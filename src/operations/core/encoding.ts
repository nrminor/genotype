/**
 * Quality score encoding detection and conversion for FASTQ sequences
 *
 * Handles the three major quality encoding schemes used in sequencing:
 * - Phred+33 (modern standard, Illumina 1.8+)
 * - Phred+64 (legacy Illumina 1.3-1.7)
 * - Solexa+64 (early Illumina with different probability calculation)
 *
 * @module quality
 * @since v0.1.0
 *
 * @remarks
 * This module exports functions both individually (tree-shakeable) and as a
 * grouped object for convenience. Choose your preferred style:
 *
 * ```typescript
 * // Import individual functions (tree-shakeable)
 * import { detectEncoding, convertScore } from './quality';
 *
 * // Or use the grouped object
 * import { QualityEncodingDetector } from './quality';
 * QualityEncodingDetector.detect(sequences);
 * ```
 */

import { QualityError } from "../../errors";
import type { FastqSequence, QualityEncoding } from "../../types";
import { QualityEncoding as QualityEncodingConstants } from "../../types";

// =============================================================================
// TYPES AND CONSTANTS
// =============================================================================

// QualityEncoding is now imported from types.ts to avoid circular dependency

/**
 * Encoding range information
 */
interface EncodingRange {
  readonly min: number;
  readonly max: number;
  readonly offset: number;
}

/**
 * Detection result with confidence scoring
 *
 * Provides uncertainty feedback when encoding detection is ambiguous,
 * helping users understand when explicit encoding specification recommended.
 */
export interface DetectionResult {
  /** Detected quality encoding */
  encoding: QualityEncoding;
  /** Confidence score (0.0-1.0, higher = more certain) */
  confidence: number;
  /** Whether detection was ambiguous (multiple encodings possible) */
  ambiguous: boolean;
  /** ASCII range found in quality data */
  ranges: { min: number; max: number };
  /** Biological reasoning for detection choice */
  reasoning: string;
}

// =============================================================================
// EXPORTED FUNCTIONS
// =============================================================================

/**
 * Detect quality encoding from single quality string (immediate analysis)
 *
 * Uses scientifically validated ASCII ranges for immediate encoding detection.
 * Optimized for real-time parsing where instant results are needed.
 *
 * @example
 * ```typescript
 * const encoding = detectEncodingImmediate("!!!!####");
 * console.log(`Detected: ${encoding}`); // "phred33"
 * ```
 *
 * @param qualityString - Quality string to analyze
 * @returns Detected quality encoding
 *
 * 🔥 NATIVE CANDIDATE: ASCII min/max finding with SIMD acceleration
 */
export function detectEncodingImmediate(qualityString: string): QualityEncoding {
  if (!qualityString || qualityString.length === 0) {
    return QualityEncodingConstants.PHRED33; // Default to modern standard
  }

  // 🔥 NATIVE: SIMD min/max finding for large quality strings
  let minAscii = 255;
  let maxAscii = 0;
  for (let i = 0; i < qualityString.length; i++) {
    const ascii = qualityString.charCodeAt(i);
    minAscii = Math.min(minAscii, ascii);
    maxAscii = Math.max(maxAscii, ascii);
  }

  // Distribution-aware detection: constrained patterns suggest legacy, mixed suggest modern
  // Check for uniform high patterns first (modern Q40+ data)
  if (minAscii >= 70 && maxAscii <= 93 && maxAscii - minAscii <= 5) {
    return QualityEncodingConstants.PHRED33; // Uniform high quality = modern
  }
  // Check constrained legacy patterns (filtered poor quality data)
  else if (minAscii >= 64 && maxAscii <= 104) {
    return QualityEncodingConstants.PHRED64; // Legacy Illumina (filtered data)
  } else if (minAscii >= 59 && maxAscii <= 104) {
    return QualityEncodingConstants.SOLEXA; // Historical Solexa (constrained range)
  }
  // Mixed ranges suggest modern quality distributions (prevalence-aware)
  else if (minAscii >= 33 && maxAscii <= 93) {
    return QualityEncodingConstants.PHRED33; // Modern standard (95% prevalence)
  } else if (minAscii >= 33 && maxAscii <= 126) {
    // Wide range suggests modern phred33 with exceptional quality scores (Q60+)
    return QualityEncodingConstants.PHRED33;
  } else {
    throw new QualityError(
      `Cannot detect quality encoding: ASCII range ${minAscii}-${maxAscii} outside known standards`,
      "unknown",
      undefined,
      undefined,
      `Expected ranges: Phred+33 (33-93), Phred+64 (64-104), or Solexa (59-104). ` +
        `Invalid characters may indicate corrupted data or non-standard encoding. ` +
        `For custom encodings, specify qualityEncoding explicitly in parser options.`
    );
  }
}

