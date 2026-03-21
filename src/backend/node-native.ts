/**
 * Node/Bun native backend for genotype compute engine.
 *
 * Loads the napi-rs addon via require() and provides a
 * Layer<BackendService, NativeAddonNotFoundError>. The layer
 * construction is synchronous (require is sync) and uses Effect.try
 * for typed initialization errors. Layer memoization in the
 * ManagedRuntime handles caching — no mutable module-level state.
 *
 * The NativeKernel interface describes the raw napi return types,
 * which differ from the kernel-types interfaces (napi marshals
 * Vec<u32> as number[], not Uint32Array). The buildFromKernel
 * function handles the type conversions at the boundary.
 */

import { Effect, Layer, Schema } from "effect";
import { BackendService, BackendUnavailableError } from "./common";
import type {
  ClassifyResult,
  PatternSearchResult,
  SequenceMetricsResult,
  TransformOp,
  TransformResult,
  TranslateBatchOptions,
  ValidationMode,
} from "./kernel-types";
import type { AlignmentBatch, AlignmentReaderHandle, ReferenceSequenceInfo } from "./types";

// ---------------------------------------------------------------------------

export class NativeAddonNotFoundError extends Schema.TaggedErrorClass<NativeAddonNotFoundError>()(
  "NativeAddonNotFoundError",
  { message: Schema.String }
) {}

// ---------------------------------------------------------------------------

interface NapiTransformResult {
  data: Buffer;
  offsets: number[];
}

interface NapiClassifyResult {
  counts: number[];
}

interface NapiPatternSearchResult {
  starts: number[];
  ends: number[];
  costs: number[];
  matchOffsets: number[];
}

interface NapiSequenceMetricsResult {
  lengths?: number[];
  gc?: number[];
  at?: number[];
  gcSkew?: number[];
  atSkew?: number[];
  entropy?: number[];
  alphabetMask?: number[];
  avgQual?: number[];
  minQual?: number[];
  maxQual?: number[];
}

export interface NativeKernel {
  grepBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    pattern: Buffer,
    maxEdits: number,
    caseInsensitive: boolean,
    searchBothStrands: boolean
  ): Buffer;
  findPatternBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    pattern: Buffer,
    maxEdits: number,
    caseInsensitive: boolean
  ): NapiPatternSearchResult;
  transformBatch(sequences: Buffer, offsets: Uint32Array, op: TransformOp): NapiTransformResult;
  removeGapsBatch(sequences: Buffer, offsets: Uint32Array, gapChars: string): NapiTransformResult;
  replaceAmbiguousBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    replacement: string
  ): NapiTransformResult;
  replaceInvalidBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    mode: ValidationMode,
    replacement: string
  ): NapiTransformResult;
  classifyBatch(sequences: Buffer, offsets: Uint32Array): NapiClassifyResult;
  checkValidBatch(sequences: Buffer, offsets: Uint32Array, mode: ValidationMode): Buffer;
  qualityAvgBatch(quality: Buffer, offsets: Uint32Array, asciiOffset: number): number[];
  qualityTrimBatch(
    quality: Buffer,
    offsets: Uint32Array,
    asciiOffset: number,
    threshold: number,
    windowSize: number,
    trimStart: boolean,
    trimEnd: boolean
  ): number[];
  qualityBinBatch(
    quality: Buffer,
    offsets: Uint32Array,
    boundaries: Buffer,
    representatives: Buffer
  ): NapiTransformResult;
  sequenceMetricsBatch(
    sequences: Buffer,
    seqOffsets: Uint32Array,
    quality: Buffer,
    qualOffsets: Uint32Array,
    metricFlags: number,
    asciiOffset: number
  ): NapiSequenceMetricsResult;
  translateBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    translationLut: Buffer,
    startMask: Buffer,
    alternativeStartMask: Buffer,
    options: TranslateBatchOptions
  ): NapiTransformResult;
  hashBatch(sequences: Buffer, offsets: Uint32Array, caseInsensitive: boolean): Buffer;
}

interface NativeAlignmentBatch {
  count: number;
  format: string;
  qnameData: Buffer;
  qnameOffsets: number[];
  sequenceData: Buffer;
  sequenceOffsets: number[];
  qualityData: Buffer;
  qualityOffsets: number[];
  cigarData: Buffer;
  cigarOffsets: number[];
  rnameData: Buffer;
  rnameOffsets: number[];
  flags: number[];
  positions: number[];
  mappingQualities: Buffer;
}

interface NativeAlignmentReader {
  readBatch(maxRecords: number): NativeAlignmentBatch | null;
  headerText(): string;
  referenceSequences(): ReferenceSequenceInfo[];
}

interface NativeAlignmentModule {
  AlignmentReader: {
    open(path: string): NativeAlignmentReader;
    openBytes(data: Buffer): NativeAlignmentReader;
  };
}

// ---------------------------------------------------------------------------

