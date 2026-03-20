/**
 * Comprehensive sequence statistics calculation for SeqOps
 *
 * This module provides statistical analysis functionality that mirrors
 * the `seqkit stats` command, offering comprehensive metrics for both
 * FASTA and FASTQ sequences including N50, GC content, and quality statistics.
 *
 * Key features:
 * - N50/N90 calculation with efficient algorithms
 * - GC content and composition analysis
 * - Quality score statistics for FASTQ files
 * - Streaming computation for memory efficiency
 * - Real-time statistics updates during processing
 *
 */

import { type } from "arktype";
import { getBackend } from "../backend";
import { SequenceError, ValidationError } from "../errors";
import { GenotypeString, CharSet } from "../genotype-string";
import {
  packSequences,
  NUM_CLASSES,
  CLASS_A,
  CLASS_T,
  CLASS_U,
  CLASS_G,
  CLASS_C,
  CLASS_N,
  CLASS_STRONG,
  CLASS_WEAK,
  CLASS_TWO_BASE,
  CLASS_BDHV,
  CLASS_GAP,
  CLASS_OTHER,
} from "../native";
import type {
  AbstractSequence,
  FASTXSequence,
  QualityEncoding,
  QualityScoreBearing,
} from "../types";
import { charToScore } from "./core/quality";

/** Byte budget per native batch. Sequences accumulate until this threshold. */
const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

/**
 * Comprehensive sequence statistics result
 *
 * Contains all statistical metrics calculated from a set of sequences,
 * including length distributions, composition analysis, and quality metrics.
 */
export interface SequenceStats {
  /** File or data source identifier */
  readonly file?: string;
  /** Detected format of sequences */
  readonly format: "FASTA" | "FASTQ" | "Mixed" | "Unknown";
  /** Inferred sequence type based on content */
  readonly type: "DNA" | "RNA" | "Protein" | "Unknown";
  /** Total number of sequences processed */
  readonly numSequences: number;
  /** Sum of all sequence lengths */
  readonly totalLength: number;
  /** Shortest sequence length */
  readonly minLength: number;
  /** Longest sequence length */
  readonly maxLength: number;
  /** Average sequence length */
  readonly avgLength: number;

  // Advanced statistics
  /** N50 - length where 50% of bases are in sequences >= this length */
  readonly n50?: number;
  /** N90 - length where 90% of bases are in sequences >= this length */
  readonly n90?: number;
  /** First quartile length */
  readonly q1Length?: number;
  /** Median length (second quartile) */
  readonly q2Length?: number;
  /** Third quartile length */
  readonly q3Length?: number;

  // Composition statistics
  /** Overall GC content (0.0 to 1.0) */
  readonly gcContent?: number;
  /** Number of gap characters (-, ., *) */
  readonly gapCount?: number;
  /** Number of ambiguous bases (N, R, Y, etc.) */
  readonly ambiguousCount?: number;
  /** Base composition counts */
  readonly baseComposition?: {
    readonly A: number;
    readonly T: number;
    readonly G: number;
    readonly C: number;
    readonly U: number;
    readonly N: number;
    readonly other: number;
  };

  // FASTQ-specific statistics
  /** Average quality score across all bases */
  readonly avgQuality?: number;
  /** Minimum quality score found */
  readonly minQuality?: number;
  /** Maximum quality score found */
  readonly maxQuality?: number;
  /** Percentage of bases with quality >= 20 */
  readonly q20Percentage?: number;
  /** Percentage of bases with quality >= 30 */
  readonly q30Percentage?: number;
  /** Mean per-base error probability computed in probability space: mean(10^(-Q/10)) */
  readonly meanErrorRate?: number;
  /** Quality encoding detected or specified */
  readonly qualityEncoding?: QualityEncoding;
}

/**
 * Configuration options for statistics calculation
 *
 * Controls which statistics are computed and how they are formatted.
 */
