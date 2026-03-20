/**
 * WebAssembly backend for genotype compute engine.
 *
 * Loads the wasm-pack output from crates/wasm-adapter/pkg/ and wraps it
 * in the GenotypeBackend interface. Each method delegates to the
 * corresponding wasm export, converting between the wasm-bindgen types
 * and the backend's expected types.
 *
 * Wasm result structs are heap-allocated on the wasm side and must be
 * freed after use. Each method extracts the data it needs and calls
 * free() before returning.
 */

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
  GenotypeBackend,
  GrepBatchOptions,
  FindPatternBatchOptions,
} from "./types";

type WasmModule = typeof import("../../crates/wasm-adapter/pkg/genotype_wasm.js");

let wasmModule: WasmModule | undefined;
let initAttempted = false;

async function loadWasm(): Promise<WasmModule | undefined> {
  if (initAttempted) return wasmModule;
  initAttempted = true;

  try {
    const mod = await import("../../crates/wasm-adapter/pkg/genotype_wasm.js");
    await mod.default();
    wasmModule = mod;
  } catch {
    // Wasm module not available — this is expected when the crate
    // hasn't been built with wasm-pack.
  }

  return wasmModule;
}

export async function createWasmBackend(): Promise<GenotypeBackend | undefined> {
  const wasm = await loadWasm();
  if (wasm === undefined) return undefined;

  return {
    kind: "wasm",

    async grepBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      pattern: Uint8Array,
      options: GrepBatchOptions
    ): Promise<Uint8Array> {
      return wasm.grep_batch(
        sequences,
        offsets,
        pattern,
        options.maxEdits,
        options.caseInsensitive,
        options.searchBothStrands
      );
    },

    async findPatternBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      pattern: Uint8Array,
      options: FindPatternBatchOptions
    ): Promise<PatternSearchResult> {
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

    async transformBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      op: TransformOp
    ): Promise<TransformResult> {
      const r = wasm.transform_batch(sequences, offsets, op as string);
      const result: TransformResult = {
        data: r.data,
        offsets: r.offsets,
      };
      r.free();
      return result;
    },

    async removeGapsBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      gapChars: string
    ): Promise<TransformResult> {
      const r = wasm.remove_gaps_batch(sequences, offsets, gapChars);
      const result: TransformResult = {
        data: r.data,
        offsets: r.offsets,
      };
      r.free();
      return result;
    },

    async replaceAmbiguousBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      replacement: string
    ): Promise<TransformResult> {
      const r = wasm.replace_ambiguous_batch(sequences, offsets, replacement);
      const result: TransformResult = {
        data: r.data,
        offsets: r.offsets,
      };
      r.free();
      return result;
    },

    async replaceInvalidBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      mode: ValidationMode,
      replacement: string
    ): Promise<TransformResult> {
      const r = wasm.replace_invalid_batch(sequences, offsets, mode as string, replacement);
      const result: TransformResult = {
        data: r.data,
        offsets: r.offsets,
      };
      r.free();
      return result;
    },

    async classifyBatch(sequences: Uint8Array, offsets: Uint32Array): Promise<ClassifyResult> {
      const r = wasm.classify_batch(sequences, offsets);
      const result: ClassifyResult = { counts: r.counts };
      r.free();
      return result;
    },

    async checkValidBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      mode: ValidationMode
    ): Promise<Uint8Array> {
      return wasm.check_valid_batch(sequences, offsets, mode as string);
    },

    async qualityAvgBatch(
      quality: Uint8Array,
      offsets: Uint32Array,
      asciiOffset: number
    ): Promise<Float64Array> {
      return wasm.quality_avg_batch(quality, offsets, asciiOffset);
    },

    async qualityTrimBatch(
      quality: Uint8Array,
      offsets: Uint32Array,
      asciiOffset: number,
      threshold: number,
      windowSize: number,
      trimStart: boolean,
      trimEnd: boolean
    ): Promise<Uint32Array> {
      return wasm.quality_trim_batch(
        quality,
        offsets,
        asciiOffset,
        threshold,
        windowSize,
        trimStart,
        trimEnd
      );
    },

    async qualityBinBatch(
      quality: Uint8Array,
      offsets: Uint32Array,
      boundaries: Uint8Array,
      representatives: Uint8Array
    ): Promise<TransformResult> {
      const r = wasm.quality_bin_batch(quality, offsets, boundaries, representatives);
      const result: TransformResult = {
        data: r.data,
        offsets: r.offsets,
      };
      r.free();
      return result;
    },

    async sequenceMetricsBatch(
      sequences: Uint8Array,
      seqOffsets: Uint32Array,
      quality: Uint8Array,
      qualOffsets: Uint32Array,
      metricFlags: number,
      asciiOffset: number
    ): Promise<SequenceMetricsResult> {
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

    async translateBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      translationLut: Uint8Array,
      startMask: Uint8Array,
      alternativeStartMask: Uint8Array,
      options: TranslateBatchOptions
    ): Promise<TransformResult> {
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
      const result: TransformResult = {
        data: r.data,
        offsets: r.offsets,
      };
      r.free();
      return result;
    },

    async hashBatch(
      sequences: Uint8Array,
      offsets: Uint32Array,
      caseInsensitive: boolean
    ): Promise<Uint8Array> {
      return wasm.hash_batch(sequences, offsets, caseInsensitive);
    },

    async createAlignmentReaderFromBytes(bytes: Uint8Array): Promise<AlignmentReaderHandle> {
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
          return reader.reference_sequences().map((r: { name: string; length: number }) => ({
            name: r.name,
            length: r.length,
          }));
        },
      };
    },
  };
}
