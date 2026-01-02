/**
 * Core quality score conversion operations
 *
 * This module provides the fundamental conversion operations between
 * quality characters and numeric scores for different encoding schemes.
 * All functions are optimized for performance with O(1) or O(n) complexity.
 */

import type { QualityEncoding } from "../../../types";
import { getEncodingInfo } from "./encoding-info";
import type { QualityScore, SolexaScore } from "./types";
import { isValidQualityScore, isValidSolexaScore } from "./types";

/**
 * Convert a single quality character to numeric score with type-safe branded types
 *
 * @param char - ASCII quality character from a FASTQ quality string
 * @param encoding - Quality encoding scheme ('phred33', 'phred64', or 'solexa')
 * @returns Type-safe branded quality score:
 *   - QualityScore (0-93) for phred33/phred64
 *   - SolexaScore (-5 to 62) for solexa encoding
 *
 * @throws {Error} When character is outside valid ASCII range for encoding
 * @throws {Error} When resulting score is outside valid range for encoding
 *
 * @example
 * ```typescript
 * // Phred+33 (modern Illumina)
 * const score1 = charToScore('I', 'phred33'); // Returns QualityScore 40
 * const score2 = charToScore('!', 'phred33'); // Returns QualityScore 0
 * const score3 = charToScore('~', 'phred33'); // Returns QualityScore 93
 *
 * // Phred+64 (legacy Illumina)
 * const score4 = charToScore('h', 'phred64'); // Returns QualityScore 40
 * const score5 = charToScore('@', 'phred64'); // Returns QualityScore 0
 *
 * // Solexa (historic, with negative scores)
 * const score6 = charToScore(';', 'solexa'); // Returns SolexaScore -5
 * const score7 = charToScore('h', 'solexa'); // Returns SolexaScore 40
 * ```
 *
 * @performance O(1) - Single character lookup with constant time validation
 * @since v0.1.0
 */
export function charToScore(char: string, encoding: QualityEncoding): QualityScore | SolexaScore {
  const info = getEncodingInfo(encoding);
  const charCode = char.charCodeAt(0);

  if (charCode < info.minChar.charCodeAt(0) || charCode > info.maxChar.charCodeAt(0)) {
    throw new Error(
      `Invalid quality character '${char}' (ASCII ${charCode}) for ${encoding} encoding. ` +
        `Valid range: ${info.minChar}-${info.maxChar} (ASCII ${info.minChar.charCodeAt(0)}-${info.maxChar.charCodeAt(0)})`
    );
  }

  const score = charCode - info.offset;

  // Special handling for Solexa encoding which can have negative scores
  if (encoding === "solexa") {
    if (!isValidSolexaScore(score)) {
      throw new Error(`Invalid Solexa quality score ${score}. Valid range: -5 to 62`);
    }
    return score as SolexaScore;
  }

  // For other encodings, validate normally
  if (!isValidQualityScore(score)) {
    throw new Error(
      `Quality score ${score} is outside valid range (0-93) for ${encoding} encoding`
    );
  }

  return score as QualityScore;
}

/**
 * Convert a numeric quality score to ASCII character with type safety
 *
 * @param score - Numeric quality score (accepts branded QualityScore/SolexaScore or validated number)
 * @param encoding - Quality encoding scheme ('phred33', 'phred64', or 'solexa')
 * @returns ASCII quality character for the encoding
 *
 * @throws {Error} When score is not a valid integer
 * @throws {Error} When score is outside QualityScore range (0-93) for non-Solexa
 * @throws {Error} When score is outside encoding-specific valid range
 *
 * @example
 * ```typescript
 * // Phred+33 (modern standard)
 * scoreToChar(40, 'phred33'); // Returns 'I' (ASCII 73)
 * scoreToChar(0, 'phred33');  // Returns '!' (ASCII 33)
 * scoreToChar(93, 'phred33'); // Returns '~' (ASCII 126)
 *
 * // Phred+64 (legacy)
 * scoreToChar(40, 'phred64'); // Returns 'h' (ASCII 104)
 * scoreToChar(0, 'phred64');  // Returns '@' (ASCII 64)
 *
 * // Type-safe with branded types
 * const validated = 40 as QualityScore;
 * scoreToChar(validated, 'phred33'); // Type-safe, no runtime validation needed
 * ```
 *
 * @performance O(1) - Direct calculation with constant time validation
 * @since v0.1.0
 */
