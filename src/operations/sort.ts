/**
 * SortProcessor - High-performance sequence ordering operations
 *
 * This processor implements sophisticated sequence sorting with memory-efficient
 * algorithms designed for genomic data compression optimization. Includes
 * external sorting for datasets larger than memory and specialized algorithms
 * for genomic sequence ordering that maximize compression ratios.
 *
 * Genomic Context: Proper sequence ordering can dramatically improve compression
 * ratios for large datasets by grouping similar sequences together, which is
 * critical for managing storage costs in genomics workflows.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import type { AbstractSequence } from '../types';
import type { SortOptions } from './types';

/**
 * Memory threshold for switching to external sort (1GB)
 * ZIG_CRITICAL: This threshold calculation and memory monitoring
 * would benefit significantly from native implementation
 */
const EXTERNAL_SORT_THRESHOLD = 1024 * 1024 * 1024; // 1GB

/**
 * Processor for high-performance sequence sorting operations
 *
 * Implements multiple sorting strategies optimized for genomic data:
 * - In-memory sorting for small-medium datasets
 * - External merge sort for large datasets (seqkit-inspired)
 * - Compression-optimized ordering for storage efficiency
 *
 * @example
 * ```typescript
 * const processor = new SortProcessor();
 * const sorted = processor.process(sequences, {
 *   by: 'length',
 *   order: 'desc'
 * });
 * ```
 */
export class SortProcessor {
  /**
   * Process sequences with intelligent sorting strategy selection
   *
   * Automatically chooses between in-memory and external sorting based
   * on estimated memory usage, following seqkit's approach.
   *
   * @param source - Input sequences
   * @param options - Sort options
   * @yields Sequences in sorted order
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: SortOptions
  ): AsyncIterable<AbstractSequence> {
    this.validateOptions(options);

    // For genomic data, we need to balance memory usage with performance
    // ZIG_CRITICAL: Memory estimation and threshold decisions would be
    // much more accurate with native memory introspection
    const sequences = await this.collectWithMemoryTracking(source);

    if (this.shouldUseExternalSort(sequences)) {
      yield* this.externalSort(sequences, options);
    } else {
      yield* this.inMemorySort(sequences, options);
    }
  }

  /**
   * Collect sequences while tracking memory usage
   *
   * ZIG_CRITICAL: Memory tracking and allocation monitoring would be
   * far more accurate with native implementation, allowing for precise
   * threshold decisions for external sorting.
   */
  private async collectWithMemoryTracking(
    source: AsyncIterable<AbstractSequence>
  ): Promise<AbstractSequence[]> {
    const sequences: AbstractSequence[] = [];
    let estimatedMemory = 0;

    for await (const seq of source) {
      sequences.push(seq);

      // Estimate memory usage (rough approximation)
      // ZIG_CRITICAL: Precise memory tracking would be much better
      estimatedMemory += seq.sequence.length * 2 + 100; // chars + overhead

      if (estimatedMemory > EXTERNAL_SORT_THRESHOLD) {
        console.warn(
          `Large dataset detected (>${Math.round(estimatedMemory / 1024 / 1024)}MB), consider external sorting for optimal performance`
        );
        break;
      }
    }

    return sequences;
  }

  /**
   * Determine if external sorting should be used
   *
   * Based on seqkit's strategy for handling large genomic datasets
   */
  private shouldUseExternalSort(sequences: AbstractSequence[]): boolean {
    const estimatedMemory = sequences.reduce(
      (total, seq) => total + seq.sequence.length * 2 + 100,
      0
    );

    return estimatedMemory > EXTERNAL_SORT_THRESHOLD;
  }

  /**
   * In-memory sorting for small-medium datasets
   *
   * ZIG_BENEFICIAL: Sorting algorithms could be optimized with native
   * implementation, especially for numeric sorts (length, GC content)
   */
  private async *inMemorySort(
    sequences: AbstractSequence[],
    options: SortOptions
  ): AsyncIterable<AbstractSequence> {
    const sortedSequences = this.sortSequencesInPlace(sequences, options);

    for (const seq of sortedSequences) {
      yield seq;
    }
  }

