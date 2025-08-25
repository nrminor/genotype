/**
 * SeqOps - Unix pipeline-style sequence operations for TypeScript
 *
 * This module provides the main SeqOps class that enables method chaining
 * for sequence processing operations, mimicking the intuitive flow of
 * Unix command pipelines while maintaining type safety.
 *
 * Version 2.0 introduces semantic methods that replace the monolithic seq() method
 * with focused, single-purpose operations for better discoverability and clarity.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import type { AbstractSequence, FASTXSequence, FastaSequence, FastqSequence } from '../types';
import { SequenceStatsCalculator, type SequenceStats, type StatsOptions } from './stats';
import { SubseqExtractor, type SubseqOptions } from './subseq';
import { FastaWriter } from '../formats/fasta';
import { FastqWriter } from '../formats/fastq';

// Import processors
import { FilterProcessor } from './filter';
import { TransformProcessor } from './transform';
import { CleanProcessor } from './clean';
import { QualityProcessor } from './quality';
import { ValidateProcessor } from './validate';
import { GrepProcessor } from './grep';
import { SampleProcessor } from './sample';
import { SortProcessor } from './sort';
import { RmdupProcessor } from './rmdup';
import type {
  FilterOptions,
  TransformOptions,
  CleanOptions,
  QualityOptions,
  ValidateOptions,
  GrepOptions,
  SampleOptions,
  SortOptions,
  RmdupOptions,
} from './types';

/**
 * Main SeqOps class providing fluent interface for sequence operations
 *
 * Enables Unix pipeline-style method chaining for processing genomic sequences.
 * All operations are lazy-evaluated and maintain streaming behavior for
 * memory efficiency with large datasets.
 *
 * @example
 * ```typescript
 * // Basic pipeline
 * await seqops(sequences)
 *   .filter({ minLength: 100 })
 *   .transform({ reverseComplement: true })
 *   .subseq({ region: "100:500" })
 *   .writeFasta('output.fasta');
 *
 * // Complex filtering and analysis
 * const stats = await seqops(sequences)
 *   .quality({ minScore: 20, trim: true })
 *   .filter({ minLength: 50 })
 *   .stats({ detailed: true });
 * ```
 */
export class SeqOps {
  /**
   * Create a new SeqOps pipeline
   *
   * @param source - Input sequences (async iterable)
   */
  constructor(private readonly source: AsyncIterable<AbstractSequence>) {}

  // =============================================================================
  // SEMANTIC API METHODS
  // =============================================================================

  /**
   * Filter sequences based on criteria
   *
   * Remove sequences that don't meet specified criteria. All criteria
   * within a single filter call are combined with AND logic.
   *
   * @param options - Filter criteria or custom predicate
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * // Filter by length and GC content
   * seqops(sequences)
   *   .filter({ minLength: 100, maxGC: 60 })
   *   .filter({ hasAmbiguous: false })
   *
   * // Custom filter function
   * seqops(sequences)
   *   .filter({ custom: seq => seq.id.startsWith('chr') })
   * ```
   */
  filter(options: FilterOptions | ((seq: AbstractSequence) => boolean)): SeqOps {
    // Handle legacy predicate function for backwards compatibility
    if (typeof options === 'function') {
      return new SeqOps(this.filterWithPredicate(options));
    }

    const processor = new FilterProcessor();
    return new SeqOps(processor.process(this.source, options));
  }

  /**
   * Transform sequence content
   *
   * Apply transformations that modify the sequence string itself.
   *
   * @param options - Transform options
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * seqops(sequences)
   *   .transform({ reverseComplement: true })
   *   .transform({ upperCase: true })
   *   .transform({ toRNA: true })
   * ```
   */
  transform(options: TransformOptions): SeqOps {
    const processor = new TransformProcessor();
    return new SeqOps(processor.process(this.source, options));
  }

