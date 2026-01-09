/**
 * BED format parser and writer
 *
 * Supports all BED format variants (BED3-BED12) with comprehensive validation.
 * Refactored for improved functionality and genomics domain enhancements.
 *
 * Handles real-world BED file messiness:
 * - Track lines and browser lines
 * - Comment lines
 * - Mixed BED formats in single file
 * - Zero-length intervals (genomics standard)
 * - Large genomic coordinates with validation
 */

import { type } from "arktype";
import { BedError, ValidationError } from "../errors";
import { FileReader } from "../io/file-reader";
import { StreamUtils } from "../io/stream-utils";
import {
  parseEndPosition,
  parseStartPosition,
  validateFinalCoordinates,
} from "../operations/core/coordinates";
import type { BedInterval, ParserOptions, Strand, ZeroBasedCoordinate } from "../types";
import { BedIntervalSchema, ZeroBasedCoordinate as ZeroBasedCoordinateValidator } from "../types";
import { AbstractParser } from "./abstract-parser";

/**
 * BED-specific parser options
 * Extends base ParserOptions for genomic interval data
 */
interface BedParserOptions extends ParserOptions {
  /** Allow zero-length intervals for insertion sites and point mutations */
  allowZeroLength?: boolean;
}

/**
 * ArkType validation for BED parser options with genomics domain expertise
 * Provides excellent error messages and biological guidance
 */
const BedParserOptionsSchema = type({
  "skipValidation?": "boolean",
  "maxLineLength?": "number>0",
  "trackLineNumbers?": "boolean",
  "allowZeroLength?": "boolean",
}).narrow((options, ctx) => {
  // Memory safety validation for genomics workflows
  if (options.maxLineLength && options.maxLineLength > 100_000_000) {
    return ctx.reject({
      expected: "maxLineLength <= 100MB for genomics file memory safety",
      actual: `${options.maxLineLength} bytes`,
      path: ["maxLineLength"],
    });
  }

  // Note: AbortSignal validation handled by TypeScript interface, not ArkType
  return true;
});

/**
 * Detect BED format variant from number of fields
 * Function provides clear switch logic for variant detection
 */
function detectVariant(fieldCount: number): "BED3" | "BED4" | "BED5" | "BED6" | "BED9" | "BED12" {
  if (fieldCount < 3) {
    throw new BedError(`Invalid BED format: requires at least 3 fields, got ${fieldCount}`, {
      context: "BED format requires chromosome, start, and end coordinates",
    });
  }

  if (fieldCount > 12) {
    throw new BedError(
      `Unsupported BED format: ${fieldCount} fields exceeds BED12 specification (max 12 fields)`,
      { context: "Consider using bigBed format for extended field sets" }
    );
  }

  switch (fieldCount) {
    case 3:
      return "BED3";
    case 4:
      return "BED4";
    case 5:
      return "BED5";
    case 6:
      return "BED6";
    case 9:
      return "BED9";
    case 12:
      return "BED12";
    default:
      throw new BedError(
        `Unsupported BED variant: BED${fieldCount} (valid: BED3, BED4, BED5, BED6, BED9, BED12)`,
        { context: "Use supported BED format variants with proper field counts" }
      );
  }
}

/**
 * Validate strand annotation
 * Function provides explicit BED interval validation
 */
function validateStrand(strand: string): strand is Strand {
  return strand === "+" || strand === "-" || strand === ".";
}

/**
 * Validate BED12 block structure according to UCSC specification
 * Function provides comprehensive block structure validation
 */
