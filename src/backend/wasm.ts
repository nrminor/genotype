/**
 * WebAssembly backend for genotype compute engine.
 *
 * Loads the wasm-pack output from crates/wasm-adapter/pkg/ and provides a
 * Layer<BackendService, WasmInitializationError>. The layer construction
 * is async (dynamic import + wasm init) and uses Effect.tryPromise for
 * typed initialization errors. Layer memoization in the ManagedRuntime
 * handles caching — no mutable module-level state.
 *
 * Wasm result structs are heap-allocated on the wasm side and must be
 * freed after use. Each method extracts the data it needs and calls
 * free() before returning.
 */

import { Effect, Layer, Schema } from "effect";
import { BackendService, BackendUnavailableError } from "./common";
import type {
  ClassifyResult,
  PatternSearchResult,
  SequenceMetricsResult,
  TransformResult,
} from "./kernel-types";
import type { AlignmentReaderHandle } from "./types";

export class WasmInitializationError extends Schema.TaggedErrorClass<WasmInitializationError>()(
  "WasmInitializationError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect) }
) {}

type WasmModule = typeof import("../../crates/wasm-adapter/pkg/genotype_wasm.js");

function buildFromModule(wasm: WasmModule) {
  return BackendService.of({
    kind: "wasm",
    grepBatch: (sequences, offsets, pattern, options) =>
      Effect.try({
        try: () =>
          wasm.grep_batch(
            sequences,
            offsets,
            pattern,
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
        try: () => {
          const r = wasm.find_pattern_batch(
            sequences,
            offsets,
            pattern,
            options.maxEdits,
            options.caseInsensitive
          );
          const result: PatternSearchResult = {
            starts: r.starts,
            ends: r.ends,
            costs: r.costs,
            matchOffsets: r.match_offsets,
          };
          r.free();
          return result;
        },
        catch: (e) =>
          new BackendUnavailableError({
            method: "findPatternBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    transformBatch: (sequences, offsets, op) =>
      Effect.try({
        try: () => {
          const r = wasm.transform_batch(sequences, offsets, op as string);
          const result: TransformResult = { data: r.data, offsets: r.offsets };
          r.free();
          return result;
        },
        catch: (e) =>
          new BackendUnavailableError({
            method: "transformBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    removeGapsBatch: (sequences, offsets, gapChars) =>
      Effect.try({
        try: () => {
          const r = wasm.remove_gaps_batch(sequences, offsets, gapChars);
          const result: TransformResult = { data: r.data, offsets: r.offsets };
          r.free();
          return result;
        },
        catch: (e) =>
          new BackendUnavailableError({
            method: "removeGapsBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    replaceAmbiguousBatch: (sequences, offsets, replacement) =>
      Effect.try({
        try: () => {
          const r = wasm.replace_ambiguous_batch(sequences, offsets, replacement);
          const result: TransformResult = { data: r.data, offsets: r.offsets };
          r.free();
          return result;
        },
        catch: (e) =>
          new BackendUnavailableError({
            method: "replaceAmbiguousBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    replaceInvalidBatch: (sequences, offsets, mode, replacement) =>
      Effect.try({
        try: () => {
          const r = wasm.replace_invalid_batch(sequences, offsets, mode as string, replacement);
          const result: TransformResult = { data: r.data, offsets: r.offsets };
          r.free();
          return result;
        },
        catch: (e) =>
          new BackendUnavailableError({
            method: "replaceInvalidBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    classifyBatch: (sequences, offsets) =>
      Effect.try({
        try: () => {
          const r = wasm.classify_batch(sequences, offsets);
          const result: ClassifyResult = { counts: r.counts };
          r.free();
          return result;
        },
        catch: (e) =>
          new BackendUnavailableError({
            method: "classifyBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    checkValidBatch: (sequences, offsets, mode) =>
      Effect.try({
        try: () => wasm.check_valid_batch(sequences, offsets, mode as string),
        catch: (e) =>
          new BackendUnavailableError({
            method: "checkValidBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    qualityAvgBatch: (quality, offsets, asciiOffset) =>
      Effect.try({
        try: () => wasm.quality_avg_batch(quality, offsets, asciiOffset),
        catch: (e) =>
          new BackendUnavailableError({
            method: "qualityAvgBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    qualityTrimBatch: (quality, offsets, asciiOffset, threshold, windowSize, trimStart, trimEnd) =>
      Effect.try({
        try: () =>
          wasm.quality_trim_batch(
            quality,
            offsets,
            asciiOffset,
            threshold,
            windowSize,
            trimStart,
            trimEnd
          ),
        catch: (e) =>
          new BackendUnavailableError({
            method: "qualityTrimBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    qualityBinBatch: (quality, offsets, boundaries, representatives) =>
      Effect.try({
        try: () => {
          const r = wasm.quality_bin_batch(quality, offsets, boundaries, representatives);
          const result: TransformResult = { data: r.data, offsets: r.offsets };
          r.free();
          return result;
        },
        catch: (e) =>
          new BackendUnavailableError({
            method: "qualityBinBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    sequenceMetricsBatch: (sequences, seqOffsets, quality, qualOffsets, metricFlags, asciiOffset) =>
      Effect.try({
        try: () => {
          const r = wasm.sequence_metrics_batch(
            sequences,
            seqOffsets,
            quality,
            qualOffsets,
            metricFlags,
            asciiOffset
          );
          const result: SequenceMetricsResult = {};
          if (r.lengths) result.lengths = r.lengths;
          if (r.gc) result.gc = r.gc;
          if (r.at) result.at = r.at;
          if (r.gc_skew) result.gcSkew = r.gc_skew;
          if (r.at_skew) result.atSkew = r.at_skew;
          if (r.entropy) result.entropy = r.entropy;
          if (r.alphabet_mask) result.alphabetMask = r.alphabet_mask;
          if (r.avg_qual) result.avgQual = r.avg_qual;
          if (r.min_qual) result.minQual = r.min_qual;
          if (r.max_qual) result.maxQual = r.max_qual;
          r.free();
          return result;
        },
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
        try: () => {
          const r = wasm.translate_batch(
            sequences,
            offsets,
            translationLut,
            startMask,
            alternativeStartMask,
            options.frameOffset,
            options.reverse,
            options.convertStartCodons,
            options.allowAlternativeStarts,
            options.trimAtFirstStop,
            options.removeStopCodons,
            options.stopCodonChar,
            options.unknownCodonChar
          );
          const result: TransformResult = { data: r.data, offsets: r.offsets };
          r.free();
          return result;
        },
        catch: (e) =>
          new BackendUnavailableError({
            method: "translateBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    hashBatch: (sequences, offsets, caseInsensitive) =>
      Effect.try({
        try: () => wasm.hash_batch(sequences, offsets, caseInsensitive),
        catch: (e) =>
          new BackendUnavailableError({
            method: "hashBatch",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
    createAlignmentReaderFromPath: (_path) =>
      Effect.fail(
        new BackendUnavailableError({
          method: "createAlignmentReaderFromPath",
          message: "wasm backend does not support file-based alignment reading",
        })
      ),
    createAlignmentReaderFromBytes: (bytes) =>
      Effect.try({
        try: (): AlignmentReaderHandle => {
          const reader = new wasm.WasmAlignmentReader(bytes);
          return {
            async readBatch(maxRecords: number) {
              const batch = reader.read_batch(maxRecords);
              if (batch === undefined) return null;
              const result = {
                count: batch.count,
                format: batch.format,
                qnameData: batch.qname_data,
                qnameOffsets: batch.qname_offsets,
                sequenceData: batch.sequence_data,
                sequenceOffsets: batch.sequence_offsets,
                qualityData: batch.quality_data,
                qualityOffsets: batch.quality_offsets,
                cigarData: batch.cigar_data,
                cigarOffsets: batch.cigar_offsets,
                rnameData: batch.rname_data,
                rnameOffsets: batch.rname_offsets,
                flags: batch.flags,
                positions: batch.positions,
                mappingQualities: batch.mapping_qualities,
              };
              batch.free();
              return result;
            },
            async headerText() {
              return reader.header_text();
            },
            async referenceSequences() {
              const wasmInfos = reader.reference_sequences();
              return wasmInfos.map((r: { name: string; length: number; free(): void }) => {
                const info = { name: r.name, length: r.length };
                r.free();
                return info;
              });
            },
            close() {
              reader.free();
            },
          };
        },
        catch: (e) =>
          new BackendUnavailableError({
            method: "createAlignmentReaderFromBytes",
            message: e instanceof Error ? e.message : String(e),
          }),
      }),
  });
}

export const wasmLayer: Layer.Layer<BackendService, WasmInitializationError> = Layer.effect(
  BackendService,
  Effect.gen(function* () {
    const mod = yield* Effect.tryPromise({
      try: async () => {
        const m = await import("../../crates/wasm-adapter/pkg/genotype_wasm.js");
        await m.default();
        return m;
      },
      catch: (cause) =>
        new WasmInitializationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    return buildFromModule(mod);
  })
);
