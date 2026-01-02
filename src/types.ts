/**
 * Core type definitions for genomic data structures
 *
 * These types are designed with real-world bioinformatics data in mind,
 * handling edge cases and malformed data gracefully while maintaining
 * strict type safety where possible.
 */

import { type } from "arktype";
import {
  BAIIndexError,
  ChromosomeNamingError,
  CigarValidationError,
  GenomicCoordinateError,
  ResourceLimitError,
  SecurityPathError,
  ValidationError,
} from "./errors";

/**
 * Helper functions for validation to reduce nesting
 */

/**
 * Validate CIGAR string consistency with sequence length
 */
export interface AbstractSequence {
  /** Sequence identifier (required, but may be empty string in malformed data) */
  readonly id: string;
  /** Optional description/comment line */
  readonly description?: string;
  /** The actual sequence data */
  readonly sequence: string;
  /** Cached sequence length for performance */
  readonly length: number;
  /** Original line number where this sequence started (for error reporting) */
  readonly lineNumber?: number;
}

/**
 * FASTA/FASTQ unified representation
 * Encompasses all information from both text-based formats
 * Extends AbstractSequence to include quality information when present
 */
export interface FASTXSequence extends AbstractSequence {
  /** Quality scores as ASCII string (present if FASTQ) */
  readonly quality?: string;
  /** Quality encoding system (present if FASTQ) */
  readonly qualityEncoding?: QualityEncoding;
  /** Computed sequence statistics */
  readonly stats?: {
    readonly length: number;
    readonly gcContent?: number;
    readonly hasAmbiguousBases?: boolean;
    readonly hasGaps?: boolean;
    readonly hasLowQuality?: boolean;
  };
}

/**
 * FASTA sequence representation with computed statistics
 * Format: >id description\nsequence
 */
export interface FastaSequence extends FASTXSequence {
  readonly format: "fasta";
  /** GC content ratio (0.0 to 1.0) */
  readonly gcContent?: number;
}

/**
 * Quality encoding systems used in FASTQ files
 */
export const QualityEncoding = {
  /** ASCII 33-126, scores 0-93 (modern standard since Illumina 1.8+) */
  PHRED33: "phred33",
  /** ASCII 64-126, scores 0-62 (legacy Illumina 1.3-1.7) */
  PHRED64: "phred64",
  /** Can have negative scores (-5 to 62), uses p/(1-p) probability */
  SOLEXA: "solexa",
} as const;

/**
 * Type for quality encoding values
 */
export type QualityEncoding = (typeof QualityEncoding)[keyof typeof QualityEncoding];

/**
 * FASTQ sequence with quality scores and statistics
 * Format: @id description\nsequence\n+\nquality
 */
export interface FastqSequence extends FASTXSequence {
  readonly format: "fastq";
  /** Quality scores as ASCII string - required for FASTQ */
  readonly quality: string;
  /** Quality encoding system detected or specified - required for FASTQ */
  readonly qualityEncoding: QualityEncoding;
  /** Parsed numeric quality scores (lazy-loaded) */
  readonly qualityScores?: number[];
  /** Computed quality statistics */
  readonly qualityStats?: {
    readonly mean: number;
    readonly min: number;
    readonly max: number;
    readonly lowQualityBases: number;
  };
}

/**
 * K-mer sequence with compile-time size tracking and parsed coordinate information
 *
 * Extends AbstractSequence with k-mer-specific metadata extracted from seqkit
 * sliding window ID format: {original_id}{suffix}:{start}-{end}
 *
 * The generic parameter K tracks k-mer size at compile-time, enabling:
 * - Type-safe k-mer operations (21-mers vs 31-mers are different types)
 * - Compile-time validation of k-mer compatibility
 * - Prevention of mixing k-mers of different sizes
 * - K-mer set operations with guaranteed size matching
 *
 * @template K - K-mer size as a literal number type (e.g., 21, 31)
 *
 * @example
 * ```typescript
 * // These are DIFFERENT types at compile-time
 * const kmer21: KmerSequence<21> = { ... };
 * const kmer31: KmerSequence<31> = { ... };
 *
 * // Type error: cannot assign 31-mer to 21-mer variable
 * const mixed: KmerSequence<21> = kmer31; // ❌ Compile error
 * ```
 */
export interface KmerSequence<K extends number = number> extends AbstractSequence {
  /**
   * K-mer size (window size) tracked at compile-time
   *
   * This field's type is the literal K, not just `number`.
   * TypeScript will infer K from the actual value.
   */
  readonly kmerSize: K;

  /**
   * Step size used to generate these k-mers
   *
   * Recorded for metadata/reproducibility but NOT tracked at compile-time.
   */
  readonly stepSize: number;

  /**
   * Original sequence ID before windowing
   *
   * Extracted from: {original_id}{suffix}:{start}-{end}
   */
  readonly originalId: string;

  /**
   * Start position in original sequence (0-based or 1-based)
   *
   * Coordinate system depends on WindowOptions.zeroBased setting.
   */
  readonly startPosition: number;

  /**
   * End position in original sequence (0-based or 1-based)
   *
   * For 0-based: exclusive end (standard programming convention)
   * For 1-based: inclusive end (bioinformatics convention)
   */
  readonly endPosition: number;

  /**
   * Coordinate system used for startPosition and endPosition
   */
  readonly coordinateSystem: "0-based" | "1-based";

  /**
   * Suffix used when generating this window
   */
  readonly suffix: string;

  /**
   * Whether this k-mer was generated from circular sequence wrapping
   */
  readonly isWrapped: boolean;

  /**
   * Index of this k-mer within the original sequence's k-mer set
   */
  readonly windowIndex: number;
}

// SAM Format Branded Types for compile-time safety
export type SAMFlag = number & {
  readonly __brand: "SAMFlag";
  readonly __valid: true;
};
export type CIGARString = string & {
  readonly __brand: "CIGAR";
  readonly __validated: true;
};
export type MAPQScore = number & {
  readonly __brand: "MAPQ";
  readonly __range: "0-255";
};

/**
 * SAM optional tag with strict typing
 */
export interface SAMTag {
  readonly tag: string; // Two character tag (e.g., "NM", "MD")
  readonly type: "A" | "i" | "f" | "Z" | "H" | "B";
  readonly value: string | number;
}

/**
 * SAM header record with validated structure
 */
export interface SAMHeader {
  readonly format: "sam-header";
  readonly type: "HD" | "SQ" | "RG" | "PG" | "CO";
  readonly fields: Record<string, string>;
  readonly lineNumber?: number;
}

/**
 * SAM alignment record with validated fields and branded types
 */
export interface SAMAlignment {
  readonly format: "sam" | "bam";
  readonly qname: string; // Query name
  readonly flag: SAMFlag; // Bitwise flag
  readonly rname: string; // Reference name
  readonly pos: number; // 1-based leftmost position
  readonly mapq: MAPQScore; // Mapping quality
  readonly cigar: CIGARString; // CIGAR string
  readonly rnext: string; // Reference name of mate
  readonly pnext: number; // Position of mate
  readonly tlen: number; // Template length
  readonly seq: string; // Segment sequence
  readonly qual: string; // Quality scores (Phred+33)
  readonly tags?: SAMTag[]; // Optional fields
  readonly lineNumber?: number;
}

/**
 * Legacy SAM/BAM alignment record (deprecated - use SAMAlignment)
 * @deprecated Use SAMAlignment instead for better type safety
 */
export interface SamRecord {
  /** Query template name */
  readonly qname: string;
  /** Bitwise flag */
  readonly flag: number;
  /** Reference sequence name */
  readonly rname: string;
  /** 1-based leftmost mapping position */
  readonly pos: number;
  /** Mapping quality */
  readonly mapq: number;
  /** CIGAR string */
  readonly cigar: string;
  /** Reference name of the mate/next read */
  readonly rnext: string;
  /** Position of the mate/next read */
  readonly pnext: number;
  /** Observed template length */
  readonly tlen: number;
  /** Segment sequence */
  readonly seq: string;
  /** ASCII of Phred-scaled base quality+33 */
  readonly qual: string;
  /** Optional fields */
  readonly tags: Record<string, unknown>;
  /** Original line number for error reporting */
  readonly lineNumber?: number;
}

/**
 * Strand orientation
 */
export type Strand = "+" | "-" | ".";

/**
 * Parse genomic region string at compile time for type safety
 *
 * Extracts chromosome, start, and end from region strings like 'chr1:1000-2000'
 * and validates coordinates at the type level for compile-time safety.
 */
export type ParseGenomicRegion<T extends string> =
  T extends `${infer Chr}:${infer Start}-${infer End}`
    ? Start extends `${number}`
      ? End extends `${number}`
        ? {
            readonly chromosome: Chr;
            readonly start: Start extends `${infer S extends number}` ? S : never;
            readonly end: End extends `${infer E extends number}` ? E : never;
            readonly length: End extends `${infer E extends number}`
              ? Start extends `${infer S extends number}`
                ? E extends S
                  ? never // Invalid: end cannot equal start
                  : S extends number
                    ? E extends number
                      ? E extends 0
                        ? never // Invalid: end cannot be 0
                        : S extends 0
                          ? E // Valid: start=0, end>0
                          : never // Simplified for now
                      : never
                    : never
                : never
              : never;
          }
        : never
      : never
    : never;

