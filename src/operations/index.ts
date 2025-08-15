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
import type {
  FilterOptions,
  TransformOptions,
  CleanOptions,
  QualityOptions,
  ValidateOptions,
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
  constructor(private source: AsyncIterable<AbstractSequence>) {}

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
  AnnotateOptions,
  SortOptions,
  SampleOptions,
  GroupOptions,
} from './types';