  /**
   * Clean and sanitize sequences
   *
   * Fix common issues in sequence data such as gaps, ambiguous bases,
   * and whitespace.
   *
   * @param options - Clean options
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * seqops(sequences)
   *   .clean({ removeGaps: true })
   *   .clean({ replaceAmbiguous: true, replaceChar: 'N' })
   *   .clean({ trimWhitespace: true, removeEmpty: true })
   * ```
   */
  clean(options: CleanOptions): SeqOps {
    const processor = new CleanProcessor();
    return new SeqOps(processor.process(this.source, options));
  }

  /**
   * FASTQ quality operations
   *
   * Filter and trim sequences based on quality scores. Only affects
   * FASTQ sequences; FASTA sequences pass through unchanged.
   *
   * @param options - Quality options
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * seqops(sequences)
   *   .quality({ minScore: 20 })
   *   .quality({ trim: true, trimThreshold: 20, trimWindow: 4 })
   * ```
   */
  quality(options: QualityOptions): SeqOps {
    const processor = new QualityProcessor();
    return new SeqOps(processor.process(this.source, options));
  }

  /**
   * Validate sequences
   *
   * Check sequences for validity and optionally fix or reject invalid ones.
   *
   * @param options - Validation options
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * seqops(sequences)
   *   .validate({ mode: 'strict', action: 'reject' })
   *   .validate({ allowAmbiguous: true, action: 'fix', fixChar: 'N' })
   * ```
   */
  validate(options: ValidateOptions): SeqOps {
    const processor = new ValidateProcessor();
    return new SeqOps(processor.process(this.source, options));
  }

  /**
   * Search sequences by pattern
   *
   * Pattern matching and filtering similar to Unix grep. Supports both
   * simple string patterns and complex options for advanced use cases.
   *
   * @param pattern - Search pattern (string or regex) or full options object
   * @param target - Target field ('sequence', 'id', or 'description') - defaults to 'sequence'
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * // Simple sequence search (most common case)
   * seqops(sequences)
   *   .grep('ATCG')                    // Search sequences for 'ATCG'
   *   .grep(/^chr\d+/, 'id')           // Search IDs with regex
   *
   * // Advanced options for complex scenarios
   * seqops(sequences)
   *   .grep({
   *     pattern: 'ATCGATCG',
   *     target: 'sequence',
   *     allowMismatches: 2,
   *     searchBothStrands: true
   *   })
   * ```
   */
  grep(
    pattern: string | RegExp | GrepOptions,
    target: 'sequence' | 'id' | 'description' = 'sequence'
  ): SeqOps {
    const processor = new GrepProcessor();

    // Handle overloaded parameters for better DX
    const options: GrepOptions =
      typeof pattern === 'object' && pattern !== null && 'pattern' in pattern
        ? (pattern as GrepOptions) // Full options object provided
        : { pattern: pattern as string | RegExp, target }; // Simple pattern with target

    return new SeqOps(processor.process(this.source, options));
  }

  /**
   * Helper for legacy predicate filter
   * @private
   */
  private async *filterWithPredicate(
    predicate: (seq: AbstractSequence) => boolean
  ): AsyncIterable<AbstractSequence> {
    for await (const seq of this.source) {
      if (predicate(seq)) {
        yield seq;
      }
    }
  }

  /**
   * Extract subsequences
   *
   * Mirrors `seqkit subseq` functionality for region extraction.
   *
   * @param options - Extraction options
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * seqops(sequences)
   *   .subseq({
   *     region: "100:500",
   *     upstream: 50,
   *     downstream: 50
   *   })
   * ```
   */
  subseq(options: SubseqOptions): SeqOps {
    const extractor = new SubseqExtractor();
    return new SeqOps(extractor.extract(this.source, options));
  }

  /**
   * Take first n sequences
   *
   * Mirrors `seqkit head` functionality.
   *
   * @param n - Number of sequences to take
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * seqops(sequences).head(1000)
   * ```
   */
  head(n: number): SeqOps {
    async function* take(source: AsyncIterable<AbstractSequence>) {
      let count = 0;
      for await (const seq of source) {
        if (count >= n) break;
        yield seq;
        count++;
      }
    }
    return new SeqOps(take(this.source));
  }

