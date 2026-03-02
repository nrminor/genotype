/**
 * GrepProcessor - Pattern search and filtering for sequences
 *
 * This processor implements pattern matching functionality similar to Unix grep,
 * allowing searches across sequence content, IDs, and descriptions with support
 * for regex patterns, case-insensitive matching, and fuzzy matching with mismatches.
 *
 * When the native addon is available and the options are compatible, sequence
 * searches are delegated to a SIMD-accelerated Rust kernel via batched FFI
 * calls. The native fast-path covers string patterns against sequence content
 * with any combination of ignoreCase, allowMismatches, and searchBothStrands.
 * All other cases (RegExp patterns, non-sequence targets, wholeWord) fall
 * through to the TypeScript implementation.
 */

import { type } from "arktype";
import { GrepError, ValidationError } from "../errors";
import { type NativeKernel, getNativeKernel, packSequences } from "../native";
import type { AbstractSequence } from "../types";
import { hasPatternWithMismatches } from "./core/pattern-matching";
import { escapeRegex } from "./core/string-utils";
import type { GrepOptions, Processor } from "./types";

/** Byte budget per native batch. Sequences accumulate until this threshold. */
const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

/**
 * ArkType schema for GrepOptions validation
 */
const GrepOptionsSchema = type({
  pattern: "string | RegExp",
  target: "'sequence' | 'id' | 'description'",
  "ignoreCase?": "boolean",
  "invert?": "boolean",
  "wholeWord?": "boolean",
  "allowMismatches?": "number>=0",
  "searchBothStrands?": "boolean",
}).narrow((options, ctx) => {
  // Pattern validation - ensure string patterns aren't empty
  if (typeof options.pattern === "string" && options.pattern.trim() === "") {
    return ctx.reject({
      expected: "non-empty pattern string",
      actual: "empty string",
      path: ["pattern"],
    });
  }

  // Validate mismatch/target compatibility
  if (options.allowMismatches && options.allowMismatches > 0 && options.target !== "sequence") {
    return ctx.reject({
      expected: "target: 'sequence' for fuzzy matching",
      actual: `target: '${options.target}' with allowMismatches > 0`,
      path: ["allowMismatches"],
    });
  }

  return true;
});

/**
 * Processor for pattern search operations
 *
 * Implements Unix grep-style pattern matching with bioinformatics enhancements.
 * Maintains streaming behavior and single responsibility principle.
 *
 * @example
 * ```typescript
 * const processor = new GrepProcessor();
 * const matches = processor.process(sequences, {
 *   pattern: /^chr\d+/,
 *   target: 'id',
 *   ignoreCase: true
 * });
 * ```
 */
export class GrepProcessor implements Processor<GrepOptions> {
  /**
   * Process sequences with pattern matching
   *
   * @param source - Input sequences
   * @param options - Grep options
   * @yields Sequences that match the pattern criteria
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: GrepOptions
  ): AsyncIterable<AbstractSequence> {
    const validationResult = GrepOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid grep options: ${validationResult.summary}`);
    }

    if (
      typeof options.pattern === "string" &&
      options.target === "sequence" &&
      options.wholeWord !== true
    ) {
      const nativeKernel = getNativeKernel();
      if (nativeKernel !== undefined) {
        yield* this.processNative(source, nativeKernel, options.pattern, options);
        return;
      }
    }

    for await (const seq of source) {
      const matches = this.sequenceMatches(seq, options);
      const shouldYield = options.invert === true ? !matches : matches;

      if (shouldYield) {
        yield seq;
      }
    }
  }

  /**
   * Check if a sequence matches the pattern criteria
   *
   * @param seq - Sequence to check
   * @param options - Pattern matching options
   * @returns True if sequence matches criteria
   */
  private sequenceMatches(seq: AbstractSequence, options: GrepOptions): boolean {
    const target = this.getSearchTarget(seq, options.target);
    if (target === null || target === "") return false;

    return this.patternMatches(target, options);
  }

  /**
   * Extract the target field for searching
   *
   * @param seq - Sequence object
   * @param target - Field to extract
   * @returns Target string or null if not available
   */
  private getSearchTarget(seq: AbstractSequence, target: string): string | null {
    switch (target) {
      case "sequence":
        return seq.sequence.toString();
      case "id":
        return seq.id;
      case "description":
        return seq.description ?? null;
      default:
        throw new GrepError(
          `Invalid search target: ${target}. Valid targets: ${["sequence", "id", "description"].join(", ")}`
        );
    }
  }

