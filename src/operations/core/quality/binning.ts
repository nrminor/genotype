/**
 * Quality Score Binning Module
 *
 * Collapses Phred quality scores from 94 possible values into 2, 3, or 5 bins
 * for improved compression and simplified downstream analysis.
 *
 * Platform-specific presets based on industry standards:
 * - Illumina: Q20 (99% accuracy), Q30 (99.9% accuracy) thresholds
 * - PacBio: Q13 common cutoff, HiFi quality ranges
 * - Nanopore: Lower thresholds reflecting platform characteristics
 *
 * Maintains O(1) memory streaming architecture - suitable for 100GB+ files.
 *
 * @module operations/core/quality/binning
 */

import { QualityError } from "../../../errors";
import type { QualityEncoding } from "../../../types";
import { charToScore, scoreToChar } from "./conversion";
import { getEncodingInfo } from "./encoding-info";

/**
 * Illumina quality score binning presets
 *
 * Based on Illumina platform quality characteristics and industry standards:
 * - Q20: 99% base call accuracy (1 error per 100 bases)
 * - Q30: 99.9% base call accuracy (1 error per 1000 bases)
 * - Modern Illumina instruments typically produce Q30-Q40 quality scores
 *
 * @remarks
 * 2-bin: Binary classification at Q20 threshold (reliable vs unreliable)
 * 3-bin: Three quality levels (poor <Q15, good Q15-Q29, excellent ≥Q30)
 * 5-bin: Fine-grained quality levels for detailed analysis
 */
const ILLUMINA_PRESETS = {
  2: [20] as const,
  3: [15, 30] as const,
  5: [10, 20, 30, 35] as const,
} as const;

/**
 * PacBio quality score binning presets
 *
 * Based on PacBio HiFi and CLR quality characteristics:
 * - Q13: Common quality cutoff for PacBio reads
 * - HiFi reads typically Q20-Q30 range
 * - CLR (Continuous Long Reads) typically Q7-Q15 range
 * - Generally lower quality than Illumina due to different chemistry
 *
 * @remarks
 * 2-bin: Binary classification at Q13 threshold
 * 3-bin: Three quality levels appropriate for PacBio data
 * 5-bin: Fine-grained for distinguishing HiFi from CLR quality ranges
 */
const PACBIO_PRESETS = {
  2: [13] as const,
  3: [10, 20] as const,
  5: [7, 13, 20, 30] as const,
} as const;

/**
 * Nanopore quality score binning presets
 *
 * Based on Oxford Nanopore quality characteristics:
 * - Q7-Q12: Typical Nanopore quality range (improving over time)
 * - Quality varies by chemistry version (R9, R10, R10.4, etc.)
 * - Generally lower quality than short-read platforms
 * - More lenient thresholds reflect platform characteristics
 *
 * @remarks
 * 2-bin: Binary classification at Q10 threshold
 * 3-bin: Three quality levels appropriate for Nanopore data
 * 5-bin: Fine-grained binning for Nanopore quality distribution
 */
const NANOPORE_PRESETS = {
  2: [10] as const,
  3: [7, 12] as const,
  5: [5, 9, 12, 18] as const,
} as const;

/**
 * Combined platform presets for quality score binning
 *
 * Maps platform identifiers to their respective quality score boundaries
 * for 2, 3, and 5-bin binning strategies.
 *
 * @example
 * ```typescript
 * // Get Illumina 3-bin boundaries
 * const boundaries = PRESETS.illumina[3]; // [15, 30]
 *
 * // Get PacBio 2-bin boundaries
 * const boundaries = PRESETS.pacbio[2]; // [13]
 * ```
 */
export const PRESETS = {
  illumina: ILLUMINA_PRESETS,
  pacbio: PACBIO_PRESETS,
  nanopore: NANOPORE_PRESETS,
} as const;

