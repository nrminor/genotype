/**
 * FASTQ Quality Score Operations Module
 *
 * Consolidates quality score conversion, validation, and statistics functions.
 * Provides tree-shakeable functions for working with various quality encodings.
 *
 * @module fastq/quality
 */

import { ValidationError } from "../../errors";
import {
  calculateQualityStats,
  convertQuality,
  qualityToScores,
} from "../../operations/core/quality";
import type { QualityEncoding } from "../../types";
import { QUALITY_THRESHOLDS, QUALITY_WINDOWS, TRIMMING_DEFAULTS } from "./constants";

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Quality encoding ASCII offsets
 */
const QUALITY_OFFSETS = {
  phred33: 33,
  phred64: 64,
  solexa: 59,
} as const satisfies Record<QualityEncoding, AsciiOffset>;

/**
 * Quality score valid ranges
 */
const QUALITY_RANGES = {
  phred33: { min: 0, max: 93, asciiMin: 33, asciiMax: 126 },
  phred64: { min: 0, max: 93, asciiMin: 64, asciiMax: 157 },
  solexa: { min: -5, max: 62, asciiMin: 59, asciiMax: 126 },
} as const;

/**
 * Quality level definitions for declarative assessment
 *
 * Ordered from highest to lowest quality for find() operation.
 * Each level includes threshold, name, and recommendation.
 */
const QUALITY_LEVELS = [
  {
    minScore: QUALITY_THRESHOLDS.EXCELLENT,
    level: "excellent" as const,
    recommendation: "High-quality data suitable for most analyses",
  },
  {
    minScore: QUALITY_THRESHOLDS.GOOD,
    level: "good" as const,
    recommendation: "Good quality data, minimal trimming needed",
  },
  {
    minScore: QUALITY_THRESHOLDS.FAIR,
    level: "fair" as const,
    recommendation: "Consider quality trimming before analysis",
  },
  {
    minScore: 0,
    level: "poor" as const,
    recommendation: "Poor quality data, aggressive trimming recommended",
  },
] as const;

// ============================================================================
// TYPES
// ============================================================================

// Type aliases for clarity and type safety
type QualityString = string;
type AsciiOffset = 33 | 64 | 59;

// ============================================================================
// QUALITY STRING VALIDATION
// ============================================================================

/**
 * Validate quality string for specific encoding
 *
 * Checks if all characters in the quality string are within the valid
 * ASCII range for the specified encoding.
 *
 * @param quality - Quality string to validate
 * @param encoding - Quality encoding to validate against
 * @returns Validation result with details
 */
function validateQualityString(
  quality: QualityString,
  encoding: QualityEncoding,
): {
  valid: boolean;
  minChar: number;
  maxChar: number;
  invalidChars: string[];
  message?: string;
} {
  if (!quality || quality.length === 0) {
    return {
      valid: false,
      minChar: 0,
      maxChar: 0,
      invalidChars: [],
      message: "Empty quality string",
    };
  }

  const range = QUALITY_RANGES[encoding];
  const chars = quality.split("");
  const charCodes = chars.map((c) => c.charCodeAt(0));
  const minChar = Math.min(...charCodes);
  const maxChar = Math.max(...charCodes);

  const invalidChars = chars.filter((char) => {
    const code = char.charCodeAt(0);
    return code < range.asciiMin || code > range.asciiMax;
  });

  const valid = invalidChars.length === 0;

  const result: {
    valid: boolean;
    minChar: number;
    maxChar: number;
    invalidChars: string[];
    message?: string;
  } = {
    valid,
    minChar,
    maxChar,
    invalidChars: [...new Set(invalidChars)], // Unique invalid chars
  };

  if (!valid) {
    result.message = `Invalid characters for ${encoding}: ${invalidChars.join(", ")}`;
  }

  return result;
}

// ============================================================================
// QUALITY CONVERSION
// ============================================================================

/**
 * Convert quality string between encodings
 *
 * Handles conversion between Phred+33, Phred+64, and Solexa encodings.
 * Properly handles the non-linear Solexa scale.
 *
 * @param quality - Input quality string
 * @param fromEncoding - Source encoding
 * @param toEncoding - Target encoding
 * @returns Converted quality string
 */
function convertQualityEncoding(
  quality: QualityString,
  fromEncoding: QualityEncoding,
  toEncoding: QualityEncoding,
): QualityString {
  if (fromEncoding === toEncoding) {
    return quality;
  }

  return convertQuality(quality, fromEncoding, toEncoding);
}

// ============================================================================
// QUALITY STATISTICS
// ============================================================================

/**
 * Calculate statistics for quality scores
 *
 * @param quality - Quality string
 * @param encoding - Quality encoding
 * @returns Statistics including mean, median, min, max, Q1, Q3
 */
function getQualityStatistics(quality: QualityString, encoding: QualityEncoding) {
  const scores = qualityToScores(quality, encoding);
  return calculateQualityStats(scores);
}

// ============================================================================
// QUALITY ASSESSMENT
// ============================================================================

/**
 * Assess overall quality of a sequence
 *
 * Provides a high-level assessment based on mean quality scores.
 *
 * @param quality - Quality string
 * @param encoding - Quality encoding
 * @returns Quality assessment
 */
