/**
 * GTF (Gene Transfer Format) parser and writer
 *
 * Supports GTF/GFF format for genomic feature annotation:
 * - Standard 9-field GTF format
 * - Attribute parsing with key=value pairs
 * - Feature type filtering
 * - Genomic coordinate extraction
 *
 * Handles real-world GTF file variations:
 * - Comment lines
 * - Header lines
 * - Mixed attribute formats
 * - Malformed coordinates
 * - Missing attributes
 */

import type { Strand, ParserOptions } from "../types";
import { ValidationError, ParseError, GenotypeError } from "../errors";

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * GTF feature annotation with parsed attributes
 */
export interface GtfFeature {
  readonly seqname: string;
  readonly source: string;
  readonly feature: string;
  readonly start: number;
  readonly end: number;
  readonly score: number | null;
  readonly strand: Strand;
  readonly frame: number | null;
  readonly attributes: Record<string, string>;
  readonly length: number;
  readonly lineNumber?: number;
}

/**
 * GTF parser options
 */
export interface GtfParserOptions extends ParserOptions {
  /** Feature types to include (default: all) */
  includeFeatures?: string[];
  /** Feature types to exclude */
  excludeFeatures?: string[];
  /** Required attributes (fail if missing) */
  requiredAttributes?: string[];
  /** Parse attribute values as typed values */
  parseAttributeValues?: boolean;
}

/**
 * Internal GTF parser options with defaults
 */
interface InternalGtfParserOptions {
  skipValidation: boolean;
  maxLineLength: number;
  trackLineNumbers: boolean;
  qualityEncoding: string;
  parseQualityScores: boolean;
  includeFeatures?: string[];
  excludeFeatures?: string[];
  requiredAttributes?: string[];
  parseAttributeValues: boolean;
  onError: (error: string, lineNumber?: number) => void;
  onWarning: (warning: string, lineNumber?: number) => void;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Validate GTF coordinates
 */
export function validateGtfCoordinates(
  start: number,
  end: number
): { valid: boolean; error?: string } {
  if (start < 1) {
    return {
      valid: false,
      error: "Start coordinate must be >= 1 (GTF is 1-based)",
    };
  }

  if (end < start) {
    return {
      valid: false,
      error: "End coordinate must be >= start coordinate",
    };
  }

  return { valid: true };
}

/**
 * Parse GTF attributes string into key-value pairs
 */
export function parseGtfAttributes(attributeString: string): Record<string, string> {
  const attributes: Record<string, string> = {};

  if (!attributeString || attributeString.trim() === "") {
    return attributes;
  }

  // Split by semicolon, handling quoted values
  const parts = attributeString.split(";");

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Match key value pattern: key "value" or key value
    const match = trimmed.match(/^([^=\s]+)\s+(.+)$/);
    if (!match) continue;

    const key = match[1]?.trim();
    let value = match[2]?.trim();

    if (key === undefined || key === "" || value === undefined || value === "") continue;

    // Remove quotes if present
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }

    attributes[key] = value;
  }

  return attributes;
}

/**
 * Validate strand annotation for GTF
 */
export function validateGtfStrand(strand: string): strand is Strand {
  return strand === "+" || strand === "-" || strand === ".";
}

/**
 * Parse score field (can be '.' for missing)
 */
export function parseGtfScore(scoreStr: string): number | null {
  if (scoreStr === "." || scoreStr === "") {
    return null;
  }

  const score = parseFloat(scoreStr);
  if (isNaN(score)) {
    throw new Error(`Invalid score: ${scoreStr}`);
  }

  return score;
}

/**
 * Parse frame field (can be '.' for missing)
 */
export function parseGtfFrame(frameStr: string): number | null {
  if (frameStr === "." || frameStr === "") {
    return null;
  }

  const frame = parseInt(frameStr, 10);
  if (isNaN(frame) || frame < 0 || frame > 2) {
    throw new Error(`Invalid frame: ${frameStr} (must be 0, 1, 2, or '.'))`);
  }

  return frame;
}

// =============================================================================
// GTF PARSER CLASS
// =============================================================================

/**
 * Streaming GTF parser with comprehensive validation
 */
export class GtfParser {
  private readonly options: InternalGtfParserOptions;

  constructor(options: GtfParserOptions = {}) {
    this.options = {
      skipValidation: options.skipValidation ?? false,
      maxLineLength: options.maxLineLength ?? 1_000_000,
      trackLineNumbers: options.trackLineNumbers ?? true,
      qualityEncoding: options.qualityEncoding ?? "phred33",
      parseQualityScores: options.parseQualityScores ?? false,
      parseAttributeValues: options.parseAttributeValues ?? false,
      onError:
        options.onError ??
        ((error: string, lineNumber?: number): void => {
          throw new ParseError(error, "GTF", lineNumber);
        }),
      onWarning:
        options.onWarning ??
        ((warning: string, lineNumber?: number): void => {
          console.warn(`GTF Warning (line ${lineNumber ?? "unknown"}): ${warning}`);
        }),
    };

    // Handle optional array properties separately
    if (options.includeFeatures !== undefined) {
      this.options.includeFeatures = options.includeFeatures;
    }
    if (options.excludeFeatures !== undefined) {
      this.options.excludeFeatures = options.excludeFeatures;
    }
    if (options.requiredAttributes !== undefined) {
      this.options.requiredAttributes = options.requiredAttributes;
    }
  }