  /**
   * Sample sequences statistically
   *
   * Apply statistical sampling to select a subset of sequences.
   * Supports both simple count-based sampling and advanced options.
   *
   * @param count - Number of sequences to sample, or full options object
   * @param strategy - Sampling strategy (optional, defaults to 'reservoir')
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * // Simple sampling (most common case)
   * seqops(sequences)
   *   .sample(1000)                    // Sample 1000 sequences
   *   .sample(500, 'systematic')       // Systematic sampling
   *
   * // Advanced options for complex scenarios
   * seqops(sequences)
   *   .sample({
   *     n: 1000,
   *     seed: 42,
   *     strategy: 'reservoir'
   *   })
   * ```
   */
  sample(
    count: number | SampleOptions,
    strategy: 'random' | 'systematic' | 'reservoir' = 'reservoir'
  ): SeqOps {
    const processor = new SampleProcessor();

    // Handle overloaded parameters for better DX
    const options: SampleOptions =
      typeof count === 'number'
        ? { n: count, strategy } // Simple count with optional strategy
        : count; // Full options object provided

    return new SeqOps(processor.process(this.source, options));
  }

  /**
   * Sort sequences by specified criteria
   *
   * High-performance sorting optimized for genomic data compression.
   * Automatically switches between in-memory and external sorting based
   * on dataset size. Proper sequence ordering dramatically improves
   * compression ratios for genomic datasets.
   *
   * @param options - Sort criteria and options
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * // Sort by length for compression optimization
   * seqops(sequences)
   *   .sort({ by: 'length', order: 'desc' })
   *
   * // Sort by GC content for clustering similar sequences
   * seqops(sequences)
   *   .sort({ by: 'gc', order: 'asc' })
   *
   * // Custom sorting for specialized genomic criteria
   * seqops(sequences)
   *   .sort({
   *     custom: (a, b) => a.sequence.localeCompare(b.sequence)
   *   })
   * ```
   */
  sort(options: SortOptions): SeqOps {
    const processor = new SortProcessor();
    return new SeqOps(processor.process(this.source, options));
  }

  /**
   * Sort sequences by length (convenience method)
   *
   * @param order - Sort order: 'asc' or 'desc' (default: 'asc')
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * seqops(sequences)
   *   .sortByLength('desc')  // Longest first for compression
   *   .sortByLength()        // Shortest first (default)
   * ```
   */
  sortByLength(order: 'asc' | 'desc' = 'asc'): SeqOps {
    return this.sort({ by: 'length', order });
  }

  /**
   * Sort sequences by ID (convenience method)
   *
   * @param order - Sort order: 'asc' or 'desc' (default: 'asc')
   * @returns New SeqOps instance for chaining
   */
  sortById(order: 'asc' | 'desc' = 'asc'): SeqOps {
    return this.sort({ by: 'id', order });
  }

  /**
   * Sort sequences by GC content (convenience method)
   *
   * @param order - Sort order: 'asc' or 'desc' (default: 'asc')
   * @returns New SeqOps instance for chaining
   */
  sortByGC(order: 'asc' | 'desc' = 'asc'): SeqOps {
    return this.sort({ by: 'gc', order });
  }

  /**
   * Remove duplicate sequences
   *
   * High-performance deduplication using probabilistic Bloom filters or
   * exact Set-based approaches. Supports both simple deduplication and
   * advanced configuration for large datasets.
   *
   * @param by - Deduplication criterion or full options object
   * @param exact - Use exact matching (default: false, uses Bloom filter)
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * // Simple deduplication (most common cases)
   * seqops(sequences)
   *   .rmdup('sequence')               // Remove sequence duplicates
   *   .rmdup('id', true)               // Remove ID duplicates (exact)
   *
   * // Advanced options for large datasets
   * seqops(sequences)
   *   .rmdup({
   *     by: 'both',
   *     expectedUnique: 5_000_000,
   *     falsePositiveRate: 0.0001
   *   })
   * ```
   */
  rmdup(by: 'sequence' | 'id' | 'both' | RmdupOptions, exact: boolean = false): SeqOps {
    const processor = new RmdupProcessor();

    // Handle overloaded parameters for better DX
    const options: RmdupOptions =
      typeof by === 'string'
        ? { by, exact } // Simple by + exact parameters
        : by; // Full options object provided

    return new SeqOps(processor.process(this.source, options));
  }