function validateBedBlockStructure(
  bed: Pick<
    BedInterval,
    "blockCount" | "blockStarts" | "blockSizes" | "start" | "end" | "chromosome"
  >,
  lineNumber?: number,
  line?: string
): void {
  // Early return for features without blocks
  if (!bed.blockCount || !bed.blockStarts?.length || !bed.blockSizes?.length) return;

  const { blockStarts, blockSizes } = bed;

  // UCSC BED12 specification: First blockStart must be 0 (relative to chromStart)
  if (blockStarts[0] !== 0) {
    throw new BedError(
      `Invalid BED12 block structure: first blockStart must be 0 (relative to chromStart), got ${blockStarts[0]}`,
      {
        chromosome: bed.chromosome,
        start: bed.start,
        end: bed.end,
        lineNumber,
        context: line,
      }
    );
  }

  // UCSC BED12 specification: Final block must end at feature boundary
  const lastStart = blockStarts[blockStarts.length - 1];
  const lastSize = blockSizes[blockSizes.length - 1];

  if (lastStart === undefined || lastSize === undefined) {
    throw new BedError("Block arrays cannot be empty for BED12 validation", {
      chromosome: bed.chromosome,
      start: bed.start,
      end: bed.end,
      lineNumber,
      context: line,
    });
  }

  const finalBlockEnd = lastStart + lastSize;
  const featureLength = bed.end - bed.start;

  if (finalBlockEnd !== featureLength) {
    throw new BedError(
      `Invalid BED12 block structure: final block must end at feature boundary. ` +
        `Expected ${featureLength}, got ${finalBlockEnd}`,
      {
        chromosome: bed.chromosome,
        start: bed.start,
        end: bed.end,
        lineNumber,
        context: line,
      }
    );
  }

  // UCSC BED12 specification: Blocks cannot overlap within same feature
  for (let i = 1; i < blockStarts.length; i++) {
    const prevStart = blockStarts[i - 1];
    const prevSize = blockSizes[i - 1];
    const currentStart = blockStarts[i];

    if (prevStart === undefined || prevSize === undefined || currentStart === undefined) {
      throw new BedError(`Invalid block structure at index ${i}`, {
        chromosome: bed.chromosome,
        start: bed.start,
        end: bed.end,
        lineNumber,
        context: line,
      });
    }

    const prevEnd = prevStart + prevSize;

    if (currentStart < prevEnd) {
      throw new BedError(
        `Invalid BED12 block structure: blocks cannot overlap within same feature. ` +
          `Block ${i - 1} ends at ${prevEnd}, block ${i} starts at ${currentStart}`,
        {
          chromosome: bed.chromosome,
          start: bed.start,
          end: bed.end,
          lineNumber,
          context: line,
        }
      );
    }
  }
}

/**
 * Parse RGB color string
 * Function handles genomics color format parsing
 */
function parseRgb(rgbString: string): { r: number; g: number; b: number } | null {
  // Handle comma-separated RGB values
  if (/^\d+,\d+,\d+$/.test(rgbString)) {
    const parts = rgbString.split(",").map(Number);
    const [r, g, b] = parts;

    // Regex guarantees 3 values, but TypeScript needs assertion
    if (r !== undefined && g !== undefined && b !== undefined && r <= 255 && g <= 255 && b <= 255) {
      return { r, g, b };
    }
  }

  // Handle single integer (0 for default)
  if (/^\d+$/.test(rgbString)) {
    const value = parseInt(rgbString, 10);
    if (value === 0) {
      return { r: 0, g: 0, b: 0 };
    }
  }

  return null;
}

/**
 * Parse BED coordinate with enhanced validation and type safety
 * Tree-shakeable function using established core coordinate parsing
 */
function parseBedCoordinate(
  coordStr: string,
  fieldName: string,
  lineNumber: number,
  line: string,
  options: { onWarning?: (msg: string, line: number) => void }
): ZeroBasedCoordinate {
  // Early check for negative coordinate strings (biological impossibility)
  if (coordStr.trim().startsWith("-")) {
    throw new BedError(`Invalid ${fieldName}: negative coordinates are biologically impossible`, {
      lineNumber,
      context: `BED coordinates must be non-negative (0-based system), got: ${coordStr}`,
    });
  }

  try {
    // Use core coordinate functions for sophisticated parsing
    const result =
      fieldName === "start"
        ? parseStartPosition(coordStr, Number.MAX_SAFE_INTEGER, false, false)
        : parseEndPosition(coordStr, Number.MAX_SAFE_INTEGER, false, false);

    const coordinate = result.value;

    // Parse-don't-validate: Transform to branded coordinate type
    const validationResult = ZeroBasedCoordinateValidator(coordinate);
    if (validationResult instanceof type.errors) {
      throw new BedError(`Invalid BED coordinate: ${validationResult.summary}`, {
        lineNumber,
        context: `Expected valid 0-based coordinate, got: ${coordStr}`,
      });
    }

    // BED-specific large coordinate protection (bedtools compatibility)
    if (coordinate > 2_500_000_000) {
      options.onWarning?.(
        `Large coordinate ${coordinate} may cause compatibility issues with bedtools (>2.5GB limit)`,
        lineNumber
      );
    }

    return validationResult;
  } catch (error) {
    throw new BedError(
      `Invalid ${fieldName}: '${coordStr}' - ${error instanceof Error ? error.message : String(error)}`,
      {
        lineNumber,
        context: `Line content: ${line.substring(0, 100)}${line.length > 100 ? "..." : ""}`,
      }
    );
  }
}

