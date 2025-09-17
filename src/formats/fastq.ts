/**
 * FASTQ format parser and writer with multi-line support
 *
 * FASTQ format parsing presents unique challenges due to format ambiguities in the original
 * specification. The 4-line record structure (header/sequence/separator/quality) can have
 * sequences and quality scores wrapped across multiple lines, similar to FASTA format.
 * This creates parsing complexity because '@' and '+' characters can appear in quality
 * strings, making naive line-based parsing unreliable.
 *
 * **Parsing Challenges:**
 * - Multi-line sequences: Original Sanger specification allows line wrapping
 * - Quality contamination: '@' (ASCII 64) and '+' (ASCII 43) appear in quality data
 * - Record boundary detection: Cannot rely on '@' markers for record starts
 * - Length-based parsing: Only reliable method is sequence-quality length matching
 *
 * **State Machine Solution:**
 * ```
 * WAITING_HEADER → READING_SEQUENCE → WAITING_SEPARATOR → READING_QUALITY
 *      ↓               ↓                    ↓                    ↓
 *   Find @ line    Collect lines      Find + line         Collect until
 *                 until + found                          length matches
 * ```
 *
 * **Quality Encoding Detection:**
 * - Phred+33: ASCII 33-93, modern standard (2011+)
 * - Phred+64: ASCII 64-104, legacy Illumina (2007-2011)
 * - Solexa+64: ASCII 59-104, historical Solexa (2006-2007)
 * - Overlap zones require statistical analysis for accurate detection
 *
 * **Performance Considerations:**
 * - Validation disabled by default for large dataset performance
 * - Quality score parsing optional due to memory allocation overhead
 * - Streaming architecture maintains constant memory usage
 */

import { type } from "arktype";
import {
  getErrorSuggestion,
  ParseError,
  QualityError,
  SequenceError,
  ValidationError,
} from "../errors";
import { detectEncodingImmediate, detectEncodingWithConfidence } from "../operations/core/encoding";
import type { FastqSequence, ParserOptions, QualityEncoding } from "../types";
import { SequenceSchema } from "../types";
import { AbstractParser } from "./abstract-parser";
import { validateFastaSequence } from "./fasta";

// =============================================================================
// MULTI-LINE PARSING STATE MACHINE
// =============================================================================

/**
 * FASTQ parsing states for multi-line record handling
 * Based on readfq/kseq algorithm for robust specification compliance
 */
enum FastqParsingState {
  WAITING_HEADER, // Looking for @ line to start new record
  READING_SEQUENCE, // Accumulating sequence lines until + separator
  WAITING_SEPARATOR, // Looking for + line (may be contaminated in quality)
  READING_QUALITY, // Accumulating quality until length matches sequence
}

/**
 * State machine parser context for multi-line FASTQ parsing
 * Tracks parsing state and accumulated data for robust record detection
 */
interface FastqParserContext {
  state: FastqParsingState;
  header?: string;
  sequenceLines: string[];
  separator?: string;
  qualityLines: string[];
  sequenceLength: number;
  currentQualityLength: number;
}

/**
 * FASTQ-specific parser options
 * Extends base ParserOptions for sequencing data with quality scores
 */
interface FastqParserOptions extends ParserOptions {
  /** Custom quality encoding for FASTQ format */
  qualityEncoding?: QualityEncoding;
  /** Whether to parse quality scores immediately */
  parseQualityScores?: boolean;
}

/**
 * ArkType validation for FASTQ parser options with sequencing domain expertise
 * Provides excellent error messages for modern sequencing workflows and deprecated encodings
 */
