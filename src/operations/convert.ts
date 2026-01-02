/**
 * ConvertProcessor - Quality score encoding conversion and format conversion
 *
 * This module provides conversion between FASTQ quality encodings and
 * bidirectional FASTA/FASTQ format conversion.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

// ============================================================================
// Imports
// ============================================================================

import { type } from "arktype";
import { ValidationError } from "../errors";
import type { AbstractSequence, FastaSequence, FastqSequence, QualityEncoding } from "../types";
import { calculateQualityStats } from "./core";
import { convertScore, detectEncodingWithConfidence, scoreToChar } from "./core/encoding";
import type { ValidPhred33Char, ValidPhred64Char, ValidSolexaChar } from "./core/quality";
import { charToScore, qualityToScores } from "./core/quality/conversion";
import type { ConvertOptions, Processor } from "./types";

// Helper type to allow both literal validation and dynamic strings
type QualityString<E extends QualityEncoding = "phred33"> = E extends "phred33"
  ? ValidPhred33Char | (string & {})
  : E extends "phred64"
    ? ValidPhred64Char | (string & {})
    : E extends "solexa"
      ? ValidSolexaChar | (string & {})
      : string;

/**
 * Options for FASTQ to FASTA conversion
 */
export interface Fq2FaOptions {
  /**
   * Include quality statistics in the FASTA description
   * @default false
   */
  includeQualityStats?: boolean;
}

/**
 * Options for FASTA to FASTQ conversion
 */
export interface Fa2FqOptions {
  /**
   * Quality string for all sequences (e.g., 'I' for Q=40)
   * @default 'I' (Phred+33, Q=40)
   */
  quality?: QualityString;

  /**
   * Quality score (numeric) for all sequences
   * Alternative to quality string
   */
  qualityScore?: number;

  /**
   * Quality encoding scheme
   * @default 'phred33'
   */
  encoding?: QualityEncoding;
}

/**
 * Result of encoding detection with warnings
 */
interface EncodingDetectionResult {
  encoding: QualityEncoding;
  warning?: string;
}

// ============================================================================
// Validation Schemas
// ============================================================================

/**
 * ArkType schema for ConvertOptions
 */
const ConvertOptionsSchema = type({
  targetEncoding: '"phred33" | "phred64" | "solexa"',
  "sourceEncoding?": '"phred33" | "phred64" | "solexa"',
  "validateEncoding?": "boolean",
});

/**
 * ArkType validation schema for Fq2FaOptions
 */
export const Fq2FaOptionsSchema = type({
  "includeQualityStats?": "boolean",
});

/**
 * ArkType validation schema for Fa2FqOptions
 */
export const Fa2FqOptionsSchema = type({
  "quality?": "string",
  "qualityScore?": "-5 <= number <= 93",
  "encoding?": '"phred33" | "phred64" | "solexa"',
}).narrow((options, ctx) => {
  if (options.quality && options.qualityScore !== undefined) {
    ctx.mustBe("Cannot specify both 'quality' and 'qualityScore' options");
    return false;
  }

  if (options.quality && options.quality.length !== 1) {
    ctx.mustBe("'quality' option must be a single character");
    return false;
  }

  // Validate qualityScore based on encoding
  if (options.qualityScore !== undefined) {
    const encoding = options.encoding || "phred33";
    if (encoding === "solexa") {
      if (options.qualityScore < -5 || options.qualityScore > 62) {
        ctx.mustBe(
          `qualityScore must be between -5 and 62 for Solexa encoding (was ${options.qualityScore})`,
        );
        return false;
      }
    } else {
      if (options.qualityScore < 0 || options.qualityScore > 93) {
        ctx.mustBe(
          `qualityScore must be between 0 and 93 for ${encoding} encoding (was ${options.qualityScore})`,
        );
        return false;
      }
    }
  }

  return true;
});

// ============================================================================
// Classes
// ============================================================================

/**
 * Processor for FASTQ quality score encoding conversion
 */
export class ConvertProcessor implements Processor<ConvertOptions> {
  /**
   * Process sequences with quality encoding conversion
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: ConvertOptions,
  ): AsyncIterable<AbstractSequence> {
    const validationResult = ConvertOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid conversion options: ${validationResult.summary}`);
    }

    for await (const seq of source) {
      yield this.convertSequence(seq, options);
    }
  }

  /**
   * Convert quality encoding for a single sequence
   */
  private convertSequence(seq: AbstractSequence, options: ConvertOptions): AbstractSequence {
    if (!this.isFastqSequence(seq)) {
      return seq;
    }

    const fastqSeq = seq;

    // Early return for empty quality
    if (!fastqSeq.quality || fastqSeq.quality.length === 0) {
      return this.createConvertedSequence(fastqSeq, "", options.targetEncoding);
    }

    // Detect or use provided source encoding
    const detectionResult = this.detectSourceEncoding(fastqSeq, options);

    // Log warning if present
    if (detectionResult.warning) {
      console.warn(detectionResult.warning);
    }

    // Skip conversion if source and target are the same
    if (detectionResult.encoding === options.targetEncoding) {
      return this.createConvertedSequence(fastqSeq, fastqSeq.quality, options.targetEncoding);
    }

    // Perform conversion
    const convertedQuality = convertScore(
      fastqSeq.quality,
      detectionResult.encoding,
      options.targetEncoding,
    );

    return this.createConvertedSequence(fastqSeq, convertedQuality, options.targetEncoding);
  }

