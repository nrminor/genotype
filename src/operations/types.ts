/**
 * Shared types and interfaces for SeqOps processors
 *
 * This module defines the common interfaces used by all processor classes
 * in the new semantic API design. Each interface represents options for
 * a single-purpose operation.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import type { AbstractSequence } from "../types";

/**
 * Options for filtering sequences based on various criteria
 *
 * All criteria are applied with AND logic within a single filter call.
 * Chain multiple filter calls for more complex logic.
 */
export interface FilterOptions {
  /** Minimum sequence length */
  minLength?: number;

  /** Maximum sequence length */
  maxLength?: number;

  /** Minimum GC content percentage (0-100) */
  minGC?: number;

  /** Maximum GC content percentage (0-100) */
  maxGC?: number;

  /** Pattern to match against ID or sequence */
  pattern?: RegExp;

  /** Whitelist of sequence IDs to keep */
  ids?: string[];

  /** Blacklist of sequence IDs to exclude */
  excludeIds?: string[];

  /** Filter sequences containing ambiguous bases (N, etc.) */
  hasAmbiguous?: boolean;

  /** Custom filter function for complex logic */
  custom?: <T extends AbstractSequence>(seq: T) => boolean;
}

/**
 * Options for transforming sequence content
 *
 * Transformations modify the sequence string itself.
 */
export interface TransformOptions {
  /** Reverse the sequence */
  reverse?: boolean;

  /** Complement the sequence (A↔T, C↔G) */
  complement?: boolean;

  /** Reverse complement the sequence */
  reverseComplement?: boolean;

  /** Convert DNA to RNA (T → U) */
  toRNA?: boolean;

  /** Convert RNA to DNA (U → T) */
  toDNA?: boolean;

  /** Convert sequence to uppercase */
  upperCase?: boolean;

  /** Convert sequence to lowercase */
  lowerCase?: boolean;

  /** Custom transformation function */
  custom?: (seq: string) => string;
}

/**
 * Options for cleaning and sanitizing sequences
 *
 * Cleaning operations fix common issues in sequence data.
 */
export interface CleanOptions {
  /** Remove gap characters (-, ., *) */
  removeGaps?: boolean;

  /** Custom gap characters to remove */
  gapChars?: string;

  /** Replace ambiguous bases with a standard character */
  replaceAmbiguous?: boolean;

  /** Character to use for replacement (default: 'N') */
  replaceChar?: string;

  /** Remove leading/trailing whitespace */
  trimWhitespace?: boolean;

  /** Filter out empty sequences after cleaning */
  removeEmpty?: boolean;
}

/**
 * Options for FASTQ quality operations
 *
 * These operations only apply to FASTQ sequences with quality scores.
 */
export interface QualityOptions {
  /** Minimum average quality score */
  minScore?: number;

  /** Maximum average quality score */
  maxScore?: number;

  /** Enable quality trimming */
  trim?: boolean;

  /** Score threshold for trimming */
  trimThreshold?: number;

  /** Sliding window size for quality trimming */
  trimWindow?: number;

  /** Trim low quality from 5' end */
  trimFromStart?: boolean;

  /** Trim low quality from 3' end */
  trimFromEnd?: boolean;

  /** Quality score encoding */
  encoding?: "phred33" | "phred64";
}

/**
 * Options for sequence validation
 *
 * Validation can reject, fix, or warn about invalid sequences.
 */
export interface ValidateOptions {
  /** Validation strictness level */
  mode?: "strict" | "normal" | "permissive";

  /** Allow RNA bases (U) in sequences */
  allowRNA?: boolean;

  /** Allow IUPAC ambiguity codes */
  allowAmbiguous?: boolean;

  /** Allow gap characters */
  allowGaps?: boolean;

  /** Action to take on invalid sequences */
  action?: "reject" | "fix" | "warn";

  /** Character to use when fixing invalid bases */
  fixChar?: string;
}

/**
 * Options for annotating sequence metadata
 *
 * Annotation operations modify sequence headers and descriptions.
 */
export interface AnnotateOptions {
  /** Add prefix to sequence IDs */
  prefix?: string;

