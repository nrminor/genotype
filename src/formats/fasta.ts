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
import { exists } from "../io/file-reader";
import type { FastaSequence, ParserOptions } from "../types";
import { FastaSequenceSchema, SequenceIdSchema, SequenceSchema } from "../types";
import { AbstractParser } from "./abstract-parser";

/**
 * FASTA-specific parser options
 * Extends base ParserOptions without format-specific additions for now
 */
interface FastaParserOptions extends ParserOptions {
  // FASTA-specific options can be added here if needed
}

/**
 * Discriminated union for processed FASTA lines
 */
type ProcessedFastaLine =
  | { isHeader: true; headerData: Partial<FastaSequence> }
  | { isHeader: false; sequenceData: string }
  | null;

/**
 * ArkType validation for FASTA parser options with genomics domain expertise
 * Provides excellent error messages for FASTA workflows and biological guidance
 */
const FastaParserOptionsSchema = type({
  "skipValidation?": "boolean",
  "maxLineLength?": "number>0",
  "trackLineNumbers?": "boolean",
}).narrow((options, ctx) => {
  // Memory safety validation for large genome assemblies
  if (options.maxLineLength && options.maxLineLength > 500_000_000) {
    return ctx.reject({
      expected: "maxLineLength <= 500MB for genome assembly memory safety",
      actual: `${options.maxLineLength} bytes`,
      path: ["maxLineLength"],
      message:
        "Plant genomes can have gigabase chromosomes - use streaming for very large sequences",
    });
  }

  // Performance guidance for validation on large genomes
  if (
    options.skipValidation === false &&
    options.maxLineLength &&
    options.maxLineLength > 50_000_000
  ) {
    // This is a warning, not an error - just guidance
    console.warn(
      `FASTA parsing with validation enabled for sequences >50MB may be slow. ` +
        `Consider skipValidation: true for large genome assemblies.`
    );
  }

  return true;
});

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
class FastaParser extends AbstractParser<FastaSequence, FastaParserOptions> {
  protected getDefaultOptions(): Partial<FastaParserOptions> {
    return {
      skipValidation: false,
      maxLineLength: 1_000_000, // 1MB max line length (suitable for most sequences)
      trackLineNumbers: true,
      onError: (error: string, lineNumber?: number): void => {
        throw new ParseError(error, "FASTA", lineNumber);
      },
      onWarning: (warning: string, lineNumber?: number): void => {
        console.warn(`FASTA Warning (line ${lineNumber}): ${warning}`);
      },
    };
  }

  /**
   * Create a new FASTA parser with specified options and interrupt support
   * @param options FASTA parser configuration options including AbortSignal
   */
  constructor(options: FastaParserOptions = {}) {
    // Step 1: ArkType validation with FASTA domain expertise
    const validationResult = FastaParserOptionsSchema(options);

    if (validationResult instanceof type.errors) {
      throw new ValidationError(
        `Invalid FASTA parser options: ${validationResult.summary}`,
        undefined,
        "FASTA parser configuration with genomics context"
      );
    }

    // Step 2: Pass validated options to base class (which will merge with defaults)
    super(options);
  }

