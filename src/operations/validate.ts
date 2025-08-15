/**
 * ValidateProcessor - Check and fix sequence validity
 * 
 * This processor validates sequences against various criteria and
 * can reject, fix, or warn about invalid sequences.
 * 
 * @version v0.1.0
 * @since v0.1.0
 */

import type { AbstractSequence } from '../types';
import type { ValidateOptions, Processor } from './types';
import { SequenceValidator } from './core/validation';

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
    
    // ZIG_CANDIDATE: Hot loop validating every sequence
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
    const mode = options.mode || 'normal';
    
    // Determine sequence type based on allowed characters
    let type: 'dna' | 'rna' | 'unknown' = 'dna';
    if (options.allowRNA) {
      type = 'rna';
    }
    
    return new SequenceValidator(mode, type);
  }

  /**
   * Validate a single sequence
   * 
   * ZIG_CANDIDATE: Character validation loop.
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
    const action = options.action || 'reject';
    
    // Check if sequence is valid
    let validSequence = seq.sequence;
    
    // Apply additional validation constraints
    if (!options.allowGaps) {
      // ZIG_CANDIDATE: Character filtering loop
      validSequence = validSequence.replace(/[-.*]/g, '');
    }
    
    // ZIG_CANDIDATE: validate() performs character-by-character validation
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
        length: validSequence.length
      };
    }
    
    // Handle invalid sequences based on action
    switch (action) {
      case 'reject':
        // Skip invalid sequences
        return null;
        
      case 'fix': {
        // Fix invalid sequences
        // ZIG_CANDIDATE: clean() replaces invalid characters
        const fixed = validator.clean(validSequence, options.fixChar || 'N');
        return {
          ...seq,
          sequence: fixed,
          length: fixed.length
        };
      }
        
      case 'warn':
        // Log warning but keep sequence
        console.warn(`Invalid sequence: ${seq.id}`);
        return seq;
        
      default:
        return null;
    }
  }
}