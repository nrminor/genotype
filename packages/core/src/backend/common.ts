/**
 * BackendService interface and error definitions.
 *
 * Separated from service.ts to break the circular dependency between
 * the service definition and the backend layer implementations
 * (node-native.ts, wasm.ts) that both need to reference BackendService.
 */

import { Effect, Layer, Schema, ServiceMap } from "effect";
import type {
  ClassifyResult,
  PatternSearchResult,
  SequenceMetricsResult,
  TransformResult,
  TranslateBatchOptions,
  TransformOp,
  ValidationMode,
} from "./kernel-types";
import type {
  AlignmentReaderHandle,
  FastaReaderHandle,
  FastaWriterHandle,
  FastqReaderHandle,
  FastqWriterHandle,
  FindPatternBatchOptions,
  GrepBatchOptions,
} from "./types";

/** Backend method does not exist on this backend (null backend, or method not implemented). */
export class BackendUnavailableError extends Schema.TaggedErrorClass<BackendUnavailableError>()(
  "BackendUnavailableError",
  {
    method: Schema.String,
    message: Schema.String,
  }
) {}

/** Backend operation was attempted but failed due to I/O (file not found, permission denied, etc). */
export class BackendIOError extends Schema.TaggedErrorClass<BackendIOError>()("BackendIOError", {
  method: Schema.String,
  message: Schema.String,
}) {}

/** Backend operation was attempted but the data failed validation (corrupt, malformed, etc). */
export class BackendValidationError extends Schema.TaggedErrorClass<BackendValidationError>()(
  "BackendValidationError",
  {
    method: Schema.String,
    message: Schema.String,
  }
) {}

/** Union of all backend error types. */
export type BackendError = BackendUnavailableError | BackendIOError | BackendValidationError;

/** The full service interface for genotype compute backends. */
export class BackendService extends ServiceMap.Service<
  BackendService,
  {
    readonly kind: "node-native" | "wasm" | "none";

    grepBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      pattern: Uint8Array,
      options: GrepBatchOptions
    ): Effect.Effect<Uint8Array, BackendError>;

    findPatternBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      pattern: Uint8Array,
      options: FindPatternBatchOptions
    ): Effect.Effect<PatternSearchResult, BackendError>;

    transformBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      op: TransformOp
    ): Effect.Effect<TransformResult, BackendError>;

    removeGapsBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      gapChars: string
    ): Effect.Effect<TransformResult, BackendError>;

    replaceAmbiguousBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      replacement: string
    ): Effect.Effect<TransformResult, BackendError>;

    replaceInvalidBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      mode: ValidationMode,
      replacement: string
    ): Effect.Effect<TransformResult, BackendError>;

    classifyBatch(
      sequences: Uint8Array,
      offsets: Uint32Array
    ): Effect.Effect<ClassifyResult, BackendError>;

    checkValidBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      mode: ValidationMode
    ): Effect.Effect<Uint8Array, BackendError>;

    qualityAvgBatch(
      quality: Uint8Array,
      offsets: Uint32Array,
      asciiOffset: number
    ): Effect.Effect<Float64Array, BackendError>;

    qualityTrimBatch(
      quality: Uint8Array,
      offsets: Uint32Array,
      asciiOffset: number,
      threshold: number,
      windowSize: number,
      trimStart: boolean,
      trimEnd: boolean
    ): Effect.Effect<Uint32Array, BackendError>;

    qualityBinBatch(
      quality: Uint8Array,
      offsets: Uint32Array,
      boundaries: Uint8Array,
      representatives: Uint8Array
    ): Effect.Effect<TransformResult, BackendError>;

    sequenceMetricsBatch(
      sequences: Uint8Array,
      seqOffsets: Uint32Array,
      quality: Uint8Array,
      qualOffsets: Uint32Array,
      metricFlags: number,
      asciiOffset: number
    ): Effect.Effect<SequenceMetricsResult, BackendError>;

    translateBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      translationLut: Uint8Array,
      startMask: Uint8Array,
      alternativeStartMask: Uint8Array,
      options: TranslateBatchOptions
    ): Effect.Effect<TransformResult, BackendError>;

    hashBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      caseInsensitive: boolean
    ): Effect.Effect<Uint8Array, BackendError>;

    createAlignmentReaderFromPath(path: string): Effect.Effect<AlignmentReaderHandle, BackendError>;

    createAlignmentReaderFromBytes(
      bytes: Uint8Array
    ): Effect.Effect<AlignmentReaderHandle, BackendError>;

    createFastqReaderFromPath(path: string): Effect.Effect<FastqReaderHandle, BackendError>;

    createFastqReaderFromBytes(bytes: Uint8Array): Effect.Effect<FastqReaderHandle, BackendError>;

    createFastaReaderFromPath(path: string): Effect.Effect<FastaReaderHandle, BackendError>;

    createFastaReaderFromBytes(bytes: Uint8Array): Effect.Effect<FastaReaderHandle, BackendError>;

    createFastqWriter(
      path: string | null,
      compress: boolean
    ): Effect.Effect<FastqWriterHandle, BackendError>;

    createFastaWriter(
      path: string | null,
      compress: boolean,
      lineWidth: number
    ): Effect.Effect<FastaWriterHandle, BackendError>;
  }
>()("@genotype/BackendService") {
  static readonly NullLayer: Layer.Layer<BackendService> = Layer.succeed(
    BackendService,
    BackendService.of({
      kind: "none",
      grepBatch: () => unavailable("grepBatch"),
      findPatternBatch: () => unavailable("findPatternBatch"),
      transformBatch: () => unavailable("transformBatch"),
      removeGapsBatch: () => unavailable("removeGapsBatch"),
      replaceAmbiguousBatch: () => unavailable("replaceAmbiguousBatch"),
      replaceInvalidBatch: () => unavailable("replaceInvalidBatch"),
      classifyBatch: () => unavailable("classifyBatch"),
      checkValidBatch: () => unavailable("checkValidBatch"),
      qualityAvgBatch: () => unavailable("qualityAvgBatch"),
      qualityTrimBatch: () => unavailable("qualityTrimBatch"),
      qualityBinBatch: () => unavailable("qualityBinBatch"),
      sequenceMetricsBatch: () => unavailable("sequenceMetricsBatch"),
      translateBatch: () => unavailable("translateBatch"),
      hashBatch: () => unavailable("hashBatch"),
      createAlignmentReaderFromPath: () => unavailable("createAlignmentReaderFromPath"),
      createAlignmentReaderFromBytes: () => unavailable("createAlignmentReaderFromBytes"),
      createFastqReaderFromPath: () => unavailable("createFastqReaderFromPath"),
      createFastqReaderFromBytes: () => unavailable("createFastqReaderFromBytes"),
      createFastaReaderFromPath: () => unavailable("createFastaReaderFromPath"),
      createFastaReaderFromBytes: () => unavailable("createFastaReaderFromBytes"),
      createFastqWriter: () => unavailable("createFastqWriter"),
      createFastaWriter: () => unavailable("createFastaWriter"),
    })
  );
}

const unavailable = (method: string) =>
  Effect.fail(
    new BackendUnavailableError({
      method,
      message: `No accelerated backend available for ${method}`,
    })
  );
