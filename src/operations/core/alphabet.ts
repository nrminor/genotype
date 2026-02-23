/**
 * Alphabet validation and template literal tags for biological sequences
 *
 * Provides two complementary APIs for creating validated biological sequences:
 *
 * **Tagged templates** (`dna\`ATCG\``) — runtime validation with ergonomic syntax,
 * supports interpolation for composing sequences from parts.
 *
 * **Literal constructors** (`dna.literal("ATCG")`) — compile-time AND runtime
 * validation using TypeScript's type system. Requires string literals but catches
 * invalid characters and (for primers) invalid lengths at compile time.
 * Also available as `.lit()` and `.checked()` (aliases, Polars-inspired).
 *
 * @example
 * ```typescript
 * // Tagged templates: runtime validation, supports interpolation
 * const sequence = dna`ATCGATCG`;
 * const composed = dna`${adapter}ATCG${adapter}`;
 *
 * // Literal constructors: compile-time + runtime validation
 * const safe = dna.literal("ATCG");           // ✅ Compiles
 * const bad = dna.literal("ATXG");            // ❌ Compile error: Invalid DNA character: "X"
 * const short = primer.literal("ATCG");       // ❌ Compile error: Primer length must be 10-50, got 4
 *
 * // Both widen to string automatically
 * processSequence(sequence);
 * processSequence(safe);
 * ```
 */

import { AlphabetValidationError } from "../../errors";
import { IUPAC_DNA, IUPAC_RNA } from "./sequence-validation";

/**
 * Recursively walks a string type character-by-character, returning the first
 * character whose uppercased form is not in `Allowed`. Returns `never` when
 * every character is valid.
 */
type FirstBadChar<S extends string, Allowed extends string> =
  S extends `${infer C}${infer Rest}`
    ? Uppercase<C> extends Allowed
      ? FirstBadChar<Rest, Allowed>
      : C
    : never;

/** Uppercase IUPAC DNA alphabet for compile-time matching */
type IupacDNAUpper =
  | "A" | "C" | "G" | "T"
  | "R" | "Y" | "S" | "W" | "K" | "M"
  | "B" | "D" | "H" | "V" | "N";

/** Uppercase IUPAC RNA alphabet for compile-time matching */
type IupacRNAUpper =
  | "A" | "C" | "G" | "U"
  | "R" | "Y" | "S" | "W" | "K" | "M"
  | "B" | "D" | "H" | "V" | "N";

/**
 * Returns `S` unchanged when every character is a valid standard DNA base,
 * otherwise returns a descriptive error message as a string literal type.
 */
type ValidateDNA<S extends string> =
  FirstBadChar<S, "A" | "C" | "G" | "T"> extends never
    ? S
    : `Invalid DNA character: "${FirstBadChar<S, "A" | "C" | "G" | "T">}"`;

/**
 * Returns `S` unchanged when every character is a valid IUPAC DNA base,
 * otherwise returns a descriptive error message as a string literal type.
 */
type ValidateIUPAC<S extends string> =
  FirstBadChar<S, IupacDNAUpper> extends never
    ? S
    : `Invalid IUPAC character: "${FirstBadChar<S, IupacDNAUpper>}"`;

/**
 * Returns `S` unchanged when every character is a valid IUPAC RNA base,
 * otherwise returns a descriptive error message as a string literal type.
 */
type ValidateRNA<S extends string> =
  FirstBadChar<S, IupacRNAUpper> extends never
    ? S
    : `Invalid RNA character: "${FirstBadChar<S, IupacRNAUpper>}"`;

/** Counts string length at the type level via tuple accumulation */
type StringToTuple<S extends string, Acc extends unknown[] = []> =
  S extends `${infer _}${infer Rest}` ? StringToTuple<Rest, [...Acc, unknown]> : Acc;

/** Extracts the numeric length of a string literal type */
type LengthOf<S extends string> = StringToTuple<S>["length"];

/** Valid primer lengths (10-50 bp) */
type PrimerLen =
  | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19
  | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29
  | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39
  | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50;

/**
 * Returns `S` unchanged when it is a valid primer (IUPAC characters, 10-50 bp),
 * otherwise returns a descriptive error message as a string literal type.
 */
type ValidatePrimer<S extends string> =
  FirstBadChar<S, IupacDNAUpper> extends never
    ? LengthOf<S> extends PrimerLen
      ? S
      : `Primer length must be 10-50, got ${LengthOf<S> & number}`
    : `Invalid primer character: "${FirstBadChar<S, IupacDNAUpper>}"`;