/**
 * Sequencing platform identifier for quality binning presets
 *
 * @remarks
 * Each platform has different quality score characteristics:
 * - illumina: Short reads, high quality (Q30-Q40 typical)
 * - pacbio: Long reads, moderate quality (Q13-Q30 for HiFi)
 * - nanopore: Ultra-long reads, lower quality (Q7-Q18 typical)
 */
export type Platform = "illumina" | "pacbio" | "nanopore";

/**
 * Binning strategy configuration
 *
 * Defines how quality scores are collapsed into bins, including the boundaries
 * between bins, representative scores for each bin, and the encoding scheme.
 *
 * @property bins - Number of bins to use (2, 3, or 5)
 * @property boundaries - Quality score boundaries between bins (length = bins - 1)
 * @property representatives - Representative quality score for each bin (length = bins)
 * @property encoding - Quality encoding scheme (phred33, phred64, or solexa)
 *
 * @example
 * ```typescript
 * // 3-bin strategy with Illumina preset boundaries [15, 30]
 * const strategy: BinningStrategy = {
 *   bins: 3,
 *   boundaries: [15, 30],
 *   representatives: [7, 22, 40],  // Midpoints of [0-14], [15-29], [30+]
 *   encoding: 'phred33'
 * };
 * ```
 */
export interface BinningStrategy {
  readonly bins: 2 | 3 | 5;
  readonly boundaries: readonly number[];
  readonly representatives: readonly number[];
  readonly encoding: QualityEncoding;
}

/**
 * Result of quality score binning operation
 *
 * Contains the original quality string, binned version, distribution statistics,
 * and compression metrics.
 *
 * @property original - Original quality string before binning
 * @property binned - Quality string after binning (same length as original)
 * @property binDistribution - Count of scores in each bin (length = bins)
 * @property compressionRatio - Ratio of unique characters (original / binned)
 *
 * @example
 * ```typescript
 * const result: BinnedResult = {
 *   original: 'IIIIIIIIII!!!!!IIIII',  // 2 unique chars (I, !)
 *   binned: 'IIIIIIIIIIIIIIIIIIII',    // 1 unique char (I)
 *   binDistribution: [5, 15],           // 5 in bin 0, 15 in bin 1
 *   compressionRatio: 2.0               // 2÷1 = 2x improvement
 * };
 * ```
 */
export interface BinnedResult {
  readonly original: string;
  readonly binned: string;
  readonly binDistribution: readonly number[];
  readonly compressionRatio: number;
}

/**
 * Validate quality score boundaries
 *
 * Ensures boundaries are:
 * - In strictly ascending order (no duplicates)
 * - Within valid quality score range for the encoding
 *
 * @param boundaries - Boundary values to validate
 * @param encoding - Quality encoding to determine valid range
 * @throws {QualityError} When boundaries violate constraints
 *
 * @example
 * ```typescript
 * // ✅ Valid
 * validateBoundaries([15, 30], 'phred33');
 *
 * // ❌ Error: Not in ascending order
 * validateBoundaries([30, 15], 'phred33');
 * // QualityError: Boundaries [30, 15]: value at index 1 (15) <= previous value (30)
 *
 * // ❌ Error: Out of range
 * validateBoundaries([15, 100], 'phred33');
 * // QualityError: Boundaries [15, 100]: value at index 1 (100) outside valid range [0, 93]
 *
 * // ✅ Valid for Solexa (allows negative)
 * validateBoundaries([-5, 10], 'solexa');
 * ```
 */