export interface StatsOptions {
  /** Calculate detailed statistics including N50/N90 (slower) */
  detailed?: boolean;
  /** Output in tabular format for command-line display */
  tabular?: boolean;
  /** Include quality statistics for FASTQ sequences */
  includeQuality?: boolean;
  /** Characters considered as gaps (default: "-.*") */
  gapChars?: string;
  /** Characters considered as ambiguous (default: "NRYSWKMBDHV") */
  ambiguousChars?: string;
  /** Calculate base composition breakdown */
  includeComposition?: boolean;
  /** File path or identifier for the statistics */
  fileName?: string;
}

/**
 * Internal statistics accumulator for streaming calculation
 * Maintains running totals and distributions during processing
 */
interface StatsAccumulator {
  count: number;
  totalLength: number;
  minLength: number;
  maxLength: number;
  lengths: number[];

  // Composition tracking
  gcCount: number;
  atCount: number;
  gapCount: number;
  ambiguousCount: number;
  baseComposition: {
    A: number;
    T: number;
    G: number;
    C: number;
    U: number;
    N: number;
    other: number;
  };

  // Quality tracking (FASTQ)
  totalQuality: number;
  qualityCount: number;
  minQuality: number;
  maxQuality: number;
  q20Count: number;
  q30Count: number;
  errorProbabilitySum: number;

  // Format detection
  hasFasta: boolean;
  hasFastq: boolean;
  hasProtein: boolean;
  hasRNA: boolean;
  qualityEncoding?: QualityEncoding | undefined;
}

/**
 * ArkType schema for StatsOptions validation with genomics-specific constraints
 */
const StatsOptionsSchema = type({
  "detailed?": "boolean",
  "tabular?": "boolean",
  "includeQuality?": "boolean",
  "gapChars?": "string",
  "ambiguousChars?": "string",
  "includeComposition?": "boolean",
  "fileName?": "string",
}).narrow((options, ctx) => {
  // Validate gap characters are reasonable
  if (options.gapChars && options.gapChars.length === 0) {
    return ctx.reject({
      expected: "non-empty gap characters string",
      path: ["gapChars"],
      description: "Gap characters cannot be empty string",
    });
  }

  // Validate ambiguous characters are valid IUPAC codes
  if (options.ambiguousChars && !/^[NRYSWKMBDHV]*$/i.test(options.ambiguousChars)) {
    return ctx.reject({
      expected: "valid IUPAC ambiguity codes",
      actual: options.ambiguousChars,
      path: ["ambiguousChars"],
      description: "Use characters like N, R, Y, S, W, K, M, B, D, H, V",
    });
  }

  return true;
});

/**
 * High-performance sequence statistics calculator with streaming support
 *
 * Calculates comprehensive statistics from sequences while maintaining
 * constant memory usage through streaming computation where possible.
 *
 * @example
 * ```typescript
 * // Basic statistics
 * const calculator = new SequenceStatsCalculator();
 * const stats = await calculator.calculateStats(sequences);
 * console.log(`N50: ${stats.n50}, GC: ${stats.gcContent}%`);
 *
 * // Detailed statistics with quality
 * const detailedStats = await calculator.calculateStats(sequences, {
 *   detailed: true,
 *   includeQuality: true,
 *   includeComposition: true
 * });
 *
 * // Tabular output for command-line
 * const tableStats = await calculator.calculateStats(sequences, {
 *   tabular: true,
 *   fileName: 'genome.fasta'
 * });
 * ```
 */
export class SequenceStatsCalculator {
  private readonly defaultOptions = {
    detailed: false,
    tabular: false,
    includeQuality: true,
    gapChars: "-.*",
    ambiguousChars: "NRYSWKMBDHV",
    includeComposition: false,
  } satisfies Omit<Required<StatsOptions>, "fileName">;

  /**
   * Calculate comprehensive sequence statistics
   *
   * Processes sequences through a single pass, computing all requested
   * statistics while maintaining memory efficiency.
   *
   * @param sequences - Input sequences to analyze
   * @param options - Configuration options for statistics
   * @returns Comprehensive statistics result
   *
   * @example
   * ```typescript
   * const stats = await calculator.calculateStats(sequences, {
   *   detailed: true,
   *   includeComposition: true
   * });
   * ```
   */
  async calculateStats(
    sequences: AsyncIterable<AbstractSequence | FASTXSequence>,
    options: StatsOptions = {}
  ): Promise<SequenceStats> {
    // Validate options with ArkType
    const validationResult = StatsOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(
        `Invalid statistics options: ${validationResult.summary}`,
        undefined,
        "Check gap characters and ambiguous character patterns"
      );
    }