  /**
   * Parse GTF features from a string
   */
  async *parseString(data: string): AsyncIterable<GtfFeature> {
    const lines = data.split(/\r?\n/);
    yield* this.parseLines(lines);
  }

  /**
   * Parse GTF features from a file
   */
  async *parseFile(
    filePath: string,
    options?: import("../types").FileReaderOptions
  ): AsyncIterable<GtfFeature> {
    if (typeof filePath !== "string" || filePath.length === 0) {
      throw new ValidationError("filePath must be a non-empty string");
    }

    const { createStream } = await import("../io/file-reader");
    const { StreamUtils } = await import("../io/stream-utils");

    try {
      const stream = await createStream(filePath, options);
      const lines = StreamUtils.readLines(stream, options?.encoding || "utf8");
      yield* this.parseLinesFromAsyncIterable(lines);
    } catch (error) {
      throw new GenotypeError(
        `Failed to parse GTF file '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
        "GTF_PARSE_ERROR",
        undefined,
        undefined
      );
    }
  }

  /**
   * Parse GTF features from lines
   */
  private async *parseLines(lines: string[], startLineNumber = 1): AsyncIterable<GtfFeature> {
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

      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith("#") || trimmedLine.startsWith("//")) {
        continue;
      }

      try {
        const feature = this.parseLine(trimmedLine, lineNumber);
        if (feature && this.shouldIncludeFeature(feature)) {
          yield feature;
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
   * Parse a single GTF line into a feature
   */
  private parseLine(line: string, lineNumber: number): GtfFeature | null {
    const fields = line.split("\t");

    if (fields.length !== 9) {
      throw new GenotypeError(
        `GTF format requires exactly 9 tab-separated fields, got ${fields.length}`,
        "GTF_FIELD_COUNT_ERROR",
        lineNumber
      );
    }

    const [
      seqname,
      source,
      feature,
      startStr,
      endStr,
      scoreStr,
      strandStr,
      frameStr,
      attributeStr,
    ] = fields;

    // Validate required fields
    if (
      seqname === undefined ||
      seqname === "" ||
      source === undefined ||
      source === "" ||
      feature === undefined ||
      feature === "" ||
      startStr === undefined ||
      startStr === "" ||
      endStr === undefined ||
      endStr === "" ||
      strandStr === undefined ||
      strandStr === ""
    ) {
      throw new GenotypeError("Missing required GTF fields", "GTF_MISSING_FIELDS", lineNumber);
    }

    // Parse coordinates
    const start = this.parseInteger(startStr, "start", lineNumber);
    const end = this.parseInteger(endStr, "end", lineNumber);

    // Validate coordinates
    const coordValidation = validateGtfCoordinates(start, end);
    if (!coordValidation.valid) {
      throw new GenotypeError(coordValidation.error!, "GTF_COORDINATE_ERROR", lineNumber);
    }

    // Parse optional fields
    const score = scoreStr !== undefined && scoreStr !== "" ? parseGtfScore(scoreStr) : null;
    const frame = frameStr !== undefined && frameStr !== "" ? parseGtfFrame(frameStr) : null;

    // Validate strand
    if (validateGtfStrand(strandStr) === false) {
      throw new GenotypeError(
        `Invalid strand '${strandStr}', must be '+', '-', or '.'`,
        "GTF_STRAND_ERROR",
        lineNumber
      );
    }

    // Parse attributes
    const attributes = parseGtfAttributes(attributeStr !== undefined ? attributeStr : "");

    // Check required attributes
    if (this.options.requiredAttributes) {
      for (const required of this.options.requiredAttributes) {
        if (!(required in attributes)) {
          throw new GenotypeError(
            `Required attribute '${required}' not found`,
            "GTF_MISSING_ATTRIBUTE",
            lineNumber
          );
        }
      }
    }

    const gtfFeature: GtfFeature = {
      seqname,
      source,
      feature,
      start,
      end,
      score,
      strand: strandStr as Strand,
      frame,
      attributes,
      length: end - start + 1, // GTF is 1-based inclusive
      ...(this.options.trackLineNumbers && { lineNumber }),
    };

    return gtfFeature;
  }

  /**
   * Parse integer field with validation
   */
  private parseInteger(value: string, fieldName: string, lineNumber: number): number {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      throw new GenotypeError(
        `Invalid ${fieldName}: '${value}' is not a valid integer`,
        "GTF_INVALID_INTEGER",
        lineNumber
      );
    }
    return parsed;
  }

  /**
   * Check if feature should be included based on filters
   */
  private shouldIncludeFeature(feature: GtfFeature): boolean {
    // Check include list
    if (this.options.includeFeatures && this.options.includeFeatures.length > 0) {
      if (!this.options.includeFeatures.includes(feature.feature)) {
        return false;
      }
    }

    // Check exclude list
    if (this.options.excludeFeatures && this.options.excludeFeatures.length > 0) {
      if (this.options.excludeFeatures.includes(feature.feature)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parse GTF features from async iterable of lines
   */
  private async *parseLinesFromAsyncIterable(
    lines: AsyncIterable<string>
  ): AsyncIterable<GtfFeature> {
    let lineNumber = 0;

    try {
      for await (const rawLine of lines) {
        lineNumber++;
        const line = rawLine.trim();

        // Skip empty lines and comments
        if (!line || line.startsWith("#") || line.startsWith("//")) {
          continue;
        }

        // Check line length bounds
        if (line.length > this.options.maxLineLength) {
          this.options.onError(
            `Line too long (${line.length} > ${this.options.maxLineLength})`,
            lineNumber
          );
          continue;
        }

        try {
          const feature = this.parseLine(line, lineNumber);
          if (feature && this.shouldIncludeFeature(feature)) {
            yield feature;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.options.onError(errorMsg, lineNumber);
        }
      }
    } catch (error) {
      throw new GenotypeError(
        `GTF parsing failed at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
        "GTF_PARSE_ERROR",
        lineNumber
      );
    }
  }
}