/**
 * Extract coordinates from genomic region string at compile time
 *
 * Enables compile-time coordinate arithmetic and validation.
 *
 * @example
 * ```typescript
 * type Coords = ExtractCoordinates<'chr1:1000-2000'>;
 * // Result: { chr: 'chr1'; start: 1000; end: 2000; length: 1000 }
 *
 * // Enable compile-time coordinate validation
 * function validateRegion<T extends string>(
 *   region: T
 * ): ExtractCoordinates<T> extends { length: number } ? T : never;
 * ```
 */
export type ExtractCoordinates<T extends string> =
  ParseGenomicRegion<T> extends {
    chromosome: infer Chr;
    start: infer Start;
    end: infer End;
  }
    ? {
        readonly chr: Chr;
        readonly start: Start;
        readonly end: End;
        readonly length: Start extends number
          ? End extends number
            ? End extends 0
              ? never
              : Start extends 0
                ? End
                : never // Simplified arithmetic for template literals
            : never
          : never;
      }
    : never;

/**
 * Validate genomic region format and coordinates at compile time
 *
 * Ensures proper format (chr:start-end) and validates that end > start.
 * Prevents entire categories of genomic coordinate bugs at compile time.
 */
export type ValidGenomicRegion<T extends string> = T extends `${string}:${number}-${number}`
  ? ParseGenomicRegion<T> extends { start: infer S; end: infer E }
    ? S extends number
      ? E extends number
        ? E extends S
          ? never // end cannot equal start
          : S extends 0
            ? T // 0-based coordinates allowed
            : T // 1-based coordinates allowed
        : never
      : never
    : never
  : never;

/**
 * Genomic region type with comprehensive compile-time validation
 *
 * Prevents malformed region strings and invalid coordinate ranges at compile time.
 *
 * @example
 * ```typescript
 * // ✅ Valid regions compile successfully
 * type Valid1 = GenomicRegion<'chr1:1000-2000'>;
 * type Valid2 = GenomicRegion<'scaffold_1:0-500'>;
 * type Valid3 = GenomicRegion<'chrX:100-999'>;
 *
 * // ❌ Invalid regions cause compile errors
 * type Invalid1 = GenomicRegion<'chr1:2000-1000'>; // end < start
 * type Invalid2 = GenomicRegion<'chr1:1000-1000'>; // end = start
 * type Invalid3 = GenomicRegion<'invalid-format'>; // bad format
 * type Invalid4 = GenomicRegion<'chr1:abc-def'>;   // non-numeric
 * ```
 */
export type GenomicRegion<T extends string> = T extends ValidGenomicRegion<T> ? T : never;

/**
 * BED interval representation with computed properties
 * Supports BED3, BED6, BED9, and BED12 formats
 */
export interface BedInterval {
  /** Reference chromosome or contig name */
  readonly chromosome: string;
  /** Start position (0-based, inclusive) */
  readonly start: number;
  /** End position (0-based, exclusive) */
  readonly end: number;
  /** Name of the BED line (BED4+) */
  readonly name?: string;
  /** Score between 0 and 1000 (BED5+) */
  readonly score?: number;
  /** Strand orientation (BED6+) */
  readonly strand?: Strand;
  /** Start of thick/coding region (BED9+) */
  readonly thickStart?: number;
  /** End of thick/coding region (BED9+) */
  readonly thickEnd?: number;
  /** RGB color value (BED9+) */
  readonly itemRgb?: string;
  /** Number of blocks/exons (BED12+) */
  readonly blockCount?: number;
  /** Comma-separated list of block sizes (BED12+) */
  readonly blockSizes?: number[];
  /** Comma-separated list of block starts (BED12+) */
  readonly blockStarts?: number[];
  /** Original line number for error reporting */
  readonly lineNumber?: number;
  /** Computed interval length */
  readonly length?: number;
  /** Computed midpoint coordinate */
  readonly midpoint?: number;
  /** Computed interval statistics */
  readonly stats?: {
    readonly length: number;
    readonly hasThickRegion: boolean;
    readonly hasBlocks: boolean;
    readonly bedType: "BED3" | "BED4" | "BED5" | "BED6" | "BED9" | "BED12";
  };
}

/**
 * Motif location result from pattern search operations
 *
 * Represents a found pattern within a sequence with detailed biological
 * context including strand information and match quality.
 */
export interface MotifLocation {
  /** Sequence ID where match was found */
  readonly sequenceId: string;
  /** Start position (0-based) */
  readonly start: number;
  /** End position (exclusive, 0-based) */
  readonly end: number;
  /** Length of the match */
  readonly length: number;
  /** Strand where match was found */
  readonly strand: "+" | "-";
  /** Matched sequence content */
  readonly matchedSequence: string;
  /** Number of mismatches (for fuzzy matching) */
  readonly mismatches: number;
  /** Score/confidence of match (0-1) */
  readonly score: number;
  /** Original pattern that was searched */
  readonly pattern: string;
  /** Additional context sequence around the match */
  readonly context?: {
    readonly upstream: string;
    readonly downstream: string;
  };
}

/**
 * Generic parsing result that can represent success or failure
 */
export type ParseResult<T> =
  | {
      success: true;
      data: T;
      warnings?: string[];
    }
  | {
      success: false;
      error: string;
      lineNumber?: number;
      context?: string;
    };

/**
 * Parser configuration options
 */
export interface ParserOptions {
  /** Skip validation for performance (dangerous but fast) */
  skipValidation?: boolean;
  /** Maximum line length before throwing error */
  maxLineLength?: number;
  /** Whether to preserve original line numbers */
  trackLineNumbers?: boolean;
  /** AbortController signal for cancelling parsing operations */
  signal?: AbortSignal;
  /** Custom error handler */
  onError?: (error: string, lineNumber?: number) => void;
  /** Custom warning handler */
  onWarning?: (warning: string, lineNumber?: number) => void;
}

/**
 * Compression format detection with focus on genomics standards
 */
export type CompressionFormat = "gzip" | "zstd" | "none";

/**
 * Branded type for compressed streams with format metadata
 */
export type CompressedStream = ReadableStream<Uint8Array> & {
  readonly __brand: "CompressedStream";
  readonly format: CompressionFormat;
  readonly originalSize?: number;
};

/**
 * Compression detection result with confidence scoring
 */
export interface CompressionDetection {
  /** Detected compression format */
  readonly format: CompressionFormat;
  /** Detection confidence level (0-1) */
  readonly confidence: number;
  /** Magic bytes that led to detection */
  readonly magicBytes?: Uint8Array;
  /** File extension used in detection */
  readonly extension?: string;
  /** Whether detection used magic bytes vs extension */
  readonly detectionMethod: "magic-bytes" | "extension" | "hybrid";
}

/**
 * Decompressor configuration options
 */
export interface DecompressorOptions {
  /** Decompression buffer size (default: runtime-optimized) */
  readonly bufferSize?: number;
  /** Safety limit for decompressed output size */
  readonly maxOutputSize?: number;
  /** AbortController signal for cancelling decompression */
  readonly signal?: AbortSignal;
  /** Whether to validate decompressed data integrity */
  readonly validateIntegrity?: boolean;
}

/**
 * BAM alignment record extending SAM with binary-specific metadata
 */
export interface BAMAlignment extends SAMAlignment {
  readonly format: "bam";
  /** BGZF block offset for random access */
  readonly blockStart?: number;
  /** BGZF block end offset */
  readonly blockEnd?: number;
  /** BAI bin for indexing */
  readonly binIndex?: number;
}

/**
 * BGZF block information for compressed BAM files
 */
export interface BGZFBlock {
  /** Offset in file where block starts */
  readonly offset: number;
  /** Compressed size of this block */
  readonly compressedSize: number;
  /** Uncompressed size of this block */
  readonly uncompressedSize: number;
  /** CRC32 checksum for integrity validation */
  readonly crc32?: number;
}

/**
 * BAM header with binary metadata
 */
export interface BAMHeader {
  /** BAM magic bytes - should be "BAM\1" */
  readonly magic: Uint8Array;
  /** Text SAM header content */
  readonly samHeader: string;
  /** Reference sequence information */
  readonly references: Array<{
    readonly name: string;
    readonly length: number;
  }>;
}

/**
 * Binary parsing context for BAM operations
 */
export interface BinaryContext {
  /** DataView for binary data access */
  readonly buffer: DataView;
  /** Current offset in buffer */
  readonly offset: number;
  /** Whether to use little-endian byte order */
  readonly littleEndian: boolean;
}

/**
 * File format detection result
 */
export interface FormatDetection {
  /** Detected file format */
  format: "fasta" | "fastq" | "sam" | "bam" | "bed" | "unknown";
  /** Detected compression format */
  compression: CompressionFormat;
  /** Confidence level (0-1) */
  confidence: number;
  /** Additional metadata detected */
  metadata?: Record<string, unknown>;
}

// Arktype validation schemas for runtime type checking with advanced patterns

/**
 * Advanced sequence validation with IUPAC codes and transformations
 */