    const opts = {
      detailed: options.detailed ?? this.defaultOptions.detailed,
      tabular: options.tabular ?? this.defaultOptions.tabular,
      includeQuality: options.includeQuality ?? this.defaultOptions.includeQuality,
      gapChars: options.gapChars ?? this.defaultOptions.gapChars,
      ambiguousChars: options.ambiguousChars ?? this.defaultOptions.ambiguousChars,
      includeComposition: options.includeComposition ?? this.defaultOptions.includeComposition,
      fileName: options.fileName,
    };
    const accumulator = this.createAccumulator();

    const useKernel =
      opts.gapChars === this.defaultOptions.gapChars &&
      opts.ambiguousChars === this.defaultOptions.ambiguousChars;
    const backend = useKernel ? await getBackend() : undefined;

    try {
      let batch: AbstractSequence[] = [];
      let batchBytes = 0;

      for await (const sequence of sequences) {
        this.processSequenceBookkeeping(sequence, accumulator, opts);

        if (backend?.classifyBatch !== undefined) {
          batch.push(sequence);
          batchBytes += sequence.sequence.length;
          if (batchBytes >= BATCH_BYTE_BUDGET) {
            await flushClassifyBatch(batch, backend, accumulator, opts.includeComposition);
            batch = [];
            batchBytes = 0;
          }
        } else {
          this.analyzeComposition(sequence.sequence, accumulator, opts);
        }
      }

      if (backend?.classifyBatch !== undefined && batch.length > 0) {
        await flushClassifyBatch(batch, backend, accumulator, opts.includeComposition);
      }

      return this.finalizeStatistics(accumulator, opts);
    } catch (error) {
      throw new SequenceError(
        `Statistics calculation failed: ${error instanceof Error ? error.message : String(error)}`,
        "<statistics>",
        undefined,
        `Processed ${accumulator.count} sequences before error`
      );
    }
  }

  /**
   * Calculate N50, N90, and other percentile metrics
   *
   * N50 is the sequence length where 50% of the total bases are in
   * sequences of this length or longer. This is a key metric for
   * genome assembly quality assessment.
   *
   * @param lengths - Array of sequence lengths (will be sorted)
   * @param percentile - Target percentile (50 for N50, 90 for N90)
   * @returns The NX value
   *
   * @example
   * ```typescript
   * const lengths = [100, 200, 300, 400, 500];
   * const n50 = calculator.calculateNX(lengths, 50);
   * const n90 = calculator.calculateNX(lengths, 90);
   * ```
   */
  calculateNX(lengths: number[], percentile: number): number {
    // Tiger Style: Assert preconditions
    if (lengths.length === 0) {
      return 0;
    }
    if (percentile < 0 || percentile > 100) {
      throw new Error(`Invalid percentile: ${percentile} (must be 0-100)`);
    }

    // Sort lengths in descending order
    const sorted = [...lengths].sort((a, b) => b - a);
    const totalLength = sorted.reduce((sum, len) => sum + len, 0);
    const targetLength = totalLength * (percentile / 100);

    let cumulativeLength = 0;
    for (const length of sorted) {
      cumulativeLength += length;
      if (cumulativeLength >= targetLength) {
        return length;
      }
    }

    return sorted[sorted.length - 1] ?? 0;
  }

  /**
   * Calculate quality statistics for FASTQ sequences
   *
   * Computes mean, min, max, and percentile-based quality metrics
   * from quality strings using the appropriate encoding.
   *
   * @param qualities - Array of quality strings
   * @param encoding - Quality encoding system
   * @returns Quality statistics
   */
  calculateQualityStats(
    qualities: string[],
    encoding: QualityEncoding
  ): {
    mean: number;
    min: number;
    max: number;
    q20Percentage: number;
    q30Percentage: number;
    meanErrorRate: number;
  } {
    if (qualities.length === 0) {
      return { mean: 0, min: 0, max: 0, q20Percentage: 0, q30Percentage: 0, meanErrorRate: 0 };
    }

    let totalScore = 0;
    let totalBases = 0;
    let minScore = Infinity;
    let maxScore = -Infinity;
    let q20Count = 0;
    let q30Count = 0;
    let errorProbabilitySum = 0;

    for (const qualityString of qualities) {
      for (const char of qualityString) {
        const score = charToScore(char, encoding);
        totalScore += score;
        totalBases++;
        minScore = Math.min(minScore, score);
        maxScore = Math.max(maxScore, score);

        if (score >= 20) q20Count++;
        if (score >= 30) q30Count++;
        errorProbabilitySum += 10 ** (-score / 10);
      }
    }

    return {
      mean: totalBases > 0 ? totalScore / totalBases : 0,
      min: minScore === Infinity ? 0 : minScore,
      max: maxScore === -Infinity ? 0 : maxScore,
      q20Percentage: totalBases > 0 ? (q20Count / totalBases) * 100 : 0,
      q30Percentage: totalBases > 0 ? (q30Count / totalBases) * 100 : 0,
      meanErrorRate: totalBases > 0 ? errorProbabilitySum / totalBases : 0,
    };
  }

  /**
   * Create a new statistics accumulator
   * @private
   */
  private createAccumulator(): StatsAccumulator {
    return {
      count: 0,
      totalLength: 0,
      minLength: Infinity,
      maxLength: -Infinity,
      lengths: [],

      gcCount: 0,
      atCount: 0,
      gapCount: 0,
      ambiguousCount: 0,
      baseComposition: {
        A: 0,
        T: 0,
        G: 0,
        C: 0,
        U: 0,
        N: 0,
        other: 0,
      },

      totalQuality: 0,
      qualityCount: 0,
      minQuality: Infinity,
      maxQuality: -Infinity,
      q20Count: 0,
      q30Count: 0,
      errorProbabilitySum: 0,

      hasFasta: false,
      hasFastq: false,
      hasProtein: false,
      hasRNA: false,
      qualityEncoding: undefined,
    };
  }

  /**
   * Process per-sequence bookkeeping that doesn't touch sequence content.
   *
   * Length stats, format detection, and quality scoring are cheap and stay
   * per-sequence. Composition analysis is handled separately — either by
   * the batched classify kernel or by the TS analyzeComposition fallback.
   * @private
   */
  private processSequenceBookkeeping(
    sequence: AbstractSequence | FASTXSequence,
    accumulator: StatsAccumulator,
    options: {
      detailed: boolean;
      includeQuality: boolean;
    }
  ): void {
    accumulator.count++;
    accumulator.totalLength += sequence.length;
    accumulator.minLength = Math.min(accumulator.minLength, sequence.length);
    accumulator.maxLength = Math.max(accumulator.maxLength, sequence.length);

    if (options.detailed) {
      accumulator.lengths.push(sequence.length);
    }

    this.detectFormat(sequence, accumulator);

    if (this.isQualityScoreBearing(sequence) && options.includeQuality) {
      this.processQuality(sequence, accumulator);
    }
  }

  /**
   * Analyze sequence composition (GC content, gaps, etc.)
   * @private
   */
  private analyzeComposition(
    sequence: GenotypeString | string,
    accumulator: StatsAccumulator,
    options: {
      gapChars: string;
      ambiguousChars: string;
      includeComposition: boolean;
    }
  ): void {
    const upper = GenotypeString.fromString(sequence).toUpperCase();
    const gapSet = CharSet.from(options.gapChars);
    const ambigSet = CharSet.from(options.ambiguousChars);
    const proteinSet = CharSet.from("DEFHIKLMPQVWY");

    for (let i = 0; i < upper.length; i++) {
      if (upper.is(i, "G") || upper.is(i, "C")) {
        accumulator.gcCount++;
        if (options.includeComposition) {
          const ch = upper.charAt(i) as "G" | "C";
          accumulator.baseComposition[ch]++;
        }
      } else if (upper.is(i, "A") || upper.is(i, "T")) {
        accumulator.atCount++;
        if (options.includeComposition) {
          const ch = upper.charAt(i) as "A" | "T";
          accumulator.baseComposition[ch]++;
        }
      } else if (upper.is(i, "U")) {
        accumulator.atCount++;
        accumulator.hasRNA = true;
        if (options.includeComposition) {
          accumulator.baseComposition.U++;
        }
      } else if (upper.is(i, "N")) {
        accumulator.ambiguousCount++;
        if (options.includeComposition) {
          accumulator.baseComposition.N++;
        }
      } else {
        if (upper.isAnyOf(i, gapSet)) {
          accumulator.gapCount++;
        } else if (upper.isAnyOf(i, ambigSet)) {
          accumulator.ambiguousCount++;
        } else if (upper.isAnyOf(i, proteinSet)) {
          accumulator.hasProtein = true;
        }
        if (options.includeComposition) {
          accumulator.baseComposition.other++;
        }
      }
    }
  }

  /**
   * Detect sequence format and type
   * @private
   */
  private detectFormat(
    sequence: AbstractSequence | FASTXSequence,
    accumulator: StatsAccumulator
  ): void {
    if (this.isQualityScoreBearing(sequence)) {
      accumulator.hasFastq = true;
      if (!accumulator.qualityEncoding) {
        accumulator.qualityEncoding = sequence.qualityEncoding;
      }
    } else {
      accumulator.hasFasta = true;
    }
  }

  /**
   * Process quality scores for FASTQ sequences
   * @private
   */
  private processQuality(
    sequence: AbstractSequence & QualityScoreBearing,
    accumulator: StatsAccumulator
  ): void {
    const quality = sequence.quality;
    const encoding = sequence.qualityEncoding;

    for (const char of quality) {
      const score = charToScore(char, encoding);

      accumulator.totalQuality += score;
      accumulator.qualityCount++;
      accumulator.minQuality = Math.min(accumulator.minQuality, score);
      accumulator.maxQuality = Math.max(accumulator.maxQuality, score);

      if (score >= 20) accumulator.q20Count++;
      if (score >= 30) accumulator.q30Count++;
      accumulator.errorProbabilitySum += 10 ** (-score / 10);
    }
  }

  /**
   * Calculate final statistics from accumulated data
   * @private
   */
  private finalizeStatistics(
    accumulator: StatsAccumulator,
    options: {
      fileName?: string | undefined;
      detailed: boolean;
      includeComposition: boolean;
      includeQuality: boolean;
    }
  ): SequenceStats {
    // Handle empty input
    if (accumulator.count === 0) {
      return this.createEmptyStats(options.fileName);
    }

    // Build statistics object with all computed values
    const stats: SequenceStats = {
      ...(options.fileName && { file: options.fileName }),
      format: this.determineFormat(accumulator),
      type: this.determineType(accumulator),
      numSequences: accumulator.count,
      totalLength: accumulator.totalLength,
      minLength: accumulator.minLength === Infinity ? 0 : accumulator.minLength,
      maxLength: accumulator.maxLength === -Infinity ? 0 : accumulator.maxLength,
      avgLength: accumulator.totalLength / accumulator.count,

      // Add detailed statistics if requested
      ...(options.detailed &&
        accumulator.lengths.length > 0 && {
          n50: this.calculateNX(accumulator.lengths, 50),
          n90: this.calculateNX(accumulator.lengths, 90),
          q1Length: (() => {
            const sorted = [...accumulator.lengths].sort((a, b) => a - b);
            return sorted[Math.floor(accumulator.lengths.length * 0.25)] ?? 0;
          })(),
          q2Length: (() => {
            const sorted = [...accumulator.lengths].sort((a, b) => a - b);
            return sorted[Math.floor(accumulator.lengths.length * 0.5)] ?? 0;
          })(),
          q3Length: (() => {
            const sorted = [...accumulator.lengths].sort((a, b) => a - b);
            return sorted[Math.floor(accumulator.lengths.length * 0.75)] ?? 0;
          })(),
        }),

      // Add composition statistics
      ...(accumulator.totalLength > 0 && {
        ...(accumulator.gcCount + accumulator.atCount > 0 && {
          gcContent: accumulator.gcCount / (accumulator.gcCount + accumulator.atCount),
        }),
        gapCount: accumulator.gapCount,
        ambiguousCount: accumulator.ambiguousCount,
        ...(options.includeComposition && {
          baseComposition: { ...accumulator.baseComposition },
        }),
      }),

      // Add quality statistics if FASTQ
      ...(accumulator.hasFastq &&
        options.includeQuality &&
        accumulator.qualityCount > 0 &&
        accumulator.qualityEncoding !== undefined && {
          avgQuality: accumulator.totalQuality / accumulator.qualityCount,
          minQuality: accumulator.minQuality === Infinity ? 0 : accumulator.minQuality,
          maxQuality: accumulator.maxQuality === -Infinity ? 0 : accumulator.maxQuality,
          q20Percentage: (accumulator.q20Count / accumulator.qualityCount) * 100,
          q30Percentage: (accumulator.q30Count / accumulator.qualityCount) * 100,
          meanErrorRate: accumulator.errorProbabilitySum / accumulator.qualityCount,
          qualityEncoding: accumulator.qualityEncoding,
        }),
    };

    return stats;
  }

  /**
   * Determine overall format from accumulated data
   * @private
   */
  private determineFormat(accumulator: StatsAccumulator): "FASTA" | "FASTQ" | "Mixed" | "Unknown" {
    if (accumulator.hasFasta && accumulator.hasFastq) {
      return "Mixed";
    }
    if (accumulator.hasFastq) {
      return "FASTQ";
    }
    if (accumulator.hasFasta) {
      return "FASTA";
    }
    return "Unknown";
  }

  /**
   * Determine sequence type from accumulated data
   * @private
   */
  private determineType(accumulator: StatsAccumulator): "DNA" | "RNA" | "Protein" | "Unknown" {
    if (accumulator.hasProtein) {
      return "Protein";
    }
    if (accumulator.hasRNA) {
      return "RNA";
    }
    if (accumulator.gcCount > 0 || accumulator.atCount > 0) {
      return "DNA";
    }
    return "Unknown";
  }

  /**
   * Create empty statistics result
   * @private
   */
  private createEmptyStats(fileName?: string | undefined): SequenceStats {
    return {
      ...(fileName && { file: fileName }),
      format: "Unknown",
      type: "Unknown",
      numSequences: 0,
      totalLength: 0,
      minLength: 0,
      maxLength: 0,
      avgLength: 0,
    };
  }

  /**
   * Type guard to check if sequence is FASTQ
   * @private
   */
  private isQualityScoreBearing(
    sequence: AbstractSequence | FASTXSequence
  ): sequence is (AbstractSequence | FASTXSequence) & QualityScoreBearing {
    return (
      "quality" in sequence &&
      "qualityEncoding" in sequence &&
      sequence.quality !== undefined &&
      sequence.qualityEncoding !== undefined
    );
  }
}

