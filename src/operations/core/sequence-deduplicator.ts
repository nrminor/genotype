/**
 * Memory-efficient sequence deduplication using probabilistic data structures.
 *
 * This module provides streaming-first deduplication with Bloom filters for
 * constant memory usage regardless of dataset size, with support for multiple
 * deduplication strategies and duplicate tracking.
 *
 * @module sequence-deduplicator
 * @since v0.1.0
 *
 * @remarks
 * Key features:
 * - Probabilistic deduplication with configurable false positive rate
 * - Multiple strategies (sequence, ID, both, exact, custom)
 * - Scalable Bloom filters that grow as needed
 * - Duplicate tracking and statistics
 * - Memory usage independent of dataset size
 *
 * Performance considerations:
 * - Bloom filter uses ~10 bits per expected sequence
 * - False positive rate of 0.1% requires ~14.4 bits per item
 * - Scalable filters add ~15% overhead but handle overflow gracefully
 * - ExactDeduplicator provides 100% accuracy at higher memory cost
 */

import type { AbstractSequence } from "../../types";
import { BloomFilter, ScalableBloomFilter } from "./bloom-filter";

/**
 * Strategy for determining sequence uniqueness.
 *
 * Built-in strategies:
 * - 'sequence': By sequence content only (ignores ID)
 * - 'id': By sequence ID only (ignores content)
 * - 'both': By combination of ID and sequence (default)
 * - 'exact': By all fields including description
 * - Custom function: (seq) => string for custom uniqueness
 *
 * @typedef {string | Function} DeduplicationStrategy
 * @since v0.1.0
 *
 * @example
 * ```typescript
 * // Deduplicate by first 50 bases (prefix matching)
 * const prefixStrategy: DeduplicationStrategy =
 *   seq => seq.sequence.substring(0, 50);
 *
 * // Deduplicate by sequence length
 * const lengthStrategy: DeduplicationStrategy =
 *   seq => seq.sequence.length.toString();
 * ```
 */
export type DeduplicationStrategy =
  | "sequence" // Deduplicate by sequence content only
  | "id" // Deduplicate by ID only
  | "both" // Deduplicate by ID and sequence (default)
  | "exact" // Deduplicate by exact match of all fields
  | ((seq: AbstractSequence) => string); // Custom key function

/**
 * Configuration options for sequence deduplication.
 *
 * @interface DeduplicationOptions
 * @since v0.1.0
 *
 * @example
 * ```typescript
 * const options: DeduplicationOptions = {
 *   strategy: 'sequence',
 *   expectedSequences: 10_000_000,
 *   falsePositiveRate: 0.0001, // 0.01%
 *   scalable: true,
 *   trackDuplicates: true,
 *   caseSensitive: false
 * };
 * ```
 */
export interface DeduplicationOptions {
  /**
   * Strategy for determining sequence uniqueness.
   * @default 'both' (deduplicate by ID and sequence)
   */
  strategy?: DeduplicationStrategy;

  /**
   * Expected number of unique sequences.
   * Used to optimally size the Bloom filter.
   * Underestimating may increase false positive rate.
   * @default 1000000
   * @minimum 100
   */
  expectedSequences?: number;

  /**
   * Acceptable false positive rate.
   * Lower values use more memory but are more accurate.
   * @default 0.001 (0.1%)
   * @minimum 0.00001 (0.001%)
   * @maximum 0.1 (10%)
   */
  falsePositiveRate?: number;

  /**
   * Use scalable Bloom filter that grows as needed.
   * Handles datasets larger than expected with minimal FPR increase.
   * @default false
   */
  scalable?: boolean;

  /**
   * Track duplicate counts and report most common.
   * Adds memory overhead proportional to number of unique duplicates.
   * @default false
   */
  trackDuplicates?: boolean;

  /**
   * Whether sequence comparison is case-sensitive.
   * When false, sequences are compared in uppercase.
   * @default true
   */
  caseSensitive?: boolean;
}

/**
 * Statistics about the deduplication process.
 *
 * @interface DeduplicationStats
 * @since v0.1.0
 *
 * @example
 * ```typescript
 * const stats = deduplicator.getStats();
 * console.log(`Processed: ${stats.totalProcessed}`);
 * console.log(`Unique: ${stats.uniqueCount}`);
 * console.log(`Duplicates removed: ${stats.duplicateCount}`);
 * console.log(`Memory usage: ${(stats.memoryUsage / 1024 / 1024).toFixed(2)} MB`);
 * console.log(`False positive rate: ${(stats.estimatedFPR * 100).toFixed(3)}%`);
 * ```
 */
