/**
 * Core sequence manipulation operations
 *
 * Provides fundamental sequence transformations including complement,
 * reverse, reverse-complement, and RNA/DNA conversions with full
 * IUPAC ambiguity code support.
 *
 * @module sequence-manipulation
 * @since v0.1.0
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * DNA complement mapping including IUPAC ambiguity codes
 * 🔥 NATIVE OPTIMIZATION: Lookup table could be SIMD-accelerated
 */
const DNA_COMPLEMENT_MAP: Record<string, string> = {
  A: "T",
  T: "A",
  C: "G",
  G: "C",
  U: "A", // RNA
  R: "Y",
  Y: "R", // Purines <-> Pyrimidines
  S: "S",
  W: "W", // Self-complementary
  K: "M",
  M: "K", // Keto <-> Amino
  B: "V",
  V: "B", // Not A <-> Not T
  D: "H",
  H: "D", // Not C <-> Not G
  N: "N", // Any remains any
  "-": "-",
  ".": ".",
  "*": "*", // Gaps and stops
};

/**
 * RNA complement mapping (U instead of T)
 */
const RNA_COMPLEMENT_MAP: Record<string, string> = {
  A: "U",
  U: "A",
  C: "G",
  G: "C",
  T: "A", // Handle DNA base in RNA
  R: "Y",
  Y: "R",
  S: "S",
  W: "W",
  K: "M",
  M: "K",
  B: "V",
  V: "B",
  D: "H",
  H: "D",
  N: "N",
  "-": "-",
  ".": ".",
  "*": "*",
};

// =============================================================================
// EXPORTED FUNCTIONS
// =============================================================================

/**
 * Generate complement of DNA/RNA sequence
 *
 * @example
 * ```typescript
 * const comp = complement('ATCG');
 * console.log(comp); // 'TAGC'
 *
 * const rnaComp = complement('AUCG');
 * console.log(rnaComp); // 'TAGC' (returns DNA complement by default)
 * ```
 *
 * @param sequence - DNA or RNA sequence to complement
 * @param isRNA - Whether to use RNA complement rules (default: false)
 * @returns Complemented sequence
 *
 * 🔥 NATIVE CRITICAL: Lookup table with SIMD processing
 */
export function complement(sequence: string, isRNA: boolean = false): string {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }

  const complementMap = isRNA ? RNA_COMPLEMENT_MAP : DNA_COMPLEMENT_MAP;

  // 🔥 NATIVE: Vectorized lookup table operations
  const upper = sequence.toUpperCase();
  const result = new Array(sequence.length);

  for (let i = 0; i < upper.length; i++) {
    const base = upper[i];
    if (base === null || base === undefined || base === "") continue;

    const comp = complementMap[base];
    const originalChar = sequence[i];

    if (
      comp === null ||
      comp === undefined ||
      comp === "" ||
      originalChar === null ||
      originalChar === undefined ||
      originalChar === ""
    ) {
      // Unknown character - keep as-is
      result[i] = originalChar;
    } else if (originalChar === originalChar.toLowerCase()) {
      // Preserve case
      result[i] = comp.toLowerCase();
    } else {
      result[i] = comp;
    }
  }

  return result.join("");
}

/**
 * Reverse a sequence (simple string reversal)
 *
 * @example
 * ```typescript
 * const rev = reverse('ATCG');
 * console.log(rev); // 'GCTA'
 * ```
 *
 * @param sequence - Sequence to reverse
 * @returns Reversed sequence
 *
 * 🔥 NATIVE CRITICAL: Simple array reversal could be SIMD-optimized
 */
export function reverse(sequence: string): string {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }

  // 🔥 NATIVE: Could use SIMD shuffle operations
  return sequence.split("").reverse().join("");
}

/**
 * Generate reverse complement of sequence
 *
 * @example
 * ```typescript
 * const rc = reverseComplement('ATCG');
 * console.log(rc); // 'CGAT'
 *
 * const rcRNA = reverseComplement('AUCG', true);
 * console.log(rcRNA); // 'CGAU'
 * ```
 *
 * @param sequence - Sequence to reverse complement
 * @param isRNA - Whether to use RNA complement rules (default: false)
 * @returns Reverse complemented sequence
 *
 * 🔥 NATIVE CRITICAL: Most common operation - prime optimization target
 */
