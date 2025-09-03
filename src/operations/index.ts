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

import { FastaParser, FastaWriter, FastqWriter } from "../formats";
import type {
  AbstractSequence,
  FASTXSequence,
  FastaSequence,
  FastqSequence,
  MotifLocation,
  ValidGenomicRegion,
} from "../types";
// Import processors
import { CleanProcessor } from "./clean";
import { ConcatProcessor } from "./concat";
import { FilterProcessor } from "./filter";
import { GrepProcessor } from "./grep";
import { LocateProcessor } from "./locate";
import { QualityProcessor } from "./quality";
import { RmdupProcessor } from "./rmdup";
import { SampleProcessor } from "./sample";
import { SortProcessor } from "./sort";
import type { SplitResult, SplitSummary } from "./split";
import { type SequenceStats, SequenceStatsCalculator, type StatsOptions } from "./stats";
import { SubseqExtractor, type SubseqOptions } from "./subseq";
import { TransformProcessor } from "./transform";
import { TranslateProcessor } from "./translate";
import type {
  CleanOptions,
  ConcatOptions,
  FilterOptions,
  GrepOptions,
  LocateOptions,
  QualityOptions,
  RmdupOptions,
  SampleOptions,
  SortOptions,
  SplitOptions,
  TransformOptions,
  TranslateOptions,
  ValidateOptions,
} from "./types";
import { ValidateProcessor } from "./validate";

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
    if (typeof options === "function") {
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
    target: "sequence" | "id" | "description" = "sequence"
  ): SeqOps {
    const processor = new GrepProcessor();

    // Handle overloaded parameters for better DX
    const options: GrepOptions =
      typeof pattern === "object" && "pattern" in pattern
        ? pattern // TypeScript knows this is GrepOptions
        : { pattern, target }; // TypeScript knows pattern is string | RegExp here

    return new SeqOps(processor.process(this.source, options));
  }

  /**
   * Concatenate sequences from multiple sources
   *
   * Combines sequences from multiple file paths and/or AsyncIterables with
   * sophisticated ID conflict resolution. Maintains streaming behavior for
   * memory efficiency with large datasets.
   *
   * @param sources - Array of file paths and/or AsyncIterables to concatenate
   * @param options - Concatenation options (optional)
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * // Simple concatenation from files
   * seqops(sequences)
   *   .concat(['file1.fasta', 'file2.fasta'])
   *   .concat([anotherAsyncIterable])
   *
   * // Advanced options for complex scenarios
   * seqops(sequences)
   *   .concat(['file1.fasta', 'file2.fasta'], {
   *     idConflictResolution: 'suffix',
   *     validateFormats: true,
   *     sourceLabels: ['batch1', 'batch2'],
   *     onProgress: (processed, total, source) =>
   *       console.log(`Processed ${processed} from ${source}`)
   *   })
   * ```
   */
  concat(
    sources: Array<string | AsyncIterable<AbstractSequence>>,
    options?: Omit<ConcatOptions, "sources">
  ): SeqOps {
    const processor = new ConcatProcessor();
    const fullOptions: ConcatOptions = { ...options, sources };
    return new SeqOps(processor.process(this.source, fullOptions));
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
    strategy: "random" | "systematic" | "reservoir" = "reservoir"
  ): SeqOps {
    const processor = new SampleProcessor();

    // Handle overloaded parameters for better DX
    const options: SampleOptions =
      typeof count === "number"
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
  sortByLength(order: "asc" | "desc" = "asc"): SeqOps {
    return this.sort({ sortBy: order === "asc" ? "length-asc" : "length" });
  }

  /**
   * Sort sequences by ID (convenience method)
   *
   * @param order - Sort order: 'asc' or 'desc' (default: 'asc')
   * @returns New SeqOps instance for chaining
   */
  sortById(order: "asc" | "desc" = "asc"): SeqOps {
    return this.sort({ sortBy: order === "asc" ? "id" : "id-desc" });
  }

  /**
   * Sort sequences by GC content (convenience method)
   *
   * @param order - Sort order: 'asc' or 'desc' (default: 'asc')
   * @returns New SeqOps instance for chaining
   */
  sortByGC(order: "asc" | "desc" = "asc"): SeqOps {
    return this.sort({ sortBy: order === "asc" ? "gc-asc" : "gc" });
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
  rmdup(by: "sequence" | "id" | "both" | RmdupOptions, exact: boolean = false): SeqOps {
    const processor = new RmdupProcessor();

    // Handle overloaded parameters for better DX
    const options: RmdupOptions =
      typeof by === "string"
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
    return this.rmdup({ by: "sequence", caseSensitive, exact: false });
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
    return this.rmdup({ by: "id", exact });
  }

  /**
   * Translate DNA/RNA sequences to proteins
   *
   * High-performance protein translation supporting all 31 NCBI genetic codes
   * with progressive disclosure for optimal developer experience.
   *
   * @param geneticCode - Genetic code number (1-33) or full options object
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * // Simple cases (90% of usage)
   * seqops(sequences)
   *   .translate()                     // Standard genetic code, frame +1
   *   .translate(2)                    // Vertebrate mitochondrial code
   *
   * // Advanced options (10% of usage)
   * seqops(sequences)
   *   .translate({
   *     geneticCode: 1,
   *     orfsOnly: true,
   *     minOrfLength: 30
   *   })
   * ```
   */
  translate(geneticCode?: number | TranslateOptions): SeqOps {
    const processor = new TranslateProcessor();

    // Handle progressive disclosure for better DX
    const options: TranslateOptions =
      typeof geneticCode === "number"
        ? { geneticCode } // Simple: just genetic code, use defaults
        : geneticCode || {}; // Full options object or empty defaults

    return new SeqOps(processor.process(this.source, options));
  }

  /**
   * Translate using mitochondrial genetic code (convenience method)
   *
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * seqops(sequences)
   *   .translateMito()  // Genetic code 2 - Vertebrate Mitochondrial
   * ```
   */
  translateMito(): SeqOps {
    return this.translate({ geneticCode: 2 });
  }

  /**
   * Translate all 6 reading frames (convenience method)
   *
   * @param geneticCode - Genetic code to use (default: 1 = Standard)
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * seqops(sequences)
   *   .translateAllFrames()    // All frames with standard code
   *   .translateAllFrames(2)   // All frames with mito code
   * ```
   */
  translateAllFrames(geneticCode: number = 1): SeqOps {
    return this.translate({
      geneticCode,
      allFrames: true,
    });
  }

  /**
   * Find and translate open reading frames (convenience method)
   *
   * @param minLength - Minimum ORF length in amino acids (default: 30)
   * @param geneticCode - Genetic code to use (default: 1 = Standard)
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * seqops(sequences)
   *   .translateOrf()          // Default: 30 aa minimum
   *   .translateOrf(100)       // 100 aa minimum
   *   .translateOrf(50, 2)     // 50 aa minimum, mito code
   * ```
   */
  translateOrf(minLength: number = 30, geneticCode: number = 1): SeqOps {
    return this.translate({
      geneticCode,
      orfsOnly: true,
      minOrfLength: minLength,
      convertStartCodons: true,
    });
  }

  // =============================================================================
  // FILE OPERATIONS (Terminal Operations)
  // =============================================================================

  /**
   * Split sequences into multiple files
   *
   * Terminal operation that writes pipeline sequences to separate files
   * with comprehensive seqkit split/split2 compatibility. Integrates seamlessly
   * with all SeqOps pipeline operations for sophisticated genomic workflows.
   *
   * @param options - Split configuration options
   * @returns Promise resolving to split results summary
   *
   * @example
   * ```typescript
   * // Basic usage - split after processing
   * const result = await seqops(sequences)
   *   .filter({ minLength: 100 })
   *   .clean({ removeGaps: true })
   *   .split({ mode: 'by-size', sequencesPerFile: 1000 });
   *
   * // Real-world genomics: Quality control → split for parallel processing
   * const qcResults = await seqops(rawReads)
   *   .quality({ minScore: 20, trim: true })      // Quality filter
   *   .filter({ minLength: 50, maxLength: 150 })  // Length filter
   *   .clean({ removeAmbiguous: true })           // Clean sequences
   *   .split({ mode: 'by-length', basesPerFile: 1000000 }); // 1MB chunks
   *
   * // Genome assembly: Split chromosomes for parallel analysis
   * const chrResults = await seqops(genome)
   *   .grep({ pattern: /^chr[1-9]/, target: 'id' })  // Autosomal only
   *   .transform({ upperCase: true })                // Normalize case
   *   .split({ mode: 'by-id', idRegex: 'chr(\\d+)' }); // Group by chromosome
   *
   * // Amplicon sequencing: Process primers → split by target
   * const amplicons = await seqops(sequences)
   *   .grep({ pattern: forwardPrimer, target: 'sequence' })  // Has forward primer
   *   .grep({ pattern: reversePrimer, target: 'sequence' })  // Has reverse primer
   *   .subseq({ region: '20:-20' })                         // Trim primers
   *   .split({ mode: 'by-parts', numParts: 8 });            // Parallel processing
   *
   * console.log(`Created ${result.filesCreated.length} files`);
   * ```
   */
  async split(options: SplitOptions): Promise<SplitSummary> {
    const { SplitProcessor } = await import("./split");
    const processor = new SplitProcessor();
    return processor.split(this.source, options);
  }

  /**
   * Split sequences with streaming results for advanced processing
   *
   * Returns AsyncIterable of split results following the locate() pattern.
   * Enables sophisticated post-processing workflows where each split result
   * needs individual handling during the splitting process.
   *
   * @param options - Split configuration options
   * @returns AsyncIterable of split results for processing
   *
   * @example
   * ```typescript
   * // Basic streaming - process each split file as it's created
   * for await (const result of seqops(sequences).splitToStream(options)) {
   *   await compressFile(result.outputFile);
   *   console.log(`Split ${result.sequenceCount} sequences to ${result.outputFile}`);
   * }
   *
   * // Large genome processing: Split → compress → upload pipeline
   * for await (const chunk of seqops(largeGenome).splitToStream({
   *   mode: 'by-length',
   *   basesPerFile: 50_000_000 // 50MB chunks
   * })) {
   *   // Process each chunk immediately to manage memory
   *   await compressWithBgzip(chunk.outputFile);
   *   await uploadToCloud(chunk.outputFile + '.gz');
   *   await deleteLocalFile(chunk.outputFile); // Clean up
   *   console.log(`Processed chunk ${chunk.partId}: ${chunk.sequenceCount} sequences`);
   * }
   *
   * // Quality control: Split → validate → report pipeline
   * const qualityReports = [];
   * for await (const batch of seqops(sequencingRun).splitToStream({
   *   mode: 'by-size',
   *   sequencesPerFile: 10000
   * })) {
   *   const qc = await runQualityControl(batch.outputFile);
   *   qualityReports.push({
   *     file: batch.outputFile,
   *     sequences: batch.sequenceCount,
   *     qcScore: qc.overallScore
   *   });
   * }
   * ```
   */
  async *splitToStream(options: SplitOptions): AsyncIterable<SplitResult> {
    const { SplitProcessor } = await import("./split");
    const processor = new SplitProcessor();
    yield* processor.process(this.source, options);
  }

  /**
   * Split by sequence count (convenience method)
   *
   * Most common splitting mode - divide sequences into files with N sequences each.
   * Ideal for creating manageable chunks for parallel processing.
   *
   * @param sequencesPerFile - Number of sequences per output file
   * @param outputDir - Output directory (default: './split')
   * @returns Promise resolving to split results
   *
   * @example
   * ```typescript
   * // Simple case - just split
   * await seqops(sequences).splitBySize(1000);
   *
   * // Common workflow: Filter → process → split for downstream analysis
   * await seqops(rawSequences)
   *   .filter({ minLength: 100 })
   *   .clean({ removeGaps: true })
   *   .splitBySize(5000, './chunks');
   *
   * // RNA-seq: Quality filter → deduplicate → split for differential expression
   * await seqops(rnaseqReads)
   *   .quality({ minScore: 20 })
   *   .rmdup({ by: 'sequence' })
   *   .splitBySize(100000, './de-analysis');
   * ```
   */
  async splitBySize(sequencesPerFile: number, outputDir = "./split"): Promise<SplitSummary> {
    return this.split({ mode: "by-size", sequencesPerFile, outputDir });
  }

  /**
   * Split into equal parts (convenience method)
   *
   * @param numParts - Number of output files to create
   * @param outputDir - Output directory (default: './split')
   * @returns Promise resolving to split results
   */
  async splitByParts(numParts: number, outputDir = "./split"): Promise<SplitSummary> {
    return this.split({ mode: "by-parts", numParts, outputDir });
  }

  /**
   * Split by base count (convenience method)
   *
   * Implements seqkit split2's key functionality for splitting by total
   * sequence bases rather than sequence count. Essential for genome processing
   * where you need consistent data sizes regardless of sequence count.
   *
   * @param basesPerFile - Number of bases per output file
   * @param outputDir - Output directory (default: './split')
   * @returns Promise resolving to split results
   *
   * @example
   * ```typescript
   * // Genome assembly: Split into 10MB chunks for parallel processing
   * await seqops(scaffolds).splitByLength(10_000_000);
   *
   * // Metagenomics: Process → bin → split by data size
   * await seqops(contigs)
   *   .filter({ minLength: 1000 })
   *   .sort({ by: 'length', order: 'desc' })  // Longest first
   *   .splitByLength(5_000_000, './metagenome-bins');
   *
   * // Long-read sequencing: Quality control → split for analysis
   * await seqops(nanoporeReads)
   *   .quality({ minScore: 7 })  // Nanopore quality threshold
   *   .filter({ minLength: 5000, maxLength: 100000 })
   *   .splitByLength(50_000_000, './nanopore-chunks');
   * ```
   */
  async splitByLength(basesPerFile: number, outputDir = "./split"): Promise<SplitSummary> {
    return this.split({ mode: "by-length", basesPerFile, outputDir });
  }

  /**
   * Split by sequence ID pattern (convenience method)
   *
   * Groups sequences by ID patterns for organized analysis. String patterns
   * are automatically converted to RegExp for better developer experience.
   *
   * @param pattern - String pattern or RegExp to group sequences by ID
   * @param outputDir - Output directory (default: './split')
   * @returns Promise resolving to split results
   *
   * @example
   * ```typescript
   * // Genome assembly: Split by chromosome
   * await seqops(scaffolds).splitById('chr(\\d+)'); // chr1, chr2, chr3...
   *
   * // Multi-species analysis: Group by organism
   * await seqops(sequences)
   *   .splitById('(\\w+)_gene'); // Groups: human_gene, mouse_gene, etc.
   *
   * // Transcriptome: Split by gene families
   * await seqops(transcripts)
   *   .filter({ minLength: 200 })
   *   .transform({ upperCase: true })
   *   .splitById('(HOX\\w+)_transcript', './gene-families');
   *
   * // Advanced: Use RegExp for complex patterns
   * await seqops(sequences)
   *   .splitById(/^(chr[XY]|chrM)_/, './sex-chromosomes');
   * ```
   */
  async splitById(pattern: string | RegExp, outputDir = "./split"): Promise<SplitSummary> {
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    return this.split({ mode: "by-id", idRegex: regex.source, outputDir });
  }

  /**
   * Split by genomic region with compile-time validation (convenience method)
   *
   * Uses advanced TypeScript template literal types to parse and validate
   * genomic regions at compile time, preventing coordinate errors.
   *
   * @param region - Genomic region string with compile-time validation
   * @param outputDir - Output directory (default: './split')
   * @returns Promise resolving to split results
   *
   * @example
   * ```typescript
   * // ✅ Type-safe region parsing - validated at compile time
   * await seqops(sequences).splitByRegion('chr1:1000-2000');
   * await seqops(sequences).splitByRegion('scaffold_1:500-1500');
   * await seqops(sequences).splitByRegion('chrX:0-1000'); // 0-based OK
   *
   * // ❌ These cause TypeScript compilation errors:
   * // await seqops(sequences).splitByRegion('chr1:2000-1000'); // end < start
   * // await seqops(sequences).splitByRegion('chr1:1000-1000'); // end = start
   * // await seqops(sequences).splitByRegion('invalid-format'); // bad format
   *
   * // 🔥 Compile-time coordinate extraction available:
   * type Coords = ExtractCoordinates<'chr1:1000-2000'>;
   * // → { chr: 'chr1'; start: 1000; end: 2000; length: 1000 }
   * ```
   */
  async splitByRegion<T extends string>(
    region: T extends ValidGenomicRegion<T> ? T : never,
    outputDir = "./split"
  ): Promise<SplitSummary> {
    return this.split({ mode: "by-region", region, outputDir });
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
    const lineEnding = process.platform === "win32" ? "\r\n" : "\n";
    const writer = new FastaWriter({
      ...(options.wrapWidth !== undefined && { lineWidth: options.wrapWidth }),
      lineEnding,
    });
    const stream = Bun.file(path).writer();

    try {
      for await (const seq of this.source) {
        const fastaSeq: FastaSequence = {
          format: "fasta",
          id: seq.id,
          sequence: seq.sequence,
          length: seq.length,
          ...(seq.description !== undefined && {
            description: seq.description,
          }),
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
  async writeFastq(path: string, defaultQuality: string = "I"): Promise<void> {
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
            format: "fastq",
            id: seq.id,
            sequence: seq.sequence,
            quality: qualityString,
            qualityEncoding: "phred33",
            length: seq.length,
            ...(seq.description !== undefined && {
              description: seq.description,
            }),
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
   * Find pattern locations in sequences
   *
   * Terminal operation that finds all occurrences of patterns within sequences
   * with support for fuzzy matching, strand searching, and various output formats.
   * Mirrors `seqkit locate` functionality.
   *
   * @param pattern - Pattern to locate (string, regex) or full options object
   * @param mismatches - Number of allowed mismatches (for simple pattern only)
   * @returns AsyncIterable of motif locations
   *
   * @example
   * ```typescript
   * // Simple cases (most common)
   * const locations = seqops(sequences)
   *   .locate('ATCG')                    // Exact string match
   *   .locate(/ATG...TAA/)               // Regex pattern
   *   .locate('ATCG', 2);                // Allow 2 mismatches
   *
   * // Advanced options for complex scenarios
   * const locations = seqops(sequences).locate({
   *   pattern: 'ATCG',
   *   allowMismatches: 1,
   *   searchBothStrands: true,
   *   outputFormat: 'bed'
   * });
   *
   * for await (const location of locations) {
   *   console.log(`Found at ${location.start}-${location.end} on ${location.strand}`);
   * }
   * ```
   */
  locate(
    pattern: string | RegExp | LocateOptions,
    mismatches: number = 0
  ): AsyncIterable<MotifLocation> {
    const processor = new LocateProcessor();

    // Handle overloaded parameters for better DX
    const options: LocateOptions =
      typeof pattern === "object" && "pattern" in pattern
        ? pattern // TypeScript knows this is LocateOptions
        : {
            pattern, // TypeScript knows this is string | RegExp
            allowMismatches: mismatches,
          }; // Simple pattern with optional mismatch count

    return processor.locate(this.source, options);
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
    return "quality" in seq && "qualityEncoding" in seq;
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

/**
 * Create SeqOps pipeline from array of sequences
 *
 * Convenient method to convert arrays to SeqOps pipelines.
 * Most common use case for examples and small datasets.
 *
 * @param sequences - Array of sequences
 * @returns New SeqOps instance
 *
 * @example
 * ```typescript
 * const sequences = [
 *   { id: 'seq1', sequence: 'ATCG', length: 4 },
 *   { id: 'seq2', sequence: 'GCTA', length: 4 }
 * ];
 *
 * const result = await seqops.from(sequences)
 *   .translate()
 *   .writeFasta('proteins.fasta');
 * ```
 */
seqops.from = <T extends AbstractSequence | FASTXSequence>(sequences: T[]): SeqOps => {
  async function* arrayToAsyncIterable(): AsyncIterable<AbstractSequence> {
    for (const seq of sequences) {
      yield seq as AbstractSequence;
    }
  }
  return new SeqOps(arrayToAsyncIterable());
};

/**
 * Concatenate multiple sequence files into a single pipeline
 *
 * Static factory function that creates a SeqOps pipeline from multiple files.
 * Elegant API for combining sequence sources with simple duplicate handling.
 *
 * @param filePaths - Array of file paths to concatenate
 * @param handleDuplicateIds - How to handle duplicate IDs: 'suffix' | 'ignore' (default: 'ignore')
 * @returns New SeqOps instance for chaining
 *
 * @example
 * ```typescript
 * // Simple concatenation
 * const combined = seqops.concat(['file1.fasta', 'file2.fasta']);
 *
 * // With duplicate ID suffixing
 * const merged = seqops.concat(['db1.fa', 'db2.fa'], 'suffix')
 *   .filter({ minLength: 100 })
 *   .writeFasta('combined.fa');
 * ```
 */
seqops.concat = (
  filePaths: string[],
  handleDuplicateIds: "suffix" | "ignore" = "ignore"
): SeqOps => {
  async function* concatenateFiles(): AsyncIterable<AbstractSequence> {
    const seenIds = new Set<string>();

    for (let sourceIndex = 0; sourceIndex < filePaths.length; sourceIndex++) {
      const filePath = filePaths[sourceIndex];
      if (!filePath) continue;

      // Simple format detection and parsing
      const parser = new FastaParser();
      const sequences = parser.parseFile(filePath);

      for await (const seq of sequences) {
        let finalSeq = seq;

        // Handle duplicate IDs simply
        if (seenIds.has(seq.id) && handleDuplicateIds === "suffix") {
          finalSeq = { ...seq, id: `${seq.id}_${sourceIndex}` };
        }

        seenIds.add(finalSeq.id);
        yield finalSeq;
      }
    }
  }

  return new SeqOps(concatenateFiles());
};

// Export processors for advanced usage
export { ConcatProcessor } from "./concat";
// Export split-specific types
export { SplitProcessor, type SplitResult, type SplitSummary } from "./split";
// Re-export types and classes for convenience
export {
  type SequenceStats,
  SequenceStatsCalculator,
  type StatsOptions,
} from "./stats";
export { SubseqExtractor, type SubseqOptions } from "./subseq";
export { TranslateProcessor } from "./translate";
// Export new semantic API types
export type {
  AnnotateOptions,
  CleanOptions,
  ConcatOptions,
  FilterOptions,
  GrepOptions,
  GroupOptions,
  LocateOptions,
  QualityOptions,
  RmdupOptions,
  SampleOptions,
  SortOptions,
  SplitOptions,
  TransformOptions,
  TranslateOptions,
  ValidateOptions,
} from "./types";
