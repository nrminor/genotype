/**
 * Core quality score conversion operations
 *
 * This module provides the fundamental conversion operations between
 * quality characters and numeric scores for different encoding schemes.
 * All functions are optimized for performance with O(1) or O(n) complexity.
 */

import { asString } from "@genotype/core/genotype-string";
import type { GenotypeString } from "@genotype/core/genotype-string";
import type { QualityEncoding } from "@genotype/core/types";
import { getEncodingInfo } from "./encoding-info";
import { errorProbabilityToScore, scoreToErrorProbability } from "./statistics";
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
    return score;
  }

  // For other encodings, validate normally
  if (!isValidQualityScore(score)) {
    throw new Error(
      `Quality score ${score} is outside valid range (0-93) for ${encoding} encoding`
    );
  }

  return score;
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
  quality: GenotypeString | string,
  encoding: QualityEncoding = "phred33"
): (QualityScore | SolexaScore)[] {
  const q = asString(quality);
  const { offset } = getEncodingInfo(encoding);

  // Declarative approach: map each character to its score with validation
  return Array.from(q).map((char, i) => {
    const score = char.charCodeAt(0) - offset;

    if (encoding === "solexa") {
      if (!isValidSolexaScore(score)) {
        throw new Error(
          `Invalid Solexa score ${score} at position ${i}. ` +
            `Character '${char}' (ASCII ${char.charCodeAt(0)}) produces out-of-range score.`
        );
      }
      return score;
    }

    if (!isValidQualityScore(score)) {
      throw new Error(
        `Invalid quality score ${score} at position ${i} in quality string. ` +
          `Character '${char}' (ASCII ${char.charCodeAt(0)}) is outside valid ASCII range for ${encoding} encoding.`
      );
    }
    return score;
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
 * Convert Solexa quality score to Phred quality score
 *
 * Solexa uses a different probability formula than Phred:
 * - Phred: Q = -10 * log10(P_error)
 * - Solexa: Q = -10 * log10(P_error / (1 - P_error))
 *
 * This function converts through error probability to get the correct Phred score.
 *
 * @param solexaScore - Solexa quality score (-5 to 62)
 * @returns Equivalent Phred quality score
 *
 * @example
 * ```typescript
 * convertSolexaToPhred(-5); // Returns ~1 (Solexa minimum → low Phred)
 * convertSolexaToPhred(0);  // Returns ~3
 * convertSolexaToPhred(40); // Returns ~40 (high scores converge)
 * ```
 */
function convertSolexaToPhred(solexaScore: number): number {
  // Solexa formula: P_error = 10^(-Q/10) / (1 + 10^(-Q/10))
  const temp = 10 ** (-solexaScore / 10);
  const errorProb = temp / (1 + temp);
  return errorProbabilityToScore(errorProb);
}

/**
 * Convert Phred quality score to Solexa quality score
 *
 * @param phredScore - Phred quality score (0 to 93)
 * @returns Equivalent Solexa quality score
 *
 * @example
 * ```typescript
 * convertPhredToSolexa(0);  // Returns -5 (Phred Q0 → Solexa minimum)
 * convertPhredToSolexa(10); // Returns ~10
 * convertPhredToSolexa(40); // Returns ~40 (high scores converge)
 * ```
 */
function convertPhredToSolexa(phredScore: number): number {
  const errorProb = scoreToErrorProbability(phredScore);

  // Handle edge case: Q0 (error prob = 1.0) cannot be converted directly
  // due to division by zero in the Solexa formula
  if (errorProb >= 0.999) {
    return -5; // Solexa minimum, represents very poor quality
  }

  // Solexa formula: Q = -10 * log10(P / (1-P))
  return -10 * Math.log10(errorProb / (1 - errorProb));
}

/**
 * Convert quality string involving Solexa encoding
 *
 * Handles the non-linear mathematical conversion between Solexa and Phred encodings.
 *
 * @param quality - Quality string to convert
 * @param from - Source encoding
 * @param to - Target encoding
 * @returns Converted quality string
 */
function convertSolexaQuality(
  quality: GenotypeString | string,
  from: QualityEncoding,
  to: QualityEncoding
): string {
  const q = asString(quality);
  const fromOffset = from === "phred33" ? 33 : 64;
  const toOffset = to === "phred33" ? 33 : 64;

  const result = new Array<string>(q.length);

  for (let i = 0; i < q.length; i++) {
    const charCode = q.charCodeAt(i);
    let score: number;

    // Convert ASCII to quality score in source encoding
    if (from === "solexa") {
      const solexaScore = charCode - 64; // Solexa uses offset 64
      // Convert Solexa to Phred
      score = convertSolexaToPhred(solexaScore);
    } else {
      // Source is Phred (33 or 64)
      const phredScore = charCode - fromOffset;
      // Convert Phred to Solexa if target is Solexa
      if (to === "solexa") {
        score = convertPhredToSolexa(phredScore);
      } else {
        score = phredScore;
      }
    }

    // Convert quality score to ASCII in target encoding
    const targetOffset = to === "solexa" ? 64 : toOffset;
    const targetChar = Math.round(score) + targetOffset;

    // Validate resulting character is in valid ASCII range
    if (targetChar < 33 || targetChar > 126) {
      throw new Error(
        `Solexa conversion resulted in invalid character code: ${targetChar}. ` +
          `ASCII range must be 33-126.`
      );
    }

    result[i] = String.fromCharCode(targetChar);
  }

  return result.join("");
}

/**
 * Convert quality string between different encodings
 *
 * Handles all encoding conversions including the non-linear Solexa math.
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
 * convertQuality('!!!!', 'phred33', 'solexa');  // Returns ';;;;' (Q0 → Q-5)
 * ```
 */
export function convertQuality(
  quality: GenotypeString | string,
  from: QualityEncoding,
  to: QualityEncoding
): string {
  // Fast path: same encoding
  if (from === to) {
    return asString(quality);
  }

  // Solexa requires non-linear mathematical conversion
  if (from === "solexa" || to === "solexa") {
    return convertSolexaQuality(quality, from, to);
  }

  // Simple offset conversion for Phred33 ↔ Phred64
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