export function reverseComplement(sequence: string, isRNA: boolean = false): string {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }

  // 🔥 NATIVE: Could combine both operations in single SIMD pass
  return reverse(complement(sequence, isRNA));
}

/**
 * Convert DNA sequence to RNA (T -> U)
 *
 * @example
 * ```typescript
 * const rna = toRNA('ATCG');
 * console.log(rna); // 'AUCG'
 * ```
 *
 * @param sequence - DNA sequence to convert
 * @returns RNA sequence
 *
 * 🔥 NATIVE: Simple character replacement - vectorizable
 */
export function toRNA(sequence: string): string {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }

  // 🔥 NATIVE: SIMD search and replace
  return sequence.replace(/[Tt]/g, (match) => (match === "T" ? "U" : "u"));
}

/**
 * Convert RNA sequence to DNA (U -> T)
 *
 * @example
 * ```typescript
 * const dna = toDNA('AUCG');
 * console.log(dna); // 'ATCG'
 * ```
 *
 * @param sequence - RNA sequence to convert
 * @returns DNA sequence
 *
 * 🔥 NATIVE: Simple character replacement - vectorizable
 */
export function toDNA(sequence: string): string {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }

  // 🔥 NATIVE: SIMD search and replace
  return sequence.replace(/[Uu]/g, (match) => (match === "U" ? "T" : "t"));
}

/**
 * Remove gap characters from sequence
 *
 * @example
 * ```typescript
 * const clean = removeGaps('AT-C.G*N');
 * console.log(clean); // 'ATCGN'
 *
 * const custom = removeGaps('AT_C.G', '_.');
 * console.log(custom); // 'ATCG'
 * ```
 *
 * @param sequence - Sequence with potential gaps
 * @param gapChars - Characters to remove (default: '.-*')
 * @returns Sequence with gaps removed
 *
 * 🔥 NATIVE: Character filtering loop - vectorizable
 */
export function removeGaps(sequence: string, gapChars: string = ".-*"): string {
  // Tiger Style: Assert meaningful constraints only
  if (sequence.length === 0) {
    return sequence; // Empty sequence handling
  }

  // 🔥 NATIVE: Character filtering could use SIMD
  // Create regex pattern from gap characters, escaping special regex chars
  const escapedChars = gapChars
    .split("")
    .map((char) => {
      // Escape special regex characters
      // Note: hyphen needs special handling in character classes
      if ("\\^$*+?.()|[]{}/-".includes(char)) {
        return `\\${char}`;
      }
      return char;
    })
    .join("");

  const pattern = new RegExp(`[${escapedChars}]`, "g");
  return sequence.replace(pattern, "");
}

/**
 * Replace ambiguous bases with a standard character
 *
 * @example
 * ```typescript
 * const clean = replaceAmbiguousBases('ATCGNR');
 * console.log(clean); // 'ATCGNN'
 *
 * const withX = replaceAmbiguousBases('ATCGNR', 'X');
 * console.log(withX); // 'ATCGXX'
 * ```
 *
 * @param sequence - Sequence with potential ambiguous bases
 * @param replaceChar - Character to use for replacement (default: 'N')
 * @returns Sequence with ambiguous bases replaced
 *
 * 🔥 NATIVE: Character validation and replacement loop - vectorizable
 */
export function replaceAmbiguousBases(sequence: string, replaceChar: string = "N"): string {
  // Tiger Style: Assert meaningful constraints only
  if (sequence.length === 0) {
    return sequence; // Empty sequence handling
  }
  if (replaceChar.length !== 1) {
    throw new Error("Replace character must be a single character");
  }

  // 🔥 NATIVE: Character replacement could use lookup table with SIMD
  // Replace any non-standard DNA/RNA bases
  // Standard bases: A, C, G, T, U
  // Everything else (including IUPAC codes) gets replaced
  return sequence.replace(/[^ACGTU]/gi, replaceChar);
}

// =============================================================================
// GROUPED EXPORT
// =============================================================================

/**
 * Grouped export of all sequence manipulation functions
 *
 * @example
 * ```typescript
 * import { SequenceManipulation } from './sequence-manipulation';
 * const rc = SequenceManipulation.reverseComplement('ATCG');
 * const clean = SequenceManipulation.removeGaps('AT-CG');
 * ```
 */
export const SequenceManipulation = {
  complement,
  reverse,
  reverseComplement,
  toRNA,
  toDNA,
  removeGaps,
  replaceAmbiguousBases,
} as const;