function assessQuality(
  quality: QualityString,
  encoding: QualityEncoding,
): {
  level: "excellent" | "good" | "fair" | "poor";
  meanScore: number;
  recommendation: string;
} {
  const stats = getQualityStatistics(quality, encoding);
  const mean = stats.mean;

  // Find matching quality level using declarative lookup
  // Destructure last element with explicit validation
  const fallbackLevel = QUALITY_LEVELS[QUALITY_LEVELS.length - 1];
  if (!fallbackLevel) {
    throw new ValidationError(
      "QUALITY_LEVELS array must contain at least one quality level definition",
      undefined,
      "Quality assessment requires non-empty QUALITY_LEVELS configuration",
    );
  }

  const matchedLevel = QUALITY_LEVELS.find((q) => mean >= q.minScore) ?? fallbackLevel;

  return {
    level: matchedLevel.level,
    meanScore: mean,
    recommendation: matchedLevel.recommendation,
  };
}

// ============================================================================
// QUALITY WINDOW ANALYSIS
// ============================================================================

/**
 * Analyze a single quality window
 *
 * Pure function for analyzing a window of quality scores.
 *
 * @param scores - Full array of quality scores
 * @param start - Starting position of window
 * @param size - Window size
 * @returns Window statistics or null if window is invalid
 * @internal
 */
function analyzeWindow(
  scores: number[],
  start: number,
  size: number,
): { start: number; end: number; meanScore: number; minScore: number; maxScore: number } | null {
  if (start + size > scores.length) return null;

  const windowScores = scores.slice(start, Math.min(start + size, scores.length));
  if (windowScores.length === 0) return null;

  const stats = calculateQualityStats(windowScores);
  return {
    start,
    end: start + windowScores.length - 1,
    meanScore: stats.mean,
    minScore: stats.min,
    maxScore: stats.max,
  };
}

/**
 * Analyze quality in sliding windows
 *
 * Useful for identifying quality drops along read length.
 *
 * @param quality - Quality string
 * @param encoding - Quality encoding
 * @param windowSize - Size of sliding window (default: 10)
 * @returns Array of window statistics
 */
function analyzeQualityWindows(
  quality: QualityString,
  encoding: QualityEncoding,
  windowSize = QUALITY_WINDOWS.DEFAULT_SIZE,
): Array<{
  start: number;
  end: number;
  meanScore: number;
  minScore: number;
  maxScore: number;
}> {
  const scores = qualityToScores(quality, encoding);

  // Validate window size
  const validWindowSize = Math.max(
    QUALITY_WINDOWS.MIN_SIZE,
    Math.min(windowSize, QUALITY_WINDOWS.MAX_SIZE, scores.length),
  );

  // Use functional approach with Array.from and map
  const numWindows = Math.max(0, scores.length - validWindowSize + 1);

  return Array.from({ length: numWindows }, (_, i) =>
    analyzeWindow(scores, i, validWindowSize),
  ).filter((w): w is NonNullable<typeof w> => w !== null);
}

// ============================================================================
// QUALITY FILTERING
// ============================================================================

/**
 * Find positions where quality drops below threshold
 *
 * Useful for quality-based trimming decisions.
 *
 * @param quality - Quality string
 * @param encoding - Quality encoding
 * @param threshold - Minimum acceptable quality score
 * @returns Positions where quality is below threshold
 */
function findLowQualityPositions(
  quality: QualityString,
  encoding: QualityEncoding,
  threshold: number,
): number[] {
  const scores = qualityToScores(quality, encoding);
  return scores
    .map((score, index) => (score < threshold ? index : -1))
    .filter((index) => index >= 0);
}

/**
 * Suggest trimming positions based on quality
 *
 * @param quality - Quality string
 * @param encoding - Quality encoding
 * @param minQuality - Minimum acceptable quality (default: 20)
 * @param minLength - Minimum acceptable length after trimming
 * @returns Suggested trim positions
 */
function suggestQualityTrimming(
  quality: QualityString,
  encoding: QualityEncoding,
  minQuality = TRIMMING_DEFAULTS.MIN_QUALITY,
  minLength = TRIMMING_DEFAULTS.MIN_LENGTH,
): {
  trimStart: number;
  trimEnd: number;
  newLength: number;
  meanQualityAfter: number;
} | null {
  const scores = qualityToScores(quality, encoding);

  // Find first position with good quality
  let trimStart = 0;
  for (let i = 0; i < scores.length; i++) {
    const score = scores[i];
    if (score !== undefined && score >= minQuality) {
      trimStart = i;
      break;
    }
  }

  // Find last position with good quality
  let trimEnd = scores.length - 1;
  for (let i = scores.length - 1; i >= 0; i--) {
    const score = scores[i];
    if (score !== undefined && score >= minQuality) {
      trimEnd = i;
      break;
    }
  }

  const newLength = trimEnd - trimStart + 1;

  // Check if trimmed sequence meets minimum length
  if (newLength < minLength) {
    return null;
  }

  const trimmedScores = scores.slice(trimStart, trimEnd + 1);
  const stats = calculateQualityStats(trimmedScores);

  return {
    trimStart,
    trimEnd,
    newLength,
    meanQualityAfter: stats.mean,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

// Export constants
export { QUALITY_OFFSETS, QUALITY_RANGES };

// Export functions
export {
  validateQualityString,
  convertQualityEncoding,
  getQualityStatistics,
  assessQuality,
  analyzeQualityWindows,
  findLowQualityPositions,
  suggestQualityTrimming,
};

// Re-export quality conversion functions from core module
export {
  getEncodingInfo as getQualityEncodingInfo,
  qualityToScores as toPhredScores,
  scoresToQuality as fromPhredScores,
} from "../../operations/core/quality";
