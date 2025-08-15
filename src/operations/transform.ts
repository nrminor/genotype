/**
 * TransformProcessor - Modify sequence content
 * 
 * This processor implements transformations that modify the actual
 * sequence string, including reverse complement, case changes, and
 * RNA/DNA conversions.
 * 
 * @version v0.1.0
 * @since v0.1.0
 */

import type { AbstractSequence } from '../types';
import type { TransformOptions, Processor } from './types';
import * as transforms from './core/transforms';

/**
 * Processor for transforming sequence content
 * 
 * @example
 * ```typescript
 * const processor = new TransformProcessor();
 * const transformed = processor.process(sequences, {
 *   reverseComplement: true,
 *   upperCase: true
 * });
 * ```
 */
export class TransformProcessor implements Processor<TransformOptions> {
  /**
   * Process sequences with transformations
   * 
   * @param source - Input sequences
   * @param options - Transform options
   * @yields Transformed sequences
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: TransformOptions
  ): AsyncIterable<AbstractSequence> {
    // ZIG_CANDIDATE: Hot loop processing every sequence
    // Batch processing in native code would improve throughput
    for await (const seq of source) {
      yield this.transformSequence(seq, options);
    }
  }

  /**
   * Apply transformations to a single sequence
   * 
   * Transformations are applied in a specific order to ensure
   * predictable results.
   * 
   * ZIG_CANDIDATE: String transformations (reverse, complement)
   * are CPU-intensive for large sequences. Native implementation
   * would provide significant performance gains.
   * 
   * @param seq - Sequence to transform
   * @param options - Transform options
   * @returns Transformed sequence
   */
  private transformSequence(
    seq: AbstractSequence,
    options: TransformOptions
  ): AbstractSequence {
    let sequence = seq.sequence;

    // Apply transformations in logical order
    
    // 1. Reverse complement (combines reverse + complement)
    if (options.reverseComplement) {
      // ZIG_CANDIDATE: reverseComplement is called from transforms module
      // which already has ZIG_CANDIDATE markers
      sequence = transforms.reverseComplement(sequence);
    } else {
      // 2. Individual reverse or complement
      if (options.complement) {
        // ZIG_CANDIDATE: complement mapping is CPU-intensive
        sequence = transforms.complement(sequence);
      }
      if (options.reverse) {
        // ZIG_CANDIDATE: string reversal allocates new string
        sequence = transforms.reverse(sequence);
      }
    }

    // 3. RNA/DNA conversion
    if (options.toRNA) {
      // ZIG_CANDIDATE: Character replacement loop
      sequence = transforms.toRNA(sequence);
    } else if (options.toDNA) {
      // ZIG_CANDIDATE: Character replacement loop
      sequence = transforms.toDNA(sequence);
    }

    // 4. Case transformation (last to preserve user preference)
    if (options.upperCase) {
      sequence = sequence.toUpperCase();
    } else if (options.lowerCase) {
      sequence = sequence.toLowerCase();
    }

    // 5. Custom transformation
    if (options.custom) {
      sequence = options.custom(sequence);
    }

    // Return new sequence object if changed
    if (sequence === seq.sequence) {
      return seq;
    }

    return {
      ...seq,
      sequence,
      length: sequence.length
    };
  }
}