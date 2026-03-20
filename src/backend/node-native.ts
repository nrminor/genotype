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
  GenotypeBackend,
  ReferenceSequenceInfo,
} from "./types";

/**
 * The native kernel interface. Each function here corresponds to a
 * `#[napi]` export from the Rust crate in `src/native/`.
 */
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
  ): PatternSearchResult;

  transformBatch(sequences: Buffer, offsets: Uint32Array, op: TransformOp): TransformResult;

  removeGapsBatch(sequences: Buffer, offsets: Uint32Array, gapChars: string): TransformResult;

  replaceAmbiguousBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    replacement: string
  ): TransformResult;

  replaceInvalidBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    mode: ValidationMode,
    replacement: string
  ): TransformResult;

  classifyBatch(sequences: Buffer, offsets: Uint32Array): ClassifyResult;

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
  ): TransformResult;

  sequenceMetricsBatch(
    sequences: Buffer,
    seqOffsets: Uint32Array,
    quality: Buffer,
    qualOffsets: Uint32Array,
    metricFlags: number,
    asciiOffset: number
  ): SequenceMetricsResult;

  translateBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    translationLut: Buffer,
    startMask: Buffer,
    alternativeStartMask: Buffer,
    options: TranslateBatchOptions
  ): TransformResult;

  hashBatch(sequences: Buffer, offsets: Uint32Array, caseInsensitive: boolean): Buffer;
}

let kernel: NativeKernel | undefined;
let kernelLoadAttempted = false;

function loadKernel(): NativeKernel | undefined {
  if (kernelLoadAttempted) return kernel;
  kernelLoadAttempted = true;

  try {
    // Use napi-rs's generated loader, which handles all platform/arch/libc
    // combinations (linux-x64-gnu, linux-x64-musl, darwin-arm64, etc.)
    // rather than constructing the .node filename ourselves.
    kernel = require("../native/index.js") as NativeKernel;
  } catch {
    // Native kernel not available — this is expected when the Rust
    // crate hasn't been built. All native-accelerated code paths
    // have TypeScript fallbacks.
  }

  return kernel;
}

/**
 * Whether the native kernel is available on this platform.
 *
 * Returns `true` if the napi-rs native module was built and can be
 * loaded, `false` otherwise.
 */
export function isNativeAvailable(): boolean {
  return loadKernel() !== undefined;
}

/**
 * Get the native kernel, or `undefined` if it's not available.
 *
 * The kernel is loaded lazily on first access.
 */
export function getNativeKernel(): NativeKernel | undefined {
  return loadKernel();
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

let cachedAlignmentModule: NativeAlignmentModule | undefined;
let alignmentLoadAttempted = false;

function loadAlignmentModule(): NativeAlignmentModule | undefined {
  if (alignmentLoadAttempted) return cachedAlignmentModule;
  alignmentLoadAttempted = true;

  try {
    cachedAlignmentModule = require("../native/index.js") as NativeAlignmentModule;
  } catch {
    // Native addon not available.
  }

  return cachedAlignmentModule;
}

function toBufferView(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
  };
}

/**
 * Create the Node/Bun native backend if the napi addon is available.
 */
export function createNodeNativeBackend(): GenotypeBackend | undefined {
  const kernel = getNativeKernel();
  const alignment = loadAlignmentModule();

  if (kernel === undefined && alignment === undefined) {
    return undefined;
  }

  return {
    kind: "node-native",

    async grepBatch(sequences, offsets, pattern, options) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return kernel.grepBatch(
        toBufferView(sequences),
        offsets,
        toBufferView(pattern),
        options.maxEdits,
        options.caseInsensitive,
        options.searchBothStrands
      );
    },

    async findPatternBatch(sequences, offsets, pattern, options) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return kernel.findPatternBatch(
        toBufferView(sequences),
        offsets,
        toBufferView(pattern),
        options.maxEdits,
        options.caseInsensitive
      );
    },

    async transformBatch(sequences, offsets, op) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return kernel.transformBatch(toBufferView(sequences), offsets, op);
    },

    async removeGapsBatch(sequences, offsets, gapChars) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return kernel.removeGapsBatch(toBufferView(sequences), offsets, gapChars);
    },

    async replaceAmbiguousBatch(sequences, offsets, replacement) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return kernel.replaceAmbiguousBatch(toBufferView(sequences), offsets, replacement);
    },

    async replaceInvalidBatch(sequences, offsets, mode, replacement) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return kernel.replaceInvalidBatch(toBufferView(sequences), offsets, mode, replacement);
    },

    async classifyBatch(sequences, offsets) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return kernel.classifyBatch(toBufferView(sequences), offsets);
    },

    async checkValidBatch(sequences, offsets, mode) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return kernel.checkValidBatch(toBufferView(sequences), offsets, mode);
    },

    async qualityAvgBatch(quality, offsets, asciiOffset) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return Float64Array.from(kernel.qualityAvgBatch(toBufferView(quality), offsets, asciiOffset));
    },

    async qualityTrimBatch(
      quality,
      offsets,
      asciiOffset,
      threshold,
      windowSize,
      trimStart,
      trimEnd
    ) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return Uint32Array.from(
        kernel.qualityTrimBatch(
          toBufferView(quality),
          offsets,
          asciiOffset,
          threshold,
          windowSize,
          trimStart,
          trimEnd
        )
      );
    },

    async qualityBinBatch(quality, offsets, boundaries, representatives) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return kernel.qualityBinBatch(
        toBufferView(quality),
        offsets,
        toBufferView(boundaries),
        toBufferView(representatives)
      );
    },

    async sequenceMetricsBatch(
      sequences,
      seqOffsets,
      quality,
      qualOffsets,
      metricFlags,
      asciiOffset
    ) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return kernel.sequenceMetricsBatch(
        toBufferView(sequences),
        seqOffsets,
        toBufferView(quality),
        qualOffsets,
        metricFlags,
        asciiOffset
      );
    },

    async translateBatch(
      sequences,
      offsets,
      translationLut,
      startMask,
      alternativeStartMask,
      options
    ) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return kernel.translateBatch(
        toBufferView(sequences),
        offsets,
        toBufferView(translationLut),
        toBufferView(startMask),
        toBufferView(alternativeStartMask),
        options
      );
    },

    async hashBatch(sequences, offsets, caseInsensitive) {
      if (kernel === undefined) throw new Error("Native kernel unavailable");
      return kernel.hashBatch(toBufferView(sequences), offsets, caseInsensitive);
    },

    async createAlignmentReaderFromPath(path: string): Promise<AlignmentReaderHandle> {
      if (alignment === undefined) throw new Error("Alignment reader unavailable");
      return wrapAlignmentReader(alignment.AlignmentReader.open(path));
    },

    async createAlignmentReaderFromBytes(bytes: Uint8Array): Promise<AlignmentReaderHandle> {
      if (alignment === undefined) throw new Error("Alignment reader unavailable");
      return wrapAlignmentReader(alignment.AlignmentReader.openBytes(toBufferView(bytes)));
    },
  };
}

/**
 * Internal synchronous access to the current Node-native kernel.
 *
 * This exists only for rare synchronous helper paths that cannot be
 * made async without a larger public API change. New production code
 * should prefer the async backend abstraction.
 */
export function getNodeNativeKernelSync() {
  return getNativeKernel();
}

/**
 * Whether the node-native backend is available in the current runtime.
 */
export function isNodeNativeBackendAvailable(): boolean {
  return createNodeNativeBackend() !== undefined;
}
