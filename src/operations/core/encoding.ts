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

import type { FastqSequence, QualityEncoding } from '../../types';
import { QualityEncoding as QualityEncodingConstants } from '../../types';

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

// =============================================================================
// EXPORTED FUNCTIONS
// =============================================================================

/**
 * Auto-detect quality encoding from FASTQ sequences
 * Samples first 10,000 sequences to determine encoding
 *
 * @example
 * ```typescript
 * const encoding = await detectEncoding(sequences);
 * console.log(`Detected encoding: ${encoding}`);
 * ```
 *
 * @param sequences - AsyncIterable of FASTQ sequences to analyze
 * @returns Detected quality encoding
 */
export async function detectEncoding(
  sequences: AsyncIterable<FastqSequence>
): Promise<QualityEncoding> {
  // Tiger Style: Assert input
  if (sequences === null || sequences === undefined) {
    throw new Error('Sequences input is required for encoding detection');
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

  // Decision tree based on ASCII ranges
  if (minQual < 59) {
    return QualityEncodingConstants.PHRED33;
  }
  if (minQual >= 64 && maxQual <= 126) {
    return QualityEncodingConstants.PHRED64;
  }
  return QualityEncodingConstants.SOLEXA;
}

/**
 * Alias for detectEncoding for backward compatibility
 * @deprecated Use detectEncoding instead
 */
export const detect = detectEncoding;

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
  if (!quality || typeof quality !== 'string') {
    throw new Error('Quality string is required for conversion');
  }
  if (from === undefined || from === null || to === undefined || to === null) {
    throw new Error('Both from and to encodings are required');
  }

  if (from === to) return quality;

  // 🔥 NATIVE: SIMD-accelerated character arithmetic
  const fromOffset = from === QualityEncodingConstants.PHRED33 ? 33 : 64;
  const toOffset = to === QualityEncodingConstants.PHRED33 ? 33 : 64;
  const diff = toOffset - fromOffset;

  // Handle Solexa's different probability calculation if needed
  if (from === QualityEncodingConstants.SOLEXA || to === QualityEncodingConstants.SOLEXA) {
    throw new Error('Solexa conversion not yet implemented');
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

  return result.join('');
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
  if (!quality || typeof quality !== 'string') {
    throw new Error('Quality string is required for average calculation');
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
  if (typeof score !== 'number' || score < 0) {
    throw new Error('Score must be a non-negative number');
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
    throw new Error('Single character required for score conversion');
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
  if (!quality || typeof quality !== 'string') {
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
  if (typeof score !== 'number' || score < 0) {
    throw new Error('Score must be a non-negative number');
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
  if (typeof probability !== 'number' || probability <= 0 || probability > 1) {
    throw new Error('Probability must be between 0 and 1');
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
  detect: detectEncoding,
  detectEncoding,
  convertScore,
  averageQuality,
  scoreToChar,
  charToScore,
  validateQualityString,
  getEncodingRange,
  scoreToErrorProbability,
  errorProbabilityToScore,
} as const;