/**
 * Pack a batch of sequences, run the classify kernel, and fold the
 * 12-class counts into the stats accumulator.
 */
async function flushClassifyBatch(
  batch: AbstractSequence[],
  backend: Awaited<ReturnType<typeof getBackend>>,
  accumulator: StatsAccumulator,
  includeComposition: boolean
): Promise<void> {
  const { data, offsets } = packSequences(batch);
  const result = await backend.classifyBatch!(data, offsets);
  const counts = result.counts;

  for (let i = 0; i < batch.length; i++) {
    const base = i * NUM_CLASSES;
    const a = counts[base + CLASS_A]!;
    const t = counts[base + CLASS_T]!;
    const u = counts[base + CLASS_U]!;
    const g = counts[base + CLASS_G]!;
    const c = counts[base + CLASS_C]!;
    const n = counts[base + CLASS_N]!;
    const s = counts[base + CLASS_STRONG]!;
    const w = counts[base + CLASS_WEAK]!;
    const tb = counts[base + CLASS_TWO_BASE]!;
    const bdhv = counts[base + CLASS_BDHV]!;
    const gap = counts[base + CLASS_GAP]!;
    const other = counts[base + CLASS_OTHER]!;

    accumulator.gcCount += g + c;
    accumulator.atCount += a + t + u;
    accumulator.gapCount += gap;
    accumulator.ambiguousCount += n + s + w + tb + bdhv;

    if (u > 0) accumulator.hasRNA = true;

    if (other > 0 && !accumulator.hasProtein) {
      scanForProtein(batch[i]!, accumulator);
    }

    if (includeComposition) {
      accumulator.baseComposition.A += a;
      accumulator.baseComposition.T += t;
      accumulator.baseComposition.G += g;
      accumulator.baseComposition.C += c;
      accumulator.baseComposition.U += u;
      accumulator.baseComposition.N += n;
      accumulator.baseComposition.other += s + w + tb + bdhv + gap + other;
    }
  }
}