function toBufferView(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function wrapTransformResult(r: NapiTransformResult): TransformResult {
  return { data: r.data, offsets: Uint32Array.from(r.offsets) };
}

function wrapClassifyResult(r: NapiClassifyResult): ClassifyResult {
  return { counts: Uint32Array.from(r.counts) };
}

function wrapPatternSearchResult(r: NapiPatternSearchResult): PatternSearchResult {
  return {
    starts: Uint32Array.from(r.starts),
    ends: Uint32Array.from(r.ends),
    costs: Uint32Array.from(r.costs),
    matchOffsets: Uint32Array.from(r.matchOffsets),
  };
}

function wrapSequenceMetricsResult(r: NapiSequenceMetricsResult): SequenceMetricsResult {
  const result: SequenceMetricsResult = {};
  if (r.lengths) result.lengths = Uint32Array.from(r.lengths);
  if (r.gc) result.gc = Float64Array.from(r.gc);
  if (r.at) result.at = Float64Array.from(r.at);
  if (r.gcSkew) result.gcSkew = Float64Array.from(r.gcSkew);
  if (r.atSkew) result.atSkew = Float64Array.from(r.atSkew);
  if (r.entropy) result.entropy = Float64Array.from(r.entropy);
  if (r.alphabetMask) result.alphabetMask = Uint32Array.from(r.alphabetMask);
  if (r.avgQual) result.avgQual = Float64Array.from(r.avgQual);
  if (r.minQual) result.minQual = Int32Array.from(r.minQual);
  if (r.maxQual) result.maxQual = Int32Array.from(r.maxQual);
  return result;
}

function wrapAlignmentReader(reader: NativeAlignmentReader): AlignmentReaderHandle {
  return {
    async readBatch(maxRecords: number): Promise<AlignmentBatch | null> {
      const batch = reader.readBatch(maxRecords);
      if (batch === null) return null;
      return {
        count: batch.count,
        format: batch.format,
        qnameData: batch.qnameData,
        qnameOffsets: Uint32Array.from(batch.qnameOffsets),
        sequenceData: batch.sequenceData,
        sequenceOffsets: Uint32Array.from(batch.sequenceOffsets),
        qualityData: batch.qualityData,
        qualityOffsets: Uint32Array.from(batch.qualityOffsets),
        cigarData: batch.cigarData,
        cigarOffsets: Uint32Array.from(batch.cigarOffsets),
        rnameData: batch.rnameData,
        rnameOffsets: Uint32Array.from(batch.rnameOffsets),
        flags: Uint16Array.from(batch.flags),
        positions: Int32Array.from(batch.positions),
        mappingQualities: batch.mappingQualities,
      };
    },
    async headerText(): Promise<string> {
      return reader.headerText();
    },
    async referenceSequences(): Promise<ReferenceSequenceInfo[]> {
      return reader.referenceSequences();
    },
    close() {
      // No-op: napi-rs ties the reader's lifetime to the JS garbage collector.
    },
  };
}

// ---------------------------------------------------------------------------

function buildFromKernel(k: NativeKernel, alignment: NativeAlignmentModule | undefined) {
  const unavailable = (method: string) =>
    Effect.fail(
      new BackendUnavailableError({
        method,
        message: `node-native backend does not support ${method}`,
      })
    );

  return BackendService.of({
    kind: "node-native",
    grepBatch: (sequences, offsets, pattern, options) =>
      Effect.try({
        try: () =>
          k.grepBatch(
            toBufferView(sequences),
            offsets,
            toBufferView(pattern),
            options.maxEdits,
            options.caseInsensitive,
            options.searchBothStrands
          ),
        catch: (e) =>
          new BackendUnavailableError({
            method: "grepBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    findPatternBatch: (sequences, offsets, pattern, options) =>
      Effect.try({
        try: () =>
          wrapPatternSearchResult(
            k.findPatternBatch(
              toBufferView(sequences),
              offsets,
              toBufferView(pattern),
              options.maxEdits,
              options.caseInsensitive
            )
          ),
        catch: (e) =>
          new BackendUnavailableError({
            method: "findPatternBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    transformBatch: (sequences, offsets, op) =>
      Effect.try({
        try: () => wrapTransformResult(k.transformBatch(toBufferView(sequences), offsets, op)),
        catch: (e) =>
          new BackendUnavailableError({
            method: "transformBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    removeGapsBatch: (sequences, offsets, gapChars) =>
      Effect.try({
        try: () =>
          wrapTransformResult(k.removeGapsBatch(toBufferView(sequences), offsets, gapChars)),
        catch: (e) =>
          new BackendUnavailableError({
            method: "removeGapsBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    replaceAmbiguousBatch: (sequences, offsets, replacement) =>
      Effect.try({
        try: () =>
          wrapTransformResult(
            k.replaceAmbiguousBatch(toBufferView(sequences), offsets, replacement)
          ),
        catch: (e) =>
          new BackendUnavailableError({
            method: "replaceAmbiguousBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    replaceInvalidBatch: (sequences, offsets, mode, replacement) =>
      Effect.try({
        try: () =>
          wrapTransformResult(
            k.replaceInvalidBatch(toBufferView(sequences), offsets, mode, replacement)
          ),
        catch: (e) =>
          new BackendUnavailableError({
            method: "replaceInvalidBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    classifyBatch: (sequences, offsets) =>
      Effect.try({
        try: () => wrapClassifyResult(k.classifyBatch(toBufferView(sequences), offsets)),
        catch: (e) =>
          new BackendUnavailableError({
            method: "classifyBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    checkValidBatch: (sequences, offsets, mode) =>
      Effect.try({
        try: () => k.checkValidBatch(toBufferView(sequences), offsets, mode),
        catch: (e) =>
          new BackendUnavailableError({
            method: "checkValidBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    qualityAvgBatch: (quality, offsets, asciiOffset) =>
      Effect.try({
        try: () =>
          Float64Array.from(k.qualityAvgBatch(toBufferView(quality), offsets, asciiOffset)),
        catch: (e) =>
          new BackendUnavailableError({
            method: "qualityAvgBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    qualityTrimBatch: (quality, offsets, asciiOffset, threshold, windowSize, trimStart, trimEnd) =>
      Effect.try({
        try: () =>
          Uint32Array.from(
            k.qualityTrimBatch(
              toBufferView(quality),
              offsets,
              asciiOffset,
              threshold,
              windowSize,
              trimStart,
              trimEnd
            )
          ),
        catch: (e) =>
          new BackendUnavailableError({
            method: "qualityTrimBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    qualityBinBatch: (quality, offsets, boundaries, representatives) =>
      Effect.try({
        try: () =>
          wrapTransformResult(
            k.qualityBinBatch(
              toBufferView(quality),
              offsets,
              toBufferView(boundaries),
              toBufferView(representatives)
            )
          ),
        catch: (e) =>
          new BackendUnavailableError({
            method: "qualityBinBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    sequenceMetricsBatch: (sequences, seqOffsets, quality, qualOffsets, metricFlags, asciiOffset) =>
      Effect.try({
        try: () =>
          wrapSequenceMetricsResult(
            k.sequenceMetricsBatch(
              toBufferView(sequences),
              seqOffsets,
              toBufferView(quality),
              qualOffsets,
              metricFlags,
              asciiOffset
            )
          ),
        catch: (e) =>
          new BackendUnavailableError({
            method: "sequenceMetricsBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    translateBatch: (
      sequences,
      offsets,
      translationLut,
      startMask,
      alternativeStartMask,
      options
    ) =>
      Effect.try({
        try: () =>
          wrapTransformResult(
            k.translateBatch(
              toBufferView(sequences),
              offsets,
              toBufferView(translationLut),
              toBufferView(startMask),
              toBufferView(alternativeStartMask),
              options
            )
          ),
        catch: (e) =>
          new BackendUnavailableError({
            method: "translateBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    hashBatch: (sequences, offsets, caseInsensitive) =>
      Effect.try({
        try: () => k.hashBatch(toBufferView(sequences), offsets, caseInsensitive),
        catch: (e) =>
          new BackendUnavailableError({
            method: "hashBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    createAlignmentReaderFromPath: (path) =>
      alignment === undefined
        ? unavailable("createAlignmentReaderFromPath")
        : Effect.try({
            try: () => wrapAlignmentReader(alignment.AlignmentReader.open(path)),
            catch: (e) =>
              new BackendUnavailableError({
                method: "createAlignmentReaderFromPath",
                message: e instanceof Error ? e.message : String(e),
              }),
          }),
    createAlignmentReaderFromBytes: (bytes) =>
      alignment === undefined
        ? unavailable("createAlignmentReaderFromBytes")
        : Effect.try({
            try: () =>
              wrapAlignmentReader(alignment.AlignmentReader.openBytes(toBufferView(bytes))),
            catch: (e) =>
              new BackendUnavailableError({
                method: "createAlignmentReaderFromBytes",
                message: e instanceof Error ? e.message : String(e),
              }),
          }),
  });
}

// ---------------------------------------------------------------------------

export const nativeLayer: Layer.Layer<BackendService, NativeAddonNotFoundError> = Layer.effect(
  BackendService,
  Effect.try({
    try: () => {
      const mod = require("../native/index.js") as NativeKernel & NativeAlignmentModule;
      const kernel = mod as NativeKernel;
      const alignment = "AlignmentReader" in mod ? (mod as NativeAlignmentModule) : undefined;
      return buildFromKernel(kernel, alignment);
    },
    catch: (cause) =>
      new NativeAddonNotFoundError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  })
);

// ---------------------------------------------------------------------------

/**
 * Internal synchronous access to the native kernel.
 *
 * This exists only for rare synchronous helper paths that cannot be
 * made async without a larger public API change. New production code
 * should use BackendService via the Effect runtime.
 */
export function getNodeNativeKernelSync(): NativeKernel | undefined {
  try {
    return require("../native/index.js") as NativeKernel;
  } catch {
    return undefined;
  }
}
