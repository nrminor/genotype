import type {
  ClassifyResult,
  PatternSearchResult,
  SequenceMetricFlag,
  SequenceMetricsResult,
  TransformOp,
  TransformResult,
  TranslateBatchOptions,
  ValidationMode,
} from "../native";

/**
 * Batch options for grep-style approximate matching.
 */
export interface GrepBatchOptions {
  maxEdits: number;
  caseInsensitive: boolean;
  searchBothStrands: boolean;
}

/**
 * Batch options for find-pattern operations that return positions.
 */
export interface FindPatternBatchOptions {
  maxEdits: number;
  caseInsensitive: boolean;
}

/**
 * Information about a reference sequence in an alignment file header.
 */
export interface ReferenceSequenceInfo {
  name: string;
  length: number;
}

/**
 * Struct-of-arrays batch of parsed alignment records.
 *
 * This mirrors the Rust-side AlignmentBatch but uses browser-friendly
 * typed array primitives (`Uint8Array` instead of `Buffer`).
 */
export interface AlignmentBatch {
  count: number;
  format: string;
  qnameData: Uint8Array;
  qnameOffsets: number[];
  sequenceData: Uint8Array;
  sequenceOffsets: number[];
  qualityData: Uint8Array;
  qualityOffsets: number[];
  cigarData: Uint8Array;
  cigarOffsets: number[];
  rnameData: Uint8Array;
  rnameOffsets: number[];
  flags: number[];
  positions: number[];
  mappingQualities: Uint8Array;
}

/**
 * Stateful handle for reading alignment records in batches.
 *
 * The interface is async-first even though the current Node/Bun native
 * implementation resolves immediately. This keeps the shared contract
 * stable when a browser/wasm backend arrives.
 */
export interface AlignmentReaderHandle {
  readBatch(maxRecords: number): Promise<AlignmentBatch | null>;
  headerText(): Promise<string>;
  referenceSequences(): Promise<ReferenceSequenceInfo[]>;
}

/**
 * Backend abstraction for genotype compute/parsing capabilities.
 *
 * Consumers depend on this interface rather than directly on napi or
 * wasm presentation layers.
 */
export interface GenotypeBackend {
  kind: "node-native" | "wasm" | "none";

  // ── stateless kernels ─────────────────────────────────────────

  grepBatch?(
    sequences: Uint8Array,
    offsets: Uint32Array,
    pattern: Uint8Array,
    options: GrepBatchOptions
  ): Promise<Uint8Array>;

  findPatternBatch?(
    sequences: Uint8Array,
    offsets: Uint32Array,
    pattern: Uint8Array,
    options: FindPatternBatchOptions
  ): Promise<PatternSearchResult>;

  transformBatch?(
    sequences: Uint8Array,
    offsets: Uint32Array,
    op: TransformOp
  ): Promise<TransformResult>;

  removeGapsBatch?(
    sequences: Uint8Array,
    offsets: Uint32Array,
    gapChars: string
  ): Promise<TransformResult>;

  replaceAmbiguousBatch?(
    sequences: Uint8Array,
    offsets: Uint32Array,
    replacement: string
  ): Promise<TransformResult>;

  replaceInvalidBatch?(
    sequences: Uint8Array,
    offsets: Uint32Array,
    mode: ValidationMode,
    replacement: string
  ): Promise<TransformResult>;

  classifyBatch?(sequences: Uint8Array, offsets: Uint32Array): Promise<ClassifyResult>;

  checkValidBatch?(
    sequences: Uint8Array,
    offsets: Uint32Array,
    mode: ValidationMode
  ): Promise<Uint8Array>;

  qualityAvgBatch?(
    quality: Uint8Array,
    offsets: Uint32Array,
    asciiOffset: number
  ): Promise<number[]>;

  qualityTrimBatch?(
    quality: Uint8Array,
    offsets: Uint32Array,
    asciiOffset: number,
    threshold: number,
    windowSize: number,
    trimStart: boolean,
    trimEnd: boolean
  ): Promise<number[]>;

  qualityBinBatch?(
    quality: Uint8Array,
    offsets: Uint32Array,
    boundaries: Uint8Array,
    representatives: Uint8Array
  ): Promise<TransformResult>;

  sequenceMetricsBatch?(
    sequences: Uint8Array,
    seqOffsets: Uint32Array,
    quality: Uint8Array,
    qualOffsets: Uint32Array,
    metricFlags: number,
    asciiOffset: number
  ): Promise<SequenceMetricsResult>;

  translateBatch?(
    sequences: Uint8Array,
    offsets: Uint32Array,
    translationLut: Uint8Array,
    startMask: Uint8Array,
    alternativeStartMask: Uint8Array,
    options: TranslateBatchOptions
  ): Promise<TransformResult>;

  hashBatch?(
    sequences: Uint8Array,
    offsets: Uint32Array,
    caseInsensitive: boolean
  ): Promise<Uint8Array>;

  // ── stateful readers ──────────────────────────────────────────

  createAlignmentReaderFromPath?(path: string): Promise<AlignmentReaderHandle>;
  createAlignmentReaderFromBytes?(bytes: Uint8Array): Promise<AlignmentReaderHandle>;
}

/**
 * Backend with no accelerated/native capabilities.
 */
export interface NullBackend extends GenotypeBackend {
  kind: "none";
}

// Re-exported enum/value types used by backend clients.
export type { SequenceMetricFlag, TransformOp, TranslateBatchOptions, ValidationMode };
