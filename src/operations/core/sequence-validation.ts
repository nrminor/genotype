/**
 * Sequence validation module with IUPAC nucleotide ambiguity code handling
 *
 * This module provides comprehensive validation for genomic sequences using IUPAC
 * nucleotide codes, supporting different validation modes from strict to permissive.
 * It includes functionality for expanding ambiguous bases and cleaning sequences.
 *
 * Key features:
 * - IUPAC nucleotide ambiguity code support (R, Y, S, W, K, M, B, D, H, V, N)
 * - Multiple validation modes (STRICT, NORMAL, PERMISSIVE)
 * - Sequence cleaning with configurable replacement characters
 * - Optimized for future SIMD implementation in native code
 * - Zero external dependencies except arktype
 * - Tiger Style compliance with explicit error handling
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { type } from "arktype";

// =============================================================================
// IUPAC PATTERN CONSTANTS
// =============================================================================

/**
 * IUPAC DNA pattern including all standard bases and ambiguity codes
 *
 * Pattern breakdown:
 * - A, C, G, T, U: Standard nucleotide bases (U included for RNA compatibility)
 * - R, Y, S, W, K, M: Two-base ambiguity codes (purines, pyrimidines, strong/weak bonds)
 * - B, D, H, V: Three-base ambiguity codes (not A, not C, not G, not T)
 * - N: Four-base ambiguity code (any base)
 * - Dash, dot, asterisk: Gap characters and stop codons
 *
 * Case-insensitive matching with /i flag for flexibility
 */
export const IUPAC_DNA: RegExp = /^[ACGTURYSWKMBDHVNacgturyswkmbdhvn.\-*]*$/i;

/**
 * IUPAC RNA pattern excluding T but including U
 *
 * RNA-specific pattern that excludes thymine (T) but includes uracil (U).
 * All other IUPAC codes remain valid for RNA sequences.
 */
export const IUPAC_RNA: RegExp = /^[ACGURYSWKMBDHVNacguryswkmbdhvn.\-*]*$/i;

/**
 * IUPAC protein sequence pattern with standard amino acids
 *
 * Includes all 20 standard amino acids plus:
 * - * : Stop codon
 * - - : Gap character
 *
 * Does not include ambiguity codes like B (Asp/Asn) or Z (Glu/Gln)
 * for STRICT mode compatibility.
 */
export const IUPAC_PROTEIN: RegExp = /^[ACDEFGHIKLMNPQRSTVWYacdefghiklmnpqrstvwy\-*]*$/;

// =============================================================================
// FUNDAMENTAL VALIDATION CONSTANTS (Core library primitives)
// =============================================================================

/**
 * Validation modes for different levels of sequence strictness
 *
 * These modes control how strictly sequences are validated across the entire library:
 * - STRICT: Only standard bases (ACGT/U for nucleotides, 20 standard amino acids)
 * - NORMAL: Standard bases plus IUPAC ambiguity codes (recommended)
 * - PERMISSIVE: Accept any ASCII characters (use with caution)
 */
export const ValidationMode = {
  /**
   * Strict validation using only standard bases
   * DNA: A, C, G, T
   * RNA: A, C, G, U
   * Protein: 20 standard amino acids
   */
  STRICT: "strict",

  /**
   * Normal validation including IUPAC ambiguity codes
   * DNA/RNA: Standard bases + R, Y, S, W, K, M, B, D, H, V, N
   * Protein: Standard amino acids (same as STRICT for now)
   */
  NORMAL: "normal",

  /**
   * Permissive validation accepting any ASCII characters
   * Useful for handling legacy data with non-standard encoding
   */
  PERMISSIVE: "permissive",
} as const;

/**
 * Type for validation mode values
 */
export type ValidationMode = (typeof ValidationMode)[keyof typeof ValidationMode];

/**
 * Sequence types for validation context across the library
 */
export const SequenceType = {
  DNA: "dna",
  RNA: "rna",
  PROTEIN: "protein",
  UNKNOWN: "unknown",
} as const;

/**
 * Type for sequence type values
 */
export type SequenceType = (typeof SequenceType)[keyof typeof SequenceType];

