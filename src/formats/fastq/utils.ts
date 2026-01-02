/**
 * Utility functions for FASTQ format
 *
 * Provides helper functions for FASTQ validation, detection, and manipulation.
 * These are tree-shakeable functions that can be imported individually.
 *
 * NOTE: Most validation has been moved to the validation module.
 * This module primarily provides parsing helpers and deprecated compatibility.
 */

// =============================================================================
// IMPORTS
// =============================================================================

import { ParseError, QualityError, SequenceError } from "../../errors";
import { qualityToScores, scoresToQuality } from "../../operations/core/quality";
import type { QualityEncoding } from "../../types";
import { validateFastaSequence } from "../fasta";
import { detectFastqFormat } from "./detection";

// =============================================================================
// CONSTANTS
// =============================================================================

// No module-level constants needed

// =============================================================================
// TYPES
// =============================================================================

// No module-level types needed

// =============================================================================
// INTERFACES
// =============================================================================

// No module-level interfaces needed

// =============================================================================
// FUNCTIONS
// =============================================================================

/**
 * Parse FASTQ header line and extract ID and description
 *
 * @param headerLine - FASTQ header line starting with '@'
 * @param lineNumber - Line number for error reporting
 * @param options - Parser options
 * @returns Object with id and optional description
 * @throws {ValidationError} If header doesn't start with '@'
 * @throws {ParseError} If header is empty
 * @throws {SequenceError} If ID contains spaces
 */
export function parseFastqHeader(
  headerLine: string,
  lineNumber: number,
  options: { skipValidation?: boolean; onWarning?: (msg: string, line?: number) => void },
): { id: string; description?: string } {
  // Validate FASTQ header format
  if (!headerLine.startsWith("@")) {
    throw new ParseError('FASTQ header must start with "@"', "FASTQ", lineNumber, headerLine);
  }

  const header = headerLine.slice(1); // Remove '@'
  if (!header) {
    if (options.skipValidation) {
      options.onWarning?.("Empty FASTQ header", lineNumber);
      return { id: "" };
    } else {
      throw new ParseError(
        'Empty FASTQ header: header must contain an identifier after "@"',
        "FASTQ",
        lineNumber,
        headerLine,
      );
    }
  }

  // Extract ID and description (same logic as FASTA)
  const firstSpace = header.search(/\s/);
  const id = firstSpace === -1 ? header : header.slice(0, firstSpace);
  const description = firstSpace === -1 ? undefined : header.slice(firstSpace + 1).trim();

  // FASTQ-specific validation (adapted from FASTA NCBI guidelines)
  if (!options.skipValidation) {
    // NCBI-compatible ID validation
    if (id.length > 50) {
      options.onWarning?.(
        `FASTQ sequence ID '${id}' is very long (${id.length} chars). ` +
          `Long IDs may cause compatibility issues with some bioinformatics tools.`,
        lineNumber,
      );
    }

    // Check for spaces in sequence ID
    if (id.includes(" ")) {
      throw new SequenceError(
        `FASTQ sequence ID '${id}' contains spaces. ` +
          `Use underscores (_) or hyphens (-) for better tool compatibility.`,
        id,
        lineNumber,
        headerLine,
      );
    }
  }

  return description !== undefined ? { id, description } : { id };
}

/**
 * Validate FASTQ quality string length matches sequence length
 *
 * @param qualityLine - Quality string line
 * @param sequence - Sequence string for length comparison
 * @param sequenceId - Sequence ID for error reporting
 * @param lineNumber - Line number for error reporting
 * @returns Cleaned quality string
 * @throws {QualityError} If quality and sequence lengths don't match
 */
export function validateFastqQuality(
  qualityLine: string,
  sequence: string,
  sequenceId: string,
  lineNumber: number,
): string {
  const quality = qualityLine.replace(/\s/g, "");

  if (quality.length !== sequence.length) {
    throw new QualityError(
      `FASTQ quality length (${quality.length}) != sequence length (${sequence.length}). ` +
        `Each base must have exactly one quality score. Check for truncated quality data or ` +
        `sequence-quality synchronization issues in paired-end files.`,
      sequenceId,
      undefined,
      lineNumber,
      qualityLine,
    );
  }

  return quality;
}

/**
 * Count FASTQ reads in data without full parsing
 *
 * @param data - FASTQ format string
 * @returns Number of reads (assuming 4-line FASTQ format)
 */
