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

/**
 * The result of a batch classify operation from the native kernel.
 *
 * `counts` is a flat array of length `numSequences * 8`, indexed as
 * `counts[seqIndex * 8 + classIndex]`. The 8 classes are:
 *
 * - 0: AT (A, T, U)
 * - 1: GC (G, C)
 * - 2: strong (S — represents G or C)
 * - 3: weak (W — represents A or T)
 * - 4: two-base ambiguity (R, Y, K, M)
 * - 5: multi-base ambiguity (N, B, D, H, V)
 * - 6: gap (-, ., *)
 * - 7: other (everything else)
 *
 * All comparisons are case-insensitive except gaps, which are literal.
 */
export interface ClassifyResult {
  counts: number[];
}

/**
 * Length-preserving byte-level transformations. Each variant maps to a
 * SIMD-accelerated kernel function in the Rust crate.
 *
 * Values match the napi-rs generated `const enum` from the Rust
 * `#[napi(string_enum)] TransformOp`.
 */
export const enum TransformOp {
  /** DNA complement (A↔T, C↔G, IUPAC codes) */
  Complement = "Complement",
  /** RNA complement (A↔U, C↔G, IUPAC codes) */
  ComplementRna = "ComplementRna",
  /** Reverse byte order */
  Reverse = "Reverse",
  /** DNA complement + reverse in one pass */
  ReverseComplement = "ReverseComplement",
  /** RNA complement + reverse in one pass */
  ReverseComplementRna = "ReverseComplementRna",
  /** T→U (case-preserving) */
  ToRna = "ToRna",
  /** U→T (case-preserving) */
  ToDna = "ToDna",
  /** Lowercase ASCII letters → uppercase */
  UpperCase = "UpperCase",
  /** Uppercase ASCII letters → lowercase */
  LowerCase = "LowerCase",
}

/**
 * Validation modes for `checkValidBatch`. Each mode defines a different
 * set of allowed characters, with a dedicated SIMD comparison chain on
 * the Rust side.
 *
 * Values match the napi-rs generated `const enum` from the Rust
 * `#[napi(string_enum)] ValidationMode`.
 */
export const enum ValidationMode {
  /** ACGT + gaps (.-*) */
  StrictDna = "StrictDna",
  /** ACGTU + all IUPAC ambiguity codes + gaps */
  NormalDna = "NormalDna",
  /** ACGU + gaps */
  StrictRna = "StrictRna",
  /** ACGU + all IUPAC ambiguity codes (no T) + gaps */
  NormalRna = "NormalRna",
  /** 20 standard amino acids + gaps */
  Protein = "Protein",
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
   * Apply a length-preserving byte-level transformation to every sequence
   * in a packed batch.
   *
   * @param sequences - Concatenated sequence bytes
   * @param offsets - N+1 offset array into the sequences buffer
   * @param op - Which transformation to apply
   * @returns Transformed bytes and identical offsets
   */
  transformBatch(sequences: Buffer, offsets: Uint32Array, op: TransformOp): TransformResult;

  /**
   * Remove gap characters from every sequence in a packed batch.
   *
   * This is the only transform operation that changes sequence lengths,
   * so the returned offsets reflect the compacted byte positions.
   *
   * @param sequences - Concatenated sequence bytes
   * @param offsets - N+1 offset array into the sequences buffer
   * @param gapChars - Characters to treat as gaps (defaults to ".-*" if empty)
   * @returns Compacted bytes and new offsets
   */
  removeGapsBatch(sequences: Buffer, offsets: Uint32Array, gapChars: string): TransformResult;

  /**
   * Replace non-standard bases (anything other than ACGTU) with a
   * replacement character in every sequence in a packed batch.
   *
   * @param sequences - Concatenated sequence bytes
   * @param offsets - N+1 offset array into the sequences buffer
   * @param replacement - Single character to use as replacement (defaults to "N" if empty)
   * @returns Transformed bytes and identical offsets
   */
  replaceAmbiguousBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    replacement: string
  ): TransformResult;

  /**
   * Classify every byte in every sequence into one of 8 classes.
   *
   * @param sequences - Concatenated sequence bytes
   * @param offsets - N+1 offset array into the sequences buffer
   * @returns Flat array of per-sequence counts (length = numSequences * 8)
   */
  classifyBatch(sequences: Buffer, offsets: Uint32Array): ClassifyResult;

  /**
   * Check whether every byte in every sequence belongs to the allowed
   * character set for the given validation mode.
   *
   * @param sequences - Concatenated sequence bytes
   * @param offsets - N+1 offset array into the sequences buffer
   * @param mode - Which character set to validate against
   * @returns Buffer of length numSequences where each byte is 1 (valid) or 0 (invalid)
   */
  checkValidBatch(sequences: Buffer, offsets: Uint32Array, mode: ValidationMode): Buffer;
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
