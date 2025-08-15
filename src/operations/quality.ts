/**
 * QualityProcessor - FASTQ quality score operations
 * 
 * This processor implements quality-based filtering and trimming
 * specifically for FASTQ sequences. Operations are no-ops for
 * non-FASTQ sequences.
 * 
 * @version v0.1.0
 * @since v0.1.0
 */

import type { AbstractSequence, FastqSequence } from '../types';
import type { QualityOptions, Processor } from './types';
import * as qualityUtils from './core/quality';

/**
 * Processor for FASTQ quality operations
 * 
 * @example
 * ```typescript
 * const processor = new QualityProcessor();
 * const filtered = processor.process(sequences, {
 *   minScore: 20,
 *   trim: true,
 *   trimThreshold: 20,
 *   trimWindow: 4
 * });
 * ```
 */
export class QualityProcessor implements Processor<QualityOptions> {
  /**
   * Process sequences with quality operations
   * 
   * @param source - Input sequences
   * @param options - Quality options
   * @yields Sequences after quality filtering/trimming
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: QualityOptions
  ): AsyncIterable<AbstractSequence> {
    // ZIG_CANDIDATE: Hot loop processing FASTQ sequences
    // Quality score calculations are CPU-intensive
    for await (const seq of source) {
      // Skip non-FASTQ sequences
      if (!this.isFastq(seq)) {
        yield seq;
        continue;
      }

      const processed = this.processQuality(seq as FastqSequence, options);
      
      // Filter out sequences that don't meet quality thresholds
      if (processed) {
        yield processed;
      }
    }
  }

  /**
   * Check if sequence is FASTQ format
   * 
   * @param seq - Sequence to check
   * @returns True if sequence is FASTQ
   */
  private isFastq(seq: AbstractSequence): seq is FastqSequence {
    return 'quality' in seq && typeof seq.quality === 'string';
  }

  /**
   * Apply quality operations to a FASTQ sequence
   * 
   * @param seq - FASTQ sequence
   * @param options - Quality options
   * @returns Processed sequence or null if filtered out
   */
  private processQuality(
    seq: FastqSequence,
    options: QualityOptions
  ): FastqSequence | null {
    let sequence = seq.sequence;
    let quality = seq.quality;
    const encoding = options.encoding || 'phred33';

    // Quality trimming
    if (options.trim) {
      const trimmed = this.qualityTrim(
        sequence,
        quality,
        options.trimThreshold || 20,
        options.trimWindow || 4,
        encoding,
        options.trimFromStart,
        options.trimFromEnd
      );
      
      if (!trimmed) {
        return null; // Sequence trimmed to nothing
      }
      
      sequence = trimmed.sequence;
      quality = trimmed.quality;
    }

    // Average quality filtering
    if (options.minScore !== undefined || options.maxScore !== undefined) {
      // ZIG_CANDIDATE: Quality score conversion and averaging
      // Native implementation would be more efficient
      const avgQuality = qualityUtils.averageQuality(quality, encoding);
      
      if (options.minScore !== undefined && avgQuality < options.minScore) {
        return null;
      }
      
      if (options.maxScore !== undefined && avgQuality > options.maxScore) {
        return null;
      }
    }

    // Return updated sequence if changed
    if (sequence === seq.sequence && quality === seq.quality) {
      return seq;
    }

    return {
      ...seq,
      sequence,
      quality,
      length: sequence.length
    };
  }

  /**
   * Perform quality trimming on a sequence
   * 
   * @param sequence - DNA/RNA sequence
   * @param quality - Quality string
   * @param threshold - Quality threshold
   * @param windowSize - Sliding window size
   * @param encoding - Quality encoding
   * @param trimStart - Trim from 5' end
   * @param trimEnd - Trim from 3' end
   * @returns Trimmed sequence and quality or null if empty
   */
  private qualityTrim(
    sequence: string,
    quality: string,
    threshold: number,
    windowSize: number,
    encoding: 'phred33' | 'phred64',
    trimStart?: boolean,
    trimEnd?: boolean
  ): { sequence: string; quality: string } | null {
    // Default to trimming both ends if not specified
    const fromStart = trimStart ?? true;
    const fromEnd = trimEnd ?? true;

    let start = 0;
    let end = sequence.length;

    // Trim from 5' end
    if (fromStart) {
      start = this.findTrimStart(quality, threshold, windowSize, encoding);
    }

    // Trim from 3' end
    if (fromEnd && start < end) {
      end = this.findTrimEnd(quality, threshold, windowSize, encoding, start);
    }

    // Check if anything remains
    if (start >= end) {
      return null;
    }

    return {
      sequence: sequence.slice(start, end),
      quality: quality.slice(start, end)
    };
  }

  /**
   * Find trim position from start of sequence
   * 
   * ZIG_CANDIDATE: Sliding window quality calculation.
   * Native implementation would avoid string slicing
   * and repeated quality score conversions.
   * 
   * @param quality - Quality string
   * @param threshold - Quality threshold
   * @param windowSize - Window size
   * @param encoding - Quality encoding
   * @returns Start position for trimming
   */
  private findTrimStart(
    quality: string,
    threshold: number,
    windowSize: number,
    encoding: 'phred33' | 'phred64'
  ): number {
    // ZIG_CANDIDATE: Hot loop with string slicing and quality calculations
    for (let i = 0; i <= quality.length - windowSize; i++) {
      const window = quality.slice(i, i + windowSize);
      const avgQual = qualityUtils.averageQuality(window, encoding);
      
      if (avgQual >= threshold) {
        return i;
      }
    }
    
    return quality.length; // No good quality found
  }

  /**
   * Find trim position from end of sequence
   * 
   * ZIG_CANDIDATE: Sliding window quality calculation.
   * Native implementation would avoid string slicing
   * and repeated quality score conversions.
   * 
   * @param quality - Quality string
   * @param threshold - Quality threshold
   * @param windowSize - Window size
   * @param encoding - Quality encoding
   * @param start - Start position (don't trim before this)
   * @returns End position for trimming
   */
  private findTrimEnd(
    quality: string,
    threshold: number,
    windowSize: number,
    encoding: 'phred33' | 'phred64',
    start: number
  ): number {
    // ZIG_CANDIDATE: Hot loop with string slicing and quality calculations
    for (let i = quality.length - windowSize; i >= start; i--) {
      const window = quality.slice(i, i + windowSize);
      const avgQual = qualityUtils.averageQuality(window, encoding);
      
      if (avgQual >= threshold) {
        return i + windowSize;
      }
    }
    
    return start; // No good quality found
  }
}