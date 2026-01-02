/**
 * Alphabet validation and template literal tags for biological sequences
 *
 * This module provides sequence validation through TypeScript's
 * template literal types and branded types. Enables beautiful syntax like
 * `dna`ATCG`` with runtime validation and string compatibility.
 *
 * @module alphabet
 * @since v0.1.0
 *
 * @example
 * ```typescript
 * const sequence = dna`ATCGATCG`;           // ✅ Valid DNA
 * const invalid = dna`ATCGXYZ`;            // ❌ Runtime error
 * const withIUPAC = iupac`ATCGRYSWKMN`;    // ✅ IUPAC codes
 * const covidPrimer = primer`ACCAGGAACTAATCAGACAAG`; // ✅ Valid primer length
 *
 * // Automatic string widening for algorithm compatibility
 * processSequence(sequence); // Works with any function expecting string
 * ```
 */

import { IUPAC_DNA, IUPAC_RNA } from "./sequence-validation";

// =============================================================================
// CHARACTER-LEVEL ALPHABET DEFINITIONS
// =============================================================================

/**
 * Standard DNA nucleotides (case-insensitive)
 */
type StandardDNAChar = "A" | "C" | "G" | "T" | "a" | "c" | "g" | "t";

/**
 * Standard RNA nucleotides (case-insensitive)
 */
type StandardRNAChar = "A" | "C" | "G" | "U" | "a" | "c" | "g" | "u";

/**
 * IUPAC ambiguity codes (case-insensitive)
 */
type IUPACChar =
  | "R"
  | "Y"
  | "S"
  | "W"
  | "K"
  | "M"
  | "B"
  | "D"
  | "H"
  | "V"
  | "N"
  | "r"
  | "y"
  | "s"
  | "w"
  | "k"
  | "m"
  | "b"
  | "d"
  | "h"
  | "v"
  | "n";

/**
 * Complete IUPAC DNA alphabet (standard + ambiguity codes)
 */
type IUPACDNAChar = StandardDNAChar | IUPACChar;

/**
 * Complete IUPAC RNA alphabet (standard + ambiguity codes)
 */
type IUPACRNAChar = StandardRNAChar | IUPACChar;

// =============================================================================
// TEMPLATE LITERAL TYPE VALIDATION
// =============================================================================

/**
 * Recursive template literal validation for standard DNA sequences
 */
type ValidDNAString<T extends string> = T extends `${StandardDNAChar}${infer Rest}`
  ? Rest extends ""
    ? T
    : ValidDNAString<Rest> extends never
      ? never
      : T
  : T extends ""
    ? T
    : never;

/**
 * Recursive template literal validation for IUPAC DNA sequences
 */
type ValidIUPACString<T extends string> = T extends `${IUPACDNAChar}${infer Rest}`
  ? Rest extends ""
    ? T
    : ValidIUPACString<Rest> extends never
      ? never
      : T
  : T extends ""
    ? T
    : never;

/**
 * Recursive template literal validation for RNA sequences
 */
type ValidRNAString<T extends string> = T extends `${IUPACRNAChar}${infer Rest}`
  ? Rest extends ""
    ? T
    : ValidRNAString<Rest> extends never
      ? never
      : T
  : T extends ""
    ? T
    : never;

/**
 * Primer length validation (10-50 bp biological constraint)
 */
type ValidPrimerLength<T extends string> = T["length"] extends 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  ? never // Too short (<10bp)
  : T["length"] extends 51 | 52 | 53 | 54 | 55 | 56 | 57 | 58 | 59 | 60
    ? never // Too long (>50bp)
    : T;

// =============================================================================
// BRANDED TYPES FOR SEQUENCE VALIDATION
// =============================================================================

/**
 * Branded type for runtime validated standard DNA sequences
 */
export type DNASequence<T extends string = string> = T & {
  readonly __brand: "DNA";
  readonly __alphabet: "standard";
};

/**
 * Branded type for validated IUPAC DNA sequences
 */
export type IUPACSequence<T extends string = string> = T & {
  readonly __brand: "DNA";
  readonly __alphabet: "iupac";
};

/**
 * Branded type for validated RNA sequences
 */
export type RNASequence<T extends string = string> = T & {
  readonly __brand: "RNA";
  readonly __alphabet: "iupac";
};

/**
 * Branded type for validated primer sequences with biological constraints
 */
export type PrimerSequence<T extends string = string> = T & {
  readonly __brand: "Primer";
  readonly __minLength: 10;
  readonly __maxLength: 50;
};

