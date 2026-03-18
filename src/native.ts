import type { AbstractSequence, FastqSequence } from "./types";

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
 * `counts` is a flat array of length `numSequences * NUM_CLASSES`, indexed as
 * `counts[seqIndex * NUM_CLASSES + classIndex]`. See the `CLASS_*` constants
 * for the 12 class indices.
 *
 * All comparisons are case-insensitive except gaps, which are literal.
 */
export interface ClassifyResult {
  counts: number[];
}

/** Number of byte classes returned by the classify kernel. */
export const NUM_CLASSES = 12;

/** Class index constants for indexing into ClassifyResult.counts. */
export const CLASS_A = 0;
export const CLASS_T = 1;
export const CLASS_U = 2;
export const CLASS_G = 3;
export const CLASS_C = 4;
export const CLASS_N = 5;
export const CLASS_STRONG = 6;
export const CLASS_WEAK = 7;
export const CLASS_TWO_BASE = 8;
export const CLASS_BDHV = 9;
export const CLASS_GAP = 10;
export const CLASS_OTHER = 11;

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

/**
 * CSR-style result for variable-length pattern match results.
 *
 * Each sequence produces zero or more matches. `matchOffsets` has length
 * `numSequences + 1`, and the matches for sequence `i` are at indices
 * `matchOffsets[i]..matchOffsets[i+1]` in the `starts`, `ends`, and
 * `costs` arrays.
 */
export interface PatternSearchResult {
  /** Match start positions (0-based, inclusive). */
  starts: number[];
  /** Match end positions (0-based, exclusive). */
  ends: number[];
  /** Edit distance costs for each match. */
  costs: number[];
  /** CSR offset array of length numSequences + 1. */
  matchOffsets: number[];
}

export interface SequenceMetricsResult {
  lengths?: number[];
  gc?: number[];
  at?: number[];
  gcSkew?: number[];
  atSkew?: number[];
  entropy?: number[];
  alphabetMask?: number[];
  avgQual?: number[];
  minQual?: number[];
  maxQual?: number[];
}

export interface TranslateBatchOptions {
  frameOffset: number;
  reverse: boolean;
  convertStartCodons: boolean;
  allowAlternativeStarts: boolean;
  trimAtFirstStop: boolean;
  removeStopCodons: boolean;
  stopCodonChar: string;
  unknownCodonChar: string;
}

