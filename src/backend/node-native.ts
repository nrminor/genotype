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
import {
  BackendService,
  BackendIOError,
  BackendUnavailableError,
  BackendValidationError,
  type BackendError,
} from "./common";
import type {
  ClassifyResult,
  PatternSearchResult,
  SequenceMetricsResult,
  TransformOp,
  TransformResult,
  TranslateBatchOptions,
  ValidationMode,
} from "./kernel-types";
import type {
  AlignmentBatch,
  AlignmentReaderHandle,
  FastaBatch,
  FastaReaderHandle,
  FastaWriterHandle,
  FastqBatch,
  FastqReaderHandle,
  FastqWriterHandle,
  ReferenceSequenceInfo,
} from "./types";

// ---------------------------------------------------------------------------

export class NativeAddonNotFoundError extends Schema.TaggedErrorClass<NativeAddonNotFoundError>()(
  "NativeAddonNotFoundError",
  { message: Schema.String }
) {}

function classifyEngineError(method: string, e: unknown): BackendError {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.startsWith("[io] ")) {
    return new BackendIOError({ method, message: msg.slice(5) });
  }
  if (msg.startsWith("[validation] ")) {
    return new BackendValidationError({ method, message: msg.slice(13) });
  }
  return new BackendUnavailableError({ method, message: msg });
}

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

interface NativeFastqBatch {
  count: number;
  nameData: Buffer;
  nameOffsets: number[];
  descriptionData: Buffer;
  descriptionOffsets: number[];
  sequenceData: Buffer;
  sequenceOffsets: number[];
  qualityData: Buffer;
  qualityOffsets: number[];
}

interface NativeFastqReader {
  readBatch(maxRecords: number): NativeFastqBatch | null;
}

interface NativeFastqModule {
  FastqReader: {
    open(path: string): NativeFastqReader;
    openBytes(data: Buffer): NativeFastqReader;
  };
}

interface NativeFastaBatch {
  count: number;
  nameData: Buffer;
  nameOffsets: number[];
  descriptionData: Buffer;
  descriptionOffsets: number[];
  sequenceData: Buffer;
  sequenceOffsets: number[];
}

interface NativeFastaReader {
  readBatch(maxRecords: number): NativeFastaBatch | null;
}

interface NativeFastaModule {
  FastaReader: {
    open(path: string): NativeFastaReader;
    openBytes(data: Buffer): NativeFastaReader;
  };
}

interface NativeFastqWriterModule {
  FastqWriter: {
    open(path: string, compress: boolean): NativeFastqWriter;
    openBytes(compress: boolean): NativeFastqWriter;
  };
}

interface NativeFastqWriter {
  writeBatch(
    nameData: Uint8Array,
    nameOffsets: Uint32Array,
    descriptionData: Uint8Array,
    descriptionOffsets: Uint32Array,
    sequenceData: Uint8Array,
    sequenceOffsets: Uint32Array,
    qualityData: Uint8Array,
    qualityOffsets: Uint32Array,
    count: number
  ): void;
  finish(): Buffer | null;
}

interface NativeFastaWriterModule {
  FastaWriter: {
    open(path: string, compress: boolean, lineWidth: number): NativeFastaWriter;
    openBytes(compress: boolean, lineWidth: number): NativeFastaWriter;
  };
}