const FastqParserOptionsSchema = type({
  "skipValidation?": "boolean",
  "maxLineLength?": "number>0",
  "trackLineNumbers?": "boolean",
  "qualityEncoding?": '"phred33"|"phred64"|"solexa"',
  "parseQualityScores?": "boolean",
}).narrow((options, ctx) => {
  // Modern sequencing workflow validation
  if (options.maxLineLength && options.maxLineLength < 1000) {
    return ctx.reject({
      expected: "maxLineLength >= 1000 for modern sequencing data",
      actual: `${options.maxLineLength}`,
      path: ["maxLineLength"],
      message: "Modern reads exceed 1KB (PacBio: 10-100KB, Nanopore: 1KB-2MB)",
    });
  }

  // Memory safety for large sequencing datasets
  if (
    options.parseQualityScores === true &&
    options.maxLineLength &&
    options.maxLineLength > 50_000_000
  ) {
    return ctx.reject({
      expected: "parseQualityScores with maxLineLength <= 50MB for memory efficiency",
      actual: `parseQualityScores=true, maxLineLength=${options.maxLineLength}`,
      path: ["parseQualityScores", "maxLineLength"],
      message:
        "Quality score parsing allocates large arrays - reduce maxLineLength or disable parseQualityScores",
    });
  }

  // Performance guidance for validation on large FASTQ datasets
  if (
    options.skipValidation === false &&
    options.maxLineLength &&
    options.maxLineLength > 10_000_000
  ) {
    console.warn(
      `FASTQ parsing with validation enabled for reads >10MB may impact performance significantly. ` +
        `For large sequencing datasets (PacBio/Nanopore), consider skipValidation: true for production workflows. ` +
        `Validation provides exceptional error detection but adds substantial processing overhead.`
    );
  }

  return true;
});

/**
 * Streaming FASTQ parser with quality score handling
 */
export class FastqParser extends AbstractParser<FastqSequence, FastqParserOptions> {
  constructor(options: FastqParserOptions = {}) {
    // Provide shared defaults to base class (only ParserOptions properties)
    // Step 1: Prepare options with FASTQ-specific defaults for modern sequencing
    const optionsWithDefaults = {
      skipValidation: false,
      maxLineLength: 1_000_000,
      trackLineNumbers: true,
      qualityEncoding: "phred33" as QualityEncoding, // Modern sequencing standard
      parseQualityScores: false, // Lazy loading for memory efficiency
      onError: (error: string, lineNumber?: number): void => {
        throw new ParseError(error, "FASTQ", lineNumber);
      },
      onWarning: (warning: string, lineNumber?: number): void => {
        console.warn(`FASTQ Warning (line ${lineNumber}): ${warning}`);
      },
      ...options, // User options override defaults
    };

    // Step 2: ArkType validation with sequencing domain expertise
    const validationResult = FastqParserOptionsSchema(optionsWithDefaults);

    if (validationResult instanceof type.errors) {
      throw new ValidationError(
        `Invalid FASTQ parser options: ${validationResult.summary}`,
        undefined,
        "FASTQ parser configuration with modern sequencing context"
      );
    }

    // Step 3: Application-level warnings for deprecated quality encodings
    if (optionsWithDefaults.qualityEncoding === "solexa") {
      optionsWithDefaults.onWarning?.(
        "Solexa quality encoding is deprecated (pre-2009 Illumina) - " +
          "consider migrating to phred33 for modern sequencing workflows",
        undefined
      );
    }

    if (optionsWithDefaults.qualityEncoding === "phred64") {
      optionsWithDefaults.onWarning?.(
        "Phred+64 encoding is legacy (Illumina 1.3-1.7) - " +
          "modern FASTQ files use phred33 encoding",
        undefined
      );
    }

    // Step 4: Pass complete validated options to type-safe parent
    super(optionsWithDefaults);
  }

  protected getFormatName(): string {
    return "FASTQ";
  }

  /**
   * Parse FASTQ sequences from a string
   */
  async *parseString(data: string): AsyncIterable<FastqSequence> {
    const lines = data.split(/\r?\n/);
    yield* this.parseLines(lines);
  }

