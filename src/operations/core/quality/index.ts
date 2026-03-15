/**
 * Unified Quality Score Operations Module
 *
 * This module provides a single source of truth for all quality score operations
 * in the Genotype library. It consolidates functionality previously scattered
 * across multiple modules into a clean, consistent API.
 *
 * @example Basic conversion
 * ```typescript
 * import { charToScore, scoreToChar } from '@/operations/core/quality';
 *
 * const score = charToScore('I', 'phred33'); // 40
 * const char = scoreToChar(40, 'phred33'); // 'I'
 * ```
 *
 * @example Encoding detection
 * ```typescript
 * import { detectEncoding } from '@/operations/core/quality';
 *
 * const encoding = detectEncoding('IIIIIIIIII'); // 'phred33'
 * ```
 */

export type {
  AsciiOffset,
  DetectionResult,
  QualityEncodingInfo,
  QualityScore,
  QualityStats,
  SolexaScore,
  ValidPhred33Char,
  ValidPhred64Char,
  ValidSolexaChar,
} from "./types";

// Export type guards for branded types
export {
  asNumbers,
  isValidQualityScore,
  isValidQualityScoreForEncoding,
  isValidSolexaScore,
} from "./types";

export {
  charToScore,
  convertQuality,
  qualityToScores,
  scoresToQuality,
  scoreToChar,
} from "./conversion";

export { getEncodingInfo } from "./encoding-info";

export {
  detectEncoding,
  detectEncodingWithConfidence,
} from "./detection";

export {
  calculateAverageQuality,
  calculateQualityStats,
  errorProbabilityToScore,
  scoreToErrorProbability,
} from "./statistics";

export type { BinnedResult, BinningStrategy, Platform } from "./binning";

export {
  binQualityString,
  calculateBinDistribution,
  calculateCompressionRatio,
  calculateRepresentatives,
  findBinIndex,
  PRESETS,
  validateBoundaries,
} from "./binning";