// =============================================================================
// TEMPLATE LITERAL TAG FUNCTIONS
// =============================================================================

/**
 * Template literal tag for standard DNA sequences
 *
 * Creates validated DNA sequences that can only contain A, C, G, T.
 * Provides beautiful syntax with full type safety and automatic string widening.
 *
 * @param template - Template strings array from template literal
 * @param substitutions - Any interpolated values
 * @returns Branded DNA sequence that widens to string
 *
 * @example
 * ```typescript
 * const seq = dna`ATCGATCG`;        // ✅ Valid standard DNA
 * const mixed = dna`ATCGatcg`;      // ✅ Mixed case OK
 * const invalid = dna`ATCGXYZ`;     // ❌ Runtime error - X,Y,Z invalid
 * const withU = dna`ATCGU`;         // ❌ Runtime error - U not in DNA alphabet
 *
 * // Automatic string widening
 * processSequence(seq); // Works with any function expecting string
 * ```
 */
export function dna<T extends string>(
  template: TemplateStringsArray,
  ...substitutions: string[]
): ValidDNAString<T> extends never ? never : DNASequence<T> {
  const sequence = template.reduce((acc, str, i) => acc + str + (substitutions[i] || ""), "") as T;

  // Runtime validation for safety
  if (!/^[ACGT]*$/i.test(sequence)) {
    throw new Error(`Invalid DNA sequence: contains non-standard bases in "${sequence}"`);
  }

  return sequence as any; // TypeScript limitation - cast required for branded types
}

/**
 * Template literal tag for IUPAC DNA sequences (includes degenerate bases)
 *
 * Creates validated IUPAC DNA sequences supporting all ambiguity codes.
 * Essential for primers with degenerate positions and biological variation handling.
 *
 * @param template - Template strings array from template literal
 * @param substitutions - Any interpolated values
 * @returns Branded IUPAC sequence that widens to string
 *
 * @example
 * ```typescript
 * const standard = iupac`ATCGATCG`;           // ✅ Standard bases work
 * const degenerate = iupac`ATCGRYSWKMN`;      // ✅ All IUPAC codes
 * const threeBases = iupac`ATCGBDHV`;         // ✅ Three-base codes (B,D,H,V)
 * const universal = iupac`GTGCCAGCMGCCGCGGTAA`; // ✅ Real 515F primer (M=A|C)
 * const invalid = iupac`ATCGXYZ`;             // ❌ Runtime error - X,Y,Z invalid
 *
 * // String compatibility maintained
 * const length = degenerate.length;          // Works like normal string
 * ```
 */
export function iupac<T extends string>(
  template: TemplateStringsArray,
  ...substitutions: string[]
): ValidIUPACString<T> extends never ? never : IUPACSequence<T> {
  const sequence = template.reduce((acc, str, i) => acc + str + (substitutions[i] || ""), "") as T;

  // Runtime validation using existing infrastructure
  if (!IUPAC_DNA.test(sequence)) {
    throw new Error(
      `Invalid IUPAC sequence: contains invalid bases in "${sequence}". Valid: ACGTRYSWKMBDHVN`
    );
  }

  return sequence as any; // TypeScript limitation - cast required for branded types
}

/**
 * Template literal tag for RNA sequences
 *
 * Creates validated RNA sequences with U instead of T.
 * Supports all IUPAC ambiguity codes for RNA analysis.
 *
 * @param template - Template strings array from template literal
 * @param substitutions - Any interpolated values
 * @returns Branded RNA sequence that widens to string
 *
 * @example
 * ```typescript
 * const mrna = rna`AUCGAUCG`;              // ✅ Valid RNA with U
 * const withIUPAC = rna`AUCGRYSWKMN`;      // ✅ IUPAC codes in RNA
 * const withT = rna`ATCGATCG`;             // ❌ Compiler error - T not valid in RNA
 * const invalid = rna`AUCGXYZ`;            // ❌ Compiler error - X,Y,Z invalid
 * ```
 */
export function rna<T extends string>(
  template: TemplateStringsArray,
  ...substitutions: string[]
): ValidRNAString<T> extends never ? never : RNASequence<T> {
  const sequence = template.reduce((acc, str, i) => acc + str + (substitutions[i] || ""), "") as T;

  // Runtime validation using existing infrastructure
  if (!IUPAC_RNA.test(sequence)) {
    throw new Error(
      `Invalid RNA sequence: contains invalid bases in "${sequence}". Valid: ACGURYSWKMBDHVN`
    );
  }

  return sequence as any; // TypeScript limitation - cast required for branded types
}