/**
 * Auto-detect quality encoding from FASTQ sequences (statistical analysis)
 * Samples first 10,000 sequences to determine encoding with high confidence
 *
 * @example
 * ```typescript
 * const encoding = await detectEncodingStatistical(sequences);
 * console.log(`Detected encoding: ${encoding}`);
 * ```
 *
 * @param sequences - AsyncIterable of FASTQ sequences to analyze
 * @returns Detected quality encoding
 */
export async function detectEncodingStatistical(
  sequences: AsyncIterable<FastqSequence>
): Promise<QualityEncoding> {
  // Tiger Style: Assert input
  if (sequences === null || sequences === undefined) {
    throw new Error("Sequences input is required for encoding detection");
  }

  let minQual = 127;
  let maxQual = 0;
  let count = 0;
  const maxSamples = 10000;

  // 🔥 NATIVE OPTIMIZATION: Vectorized min/max finding
  for await (const seq of sequences) {
    if (!seq.quality) {
      continue;
    }

    for (let i = 0; i < seq.quality.length; i++) {
      const qual = seq.quality.charCodeAt(i);
      minQual = Math.min(minQual, qual);
      maxQual = Math.max(maxQual, qual);
    }

    if (++count >= maxSamples) break;
  }

  // Handle empty input
  if (count === 0 || minQual === 127) {
    return QualityEncodingConstants.PHRED33; // Default to modern standard
  }

  // Distribution-aware detection with statistical confidence (NAR specification)
  // 🔥 NATIVE CANDIDATE: Range checking could be SIMD-accelerated
  // Check for uniform high patterns first (modern Q40+ data)
  if (minQual >= 70 && maxQual <= 93 && maxQual - minQual <= 5) {
    return QualityEncodingConstants.PHRED33; // Uniform high quality = modern
  }
  // Check constrained legacy patterns (filtered poor quality data)
  else if (minQual >= 64 && maxQual <= 104) {
    return QualityEncodingConstants.PHRED64; // Legacy Illumina (filtered data)
  } else if (minQual >= 59 && maxQual <= 104) {
    return QualityEncodingConstants.SOLEXA; // Historical Solexa
  }
  // Mixed ranges suggest modern quality distributions (prevalence-aware)
  else if (minQual >= 33 && maxQual <= 93) {
    return QualityEncodingConstants.PHRED33; // Modern standard (95% prevalence)
  } else if (minQual >= 33 && maxQual <= 126) {
    // Wide range suggests modern phred33 with exceptional quality scores (Q60+)
    return QualityEncodingConstants.PHRED33;
  } else {
    throw new Error(
      `Cannot detect quality encoding: ASCII range ${minQual}-${maxQual} outside known standards. ` +
        `Expected ranges: Phred+33 (33-93), Phred+64 (64-104), or Solexa (59-104).`
    );
  }
}

/**
 * Detect quality encoding with confidence scoring and uncertainty reporting
 *
 * Provides detailed feedback about detection certainty, biological reasoning,
 * and recommendations for ambiguous cases.
 *
 * @example
 * ```typescript
 * const result = detectEncodingWithConfidence("@@@@IIII");
 * if (result.confidence < 0.8) {
 *   console.warn(`Uncertain detection: ${result.reasoning}`);
 * }
 * ```
 *
 * @param qualityString - Quality string to analyze
 * @returns Detection result with confidence metrics
 */
