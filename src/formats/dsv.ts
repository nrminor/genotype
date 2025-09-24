/**
 * DSV (Delimiter-Separated Values) format parser and writer
 *
 * Handles the messiness of real-world tabular genomic data:
 * - Various delimiters (tab, comma, pipe, semicolon, etc.)
 * - Quoted fields with embedded delimiters and newlines
 * - Missing values and ragged rows
 * - Comment lines and headers
 * - Excel-specific quirks (date corruption, gene name mangling)
 * - Large-scale genomic datasets with streaming support
 * - **NEW**: Automatic delimiter and header detection
 * - **NEW**: Transparent compression support (gzip/zstd)
 * - **NEW**: Magic byte detection for compressed files
 *
 * Complies with RFC 4180 for CSV format while supporting broader DSV variations.
 *
 * @example Auto-detection and compression
 * ```typescript
 * // Automatically detect format and decompress
 * const parser = new DSVParser({ autoDetect: true });
 * const records = await parser.parseFile("data.csv.gz");
 *
 * // Write compressed output
 * const writer = new CSVWriter();
 * await writer.writeFile("output.csv.gz", records); // Auto-compresses
 *
 * // Comprehensive format detection
 * const info = await DSVUtils.sniff(fileContent);
 * console.log(info); // { delimiter: ",", hasHeaders: true, compression: "gzip", confidence: 0.9 }
 * ```
 *
 * @example Complete genomic workflow
 * ```typescript
 * // Process RNA-seq expression data with full auto-detection
 * const parser = new DSVParser({ autoDetect: true });
 * const writer = new TSVWriter({ excelCompatible: true });
 *
 * // Parse compressed input of unknown format
 * const records = [];
 * for await (const record of parser.parseFile("expression_data.txt.gz")) {
 *   // Filter for significant expression
 *   if (parseFloat(record.TPM) > 1.0) {
 *     records.push(record);
 *   }
 * }
 *
 * // Write filtered results as compressed TSV
 * await writer.writeFile("filtered_expression.tsv.gz", records);
 * console.log(`Processed ${records.length} significant genes`);
 * ```
 *
 * @module formats/dsv
 */

// =============================================================================
// IMPORTS
// =============================================================================

import { type } from "arktype";
import { CompressionDetector } from "../compression/detector";
import { GzipDecompressor } from "../compression/gzip";
import { ZstdDecompressor } from "../compression/zstd";
import { CompressionError, DSVParseError, FileError, ParseError, ValidationError } from "../errors";
import { createStream } from "../io/file-reader";
import { gcContent } from "../operations/core/calculations";
import type { CompressionFormat, ParserOptions } from "../types";
import { AbstractParser } from "./abstract-parser";

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Default delimiter for different formats
 */
export const DEFAULT_DELIMITERS = {
  csv: ",",
  tsv: "\t",
  psv: "|",
  ssv: ";",
} as const;

/**
 * Default quote character (RFC 4180 compliant)
 */
export const DEFAULT_QUOTE = '"';

/**
 * Default escape character (doubling quotes per RFC 4180)
 */
export const DEFAULT_ESCAPE = '"';

/**
 * Common comment prefixes in genomic data files
 */
export const COMMENT_PREFIXES = ["#", "//", ";"] as const;

/**
 * Magic bytes for common compression formats
 * Used for detecting compressed files by their binary signatures
 */
export const COMPRESSION_MAGIC = {
  GZIP: [0x1f, 0x8b], // gzip magic bytes
  ZSTD: [0x28, 0xb5, 0x2f, 0xfd], // zstandard magic bytes
  BZIP2: [0x42, 0x5a], // 'BZ' - bzip2 magic bytes
  XZ: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], // xz/lzma magic bytes
} as const;

/**
 * Maximum field size for memory safety (100MB)
 * Prevents memory exhaustion from malformed files
 */
export const MAX_FIELD_SIZE = 100_000_000; // 100MB

/**
 * Maximum row size for memory safety (500MB)
 * Large enough for genome assemblies
 */
export const MAX_ROW_SIZE = 500_000_000; // 500MB

/**
 * Maximum number of lines to sample for delimiter/header detection
 * Prevents memory exhaustion when detection fails on large files
 */
export const MAX_DETECTION_LINES = 100;

/**
 * Maximum bytes to sample for format detection (10KB)
 * Enough for reliable detection without loading entire files
 */
export const MAX_DETECTION_BYTES = 10_000;

/**
 * Excel-specific gene name patterns that get corrupted
 * Examples: SEPT1 → Sep-1, MARCH1 → Mar-1
 */
