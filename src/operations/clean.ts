/**
 * CleanProcessor - Sanitize and fix sequence issues
 *
 * This processor implements cleaning operations that fix common
 * issues in sequence data, such as removing gaps, replacing
 * ambiguous bases, and trimming whitespace.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { type } from "arktype";
import { ValidationError } from "../errors";
import type { AbstractSequence } from "../types";
import { removeGaps, replaceAmbiguousBases } from "./core/sequence-manipulation";
import type { CleanOptions, Processor } from "./types";

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
  // Semantic validation: replaceChar must be a valid nucleotide when replaceAmbiguous is true
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
    // Validate options using ArkType schema
    const validationResult = CleanOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid clean options: ${validationResult.summary}`);
    }

    // NATIVE_CANDIDATE: Hot loop processing every sequence
    // Native batch processing would improve performance
    for await (const seq of source) {
      const cleaned = this.cleanSequence(seq, options);

      // Skip empty sequences if requested
      if (options.removeEmpty === true && cleaned.sequence.length === 0) {
        continue;
      }

      yield cleaned;
    }
  }

  /**
   * Apply cleaning operations to a single sequence
   *
   * @param seq - Sequence to clean
   * @param options - Clean options
   * @returns Cleaned sequence
   */
  private cleanSequence(seq: AbstractSequence, options: CleanOptions): AbstractSequence {
    let sequence = seq.sequence;
    let description = seq.description;

    // Trim whitespace first
    if (options.trimWhitespace === true) {
      sequence = sequence.trim();
      if (description !== undefined) {
        description = description.trim();
      }
    }

    // Remove gaps
    if (options.removeGaps === true) {
      const gapChars = options.gapChars ?? ".-*";
      sequence = removeGaps(sequence, gapChars);
    }

    // Replace ambiguous bases
    if (options.replaceAmbiguous === true) {
      const replaceChar = options.replaceChar ?? "N";
      sequence = replaceAmbiguousBases(sequence, replaceChar);
    }

    // Return new sequence object if changed
    if (sequence === seq.sequence && description === seq.description) {
      return seq;
    }

    return {
      ...seq,
      sequence,
      length: sequence.length,
      ...(description !== seq.description && { description }),
    };
  }
}