export function detectEncodingWithConfidence(qualityString: string): DetectionResult {
  if (!qualityString || qualityString.length === 0) {
    return {
      encoding: QualityEncodingConstants.PHRED33,
      confidence: 0.5, // Low confidence for empty data
      ambiguous: true,
      ranges: { min: 0, max: 0 },
      reasoning: "Empty quality string - defaulting to modern Phred+33 standard",
    };
  }

  // Calculate ASCII range
  let minAscii = 255;
  let maxAscii = 0;
  for (let i = 0; i < qualityString.length; i++) {
    const ascii = qualityString.charCodeAt(i);
    minAscii = Math.min(minAscii, ascii);
    maxAscii = Math.max(maxAscii, ascii);
  }

  const ranges = { min: minAscii, max: maxAscii };
  const range = maxAscii - minAscii;

  // Distribution-aware detection with confidence scoring
  // Check for uniform high patterns first (modern Q40+ data)
  if (minAscii >= 70 && maxAscii <= 93 && range <= 5) {
    return {
      encoding: QualityEncodingConstants.PHRED33,
      confidence: 0.95, // High confidence - uniform high quality pattern
      ambiguous: false,
      ranges,
      reasoning: "Uniform high-ASCII pattern characteristic of modern high-quality sequencing",
    };
  }
  // Check constrained legacy patterns (filtered poor quality data)
  else if (minAscii >= 64 && maxAscii <= 104) {
    const confidence = minAscii >= 70 ? 0.85 : 0.9; // Lower confidence for overlap zone
    return {
      encoding: QualityEncodingConstants.PHRED64,
      confidence,
      ambiguous: minAscii < 70, // Ambiguous if overlaps with phred33
      ranges,
      reasoning:
        minAscii < 70
          ? "High-ASCII-only pattern suggests legacy data, but overlaps with modern range"
          : "High-ASCII constrained range characteristic of legacy Illumina 1.3-1.7",
    };
  } else if (minAscii >= 59 && maxAscii <= 104) {
    return {
      encoding: QualityEncodingConstants.SOLEXA,
      confidence: 0.75, // Lower confidence - rare encoding
      ambiguous: true,
      ranges,
      reasoning: "Historical Solexa range detected - very rare in modern data, consider verifying",
    };
  }
  // Mixed ranges suggest modern quality distributions (prevalence-aware)
  else if (minAscii >= 33 && maxAscii <= 93) {
    const confidence = range > 40 ? 0.9 : 0.85; // Higher confidence for broader ranges
    return {
      encoding: QualityEncodingConstants.PHRED33,
      confidence,
      ambiguous: false,
      ranges,
      reasoning: "Mixed ASCII range characteristic of modern quality distribution",
    };
  } else if (minAscii >= 33 && maxAscii <= 126) {
    return {
      encoding: QualityEncodingConstants.PHRED33,
      confidence: 0.8, // Medium confidence - very wide range
      ambiguous: true,
      ranges,
      reasoning: "Very wide ASCII range - likely modern Phred+33 with exceptional quality scores",
    };
  } else {
    throw new QualityError(
      `Cannot detect quality encoding: ASCII range ${minAscii}-${maxAscii} outside known standards`,
      "unknown",
      undefined,
      undefined,
      `Expected ranges: Phred+33 (33-93), Phred+64 (64-104), or Solexa (59-104). ` +
        `Invalid characters may indicate corrupted data or non-standard encoding. ` +
        `For custom encodings, specify qualityEncoding explicitly in parser options.`
    );
  }
}

/**
 * Primary quality encoding detection (re-export for intuitive API)
 * Uses immediate detection as the primary use case for most workflows
 */
export const detectEncoding = detectEncodingImmediate;

/**
 * Convert Solexa quality score to Phred quality score
 *
 * Solexa uses different probability calculation: Q_solexa = -10 * log10(Pe / (1-Pe))
 * Must convert through error probability to get correct Phred score
 *
 * @param solexaScore - Solexa quality score (-5 to 62)
 * @returns Equivalent Phred quality score
 */
/**
 * Convert quality scores between encodings
 *
 * @example
 * ```typescript
 * const converted = convertScore(
 *   quality,
 *   "phred64",
 *   "phred33"
 * );
 * ```
 *
 * @param quality - Quality string to convert
 * @param from - Source encoding
 * @param to - Target encoding
 * @returns Converted quality string
 * @throws Error if Solexa conversion is attempted
 *
 * 🔥 NATIVE OPTIMIZATION: Bulk character code conversion
 */
