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

import type { AbstractSequence } from "../types";
import { removeGaps, replaceAmbiguousBases } from "./core/sequence-manipulation";
import type { CleanOptions, Processor } from "./types";

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
