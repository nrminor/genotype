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

import type { AbstractSequence, PrimerSequence } from "../types";

/**
 * Options for amplicon extraction via primer sequences
 *
 * Supports both validated PrimerSequence types and runtime strings.
 * Runtime strings are validated and branded as PrimerSequence by ArkType schema.
 */
export interface AmpliconOptions {
  /** Forward primer sequence (5' → 3') - supports IUPAC codes */
  forwardPrimer: string | PrimerSequence;

  /** Reverse primer sequence (5' → 3') - supports IUPAC codes */
  reversePrimer?: string | PrimerSequence;

  /** Maximum allowed mismatches when matching primers */
  maxMismatches?: number;

  /** Region specification relative to amplicon (e.g., "-50:50", "1:-1") */
  region?: string;

  /** Extract flanking regions around primers instead of inner amplicon (seqkit -f compatibility) */
  flanking?: boolean;

  /** Force canonical matching (primer OR reverse complement) - auto-detected if not specified */
  canonical?: boolean;

  /** Windowed search for long-read performance optimization */
  searchWindow?: {
    /** Search first N bases for forward primer */
    forward?: number;
    /** Search last N bases for reverse primer */
    reverse?: number;
  };

  /** Only search on positive strand (skip reverse complement) */
  onlyPositiveStrand?: boolean;

  /** Output results in BED6+1 format */
  outputBed?: boolean;

  /** Include mismatch information in sequence descriptions */
  outputMismatches?: boolean;
}

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
 * Type-safe boundary arrays for compile-time validation
 *
 * Ensures boundaries array length matches the number of bins at compile time.
 * For N bins, you need exactly N-1 boundary values.
 *
 * @example
 * ```typescript
 * const boundaries2: BoundariesForBins<2> = [20];              // ✅ 1 boundary for 2 bins
 * const boundaries3: BoundariesForBins<3> = [15, 30];          // ✅ 2 boundaries for 3 bins
 * const boundaries5: BoundariesForBins<5> = [10, 20, 30, 35];  // ✅ 4 boundaries for 5 bins
 *
 * const invalid1: BoundariesForBins<3> = [20];                 // ❌ Compile error: Need 2, got 1
 * const invalid2: BoundariesForBins<2> = [15, 30];             // ❌ Compile error: Need 1, got 2
 * ```
 *
 * @public
 */
export type BoundariesForBins<N extends 2 | 3 | 5> = N extends 2
  ? readonly [number]
  : N extends 3
    ? readonly [number, number]
    : readonly [number, number, number, number];

/**
 * Base quality operations (filtering, trimming)
 *
 * These operations are independent of binning and can be used alone
 * or combined with binning options.
 *
 * @internal
 */
interface QualityBaseOptions {
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

  /** Quality score encoding (Phred+33, Phred+64, or Solexa+64) */
  encoding?: "phred33" | "phred64" | "solexa";
}

/**
 * Quality score binning options
 *
 * Discriminated union ensuring type safety:
 * - Either preset OR boundaries, never both
 * - Boundary array length matches bin count (compile-time checked)
 * - bins is always specified when binning is requested
 *
 * @internal
 */
type QualityBinningOptions<N extends 2 | 3 | 5 = 2 | 3 | 5> =
  | {
      bins: N;
      preset: "illumina" | "pacbio" | "nanopore";
      boundaries?: never;
    }
  | {
      bins: N;
      boundaries: BoundariesForBins<N>;
      preset?: never;
    };