  /**
   * Remove sequence duplicates (convenience method)
   *
   * Most common deduplication use case - remove sequences with identical content.
   *
   * @param caseSensitive - Whether to consider case (default: true)
   * @returns New SeqOps instance for chaining
   */
  removeSequenceDuplicates(caseSensitive: boolean = true): SeqOps {
    return this.rmdup({ by: 'sequence', caseSensitive, exact: false });
  }

  /**
   * Remove ID duplicates (convenience method)
   *
   * Remove sequences with duplicate IDs, keeping first occurrence.
   *
   * @param exact - Use exact matching (default: true for IDs)
   * @returns New SeqOps instance for chaining
   */
  removeIdDuplicates(exact: boolean = true): SeqOps {
    return this.rmdup({ by: 'id', exact });
  }

  // =============================================================================
  // TERMINAL OPERATIONS (trigger execution)
  // =============================================================================

  /**
   * Calculate sequence statistics
   *
   * Terminal operation that processes all sequences to compute statistics.
   * Mirrors `seqkit stats` functionality.
   *
   * @param options - Statistics options
   * @returns Promise resolving to statistics
   *
   * @example
   * ```typescript
   * const stats = await seqops(sequences)
   *   .seq({ minLength: 100 })
   *   .stats({ detailed: true });
   * console.log(`N50: ${stats.n50}`);
   * ```
   */
  async stats(options: StatsOptions = {}): Promise<SequenceStats> {
    const calculator = new SequenceStatsCalculator();
    return calculator.calculateStats(this.source, options);
  }

  /**
   * Write sequences to FASTA file
   *
   * Terminal operation that writes all sequences in FASTA format.
   *
   * @param path - Output file path
   * @param options - Writer options
   * @returns Promise resolving when write is complete
   *
   * @example
   * ```typescript
   * await seqops(sequences)
   *   .seq({ reverseComplement: true })
   *   .writeFasta('output.fasta');
   * ```
   */
  async writeFasta(path: string, options: { wrapWidth?: number } = {}): Promise<void> {
    const lineEnding = process.platform === 'win32' ? '\r\n' : '\n';
    const writer = new FastaWriter({
      ...(options.wrapWidth !== undefined && { lineWidth: options.wrapWidth }),
      lineEnding,
    });
    const stream = Bun.file(path).writer();

    try {
      for await (const seq of this.source) {
        const fastaSeq: FastaSequence = {
          format: 'fasta',
          id: seq.id,
          sequence: seq.sequence,
          length: seq.length,
          ...(seq.description !== undefined && { description: seq.description }),
        };
        const formatted = writer.formatSequence(fastaSeq);
        // Add line ending after each sequence to separate them
        stream.write(formatted + lineEnding);
      }
    } finally {
      stream.end();
    }
  }

  /**
   * Write sequences to FASTQ file
   *
   * Terminal operation that writes all sequences in FASTQ format.
   * If input sequences don't have quality scores, uses default quality.
   *
   * @param path - Output file path
   * @param defaultQuality - Default quality string for FASTA sequences
   * @returns Promise resolving when write is complete
   *
   * @example
   * ```typescript
   * await seqops(sequences)
   *   .seq({ minQuality: 20 })
   *   .writeFastq('output.fastq', 'IIIIIIIIII');
   * ```
   */
  async writeFastq(path: string, defaultQuality: string = 'I'): Promise<void> {
    const writer = new FastqWriter();
    const stream = Bun.file(path).writer();

    try {
      for await (const seq of this.source) {
        let fastqSeq: FastqSequence;

        if (this.isFastqSequence(seq)) {
          fastqSeq = seq;
        } else {
          // Convert to FASTQ with default quality
          const qualityString = defaultQuality.repeat(seq.length).substring(0, seq.length);
          fastqSeq = {
            format: 'fastq',
            id: seq.id,
            sequence: seq.sequence,
            quality: qualityString,
            qualityEncoding: 'phred33',
            length: seq.length,
            ...(seq.description !== undefined && { description: seq.description }),
          };
        }

        const formatted = writer.formatSequence(fastqSeq);
        stream.write(formatted);
      }
    } finally {
      stream.end();
    }
  }