/** Branded type for runtime-validated standard DNA sequences */
export type DNASequence<T extends string = string> = T & {
  readonly __brand: "DNA";
  readonly __alphabet: "standard";
};

/** Branded type for validated IUPAC DNA sequences */
export type IUPACSequence<T extends string = string> = T & {
  readonly __brand: "DNA";
  readonly __alphabet: "iupac";
};

/** Branded type for validated RNA sequences */
export type RNASequence<T extends string = string> = T & {
  readonly __brand: "RNA";
  readonly __alphabet: "iupac";
};

/** Branded type for validated primer sequences with biological constraints */
export type PrimerSequence<T extends string = string> = T & {
  readonly __brand: "Primer";
  readonly __minLength: 10;
  readonly __maxLength: 50;
};

/**
 * Compile-time validated DNA sequence constructor signature. Used as the
 * type for `.literal()`, `.lit()`, and `.checked()` — all three are aliases
 * for the same function, inspired by Polars' aliasing convention.
 */
type DnaLiteral = <const S extends string>(
  seq: S extends ValidateDNA<S> ? S : ValidateDNA<S>
) => DNASequence<S>;

/**
 * Standard DNA sequence constructor.
 *
 * As a tagged template (`dna\`ATCG\``): runtime validation only, supports
 * interpolation for composing sequences.
 *
 * Via `.literal()` / `.lit()` / `.checked()`: compile-time character
 * validation plus runtime validation. Requires a string literal argument.
 */
export interface DnaTag {
  (template: TemplateStringsArray, ...substitutions: string[]): DNASequence;
  literal: DnaLiteral;
  lit: DnaLiteral;
  checked: DnaLiteral;
}

/** Compile-time validated IUPAC DNA sequence constructor signature. */
type IupacLiteral = <const S extends string>(
  seq: S extends ValidateIUPAC<S> ? S : ValidateIUPAC<S>
) => IUPACSequence<S>;

/**
 * IUPAC DNA sequence constructor (includes degenerate bases).
 *
 * As a tagged template (`iupac\`ATCGRYSWKM\``): runtime validation only,
 * supports interpolation.
 *
 * Via `.literal()` / `.lit()` / `.checked()`: compile-time character
 * validation plus runtime validation.
 */
export interface IupacTag {
  (template: TemplateStringsArray, ...substitutions: string[]): IUPACSequence;
  literal: IupacLiteral;
  lit: IupacLiteral;
  checked: IupacLiteral;
}

/** Compile-time validated RNA sequence constructor signature. */
type RnaLiteral = <const S extends string>(
  seq: S extends ValidateRNA<S> ? S : ValidateRNA<S>
) => RNASequence<S>;

/**
 * RNA sequence constructor.
 *
 * As a tagged template (`rna\`AUCG\``): runtime validation only, supports
 * interpolation.
 *
 * Via `.literal()` / `.lit()` / `.checked()`: compile-time character
 * validation plus runtime validation.
 */
export interface RnaTag {
  (template: TemplateStringsArray, ...substitutions: string[]): RNASequence;
  literal: RnaLiteral;
  lit: RnaLiteral;
  checked: RnaLiteral;
}

/** Compile-time validated primer sequence constructor signature. */
type PrimerLiteral = <const S extends string>(
  seq: S extends ValidatePrimer<S> ? S : ValidatePrimer<S>
) => PrimerSequence<S>;

/**
 * Primer sequence constructor with biological length constraints (10-50 bp).
 *
 * As a tagged template (`primer\`ACCAGGAACTAATCAGACAAG\``): runtime validation
 * only, supports interpolation.
 *
 * Via `.literal()` / `.lit()` / `.checked()`: compile-time character AND
 * length validation plus runtime validation.
 */
export interface PrimerTag {
  (template: TemplateStringsArray, ...substitutions: string[]): PrimerSequence;
  literal: PrimerLiteral;
  lit: PrimerLiteral;
  checked: PrimerLiteral;
}

function _dnaTag(template: TemplateStringsArray, ...substitutions: string[]): DNASequence {
  const sequence = template.reduce((acc, str, i) => acc + str + (substitutions[i] || ""), "");
  if (!/^[ACGT]*$/i.test(sequence)) {
    throw new AlphabetValidationError(
      `Invalid DNA sequence: contains non-standard bases in "${sequence}"`,
      "dna",
      sequence,
      "Valid characters: A, C, G, T"
    );
  }
  return sequence as DNASequence;
}