/**
 * Options for FASTQ quality operations
 *
 * Supports filtering, trimming, and binning operations with compile-time type safety.
 * Invalid option combinations are caught at compile-time rather than runtime.
 *
 * @example
 * ```typescript
 * // ✅ Filtering only
 * const opt1: QualityOptions = { minScore: 20, maxScore: 40 };
 *
 * // ✅ Trimming only
 * const opt2: QualityOptions = { trim: true, trimThreshold: 15, trimWindow: 4 };
 *
 * // ✅ Binning with platform preset (90% use case)
 * const opt3: QualityOptions = { bins: 3, preset: 'illumina' };
 *
 * // ✅ Binning with custom boundaries (compile-time length validation!)
 * const opt4: QualityOptions = { bins: 2, boundaries: [20] };
 * const opt5: QualityOptions = { bins: 3, boundaries: [15, 30] };
 * const opt6: QualityOptions = { bins: 5, boundaries: [10, 20, 30, 35] };
 *
 * // ✅ Combined: filtering + trimming + binning
 * const opt7: QualityOptions = {
 *   minScore: 20,
 *   trim: true,
 *   trimThreshold: 15,
 *   bins: 3,
 *   preset: 'illumina'
 * };
 *
 * // ❌ COMPILE ERROR: bins without preset or boundaries
 * const bad1: QualityOptions = { bins: 3 };
 *
 * // ❌ COMPILE ERROR: Both preset AND boundaries
 * const bad2: QualityOptions = { bins: 3, preset: 'illumina', boundaries: [15, 30] };
 *
 * // ❌ COMPILE ERROR: Wrong boundary length
 * const bad3: QualityOptions = { bins: 3, boundaries: [20] };
 *
 * // ❌ COMPILE ERROR: preset without bins
 * const bad4: QualityOptions = { preset: 'illumina' };
 * ```
 *
 * @public
 */
export type QualityOptions = QualityBaseOptions & ({} | QualityBinningOptions);

/**
 * Options for quality score encoding conversion
 *
 * Convert FASTQ quality scores between different encoding schemes.
 * Essential for legacy data processing and tool compatibility.
 */
export interface ConvertOptions {
  /** Target quality encoding to convert to */
  targetEncoding: "phred33" | "phred64" | "solexa";
  /** Source encoding (auto-detect if not specified) */
  sourceEncoding?: "phred33" | "phred64" | "solexa";
  /** Whether to validate encoding compatibility before conversion */
  validateEncoding?: boolean;
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
 * Options for renaming duplicate sequence IDs
 *
 * Ensures unique IDs by appending numeric suffixes to duplicates.
 * Matches seqkit rename functionality with type-safe TypeScript interface.
 */
export interface RenameOptions {
  /**
   * Check duplication by full name instead of just ID
   *
   * When true, considers both ID and description for duplicate detection.
   * When false (default), only the sequence ID is used.
   *
   * @default false
   */
  readonly byName?: boolean;

  /**
   * Separator between original ID and counter
   *
   * Must be a non-empty string. Common choices: "_", ".", "-", "|"
   *
   * @default "_"
   */
  readonly separator?: string;

  /**
   * Starting count number for duplicates
   *
   * Must be a non-negative number (>= 0). The first duplicate gets this number,
   * subsequent duplicates increment from here.
   *
   * @default 2
   */
  readonly startNum?: number;

