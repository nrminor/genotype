/**
 * QualityProcessor - FASTQ quality score operations
 *
 * This processor implements quality-based filtering and trimming
 * for FASTQ sequences. The type system guarantees that only FASTQ
 * sequences reach the processor (via the SeqOps.quality() constraint).
 *
 * When average quality filtering is active (minScore/maxScore), the
 * processor batches sequences and delegates to the native SIMD kernel
 * for the average quality computation. Trimming and binning are still
 * per-sequence (steps 3 and 4 of the quality wiring plan will batch
 * those too).
 */

import { withQuality, withSequence } from "../constructors";
import { type NativeKernel, getNativeKernel, packQualityStrings } from "../native";
import type { AbstractSequence, FastqSequence, QualityEncoding } from "../types";
import { findQualityTrimEnd, findQualityTrimStart } from "./core/calculations";
import {
  type BinningStrategy,
  calculateRepresentatives,
  binQualityString as coreBinQualityString,
  PRESETS,
} from "./core/quality/binning";
import { detectEncoding } from "./core/quality/detection";
import { getEncodingInfo } from "./core/quality/encoding-info";
import { calculateAverageQuality } from "./core/quality/statistics";
import type { Processor, QualityOptions } from "./types";

/**
 * Processor for FASTQ quality operations
 *
 * @example
 * ```typescript
 * const processor = new QualityProcessor();
 * const filtered = processor.process(sequences, {
 *   minScore: 20,
 *   trim: true,
 *   trimThreshold: 20,
 *   trimWindow: 4
 * });
 * ```
 */
/** Byte budget per native batch. Sequences accumulate until this threshold. */
const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

/**
 * Processor for FASTQ quality operations
 *
 * @example
 * ```typescript
 * const processor = new QualityProcessor();
 * const filtered = processor.process(sequences, {
 *   minScore: 20,
 *   trim: true,
 *   trimThreshold: 20,
 *   trimWindow: 4
 * });
 * ```
 */
