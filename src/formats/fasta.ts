/**
 * FASTA format parser and writer
 *
 * Handles the messiness of real-world FASTA files:
 * - Multiple sequence formats
 * - Wrapped and unwrapped sequences
 * - Missing or malformed headers
 * - Mixed case sequences
 * - IUPAC ambiguity codes
 * - Comments and blank lines
 */

import { type } from "arktype";
import {
  FileError,
  getErrorSuggestion,
  ParseError,
  SequenceError,
  ValidationError,
} from "../errors";
import type { FastaSequence, ParserOptions } from "../types";
import { FastaSequenceSchema, SequenceIdSchema, SequenceSchema } from "../types";

/**
 * Streaming FASTA parser with comprehensive validation
 *
 * Designed for memory efficiency - processes sequences one at a time
 * without loading entire files into memory. Handles real-world FASTA
 * file messiness including wrapped sequences, comments, and malformed headers.
 *
 * @example Basic usage
 * ```typescript
 * const parser = new FastaParser();
 * for await (const sequence of parser.parseString(fastaData)) {
 *   console.log(`${sequence.id}: ${sequence.length} bp`);
 * }
 * ```
 *
 * @example With custom options
 * ```typescript
 * const parser = new FastaParser({
 *   skipValidation: false,
 *   maxLineLength: 1000000,
 *   onError: (error, lineNumber) => console.error(`Line ${lineNumber}: ${error}`)
 * });
 * ```
 */
export class FastaParser {
  private readonly options: Required<ParserOptions>;

  /**
   * Create a new FASTA parser with specified options
   * @param options Parser configuration options
   */
  constructor(options: ParserOptions = {}) {
    if (typeof options !== "object") {
      throw new ValidationError("options must be an object");
    }
    this.options = {
      skipValidation: false,
      maxLineLength: 1_000_000, // 1MB max line length
      trackLineNumbers: true,
      qualityEncoding: "phred33", // Not used for FASTA
      parseQualityScores: false, // Not used for FASTA
      onError: (error: string, lineNumber?: number): void => {
        throw new ParseError(error, "FASTA", lineNumber);
      },
      onWarning: (warning: string, lineNumber?: number): void => {
        console.warn(`FASTA Warning (line ${lineNumber}): ${warning}`);
      },
      ...options,
    };
  }

  /**
   * Parse FASTA sequences from a string
   * @param data Raw FASTA format string data
   * @yields FastaSequence objects as they are parsed from the input
   * @throws {ParseError} When FASTA format is invalid
   * @throws {SequenceError} When sequence data is malformed
   * @example
   * ```typescript
   * const fastaData = '>seq1\nATCG\n>seq2\nGGGG';
   * for await (const sequence of parser.parseString(fastaData)) {
   *   console.log(`${sequence.id}: ${sequence.sequence}`);
   * }
   * ```
   */
  async *parseString(data: string): AsyncIterable<FastaSequence> {
    if (typeof data !== "string") {
      throw new ValidationError("data must be a string");
    }
    const lines = data.split(/\r?\n/);
    yield* this.parseLines(lines);
  }

