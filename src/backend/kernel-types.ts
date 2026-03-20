/**
 * Kernel contract types shared across all backend implementations.
 *
 * This module defines the result interfaces, const enums, and constants
 * that describe what kernels accept and return. These are backend-neutral:
 * the same types apply whether the kernel runs via napi, wasm, or a
 * pure-TypeScript fallback.
 */

/** The result of a batch transform operation. */
export interface TransformResult {
  /** Transformed sequence bytes, contiguous in a single buffer. */
  data: Uint8Array;
  /** N+1 offset array where offsets[i] is the byte position where sequence i starts. */
  offsets: number[];
}

/**
 * The result of a batch classify operation.
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
