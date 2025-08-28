/**
 * RmdupProcessor - High-performance sequence deduplication
 *
 * This processor implements sophisticated sequence deduplication leveraging
 * existing Bloom filter and exact deduplication utilities. Optimized for
 * genomic workflows where PCR duplicates and redundant sequences need removal.
 *
 * Genomic Context: Deduplication is critical in genomics for removing PCR
 * duplicates from sequencing data and redundant sequences from assemblies,
 * significantly improving downstream analysis quality and reducing storage costs.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { type } from 'arktype';
import type { AbstractSequence } from '../types';
import { SequenceDeduplicator, ExactDeduplicator } from './core/sequence-deduplicator';
import type { DeduplicationStrategy } from './core/sequence-deduplicator';
import type { RmdupOptions } from './types';
import { createOptionsValidator } from './core/validation-utils';

/**
 * Schema for validating RmdupOptions using ArkType
 */
const RmdupOptionsSchema = type({
  by: 'string', // Let custom validator handle valid values
  'caseSensitive?': 'boolean',
  'exact?': 'boolean',
  'expectedUnique?': 'number', // Let custom validator handle positive constraint
  'falsePositiveRate?': 'number', // Let custom validator handle range constraint
});

/**
 * Common validation function for rmdup options using the new pattern
 */
const validateRmdupOptions = createOptionsValidator<RmdupOptions>(RmdupOptionsSchema, [
  // Strategy validation
  (options: RmdupOptions) => {
    const validStrategies = ['sequence', 'id', 'both'];
    if (!validStrategies.includes(options.by)) {
      throw new Error(
        `Invalid deduplication strategy: ${options.by}. Valid options: ${validStrategies.join(', ')}`
      );
    }
  },
  // Expected unique validation
  (options: RmdupOptions) => {
    if (options.expectedUnique !== undefined && options.expectedUnique <= 0) {
      throw new Error(`Expected unique count must be positive, got: ${options.expectedUnique}`);
    }
  },
  // False positive rate validation
  (options: RmdupOptions) => {
    if (options.falsePositiveRate !== undefined) {
      if (options.falsePositiveRate <= 0 || options.falsePositiveRate > 0.1) {
        throw new Error(
          `False positive rate must be between 0 and 0.1, got: ${options.falsePositiveRate}`
        );
      }
    }
  },
]);

/**
 * Processor for high-performance sequence deduplication
 *
 * Leverages existing Bloom filter and exact deduplication utilities for
 * optimal performance across different dataset sizes and accuracy requirements.
 *
 * @example
 * ```typescript
 * const processor = new RmdupProcessor();
 * const deduplicated = processor.process(sequences, {
 *   by: 'sequence',
 *   caseSensitive: false,
 *   exact: false
 * });
 * ```
 */
export class RmdupProcessor {
  /**
   * Process sequences with deduplication
   *
   * Automatically chooses between Bloom filter and exact deduplication
   * based on accuracy requirements and dataset characteristics.
   *
   * @param source - Input sequences
   * @param options - Deduplication options
   * @yields Unique sequences (first occurrence of duplicates)
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: RmdupOptions
  ): AsyncIterable<AbstractSequence> {
    validateRmdupOptions(options);

    const deduplicationStrategy = this.mapStrategy(options.by);
    const caseSensitive = options.caseSensitive ?? true;

    if (options.exact === true) {
      yield* this.exactDeduplication(source, deduplicationStrategy, caseSensitive);
    } else {
      yield* this.bloomDeduplication(source, deduplicationStrategy, options);
    }
  }

  /**
   * Exact deduplication using Set-based approach
   *
   * NATIVE_BENEFICIAL: Hash set operations and string hashing could be
   * optimized with native implementation for better performance on
   * large genomic datasets.
   */
  private async *exactDeduplication(
    source: AsyncIterable<AbstractSequence>,
    strategy: DeduplicationStrategy,
    caseSensitive: boolean
  ): AsyncIterable<AbstractSequence> {
    const deduplicator = new ExactDeduplicator(strategy, caseSensitive);

    // Use the existing deduplicate method that yields unique sequences
    yield* deduplicator.deduplicate(source);
  }

  /**
   * Bloom filter-based deduplication for large datasets
   *
   * NATIVE_CRITICAL: Bloom filter operations (hash computation, bit array access)
   * are core bottlenecks for large genomic datasets. Native implementation
   * could provide dramatic performance improvements through:
   * - SIMD-optimized hashing (xxhash or similar)
   * - Efficient bit array operations
   * - Reduced memory allocations
   * - Parallel processing for multiple hash functions
   */
  private async *bloomDeduplication(
    source: AsyncIterable<AbstractSequence>,
    strategy: DeduplicationStrategy,
    options: RmdupOptions
  ): AsyncIterable<AbstractSequence> {
    const deduplicationOptions = {
      strategy,
      expectedSequences: options.expectedUnique ?? 1_000_000,
      falsePositiveRate: options.falsePositiveRate ?? 0.001,
      scalable: true, // Always use scalable for robustness
      trackDuplicates: false, // Keep memory usage minimal
      caseSensitive: options.caseSensitive ?? true,
    };

    const deduplicator = new SequenceDeduplicator(deduplicationOptions);

    // Use the existing deduplicate method that yields unique sequences
    yield* deduplicator.deduplicate(source);
  }

  /**
   * Map rmdup options to core deduplication strategy
   */
  private mapStrategy(by: string): DeduplicationStrategy {
    switch (by) {
      case 'sequence':
        return 'sequence';
      case 'id':
        return 'id';
      case 'both':
        return 'both';
      default:
        throw new Error(`Invalid deduplication criterion: ${by}`);
    }
  }
}
