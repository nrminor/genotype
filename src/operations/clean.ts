/**
 * CleanProcessor - Sanitize and fix sequence issues
 *
 * Delegates to the native SIMD-accelerated transform kernel for gap
 * removal and ambiguous base replacement. Whitespace trimming and
 * empty sequence filtering are handled per-sequence around the
 * batched kernel path.
 */

import { type } from "arktype";
import { removeGapsBatch, replaceAmbiguousBatch } from "../backend/service";
import { withSequence } from "../constructors";
import { ValidationError } from "../errors";
import { GenotypeString } from "../genotype-string";
import { packSequences } from "../backend/batch";
import type { AbstractSequence } from "../types";
import type { CleanOptions, Processor } from "./types";

/** Byte budget per native batch. Sequences accumulate until this threshold. */
const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

/**
 * Valid nucleotide characters for replaceChar validation
 */
const VALID_REPLACE_CHARS = new Set(["A", "C", "G", "T", "U", "N"]);

/**
 * ArkType schema for CleanOptions validation
 *
 * Validates cleaning operation options with semantic constraints:
 * - gapChars must be non-empty if provided
 * - replaceChar must be exactly 1 character
 * - replaceChar must be a valid nucleotide when replaceAmbiguous is true
 */
const CleanOptionsSchema = type({
  "removeGaps?": "boolean",
  "gapChars?": "string>=1",
  "replaceAmbiguous?": "boolean",
  "replaceChar?": "string==1",
  "trimWhitespace?": "boolean",
  "removeEmpty?": "boolean",
}).narrow((options, ctx) => {
  if (
    options.replaceAmbiguous === true &&
    options.replaceChar !== undefined &&
    !VALID_REPLACE_CHARS.has(options.replaceChar.toUpperCase())
  ) {
    return ctx.reject({
      expected: "a valid nucleotide (A, C, G, T, U, or N)",
      actual: `'${options.replaceChar}'`,
      path: ["replaceChar"],
    });
  }

  return true;
});

/**
 * Processor for cleaning and sanitizing sequences
 *
 * @example
 * ```typescript
 * const processor = new CleanProcessor();
 * const cleaned = processor.process(sequences, {
 *   removeGaps: true,
 *   replaceAmbiguous: true,
 *   replaceChar: 'N'
 * });
 * ```
 */
export class CleanProcessor implements Processor<CleanOptions> {
  /**
   * Process sequences with cleaning operations
   *
   * @param source - Input sequences
   * @param options - Clean options
   * @yields Cleaned sequences, may filter out empty sequences
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: CleanOptions
  ): AsyncIterable<AbstractSequence> {
    const validationResult = CleanOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid clean options: ${validationResult.summary}`);
    }

    const hasKernelOps = options.removeGaps === true || options.replaceAmbiguous === true;

    // No kernel ops — handle trim and removeEmpty per-sequence.
    if (!hasKernelOps) {
      for await (const seq of source) {
        const cleaned = applyTrim(seq, options);
        if (options.removeEmpty === true && cleaned.sequence.length === 0) {
          continue;
        }
        yield cleaned;
      }
      return;
    }

    let batch: AbstractSequence[] = [];
    let batchBytes = 0;

    for await (const seq of source) {
      // Pre-process: trim before packing (matches current operation order).
      const trimmed = applyTrim(seq, options);
      batch.push(trimmed);
      batchBytes += trimmed.sequence.length;

      if (batchBytes >= BATCH_BYTE_BUDGET) {
        yield* await flushBatch(batch, options);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* await flushBatch(batch, options);
    }
  }
}

/**
 * Apply whitespace trimming to a sequence's content and description.
 *
 * Returns the original object unchanged if trimWhitespace is not set
 * or if trimming produces no change (preserving reference identity
 * for the no-op short-circuit path).
 */
function applyTrim(seq: AbstractSequence, options: CleanOptions): AbstractSequence {
  if (options.trimWhitespace !== true) {
    return seq;
  }

  const trimmedSeq = seq.sequence.trim();
  const seqChanged = !trimmedSeq.equals(seq.sequence);

  const { description } = seq;
  if (description !== undefined) {
    const trimmedDesc = description.trim();
    if (trimmedDesc !== description) {
      const result = seqChanged ? withSequence(seq, trimmedSeq) : seq;
      return { ...result, description: trimmedDesc };
    }
  }

  return seqChanged ? withSequence(seq, trimmedSeq) : seq;
}

/**
 * Pack a batch of sequences, run kernel ops, unpack the results,
 * and yield cleaned sequences. Skips empty sequences if removeEmpty
 * is set.
 */
async function* flushBatch(
  sequences: readonly AbstractSequence[],
  options: CleanOptions
): AsyncIterable<AbstractSequence> {
  const packed = packSequences(sequences);
  let data: Uint8Array = packed.data;
  let offsets: Uint32Array | number[] = packed.offsets;

  if (options.removeGaps === true) {
    const gapChars = options.gapChars ?? ".-*";
    const result = await removeGapsBatch(data, asUint32Array(offsets), gapChars);
    data = result.data;
    offsets = result.offsets;
  }

  if (options.replaceAmbiguous === true) {
    const replaceChar = options.replaceChar ?? "N";
    // replaceAmbiguous is length-preserving, so offsets don't change.
    // We only need the transformed data — keeping the existing offsets
    // avoids replacing a Uint32Array with a number[] of identical values.
    const result = await replaceAmbiguousBatch(data, asUint32Array(offsets), replaceChar);
    data = result.data;
  }

  for (let i = 0; i < sequences.length; i++) {
    const start = offsets[i]!;
    const end = offsets[i + 1]!;

    if (options.removeEmpty === true && start === end) {
      continue;
    }

    const sequence = GenotypeString.fromBytes(data.subarray(start, end));
    yield withSequence(sequences[i]!, sequence);
  }
}

/**
 * Convert offsets to Uint32Array if they aren't already. Kernel
 * functions accept Uint32Array; the initial packed offsets are
 * Uint32Array, but kernel results return number[].
 */
function asUint32Array(offsets: Uint32Array | number[]): Uint32Array {
  return offsets instanceof Uint32Array ? offsets : new Uint32Array(offsets);
}