export const NucleotideBase = type("'A'|'C'|'G'|'T'|'U'");
export const AmbiguityCode = type("'R'|'Y'|'S'|'W'|'K'|'M'|'B'|'D'|'H'|'V'|'N'");
export const GapCharacter = type("'-'|'.'|'*'");
export const ValidSequenceChar = type(
  "'A'|'C'|'G'|'T'|'U'|'R'|'Y'|'S'|'W'|'K'|'M'|'B'|'D'|'H'|'V'|'N'|'-'|'.'|'*'|'a'|'c'|'g'|'t'|'u'|'r'|'y'|'s'|'w'|'k'|'m'|'b'|'d'|'h'|'v'|'n'",
);

/**
 * Sophisticated sequence ID validation with bioinformatics patterns
 */
export const SequenceIdSchema = type("string>0").pipe((id: string) => {
  // Remove common problematic characters but preserve meaningful ones
  const cleaned = id.replace(/[^\w\-.|:]/g, "_");
  // Clean IDs that might cause issues
  if (id !== cleaned) {
    throw new ValidationError(
      `Sequence ID contains invalid characters: original='${id}' would be sanitized to='${cleaned}'`,
      undefined,
      "Use alphanumeric characters, hyphens, dots, pipes, and colons only",
    );
  }
  return cleaned;
});

/**
 * DNA/RNA sequence schema with sophisticated validation and normalization
 */
export const SequenceSchema = type("string").pipe((seq: string) => {
  // Remove whitespace and validate characters
  const cleaned = seq.replace(/\s+/g, "").toUpperCase();
  const validPattern = /^[ACGTURYSWKMBDHVN\-.*]*$/;

  if (!validPattern.test(cleaned)) {
    const invalidChars = cleaned.match(/[^ACGTURYSWKMBDHVN\-.*]/g);
    throw new Error(`Invalid sequence characters: ${invalidChars?.join(", ")}`);
  }

  return cleaned;
});

/**
 * Quality score validation with encoding-aware constraints
 */
export const QualitySchema = type({
  quality: "string>0",
  encoding: '"phred33"|"phred64"|"solexa"',
}).pipe(({ quality, encoding }) => {
  const minChar = encoding === "phred33" ? 33 : 64;
  const maxChar = encoding === "phred33" ? 126 : 126;

  for (let i = 0; i < quality.length; i++) {
    const ascii = quality.charCodeAt(i);
    if (ascii < minChar || ascii > maxChar) {
      throw new Error(`Invalid quality character '${quality[i]}' (ASCII ${ascii}) for ${encoding}`);
    }
  }

  return quality;
});

/**
 * ArkType branded coordinate types for compile-time and runtime safety
 * Prevents mixing 0-based (BED) and 1-based (GTF) coordinate systems
 * Single source of truth using ArkType's branded type syntax
 */

/**
 * 0-based coordinate validation for BED format
 * ArkType branded type with comprehensive genomic coordinate validation
 */
export const ZeroBasedCoordinate = type("number>=0#ZeroBased").pipe((coord: number) => {
  if (!Number.isInteger(coord)) {
    throw new Error("BED coordinates must be integers");
  }
  if (coord > 2_500_000_000) {
    throw GenomicCoordinateError.forLargeCoordinate(coord, "position");
  }
  return coord;
});
export type ZeroBasedCoordinate = typeof ZeroBasedCoordinate.infer;

/**
 * 1-based coordinate validation for GTF/GFF format
 * ArkType branded type with comprehensive genomic coordinate validation
 */
export const OneBasedCoordinate = type("number>=1#OneBased").pipe((coord: number) => {
  if (!Number.isInteger(coord)) {
    throw new Error("GTF/GFF coordinates must be integers");
  }
  if (coord > 2_500_000_000) {
    throw GenomicCoordinateError.forLargeCoordinate(coord, "position");
  }
  if (coord < 1) {
    throw new Error("1-based coordinates must start at 1, not 0");
  }
  return coord;
});
export type OneBasedCoordinate = typeof OneBasedCoordinate.infer;

/**
 * Coordinate validation with biological constraints
 */
export const GenomicCoordinate = type("number>=0").pipe((coord: number) => {
  if (!Number.isInteger(coord)) {
    throw new Error("Genomic coordinates must be integers");
  }
  if (coord > 2_500_000_000) {
    throw GenomicCoordinateError.forLargeCoordinate(coord, "position");
  }
  return coord;
});

/**
 * Chromosome name validation with common patterns
 */
export const ChromosomeSchema = type("string>0").pipe((chr: string) => {
  // Normalize common chromosome name patterns
  const normalized = chr.replace(/^chr/i, "").toUpperCase();

  // Validate against common patterns
  const validPatterns = [
    /^[1-9][0-9]*$/, // Numeric: 1, 2, 23
    /^[XYM]$/, // Sex chromosomes and mitochondrial
    /^MT$/, // Alternative mitochondrial
    /^GL\d+\.\d+$/, // GenBank accession
    /^KI\d+\.\d+$/, // RefSeq accession
    /^\w+$/, // Generic fallback
  ];

  const isValid = validPatterns.some((pattern) => pattern.test(normalized));
  if (!isValid) {
    throw ChromosomeNamingError.forNonStandardName(chr);
  }

  return chr; // Return original format for compatibility
});

/**
 * Advanced FASTA sequence schema with morphing and validation
 */
export const FastaSequenceSchema = type({
  format: '"fasta"',
  id: SequenceIdSchema,
  "description?": "string | undefined",
  sequence: SequenceSchema,
  length: "number>=0",
  "lineNumber?": "number>0",
}).pipe((fasta) => {
  // Validate sequence length matches actual length
  if (fasta.sequence.length !== fasta.length) {
    throw new Error(
      `Sequence length mismatch: declared ${fasta.length}, actual ${fasta.sequence.length}`,
    );
  }

  // Calculate and cache GC content for performance
  const gcCount = (fasta.sequence.match(/[GC]/g) || []).length;
  const gcContent = fasta.sequence.length > 0 ? gcCount / fasta.sequence.length : 0;

  return {
    ...fasta,
    gcContent,
    stats: {
      length: fasta.sequence.length,
      gcContent,
      hasAmbiguousBases: /[RYSWKMBDHVN]/.test(fasta.sequence),
      hasGaps: /[-.*]/.test(fasta.sequence),
    },
  };
});

/**
 * FASTQ sequence schema with quality validation
 */
export const FastqSequenceSchema = type({
  format: '"fastq"',
  id: SequenceIdSchema,
  "description?": "string | undefined",
  sequence: SequenceSchema,
  quality: "string",
  qualityEncoding: '"phred33"|"phred64"|"solexa"',
  "qualityScores?": "number[] | undefined",
  length: "number>=0",
  "lineNumber?": "number>0",
}).pipe((fastq) => {
  // Validate sequence and quality lengths match
  if (fastq.sequence.length !== fastq.quality.length) {
    throw new Error(
      `Sequence/quality length mismatch: seq=${fastq.sequence.length}, qual=${fastq.quality.length}`,
    );
  }

  // Validate quality string against encoding
  QualitySchema({ quality: fastq.quality, encoding: fastq.qualityEncoding });

  // Calculate quality statistics if scores provided
  let qualityStats = {};
  if (fastq.qualityScores) {
    const scores = fastq.qualityScores;
    qualityStats = {
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
      min: Math.min(...scores),
      max: Math.max(...scores),
      lowQualityBases: scores.filter((s) => s < 20).length,
    };
  }

  return {
    ...fastq,
    qualityStats,
    stats: {
      length: fastq.sequence.length,
      hasLowQuality: fastq.qualityScores ? fastq.qualityScores.some((s) => s < 20) : false,
    },
  };
});

/**
 * BED interval schema with coordinate validation and normalization
 */
export const BedIntervalSchema = type({
  chromosome: ChromosomeSchema,
  start: GenomicCoordinate,
  end: GenomicCoordinate,
  "name?": "string",
  "score?": "number>=0",
  "strand?": '"+"|"-"|"."',
  "thickStart?": GenomicCoordinate,
  "thickEnd?": GenomicCoordinate,
  "itemRgb?": "string",
  "blockCount?": "number>0",
  "blockSizes?": "number[]",
  "blockStarts?": "number[]",
  "lineNumber?": "number>0",
}).pipe(validateAndEnrichBedInterval);

function validateAndEnrichBedInterval(bed: any): any {
  validateBedCoordinates(bed);
  validateBedScore(bed);
  validateBedThickCoordinates(bed);
  validateBedBlockStructure(bed);
  return enrichBedInterval(bed);
}

function validateBedCoordinates(bed: any): void {
  if (bed.end < bed.start) {
    throw new Error(`Invalid coordinates: end (${bed.end}) must be >= start (${bed.start})`);
  }
  // Note: Zero-length intervals (end = start) are valid in BED format for insertion sites
}

function validateBedScore(bed: any): void {
  if (bed.score !== undefined && (bed.score < 0 || bed.score > 1000)) {
    throw new Error(`Score must be between 0 and 1000, got ${bed.score}`);
  }
}

function validateBedThickCoordinates(bed: any): void {
  if (bed.thickStart !== undefined && bed.thickEnd !== undefined) {
    if (bed.thickStart > bed.thickEnd) {
      throw new Error(
        `Invalid thick coordinates: thickEnd (${bed.thickEnd}) must be >= thickStart (${bed.thickStart})`,
      );
    }
    if (bed.thickStart < bed.start || bed.thickEnd > bed.end) {
      throw new Error("Thick coordinates must be within interval bounds");
    }
  }
}