export function convertScore(quality: string, from: QualityEncoding, to: QualityEncoding): string {
  // Tiger Style: Assert inputs
  if (!quality || typeof quality !== "string") {
    throw new Error("Quality string is required for conversion");
  }
  if (from === undefined || from === null || to === undefined || to === null) {
    throw new Error("Both from and to encodings are required");
  }

  if (from === to) return quality;

  // 🔥 NATIVE: SIMD-accelerated character arithmetic
  const fromOffset = from === QualityEncodingConstants.PHRED33 ? 33 : 64;
  const toOffset = to === QualityEncodingConstants.PHRED33 ? 33 : 64;
  const diff = toOffset - fromOffset;

  // Handle Solexa's different probability calculation
  if (from === QualityEncodingConstants.SOLEXA || to === QualityEncodingConstants.SOLEXA) {
    return convertSolexaQuality(quality, from, to);
  }

  // Simple offset conversion for Phred encodings
  const result = new Array(quality.length);
  for (let i = 0; i < quality.length; i++) {
    const newCharCode = quality.charCodeAt(i) + diff;
    // Validate resulting character is in valid range
    if (newCharCode < 33 || newCharCode > 126) {
      throw new Error(`Quality conversion resulted in invalid character code: ${newCharCode}`);
    }
    result[i] = String.fromCharCode(newCharCode);
  }

  return result.join("");
}

/**
 * Calculate average quality score
 *
 * @example
 * ```typescript
 * const avg = averageQuality(
 *   quality,
 *   "phred33"
 * );
 * console.log(`Average quality: ${avg.toFixed(2)}`);
 * ```
 *
 * @param quality - Quality string to analyze
 * @param encoding - Quality encoding (default: PHRED33)
 * @returns Average quality score as number
 *
 * 🔥 NATIVE OPTIMIZATION: Vectorized sum calculation
 */
export function averageQuality(
  quality: string,
  encoding: QualityEncoding = QualityEncodingConstants.PHRED33
): number {
  // Tiger Style: Assert inputs
  if (!quality || typeof quality !== "string") {
    throw new Error("Quality string is required for average calculation");
  }

  if (quality.length === 0) {
    return 0;
  }

  const offset = encoding === QualityEncodingConstants.PHRED33 ? 33 : 64;
  let sum = 0;

  // 🔥 NATIVE: SIMD horizontal sum
  for (let i = 0; i < quality.length; i++) {
    sum += quality.charCodeAt(i) - offset;
  }

  return sum / quality.length;
}

/**
 * Convert numeric quality score to ASCII character
 *
 * @param score - Numeric quality score
 * @param encoding - Target encoding
 * @returns ASCII character representing the score
 */
export function scoreToChar(score: number, encoding: QualityEncoding): string {
  // Tiger Style: Assert inputs
  if (typeof score !== "number" || score < 0) {
    throw new Error("Score must be a non-negative number");
  }

  const range = getEncodingRange(encoding);
  const charCode = score + range.offset;

  if (charCode < range.min || charCode > range.max) {
    throw new Error(`Score ${score} out of range for ${encoding} encoding`);
  }

  return String.fromCharCode(charCode);
}

/**
 * Convert ASCII character to numeric quality score
 *
 * @param char - ASCII character from quality string
 * @param encoding - Source encoding
 * @returns Numeric quality score
 */
export function charToScore(char: string, encoding: QualityEncoding): number {
  // Tiger Style: Assert inputs
  if (!char || char.length !== 1) {
    throw new Error("Single character required for score conversion");
  }

  const range = getEncodingRange(encoding);
  const charCode = char.charCodeAt(0);

  if (charCode < range.min || charCode > range.max) {
    throw new Error(`Character '${char}' (ASCII ${charCode}) invalid for ${encoding}`);
  }

  return charCode - range.offset;
}

/**
 * Validate quality string for given encoding
 *
 * @param quality - Quality string to validate
 * @param encoding - Expected encoding
 * @returns true if valid, false otherwise
 */
export function validateQualityString(quality: string, encoding: QualityEncoding): boolean {
  if (!quality || typeof quality !== "string") {
    return false;
  }

  const range = getEncodingRange(encoding);

  for (let i = 0; i < quality.length; i++) {
    const charCode = quality.charCodeAt(i);
    if (charCode < range.min || charCode > range.max) {
      return false;
    }
  }

  return true;
}

/**
 * Get valid ASCII range and offset for encoding
 *
 * @param encoding - Quality encoding
 * @returns Range information with min, max, and offset
 */
export function getEncodingRange(encoding: QualityEncoding): EncodingRange {
  switch (encoding) {
    case QualityEncodingConstants.PHRED33:
      return { min: 33, max: 126, offset: 33 };
    case QualityEncodingConstants.PHRED64:
      return { min: 64, max: 126, offset: 64 };
    case QualityEncodingConstants.SOLEXA:
      // Solexa can have quality scores from -5 to 62
      // ASCII range: 59-126 (offset 64, but -5 maps to ASCII 59)
      return { min: 59, max: 126, offset: 64 };
    default:
      throw new Error(`Unknown encoding: ${encoding}`);
  }
}