export interface DeduplicationStats {
  /**
   * Total number of sequences processed.
   * @minimum 0
   */
  totalProcessed: number;

  /**
   * Number of unique sequences found.
   * @minimum 0
   */
  uniqueCount: number;

  /**
   * Number of duplicate sequences removed.
   * Equals totalProcessed - uniqueCount.
   * @minimum 0
   */
  duplicateCount: number;

  /**
   * Current estimated false positive rate.
   * May be lower than configured if fewer items than expected.
   * @minimum 0.0
   * @maximum 1.0
   */
  estimatedFPR: number;

  /**
   * Memory used by the Bloom filter in bytes.
   * For scalable filters, includes all sub-filters.
   * @minimum 0
   */
  memoryUsage: number;

  /**
   * Most frequently duplicated sequence IDs.
   * Only available when trackDuplicates is true.
   * Limited to top 10 duplicates.
   */
  topDuplicates?: Array<{
    /** Sequence ID */
    id: string;
    /** Number of times this ID was seen as duplicate */
    count: number;
  }>;
}

/**
 * Memory-efficient sequence deduplicator using Bloom filters.
 *
 * Provides constant memory usage regardless of dataset size through
 * probabilistic data structures. Ideal for streaming deduplication
 * of multi-GB sequence files.
 *
 * @class SequenceDeduplicator
 * @since v0.1.0
 *
 * @example
 * ```typescript
 * // Simple deduplication with defaults
 * const dedup = new SequenceDeduplicator();
 * for await (const seq of dedup.deduplicate(sequences)) {
 *   console.log(seq); // Only unique sequences
 * }
 *
 * // Track duplicates for reporting
 * const tracker = new SequenceDeduplicator({
 *   trackDuplicates: true,
 *   expectedSequences: 10_000_000,
 *   falsePositiveRate: 0.0001
 * });
 *
 * await tracker.process(sequences);
 * const stats = tracker.getStats();
 * console.log(`Removed ${stats.duplicateCount} duplicates`);
 * stats.topDuplicates?.forEach(dup => {
 *   console.log(`${dup.id}: ${dup.count} duplicates`);
 * });
 *
 * // Custom deduplication by prefix
 * const prefixDedup = new SequenceDeduplicator({
 *   strategy: seq => seq.sequence.substring(0, 50),
 *   scalable: true // Handle overflow gracefully
 * });
 *
 * // Case-insensitive sequence deduplication
 * const caseInsensitive = new SequenceDeduplicator({
 *   strategy: 'sequence',
 *   caseSensitive: false
 * });
 * ```
 *
 * @remarks
 * The false positive rate means some unique sequences may be incorrectly
 * identified as duplicates. For 100% accuracy with small datasets, use
 * ExactDeduplicator instead. Memory usage is approximately:
 * -log2(falsePositiveRate) * expectedSequences / 8 bytes
 */
export class SequenceDeduplicator {
  private bloom: BloomFilter | ScalableBloomFilter;
  private readonly options: Required<DeduplicationOptions>;
  private readonly getKey: (seq: AbstractSequence) => string;
  private stats: DeduplicationStats;
  private readonly duplicateTracker?: Map<string, number>;

  constructor(options: DeduplicationOptions = {}) {
    this.options = {
      strategy: options.strategy ?? "both",
      expectedSequences: options.expectedSequences ?? 1_000_000,
      falsePositiveRate: options.falsePositiveRate ?? 0.001,
      scalable: options.scalable ?? false,
      trackDuplicates: options.trackDuplicates ?? false,
      caseSensitive: options.caseSensitive ?? true,
    };

    // Initialize Bloom filter
    if (this.options.scalable) {
      this.bloom = new ScalableBloomFilter(
        this.options.expectedSequences,
        this.options.falsePositiveRate
      );
    } else {
      this.bloom = new BloomFilter(this.options.expectedSequences, this.options.falsePositiveRate);
    }

    // Set up key generation function
    this.getKey = this.createKeyFunction(this.options.strategy);

    // Initialize statistics
    this.stats = {
      totalProcessed: 0,
      uniqueCount: 0,
      duplicateCount: 0,
      estimatedFPR: 0,
      memoryUsage: 0,
    };

    // Set up duplicate tracking if requested
    if (this.options.trackDuplicates) {
      this.duplicateTracker = new Map();
    }
  }

