/**
 * BED format parser and writer
 *
 * Supports all BED format variants (BED3-BED12) with comprehensive validation.
 * Refactored to Tiger Style compliance while maintaining functionality and
 * adding genomics domain improvements.
 *
 * Handles real-world BED file messiness:
 * - Track lines and browser lines
 * - Comment lines
 * - Mixed BED formats in single file
 * - Zero-length intervals (genomics standard)
 * - Large genomic coordinates with validation
 */

import { type } from "arktype";
import { BedError, ParseError, ValidationError } from "../errors";
import type { BedInterval, ParserOptions, Strand } from "../types";
import { BedIntervalSchema } from "../types";

/**
 * Detect BED format variant from number of fields
 * Tiger Style: Function under 70 lines, clear switch logic
 */
export function detectVariant(fieldCount: number): string {
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
      if (fieldCount < 3) return "invalid";
      if (fieldCount > 12) return "extended";
      return `BED${fieldCount}`;
  }
}

/**
 * Validate strand annotation
 * Tiger Style: Function under 70 lines, explicit validation
 */
export function validateStrand(strand: string): strand is Strand {
  return strand === "+" || strand === "-" || strand === ".";
}

/**
 * Parse RGB color string
 * Tiger Style: Function under 70 lines, handles genomics color formats
 */