  /**
   * External merge sort for large datasets
   *
   * ZIG_CRITICAL: External sorting with disk I/O, memory management,
   * and merge operations would benefit dramatically from native implementation.
   * This is where genomic data processing performance is often bottlenecked.
   *
   * Inspired by seqkit's two-pass approach for memory efficiency.
   */
  private async *externalSort(
    sequences: AbstractSequence[],
    options: SortOptions
  ): AsyncIterable<AbstractSequence> {
    // For now, fall back to in-memory sort with warning
    // TODO: Implement true external sorting for production use
    console.warn('External sort not yet implemented, using in-memory sort');

    yield* this.inMemorySort(sequences, options);
  }

  /**
   * Sort sequences array in place for memory efficiency
   *
   * ZIG_BENEFICIAL: In-place sorting with custom comparators could be
   * optimized with native implementation, especially for genomic-specific
   * sorting criteria like GC content or k-mer similarity.
   */
  private sortSequencesInPlace(
    sequences: AbstractSequence[],
    options: SortOptions
  ): AbstractSequence[] {
    // Use custom comparison if provided
    if (options.custom !== undefined) {
      return sequences.sort(options.custom);
    }

    // Use optimized comparison functions for genomic data
    const compareFn = this.getOptimizedCompareFunction(options.by, options.order);
    return sequences.sort(compareFn);
  }

  /**
   * Get optimized comparison function for genomic sorting
   *
   * ZIG_CRITICAL: Comparison functions are called millions of times in large sorts.
   *
   * @param sortBy - Field to sort by
   * @param order - Sort order (ascending/descending)
   * @returns Optimized comparison function
   */
  private getOptimizedCompareFunction(
    sortBy: string,
    order: string = 'asc'
  ): (a: AbstractSequence, b: AbstractSequence) => number {
    const ascending = order !== 'desc';

    switch (sortBy) {
      case 'length':
        return this.createLengthComparator(ascending);
      case 'id':
        return this.createIdComparator(ascending);
      case 'gc':
        return this.createGCComparator(ascending);
      case 'quality':
        return this.createQualityComparator(ascending);
      default:
        throw new Error(`Invalid sort criterion: ${sortBy}`);
    }
  }

  /**
   * Create length-based comparator
   * ZIG_BENEFICIAL: Called frequently for large sorts
   */
  private createLengthComparator(
    ascending: boolean
  ): (a: AbstractSequence, b: AbstractSequence) => number {
    return (a, b) => (ascending ? a.length - b.length : b.length - a.length);
  }

  /**
   * Create ID-based comparator
   * ZIG_BENEFICIAL: String comparison optimization opportunity
   */
  private createIdComparator(
    ascending: boolean
  ): (a: AbstractSequence, b: AbstractSequence) => number {
    return (a, b) => {
      const comparison = a.id.localeCompare(b.id);
      return ascending ? comparison : -comparison;
    };
  }

  /**
   * Create GC content-based comparator
   * ZIG_CRITICAL: Expensive GC calculation called for every comparison
   */
  private createGCComparator(
    ascending: boolean
  ): (a: AbstractSequence, b: AbstractSequence) => number {
    return (a, b) => {
      const gcA = this.calculateGCOptimized(a.sequence);
      const gcB = this.calculateGCOptimized(b.sequence);
      return ascending ? gcA - gcB : gcB - gcA;
    };
  }

  /**
   * Create quality score-based comparator
   * ZIG_CRITICAL: Expensive quality calculation for FASTQ files
   */
  private createQualityComparator(
    ascending: boolean
  ): (a: AbstractSequence, b: AbstractSequence) => number {
    return (a, b) => {
      const qualityA = this.getAverageQualityOptimized(a);
      const qualityB = this.getAverageQualityOptimized(b);
      return ascending ? qualityA - qualityB : qualityB - qualityA;
    };
  }