  /**
   * Also rename the first occurrence
   *
   * When true, ALL occurrences get suffixes including the first.
   * When false (default), first occurrence keeps original ID.
   *
   * @default false
   */
  readonly renameFirst?: boolean;
}

/**
 * Base options for the replace operation (all common fields)
 *
 * This type contains all fields that are independent of the key-value source.
 * Use ReplaceOptions for the public API, which enforces mutual exclusivity
 * of kvMap and kvFile at compile-time.
 *
 * @internal
 */
type BaseReplaceOptions = {
  /**
   * Regular expression pattern to match
   *
   * The pattern is compiled with JavaScript RegExp and applied to either
   * sequence IDs (default) or sequence content (with bySeq option).
   * Must be a valid regex pattern.
   *
   * Corresponds to seqkit's -p/--pattern flag.
   *
   * @example
   * ```typescript
   * // Remove descriptions
   * pattern: '\\s.+'
   *
   * // Match first word
   * pattern: '^(\\w+)'
   *
   * // Remove gaps
   * pattern: '[ \\-]'
   * ```
   */
  readonly pattern: string;

  /**
   * Replacement string with support for capture variables and special symbols
   *
   * Supports standard regex capture variables ($1, $2, etc.) and special
   * placeholders like {nr}, {kv}, {fn}, {fbn}, {fbne}.
   *
   * Corresponds to seqkit's -r/--replacement flag.
   *
   * @example
   * ```typescript
   * // Remove matched content
   * replacement: ''
   *
   * // Use capture variables
   * replacement: 'prefix_$1_suffix'
   *
   * // Add record number
   * replacement: 'seq_{nr}'
   *
   * // Key-value lookup
   * replacement: '$1_{kv}'
   * ```
   */
  readonly replacement: string;

  /**
   * Replace in sequence content instead of sequence name
   *
   * When true, applies pattern to sequence content (FASTA only).
   * When false (default), applies pattern to sequence ID/name.
   *
   * IMPORTANT: Only works with FASTA format. Throws error for FASTQ.
   *
   * Corresponds to seqkit's -s/--by-seq flag.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Remove gaps from sequence
   * { pattern: '[ \\-]', replacement: '', bySeq: true }
   *
   * // Add space after each base
   * { pattern: '(.)', replacement: '$1 ', bySeq: true }
   * ```
   */
  readonly bySeq?: boolean;

  /**
   * Case-insensitive pattern matching
   *
   * When true, pattern matching ignores case.
   * When false (default), matching is case-sensitive.
   *
   * Corresponds to seqkit's -i/--ignore-case flag.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Match 'GENE', 'gene', 'Gene', etc.
   * { pattern: 'gene', replacement: 'GENE', ignoreCase: true }
   * ```
   */
  readonly ignoreCase?: boolean;

  /**
   * Minimum width for record number formatting
   *
   * Used with {nr} placeholder. Pads record numbers with leading zeros.
   * Must be a positive integer (>= 1).
   *
   * Corresponds to seqkit's --nr-width flag.
   *
   * @default 1
   *
   * @example
   * ```typescript
   * // Default: seq_1, seq_2, seq_10
   * { replacement: 'seq_{nr}', nrWidth: 1 }
   *
   * // Width 3: seq_001, seq_002, seq_010
   * { replacement: 'seq_{nr}', nrWidth: 3 }
   *
   * // Width 5: seq_00001, seq_00002, seq_00010
   * { replacement: 'seq_{nr}', nrWidth: 5 }
   * ```
   */
  readonly nrWidth?: number;

  /**
   * Source file name for {fn}, {fbn}, {fbne} placeholders
   *
   * Optional file path used to populate file name placeholders in replacement string.
   * If not provided, placeholders default to 'stdin'.
   *
   * Placeholders:
   * - {fn}: Full file name/path
   * - {fbn}: Base name (last component of path)
   * - {fbne}: Base name without extension
   *
   * @example
   * ```typescript
   * // With file name
   * {
   *   fileName: '/data/sequences.fasta',
   *   replacement: '{fn}__{fbn}__{fbne}'
   * }
   * // Result: '/data/sequences.fasta__sequences.fasta__sequences'
   *
   * // Without file name (defaults to 'stdin')
   * { replacement: '{fn}' }
   * // Result: 'stdin'
   * ```
   */
  readonly fileName?: string;

  // NOTE: kvMap and kvFile are NOT included in BaseReplaceOptions
  // They are added via discriminated union below to enforce mutual exclusivity

  /**
   * Capture variable index for key-value lookup
   *
   * Specifies which capture group ($1, $2, etc.) contains the key
   * for key-value file lookups. Must be >= 1.
   *
   * Corresponds to seqkit's -I/--key-capt-idx flag.
   *
   * @default 1
   *
   * @example
   * ```typescript
   * // Use first capture as key
   * { pattern: '(\\w+)_(\\w+)', keyCaptIdx: 1 }
   *
   * // Use second capture as key
   * { pattern: '(\\w+)_(\\w+)', keyCaptIdx: 2 }
   * ```
   */
  readonly keyCaptIdx?: number;

  /**
   * Keep original key when value not found in key-value file
   *
   * When true, if key lookup fails, the original key is kept.
   * When false (default), missing keys use keyMissRepl or empty string.
   *
   * Corresponds to seqkit's -K/--keep-key flag.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Missing key → keep original
   * { kvFile: 'aliases.txt', keepKey: true }
   * ```
   */
  readonly keepKey?: boolean;

  /**
   * Keep entire record untouched when key not found in key-value file
   *
   * When true, if key lookup fails, the entire sequence is unchanged.
   * When false (default), replacement still happens with empty/custom value.
   *
   * Corresponds to seqkit's -U/--keep-untouch flag.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Missing key → don't modify sequence at all
   * { kvFile: 'aliases.txt', keepUntouch: true }
   * ```
   */
  readonly keepUntouch?: boolean;

  /**
   * Custom replacement string for missing keys in key-value file
   *
   * Used when key is not found in key-value file and keepKey/keepUntouch
   * are false. If undefined, empty string is used.
   *
   * Corresponds to seqkit's -m/--key-miss-repl flag.
   *
   * @default undefined (empty string)
   *
   * @example
   * ```typescript
   * // Missing key → replace with "UNKNOWN"
   * { kvFile: 'aliases.txt', keyMissRepl: 'UNKNOWN' }
   * ```
   */
  readonly keyMissRepl?: string;

  /**
   * Filter patterns to select which records to edit
   *
   * Only sequences matching these patterns will be modified.
   * Similar to seqkit grep functionality.
   *
   * Corresponds to seqkit's --f-pattern flag.
   *
   * @example
   * ```typescript
   * // Only edit sequences with IDs containing "mitochondrial"
   * { filterPattern: ['mitochondrial'] }
   *
   * // Edit sequences matching multiple patterns
   * { filterPattern: ['gene1', 'gene2'] }
   * ```
   */
  readonly filterPattern?: string[];

  /**
   * Path to file containing filter patterns (one per line)
   *
   * Corresponds to seqkit's --f-pattern-file flag.
   *
   * @example
   * ```typescript
   * { filterPatternFile: 'patterns.txt' }
   * ```
   */
  readonly filterPatternFile?: string;

  /**
   * Treat filter patterns as regular expressions
   *
   * When true, filter patterns are treated as regex.
   * When false (default), patterns are literal strings.
   *
   * Corresponds to seqkit's --f-use-regexp flag.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Match IDs starting with "seq"
   * { filterPattern: ['^seq'], filterUseRegexp: true }
   * ```
   */
  readonly filterUseRegexp?: boolean;

  /**
   * Filter by full name (ID + description) instead of just ID
   *
   * When true, matches against full header line.
   * When false (default), matches against ID only.
   *
   * Corresponds to seqkit's --f-by-name flag.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Match descriptions containing "mitochondrial"
   * { filterPattern: ['mitochondrial'], filterByName: true }
   * ```
   */
  readonly filterByName?: boolean;

  /**
   * Filter by sequence content instead of ID
   *
   * When true, matches against sequence content.
   * When false (default), matches against ID.
   *
   * Corresponds to seqkit's --f-by-seq flag.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Edit only sequences containing "ATCG"
   * { filterPattern: ['ATCG'], filterBySeq: true }
   * ```
   */
  readonly filterBySeq?: boolean;

  /**
   * Case-insensitive filter pattern matching
   *
   * When true, filter patterns ignore case.
   * When false (default), matching is case-sensitive.
   *
   * Corresponds to seqkit's --f-ignore-case flag.
   *
   * @default false
   *
   * @example
   * ```typescript
   * { filterPattern: ['gene'], filterIgnoreCase: true }
   * ```
   */
  readonly filterIgnoreCase?: boolean;

  /**
   * Invert filter match - edit sequences that DON'T match filter
   *
   * When true, edits sequences that don't match filter patterns.
   * When false (default), edits sequences that match.
   *
   * Corresponds to seqkit's --f-invert-match flag.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Edit all sequences EXCEPT those with "mitochondrial" in ID
   * { filterPattern: ['mitochondrial'], filterInvertMatch: true }
   * ```
   */
  readonly filterInvertMatch?: boolean;
};

/**
 * Options for the replace operation with compile-time mutual exclusivity
 *
 * Replace performs regex-based pattern matching and substitution on sequence
 * IDs/names or sequence content with support for capture variables, record
 * numbering, key-value lookups, and selective filtering.
 *
 * ## Type-Safe Mutual Exclusivity
 *
 * The kvMap and kvFile options are mutually exclusive. This is enforced at
 * **compile-time** via a discriminated union - TypeScript will show an error
 * if you attempt to specify both options together.
 *
 * Three valid configurations:
 * 1. With kvMap (in-memory Map or Record)
 * 2. With kvFile (path to tab-delimited file)
 * 3. Neither (no key-value substitution)
 *
 * @example
 * ```typescript
 * // ✅ Valid: kvMap only
 * const opts1: ReplaceOptions = {
 *   pattern: '^(\\w+)',
 *   replacement: '{kv}',
 *   kvMap: { gene1: 'GENE1', gene2: 'GENE2' }
 * };
 *
 * // ✅ Valid: kvFile only
 * const opts2: ReplaceOptions = {
 *   pattern: '^(\\w+)',
 *   replacement: '{kv}',
 *   kvFile: 'aliases.txt'
 * };
 *
 * // ✅ Valid: neither
 * const opts3: ReplaceOptions = {
 *   pattern: '\\s.+',
 *   replacement: ''
 * };
 *
 * // ❌ TypeScript Error: Cannot specify both kvMap and kvFile
 * const invalid: ReplaceOptions = {
 *   pattern: '^(\\w+)',
 *   replacement: '{kv}',
 *   kvMap: { gene1: 'GENE1' },
 *   kvFile: 'aliases.txt'  // Error: Type 'string' is not assignable to type 'undefined'
 * };
 * ```
 *
 * @public
 */
export type ReplaceOptions =
  | (BaseReplaceOptions & {
      /**
       * In-memory key-value mappings for {kv} placeholder
       *
       * Provides programmatic construction of key-value mappings without requiring
       * external files. Accepts either a Map or plain object.
       *
       * This is a TypeScript library enhancement over seqkit's file-only approach,
       * enabling dynamic mapping construction from databases, APIs, or computation.
       *
       * When specified, kvFile must not be present (enforced at compile-time).
       *
       * @example
       * ```typescript
       * // Plain object (simple cases)
       * {
       *   pattern: '^(\\w+)',
       *   replacement: '{kv}',
       *   kvMap: {
       *     patient_001: 'ANON_A001',
       *     patient_002: 'ANON_A002'
       *   }
       * }
       *
       * // Map (when building programmatically)
       * const geneAliases = new Map<string, string>();
       * for (const gene of databaseGenes) {
       *   geneAliases.set(gene.ensemblId, gene.symbol);
       * }
       * {
       *   pattern: '^(ENSG\\d+)',
       *   replacement: '{kv}',
       *   kvMap: geneAliases
       * }
       * ```
       */
      readonly kvMap: Map<string, string> | Record<string, string>;
      readonly kvFile?: undefined;
    })
  | (BaseReplaceOptions & {
      /**
       * Path to tab-delimited key-value file for {kv} placeholder
       *
       * File format: each line has "key\tvalue" (tab-separated).
       * Keys are extracted from capture groups (configurable with keyCaptIdx).
       * Values replace the {kv} placeholder.
       *
       * When specified, kvMap must not be present (enforced at compile-time).
       *
       * Corresponds to seqkit's -k/--kv-file flag.
       *
       * @example
       * ```typescript
       * // File: aliases.txt
       * // name1    Sample_A
       * // name2    Sample_B
       *
       * {
       *   pattern: ' (.+)$',
       *   replacement: ' {kv}',
       *   kvFile: 'aliases.txt'
       * }
       * ```
       */
      readonly kvFile: string;
      readonly kvMap?: undefined;
    })
  | BaseReplaceOptions; // Neither kvMap nor kvFile;

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
