/**
 * Quality score statistics and analysis
 *
 * This module provides statistical analysis functions for quality scores,
 * including basic statistics and error probability calculations.
 */

import type { QualityEncoding } from "../../../types";
import { qualityToScores } from "./conversion";
import type { QualityStats } from "./types";

/**
 * Calculate comprehensive quality statistics from numeric scores
 *
 * @param scores - Array of numeric quality scores
 * @returns Statistical summary including mean, median, quartiles
 *
 * @example
 * ```typescript
 * const stats = calculateQualityStats([30, 35, 40, 35, 30]);
 * console.log(`Mean quality: ${stats.mean.toFixed(1)}`);
 * console.log(`Median quality: ${stats.median}`);
 * ```
 */
export function calculateQualityStats(scores: number[]): QualityStats {
  if (!scores || scores.length === 0) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      q1: 0,
      q3: 0,
      stdDev: 0,
      count: 0,
    };
  }

  // Sort for percentile calculations
  const sorted = [...scores].sort((a, b) => a - b);
  const n = sorted.length;

  // Basic statistics
  const min = sorted[0] ?? 0;
  const max = sorted[n - 1] ?? 0;

  // Calculate mean
  let sum = 0;
  for (const score of scores) {
    sum += score;
  }
  const mean = sum / n;

  // Calculate median and quartiles
  const median =
    n % 2 === 0
      ? ((sorted[n / 2 - 1] ?? 0) + (sorted[n / 2] ?? 0)) / 2
      : (sorted[Math.floor(n / 2)] ?? 0);

  const q1Index = Math.floor(n * 0.25);
  const q3Index = Math.floor(n * 0.75);
  const q1 = sorted[q1Index] ?? 0;
  const q3 = sorted[q3Index] ?? 0;

  // Calculate standard deviation
  let sumSquaredDiff = 0;
  for (const score of scores) {
    const diff = score - mean;
    sumSquaredDiff += diff * diff;
  }
  const stdDev = Math.sqrt(sumSquaredDiff / n);

  return {
    min,
    max,
    mean,
    median,
    q1,
    q3,
    stdDev,
    count: n,
  };
}

/**
 * Calculate average quality score from a quality string
 *
 * Optimized for streaming with single-pass calculation.
 *
 * @param quality - ASCII quality string
 * @param encoding - Quality encoding scheme
 * @returns Average quality score
 *
 * @example
 * ```typescript
 * const avg = calculateAverageQuality('IIIIIIIIII', 'phred33'); // 40
 * ```
 */
export function calculateAverageQuality(
  quality: string,
  encoding: QualityEncoding = "phred33"
): number {
  if (!quality || quality.length === 0) {
    return 0;
  }

  const scores = qualityToScores(quality, encoding);
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

/**
 * Convert quality score to error probability
 *
 * Uses the formula: P = 10^(-Q/10)
 *
 * @param score - Phred quality score
 * @returns Error probability (0-1)
 *
 * @example
 * ```typescript
 * const prob = scoreToErrorProbability(20); // 0.01 (1% error rate)
 * const prob = scoreToErrorProbability(30); // 0.001 (0.1% error rate)
 * const prob = scoreToErrorProbability(40); // 0.0001 (0.01% error rate)
 * ```
 */
export function scoreToErrorProbability(score: number): number {
  return 10 ** (-score / 10);
}

/**
 * Convert error probability to quality score
 *
 * Uses the formula: Q = -10 * log10(P)
 *
 * @param probability - Error probability (0-1)
 * @returns Phred quality score
 *
 * @example
 * ```typescript
 * const score = errorProbabilityToScore(0.01); // 20
 * const score = errorProbabilityToScore(0.001); // 30
 * const score = errorProbabilityToScore(0.0001); // 40
 * ```
 */
export function errorProbabilityToScore(probability: number): number {
  if (probability <= 0 || probability > 1) {
    throw new Error(`Invalid error probability: ${probability}. Must be between 0 and 1.`);
  }

  return -10 * Math.log10(probability);
}

/**
 * Calculate average error rate for a quality string
 *
 * Converts each quality score to error probability and computes the mean.
 *
 * @param quality - ASCII quality string
 * @param encoding - Quality encoding scheme
 * @returns Average error rate (0-1)
 *
 * @example
 * ```typescript
 * const errorRate = calculateErrorRate('IIIIGGGGFFFF', 'phred33');
 * console.log(`Average error rate: ${(errorRate * 100).toFixed(2)}%`);
 * ```
 */
export function calculateErrorRate(quality: string, encoding: QualityEncoding = "phred33"): number {
  if (!quality || quality.length === 0) {
    return 0;
  }

  const scores = qualityToScores(quality, encoding);
  let sumProbability = 0;

  for (const score of scores) {
    sumProbability += scoreToErrorProbability(score);
  }

  return sumProbability / scores.length;
}

/**
 * Find the percentage of bases above a quality threshold
 *
 * Useful for quality control metrics like Q20 or Q30 percentages.
 *
 * @param quality - ASCII quality string
 * @param threshold - Minimum quality score
 * @param encoding - Quality encoding scheme
 * @returns Percentage of bases above threshold (0-100)
 *
 * @example
 * ```typescript
 * const q30Percent = percentAboveThreshold('IIIIIGGGGFFFFF', 30, 'phred33');
 * console.log(`Q30: ${q30Percent.toFixed(1)}%`); // Percentage of Q30+ bases
 * ```
 */
export function percentAboveThreshold(
  quality: string,
  threshold: number,
  encoding: QualityEncoding = "phred33"
): number {
  if (!quality || quality.length === 0) {
    return 0;
  }

  const scores = qualityToScores(quality, encoding);
  const countAbove = scores.filter((score) => score >= threshold).length;
  return (countAbove / scores.length) * 100;
}
