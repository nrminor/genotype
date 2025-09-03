/**
 * SAM format parser and writer
 *
 * Handles the complexity of SAM (Sequence Alignment/Map) format:
 * - Header section with @HD, @SQ, @RG, @PG, @CO lines
 * - Alignment section with 11 mandatory fields per line
 * - CIGAR string parsing and validation
 * - FLAG field bitwise operations with type safety
 * - Quality score handling (Phred+33 encoding)
 * - Optional fields (tags) with proper type validation
 * - Streaming architecture for memory efficiency
 */

import { type } from "arktype";
import type {
  SAMAlignment,
  SAMHeader,
  SAMTag,
  SAMFlag,
  CIGARString,
  MAPQScore,
  ParserOptions,
} from "../types";
import {
  SAMAlignmentSchema,
  SAMHeaderSchema,
  SAMFlagSchema,
  CIGAROperationSchema,
  MAPQScoreSchema,
  SAMTagSchema,
} from "../types";
import { SamError, ValidationError } from "../errors";

/**
 * Streaming SAM parser with comprehensive validation
 *
 * Designed for memory efficiency - processes records one at a time
 * without loading entire files into memory. Handles real-world SAM
 * file complexity including malformed headers, invalid CIGAR strings,
 * and incorrect optional tags.
 *
 * @example Basic usage
 * ```typescript
 * const parser = new SAMParser();
 * for await (const record of parser.parseString(samData)) {
 *   if (record.format === 'sam-header') {
 *     console.log(`Header: ${record.type}`);
 *   } else {
 *     console.log(`Alignment: ${record.qname} -> ${record.rname}:${record.pos}`);
 *   }
 * }
 * ```
 *
 * @example With custom options
 * ```typescript
 * const parser = new SAMParser({
 *   skipValidation: false,
 *   trackLineNumbers: true,
 *   onError: (error, lineNumber) => console.error(`Line ${lineNumber}: ${error}`)
 * });
 * ```
 */
export class SAMParser {
  private readonly options: Required<ParserOptions>;

  /**
   * Create a new SAM parser with specified options
   * @param options Parser configuration options
   */
  constructor(options: ParserOptions = {}) {
    // Tiger Style: Assert constructor arguments
    if (typeof options !== "object") {
      throw new ValidationError("options must be an object");
    }
    this.options = {
      skipValidation: false,
      maxLineLength: 10_000_000, // 10MB max line length for long reads
      trackLineNumbers: true,
      qualityEncoding: "phred33",
      parseQualityScores: false,
      onError: (error: string, lineNumber?: number): void => {
        throw new SamError(error, undefined, undefined, lineNumber);
      },
      onWarning: (warning: string, lineNumber?: number): void => {
        console.warn(`SAM Warning (line ${lineNumber}): ${warning}`);
      },
      ...options,
    };
  }

  /**
   * Parse SAM records from a string
   * @param data Raw SAM format string data
   * @yields SAMAlignment or SAMHeader objects as they are parsed from the input
   * @throws {SamError} When SAM format is invalid
   * @throws {ValidationError} When record data is malformed
   */
  async *parseString(data: string): AsyncIterable<SAMAlignment | SAMHeader> {
    // Tiger Style: Assert function arguments
    if (typeof data !== "string") {
      throw new ValidationError("data must be a string");
    }
    const lines = data.split(/\r?\n/);
    yield* this.parseLines(lines);
  }

  /**
   * Parse SAM records from a file using streaming I/O
   * @param filePath Path to SAM file to parse
   * @param options File reading options for performance tuning
   * @yields SAMAlignment or SAMHeader objects as they are parsed from the file
   * @throws {FileError} When file cannot be read
   * @throws {SamError} When SAM format is invalid
   * @throws {ValidationError} When record data is malformed
   * @example
   * ```typescript
   * const parser = new SAMParser();
   * for await (const record of parser.parseFile('/path/to/alignments.sam')) {
   *   if (record.format === 'sam') {
   *     console.log(`${record.qname} -> ${record.rname}:${record.pos}`);
   *   }
   * }
   * ```
   */
  async *parseFile(
    filePath: string,
    options?: import("../types").FileReaderOptions
  ): AsyncIterable<SAMAlignment | SAMHeader> {
    // Tiger Style: Assert function arguments
    if (typeof filePath !== "string") {
      throw new ValidationError("filePath must be a string");
    }
    if (filePath.length === 0) {
      throw new ValidationError("filePath must not be empty");
    }
    if (options && typeof options !== "object") {
      throw new ValidationError("options must be an object if provided");
    }

    // Import I/O modules dynamically to avoid circular dependencies
    const { createStream } = await import("../io/file-reader");
    const { StreamUtils } = await import("../io/stream-utils");

    try {
      // Validate file path and create stream
      const validatedPath = await this.validateFilePath(filePath);
      const stream = await createStream(validatedPath, options);

      // Convert binary stream to lines and parse
      const lines = StreamUtils.readLines(stream, options?.encoding || "utf8");
      yield* this.parseLinesFromAsyncIterable(lines);
    } catch (error) {
      // Re-throw with enhanced context
      if (error instanceof Error) {
        throw new SamError(
          `Failed to parse SAM file '${filePath}': ${error.message}`,
          undefined,
          "file",
          undefined,
          error.stack
        );
      }
      throw error;
    }
  }