function validateBedBlockStructure(bed: any): void {
  const hasBlocks = bed.blockCount > 0;
  if (!hasBlocks) return;

  // Array length consistency validation (types.ts responsibility)
  if (bed.blockSizes?.length !== bed.blockCount) {
    throw new Error(
      `Block sizes count (${bed.blockSizes?.length ?? 0}) != block count (${bed.blockCount})`,
    );
  }
  if (bed.blockStarts?.length !== bed.blockCount) {
    throw new Error(
      `Block starts count (${bed.blockStarts?.length ?? 0}) != block count (${bed.blockCount})`,
    );
  }

  // Delegate UCSC specification validation to BED module
  // Note: Actual validation implementation moved to formats/bed.ts
  // This maintains separation of concerns - types.ts for schemas, formats/ for validation logic
}

function enrichBedInterval(bed: any): any {
  const length = bed.end - bed.start;
  const midpoint = bed.start + Math.floor(length / 2);

  return {
    ...bed,
    length,
    midpoint,
    stats: {
      length,
      hasThickRegion: bed.thickStart !== undefined && bed.thickEnd !== undefined,
      hasBlocks: bed.blockCount !== undefined && bed.blockCount > 1,
      bedType: determineBedType(bed),
    },
  };
}

function determineBedType(bed: any): string {
  if (bed.blockCount !== null && bed.blockCount !== undefined && bed.blockCount !== 0) {
    return "BED12";
  }
  if (bed.itemRgb !== null && bed.itemRgb !== undefined && bed.itemRgb !== "") {
    return "BED9";
  }
  if (bed.strand !== null && bed.strand !== undefined && bed.strand !== ".") {
    return "BED6";
  }
  if (bed.score !== undefined) {
    return "BED5";
  }
  if (bed.name !== null && bed.name !== undefined && bed.name !== "") {
    return "BED4";
  }
  return "BED3";
}

/**
 * SAM CIGAR operation validation - comprehensive pattern for all operations
 */
export const CIGAROperationSchema = type("string").pipe((cigar: string) => {
  // Handle special case for unmapped reads
  if (cigar === "*") {
    return cigar as CIGARString;
  }

  // Validate CIGAR pattern
  if (!/^(\d+[MIDNSHPX=])*$/.test(cigar)) {
    throw new Error(`Invalid CIGAR pattern: ${cigar}`);
  }

  // Validate individual CIGAR operations
  const operations = cigar.match(/\d+[MIDNSHPX=]/g) || [];
  for (const op of operations) {
    const length = parseInt(op.slice(0, -1), 10);
    const operation = op.slice(-1);

    if (length <= 0) {
      throw new Error(`Invalid CIGAR operation length: ${length}`);
    }

    // Validate operation type
    if (!"MIDNSHPX=".includes(operation)) {
      throw new Error(`Invalid CIGAR operation: ${operation}`);
    }
  }

  return cigar as CIGARString;
});

/**
 * SAM FLAG validation with bitwise operation support
 */
export const SAMFlagSchema = type("number>=0").pipe((flag: number) => {
  // SAM flags are 11-bit (0-2047)
  if (flag > 2047) {
    throw new Error(`SAM flag out of range: ${flag} (max 2047)`);
  }

  if (!Number.isInteger(flag)) {
    throw new Error("SAM flag must be an integer");
  }

  return flag as SAMFlag;
});

/**
 * MAPQ score validation (0-255 range)
 */
export const MAPQScoreSchema = type("number>=0").pipe((mapq: number) => {
  if (mapq > 255) {
    throw new Error(`MAPQ score out of range: ${mapq} (max 255)`);
  }

  if (!Number.isInteger(mapq)) {
    throw new Error("MAPQ score must be an integer");
  }

  return mapq as MAPQScore;
});

/**
 * SAM tag validation schema
 */
export const SAMTagSchema = type({
  tag: "string",
  type: '"A"|"i"|"f"|"Z"|"H"|"B"',
  value: "string | number",
}).pipe((tag) => {
  // Validate tag name (2 characters)
  if (tag.tag.length !== 2) {
    throw new Error(`SAM tag must be 2 characters: ${tag.tag}`);
  }

  // Validate tag characters (alphanumeric)
  if (!/^[A-Za-z0-9]{2}$/.test(tag.tag)) {
    throw new Error(`Invalid SAM tag characters: ${tag.tag}`);
  }

  // Type-specific value validation
  switch (tag.type) {
    case "A":
      if (typeof tag.value !== "string" || tag.value.length !== 1) {
        throw new Error(`SAM tag type A must be single character: ${tag.value}`);
      }
      break;
    case "i":
      if (typeof tag.value !== "number" || !Number.isInteger(tag.value)) {
        throw new Error(`SAM tag type i must be integer: ${tag.value}`);
      }
      break;
    case "f":
      if (typeof tag.value !== "number") {
        throw new Error(`SAM tag type f must be number: ${tag.value}`);
      }
      break;
    case "Z":
    case "H":
      if (typeof tag.value !== "string") {
        throw new Error(`SAM tag type ${tag.type} must be string: ${tag.value}`);
      }
      break;
  }

  return tag;
});

/**
 * SAM header validation schema
 */
export const SAMHeaderSchema = type({
  format: '"sam-header"',
  type: '"HD"|"SQ"|"RG"|"PG"|"CO"',
  fields: "Record<string, string>",
  "lineNumber?": "number>0",
}).pipe((header) => {
  // Type-specific field validation
  switch (header.type) {
    case "HD":
      if (header.fields.VN === undefined || header.fields.VN === null || header.fields.VN === "") {
        throw new Error("HD header must have VN (version) field");
      }
      break;
    case "SQ": {
      if (
        header.fields.SN === undefined ||
        header.fields.SN === null ||
        header.fields.SN === "" ||
        header.fields.LN === undefined ||
        header.fields.LN === null ||
        header.fields.LN === ""
      ) {
        throw new Error("SQ header must have SN (sequence name) and LN (length) fields");
      }
      const length = parseInt(header.fields.LN, 10);
      if (Number.isNaN(length) || length <= 0) {
        throw new Error(`Invalid SQ length: ${header.fields.LN}`);
      }
      break;
    }
    case "RG":
      if (header.fields.ID === undefined || header.fields.ID === null || header.fields.ID === "") {
        throw new Error("RG header must have ID field");
      }
      break;
    case "PG":
      if (header.fields.ID === undefined || header.fields.ID === null || header.fields.ID === "") {
        throw new Error("PG header must have ID field");
      }
      break;
  }

  return header;
});

/**
 * SAM alignment record validation schema with comprehensive validation
 */
export const SAMAlignmentSchema = type({
  format: '"sam"',
  qname: "string>0",
  flag: SAMFlagSchema,
  rname: "string",
  pos: "number>=0",
  mapq: MAPQScoreSchema,
  cigar: CIGAROperationSchema,
  rnext: "string",
  pnext: "number>=0",
  tlen: "number",
  seq: "string",
  qual: "string",
  "tags?": type("unknown[] | undefined").pipe((tags: unknown[] | undefined) => {
    if (!tags) return undefined;
    return tags.map((tag) => SAMTagSchema(tag));
  }),
  "lineNumber?": "number>0",
}).pipe((alignment) => {
  // Validate sequence and quality length match (unless one is '*')
  if (alignment.seq !== "*" && alignment.qual !== "*") {
    if (alignment.seq.length !== alignment.qual.length) {
      throw new Error(
        `Sequence/quality length mismatch: seq=${alignment.seq.length}, qual=${alignment.qual.length}`,
      );
    }
  }

  // Validate position (1-based, 0 means unmapped)
  if (alignment.pos < 0) {
    throw new Error(`Invalid position: ${alignment.pos} (must be >= 0)`);
  }

  // Validate CIGAR consistency with sequence
  validateCigarSequenceConsistency(alignment.cigar, alignment.seq);

  return alignment;
});

/**
 * Legacy SAM record validation schema (deprecated)
 * @deprecated Use SAMAlignmentSchema instead
 */
export const SamFlagSchema = type("number>=0"); // 11-bit flag (will validate range in pipe)
export const SamCigarSchema = type(/^(\d+[MIDNSHPX=])*$/);
export const SamMapQSchema = type("number>=0"); // Will validate <=255 in pipe

/**
 * Genomic range operations using ArkType's morphing capabilities
 */
export const GenomicRange = type({
  chromosome: ChromosomeSchema,
  start: GenomicCoordinate,
  end: GenomicCoordinate,
}).pipe((range) => ({
  ...range,
  length: range.end - range.start,
  contains: (pos: number): boolean => pos >= range.start && pos < range.end,
  overlaps: (other: typeof range): boolean =>
    range.chromosome === other.chromosome && range.start < other.end && range.end > other.start,
  toString: (): string => `${range.chromosome}:${range.start}-${range.end}`,
}));

/**
 * Helper type for extracting the validated type from an Arktype schema
 */
export type InferSchema<T> = T extends { infer: infer U } ? U : never;

// =============================================================================
// FILE I/O TYPES - Cross-platform file operations with compile-time safety
// =============================================================================

/**
 * Branded type for validated file paths with compile-time safety
 * Ensures file paths have been validated before use in I/O operations
 */
export type FilePath = string & {
  readonly __brand: "FilePath";
  readonly __validated: true;
  readonly __absolute: boolean;
};

