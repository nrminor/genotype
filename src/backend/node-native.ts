import { getNativeKernel } from "../native";
import type {
  AlignmentBatch,
  AlignmentReaderHandle,
  GenotypeBackend,
  ReferenceSequenceInfo,
} from "./types";

interface NativeAlignmentReader {
  readBatch(maxRecords: number): AlignmentBatch | null;
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
      return reader.readBatch(maxRecords);
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
      return kernel.qualityAvgBatch(toBufferView(quality), offsets, asciiOffset);
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
      return kernel.qualityTrimBatch(
        toBufferView(quality),
        offsets,
        asciiOffset,
        threshold,
        windowSize,
        trimStart,
        trimEnd
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