/**
 * Validate BED interval with comprehensive validation
 * Tree-shakeable function with type-safe error handling
 */
function validateBedInterval(interval: BedInterval, lineNumber: number, line: string): void {
  try {
    // First validate with ArkType schema
    const validation = BedIntervalSchema(interval);
    if (validation instanceof type.errors) {
      throw new BedError(`Invalid BED interval: ${validation.summary}`, {
        chromosome: interval.chromosome,
        start: interval.start,
        end: interval.end,
        lineNumber,
        context: line,
      });
    }

    // Then validate BED12 block structure (UCSC specification)
    validateBedBlockStructure(interval, lineNumber, line);
  } catch (error) {
    if (error instanceof BedError) throw error;
    throw new BedError(
      `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        chromosome: interval.chromosome,
        start: interval.start,
        end: interval.end,
        lineNumber,
        context: line,
      }
    );
  }
}

/**
 * Build BED interval with optional biological fields
 * Tree-shakeable function preserving biological semantics
 */
function buildBedInterval(
  chromosome: string,
  start: ZeroBasedCoordinate,
  end: ZeroBasedCoordinate,
  optionalFields: string[],
  lineNumber: number,
  options: { onWarning?: (msg: string, line: number) => void }
): BedInterval {
  // Determine all optional fields upfront (no mutation)
  const name = optionalFields.length >= 1 && optionalFields[0] ? optionalFields[0] : undefined;
  const score =
    optionalFields.length >= 2 && optionalFields[1]
      ? (() => {
          const parsed = parseInt(optionalFields[1], 10);
          return !Number.isNaN(parsed) ? parsed : undefined;
        })()
      : undefined;
  const strand =
    optionalFields.length >= 3 && optionalFields[2] && validateStrand(optionalFields[2])
      ? (optionalFields[2] as Strand)
      : undefined;

  // Parse thick region coordinates upfront (BED9)
  let thickStart: ZeroBasedCoordinate | undefined;
  let thickEnd: ZeroBasedCoordinate | undefined;

  if (optionalFields.length >= 6) {
    if (optionalFields[3]) {
      try {
        const result = parseStartPosition(optionalFields[3], Number.MAX_SAFE_INTEGER, false, false);
        const validated = ZeroBasedCoordinateValidator(result.value);
        if (!(validated instanceof type.errors)) {
          thickStart = validated;

          if (result.value > 2_500_000_000) {
            options.onWarning?.(
              `Large thickStart coordinate ${result.value} may cause compatibility issues with bedtools (>2.5GB limit)`,
              lineNumber
            );
          }
        }
      } catch {
        // Invalid thickStart - leave undefined
      }
    }

    if (optionalFields[4]) {
      try {
        const result = parseEndPosition(optionalFields[4], Number.MAX_SAFE_INTEGER, false, false);
        const validated = ZeroBasedCoordinateValidator(result.value);
        if (!(validated instanceof type.errors)) {
          thickEnd = validated;

          if (result.value > 2_500_000_000) {
            options.onWarning?.(
              `Large thickEnd coordinate ${result.value} may cause compatibility issues with bedtools (>2.5GB limit)`,
              lineNumber
            );
          }
        }
      } catch {
        // Invalid thickEnd - leave undefined
      }
    }
  }

  const itemRgb = optionalFields.length >= 6 && optionalFields[5] ? optionalFields[5] : undefined;

  // Construct complete BedInterval with proper optional field handling
  const interval: BedInterval = {
    chromosome,
    start,
    end,
    length: end - start,
    midpoint: Math.floor((start + end) / 2),
    lineNumber,
    ...(name !== undefined && { name }),
    ...(score !== undefined && { score }),
    ...(strand !== undefined && { strand }),
    ...(thickStart !== undefined && { thickStart }),
    ...(thickEnd !== undefined && { thickEnd }),
    ...(itemRgb !== undefined && { itemRgb }),
    stats: {
      bedType: detectVariant(optionalFields.length + 3),
      length: end - start,
      hasThickRegion: thickStart !== undefined || thickEnd !== undefined,
      hasBlocks: false, // Set by block parsing
    },
  };

  return interval;
}

/**
 * Parse BED12 block fields with UCSC specification compliance
 * Function focused on BED12 block structure validation
 */
function parseBed12BlockFields(
  interval: { blockCount?: number; blockSizes?: number[]; blockStarts?: number[] },
  optionalFields: string[],
  lineNumber: number
): void {
  if (optionalFields.length >= 9) {
    const blockCountStr = optionalFields[6];
    if (blockCountStr) {
      const blockCount = parseInt(blockCountStr, 10);
      if (!Number.isNaN(blockCount)) {
        interval.blockCount = blockCount;

        // Parse blockSizes (comma-separated)
        if (optionalFields[7]) {
          interval.blockSizes = optionalFields[7]
            .split(",")
            .map(Number)
            .filter((n) => !Number.isNaN(n));
        }

        // Parse blockStarts (comma-separated, relative to chromStart)
        if (optionalFields[8]) {
          interval.blockStarts = optionalFields[8]
            .split(",")
            .map(Number)
            .filter((n) => !Number.isNaN(n));
        }

        // Validate block count consistency
        if (interval.blockSizes && interval.blockSizes.length !== blockCount) {
          throw new BedError(
            `Block sizes count mismatch: blockCount=${blockCount} but found ${interval.blockSizes.length} block sizes`,
            { lineNumber }
          );
        }
        if (interval.blockStarts && interval.blockStarts.length !== blockCount) {
          throw new BedError(
            `Block starts count mismatch: blockCount=${blockCount} but found ${interval.blockStarts.length} block starts`,
            { lineNumber }
          );
        }
      }
    }
  }
}

/**
 * Parse single BED line to interval
 * Tree-shakeable function with core BED parsing logic
 */
function parseBedLine(
  line: string,
  lineNumber: number,
  options: Required<ParserOptions & { allowZeroLength: boolean }>
): BedInterval | null {
  const fields = line.split(/\s+/);

  if (fields.length < 3) {
    throw new BedError(`BED format requires at least 3 fields, got ${fields.length}`, {
      lineNumber,
      context: line,
    });
  }

  const [chromosome, startStr, endStr, ...optionalFields] = fields;

  // Validate required fields
  if (!chromosome || !startStr || !endStr) {
    throw new BedError("Missing required fields (chromosome, start, end)", {
      chromosome,
      lineNumber,
      context: line,
    });
  }

  // Parse coordinates using extracted function
  const start = parseBedCoordinate(startStr, "start", lineNumber, line, {
    onWarning: options.onWarning,
  });
  const end = parseBedCoordinate(endStr, "end", lineNumber, line, {
    onWarning: options.onWarning,
  });

  // Validate coordinates with BED biological semantics
  const coordValidation = validateCoordinates(start, end, options.allowZeroLength);
  if (!coordValidation.valid) {
    const errorMsg = coordValidation.error ?? "Unknown coordinate validation error";
    throw new BedError(errorMsg, { chromosome, start, end, lineNumber, context: line });
  }

  // Build interval using extracted function
  const interval = buildBedInterval(chromosome, start, end, optionalFields, lineNumber, {
    onWarning: options.onWarning,
  });

  // Add BED12 block fields
  parseBed12BlockFields(interval, optionalFields, lineNumber);

  // Final validation if not skipped
  if (!options.skipValidation) {
    validateBedInterval(interval, lineNumber, line);
  }

  return interval;
}

/**
 * Check if BED line should be skipped during parsing
 * Function provides biological track and comment line detection
 */
function shouldSkipBedLine(trimmedLine: string): boolean {
  return (
    !trimmedLine ||
    trimmedLine.startsWith("#") ||
    trimmedLine.startsWith("track") ||
    trimmedLine.startsWith("browser")
  );
}

/**
 * BED-specific coordinate validation wrapper around core validation
 * Function preserves BED biological semantics and line processing
 * Eliminates coordinate validation duplication while preserving allowZeroLength
 */
function validateCoordinates(
  start: number,
  end: number,
  allowZeroLength = true
): { valid: boolean; error?: string } {
  // Early validation for negative coordinates
  if (start < 0 || end < 0) {
    return { valid: false, error: "Coordinates cannot be negative" };
  }

  // BED-specific: Zero-length intervals valid (insertion sites, point mutations)
  if (allowZeroLength && start === end) {
    return { valid: true };
  }

  try {
    // Use core validation for coordinate order and bounds (with 2.5GB limit)
    validateFinalCoordinates(start, end, Number.MAX_SAFE_INTEGER, `BED:${start}-${end}`);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Streaming BED parser following established FASTA patterns
 * Class methods maintain focused responsibilities for BED parsing
 */
class BedParser extends AbstractParser<BedInterval, BedParserOptions> {
  protected getDefaultOptions(): Partial<BedParserOptions> {
    return {
      skipValidation: false,
      maxLineLength: 1_000_000,
      trackLineNumbers: true,
      allowZeroLength: true, // BED-specific default for insertion sites
      onError: (error: string, lineNumber?: number): void => {
        throw new BedError(error, { lineNumber });
      },
      onWarning: (warning: string, lineNumber?: number): void => {
        console.warn(`BED Warning (line ${lineNumber}): ${warning}`);
      },
    };
  }

  constructor(options: BedParserOptions = {}) {
    // Step 1: ArkType validation with genomics domain expertise
    const validationResult = BedParserOptionsSchema(options);

    if (validationResult instanceof type.errors) {
      throw new ValidationError(
        `Invalid BED parser options: ${validationResult.summary}`,
        undefined,
        "BED parser configuration with genomics context"
      );
    }

    // Step 2: Pass validated options to parent (which will merge with defaults)
    super(options);

    // Step 3: Application-level warnings based on validated options
    if (this.options.allowZeroLength === false) {
      this.options.onWarning?.(
        "allowZeroLength: false disables insertion sites and point mutations - " +
          "these are valid genomics features in BED format",
        undefined
      );
    }

    if (this.options.skipValidation === true && !this.options.onError) {
      this.options.onWarning?.(
        "skipValidation: true without custom onError handler may silently ignore " +
          "malformed BED data - consider providing error handler for production use",
        undefined
      );
    }
  }

  protected getFormatName(): string {
    return "BED";
  }

  /**
   * Parse BED intervals from string
   * Function delegates to parseLines for streaming processing
   */
  async *parseString(data: string): AsyncIterable<BedInterval> {
    this.checkAborted(); // Inherited interrupt checking
    const lines = data.split(/\r?\n/);
    yield* this.parseLines(lines);
  }

  /**
   * Parse BED intervals from file using streaming I/O
   * Function follows established streaming parser patterns
   */
  async *parseFile(filePath: string, options?: { encoding?: string }): AsyncIterable<BedInterval> {
    this.throwIfAborted("file parsing"); // Inherited interrupt checking with context

    if (filePath.length === 0) {
      throw new ValidationError("filePath must not be empty");
    }

    try {
      const stream = await FileReader.createStream(filePath, {
        encoding: (options?.encoding as "utf8") || "utf8",
        maxFileSize: 10_000_000_000, // 10GB max to match FileReader default
      });

      const lines = StreamUtils.readLines(stream, "utf8");
      yield* this.parseLinesFromAsyncIterable(lines);
    } catch (error) {
      throw new BedError(
        `Failed to read BED file '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
        { context: `File path: ${filePath}` }
      );
    }
  }

  /**
   * Parse BED intervals from stream
   * Function maintains streaming architecture for memory efficiency
   */
  async *parse(stream: ReadableStream<Uint8Array>): AsyncIterable<BedInterval> {
    if (!(stream instanceof ReadableStream)) {
      throw new ValidationError("stream must be ReadableStream");
    }

    try {
      // Convert binary stream to text manually to avoid type issues
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";

          if (lines.length > 0) {
            yield* this.parseLines(lines);
          }
        }

        if (buffer) {
          yield* this.parseLines([buffer]);
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      throw new BedError(
        `Stream parsing failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Parse lines with streaming architecture
   * Function provides focused BED line processing logic
   */
  private async *parseLines(lines: string[], startLineNumber = 1): AsyncIterable<BedInterval> {
    let lineNumber = startLineNumber;

    for (const line of lines) {
      lineNumber++;
      this.checkAborted(); // Inherited interrupt checking in parsing loop

      if (line.length > this.options.maxLineLength) {
        this.options.onError(
          `Line too long (${line.length} > ${this.options.maxLineLength})`,
          lineNumber
        );
        continue;
      }

      const trimmedLine = line.trim();

      // Skip empty lines, comments, track lines (biological workflow handling)
      if (shouldSkipBedLine(trimmedLine)) {
        continue;
      }

      try {
        const interval = parseBedLine(line, lineNumber, this.options);
        if (interval) {
          yield interval;
        }
      } catch (error) {
        if (!this.options.skipValidation) {
          throw error;
        }
        this.options.onError(error instanceof Error ? error.message : String(error), lineNumber);
      }
    }
  }

  /**
   * Parse lines from async iterable
   * Function maintains streaming behavior for large files
   */
  private async *parseLinesFromAsyncIterable(
    lines: AsyncIterable<string>
  ): AsyncIterable<BedInterval> {
    let lineNumber = 0;

    try {
      for await (const line of lines) {
        lineNumber++;

        if (line.length > this.options.maxLineLength) {
          this.options.onError(
            `Line too long (${line.length} > ${this.options.maxLineLength})`,
            lineNumber
          );
          continue;
        }

        const trimmedLine = line.trim();

        if (shouldSkipBedLine(trimmedLine)) {
          continue;
        }

        try {
          const interval = parseBedLine(line, lineNumber, this.options);
          if (interval) {
            yield interval;
          }
        } catch (error) {
          if (!this.options.skipValidation) {
            throw error;
          }
          this.options.onError(error instanceof Error ? error.message : String(error), lineNumber);
        }
      }
    } catch (error) {
      throw new BedError(
        `BED parsing failed at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
        { lineNumber }
      );
    }
  }
}

