/**
 * Merge checked paired-end FASTQ reads with the accelerated read-merge kernel.
 */

import { createFastqRecord } from "@genotype/core/constructors";
import { packQualityStrings, packSequences, packStrings } from "@genotype/core/backend/batch";
import { mergePairedReadsBatch } from "@genotype/core/backend/service";
import {
  PairedReadMergeTiePolicy,
  PairedReadOverlapTiePolicy,
  PairedReadValidationPreset,
  type PairedReadMergeOptions,
} from "@genotype/core/backend/kernel-types";
import { MemoryError, QualityError, SequenceError } from "@genotype/core/errors";
import { GenotypeString } from "@genotype/core/genotype-string";
import type { FastqSequence } from "@genotype/core/types";
import type { PairOptions } from "./pair";
import type { ReadPair } from "./pair-stream";

const DEFAULT_BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

export type MergePairsNoOverlapPolicy = "keep" | "skip" | "error";
export type MergePairsValidationPreset = "loose" | "normal" | "strict";

export interface FastqPairMergeOptions {
  readonly onNoOverlap?: MergePairsNoOverlapPolicy;
  readonly batchByteBudget?: number;
  readonly overlapDiffMax?: number;
  readonly minOverlap?: number;
  readonly diffPercentMax?: number;
  readonly minComparisons?: number;
  readonly overlapTiePolicy?: PairedReadOverlapTiePolicy;
  readonly mergeTiePolicy?: PairedReadMergeTiePolicy;
  readonly maxOutputQual?: number;
  readonly qualityOnly?: boolean;
  readonly minBaseCorrectionDeltaQ?: number;
  readonly validateOverlap?: boolean;
  readonly validationPreset?: MergePairsValidationPreset;
  readonly correctOverlap?: boolean;
}

export interface MergePairsPipelineOptions {
  readonly pairing?: PairOptions;
  readonly merge?: FastqPairMergeOptions;
}

export interface MergePairsFlatOptions extends PairOptions, FastqPairMergeOptions {}

export type MergePairsOptions = MergePairsPipelineOptions | MergePairsFlatOptions;

export interface SplitMergePairsOptions {
  readonly pairing?: PairOptions;
  readonly merge?: FastqPairMergeOptions;
}

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