  protected getFormatName(): string {
    return "FASTA";
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
    // Validate meaningful constraints (preserve biological validation)
    if (filePath.length === 0) {
      throw new ValidationError("filePath must not be empty");
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
        buffer = lastLine ?? ""; // Keep incomplete line in buffer

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
            processedLine.sequenceData,
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
  private processLine(line: string, lineNumber: number): ProcessedFastaLine {
    // Validate meaningful constraints
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

    // Delegate to tree-shakeable helper
    if (shouldSkipFastaLine(line)) {
      return null;
    }

    const trimmedLine = line.trim();

    // Delegate to tree-shakeable helper for header detection
    if (isFastaHeader(trimmedLine)) {
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
    // Validate meaningful constraints
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
    // Delegate to tree-shakeable function
    const headerData = parseFastaHeader(headerLine, lineNumber, {
      skipValidation: this.options.skipValidation,
      onWarning: this.options.onWarning,
    });

    return this.buildHeaderResult(headerData.id, headerData.description, lineNumber);
  }

  private buildHeaderResult(
    id: string,
    description: string | undefined,
    lineNumber: number
  ): Partial<FastaSequence> {
    const result = {
      format: "fasta" as const,
      id,
      description: description || undefined,
      lineNumber: this.options.trackLineNumbers ? lineNumber : undefined,
    };

    // Tiger Style: Assert postconditions
    if (result.format !== "fasta") {
      throw new SequenceError("result format must be fasta", result.id || "unknown", lineNumber);
    }

    return {
      format: "fasta",
      id: result.id || "",
      ...(result.description && { description: result.description }),
      ...(result.lineNumber && { lineNumber: result.lineNumber }),
    };
  }

  /**
   * Clean and validate sequence data, removing whitespace and validating characters
   * @param sequenceLine Raw sequence line from input
   * @param lineNumber Line number for error reporting
   * @returns Cleaned sequence string with whitespace removed
   */
  private cleanSequence(sequenceLine: string, lineNumber: number): string {
    // Validate meaningful constraints
    if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
      throw new ValidationError("lineNumber must be positive integer");
    }

    // Delegate to tree-shakeable function
    return validateFastaSequence(sequenceLine, lineNumber, {
      skipValidation: this.options.skipValidation,
    });
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

    // Delegate to tree-shakeable function
    const sequence = concatenateFastaSequence(sequenceBuffer);
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
    // Note: Tree-shakeable function has slightly different error message but same validation
    validateFastaFinalizeInputs(partialSequence, sequenceBuffer, lineNumber);
  }

  private getSequenceIdOrDefault(partialSequence: Partial<FastaSequence>): string {
    return partialSequence.id || "unknown";
  }

  private buildFastaSequence(
    partialSequence: Partial<FastaSequence>,
    sequence: string,
    length: number
  ): FastaSequence {
    // Delegate to tree-shakeable function
    return buildFastaRecord(partialSequence, sequence, length);
  }

  private validateFinalSequence(fastaSequence: FastaSequence, lineNumber: number): void {
    // Delegate to tree-shakeable function
    validateFastaFinalSequence(fastaSequence, lineNumber, this.options.skipValidation);
  }

  private assertSequencePostconditions(fastaSequence: FastaSequence, lineNumber: number): void {
    // Delegate to tree-shakeable function
    assertFastaPostconditions(fastaSequence, lineNumber);
  }

  /**
   * Validate file path and ensure it's accessible for reading
   * @param filePath Raw file path from user input
   * @returns Promise resolving to validated file path
   * @throws {FileError} If file path is invalid or file is not accessible
   */
  private async validateFilePath(filePath: string): Promise<string> {
    // Delegate to tree-shakeable function for basic validation
    const validatedPath = await validateFastaFilePath(filePath);

    // Additional FASTA-specific checks if needed
    try {
      // Import FileReader functions dynamically to avoid circular dependencies
      const { getMetadata } = await import("../io/file-reader");
      const metadata = await getMetadata(validatedPath);

      // Warn about very large files
      if (metadata.size > 1_073_741_824) {
        // 1GB
        this.options.onWarning(
          `Large FASTA file detected: ${Math.round(metadata.size / 1_048_576)}MB. Consider using streaming with smaller buffer sizes.`,
          1
        );
      }
    } catch (_error) {
      // Non-critical - continue even if metadata check fails
    }

    return validatedPath;
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
              processedLine.sequenceData,
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

      // Validate and yield final sequence
      validateFastaParsingState(currentSequence, sequenceBuffer, lineNumber);
      if (currentSequence && sequenceBuffer.length > 0) {
        yield this.finalizeSequence(currentSequence, sequenceBuffer, lineNumber);
      }
    } catch (error) {
      // Delegate to tree-shakeable error handler
      throw createFastaParseError(error, lineNumber);
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
class FastaWriter {
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
    this.lineWidth = options.lineWidth || 80;
    this.includeDescription = options.includeDescription ?? true;
    this.lineEnding = options.lineEnding ?? (process.platform === "win32" ? "\r\n" : "\n");
  }

  /**
   * Format a single FASTA sequence as string
   */
  formatSequence(sequence: FastaSequence): string {
    let header = `>${sequence.id}`;

    if (this.includeDescription === true && sequence.description) {
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
const FastaUtils = {
  /**
   * Detect if string contains FASTA format data
   */
  detectFormat: detectFastaFormat,

  /**
   * Count sequences in FASTA data without parsing
   */
  countSequences: countFastaSequences,

  /**
   * Extract sequence IDs without full parsing
   */
  extractIds: extractFastaIds,

  /**
   * Calculate basic sequence statistics
   */
  calculateStats: calculateFastaStats,
};

/**
 * Parse FASTA header line and extract ID and description
 * Tree-shakeable function for FASTA header processing
 */
function parseFastaHeader(
  headerLine: string,
  lineNumber: number,
  options: { skipValidation?: boolean; onWarning?: (msg: string, line?: number) => void }
): { id: string; description?: string } {
  // Validate header format
  if (!headerLine.startsWith(">")) {
    throw new ValidationError('headerLine must start with ">"');
  }

  const header = headerLine.slice(1); // Remove '>'
  if (!header) {
    if (options.skipValidation) {
      options.onWarning?.("Empty FASTA header", lineNumber);
      return { id: "" };
    } else {
      throw new ParseError(
        'Empty FASTA header: header must contain an identifier after ">"',
        "FASTA",
        lineNumber,
        headerLine
      );
    }
  }

  // Extract ID and description
  const firstSpace = header.search(/\s/);
  const id = firstSpace === -1 ? header : header.slice(0, firstSpace);
  const description = firstSpace === -1 ? undefined : header.slice(firstSpace + 1).trim();

  // Validate sequence ID following NCBI guidelines
  if (!options.skipValidation) {
    // NCBI FASTA specification validation
    if (id.length > 25) {
      options.onWarning?.(
        `Sequence ID '${id}' exceeds NCBI recommended maximum of 25 characters (${id.length} chars). ` +
          `Long IDs may cause compatibility issues with BLAST and other NCBI tools.`,
        lineNumber
      );
    }

    // Check for spaces in sequence ID (not allowed by NCBI spec)
    if (id.includes(" ")) {
      throw new SequenceError(
        `Sequence ID '${id}' contains spaces. NCBI FASTA specification requires no spaces in sequence identifiers. ` +
          `Use underscores (_) or hyphens (-) instead.`,
        id,
        lineNumber,
        headerLine
      );
    }

    // Use existing SequenceIdSchema validation
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
      options.onWarning?.(
        `Sequence ID validation warning: ${error instanceof Error ? error.message : String(error)}`,
        lineNumber
      );
    }
  }

  return description !== undefined ? { id, description } : { id };
}

/**
 * Validate and clean FASTA sequence data
 * Tree-shakeable function for FASTA sequence processing
 */
function validateFastaSequence(
  sequenceLine: string,
  lineNumber: number,
  options: { skipValidation?: boolean }
): string {
  // Remove whitespace
  const cleaned = sequenceLine.replace(/\s/g, "");

  if (!cleaned) {
    return "";
  }

  // Validate sequence if not skipping validation
  if (!options.skipValidation) {
    const validation = SequenceSchema(cleaned);
    if (validation instanceof type.errors) {
      const suggestion = getErrorSuggestion(
        new ValidationError(`Invalid sequence characters: ${validation.summary}`)
      );

      throw new SequenceError(
        `Invalid FASTA sequence characters found at line ${lineNumber}. ${suggestion}\n` +
          `FASTA sequences should contain IUPAC nucleotide codes (A,C,G,T,U), ambiguity codes (R,Y,S,W,K,M,B,D,H,V,N), ` +
          `and gap characters (-,.) for alignments. Check for invalid characters or encoding issues.`,
        "unknown",
        lineNumber,
        sequenceLine
      );
    }
  }

  // Validate postconditions
  if (cleaned.includes(" ") || cleaned.includes("\t")) {
    throw new SequenceError("cleaned result must not contain whitespace", "unknown", lineNumber);
  }

  return cleaned;
}

/**
 * Detect if string contains FASTA format data
 * Tree-shakeable function for FASTA format detection
 */
function detectFastaFormat(data: string): boolean {
  const trimmed = data.trim();
  return trimmed.startsWith(">") && trimmed.includes("\n");
}

/**
 * Count sequences in FASTA data without full parsing
 * Tree-shakeable function for efficient sequence counting
 */
function countFastaSequences(data: string): number {
  return (data.match(/^>/gm) || []).length;
}

/**
 * Extract sequence IDs from FASTA data without full parsing
 * Tree-shakeable function for quick ID extraction
 */
function extractFastaIds(data: string): string[] {
  const matches = data.match(/^>([^\s\n\r]+)/gm);
  return matches ? matches.map((m) => m.slice(1)) : [];
}

/**
 * Build complete FASTA sequence record from parsed components
 * Tree-shakeable function for FASTA record construction
 */
function buildFastaRecord(
  partialSequence: Partial<FastaSequence>,
  sequence: string,
  length: number
): FastaSequence {
  const id = partialSequence.id && partialSequence.id !== "unknown" ? partialSequence.id : "";

  return {
    format: "fasta",
    id,
    ...(partialSequence.description && {
      description: partialSequence.description,
    }),
    sequence,
    length,
    ...(partialSequence.lineNumber && {
      lineNumber: partialSequence.lineNumber,
    }),
  };
}

/**
 * Check if a line should be skipped during FASTA parsing
 * Tree-shakeable function for line filtering
 * @param line The line to check
 * @returns true if line should be skipped (empty or comment)
 */
function shouldSkipFastaLine(line: string): boolean {
  const trimmed = line.trim();
  // Skip empty lines and semicolon comments (deprecated but still found)
  return !trimmed || trimmed.startsWith(";");
}

/**
 * Check if a line is a FASTA header
 * Tree-shakeable function for header detection
 * @param line The line to check
 * @returns true if line is a header (starts with >)
 */
function isFastaHeader(line: string): boolean {
  return line.trim().startsWith(">");
}

/**
 * Process and concatenate multi-line FASTA sequences
 * Tree-shakeable function for sequence joining
 * @param sequenceBuffer Array of sequence parts to concatenate
 * @returns Concatenated and cleaned sequence
 */
function concatenateFastaSequence(sequenceBuffer: string[]): string {
  return sequenceBuffer.join("");
}

/**
 * Normalize FASTA sequence (uppercase, remove whitespace)
 * Tree-shakeable function for sequence normalization
 * @param sequence Raw sequence string
 * @returns Normalized sequence
 */
function normalizeFastaSequence(sequence: string): string {
  // Remove all whitespace and convert to uppercase
  return sequence.replace(/\s/g, "").toUpperCase();
}

/**
 * Create enhanced FASTA parsing error with context
 * Tree-shakeable function for error generation
 * @param error The original error
 * @param lineNumber The line number where error occurred
 * @param context Additional context for error
 * @returns Enhanced ParseError with biological context
 */
function createFastaParseError(error: unknown, lineNumber: number, context?: string): ParseError {
  if (error instanceof ParseError || error instanceof SequenceError) {
    return error as ParseError;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ParseError(
    `FASTA parsing failed at line ${lineNumber}: ${message}`,
    "FASTA",
    lineNumber,
    context || "Check file format and content"
  );
}

/**
 * Validate FASTA parsing state before finalizing
 * Tree-shakeable function for state validation
 * @param currentSequence Current sequence being built
 * @param sequenceBuffer Buffer containing sequence data
 * @param lineNumber Current line number
 */
function validateFastaParsingState(
  currentSequence: Partial<FastaSequence> | null,
  sequenceBuffer: string[],
  lineNumber: number
): void {
  if (currentSequence && sequenceBuffer.length === 0) {
    throw new SequenceError(
      "Header found but no sequence data",
      currentSequence.id || "unknown",
      lineNumber
    );
  }
}

/**
 * Calculate statistics for a FASTA sequence
 * Tree-shakeable function for sequence analysis
 * @param sequence The sequence to analyze
 * @returns Statistics including length, GC content, and base composition
 */
function calculateFastaStats(sequence: string): {
  length: number;
  gcContent: number;
  composition: Record<string, number>;
} {
  const length = sequence.length;
  const composition: Record<string, number> = {};
  let gcCount = 0;

  for (const char of sequence.toUpperCase()) {
    composition[char] = (composition[char] ?? 0) + 1;
    if (char === "G" || char === "C") {
      gcCount++;
    }
  }

  return {
    length,
    gcContent: length > 0 ? gcCount / length : 0,
    composition,
  };
}

/**
 * Validate inputs for finalizing a FASTA sequence
 * Tree-shakeable function for pre-finalization validation
 */
function validateFastaFinalizeInputs(
  partialSequence: Partial<FastaSequence> | null,
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
    throw new SequenceError("Empty sequence found", partialSequence?.id || "unknown", lineNumber);
  }
  if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
    throw new ValidationError("lineNumber must be positive integer");
  }
}

/**
 * Validate final FASTA sequence using ArkType
 * Tree-shakeable function for complete sequence validation
 */
function validateFastaFinalSequence(
  fastaSequence: FastaSequence,
  lineNumber: number,
  skipValidation?: boolean
): void {
  if (skipValidation) return;

  const validation = FastaSequenceSchema(fastaSequence);
  if (validation instanceof type.errors) {
    throw new SequenceError(
      `Invalid FASTA sequence structure: ${validation.summary}`,
      fastaSequence.id,
      lineNumber
    );
  }
}

/**
 * Assert FASTA sequence postconditions
 * Tree-shakeable function for sequence integrity checks
 */
function assertFastaPostconditions(fastaSequence: FastaSequence, lineNumber: number): void {
  if (fastaSequence.format !== "fasta") {
    throw new SequenceError("result format must be fasta", fastaSequence.id, lineNumber);
  }
  if (fastaSequence.length !== fastaSequence.sequence.length) {
    throw new SequenceError("length must match sequence length", fastaSequence.id, lineNumber);
  }
  if (fastaSequence.length === 0) {
    throw new SequenceError("sequence must not be empty", fastaSequence.id, lineNumber);
  }
}

/**
 * Validate FASTA file path for security and accessibility
 * Tree-shakeable function for file path validation
 * @param filePath The file path to validate
 * @returns Promise resolving to validated path
 */
async function validateFastaFilePath(filePath: string): Promise<string> {
  // Basic path validation
  if (!filePath || filePath.length === 0) {
    throw new FileError("File path cannot be empty", filePath, "read");
  }

  // Security: prevent directory traversal
  if (filePath.includes("../") || filePath.includes("..\\")) {
    throw new FileError(
      "Path traversal detected - file path cannot contain '../'",
      filePath,
      "open"
    );
  }

  // Check file existence
  try {
    const fileExists = await exists(filePath);

    if (!fileExists) {
      throw new FileError(
        `File not found: ${filePath}. Please check the file path and try again.`,
        filePath,
        "read"
      );
    }

    return filePath;
  } catch (error) {
    if (error instanceof FileError) {
      throw error;
    }
    throw new FileError(
      `Cannot access file: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
      "open",
      error
    );
  }
}

// Exports - grouped at end per project style guide
export {
  FastaParser,
  FastaWriter,
  FastaUtils,
  parseFastaHeader,
  validateFastaSequence,
  detectFastaFormat,
  countFastaSequences,
  extractFastaIds,
  buildFastaRecord,
  shouldSkipFastaLine,
  isFastaHeader,
  concatenateFastaSequence,
  normalizeFastaSequence,
  createFastaParseError,
  validateFastaParsingState,
  calculateFastaStats,
  validateFastaFinalizeInputs,
  validateFastaFinalSequence,
  assertFastaPostconditions,
  validateFastaFilePath,
};
