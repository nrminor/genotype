/**
 * @module formats/dsv/validation
 * @description Validation utilities for DSV parsing and writing
 *
 * This module contains:
 * - ArkType schemas for parser and writer options
 * - Field size validation
 * - FieldValidator class for encapsulating validation logic
 */

import { type } from "arktype";
import { DSVParseError, ValidationError } from "../../errors";
import { MAX_FIELD_SIZE } from "./constants";

// =============================================================================
// FIELD SIZE VALIDATION
// =============================================================================

/**
 * Validate that a field doesn't exceed the maximum allowed size
 * @param field - Field content to validate
 * @param maxSize - Maximum allowed size in bytes (default: MAX_FIELD_SIZE)
 * @throws {DSVParseError} if field exceeds size limit
 */
export function validateFieldSize(field: string, maxSize: number = MAX_FIELD_SIZE): void {
  const sizeInBytes = new TextEncoder().encode(field).length;
  if (sizeInBytes > maxSize) {
    throw new DSVParseError(
      `Field size (${sizeInBytes} bytes) exceeds maximum allowed (${maxSize} bytes)`,
      undefined,
      undefined
    );
  }
}

// =============================================================================
// ARKTYPE VALIDATION SCHEMAS
// =============================================================================

/**
 * ArkType validation schema for DSV parser options
 */
export const DSVParserOptionsSchema = type({
  "delimiter?": "string",
  "autoDetectDelimiter?": "boolean",
  "quote?": "string",
  "escape?": "string",
  "header?": "boolean|string[]",
  "columns?": "string[]",
  "skipEmptyLines?": "boolean",
  "skipComments?": "boolean",
  "commentPrefix?": "string",
  "protectFromExcel?": "boolean",
  "raggedRows?": '"error"|"pad"|"truncate"|"ignore"',
  "maxFieldLines?": "number",
  "computeStats?": "boolean",
  "includeGC?": "boolean",
  "includeGCSkew?": "boolean",
  "includeBaseCount?": "boolean",
  "includeQuality?": "boolean",
  "autoDetect?": "boolean",
  "autoDetectHeaders?": "boolean",
}).narrow((options, ctx) => {
  // Validate delimiter
  if (options.delimiter && options.delimiter.length !== 1) {
    return ctx.reject({
      path: ["delimiter"],
      expected: "single character delimiter",
      actual: `${options.delimiter.length} characters`,
    });
  }

  // Validate quote/escape chars don't conflict
  if (options.quote && options.escape && options.quote === options.delimiter) {
    return ctx.reject({
      path: ["quote", "delimiter"],
      expected: "different quote and delimiter characters",
      actual: "same character for both",
    });
  }

  // Validate field size limits
  if (options.header && Array.isArray(options.header) && options.header.length > 10000) {
    return ctx.reject({
      path: ["header"],
      expected: "reasonable number of columns (< 10000)",
      actual: `${options.header.length} columns`,
    });
  }

  // Warn about Excel compatibility
  if (options.protectFromExcel === false) {
    console.warn(
      "DSV: Excel protection disabled. Gene names like SEPT1, MARCH1 may be corrupted to dates."
    );
  }

  return true;
});

/**
 * ArkType validation schema for DSV writer options
 */
export const DSVWriterOptionsSchema = type({
  "delimiter?": "string",
  "quote?": "string",
  "escapeChar?": "string",
  "header?": "boolean",
  "columns?": "string[]",
  "lineEnding?": '"\n"|"\r\n"|"\r"',
  "quoteAll?": "boolean",
  "excelCompatible?": "boolean",
  "computeStats?": "boolean",
  "includeGC?": "boolean",
  "includeGCSkew?": "boolean",
  "includeBaseCount?": "boolean",
  "includeQuality?": "boolean",
}).narrow((options, ctx) => {
  // Validate delimiter
  if (options.delimiter && options.delimiter.length !== 1) {
    return ctx.reject({
      path: ["delimiter"],
      expected: "single character delimiter",
      actual: `${options.delimiter.length} characters`,
    });
  }

  // Validate quote/escape compatibility
  if (options.quote && options.escapeChar && options.escapeChar !== options.quote) {
    console.warn(
      "DSV: Using different quote and escape characters. RFC 4180 recommends doubling quotes for escaping."
    );
  }

  return true;
});

// =============================================================================
// FIELD VALIDATOR CLASS
// =============================================================================

/**
 * FieldValidator class for encapsulating field validation logic
 */
export class FieldValidator {
  private maxFieldSize: number;
  private strictMode: boolean;

  constructor(options?: {
    maxFieldSize?: number;
    strictMode?: boolean;
  }) {
    this.maxFieldSize = options?.maxFieldSize ?? MAX_FIELD_SIZE;
    this.strictMode = options?.strictMode ?? false;
  }

  /**
   * Validate a single field
   */
  validateField(field: string): void {
    validateFieldSize(field, this.maxFieldSize);

    // Additional validation can be added here
    if (this.strictMode) {
      // Check for control characters using character codes
      for (let i = 0; i < field.length; i++) {
        const charCode = field.charCodeAt(i);
        // Check for control characters (0x00-0x1F and 0x7F)
        if ((charCode >= 0 && charCode <= 31) || charCode === 127) {
          throw new ValidationError("Field contains control characters");
        }
      }
    }
  }

  /**
   * Validate an array of fields
   */
  validateRow(fields: string[]): void {
    for (const field of fields) {
      this.validateField(field);
    }
  }

  /**
   * Check if a field needs validation (performance optimization)
   */
  needsValidation(field: string): boolean {
    // Quick checks to avoid expensive validation
    if (field.length === 0) return false;
    if (field.length * 4 > this.maxFieldSize) return true; // Worst case UTF-8
    return this.strictMode;
  }
}

/**
 * Validate DSV content for common issues
 */
export function validateDSV(
  content: string,
  options: {
    delimiter?: string;
    requireHeaders?: boolean;
    minColumns?: number;
    maxColumns?: number;
  } = {}
): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const delimiter = options.delimiter || ",";

  const lines = content.split(/\r?\n/).filter((l) => l);

  if (lines.length === 0) {
    errors.push("No content found");
    return { valid: false, errors, warnings };
  }

  // Check for consistent column counts
  const columnCounts = new Map<number, number>();
  let firstLineColumns = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("#")) continue; // Skip empty lines and comments

    const columns = line.split(delimiter).length;

    if (firstLineColumns === 0) {
      firstLineColumns = columns;
    }

    columnCounts.set(columns, (columnCounts.get(columns) || 0) + 1);

    if (options.minColumns && columns < options.minColumns) {
      errors.push(`Line ${i + 1} has ${columns} columns, minimum required: ${options.minColumns}`);
    }

    if (options.maxColumns && columns > options.maxColumns) {
      errors.push(`Line ${i + 1} has ${columns} columns, maximum allowed: ${options.maxColumns}`);
    }
  }

  // Check for inconsistent column counts
  if (columnCounts.size > 1) {
    const counts = Array.from(columnCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cols, count]) => `${cols} columns: ${count} rows`)
      .join(", ");
    warnings.push(`Inconsistent column counts: ${counts}`);
  }

  // Check for potential Excel corruption
  const excelDangerPatterns = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d/i;
  for (let i = 0; i < Math.min(100, lines.length); i++) {
    const line = lines[i];
    if (line && excelDangerPatterns.test(line)) {
      warnings.push(
        `Line ${i + 1} contains gene names that Excel might corrupt (e.g., SEPT1, MARCH1)`
      );
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