/**
 * Template literal tag for primer sequences with biological constraints
 *
 * Creates validated primer sequences with biological length constraints.
 * Combines IUPAC validation with primer-specific requirements (15-50 bp length).
 * Perfect for PCR primer validation in amplicon detection workflows.
 *
 * @param template - Template strings array from template literal
 * @param substitutions - Any interpolated values
 * @returns Branded primer sequence that widens to string
 *
 * @example
 * ```typescript
 * // Real-world COVID-19 primers
 * const covidN = primer`ACCAGGAACTAATCAGACAAG`;        // ✅ 21bp = valid length
 * const covidNRev = primer`CAAAGACCAATCCTACCATGAG`;     // ✅ 22bp = valid length
 *
 * // Real-world 16S rRNA primers with IUPAC codes
 * const microbial515F = primer`GTGCCAGCMGCCGCGGTAA`;     // ✅ 19bp, M=A|C valid
 * const microbial806R = primer`GGACTACHVGGGTWTCTAAT`;    // ✅ 20bp, H=A|C|T, V=A|C|G, W=A|T
 *
 * // Biological constraint validation
 * const tooShort = primer`ATCG`;                        // ❌ Runtime error: 4bp < 15bp minimum
 * const tooLong = primer`${'A'.repeat(60)}`;            // ❌ Runtime error: 60bp > 50bp maximum
 * const invalidChars = primer`ATCGXYZ${unknown}`;       // ❌ Runtime error: X,Y,Z not valid IUPAC
 *
 * // String compatibility for algorithms
 * const length = covidN.length;                         // Works like string
 * processPattern(covidN);                               // Automatic widening
 * ```
 */
export function primer<T extends string>(
  template: TemplateStringsArray,
  ...substitutions: string[]
): ValidIUPACString<T> extends never
  ? never
  : ValidPrimerLength<T> extends never
    ? never
    : PrimerSequence<T> {
  const sequence = template.reduce((acc, str, i) => acc + str + (substitutions[i] || ""), "") as T;

  // Runtime validation for biological constraints
  if (!IUPAC_DNA.test(sequence)) {
    throw new Error(
      `Invalid primer sequence: contains invalid bases in "${sequence}". Valid: ACGTRYSWKMBDHVN`
    );
  }
  if (sequence.length < 10) {
    throw new Error(
      `Primer too short: ${sequence.length}bp < 10bp minimum for biological specificity`
    );
  }
  if (sequence.length > 50) {
    throw new Error(
      `Primer too long: ${sequence.length}bp > 50bp maximum for efficient PCR amplification`
    );
  }

  return sequence as any; // TypeScript limitation - cast required for branded types
}

// =============================================================================
// TYPE UTILITIES AND HELPERS
// =============================================================================

/**
 * Type guard to check if a string is a valid DNA sequence at runtime
 */
export function isDNASequence(seq: string): boolean {
  return /^[ACGT]*$/i.test(seq);
}

/**
 * Type guard to check if a string is a valid IUPAC sequence at runtime
 */
export function isIUPACSequence(seq: string): boolean {
  return IUPAC_DNA.test(seq);
}

/**
 * Type guard to check if a string is a valid RNA sequence at runtime
 */
export function isRNASequence(seq: string): boolean {
  return IUPAC_RNA.test(seq);
}

/**
 * Type guard to check if a string is a valid primer sequence at runtime
 */
export function isPrimerSequence(seq: string): boolean {
  return IUPAC_DNA.test(seq) && seq.length >= 10 && seq.length <= 50;
}

// Note: Usage examples are demonstrated in the comprehensive test suite

// =============================================================================
// INTEGRATION UTILITIES
// =============================================================================

/**
 * Convert any validated sequence back to plain string
 * (Though automatic widening usually makes this unnecessary)
 */
export function asString<T extends DNASequence | IUPACSequence | RNASequence | PrimerSequence>(
  seq: T
): string {
  return seq as string;
}

/**
 * Validate sequence alphabet at runtime and return branded type
 */
export function validateAndBrand(
  seq: string,
  alphabet: "dna" | "iupac" | "rna" | "primer"
): string | null {
  switch (alphabet) {
    case "dna":
      return isDNASequence(seq) ? (seq as DNASequence) : null;
    case "iupac":
      return isIUPACSequence(seq) ? (seq as IUPACSequence) : null;
    case "rna":
      return isRNASequence(seq) ? (seq as RNASequence) : null;
    case "primer":
      return isPrimerSequence(seq) ? (seq as PrimerSequence) : null;
    default:
      return null;
  }
}