  /**
   * Type guard to identify FASTQ sequences
   */
  private isFastqSequence(seq: AbstractSequence): seq is FastqSequence {
    return "quality" in seq && "qualityEncoding" in seq;
  }

  /**
   * Detect source encoding with optional warning generation
   */
  private detectSourceEncoding(
    seq: FastqSequence,
    options: ConvertOptions,
  ): EncodingDetectionResult {
    if (options.sourceEncoding) {
      return { encoding: options.sourceEncoding };
    }

    const detectionResult = detectEncodingWithConfidence(seq.quality);

    if (detectionResult.confidence < 0.8 || detectionResult.ambiguous) {
      return {
        encoding: detectionResult.encoding,
        warning:
          `Uncertain quality encoding detection for sequence '${seq.id}': ` +
          `${detectionResult.reasoning} ` +
          `(confidence: ${(detectionResult.confidence * 100).toFixed(1)}%). ` +
          `Consider specifying sourceEncoding explicitly if conversion results seem incorrect.`,
      };
    }

    return { encoding: detectionResult.encoding };
  }

  /**
   * Create a properly typed converted sequence
   */
  private createConvertedSequence(
    original: FastqSequence,
    quality: string,
    encoding: QualityEncoding,
  ): FastqSequence {
    const converted: FastqSequence = {
      format: "fastq",
      id: original.id,
      sequence: original.sequence,
      ...(original.description && { description: original.description }),
      quality: quality,
      qualityEncoding: encoding,
      length: original.length,
    };
    return converted;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build a FASTA description with optional quality statistics
 */
function buildDescription(seq: FastqSequence, includeStats?: boolean): string {
  if (!includeStats || !seq.quality) {
    return seq.description || "";
  }

  const statsString = formatQualityStats(seq.quality, seq.qualityEncoding || "phred33");
  return seq.description ? `${seq.description} ${statsString}` : statsString;
}

/**
 * Format quality statistics as a readable string
 */
function formatQualityStats(quality: string, encoding: QualityEncoding): string {
  const scores = qualityToScores(quality, encoding);
  const stats = calculateQualityStats(scores);

  return `avg_qual=${stats.mean.toFixed(1)} min_qual=${stats.min} max_qual=${stats.max}`;
}

/**
 * Determine and validate the quality character for conversion
 */
function determineQualityChar(options: Fa2FqOptions, encoding: QualityEncoding): string {
  if (options.qualityScore !== undefined) {
    return scoreToChar(options.qualityScore, encoding);
  }

  const char = options.quality || "I";

  // Validate character is valid for encoding
  try {
    charToScore(char, encoding);
    return char;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ValidationError(
      `Invalid quality character '${char}' for encoding '${encoding}': ${message}`,
    );
  }
}

/**
 * Create a properly typed FASTA sequence
 */
function createFastaSequence(seq: FastqSequence, description: string): FastaSequence {
  const fasta: FastaSequence = {
    format: "fasta",
    id: seq.id,
    sequence: seq.sequence,
    description: description,
    length: seq.length,
  };
  return fasta;
}

/**
 * Create a properly typed FASTQ sequence
 */
function createFastqSequence(
  seq: FastaSequence,
  qualityChar: string,
  encoding: QualityEncoding,
): FastqSequence {
  const fastq: FastqSequence = {
    format: "fastq",
    id: seq.id,
    sequence: seq.sequence,
    ...(seq.description && { description: seq.description }),
    quality: qualityChar.repeat(seq.length),
    qualityEncoding: encoding,
    length: seq.length,
  };
  return fastq;
}

/**
 * Convert FASTQ sequences to FASTA format
 *
 * Strips quality scores from FASTQ sequences, converting them to FASTA format.
 * Optionally preserves quality statistics in the description field.
 *
 * @param source - Input FASTQ sequences
 * @param options - Conversion options
 * @returns AsyncIterable of FASTA sequences
 */
export async function* fq2fa<T extends FastqSequence>(
  source: AsyncIterable<T>,
  options: Fq2FaOptions = {},
): AsyncIterable<FastaSequence> {
  const validationResult = Fq2FaOptionsSchema(options);
  if (validationResult instanceof type.errors) {
    throw new ValidationError(`Invalid fq2fa options: ${validationResult.summary}`);
  }

  for await (const seq of source) {
    const description = buildDescription(seq, validationResult.includeQualityStats);
    yield createFastaSequence(seq, description);
  }
}

/**
 * Convert FASTA sequences to FASTQ format
 *
 * Adds uniform quality scores to FASTA sequences, converting them to FASTQ format.
 *
 * @param source - Input FASTA sequences
 * @param options - Conversion options
 * @returns AsyncIterable of FASTQ sequences
 */
export async function* fa2fq<T extends FastaSequence>(
  source: AsyncIterable<T>,
  options?: Fa2FqOptions,
): AsyncIterable<FastqSequence> {
  const validationResult = Fa2FqOptionsSchema(options || {});
  if (validationResult instanceof type.errors) {
    throw new ValidationError(`Invalid fa2fq options: ${validationResult.summary}`);
  }

  const encoding = validationResult.encoding || "phred33";
  const qualityChar = determineQualityChar(validationResult, encoding);

  for await (const seq of source) {
    yield createFastqSequence(seq, qualityChar, encoding);
  }
}
