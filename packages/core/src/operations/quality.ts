/**
 * QualityProcessor - FASTQ quality score operations
 *
 * This processor implements quality-based filtering, trimming, and
 * binning for FASTQ sequences. The type system guarantees that only
 * FASTQ sequences reach the processor (via the SeqOps.quality()
 * constraint).
 *
 * All three operations delegate to native SIMD kernels in batches:
 * trim positions via `qualityTrimBatch`, average quality scores via
 * `qualityAvgBatch`, and quality binning via `qualityBinBatch`. When
 * no operations are requested, sequences pass through unchanged.
 */

import { withQuality, withSequence } from "@genotype/core/constructors";
import { qualityAvgBatch, qualityBinBatch, qualityTrimBatch } from "@genotype/core/backend/service";

import { packQualityStrings } from "@genotype/core/backend/batch";
import type { TransformResult } from "@genotype/core/backend/kernel-types";
import type { AbstractSequence, QualityEncoding, QualityScoreBearing } from "@genotype/core/types";
import {
  type BinningStrategy,
  calculateRepresentatives,
  binQualityString as coreBinQualityString,
  PRESETS,
} from "./core/quality/binning";
import { detectEncoding } from "./core/quality/detection";
import { getEncodingInfo } from "./core/quality/encoding-info";
import type { Processor, QualityOptions } from "./types";

/** Byte budget per native batch. Sequences accumulate until this threshold. */
const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

/** Pre-computed ASCII-space parameters for the quality binning kernel. */
interface AsciiStrategyParams {
  boundaries: Buffer;
  representatives: Buffer;
}

/**
 * Convert a `BinningStrategy` into the ASCII-space `Buffer` parameters
 * the native kernel expects.
 *
 * `boundary_bytes[i] = boundaries[i] + offset` and
 * `representative_bytes[i] = representatives[i] + offset`. Computed
 * once per strategy, not per sequence.
 */
function binStrategyToAscii(strategy: BinningStrategy): AsciiStrategyParams {
  const { offset } = getEncodingInfo(strategy.encoding);
  const boundaries = Buffer.from(strategy.boundaries.map((b) => b + offset));
  const representatives = Buffer.from(strategy.representatives.map((r) => r + offset));
  return { boundaries, representatives };
}

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
   * Sequences accumulate into batches for the native SIMD kernels.
   * The trim kernel returns positions that the processor uses to
   * slice both sequence and quality strings; the avg quality kernel
   * filters by score; the bin kernel remaps quality bytes. When no
   * operations are requested, sequences pass through unchanged.
   *
   * @param source - Input sequences
   * @param options - Quality options
   * @yields Sequences after quality filtering/trimming/binning
   */
  async *process<T extends AbstractSequence & QualityScoreBearing>(
    source: AsyncIterable<T>,
    options: QualityOptions
  ): AsyncIterable<T> {
    const needsTrim = options.trim === true;
    const needsAvgQuality = options.minScore !== undefined || options.maxScore !== undefined;
    const needsBinning = "bins" in options;
    const needsKernel = needsTrim || needsAvgQuality || needsBinning;

    if (!needsKernel) {
      yield* source;
      return;
    }

    const encoding = options.encoding ?? "phred33";

    let binParams: AsciiStrategyParams | undefined;
    if (needsBinning) {
      const strategy = resolveBinningStrategy(options as BinQualityOptions, encoding);
      binParams = binStrategyToAscii(strategy);
    }

    let batch: T[] = [];
    let batchBytes = 0;

    for await (const seq of source) {
      batch.push(seq);
      batchBytes += seq.quality.length;
      if (batchBytes >= BATCH_BYTE_BUDGET) {
        yield* flushQualityBatch<T>(batch, options, encoding, binParams);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* flushQualityBatch<T>(batch, options, encoding, binParams);
    }
  }
}

/**
 * Process a batch of sequences through the native kernels.
 *
 * Phase 1 (trim): if trim is enabled, pack quality strings and call
 * `qualityTrimBatch` to get start/end positions. Reconstruct post-trim
 * sequences, filtering out any that were trimmed to nothing.
 *
 * Phase 2 (avg quality): if minScore/maxScore is set, pack the post-trim
 * quality strings and call `qualityAvgBatch` to filter by score.
 *
 * Phase 3 (binning): if binning is configured, pack survivors' quality
 * strings and call `qualityBinBatch` to remap quality bytes.
 */
