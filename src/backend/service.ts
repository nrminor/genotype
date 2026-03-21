/**
 * Backend service wiring and runtime.
 *
 * Composes the native and wasm backend layers into BackendService.layer
 * via Layer.catchTag fallback, and provides the ManagedRuntime that
 * bridges Effect-managed services into Promise-based operation code.
 *
 * The BackendService interface and error types are defined in common.ts
 * to avoid circular imports between this module and the backend
 * implementations.
 */

import { Layer, ManagedRuntime } from "effect";
import type { TransformOp, TranslateBatchOptions, ValidationMode } from "./kernel-types";
import type { FindPatternBatchOptions, GrepBatchOptions } from "./types";
import { BackendService, BackendUnavailableError } from "./common";
import { nativeLayer } from "./node-native";
import { wasmLayer } from "./wasm";
import { RuntimeEnvLayer } from "../io/layers";

export { BackendService, BackendUnavailableError } from "./common";

const backendLayer: Layer.Layer<BackendService> = nativeLayer.pipe(
  Layer.catchTag("NativeAddonNotFoundError", () =>
    wasmLayer.pipe(Layer.catchTag("WasmInitializationError", () => BackendService.NullLayer))
  )
);

/**
 * ManagedRuntime for running backend operations from non-Effect code.
 * Layers are memoized — detection runs once, then cached.
 */
export const backendRuntime = ManagedRuntime.make(
  Layer.provideMerge(backendLayer, RuntimeEnvLayer),
  { memoMap: Layer.makeMemoMapUnsafe() }
);

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
