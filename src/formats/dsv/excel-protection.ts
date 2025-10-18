/**
 * Excel Protection Module
 *
 * Protects genomic data from Excel's automatic conversions.
 * Handles gene names (SEPT1→Sep-1), leading zeros, large numbers, and formulas.
 */

import { EXCEL_GENE_PATTERNS } from "./constants";

/**
 * Protect gene names from Excel date corruption
 * Excel converts SEPT1, MARCH1 etc to dates - this adds quotes to prevent it
 *
 * @param field - Field value to protect
 * @returns Protected field (quoted if needed)
 */
export function protectFromExcel(field: string): string {
  // Check if field matches Excel gene corruption patterns
  for (const pattern of EXCEL_GENE_PATTERNS) {
    if (pattern.test(field)) {
      return `"${field}"`;
    }
  }

  // Check for leading zeros that Excel would strip
  if (/^0+[0-9A-Za-z]/.test(field)) {
    return `"${field}"`;
  }

  // Check for large numbers that Excel converts to scientific notation
  if (/^\d{16,}$/.test(field)) {
    return `"${field}"`;
  }

  // Check for strings that look like formulas
  if (/^[=+\-@]/.test(field)) {
    return `"${field}"`;
  }

  return field;
}

/**
 * Excel protector class for configurable protection
 */
export class ExcelProtector {
  private patterns: RegExp[];

  constructor(options?: {
    customPatterns?: RegExp[];
    disableDefaults?: boolean;
  }) {
    this.patterns = [];

    if (!options?.disableDefaults) {
      this.patterns.push(...EXCEL_GENE_PATTERNS);
    }

    if (options?.customPatterns) {
      this.patterns.push(...options.customPatterns);
    }
  }

  /**
   * Protect a single field
   */
  protect(field: string): string {
    return protectFromExcel(field);
  }

  /**
   * Check if a field needs protection
   */
  needsProtection(field: string): boolean {
    // Check custom and default patterns
    for (const pattern of this.patterns) {
      if (pattern.test(field)) {
        return true;
      }
    }

    // Check other Excel issues
    if (/^0+[0-9A-Za-z]/.test(field)) return true;
    if (/^\d{16,}$/.test(field)) return true;
    if (/^[=+\-@]/.test(field)) return true;

    return false;
  }

  /**
   * Protect an entire row (batch processing for performance)
   */
  protectRow(fields: string[]): string[] {
    return fields.map((field) => this.protect(field));
  }
}
