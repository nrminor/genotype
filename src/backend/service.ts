/**
 * Effect-based backend service for genotype compute kernels.
 *
 * Wraps the existing GenotypeBackend interface in a ServiceMap.Service
 * where all methods are required and return typed Effects. The null
 * backend fails every method with BackendUnavailableError instead of
 * methods being undefined. A ManagedRuntime provides the bridge from
 * Effect-managed services into Promise-based operation code.
 */

import { Effect, Layer, ManagedRuntime, Schema, ServiceMap } from "effect";
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
  FindPatternBatchOptions,
  GenotypeBackend,
  GrepBatchOptions,
} from "./types";
import { createNodeNativeBackend } from "./node-native";
import { createWasmBackend } from "./wasm";
import { RuntimeEnvLayer } from "../io/layers";

/** Typed error for backend method unavailability. */
export class BackendUnavailableError extends Schema.TaggedErrorClass<BackendUnavailableError>()(
  "BackendUnavailableError",
  {
    method: Schema.String,
    message: Schema.String,
  }
) {}

const unavailable = (method: string, kind: "node-native" | "wasm" | "none") =>
  Effect.fail(
    new BackendUnavailableError({
      method,
      message: `${kind} backend does not support ${method}`,
    })
  );

const wrapOptionalMethod = <Args extends unknown[], R>(
  method: ((...args: Args) => Promise<R>) | undefined,
  methodName: string,
  kind: "node-native" | "wasm" | "none"
): ((...args: Args) => Effect.Effect<R, BackendUnavailableError>) =>
  method === undefined
    ? () => unavailable(methodName, kind)
    : (...args: Args) =>
        Effect.tryPromise({
          try: () => method(...args),
          catch: (cause) =>
            new BackendUnavailableError({
              method: methodName,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

const buildNullBackendShape = () => ({
  kind: "none" as const,
  grepBatch: () => unavailable("grepBatch", "none"),
  findPatternBatch: () => unavailable("findPatternBatch", "none"),
  transformBatch: () => unavailable("transformBatch", "none"),
  removeGapsBatch: () => unavailable("removeGapsBatch", "none"),
  replaceAmbiguousBatch: () => unavailable("replaceAmbiguousBatch", "none"),
  replaceInvalidBatch: () => unavailable("replaceInvalidBatch", "none"),
  classifyBatch: () => unavailable("classifyBatch", "none"),
  checkValidBatch: () => unavailable("checkValidBatch", "none"),
  qualityAvgBatch: () => unavailable("qualityAvgBatch", "none"),
  qualityTrimBatch: () => unavailable("qualityTrimBatch", "none"),
  qualityBinBatch: () => unavailable("qualityBinBatch", "none"),
  sequenceMetricsBatch: () => unavailable("sequenceMetricsBatch", "none"),
  translateBatch: () => unavailable("translateBatch", "none"),
  hashBatch: () => unavailable("hashBatch", "none"),
  createAlignmentReaderFromPath: () => unavailable("createAlignmentReaderFromPath", "none"),
  createAlignmentReaderFromBytes: () => unavailable("createAlignmentReaderFromBytes", "none"),
});

const buildLayerFromGenotypeBackend = (
  backend: GenotypeBackend,
  kind: "node-native" | "wasm"
): Layer.Layer<BackendService> =>
  Layer.succeed(
    BackendService,
    BackendService.of({
      kind,
      grepBatch: wrapOptionalMethod(backend.grepBatch?.bind(backend), "grepBatch", kind),
      findPatternBatch: wrapOptionalMethod(
        backend.findPatternBatch?.bind(backend),
        "findPatternBatch",
        kind
      ),
      transformBatch: wrapOptionalMethod(
        backend.transformBatch?.bind(backend),
        "transformBatch",
        kind
      ),
      removeGapsBatch: wrapOptionalMethod(
        backend.removeGapsBatch?.bind(backend),
        "removeGapsBatch",
        kind
      ),
      replaceAmbiguousBatch: wrapOptionalMethod(
        backend.replaceAmbiguousBatch?.bind(backend),
        "replaceAmbiguousBatch",
        kind
      ),
      replaceInvalidBatch: wrapOptionalMethod(
        backend.replaceInvalidBatch?.bind(backend),
        "replaceInvalidBatch",
        kind
      ),
      classifyBatch: wrapOptionalMethod(
        backend.classifyBatch?.bind(backend),
        "classifyBatch",
        kind
      ),
      checkValidBatch: wrapOptionalMethod(
        backend.checkValidBatch?.bind(backend),
        "checkValidBatch",
        kind
      ),
      qualityAvgBatch: wrapOptionalMethod(
        backend.qualityAvgBatch?.bind(backend),
        "qualityAvgBatch",
        kind
      ),
      qualityTrimBatch: wrapOptionalMethod(
        backend.qualityTrimBatch?.bind(backend),
        "qualityTrimBatch",
        kind
      ),
      qualityBinBatch: wrapOptionalMethod(
        backend.qualityBinBatch?.bind(backend),
        "qualityBinBatch",
        kind
      ),
      sequenceMetricsBatch: wrapOptionalMethod(
        backend.sequenceMetricsBatch?.bind(backend),
        "sequenceMetricsBatch",
        kind
      ),
      translateBatch: wrapOptionalMethod(
        backend.translateBatch?.bind(backend),
        "translateBatch",
        kind
      ),
      hashBatch: wrapOptionalMethod(backend.hashBatch?.bind(backend), "hashBatch", kind),
      createAlignmentReaderFromPath: wrapOptionalMethod(
        backend.createAlignmentReaderFromPath?.bind(backend),
        "createAlignmentReaderFromPath",
        kind
      ),
      createAlignmentReaderFromBytes: wrapOptionalMethod(
        backend.createAlignmentReaderFromBytes?.bind(backend),
        "createAlignmentReaderFromBytes",
        kind
      ),
    })
  );

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
    BackendService.of(buildNullBackendShape())
  );

  static readonly layer: Layer.Layer<BackendService> = Layer.unwrap(
    Effect.gen(function* () {
      if (typeof createNodeNativeBackend === "function") {
        const native = createNodeNativeBackend();
        if (native !== undefined) {
          return buildLayerFromGenotypeBackend(native, "node-native");
        }
      }

      const wasmResult = yield* Effect.promise(() => createWasmBackend().catch(() => undefined));
      if (wasmResult !== undefined) {
        return buildLayerFromGenotypeBackend(wasmResult, "wasm");
      }

      return BackendService.NullLayer;
    })
  );
}

/**
 * ManagedRuntime for running backend operations from non-Effect code.
 * Layers are memoized — detection runs once, then cached.
 */
export const backendRuntime = ManagedRuntime.make(
  Layer.provideMerge(BackendService.layer, RuntimeEnvLayer),
  { memoMap: Layer.makeMemoMapUnsafe() }
);

// ── Convenience exports ──────────────────────────────────────────────
// Promise-based wrappers so operations don't need to import Effect.

/** Classify every byte in every sequence into one of 12 classes. */
export const classifyBatch = (sequences: Uint8Array, offsets: Uint32Array) =>
  backendRuntime.runPromise(BackendService.use((b) => b.classifyBatch(sequences, offsets)));

/** Apply a length-preserving byte-level transformation. */
export const transformBatch = (sequences: Uint8Array, offsets: Uint32Array, op: TransformOp) =>
  backendRuntime.runPromise(BackendService.use((b) => b.transformBatch(sequences, offsets, op)));

/** Search sequences for a pattern within an edit distance. */
export const grepBatch = (
  sequences: Uint8Array,
  offsets: Uint32Array,
  pattern: Uint8Array,
  options: GrepBatchOptions
) =>
  backendRuntime.runPromise(
    BackendService.use((b) => b.grepBatch(sequences, offsets, pattern, options))
  );

/** Find all pattern matches with positions and edit distances. */
export const findPatternBatch = (
  sequences: Uint8Array,
  offsets: Uint32Array,
  pattern: Uint8Array,
  options: FindPatternBatchOptions
) =>
  backendRuntime.runPromise(
    BackendService.use((b) => b.findPatternBatch(sequences, offsets, pattern, options))
  );

/** Remove gap characters from sequences. */
export const removeGapsBatch = (sequences: Uint8Array, offsets: Uint32Array, gapChars: string) =>
  backendRuntime.runPromise(
    BackendService.use((b) => b.removeGapsBatch(sequences, offsets, gapChars))
  );

/** Replace non-standard bases with a replacement character. */
export const replaceAmbiguousBatch = (
  sequences: Uint8Array,
  offsets: Uint32Array,
  replacement: string
) =>
  backendRuntime.runPromise(
    BackendService.use((b) => b.replaceAmbiguousBatch(sequences, offsets, replacement))
  );

/** Replace invalid bytes for a given validation mode. */
export const replaceInvalidBatch = (
  sequences: Uint8Array,
  offsets: Uint32Array,
  mode: ValidationMode,
  replacement: string
) =>
  backendRuntime.runPromise(
    BackendService.use((b) => b.replaceInvalidBatch(sequences, offsets, mode, replacement))
  );

/** Check whether all bytes are valid for a given mode. */
export const checkValidBatch = (
  sequences: Uint8Array,
  offsets: Uint32Array,
  mode: ValidationMode
) =>
  backendRuntime.runPromise(BackendService.use((b) => b.checkValidBatch(sequences, offsets, mode)));

/** Compute average quality score per sequence. */
export const qualityAvgBatch = (quality: Uint8Array, offsets: Uint32Array, asciiOffset: number) =>
  backendRuntime.runPromise(
    BackendService.use((b) => b.qualityAvgBatch(quality, offsets, asciiOffset))
  );

/** Find quality trim positions per sequence. */
export const qualityTrimBatch = (
  quality: Uint8Array,
  offsets: Uint32Array,
  asciiOffset: number,
  threshold: number,
  windowSize: number,
  trimStart: boolean,
  trimEnd: boolean
) =>
  backendRuntime.runPromise(
    BackendService.use((b) =>
      b.qualityTrimBatch(quality, offsets, asciiOffset, threshold, windowSize, trimStart, trimEnd)
    )
  );

/** Remap quality bytes into fewer bins. */
export const qualityBinBatch = (
  quality: Uint8Array,
  offsets: Uint32Array,
  boundaries: Uint8Array,
  representatives: Uint8Array
) =>
  backendRuntime.runPromise(
    BackendService.use((b) => b.qualityBinBatch(quality, offsets, boundaries, representatives))
  );

/** Compute per-sequence metrics. */
export const sequenceMetricsBatch = (
  sequences: Uint8Array,
  seqOffsets: Uint32Array,
  quality: Uint8Array,
  qualOffsets: Uint32Array,
  metricFlags: number,
  asciiOffset: number
) =>
  backendRuntime.runPromise(
    BackendService.use((b) =>
      b.sequenceMetricsBatch(sequences, seqOffsets, quality, qualOffsets, metricFlags, asciiOffset)
    )
  );

/** Translate nucleotide sequences to proteins. */
export const translateBatch = (
  sequences: Uint8Array,
  offsets: Uint32Array,
  translationLut: Uint8Array,
  startMask: Uint8Array,
  alternativeStartMask: Uint8Array,
  options: TranslateBatchOptions
) =>
  backendRuntime.runPromise(
    BackendService.use((b) =>
      b.translateBatch(sequences, offsets, translationLut, startMask, alternativeStartMask, options)
    )
  );

/** Hash every sequence with XXH3-128. */
export const hashBatch = (sequences: Uint8Array, offsets: Uint32Array, caseInsensitive: boolean) =>
  backendRuntime.runPromise(
    BackendService.use((b) => b.hashBatch(sequences, offsets, caseInsensitive))
  );

/** Open an alignment reader from a file path. */
export const createAlignmentReaderFromPath = (path: string) =>
  backendRuntime.runPromise(BackendService.use((b) => b.createAlignmentReaderFromPath(path)));

/** Open an alignment reader from in-memory bytes. */
export const createAlignmentReaderFromBytes = (bytes: Uint8Array) =>
  backendRuntime.runPromise(BackendService.use((b) => b.createAlignmentReaderFromBytes(bytes)));