// =============================================================================
// SEQUENCE VALIDATOR CLASS
// =============================================================================

/**
 * Instance-based validator for genomic sequence validation and processing
 *
 * Provides methods for:
 * 1. Sequence validation against IUPAC patterns
 * 2. IUPAC ambiguity code expansion
 * 3. Sequence cleaning and character replacement
 *
 * The validator is configured with a specific mode and sequence type at
 * construction time, eliminating the need to pass these parameters to
 * every method call.
 *
 * @class SequenceValidator
 * @since v0.1.0
 *
 * @example
 * ```typescript
 * // Create a validator for DNA sequences with normal validation
 * const validator = new SequenceValidator(ValidationMode.NORMAL, SequenceType.DNA);
 *
 * // Validate sequences
 * const isValid = validator.validate('ATCGRYSW');
 * console.log(isValid); // true
 *
 * // Clean sequences
 * const cleaned = validator.clean('ATCG123XYZ');
 * console.log(cleaned); // 'ATCGNNNNNN'
 *
 * // Create a strict RNA validator
 * const strictRNA = new SequenceValidator(ValidationMode.STRICT, SequenceType.RNA);
 * const isStrictValid = strictRNA.validate('AUGC');
 * console.log(isStrictValid); // true
 * ```
 */

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

/**
 * Validation mode schema for runtime type checking
 */
export const ValidationModeSchema = type('"strict"|"normal"|"permissive"');

/**
 * Sequence type schema for runtime type checking
 */
export const SequenceTypeSchema = type('"dna"|"rna"|"protein"|"unknown"');

/**
 * Validation options schema with comprehensive parameter validation
 */
export const ValidationOptionsSchema = type({
  mode: ValidationModeSchema,
  type: SequenceTypeSchema,
  "replaceChar?": type("string").pipe((char: string) => {
    if (char.length !== 1) {
      throw new Error("replaceChar must be a single character");
    }
    return char;
  }),
  "strict?": "boolean",
}).pipe((options) => {
  // Additional cross-field validation if needed
  return options;
});

/**
 * Sequence validation result schema
 */
export const ValidationResultSchema = type({
  isValid: "boolean",
  sequence: "string",
  mode: ValidationModeSchema,
  type: SequenceTypeSchema,
  "errors?": "string[]",
  "warnings?": "string[]",
  "cleaned?": "string",
});

export class SequenceValidator {
  /**
   * Validation mode for this validator instance
   * @readonly
   */
  public readonly mode: ValidationMode;

  /**
   * Sequence type for this validator instance
   * @readonly
   */
  public readonly type: SequenceType;

  /**
   * Pre-computed validation pattern based on mode and type
   * @private
   */
  private readonly validationPattern: RegExp;

  /**
   * Pre-computed valid character pattern for cleaning
   * @private
   */
  private readonly cleaningPattern: RegExp;

