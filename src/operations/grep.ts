/**
 * GrepProcessor - Pattern search and filtering for sequences
 *
 * This processor implements pattern matching functionality similar to Unix grep,
 * allowing searches across sequence content, IDs, and descriptions with support
 * for regex patterns, case-insensitive matching, and fuzzy matching with mismatches.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { type } from "arktype";
import { GrepError, ValidationError } from "../errors";
import type { AbstractSequence } from "../types";
import { hasPatternWithMismatches } from "./core/pattern-matching";
import type { GrepOptions } from "./types";

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
export class GrepProcessor {
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
    // Direct ArkType validation
    const validationResult = GrepOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid grep options: ${validationResult.summary}`);
    }

    for await (const seq of source) {
      const matches = this.sequenceMatches(seq, options);

      // Apply invert logic
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
        return seq.sequence;
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
        `\\b${this.escapeRegex(searchPattern)}\\b`,
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
   * Escape special regex characters in string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