  /**
   * Deduplicate a stream of sequences.
   *
   * Yields only sequences that haven't been seen before according to
   * the configured deduplication strategy. Uses constant memory
   * regardless of input size.
   *
   * @param sequences - Async iterable of sequences to deduplicate
   * @yields {Sequence} Unique sequences in order of first appearance
   *
   * @example
   * ```typescript
   * for await (const unique of dedup.deduplicate(readFasta('genome.fa'))) {
   *   console.log(`Unique: ${unique.id}`);
   * }
   * ```
   */
  async *deduplicate(sequences: AsyncIterable<AbstractSequence>): AsyncGenerator<AbstractSequence> {
    for await (const seq of sequences) {
      if (this.processSequence(seq)) {
        yield seq;
      }
    }
  }

  /**
   * Process sequences without yielding (for statistics only).
   *
   * Use this when you only need deduplication statistics without
   * the actual unique sequences. More memory-efficient than
   * collecting all unique sequences.
   *
   * @param sequences - Async iterable of sequences to analyze
   * @returns Promise that resolves when processing is complete
   *
   * @example
   * ```typescript
   * await dedup.process(sequences);
   * const stats = dedup.getStats();
   * console.log(`${stats.duplicateCount} duplicates found`);
   * ```
   */
  async process(sequences: AsyncIterable<AbstractSequence>): Promise<void> {
    for await (const seq of sequences) {
      this.processSequence(seq);
    }
  }

  /**
   * Check if a sequence is unique (hasn't been seen before).
   *
   * Tests whether the sequence would be considered unique according
   * to the configured strategy. Does not modify the filter.
   *
   * @param sequence - Sequence to test for uniqueness
   * @returns True if sequence hasn't been seen before
   *
   * @example
   * ```typescript
   * if (dedup.isUnique(sequence)) {
   *   console.log('This is a new sequence');
   * }
   * ```
   */
  isUnique(sequence: AbstractSequence): boolean {
    const key = this.getKey(sequence);
    return !this.bloom.contains(key);
  }

  /**
   * Mark a sequence as seen.
   *
   * Adds the sequence to the Bloom filter so future occurrences
   * will be detected as duplicates.
   *
   * @param sequence - Sequence to mark as seen
   *
   * @example
   * ```typescript
   * if (customLogic(sequence)) {
   *   dedup.markAsSeen(sequence);
   * }
   * ```
   */
  markAsSeen(sequence: AbstractSequence): void {
    const key = this.getKey(sequence);
    this.bloom.add(key);
    this.stats.uniqueCount++;
  }