export class MergePairsProcessor {
  async *process(
    pairs: AsyncIterable<ReadPair<FastqSequence>>,
    options: FastqPairMergeOptions = {}
  ): AsyncIterable<FastqSequence> {
    const settings = normalizeOptions(options);
    let batch: ReadPair<FastqSequence>[] = [];
    let batchBytes = 0;

    for await (const pair of pairs) {
      validateFastqForMerge(pair.r1);
      validateFastqForMerge(pair.r2);
      batch.push(pair);
      batchBytes += pair.r1.length + pair.r2.length;

      if (batchBytes >= settings.batchByteBudget) {
        yield* flushBatch(batch, settings);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* flushBatch(batch, settings);
    }
  }
}

interface NormalizedOptions {
  readonly onNoOverlap: MergePairsNoOverlapPolicy;
  readonly batchByteBudget: number;
  readonly kernel: PairedReadMergeOptions;
}

export function splitMergePairsOptions(options?: MergePairsOptions): SplitMergePairsOptions {
  if (options === undefined) return {};

  if (isPipelineOptions(options)) {
    const split: Mutable<SplitMergePairsOptions> = {};
    if (options.pairing !== undefined) split.pairing = options.pairing;
    if (options.merge !== undefined) split.merge = options.merge;
    return split;
  }

  const pairing: Mutable<PairOptions> = {};
  let hasPairing = false;
  if (options.extractPairId !== undefined) {
    pairing.extractPairId = options.extractPairId;
    hasPairing = true;
  }
  if (options.maxBufferSize !== undefined) {
    pairing.maxBufferSize = options.maxBufferSize;
    hasPairing = true;
  }
  if (options.onUnpaired !== undefined) {
    pairing.onUnpaired = options.onUnpaired;
    hasPairing = true;
  }

  const merge: Mutable<FastqPairMergeOptions> = {};
  let hasMerge = false;
  if (options.onNoOverlap !== undefined) {
    merge.onNoOverlap = options.onNoOverlap;
    hasMerge = true;
  }
  if (options.batchByteBudget !== undefined) {
    merge.batchByteBudget = options.batchByteBudget;
    hasMerge = true;
  }
  if (options.overlapDiffMax !== undefined) {
    merge.overlapDiffMax = options.overlapDiffMax;
    hasMerge = true;
  }
  if (options.minOverlap !== undefined) {
    merge.minOverlap = options.minOverlap;
    hasMerge = true;
  }
  if (options.diffPercentMax !== undefined) {
    merge.diffPercentMax = options.diffPercentMax;
    hasMerge = true;
  }
  if (options.minComparisons !== undefined) {
    merge.minComparisons = options.minComparisons;
    hasMerge = true;
  }
  if (options.overlapTiePolicy !== undefined) {
    merge.overlapTiePolicy = options.overlapTiePolicy;
    hasMerge = true;
  }
  if (options.mergeTiePolicy !== undefined) {
    merge.mergeTiePolicy = options.mergeTiePolicy;
    hasMerge = true;
  }
  if (options.maxOutputQual !== undefined) {
    merge.maxOutputQual = options.maxOutputQual;
    hasMerge = true;
  }
  if (options.qualityOnly !== undefined) {
    merge.qualityOnly = options.qualityOnly;
    hasMerge = true;
  }
  if (options.minBaseCorrectionDeltaQ !== undefined) {
    merge.minBaseCorrectionDeltaQ = options.minBaseCorrectionDeltaQ;
    hasMerge = true;
  }
  if (options.validateOverlap !== undefined) {
    merge.validateOverlap = options.validateOverlap;
    hasMerge = true;
  }
  if (options.validationPreset !== undefined) {
    merge.validationPreset = options.validationPreset;
    hasMerge = true;
  }
  if (options.correctOverlap !== undefined) {
    merge.correctOverlap = options.correctOverlap;
    hasMerge = true;
  }

  const split: Mutable<SplitMergePairsOptions> = {};
  if (hasPairing) split.pairing = pairing;
  if (hasMerge) split.merge = merge;
  return split;
}

function isPipelineOptions(options: MergePairsOptions): options is MergePairsPipelineOptions {
  return "pairing" in options || "merge" in options;
}

function normalizeOptions(options: FastqPairMergeOptions): NormalizedOptions {
  const batchByteBudget = options.batchByteBudget ?? DEFAULT_BATCH_BYTE_BUDGET;
  if (batchByteBudget <= 0) {
    throw new MemoryError(`Invalid batchByteBudget: ${batchByteBudget}. Must be greater than 0.`);
  }

  return {
    onNoOverlap: options.onNoOverlap ?? "keep",
    batchByteBudget,
    kernel: {
      overlapDiffMax: options.overlapDiffMax ?? 5,
      minOverlap: options.minOverlap ?? 10,
      diffPercentMax: options.diffPercentMax ?? 0.2,
      minComparisons: options.minComparisons ?? 10,
      overlapTiePolicy: options.overlapTiePolicy ?? PairedReadOverlapTiePolicy.PreferFromStart,
      mergeTiePolicy: options.mergeTiePolicy ?? PairedReadMergeTiePolicy.PreferForward,
      maxOutputQual: options.maxOutputQual ?? 40,
      qualityOnly: options.qualityOnly ?? false,
      minBaseCorrectionDeltaQ: options.minBaseCorrectionDeltaQ ?? 0,
      validateOverlap: options.validateOverlap ?? true,
      validationPreset: toKernelValidationPreset(options.validationPreset ?? "normal"),
      correctOverlap: options.correctOverlap ?? true,
    },
  };
}

function toKernelValidationPreset(preset: MergePairsValidationPreset): PairedReadValidationPreset {
  switch (preset) {
    case "loose":
      return PairedReadValidationPreset.Loose;
    case "normal":
      return PairedReadValidationPreset.Normal;
    case "strict":
      return PairedReadValidationPreset.Strict;
  }
}

function validateFastqForMerge(read: FastqSequence): void {
  if (read.qualityEncoding !== "phred33") {
    throw new QualityError(
      "mergePairs currently requires phred33 FASTQ qualities because libpairassembly interprets quality bytes as Phred+33",
      read.id,
      read.qualityEncoding
    );
  }
  if (read.sequence.length !== read.quality.length) {
    throw new QualityError("sequence and quality lengths differ", read.id, read.qualityEncoding);
  }
}

async function* flushBatch(
  pairs: readonly ReadPair<FastqSequence>[],
  options: NormalizedOptions
): AsyncIterable<FastqSequence> {
  const pairIds = packStrings(pairs.map((pair) => pair.id));
  const r1Sequences = packSequences(pairs.map((pair) => pair.r1));
  const r1Quality = packQualityStrings(pairs.map((pair) => pair.r1));
  const r2Sequences = packSequences(pairs.map((pair) => pair.r2));
  const r2Quality = packQualityStrings(pairs.map((pair) => pair.r2));

  const result = await mergePairedReadsBatch(
    pairIds.data,
    pairIds.offsets,
    r1Sequences.data,
    r1Sequences.offsets,
    r1Quality.data,
    r1Quality.offsets,
    r2Sequences.data,
    r2Sequences.offsets,
    r2Quality.data,
    r2Quality.offsets,
    options.kernel
  );

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;
    if (result.status[i] === 1) {
      yield mergedRecord(pair, result, i);
      continue;
    }

    switch (options.onNoOverlap) {
      case "keep":
        yield pair.r1;
        yield pair.r2;
        break;
      case "skip":
        break;
      case "error":
        throw new SequenceError(
          `No acceptable paired-read overlap found for '${pair.id}'`,
          pair.id
        );
    }
  }
}

function mergedRecord(
  pair: ReadPair<FastqSequence>,
  result: Awaited<ReturnType<typeof mergePairedReadsBatch>>,
  index: number
): FastqSequence {
  const seqStart = result.sequenceOffsets[index]!;
  const seqEnd = result.sequenceOffsets[index + 1]!;
  const qualStart = result.qualityOffsets[index]!;
  const qualEnd = result.qualityOffsets[index + 1]!;

  return createFastqRecord({
    id: pair.id,
    sequence: GenotypeString.fromBytes(result.sequenceData.subarray(seqStart, seqEnd)),
    quality: GenotypeString.fromBytes(result.qualityData.subarray(qualStart, qualEnd)),
    qualityEncoding: pair.r1.qualityEncoding,
    description: pair.r1.description,
  });
}