/**
 * Runtime-specific file handle with type safety
 * Maintains reference to the originating runtime for proper cleanup
 */
export type FileHandle = unknown & {
  readonly __brand: "FileHandle";
  readonly __runtime: "node" | "deno" | "bun";
  readonly __readable: boolean;
  readonly __writable: boolean;
};

/**
 * File reading configuration options with sensible defaults
 * Provides control over streaming behavior and safety limits
 */
export interface FileReaderOptions {
  /** Buffer size for streaming reads (default: runtime-optimized) */
  readonly bufferSize?: number;
  /** Text encoding for file content (default: 'utf8') */
  readonly encoding?: "utf8" | "binary" | "ascii";
  /** Maximum file size to prevent memory exhaustion (default: 100MB) */
  readonly maxFileSize?: number;
  /** Read timeout in milliseconds (default: 30000) */
  readonly timeout?: number;
  /** Allow concurrent reads from same file (default: false) */
  readonly concurrent?: boolean;
  /** AbortController signal for cancelling operations */
  readonly signal?: AbortSignal;
  /** Whether to automatically detect and decompress compressed files (default: true) */
  readonly autoDecompress?: boolean;
  /** Override compression format detection (default: auto-detect) */
  readonly compressionFormat?: CompressionFormat;
  /** Options for decompression when auto-decompression is enabled */
  readonly decompressionOptions?: DecompressorOptions;
}

/**
 * File writing configuration options
 *
 * Provides control over compression behavior for file writing operations.
 * Mirrors FileReaderOptions for symmetric read/write API design.
 *
 * @since v0.1.0
 */
export interface WriteOptions {
  /** Automatically compress based on file extension (default: true) */
  readonly autoCompress?: boolean;
  /** Override compression format detection (default: auto-detect from extension) */
  readonly compressionFormat?: CompressionFormat;
  /** Compression level 1-9 for gzip (default: 6, higher = better compression but slower) */
  readonly compressionLevel?: number;
}

/**
 * Stream chunk data with metadata for processing
 * Provides context about the chunk's position in the stream
 */
export interface StreamChunk {
  /** Raw binary data for this chunk */
  readonly data: Uint8Array;
  /** Whether this is the final chunk in the stream */
  readonly isLast: boolean;
  /** Number of bytes in this chunk */
  readonly bytesRead: number;
  /** Total file size if known */
  readonly totalBytes?: number;
  /** Chunk sequence number for debugging */
  readonly chunkNumber: number;
}

/**
 * File metadata with cross-platform compatibility
 * Provides essential file information for validation and optimization
 */
export interface FileMetadata {
  /** Absolute file path */
  readonly path: FilePath;
  /** File size in bytes */
  readonly size: number;
  /** Last modification time */
  readonly lastModified: Date;
  /** Whether file is readable */
  readonly readable: boolean;
  /** Whether file is writable */
  readonly writable: boolean;
  /** Detected MIME type if available */
  readonly mimeType?: string;
  /** File extension for format detection */
  readonly extension: string;
}

/**
 * Line processing result for streaming text files
 * Handles incomplete lines and buffer management
 */
export interface LineProcessingResult {
  /** Complete lines extracted from buffer */
  readonly lines: string[];
  /** Incomplete line remainder to carry forward */
  readonly remainder: string;
  /** Total lines processed so far */
  readonly totalLines: number;
  /** Whether end of file was reached */
  readonly isComplete: boolean;
}

/**
 * File validation result with detailed feedback
 * Provides context for file accessibility and format detection
 */
export interface FileValidationResult {
  /** Whether file is valid and accessible */
  readonly isValid: boolean;
  /** File metadata if accessible */
  readonly metadata?: FileMetadata;
  /** Validation error if any */
  readonly error?: string;
  /** Detected file format */
  readonly detectedFormat?: "fasta" | "fastq" | "sam" | "bam" | "bed" | "unknown";
  /** Confidence level for format detection (0-1) */
  readonly confidence?: number;
}

/**
 * Stream processing statistics for monitoring
 * Tracks performance and resource usage during I/O operations
 */
export interface StreamStats {
  /** Total bytes processed */
  readonly bytesProcessed: number;
  /** Number of chunks processed */
  readonly chunksProcessed: number;
  /** Processing start time */
  readonly startTime: number;
  /** Current processing rate in bytes/second */
  readonly processingRate: number;
  /** Estimated time remaining in milliseconds */
  readonly estimatedTimeRemaining?: number;
  /** Memory usage in bytes */
  readonly memoryUsage: number;
}

/**
 * File I/O operation context for error handling and debugging
 * Provides comprehensive context for troubleshooting I/O issues
 */
export interface FileIOContext {
  /** File path being operated on */
  readonly filePath: string;
  /** Type of operation being performed */
  readonly operation: "read" | "write" | "stat" | "open" | "close" | "seek";
  /** Runtime environment */
  readonly runtime: "node" | "deno" | "bun";
  /** Operation start timestamp */
  readonly startTime: number;
  /** Current position in file */
  readonly position?: number;
  /** Buffer size being used */
  readonly bufferSize: number;
  /** Additional context data */
  readonly context?: Record<string, unknown>;
}

// Validation schemas for file I/O types using ArkType

/**
 * File path validation schema with security checks
 * Validates and normalizes file paths while preventing directory traversal
 */