  /**
   * Create a new SequenceValidator instance
   *
   * @param mode - Validation strictness level (default: NORMAL)
   * @param type - Sequence type for validation (default: DNA)
   * @throws {Error} When mode or type parameters are invalid
   *
   * @example
   * ```typescript
   * // Default validator (NORMAL mode, DNA type)
   * const defaultValidator = new SequenceValidator();
   *
   * // Strict protein validator
   * const proteinValidator = new SequenceValidator(
   *   ValidationMode.STRICT,
   *   SequenceType.PROTEIN
   * );
   *
   * // Permissive RNA validator
   * const permissiveRNA = new SequenceValidator(
   *   ValidationMode.PERMISSIVE,
   *   SequenceType.RNA
   * );
   * ```
   */
  constructor(mode: ValidationMode = "normal", type: SequenceType = "dna") {
    // Validate inputs
    const validModes = Object.values(ValidationMode) as readonly string[];
    const validTypes = Object.values(SequenceType) as readonly string[];

    if (!validModes.includes(mode)) {
      throw new Error(`Invalid validation mode: ${mode}`);
    }
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid sequence type: ${type}`);
    }

    this.mode = mode;
    this.type = type;

    // Pre-compute validation pattern
    this.validationPattern = this.computeValidationPattern();
    this.cleaningPattern = this.computeCleaningPattern();
  }

  /**
   * Compute the validation pattern based on mode and type
   * @private
   */
  private computeValidationPattern(): RegExp {
    if (this.mode === "permissive") {
      // Permissive mode accepts everything
      return /^.*$/;
    }

    switch (this.type) {
      case "dna":
        return this.mode === "strict" ? /^[ACGTacgt.\-*]*$/i : IUPAC_DNA;

      case "rna":
        return this.mode === "strict" ? /^[ACGUacgu.\-*]*$/i : IUPAC_RNA;

      case "protein":
        return IUPAC_PROTEIN;

      case "unknown":
        // For unknown types, use DNA pattern as most permissive nucleotide pattern
        return this.mode === "strict" ? /^[ACGTUacgtu.\-*]*$/i : IUPAC_DNA;

      default:
        throw new Error(`Unsupported sequence type: ${this.type}`);
    }
  }

  /**
   * Compute the cleaning pattern based on mode
   * @private
   */
  private computeCleaningPattern(): RegExp {
    if (this.mode === "permissive") {
      // Permissive mode accepts everything
      return /./;
    }

    switch (this.mode) {
      case "strict":
        // Only standard bases, gaps, and stop codons
        return /[ACGTUacgtu.\-*]/;

      case "normal":
        // Standard bases plus IUPAC ambiguity codes
        return /[ACGTURYSWKMBDHVNacgturyswkmbdhvn.\-*]/;

      default:
        throw new Error(`Unsupported validation mode for cleaning: ${this.mode}`);
    }
  }

  /**
   * Validate a sequence against the configured pattern
   *
   * This method performs pattern matching validation using the mode and type
   * configured at construction time.
   *
   * // NATIVE OPTIMIZATION: This method is a prime candidate for SIMD optimization
   * // using vectorized character validation operations in native implementation
   *
   * @param sequence - The sequence string to validate
   * @returns True if sequence matches the pattern for the configured mode and type
   * @throws {Error} When sequence parameter is invalid
   *
   * @example
   * ```typescript
   * const validator = new SequenceValidator(ValidationMode.NORMAL, SequenceType.DNA);
   *
   * // Validate DNA sequence with IUPAC codes
   * const isValid = validator.validate('ATCGRYSW');
   * console.log(isValid); // true
   *
   * // Invalid characters return false
   * const isInvalid = validator.validate('ATCG123');
   * console.log(isInvalid); // false
   * ```
   *
   * @performance O(n) time complexity where n is sequence length
   * @since v0.1.0
   */
  validate(sequence: string): boolean {
    // Tiger Style: Assert preconditions
    if (typeof sequence !== "string") {
      throw new Error("sequence must be a string");
    }

    // Empty sequences are valid
    if (sequence.length === 0) {
      return true;
    }

    return this.validationPattern.test(sequence);
  }

  /**
   * Clean a sequence by removing or replacing invalid characters
   *
   * This method processes sequences to remove or replace characters that don't
   * match the validation pattern for the configured mode. Invalid characters are
   * replaced with the specified replacement character (default 'N').
   *
   * // NATIVE OPTIMIZATION: Character filtering and replacement operations
   * // are ideal for SIMD vectorization in native implementation
   *
   * @param sequence - The sequence string to clean
   * @param replaceChar - Character to replace invalid characters with (default: 'N')
   * @returns Cleaned sequence with invalid characters replaced
   * @throws {Error} When parameters are invalid
   *
   * @example
   * ```typescript
   * const validator = new SequenceValidator(ValidationMode.NORMAL, SequenceType.DNA);
   *
   * // Clean sequence with invalid characters
   * const dirty = 'ATCG123XYZ';
   * const clean = validator.clean(dirty, 'N');
   * console.log(clean); // 'ATCGNNNNNN'
   *
   * // Custom replacement character
   * const withDash = validator.clean(dirty, '-');
   * console.log(withDash); // 'ATCG------'
   * ```
   *
   * @performance O(n) time complexity where n is sequence length
   * @since v0.1.0
   */
  clean(sequence: string, replaceChar: string = "N"): string {
    // Tiger Style: Assert preconditions
    if (typeof sequence !== "string") {
      throw new Error("sequence must be a string");
    }
    if (typeof replaceChar !== "string") {
      throw new Error("replaceChar must be a string");
    }
    if (replaceChar.length !== 1) {
      throw new Error("replaceChar must be a single character");
    }

    // PERMISSIVE mode returns sequence unchanged
    if (this.mode === "permissive") {
      return sequence;
    }

    // Empty sequences return as-is
    if (sequence.length === 0) {
      return sequence;
    }

    // Filter sequence, replacing invalid characters
    let cleanedSequence = "";

    for (let i = 0; i < sequence.length; i++) {
      const char = sequence[i];
      if (char != null && this.cleaningPattern.test(char)) {
        cleanedSequence += char;
      } else {
        cleanedSequence += replaceChar;
      }
    }

    return cleanedSequence;
  }

  /**
   * Validate and clean a sequence in one operation
   *
   * @param sequence - The sequence to validate and clean
   * @param options - Additional options
   * @returns Validation result with cleaned sequence if validation fails
   *
   * @example
   * ```typescript
   * const validator = new SequenceValidator(ValidationMode.NORMAL, SequenceType.DNA);
   * const result = validator.validateAndClean('ATCG123XYZ');
   *
   * console.log(result.isValid); // false
   * console.log(result.cleanedSequence); // 'ATCGNNNNNN'
   * console.log(result.errors); // ['Sequence contains invalid characters']
   * ```
   *
   * @since v0.1.0
   */
  validateAndClean(
    sequence: string,
    options: { replaceChar?: string; returnCleaned?: boolean } = {},
  ): {
    isValid: boolean;
    originalSequence: string;
    cleanedSequence?: string;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { replaceChar = "N", returnCleaned = false } = options;

    try {
      // Validate the original sequence
      const isValid = this.validate(sequence);

      if (!isValid) {
        errors.push(
          `Sequence contains characters not valid for ${this.mode} ${this.type} validation`,
        );
      }

      // Clean sequence if requested or if validation failed
      const shouldClean = returnCleaned || !isValid;
      const result: {
        isValid: boolean;
        originalSequence: string;
        cleanedSequence?: string;
        errors: string[];
        warnings: string[];
      } = {
        isValid,
        originalSequence: sequence,
        errors,
        warnings,
      };

      if (shouldClean) {
        try {
          const cleaned = this.clean(sequence, replaceChar);
          result.cleanedSequence = cleaned;

          // Check if cleaning changed the sequence
          if (cleaned !== sequence && cleaned.includes(replaceChar)) {
            warnings.push(`Invalid characters replaced with '${replaceChar}'`);
          }
        } catch (cleanError) {
          errors.push(
            `Failed to clean sequence: ${cleanError instanceof Error ? cleanError.message : String(cleanError)}`,
          );
        }
      }

      return result;
    } catch (error) {
      errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);

      return {
        isValid: false,
        originalSequence: sequence,
        errors,
        warnings,
      };
    }
  }

  /**
   * Create a new validator with different settings
   *
   * @param mode - New validation mode (uses current if not specified)
   * @param type - New sequence type (uses current if not specified)
   * @returns New SequenceValidator instance with specified settings
   *
   * @example
   * ```typescript
   * const normalDNA = new SequenceValidator(ValidationMode.NORMAL, SequenceType.DNA);
   * const strictDNA = normalDNA.withSettings(ValidationMode.STRICT);
   * const strictRNA = normalDNA.withSettings(ValidationMode.STRICT, SequenceType.RNA);
   * ```
   *
   * @since v0.1.0
   */
  withSettings(mode?: ValidationMode, type?: SequenceType): SequenceValidator {
    return new SequenceValidator(mode ?? this.mode, type ?? this.type);
  }

  /**
   * Expand a single IUPAC ambiguity code to its constituent bases
   *
   * This is a static method as it doesn't depend on instance configuration.
   *
   * Full IUPAC mapping:
   * - R → [A, G] (puRines)
   * - Y → [C, T] (pYrimidines)
   * - S → [G, C] (Strong bonds - 3 hydrogen bonds)
   * - W → [A, T] (Weak bonds - 2 hydrogen bonds)
   * - K → [G, T] (Keto groups)
   * - M → [A, C] (aMino groups)
   * - B → [C, G, T] (not A)
   * - D → [A, G, T] (not C)
   * - H → [A, C, T] (not G)
   * - V → [A, C, G] (not T)
   * - N → [A, C, G, T] (aNy base)
   *
   * @param base - Single character IUPAC code to expand (case-insensitive)
   * @returns Array of possible bases for the given code
   * @throws {Error} When base parameter is invalid
   *
   * @example
   * ```typescript
   * // Expand purine ambiguity code
   * const purines = SequenceValidator.expandAmbiguous('R');
   * console.log(purines); // ['A', 'G']
   *
   * // Expand any-base code
   * const anyBase = SequenceValidator.expandAmbiguous('N');
   * console.log(anyBase); // ['A', 'C', 'G', 'T']
   *
   * // Non-ambiguous bases return themselves
   * const standard = SequenceValidator.expandAmbiguous('A');
   * console.log(standard); // ['A']
   * ```
   *
   * @performance O(1) constant time for single character lookup
   * @since v0.1.0
   */
  static expandAmbiguous(base: string): string[] {
    // Tiger Style: Assert preconditions
    if (typeof base !== "string") {
      throw new Error("base must be a string");
    }
    if (base.length !== 1) {
      throw new Error("base must be a single character");
    }

    // Convert to uppercase for consistent lookup
    const upperBase = base.toUpperCase();

    // IUPAC ambiguity code mapping
    const expansionMap: Record<string, string[]> = {
      // Two-base ambiguity codes
      R: ["A", "G"], // puRines
      Y: ["C", "T"], // pYrimidines
      S: ["G", "C"], // Strong bonds (3 H-bonds)
      W: ["A", "T"], // Weak bonds (2 H-bonds)
      K: ["G", "T"], // Keto groups
      M: ["A", "C"], // aMino groups

      // Three-base ambiguity codes (complement codes)
      B: ["C", "G", "T"], // not A
      D: ["A", "G", "T"], // not C
      H: ["A", "C", "T"], // not G
      V: ["A", "C", "G"], // not T/U

      // Four-base ambiguity code
      N: ["A", "C", "G", "T"], // aNy base

      // Handle RNA uracil in ambiguity codes
      U: ["U"], // Uracil (RNA equivalent of T)
    };

    // Return expansion if found, otherwise return the original base
    return expansionMap[upperBase] || [upperBase];
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convenience function to validate and clean a sequence in one operation
 *
 * Creates a temporary validator instance for one-off operations.
 *
 * @param sequence - The sequence to validate and clean
 * @param mode - Validation mode
 * @param type - Sequence type
 * @param options - Additional options
 * @returns Validation result with cleaned sequence if validation fails
 *
 * @deprecated Since 0.2.0 - Use validator instance methods instead
 */
export function validateAndClean(
  sequence: string,
  mode: ValidationMode = "normal",
  type: SequenceType = "dna",
  options: { replaceChar?: string; returnCleaned?: boolean } = {},
): {
  isValid: boolean;
  originalSequence: string;
  cleanedSequence?: string;
  errors: string[];
  warnings: string[];
} {
  const validator = new SequenceValidator(mode, type);
  return validator.validateAndClean(sequence, options);
}

/**
 * Detect sequence type based on character composition
 *
 * Uses heuristics to determine if a sequence is DNA, RNA, or protein:
 * - Presence of 'U' without 'T' suggests RNA
 * - Only A,C,G,T (and U) suggests nucleotide (DNA/RNA)
 * - Presence of amino acid letters suggests protein
 *
 * @param sequence - Sequence to analyze
 * @returns Detected sequence type
 */
export function detectSequenceType(sequence: string): SequenceType {
  if (!sequence || sequence.length === 0) {
    return "unknown";
  }

  const upperSeq = sequence.toUpperCase();
  const hasU = upperSeq.includes("U");
  const hasT = upperSeq.includes("T");

  // Check for amino acid specific characters (letters that aren't common in nucleotides)
  const proteinChars = /[DEFHIKLMNPQRSVWY]/;
  const hasProteinChars = proteinChars.test(upperSeq);

  // Check if sequence is mostly nucleotide characters (including IUPAC codes)
  const nucleotideChars = /^[ACGTUNRYSWKMBDHV\-.*]*$/i;
  const isNucleotide = nucleotideChars.test(upperSeq);

  // If it has protein-specific characters and it's not purely nucleotides, it's protein
  if (hasProteinChars && !isNucleotide) {
    return "protein";
  }

  // If it's nucleotide sequence, check RNA vs DNA
  if (isNucleotide) {
    if (hasU && !hasT) {
      return "rna";
    }
    if (hasT && !hasU) {
      return "dna";
    }
    if (hasT && hasU) {
      return "dna"; // Mixed, default to DNA
    }
    // If no T or U, could be either - default to DNA
    return "dna";
  }

  return "unknown";
}

/**
 * Expand a single IUPAC ambiguity code to its constituent bases
 *
 * Core primitive function for IUPAC nucleotide code expansion.
 * Used across multiple modules for pattern matching, translation, and validation.
 *
 * @param base - Single character IUPAC code to expand
 * @returns Array of possible bases for the given code
 * @throws {Error} When base parameter is invalid
 *
 * @example
 * ```typescript
 * const purines = expandAmbiguous('R');
 * console.log(purines); // ['A', 'G']
 *
 * const anyBase = expandAmbiguous('N');
 * console.log(anyBase); // ['A', 'C', 'G', 'T']
 * ```
 *
 * @since v0.1.0
 */
export function expandAmbiguous(base: string): string[] {
  // Tiger Style: Assert meaningful constraints
  if (base.length !== 1) {
    throw new Error("base must be a single character");
  }

  // Convert to uppercase for consistent lookup
  const upperBase = base.toUpperCase();

  // IUPAC ambiguity code mapping
  const expansionMap: Record<string, string[]> = {
    // Two-base ambiguity codes
    R: ["A", "G"], // puRines
    Y: ["C", "T"], // pYrimidines
    S: ["G", "C"], // Strong bonds (3 H-bonds)
    W: ["A", "T"], // Weak bonds (2 H-bonds)
    K: ["G", "T"], // Keto groups
    M: ["A", "C"], // aMino groups

    // Three-base ambiguity codes (complement codes)
    B: ["C", "G", "T"], // not A
    D: ["A", "G", "T"], // not C
    H: ["A", "C", "T"], // not G
    V: ["A", "C", "G"], // not T/U

    // Four-base ambiguity code
    N: ["A", "C", "G", "T"], // aNy base

    // Handle RNA uracil in ambiguity codes
    U: ["U"], // Uracil (RNA equivalent of T)
  };

  // Return expansion if found, otherwise return the original base
  return expansionMap[upperBase] || [upperBase];
}

/**
 * Get all possible expansions for a sequence containing ambiguity codes
 *
 * Warning: This can generate a very large number of sequences for sequences
 * with many ambiguity codes (exponential growth). Use with caution.
 *
 * @param sequence - Sequence with potential ambiguity codes
 * @param maxExpansions - Maximum number of expansions to generate (default: 1000)
 * @returns Array of all possible expanded sequences
 */
export function expandAmbiguousSequence(sequence: string, maxExpansions: number = 1000): string[] {
  if (!sequence || sequence.length === 0) {
    return [""];
  }

  const result: string[] = [""];

  for (const char of sequence) {
    const expansions = expandAmbiguous(char);
    const newResult: string[] = [];

    for (const prefix of result) {
      for (const expansion of expansions) {
        newResult.push(prefix + expansion);

        // Safety check to prevent memory exhaustion
        if (newResult.length >= maxExpansions) {
          return newResult;
        }
      }
    }

    result.length = 0;
    result.push(...newResult);
  }

  return result;
}