  /**
   * Parse SAM records from an iterator of lines
   * @param lines Array of text lines to parse
   * @param startLineNumber Starting line number for error reporting
   * @yields SAMAlignment or SAMHeader objects as they are parsed
   */
  private async *parseLines(
    lines: string[],
    startLineNumber = 1
  ): AsyncIterable<SAMAlignment | SAMHeader> {
    // Tiger Style: Assert function arguments
    if (!Array.isArray(lines)) {
      throw new ValidationError("lines must be an array");
    }
    if (!Number.isInteger(startLineNumber) || startLineNumber < 0) {
      throw new ValidationError("startLineNumber must be non-negative integer");
    }

    for (let i = 0; i < lines.length; i++) {
      const currentLineNumber = startLineNumber + i;
      const line = lines[i]!.trim();

      // Skip empty lines
      if (!line) continue;

      // Check line length bounds
      if (line.length > this.options.maxLineLength) {
        this.options.onError(
          `Line too long (${line.length} > ${this.options.maxLineLength})`,
          currentLineNumber
        );
        continue;
      }

      try {
        if (line.startsWith("@")) {
          // Header line
          yield this.parseHeader(line, currentLineNumber);
        } else {
          // Alignment line
          yield this.parseAlignment(line, currentLineNumber);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.options.onError(errorMsg, currentLineNumber);
      }
    }
  }

  /**
   * Parse SAM header line into header record
   * @param headerLine Raw header line starting with '@'
   * @param lineNumber Line number for error reporting
   * @returns SAMHeader object with validated structure
   */
  private parseHeader(headerLine: string, lineNumber: number): SAMHeader {
    this.validateHeaderInputs(headerLine, lineNumber);
    const { headerType, parts } = this.parseHeaderParts(headerLine, lineNumber);
    const fields = this.parseHeaderFields(parts, headerType, lineNumber, headerLine);
    const header = this.buildHeader(headerType, fields, lineNumber);
    this.validateHeaderResult(header, lineNumber, headerLine);
    this.assertHeaderPostconditions(header, lineNumber, headerLine);
    return header;
  }

  private validateHeaderInputs(headerLine: string, lineNumber: number): void {
    if (typeof headerLine !== "string") {
      throw new ValidationError("headerLine must be a string");
    }
    if (!headerLine.startsWith("@")) {
      throw new ValidationError('headerLine must start with "@"');
    }
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new ValidationError("lineNumber must be positive integer");
    }
  }

  private parseHeaderParts(
    headerLine: string,
    lineNumber: number
  ): {
    headerType: "HD" | "SQ" | "RG" | "PG" | "CO";
    parts: string[];
  } {
    const parts = headerLine.slice(1).split("\t");
    if (parts.length === 0) {
      throw new SamError("Empty header line", undefined, "header", lineNumber, headerLine);
    }

    const headerType = parts[0] as "HD" | "SQ" | "RG" | "PG" | "CO";
    if (!["HD", "SQ", "RG", "PG", "CO"].includes(headerType)) {
      throw new SamError(
        `Invalid header type: ${headerType}`,
        undefined,
        "header",
        lineNumber,
        headerLine
      );
    }

    return { headerType, parts };
  }

  private parseHeaderFields(
    parts: string[],
    headerType: "HD" | "SQ" | "RG" | "PG" | "CO",
    lineNumber: number,
    headerLine: string
  ): Record<string, string> {
    const fields: Record<string, string> = {};

    if (headerType === "CO") {
      fields.comment = parts.slice(1).join("\t");
      return fields;
    }

    for (let i = 1; i < parts.length; i++) {
      const field = parts[i]!;
      const colonIndex = field.indexOf(":");
      if (colonIndex === -1) {
        throw new SamError(
          `Invalid header field format: ${field}`,
          undefined,
          "header",
          lineNumber,
          headerLine
        );
      }

      const key = field.slice(0, colonIndex);
      const value = field.slice(colonIndex + 1);
      fields[key] = value;
    }

    return fields;
  }

  private buildHeader(
    headerType: "HD" | "SQ" | "RG" | "PG" | "CO",
    fields: Record<string, string>,
    lineNumber: number
  ): SAMHeader {
    return {
      format: "sam-header",
      type: headerType,
      fields,
      ...(this.options.trackLineNumbers && { lineNumber }),
    };
  }

