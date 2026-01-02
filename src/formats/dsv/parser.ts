/**
 * @module formats/dsv/parser
 * @description Core DSV (Delimiter-Separated Values) parser implementation
 *
 * Provides streaming CSV/TSV parsing with:
 * - RFC 4180 compliance for CSV format
 * - Multi-line field support
 * - Automatic delimiter and header detection
 * - Transparent compression support (gzip/zstd)
 * - Excel protection for genomic data
 * - Configurable error recovery
 */

// =============================================================================
// IMPORTS
// =============================================================================

import { type } from "arktype";
import { CompressionDetector } from "../../compression/detector";
import { wrapStream as wrapGzipStream } from "../../compression/gzip";
import { wrapStream as wrapZstdStream } from "../../compression/zstd";
import { CompressionError, DSVParseError, FileError, ValidationError } from "../../errors";
import { createStream } from "../../io/file-reader";
import type { CompressionFormat } from "../../types";
import { AbstractParser } from "../abstract-parser";

// Import from local DSV modules
import {
  DEFAULT_DELIMITERS,
  DEFAULT_ESCAPE,
  DEFAULT_QUOTE,
  MAX_DETECTION_LINES,
  MAX_FIELD_SIZE,
} from "./constants";
import { detectDelimiter, detectHeaders } from "./detection";
import { hasBalancedQuotes, parseCSVRow } from "./state-machine";
import type { DSVParserOptions, DSVParserState, DSVRecord } from "./types";
import {
  calculateBaseCount,
  calculateGC,
  calculateGCSkew,
  handleRaggedRow,
  removeBOM,
} from "./utils";
import { DSVParserOptionsSchema, validateFieldSize } from "./validation";

// =============================================================================
// CLASSES - HELPER CLASSES
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
// CLASSES - MAIN PARSER
// =============================================================================

/**
 * DSVParser - Core CSV/TSV parser implementation
 *
 * Features:
 * - RFC 4180 compliant CSV parsing
 * - Streaming support for large files
 * - Multi-line field handling with quote escaping
 * - Automatic delimiter and header detection
 * - Transparent compression support (gzip/zstd)
 * - Excel protection for genomic data
 * - Configurable error recovery strategies
 *
 * @extends AbstractParser<DSVRecord, DSVParserOptions>
 */
export class DSVParser extends AbstractParser<DSVRecord, DSVParserOptions> {
  private delimiter: string;
  private quote: string;
  private escapeChar: string;
  private commentPrefix: string;
  private headers: string[] | null = null;

  protected getDefaultOptions(): Partial<DSVParserOptions> {
    return {
      quote: DEFAULT_QUOTE,
      escape: DEFAULT_ESCAPE,
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
    this.delimiter = this.options.autoDetectDelimiter
      ? ""
      : this.options.delimiter || DEFAULT_DELIMITERS.tsv;
    this.quote = this.options.quote ?? DEFAULT_QUOTE;
    this.escapeChar = this.options.escape ?? DEFAULT_ESCAPE;
    this.commentPrefix = this.options.commentPrefix ?? "#";
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
      default:
        return "DSV";
    }
  }

  /**
   * Parse a DSV file from a path
   * Automatically handles compression based on file extension
   */
  async *parseFile(path: string): AsyncIterable<DSVRecord> {
    try {
      const detectionStream = await createStream(path);
      const detection = await CompressionDetector.fromStream(detectionStream);

      const stream = await createStream(path);

      // Decompress if needed
      if (detection.format !== "none") {
        const decompressedStream = this.decompressStream(stream, detection.format);
        yield* this.parse(decompressedStream);
      } else {
        yield* this.parse(stream);
      }
    } catch (error) {
      if (error instanceof FileError) {
        throw error;
      }
      throw new FileError(
        `Failed to parse DSV file: ${error instanceof Error ? error.message : String(error)}`,
        path,
        "read",
        error
      );
    }
  }

  /**
   * Decompress a stream based on detected compression format
   */
  private decompressStream(
    stream: ReadableStream<Uint8Array>,
    format: CompressionFormat
  ): ReadableStream<Uint8Array> {
    try {
      switch (format) {
        case "gzip": {
          return wrapGzipStream(stream);
        }
        case "zstd": {
          return wrapZstdStream(stream);
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
        line.startsWith(this.commentPrefix) &&
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
          state.accumulatedRow += `\n${line}`;
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
   * Parse DSV data from a string
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
      processStream = this.decompressStream(processStream, detection.format);
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
  private createRecord(fields: string[], lineNumber: number): DSVRecord | null {
    if (!this.headers) {
      // Use default columns for sequence data
      this.headers = ["id", "sequence", "quality", "description"];
    }

    const record: DSVRecord = {
      format: "dsv",
      id: fields[0] || "",
      lineNumber,
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
        record.gcSkew = calculateGCSkew(record.sequence);
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
}

// =============================================================================
// CLASSES - CONVENIENCE PARSERS
// =============================================================================

/**
 * CSVParser - Convenience class for CSV files
 * Sets delimiter to comma by default
 */
export class CSVParser extends DSVParser {
  constructor(options: Omit<DSVParserOptions, "delimiter"> = {}) {
    super({ ...options, delimiter: "," });
  }
}

/**
 * TSVParser - Convenience class for TSV files
 * Sets delimiter to tab by default
 */
export class TSVParser extends DSVParser {
  constructor(options: Omit<DSVParserOptions, "delimiter"> = {}) {
    super({ ...options, delimiter: "\t" });
  }
}