export function scoreToChar(
  score: QualityScore | SolexaScore | number,
  encoding: QualityEncoding
): string {
  const info = getEncodingInfo(encoding);

  // Validate based on encoding
  if (encoding === "solexa") {
    if (!isValidSolexaScore(score)) {
      throw new Error(
        `Invalid Solexa quality score ${score}. Must be an integer between -5 and 62.`
      );
    }
  } else {
    if (!isValidQualityScore(score)) {
      throw new Error(
        `Invalid quality score ${score} for ${encoding}. Must be an integer between 0 and 93.`
      );
    }
  }

  // Check encoding-specific bounds (redundant but keeps the original logic)
  if (score < info.minScore || score > info.maxScore) {
    throw new Error(
      `Quality score ${score} is outside valid range for ${encoding} encoding. ` +
        `Valid range: ${info.minScore}-${info.maxScore}`
    );
  }

  return String.fromCharCode(score + info.offset);
}

/**
 * Convert quality string to array of numeric scores
 *
 * @param quality - ASCII quality string
 * @param encoding - Quality encoding scheme (default: phred33)
 * @returns Array of numeric quality scores
 *
 * @example
 * ```typescript
 * qualityToScores('IIII', 'phred33'); // Returns [40, 40, 40, 40]
 * qualityToScores('hhhh', 'phred64'); // Returns [40, 40, 40, 40]
 * ```
 */
export function qualityToScores(
  quality: string,
  encoding: QualityEncoding = "phred33"
): (QualityScore | SolexaScore)[] {
  const { offset } = getEncodingInfo(encoding);

  // Declarative approach: map each character to its score with validation
  return Array.from(quality).map((char, i) => {
    const score = char.charCodeAt(0) - offset;

    if (encoding === "solexa") {
      if (!isValidSolexaScore(score)) {
        throw new Error(
          `Invalid Solexa score ${score} at position ${i}. ` +
            `Character '${char}' (ASCII ${char.charCodeAt(0)}) produces out-of-range score.`
        );
      }
      return score as SolexaScore;
    }

    if (!isValidQualityScore(score)) {
      throw new Error(
        `Invalid quality score ${score} at position ${i} in quality string. ` +
          `Character '${char}' (ASCII ${char.charCodeAt(0)}) produces out-of-range score for ${encoding} encoding.`
      );
    }
    return score as QualityScore;
  });
}

/**
 * Convert array of numeric scores to quality string
 *
 * @param scores - Array of numeric quality scores
 * @param encoding - Quality encoding scheme (default: phred33)
 * @returns ASCII quality string
 *
 * @example
 * ```typescript
 * scoresToQuality([40, 40, 40, 40], 'phred33'); // Returns 'IIII'
 * scoresToQuality([40, 40, 40, 40], 'phred64'); // Returns 'hhhh'
 * ```
 */
export function scoresToQuality(
  scores: (QualityScore | number)[],
  encoding: QualityEncoding = "phred33"
): string {
  const { offset, minScore, maxScore } = getEncodingInfo(encoding);

  return scores
    .map((score) => {
      // Validate each score
      if (!isValidQualityScore(score)) {
        throw new Error(`Invalid quality score ${score}. Must be an integer between 0 and 93.`);
      }

      // Check encoding-specific bounds
      if (score < minScore || score > maxScore) {
        throw new Error(
          `Quality score ${score} is outside valid range for ${encoding} encoding. ` +
            `Valid range: ${minScore}-${maxScore}`
        );
      }

      return String.fromCharCode(score + offset);
    })
    .join("");
}

/**
 * Convert quality string between different encodings
 *
 * @param quality - Quality string in source encoding
 * @param from - Source encoding
 * @param to - Target encoding
 * @returns Quality string in target encoding
 *
 * @example
 * ```typescript
 * convertQuality('IIII', 'phred33', 'phred64'); // Returns 'hhhh'
 * convertQuality('hhhh', 'phred64', 'phred33'); // Returns 'IIII'
 * ```
 */
export function convertQuality(
  quality: string,
  from: QualityEncoding,
  to: QualityEncoding
): string {
  // Fast path: same encoding
  if (from === to) {
    return quality;
  }

  const fromInfo = getEncodingInfo(from);
  const toInfo = getEncodingInfo(to);
  const offsetDiff = fromInfo.offset - toInfo.offset;

  // Fast path: simple offset conversion (no clamping needed)
  if (fromInfo.minScore >= toInfo.minScore && fromInfo.maxScore <= toInfo.maxScore) {
    return Array.from(quality)
      .map((char) => String.fromCharCode(char.charCodeAt(0) - offsetDiff))
      .join("");
  }

  // Slow path: need to validate and potentially clamp scores
  const scores = qualityToScores(quality, from);

  // Clamp scores to target encoding range
  for (let i = 0; i < scores.length; i++) {
    const score = scores[i];
    if (score !== undefined) {
      if (score < toInfo.minScore) scores[i] = toInfo.minScore;
      else if (score > toInfo.maxScore) scores[i] = toInfo.maxScore;
    }
  }

  return scoresToQuality(scores, to);
}