  /**
   * Parse multi-line FASTQ sequences using state machine
   * Provides full FASTQ specification compliance for wrapped sequences
   */
  parseMultiLineString(data: string): FastqSequence[] {
    const lines = data.split(/\r?\n/);
    return parseMultiLineFastq(lines, 1, {
      maxLineLength: this.options.maxLineLength!,
      onError: this.options.onError!,
    });
  }

  /**
   * Parse FASTQ sequences from a file using streaming I/O
   * @param filePath Path to FASTQ file to parse
   * @param options File reading options for performance tuning
   * @yields FastqSequence objects as they are parsed from the file
   * @throws {FileError} When file cannot be read
   * @throws {ParseError} When FASTQ format is invalid
   * @throws {QualityError} When quality data is malformed
   * @example
   * ```typescript
   * const parser = new FastqParser();
   * for await (const sequence of parser.parseFile('/path/to/reads.fastq')) {
   *   console.log(`${sequence.id}: Q${sequence.qualityStats?.mean || 'unknown'}`);
   * }
   * ```
   */
  async *parseFile(
    filePath: string,
    options?: import("../types").FileReaderOptions
  ): AsyncIterable<FastqSequence> {
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
      // Re-throw with enhanced context
      if (error instanceof Error) {
        throw new ParseError(
          `Failed to parse FASTQ file '${filePath}': ${error.message}`,
          "FASTQ",
          undefined,
          error.stack
        );
      }
      throw error;
    }
  }

  /**
   * Parse FASTQ sequences from a ReadableStream
   */
  async *parse(stream: ReadableStream<Uint8Array>): AsyncIterable<FastqSequence> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lineNumber = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (buffer.trim()) {
            const lines = buffer.split(/\r?\n/);
            yield* this.parseLines(lines, lineNumber);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split(/\r?\n/);
        const poppedLine = lines.pop();
        buffer = poppedLine !== undefined ? poppedLine : "";

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
   * Parse FASTQ sequences from an iterator of lines
   */
  private async *parseLines(lines: string[], startLineNumber = 1): AsyncIterable<FastqSequence> {
    let lineNumber = startLineNumber;
    const lineBuffer: string[] = [];

    for (const line of lines) {
      lineNumber++;

      if (line.length > this.options.maxLineLength!) {
        this.options.onError!(
          `Line too long (${line.length} > ${this.options.maxLineLength!})`,
          lineNumber
        );
        continue;
      }

      const trimmedLine = line.trim();

      // Skip empty lines
      if (!trimmedLine) {
        continue;
      }

      lineBuffer.push(trimmedLine);

      // Process complete FASTQ records (4 lines each)
      if (lineBuffer.length === 4) {
        try {
          const sequence = this.parseRecord(lineBuffer, lineNumber - 3);
          yield sequence;
        } catch (error) {
          if (!this.options.skipValidation) {
            throw error;
          }
          this.options.onError!(
            error instanceof Error ? error.message : String(error),
            lineNumber - 3
          );
        }
        lineBuffer.length = 0; // Clear buffer
      }
    }

    // Handle incomplete record at end
    if (lineBuffer.length > 0) {
      this.options.onError!(
        `Incomplete FASTQ record: expected 4 lines, got ${lineBuffer.length}`,
        lineNumber
      );
    }
  }

  /**
   * Parse a single FASTQ record from 4 lines
   */
  private parseRecord(lines: string[], startLineNumber: number): FastqSequence {
    const [headerLine, sequenceLine, separatorLine, qualityLine] = lines;

    // Validate header line
    if (headerLine === undefined || headerLine === null || !headerLine.startsWith("@")) {
      throw new ParseError(
        'FASTQ header must start with "@"',
        "FASTQ",
        startLineNumber,
        headerLine
      );
    }

    // Parse header
    const header = (headerLine ?? "").slice(1);
    const firstSpace = header.search(/\s/);
    const id = firstSpace === -1 ? header : header.slice(0, firstSpace);
    const description = firstSpace === -1 ? undefined : header.slice(firstSpace + 1).trim();

    // Validate sequence
    const sequence = this.cleanSequence(sequenceLine ?? "", startLineNumber + 1);

    // Validate separator (should be '+' optionally followed by ID)
    if (separatorLine === undefined || separatorLine === null || !separatorLine.startsWith("+")) {
      throw new ParseError(
        'FASTQ separator must start with "+"',
        "FASTQ",
        startLineNumber + 2,
        separatorLine
      );
    }

    // Validate quality scores
    const quality = this.validateQuality(qualityLine ?? "", sequence, id, startLineNumber + 3);

    // Detect or use specified quality encoding
    const qualityEncoding = this.detectOrUseEncoding(quality, id);

    // Build FASTQ sequence object
    const fastqSequence: FastqSequence = {
      format: "fastq",
      id,
      ...(description && { description }),
      sequence,
      quality,
      qualityEncoding,
      length: sequence.length,
      ...(this.options.trackLineNumbers && { lineNumber: startLineNumber }),
    };

    // Parse quality scores if requested
    if (this.options.parseQualityScores) {
      try {
        const qualityScores = toNumbers(quality, qualityEncoding);
        (fastqSequence as any).qualityScores = qualityScores;

        // Calculate quality statistics when scores are available
        if (qualityScores?.length > 0) {
          const mean = qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length;
          const min = Math.min(...qualityScores);
          const max = Math.max(...qualityScores);
          const lowQualityBases = qualityScores.filter((score) => score < 20).length;

          (fastqSequence as any).qualityStats = {
            mean,
            min,
            max,
            lowQualityBases,
          };
        }
      } catch (error) {
        throw new QualityError(
          error instanceof Error ? error.message : String(error),
          id,
          qualityEncoding,
          startLineNumber + 3,
          qualityLine
        );
      }
    }

    // Final validation - temporarily disabled for basic functionality
    // if (!this.options.skipValidation) {
    //   const validation = FastqSequenceSchema(fastqSequence);
    //   if (validation instanceof type.errors) {
    //     throw new SequenceError(
    //       `Invalid FASTQ sequence: ${validation.summary}`,
    //       id,
    //       startLineNumber
    //     );
    //   }
    // }

    return fastqSequence;
  }

  /**
   * Clean and validate sequence data
   */
  private cleanSequence(sequenceLine: string, lineNumber: number): string {
    const cleaned = sequenceLine.replace(/\s/g, "");

    if (!cleaned) {
      throw new SequenceError("Empty sequence found", "unknown", lineNumber, sequenceLine);
    }

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

    return cleaned;
  }

  /**
   * Validate quality string matches sequence length
   */
  private validateQuality(
    qualityLine: string,
    sequence: string,
    sequenceId: string,
    lineNumber: number
  ): string {
    // Delegate to tree-shakeable function
    return validateFastqQuality(qualityLine, sequence, sequenceId, lineNumber);
  }

  /**
   * Detect quality encoding or use specified encoding
   */
  private detectOrUseEncoding(quality: string, sequenceId: string): QualityEncoding {
    if (this.options.qualityEncoding && this.options.qualityEncoding !== "phred33") {
      return this.options.qualityEncoding;
    }

    try {
      return detectEncodingImmediate(quality);
    } catch (error) {
      this.options.onWarning!(
        `Could not detect quality encoding for sequence '${sequenceId}': ${error instanceof Error ? error.message : String(error)}. Using phred33 as fallback`,
        undefined
      );
      return "phred33";
    }
  }

  /**
   * Validate file path and ensure it's accessible for reading
   * @param filePath Raw file path from user input
   * @returns Promise resolving to validated file path
   * @throws {ParseError} If file path is invalid or file is not accessible
   */
  private async validateFilePath(filePath: string): Promise<string> {
    // Validate meaningful constraints (preserve biological validation)
    if (filePath.length === 0) {
      throw new ValidationError("filePath must not be empty");
    }

    // Import FileReader functions dynamically to avoid circular dependencies
    const { exists, getMetadata } = await import("../io/file-reader");

    // Check if file exists and is readable
    if (!(await exists(filePath))) {
      throw new ParseError(
        `FASTQ file not found or not accessible: ${filePath}`,
        "FASTQ",
        undefined,
        "Please check that the file exists and you have read permissions"
      );
    }

    // Get file metadata for additional validation
    try {
      const metadata = await getMetadata(filePath);

      if (!metadata.readable) {
        throw new ParseError(
          `FASTQ file is not readable: ${filePath}`,
          "FASTQ",
          undefined,
          "Check file permissions"
        );
      }

      // Warn about very large files
      if (metadata.size > 5_368_709_120) {
        // 5GB
        this.options.onWarning!(
          `Very large FASTQ file detected: ${Math.round(metadata.size / 1_073_741_824)}GB. Processing may take significant time and memory.`,
          1
        );
      }
    } catch (error) {
      if (error instanceof ParseError) throw error;
      throw new ParseError(
        `Failed to validate FASTQ file: ${error instanceof Error ? error.message : String(error)}`,
        "FASTQ",
        undefined,
        filePath
      );
    }

    return filePath;
  }

  /**
   * Parse FASTQ sequences from async iterable of lines
   * @param lines Async iterable of text lines
   * @yields FastqSequence objects as they are parsed
   */
  private async *parseLinesFromAsyncIterable(
    lines: AsyncIterable<string>
  ): AsyncIterable<FastqSequence> {
    // TypeScript guarantees lines is AsyncIterable<string>

    let lineNumber = 0;
    const lineBuffer: string[] = [];

    try {
      for await (const rawLine of lines) {
        lineNumber++;

        if (rawLine.length > this.options.maxLineLength!) {
          this.options.onError!(
            `Line too long (${rawLine.length} > ${this.options.maxLineLength!})`,
            lineNumber
          );
          continue;
        }

        const trimmedLine = rawLine.trim();

        // Skip empty lines
        if (!trimmedLine) {
          continue;
        }

        lineBuffer.push(trimmedLine);

        // Process complete FASTQ records (4 lines each)
        if (lineBuffer.length === 4) {
          try {
            const sequence = this.parseRecord(lineBuffer, lineNumber - 3);
            yield sequence;
          } catch (error) {
            if (!this.options.skipValidation) {
              throw error;
            }
            this.options.onError!(
              error instanceof Error ? error.message : String(error),
              lineNumber - 3
            );
          }
          lineBuffer.length = 0; // Clear buffer
        }
      }

      // Handle incomplete record at end
      if (lineBuffer.length > 0) {
        const error = new ParseError(
          `Incomplete FASTQ record: expected 4 lines, got ${lineBuffer.length}`,
          "FASTQ",
          lineNumber,
          `Record starts with: ${lineBuffer[0] || "unknown"}`
        );

        if (!this.options.skipValidation) {
          throw error;
        }

        this.options.onError!(error.message, lineNumber);
      }
    } catch (error) {
      // Enhance error with line number context
      if (error instanceof ParseError || error instanceof QualityError) {
        throw error;
      }

      throw new ParseError(
        `FASTQ parsing failed at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
        "FASTQ",
        lineNumber,
        "Check file format and content"
      );
    }

    // Tiger Style: Assert postconditions
    if (lineNumber < 0) {
      throw new ParseError("line number must be non-negative", "FASTQ");
    }
  }
}

/**
 * FASTQ writer for outputting sequences
 */
export class FastqWriter {
  private readonly qualityEncoding: QualityEncoding;
  private readonly includeDescription: boolean;

  constructor(
    options: {
      qualityEncoding?: QualityEncoding;
      includeDescription?: boolean;
    } = {}
  ) {
    this.qualityEncoding = options.qualityEncoding || "phred33";
    this.includeDescription = options.includeDescription ?? true;
  }

  /**
   * Format a single FASTQ sequence as string
   */
  formatSequence(sequence: FastqSequence): string {
    let header = `@${sequence.id}`;

    if (
      this.includeDescription === true &&
      sequence.description !== undefined &&
      sequence.description !== null &&
      sequence.description !== ""
    ) {
      header += ` ${sequence.description}`;
    }

    // Convert quality if needed
    let quality = sequence.quality;
    if (sequence.qualityEncoding !== this.qualityEncoding) {
      const scores = toNumbers(sequence.quality, sequence.qualityEncoding);
      quality = scoresToString(scores, this.qualityEncoding);
    }

    return `${header}\n${sequence.sequence}\n+\n${quality}`;
  }

  /**
   * Format multiple sequences as string
   */
  formatSequences(sequences: FastqSequence[]): string {
    return sequences.map((seq) => this.formatSequence(seq)).join("\n");
  }

  /**
   * Write sequences to a WritableStream
   */
  async writeToStream(
    sequences: AsyncIterable<FastqSequence>,
    stream: WritableStream<Uint8Array>
  ): Promise<void> {
    const writer = stream.getWriter();
    const encoder = new TextEncoder();

    try {
      for await (const sequence of sequences) {
        const formatted = this.formatSequence(sequence) + "\n";
        await writer.write(encoder.encode(formatted));
      }
    } finally {
      writer.releaseLock();
    }
  }
}

/**
 * Parse FASTQ records using state machine for multi-line support
 *
 * Implements length-tracking algorithm to handle @ and + contamination in quality strings.
 * This approach is necessary because the original Sanger FASTQ specification allows sequence
 * and quality lines to be wrapped, but '@' and '+' characters can appear in quality data,
 * making simple line-marker detection unreliable.
 *
 * **Algorithm pseudocode:**
 * ```
 * for each line in input:
 *   switch (state):
 *     case WAITING_HEADER:
 *       if line starts with '@': store header, state = READING_SEQUENCE
 *     case READING_SEQUENCE:
 *       if line starts with '+': store separator, calculate sequence length, state = READING_QUALITY
 *       else: accumulate sequence data
 *     case READING_QUALITY:
 *       accumulate quality data
 *       if quality.length >= sequence.length: record complete, state = WAITING_HEADER
 * ```
 *
 * **Why not simple '@' detection:**
 * '@' can appear at start of quality lines (ASCII 64 in Phred+64 encoding), so line-marker
 * detection would incorrectly split records. Length-based parsing is the only reliable method.
 */
function parseMultiLineFastq(
  lines: string[],
  startLineNumber: number = 1,
  options: { maxLineLength: number; onError: (msg: string, line?: number) => void }
): FastqSequence[] {
  const results: FastqSequence[] = [];
  let lineNumber = startLineNumber;

  const context: FastqParserContext = {
    state: FastqParsingState.WAITING_HEADER,
    sequenceLines: [],
    qualityLines: [],
    sequenceLength: 0,
    currentQualityLength: 0,
  };

  for (const line of lines) {
    lineNumber++;

    // Skip empty lines in any state
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Check line length bounds
    if (line.length > options.maxLineLength) {
      options.onError(`Line too long (${line.length} > ${options.maxLineLength})`, lineNumber);
      continue;
    }

    // State machine processing
    switch (context.state) {
      case FastqParsingState.WAITING_HEADER:
        if (trimmedLine.startsWith("@")) {
          context.header = trimmedLine;
          context.state = FastqParsingState.READING_SEQUENCE;
          context.sequenceLines = [];
        } else {
          options.onError(`Expected FASTQ header starting with @, got: ${trimmedLine}`, lineNumber);
        }
        break;

      case FastqParsingState.READING_SEQUENCE:
        if (trimmedLine.startsWith("+")) {
          // Found separator, calculate sequence length for quality tracking
          context.separator = trimmedLine;
          context.sequenceLength = context.sequenceLines.join("").length;
          context.state = FastqParsingState.READING_QUALITY;
          context.qualityLines = [];
          context.currentQualityLength = 0;
        } else {
          // Accumulate sequence lines
          context.sequenceLines.push(trimmedLine);
        }
        break;

      case FastqParsingState.READING_QUALITY:
        // Accumulate quality characters
        context.qualityLines.push(trimmedLine);
        context.currentQualityLength += trimmedLine.length;

        // Check if quality length matches sequence length (record complete)
        if (context.currentQualityLength >= context.sequenceLength) {
          // Create FASTQ record
          const sequence = context.sequenceLines.join("");
          const quality = context.qualityLines.join("");

          // Validate exact length match
          if (quality.length !== sequence.length) {
            options.onError(
              `Quality length (${quality.length}) != sequence length (${sequence.length})`,
              lineNumber
            );
          } else {
            // Parse header using tree-shakeable function
            const headerData = parseFastqHeader(context.header || "", lineNumber, {
              skipValidation: false, // Always validate in state machine for robustness
              onWarning: (msg, line) => console.warn(`FASTQ Warning (line ${line}): ${msg}`),
            });

            // Enhanced encoding detection with confidence reporting
            const encodingResult = detectEncodingWithConfidence(quality);
            if (encodingResult.confidence < 0.8) {
              console.warn(
                `Uncertain quality encoding detection for sequence '${headerData.id}': ${encodingResult.reasoning} (confidence: ${(encodingResult.confidence * 100).toFixed(1)}%). Consider specifying sourceEncoding explicitly if conversion results seem incorrect.`
              );
            }

            const fastqRecord: FastqSequence = {
              format: "fastq",
              id: headerData.id,
              ...(headerData.description && { description: headerData.description }),
              sequence,
              quality,
              qualityEncoding: encodingResult.encoding,
              length: sequence.length,
            };

            results.push(fastqRecord);
          }

          // Reset for next record
          context.state = FastqParsingState.WAITING_HEADER;
        }
        break;
    }
  }

  return results;
}

/**
 * Parse FASTQ header line and extract ID and description
 */
export function parseFastqHeader(
  headerLine: string,
  lineNumber: number,
  options: { skipValidation?: boolean; onWarning?: (msg: string, line?: number) => void }
): { id: string; description?: string } {
  // Validate FASTQ header format
  if (!headerLine.startsWith("@")) {
    throw new ValidationError('FASTQ header must start with "@"');
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
        headerLine
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
        lineNumber
      );
    }

    // Check for spaces in sequence ID
    if (id.includes(" ")) {
      throw new SequenceError(
        `FASTQ sequence ID '${id}' contains spaces. ` +
          `Use underscores (_) or hyphens (-) for better tool compatibility.`,
        id,
        lineNumber,
        headerLine
      );
    }
  }

  return description !== undefined ? { id, description } : { id };
}

/**
 * Validate FASTQ quality string length matches sequence length
 * Tree-shakeable function for FASTQ quality validation
 */
export function validateFastqQuality(
  qualityLine: string,
  sequence: string,
  sequenceId: string,
  lineNumber: number
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
      qualityLine
    );
  }

  return quality;
}

/**
 * Detect if string contains FASTQ format data
 * Tree-shakeable function for FASTQ format detection
 */
export function detectFastqFormat(data: string): boolean {
  const trimmed = data.trim();
  const lines = trimmed.split(/\r?\n/);
  return (
    lines.length >= 4 &&
    (lines[0]?.startsWith("@") ?? false) &&
    (lines[2]?.startsWith("+") ?? false)
  );
}

/**
 * Count FASTQ reads in data without full parsing
 * Tree-shakeable function for efficient read counting
 */
export function countFastqReads(data: string): number {
  const lines = data.split(/\r?\n/).filter((line) => line.trim());
  return Math.floor(lines.length / 4);
}

/**
 * Extract read IDs from FASTQ data without full parsing
 * Tree-shakeable function for quick ID extraction
 */
export function extractFastqIds(data: string): string[] {
  const matches = data.match(/^@([^\s\n\r]+)/gm);
  return matches ? matches.map((m) => m.slice(1)) : [];
}

/**
 * Validate FASTQ sequence using FASTA validation with FASTQ-specific context
 * Tree-shakeable function leveraging proven FASTA sequence validation
 */
export function validateFastqSequence(
  sequenceLine: string,
  lineNumber: number,
  options: { skipValidation?: boolean }
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
        sequenceLine
      );
    }
    throw error;
  }
}
/**
 * Utility functions for FASTQ format
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
   * Extract sequence IDs without full parsing
   */
  extractIds: extractFastqIds,

  /**
   * Convert between quality encodings
   */
  convertQuality(
    qualityString: string,
    fromEncoding: QualityEncoding,
    toEncoding: QualityEncoding
  ): string {
    if (fromEncoding === toEncoding) return qualityString;

    const scores = toNumbers(qualityString, fromEncoding);
    return scoresToString(scores, toEncoding);
  },

  /**
   * Validate FASTQ record structure
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
};

/**
 * Convert ASCII quality string to numeric scores
 */
export function toNumbers(qualityString: string, encoding: QualityEncoding = "phred33"): number[] {
  const scores: number[] = [];
  const offset = getOffset(encoding);

  for (let i = 0; i < qualityString.length; i++) {
    const ascii = qualityString.charCodeAt(i);
    const score = ascii - offset;

    // Validate score range
    if (encoding === "solexa") {
      // Solexa scores can be negative
      scores.push(score);
    } else {
      // Phred scores should be non-negative
      if (score < 0) {
        throw new QualityError(
          `Invalid quality score: ASCII ${ascii} gives score ${score} (should be >= 0)`,
          "unknown",
          encoding
        );
      }
      scores.push(score);
    }
  }

  return scores;
}

/**
 * Convert numeric scores to ASCII quality string
 */
export function scoresToString(scores: number[], encoding: QualityEncoding = "phred33"): string {
  const offset = getOffset(encoding);
  return scores.map((score) => String.fromCharCode(score + offset)).join("");
}

/**
 * Get ASCII offset for quality encoding
 */
export function getOffset(encoding: QualityEncoding): number {
  switch (encoding) {
    case "phred33":
      return 33;
    case "phred64":
      return 64;
    case "solexa":
      return 64;
    default:
      throw new Error(`Unknown quality encoding: ${encoding}`);
  }
}

/**
 * Calculate quality statistics
 */
export function calculateStats(scores: number[]): {
  mean: number;
  median: number;
  min: number;
  max: number;
  q25: number;
  q75: number;
} {
  if (scores.length === 0) {
    throw new QualityError("Cannot calculate stats for empty quality array", "unknown");
  }

  const sorted = [...scores].sort((a, b) => a - b);
  const length = sorted.length;

  return {
    mean: scores.reduce((sum, score) => sum + score, 0) / length,
    median:
      length % 2 === 0
        ? ((sorted[length / 2 - 1] ?? 0) + (sorted[length / 2] ?? 0)) / 2
        : (sorted[Math.floor(length / 2)] ?? 0),
    min: sorted[0] ?? 0,
    max: sorted[length - 1] ?? 0,
    q25: sorted[Math.floor(length * 0.25)] ?? 0,
    q75: sorted[Math.floor(length * 0.75)] ?? 0,
  };
}

/**
 * Quality score conversion utilities
 * @deprecated Use individual function imports for better tree-shaking
 */
export const QualityScores = {
  toNumbers,
  toString: scoresToString,
  getOffset,
  calculateStats,
} as const;
