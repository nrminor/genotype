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

import type { AbstractSequence } from '../types';
import type { CleanOptions, Processor } from './types';

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
    // ZIG_CANDIDATE: Hot loop processing every sequence
    // Native batch processing would improve performance
    for await (const seq of source) {
      const cleaned = this.cleanSequence(seq, options);

      // Skip empty sequences if requested
      if (options.removeEmpty && cleaned.sequence.length === 0) {
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
    if (options.trimWhitespace) {
      sequence = sequence.trim();
      if (description) {
        description = description.trim();
      }
    }

    // Remove gaps
    if (options.removeGaps) {
      const gapChars = options.gapChars || '.-*';
      sequence = this.removeGaps(sequence, gapChars);
    }

    // Replace ambiguous bases
    if (options.replaceAmbiguous) {
      const replaceChar = options.replaceChar || 'N';
      sequence = this.replaceAmbiguousBases(sequence, replaceChar);
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

  /**
   * Remove gap characters from sequence
   *
   * ZIG_CANDIDATE: Character filtering loop.
   * Native implementation would avoid regex overhead
   * and intermediate string allocations.
   *
   * @param sequence - Input sequence
   * @param gapChars - Characters to remove
   * @returns Sequence with gaps removed
   */
  private removeGaps(sequence: string, gapChars: string): string {
    // Create regex pattern from gap characters, escaping special regex chars
    const escapedChars = gapChars
      .split('')
      .map((char) => {
        // Escape special regex characters
        // Note: hyphen needs special handling in character classes
        if ('\\^$*+?.()|[]{}/-'.includes(char)) {
          return '\\' + char;
        }
        return char;
      })
      .join('');

    // ZIG_CANDIDATE: Regex replace creates new string
    // Native loop could build result directly
    const pattern = new RegExp(`[${escapedChars}]`, 'g');
    return sequence.replace(pattern, '');
  }

  /**
   * Replace ambiguous bases with a standard character
   *
   * ZIG_CANDIDATE: Character validation and replacement loop.
   * Native implementation would be faster than regex replace.
   *
   * @param sequence - Input sequence
   * @param replaceChar - Character to use for replacement
   * @returns Sequence with ambiguous bases replaced
   */
  private replaceAmbiguousBases(sequence: string, replaceChar: string): string {
    // Replace any non-standard DNA/RNA bases
    // Standard bases: A, C, G, T, U
    // Everything else (including IUPAC codes) gets replaced
    // ZIG_CANDIDATE: Regex creates new string with replacements
    return sequence.replace(/[^ACGTU]/gi, replaceChar);
  }
}