/**
 * Scan a sequence's raw bytes for protein-specific amino acid letters.
 *
 * Only called when the classify kernel reports non-zero Other count for a
 * sequence, which means it contains bytes outside the nucleotide+IUPAC+gap
 * alphabet. This function checks for E, F, I, L, P, Q — the amino acids
 * that are NOT also IUPAC nucleotide ambiguity codes. Early-exits on the
 * first match.
 */
function scanForProtein(seq: AbstractSequence, accumulator: StatsAccumulator): void {
  const bytes = seq.sequence.toBytes();
  for (let i = 0; i < bytes.length; i++) {
    const upper = bytes[i]! & ~0x20;
    if (
      upper === 0x45 ||
      upper === 0x46 ||
      upper === 0x49 ||
      upper === 0x4c ||
      upper === 0x50 ||
      upper === 0x51
    ) {
      accumulator.hasProtein = true;
      return;
    }
  }
}

/**
 * Create a statistics calculator with convenient defaults
 *
 * @param options - Default options for all calculations
 * @returns Configured SequenceStatsCalculator instance
 *
 * @example
 * ```typescript
 * const calculator = createStatsCalculator({ detailed: true });
 * const stats = await calculator.calculateStats(sequences);
 * ```
 */
export function createStatsCalculator(options: StatsOptions = {}): SequenceStatsCalculator {
  const calculator = new SequenceStatsCalculator();
  // Note: Options would be used to configure calculator behavior
  // Currently calculator is stateless but could be enhanced to use options
  if (options.detailed !== undefined) {
    console.debug(`Stats calculator created with detailed=${options.detailed} mode`);
  }
  return calculator;
}

