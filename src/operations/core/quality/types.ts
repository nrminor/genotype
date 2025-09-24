/**
 * Shared types for quality score operations
 *
 * This module defines the core types used throughout quality operations.
 * These types provide a consistent interface for quality score manipulation
 * across different encoding schemes with compile-time safety through
 * branded types and template literals.
 */

import type { QualityEncoding } from "../../../types";

// ============================================================================
// BRANDED TYPES FOR COMPILE-TIME SAFETY
// ============================================================================

/**
 * Branded type for standard quality scores (Phred33/Phred64)
 * @minimum 0
 * @maximum 93
 */
export type QualityScore = number & {
  readonly __brand: "QualityScore";
  readonly __min: 0;
  readonly __max: 93;
};

/**
 * Branded type for Solexa quality scores which can be negative
 * @minimum -5
 * @maximum 62
 */
export type SolexaScore = number & {
  readonly __brand: "SolexaScore";
  readonly __min: -5;
  readonly __max: 62;
};

/**
 * Branded type for ASCII offsets used in quality encodings
 */
export type AsciiOffset = (33 | 59 | 64) & { readonly __brand: "AsciiOffset" };

/**
 * Branded type for ASCII character codes in quality strings
 * @minimum 33 (!)
 * @maximum 126 (~)
 */
export type QualityChar = number & {
  readonly __brand: "QualityChar";
  readonly __min: 33;
  readonly __max: 126;
};

/**
 * Type guard to validate standard quality score range
 */
export const isValidQualityScore = (score: number): score is QualityScore => {
  return score >= 0 && score <= 93 && Number.isInteger(score);
};

/**
 * Type guard to validate Solexa quality score range
 */
export const isValidSolexaScore = (score: number): score is SolexaScore => {
  return score >= -5 && score <= 62 && Number.isInteger(score);
};

/**
 * Type guard to validate ASCII offset
 */
export const isValidAsciiOffset = (offset: number): offset is AsciiOffset => {
  return offset === 33 || offset === 59 || offset === 64;
};

/**
 * Type guard to validate quality character code
 */
export const isValidQualityChar = (charCode: number): charCode is QualityChar => {
  return charCode >= 33 && charCode <= 126 && Number.isInteger(charCode);
};

/**
 * Comprehensive information about a quality encoding scheme
 * with strongly-typed offset and score ranges
 */
export interface QualityEncodingInfo {
  readonly name: QualityEncoding;
  readonly offset: AsciiOffset;
  readonly minScore: QualityScore;
  readonly maxScore: QualityScore;
  readonly minChar: string;
  readonly maxChar: string;
  readonly description: string;
}

/**
 * Comprehensive quality statistics
 */
export interface QualityStats {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly median: number;
  readonly q1: number; // First quartile (25th percentile)
  readonly q3: number; // Third quartile (75th percentile)
  readonly stdDev: number; // Standard deviation
  readonly count: number; // Number of scores
}

/**
 * Result of quality encoding detection with confidence
 */
export interface DetectionResult {
  readonly encoding: QualityEncoding;
  readonly confidence: number; // 0-1 confidence score
  readonly evidence: string[]; // Reasoning for detection
}

/**
 * Quality validation result with detailed errors
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors?: string[];
  readonly warnings?: string[];
}

/**
 * Options for quality trimming operations
 */
export interface TrimOptions {
  readonly threshold: number; // Minimum quality score
  readonly windowSize?: number; // Window size for sliding window (default: 1)
  readonly minLength?: number; // Minimum length after trimming
}

/**
 * Result of quality trimming analysis
 */
export interface TrimPositions {
  readonly start: number; // 0-based index to start from
  readonly end: number; // 0-based index to end at (exclusive)
  readonly trimmedStart: number; // Number of bases trimmed from start
  readonly trimmedEnd: number; // Number of bases trimmed from end
}