  /** Add suffix to sequence IDs */
  suffix?: string;

  /** Keep only first word of ID */
  simplifyId?: boolean;

  /** Add sequence length to description */
  addLength?: boolean;

  /** Add GC content to description */
  addGC?: boolean;

  /** Custom annotation function */
  custom?: (seq: AbstractSequence) => Partial<AbstractSequence>;
}

/**
 * Options for sorting sequences - uses superior core implementation
 *
 * Re-exports the comprehensive SortOptions from core/sequence-sorter
 * which provides external sorting, deduplication, and memory safety.
 */
export type { SortBy, SortOptions } from "./core/sequence-sorter";

/**
 * Options for random sampling
 */
export interface SampleOptions {
  /** Number of sequences to sample */
  n?: number;

  /** Fraction of sequences to sample (0-1) */
  fraction?: number;

  /** Random seed for reproducibility */
  seed?: number;

  /** Allow sampling with replacement */
  withReplacement?: boolean;

  /** Sampling strategy */
  strategy?: "random" | "systematic" | "reservoir";
}

/**
 * Options for sequence deduplication
 *
 * Simplified interface for removing duplicate sequences.
 * Leverages sophisticated Bloom filter infrastructure.
 */
export interface RmdupOptions {
  /** Deduplication criterion */
  by: "sequence" | "id" | "both";

  /** Case-sensitive comparison */
  caseSensitive?: boolean;

  /** Use exact deduplication (higher memory, no false positives) */
  exact?: boolean;

  /** Expected number of unique sequences (for optimization) */
  expectedUnique?: number;

  /** Acceptable false positive rate for probabilistic deduplication */
  falsePositiveRate?: number;
}

/**
 * Options for grouping sequences
 */
export interface GroupOptions {
  /** Grouping criterion */
  by: "length" | "gc" | ((seq: AbstractSequence) => string);

  /** Aggregation method for groups */
  aggregate?: "count" | "stats" | "collect";
}

/**
 * Options for motif location finding operations
 *
 * Comprehensive interface for finding patterns within sequences with
 * bioinformatics-specific features like strand searching and fuzzy matching.
 */
export interface LocateOptions {
  /** Pattern to locate (string or regex) */
  pattern: string | RegExp;

  /** Case-insensitive matching */
  ignoreCase?: boolean;

  /** Allow mismatches in sequence patterns (bioinformatics-specific) */
  allowMismatches?: number;

  /** Search both strands for sequence patterns */
  searchBothStrands?: boolean;

  /** Output format for results */
  outputFormat?: "default" | "bed" | "custom";

  /** Include overlap regions when finding multiple matches */
  allowOverlaps?: boolean;

  /** Minimum match length (for fuzzy matching) */
  minLength?: number;

  /** Maximum number of matches to return per sequence */
  maxMatches?: number;
}

// MotifLocation moved to main types module (src/types.ts) for better DX

/**
 * Options for pattern search operations
 *
 * Focused single-responsibility interface for grep-style pattern matching.
 * Follows Unix grep semantics while adding bioinformatics-specific features.
 */
export interface GrepOptions {
  /** Pattern to search for (string or regex) */
  pattern: string | RegExp;

  /** Target field to search in */
  target: "sequence" | "id" | "description";

  /** Case-insensitive matching */
  ignoreCase?: boolean;

  /** Invert match (like grep -v) */
  invert?: boolean;

  /** Match whole words only */
  wholeWord?: boolean;

  /** Allow mismatches in sequence patterns (bioinformatics-specific) */
  allowMismatches?: number;

  /** Search both strands for sequence patterns */
  searchBothStrands?: boolean;
}

/**
 * Options for DNA/RNA to protein translation
 *
 * Comprehensive translation options supporting all NCBI genetic codes,
 * multiple reading frames, and various output formats.
 */
export interface TranslateOptions {
  /** Genetic code table ID (1-33, default: 1 = Standard) */
  geneticCode?: number;

  /** Reading frames to translate (default: [1]) */
  frames?: Array<1 | 2 | 3 | -1 | -2 | -3>;