  private validateHeaderResult(header: SAMHeader, lineNumber: number, headerLine: string): void {
    if (this.options.skipValidation) {
      return;
    }

    try {
      const validation = SAMHeaderSchema(header);
      if (validation instanceof type.errors) {
        throw new SamError(
          `Invalid SAM header: ${validation.summary}`,
          undefined,
          "header",
          lineNumber,
          headerLine
        );
      }
    } catch (error) {
      if (error instanceof SamError) {
        throw error;
      }
      throw new SamError(
        `Header validation failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "header",
        lineNumber,
        headerLine
      );
    }
  }

  private assertHeaderPostconditions(
    header: SAMHeader,
    lineNumber: number,
    headerLine: string
  ): void {
    if (header.format !== "sam-header") {
      throw new SamError(
        "result format must be sam-header",
        undefined,
        "header",
        lineNumber,
        headerLine
      );
    }
    if (!["HD", "SQ", "RG", "PG", "CO"].includes(header.type)) {
      throw new SamError("header type must be valid", undefined, "header", lineNumber, headerLine);
    }
  }

  /**
   * Parse SAM alignment line into alignment record
   * @param alignmentLine Raw alignment line with 11+ tab-separated fields
   * @param lineNumber Line number for error reporting
   * @returns SAMAlignment object with validated fields
   */
  private parseAlignment(alignmentLine: string, lineNumber: number): SAMAlignment {
    this.validateAlignmentInputs(alignmentLine, lineNumber);
    const fields = this.parseAlignmentFields(alignmentLine, lineNumber);
    const alignment = this.buildAlignmentFromFields(fields, lineNumber);
    this.validateAlignment(alignment, alignmentLine, lineNumber);
    this.assertAlignmentPostconditions(alignment, alignmentLine, lineNumber);
    return alignment;
  }

  private validateAlignmentInputs(alignmentLine: string, lineNumber: number): void {
    if (typeof alignmentLine !== "string") {
      throw new ValidationError("alignmentLine must be a string");
    }
    if (alignmentLine.startsWith("@")) {
      throw new ValidationError('alignmentLine must not start with "@"');
    }
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new ValidationError("lineNumber must be positive integer");
    }
  }

  private parseAlignmentFields(alignmentLine: string, lineNumber: number): string[] {
    const fields = alignmentLine.split("\t");
    if (fields.length < 11) {
      throw new SamError(
        `Insufficient fields: expected 11, got ${fields.length}`,
        fields[0] !== undefined && fields[0] !== null && fields[0] !== "" ? fields[0] : "unknown",
        "alignment",
        lineNumber,
        alignmentLine
      );
    }
    return fields;
  }

  private buildAlignmentFromFields(fields: string[], lineNumber: number): SAMAlignment {
    const qname = fields[0]!;
    const alignmentLine = fields.join("\t");

    // Parse mandatory fields
    const flag = this.parseFlag(fields[1]!, lineNumber);
    const rname = fields[2]!;
    const pos = parseInt(fields[3]!);
    const mapq = this.parseMAPQ(fields[4]!, lineNumber);
    const cigar = this.parseCIGAR(fields[5]!, lineNumber);
    const rnext = fields[6]!;
    const pnext = parseInt(fields[7]!);
    const tlen = parseInt(fields[8]!);
    const seq = fields[9]!;
    const qual = fields[10]!;

    this.validateNumericFields(pos, pnext, tlen, qname, fields, lineNumber, alignmentLine);

    // Parse optional tags
    const tags = fields.length > 11 ? this.parseTags(fields.slice(11), lineNumber) : undefined;

    return {
      format: "sam",
      qname,
      flag,
      rname,
      pos,
      mapq,
      cigar,
      rnext,
      pnext,
      tlen,
      seq,
      qual,
      ...(tags && { tags }),
      ...(this.options.trackLineNumbers && { lineNumber }),
    };
  }

  private validateNumericFields(
    pos: number,
    pnext: number,
    tlen: number,
    qname: string,
    fields: string[],
    lineNumber: number,
    alignmentLine: string
  ): void {
    if (isNaN(pos) || pos < 0) {
      throw new SamError(`Invalid position: ${fields[3]}`, qname, "pos", lineNumber, alignmentLine);
    }
    if (isNaN(pnext) || pnext < 0) {
      throw new SamError(
        `Invalid mate position: ${fields[7]}`,
        qname,
        "pnext",
        lineNumber,
        alignmentLine
      );
    }
    if (isNaN(tlen)) {
      throw new SamError(
        `Invalid template length: ${fields[8]}`,
        qname,
        "tlen",
        lineNumber,
        alignmentLine
      );
    }
  }

  private validateAlignment(
    alignment: SAMAlignment,
    alignmentLine: string,
    lineNumber: number
  ): void {
    if (this.options.skipValidation) {
      return;
    }

    try {
      const validation = SAMAlignmentSchema(alignment);
      if (validation instanceof type.errors) {
        throw new SamError(
          `Invalid SAM alignment: ${validation.summary}`,
          alignment.qname,
          "alignment",
          lineNumber,
          alignmentLine
        );
      }
    } catch (error) {
      if (error instanceof SamError) {
        throw error;
      }
      throw new SamError(
        `Alignment validation failed: ${error instanceof Error ? error.message : String(error)}`,
        alignment.qname,
        "alignment",
        lineNumber,
        alignmentLine
      );
    }
  }

  private assertAlignmentPostconditions(
    alignment: SAMAlignment,
    alignmentLine: string,
    lineNumber: number
  ): void {
    const qname = alignment.qname;

    if (alignment.format !== "sam") {
      throw new SamError(
        "result format must be sam",
        qname,
        "alignment",
        lineNumber,
        alignmentLine
      );
    }
    if (typeof alignment.qname !== "string") {
      throw new SamError("qname must be string", qname, "alignment", lineNumber, alignmentLine);
    }
    if (alignment.pos < 0) {
      throw new SamError(
        "position must be non-negative",
        qname,
        "alignment",
        lineNumber,
        alignmentLine
      );
    }
  }

  /**
   * Parse and validate SAM FLAG field
   * @param flagStr String representation of the flag
   * @param lineNumber Line number for error reporting
   * @returns Validated SAMFlag branded type
   */
  private parseFlag(flagStr: string, lineNumber: number): SAMFlag {
    // Tiger Style: Assert function arguments
    if (typeof flagStr !== "string") {
      throw new ValidationError("flagStr must be a string");
    }
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new ValidationError("lineNumber must be positive integer");
    }

    const flag = parseInt(flagStr);
    if (isNaN(flag)) {
      throw new SamError(`Invalid FLAG: not a number: ${flagStr}`, undefined, "flag", lineNumber);
    }

    const result = SAMFlagSchema(flag);
    if (typeof result === "number") {
      return result;
    } else {
      const errorMessage = Array.isArray(result)
        ? result.map((e) => e.message).join(", ")
        : String(result);
      throw new SamError(`Invalid FLAG: ${errorMessage}`, undefined, "flag", lineNumber);
    }
  }

  /**
   * Parse and validate MAPQ field
   * @param mapqStr String representation of mapping quality
   * @param lineNumber Line number for error reporting
   * @returns Validated MAPQScore branded type
   */
  private parseMAPQ(mapqStr: string, lineNumber: number): MAPQScore {
    // Tiger Style: Assert function arguments
    if (typeof mapqStr !== "string") {
      throw new ValidationError("mapqStr must be a string");
    }
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new ValidationError("lineNumber must be positive integer");
    }

    const mapq = parseInt(mapqStr);
    if (isNaN(mapq)) {
      throw new SamError(`Invalid MAPQ: not a number: ${mapqStr}`, undefined, "mapq", lineNumber);
    }

    const result = MAPQScoreSchema(mapq);
    if (typeof result === "number") {
      return result;
    } else {
      const errorMessage = Array.isArray(result)
        ? result.map((e) => e.message).join(", ")
        : String(result);
      throw new SamError(`Invalid MAPQ: ${errorMessage}`, undefined, "mapq", lineNumber);
    }
  }

  /**
   * Parse and validate CIGAR string
   * @param cigarStr CIGAR string with operations and lengths
   * @param lineNumber Line number for error reporting
   * @returns Validated CIGARString branded type
   */
  private parseCIGAR(cigarStr: string, lineNumber: number): CIGARString {
    // Tiger Style: Assert function arguments
    if (typeof cigarStr !== "string") {
      throw new ValidationError("cigarStr must be a string");
    }
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new ValidationError("lineNumber must be positive integer");
    }

    // Handle special case for unmapped reads
    if (cigarStr === "*") {
      return cigarStr as CIGARString;
    }

    const result = CIGAROperationSchema(cigarStr);
    if (typeof result === "string") {
      return result;
    } else {
      const errorMessage = Array.isArray(result)
        ? result.map((e) => e.message).join(", ")
        : String(result);
      throw new SamError(`Invalid CIGAR: ${errorMessage}`, undefined, "cigar", lineNumber);
    }
  }

  /**
   * Parse optional SAM tags
   * @param tagFields Array of tag field strings in format "TAG:TYPE:VALUE"
   * @param lineNumber Line number for error reporting
   * @returns Array of validated SAMTag objects
   */
  private parseTags(tagFields: string[], lineNumber: number): SAMTag[] {
    this.validateTagInputs(tagFields, lineNumber);

    const tags: SAMTag[] = [];
    for (const tagField of tagFields) {
      if (!tagField) continue;
      const tag = this.parseTagField(tagField, lineNumber);
      tags.push(tag);
    }

    this.assertTagPostconditions(tags, tagFields, lineNumber);
    return tags;
  }

  private validateTagInputs(tagFields: string[], lineNumber: number): void {
    if (!Array.isArray(tagFields)) {
      throw new ValidationError("tagFields must be an array");
    }
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new ValidationError("lineNumber must be positive integer");
    }
  }

  private parseTagField(tagField: string, lineNumber: number): SAMTag {
    const parts = tagField.split(":");
    if (parts.length < 3) {
      throw new SamError(
        `Invalid tag format: ${tagField} (expected TAG:TYPE:VALUE)`,
        undefined,
        "tag",
        lineNumber
      );
    }

    const tag = parts[0];
    const type = (parts[1] ?? "") as "A" | "i" | "f" | "Z" | "H" | "B";
    const valueStr = parts.slice(2).join(":"); // Rejoin in case value contains colons

    const value = this.parseTagValue(type, valueStr, tag, lineNumber);
    const samTag: SAMTag = {
      tag: tag ?? "",
      type: type as "A" | "i" | "f" | "Z" | "H" | "B",
      value,
    };

    this.validateTag(samTag, lineNumber);
    return samTag;
  }

  private parseTagValue(
    type: "A" | "i" | "f" | "Z" | "H" | "B",
    valueStr: string,
    tag: string | undefined,
    lineNumber: number
  ): string | number {
    try {
      switch (type) {
        case "A":
        case "Z":
        case "H":
        case "B":
          return valueStr;
        case "i": {
          const value = parseInt(valueStr);
          if (isNaN(value)) {
            throw new Error(`Invalid integer value: ${valueStr}`);
          }
          return value;
        }
        case "f": {
          const value = parseFloat(valueStr);
          if (isNaN(value)) {
            throw new Error(`Invalid float value: ${valueStr}`);
          }
          return value;
        }
        default:
          throw new Error(`Unsupported tag type: ${type}`);
      }
    } catch (error) {
      throw new SamError(
        `Invalid tag value for ${tag}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "tag",
        lineNumber
      );
    }
  }

