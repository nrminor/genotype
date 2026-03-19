/**
 * Core type definitions for genomic data structures
 *
 * These types are designed with real-world bioinformatics data in mind,
 * handling edge cases and malformed data gracefully while maintaining
 * strict type safety where possible.
 */

import { type } from "arktype";
import {
  ChromosomeNamingError,
  GenomicCoordinateError,
  QualityError,
  ResourceLimitError,
  SecurityPathError,
  SequenceError,
  ValidationError,
} from "./errors";
import { GenotypeString } from "./genotype-string";

/**
 * ArkType validators that accept both plain strings and GenotypeString.
 *
 * ArkType's built-in `"string"` and `"string>0"` constraints use
 * `typeof x === "string"` internally, which returns false for GenotypeString
 * instances. These union types teach ArkType to accept either representation
 * without forcing a conversion between them.
 */
export const stringLike = type("string").or(
  type("unknown")
    .narrow((value): value is GenotypeString => value instanceof GenotypeString)
    .describe("a GenotypeString")
);

export const nonEmptyStringLike = type("string > 0").or(
  type("unknown")
    .narrow((value): value is GenotypeString => value instanceof GenotypeString && value.length > 0)
    .describe("a non-empty GenotypeString")
);

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
  readonly sequence: GenotypeString;
  /** Cached sequence length for performance */
  readonly length: number;
  /** Original line number where this sequence started (for error reporting) */
  readonly lineNumber?: number;
}

/**
 * Quality encoding systems used in FASTQ and alignment files
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
 * A sequence record that carries per-base quality scores.
 *
 * This interface is shared by FastqSequence and AlignmentRecord so
 * that quality-aware operations can accept either type without
 * coupling to a specific format. The name uses "bearing" in the
 * sense of "carrying" — a QualityScoreBearing type is one that
 * carries quality score data.
 */
export interface QualityScoreBearing {
  readonly quality: GenotypeString;
  readonly qualityEncoding: QualityEncoding;
}

/**
 * FASTA/FASTQ unified representation
 * Encompasses all information from both text-based formats
 * Extends AbstractSequence to include quality information when present
 */
export interface FASTXSequence extends AbstractSequence {
  /** Quality scores as ASCII string (present if FASTQ) */
  readonly quality?: GenotypeString;
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
 * FASTQ sequence with quality scores and statistics
 * Format: @id description\nsequence\n+\nquality
 *
 * Extends both AbstractSequence (for the operations pipeline) and
 * QualityScoreBearing (for quality-aware operations shared with
 * alignment records). The stats field is carried over from
 * FASTXSequence for backward compatibility.
 */
export interface FastqSequence extends AbstractSequence, QualityScoreBearing {
  readonly format: "fastq";
  /** Computed sequence statistics */
  readonly stats?: {
    readonly length: number;
    readonly gcContent?: number;
    readonly hasAmbiguousBases?: boolean;
    readonly hasGaps?: boolean;
    readonly hasLowQuality?: boolean;
  };
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
export type ParseResult<T, E = Error> =
  | {
      readonly success: true;
      readonly value: T;
    }
  | {
      readonly success: false;
      readonly error: E;
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
 * Alignment record from a BAM or SAM file.
 *
 * Extends AbstractSequence so that alignment records flow through the
 * operations pipeline (grep, filter, unique, translate, etc.) without
 * conversion. Extends QualityScoreBearing so that quality-aware
 * operations (trimming, filtering, binning) work on alignment records
 * the same way they work on FASTQ records.
 *
 * The alignment-specific fields represent a focused subset of the
 * SAM/BAM specification — enough for common sequence-oriented
 * workflows without trying to model the full spec. Fields like mate
 * info (RNEXT, PNEXT, TLEN), optional tags, and BAM binary metadata
 * are excluded from the initial implementation and can be added later.
 *
 * The AbstractSequence fields are populated as:
 * - `id` ← QNAME (the read name)
 * - `sequence` ← decoded sequence bytes
 * - `length` ← sequence length
 * - `description` ← undefined (SAM/BAM records don't have descriptions)
 */
export interface AlignmentRecord extends AbstractSequence, QualityScoreBearing {
  readonly format: "sam" | "bam";
  /** SAM bitwise FLAG field (0-65535) */
  readonly flag: number;
  /** Reference sequence name, or "*" if unmapped */
  readonly referenceSequence: string;
  /** 1-based leftmost mapping position, or 0 if unmapped */
  readonly position: number;
  /** Mapping quality (0-255, where 255 indicates unavailable) */
  readonly mappingQuality: number;
  /** CIGAR string, or "*" if unavailable */
  readonly cigar: string;
}

/**
 * BGZF block information for compressed BAM files
 */
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
      "Use alphanumeric characters, hyphens, dots, pipes, and colons only"
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
    throw new SequenceError(`Invalid sequence characters: ${invalidChars?.join(", ")}`);
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
      throw new QualityError(
        `Invalid quality character '${quality[i]}' (ASCII ${ascii}) for ${encoding}`,
        undefined,
        encoding
      );
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
    throw new SequenceError(
      `Length mismatch: declared ${fasta.length}, actual ${fasta.sequence.length}`,
      fasta.id
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
    throw new QualityError(
      `Sequence/quality length mismatch: seq=${fastq.sequence.length}, qual=${fastq.quality.length}`,
      fastq.id,
      fastq.qualityEncoding
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
        `Invalid thick coordinates: thickEnd (${bed.thickEnd}) must be >= thickStart (${bed.thickStart})`
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
      `Block sizes count (${bed.blockSizes?.length ?? 0}) != block count (${bed.blockCount})`
    );
  }
  if (bed.blockStarts?.length !== bed.blockCount) {
    throw new Error(
      `Block starts count (${bed.blockStarts?.length ?? 0}) != block count (${bed.blockCount})`
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
 * Branded type for validated file paths with compile-time safety
 * Ensures file paths have been validated before use in I/O operations
 */
export type FilePath = string & {
  readonly __brand: "FilePath";
  readonly __validated: true;
  readonly __absolute: boolean;
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
      `File size limit: ${options.maxFileSize} bytes, Max allowed: 10,737,418,240 bytes`
    );
  }

  // Validate decompression options if provided
  if (options.decompressionOptions !== null && options.decompressionOptions !== undefined) {
    try {
      DecompressorOptionsSchema(options.decompressionOptions);
    } catch (error) {
      // Invalid decompression options detected - continuing with defaults
      console.warn(
        `Invalid decompression options: ${error instanceof Error ? error.message : String(error)}. Using defaults.`
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
      `Bytes read mismatch: reported ${chunk.bytesRead}, actual ${chunk.data.length}`
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
      `Max output size: ${options.maxOutputSize} bytes, Max allowed: 107,374,182,400 bytes`
    );
  }

  return options;
});

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
