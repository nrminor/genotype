/**
 * ValidateProcessor - Check and fix sequence validity
 *
 * This processor validates sequences against various criteria and
 * can reject, fix, or warn about invalid sequences.
 *
 */

import { type } from "arktype";
import { withSequence } from "../constructors";
import { ValidationError } from "../errors";
import type { AbstractSequence } from "../types";
import { SequenceValidator, type ValidationMode } from "./core/sequence-validation";
import type { Processor, ValidateOptions } from "./types";

export {
  expandAmbiguous,
  SequenceType,
  SequenceValidator,
  ValidationMode,
} from "./core/sequence-validation";

/**
 * ArkType schema for ValidateOptions validation
 *
 * Validates:
 * - sequenceType must be "dna" or "rna"
 * - action must be "reject", "fix", or "warn"
 * - fixChar must be a single character
 * - Cross-field constraint: fixChar only valid when action is "fix"
 */
const ValidateOptionsSchema = type({
  sequenceType: '"dna"|"rna"',
  "allowAmbiguous?": "boolean",
  "allowGaps?": "boolean",
  "action?": '"reject"|"fix"|"warn"',
  "fixChar?": "string",
}).narrow((options, ctx) => {
  if (options.fixChar !== undefined && options.fixChar.length !== 1) {
    return ctx.reject({
      expected: "a single character",
      path: ["fixChar"],
    });
  }
  if (options.fixChar !== undefined && options.action !== "fix") {
    return ctx.reject({
      expected: 'action to be "fix" when fixChar is specified',
      path: ["fixChar", "action"],
    });
  }
  return true;
});

/**
 * Processor for validating sequences
 *
 * @example
 * ```typescript
 * const processor = new ValidateProcessor();
 * const validated = processor.process(sequences, {
 *   sequenceType: 'dna',
 *   allowAmbiguous: false,
 *   action: 'reject',
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
    const validationResult = ValidateOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid validate options: ${validationResult.summary}`);
    }

    const validator = this.createValidator(options);

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
    const mode: ValidationMode = options.allowAmbiguous === false ? "strict" : "normal";
    return new SequenceValidator(mode, options.sequenceType);
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
    let validSequence = seq.sequence.toString();

    // Apply additional validation constraints
    if (options.allowGaps !== true) {
      // NATIVE_CANDIDATE: Character filtering loop
      validSequence = validSequence.replace(/[-.*]/g, "");
    }

    // NATIVE_CANDIDATE: validate() performs character-by-character validation
    const isValid = validator.validate(validSequence);

    if (isValid) {
      // Return sequence as-is if valid
      if (validSequence === seq.sequence.toString()) {
        return seq;
      }
      return withSequence(seq, validSequence);
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
        return withSequence(seq, fixed);
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