export function validateBoundaries(boundaries: readonly number[], encoding: QualityEncoding): void {
  if (boundaries.length === 0) {
    throw new QualityError("Boundaries array cannot be empty", "validation", encoding);
  }

  const info = getEncodingInfo(encoding);
  const { minScore, maxScore } = info;

  for (let i = 0; i < boundaries.length; i++) {
    const current = boundaries[i];

    if (current === undefined) {
      throw new QualityError(`Boundary at index ${i} is undefined`, "validation", encoding);
    }

    if (current < minScore || current > maxScore) {
      throw new QualityError(
        `Boundaries ${JSON.stringify(Array.from(boundaries))}: ` +
          `value at index ${i} (${current}) outside valid range [${minScore}, ${maxScore}] for ${encoding}.\n` +
          `Valid ${encoding} range: ${minScore} to ${maxScore}.\n` +
          `Example valid boundaries: [15, 30] for 3 bins`,
        "validation",
        encoding,
      );
    }

    if (i > 0) {
      const previous = boundaries[i - 1];
      if (previous === undefined) {
        throw new QualityError(`Boundary at index ${i - 1} is undefined`, "validation", encoding);
      }
      if (current <= previous) {
        throw new QualityError(
          `Boundaries ${JSON.stringify(Array.from(boundaries))}: ` +
            `value at index ${i} (${current}) <= previous value (${previous}). ` +
            `Boundaries must be in strictly ascending order.\n` +
            `Example: [15, 30] is valid (15 < 30), but [30, 15] is not`,
          "validation",
          encoding,
        );
      }
    }
  }
}

/**
 * Calculate representative quality scores for each bin
 *
 * Computes the midpoint score for each bin range defined by boundaries.
 * Representative scores are used to replace all scores within a bin.
 *
 * Algorithm:
 * - First bin [0, boundary[0]): midpoint = floor(boundary[0] / 2)
 * - Middle bins [boundary[i], boundary[i+1]): midpoint = floor((boundary[i] + boundary[i+1]) / 2)
 * - Last bin [boundary[last], infinity): representative = boundary[last] + 10
 *
 * @param boundaries - Quality score boundaries between bins (length = bins - 1)
 * @returns Array of representative scores (length = bins)
 *
 * @example
 * ```typescript
 * // 3-bin Illumina preset with boundaries [15, 30]
 * const reps = calculateRepresentatives([15, 30]);
 * // Returns [7, 22, 40]
 * // - Bin 0: [0-14]  → rep 7  (midpoint of 0 and 15)
 * // - Bin 1: [15-29] → rep 22 (midpoint of 15 and 30)
 * // - Bin 2: [30+]   → rep 40 (30 + 10)
 *
 * // 2-bin with boundary [20]
 * const reps = calculateRepresentatives([20]);
 * // Returns [10, 30]
 * // - Bin 0: [0-19] → rep 10
 * // - Bin 1: [20+]  → rep 30
 *
 * // 5-bin with boundaries [10, 20, 30, 35]
 * const reps = calculateRepresentatives([10, 20, 30, 35]);
 * // Returns [5, 15, 25, 32, 45]
 * ```
 */
export function calculateRepresentatives(boundaries: readonly number[]): number[] {
  if (boundaries.length === 0) {
    throw new Error("Boundaries array cannot be empty");
  }

  const representatives: number[] = [];

  // First bin: [0, boundaries[0])
  // Use midpoint between 0 and first boundary
  const firstBoundary = boundaries[0];
  if (firstBoundary === undefined) {
    throw new Error("First boundary is undefined");
  }
  representatives.push(Math.floor(firstBoundary / 2));

  // Middle bins: [boundaries[i], boundaries[i+1])
  // Use midpoint between consecutive boundaries
  for (let i = 0; i < boundaries.length - 1; i++) {
    const current = boundaries[i];
    const next = boundaries[i + 1];
    if (current === undefined || next === undefined) {
      throw new Error(`Boundary at index ${i} or ${i + 1} is undefined`);
    }
    const midpoint = Math.floor((current + next) / 2);
    representatives.push(midpoint);
  }

  // Last bin: [boundaries[last], infinity)
  // Use last boundary + fixed offset (10)
  // This assumes most high-quality scores cluster near boundaries[last]
  const lastBoundary = boundaries[boundaries.length - 1];
  if (lastBoundary === undefined) {
    throw new Error("Last boundary is undefined");
  }
  representatives.push(lastBoundary + 10);

  return representatives;
}

