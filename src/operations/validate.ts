/**
 * ValidateProcessor - Check and fix sequence validity
 *
 * This processor validates sequences against various criteria and
 * can reject, fix, or warn about invalid sequences.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import type { AbstractSequence } from "../types";
// Import IUPAC constants and validation primitives from core
import {
  expandAmbiguous,
  IUPAC_DNA,
  IUPAC_PROTEIN,
  IUPAC_RNA,
  SequenceType,
  ValidationMode,
} from "./core/sequence-validation";
import type { Processor, ValidateOptions } from "./types";

// Re-export core validation primitives for convenient access
export { expandAmbiguous, SequenceType, ValidationMode } from "./core/sequence-validation";

// =============================================================================
// SEQUENCE VALIDATOR CLASS (moved from core/validation.ts)
// =============================================================================

/**
 * Sequence validator with mode and type configuration
 *
 * This class was moved from core/validation.ts since it's only used
 * by the ValidateProcessor. The IUPAC constants remain in core.
 */
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
   * @param sequence - The sequence string to validate
   * @returns True if sequence matches the pattern for the configured mode and type
   * @throws {Error} When sequence parameter is invalid
   */
  validate(sequence: string): boolean {
    // Empty sequences are valid
    if (sequence.length === 0) {
      return true;
    }

    return this.validationPattern.test(sequence);
  }

  /**
   * Clean a sequence by removing or replacing invalid characters
   *
   * // NATIVE OPTIMIZATION: Character filtering and replacement operations
   * // are ideal for SIMD vectorization in native implementation
   *
   * @param sequence - The sequence string to clean
   * @param replaceChar - Character to replace invalid characters with (default: 'N')
   * @returns Cleaned sequence with invalid characters replaced
   * @throws {Error} When parameters are invalid
   */
  clean(sequence: string, replaceChar: string = "N"): string {
    // Tiger Style: Only meaningful constraint validation
    if (sequence.length === 0) {
      return sequence;
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
   */
  validateAndClean(
    sequence: string,
    options: { replaceChar?: string; returnCleaned?: boolean } = {}
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
          `Sequence contains characters not valid for ${this.mode} ${this.type} validation`
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
            `Failed to clean sequence: ${cleanError instanceof Error ? cleanError.message : String(cleanError)}`
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
   */
  withSettings(mode?: ValidationMode, type?: SequenceType): SequenceValidator {
    return new SequenceValidator(mode ?? this.mode, type ?? this.type);
  }
}

/**
 * Processor for validating sequences
 *
 * @example
 * ```typescript
 * const processor = new ValidateProcessor();
 * const validated = processor.process(sequences, {
 *   mode: 'strict',
 *   action: 'reject',
 *   allowAmbiguous: false
 * });
 * ```
 */
export class ValidateProcessor implements Processor<ValidateOptions> {
  /**
   * Process sequences with validation
   *
   * @param source - Input sequences
   * @param options - Validation options
   * @yields Valid sequences (may be fixed)
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: ValidateOptions
  ): AsyncIterable<AbstractSequence> {
    const validator = this.createValidator(options);

    // NATIVE_CANDIDATE: Hot loop validating every sequence
    // Native batch validation would improve performance
    for await (const seq of source) {
      const result = this.validateSequence(seq, options, validator);

      if (result) {
        yield result;
      }
    }
  }

  /**
   * Create a validator instance based on options
   *
   * @param options - Validation options
   * @returns Configured validator
   */
  private createValidator(options: ValidateOptions): SequenceValidator {
    const mode = options.mode || "normal";

    // Determine sequence type based on allowed characters
    let type: "dna" | "rna" | "unknown" = "dna";
    if (options.allowRNA === true) {
      type = "rna";
    }

    return new SequenceValidator(mode, type);
  }

  /**
   * Validate a single sequence
   *
   * NATIVE_CANDIDATE: Character validation loop.
   * Native implementation would be faster for
   * validating large sequences against IUPAC codes.
   *
   * @param seq - Sequence to validate
   * @param options - Validation options
   * @param validator - Validator instance
   * @returns Validated sequence, fixed sequence, or null if rejected
   */
  private validateSequence(
    seq: AbstractSequence,
    options: ValidateOptions,
    validator: SequenceValidator
  ): AbstractSequence | null {
    const action = options.action || "reject";

    // Check if sequence is valid
    let validSequence = seq.sequence;

    // Apply additional validation constraints
    if (options.allowGaps !== true) {
      // NATIVE_CANDIDATE: Character filtering loop
      validSequence = validSequence.replace(/[-.*]/g, "");
    }

    // NATIVE_CANDIDATE: validate() performs character-by-character validation
    const isValid = validator.validate(validSequence);

    if (isValid) {
      // Return sequence as-is if valid
      if (validSequence === seq.sequence) {
        return seq;
      }
      // Return modified sequence if gaps were removed
      return {
        ...seq,
        sequence: validSequence,
        length: validSequence.length,
      };
    }

    // Handle invalid sequences based on action
    switch (action) {
      case "reject":
        // Skip invalid sequences
        return null;

      case "fix": {
        // Fix invalid sequences
        // NATIVE_CANDIDATE: clean() replaces invalid characters
        const fixed = validator.clean(validSequence, options.fixChar ?? "N");
        return {
          ...seq,
          sequence: fixed,
          length: fixed.length,
        };
      }

      case "warn":
        // Log warning but keep sequence
        console.warn(`Invalid sequence: ${seq.id}`);
        return seq;

      default:
        return null;
    }
  }
}