export const enum SequenceMetricFlag {
  Length = 1 << 0,
  Gc = 1 << 1,
  At = 1 << 2,
  GcSkew = 1 << 3,
  AtSkew = 1 << 4,
  Entropy = 1 << 5,
  Alphabet = 1 << 6,
  AvgQual = 1 << 7,
  MinQual = 1 << 8,
  MaxQual = 1 << 9,
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
   * Find all pattern matches with positions and edit distances in a batch
   * of sequences.
   *
   * Uses the Iupac profile (forward-only) with traceback enabled, so IUPAC
   * degenerate bases are handled correctly and exact match start positions
   * are computed. The caller handles orientation by making separate calls
   * with the original and reverse-complement patterns.
   *
   * @param sequences - Concatenated sequence bytes
   * @param offsets - N+1 offset array into the sequences buffer
   * @param pattern - Pattern to search for
   * @param maxEdits - Maximum edit distance
   * @param caseInsensitive - Whether to ignore case (Iupac profile is inherently case-insensitive)
   * @returns CSR-style result with match positions and costs
   */
  findPatternBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    pattern: Buffer,
    maxEdits: number,
    caseInsensitive: boolean
  ): PatternSearchResult;

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
   * Replace bytes not in the allowed character set for the given validation
   * mode with a replacement character in every sequence in a packed batch.
   *
   * Valid bytes pass through unchanged; invalid bytes become the replacement.
   * This is the "fix" counterpart to `checkValidBatch`.
   *
   * @param sequences - Concatenated sequence bytes
   * @param offsets - N+1 offset array into the sequences buffer
   * @param mode - Which character set defines "valid"
   * @param replacement - Single character to replace invalid bytes with (defaults to "N" if empty)
   * @returns Transformed bytes and identical offsets
   */
  replaceInvalidBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    mode: ValidationMode,
    replacement: string
  ): TransformResult;

  /**
   * Classify every byte in every sequence into one of 12 classes.
   *
   * @param sequences - Concatenated sequence bytes
   * @param offsets - N+1 offset array into the sequences buffer
   * @returns Flat array of per-sequence counts (length = numSequences * NUM_CLASSES)
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

  /**
   * Compute the average quality score for each sequence in a batch.
   *
   * Quality bytes are Phred-encoded ASCII. The `asciiOffset` parameter
   * (33 for Phred+33, 64 for Phred+64 and Solexa) is subtracted to
   * convert from ASCII code to quality score.
   *
   * @param quality - Concatenated quality bytes
   * @param offsets - N+1 offset array into the quality buffer
   * @param asciiOffset - ASCII offset to subtract (33 or 64)
   * @returns Array of average quality scores, one per sequence
   */
  qualityAvgBatch(quality: Buffer, offsets: Uint32Array, asciiOffset: number): number[];

  /**
   * Find trim positions for each sequence in a batch using a sliding
   * window average quality threshold.
   *
   * Returns a flat array of length `numSequences * 2`, where
   * `result[i*2]` is the start position and `result[i*2+1]` is the
   * end position (exclusive). A `(0, 0)` pair means trimming consumed
   * the entire sequence.
   *
   * @param quality - Concatenated quality bytes
   * @param offsets - N+1 offset array into the quality buffer
   * @param asciiOffset - ASCII offset to subtract (33 or 64)
   * @param threshold - Minimum average quality score for a window to pass
   * @param windowSize - Number of bases in the sliding window
   * @param trimStart - Whether to trim from the 5' end
   * @param trimEnd - Whether to trim from the 3' end
   * @returns Flat array of start/end pairs, two per sequence
   */
  qualityTrimBatch(
    quality: Buffer,
    offsets: Uint32Array,
    asciiOffset: number,
    threshold: number,
    windowSize: number,
    trimStart: boolean,
    trimEnd: boolean
  ): number[];

  /**
   * Remap quality bytes into fewer bins using SIMD compare-and-select.
   *
   * `boundaries` and `representatives` are raw ASCII byte values
   * (pre-offset-adjusted by the caller). The kernel does pure byte
   * comparisons with no encoding awareness.
   *
   * @param quality - Concatenated quality bytes
   * @param offsets - N+1 offset array into the quality buffer
   * @param boundaries - ASCII byte thresholds between bins (length 1-4)
   * @param representatives - ASCII byte values for each bin (length = boundaries.length + 1)
   * @returns Remapped bytes and identical offsets (length-preserving)
   */
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

/**
 * Pack the quality strings from an array of FASTQ sequences into the
 * contiguous batch layout that Rust kernel functions expect.
 *
 * Parallel to {@link packSequences} but reads `.quality` instead of
 * `.sequence`. Returns the same `PackedBatch` shape.
 *
 * @param sequences - The FASTQ sequences whose quality strings to pack
 * @returns The packed batch layout
 */
export function packQualityStrings(sequences: readonly FastqSequence[]): PackedBatch {
  const count = sequences.length;
  const offsets = new Uint32Array(count + 1);

  const chunks: Uint8Array[] = new Array(count);
  let totalBytes = 0;
  for (let i = 0; i < count; i++) {
    const bytes = sequences[i]!.quality.toBytes();
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

/**
 * Pack an array of raw strings into the contiguous batch layout that
 * Rust kernel functions expect.
 *
 * Unlike {@link packSequences} which reads `.sequence` from
 * `AbstractSequence` objects, this packs arbitrary strings — useful
 * for packing windowed subsequences that have already been sliced
 * in TypeScript.
 *
 * @param strings - The strings to pack (encoded as latin1 bytes)
 * @returns The packed batch layout
 */
export function packStrings(strings: readonly string[]): PackedBatch {
  const count = strings.length;
  const offsets = new Uint32Array(count + 1);

  const chunks: Uint8Array[] = new Array(count);
  let totalBytes = 0;
  for (let i = 0; i < count; i++) {
    const bytes = Buffer.from(strings[i]!, "latin1");
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
