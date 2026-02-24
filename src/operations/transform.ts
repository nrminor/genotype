/**
 * TransformProcessor - Modify sequence content
 *
 * This processor implements transformations that modify the actual
 * sequence string, including reverse complement, case changes, and
 * RNA/DNA conversions.
 *
 */

import { withSequence } from "../constructors";
import type { GenotypeString } from "../genotype-string";
import type { AbstractSequence } from "../types";
import * as seqManip from "./core/sequence-manipulation";
import type { Processor, TransformOptions } from "./types";

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
    // NATIVE_CANDIDATE: Hot loop processing every sequence
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
   * NATIVE_CANDIDATE: String transformations (reverse, complement)
   * are CPU-intensive for large sequences. Native implementation
   * would provide significant performance gains.
   *
   * @param seq - Sequence to transform
   * @param options - Transform options
   * @returns Transformed sequence
   */
  private transformSequence(seq: AbstractSequence, options: TransformOptions): AbstractSequence {
    let sequence: GenotypeString | string = seq.sequence;

    // 1. Reverse complement (combines reverse + complement)
    if (options.reverseComplement === true) {
      sequence = seqManip.reverseComplement(sequence);
    } else {
      // 2. Individual reverse or complement
      if (options.complement === true) {
        sequence = seqManip.complement(sequence);
      }
      if (options.reverse === true) {
        sequence = seqManip.reverse(sequence);
      }
    }

    // 3. RNA/DNA conversion
    if (options.toRNA === true) {
      sequence = seqManip.toRNA(sequence);
    } else if (options.toDNA === true) {
      sequence = seqManip.toDNA(sequence);
    }

    // 4. Case transformation (last to preserve user preference)
    if (options.upperCase === true) {
      sequence = sequence.toUpperCase();
    } else if (options.lowerCase === true) {
      sequence = sequence.toLowerCase();
    }

    // 5. Custom transformation
    if (options.custom) {
      sequence = options.custom(sequence.toString());
    }

    if (sequence === seq.sequence) {
      return seq;
    }

    return withSequence(seq, sequence);
  }
}