  /**
   * Get current deduplication statistics.
   *
   * Returns statistics about the deduplication process including
   * counts, memory usage, and false positive rate.
   *
   * @returns Current statistics snapshot
   *
   * @example
   * ```typescript
   * const stats = dedup.getStats();
   * const efficiency = stats.duplicateCount / stats.totalProcessed;
   * console.log(`Deduplication efficiency: ${(efficiency * 100).toFixed(1)}%`);
   * ```
   */
  getStats(): DeduplicationStats {
    // Update current statistics
    const bloomStats = this.bloom.getStats();

    // Handle different stats structures from BloomFilter vs ScalableBloomFilter
    if ("estimatedFPR" in bloomStats) {
      // Regular BloomFilter
      this.stats.estimatedFPR = bloomStats.estimatedFPR;
      this.stats.memoryUsage = bloomStats.sizeBytes;
    } else {
      // ScalableBloomFilter
      this.stats.memoryUsage = bloomStats.totalSizeBytes;
      // Estimate FPR from the filters
      const avgFPR =
        bloomStats.filters.reduce((sum, f) => sum + f.estimatedFPR, 0) / bloomStats.filters.length;
      this.stats.estimatedFPR = avgFPR;
    }

    // Add top duplicates if tracking
    if (this.duplicateTracker && this.duplicateTracker.size > 0) {
      const sorted = Array.from(this.duplicateTracker.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      this.stats.topDuplicates = sorted.map(([id, count]) => ({ id, count }));
    }

    return { ...this.stats };
  }

  /**
   * Reset the deduplicator for reuse.
   *
   * Clears all internal state including the Bloom filter and statistics.
   * Useful for processing multiple independent datasets.
   *
   * @example
   * ```typescript
   * await dedup.process(dataset1);
   * console.log(dedup.getStats());
   * dedup.reset();
   * await dedup.process(dataset2); // Fresh deduplication
   * ```
   */
  reset(): void {
    this.bloom.reset();
    this.stats = {
      totalProcessed: 0,
      uniqueCount: 0,
      duplicateCount: 0,
      estimatedFPR: 0,
      memoryUsage: 0,
    };

    if (this.duplicateTracker) {
      this.duplicateTracker.clear();
    }
  }

  /**
   * Merge two deduplicators into one.
   *
   * Creates a new deduplicator that recognizes sequences seen by
   * either original deduplicator. Useful for combining pre-processed
   * datasets.
   *
   * @param other - Another deduplicator to merge with
   * @returns New deduplicator with combined filters
   *
   * @throws {Error} If either deduplicator uses scalable filters
   *
   * @example
   * ```typescript
   * const dedup1 = new SequenceDeduplicator();
   * await dedup1.process(dataset1);
   *
   * const dedup2 = new SequenceDeduplicator();
   * await dedup2.process(dataset2);
   *
   * const combined = dedup1.merge(dedup2);
   * // combined recognizes duplicates from both datasets
   * ```
   */
  merge(other: SequenceDeduplicator): SequenceDeduplicator {
    if (!(this.bloom instanceof BloomFilter) || !(other.bloom instanceof BloomFilter)) {
      throw new Error("Can only merge non-scalable Bloom filters");
    }

    const merged = new SequenceDeduplicator(this.options);
    merged.bloom = this.bloom.union(other.bloom);
    merged.stats.uniqueCount = this.stats.uniqueCount + other.stats.uniqueCount;
    merged.stats.totalProcessed = this.stats.totalProcessed + other.stats.totalProcessed;

    return merged;
  }

  // Private helper methods

  private processSequence(seq: AbstractSequence): boolean {
    this.stats.totalProcessed++;
    const key = this.getKey(seq);

    if (this.bloom.contains(key)) {
      // Duplicate found
      this.stats.duplicateCount++;

      // Track duplicate if requested
      if (this.duplicateTracker) {
        const count = this.duplicateTracker.get(seq.id) ?? 0;
        this.duplicateTracker.set(seq.id, count + 1);
      }

      return false; // Don't yield duplicates
    } else {
      // New unique sequence
      this.bloom.add(key);
      this.stats.uniqueCount++;
      return true; // Yield unique sequences
    }
  }

  private createKeyFunction(strategy: DeduplicationStrategy): (seq: AbstractSequence) => string {
    if (typeof strategy === "function") {
      return strategy;
    }

    const processSequence = this.options.caseSensitive
      ? (s: string): string => s
      : (s: string): string => s.toUpperCase();

    switch (strategy) {
      case "sequence":
        return (seq) => processSequence(seq.sequence);

      case "id":
        return (seq) => seq.id;

      case "both":
        return (seq) => `${seq.id}:${processSequence(seq.sequence)}`;

      case "exact":
        return (seq) =>
          JSON.stringify({
            id: seq.id,
            sequence: processSequence(seq.sequence),
            description: seq.description,
          });

      default:
        // Default to 'both' strategy
        return (seq) => `${seq.id}:${processSequence(seq.sequence)}`;
    }
  }
}

/**
 * Exact deduplicator using Set for 100% accuracy.
 *
 * Provides perfect deduplication without false positives at the cost
 * of higher memory usage. Best for smaller datasets where accuracy
 * is critical.
 *
 * @class ExactDeduplicator
 * @since v0.1.0
 *
 * @example
 * ```typescript
 * const exact = new ExactDeduplicator('sequence');
 * for await (const unique of exact.deduplicate(sequences)) {
 *   // Guaranteed no false positives
 *   console.log(unique);
 * }
 * ```
 *
 * @remarks
 * Memory usage is proportional to the number of unique sequences.
 * Each unique key uses approximately 50-200 bytes depending on
 * sequence length and deduplication strategy.
 */
export class ExactDeduplicator {
  private readonly seen = new Set<string>();
  private readonly getKey: (seq: AbstractSequence) => string;
  private stats = {
    totalProcessed: 0,
    uniqueCount: 0,
    duplicateCount: 0,
  };