  /**
   * Check if target string matches the pattern
   *
   * @param target - String to search in
   * @param options - Pattern matching options
   * @returns True if pattern matches
   */
  private patternMatches(target: string, options: GrepOptions): boolean {
    const { pattern, ignoreCase, wholeWord, allowMismatches, searchBothStrands } = options;

    // Handle regex patterns
    if (pattern instanceof RegExp) {
      return this.regexMatches(target, pattern, ignoreCase === true);
    }

    // Handle string patterns
    const searchTarget = ignoreCase === true ? target.toLowerCase() : target;
    const searchPattern = ignoreCase === true ? pattern.toLowerCase() : pattern;

    // Handle sequence matching (including both strands and fuzzy matching)
    if (options.target === "sequence") {
      const maxMismatches = allowMismatches ?? 0;
      return hasPatternWithMismatches(
        searchTarget,
        searchPattern,
        maxMismatches,
        searchBothStrands === true
      );
    }

    // Handle whole word matching
    if (wholeWord === true) {
      const wordRegex = new RegExp(
        `\\b${escapeRegex(searchPattern)}\\b`,
        ignoreCase === true ? "i" : ""
      );
      return wordRegex.test(target);
    }

    // Simple string inclusion
    return searchTarget.includes(searchPattern);
  }

  /**
   * Check regex pattern matching with case sensitivity handling
   */
  private regexMatches(target: string, pattern: RegExp, ignoreCase: boolean): boolean {
    if (ignoreCase === true && !pattern.flags.includes("i")) {
      // Create case-insensitive version if needed
      const flags = `${pattern.flags}i`;
      const caseInsensitivePattern = new RegExp(pattern.source, flags);
      return caseInsensitivePattern.test(target);
    }
    return pattern.test(target);
  }

  /**
   * Process sequences through the native SIMD-accelerated grep kernel.
   *
   * Accumulates sequences into batches by byte budget, packs each batch
   * into the contiguous layout the Rust kernel expects, calls grepBatch,
   * and yields matching sequences. The invert flag is applied here after
   * the native call returns.
   */
  private async *processNative(
    source: AsyncIterable<AbstractSequence>,
    nativeKernel: NativeKernel,
    pattern: string,
    options: GrepOptions
  ): AsyncIterable<AbstractSequence> {
    const patternBytes = Buffer.from(pattern);
    const maxEdits = options.allowMismatches ?? 0;
    const caseInsensitive = options.ignoreCase === true;
    const searchBothStrands = options.searchBothStrands === true;
    const invert = options.invert === true;

    let batch: AbstractSequence[] = [];
    let batchBytes = 0;

    for await (const seq of source) {
      batch.push(seq);
      batchBytes += seq.sequence.length;

      if (batchBytes >= BATCH_BYTE_BUDGET) {
        yield* flushBatch(
          batch,
          nativeKernel,
          patternBytes,
          maxEdits,
          caseInsensitive,
          searchBothStrands,
          invert
        );
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* flushBatch(
        batch,
        nativeKernel,
        patternBytes,
        maxEdits,
        caseInsensitive,
        searchBothStrands,
        invert
      );
    }
  }
}

/**
 * Pack a batch of sequences, call the native grep kernel, and yield
 * sequences that match (or don't match, if inverted).
 */
function* flushBatch(
  sequences: readonly AbstractSequence[],
  nativeKernel: NativeKernel,
  patternBytes: Buffer,
  maxEdits: number,
  caseInsensitive: boolean,
  searchBothStrands: boolean,
  invert: boolean
): Iterable<AbstractSequence> {
  const { data, offsets } = packSequences(sequences);
  const matches = nativeKernel.grepBatch(
    data,
    offsets,
    patternBytes,
    maxEdits,
    caseInsensitive,
    searchBothStrands
  );

  for (let i = 0; i < sequences.length; i++) {
    const matched = matches[i] === 1;
    const shouldYield = invert ? !matched : matched;
    if (shouldYield) {
      yield sequences[i]!;
    }
  }
}