function _dnaChecked(seq: string): DNASequence {
  if (!/^[ACGT]*$/i.test(seq)) {
    throw new AlphabetValidationError(
      `Invalid DNA sequence: contains non-standard bases in "${seq}"`,
      "dna",
      seq,
      "Valid characters: A, C, G, T"
    );
  }
  return seq as DNASequence;
}

_dnaTag.literal = _dnaChecked;
_dnaTag.lit = _dnaChecked;
_dnaTag.checked = _dnaChecked;

function _iupacTag(template: TemplateStringsArray, ...substitutions: string[]): IUPACSequence {
  const sequence = template.reduce((acc, str, i) => acc + str + (substitutions[i] || ""), "");
  if (!IUPAC_DNA.test(sequence)) {
    throw new AlphabetValidationError(
      `Invalid IUPAC sequence: contains invalid bases in "${sequence}"`,
      "iupac",
      sequence,
      "Valid characters: A, C, G, T, R, Y, S, W, K, M, B, D, H, V, N"
    );
  }
  return sequence as IUPACSequence;
}

function _iupacChecked(seq: string): IUPACSequence {
  if (!IUPAC_DNA.test(seq)) {
    throw new AlphabetValidationError(
      `Invalid IUPAC sequence: contains invalid bases in "${seq}"`,
      "iupac",
      seq,
      "Valid characters: A, C, G, T, R, Y, S, W, K, M, B, D, H, V, N"
    );
  }
  return seq as IUPACSequence;
}

_iupacTag.literal = _iupacChecked;
_iupacTag.lit = _iupacChecked;
_iupacTag.checked = _iupacChecked;

function _rnaTag(template: TemplateStringsArray, ...substitutions: string[]): RNASequence {
  const sequence = template.reduce((acc, str, i) => acc + str + (substitutions[i] || ""), "");
  if (!IUPAC_RNA.test(sequence)) {
    throw new AlphabetValidationError(
      `Invalid RNA sequence: contains invalid bases in "${sequence}"`,
      "rna",
      sequence,
      "Valid characters: A, C, G, U, R, Y, S, W, K, M, B, D, H, V, N"
    );
  }
  return sequence as RNASequence;
}

function _rnaChecked(seq: string): RNASequence {
  if (!IUPAC_RNA.test(seq)) {
    throw new AlphabetValidationError(
      `Invalid RNA sequence: contains invalid bases in "${seq}"`,
      "rna",
      seq,
      "Valid characters: A, C, G, U, R, Y, S, W, K, M, B, D, H, V, N"
    );
  }
  return seq as RNASequence;
}

_rnaTag.literal = _rnaChecked;
_rnaTag.lit = _rnaChecked;
_rnaTag.checked = _rnaChecked;

function _primerTag(template: TemplateStringsArray, ...substitutions: string[]): PrimerSequence {
  const sequence = template.reduce((acc, str, i) => acc + str + (substitutions[i] || ""), "");
  if (!IUPAC_DNA.test(sequence)) {
    throw new AlphabetValidationError(
      `Invalid primer sequence: contains invalid bases in "${sequence}"`,
      "primer",
      sequence,
      "Valid characters: A, C, G, T, R, Y, S, W, K, M, B, D, H, V, N"
    );
  }
  if (sequence.length < 10) {
    throw new AlphabetValidationError(
      `Primer too short: ${sequence.length}bp < 10bp minimum for biological specificity`,
      "primer",
      sequence,
      "Primers must be 10-50bp for biological specificity"
    );
  }
  if (sequence.length > 50) {
    throw new AlphabetValidationError(
      `Primer too long: ${sequence.length}bp > 50bp maximum for efficient PCR amplification`,
      "primer",
      sequence,
      "Primers must be 10-50bp for efficient PCR amplification"
    );
  }
  return sequence as PrimerSequence;
}