export function parseRgb(rgbString: string): { r: number; g: number; b: number } | null {
  // Handle comma-separated RGB values
  if (/^\d+,\d+,\d+$/.test(rgbString)) {
    const parts = rgbString.split(",").map(Number);
    if (parts.length === 3) {
      const r = parts[0]!;
      const g = parts[1]!;
      const b = parts[2]!;
      if (r <= 255 && g <= 255 && b <= 255) {
        return { r, g, b };
      }
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
 * Validate genomic coordinates with domain knowledge
 * Tiger Style: Function under 70 lines, genomics-aware validation
 */
export function validateCoordinates(
  start: number,
  end: number,
  allowZeroLength = true
): { valid: boolean; error?: string } {
  if (start < 0 || end < 0) {
    return { valid: false, error: "Coordinates cannot be negative" };
  }

  if (!allowZeroLength && start >= end) {
    return { valid: false, error: "End coordinate must be greater than start" };
  }

  if (allowZeroLength && start > end) {
    return { valid: false, error: "Start coordinate cannot exceed end coordinate" };
  }

  // Genomics domain validation - largest human chromosome is ~249MB
  const MAX_CHROMOSOME_SIZE = 300_000_000;
  if (start > MAX_CHROMOSOME_SIZE || end > MAX_CHROMOSOME_SIZE) {
    const violating = start > MAX_CHROMOSOME_SIZE ? start : end;
    const sizeMB = Math.round(violating / 1_000_000);
    return {
      valid: false,
      error: `Coordinate ${violating} (${sizeMB}MB) exceeds largest known chromosome (300MB)`,
    };
  }

  return { valid: true };
}

/**
 * Streaming BED parser following established FASTA patterns
 * Tiger Style: Class methods under 70 lines, focused responsibilities
 */
export class BedParser {
  private readonly options: Required<ParserOptions & { allowZeroLength: boolean }>;

  constructor(options: ParserOptions & { allowZeroLength?: boolean } = {}) {
    if (typeof options !== "object") {
      throw new ValidationError("options must be an object");
    }

    this.options = {
      skipValidation: false,
      maxLineLength: 1_000_000,
      trackLineNumbers: true,
      allowZeroLength: true, // Genomics improvement
      qualityEncoding: "phred33",
      parseQualityScores: false,
      onError: (error: string, lineNumber?: number): void => {
        throw new BedError(error, undefined, undefined, undefined, lineNumber);
      },
      onWarning: (warning: string, lineNumber?: number): void => {
        console.warn(`BED Warning (line ${lineNumber}): ${warning}`);
      },
      ...options,
    };
  }

  /**
   * Parse BED intervals from string
   * Tiger Style: Function under 70 lines, delegates to parseLines
   */
  async *parseString(data: string): AsyncIterable<BedInterval> {
    if (typeof data !== "string") {
      throw new ValidationError("data must be a string");
    }
    const lines = data.split(/\r?\n/);
    yield* this.parseLines(lines);
  }

  /**
   * Parse BED intervals from file using streaming I/O
   * Tiger Style: Function under 70 lines, follows FASTA pattern
   */
  async *parseFile(filePath: string, options?: { encoding?: string }): AsyncIterable<BedInterval> {
    if (typeof filePath !== "string") {
      throw new ValidationError("filePath must be a string");
    }
    if (filePath.length === 0) {
      throw new ValidationError("filePath must not be empty");
    }

    try {
      const { FileReader } = await import("../io/file-reader");
      const stream = await FileReader.createStream(filePath, {
        encoding: (options?.encoding as "utf8") || "utf8",
        maxFileSize: 10_000_000_000, // 10GB max to match FileReader default
      });

      const { StreamUtils } = await import("../io/stream-utils");
      const lines = StreamUtils.readLines(stream, "utf8");
      yield* this.parseLinesFromAsyncIterable(lines);
    } catch (error) {
      throw new BedError(
        `Failed to read BED file '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        undefined,
        undefined,
        undefined,
        `File path: ${filePath}`
      );
    }
  }

  /**
   * Parse BED intervals from stream
   * Tiger Style: Function under 70 lines, maintains streaming architecture
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
        `Stream parsing failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        undefined,
        undefined,
        undefined
      );
    }
  }

  /**
   * Parse lines with streaming architecture
   * Tiger Style: Function under 70 lines, focused line processing
   */
  private async *parseLines(lines: string[], startLineNumber = 1): AsyncIterable<BedInterval> {
    let lineNumber = startLineNumber;

    for (const line of lines) {
      lineNumber++;

      if (line.length > this.options.maxLineLength) {
        this.options.onError(
          `Line too long (${line.length} > ${this.options.maxLineLength})`,
          lineNumber
        );
        continue;
      }

      const trimmedLine = line.trim();

      // Skip empty lines, comments, track lines
      if (
        !trimmedLine ||
        trimmedLine.startsWith("#") ||
        trimmedLine.startsWith("track") ||
        trimmedLine.startsWith("browser")
      ) {
        continue;
      }

      try {
        const interval = this.parseLine(trimmedLine, lineNumber);
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
   * Tiger Style: Function under 70 lines, maintains streaming
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

        if (
          !trimmedLine ||
          trimmedLine.startsWith("#") ||
          trimmedLine.startsWith("track") ||
          trimmedLine.startsWith("browser")
        ) {
          continue;
        }

        try {
          const interval = this.parseLine(trimmedLine, lineNumber);
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
        undefined,
        undefined,
        undefined,
        lineNumber
      );
    }
  }

  /**
   * Parse single BED line with enhanced error context
   * Tiger Style: Function under 70 lines, clear parsing logic
   */
  private parseLine(line: string, lineNumber: number): BedInterval | null {
    const fields = line.split(/\s+/);

    if (fields.length < 3) {
      throw new BedError(
        `BED format requires at least 3 fields, got ${fields.length}`,
        undefined,
        undefined,
        undefined,
        lineNumber,
        line
      );
    }

    const [chromosome, startStr, endStr, ...optionalFields] = fields;

    // Validate required fields
    if (!chromosome || !startStr || !endStr) {
      throw new BedError(
        "Missing required fields (chromosome, start, end)",
        chromosome,
        undefined,
        undefined,
        lineNumber,
        line
      );
    }

    // Parse coordinates with error context
    const start = this.parseCoordinate(startStr, "start", lineNumber, line);
    const end = this.parseCoordinate(endStr, "end", lineNumber, line);

    // Validate coordinates with genomics knowledge
    const coordValidation = validateCoordinates(start, end, this.options.allowZeroLength);
    if (!coordValidation.valid) {
      throw new BedError(coordValidation.error!, chromosome, start, end, lineNumber, line);
    }

    // Build interval with calculated fields
    const interval = this.buildInterval(chromosome, start, end, optionalFields, lineNumber);

    // Final validation
    if (!this.options.skipValidation) {
      this.validateInterval(interval, lineNumber, line);
    }

    return interval;
  }

  /**
   * Parse coordinate with enhanced error handling
   * Tiger Style: Function under 70 lines, focused parsing
   */
  private parseCoordinate(
    coordStr: string,
    fieldName: string,
    lineNumber: number,
    line: string
  ): number {
    const coordinate = parseInt(coordStr.trim(), 10);

    if (isNaN(coordinate)) {
      throw new BedError(
        `Invalid ${fieldName}: '${coordStr}' is not a valid integer`,
        undefined,
        fieldName === "start" ? coordinate : undefined,
        fieldName === "end" ? coordinate : undefined,
        lineNumber,
        `Expected integer, got: ${coordStr}`
      );
    }

    return coordinate;
  }

  /**
   * Build BED interval with optional fields
   * Tiger Style: Function under 70 lines, clear field assignment
   */
  private buildInterval(
    chromosome: string,
    start: number,
    end: number,
    optionalFields: string[],
    lineNumber: number
  ): BedInterval {
    const interval: any = {
      chromosome,
      start,
      end,
      length: end - start,
      midpoint: Math.floor((start + end) / 2),
      lineNumber,
    };

    // Add optional fields based on availability
    if (optionalFields.length >= 1 && optionalFields[0]) {
      interval.name = optionalFields[0];
    }

    if (optionalFields.length >= 2 && optionalFields[1]) {
      const score = parseInt(optionalFields[1], 10);
      if (!isNaN(score)) {
        interval.score = score;
      }
    }

    if (optionalFields.length >= 3 && optionalFields[2]) {
      const strand = optionalFields[2];
      if (validateStrand(strand)) {
        interval.strand = strand;
      }
    }

    // Add BED12 fields if present
    if (optionalFields.length >= 9) {
      this.parseBed12Fields(interval, optionalFields, lineNumber);
    }

    // Add classification stats
    interval.stats = {
      bedType: detectVariant(optionalFields.length + 3),
      length: end - start,
      hasThickRegion: optionalFields.length >= 6,
      hasBlocks: optionalFields.length >= 9,
    };

    return interval as BedInterval;
  }

  /**
   * Parse BED12 block fields
   * Tiger Style: Function under 70 lines, handles complex fields
   */
  private parseBed12Fields(interval: any, optionalFields: string[], lineNumber: number): void {
    if (optionalFields.length >= 6) {
      const thickStartStr = optionalFields[3];
      const thickEndStr = optionalFields[4];

      if (thickStartStr) {
        const thickStart = parseInt(thickStartStr, 10);
        if (!isNaN(thickStart)) interval.thickStart = thickStart;
      }

      if (thickEndStr) {
        const thickEnd = parseInt(thickEndStr, 10);
        if (!isNaN(thickEnd)) interval.thickEnd = thickEnd;
      }
    }

    if (optionalFields.length >= 7 && optionalFields[5]) {
      interval.itemRgb = optionalFields[5];
    }

    if (optionalFields.length >= 9) {
      const blockCountStr = optionalFields[6];
      if (blockCountStr) {
        const blockCount = parseInt(blockCountStr, 10);
        if (!isNaN(blockCount)) {
          interval.blockCount = blockCount;

          if (optionalFields[7]) {
            interval.blockSizes = optionalFields[7]
              .split(",")
              .map(Number)
              .filter((n) => !isNaN(n));
          }

          if (optionalFields[8]) {
            interval.blockStarts = optionalFields[8]
              .split(",")
              .map(Number)
              .filter((n) => !isNaN(n));
          }
        }
      }
    }
  }

  /**
   * Validate completed interval
   * Tiger Style: Function under 70 lines, final validation step
   */
  private validateInterval(interval: BedInterval, lineNumber: number, line: string): void {
    try {
      const validation = BedIntervalSchema(interval);
      if (validation instanceof type.errors) {
        throw new BedError(
          `Invalid BED interval: ${validation.summary}`,
          interval.chromosome,
          interval.start,
          interval.end,
          lineNumber,
          line
        );
      }
    } catch (error) {
      if (error instanceof BedError) throw error;
      throw new BedError(
        `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
        interval.chromosome,
        interval.start,
        interval.end,
        lineNumber,
        line
      );
    }
  }
}

/**
 * BED format writer
 * Tiger Style: Simple implementation, focused on output formatting
 */
export class BedWriter {
  /**
   * Format BED interval as tab-separated string
   * Tiger Style: Function under 70 lines, clear field logic
   */
  formatInterval(interval: BedInterval): string {
    const fields: string[] = [
      interval.chromosome,
      interval.start.toString(),
      interval.end.toString(),
    ];

    if (interval.name !== undefined) {
      fields.push(interval.name);

      if (interval.score !== undefined) {
        fields.push(interval.score.toString());

        if (interval.strand !== undefined) {
          fields.push(interval.strand);

          if (interval.thickStart !== undefined && interval.thickEnd !== undefined) {
            fields.push(interval.thickStart.toString());
            fields.push(interval.thickEnd.toString());
            fields.push(interval.itemRgb !== undefined ? interval.itemRgb : "0");

            if (interval.blockCount !== undefined) {
              fields.push(interval.blockCount.toString());
              fields.push(interval.blockSizes ? interval.blockSizes.join(",") : "");
              fields.push(interval.blockStarts ? interval.blockStarts.join(",") : "");
            }
          }
        }
      }
    }

    return fields.join("\t");
  }
}

// Utility functions as module exports (Tiger Style)

/**
 * Detect if data contains BED format
 * Tiger Style: Function under 70 lines, format detection logic
 */
export function detectFormat(data: string): boolean {
  if (typeof data !== "string" || data.length === 0) {
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

    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (start < 0 || end < 0) return false;
  }

  return true;
}

/**
 * Count intervals in BED data
 * Tiger Style: Function under 70 lines
 */
export function countIntervals(data: string): number {
  if (typeof data !== "string") return 0;

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
 * Tiger Style: Function under 70 lines
 */
export function calculateStats(intervals: BedInterval[]): {
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
 * Tiger Style: Function under 70 lines
 */
export function sortIntervals(intervals: BedInterval[]): BedInterval[] {
  return [...intervals].sort((a, b) => {
    const chrCompare = a.chromosome.localeCompare(b.chromosome);
    if (chrCompare !== 0) return chrCompare;

    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });
}

/**
 * Merge overlapping intervals
 * Tiger Style: Function under 70 lines
 */
export function mergeOverlapping(intervals: BedInterval[]): BedInterval[] {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return [];
  }

  const sorted = sortIntervals(intervals);
  const merged: BedInterval[] = [sorted[0]!]; // Non-null assertion: we checked length > 0

  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1];

    if (last && current.chromosome === last.chromosome && current.start <= last.end) {
      // Merge intervals by updating end coordinate
      (last as any).end = Math.max(last.end, current.end);
      // Update calculated fields
      (last as any).length = last.end - last.start;
      (last as any).midpoint = Math.floor((last.start + last.end) / 2);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

// Namespace exports maintaining existing API
export const BedFormat = {
  detectVariant,
  validateStrand,
  parseRgb,
  validateCoordinates,
} as const;

export const BedUtils = {
  detectFormat,
  countIntervals,
  calculateStats,
  sortIntervals,
  mergeOverlapping,
} as const;