/**
 * BED format writer
 * Simple implementation focused on BED output formatting
 */
class BedWriter {
  /**
   * Format BED interval as tab-separated string
   * Function provides clear BED field formatting logic
   */
  formatInterval(interval: BedInterval): string {
    // Required BED3 fields
    const fields: string[] = [
      interval.chromosome,
      interval.start.toString(),
      interval.end.toString(),
    ];

    // Early return for BED3 (minimal format)
    if (interval.name === undefined) {
      return fields.join("\t");
    }

    // BED4: Add name field
    fields.push(interval.name);
    if (interval.score === undefined) {
      return fields.join("\t");
    }

    // BED5: Add score field
    fields.push(interval.score.toString());
    if (interval.strand === undefined) {
      return fields.join("\t");
    }

    // BED6: Add strand field
    fields.push(interval.strand);
    if (interval.thickStart === undefined || interval.thickEnd === undefined) {
      return fields.join("\t");
    }

    // BED9: Add thick region fields
    fields.push(interval.thickStart.toString());
    fields.push(interval.thickEnd.toString());
    fields.push(interval.itemRgb !== undefined ? interval.itemRgb : "0");

    if (interval.blockCount === undefined) {
      return fields.join("\t");
    }

    // BED12: Add block fields
    fields.push(interval.blockCount.toString());
    fields.push(interval.blockSizes ? interval.blockSizes.join(",") : "");
    fields.push(interval.blockStarts ? interval.blockStarts.join(",") : "");

    return fields.join("\t");
  }
}

