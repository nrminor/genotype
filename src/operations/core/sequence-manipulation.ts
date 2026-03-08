/**
 * Core sequence manipulation operations
 *
 * Provides fundamental sequence transformations including complement,
 * reverse, reverse-complement, and RNA/DNA conversions with full
 * IUPAC ambiguity code support.
 *
 */

import { GenotypeString, asString } from "../../genotype-string";
import { ValidationError } from "../../errors";

/**
 * DNA complement mapping including IUPAC ambiguity codes
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
 * @returns Complemented sequence (same type as input)
 *
 */
export function complement(sequence: GenotypeString, isRNA?: boolean): GenotypeString;
export function complement(sequence: string, isRNA?: boolean): string;
export function complement(
  sequence: GenotypeString | string,
  isRNA: boolean = false
): GenotypeString | string {
  const seq = asString(sequence);
  if (seq.length === 0) {
    throw new ValidationError("Sequence must be non-empty");
  }

  const complementMap = isRNA ? RNA_COMPLEMENT_MAP : DNA_COMPLEMENT_MAP;

  const upper = seq.toUpperCase();
  const result = new Array(seq.length);

  for (let i = 0; i < upper.length; i++) {
    const base = upper[i];
    if (base === null || base === undefined || base === "") continue;

    const comp = complementMap[base];
    const originalChar = seq[i];

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

  const out = result.join("");
  return sequence instanceof GenotypeString ? GenotypeString.fromString(out) : out;
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
 * @returns Reversed sequence (same type as input)
 *
 */
export function reverse(sequence: GenotypeString): GenotypeString;
export function reverse(sequence: string): string;
export function reverse(sequence: GenotypeString | string): GenotypeString | string {
  const seq = asString(sequence);
  if (seq.length === 0) {
    throw new ValidationError("Sequence must be non-empty");
  }

  const out = seq.split("").reverse().join("");
  return sequence instanceof GenotypeString ? GenotypeString.fromString(out) : out;
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
 * @returns Reverse complemented sequence (same type as input)
 *
 */
export function reverseComplement(sequence: GenotypeString, isRNA?: boolean): GenotypeString;
export function reverseComplement(sequence: string, isRNA?: boolean): string;
export function reverseComplement(
  sequence: GenotypeString | string,
  isRNA: boolean = false
): GenotypeString | string {
  const seq = asString(sequence);
  if (seq.length === 0) {
    throw new ValidationError("Sequence must be non-empty");
  }

  // Pass the plain string to avoid double-wrapping — complement and reverse
  // will return strings, then we wrap once at the end if needed.
  const out = reverse(complement(seq, isRNA));
  return sequence instanceof GenotypeString ? GenotypeString.fromString(out) : out;
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
 * @returns RNA sequence (same type as input)
 *
 */
export function toRNA(sequence: GenotypeString): GenotypeString;
export function toRNA(sequence: string): string;
export function toRNA(sequence: GenotypeString | string): GenotypeString | string {
  const seq = asString(sequence);
  if (seq.length === 0) {
    throw new ValidationError("Sequence must be non-empty");
  }

  const out = seq.replace(/[Tt]/g, (match) => (match === "T" ? "U" : "u"));
  return sequence instanceof GenotypeString ? GenotypeString.fromString(out) : out;
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
 * @returns DNA sequence (same type as input)
 *
 */
export function toDNA(sequence: GenotypeString): GenotypeString;
export function toDNA(sequence: string): string;
export function toDNA(sequence: GenotypeString | string): GenotypeString | string {
  const seq = asString(sequence);
  if (seq.length === 0) {
    throw new ValidationError("Sequence must be non-empty");
  }

  const out = seq.replace(/[Uu]/g, (match) => (match === "U" ? "T" : "t"));
  return sequence instanceof GenotypeString ? GenotypeString.fromString(out) : out;
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
 * @returns Sequence with gaps removed (same type as input)
 *
 */
export function removeGaps(sequence: GenotypeString, gapChars?: string): GenotypeString;
export function removeGaps(sequence: string, gapChars?: string): string;
export function removeGaps(
  sequence: GenotypeString | string,
  gapChars: string = ".-*"
): GenotypeString | string {
  const seq = asString(sequence);
  if (seq.length === 0) {
    return sequence instanceof GenotypeString ? GenotypeString.fromString(seq) : seq;
  }

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
  const out = seq.replace(pattern, "");
  return sequence instanceof GenotypeString ? GenotypeString.fromString(out) : out;
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
 * @returns Sequence with ambiguous bases replaced (same type as input)
 *
 */
export function replaceAmbiguousBases(
  sequence: GenotypeString,
  replaceChar?: string
): GenotypeString;
export function replaceAmbiguousBases(sequence: string, replaceChar?: string): string;
export function replaceAmbiguousBases(
  sequence: GenotypeString | string,
  replaceChar: string = "N"
): GenotypeString | string {
  const seq = asString(sequence);
  if (seq.length === 0) {
    return sequence instanceof GenotypeString ? GenotypeString.fromString(seq) : seq;
  }
  if (replaceChar.length !== 1) {
    throw new ValidationError("Replace character must be a single character");
  }

  // Replace any non-standard DNA/RNA bases
  // Standard bases: A, C, G, T, U
  // Everything else (including IUPAC codes) gets replaced
  const out = seq.replace(/[^ACGTU]/gi, replaceChar);
  return sequence instanceof GenotypeString ? GenotypeString.fromString(out) : out;
}

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
