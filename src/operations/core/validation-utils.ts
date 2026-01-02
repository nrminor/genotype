/**
 * Common validation utilities for operations
 *
 * This module provides reusable validation infrastructure that works with ArkType
 * to eliminate the duplicate validateOptions patterns found across 8+ processors.
 *
 * Following Tiger Style and zero-dependency philosophy, this provides a centralized
 * validation pattern that can be used by all operations processors.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import type { type } from "arktype";
import { GenotypeError, ValidationError } from "../../errors";

/**
 * Custom validation function signature
 * Allows for domain-specific validation logic beyond schema validation
 */
type CustomValidator<T> = (options: T) => void;

/**
 * Result of validation - either success with validated data or error
 */
type ValidationResult<T> = { success: true; data: T } | { success: false; error: ValidationError };

/**
 * Creates a reusable validation function for operation options
 *
 * This function eliminates the duplicate validateOptions pattern found across
 * processors by providing a common validation infrastructure that combines:
 * - ArkType schema validation for structure and types
 * - Custom validators for domain-specific business rules
 * - Consistent error handling and messaging
 *
 * @param schema - ArkType schema for structural validation
 * @param customValidators - Optional array of custom validation functions
 * @returns A validation function that returns validated options or throws ValidationError
 *
 * @example
 * ```typescript
 * const validateGrepOptions = createOptionsValidator(
 *   type({
 *     pattern: 'string | RegExp',
 *     target: "'sequence' | 'id' | 'description'",
 *     ignoreCase: 'boolean?',
 *   }),
 *   [
 *     (opts) => {
 *       if (opts.pattern === '') {
 *         throw new Error('Pattern cannot be empty');
 *       }
 *     }
 *   ]
 * );
 *
 * // Usage in processor:
 * const validatedOptions = validateGrepOptions(options);
 * ```
 */
export function createOptionsValidator<T>(
  schema: ReturnType<typeof type>,
  customValidators?: CustomValidator<T>[],
): (options: T) => T {
  return (options: T): T => {
    // First, validate against the ArkType schema
    const schemaResult = (schema as (input: unknown) => unknown)(options);

    // ArkType returns validation errors through a specific pattern
    // If validation fails, we need to handle it appropriately
    try {
      // ArkType's validation will throw or return errors depending on version
      // We'll catch any validation errors and re-throw as ValidationError
      if (
        schemaResult !== null &&
        schemaResult !== undefined &&
        typeof schemaResult === "object" &&
        "problems" in schemaResult
      ) {
        // This is an error result from ArkType
        throw new ValidationError(
          `Invalid options: ${JSON.stringify(schemaResult)}`,
          undefined,
          "Review the options structure and types",
        );
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Schema validation failed: ${error instanceof Error ? error.message : "unknown error"}`,
        undefined,
        "Check option types and required fields",
      );
    }

    // Use the original options if schema passed, since ArkType might transform
    const validatedOptions = schemaResult as T;

    // Schema validation passed, now run custom validators
    if (customValidators && customValidators.length > 0) {
      for (const validator of customValidators) {
        try {
          validator(validatedOptions);
        } catch (error) {
          // Preserve domain-specific errors and ValidationError as-is
          if (error instanceof ValidationError || error instanceof GenotypeError) {
            throw error;
          } else if (error instanceof Error) {
            throw new ValidationError(error.message, undefined, "Custom validation failed");
          } else {
            throw new ValidationError(
              "Unknown validation error",
              undefined,
              "Custom validation failed with unknown error",
            );
          }
        }
      }
    }

    // All validation passed, return the validated options
    return validatedOptions;
  };
}

/**
 * Creates a safe validation function that returns a result instead of throwing
 *
 * This is useful for scenarios where you want to handle validation failures
 * gracefully without try/catch blocks.
 *
 * @param schema - ArkType schema for structural validation
 * @param customValidators - Optional array of custom validation functions
 * @returns A validation function that returns ValidationResult
 *
 * @example
 * ```typescript
 * const validateSampleOptions = createSafeOptionsValidator(
 *   SampleOptionsSchema,
 *   [validateMutuallyExclusive]
 * );
 *
 * const result = validateSampleOptions(options);
 * if (result.success) {
 *   // Use result.data
 * } else {
 *   // Handle result.error
 * }
 * ```
 */
export function createSafeOptionsValidator<T>(
  schema: ReturnType<typeof type>,
  customValidators?: CustomValidator<T>[],
): (options: T) => ValidationResult<T> {
  const validator = createOptionsValidator(schema, customValidators);

  return (options: T): ValidationResult<T> => {
    try {
      const validatedData = validator(options);
      return { success: true, data: validatedData };
    } catch (error) {
      const validationError =
        error instanceof ValidationError
          ? error
          : new ValidationError(
              error instanceof Error ? error.message : "Unknown validation error",
            );
      return { success: false, error: validationError };
    }
  };
}

/**
 * Utility function to create contextual errors for validation failures
 *
 * This provides consistent error formatting across all validation functions.
 */
export function createValidationError(
  message: string,
  context?: string,
  data?: Record<string, unknown>,
): ValidationError {
  let contextStr =
    context !== undefined && context !== null && context !== "" ? context : "Validation failed";

  if (data && Object.keys(data).length > 0) {
    const dataStr = Object.entries(data)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
    contextStr = `${contextStr} - ${dataStr}`;
  }

  return new ValidationError(message, undefined, contextStr);
}

/**
 * Common validation patterns for genomic operations
 *
 * These are reusable validation functions that can be used as custom validators
 * for common patterns found across multiple operations.
 */
export const CommonValidators = {
  /**
   * Validates that a pattern is not empty (for grep, locate, etc.)
   */
  nonEmptyPattern: <T extends { pattern: string | RegExp }>(options: T): void => {
    if (typeof options.pattern === "string" && options.pattern.trim() === "") {
      throw new Error("Pattern cannot be empty");
    }
  },

  /**
   * Validates mutually exclusive numeric options (for sample: n vs fraction)
   */
  mutuallyExclusiveNumbers: <T extends { n?: number; fraction?: number }>(options: T): void => {
    const hasN = options.n !== undefined && options.n !== null;
    const hasFraction = options.fraction !== undefined && options.fraction !== null;

    if (!hasN && !hasFraction) {
      throw new Error("Either n or fraction must be specified");
    }

    if (hasN && hasFraction) {
      throw new Error("Cannot specify both n and fraction");
    }
  },

  /**
   * Validates positive integers (for counts, lengths, etc.)
   */
  positiveInteger:
    <T extends Record<string, unknown>>(field: keyof T) =>
    (options: T): void => {
      const value = options[field];
      if (
        value !== undefined &&
        typeof value === "number" &&
        (value <= 0 || !Number.isInteger(value))
      ) {
        throw new Error(`${String(field)} must be a positive integer, got: ${value}`);
      }
    },

  /**
   * Validates fraction values (0 < fraction <= 1)
   */
  validFraction: <T extends { fraction?: number }>(options: T): void => {
    if (options.fraction !== undefined) {
      if (options.fraction <= 0 || options.fraction > 1) {
        throw new Error(`Fraction must be between 0 and 1, got: ${options.fraction}`);
      }
    }
  },

  /**
   * Validates that a target field is one of allowed values
   */
  validTarget:
    <T extends { target: string }>(allowedTargets: string[]) =>
    (options: T): void => {
      if (!allowedTargets.includes(options.target)) {
        throw new Error(
          `Invalid target: ${options.target}. Valid targets: ${allowedTargets.join(", ")}`,
        );
      }
    },
};
