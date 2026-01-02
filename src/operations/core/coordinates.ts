/**
 * Genomic coordinate parsing and validation utilities
 *
 * Provides pure functions for parsing genomic coordinate strings,
 * handling different coordinate systems (0-based vs 1-based),
 * and validating coordinate ranges.
 *
 * @module coordinates
 * @since v0.1.0
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Parsed genomic coordinates with metadata
 */
export interface ParsedCoordinates {
  /** Start position (0-based, inclusive) */
  start: number;
  /** End position (0-based, exclusive) */
  end: number;
  /** Original coordinate string */
  original: string;
  /** Whether coordinates contained negative indices */
  hasNegativeIndices: boolean;
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate that a region string has the required format
 *
 * @param region - Region string to validate
 * @throws {Error} When region format is invalid
 *
 * @example
 * ```typescript
 * validateRegionString("chr1:1000-2000"); // OK
 * validateRegionString("invalid");        // Throws error
 * ```
 */
export function validateRegionString(region: string): void {
  if (region.length === 0 || region.trim() === "") {
    throw new Error("Region string cannot be empty");
  }
}

/**
 * Validate region parts after splitting on delimiter
 *
 * @param startStr - Start coordinate string
 * @param endStr - End coordinate string
 * @param region - Original region string for error context
 * @throws {Error} When region parts are invalid
 */
export function validateRegionParts(
  startStr: string | undefined,
  endStr: string | undefined,
  region: string,
): void {
  if (startStr === undefined || endStr === undefined) {
    throw new Error(`Invalid region format: ${region} (missing start or end)`);
  }
}

/**
 * Validate final parsed coordinates
 *
 * @param start - Start coordinate
 * @param end - End coordinate
 * @param sequenceLength - Total sequence length
 * @param region - Original region string for error context
 * @throws {Error} When coordinates are invalid
 */
export function validateFinalCoordinates(
  start: number,
  end: number,
  sequenceLength: number,
  region: string,
): void {
  if (start < 0) {
    throw new Error(`Invalid start position: ${start} (must be >= 0) in region ${region}`);
  }
  if (end > sequenceLength) {
    throw new Error(
      `Invalid end position: ${end} (exceeds sequence length ${sequenceLength}) in region ${region}`,
    );
  }
  if (start >= end) {
    throw new Error(`Invalid coordinates: start ${start} >= end ${end} in region ${region}`);
  }
}

// =============================================================================
// PARSING FUNCTIONS
// =============================================================================

/**
 * Parse start position with negative index handling
 *
 * @param startStr - Start position string
 * @param sequenceLength - Total sequence length for negative index calculation
 * @param oneBased - Whether coordinates are 1-based (default: false = 0-based)
 * @param hasNegativeIndices - Whether negative indices are present
 * @returns Parsed start position and negative index flag
 *
 * @example
 * ```typescript
 * parseStartPosition("1", 100, true, false);    // {value: 0, hasNegative: false}
 * parseStartPosition("-10", 100, false, true); // {value: 90, hasNegative: true}
 * ```
 *
 * 🔥 NATIVE: String parsing and arithmetic - vectorizable
 */
export function parseStartPosition(
  startStr: string,
  sequenceLength: number,
  oneBased: boolean,
  hasNegativeIndices: boolean,
): { value: number; hasNegative: boolean } {
  // Tiger Style: Assert inputs
  if (typeof startStr !== "string" || startStr.trim() === "") {
    throw new Error("Start position string cannot be empty");
  }
  if (sequenceLength < 0) {
    throw new Error("Sequence length must be non-negative");
  }

  const isNegative = startStr.startsWith("-");
  const numericValue = parseInt(startStr, 10);

  if (Number.isNaN(numericValue)) {
    throw new Error(`Invalid start position: ${startStr} (not a number)`);
  }

  let result: number;
  if (isNegative) {
    // Negative index: count from end
    result = sequenceLength + numericValue; // numericValue is already negative
  } else {
    // Positive index: convert from 1-based to 0-based if needed
    result = oneBased ? numericValue - 1 : numericValue;
  }

  return {
    value: Math.max(0, result), // Clamp to valid range
    hasNegative: isNegative || hasNegativeIndices,
  };
}

/**
 * Parse end position with negative index handling
 *
 * @param endStr - End position string
 * @param sequenceLength - Total sequence length for negative index calculation
 * @param oneBased - Whether coordinates are 1-based (default: false = 0-based)
 * @param hasNegativeIndices - Whether negative indices are present
 * @returns Parsed end position and negative index flag
 *
 * @example
 * ```typescript
 * parseEndPosition("100", 1000, true, false);  // {value: 100, hasNegative: false}
 * parseEndPosition("-1", 1000, false, true);   // {value: 1000, hasNegative: true}
 * ```
 *
 * 🔥 NATIVE: String parsing and arithmetic - vectorizable
 */
export function parseEndPosition(
  endStr: string,
  sequenceLength: number,
  oneBased: boolean,
  hasNegativeIndices: boolean,
): { value: number; hasNegative: boolean } {
  // Tiger Style: Assert inputs
  if (typeof endStr !== "string" || endStr.trim() === "") {
    throw new Error("End position string cannot be empty");
  }
  if (sequenceLength < 0) {
    throw new Error("Sequence length must be non-negative");
  }

  const isNegative = endStr.startsWith("-");
  const numericValue = parseInt(endStr, 10);

  if (Number.isNaN(numericValue)) {
    throw new Error(`Invalid end position: ${endStr} (not a number)`);
  }

  let result: number;
  if (isNegative) {
    // Special case: -1 means end of sequence
    if (numericValue === -1) {
      result = sequenceLength;
    } else {
      // Other negative indices: count from end
      result = sequenceLength + numericValue; // numericValue is already negative
    }
  } else {
    // Positive index: convert from 1-based to 0-based if needed
    // End position is exclusive in 0-based, inclusive in 1-based
    result = oneBased ? numericValue : numericValue;
  }

  return {
    value: Math.min(sequenceLength, Math.max(0, result)), // Clamp to valid range
    hasNegative: isNegative || hasNegativeIndices,
  };
}