  constructor(strategy: DeduplicationStrategy = "both", caseSensitive: boolean = true) {
    const processSequence = caseSensitive
      ? (s: string): string => s
      : (s: string): string => s.toUpperCase();

    if (typeof strategy === "function") {
      this.getKey = strategy;
    } else {
      switch (strategy) {
        case "sequence":
          this.getKey = (seq): string => processSequence(seq.sequence);
          break;
        case "id":
          this.getKey = (seq): string => seq.id;
          break;
        case "both":
          this.getKey = (seq): string => `${seq.id}:${processSequence(seq.sequence)}`;
          break;
        case "exact":
          this.getKey = (seq): string =>
            JSON.stringify({
              id: seq.id,
              sequence: processSequence(seq.sequence),
              description: seq.description,
            });
          break;
        default:
          this.getKey = (seq): string => `${seq.id}:${processSequence(seq.sequence)}`;
      }
    }
  }

  /**
   * Deduplicate sequences with 100% accuracy.
   *
   * Uses a Set to track seen sequences, providing perfect accuracy
   * at the cost of higher memory usage.
   *
   * @param sequences - Async iterable of sequences to deduplicate
   * @yields {Sequence} Unique sequences with no false positives
   *
   * @example
   * ```typescript
   * for await (const seq of exact.deduplicate(sequences)) {
   *   // Every yielded sequence is guaranteed unique
   *   await processUnique(seq);
   * }
   * ```
   */
  async *deduplicate(sequences: AsyncIterable<AbstractSequence>): AsyncGenerator<AbstractSequence> {
    for await (const seq of sequences) {
      this.stats.totalProcessed++;
      const key = this.getKey(seq);

      if (!this.seen.has(key)) {
        this.seen.add(key);
        this.stats.uniqueCount++;
        yield seq;
      } else {
        this.stats.duplicateCount++;
      }
    }
  }

  /**
   * Get deduplication statistics.
   *
   * @returns Statistics including memory usage estimate
   *
   * @example
   * ```typescript
   * const stats = exact.getStats();
   * console.log(`Memory: ${(stats.memoryUsage / 1024).toFixed(1)} KB`);
   * ```
   */
  getStats(): {
    totalProcessed: number;
    uniqueCount: number;
    duplicateCount: number;
    memoryUsage: number;
  } {
    return {
      ...this.stats,
      memoryUsage: this.seen.size * 100, // Rough estimate: 100 bytes per key
    };
  }

  /**
   * Reset the deduplicator for reuse.
   *
   * Clears all tracked sequences and resets statistics.
   */
  reset(): void {
    this.seen.clear();
    this.stats = {
      totalProcessed: 0,
      uniqueCount: 0,
      duplicateCount: 0,
    };
  }
}

/**
 * Deduplicate sequences without creating a deduplicator instance.
 *
 * Convenience function for one-off deduplication operations.
 * Returns an array of unique sequences.
 *
 * @param sequences - Async iterable of sequences to deduplicate
 * @param options - Optional deduplication configuration
 * @returns Promise resolving to array of unique sequences
 *
 * @example
 * ```typescript
 * const unique = await deduplicateSequences(sequences, {
 *   strategy: 'sequence',
 *   falsePositiveRate: 0.0001
 * });
 * console.log(`Found ${unique.length} unique sequences`);
 * ```
 *
 * @since v0.1.0
 */
export async function deduplicateSequences(
  sequences: AsyncIterable<AbstractSequence>,
  options?: DeduplicationOptions
): Promise<AbstractSequence[]> {
  const dedup = new SequenceDeduplicator(options);
  const result: AbstractSequence[] = [];

  for await (const seq of dedup.deduplicate(sequences)) {
    result.push(seq);
  }

  return result;
}

/**
 * Analyze sequences for duplicates without removing them.
 *
 * Convenience function to get deduplication statistics without
 * actually deduplicating. Useful for dataset analysis.
 *
 * @param sequences - Async iterable of sequences to analyze
 * @param options - Optional deduplication configuration
 * @returns Promise resolving to deduplication statistics
 *
 * @example
 * ```typescript
 * const stats = await findDuplicates(sequences, {
 *   strategy: 'id',
 *   trackDuplicates: true
 * });
 *
 * console.log(`Dataset has ${stats.duplicateCount} duplicates`);
 * stats.topDuplicates?.forEach(dup => {
 *   console.log(`${dup.id} appears ${dup.count + 1} times`);
 * });
 * ```
 *
 * @since v0.1.0
 */
export async function findDuplicates(
  sequences: AsyncIterable<AbstractSequence>,
  options?: DeduplicationOptions
): Promise<DeduplicationStats> {
  const dedup = new SequenceDeduplicator({
    ...options,
    trackDuplicates: true,
  });

  await dedup.process(sequences);
  return dedup.getStats();
}