export const FilePathSchema = type("string>0").pipe((path: string) => {
  // Tiger Style: Assert preconditions
  if (typeof path !== "string") {
    throw new Error("path must be a string");
  }
  if (path.length === 0) {
    throw new Error("path must not be empty");
  }

  // Check for invalid characters including null bytes
  if (path.includes("\0")) {
    throw new Error("File paths cannot contain null characters");
  }

  // Check for other invalid characters
  const invalidChars = /[<>"|*?]/;
  if (invalidChars.test(path)) {
    throw new Error("File path contains invalid characters");
  }

  // Normalize path separators and resolve relative components
  const normalized = path.replace(/[\\/]+/g, "/").replace(/\/+/g, "/");

  // Security: Prevent directory traversal attacks
  if (normalized.includes("../") || normalized.includes("..\\")) {
    throw new Error("Directory traversal not allowed in file paths");
  }

  // Security: Prevent access to sensitive system paths
  const sensitivePatterns = [
    "/etc/",
    "/proc/",
    "/sys/",
    "/dev/",
    "C:\\Windows\\",
    "C:\\System32\\",
    "C:/Windows/", // Normalized Windows paths
    "C:/System32/", // Normalized Windows paths
    "/System/",
    "/Library/System",
  ];

  if (
    sensitivePatterns.some((pattern) => normalized.toLowerCase().includes(pattern.toLowerCase()))
  ) {
    throw SecurityPathError.forSensitiveDirectory(normalized);
  }

  // Determine if path is absolute
  const _isAbsolute = normalized.startsWith("/") || /^[A-Za-z]:[\\/]/.test(normalized);

  return normalized as FilePath & { readonly __absolute: typeof _isAbsolute };
});

/**
 * File reader options validation schema
 * Ensures all options are within safe and reasonable bounds
 */
export const FileReaderOptionsSchema = type({
  "bufferSize?": "number>=1024", // Minimum 1KB buffer
  "encoding?": '"utf8"|"binary"|"ascii"',
  "maxFileSize?": "number>=0",
  "timeout?": "number>=0",
  "concurrent?": "boolean",
  "signal?": "unknown", // AbortSignal
  "autoDecompress?": "boolean",
  "compressionFormat?": '"gzip"|"zstd"|"none"',
  "decompressionOptions?": "unknown", // DecompressorOptions
}).pipe((options) => {
  // Validate buffer size bounds
  if (
    options.bufferSize !== null &&
    options.bufferSize !== undefined &&
    options.bufferSize !== 0 &&
    options.bufferSize > 1_048_576
  ) {
    throw ResourceLimitError.forBufferSize(options.bufferSize, 1_048_576, "File reader");
  }

  // Validate timeout bounds
  if (
    options.timeout !== null &&
    options.timeout !== undefined &&
    options.timeout !== 0 &&
    options.timeout > 300_000
  ) {
    throw ResourceLimitError.forTimeout(options.timeout, 300_000, "File reader");
  }

  // Validate file size bounds
  if (
    options.maxFileSize !== null &&
    options.maxFileSize !== undefined &&
    options.maxFileSize !== 0 &&
    options.maxFileSize > 10_737_418_240
  ) {
    throw new ResourceLimitError(
      `File size limit too large: ${Math.round(options.maxFileSize / 1_073_741_824)}GB (maximum 10GB)`,
      "file-size",
      options.maxFileSize,
      10_737_418_240,
      "bytes",
      `File size limit: ${options.maxFileSize} bytes, Max allowed: 10,737,418,240 bytes`,
    );
  }

  // Validate decompression options if provided
  if (options.decompressionOptions !== null && options.decompressionOptions !== undefined) {
    try {
      DecompressorOptionsSchema(options.decompressionOptions);
    } catch (error) {
      // Invalid decompression options detected - continuing with defaults
      console.warn(
        `Invalid decompression options: ${error instanceof Error ? error.message : String(error)}. Using defaults.`,
      );
    }
  }

  return options;
});

/**
 * Write options validation schema
 *
 * Validates compression options for file writing operations.
 * Ensures compression level is within valid range (1-9).
 *
 * @since v0.1.0
 */
export const WriteOptionsSchema = type({
  "autoCompress?": "boolean",
  "compressionFormat?": '"gzip"|"zstd"|"none"',
  "compressionLevel?": "number>=1",
}).pipe((options) => {
  // Validate compression level bounds (gzip levels: 1-9)
  if (
    options.compressionLevel !== null &&
    options.compressionLevel !== undefined &&
    options.compressionLevel > 9
  ) {
    throw new ValidationError(`Compression level ${options.compressionLevel} exceeds maximum of 9`);
  }

  return options;
});

/**
 * Stream chunk validation schema
 * Ensures stream chunks have valid structure and data
 */
export const StreamChunkSchema = type({
  data: "unknown", // Uint8Array
  isLast: "boolean",
  bytesRead: "number>=0",
  "totalBytes?": "number>=0",
  chunkNumber: "number>=0",
}).pipe((chunk) => {
  // Validate data is Uint8Array
  if (!(chunk.data instanceof Uint8Array)) {
    throw new Error("Stream chunk data must be Uint8Array");
  }

  // Validate bytes read matches data length
  if (chunk.bytesRead !== chunk.data.length) {
    throw new Error(
      `Bytes read mismatch: reported ${chunk.bytesRead}, actual ${chunk.data.length}`,
    );
  }

  // Validate total bytes consistency
  if (
    chunk.totalBytes !== null &&
    chunk.totalBytes !== undefined &&
    chunk.totalBytes !== 0 &&
    chunk.bytesRead > chunk.totalBytes
  ) {
    throw new Error("Bytes read cannot exceed total bytes");
  }

  return chunk;
});

/**
 * File metadata validation schema
 * Validates file metadata structure and constraints
 */
export const FileMetadataSchema = type({
  path: FilePathSchema,
  size: "number>=0",
  lastModified: "unknown", // Date
  readable: "boolean",
  writable: "boolean",
  "mimeType?": "string",
  extension: "string",
}).pipe((metadata) => {
  // Validate lastModified is a Date
  if (!(metadata.lastModified instanceof Date)) {
    throw new Error("lastModified must be a Date object");
  }

  // Validate extension format
  if (metadata.extension && !metadata.extension.startsWith(".")) {
    // Extension should start with dot but continuing
  }

  return metadata;
});

// =============================================================================
// BAI INDEX TYPES - BAM Index format support with comprehensive validation
// =============================================================================

/**
 * Virtual file offset used in BAI indexes for BGZF-compressed BAM files
 * Combines BGZF block offset (48 bits) and uncompressed offset within block (16 bits)
 */
export type VirtualOffset = bigint & {
  readonly __brand: "VirtualOffset";
  readonly __valid: true;
};

/**
 * BAI bin number using UCSC binning scheme
 * Hierarchical spatial indexing for efficient genomic region queries
 */
export type BAIBinNumber = number & {
  readonly __brand: "BAIBin";
  readonly __valid: true;
};

/**
 * BAI chunk representing a contiguous region in the BAM file
 * Contains virtual file offset range that maps to genomic coordinates
 */
export interface BAIChunk {
  /** Virtual file offset where chunk begins */
  readonly beginOffset: VirtualOffset;
  /** Virtual file offset where chunk ends */
  readonly endOffset: VirtualOffset;
}

/**
 * BAI bin containing chunks for efficient range queries
 * Each bin represents a genomic coordinate range using UCSC binning scheme
 */
export interface BAIBin {
  /** Bin identifier using UCSC binning scheme */
  readonly binId: BAIBinNumber;
  /** Array of chunks within this bin sorted by begin offset */
  readonly chunks: readonly BAIChunk[];
}

/**
 * Linear index for 16KB genomic intervals
 * Provides minimum virtual offset for each 16KB genomic window
 */
export interface BAILinearIndex {
  /** Array of virtual offsets for 16KB intervals (0 = no alignments) */
  readonly intervals: readonly VirtualOffset[];
  /** Size of each interval in bases (typically 16384) */
  readonly intervalSize: number;
}

/**
 * BAI reference sequence index
 * Contains hierarchical bins and linear index for one reference sequence
 */
export interface BAIReference {
  /** Map of bin ID to bin data for hierarchical indexing */
  readonly bins: ReadonlyMap<number, BAIBin>;
  /** Linear index for 16KB genomic intervals */
  readonly linearIndex: BAILinearIndex;
  /** Reference sequence name for validation */
  readonly referenceName?: string;
  /** Reference sequence length for bounds checking */
  readonly referenceLength?: number;
}

/**
 * Complete BAI index structure
 * Root container for all reference sequence indexes
 */
export interface BAIIndex {
  /** Number of reference sequences indexed */
  readonly referenceCount: number;
  /** Array of reference indexes (one per reference sequence) */
  readonly references: readonly BAIReference[];
  /** BAI format version for compatibility checking */
  readonly version?: string;
  /** Index creation timestamp for metadata */
  readonly createdAt?: Date;
  /** Source BAM file path for tracking */
  readonly sourceFile?: string;
}

/**
 * BAI query result containing relevant chunks for a genomic region
 * Optimized for efficient BAM file seeking and reading
 */
export interface BAIQueryResult {
  /** Array of chunks that overlap the query region */
  readonly chunks: readonly BAIChunk[];
  /** Minimum virtual offset for linear index optimization */
  readonly minOffset?: VirtualOffset;
  /** Reference sequence ID that was queried */
  readonly referenceId: number;
  /** Query region that was searched */
  readonly region: {
    readonly start: number;
    readonly end: number;
  };
}

/**
 * BAI statistics for monitoring and optimization
 * Provides insights into index structure and performance
 */
export interface BAIStatistics {
  /** Total number of bins across all references */
  readonly totalBins: number;
  /** Total number of chunks across all references */
  readonly totalChunks: number;
  /** Total number of linear index intervals */
  readonly totalIntervals: number;
  /** Estimated memory usage in bytes */
  readonly estimatedMemoryUsage: number;
  /** Per-reference statistics */
  readonly perReference: readonly {
    readonly referenceId: number;
    readonly binCount: number;
    readonly chunkCount: number;
    readonly intervalCount: number;
  }[];
}

/**
 * BAI writer options for index generation
 * Controls index creation behavior and optimization
 */
export interface BAIWriterOptions {
  /** Custom linear index interval size (default: 16384) */
  readonly intervalSize?: number;
  /** Whether to validate alignment consistency during indexing */
  readonly validateAlignments?: boolean;
  /** Memory optimization: process in chunks (default: false) */
  readonly streamingMode?: boolean;
  /** Custom bin size limits for memory control */
  readonly maxChunksPerBin?: number;
  /** AbortController signal for cancelling index generation */
  readonly signal?: AbortSignal;
}

/**
 * BAI reader options for index loading and querying
 * Controls index reading behavior and caching
 */
export interface BAIReaderOptions {
  /** Whether to cache loaded index in memory (default: true) */
  readonly cacheIndex?: boolean;
  /** Validate index integrity on load (default: true) */
  readonly validateOnLoad?: boolean;
  /** Custom buffer size for reading index file */
  readonly bufferSize?: number;
  /** Timeout for index file operations in milliseconds */
  readonly timeout?: number;
}

/**
 * Virtual offset utilities with BGZF compression support
 * Handles packing/unpacking of block offset and uncompressed offset
 */
export interface VirtualOffsetUtils {
  /** Pack block offset and uncompressed offset into virtual offset */
  readonly pack: (blockOffset: number, uncompressedOffset: number) => VirtualOffset;
  /** Unpack virtual offset into component offsets */
  readonly unpack: (virtualOffset: VirtualOffset) => {
    readonly blockOffset: number;
    readonly uncompressedOffset: number;
  };
  /** Compare two virtual offsets for sorting */
  readonly compare: (a: VirtualOffset, b: VirtualOffset) => number;
}

/**
 * UCSC binning scheme utilities for genomic coordinate indexing
 * Implements hierarchical spatial indexing for efficient range queries
 */
export interface BinningUtils {
  /** Calculate bin number for genomic coordinate range */
  readonly calculateBin: (start: number, end: number) => BAIBinNumber;
  /** Get all bin numbers that overlap with genomic range */
  readonly getOverlappingBins: (start: number, end: number) => readonly BAIBinNumber[];
  /** Get parent bin number for hierarchical queries */
  readonly getParentBin: (binNumber: BAIBinNumber) => BAIBinNumber | null;
  /** Get child bin numbers for hierarchical queries */
  readonly getChildBins: (binNumber: BAIBinNumber) => readonly BAIBinNumber[];
  /** Validate bin number is within valid UCSC scheme range */
  readonly isValidBin: (binNumber: number) => boolean;
}

// =============================================================================
// COMPRESSION TYPES - Validation schemas for compression operations
// =============================================================================

/**
 * Compression format validation schema
 */
export const CompressionFormatSchema = type('"gzip"|"zstd"|"none"');

/**
 * Compression detection validation schema
 */
export const CompressionDetectionSchema = type({
  format: CompressionFormatSchema,
  confidence: "number>=0",
  "magicBytes?": "unknown", // Uint8Array
  "extension?": "string",
  detectionMethod: '"magic-bytes"|"extension"|"hybrid"',
}).pipe((detection) => {
  // Validate magic bytes if present
  if (
    detection.magicBytes !== null &&
    detection.magicBytes !== undefined &&
    !(detection.magicBytes instanceof Uint8Array)
  ) {
    throw new Error("magicBytes must be Uint8Array");
  }

  // Validate confidence bounds
  if (detection.confidence < 0 || detection.confidence > 1) {
    throw new Error(`Confidence must be between 0 and 1, got ${detection.confidence}`);
  }

  // Validate method consistency
  if (
    detection.detectionMethod === "magic-bytes" &&
    (detection.magicBytes === null || detection.magicBytes === undefined)
  ) {
    throw new Error("magic-bytes detection method requires magicBytes");
  }
  if (
    detection.detectionMethod === "extension" &&
    (detection.extension === null ||
      detection.extension === undefined ||
      detection.extension === "")
  ) {
    throw new Error("extension detection method requires extension");
  }

  return detection;
});

/**
 * Decompressor options validation schema
 */
export const DecompressorOptionsSchema = type({
  "bufferSize?": "number>=1024", // Minimum 1KB buffer
  "maxOutputSize?": "number>=0",
  "signal?": "unknown", // AbortSignal
  "validateIntegrity?": "boolean",
}).pipe((options) => {
  // Validate buffer size bounds
  if (
    options.bufferSize !== null &&
    options.bufferSize !== undefined &&
    options.bufferSize !== 0 &&
    options.bufferSize > 10_485_760
  ) {
    throw ResourceLimitError.forBufferSize(options.bufferSize, 10_485_760, "Decompression");
  }

  // Validate max output size bounds
  if (
    options.maxOutputSize !== null &&
    options.maxOutputSize !== undefined &&
    options.maxOutputSize !== 0 &&
    options.maxOutputSize > 107_374_182_400
  ) {
    throw new ResourceLimitError(
      `Maximum output size too large: ${Math.round(options.maxOutputSize / 1_073_741_824)}GB (maximum 100GB)`,
      "memory",
      options.maxOutputSize,
      107_374_182_400,
      "bytes",
      `Max output size: ${options.maxOutputSize} bytes, Max allowed: 107,374,182,400 bytes`,
    );
  }

  return options;
});

// =============================================================================
// BAI INDEX VALIDATION SCHEMAS - Runtime validation for BAI types
// =============================================================================

/**
 * Virtual offset validation schema with BGZF constraints
 * Ensures virtual offsets are within valid 64-bit range for BGZF
 */
export const VirtualOffsetSchema = type("bigint").pipe((offset: bigint) => {
  // Tiger Style: Assert valid virtual offset range
  if (offset < 0n) {
    throw new Error("Virtual offset cannot be negative");
  }

  // BGZF virtual offsets use 48 bits for block offset + 16 bits for uncompressed offset
  if (offset >= 1n << 64n) {
    throw new Error("Virtual offset exceeds 64-bit limit");
  }

  // Validate uncompressed offset doesn't exceed 64KB (BGZF block size limit)
  const uncompressedOffset = Number(offset & 0xffffn);
  if (uncompressedOffset >= 65536) {
    throw new Error(`Uncompressed offset ${uncompressedOffset} exceeds BGZF block size limit`);
  }

  return offset as VirtualOffset;
});

/**
 * BAI bin number validation using UCSC binning scheme constraints
 * Validates bin numbers are within the defined hierarchical levels
 */
export const BAIBinNumberSchema = type("number>=0").pipe((binNumber: number) => {
  // Tiger Style: Assert integer bin number
  if (!Number.isInteger(binNumber)) {
    throw new Error("BAI bin number must be an integer");
  }

  // UCSC binning scheme has maximum bin number of 37449 (level 5)
  if (binNumber > 37449) {
    throw new Error(`BAI bin number ${binNumber} exceeds maximum (37449)`);
  }

  // Validate bin is within defined levels (0-37449)
  const validLevels = [
    { min: 0, max: 0 }, // Level 0: bin 0
    { min: 1, max: 8 }, // Level 1: bins 1-8
    { min: 9, max: 72 }, // Level 2: bins 9-72
    { min: 73, max: 584 }, // Level 3: bins 73-584
    { min: 585, max: 4680 }, // Level 4: bins 585-4680
    { min: 4681, max: 37448 }, // Level 5: bins 4681-37448
  ];

  const isValidLevel = validLevels.some(
    (level) => binNumber >= level.min && binNumber <= level.max,
  );
  if (!isValidLevel) {
    throw new Error(`BAI bin number ${binNumber} is not within valid UCSC binning levels`);
  }

  return binNumber as BAIBinNumber;
});

/**
 * BAI chunk validation schema with virtual offset ordering
 * Ensures chunks have valid virtual offset ranges
 */
export const BAIChunkSchema = type({
  beginOffset: VirtualOffsetSchema,
  endOffset: VirtualOffsetSchema,
}).pipe((chunk) => {
  // Tiger Style: Assert virtual offset ordering
  if (chunk.beginOffset >= chunk.endOffset) {
    throw new Error(
      `Invalid BAI chunk: beginOffset (${chunk.beginOffset}) must be < endOffset (${chunk.endOffset})`,
    );
  }

  // Validate chunk size is reasonable (not empty, not too large)
  const chunkSize = Number(chunk.endOffset - chunk.beginOffset);
  if (chunkSize === 0) {
    throw new Error("BAI chunk cannot be empty (beginOffset == endOffset)");
  }

  if (chunkSize > 1_073_741_824) {
    throw BAIIndexError.forPerformanceImpact(
      "chunk",
      Math.round(chunkSize / 1_048_576),
      1024,
      "MB",
    );
  }

  return chunk;
});

/**
 * BAI bin validation schema with chunk ordering
 * Ensures bins have valid structure and sorted chunks
 */
export const BAIBinSchema = type({
  binId: BAIBinNumberSchema,
  chunks: type("unknown[]").pipe((chunks: unknown[]) => {
    // Validate each chunk
    const validatedChunks = chunks.map((chunk) => {
      const result = BAIChunkSchema(chunk);
      if (Array.isArray(result) && "arkKind" in result && result.arkKind === "errors") {
        throw new Error(`Invalid BAI chunk: ${result.map((e) => e.message).join(", ")}`);
      }
      return result;
    });

    // Tiger Style: Assert chunks are sorted by beginOffset
    validateChunkOrdering(validatedChunks);

    return validatedChunks;
  }),
}).pipe((bin) => {
  // Additional bin-level validation
  if (bin.chunks.length === 0) {
    throw new BAIIndexError(
      `BAI bin ${bin.binId} has no chunks`,
      "bin",
      bin.chunks.length,
      "May indicate sparse genomic coverage - consider regenerating index",
      `Bin ID: ${bin.binId}, Chunks: ${bin.chunks.length}`,
    );
  }

  if (bin.chunks.length > 10000) {
    throw BAIIndexError.forPerformanceImpact("bin", bin.chunks.length, 10000, "chunks");
  }

  return bin;
});

/**
 * BAI linear index validation schema
 * Ensures linear index has valid structure and interval size
 */
export const BAILinearIndexSchema = type({
  intervals: type("unknown[]").pipe((intervals: unknown[]) => {
    return intervals.map((interval) => {
      if (typeof interval === "bigint" || interval === 0n) {
        return VirtualOffsetSchema(interval);
      }
      if (typeof interval === "number" && interval === 0) {
        return 0n as VirtualOffset;
      }
      throw new Error("Linear index intervals must be virtual offsets or 0");
    });
  }),
  intervalSize: "number>0",
}).pipe((linearIndex) => {
  // Tiger Style: Validate standard 16KB interval size
  if (linearIndex.intervalSize !== 16384) {
    throw new BAIIndexError(
      `Non-standard BAI linear index interval size: ${linearIndex.intervalSize}`,
      "linear-index",
      linearIndex.intervalSize,
      "Use standard 16384 byte intervals for better tool compatibility",
      `Interval size: ${linearIndex.intervalSize}, Standard: 16384`,
    );
  }

  // Validate interval ordering (should be non-decreasing)
  for (let i = 1; i < linearIndex.intervals.length; i++) {
    const prev = linearIndex.intervals[i - 1];
    const curr = linearIndex.intervals[i];

    if (prev === undefined || curr === undefined) {
      throw new BAIIndexError(`Invalid linear index structure at position ${i}`, "linear-index", i);
    }

    if (prev !== 0n && curr !== 0n && curr < prev) {
      // Linear index intervals not ordered at this position
      break;
    }
  }

  return linearIndex;
});

/**
 * BAI reference validation schema with comprehensive checks
 * Validates reference index structure and consistency
 */
export const BAIReferenceSchema = type({
  bins: "unknown", // ReadonlyMap<number, BAIBin>
  linearIndex: BAILinearIndexSchema,
  "referenceName?": "string",
  "referenceLength?": "number>=0",
}).pipe((reference) => {
  // Validate bins Map structure
  if (!(reference.bins instanceof Map)) {
    throw new Error("BAI reference bins must be a Map");
  }

  const validatedBins = new Map<number, BAIBin>();

  for (const [binId, bin] of reference.bins) {
    // Validate bin ID matches key
    if (typeof binId !== "number" || !Number.isInteger(binId)) {
      throw new Error(`Invalid bin ID: ${binId}`);
    }

    const result = BAIBinSchema(bin);
    if (Array.isArray(result) && "arkKind" in result && result.arkKind === "errors") {
      throw new Error(`Invalid BAI bin: ${result.map((e) => e.message).join(", ")}`);
    }
    const validatedBin = result;

    if (
      typeof validatedBin === "object" &&
      "binId" in validatedBin &&
      validatedBin.binId !== binId
    ) {
      throw new Error(`Bin ID mismatch: key=${binId}, bin.binId=${validatedBin.binId}`);
    }

    if (typeof validatedBin === "object" && "binId" in validatedBin && "chunks" in validatedBin) {
      validatedBins.set(binId, validatedBin as BAIBin);
    } else {
      throw new Error(`Invalid bin validation result for bin ${binId}`);
    }
  }

  // Tiger Style: Assert reasonable bin count
  if (validatedBins.size === 0) {
    // BAI reference has no bins
  }

  if (validatedBins.size > 50000) {
    // BAI reference has many bins
  }

  return {
    ...reference,
    bins: validatedBins as ReadonlyMap<number, BAIBin>,
  };
});

/**
 * Complete BAI index validation schema
 * Validates entire index structure with cross-reference checks
 */
export const BAIIndexSchema = type({
  referenceCount: "number>=0",
  references: type("unknown[]").pipe((references: unknown[]) => {
    return references.map((ref) => {
      const result = BAIReferenceSchema(ref);
      if (Array.isArray(result) && "arkKind" in result && result.arkKind === "errors") {
        throw new Error(`Invalid BAI reference: ${result.map((e) => e.message).join(", ")}`);
      }
      return result;
    });
  }),
  "version?": "string",
  "createdAt?": "unknown", // Date
  "sourceFile?": "string",
}).pipe((index) => {
  // Tiger Style: Assert reference count consistency
  if (index.references.length !== index.referenceCount) {
    throw new Error(
      `Reference count mismatch: declared=${index.referenceCount}, actual=${index.references.length}`,
    );
  }

  // Validate createdAt is Date if provided
  if (
    index.createdAt !== null &&
    index.createdAt !== undefined &&
    !(index.createdAt instanceof Date)
  ) {
    throw new Error("createdAt must be a Date object");
  }

  // Validate version format if provided
  if (
    index.version !== null &&
    index.version !== undefined &&
    index.version !== "" &&
    !/^\d+\.\d+$/.test(index.version)
  ) {
    throw new BAIIndexError(
      `Non-standard BAI version format: '${index.version}'`,
      "version",
      index.version,
      'Use standard version format (e.g., "1.0") for better compatibility',
      `Version: ${index.version}, Expected format: X.Y`,
    );
  }

  // Calculate and warn about large indexes
  const totalBins = index.references.reduce((sum, ref) => {
    if (
      typeof ref === "object" &&
      ref !== null &&
      "bins" in ref &&
      ref.bins !== null &&
      ref.bins !== undefined &&
      typeof ref.bins.size === "number"
    ) {
      return sum + ref.bins.size;
    }
    return sum;
  }, 0);
  if (totalBins > 100000) {
    throw BAIIndexError.forPerformanceImpact("bin", totalBins, 100000, "total bins");
  }

  return index;
});

/**
 * BAI query result validation schema
 * Ensures query results have valid structure
 */
export const BAIQueryResultSchema = type({
  chunks: type("unknown[]").pipe((chunks: unknown[]) => {
    return chunks.map((chunk) => {
      const result = BAIChunkSchema(chunk);
      if (Array.isArray(result) && "arkKind" in result && result.arkKind === "errors") {
        throw new Error(`Invalid BAI chunk: ${result.map((e) => e.message).join(", ")}`);
      }
      return result;
    });
  }),
  "minOffset?": VirtualOffsetSchema,
  referenceId: "number>=0",
  region: type({
    start: "number>=0",
    end: "number>=0",
  }).pipe((region) => {
    if (region.end <= region.start) {
      throw new Error(
        `Invalid query region: end (${region.end}) must be > start (${region.start})`,
      );
    }
    return region;
  }),
}).pipe((result) => {
  // Tiger Style: Assert chunks are sorted
  for (let i = 1; i < result.chunks.length; i++) {
    const current = result.chunks[i];
    const previous = result.chunks[i - 1];
    if (
      current &&
      previous &&
      typeof current === "object" &&
      typeof previous === "object" &&
      "beginOffset" in current &&
      "beginOffset" in previous
    ) {
      if (current.beginOffset <= previous.beginOffset) {
        throw new Error("Query result chunks must be sorted by beginOffset");
      }
    }
  }

  return result;
});

/**
 * BAI writer options validation schema
 * Validates index generation configuration
 */
export const BAIWriterOptionsSchema = type({
  "intervalSize?": "number>0",
  "validateAlignments?": "boolean",
  "streamingMode?": "boolean",
  "maxChunksPerBin?": "number>0",
  "signal?": "unknown", // AbortSignal
}).pipe((options) => {
  // Validate interval size is power of 2 and reasonable
  if (
    options.intervalSize !== null &&
    options.intervalSize !== undefined &&
    options.intervalSize !== 0
  ) {
    if (options.intervalSize < 1024 || options.intervalSize > 65536) {
      throw new Error(`Invalid interval size: ${options.intervalSize} (should be 1024-65536)`);
    }

    // Check if power of 2 for alignment efficiency
    if ((options.intervalSize & (options.intervalSize - 1)) !== 0) {
      throw new BAIIndexError(
        `Non-power-of-2 BAI interval size: ${options.intervalSize}`,
        "interval-size",
        options.intervalSize,
        "Use power-of-2 sizes (1024, 2048, 4096, etc.) for better memory efficiency",
        `Interval size: ${options.intervalSize}`,
      );
    }
  }

  // Validate max chunks per bin
  if (
    options.maxChunksPerBin !== null &&
    options.maxChunksPerBin !== undefined &&
    options.maxChunksPerBin !== 0 &&
    options.maxChunksPerBin > 100000
  ) {
    throw BAIIndexError.forPerformanceImpact("bin", options.maxChunksPerBin, 100000, "max chunks");
  }

  return options;
});

/**
 * BAI reader options validation schema
 * Validates index reading configuration
 */
export const BAIReaderOptionsSchema = type({
  "cacheIndex?": "boolean",
  "validateOnLoad?": "boolean",
  "bufferSize?": "number>=1024",
  "timeout?": "number>0",
}).pipe((options) => {
  // Validate buffer size bounds
  if (
    options.bufferSize !== null &&
    options.bufferSize !== undefined &&
    options.bufferSize !== 0 &&
    options.bufferSize > 10_485_760
  ) {
    throw ResourceLimitError.forBufferSize(options.bufferSize, 10_485_760, "BAI reader");
  }

  // Validate timeout bounds
  if (
    options.timeout !== null &&
    options.timeout !== undefined &&
    options.timeout !== 0 &&
    options.timeout > 300000
  ) {
    throw ResourceLimitError.forTimeout(options.timeout, 300_000, "BAI operation");
  }

  return options;
});

// =============================================================================
// ALPHABET VALIDATION EXPORTS
// =============================================================================

export type {
  DNASequence,
  IUPACSequence,
  PrimerSequence,
  RNASequence,
} from "./operations/core/alphabet";
// Re-export template literal tags and types for convenient library access
export {
  dna,
  isDNASequence,
  isIUPACSequence,
  isPrimerSequence,
  isRNASequence,
  iupac,
  primer,
  rna,
} from "./operations/core/alphabet";

// =============================================================================
// PRIVATE HELPER FUNCTIONS
// =============================================================================

function validateCigarSequenceConsistency(cigar: string, sequence: string): void {
  if (cigar === "*" || sequence === "*") {
    return;
  }

  const operations = cigar.match(/\d+[MIDNSHPX=]/g) || [];
  let consumesQuery = 0;

  for (const op of operations) {
    const length = parseInt(op.slice(0, -1), 10);
    const operation = op.slice(-1);

    // Operations that consume query sequence
    if ("MIS=X".includes(operation)) {
      consumesQuery += length;
    }
  }

  // Check if CIGAR matches sequence length (allow some flexibility for edge cases)
  if (consumesQuery > 0 && Math.abs(consumesQuery - sequence.length) > sequence.length * 0.1) {
    throw CigarValidationError.withMismatchAnalysis(cigar, sequence.length, consumesQuery);
  }
}

/**
 * Validate BAI chunk ordering by beginOffset
 */
function validateChunkOrdering(chunks: any[]): void {
  for (let i = 1; i < chunks.length; i++) {
    const current = chunks[i];
    const previous = chunks[i - 1];

    if (!isValidChunk(current) || !isValidChunk(previous)) {
      continue;
    }

    if (current.beginOffset <= previous.beginOffset) {
      throw new Error(`BAI chunks must be sorted by beginOffset`);
    }
  }
}

/**
 * Check if object is a valid chunk with beginOffset
 */
function isValidChunk(chunk: any): chunk is { beginOffset: number } {
  return (
    chunk !== null &&
    chunk !== undefined &&
    typeof chunk === "object" &&
    "beginOffset" in chunk &&
    typeof chunk.beginOffset === "number"
  );
}

/**
 * Base sequence interface - foundation for all genomic sequence types
 */