async function* flushQualityBatch<T extends AbstractSequence & QualityScoreBearing>(
  batch: T[],
  options: QualityOptions,
  encoding: QualityEncoding,
  binParams: AsciiStrategyParams | undefined
): AsyncIterable<T> {
  const { offset } = getEncodingInfo(encoding);

  let candidates: T[] = batch;

  if (options.trim === true) {
    const { data, offsets } = packQualityStrings(candidates);
    const threshold = options.trimThreshold ?? 20;
    const windowSize = options.trimWindow ?? 4;
    const fromStart = options.trimFromStart ?? true;
    const fromEnd = options.trimFromEnd ?? true;
    const trimPositions = await qualityTrimBatch(
      data,
      offsets,
      offset,
      threshold,
      windowSize,
      fromStart,
      fromEnd
    );

    const trimmed: T[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const start = trimPositions[i * 2]!;
      const end = trimPositions[i * 2 + 1]!;
      if (start >= end) continue;

      const seq = candidates[i]!;
      if (start === 0 && end === seq.sequence.length) {
        trimmed.push(seq);
      } else {
        trimmed.push(
          withQuality(
            withSequence(seq, seq.sequence.slice(start, end)),
            seq.quality.slice(start, end)
          )
        );
      }
    }
    candidates = trimmed;
  }

  if (candidates.length === 0) return;

  const needsAvgQuality = options.minScore !== undefined || options.maxScore !== undefined;

  if (needsAvgQuality) {
    const { data, offsets } = packQualityStrings(candidates);
    const averages = await qualityAvgBatch(data, offsets, offset);

    const filtered: T[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const avg = averages[i]!;
      if (options.minScore !== undefined && avg < options.minScore) continue;
      if (options.maxScore !== undefined && avg > options.maxScore) continue;
      filtered.push(candidates[i]!);
    }
    candidates = filtered;
  }

  if (candidates.length === 0) return;

  if (binParams !== undefined) {
    const { data, offsets } = packQualityStrings(candidates);
    const result: TransformResult = await qualityBinBatch(
      data,
      offsets,
      binParams.boundaries,
      binParams.representatives
    );

    for (let i = 0; i < candidates.length; i++) {
      const start = result.offsets[i]!;
      const end = result.offsets[i + 1]!;
      const binnedBytes = result.data.subarray(start, end);
      yield withQuality(candidates[i]!, new TextDecoder("latin1").decode(binnedBytes));
    }
  } else {
    yield* candidates;
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
 * @param options - User-provided binning options
 * @param encoding - Resolved quality encoding (caller is responsible for detection)
 * @returns Complete binning strategy ready for use
 * @throws Error if boundaries length doesn't match bins - 1
 * @throws Error if preset/bins combination doesn't exist
 *
 * @example
 * ```typescript
 * const strategy = resolveBinningStrategy(
 *   { bins: 3, preset: 'illumina' },
 *   'phred33'
 * );
 * // Returns: { bins: 3, boundaries: [15, 30], representatives: [7, 22, 40], encoding: 'phred33' }
 * ```
 */
function resolveBinningStrategy(
  options: BinQualityOptions,
  encoding: QualityEncoding
): BinningStrategy {
  let boundaries: readonly number[];

  if ("preset" in options) {
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
    boundaries = options.boundaries;
  }

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
        `Example: { bins: ${options.bins}, ${examples[options.bins]} }`
    );
  }

  const representatives = calculateRepresentatives(boundaries);

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
    const hasQuality = (s: AbstractSequence): s is AbstractSequence & QualityScoreBearing => {
      return "quality" in s && s.quality !== undefined;
    };

    if (!hasQuality(seq)) {
      yield seq;
      continue;
    }

    try {
      if (strategy === null) {
        const qualityStr = seq.quality.toString();
        const encoding = options.encoding ?? detectEncoding(qualityStr);
        strategy = resolveBinningStrategy(options, encoding);
      }

      const binnedQuality = coreBinQualityString(seq.quality.toString(), strategy);
      yield withQuality(seq, binnedQuality);
    } catch (error) {
      throw new Error(
        `Failed to bin quality for sequence '${seq.id}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