/**
 * Calculate statistics from sequences directly
 *
 * @param sequences - Input sequences
 * @param options - Statistics options
 * @returns Calculated statistics
 *
 * @example
 * ```typescript
 * const stats = await calculateSequenceStats(sequences, {
 *   detailed: true,
 *   includeQuality: true
 * });
 * console.log(`N50: ${stats.n50}`);
 * ```
 */
export async function calculateSequenceStats(
  sequences: AsyncIterable<AbstractSequence | FASTXSequence>,
  options: StatsOptions = {}
): Promise<SequenceStats> {
  const calculator = new SequenceStatsCalculator();
  return calculator.calculateStats(sequences, options);
}

/**
 * Format statistics for tabular display
 *
 * @param stats - Statistics to format
 * @returns Formatted string for console output
 *
 * @example
 * ```typescript
 * const stats = await calculateSequenceStats(sequences);
 * console.log(formatStatsTable(stats));
 * ```
 */
export function formatStatsTable(stats: SequenceStats): string {
  const lines: string[] = [];

  lines.push("File\tFormat\tType\tNum_seqs\tSum_len\tMin_len\tMax_len\tAvg_len");

  const row = [
    stats.file ?? "-",
    stats.format,
    stats.type,
    stats.numSequences.toString(),
    stats.totalLength.toString(),
    stats.minLength.toString(),
    stats.maxLength.toString(),
    stats.avgLength.toFixed(1),
  ];

  if (stats.n50 !== undefined) {
    lines[0] += "\tN50";
    row.push(stats.n50.toString());
  }

  if (stats.gcContent !== undefined) {
    lines[0] += "\tGC%";
    row.push((stats.gcContent * 100).toFixed(2));
  }

  if (stats.avgQuality !== undefined) {
    lines[0] += "\tAvg_qual";
    row.push(stats.avgQuality.toFixed(1));
  }

  lines.push(row.join("\t"));

  return lines.join("\n");
}