export const EXCEL_GENE_PATTERNS = [
  /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\d+$/i,
  /^(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\d+$/i,
] as const;

/**
 * Line ending options
 */
export const LINE_ENDINGS = {
  unix: "\n",
  windows: "\r\n",
  classic_mac: "\r",
} as const;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Supported delimiter types for DSV formats
 */
export type DelimiterType = "," | "\t" | "|" | ";" | string;

/**
 * DSV-specific sequence format identifier
 */
export type DSVFormat = "csv" | "tsv" | "dsv";

/**
 * DSV record structure for genomic data
 * Flexible to accommodate various sequence formats and metadata
 */
export interface DSVRecord {
  format: "dsv";
  id: string;
  sequence?: string;
  quality?: string;
  description?: string;
  // Additional computed fields
  length?: number;
  gc?: number;
  gcSkew?: number;
  avgQuality?: number;
  baseCount?: Record<string, number>;
  [key: string]: any; // Allow custom fields
}

/**
 * Parser state for CSV/TSV parsing state machine
 */
export enum CSVParseState {
  FIELD_START,
  UNQUOTED_FIELD,
  QUOTED_FIELD,
  QUOTE_IN_QUOTED,
}

/**
 * DSV parser options extending base parser options
 */
export interface DSVParserOptions extends ParserOptions {
  // Delimiter configuration
  delimiter?: DelimiterType;
  autoDetectDelimiter?: boolean;

  // Quote handling
  quote?: string;
  escape?: string;

  // Header configuration
  header?: boolean | string[];
  columns?: string[];

  // Parsing behavior
  skipEmptyLines?: boolean;
  skipComments?: boolean;
  commentPrefix?: string;

  // Error handling
  onError?: (error: string, lineNumber?: number) => void;

  // Excel compatibility
  protectFromExcel?: boolean;

  // Ragged row handling
  raggedRows?: "error" | "pad" | "truncate" | "ignore";

  // Error recovery - maximum lines a single field can span (default: 100)
  maxFieldLines?: number;

  // Statistics computation
  computeStats?: boolean;
  includeGC?: boolean;
  includeGCSkew?: boolean;
  includeBaseCount?: boolean;
  includeQuality?: boolean;

  // Auto-detection options
  autoDetect?: boolean; // Enable all auto-detection
  autoDetectHeaders?: boolean; // Just header detection
}

/**
 * DSV writer options for output formatting
 */
export interface DSVWriterOptions {
  delimiter?: DelimiterType;
  quote?: string;
  escapeChar?: string;
  header?: boolean;
  columns?: string[];
  lineEnding?: "\n" | "\r\n" | "\r";
  quoteAll?: boolean;

  // Excel compatibility mode
  excelCompatible?: boolean;

  // Statistics to include
  computeStats?: boolean;
  includeGC?: boolean;
  includeGCSkew?: boolean;
  includeBaseCount?: boolean;
  includeQuality?: boolean;

  // Compression options
  compression?: "gzip" | "zstd" | null;
  compressionLevel?: number; // 1-9 for gzip, 1-22 for zstd
}

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

/**
 * ArkType validation schema for DSV parser options
 */
const DSVParserOptionsSchema = type({
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
const DSVWriterOptionsSchema = type({
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
// PARSER STATE MANAGEMENT
// =============================================================================

/**
 * Parser state for resumable DSV parsing
 * Allows parseString to work with both full strings and streaming chunks
 */
interface DSVParserState {
  accumulatedRow: string; // Current row being built (may span lines)
  rowStartLine: number; // Line number where current row started
  inMultiLineField: boolean; // Whether currently in a quoted field that spans lines
  linesInCurrentField: number; // Track lines for maxFieldLines limit
  currentLineNumber: number; // Current line number being processed
  headerProcessed: boolean; // Whether header row has been processed
  expectedColumns: number; // Expected column count for validation
}

// =============================================================================
// HELPER CLASSES
// =============================================================================

/**
 * BufferedStreamReader - Allows peeking at stream bytes without consuming
 * Essential for magic byte detection in compressed streams
 */
class BufferedStreamReader {
  private buffer: Uint8Array = new Uint8Array(0);
  private reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async peek(bytes: number): Promise<Uint8Array> {
    if (this.buffer.length < bytes) {
      const { value, done } = await this.reader.read();
      if (!done && value) {
        const newBuffer = new Uint8Array(this.buffer.length + value.length);
        newBuffer.set(this.buffer);
        newBuffer.set(value, this.buffer.length);
        this.buffer = newBuffer;
      }
    }
    return this.buffer.slice(0, bytes);
  }

  stream(): ReadableStream<Uint8Array> {
    const buffer = this.buffer;
    const reader = this.reader;

    return new ReadableStream({
      async start(controller) {
        if (buffer.length > 0) {
          controller.enqueue(buffer);
        }
        // Continue with rest of stream
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      },
    });
  }
}

// =============================================================================
// PARSER IMPLEMENTATION
// =============================================================================

/**
 * Streaming DSV parser for genomic data
 *
 * Supports CSV, TSV, and custom delimiter formats with proper
 * quote handling, Excel protection, and error recovery.
 *
 * Features automatic detection of delimiters and headers when enabled:
 * - autoDetect: Enables both delimiter and header detection
 * - autoDetectDelimiter: Detects delimiter from common types (comma, tab, pipe, semicolon)
 * - autoDetectHeaders: Identifies if first row contains column names vs data
 *
 * @example Basic usage with auto-detection
 * ```typescript
 * // Manual configuration
 * const parser = new DSVParser({ delimiter: ",", header: true });
 *
 * // Auto-detect everything (delimiter, headers, compression)
 * const autoParser = new DSVParser({ autoDetect: true });
 *
 * // Selective auto-detection
 * const semiAutoParser = new DSVParser({
 *   autoDetectDelimiter: true,
 *   header: false
 * });
 *
 * for await (const record of autoParser.parseFile("data.csv")) {
 *   console.log(record.id, record.sequence);
 * }
 * ```
 *
 * @example Working with compressed files
 * ```typescript
 * // Automatically handles .gz and .zst files
 * const parser = new DSVParser({ autoDetect: true });
 *
 * // Parse compressed CSV (auto-detected by magic bytes)
 * for await (const record of parser.parseFile("sequences.csv.gz")) {
 *   console.log(`${record.gene}: ${record.expression} TPM`);
 * }
 *
 * // Stream compressed data directly
 * const compressedStream = await fetch("https://data.org/genes.tsv.gz");
 * for await (const record of parser.parse(compressedStream.body)) {
 *   // Transparently decompressed and parsed
 * }
 * ```
 *
 * @example Format detection with DSVUtils
 * ```typescript
 * // Detect format before parsing
 * const fileContent = await Bun.file("unknown.data").bytes();
 * const format = await DSVUtils.sniff(fileContent);
 *
 * if (format.confidence > 0.8) {
 *   const parser = new DSVParser({
 *     delimiter: format.delimiter,
 *     header: format.hasHeaders
 *   });
 *   // Parse with detected settings
 * }
 * ```
 */
export class DSVParser extends AbstractParser<DSVRecord, DSVParserOptions> {
  private delimiter: string;
  private quote: string;
  private escapeChar: string;
  private headers: string[] | null = null;

  protected getDefaultOptions(): Partial<DSVParserOptions> {
    return {
      quote: '"',
      escape: '"',
      header: true,
      skipEmptyLines: true,
      skipComments: true,
      commentPrefix: "#",
      raggedRows: "pad" as const,
      maxFieldLines: 100,
    };
  }

  /**
   * Create initial parser state for resumable parsing
   */
  private createInitialState(): DSVParserState {
    return {
      accumulatedRow: "",
      rowStartLine: 1,
      inMultiLineField: false,
      linesInCurrentField: 0,
      currentLineNumber: 1,
      headerProcessed: false,
      expectedColumns: 0,
    };
  }

  constructor(options: DSVParserOptions = {}) {
    // Validate options
    const validation = DSVParserOptionsSchema(options);
    if (validation instanceof type.errors) {
      throw new ValidationError(`Invalid DSV parser options: ${validation.summary}`);
    }

    // Build options to pass to super, handling special cases
    const processedOptions = { ...options };

    // Handle autoDetect option - enables both delimiter and header detection
    if (options.autoDetect) {
      processedOptions.autoDetect = true;
      processedOptions.autoDetectDelimiter = true;
      processedOptions.autoDetectHeaders = true;
    }

    // Don't set default header if auto-detecting
    if (
      (processedOptions.autoDetect || processedOptions.autoDetectHeaders) &&
      options.header === undefined
    ) {
      processedOptions.header = undefined as any; // Will be set by detection
    }

    // If no custom onError provided, use one that throws DSVParseError
    if (!options.onError) {
      processedOptions.onError = (error: string, lineNumber?: number): void => {
        throw new DSVParseError(error, lineNumber);
      };
    }

    super(processedOptions);

    // Store delimiter as empty string if auto-detection is needed
    this.delimiter = this.options.autoDetectDelimiter ? "" : this.options.delimiter || "\t";
    this.quote = this.options.quote!;
    this.escapeChar = this.options.escape!;
  }

  /**
   * Get the format name for error messages
   */
  getFormatName(): string {
    switch (this.delimiter) {
      case ",":
        return "CSV";
      case "\t":
        return "TSV";
      case "|":
        return "PSV (Pipe-Separated Values)";
      case ";":
        return "SSV (Semicolon-Separated Values)";
      default:
        return "DSV";
    }
  }

  /**
   * Parse file from path
   */
  async *parseFile(path: string): AsyncIterable<DSVRecord> {
    try {
      // Create stream for magic byte detection
      const detectionStream = await createStream(path);
      const detection = await CompressionDetector.fromStream(detectionStream);

      // Create fresh stream for actual parsing
      let stream = await createStream(path);

      // Apply decompression if needed
      if (detection.format !== "none" && detection.confidence > 0.5) {
        stream = await this.decompressStream(stream, detection.format);
      }

      yield* this.parse(stream);
    } catch (error) {
      // Preserve CompressionError to provide specific handling guidance
      if (error instanceof CompressionError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new FileError(
          `Failed to parse ${this.getFormatName()} file: ${error.message}`,
          path,
          "read"
        );
      }
      throw error;
    }
  }

  /**
   * Decompress a stream based on the detected compression format
   * @param stream - The compressed stream
   * @param format - The compression format detected
   * @returns Decompressed stream
   */
  private async decompressStream(
    stream: ReadableStream<Uint8Array>,
    format: CompressionFormat
  ): Promise<ReadableStream<Uint8Array>> {
    try {
      switch (format) {
        case "gzip": {
          return GzipDecompressor.wrapStream(stream);
        }
        case "zstd": {
          return ZstdDecompressor.wrapStream(stream);
        }
        case "none":
          return stream;
        default: {
          // Handle any future compression formats
          console.warn(`Unsupported compression format: ${format}, treating as uncompressed`);
          return stream;
        }
      }
    } catch (error) {
      // Handle corrupted compressed streams gracefully
      throw new CompressionError(
        `Failed to decompress ${format} stream: ${error instanceof Error ? error.message : String(error)}`,
        format,
        "decompress"
      );
    }
  }

  /**
   * Process array of lines with the given state
   */
  private async *processLines(lines: string[], state: DSVParserState): AsyncIterable<DSVRecord> {
    for (const line of lines) {
      // Skip empty lines if configured (but not when in multi-line field)
      if (this.options.skipEmptyLines && !line.trim() && !state.inMultiLineField) {
        state.currentLineNumber++;
        continue;
      }

      // Skip comment lines (but not when in multi-line field)
      if (
        this.options.skipComments &&
        line.startsWith(this.options.commentPrefix!) &&
        !state.inMultiLineField
      ) {
        state.currentLineNumber++;
        continue;
      }

      // Check if we need to accumulate this line
      if (state.inMultiLineField) {
        // Check if we've exceeded max field lines
        state.linesInCurrentField++;
        if (this.options.maxFieldLines && state.linesInCurrentField > this.options.maxFieldLines) {
          // Field has exceeded maximum line limit - treat as error and recover
          const errorMsg = `Field starting at line ${state.rowStartLine} exceeds maximum line limit (${this.options.maxFieldLines})`;
          if (this.options.onError) {
            this.options.onError(errorMsg, state.rowStartLine);
          } else {
            throw new DSVParseError(errorMsg, state.rowStartLine, undefined, state.accumulatedRow);
          }

          // Reset state and try to parse current line as new row
          state.accumulatedRow = line;
          state.rowStartLine = state.currentLineNumber;
          state.inMultiLineField = false;
          state.linesInCurrentField = 1;
        } else {
          // Continue accumulating
          state.accumulatedRow += "\n" + line;
        }
      } else {
        // Start new row
        state.accumulatedRow = line;
        state.rowStartLine = state.currentLineNumber;
        state.linesInCurrentField = 1;
      }

      // Check if quotes are balanced
      const quotesBalanced = hasBalancedQuotes(state.accumulatedRow, this.quote, this.escapeChar);

      if (quotesBalanced && state.accumulatedRow) {
        // Row is complete, parse it
        state.inMultiLineField = false;

        try {
          const fields = parseCSVRow(
            state.accumulatedRow,
            this.delimiter,
            this.quote,
            this.escapeChar
          );

          // Validate field sizes
          for (const field of fields) {
            validateFieldSize(field, MAX_FIELD_SIZE);
          }

          // Process header if needed
          if (!state.headerProcessed && this.options.header === true) {
            this.headers = fields;
            state.expectedColumns = fields.length;
            state.headerProcessed = true;
          } else {
            // Handle ragged rows
            let processedFields = fields;
            if (state.expectedColumns > 0 && fields.length !== state.expectedColumns) {
              processedFields = handleRaggedRow(
                fields,
                state.expectedColumns,
                this.options.raggedRows
              );
            }

            // Create and yield record
            const record = this.createRecord(processedFields, state.rowStartLine);
            if (record && this.options.signal?.aborted !== true) {
              yield record;
            }
          }

          state.accumulatedRow = "";
          state.linesInCurrentField = 0;
        } catch (error) {
          // Handle parse errors
          if (this.options.onError) {
            this.options.onError(
              error instanceof Error ? error.message : String(error),
              state.rowStartLine
            );
            state.accumulatedRow = "";
            state.inMultiLineField = false;
            state.linesInCurrentField = 0;
          } else {
            throw new DSVParseError(
              error instanceof Error ? error.message : String(error),
              state.rowStartLine,
              undefined,
              state.accumulatedRow
            );
          }
        }
      } else if (!quotesBalanced) {
        state.inMultiLineField = true;
      }

      state.currentLineNumber++;
    }

    // Handle unclosed multi-line field at end of processing
    if (state.inMultiLineField && state.accumulatedRow) {
      // We have an unclosed quote - apply recovery logic
      const errorMsg = `Unclosed quote in field starting at line ${state.rowStartLine}`;

      if (this.options.onError) {
        // Report the error but try to recover
        this.options.onError(errorMsg, state.rowStartLine);

        // Split accumulated content into individual lines
        const accumulatedLines = state.accumulatedRow.split(/\r?\n/);

        // First, try to parse what we have as a complete row (might be a valid multi-line field)
        try {
          const fields = parseCSVRow(
            state.accumulatedRow,
            this.delimiter,
            this.quote,
            this.escapeChar
          );

          const record = this.createRecord(fields, state.rowStartLine);
          if (record) {
            yield record;
          }
        } catch (_parseError) {
          // If that fails, try to recover individual lines after the first bad one
          for (let i = 1; i < accumulatedLines.length; i++) {
            const recoveryLine = accumulatedLines[i];
            if (!recoveryLine || !recoveryLine.trim()) continue;

            try {
              const fields = parseCSVRow(recoveryLine, this.delimiter, this.quote, this.escapeChar);

              // Validate field sizes
              for (const field of fields) {
                validateFieldSize(field, MAX_FIELD_SIZE);
              }

              // Handle ragged rows if needed
              let processedFields = fields;
              if (state.expectedColumns > 0 && fields.length !== state.expectedColumns) {
                processedFields = handleRaggedRow(
                  fields,
                  state.expectedColumns,
                  this.options.raggedRows
                );
              }

              const record = this.createRecord(processedFields, state.rowStartLine + i);
              if (record) {
                yield record;
              }
            } catch (recoveryError) {
              // Report but continue trying other lines
              if (this.options.onError) {
                this.options.onError(
                  `Failed to recover line ${state.rowStartLine + i}: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
                  state.rowStartLine + i
                );
              }
            }
          }
        }
      } else {
        // No error handler - throw the error
        throw new DSVParseError(errorMsg, state.rowStartLine, undefined, state.accumulatedRow);
      }

      // Reset state
      state.accumulatedRow = "";
      state.inMultiLineField = false;
      state.linesInCurrentField = 0;
    }
  }

  /**
   * Process a chunk of streaming data
   * Handles partial lines that span chunk boundaries
   * Returns: yields DSVRecords, buffer must be managed externally
   */
  private async *processChunk(
    chunk: string,
    state: DSVParserState,
    bufferRef: { value: string }
  ): AsyncIterable<DSVRecord> {
    // Add chunk to buffer
    bufferRef.value += chunk;

    // Split into lines, keeping the last (potentially incomplete) line
    const lines = bufferRef.value.split(/\r?\n/);
    const lastLine = lines.pop() || "";

    // Clean null bytes from all complete lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line) {
        lines[i] = line.replace(/\0/g, "");
      }
    }

    // Process complete lines if we have any
    if (lines.length > 0) {
      yield* this.processLines(lines, state);
    }

    // Update the buffer to contain only the incomplete last line
    bufferRef.value = lastLine;
  }

  /**
   * Parse string input
   */
  async *parseString(data: string): AsyncIterable<DSVRecord> {
    // Use state object for resumable parsing
    const state = this.createInitialState();

    // Unified parsing logic that handles both multi-line fields and error recovery
    const lines = data.split(/\r?\n/);

    // Clean null bytes from all lines and remove BOM from first line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line) {
        lines[i] = line.replace(/\0/g, ""); // Remove null bytes
      }
    }

    // Remove BOM from first line if present
    if (lines[0]) {
      lines[0] = removeBOM(lines[0]);
    }

    // Auto-detect delimiter if needed
    if ((this.options.autoDetect || this.options.autoDetectDelimiter) && !this.delimiter) {
      const sampleLines = lines.slice(0, Math.min(10, lines.length));
      const detected = detectDelimiter(sampleLines);
      if (detected) {
        this.delimiter = detected;
      } else {
        // Fall back to comma when detection fails
        console.warn("Could not auto-detect delimiter, defaulting to comma (,)");
        this.delimiter = ",";
      }
    }

    // Auto-detect headers if needed
    if (
      (this.options.autoDetect || this.options.autoDetectHeaders) &&
      this.options.header === undefined
    ) {
      const sampleLines = lines.slice(0, Math.min(5, lines.length));
      const hasHeaders = detectHeaders(sampleLines, this.delimiter);
      this.options.header = hasHeaders;
    }

    // Delegate to processLines for the actual parsing
    yield* this.processLines(lines, state);
  }

  /**
   * Parse stream with automatic compression detection
   * @param stream - Potentially compressed stream
   * @returns AsyncIterable of DSV records
   * @deprecated Use parse() which now handles compression automatically
   */
  async *parseCompressed(stream: ReadableStream<Uint8Array>): AsyncIterable<DSVRecord> {
    // parse() now handles compression automatically via BufferedStreamReader
    yield* this.parse(stream);
  }

  /**
   * Parse stream input with true streaming (no full buffering)
   */
  async *parse(stream: ReadableStream<Uint8Array>): AsyncIterable<DSVRecord> {
    // Use BufferedStreamReader to detect compression
    const bufferedReader = new BufferedStreamReader(stream);
    const magicBytes = await bufferedReader.peek(4);

    const detection = CompressionDetector.fromMagicBytes(magicBytes);
    let processStream = bufferedReader.stream();

    if (detection.format !== "none" && detection.confidence > 0.5) {
      processStream = await this.decompressStream(processStream, detection.format);
    }

    // Continue with normal parsing
    const reader = processStream.getReader();
    const decoder = new TextDecoder();
    const state = this.createInitialState();
    const bufferRef = { value: "" };
    let delimiterDetected = false;
    const initialLines: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        // Decode chunk
        const chunk = decoder.decode(value, { stream: true });

        // Handle delimiter auto-detection if needed
        if (
          !delimiterDetected &&
          (this.options.autoDetect || this.options.autoDetectDelimiter) &&
          !this.delimiter
        ) {
          // Stop accumulating if we've hit the limit - fall back to defaults
          if (initialLines.length >= MAX_DETECTION_LINES) {
            console.warn(
              `Reached ${MAX_DETECTION_LINES} line limit for delimiter detection, using defaults`
            );
            this.delimiter = ",";
            delimiterDetected = true;
            // Process accumulated lines and continue
            yield* this.processLines(initialLines, state);
            initialLines.length = 0;
          } else {
            // Accumulate lines for delimiter detection (with limit)
            bufferRef.value += chunk;
            const lines = bufferRef.value.split(/\r?\n/);

            // Keep last incomplete line in buffer
            bufferRef.value = lines.pop() || "";

            // Only accumulate up to the limit
            const linesToAdd = lines.slice(0, MAX_DETECTION_LINES - initialLines.length);
            initialLines.push(...linesToAdd);
          }

          // Clean null bytes and BOM from initial lines
          for (let i = 0; i < initialLines.length; i++) {
            const line = initialLines[i];
            if (line) {
              let cleanedLine = line.replace(/\0/g, "");
              // Remove BOM from the very first line
              if (i === 0) {
                cleanedLine = removeBOM(cleanedLine);
              }
              initialLines[i] = cleanedLine;
            }
          }

          // Try to detect delimiter if we have enough lines
          if (initialLines.length >= 5) {
            const detected = detectDelimiter(initialLines.slice(0, 5));
            if (detected) {
              this.delimiter = detected;
            } else {
              // Fall back to comma when detection fails
              console.warn(
                "Could not auto-detect delimiter from streaming data, defaulting to comma (,)"
              );
              this.delimiter = ",";
            }
            delimiterDetected = true;

            // Auto-detect headers if needed
            if (
              (this.options.autoDetect || this.options.autoDetectHeaders) &&
              this.options.header === undefined
            ) {
              const hasHeaders = detectHeaders(initialLines.slice(0, 5), this.delimiter);
              this.options.header = hasHeaders;
            }

            // Process the accumulated initial lines
            yield* this.processLines(initialLines, state);
            initialLines.length = 0; // Clear array
          }
        } else {
          // Normal processing after delimiter is known
          yield* this.processChunk(chunk, state, bufferRef);
        }
      }

      // Process any remaining initial lines if delimiter detection didn't complete
      if (initialLines.length > 0) {
        if (!this.delimiter) {
          const detected = detectDelimiter(initialLines);
          if (detected) {
            this.delimiter = detected;
          } else {
            // Fall back to comma when detection fails
            console.warn("Could not auto-detect delimiter, defaulting to comma (,)");
            this.delimiter = ",";
          }
        }

        // Auto-detect headers if needed
        if (
          (this.options.autoDetect || this.options.autoDetectHeaders) &&
          this.options.header === undefined
        ) {
          const hasHeaders = detectHeaders(initialLines.slice(0, 5), this.delimiter);
          this.options.header = hasHeaders;
        }

        yield* this.processLines(initialLines, state);
      }

      // Process any remaining data in buffer
      if (bufferRef.value) {
        // Process the last line if there's anything left
        yield* this.processLines([bufferRef.value], state);
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Create a DSVRecord from parsed fields
   */
  private createRecord(fields: string[], lineNumber: number): DSVRecord | null {
    if (!this.headers) {
      // Use default columns for sequence data
      this.headers = ["id", "sequence", "quality", "description"];
    }

    const record: DSVRecord = {
      format: "dsv",
      id: fields[0] || "",
    };

    // Map values to columns
    this.headers.forEach((col, i) => {
      // Set empty string for missing fields (padding)
      record[col] = fields[i] !== undefined ? fields[i] : "";
    });

    // Compute statistics if requested
    if (this.options.computeStats && record.sequence) {
      record.length = record.sequence.length;

      if (this.options.includeGC) {
        record.gc = calculateGC(record.sequence);
      }

      if (this.options.includeGCSkew) {
        // GC skew calculation to be implemented
        // record.gcSkew = calculateGCSkew(record.sequence);
      }

      if (this.options.includeBaseCount) {
        record.baseCount = calculateBaseCount(record.sequence);
      }
    }

    return record;
  }
}

// =============================================================================
// WRITER IMPLEMENTATION
// =============================================================================

/**
 * DSV writer for outputting genomic data
 * RFC 4180 compliant with Excel protection for gene names
 *
 * @example Basic writing
 * ```typescript
 * const writer = new DSVWriter({ delimiter: ",", excelCompatible: true });
 * const csv = writer.formatRecords(records);
 * ```
 *
 * @example Writing compressed files
 * ```typescript
 * // Automatically compress based on file extension
 * const writer = new CSVWriter();
 * await writer.writeFile("genes.csv.gz", sequences); // Creates gzipped CSV
 *
 * // Excel-safe compressed output
 * const safeWriter = new TSVWriter({ excelCompatible: true });
 * await safeWriter.writeFile("expression.tsv.gz", data); // Protects gene names
 * ```
 */
export class DSVWriter {
  private readonly delimiter: string;
  private readonly quote: string;
  private readonly escapeChar: string;
  private readonly header: boolean;
  private readonly columns: string[];
  private readonly lineEnding: string;
  private readonly quoteAll: boolean;
  private readonly excelCompatible: boolean;
  private readonly compression: "gzip" | "zstd" | null;
  private readonly compressionLevel: number;

  constructor(options: DSVWriterOptions = {}) {
    // Validate options
    const validation = DSVWriterOptionsSchema(options);
    if (validation instanceof type.errors) {
      throw new ValidationError(`Invalid DSV writer options: ${validation.summary}`);
    }

    this.delimiter = options.delimiter || "\t";
    this.quote = options.quote || '"';
    this.escapeChar = options.escapeChar || '"';
    this.header = options.header !== false;
    this.columns = options.columns || ["id", "sequence", "quality", "description"];
    this.lineEnding = options.lineEnding || "\n";
    this.quoteAll = options.quoteAll || false;
    this.excelCompatible = options.excelCompatible || false;
    this.compression = options.compression || null;
    this.compressionLevel = options.compressionLevel || (options.compression === "zstd" ? 3 : 6);
  }

  /**
   * Format a single field with proper escaping
   */
  private formatField(value: string | number | boolean | null | undefined): string {
    if (value == null) return "";

    let field = String(value);
    let alreadyQuoted = false;

    // Excel protection for gene names
    if (this.excelCompatible) {
      const protectedField = protectFromExcel(field);
      alreadyQuoted =
        protectedField !== field && protectedField.startsWith('"') && protectedField.endsWith('"');
      field = protectedField;
    }

    // If already quoted by Excel protection, return as-is
    if (alreadyQuoted) {
      return field;
    }

    // Check if field needs quoting
    const needsQuoting =
      this.quoteAll ||
      field.includes(this.delimiter) ||
      field.includes(this.quote) ||
      field.includes("\n") ||
      field.includes("\r");

    if (needsQuoting) {
      // Escape quotes by doubling them (RFC 4180)
      if (this.escapeChar === this.quote) {
        field = field.replace(new RegExp(this.quote, "g"), this.quote + this.quote);
      } else {
        field = field.replace(new RegExp(this.quote, "g"), this.escapeChar + this.quote);
      }
      return this.quote + field + this.quote;
    }

    return field;
  }

  /**
   * Format a row of fields
   */
  formatRow(fields: (string | number | boolean | null | undefined)[]): string {
    return fields.map((field) => this.formatField(field)).join(this.delimiter);
  }

  /**
   * Format a DSVRecord into a row
   */
  formatRecord(record: DSVRecord, options: DSVWriterOptions = {}): string {
    const fields: (string | number | boolean | null | undefined)[] = [];

    // Use specified columns or extract from record
    const columns = options.columns || this.columns;

    for (const col of columns) {
      let value = record[col];

      // Compute statistics if requested
      if (value === undefined) {
        if (col === "length" && record.sequence) {
          value = record.sequence.length;
        } else if (col === "gc" && options.includeGC && record.sequence) {
          // We need to import gcContent function
          value = calculateGC(record.sequence);
        } else if (col === "baseCount" && options.includeBaseCount && record.sequence) {
          value = JSON.stringify(calculateBaseCount(record.sequence));
        }
      }

      fields.push(value);
    }

    return this.formatRow(fields);
  }

  /**
   * Format multiple records with optional header
   */
  formatRecords(records: DSVRecord[], options: DSVWriterOptions = {}): string {
    const lines: string[] = [];

    // Add header if requested
    if (this.header) {
      lines.push(this.formatRow(this.columns));
    }

    // Add data rows
    for (const record of records) {
      lines.push(this.formatRecord(record, options));
    }

    return lines.join(this.lineEnding);
  }

  /**
   * Write records to stream
   */
  async writeToStream(
    records: AsyncIterable<DSVRecord>,
    stream: WritableStream<Uint8Array>,
    options: DSVWriterOptions = {}
  ): Promise<void> {
    const writer = stream.getWriter();
    const encoder = new TextEncoder();
    let headerWritten = false;

    try {
      for await (const record of records) {
        // Write header on first record
        if (!headerWritten && this.header) {
          const headerRow = this.formatRow(this.columns);
          await writer.write(encoder.encode(headerRow + this.lineEnding));
          headerWritten = true;
        }

        const row = this.formatRecord(record, options);
        await writer.write(encoder.encode(row + this.lineEnding));
      }
    } finally {
      writer.releaseLock();
    }
  }

  /**
   * Write records to a file with optional compression
   * @param path - File path to write to
   * @param records - Records to write
   */
  async writeFile(path: string, records: DSVRecord[]): Promise<void> {
    const content = this.formatRecords(records);
    const { writeFile } = await import("fs/promises");

    // Auto-detect compression from file extension if not specified
    let compression = this.compression;
    if (!compression && path.endsWith(".gz")) {
      compression = "gzip";
    } else if (!compression && path.endsWith(".zst")) {
      compression = "zstd";
    }

    if (compression === "gzip") {
      // Use Bun's built-in gzip compression
      const { gzipSync } = await import("bun");
      const compressed = gzipSync(content);
      await writeFile(path, compressed);
    } else if (compression === "zstd") {
      // Zstd not built into Bun, would need external library
      throw new Error("Zstd compression writing not yet available - use gzip instead");
    } else {
      // Write uncompressed
      await writeFile(path, content, "utf-8");
    }
  }
}

// =============================================================================
// CONVENIENCE CLASSES
// =============================================================================

/**
 * CSV Parser - convenience wrapper with comma delimiter
 */
export class CSVParser extends DSVParser {
  constructor(options: Omit<DSVParserOptions, "delimiter"> = {}) {
    super({ ...options, delimiter: "," });
  }

  override getFormatName(): string {
    return "CSV";
  }
}

/**
 * TSV Parser - convenience wrapper with tab delimiter
 */
export class TSVParser extends DSVParser {
  constructor(options: Omit<DSVParserOptions, "delimiter"> = {}) {
    super({ ...options, delimiter: "\t" });
  }

  override getFormatName(): string {
    return "TSV";
  }
}

/**
 * CSV Writer - convenience wrapper with comma delimiter
 */
export class CSVWriter extends DSVWriter {
  constructor(options: Omit<DSVWriterOptions, "delimiter"> = {}) {
    super({ ...options, delimiter: "," });
  }
}

/**
 * TSV Writer - convenience wrapper with tab delimiter
 */
export class TSVWriter extends DSVWriter {
  constructor(options: Omit<DSVWriterOptions, "delimiter"> = {}) {
    super({ ...options, delimiter: "\t" });
  }
}

// =============================================================================
// UTILITY FUNCTIONS (Tree-shakeable)
// =============================================================================

/**
 * Remove BOM (Byte Order Mark) from string
 * Handles UTF-8, UTF-16 BE, and UTF-16 LE BOMs
 *
 * @param text - Text that may contain BOM
 * @returns Text without BOM
 */
export function removeBOM(text: string): string {
  // UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  // UTF-16 BE BOM
  if (text.charCodeAt(0) === 0xfe && text.charCodeAt(1) === 0xff) {
    return text.slice(2);
  }
  // UTF-16 LE BOM
  if (text.charCodeAt(0) === 0xff && text.charCodeAt(1) === 0xfe) {
    return text.slice(2);
  }
  return text;
}

/**
 * Normalize line endings to Unix format (LF)
 * Handles Windows (CRLF), Classic Mac (CR), and Unix (LF)
 *
 * @param text - Text with mixed line endings
 * @returns Text with normalized line endings
 */
export function normalizeLineEndings(text: string): string {
  // Replace CRLF with LF first, then CR with LF
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Auto-detect delimiter from sample lines
 * Tests common delimiters and returns most likely one
 *
 * @param lines - Sample lines to analyze
 * @returns Detected delimiter or null if unclear
 */
export function detectDelimiter(
  lines: string[],
  candidates: string[] = [",", "\t", "|", ";"] // Common DSV delimiters
): string | null {
  const scores = new Map<string, number>();

  for (const delimiter of candidates) {
    let consistentCount = 0;
    let lastCount = -1;
    const counts: number[] = [];

    for (const line of lines) {
      // Skip empty lines and comments
      if (!line.trim() || line.startsWith("#")) continue;

      const count = line.split(delimiter).length - 1;
      if (count > 0) {
        counts.push(count);
        if (lastCount === -1) {
          lastCount = count;
        } else if (lastCount === count) {
          consistentCount++;
        }
      }
    }

    // Enhanced scoring: consider consistency, average count, and variance
    if (counts.length > 0) {
      const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
      const variance =
        counts.reduce((sum, val) => sum + Math.pow(val - avgCount, 2), 0) / counts.length;

      // Score based on consistency, average count, and low variance
      // Higher consistency, higher avg count, and lower variance = better score
      const score = consistentCount * avgCount * (1 / (1 + variance));
      scores.set(delimiter, score);
    } else {
      scores.set(delimiter, 0);
    }
  }

  // Return delimiter with highest score
  let bestDelimiter: string | null = null;
  let bestScore = 0;

  for (const [delimiter, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestScore > 0 ? bestDelimiter : null;
}

/**
 * Detect if the first row contains headers
 *
 * Uses heuristics to determine if the first row contains column names:
 * - Checks for common genomic header keywords (gene, chr, pos, seq, etc.)
 * - Compares numeric content between first and second rows
 * - Returns false if all values in first row are numeric
 *
 * @param lines - Sample lines from the file (minimum 2 required)
 * @param delimiter - The delimiter to use for parsing
 * @returns True if first row appears to be headers, false otherwise
 *
 * @example
 * ```typescript
 * const hasHeaders = detectHeaders(
 *   ["gene,expression", "BRCA1,5.2"],
 *   ","
 * ); // Returns true
 *
 * const noHeaders = detectHeaders(
 *   ["1,2,3", "4,5,6"],
 *   ","
 * ); // Returns false
 * ```
 */
export function detectHeaders(lines: string[], delimiter: string): boolean {
  if (lines.length < 2) return false;

  const firstLine = lines[0];
  const secondLine = lines[1];
  if (!firstLine || !secondLine) return false;

  const firstRow = parseCSVRow(firstLine, delimiter);
  const secondRow = parseCSVRow(secondLine, delimiter);

  // If only single column, default to no headers (likely sequence data)
  if (firstRow.length === 1 && secondRow.length === 1) {
    // Unless it's clearly a header keyword
    const firstValue = firstRow[0];
    if (!firstValue) return false;
    const headerKeywords = ["id", "sequence", "gene", "name", "seq", "quality", "chr", "pos"];
    return headerKeywords.some((keyword) => firstValue.toLowerCase() === keyword);
  }

  // Check if first row looks like headers:
  // 1. All values are non-numeric or contain typical header patterns
  // 2. Pattern differs from subsequent data rows
  // 3. No special characters except underscores/hyphens

  const looksLikeHeaders = firstRow.every((field) => {
    // Check for common header patterns
    if (
      /^(id|name|seq|sequence|qual|quality|chr|chrom|chromosome|pos|position|ref|alt|gene|expression)$/i.test(
        field
      )
    ) {
      return true;
    }
    // Check if non-numeric
    return isNaN(Number(field)) && !/^[0-9.+-]+$/.test(field);
  });

  // Compare with second row pattern
  const secondRowNumeric = secondRow.filter((f) => !isNaN(Number(f))).length;
  const firstRowNumeric = firstRow.filter((f) => !isNaN(Number(f))).length;

  // Headers are detected if first row looks like headers AND:
  // - Second row has more numeric fields, OR
  // - Both have same numeric count but first row contains header keywords
  return looksLikeHeaders && secondRowNumeric >= firstRowNumeric;
}

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
 * Validate field size for memory safety
 * Prevents memory exhaustion from malformed files
 *
 * @param field - Field to validate
 * @param maxSize - Maximum allowed size in bytes
 * @throws {ValidationError} if field exceeds size limit
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

/**
 * Handle ragged rows (rows with inconsistent column counts)
 *
 * @param fields - Parsed fields from a row
 * @param expectedColumns - Expected number of columns
 * @param handling - How to handle mismatch: "error", "pad", "truncate", or "ignore"
 * @returns Adjusted fields array
 */
export function handleRaggedRow(
  fields: string[],
  expectedColumns: number,
  handling: "error" | "pad" | "truncate" | "ignore" = "pad"
): string[] {
  if (fields.length === expectedColumns || handling === "ignore") {
    return fields;
  }

  switch (handling) {
    case "error":
      throw new DSVParseError(
        `Row has ${fields.length} columns, expected ${expectedColumns}`,
        undefined,
        undefined
      );
    case "pad":
      // Add empty fields
      while (fields.length < expectedColumns) {
        fields.push("");
      }
      return fields;
    case "truncate":
      // Remove extra fields
      return fields.slice(0, expectedColumns);
    default:
      return fields;
  }
}

/**
 * Calculate base counts for a sequence
 *
 * @param sequence - DNA/RNA sequence
 * @returns Map of base to count
 */
export function calculateBaseCount(sequence: string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const base of sequence.toUpperCase()) {
    counts[base] = (counts[base] || 0) + 1;
  }

  return counts;
}

/**
 * Calculate GC content percentage
 * Reuses existing core function
 *
 * @param sequence - DNA/RNA sequence
 * @returns GC percentage (0-100)
 */
export function calculateGC(sequence: string): number {
  // Handle empty sequence
  if (!sequence || sequence.length === 0) {
    return 0;
  }

  // Count only A, T, C, G (ignore ambiguous bases)
  const upper = sequence.toUpperCase();
  let gcCount = 0;
  let totalBases = 0;

  for (let i = 0; i < upper.length; i++) {
    const base = upper[i];
    if (base === "G" || base === "C") {
      gcCount++;
      totalBases++;
    } else if (base === "A" || base === "T" || base === "U") {
      totalBases++;
    }
    // Ignore all other characters including N and ambiguous codes
  }

  return totalBases === 0 ? 0 : (gcCount / totalBases) * 100;
}

/**
 * Calculate GC skew
 * GC skew = (G - C) / (G + C)
 *
 * @param sequence - DNA sequence
 * @returns GC skew value (-1 to 1)
 */
export function calculateGCSkew(sequence: string): number {
  const seq = sequence.toUpperCase();
  let g = 0;
  let c = 0;

  for (const base of seq) {
    if (base === "G") g++;
    else if (base === "C") c++;
  }

  if (g + c === 0) return 0;
  return (g - c) / (g + c);
}

/**
 * Count unescaped quotes in a line
 * Escaped quotes (doubled when escape==quote) are not counted
 *
 * @param line - The line to check
 * @param quote - Quote character (usually ")
 * @param escapeChar - Escape character (usually same as quote)
 * @returns Number of unescaped quotes
 */
function countUnescapedQuotes(line: string, quote: string, escapeChar: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === quote) {
      // Check if it's escaped
      if (escapeChar === quote && line[i + 1] === quote) {
        i++; // Skip the escaped quote
      } else {
        count++;
      }
    }
  }
  return count;
}

/**
 * Check if quotes are balanced in a line
 * Uses countUnescapedQuotes to determine if all quotes are properly closed
 *
 * @param line - The line to check
 * @param quote - Quote character (usually ")
 * @param escapeChar - Escape character (usually same as quote)
 * @returns true if quotes are balanced (even count), false otherwise
 */
function hasBalancedQuotes(line: string, quote: string, escapeChar: string): boolean {
  const quoteCount = countUnescapedQuotes(line, quote, escapeChar);
  return quoteCount % 2 === 0;
}

/**
 * Parse CSV row with proper RFC 4180 state machine
 * Handles quoted fields, escaped quotes, and multi-line fields
 *
 * @param line - CSV line to parse
 * @param delimiter - Field delimiter
 * @param quote - Quote character
 * @param escapeChar - Escape character (usually same as quote)
 * @returns Array of parsed fields
 */
export function parseCSVRow(
  line: string,
  delimiter: string = ",",
  quote: string = '"',
  escapeChar: string = '"'
): string[] {
  const fields: string[] = [];
  let currentField = "";
  let state = CSVParseState.FIELD_START;
  let i = 0;

  while (i < line.length) {
    const char = line[i]!; // Safe because i < line.length
    const nextChar = line[i + 1];

    switch (state) {
      case CSVParseState.FIELD_START:
        if (char === quote) {
          // Start of quoted field
          state = CSVParseState.QUOTED_FIELD;
          i++;
        } else if (char === delimiter) {
          // Empty field
          fields.push("");
          i++;
          // Stay in FIELD_START
        } else {
          // Start of unquoted field
          currentField = char;
          state = CSVParseState.UNQUOTED_FIELD;
          i++;
        }
        break;

      case CSVParseState.UNQUOTED_FIELD:
        if (char === delimiter) {
          // End of field
          fields.push(currentField);
          currentField = "";
          state = CSVParseState.FIELD_START;
          i++;
        } else {
          // Continue building field
          currentField += char;
          i++;
        }
        break;

      case CSVParseState.QUOTED_FIELD:
        if (char === quote) {
          if (escapeChar === quote && nextChar === quote) {
            // Escaped quote (doubled)
            currentField += quote;
            i += 2; // Skip both quotes
          } else {
            // End quote
            state = CSVParseState.QUOTE_IN_QUOTED;
            i++;
          }
        } else {
          // Regular character in quoted field
          currentField += char;
          i++;
        }
        break;

      case CSVParseState.QUOTE_IN_QUOTED:
        if (char === delimiter) {
          // Field ended properly
          fields.push(currentField);
          currentField = "";
          state = CSVParseState.FIELD_START;
          i++;
        } else if (char === quote && escapeChar === quote) {
          // This was actually an escaped quote, go back to quoted field
          currentField += quote;
          state = CSVParseState.QUOTED_FIELD;
          i++;
        } else {
          // Malformed CSV - characters after closing quote
          // Be lenient and treat as part of field
          currentField += char;
          state = CSVParseState.UNQUOTED_FIELD;
          i++;
        }
        break;
    }
  }

  // Handle final field
  if (state === CSVParseState.QUOTED_FIELD) {
    // Unclosed quote - throw error
    throw new DSVParseError("Unclosed quote in CSV field", undefined, undefined, line);
  } else if (state === CSVParseState.UNQUOTED_FIELD || state === CSVParseState.QUOTE_IN_QUOTED) {
    fields.push(currentField);
  } else if (state === CSVParseState.FIELD_START && line.endsWith(delimiter)) {
    // Trailing delimiter means empty final field
    fields.push("");
  }

  return fields;
}

/**
 * Parse multiple CSV lines handling line breaks in quoted fields
 *


// =============================================================================
// FORMAT UTILITIES
// =============================================================================

/**
 * DSV format utilities similar to FastaUtils, FastqUtils
 * Provides convenient methods for format detection, validation, and analysis
 */
export const DSVUtils = {
  /**
   * Detect DSV format and delimiter from content
   */
  detectFormat(content: string): {
    format: "csv" | "tsv" | "psv" | "ssv" | "dsv";
    delimiter: string;
  } {
    const lines = content.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
    if (lines.length === 0) {
      return { format: "dsv", delimiter: "\t" };
    }

    // Count delimiter occurrences in first few lines
    const delimiters = [
      { char: ",", format: "csv" as const },
      { char: "\t", format: "tsv" as const },
      { char: "|", format: "psv" as const },
      { char: ";", format: "ssv" as const },
    ];

    const counts = delimiters.map((d) => {
      const sampleLines = lines.slice(0, Math.min(5, lines.length));
      let totalCount = 0;
      let consistent = true;
      let lastCount = -1;

      for (const line of sampleLines) {
        const count = line.split(d.char).length - 1;
        totalCount += count;
        if (lastCount >= 0 && count !== lastCount) {
          consistent = false;
        }
        lastCount = count;
      }

      return {
        ...d,
        count: totalCount,
        consistent,
        avgPerLine: totalCount / sampleLines.length,
      };
    });

    // Sort by consistency and count
    counts.sort((a, b) => {
      if (a.consistent && !b.consistent) return -1;
      if (!a.consistent && b.consistent) return 1;
      return b.avgPerLine - a.avgPerLine;
    });

    const best = counts[0];
    if (best && best.avgPerLine > 0) {
      return { format: best.format, delimiter: best.char };
    }

    return { format: "dsv", delimiter: "\t" };
  },

  /**
   * Validate DSV structure and consistency
   */
  validate(
    content: string,
    options: { delimiter?: string } = {}
  ): {
    valid: boolean;
    errors: string[];
    warnings: string[];
    stats: {
      rows: number;
      columns: number;
      raggedRows: number[];
      emptyFields: number;
    };
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const raggedRows: number[] = [];
    let emptyFields = 0;

    const delimiter = options.delimiter || this.detectFormat(content).delimiter;
    const lines = content.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));

    if (lines.length === 0) {
      errors.push("No data rows found");
      return {
        valid: false,
        errors,
        warnings,
        stats: { rows: 0, columns: 0, raggedRows: [], emptyFields: 0 },
      };
    }

    // Parse first row to get expected column count
    const firstRowFields = parseCSVRow(lines[0]!, delimiter);
    const expectedColumns = firstRowFields.length;

    // Check all rows
    for (let i = 0; i < lines.length; i++) {
      try {
        const fields = parseCSVRow(lines[i]!, delimiter);

        // Check for ragged rows
        if (fields.length !== expectedColumns) {
          raggedRows.push(i + 1);
          warnings.push(`Row ${i + 1} has ${fields.length} columns, expected ${expectedColumns}`);
        }

        // Count empty fields
        for (const field of fields) {
          if (field === "") emptyFields++;
        }
      } catch (error) {
        errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Add warnings for potential issues
    if (emptyFields > lines.length * expectedColumns * 0.5) {
      warnings.push("More than 50% of fields are empty");
    }

    if (raggedRows.length > lines.length * 0.1) {
      warnings.push("More than 10% of rows have inconsistent column counts");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats: {
        rows: lines.length,
        columns: expectedColumns,
        raggedRows,
        emptyFields,
      },
    };
  },

  /**
   * Count columns in DSV data
   */
  countColumns(content: string, options: { delimiter?: string } = {}): number {
    const delimiter = options.delimiter || this.detectFormat(content).delimiter;
    const lines = content.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));

    if (lines.length === 0) return 0;

    try {
      const fields = parseCSVRow(lines[0]!, delimiter);
      return fields.length;
    } catch {
      return 0;
    }
  },

  /**
   * Detect delimiter from content
   */
  detectDelimiter(content: string): string | null {
    const lines = content.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
    return detectDelimiter(lines);
  },

  /**
   * Extract header row if present
   */
  extractHeaders(content: string, options: { delimiter?: string } = {}): string[] | null {
    const delimiter = options.delimiter || this.detectFormat(content).delimiter;
    const lines = content.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));

    if (lines.length === 0) return null;

    try {
      return parseCSVRow(lines[0]!, delimiter);
    } catch {
      return null;
    }
  },

  /**
   * Get summary statistics for DSV data
   */
  summarize(
    content: string,
    options: { delimiter?: string } = {}
  ): {
    format: string;
    delimiter: string;
    rows: number;
    columns: number;
    headers: string[] | null;
    sampleData: string[][];
  } {
    const detection = this.detectFormat(content);
    const delimiter = options.delimiter || detection.delimiter;
    const lines = content.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
    const headers = this.extractHeaders(content, { delimiter });

    // Parse sample rows
    const sampleData: string[][] = [];
    const sampleSize = Math.min(5, lines.length);
    const startIndex = headers ? 1 : 0;

    for (let i = startIndex; i < startIndex + sampleSize && i < lines.length; i++) {
      try {
        const fields = parseCSVRow(lines[i]!, delimiter);
        sampleData.push(fields);
      } catch {
        // Skip malformed rows in sample
      }
    }

    return {
      format: detection.format,
      delimiter,
      rows: lines.length,
      columns: headers?.length || this.countColumns(content, { delimiter }),
      headers,
      sampleData,
    };
  },

  /**
   * Comprehensive format detection with confidence scoring
   * Analyzes input to detect delimiter, headers, and compression
   *
   * @example
   * ```typescript
   * // Detect format from string
   * const csvInfo = await DSVUtils.sniff("gene,expr\nBRCA1,5.2");
   * // { delimiter: ",", hasHeaders: true, compression: null, confidence: 0.9 }
   *
   * // Detect compression from bytes
   * const gzipInfo = await DSVUtils.sniff(gzippedData);
   * // { delimiter: null, hasHeaders: false, compression: "gzip", confidence: 1.0 }
   *
   * // Detect from stream
   * const stream = await FileReader.createStream("data.csv.gz");
   * const streamInfo = await DSVUtils.sniff(stream);
   * // { delimiter: ",", hasHeaders: true, compression: "gzip", confidence: 0.85 }
   * ```
   */
  async sniff(input: string | ReadableStream<Uint8Array> | Uint8Array): Promise<{
    delimiter: string | null;
    hasHeaders: boolean;
    compression: CompressionFormat | null;
    confidence: number;
  }> {
    const result = {
      delimiter: null as string | null,
      hasHeaders: false,
      compression: null as CompressionFormat | null,
      confidence: 0,
    };

    // Handle different input types
    let content: string = "";
    let bytes: Uint8Array | null = null;

    if (typeof input === "string") {
      content = input;
      bytes = new TextEncoder().encode(input.slice(0, 4));
    } else if (input instanceof Uint8Array) {
      bytes = input.slice(0, 4);
      content = new TextDecoder().decode(input.slice(0, 10000)); // Sample first 10KB
    } else if (input instanceof ReadableStream) {
      const reader = input.getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      if (value) {
        bytes = value.slice(0, 4);
        content = new TextDecoder().decode(value.slice(0, 10000));
      }
    }

    // Detect compression from magic bytes
    if (bytes && bytes.length >= 2) {
      const detection = CompressionDetector.fromMagicBytes(bytes);
      result.compression = detection.format !== "none" ? detection.format : null;
      if (detection.confidence) {
        result.confidence = Math.max(result.confidence, detection.confidence * 0.5);
      }
    }

    // Detect delimiter and headers from content
    if (content) {
      const lines = content.split(/\r?\n/).filter((l) => l);

      // Detect delimiter
      const detectedDelimiter = detectDelimiter(lines);
      if (detectedDelimiter) {
        result.delimiter = detectedDelimiter;
        result.confidence = Math.max(result.confidence, 0.7);
      }

      // Detect headers
      if (detectedDelimiter && lines.length >= 2) {
        result.hasHeaders = detectHeaders(lines, detectedDelimiter);
        if (result.hasHeaders) {
          result.confidence = Math.min(1.0, result.confidence + 0.2);
        }
      }
    }

    return result;
  },
};