// =============================================================================
// GTF WRITER CLASS
// =============================================================================

/**
 * GTF writer for outputting features
 */
export class GtfWriter {
  /**
   * Format a single GTF feature as string
   */
  formatFeature(feature: GtfFeature): string {
    const fields: string[] = [
      feature.seqname,
      feature.source,
      feature.feature,
      feature.start.toString(),
      feature.end.toString(),
      feature.score !== null ? feature.score.toString() : ".",
      feature.strand,
      feature.frame !== null ? feature.frame.toString() : ".",
      this.formatAttributes(feature.attributes),
    ];

    return fields.join("\t");
  }

  /**
   * Format attributes object as GTF attribute string
   */
  private formatAttributes(attributes: Record<string, string>): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(attributes)) {
      // Quote values that contain spaces or special characters
      const quotedValue = /[\s;"]/.test(value) ? `"${value}"` : value;
      parts.push(`${key} ${quotedValue}`);
    }

    return parts.join("; ") + (parts.length > 0 ? ";" : "");
  }

  /**
   * Format multiple features as string
   */
  formatFeatures(features: GtfFeature[]): string {
    return features.map((feature) => this.formatFeature(feature)).join("\n");
  }

  /**
   * Write features to a WritableStream
   */
  async writeToStream(
    features: AsyncIterable<GtfFeature>,
    stream: WritableStream<Uint8Array>
  ): Promise<void> {
    const writer = stream.getWriter();
    const encoder = new TextEncoder();

    try {
      for await (const feature of features) {
        const formatted = this.formatFeature(feature) + "\n";
        await writer.write(encoder.encode(formatted));
      }
    } finally {
      writer.releaseLock();
    }
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Detect if string contains GTF format data
 */
export function detectGtfFormat(data: string): boolean {
  const trimmed = data.trim();
  const lines = trimmed.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !line.startsWith("#") && !line.startsWith("//");
  });

  if (lines.length === 0) return false;

  // Check first few data lines
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    const line = lines[i];
    if (line === undefined || line === "") return false;

    const fields = line.split("\t");
    if (fields.length !== 9) return false;

    // Check if coordinates are valid integers
    const start = parseInt(fields[3] !== undefined ? fields[3] : "", 10);
    const end = parseInt(fields[4] !== undefined ? fields[4] : "", 10);
    if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
      return false;
    }

    // Check strand
    const strand = fields[6];
    if (strand === undefined || strand === "" || validateGtfStrand(strand) === false) {
      return false;
    }
  }

  return true;
}

/**
 * Count features in GTF data without parsing
 */
export function countGtfFeatures(data: string): number {
  return data.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#") && !trimmed.startsWith("//");
  }).length;
}

/**
 * Filter features by type
 */
export function filterFeaturesByType(
  features: AsyncIterable<GtfFeature>,
  featureTypes: string[]
): AsyncIterable<GtfFeature> {
  const typeSet = new Set(featureTypes);

  return {
    async *[Symbol.asyncIterator]() {
      for await (const feature of features) {
        if (typeSet.has(feature.feature)) {
          yield feature;
        }
      }
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export const GtfFormat = {
  validateGtfCoordinates,
  parseGtfAttributes,
  validateGtfStrand,
  parseGtfScore,
  parseGtfFrame,
} as const;

export const GtfUtils = {
  detectGtfFormat,
  countGtfFeatures,
  filterFeaturesByType,
} as const;
