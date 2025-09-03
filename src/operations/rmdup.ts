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

import { type } from "arktype";
import { ValidationError } from "../errors";
import type { AbstractSequence } from "../types";
import type { DeduplicationStrategy } from "./core/sequence-deduplicator";
import { ExactDeduplicator, SequenceDeduplicator } from "./core/sequence-deduplicator";
import type { RmdupOptions } from "./types";

/**
 * ArkType schema for RmdupOptions validation
 */
const RmdupOptionsSchema = type({
  by: "'sequence' | 'id' | 'both'",
  "caseSensitive?": "boolean",
  "exact?": "boolean",
  "expectedUnique?": "number>0",
  "falsePositiveRate?": "0 < number <= 0.1",
});
// export type RmdupOptionsSchema = typeof RmdupOptionsSchema.infer;

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
    // Direct ArkType validation
    const validationResult = RmdupOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid rmdup options: ${validationResult.summary}`);
    }

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
   *
   * Note: ArkType already validated the enum, so no error case needed
   */
  private mapStrategy(by: "sequence" | "id" | "both"): DeduplicationStrategy {
    // Direct mapping - ArkType guarantees valid values
    return by;
  }
}