  /**
   * Parse FASTA sequences from a file using streaming I/O
   * @param filePath Path to FASTA file to parse
   * @param options File reading options for performance tuning
   * @yields FastaSequence objects as they are parsed from the file
   * @throws {FileError} When file cannot be read
   * @throws {ParseError} When FASTA format is invalid
   * @throws {SequenceError} When sequence data is malformed
   * @example
   * ```typescript
   * const parser = new FastaParser();
   * for await (const sequence of parser.parseFile('/path/to/genome.fasta')) {
   *   console.log(`${sequence.id}: ${sequence.length} bp`);
   * }
   * ```
   */
  async *parseFile(
    filePath: string,
    options?: import("../types").FileReaderOptions
  ): AsyncIterable<FastaSequence> {
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
      // Re-throw file errors unchanged to preserve error type
      if (error instanceof FileError) {
        throw error;
      }
      // Re-throw with enhanced context for parsing errors
      if (error instanceof Error) {
        throw new ParseError(
          `Failed to parse FASTA file '${filePath}': ${error.message}`,
          "FASTA",
          undefined,
          error.stack
        );
      }
      throw error;
    }
  }

  /**
   * Parse FASTA sequences from a ReadableStream
   * @param stream Stream of binary data containing FASTA format text
   * @yields FastaSequence objects as they are parsed from the stream
   * @throws {ParseError} When FASTA format is invalid
   * @throws {SequenceError} When sequence data is malformed
   * @example
   * ```typescript
   * const response = await fetch('genome.fasta');
   * for await (const sequence of parser.parse(response.body!)) {
   *   console.log(`Processing ${sequence.id}...`);
   * }
   * ```
   */
  async *parse(stream: ReadableStream<Uint8Array>): AsyncIterable<FastaSequence> {
    // Tiger Style: Assert function arguments
    if (!(stream instanceof ReadableStream)) {
      throw new ValidationError("stream must be a ReadableStream");
    }
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lineNumber = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            const lines = buffer.split(/\r?\n/);
            yield* this.parseLines(lines, lineNumber);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split(/\r?\n/);
        const lastLine = lines.pop();
        buffer = lastLine !== null && lastLine !== undefined ? lastLine : ""; // Keep incomplete line in buffer

        if (lines.length > 0) {
          yield* this.parseLines(lines, lineNumber);
          lineNumber += lines.length;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse FASTA sequences from an iterator of lines
   * @param lines Array of text lines to parse
   * @param startLineNumber Starting line number for error reporting
   * @yields FastaSequence objects as they are parsed
   */
  private async *parseLines(lines: string[], startLineNumber = 1): AsyncIterable<FastaSequence> {
    if (!Array.isArray(lines)) {
      throw new ValidationError("lines must be an array");
    }
    if (!Number.isInteger(startLineNumber) || startLineNumber < 0) {
      throw new ValidationError("startLineNumber must be non-negative integer");
    }

    let currentSequence: Partial<FastaSequence> | null = null;
    let sequenceBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const currentLineNumber = startLineNumber + i;

      try {
        const processedLine = this.processLine(lines[i] ?? "", currentLineNumber);

        if (!processedLine) continue; // Skip empty/comment lines

        if (processedLine.isHeader) {
          // Yield previous sequence if exists
          if (currentSequence) {
            yield this.finalizeSequence(currentSequence, sequenceBuffer, currentLineNumber - 1);
          }

          currentSequence = processedLine.headerData ?? null;
          sequenceBuffer = [];
        } else {
          // Handle sequence data
          this.processSequenceData(
            processedLine.sequenceData!,
            currentSequence,
            sequenceBuffer,
            currentLineNumber
          );
        }
      } catch (error) {
        // Call error handler for parsing errors
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.options.onError(errorMessage, currentLineNumber);
      }
    }

    // Yield final sequence
    if (currentSequence && sequenceBuffer.length > 0) {
      yield this.finalizeSequence(
        currentSequence,
        sequenceBuffer,
        startLineNumber + lines.length - 1
      );
    }
  }

  /**
   * Process a single line and determine its type and content
   * @param line Raw line text
   * @param lineNumber Line number for error reporting
   * @returns Processed line data or null if line should be skipped
   */
  private processLine(
    line: string,
    lineNumber: number
  ): {
    isHeader: boolean;
    headerData?: Partial<FastaSequence>;
    sequenceData?: string;
  } | null {
    // Tiger Style: Assert function arguments
    if (typeof line !== "string") {
      throw new ValidationError("line must be a string");
    }
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new ValidationError("lineNumber must be positive integer");
    }

    // Check line length bounds
    if (line.length > this.options.maxLineLength) {
      this.options.onError(
        `Line too long (${line.length} > ${this.options.maxLineLength})`,
        lineNumber
      );
      return null;
    }

    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith(";")) {
      return null;
    }

    // Header line
    if (trimmedLine.startsWith(">")) {
      return {
        isHeader: true,
        headerData: this.parseHeader(trimmedLine, lineNumber),
      };
    }

    // Sequence line
    const cleanedSequence = this.cleanSequence(trimmedLine, lineNumber);
    return cleanedSequence
      ? {
          isHeader: false,
          sequenceData: cleanedSequence,
        }
      : null;
  }

  /**
   * Process sequence data line and update current sequence state
   * @param sequenceData Cleaned sequence data
   * @param currentSequence Current sequence being built
   * @param sequenceBuffer Buffer of sequence parts
   * @param lineNumber Line number for error reporting
   */
  private processSequenceData(
    sequenceData: string,
    currentSequence: Partial<FastaSequence> | null,
    sequenceBuffer: string[],
    lineNumber: number
  ): void {
    // Tiger Style: Assert function arguments and preconditions
    if (typeof sequenceData !== "string") {
      throw new ValidationError("sequenceData must be a string");
    }
    if (!Array.isArray(sequenceBuffer)) {
      throw new ValidationError("sequenceBuffer must be an array");
    }
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new ValidationError("lineNumber must be positive integer");
    }

    if (!currentSequence) {
      this.options.onError("Sequence data found before header", lineNumber);
      return;
    }

    sequenceBuffer.push(sequenceData);

    // Tiger Style: Assert postcondition
    if (sequenceBuffer.length === 0) {
      throw new SequenceError(
        "sequenceBuffer should contain data after processing",
        "unknown",
        lineNumber
      );
    }
  }

  /**
   * Parse FASTA header line into sequence metadata
   * @param headerLine Raw header line starting with '>'
   * @param lineNumber Line number for error reporting
   * @returns Partial sequence object with ID and description
   */
  private parseHeader(headerLine: string, lineNumber: number): Partial<FastaSequence> {
    this.validateHeaderInputs(headerLine, lineNumber);

    const header = headerLine.slice(1); // Remove '>'
    if (!header) {
      if (this.options.skipValidation) {
        this.options.onWarning("Empty FASTA header", lineNumber);
      } else {
        throw new ParseError(
          'Empty FASTA header: header must contain an identifier after ">"',
          "FASTA",
          lineNumber,
          headerLine
        );
      }
    }

    const { id, description } = this.extractIdAndDescription(header);
    this.validateSequenceId(id, lineNumber, headerLine);

    return this.buildHeaderResult(id, description, lineNumber);
  }

  private validateHeaderInputs(headerLine: string, lineNumber: number): void {
    if (typeof headerLine !== "string") {
      throw new ValidationError("headerLine must be a string");
    }
    if (!headerLine.startsWith(">")) {
      throw new ValidationError('headerLine must start with ">"');
    }
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new ValidationError("lineNumber must be positive integer");
    }
  }

  private extractIdAndDescription(header: string): {
    id: string;
    description?: string;
  } {
    const firstSpace = header.search(/\s/);
    const id = firstSpace === -1 ? header : header.slice(0, firstSpace);
    const description = firstSpace === -1 ? undefined : header.slice(firstSpace + 1).trim();

    if (description === undefined) {
      return { id };
    }
    return { id, description };
  }

  private validateSequenceId(id: string, lineNumber: number, headerLine: string): void {
    if (this.options.skipValidation || !id) return;

    try {
      const idValidation = SequenceIdSchema(id);
      if (idValidation instanceof type.errors) {
        throw new SequenceError(
          `Invalid sequence ID: ${idValidation.summary}`,
          id,
          lineNumber,
          headerLine
        );
      }
    } catch (error) {
      if (error instanceof SequenceError) {
        throw error;
      }
      this.options.onWarning(
        `Sequence ID validation warning: ${error instanceof Error ? error.message : String(error)}`,
        lineNumber
      );
    }
  }

  private buildHeaderResult(
    id: string,
    description: string | undefined,
    lineNumber: number
  ): Partial<FastaSequence> {
    const result = {
      format: "fasta" as const,
      id,
      description:
        description !== null && description !== undefined && description !== ""
          ? description
          : undefined,
      lineNumber: this.options.trackLineNumbers ? lineNumber : undefined,
    };

    // Tiger Style: Assert postconditions
    if (result.format !== "fasta") {
      throw new SequenceError("result format must be fasta", result.id || "unknown", lineNumber);
    }
    if (typeof result.id !== "string") {
      throw new SequenceError("result id must be a string", result.id || "unknown", lineNumber);
    }

    return {
      format: "fasta",
      id: result.id !== null && result.id !== undefined && result.id !== "" ? result.id : "",
      ...(result.description !== null &&
        result.description !== undefined &&
        result.description !== "" && { description: result.description }),
      ...(result.lineNumber !== null &&
        result.lineNumber !== undefined &&
        result.lineNumber !== 0 && { lineNumber: result.lineNumber }),
    };
  }

  /**
   * Clean and validate sequence data, removing whitespace and validating characters
   * @param sequenceLine Raw sequence line from input
   * @param lineNumber Line number for error reporting
   * @returns Cleaned sequence string with whitespace removed
   */
  private cleanSequence(sequenceLine: string, lineNumber: number): string {
    // Tiger Style: Assert function arguments
    if (typeof sequenceLine !== "string") {
      throw new ValidationError("sequenceLine must be a string");
    }
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new ValidationError("lineNumber must be positive integer");
    }
    // Remove whitespace
    const cleaned = sequenceLine.replace(/\s/g, "");

    if (!cleaned) {
      return "";
    }

    // Validate sequence if not skipping validation
    if (!this.options.skipValidation) {
      const validation = SequenceSchema(cleaned);
      if (validation instanceof type.errors) {
        const suggestion = getErrorSuggestion(
          new ValidationError(`Invalid sequence characters: ${validation.summary}`)
        );

        throw new SequenceError(
          `Invalid sequence characters found. ${suggestion}`,
          "unknown",
          lineNumber,
          sequenceLine
        );
      }
    }

    // Tiger Style: Assert postconditions
    if (typeof cleaned !== "string") {
      throw new SequenceError("cleaned result must be a string", "unknown", lineNumber);
    }
    if (cleaned.includes(" ") || cleaned.includes("\t")) {
      throw new SequenceError("cleaned result must not contain whitespace", "unknown", lineNumber);
    }

    return cleaned;
  }

  /**
   * Finalize sequence object with complete data and validation
   * @param partialSequence Partial sequence data from header parsing
   * @param sequenceBuffer Array of sequence parts to concatenate
   * @param lineNumber Final line number for error reporting
   * @returns Complete validated FastaSequence object
   */
  private finalizeSequence(
    partialSequence: Partial<FastaSequence>,
    sequenceBuffer: string[],
    lineNumber: number
  ): FastaSequence {
    this.validateFinalizeInputs(partialSequence, sequenceBuffer, lineNumber);

    const sequence = sequenceBuffer.join("");
    const length = sequence.length;

    if (length === 0) {
      throw new SequenceError(
        "Empty sequence found",
        this.getSequenceIdOrDefault(partialSequence),
        lineNumber
      );
    }

    const fastaSequence = this.buildFastaSequence(partialSequence, sequence, length);
    this.validateFinalSequence(fastaSequence, lineNumber);
    this.assertSequencePostconditions(fastaSequence, lineNumber);

    return fastaSequence;
  }

  private validateFinalizeInputs(
    partialSequence: Partial<FastaSequence>,
    sequenceBuffer: string[],
    lineNumber: number
  ): void {
    if (partialSequence === null) {
      throw new ValidationError("partialSequence must not be null");
    }
    if (!Array.isArray(sequenceBuffer)) {
      throw new ValidationError("sequenceBuffer must be an array");
    }
    if (sequenceBuffer.length === 0) {
      throw new SequenceError(
        "Empty sequence found",
        this.getSequenceIdOrDefault(partialSequence),
        lineNumber
      );
    }
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new ValidationError("lineNumber must be positive integer");
    }
  }

  private getSequenceIdOrDefault(partialSequence: Partial<FastaSequence>): string {
    return partialSequence.id !== null &&
      partialSequence.id !== undefined &&
      partialSequence.id !== ""
      ? partialSequence.id
      : "unknown";
  }

  private buildFastaSequence(
    partialSequence: Partial<FastaSequence>,
    sequence: string,
    length: number
  ): FastaSequence {
    return {
      format: "fasta",
      id:
        this.getSequenceIdOrDefault(partialSequence) === "unknown"
          ? ""
          : this.getSequenceIdOrDefault(partialSequence),
      ...(partialSequence.description !== null &&
        partialSequence.description !== undefined &&
        partialSequence.description !== "" && {
          description: partialSequence.description,
        }),
      sequence,
      length,
      ...(partialSequence.lineNumber !== null &&
        partialSequence.lineNumber !== undefined &&
        partialSequence.lineNumber !== 0 && {
          lineNumber: partialSequence.lineNumber,
        }),
    };
  }

  private validateFinalSequence(fastaSequence: FastaSequence, lineNumber: number): void {
    if (this.options.skipValidation) return;

    try {
      const validation = FastaSequenceSchema(fastaSequence);
      if (validation instanceof type.errors) {
        throw new SequenceError(
          `Invalid FASTA sequence: ${validation.summary}`,
          fastaSequence.id,
          lineNumber
        );
      }
    } catch (error) {
      if (error instanceof SequenceError) {
        throw error;
      }
      throw new SequenceError(
        `Sequence validation failed: ${error instanceof Error ? error.message : String(error)}`,
        fastaSequence.id,
        lineNumber
      );
    }
  }

  private assertSequencePostconditions(fastaSequence: FastaSequence, lineNumber: number): void {
    if (fastaSequence.format !== "fasta") {
      throw new SequenceError("result format must be fasta", fastaSequence.id, lineNumber);
    }
    if (typeof fastaSequence.id !== "string") {
      throw new SequenceError("result id must be a string", fastaSequence.id, lineNumber);
    }
    if (fastaSequence.length !== fastaSequence.sequence.length) {
      throw new SequenceError("length must match sequence length", fastaSequence.id, lineNumber);
    }
    if (fastaSequence.length === 0) {
      throw new SequenceError("sequence must not be empty", fastaSequence.id, lineNumber);
    }
  }

  /**
   * Validate file path and ensure it's accessible for reading
   * @param filePath Raw file path from user input
   * @returns Promise resolving to validated file path
   * @throws {FileError} If file path is invalid or file is not accessible
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
      throw new FileError(`FASTA file not found or not accessible: ${filePath}`, filePath, "read");
    }

    // Get file metadata for additional validation
    try {
      const metadata = await getMetadata(filePath);

      if (!metadata.readable) {
        throw new ParseError(
          `FASTA file is not readable: ${filePath}`,
          "FASTA",
          undefined,
          "Check file permissions"
        );
      }

      // Warn about very large files
      if (metadata.size > 1_073_741_824) {
        // 1GB
        this.options.onWarning(
          `Large FASTA file detected: ${Math.round(metadata.size / 1_048_576)}MB. Consider using streaming with smaller buffer sizes.`,
          1
        );
      }
    } catch (error) {
      if (error instanceof ParseError) throw error;
      throw new ParseError(
        `Failed to validate FASTA file: ${error instanceof Error ? error.message : String(error)}`,
        "FASTA",
        undefined,
        filePath
      );
    }

    return filePath;
  }

  /**
   * Parse FASTA sequences from async iterable of lines
   * @param lines Async iterable of text lines
   * @yields FastaSequence objects as they are parsed
   */
  private async *parseLinesFromAsyncIterable(
    lines: AsyncIterable<string>
  ): AsyncIterable<FastaSequence> {
    // Tiger Style: Assert function arguments
    if (typeof lines !== "object" || !(Symbol.asyncIterator in lines)) {
      throw new ValidationError("lines must be async iterable");
    }

    let currentSequence: Partial<FastaSequence> | null = null;
    let sequenceBuffer: string[] = [];
    let lineNumber = 0;

    try {
      for await (const rawLine of lines) {
        lineNumber++;

        try {
          const processedLine = this.processLine(rawLine, lineNumber);

          if (!processedLine) continue; // Skip empty/comment lines

          if (processedLine.isHeader) {
            // Yield previous sequence if exists
            if (currentSequence) {
              yield this.finalizeSequence(currentSequence, sequenceBuffer, lineNumber - 1);
            }

            currentSequence = processedLine.headerData ?? null;
            sequenceBuffer = [];
          } else {
            // Handle sequence data
            this.processSequenceData(
              processedLine.sequenceData!,
              currentSequence,
              sequenceBuffer,
              lineNumber
            );
          }
        } catch (lineError) {
          // Call error handler for line-level parsing errors
          const errorMessage = lineError instanceof Error ? lineError.message : String(lineError);
          this.options.onError(errorMessage, lineNumber);
        }
      }

      // Yield final sequence
      if (currentSequence && sequenceBuffer.length > 0) {
        yield this.finalizeSequence(currentSequence, sequenceBuffer, lineNumber);
      } else if (currentSequence) {
        // Handle case where header exists but no sequence data
        throw new SequenceError(
          "Header found but no sequence data",
          currentSequence.id !== null &&
            currentSequence.id !== undefined &&
            currentSequence.id !== ""
            ? currentSequence.id
            : "unknown",
          lineNumber
        );
      }
    } catch (error) {
      // Enhance error with line number context
      if (error instanceof ParseError || error instanceof SequenceError) {
        throw error;
      }

      throw new ParseError(
        `FASTA parsing failed at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
        "FASTA",
        lineNumber,
        "Check file format and content"
      );
    }

    // Tiger Style: Assert postconditions
    if (lineNumber < 0) {
      throw new ParseError("line number must be non-negative", "FASTA");
    }
  }
}

/**
 * FASTA writer for outputting sequences
 */
export class FastaWriter {
  private readonly lineWidth: number;
  private readonly includeDescription: boolean;
  private readonly lineEnding: string;

  constructor(
    options: {
      lineWidth?: number;
      includeDescription?: boolean;
      lineEnding?: string;
    } = {}
  ) {
    this.lineWidth =
      options.lineWidth !== null && options.lineWidth !== undefined && options.lineWidth !== 0
        ? options.lineWidth
        : 80;
    this.includeDescription = options.includeDescription ?? true;
    this.lineEnding = options.lineEnding ?? (process.platform === "win32" ? "\r\n" : "\n");
  }

  /**
   * Format a single FASTA sequence as string
   */
  formatSequence(sequence: FastaSequence): string {
    let header = `>${sequence.id}`;

    if (
      this.includeDescription === true &&
      sequence.description !== null &&
      sequence.description !== undefined &&
      sequence.description !== ""
    ) {
      header += ` ${sequence.description}`;
    }

    // Wrap sequence to specified line width
    const wrappedSequence = this.wrapText(sequence.sequence, this.lineWidth);

    return `${header}${this.lineEnding}${wrappedSequence}`;
  }

  /**
   * Format multiple sequences as string
   */
  formatSequences(sequences: FastaSequence[]): string {
    return sequences.map((seq) => this.formatSequence(seq)).join(this.lineEnding);
  }

  /**
   * Write sequences to a WritableStream
   */
  async writeToStream(
    sequences: AsyncIterable<FastaSequence>,
    stream: WritableStream<Uint8Array>
  ): Promise<void> {
    const writer = stream.getWriter();
    const encoder = new TextEncoder();

    try {
      for await (const sequence of sequences) {
        const formatted = this.formatSequence(sequence) + this.lineEnding;
        await writer.write(encoder.encode(formatted));
      }
    } finally {
      writer.releaseLock();
    }
  }

  /**
   * Wrap text to specified width
   */
  private wrapText(text: string, width: number): string {
    if (width <= 0) return text;

    const lines: string[] = [];
    for (let i = 0; i < text.length; i += width) {
      lines.push(text.slice(i, i + width));
    }
    return lines.join(this.lineEnding);
  }
}

/**
 * Utility functions for FASTA format
 */
export const FastaUtils = {
  /**
   * Detect if string contains FASTA format data
   */
  detectFormat(data: string): boolean {
    const trimmed = data.trim();
    return trimmed.startsWith(">") && trimmed.includes("\n");
  },

  /**
   * Count sequences in FASTA data without parsing
   */
  countSequences(data: string): number {
    return (data.match(/^>/gm) || []).length;
  },

  /**
   * Extract sequence IDs without full parsing
   */
  extractIds(data: string): string[] {
    const matches = data.match(/^>([^\s\n\r]+)/gm);
    return matches ? matches.map((m) => m.slice(1)) : [];
  },

  /**
   * Calculate basic sequence statistics
   */
  calculateStats(sequence: string): {
    length: number;
    gcContent: number;
    composition: Record<string, number>;
  } {
    const length = sequence.length;
    const composition: Record<string, number> = {};
    let gcCount = 0;

    for (const char of sequence.toUpperCase()) {
      composition[char] =
        (composition[char] !== null && composition[char] !== undefined ? composition[char] : 0) + 1;
      if (char === "G" || char === "C") {
        gcCount++;
      }
    }

    return {
      length,
      gcContent: length > 0 ? gcCount / length : 0,
      composition,
    };
  },
};
