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
import type { AlignmentReaderHandle, FindPatternBatchOptions, GrepBatchOptions } from "./types";

/** Typed error for backend method unavailability. */
export class BackendUnavailableError extends Schema.TaggedErrorClass<BackendUnavailableError>()(
  "BackendUnavailableError",
  {
    method: Schema.String,
    message: Schema.String,
  }
) {}

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
    ): Effect.Effect<Uint8Array, BackendUnavailableError>;

    findPatternBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      pattern: Uint8Array,
      options: FindPatternBatchOptions
    ): Effect.Effect<PatternSearchResult, BackendUnavailableError>;

    transformBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      op: TransformOp
    ): Effect.Effect<TransformResult, BackendUnavailableError>;

    removeGapsBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      gapChars: string
    ): Effect.Effect<TransformResult, BackendUnavailableError>;

    replaceAmbiguousBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      replacement: string
    ): Effect.Effect<TransformResult, BackendUnavailableError>;

    replaceInvalidBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      mode: ValidationMode,
      replacement: string
    ): Effect.Effect<TransformResult, BackendUnavailableError>;

    classifyBatch(
      sequences: Uint8Array,
      offsets: Uint32Array
    ): Effect.Effect<ClassifyResult, BackendUnavailableError>;

    checkValidBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      mode: ValidationMode
    ): Effect.Effect<Uint8Array, BackendUnavailableError>;

    qualityAvgBatch(
      quality: Uint8Array,
      offsets: Uint32Array,
      asciiOffset: number
    ): Effect.Effect<Float64Array, BackendUnavailableError>;

    qualityTrimBatch(
      quality: Uint8Array,
      offsets: Uint32Array,
      asciiOffset: number,
      threshold: number,
      windowSize: number,
      trimStart: boolean,
      trimEnd: boolean
    ): Effect.Effect<Uint32Array, BackendUnavailableError>;

    qualityBinBatch(
      quality: Uint8Array,
      offsets: Uint32Array,
      boundaries: Uint8Array,
      representatives: Uint8Array
    ): Effect.Effect<TransformResult, BackendUnavailableError>;

    sequenceMetricsBatch(
      sequences: Uint8Array,
      seqOffsets: Uint32Array,
      quality: Uint8Array,
      qualOffsets: Uint32Array,
      metricFlags: number,
      asciiOffset: number
    ): Effect.Effect<SequenceMetricsResult, BackendUnavailableError>;

    translateBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      translationLut: Uint8Array,
      startMask: Uint8Array,
      alternativeStartMask: Uint8Array,
      options: TranslateBatchOptions
    ): Effect.Effect<TransformResult, BackendUnavailableError>;

    hashBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      caseInsensitive: boolean
    ): Effect.Effect<Uint8Array, BackendUnavailableError>;

    createAlignmentReaderFromPath(
      path: string
    ): Effect.Effect<AlignmentReaderHandle, BackendUnavailableError>;

    createAlignmentReaderFromBytes(
      bytes: Uint8Array
    ): Effect.Effect<AlignmentReaderHandle, BackendUnavailableError>;
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