function _primerChecked(seq: string): PrimerSequence {
  if (!IUPAC_DNA.test(seq)) {
    throw new AlphabetValidationError(
      `Invalid primer sequence: contains invalid bases in "${seq}"`,
      "primer",
      seq,
      "Valid characters: A, C, G, T, R, Y, S, W, K, M, B, D, H, V, N"
    );
  }
  if (seq.length < 10) {
    throw new AlphabetValidationError(
      `Primer too short: ${seq.length}bp < 10bp minimum for biological specificity`,
      "primer",
      seq,
      "Primers must be 10-50bp for biological specificity"
    );
  }
  if (seq.length > 50) {
    throw new AlphabetValidationError(
      `Primer too long: ${seq.length}bp > 50bp maximum for efficient PCR amplification`,
      "primer",
      seq,
      "Primers must be 10-50bp for efficient PCR amplification"
    );
  }
  return seq as PrimerSequence;
}

_primerTag.literal = _primerChecked;
_primerTag.lit = _primerChecked;
_primerTag.checked = _primerChecked;

/**
 * Standard DNA sequence constructor.
 *
 * @example
 * ```typescript
 * // Tagged template: runtime validation, supports interpolation
 * const seq = dna`ATCGATCG`;
 * const composed = dna`${adapter}ATCG${adapter}`;
 *
 * // Literal: compile-time + runtime validation (requires string literal)
 * const safe = dna.literal("ATCG");        // ✅
 * const bad = dna.literal("ATXG");         // ❌ Compile error
 * ```
 */
export const dna: DnaTag = _dnaTag as DnaTag;

/**
 * IUPAC DNA sequence constructor (includes degenerate bases).
 *
 * @example
 * ```typescript
 * const seq = iupac`ATCGRYSWKMN`;
 * const safe = iupac.literal("ATCGRYSWKMN");  // ✅
 * const bad = iupac.literal("ATCGXYZ");        // ❌ Compile error
 * ```
 */
export const iupac: IupacTag = _iupacTag as IupacTag;

/**
 * RNA sequence constructor.
 *
 * @example
 * ```typescript
 * const seq = rna`AUCGAUCG`;
 * const safe = rna.literal("AUCG");    // ✅
 * const bad = rna.literal("ATCG");     // ❌ Compile error (T not valid in RNA)
 * ```
 */
export const rna: RnaTag = _rnaTag as RnaTag;

/**
 * Primer sequence constructor with biological length constraints (10-50 bp).
 *
 * @example
 * ```typescript
 * const covid = primer`ACCAGGAACTAATCAGACAAG`;
 * const safe = primer.literal("ACCAGGAACTAATCAGACAAG");  // ✅ 21bp
 * const short = primer.literal("ATCG");                   // ❌ Compile error: length
 * const bad = primer.literal("ACCAGGAACTXATCAGACAAG");    // ❌ Compile error: char
 * ```
 */
export const primer: PrimerTag = _primerTag as PrimerTag;

/** Check if a string is a valid standard DNA sequence at runtime */
export function isDNASequence(seq: string): seq is DNASequence {
  return /^[ACGT]*$/i.test(seq);
}

/** Check if a string is a valid IUPAC DNA sequence at runtime */
export function isIUPACSequence(seq: string): seq is IUPACSequence {
  return IUPAC_DNA.test(seq);
}

/** Check if a string is a valid RNA sequence at runtime */
export function isRNASequence(seq: string): seq is RNASequence {
  return IUPAC_RNA.test(seq);
}

/** Check if a string is a valid primer sequence at runtime */
export function isPrimerSequence(seq: string): seq is PrimerSequence {
  return IUPAC_DNA.test(seq) && seq.length >= 10 && seq.length <= 50;
}

/**
 * Convert any validated sequence back to plain string.
 * Usually unnecessary since branded types widen to string automatically.
 */
export function asString<T extends DNASequence | IUPACSequence | RNASequence | PrimerSequence>(
  seq: T
): string {
  return seq as string;
}

/**
 * Validate a string at runtime and return the appropriate branded type,
 * or null if validation fails.
 */
export function validateAndBrand(
  seq: string,
  alphabet: "dna" | "iupac" | "rna" | "primer"
): DNASequence | IUPACSequence | RNASequence | PrimerSequence | null {
  switch (alphabet) {
    case "dna":
      return isDNASequence(seq) ? seq : null;
    case "iupac":
      return isIUPACSequence(seq) ? seq : null;
    case "rna":
      return isRNASequence(seq) ? seq : null;
    case "primer":
      return isPrimerSequence(seq) ? seq : null;
    default: {
      const _exhaustive: never = alphabet;
      return _exhaustive;
    }
  }
}