export function countFastqReads(data: string): number {
  const lines = data.split(/\r?\n/).filter((line) => line.trim());
  return Math.floor(lines.length / 4);
}

/**
 * Extract read IDs from FASTQ data without full parsing
 *
 * @param data - FASTQ format string
 * @returns Array of sequence IDs
 */
export function extractFastqIds(data: string): string[] {
  const matches = data.match(/^@([^\s\n\r]+)/gm);
  return matches ? matches.map((m) => m.slice(1)) : [];
}

/**
 * Validate FASTQ sequence using FASTA validation with FASTQ-specific context
 *
 * @param sequenceLine - Sequence line to validate
 * @param lineNumber - Line number for error reporting
 * @param options - Validation options
 * @returns Cleaned sequence string
 * @throws {SequenceError} If sequence contains invalid characters
 */
export function validateFastqSequence(
  sequenceLine: string,
  lineNumber: number,
  options: { skipValidation?: boolean },
): string {
  // For FASTQ performance: validation is expensive, often disabled for large datasets
  if (options.skipValidation) {
    return sequenceLine.replace(/\s/g, "");
  }

  // Leverage FASTA sequence validation with FASTQ-specific error context
  try {
    return validateFastaSequence(sequenceLine, lineNumber, options);
  } catch (error) {
    if (error instanceof SequenceError) {
      // Enhance error with FASTQ-specific context
      throw new SequenceError(
        `FASTQ sequence validation failed: ${error.message}\n` +
          `Note: FASTQ sequence validation is optional for performance. ` +
          `Consider skipValidation: true for large read datasets if sequence quality is trusted.`,
        error.sequenceId || "unknown",
        lineNumber,
        sequenceLine,
      );
    }
    throw error;
  }
}

/**
 * Utility functions for FASTQ format
 * @deprecated Use individual function imports for better tree-shaking
 */
export const FastqUtils = {
  /**
   * Detect if string contains FASTQ format data
   */
  detectFormat: detectFastqFormat,

  /**
   * Count sequences in FASTQ data without parsing
   */
  countSequences: countFastqReads,

  /**
   * Extract sequence IDs from FASTQ data
   */
  extractIds: extractFastqIds,

  /**
   * Parse FASTQ header line
   */
  parseHeader: parseFastqHeader,

  /**
   * Validate quality string length
   */
  validateQuality: validateFastqQuality,

  /**
   * Validate FASTQ sequence
   */
  validateSequence: validateFastqSequence,

  /**
   * Perform quick validation of FASTQ structure
   * @deprecated Use validateFastqRecord from validation module
   */
  validateStructure: (data: string): boolean => {
    try {
      const lines = data.split(/\r?\n/);
      if (lines.length < 4) return false;

      // Check basic structure
      return (
        (lines[0]?.startsWith("@") ?? false) &&
        (lines[2]?.startsWith("+") ?? false) &&
        (lines[1]?.length ?? 0) === (lines[3]?.length ?? 0)
      );
    } catch {
      return false;
    }
  },

  /**
   * Convert between quality encodings
   */
  convertQuality(
    qualityString: string,
    fromEncoding: QualityEncoding,
    toEncoding: QualityEncoding,
  ): string {
    if (fromEncoding === toEncoding) return qualityString;

    const scores = qualityToScores(qualityString, fromEncoding);
    return scoresToQuality(scores, toEncoding);
  },

  /**
   * Validate FASTQ record structure
   * @deprecated Use validateFastqRecord from validation module instead
   */
  validateRecord(lines: string[]): { valid: boolean; error?: string } {
    if (lines.length !== 4) {
      return { valid: false, error: `Expected 4 lines, got ${lines.length}` };
    }

    if (lines[0] === undefined || lines[0] === null || !lines[0].startsWith("@")) {
      return { valid: false, error: "Header must start with @" };
    }

    if (lines[2] === undefined || lines[2] === null || !lines[2].startsWith("+")) {
      return { valid: false, error: "Separator must start with +" };
    }

    const seqLen = (lines[1] ?? "").replace(/\s/g, "").length;
    const qualLen = (lines[3] ?? "").replace(/\s/g, "").length;

    if (seqLen !== qualLen) {
      return {
        valid: false,
        error: `Sequence length (${seqLen}) != quality length (${qualLen})`,
      };
    }

    return { valid: true };
  },
} as const;

// =============================================================================
// EXPORTS
// =============================================================================

// Re-export detectFastqFormat for backward compatibility
export { detectFastqFormat };