// Utility functions as module exports

/**
 * Detect if data contains BED format
 * Function provides BED format variant detection logic
 */
function detectFormat(data: string): boolean {
  if (data.length === 0) {
    return false;
  }

  const lines = data
    .trim()
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed &&
        !trimmed.startsWith("#") &&
        !trimmed.startsWith("track") &&
        !trimmed.startsWith("browser")
      );
    });

  if (lines.length === 0) return false;

  // Check first few lines for BED characteristics
  for (const line of lines.slice(0, 3)) {
    const fields = line.trim().split(/\s+/);

    if (fields.length < 3) return false;

    const startStr = fields[1];
    const endStr = fields[2];

    if (!startStr || !endStr) return false;
    if (!/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) return false;

    try {
      const startResult = parseStartPosition(startStr, Number.MAX_SAFE_INTEGER, false, false);
      const endResult = parseEndPosition(endStr, Number.MAX_SAFE_INTEGER, false, false);
      if (startResult.value < 0 || endResult.value < 0) return false;
    } catch {
      return false; // Invalid coordinates = not BED format
    }
  }

  return true;
}

/**
 * Count intervals in BED data
 * Function provides BED coordinate validation
 */
function countIntervals(data: string): number {
  return data.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("track") &&
      !trimmed.startsWith("browser")
    );
  }).length;
}