interface NativeFastaWriter {
  writeBatch(
    nameData: Uint8Array,
    nameOffsets: Uint32Array,
    descriptionData: Uint8Array,
    descriptionOffsets: Uint32Array,
    sequenceData: Uint8Array,
    sequenceOffsets: Uint32Array,
    count: number
  ): void;
  finish(): Buffer | null;
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

function wrapFastqReader(reader: NativeFastqReader): FastqReaderHandle {
  return {
    async readBatch(maxRecords: number): Promise<FastqBatch | null> {
      const batch = reader.readBatch(maxRecords);
      if (batch === null) return null;
      return {
        count: batch.count,
        nameData: batch.nameData,
        nameOffsets: Uint32Array.from(batch.nameOffsets),
        descriptionData: batch.descriptionData,
        descriptionOffsets: Uint32Array.from(batch.descriptionOffsets),
        sequenceData: batch.sequenceData,
        sequenceOffsets: Uint32Array.from(batch.sequenceOffsets),
        qualityData: batch.qualityData,
        qualityOffsets: Uint32Array.from(batch.qualityOffsets),
      };
    },
    close() {},
  };
}

function wrapFastaReader(reader: NativeFastaReader): FastaReaderHandle {
  return {
    async readBatch(maxRecords: number): Promise<FastaBatch | null> {
      const batch = reader.readBatch(maxRecords);
      if (batch === null) return null;
      return {
        count: batch.count,
        nameData: batch.nameData,
        nameOffsets: Uint32Array.from(batch.nameOffsets),
        descriptionData: batch.descriptionData,
        descriptionOffsets: Uint32Array.from(batch.descriptionOffsets),
        sequenceData: batch.sequenceData,
        sequenceOffsets: Uint32Array.from(batch.sequenceOffsets),
      };
    },
    close() {},
  };
}

function wrapFastqWriter(writer: NativeFastqWriter): FastqWriterHandle {
  return {
    async writeBatch(batch: FastqBatch): Promise<void> {
      writer.writeBatch(
        batch.nameData,
        batch.nameOffsets,
        batch.descriptionData,
        batch.descriptionOffsets,
        batch.sequenceData,
        batch.sequenceOffsets,
        batch.qualityData,
        batch.qualityOffsets,
        batch.count
      );
    },
    async finish(): Promise<Uint8Array | null> {
      return writer.finish();
    },
  };
}

function wrapFastaWriter(writer: NativeFastaWriter): FastaWriterHandle {
  return {
    async writeBatch(batch: FastaBatch): Promise<void> {
      writer.writeBatch(
        batch.nameData,
        batch.nameOffsets,
        batch.descriptionData,
        batch.descriptionOffsets,
        batch.sequenceData,
        batch.sequenceOffsets,
        batch.count
      );
    },
    async finish(): Promise<Uint8Array | null> {
      return writer.finish();
    },
  };
}

function buildFromKernel(
  k: NativeKernel,
  alignment: NativeAlignmentModule | undefined,
  fastqMod: NativeFastqModule | undefined,
  fastaMod: NativeFastaModule | undefined,
  fastqWriterMod: NativeFastqWriterModule | undefined,
  fastaWriterMod: NativeFastaWriterModule | undefined
) {
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
        catch: (e) => classifyEngineError("grepBatch", e),
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
        catch: (e) => classifyEngineError("findPatternBatch", e),
      }),
    transformBatch: (sequences, offsets, op) =>
      Effect.try({
        try: () => wrapTransformResult(k.transformBatch(toBufferView(sequences), offsets, op)),
        catch: (e) => classifyEngineError("transformBatch", e),
      }),
    removeGapsBatch: (sequences, offsets, gapChars) =>
      Effect.try({
        try: () =>
          wrapTransformResult(k.removeGapsBatch(toBufferView(sequences), offsets, gapChars)),
        catch: (e) => classifyEngineError("removeGapsBatch", e),
      }),
    replaceAmbiguousBatch: (sequences, offsets, replacement) =>
      Effect.try({
        try: () =>
          wrapTransformResult(
            k.replaceAmbiguousBatch(toBufferView(sequences), offsets, replacement)
          ),
        catch: (e) => classifyEngineError("replaceAmbiguousBatch", e),
      }),
    replaceInvalidBatch: (sequences, offsets, mode, replacement) =>
      Effect.try({
        try: () =>
          wrapTransformResult(
            k.replaceInvalidBatch(toBufferView(sequences), offsets, mode, replacement)
          ),
        catch: (e) => classifyEngineError("replaceInvalidBatch", e),
      }),
    classifyBatch: (sequences, offsets) =>
      Effect.try({
        try: () => wrapClassifyResult(k.classifyBatch(toBufferView(sequences), offsets)),
        catch: (e) => classifyEngineError("classifyBatch", e),
      }),
    checkValidBatch: (sequences, offsets, mode) =>
      Effect.try({
        try: () => k.checkValidBatch(toBufferView(sequences), offsets, mode),
        catch: (e) => classifyEngineError("checkValidBatch", e),
      }),
    qualityAvgBatch: (quality, offsets, asciiOffset) =>
      Effect.try({
        try: () =>
          Float64Array.from(k.qualityAvgBatch(toBufferView(quality), offsets, asciiOffset)),
        catch: (e) => classifyEngineError("qualityAvgBatch", e),
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
        catch: (e) => classifyEngineError("qualityTrimBatch", e),
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
        catch: (e) => classifyEngineError("qualityBinBatch", e),
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
        catch: (e) => classifyEngineError("sequenceMetricsBatch", e),
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
        catch: (e) => classifyEngineError("translateBatch", e),
      }),
    hashBatch: (sequences, offsets, caseInsensitive) =>
      Effect.try({
        try: () => k.hashBatch(toBufferView(sequences), offsets, caseInsensitive),
        catch: (e) => classifyEngineError("hashBatch", e),
      }),
    createAlignmentReaderFromPath: (path) =>
      alignment === undefined
        ? unavailable("createAlignmentReaderFromPath")
        : Effect.try({
            try: () => wrapAlignmentReader(alignment.AlignmentReader.open(path)),
            catch: (e) => classifyEngineError("createAlignmentReaderFromPath", e),
          }),
    createAlignmentReaderFromBytes: (bytes) =>
      alignment === undefined
        ? unavailable("createAlignmentReaderFromBytes")
        : Effect.try({
            try: () =>
              wrapAlignmentReader(alignment.AlignmentReader.openBytes(toBufferView(bytes))),
            catch: (e) => classifyEngineError("createAlignmentReaderFromBytes", e),
          }),
    createFastqReaderFromPath: (path) =>
      fastqMod === undefined
        ? unavailable("createFastqReaderFromPath")
        : Effect.try({
            try: () => wrapFastqReader(fastqMod.FastqReader.open(path)),
            catch: (e) => classifyEngineError("createFastqReaderFromPath", e),
          }),
    createFastqReaderFromBytes: (bytes) =>
      fastqMod === undefined
        ? unavailable("createFastqReaderFromBytes")
        : Effect.try({
            try: () => wrapFastqReader(fastqMod.FastqReader.openBytes(toBufferView(bytes))),
            catch: (e) => classifyEngineError("createFastqReaderFromBytes", e),
          }),
    createFastaReaderFromPath: (path) =>
      fastaMod === undefined
        ? unavailable("createFastaReaderFromPath")
        : Effect.try({
            try: () => wrapFastaReader(fastaMod.FastaReader.open(path)),
            catch: (e) => classifyEngineError("createFastaReaderFromPath", e),
          }),
    createFastaReaderFromBytes: (bytes) =>
      fastaMod === undefined
        ? unavailable("createFastaReaderFromBytes")
        : Effect.try({
            try: () => wrapFastaReader(fastaMod.FastaReader.openBytes(toBufferView(bytes))),
            catch: (e) => classifyEngineError("createFastaReaderFromBytes", e),
          }),
    createFastqWriter: (path, compress) =>
      fastqWriterMod === undefined
        ? unavailable("createFastqWriter")
        : Effect.try({
            try: () =>
              path !== null
                ? wrapFastqWriter(fastqWriterMod.FastqWriter.open(path, compress))
                : wrapFastqWriter(fastqWriterMod.FastqWriter.openBytes(compress)),
            catch: (e) => classifyEngineError("createFastqWriter", e),
          }),
    createFastaWriter: (path, compress, lineWidth) =>
      fastaWriterMod === undefined
        ? unavailable("createFastaWriter")
        : Effect.try({
            try: () =>
              path !== null
                ? wrapFastaWriter(fastaWriterMod.FastaWriter.open(path, compress, lineWidth))
                : wrapFastaWriter(fastaWriterMod.FastaWriter.openBytes(compress, lineWidth)),
            catch: (e) => classifyEngineError("createFastaWriter", e),
          }),
  });
}

// ---------------------------------------------------------------------------

export const nativeLayer: Layer.Layer<BackendService, NativeAddonNotFoundError> = Layer.effect(
  BackendService,
  Effect.try({
    try: () => {
      const mod = require("../native/index.js") as NativeKernel &
        NativeAlignmentModule &
        NativeFastqModule &
        NativeFastaModule &
        NativeFastqWriterModule &
        NativeFastaWriterModule;
      const kernel = mod as NativeKernel;
      const alignment = "AlignmentReader" in mod ? (mod as NativeAlignmentModule) : undefined;
      const fastqMod = "FastqReader" in mod ? (mod as NativeFastqModule) : undefined;
      const fastaMod = "FastaReader" in mod ? (mod as NativeFastaModule) : undefined;
      const fastqWriterMod = "FastqWriter" in mod ? (mod as NativeFastqWriterModule) : undefined;
      const fastaWriterMod = "FastaWriter" in mod ? (mod as NativeFastaWriterModule) : undefined;
      return buildFromKernel(kernel, alignment, fastqMod, fastaMod, fastqWriterMod, fastaWriterMod);
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