export class QualityProcessor implements Processor<QualityOptions> {
  /**
   * Process sequences with quality operations
   *
   * When average quality filtering is active (minScore/maxScore), sequences
   * accumulate into batches for the native SIMD quality average kernel.
   * Trimming is applied per-sequence before batching; binning is applied
   * per-sequence after the batch filter.
   *
   * @param source - Input sequences
   * @param options - Quality options
   * @yields Sequences after quality filtering/trimming
   */
  async *process(
    source: AsyncIterable<FastqSequence>,
    options: QualityOptions
  ): AsyncIterable<FastqSequence> {
    const needsAvgQuality =
      options.minScore !== undefined || options.maxScore !== undefined;
    const kernel = needsAvgQuality ? getNativeKernel() : undefined;

    if (kernel === undefined) {
      for await (const seq of source) {
        const processed = this.processQuality(seq, options);
        if (processed) {
          yield processed;
        }
      }
      return;
    }

    const encoding = options.encoding ?? "phred33";
    let batch: FastqSequence[] = [];
    let batchBytes = 0;

    for await (const seq of source) {
      const candidate = applyTrim(seq, options, encoding);
      if (candidate === null) continue;

      batch.push(candidate);
      batchBytes += candidate.quality.length;
      if (batchBytes >= BATCH_BYTE_BUDGET) {
        yield* flushQualityBatch(batch, kernel, options, encoding);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* flushQualityBatch(batch, kernel, options, encoding);
    }
  }

  /**
   * Per-sequence fallback when the native kernel is unavailable.
   * Applies trim, average quality filter, and binning in sequence.
   */
  private processQuality(seq: FastqSequence, options: QualityOptions): FastqSequence | null {
    const encoding = options.encoding ?? "phred33";

    let candidate = applyTrim(seq, options, encoding);
    if (candidate === null) return null;

    if (options.minScore !== undefined || options.maxScore !== undefined) {
      const avgQuality = calculateAverageQuality(candidate.quality, encoding);
      if (options.minScore !== undefined && avgQuality < options.minScore) return null;
      if (options.maxScore !== undefined && avgQuality > options.maxScore) return null;
    }

    return applyBinning(candidate, options);
  }
}

/**
 * Apply quality trimming to a sequence, returning the (possibly modified)
 * FastqSequence or null if trimming consumed the entire sequence.
 */
function applyTrim(
  seq: FastqSequence,
  options: QualityOptions,
  encoding: QualityEncoding
): FastqSequence | null {
  if (options.trim !== true) return seq;

  const seqStr = seq.sequence.toString();
  const qualStr = seq.quality.toString();
  const threshold = options.trimThreshold ?? 20;
  const windowSize = options.trimWindow ?? 4;
  const fromStart = options.trimFromStart ?? true;
  const fromEnd = options.trimFromEnd ?? true;

  let start = 0;
  let end = seqStr.length;

  if (fromStart) {
    start = findQualityTrimStart(qualStr, threshold, windowSize, encoding);
  }
  if (fromEnd && start < end) {
    end = findQualityTrimEnd(qualStr, threshold, windowSize, encoding, start);
  }
  if (start >= end) return null;

  if (start === 0 && end === seqStr.length) return seq;

  let result = withSequence(seq, seqStr.slice(start, end));
  result = withQuality(result, qualStr.slice(start, end));
  return result;
}

/**
 * Run the quality average kernel on a batch of (post-trim) sequences,
 * filter by minScore/maxScore, then apply binning to survivors.
 */
function* flushQualityBatch(
  batch: FastqSequence[],
  kernel: NativeKernel,
  options: QualityOptions,
  encoding: QualityEncoding
): Iterable<FastqSequence> {
  const { data, offsets } = packQualityStrings(batch);
  const { offset } = getEncodingInfo(encoding);
  const averages = kernel.qualityAvgBatch(data, offsets, offset);

  for (let i = 0; i < batch.length; i++) {
    const avg = averages[i]!;
    if (options.minScore !== undefined && avg < options.minScore) continue;
    if (options.maxScore !== undefined && avg > options.maxScore) continue;

    yield applyBinning(batch[i]!, options);
  }
}

/**
 * Apply quality binning to a sequence if binning options are present.
 * Returns the sequence unchanged if no binning is configured.
 *
 * @throws Error wrapping the original error with the sequence ID for
 *   diagnostic context (e.g. invalid preset, malformed boundaries).
 */
function applyBinning(seq: FastqSequence, options: QualityOptions): FastqSequence {
  if (!("bins" in options)) return seq;

  try {
    const qualStr = seq.quality.toString();
    const strategy = resolveBinningStrategy(options as BinQualityOptions, qualStr);
    const binned = coreBinQualityString(qualStr, strategy);
    return withQuality(seq, binned);
  } catch (error) {
    throw new Error(
      `Failed to bin quality for sequence '${seq.id}': ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Type-safe boundary arrays for compile-time validation
 *
 * Ensures boundaries array length matches the number of bins at compile time.
 *
 * @example
 * ```typescript
 * const boundaries2: BoundariesForBins<2> = [20];        // ✅ Valid
 * const boundaries3: BoundariesForBins<3> = [15, 30];    // ✅ Valid
 * const boundaries5: BoundariesForBins<5> = [10, 20, 30, 35]; // ✅ Valid
 *
 * // const invalid: BoundariesForBins<3> = [20];          // ❌ Compile error
 * ```
 */
export type BoundariesForBins<N extends 2 | 3 | 5> = N extends 2
  ? readonly [number]
  : N extends 3
    ? readonly [number, number]
    : readonly [number, number, number, number];

/**
 * Options for quality score binning operation
 *
 * Discriminated union for type-safe binning configuration. Either specify
 * a platform preset OR custom boundaries, but not both.
 *
 * @example Platform preset usage (90% use case)
 * ```typescript
 * // Illumina data with 3 bins
 * const options: BinQualityOptions = {
 *   bins: 3,
 *   preset: 'illumina'
 * };
 *
 * // PacBio data with 2 bins
 * const options: BinQualityOptions = {
 *   bins: 2,
 *   preset: 'pacbio',
 *   preserveOriginal: true
 * };
 * ```
 *
 * @example Custom boundaries (9% use case)
 * ```typescript
 * // Custom 3-bin boundaries
 * const options: BinQualityOptions = {
 *   bins: 3,
 *   boundaries: [18, 28]  // Compile-time enforced length
 * };
 *
 * // Custom with explicit encoding
 * const options: BinQualityOptions = {
 *   bins: 2,
 *   boundaries: [15],
 *   encoding: 'phred33'
 * };
 * ```
 */
export type BinQualityOptions<N extends 2 | 3 | 5 = 2 | 3 | 5> =
  | {
      bins: N;
      preset: "illumina" | "pacbio" | "nanopore";
      encoding?: QualityEncoding;
      preserveOriginal?: boolean;
    }
  | {
      bins: N;
      boundaries: BoundariesForBins<N>;
      encoding?: QualityEncoding;
      preserveOriginal?: boolean;
    };

/**
 * Resolve binning options to a complete binning strategy
 *
 * Converts user-friendly options (preset or custom boundaries) into a fully
 * resolved BinningStrategy with all necessary parameters for binning.
 *
 * Process:
 * 1. Extract boundaries from preset OR custom boundaries
 * 2. Validate boundaries length matches bins - 1
 * 3. Calculate representative scores from boundaries
 * 4. Detect or use provided encoding
 * 5. Return complete BinningStrategy
 *
 * @param options - User-provided binning options
 * @param sampleQuality - Sample quality string for encoding detection
 * @returns Complete binning strategy ready for use
 * @throws Error if boundaries length doesn't match bins - 1
 * @throws Error if preset/bins combination doesn't exist
 *
 * @example
 * ```typescript
 * // Preset-based
 * const strategy = resolveBinningStrategy(
 *   { bins: 3, preset: 'illumina' },
 *   'IIIIIIIIII'
 * );
 * // Returns: { bins: 3, boundaries: [15, 30], representatives: [7, 22, 40], encoding: 'phred33' }
 *
 * // Custom boundaries
 * const strategy = resolveBinningStrategy(
 *   { bins: 2, boundaries: [20] },
 *   '!!!IIIII'
 * );
 * // Returns: { bins: 2, boundaries: [20], representatives: [10, 30], encoding: 'phred33' }
 * ```
 */
function resolveBinningStrategy(
  options: BinQualityOptions,
  sampleQuality: string
): BinningStrategy {
  // Extract boundaries from preset or custom
  let boundaries: readonly number[];

  if ("preset" in options) {
    // Preset-based: lookup in PRESETS
    const presetBoundaries = PRESETS[options.preset]?.[options.bins];
    if (!presetBoundaries) {
      throw new Error(
        `No preset found for platform '${options.preset}' with ${options.bins} bins.\n` +
          `Available combinations:\n` +
          `  - illumina: 2, 3, 5 bins\n` +
          `  - pacbio: 2, 3, 5 bins\n` +
          `  - nanopore: 2, 3, 5 bins\n` +
          `Example: { bins: 3, preset: 'illumina' }`
      );
    }
    boundaries = presetBoundaries;
  } else {
    // Custom boundaries
    boundaries = options.boundaries;
  }

  // Validate boundaries length
  const expectedLength = options.bins - 1;
  if (boundaries.length !== expectedLength) {
    const examples = {
      2: "boundaries: [20]",
      3: "boundaries: [15, 30]",
      5: "boundaries: [10, 20, 30, 35]",
    };
    throw new Error(
      `Invalid boundaries for ${options.bins} bins: expected ${expectedLength}, got ${boundaries.length}.\n` +
        `For ${options.bins} bins, you need ${expectedLength} boundary value(s).\n` +
        `Example: { bins: ${options.bins}, ${examples[options.bins as keyof typeof examples]} }`
    );
  }

  // Calculate representative scores from boundaries
  const representatives = calculateRepresentatives(boundaries);

  // Detect or use provided encoding
  const encoding = options.encoding ?? detectEncoding(sampleQuality);

  return {
    bins: options.bins,
    boundaries,
    representatives,
    encoding,
  };
}

/**
 * Bin quality scores for improved compression
 *
 * Collapses quality scores from 94 possible values into 2, 3, or 5 bins
 * based on platform-specific presets or custom boundaries. Creates longer
 * runs of identical characters for better compression (50-70% improvement).
 *
 * Maintains O(1) memory streaming architecture - suitable for large FASTQ files.
 *
 * @param source - Input FASTQ sequences
 * @param options - Binning configuration (preset or custom boundaries)
 * @yields FASTQ sequences with binned quality scores
 *
 * @example Platform preset usage (90% use case)
 * ```typescript
 * import { binQuality } from './operations/quality';
 * import { parseFastq } from './formats/fastq';
 *
 * const sequences = parseFastq('illumina.fastq');
 * const binned = binQuality(sequences, {
 *   bins: 3,
 *   preset: 'illumina'
 * });
 *
 * for await (const seq of binned) {
 *   console.log(seq.quality); // Quality scores binned to 3 levels
 * }
 * ```
 *
 * @example Custom boundaries (9% use case)
 * ```typescript
 * const binned = binQuality(sequences, {
 *   bins: 2,
 *   boundaries: [20]
 * });
 * ```
 *
 * @example With original quality preservation
 * ```typescript
 * const binned = binQuality(sequences, {
 *   bins: 3,
 *   preset: 'pacbio',
 *   preserveOriginal: true
 * });
 *
 * for await (const seq of binned) {
 *   console.log('Binned:', seq.quality);
 *   console.log('Original:', seq.metadata?.originalQuality);
 *   console.log('Compression:', seq.metadata?.compressionRatio);
 * }
 * ```
 */
export async function* binQuality(
  source: AsyncIterable<AbstractSequence>,
  options: BinQualityOptions
): AsyncIterable<AbstractSequence> {
  // Strategy will be resolved on first sequence
  let strategy: BinningStrategy | null = null;

  for await (const seq of source) {
    // Type guard to check if sequence is FASTQ
    const isFastqSeq = (s: AbstractSequence): s is FastqSequence => {
      return "quality" in s && s.quality !== undefined;
    };

    // Skip non-FASTQ sequences
    if (!isFastqSeq(seq)) {
      yield seq;
      continue;
    }

    try {
      // Resolve strategy on first FASTQ sequence (for encoding detection)
      const qualityStr = seq.quality.toString();
      if (strategy === null) {
        strategy = resolveBinningStrategy(options, qualityStr);
      }

      // Bin the quality string
      const binnedQuality = coreBinQualityString(qualityStr, strategy);

      yield withQuality(seq, binnedQuality);
    } catch (error) {
      // Re-throw with context
      throw new Error(
        `Failed to bin quality for sequence '${seq.id}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