  /** Translate all 6 reading frames (overrides frames option) */
  allFrames?: boolean;

  /** Convert start codons to methionine (M) even if normally different amino acid */
  convertStartCodons?: boolean;

  /** Remove stop codons from output */
  removeStopCodons?: boolean;

  /** Replace stop codons with specific character (default: '*') */
  stopCodonChar?: string;

  /** Character to use for unknown/invalid codons (default: 'X') */
  unknownCodonChar?: string;

  /** Minimum ORF length when searching for ORFs (amino acids) */
  minOrfLength?: number;

  /** Find and translate only open reading frames (ORFs) */
  orfsOnly?: boolean;

  /** Include frame information in sequence IDs */
  includeFrameInId?: boolean;

  /** Trim sequences at first stop codon */
  trimAtFirstStop?: boolean;

  /** Allow alternative start codons (CTG, TTG, GTG) */
  allowAlternativeStarts?: boolean;
}

/**
 * Options for concatenating sequences from multiple sources
 *
 * Supports file paths and AsyncIterables with comprehensive ID conflict resolution.
 * Maintains memory efficiency through streaming processing without loading entire datasets.
 */
export interface ConcatOptions {
  /** Multiple source paths or AsyncIterables to concatenate */
  sources: Array<string | AsyncIterable<AbstractSequence>>;

  /** Strategy for handling ID conflicts between sources */
  idConflictResolution?: "error" | "rename" | "ignore" | "suffix";

  /** Suffix to append when using 'suffix' conflict resolution (default: source index) */
  renameSuffix?: string;

  /** Validate that all sources have compatible formats (default: true) */
  validateFormats?: boolean;

  /** Preserve original source order in output (default: true) */
  preserveOrder?: boolean;

  /** Skip empty sequences during concatenation (default: false) */
  skipEmpty?: boolean;

  /** Human-readable labels for sources (used in error messages and suffixes) */
  sourceLabels?: string[];

  /** Maximum memory usage in bytes before switching to disk-based processing */
  maxMemory?: number;

  /** Progress callback for tracking concatenation progress */
  onProgress?: (processed: number, total?: number, currentSource?: string) => void;
}

/**
 * Options for splitting sequences into multiple files
 *
 * Supports multiple splitting strategies with memory-efficient processing.
 */
export interface SplitOptions {
  /** Splitting strategy to use */
  mode: "by-size" | "by-parts" | "by-length" | "by-id" | "by-region";

  // Mode-specific options
  /** Number of sequences per output file (for by-size) */
  sequencesPerFile?: number;
  /** Number of output parts to create (for by-parts) */
  numParts?: number;
  /** Number of bases per output file (for by-length) */
  basesPerFile?: number;
  /** Regular expression to extract ID groups (for by-id) */
  idRegex?: string;
  /** Genomic region to extract (for by-region, format: chr:start-end) */
  region?: string;

  // Output control
  /** Directory for output files (default: current directory) */
  outputDir?: string;
  /** Prefix for output filenames (default: 'part') */
  filePrefix?: string;
  /** File extension for outputs (default: '.fasta') */
  fileExtension?: string;
  /** Whether to preserve sequence order within parts */
  keepOrder?: boolean;

  // Memory management
  /** Use streaming mode for large files (default: true) */
  useStreaming?: boolean;
  /** Maximum memory usage in MB (default: 100) */
  maxMemoryMB?: number;
  /** Buffer size for file operations (default: 64KB) */
  bufferSize?: number;
}

/**
 * Base interface for all processor classes
 *
 * Each processor implements a single operation type and
 * maintains the async iterable pattern for streaming.
 */
export interface Processor<TOptions> {
  /**
   * Process sequences with the given options
   *
   * @param source - Input sequences
   * @param options - Processing options
   * @returns Processed sequences
   */
  process(
    source: AsyncIterable<AbstractSequence>,
    options: TOptions
  ): AsyncIterable<AbstractSequence>;
}

// Note: Terminal operations like locate() and stats() don't need special interfaces
// They simply return different result types from their methods