/**
 * Convert quality score to error probability
 * Q = -10 * log10(P_error)
 * P_error = 10^(-Q/10)
 *
 * @param score - Quality score
 * @returns Error probability (0-1)
 */
export function scoreToErrorProbability(score: number): number {
  if (typeof score !== "number" || score < 0) {
    throw new Error("Score must be a non-negative number");
  }
  return 10 ** (-score / 10);
}

/**
 * Convert error probability to quality score
 * Q = -10 * log10(P_error)
 *
 * @param probability - Error probability (0-1)
 * @returns Quality score
 */
export function errorProbabilityToScore(probability: number): number {
  if (typeof probability !== "number" || probability <= 0 || probability > 1) {
    throw new Error("Probability must be between 0 and 1");
  }
  return -10 * Math.log10(probability);
}

// =============================================================================
// GROUPED EXPORT
// =============================================================================

/**
 * Quality score encoding detection and conversion utilities grouped for convenience.
 *
 * All functions are also available as individual exports for tree-shaking.
 *
 * @example
 * ```typescript
 * // Use via the grouped object
 * import { QualityEncodingDetector } from './quality';
 * const encoding = await QualityEncodingDetector.detect(sequences);
 *
 * // Or import individual functions
 * import { detectEncoding, convertScore } from './quality';
 * const encoding = await detectEncoding(sequences);
 * ```
 */
export const QualityEncodingDetector = {
  // Detection functions with clear names
  detectEncodingImmediate,
  detectEncodingStatistical,
  // Intuitive primary API (re-exports for expected interface)
  detectEncoding: detectEncodingImmediate,
  detect: detectEncodingStatistical,
  // Conversion and utilities
  convertScore,
  averageQuality,
  scoreToChar,
  charToScore,
  validateQualityString,
  getEncodingRange,
  scoreToErrorProbability,
  errorProbabilityToScore,
} as const;

// =============================================================================
// PRIVATE HELPER FUNCTIONS
// =============================================================================

function convertSolexaToPhred(solexaScore: number): number {
  // Solexa formula: P = 10^(-Q/10) / (1 + 10^(-Q/10))
  const temp = 10 ** (-solexaScore / 10);
  const errorProb = temp / (1 + temp);
  return errorProbabilityToScore(errorProb); // Use existing infrastructure
}

function convertPhredToSolexa(phredScore: number): number {
  const errorProb = scoreToErrorProbability(phredScore); // Use existing infrastructure

  // Handle edge case: Q0 (error prob = 1.0) cannot be converted directly due to division by zero
  if (errorProb >= 0.999) {
    // Q0 in Phred roughly corresponds to Q-5 in Solexa (minimum Solexa score)
    return -5; // Solexa minimum, represents very poor quality
  }

  // Solexa formula: Q = -10 * log10(P / (1-P))
  return -10 * Math.log10(errorProb / (1 - errorProb));
}

function convertSolexaQuality(quality: string, from: QualityEncoding, to: QualityEncoding): string {
  const fromOffset = from === QualityEncodingConstants.PHRED33 ? 33 : 64;
  const toOffset = to === QualityEncodingConstants.PHRED33 ? 33 : 64;

  const result = new Array(quality.length);

  for (let i = 0; i < quality.length; i++) {
    const char = quality.charCodeAt(i);
    let score: number;

    // Convert ASCII to quality score in source encoding
    if (from === QualityEncodingConstants.SOLEXA) {
      score = char - 64; // Solexa uses offset 64
      // Convert Solexa to Phred, then to target
      const phredScore = convertSolexaToPhred(score);
      score = phredScore;
    } else {
      score = char - fromOffset; // Phred score
      // Convert Phred to Solexa if needed
      if (to === QualityEncodingConstants.SOLEXA) {
        score = convertPhredToSolexa(score);
      }
    }

    // Convert quality score to ASCII in target encoding
    const targetOffset = to === QualityEncodingConstants.SOLEXA ? 64 : toOffset;
    const targetChar = Math.round(score) + targetOffset;

    // Validate resulting character is in valid range
    if (targetChar < 33 || targetChar > 126) {
      throw new Error(`Solexa conversion resulted in invalid character code: ${targetChar}`);
    }

    result[i] = String.fromCharCode(targetChar);
  }

  return result.join("");
}