  private validateTag(samTag: SAMTag, lineNumber: number): void {
    if (this.options.skipValidation) {
      return;
    }

    if (samTag.tag.length !== 2 || !/^[A-Za-z0-9]{2}$/.test(samTag.tag)) {
      throw new SamError(
        `SAM tag must be 2 alphanumeric characters: ${samTag.tag}`,
        undefined,
        "tag",
        lineNumber
      );
    }
  }

  private assertTagPostconditions(tags: SAMTag[], tagFields: string[], lineNumber: number): void {
    if (!Array.isArray(tags)) {
      throw new SamError("result must be an array", undefined, "tag", lineNumber);
    }
    if (tags.length > tagFields.length) {
      throw new SamError(
        "result length must not exceed input length",
        undefined,
        "tag",
        lineNumber
      );
    }
  }

  /**
   * Validate file path and ensure it's accessible for reading
   * @param filePath Raw file path from user input
   * @returns Promise resolving to validated file path
   * @throws {SamError} If file path is invalid or file is not accessible
   */
  private async validateFilePath(filePath: string): Promise<string> {
    // Tiger Style: Assert function arguments
    if (typeof filePath !== "string") {
      throw new ValidationError("filePath must be a string");
    }
    if (filePath.length === 0) {
      throw new ValidationError("filePath must not be empty");
    }

    // Import FileReader functions dynamically to avoid circular dependencies
    const { exists, getMetadata } = await import("../io/file-reader");

    // Check if file exists and is readable
    if (!(await exists(filePath))) {
      throw new SamError(
        `SAM file not found or not accessible: ${filePath}`,
        undefined,
        "file",
        undefined,
        "Please check that the file exists and you have read permissions"
      );
    }

    // Get file metadata for additional validation
    try {
      const metadata = await getMetadata(filePath);

      if (!metadata.readable) {
        throw new SamError(
          `SAM file is not readable: ${filePath}`,
          undefined,
          "file",
          undefined,
          "Check file permissions"
        );
      }

      // Warn about very large files
      if (metadata.size > 2_147_483_648) {
        // 2GB
        this.options.onWarning(
          `Large SAM file detected: ${Math.round(metadata.size / 1_048_576)}MB. Consider using BAM format for better performance.`,
          1
        );
      }
    } catch (error) {
      if (error instanceof SamError) throw error;
      throw new SamError(
        `Failed to validate SAM file: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "file",
        undefined,
        filePath
      );
    }

    return filePath;
  }

  /**
   * Parse SAM records from async iterable of lines
   * @param lines Async iterable of text lines
   * @yields SAMAlignment or SAMHeader objects as they are parsed
   */
  private async *parseLinesFromAsyncIterable(
    lines: AsyncIterable<string>
  ): AsyncIterable<SAMAlignment | SAMHeader> {
    // Tiger Style: Assert function arguments
    if (typeof lines !== "object" || !(Symbol.asyncIterator in lines)) {
      throw new ValidationError("lines must be async iterable");
    }

    let lineNumber = 0;

    try {
      for await (const rawLine of lines) {
        lineNumber++;
        const line = rawLine.trim();

        // Skip empty lines
        if (!line) continue;

        // Check line length bounds
        if (line.length > this.options.maxLineLength) {
          this.options.onError(
            `Line too long (${line.length} > ${this.options.maxLineLength})`,
            lineNumber
          );
          continue;
        }

        try {
          if (line.startsWith("@")) {
            // Header line
            yield this.parseHeader(line, lineNumber);
          } else {
            // Alignment line
            yield this.parseAlignment(line, lineNumber);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.options.onError(errorMsg, lineNumber);
        }
      }
    } catch (error) {
      // Enhance error with line number context
      if (error instanceof SamError) {
        throw error;
      }

      throw new SamError(
        `SAM parsing failed at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "parsing",
        lineNumber,
        "Check file format and content"
      );
    }

    // Tiger Style: Assert postconditions
    if (lineNumber < 0) {
      throw new SamError("line number must be non-negative", undefined, "parsing", lineNumber);
    }
  }
}