/**
 * Calculate interval statistics
 * Function provides BED coordinate validation
 */
function calculateStats(intervals: BedInterval[]): {
  count: number;
  totalLength: number;
  averageLength: number;
  minLength: number;
  maxLength: number;
} {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return {
      count: 0,
      totalLength: 0,
      averageLength: 0,
      minLength: 0,
      maxLength: 0,
    };
  }

  const lengths = intervals.map((interval) => interval.end - interval.start);
  const totalLength = lengths.reduce((sum, len) => sum + len, 0);

  return {
    count: intervals.length,
    totalLength,
    averageLength: totalLength / intervals.length,
    minLength: Math.min(...lengths),
    maxLength: Math.max(...lengths),
  };
}

/**
 * Sort intervals by genomic position
 * Function provides BED coordinate validation
 */
function sortIntervals(intervals: BedInterval[]): BedInterval[] {
  return [...intervals].sort((a, b) => {
    const chrCompare = a.chromosome.localeCompare(b.chromosome);
    if (chrCompare !== 0) return chrCompare;

    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });
}

/**
 * Merge overlapping intervals
 * Function provides BED coordinate validation
 */
function mergeOverlapping(intervals: BedInterval[]): BedInterval[] {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return [];
  }

  const sorted = sortIntervals(intervals);
  const [first] = sorted;
  // Early return check guarantees sorted has at least one element
  if (!first) {
    return [];
  }
  const merged: BedInterval[] = [first];

  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1];

    if (last && current.chromosome === last.chromosome && current.start <= last.end) {
      // Create new merged interval (proper immutable approach)
      const mergedEnd = Math.max(last.end, current.end);
      const mergedInterval: BedInterval = {
        ...last,
        end: mergedEnd,
        length: mergedEnd - last.start,
        midpoint: Math.floor((last.start + mergedEnd) / 2),
      };
      merged[merged.length - 1] = mergedInterval; // Replace last with merged
    } else {
      merged.push(current);
    }
  }

  return merged;
}

// Namespace exports maintaining existing API
const BedFormat = {
  detectVariant,
  validateStrand,
  parseRgb,
  validateCoordinates,
} as const;

const BedUtils = {
  detectFormat,
  countIntervals,
  calculateStats,
  sortIntervals,
  mergeOverlapping,
} as const;

// Exports - grouped at end per project style guide
export {
  detectVariant,
  validateStrand,
  validateBedBlockStructure,
  parseRgb,
  validateCoordinates,
  BedParser,
  BedWriter,
  detectFormat,
  countIntervals,
  calculateStats,
  sortIntervals,
  mergeOverlapping,
  BedFormat,
  BedUtils,
};