/**
 * Find which bin a quality score belongs to
 *
 * Performs linear search through boundaries to determine the bin index
 * for a given quality score. Scores below the first boundary go to bin 0,
 * scores above the last boundary go to the last bin.
 *
 * @param score - Quality score (0-93 for Phred, -5 to 62 for Solexa)
 * @param boundaries - Quality score boundaries between bins
 * @returns Bin index (0 to boundaries.length)
 *
 * @example
 * ```typescript
 * // 3-bin with boundaries [15, 30]
 * findBinIndex(10, [15, 30]);  // Returns 0 (score < 15)
 * findBinIndex(20, [15, 30]);  // Returns 1 (15 <= score < 30)
 * findBinIndex(35, [15, 30]);  // Returns 2 (score >= 30)
 *
 * // 2-bin with boundary [20]
 * findBinIndex(5, [20]);   // Returns 0 (score < 20)
 * findBinIndex(25, [20]);  // Returns 1 (score >= 20)
 *
 * // Edge cases
 * findBinIndex(0, [15, 30]);   // Returns 0 (minimum score)
 * findBinIndex(93, [15, 30]);  // Returns 2 (maximum phred score)
 * ```
 */
export function findBinIndex(score: number, boundaries: readonly number[]): number {
  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i];
    if (boundary === undefined) {
      throw new Error(`Boundary at index ${i} is undefined`);
    }
    if (score < boundary) {
      return i;
    }
  }
  // Score is >= last boundary, return last bin index
  return boundaries.length;
}

/**
 * Bin a quality string using the specified binning strategy
 *
 * Collapses quality scores by replacing each character with its bin's
 * representative score. This creates longer runs of identical characters
 * for improved compression.
 *
 * Process for each character:
 * 1. Convert ASCII character to numeric score (using encoding)
 * 2. Find which bin the score belongs to
 * 3. Get the representative score for that bin
 * 4. Convert representative score back to ASCII character
 *
 * @param qualityString - Original quality string from FASTQ
 * @param strategy - Binning configuration (boundaries, representatives, encoding)
 * @returns Binned quality string (same length as input)
 *
 * @example
 * ```typescript
 * // 3-bin Illumina strategy with boundaries [15, 30]
 * const strategy: BinningStrategy = {
 *   bins: 3,
 *   boundaries: [15, 30],
 *   representatives: [7, 22, 40],  // From calculateRepresentatives()
 *   encoding: 'phred33'
 * };
 *
 * // Original quality with mixed scores
 * const original = '!!!IIIIIII((((IIIII';
 * // Scores:     [0,0,0,40,40,40,40,40,40,7,7,7,7,40,40,40,40,40]
 *
 * const binned = binQualityString(original, strategy);
 * // Result: '((((((((((((((((((((('
 * // All low scores (<15) → bin 0 → rep 7 → '('
 * // All high scores (≥30) → bin 2 → rep 40 → 'I'
 * // Creates runs for better compression
 *
 * // 2-bin example
 * const strategy2 = {
 *   bins: 2,
 *   boundaries: [20],
 *   representatives: [10, 30],
 *   encoding: 'phred33'
 * };
 * binQualityString('!!!!IIII', strategy2);
 * // Returns '++++++??' (low → '+', high → '?')
 * ```
 */
export function binQualityString(qualityString: string, strategy: BinningStrategy): string {
  let result = "";

  for (const char of qualityString) {
    // Convert ASCII character to numeric quality score
    const score = charToScore(char, strategy.encoding);

    // Find which bin this score belongs to
    const binIndex = findBinIndex(score, strategy.boundaries);

    // Get the representative score for this bin
    const representative = strategy.representatives[binIndex];
    if (representative === undefined) {
      throw new Error(
        `No representative found for bin ${binIndex}. ` +
          `Expected ${strategy.bins} representatives, got ${strategy.representatives.length}.`,
      );
    }

    // Convert representative score back to ASCII character
    const binnedChar = scoreToChar(representative, strategy.encoding);
    result += binnedChar;
  }

  return result;
}