/**
 * SAM writer for outputting alignments and headers
 *
 * Designed to complement the SAMParser with full format compliance.
 * Handles all SAM format requirements including header validation,
 * alignment field formatting, CIGAR string validation, and optional
 * tag serialization.
 *
 * @example Basic usage
 * ```typescript
 * const writer = new SAMWriter();
 * const samString = writer.writeString([header1, alignment1, alignment2]);
 * console.log(samString);
 * ```
 *
 * @example Writing to file
 * ```typescript
 * const writer = new SAMWriter({ validate: true });
 * await writer.writeFile('/path/to/output.sam', [header, ...alignments]);
 * ```
 *
 * @example Streaming output
 * ```typescript
 * const writer = new SAMWriter();
 * const stream = new WritableStream({...});
 * await writer.writeStream(stream, async function*() {
 *   yield header;
 *   for (const alignment of alignments) {
 *     yield alignment;
 *   }
 * }());
 * ```
 */
export class SAMWriter {
  private readonly options: {
    validate: boolean;
    includeLineNumbers: boolean;
    onError: (error: string, record?: SAMAlignment | SAMHeader) => void;
    onWarning: (warning: string, record?: SAMAlignment | SAMHeader) => void;
  };

  /**
   * Create a new SAM writer with specified options
   * @param options Writer configuration options
   */
  constructor(
    options: {
      /** Validate records before writing (default: true) */
      validate?: boolean;
      /** Include line numbers in error reporting (default: true) */
      includeLineNumbers?: boolean;
      /** Custom error handler */
      onError?: (error: string, record?: SAMAlignment | SAMHeader) => void;
      /** Custom warning handler */
      onWarning?: (warning: string, record?: SAMAlignment | SAMHeader) => void;
    } = {}
  ) {
    // Tiger Style: Assert constructor arguments
    if (typeof options !== "object") {
      throw new ValidationError("options must be an object");
    }

    this.options = {
      validate: options.validate ?? true,
      includeLineNumbers: options.includeLineNumbers ?? true,
      onError:
        options.onError ||
        ((error: string, record?: SAMAlignment | SAMHeader): void => {
          const recordInfo = record
            ? (record as any).format === "sam"
              ? (record as SAMAlignment).qname
              : (record as SAMHeader).type
            : "unknown";
          throw new SamError(error, recordInfo, undefined, record?.lineNumber);
        }),
      onWarning:
        options.onWarning ||
        ((warning: string, record?: SAMAlignment | SAMHeader): void => {
          const recordInfo = record
            ? (record as any).format === "sam"
              ? (record as SAMAlignment).qname
              : (record as SAMHeader).type
            : "unknown";
          console.warn(`SAM Writer Warning: ${warning} (record: ${recordInfo})`);
        }),
    };
  }