  /**
   * Collect all sequences into an array
   *
   * Terminal operation that materializes all sequences in memory.
   * Use with caution on large datasets.
   *
   * @returns Promise resolving to array of sequences
   *
   * @example
   * ```typescript
   * const sequences = await seqops(input)
   *   .seq({ minLength: 100 })
   *   .collect();
   * console.log(`Collected ${sequences.length} sequences`);
   * ```
   */
  async collect(): Promise<AbstractSequence[]> {
    const results: AbstractSequence[] = [];
    for await (const seq of this.source) {
      results.push(seq);
    }
    return results;
  }

  /**
   * Count sequences
   *
   * Terminal operation that counts sequences without loading them in memory.
   *
   * @returns Promise resolving to sequence count
   *
   * @example
   * ```typescript
   * const count = await seqops(sequences)
   *   .filter(seq => seq.length > 100)
   *   .count();
   * ```
   */
  async count(): Promise<number> {
    let count = 0;
    for await (const _seq of this.source) {
      count++;
    }
    return count;
  }

  /**
   * Process each sequence with a callback
   *
   * Terminal operation that applies a function to each sequence.
   *
   * @param fn - Callback function
   * @returns Promise resolving when processing is complete
   *
   * @example
   * ```typescript
   * await seqops(sequences)
   *   .forEach(seq => console.log(seq.id, seq.length));
   * ```
   */
  async forEach(fn: (seq: AbstractSequence) => void | Promise<void>): Promise<void> {
    for await (const seq of this.source) {
      await fn(seq);
    }
  }

  /**
   * Enable direct iteration over the pipeline
   *
   * @returns Async iterator for sequences
   *
   * @example
   * ```typescript
   * for await (const seq of seqops(sequences).seq({ minLength: 100 })) {
   *   console.log(seq.id);
   * }
   * ```
   */
  [Symbol.asyncIterator](): AsyncIterator<AbstractSequence> {
    return this.source[Symbol.asyncIterator]();
  }

  // =============================================================================
  // PRIVATE HELPERS
  // =============================================================================

  /**
   * Type guard to check if sequence is FASTQ
   * @private
   */
  private isFastqSequence(seq: AbstractSequence): seq is FastqSequence {
    return 'quality' in seq && 'qualityEncoding' in seq;
  }
}

/**
 * Factory function to create SeqOps pipeline
 *
 * Convenient function to start a sequence processing pipeline.
 *
 * @param sequences - Input sequences
 * @returns New SeqOps instance
 *
 * @example
 * ```typescript
 * const result = await seqops(sequences)
 *   .seq({ minLength: 100 })
 *   .subseq({ region: "1:500" })
 *   .writeFasta('output.fasta');
 * ```
 */
export function seqops(sequences: AsyncIterable<AbstractSequence | FASTXSequence>): SeqOps {
  return new SeqOps(sequences as AsyncIterable<AbstractSequence>);
}

// Re-export types and classes for convenience
export { SequenceStatsCalculator, type SequenceStats, type StatsOptions } from './stats';
export { SubseqExtractor, type SubseqOptions } from './subseq';

// Export new semantic API types
export type {
  FilterOptions,
  TransformOptions,
  CleanOptions,
  QualityOptions,
  ValidateOptions,
  GrepOptions,
  SampleOptions,
  SortOptions,
  RmdupOptions,
  AnnotateOptions,
  GroupOptions,
} from './types';
