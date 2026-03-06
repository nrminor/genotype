import type { AbstractSequence } from "./types";

/**
 * The native kernel interface. Each function here corresponds to a
 * `#[napi]` export from the Rust crate in `src/native/`.
 */
/** The result of a batch transform operation from the native kernel. */
export interface TransformResult {
  /** Transformed sequence bytes, contiguous in a single Buffer. */
  data: Buffer;
  /** N+1 offset array where offsets[i] is the byte position where sequence i starts. */
  offsets: number[];
}

export interface NativeKernel {
  /** Search a batch of sequences for a pattern within a given edit distance. */
  grepBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    pattern: Buffer,
    maxEdits: number,
    caseInsensitive: boolean,
    searchBothStrands: boolean
  ): Buffer;

  /**
   * Apply a byte-level transformation to every sequence in a packed batch.
   *
   * @param sequences - Concatenated sequence bytes
   * @param offsets - N+1 offset array into the sequences buffer
   * @param operation - The transformation to apply
   * @param param - Operation-specific parameter (gap chars, replacement char, or empty string)
   * @returns Transformed bytes and new offsets
   */
  transformBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    operation: string,
    param: string
  ): TransformResult;
}

/**
 * The result of packing an array of sequences into the batch layout
 * expected by native kernel functions.
 */
export interface PackedBatch {
  /** Concatenated sequence bytes, contiguous in a single Buffer. */
  data: Buffer;
  /** N+1 offset array where offsets[i] is the byte position where sequence i starts. */
  offsets: Uint32Array;
}

/**
 * Pack an array of sequences into the contiguous batch layout that Rust
 * kernel functions expect: a single `Buffer` of concatenated sequence
 * bytes and a `Uint32Array` of N+1 offsets.
 *
 * This is shared infrastructure for all native-accelerated operations,
 * not specific to grep. It is not exported from the package root.
 *
 * @param sequences - The sequences to pack
 * @returns The packed batch layout
 */
export function packSequences(sequences: readonly AbstractSequence[]): PackedBatch {
  const count = sequences.length;
  const offsets = new Uint32Array(count + 1);

  const chunks: Uint8Array[] = new Array(count);
  let totalBytes = 0;
  for (let i = 0; i < count; i++) {
    const bytes = sequences[i]!.sequence.toBytes();
    chunks[i] = bytes;
    offsets[i] = totalBytes;
    totalBytes += bytes.length;
  }
  offsets[count] = totalBytes;

  const data = Buffer.allocUnsafe(totalBytes);
  for (let i = 0; i < count; i++) {
    data.set(chunks[i]!, offsets[i]!);
  }

  return { data, offsets };
}

let kernel: NativeKernel | undefined;
let loadAttempted = false;

function loadKernel(): NativeKernel | undefined {
  if (loadAttempted) return kernel;
  loadAttempted = true;

  try {
    // Use napi-rs's generated loader, which handles all platform/arch/libc
    // combinations (linux-x64-gnu, linux-x64-musl, darwin-arm64, etc.)
    // rather than constructing the .node filename ourselves.
    kernel = require("./native/index.js") as NativeKernel;
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
 * loaded, `false` otherwise. Used by processors to decide whether to
 * delegate to native-accelerated code paths.
 */
export function isNativeAvailable(): boolean {
  return loadKernel() !== undefined;
}

/**
 * Get the native kernel, or `undefined` if it's not available.
 *
 * Callers should check `isNativeAvailable()` first or handle the
 * `undefined` case. The kernel is loaded lazily on first access.
 */
export function getNativeKernel(): NativeKernel | undefined {
  return loadKernel();
}