/**
 * Calculate distribution of scores across bins
 *
 * Counts how many quality scores fell into each bin. Useful for
 * understanding quality distribution and verifying binning behavior.
 *
 * @param qualityString - Original quality string from FASTQ
 * @param strategy - Binning configuration (boundaries, encoding)
 * @returns Array of counts per bin (length = bins)
 *
 * @example
 * ```typescript
 * const strategy: BinningStrategy = {
 *   bins: 3,
 *   boundaries: [15, 30],
 *   representatives: [7, 22, 40],
 *   encoding: 'phred33'
 * };
 *
 * // Quality string with 5 low, 10 medium, 5 high scores
 * const quality = '!!!!!(((((IIIII';
 * const distribution = calculateBinDistribution(quality, strategy);
 * // Returns [5, 10, 5]
 * //   Bin 0 (<15):  5 scores
 * //   Bin 1 (15-29): 10 scores
 * //   Bin 2 (≥30):  5 scores
 *
 * // 2-bin example
 * const strategy2 = { bins: 2, boundaries: [20], representatives: [10, 30], encoding: 'phred33' };
 * calculateBinDistribution('!!!!IIII', strategy2);
 * // Returns [4, 4] - 4 scores in each bin
 * ```
 */
export function calculateBinDistribution(
  qualityString: string,
  strategy: BinningStrategy,
): number[] {
  // Initialize count array with zeros for each bin
  const distribution = new Array(strategy.bins).fill(0);

  for (const char of qualityString) {
    // Convert ASCII character to numeric quality score
    const score = charToScore(char, strategy.encoding);

    // Find which bin this score belongs to
    const binIndex = findBinIndex(score, strategy.boundaries);

    // Increment count for this bin
    const currentCount = distribution[binIndex];
    if (currentCount === undefined) {
      throw new Error(
        `Invalid bin index ${binIndex} for ${strategy.bins} bins. ` +
          `This should never happen - please report this bug.`,
      );
    }
    distribution[binIndex] = currentCount + 1;
  }

  return distribution;
}

/**
 * Calculate compression ratio from binning
 *
 * Measures the reduction in unique characters achieved by binning.
 * Higher ratio indicates better compression potential.
 *
 * Formula: uniqueChars(original) / uniqueChars(binned)
 *
 * @param original - Original quality string before binning
 * @param binned - Quality string after binning
 * @returns Compression ratio (e.g., 2.0 = 2x improvement, 1.0 = no improvement)
 *
 * @example
 * ```typescript
 * // High entropy original with many unique characters
 * const original = '!"#$%&IIIIII';  // 7 unique chars
 * const binned = '((((((IIIIII';    // 2 unique chars
 * const ratio = calculateCompressionRatio(original, binned);
 * // Returns 3.5 (7 / 2 = 3.5x improvement)
 *
 * // More realistic example
 * const original2 = 'ABCDEFGHIJ';   // 10 unique quality chars
 * const binned2 = 'AAAAIIIIII';     // 2 unique chars (A and I)
 * calculateCompressionRatio(original2, binned2);
 * // Returns 5.0 (10 / 2 = 5x improvement)
 *
 * // Edge case: already uniform quality
 * const original3 = 'IIIIIIIIII';   // 1 unique char
 * const binned3 = 'IIIIIIIIII';     // 1 unique char
 * calculateCompressionRatio(original3, binned3);
 * // Returns 1.0 (no improvement possible)
 * ```
 */
export function calculateCompressionRatio(original: string, binned: string): number {
  // Count unique characters in original string
  const originalUnique = new Set(original).size;

  // Count unique characters in binned string
  const binnedUnique = new Set(binned).size;

  // Avoid division by zero - if binned has no unique chars, ratio is undefined
  if (binnedUnique === 0) {
    return 1.0; // No compression (degenerate case)
  }

  // Calculate ratio: higher = better compression
  return originalUnique / binnedUnique;
}