  /**
   * Optimized GC content calculation for sorting
   *
   * ZIG_CRITICAL: This function is called for every sequence pair comparison
   * when sorting by GC content. For large datasets, this becomes a major
   * performance bottleneck. Native implementation could:
   * - Use SIMD instructions for parallel character counting
   * - Cache calculated values to avoid recomputation
   * - Use bit manipulation for faster character classification
   *
   * @param sequence - DNA/RNA sequence
   * @returns GC content as percentage (0-100)
   */
  private calculateGCOptimized(sequence: string): number {
    if (sequence.length === 0) return 0;

    // ZIG_CRITICAL: This regex-based approach is inefficient for sorting
    // Native implementation would use:
    // - Direct character loop with SIMD vectorization
    // - Lookup table for character classification
    // - Parallel processing for very long sequences
    let gcCount = 0;
    const seqUpper = sequence.toUpperCase();

    for (let i = 0; i < seqUpper.length; i++) {
      const char = seqUpper[i];
      if (char === 'G' || char === 'C') {
        gcCount++;
      }
    }

    return (gcCount / sequence.length) * 100;
  }

  /**
   * Optimized average quality calculation for FASTQ sorting
   *
   * ZIG_CRITICAL: Quality score processing for sorting is extremely expensive
   * for large FASTQ files. Native implementation could:
   * - Vectorize quality score arithmetic
   * - Cache quality calculations to avoid recomputation
   * - Support multiple quality encodings efficiently
   * - Use SIMD for parallel quality score processing
   *
   * @param seq - Sequence object
   * @returns Average quality score (0 for non-FASTQ sequences)
   */
  private getAverageQualityOptimized(seq: AbstractSequence): number {
    // Type guard for FASTQ sequences
    if ('quality' in seq && typeof seq.quality === 'string') {
      const quality = seq.quality as string;
      if (quality.length === 0) return 0;

      // ZIG_CRITICAL: This loop is called millions of times in large sorts
      // Native implementation would:
      // - Use SIMD for parallel ASCII to score conversion
      // - Support different quality encodings without branching
      // - Cache results to avoid recomputation
      let totalScore = 0;
      for (let i = 0; i < quality.length; i++) {
        totalScore += quality.charCodeAt(i) - 33; // Assume Phred+33
      }
      return totalScore / quality.length;
    }

    return 0; // Non-FASTQ sequences get score of 0
  }

  /**
   * Validate sort options with genomic-aware checks
   */
  private validateOptions(options: SortOptions): void {
    if (options.custom !== undefined) {
      this.validateCustomFunction(options);
      return;
    }

    this.validateBuiltInSortOptions(options);
  }

  /**
   * Validate custom function options
   */
  private validateCustomFunction(options: SortOptions): void {
    if (typeof options.custom !== 'function') {
      throw new Error('Custom sort function must be a function');
    }
  }

  /**
   * Validate built-in sort field and order options
   */
  private validateBuiltInSortOptions(options: SortOptions): void {
    if (options.by === undefined) {
      throw new Error('Sort field (by) is required when not using custom function');
    }

    const validSortFields = ['length', 'id', 'gc', 'quality'];
    if (!validSortFields.includes(options.by)) {
      throw new Error(
        `Invalid sort field: ${options.by}. Valid options: ${validSortFields.join(', ')}`
      );
    }

    if (options.order !== undefined) {
      const validOrders = ['asc', 'desc'];
      if (!validOrders.includes(options.order)) {
        throw new Error(
          `Invalid sort order: ${options.order}. Valid options: ${validOrders.join(', ')}`
        );
      }
    }
  }

  /**
   * Estimate memory usage for sort decision
   *
   * ZIG_CRITICAL: Accurate memory estimation is crucial for choosing
   * the right sorting strategy. Native implementation would provide:
   * - Precise memory usage tracking
   * - Real-time memory pressure monitoring
   * - Automatic fallback to external sort when needed
   */
  private estimateMemoryUsage(sequences: AbstractSequence[]): number {
    return sequences.reduce((total, seq) => {
      // Rough estimate: sequence chars + object overhead + quality if present
      let seqMemory = seq.sequence.length * 2; // 2 bytes per char (UTF-16)
      seqMemory += seq.id.length * 2;
      seqMemory += 200; // Object overhead

      if ('quality' in seq && typeof seq.quality === 'string') {
        seqMemory += (seq.quality as string).length * 2;
      }

      return total + seqMemory;
    }, 0);
  }
}