  /**
   * Write SAM records to string format
   * @param records Array of SAM headers and alignments to write
   * @returns Formatted SAM string with proper line separators
   * @throws {SamError} When records are invalid or formatting fails
   *
   * @example
   * ```typescript
   * const writer = new SAMWriter();
   * const records = [header, alignment1, alignment2];
   * const samData = writer.writeString(records);
   * ```
   */
  writeString(records: Array<SAMAlignment | SAMHeader>): string {
    // Tiger Style: Assert function arguments
    if (!Array.isArray(records)) {
      throw new ValidationError("records must be an array");
    }

    const lines: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      try {
        if (record && record.format === "sam-header") {
          lines.push(this.formatHeader(record as SAMHeader));
        } else if (record && record.format === "sam") {
          lines.push(this.formatAlignment(record as SAMAlignment));
        } else {
          this.options.onError(`Invalid record format: ${(record as any).format}`, record);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.options.onError(`Failed to format record ${i}: ${errorMsg}`, record);
      }
    }

    // Tiger Style: Assert postconditions
    if (lines.length > records.length) {
      throw new SamError("output lines should not exceed input records", undefined, "writing");
    }

    return lines.join("\n");
  }

  /**
   * Write SAM records to file using Bun's native file I/O
   * @param filePath Path where SAM file should be written
   * @param records Array of SAM headers and alignments to write
   * @param options File writing options
   * @throws {SamError} When file cannot be written or records are invalid
   *
   * @example
   * ```typescript
   * const writer = new SAMWriter();
   * await writer.writeFile('/path/to/output.sam', [header, ...alignments]);
   * ```
   */
  async writeFile(
    filePath: string,
    records: Array<SAMAlignment | SAMHeader>,
    options?: { encoding?: "utf8" | "binary"; mode?: number }
  ): Promise<void> {
    // Tiger Style: Assert function arguments
    if (typeof filePath !== "string") {
      throw new ValidationError("filePath must be a string");
    }
    if (filePath.length === 0) {
      throw new ValidationError("filePath must not be empty");
    }
    if (!Array.isArray(records)) {
      throw new ValidationError("records must be an array");
    }
    if (options && typeof options !== "object") {
      throw new ValidationError("options must be an object if provided");
    }

    try {
      const samData = this.writeString(records);

      // Use Bun's native file writing
      await Bun.write(filePath, samData);
    } catch (error) {
      throw new SamError(
        `Failed to write SAM file '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "file",
        undefined,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Write SAM records to a WritableStream
   * @param stream WritableStream to write formatted SAM data to
   * @param records Async iterable of SAM headers and alignments
   * @throws {SamError} When stream writing fails or records are invalid
   *
   * @example
   * ```typescript
   * const writer = new SAMWriter();
   * const stream = new WritableStream({...});
   * await writer.writeStream(stream, async function*() {
   *   yield header;
   *   for (const alignment of alignments) {
   *     yield alignment;
   *   }
   * }());
   * ```
   */
  async writeStream(
    stream: WritableStream<Uint8Array>,
    records: AsyncIterable<SAMAlignment | SAMHeader>
  ): Promise<void> {
    // Tiger Style: Assert function arguments
    if (!(stream instanceof WritableStream)) {
      throw new ValidationError("stream must be a WritableStream");
    }
    if (typeof records !== "object" || !(Symbol.asyncIterator in records)) {
      throw new ValidationError("records must be async iterable");
    }

    const writer = stream.getWriter();
    const encoder = new TextEncoder();

    try {
      for await (const record of records) {
        let formattedLine: string;

        try {
          if (record.format === "sam-header") {
            formattedLine = this.formatHeader(record);
          } else if (record.format === "sam") {
            formattedLine = this.formatAlignment(record);
          } else {
            this.options.onError(`Invalid record format: ${(record as any).format}`, record);
            continue;
          }

          await writer.write(encoder.encode(formattedLine + "\n"));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.options.onError(`Failed to format record: ${errorMsg}`, record);
        }
      }
    } finally {
      writer.releaseLock();
    }
  }

  /**
   * Format SAM header record to string
   * @param header SAMHeader object to format
   * @returns Formatted header line starting with '@'
   * @throws {SamError} When header is invalid
   */
  private formatHeader(header: SAMHeader): string {
    // Tiger Style: Assert function arguments
    if (header === null || typeof header !== "object") {
      throw new ValidationError("header must be an object");
    }
    if (header.format !== "sam-header") {
      throw new ValidationError("header format must be sam-header");
    }

    // Validate header if validation is enabled
    if (this.options.validate) {
      try {
        const validation = SAMHeaderSchema(header);
        if (validation instanceof type.errors) {
          throw new SamError(
            `Invalid SAM header: ${validation.summary}`,
            undefined,
            "header",
            header.lineNumber
          );
        }
      } catch (error) {
        if (error instanceof SamError) {
          throw error;
        }
        throw new SamError(
          `Header validation failed: ${error instanceof Error ? error.message : String(error)}`,
          undefined,
          "header",
          header.lineNumber
        );
      }
    }

    let line = `@${header.type}`;

    // Format fields based on header type
    if (header.type === "CO") {
      // Comment headers store the entire comment in fields.comment
      if (
        header.fields.comment !== undefined &&
        header.fields.comment !== null &&
        header.fields.comment !== ""
      ) {
        line += `\t${header.fields.comment}`;
      }
    } else {
      // Other headers have key:value pairs
      for (const [key, value] of Object.entries(header.fields)) {
        if (value !== undefined && value !== "") {
          line += `\t${key}:${value}`;
        }
      }
    }

    // Tiger Style: Assert postconditions
    if (!line.startsWith("@")) {
      throw new SamError(
        "formatted header must start with @",
        undefined,
        "header",
        header.lineNumber
      );
    }
    if (!line.includes(header.type)) {
      throw new SamError(
        "formatted header must include type",
        undefined,
        "header",
        header.lineNumber
      );
    }

    return line;
  }

  /**
   * Format SAM alignment record to string
   * @param alignment SAMAlignment object to format
   * @returns Formatted alignment line with tab-separated fields
   * @throws {SamError} When alignment is invalid
   */
  private formatAlignment(alignment: SAMAlignment): string {
    // Tiger Style: Assert function arguments
    if (alignment === null || typeof alignment !== "object") {
      throw new ValidationError("alignment must be an object");
    }
    if (alignment.format !== "sam") {
      throw new ValidationError("alignment format must be sam");
    }

    // Validate alignment if validation is enabled
    if (this.options.validate) {
      try {
        const validation = SAMAlignmentSchema(alignment);
        if (validation instanceof type.errors) {
          throw new SamError(
            `Invalid SAM alignment: ${validation.summary}`,
            alignment.qname,
            "alignment",
            alignment.lineNumber
          );
        }
      } catch (error) {
        if (error instanceof SamError) {
          throw error;
        }
        throw new SamError(
          `Alignment validation failed: ${error instanceof Error ? error.message : String(error)}`,
          alignment.qname,
          "alignment",
          alignment.lineNumber
        );
      }
    }

    // Format the 11 mandatory fields
    const fields = [
      alignment.qname,
      alignment.flag.toString(),
      alignment.rname,
      alignment.pos.toString(),
      alignment.mapq.toString(),
      alignment.cigar,
      alignment.rnext,
      alignment.pnext.toString(),
      alignment.tlen.toString(),
      alignment.seq,
      alignment.qual,
    ];

    // Add optional tags if present
    if (alignment.tags && alignment.tags.length > 0) {
      for (const tag of alignment.tags) {
        const formattedTag = this.formatTag(tag);
        fields.push(formattedTag);
      }
    }

    const line = fields.join("\t");

    // Tiger Style: Assert postconditions
    if (fields.length < 11) {
      throw new SamError(
        "formatted alignment must have at least 11 fields",
        alignment.qname,
        "alignment",
        alignment.lineNumber
      );
    }
    if (line.startsWith("@")) {
      throw new SamError(
        "formatted alignment must not start with @",
        alignment.qname,
        "alignment",
        alignment.lineNumber
      );
    }
    if (!line.includes("\t")) {
      throw new SamError(
        "formatted alignment must contain tabs",
        alignment.qname,
        "alignment",
        alignment.lineNumber
      );
    }

    return line;
  }

  /**
   * Format SAM optional tag to string
   * @param tag SAMTag object to format
   * @returns Formatted tag string in TAG:TYPE:VALUE format
   * @throws {SamError} When tag is invalid
   */
  private formatTag(tag: SAMTag): string {
    // Tiger Style: Assert function arguments
    if (tag === null || typeof tag !== "object") {
      throw new ValidationError("tag must be an object");
    }
    if (typeof tag.tag !== "string") {
      throw new ValidationError("tag.tag must be a string");
    }
    if (typeof tag.type !== "string") {
      throw new ValidationError("tag.type must be a string");
    }

    // Validate tag if validation is enabled
    if (this.options.validate) {
      try {
        const validation = SAMTagSchema(tag);
        if (validation instanceof type.errors) {
          throw new SamError(`Invalid SAM tag: ${validation.summary}`, undefined, "tag");
        }
      } catch (error) {
        if (error instanceof SamError) {
          throw error;
        }
        throw new SamError(
          `Tag validation failed: ${error instanceof Error ? error.message : String(error)}`,
          undefined,
          "tag"
        );
      }
    }

    // Format value based on type
    let formattedValue: string;
    switch (tag.type) {
      case "A":
        formattedValue = String(tag.value);
        break;
      case "i":
        formattedValue = String(tag.value);
        break;
      case "f":
        formattedValue = String(tag.value);
        break;
      case "Z":
      case "H":
      case "B":
        formattedValue = String(tag.value);
        break;
      default:
        throw new SamError(`Unsupported tag type: ${tag.type}`, undefined, "tag");
    }

    const formatted = `${tag.tag}:${tag.type}:${formattedValue}`;

    // Tiger Style: Assert postconditions
    if (!formatted.includes(":")) {
      throw new SamError("formatted tag must contain colons", undefined, "tag");
    }
    if (!formatted.startsWith(tag.tag)) {
      throw new SamError("formatted tag must start with tag name", undefined, "tag");
    }

    return formatted;
  }
}

/**
 * SAM utility functions for format detection and operations
 */
export const SAMUtils = {
  /**
   * Detect if string contains SAM format data
   */
  detectFormat(data: string): boolean {
    const trimmed = data.trim();
    const lines = trimmed.split(/\r?\n/);

    // Check for SAM header lines
    if (lines.some((line) => /^@(HD|SQ|RG|PG|CO)\t/.test(line))) {
      return true;
    }

    // Check for SAM alignment lines (must have exactly 11 or more tab-separated fields)
    return lines.some((line) => {
      if (line.startsWith("@")) return false;
      const fields = line.split("\t");
      return (
        fields.length >= 11 &&
        /^\d+$/.test(fields[1] ?? "") && // FLAG must be numeric
        /^\d+$/.test(fields[3] ?? "") && // POS must be numeric
        /^\d+$/.test(fields[4] ?? "")
      ); // MAPQ must be numeric
    });
  },

  /**
   * Decode SAM flag into human-readable components
   */
  decodeFlag(flag: number): {
    isPaired: boolean;
    isProperPair: boolean;
    isUnmapped: boolean;
    isMateUnmapped: boolean;
    isReverse: boolean;
    isMateReverse: boolean;
    isFirstInPair: boolean;
    isSecondInPair: boolean;
    isSecondary: boolean;
    isQCFail: boolean;
    isDuplicate: boolean;
    isSupplementary: boolean;
  } {
    return {
      isPaired: (flag & 0x1) !== 0,
      isProperPair: (flag & 0x2) !== 0,
      isUnmapped: (flag & 0x4) !== 0,
      isMateUnmapped: (flag & 0x8) !== 0,
      isReverse: (flag & 0x10) !== 0,
      isMateReverse: (flag & 0x20) !== 0,
      isFirstInPair: (flag & 0x40) !== 0,
      isSecondInPair: (flag & 0x80) !== 0,
      isSecondary: (flag & 0x100) !== 0,
      isQCFail: (flag & 0x200) !== 0,
      isDuplicate: (flag & 0x400) !== 0,
      isSupplementary: (flag & 0x800) !== 0,
    };
  },

  /**
   * Parse CIGAR string into operations
   */
  parseCIGAROperations(cigar: string): Array<{ operation: string; length: number }> {
    if (cigar === "*") return [];

    const operations = cigar.match(/\d+[MIDNSHPX=]/g) || [];
    return operations.map((op) => ({
      operation: op.slice(-1),
      length: parseInt(op.slice(0, -1)),
    }));
  },

  /**
   * Calculate alignment span on reference
   */
  calculateReferenceSpan(cigar: string): number {
    if (cigar === "*") return 0;

    const operations = this.parseCIGAROperations(cigar);
    return operations
      .filter((op) => "MDN=X".includes(op.operation))
      .reduce((sum, op) => sum + op.length, 0);
  },
};
