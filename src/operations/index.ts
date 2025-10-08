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
import {
  JSONLParser,
  type JSONParseOptions,
  JSONParser,
  type JSONWriteOptions,
} from "../formats/json";
import type {
  AbstractSequence,
  FastaSequence,
  FastqSequence,
  KmerSequence,
  MotifLocation,
  ValidGenomicRegion,
} from "../types";
// Import processors
import { AmpliconProcessor } from "./amplicon";
import { CleanProcessor } from "./clean";
import { ConcatProcessor } from "./concat";
import { ConvertProcessor, type Fa2FqOptions, fa2fq, fq2fa } from "./convert";
import { FilterProcessor } from "./filter";
import {
  type ColumnId,
  type Fx2TabOptions,
  type Fx2TabRow,
  fx2tab,
  rowsToStrings,
  type Tab2FxOptions,
  TabularOps,
  tab2fx,
} from "./fx2tab";
import { GrepProcessor } from "./grep";
import { LocateProcessor } from "./locate";
import { QualityProcessor } from "./quality";
import { rename } from "./rename";
import { replace } from "./replace";
import { RmdupProcessor } from "./rmdup";
import { SampleProcessor } from "./sample";
import { SortProcessor } from "./sort";
import type { SplitResult, SplitSummary } from "./split";
import { type SequenceStats, SequenceStatsCalculator, type StatsOptions } from "./stats";
import { SubseqExtractor, type SubseqOptions } from "./subseq";
import { TransformProcessor } from "./transform";
import { TranslateProcessor } from "./translate";
import { WindowsProcessor } from "./windows";
import { KmerSet, SequenceSet } from "./types";
import type {
  AmpliconOptions,
  AnnotateOptions,
  CleanOptions,
  ConcatOptions,
  ConvertOptions,
  FilterOptions,
  GrepOptions,
  GroupOptions,
  LocateOptions,
  QualityOptions,
  RenameOptions,
  ReplaceOptions,
  RmdupOptions,
  SampleOptions,
  SortOptions,
  SplitOptions,
  TransformOptions,
  TranslateOptions,
  ValidateOptions,
  WindowOptions,
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
export class SeqOps<T extends AbstractSequence> {
  /**
   * Create a new SeqOps pipeline
   *
   * @param source - Input sequences (async iterable)
   */
  constructor(private readonly source: AsyncIterable<T>) {}

  // =============================================================================
  // STATIC FACTORY METHODS
  // =============================================================================

  /**
   * Create SeqOps pipeline from delimiter-separated file
   *
   * Supports auto-detection of delimiter and format. Files can be compressed
   * (.gz, .zst) and will be automatically decompressed during streaming.
   *
   * @param path - Path to DSV file (TSV, CSV, or custom delimiter)
   * @param options - Parsing options (delimiter auto-detected if not specified)
   * @returns New SeqOps pipeline for sequence processing
   *
   * @example
   * ```typescript
   * // Auto-detect delimiter
   * const sequences = await SeqOps.fromDSV('data.txt').collect();
   *
   * // Explicit delimiter with custom columns
   * const genes = await SeqOps.fromDSV('genes.psv', {
   *   delimiter: '|',
   *   format: 'fastq'
   * }).filter({ minLength: 100 });
   * ```
   *
   * @since 2.1.0
   */
  static fromDSV(path: string, options?: Tab2FxOptions): SeqOps<AbstractSequence> {
    return new SeqOps(tab2fx(path, options));
  }

  /**
   * Create SeqOps pipeline from TSV (tab-separated) file
   *
   * Convenience method for TSV files with tab delimiter pre-configured.
   *
   * @param path - Path to TSV file
   * @param options - Parsing options (delimiter forced to tab)
   * @returns New SeqOps pipeline
   *
   * @example
   * ```typescript
   * await SeqOps.fromTSV('sequences.tsv')
   *   .filter({ minLength: 50 })
   *   .writeFasta('filtered.fa');
   * ```
   *
   * @since 2.1.0
   */
  static fromTSV(
    path: string,
    options?: Omit<Tab2FxOptions, "delimiter">
  ): SeqOps<AbstractSequence> {
    return SeqOps.fromDSV(path, { ...options, delimiter: "\t" });
  }

  /**
   * Create SeqOps pipeline from CSV (comma-separated) file
   *
   * Convenience method for CSV files with comma delimiter pre-configured.
   * Handles Excel-exported CSV files with proper quote escaping.
   *
   * @param path - Path to CSV file
   * @param options - Parsing options (delimiter forced to comma)
   * @returns New SeqOps pipeline
   *
   * @example
   * ```typescript
   * await SeqOps.fromCSV('excel_export.csv')
   *   .clean()
   *   .stats()
   *   .writeFastq('processed.fq');
   * ```
   *
   * @since 2.1.0
   */
  static fromCSV(
    path: string,
    options?: Omit<Tab2FxOptions, "delimiter">
  ): SeqOps<AbstractSequence> {
    return SeqOps.fromDSV(path, { ...options, delimiter: "," });
  }

  /**
   * Create SeqOps pipeline from JSON file
   *
   * Parses JSON files containing sequence arrays. Supports both simple
   * array format and wrapped format with metadata. Suitable for datasets
   * under 100K sequences (loads entire file into memory).
   *
   * @param path - Path to JSON file
   * @param options - Parsing options (format, quality encoding)
   * @returns New SeqOps pipeline
   *
   * @example
   * ```typescript
   * // Parse JSON array of sequences
   * await SeqOps.fromJSON('sequences.json')
   *   .filter({ minLength: 100 })
   *   .writeFasta('filtered.fa');
   *
   * // Parse FASTQ sequences with quality encoding
   * await SeqOps.fromJSON('reads.json', {
   *   format: 'fastq',
   *   qualityEncoding: 'phred33'
   * }).quality({ minScore: 20 });
   * ```
   *
   * @performance O(n) memory - loads entire file. Use fromJSONL() for large datasets.
   * @since 0.1.0
   */
  static fromJSON(path: string, options?: JSONParseOptions): SeqOps<AbstractSequence> {
    const parser = new JSONParser();
    return new SeqOps(parser.parseFile(path, options));
  }

  /**
   * Create SeqOps pipeline from JSONL (JSON Lines) file
   *
   * Parses JSONL files where each line is a separate JSON object.
   * Provides streaming with O(1) memory usage, suitable for datasets
   * with millions of sequences.
   *
   * @param path - Path to JSONL file
   * @param options - Parsing options (format, quality encoding)
   * @returns New SeqOps pipeline
   *
   * @example
   * ```typescript
   * // Stream large JSONL dataset
   * await SeqOps.fromJSONL('huge-dataset.jsonl')
   *   .filter({ minLength: 100 })
   *   .sample(1000)
   *   .writeFasta('sampled.fa');
   *
   * // Process FASTQ from JSONL
   * await SeqOps.fromJSONL('reads.jsonl', { format: 'fastq' })
   *   .quality({ minScore: 30 })
   *   .clean()
   *   .writeFastq('clean.fq');
   * ```
   *
   * @performance O(1) memory - streams line-by-line. Ideal for large files.
   * @since 0.1.0
   */
  static fromJSONL(path: string, options?: JSONParseOptions): SeqOps<AbstractSequence> {
    const parser = new JSONLParser();
    return new SeqOps(parser.parseFile(path, options));
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
   * const result = await SeqOps.from(sequences)
   *   .translate()
   *   .writeFasta('proteins.fasta');
   * ```
   *
   * @since 2.0.0
   */
  static from<T extends AbstractSequence>(sequences: T[]): SeqOps<T> {
    async function* arrayToAsyncIterable(): AsyncIterable<T> {
      for (const seq of sequences) {
        yield seq as T;
      }
    }
    return new SeqOps(arrayToAsyncIterable());
  }

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
   * const combined = SeqOps.concat(['file1.fasta', 'file2.fasta']);
   *
   * // With duplicate ID suffixing
   * const merged = SeqOps.concat(['db1.fa', 'db2.fa'], 'suffix')
   *   .filter({ minLength: 100 })
   *   .writeFasta('combined.fa');
   * ```
   *
   * @since 2.0.0
   */
  static concat(
    filePaths: string[],
    handleDuplicateIds: "suffix" | "ignore" = "ignore"
  ): SeqOps<FastaSequence> {
    async function* concatenateFiles(): AsyncIterable<FastaSequence> {
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
  }

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
  filter(options: FilterOptions | ((seq: T) => boolean)): SeqOps<T> {
    // Handle legacy predicate function for backwards compatibility
    if (typeof options === "function") {
      return new SeqOps<T>(this.filterWithPredicate(options) as AsyncIterable<T>);
    }

    const processor = new FilterProcessor();
    return new SeqOps<T>(processor.process(this.source, options) as AsyncIterable<T>);
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
  transform(options: TransformOptions): SeqOps<T> {
    const processor = new TransformProcessor();
    return new SeqOps<T>(processor.process(this.source, options) as AsyncIterable<T>);
  }

  /**
   * Extract amplicons via primer sequences
   *
   * Finds primer pairs within sequences and extracts the amplified regions.
   * Supports mismatch tolerance, degenerate bases (IUPAC codes), windowed search
   * for long-read performance, canonical matching for BED-extracted primers,
   * and flexible region extraction. Provides complete seqkit amplicon parity
   * with enhanced biological validation and type safety.
   *
   * @example
   * ```typescript
   * // Simple amplicon extraction (90% use case)
   * seqops(sequences)
   *   .amplicon('ATCGATCG', 'CGATCGAT')
   *   .writeFasta('amplicons.fasta');
   *
   * // With mismatch tolerance (common case)
   * seqops(sequences)
   *   .amplicon('ATCGATCG', 'CGATCGAT', 2)
   *   .filter({ minLength: 50 });
   *
   * // Single primer (auto-canonical matching)
   * seqops(sequences)
   *   .amplicon('UNIVERSAL_PRIMER')
   *   .stats();
   *
   * // Real-world COVID-19 diagnostics
   * seqops(samples)
   *   .quality({ minScore: 20 })
   *   .amplicon(
   *     primer`ACCAGGAACTAATCAGACAAG`,     // N gene forward
   *     primer`CAAAGACCAATCCTACCATGAG`,    // N gene reverse
   *     2                                  // Allow sequencing errors
   *   )
   *   .validate({ mode: 'strict' });
   *
   * // Long reads with windowed search (massive performance boost)
   * seqops(nanoporeReads)
   *   .amplicon('FORWARD', 'REVERSE', {
   *     searchWindow: { forward: 200, reverse: 200 }  // 100x+ speedup
   *   });
   *
   * // Advanced features (10% use case)
   * seqops(sequences)
   *   .amplicon({
   *     forwardPrimer: primer`ACCAGGAACTAATCAGACAAG`,
   *     reversePrimer: primer`CAAAGACCAATCCTACCATGAG`,
   *     maxMismatches: 3,                             // Long-read tolerance
   *     canonical: true,                              // BED-extracted primers
   *     flanking: true,                               // Include primer context
   *     region: '-100:100',                           // Biological context
   *     searchWindow: { forward: 200, reverse: 200 }, // Performance optimization
   *     outputMismatches: true                        // Debug information
   *   })
   *   .rmdup('sequence')
   *   .writeFasta('advanced_amplicons.fasta');
   * ```
   */

  // Method overloads for clean IntelliSense
  amplicon(forwardPrimer: string): SeqOps<T>;
  amplicon(forwardPrimer: string, reversePrimer: string): SeqOps<T>;
  amplicon(forwardPrimer: string, reversePrimer: string, maxMismatches: number): SeqOps<T>;
  amplicon(
    forwardPrimer: string,
    reversePrimer: string,
    options: Partial<AmpliconOptions>
  ): SeqOps<T>;
  amplicon(options: AmpliconOptions): SeqOps<T>;

  // Implementation handles all overloads
  amplicon(
    forwardPrimer: string | AmpliconOptions,
    reversePrimer?: string,
    maxMismatchesOrOptions?: number | Partial<AmpliconOptions>
  ): SeqOps<T> {
    const processor = new AmpliconProcessor();

    // Clean overload resolution
    let options: AmpliconOptions;

    if (typeof forwardPrimer === "object") {
      // amplicon({ options })
      options = forwardPrimer;
    } else if (reversePrimer === undefined) {
      // amplicon('PRIMER')
      options = { forwardPrimer };
    } else if (maxMismatchesOrOptions === undefined) {
      // amplicon('FORWARD', 'REVERSE')
      options = { forwardPrimer, reversePrimer };
    } else if (typeof maxMismatchesOrOptions === "number") {
      // amplicon('FORWARD', 'REVERSE', 2)
      options = { forwardPrimer, reversePrimer, maxMismatches: maxMismatchesOrOptions };
    } else {
      // amplicon('FORWARD', 'REVERSE', { options })
      options = { forwardPrimer, reversePrimer, ...maxMismatchesOrOptions };
    }

    return new SeqOps<T>(processor.process(this.source, options) as AsyncIterable<T>);
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
  clean(options: CleanOptions): SeqOps<T> {
    const processor = new CleanProcessor();
    return new SeqOps<T>(processor.process(this.source, options) as AsyncIterable<T>);
  }

  /**
   * FASTQ quality operations
   *
   * Filter, trim, and bin sequences based on quality scores.
   * Supports filtering, trimming, and binning operations - all operations
   * are optional and can be combined. Only affects FASTQ sequences;
   * FASTA sequences pass through unchanged.
   *
   * @param options - Quality filtering, trimming, and binning options
   * @returns New SeqOps instance for chaining
   *
   * @example Basic filtering
   * ```typescript
   * seqops(sequences)
   *   .quality({ minScore: 20 })
   * ```
   *
   * @example Quality trimming
   * ```typescript
   * seqops(sequences)
   *   .quality({ trim: true, trimThreshold: 20, trimWindow: 4 })
   * ```
   *
   * @example Quality binning for compression
   * ```typescript
   * seqops(sequences)
   *   .quality({ bins: 3, preset: 'illumina' })
   * ```
   *
   * @example Combined operations
   * ```typescript
   * seqops(sequences)
   *   .quality({
   *     minScore: 20,        // 1. Filter low quality
   *     trim: true,          // 2. Trim ends
   *     bins: 3,             // 3. Bin for compression
   *     preset: 'illumina'
   *   })
   * ```
   *
   * @example Custom binning boundaries
   * ```typescript
   * seqops(sequences)
   *   .quality({ bins: 2, boundaries: [25] })
   * ```
   */
  quality<U extends T & FastqSequence>(this: SeqOps<U>, options: QualityOptions): SeqOps<U> {
    const processor = new QualityProcessor();
    return new SeqOps<U>(processor.process(this.source, options) as AsyncIterable<U>);
  }

  /**
   * Convert FASTQ quality score encodings
   *
   * Convert quality scores between different encoding schemes (Phred+33, Phred+64, Solexa).
   * Essential for legacy data processing and tool compatibility. Only affects FASTQ sequences;
   * FASTA sequences pass through unchanged.
   *
   * @param options - Conversion options
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * // Primary workflow: Auto-detect source encoding (matches seqkit)
   * seqops(legacyData)
   *   .convert({ targetEncoding: 'phred33' })
   *   .writeFastq('modernized.fastq');
   *
   * // Legacy Illumina 1.3-1.7 to modern standard
   * seqops(illumina15Data)
   *   .convert({
   *     sourceEncoding: 'phred64',  // Skip detection for known encoding
   *     targetEncoding: 'phred33'   // Modern standard
   *   })
   *
   * // Real-world pipeline: QC → standardize encoding → analysis
   * const results = await seqops(mixedEncodingFiles)
   *   .quality({ minScore: 20 })           // Filter first
   *   .convert({ targetEncoding: 'phred33' })  // Standardize
   *   .stats({ detailed: true });
   * ```
   */
  convert<U extends T & FastqSequence>(this: SeqOps<U>, options: ConvertOptions): SeqOps<U> {
    const processor = new ConvertProcessor();
    return new SeqOps<U>(processor.process(this.source, options) as AsyncIterable<U>);
  }

  /**
   * Convert FASTA sequences to FASTQ format
   *
   * Converts FASTA sequences to FASTQ by adding uniform quality scores.
   * This method is only available when working with FASTA sequences and
   * will cause a compile-time error if called on FASTQ sequences.
   *
   * @param options - Conversion options with compile-time validation for literal values
   * @returns New SeqOps instance with FASTQ sequences
   *
   * @example
   * ```typescript
   * // Convert with default quality (Phred+33 score 40)
   * await seqops(fastaSeqs)
   *   .toFastqSequence()
   *   .writeFastq('output.fastq');
   *
   * // Convert with custom quality character
   * await seqops(fastaSeqs)
   *   .toFastqSequence({ quality: 'I' }) // Valid
   *   .writeFastq('output.fastq');
   *
   * // These will cause compile-time errors:
   * // seqops(fastaSeqs).toFastqSequence({ quality: '€' }); // Invalid character
   * // seqops(fastqSeqs).toFastqSequence(); // Cannot convert FASTQ to FASTQ
   * ```
   */
  toFastqSequence<U extends T & FastaSequence>(
    this: SeqOps<U>,
    options?: Fa2FqOptions
  ): SeqOps<FastqSequence> {
    // The type constraint ensures U extends FastaSequence
    // so this.source is AsyncIterable<U> where U extends FastaSequence
    // fa2fq applies ValidateQuality internally for compile-time validation
    return new SeqOps<FastqSequence>(fa2fq(this.source, options));
  }

  /**
   * Convert FASTQ sequences to FASTA format
   *
   * Converts FASTQ sequences to FASTA by removing quality scores.
   * This method is only available when working with FASTQ sequences and
   * will cause a compile-time error if called on FASTA sequences.
   *
   * @param options - Conversion options
   * @returns New SeqOps instance with FASTA sequences
   *
   * @example
   * ```typescript
   * // Convert FASTQ to FASTA for BLAST database
   * await seqops(fastqSeqs)
   *   .toFastaSequence()
   *   .writeFasta('blast_db.fasta');
   *
   * // Preserve quality metrics for QC tracking
   * await seqops(fastqSeqs)
   *   .toFastaSequence({ includeQualityStats: true })
   *   .writeFasta('assembly_input.fasta');
   *
   * // This will cause a compile-time error:
   * // seqops(fastaSeqs).toFastaSequence(); // Cannot convert FASTA to FASTA
   * ```
   */
  toFastaSequence<U extends T & FastqSequence>(
    this: SeqOps<U>,
    options?: Record<string, never>
  ): SeqOps<FastaSequence> {
    // The type constraint ensures U extends FastqSequence
    // so this.source is AsyncIterable<U> where U extends FastqSequence
    return new SeqOps<FastaSequence>(fq2fa(this.source, options));
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
  validate(options: ValidateOptions): SeqOps<T> {
    const processor = new ValidateProcessor();
    return new SeqOps<T>(processor.process(this.source, options) as AsyncIterable<T>);
  }

  /**
   * Search sequences by pattern
   *
   * Pattern matching and filtering similar to Unix grep. Supports both
   * simple string patterns and complex options for advanced use cases.
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

  // Method overloads for clean IntelliSense
  grep(pattern: string): SeqOps<T>;
  grep(pattern: RegExp): SeqOps<T>;
  grep(pattern: string, target: "sequence" | "id" | "description"): SeqOps<T>;
  grep(pattern: RegExp, target: "sequence" | "id" | "description"): SeqOps<T>;
  grep(options: GrepOptions): SeqOps<T>;

  // Implementation handles all overloads
  grep(
    pattern: string | RegExp | GrepOptions,
    target: "sequence" | "id" | "description" = "sequence"
  ): SeqOps<T> {
    const processor = new GrepProcessor();

    // Handle overloaded parameters for better DX
    const options: GrepOptions =
      typeof pattern === "object" && "pattern" in pattern
        ? pattern // TypeScript knows this is GrepOptions
        : { pattern, target }; // TypeScript knows pattern is string | RegExp here

    return new SeqOps<T>(processor.process(this.source, options) as AsyncIterable<T>);
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
  ): SeqOps<T> {
    const processor = new ConcatProcessor();
    const fullOptions: ConcatOptions = { ...options, sources };
    return new SeqOps<T>(processor.process(this.source, fullOptions) as AsyncIterable<T>);
  }

  /**
   * Helper for legacy predicate filter
   * @private
   */
  private async *filterWithPredicate(predicate: (seq: T) => boolean): AsyncIterable<T> {
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
  subseq(options: SubseqOptions): SeqOps<T> {
    const extractor = new SubseqExtractor();
    return new SeqOps(extractor.extract(this.source, options));
  }

  /**
   * Generate sliding windows (k-mers) from sequences
   *
   * Extracts overlapping or non-overlapping windows from sequences with
   * compile-time k-mer size tracking. Essential for k-mer analysis,
   * motif discovery, and sequence decomposition.
   *
   * @param size - Window size (k-mer size)
   * @returns New SeqOps instance with KmerSequence<K> type
   *
   * @example
   * ```typescript
   * // Simple usage - just specify size
   * const kmers = await seqops(sequences).windows(21).toArray();
   *
   * // With options - step, circular, greedy modes
   * seqops(sequences).windows(21, { step: 3, circular: true })
   *
   * // Non-overlapping tiles
   * seqops(sequences).windows(100, { step: 100 })
   *
   * // Greedy mode - include short final window
   * seqops(sequences).windows(50, { greedy: true })
   * ```
   */
  windows<K extends number>(size: K): SeqOps<KmerSequence<K>>;

  /**
   * Generate sliding windows (k-mers) from sequences with options
   *
   * @param size - Window size (k-mer size)
   * @param options - Additional window options (step, circular, greedy, etc.)
   * @returns New SeqOps instance with KmerSequence<K> type
   */
  windows<K extends number>(
    size: K,
    options: Omit<WindowOptions<K>, "size">
  ): SeqOps<KmerSequence<K>>;

  /**
   * Generate sliding windows (k-mers) from sequences (legacy object form)
   *
   * @param options - Window generation options with k-mer size
   * @returns New SeqOps instance with KmerSequence<K> type
   */
  windows<K extends number>(options: WindowOptions<K>): SeqOps<KmerSequence<K>>;

  windows<K extends number>(
    sizeOrOptions: K | WindowOptions<K>,
    maybeOptions?: Omit<WindowOptions<K>, "size">
  ): SeqOps<KmerSequence<K>> {
    const processor = new WindowsProcessor<K>();

    let fullOptions: WindowOptions<K>;
    if (typeof sizeOrOptions === "number") {
      fullOptions = { ...maybeOptions, size: sizeOrOptions } as WindowOptions<K>;
    } else {
      fullOptions = sizeOrOptions;
    }

    const result = processor.process(this.source, fullOptions);
    return new SeqOps<KmerSequence<K>>(result);
  }

  /**
   * Alias for `.windows()` - emphasizes sliding window concept
   *
   * @param size - Window size
   * @returns SeqOps yielding KmerSequence objects
   */
  sliding<K extends number>(size: K): SeqOps<KmerSequence<K>>;
  sliding<K extends number>(
    size: K,
    options: Omit<WindowOptions<K>, "size">
  ): SeqOps<KmerSequence<K>>;
  sliding<K extends number>(options: WindowOptions<K>): SeqOps<KmerSequence<K>>;
  sliding<K extends number>(
    sizeOrOptions: K | WindowOptions<K>,
    maybeOptions?: Omit<WindowOptions<K>, "size">
  ): SeqOps<KmerSequence<K>> {
    return this.windows(sizeOrOptions as any, maybeOptions as any);
  }

  /**
   * Alias for `.windows()` - emphasizes k-mer generation
   *
   * @param size - K-mer size
   * @returns SeqOps yielding KmerSequence objects
   */
  kmers<K extends number>(size: K): SeqOps<KmerSequence<K>>;
  kmers<K extends number>(
    size: K,
    options: Omit<WindowOptions<K>, "size">
  ): SeqOps<KmerSequence<K>>;
  kmers<K extends number>(options: WindowOptions<K>): SeqOps<KmerSequence<K>>;
  kmers<K extends number>(
    sizeOrOptions: K | WindowOptions<K>,
    maybeOptions?: Omit<WindowOptions<K>, "size">
  ): SeqOps<KmerSequence<K>> {
    return this.windows(sizeOrOptions as any, maybeOptions as any);
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
  head(n: number): SeqOps<T> {
    async function* take(source: AsyncIterable<AbstractSequence>) {
      let count = 0;
      for await (const seq of source) {
        if (count >= n) break;
        yield seq;
        count++;
      }
    }
    return new SeqOps<T>(take(this.source) as AsyncIterable<T>);
  }

  /**
   * Sample sequences statistically
   *
   * Apply statistical sampling to select a subset of sequences.
   * Supports both simple count-based sampling and advanced options.
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

  // Method overloads for clean IntelliSense
  sample(count: number): SeqOps<T>;
  sample(count: number, strategy: "random" | "systematic" | "reservoir"): SeqOps<T>;
  sample(options: SampleOptions): SeqOps<T>;

  // Implementation handles all overloads
  sample(
    count: number | SampleOptions,
    strategy: "random" | "systematic" | "reservoir" = "reservoir"
  ): SeqOps<T> {
    const processor = new SampleProcessor();

    // Handle overloaded parameters for better DX
    const options: SampleOptions =
      typeof count === "number"
        ? { n: count, strategy } // Simple count with optional strategy
        : count; // Full options object provided

    return new SeqOps<T>(processor.process(this.source, options) as AsyncIterable<T>);
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
  sort(options: SortOptions): SeqOps<T> {
    const processor = new SortProcessor();
    return new SeqOps<T>(processor.process(this.source, options) as AsyncIterable<T>);
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
  sortByLength(order: "asc" | "desc" = "asc"): SeqOps<T> {
    return this.sort({ sortBy: order === "asc" ? "length-asc" : "length" });
  }

  /**
   * Sort sequences by ID (convenience method)
   *
   * @param order - Sort order: 'asc' or 'desc' (default: 'asc')
   * @returns New SeqOps instance for chaining
   */
  sortById(order: "asc" | "desc" = "asc"): SeqOps<T> {
    return this.sort({ sortBy: order === "asc" ? "id" : "id-desc" });
  }

  /**
   * Sort sequences by GC content (convenience method)
   *
   * @param order - Sort order: 'asc' or 'desc' (default: 'asc')
   * @returns New SeqOps instance for chaining
   */
  sortByGC(order: "asc" | "desc" = "asc"): SeqOps<T> {
    return this.sort({ sortBy: order === "asc" ? "gc-asc" : "gc" });
  }

  /**
   * Remove duplicate sequences
   *
   * High-performance deduplication using probabilistic Bloom filters or
   * exact Set-based approaches. Supports both simple deduplication and
   * advanced configuration for large datasets.
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

  // Method overloads for clean IntelliSense
  rmdup(by: "sequence" | "id" | "both"): SeqOps<T>;
  rmdup(by: "sequence" | "id" | "both", exact: boolean): SeqOps<T>;
  rmdup(options: RmdupOptions): SeqOps<T>;

  // Implementation handles all overloads
  rmdup(by: "sequence" | "id" | "both" | RmdupOptions, exact: boolean = false): SeqOps<T> {
    const processor = new RmdupProcessor();

    // Handle overloaded parameters for better DX
    const options: RmdupOptions =
      typeof by === "string"
        ? { by, exact } // Simple by + exact parameters
        : by; // Full options object provided

    return new SeqOps<T>(processor.process(this.source, options) as AsyncIterable<T>);
  }

  /**
   * Rename duplicated sequence IDs
   *
   * Appends numeric suffixes to duplicate IDs to ensure uniqueness.
   * Useful after merging datasets or processing PCR replicates.
   *
   * @param options - Rename options
   * @returns New SeqOps with unique IDs
   *
   * @example
   * ```typescript
   * // Basic usage - duplicates get "_2", "_3" suffixes
   * seqops(sequences).rename();
   *
   * // Rename all occurrences including first
   * seqops(sequences).rename({ renameFirst: true, startNum: 1 });
   * // Result: "id_1", "id_2", "id_3"
   * ```
   */
  rename(options?: RenameOptions): SeqOps<T> {
    return new SeqOps(rename(this.source, options));
  }

  /**
   * Replace sequence names/content by regular expression
   *
   * Performs pattern-based substitution on sequence IDs (default) or
   * sequence content (FASTA only). Supports capture variables, special
   * placeholders ({nr}, {kv}, {fn}), and grep-style filtering.
   *
   * @param options - Replace options with pattern and replacement string
   * @returns New SeqOps instance for chaining
   *
   * @example
   * ```typescript
   * // Remove descriptions from sequence IDs
   * seqops(sequences).replace({ pattern: '\\s.+', replacement: '' })
   *
   * // Add prefix to all sequence IDs
   * seqops(sequences).replace({ pattern: '^', replacement: 'PREFIX_' })
   *
   * // Use capture variables to restructure IDs
   * seqops(sequences).replace({
   *   pattern: '^(\\w+)_(\\w+)',
   *   replacement: '$2_$1'
   * })
   *
   * // Key-value lookup from file
   * seqops(sequences).replace({
   *   pattern: '^(\\w+)',
   *   replacement: '$1_{kv}',
   *   kvFile: 'aliases.txt'
   * })
   * ```
   */
  replace(options: ReplaceOptions): SeqOps<T> {
    return new SeqOps(replace(this.source, options));
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
  translate(geneticCode?: number | TranslateOptions): SeqOps<T> {
    const processor = new TranslateProcessor();

    // Handle progressive disclosure for better DX
    const options: TranslateOptions =
      typeof geneticCode === "number"
        ? { geneticCode } // Simple: just genetic code, use defaults
        : geneticCode || {}; // Full options object or empty defaults

    return new SeqOps<T>(processor.process(this.source, options) as AsyncIterable<T>);
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
  translateMito(): SeqOps<T> {
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
  translateAllFrames(geneticCode: number = 1): SeqOps<T> {
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
  translateOrf(minLength: number = 30, geneticCode: number = 1): SeqOps<T> {
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
   * Write sequences to JSON file
   *
   * Convenience method that converts sequences to tabular format and writes
   * as JSON. Supports both simple array format and wrapped format with metadata.
   * Loads entire dataset into memory before writing.
   *
   * @param path - Output file path
   * @param options - Combined column selection and JSON formatting options
   * @returns Promise resolving when write is complete
   *
   * @example
   * ```typescript
   * // Simple JSON array
   * await SeqOps.fromFasta('input.fa')
   *   .writeJSON('output.json');
   *
   * // With selected columns
   * await SeqOps.fromFasta('input.fa')
   *   .writeJSON('output.json', {
   *     columns: ['id', 'sequence', 'length', 'gc']
   *   });
   *
   * // Pretty-printed with metadata
   * await SeqOps.fromFasta('input.fa')
   *   .writeJSON('output.json', {
   *     columns: ['id', 'sequence', 'length'],
   *     pretty: true,
   *     includeMetadata: true
   *   });
   * ```
   *
   * @performance O(n) memory - loads all sequences. Use writeJSONL() for large datasets.
   * @since 0.1.0
   */
  async writeJSON(
    path: string,
    options?: Fx2TabOptions<readonly ColumnId[]> & JSONWriteOptions
  ): Promise<void> {
    // Separate Fx2TabOptions from JSONWriteOptions
    const { pretty, includeMetadata, nullValue: jsonNullValue, ...fx2tabOptions } = options || {};

    // Build JSON-specific options
    const jsonOptions: JSONWriteOptions = {
      ...(pretty !== undefined && { pretty }),
      ...(includeMetadata !== undefined && { includeMetadata }),
      ...(jsonNullValue !== undefined && { nullValue: jsonNullValue }),
    };

    // Force header: false to exclude header row from JSON output
    await this.toTabular({ ...fx2tabOptions, header: false }).writeJSON(path, jsonOptions);
  }

  /**
   * Write sequences to JSONL (JSON Lines) file
   *
   * Convenience method that converts sequences to tabular format and writes
   * as JSONL (one JSON object per line). Provides streaming with O(1) memory
   * usage, ideal for large datasets.
   *
   * Note: JSONL format does not support metadata or pretty-printing.
   * Each line is a separate, compact JSON object.
   *
   * @param path - Output file path
   * @param options - Column selection options (JSON formatting options not applicable)
   * @returns Promise resolving when write is complete
   *
   * @example
   * ```typescript
   * // Basic JSONL output
   * await SeqOps.fromFasta('input.fa')
   *   .writeJSONL('output.jsonl');
   *
   * // With selected columns
   * await SeqOps.fromFasta('input.fa')
   *   .writeJSONL('output.jsonl', {
   *     columns: ['id', 'sequence', 'length', 'gc']
   *   });
   *
   * // Large dataset streaming
   * await SeqOps.fromFasta('huge-dataset.fa')
   *   .filter({ minLength: 100 })
   *   .writeJSONL('filtered.jsonl'); // O(1) memory
   * ```
   *
   * @performance O(1) memory - streams line-by-line. Use for large datasets.
   * @since 0.1.0
   */
  async writeJSONL(path: string, options?: Fx2TabOptions<readonly ColumnId[]>): Promise<void> {
    // JSONL doesn't support pretty-printing or metadata (line-oriented format)
    // Force header: false to exclude header row from output
    await this.toTabular({ ...options, header: false }).writeJSONL(path);
  }

  /**
   * Convert sequences to tabular format
   *
   * Transform sequences into a tabular representation with configurable columns.
   * This is the primary method for tabular conversion, providing a more intuitive
   * name than the seqkit-inspired fx2tab.
   *
   * @param options - Column selection and formatting options
   * @returns TabularOps instance for further processing or writing
   *
   * @example
   * ```typescript
   * // Basic conversion to tabular format
   * await seqops(sequences)
   *   .toTabular({ columns: ['id', 'seq', 'length', 'gc'] })
   *   .writeTSV('output.tsv');
   *
   * // With custom columns
   * await seqops(sequences)
   *   .toTabular({
   *     columns: ['id', 'seq', 'gc'],
   *     customColumns: {
   *       high_gc: (seq) => seq.gc > 60 ? 'HIGH' : 'NORMAL'
   *     }
   *   })
   *   .writeCSV('analysis.csv');
   * ```
   */
  toTabular<Columns extends readonly ColumnId[] = readonly ["id", "seq", "length"]>(
    options?: Fx2TabOptions<Columns>
  ): TabularOps<Columns> {
    return new TabularOps(fx2tab(this.source, options));
  }

  /**
   * Convert sequences to tabular format (SeqKit compatibility)
   *
   * Alias for `.toTabular()` maintained for SeqKit parity and backward compatibility.
   * New code should prefer `.toTabular()` for better clarity.
   *
   * @param options - Column selection and formatting options
   * @returns TabularOps instance for further processing or writing
   * @see {@link toTabular} - Primary method for tabular conversion
   *
   * @example
   * ```typescript
   * // Legacy name for SeqKit users
   * await seqops(sequences)
   *   .fx2tab({ columns: ['id', 'seq', 'gc'] })
   *   .writeTSV('output.tsv');
   * ```
   */
  fx2tab<Columns extends readonly ColumnId[] = readonly ["id", "seq", "length"]>(
    options?: Fx2TabOptions<Columns>
  ): TabularOps<Columns> {
    return this.toTabular(options);
  }

  /**
   * Convert sequences to row-based format
   *
   * Clearer alias for `.toTabular()` that emphasizes the row-based structure
   * used for output to various formats (TSV, CSV, JSON, JSONL).
   *
   * This method converts sequences into a structured row format that can be
   * written to tabular formats (TSV/CSV) or object formats (JSON/JSONL).
   * Use this when the term "tabular" feels semantically incorrect for your
   * output format (e.g., JSON).
   *
   * @param options - Column selection and formatting options
   * @returns TabularOps instance for further processing or writing
   * @see {@link toTabular} - Original method name
   *
   * @example
   * ```typescript
   * // Writing to JSON - "rows" is clearer than "tabular"
   * await seqops(sequences)
   *   .asRows({ columns: ['id', 'sequence', 'length'] })
   *   .writeJSON('output.json');
   *
   * // Writing to JSONL
   * await seqops(sequences)
   *   .asRows({ columns: ['id', 'seq', 'gc'] })
   *   .writeJSONL('output.jsonl');
   *
   * // Also works for tabular formats
   * await seqops(sequences)
   *   .asRows({ columns: ['id', 'seq', 'length'] })
   *   .writeTSV('output.tsv');
   * ```
   *
   * @since 0.1.0
   */
  asRows<Columns extends readonly ColumnId[] = readonly ["id", "seq", "length"]>(
    options?: Fx2TabOptions<Columns>
  ): TabularOps<Columns> {
    return this.toTabular(options);
  }

  /**
   * Write sequences as TSV (tab-separated values)
   *
   * Terminal operation that writes sequences as tab-separated values.
   *
   * @param path - Output file path
   * @param options - Conversion options (delimiter will be set to tab)
   *
   * @example
   * ```typescript
   * // Simple TSV output
   * await seqops(sequences).writeTSV('output.tsv');
   *
   * // With column selection
   * await seqops(sequences).writeTSV('output.tsv', {
   *   columns: ['id', 'seq', 'length', 'gc']
   * });
   * ```
   */
  async writeTSV(path: string, options: Omit<Fx2TabOptions, "delimiter"> = {}): Promise<void> {
    const stream = Bun.file(path).writer();

    try {
      for await (const row of fx2tab(this.source, { ...options, delimiter: "\t" })) {
        await stream.write(row.__raw + "\n");
      }
    } finally {
      stream.end();
    }
  }

  /**
   * Write sequences as CSV (comma-separated values)
   *
   * Terminal operation that writes sequences as comma-separated values.
   * Excel protection is recommended for CSV files.
   *
   * @param path - Output file path
   * @param options - Conversion options (delimiter will be set to comma)
   *
   * @example
   * ```typescript
   * // CSV with Excel protection
   * await seqops(sequences).writeCSV('output.csv', {
   *   excelSafe: true
   * });
   * ```
   */
  async writeCSV(path: string, options: Omit<Fx2TabOptions, "delimiter"> = {}): Promise<void> {
    const stream = Bun.file(path).writer();

    try {
      for await (const row of fx2tab(this.source, { ...options, delimiter: "," })) {
        await stream.write(row.__raw + "\n");
      }
    } finally {
      stream.end();
    }
  }

  /**
   * Write sequences as DSV with custom delimiter
   *
   * Terminal operation for any delimiter-separated format.
   *
   * @param path - Output file path
   * @param delimiter - Custom delimiter character(s)
   * @param options - Conversion options
   *
   * @example
   * ```typescript
   * // Pipe-delimited output
   * await seqops(sequences).writeDSV('output.psv', '|', {
   *   columns: ['id', 'seq', 'length']
   * });
   *
   * // Semicolon for European Excel
   * await seqops(sequences).writeDSV('output.csv', ';', {
   *   excelSafe: true
   * });
   * ```
   */
  async writeDSV(
    path: string,
    delimiter: string,
    options: Omit<Fx2TabOptions, "delimiter"> = {}
  ): Promise<void> {
    const stream = Bun.file(path).writer();

    try {
      for await (const row of fx2tab(this.source, { ...options, delimiter })) {
        await stream.write(row.__raw + "\n");
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
   * Collect k-mer sequences into KmerSet with K preservation
   *
   * When the stream contains KmerSequence objects, returns KmerSet<K>
   * which enforces compile-time k-mer size matching for set operations.
   *
   * @returns Promise<KmerSet<K>> for k-mer sequences
   */
  collectSet<K extends number>(this: SeqOps<KmerSequence<K>>): Promise<KmerSet<K>>;

  /**
   * Collect generic sequences into SequenceSet
   *
   * For non-k-mer sequences, returns generic SequenceSet<T>
   * which allows flexible set operations across sequence types.
   *
   * @returns Promise<SequenceSet<T>> for generic sequences
   */
  collectSet(this: SeqOps<T>): Promise<SequenceSet<T>>;

  /**
   * Collect sequences into a set with automatic type discrimination
   *
   * Terminal operation that materializes the stream into a set for
   * efficient set algebra operations. Automatically returns:
   * - KmerSet<K> for k-mer sequences (K preserved)
   * - SequenceSet<T> for other sequence types
   *
   * @returns Promise resolving to appropriate set type
   *
   * @example
   * ```typescript
   * // K-mer case - returns KmerSet<21>
   * const kmerSet = await seqops(sequences)
   *   .windows(21)
   *   .collectSet();
   * // Type: KmerSet<21> - only accepts union(other: KmerSet<21>)
   *
   * // FASTA case - returns SequenceSet<FastaSequence>
   * const fastaSet = await seqops("genome.fasta")
   *   .collectSet();
   * // Type: SequenceSet<FastaSequence>
   * ```
   */
  async collectSet(): Promise<SequenceSet<T> | KmerSet<any>> {
    const sequences: T[] = [];
    for await (const seq of this.source) {
      sequences.push(seq);
    }

    // Runtime check: Is this a KmerSequence?
    if (sequences.length > 0 && sequences[0] && "kmerSize" in sequences[0]) {
      // Return KmerSet for k-mers (preserves K type)
      return new KmerSet(sequences as any);
    }

    // Return generic SequenceSet for other types
    return new SequenceSet<T>(sequences);
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

  // Method overloads for clean IntelliSense
  locate(pattern: string): AsyncIterable<MotifLocation>;
  locate(pattern: RegExp): AsyncIterable<MotifLocation>;
  locate(pattern: string, mismatches: number): AsyncIterable<MotifLocation>;
  locate(pattern: RegExp, mismatches: number): AsyncIterable<MotifLocation>;
  locate(options: LocateOptions): AsyncIterable<MotifLocation>;

  // Implementation handles all overloads
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
export function seqops<T extends AbstractSequence>(sequences: AsyncIterable<T>): SeqOps<T> {
  return new SeqOps<T>(sequences as AsyncIterable<T>);
}

// Export processors for advanced usage
export { AmpliconProcessor } from "./amplicon";
export { ConcatProcessor } from "./concat";
export { ConvertProcessor, type Fa2FqOptions, fa2fq, fq2fa } from "./convert";
export {
  type ExtractOptions,
  FaiBuilder,
  Faidx,
  type FaidxOptions,
  type FaidxRecord,
} from "./faidx";
export {
  type ColumnId,
  type Fx2TabOptions,
  type Fx2TabRow,
  fx2tab,
  rowsToStrings,
  type Tab2FxOptions,
  TabularOps,
  tab2fx,
} from "./fx2tab";
export { KmerSet, SequenceSet } from "./types";
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
export { WindowsProcessor } from "./windows";
// Export new semantic API types
export type {
  AmpliconOptions,
  AnnotateOptions,
  CleanOptions,
  ConcatOptions,
  ConvertOptions,
  FilterOptions,
  GrepOptions,
  GroupOptions,
  LocateOptions,
  QualityOptions,
  RenameOptions,
  ReplaceOptions,
  RmdupOptions,
  SampleOptions,
  SortOptions,
  SplitOptions,
  TransformOptions,
  TranslateOptions,
  ValidateOptions,
  WindowOptions,
} from "./types";
