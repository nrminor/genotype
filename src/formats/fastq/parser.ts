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

// =============================================================================
// IMPORTS
// =============================================================================

import { type } from "arktype";
import {
  getErrorSuggestion,
  ParseError,
  QualityError,
  SequenceError,
  ValidationError,
} from "../../errors";
import { createStream, exists, getMetadata } from "../../io/file-reader";
import { StreamUtils } from "../../io/stream-utils";
import { detectEncoding, qualityToScores } from "../../operations/core/quality";
import type { FastqSequence, FileReaderOptions, QualityEncoding } from "../../types";
import { SequenceSchema } from "../../types";
import { AbstractParser } from "../abstract-parser";
import { QUALITY_THRESHOLDS } from "./constants";
import { detectFastqComplexity } from "./detection";
import {
  extractDescription,
  extractId,
  isValidHeader,
  isValidSeparator,
  lengthsMatch,
} from "./primitives";
import { parseMultiLineFastq } from "./state-machine";
import type { FastqParserOptions, ParsingStrategy } from "./types";
import {
  countFastqReads,
  detectFastqFormat,
  extractFastqIds,
  parseFastqHeader,
  validateFastqQuality,
  validateFastqSequence,
} from "./utils";
import { type ValidationLevel, validateFastqRecord } from "./validation";
import { FastqWriter } from "./writer";

// =============================================================================
// CONSTANTS
// =============================================================================

// No module-level constants needed here

// =============================================================================
// TYPES
// =============================================================================

// Types are imported from ./types module

// =============================================================================
// INTERFACES
// =============================================================================

// Interfaces are imported from ./types module

// =============================================================================
// ARKTYPE SCHEMAS
// =============================================================================

/**
 * ArkType schema for FASTQ parser options validation
 *
 * Provides runtime validation with excellent error messages for:
 * - Quality encoding detection (Phred+33, Phred+64, Solexa)
 * - Performance tuning parameters
 * - Error handling callbacks
 * - Domain-specific constraints for modern sequencing workflows
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

// =============================================================================
// CLASSES
// =============================================================================

/**
 * FASTQ format parser with intelligent path selection and quality score handling
 *
 * Automatically detects FASTQ format complexity and chooses the optimal parsing strategy:
 * - **Fast path**: For simple 4-line format (handles ~95% of modern FASTQ files)
 * - **State machine**: For complex multi-line format (wrapped sequences/quality)
 *
 * Features:
 * - Automatic format detection with confidence scoring
 * - Streaming support for memory-efficient parsing
 * - Quality encoding auto-detection (Phred+33, Phred+64, Solexa)
 * - Telemetry tracking for parser performance monitoring
 * - Support for both modern (Illumina) and legacy (454, Ion Torrent) formats
 *
 * @example
 * ```typescript
 * // Auto-detection (recommended)
 * const parser = new FastqParser();
 * for await (const seq of parser.parseFile('reads.fastq')) {
 *   console.log(`${seq.id}: ${seq.sequence.length} bp`);
 * }
 *
 * // Force specific strategy for known format
 * const fastParser = new FastqParser({ parsingStrategy: 'fast' });
 *
 * // Get parsing metrics
 * const metrics = parser.getMetrics();
 * console.log(`Used fast path: ${metrics.fastPathCount} times`);
 * console.log(`Used state machine: ${metrics.stateMachineCount} times`);
 * ```
 *
 * @since 0.1.0
 */
export class FastqParser extends AbstractParser<FastqSequence, FastqParserOptions> {
  /**
   * Parsing metrics for telemetry and performance monitoring
   */
  private parsingMetrics = {
    fastPathCount: 0,
    stateMachineCount: 0,
    autoDetectCount: 0,
    totalSequences: 0,
    lastStrategy: null as ParsingStrategy | null,
    lastDetectedFormat: null as "simple" | "complex" | null,
    lastConfidence: null as number | null,
  };

  protected getDefaultOptions(): Partial<FastqParserOptions> {
    return {
      skipValidation: false,
      maxLineLength: 1_000_000,
      trackLineNumbers: true,
      qualityEncoding: "phred33" as QualityEncoding, // Modern sequencing standard
      parseQualityScores: false, // Lazy loading for memory efficiency
      validationLevel: "quick" as ValidationLevel, // Default to quick validation
      parsingStrategy: "auto", // Default to automatic parser selection
      confidenceThreshold: 0.8, // Default confidence threshold
      debugStrategy: false, // Default to no debug output
      onError: (error: string, lineNumber?: number): void => {
        throw new ParseError(error, "FASTQ", lineNumber);
      },
      onWarning: (warning: string, lineNumber?: number): void => {
        console.warn(`FASTQ Warning (line ${lineNumber}): ${warning}`);
      },
    };
  }

  constructor(options: FastqParserOptions = {}) {
    // Step 1: Prepare options with user overrides
    const optionsWithDefaults = {
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

    // Step 3: Pass validated options to parent (which will merge with defaults)
    super(optionsWithDefaults);

    // Step 4: Application-level warnings for deprecated quality encodings
    if (this.options.qualityEncoding === "solexa") {
      this.options.onWarning?.(
        "Solexa quality encoding is deprecated (pre-2009 Illumina) - " +
          "consider migrating to phred33 for modern sequencing workflows",
        undefined
      );
    }

    if (this.options.qualityEncoding === "phred64") {
      this.options.onWarning?.(
        "Phred+64 encoding is legacy (Illumina 1.3-1.7) - " +
          "modern FASTQ files use phred33 encoding",
        undefined
      );
    }
  }

  protected getFormatName(): string {
    return "FASTQ";
  }

  /**
   * Get current parsing metrics for telemetry and performance monitoring
   *
   * Provides insights into parser behavior and performance:
   * - Which parser paths were used (fast vs state machine)
   * - How many times auto-detection was triggered
   * - Detection confidence scores
   * - Total sequences processed
   *
   * @returns Copy of current parsing metrics
   * @example
   * ```typescript
   * const parser = new FastqParser();
   * // ... parse some files ...
   *
   * const metrics = parser.getMetrics();
   * console.log(`Fast path used: ${metrics.fastPathCount} times`);
   * console.log(`State machine used: ${metrics.stateMachineCount} times`);
   * console.log(`Last format detected: ${metrics.lastDetectedFormat}`);
   * console.log(`Detection confidence: ${metrics.lastConfidence}`);
   * ```
   */
  public getMetrics() {
    return { ...this.parsingMetrics };
  }

  /**
   * Reset parsing metrics to initial state
   *
   * Clears all accumulated metrics, useful for:
   * - Starting fresh measurement periods
   * - Benchmarking specific operations
   * - Comparing different parsing strategies
   *
   * @example
   * ```typescript
   * const parser = new FastqParser();
   *
   * // Benchmark fast path
   * parser.resetMetrics();
   * await processFile('simple.fastq', { parsingStrategy: 'fast' });
   * const fastMetrics = parser.getMetrics();
   *
   * // Benchmark state machine
   * parser.resetMetrics();
   * await processFile('simple.fastq', { parsingStrategy: 'state-machine' });
   * const smMetrics = parser.getMetrics();
   * ```
   */
  public resetMetrics(): void {
    this.parsingMetrics = {
      fastPathCount: 0,
      stateMachineCount: 0,
      autoDetectCount: 0,
      totalSequences: 0,
      lastStrategy: null,
      lastDetectedFormat: null,
      lastConfidence: null,
    };
  }

  /**
   * Update metrics after parser selection
   *
   * @param strategy - The parsing strategy used
   * @param usedPath - Which parser was actually used
   * @param detectedFormat - Format detected by complexity analysis
   * @param confidence - Confidence score from detection
   */
  private updateMetrics(
    strategy: ParsingStrategy,
    usedPath: "fast" | "state-machine",
    detectedFormat?: "simple" | "complex",
    confidence?: number
  ): void {
    // Store the actual parser used, not the input strategy
    this.parsingMetrics.lastStrategy = usedPath as ParsingStrategy;

    if (detectedFormat) {
      this.parsingMetrics.lastDetectedFormat = detectedFormat;
    }

    if (confidence !== undefined) {
      this.parsingMetrics.lastConfidence = confidence;
    }

    if (strategy === "auto") {
      this.parsingMetrics.autoDetectCount++;
    }

    if (usedPath === "fast") {
      this.parsingMetrics.fastPathCount++;
    } else {
      this.parsingMetrics.stateMachineCount++;
    }
  }

  /**
   * Parse FASTQ sequences from a string with intelligent path selection
   *
   * Automatically detects format complexity and chooses the optimal parser:
   * - Simple 4-line format → Fast path parser (optimized for speed)
   * - Multi-line format → State machine parser (handles complexity)
   *
   * The parser selection can be controlled via `parsingStrategy` option:
   * - `'auto'` (default): Automatic detection based on format analysis
   * - `'fast'`: Force fast path parser (fails on complex formats)
   * - `'state-machine'`: Force state machine parser (handles all formats)
   *
   * @param data - FASTQ format string
   * @yields Parsed FASTQ sequences with quality scores
   * @throws {ParseError} When FASTQ format is invalid
   * @throws {ValidationError} When sequence validation fails
   *
   * @example
   * ```typescript
   * const fastq = `@seq1
   * ATCG
   * +
   * IIII`;
   *
   * for await (const seq of parser.parseString(fastq)) {
   *   console.log(seq.id, seq.sequence);
   * }
   * ```
   */
  async *parseString(data: string): AsyncIterable<FastqSequence> {
    const strategy = this.options.parsingStrategy ?? "auto";
    const confidenceThreshold = this.options.confidenceThreshold ?? 0.8;

    // Log strategy selection if debugging enabled
    if (this.options.debugStrategy) {
      console.log(`FASTQ Parser: Strategy = ${strategy}`);
    }

    // Determine which parser to use
    let useStateMachine = false;
    let detectedFormat: "simple" | "complex" | undefined;
    let detectedConfidence: number | undefined;

    if (strategy === "fast") {
      // Force fast path
      useStateMachine = false;
    } else if (strategy === "state-machine") {
      // Force state machine
      useStateMachine = true;
    } else {
      // Auto-detect format complexity
      const detection = detectFastqComplexity(data);
      detectedFormat = detection.format;
      detectedConfidence = detection.confidence;

      if (this.options.debugStrategy) {
        console.log(`Format detected: ${detection.format}, Confidence: ${detection.confidence}`);
      }

      // Use state machine if complex format or low confidence
      useStateMachine =
        detection.format === "complex" || detection.confidence < confidenceThreshold;

      if (this.options.debugStrategy) {
        console.log(useStateMachine ? "Using state machine parser" : "Using fast path parser");
      }
    }

    // Update metrics for parser selection
    this.updateMetrics(
      strategy,
      useStateMachine ? "state-machine" : "fast",
      detectedFormat,
      detectedConfidence
    );

    // Use the appropriate parser
    const lines = data.split(/\r?\n/);

    if (useStateMachine) {
      // Use state machine for complex formats
      const sequences = parseMultiLineFastq(lines, 1, {
        maxLineLength: this.options.maxLineLength,
        onError: this.options.onError,
        ...(this.options.qualityEncoding && {
          qualityEncoding: this.options.qualityEncoding,
        }),
        ...(this.options.trackLineNumbers !== undefined && {
          trackLineNumbers: this.options.trackLineNumbers,
        }),
      });

      // Convert array to async generator and add missing fields if needed
      for (const seq of sequences) {
        // Add quality scores and stats if requested and not present
        if (this.options.parseQualityScores && seq.quality && !seq.qualityScores) {
          const qualityScores = qualityToScores(seq.quality, seq.qualityEncoding);
          const qualityStats = calculateQualityStatistics(qualityScores);

          const enrichedSeq = {
            ...seq,
            ...(qualityScores && { qualityScores }),
            ...(qualityStats && { qualityStats }),
          };
          this.parsingMetrics.totalSequences++;
          yield enrichedSeq;
        } else {
          this.parsingMetrics.totalSequences++;
          yield seq;
        }
      }
    } else {
      // Use fast path for simple formats
      // We need to track sequences from fast path too
      for await (const seq of this.parseLines(lines)) {
        this.parsingMetrics.totalSequences++;
        yield seq;
      }
    }
  }

  /**
   * Parse multi-line FASTQ sequences using state machine
   * Provides full FASTQ specification compliance for wrapped sequences
   */
  parseMultiLineString(data: string): FastqSequence[] {
    const lines = data.split(/\r?\n/);
    const fastqOptions = this.options;

    return parseMultiLineFastq(lines, 1, {
      maxLineLength: this.options.maxLineLength,
      onError: this.options.onError,
      ...(fastqOptions.qualityEncoding && { qualityEncoding: fastqOptions.qualityEncoding }),
      ...(this.options.trackLineNumbers !== undefined && {
        trackLineNumbers: this.options.trackLineNumbers,
      }),
    });
  }

  /**
   * Parse FASTQ sequences from a file using streaming I/O with intelligent path selection
   *
   * Samples the beginning of the file to detect format complexity, then uses the
   * appropriate parser for optimal performance. Large files are processed in a
   * memory-efficient streaming manner.
   *
   * @param filePath - Path to FASTQ file to parse (can be compressed)
   * @param options - File reading options for performance tuning
   * @yields FastqSequence objects as they are parsed from the file
   * @throws {FileError} When file cannot be read
   * @throws {ParseError} When FASTQ format is invalid
   * @throws {ValidationError} When sequence validation fails
   *
   * @example
   * ```typescript
   * // Parse with auto-detection
   * const parser = new FastqParser();
   * for await (const sequence of parser.parseFile('/path/to/reads.fastq')) {
   *   console.log(`${sequence.id}: ${sequence.length} bp`);
   * }
   *
   * // Force specific strategy for known format
   * const parser = new FastqParser({ parsingStrategy: 'fast' });
   * for await (const seq of parser.parseFile('illumina.fastq.gz')) {
   *   // Process Illumina reads with fast parser
   * }
   * ```
   */
  async *parseFile(filePath: string, options?: FileReaderOptions): AsyncIterable<FastqSequence> {
    // Validate meaningful constraints (preserve biological validation)
    if (filePath.length === 0) {
      throw new ValidationError("filePath must not be empty");
    }

    try {
      // Validate file path
      const validatedPath = await this.validateFilePath(filePath);

      const strategy = this.options.parsingStrategy ?? "auto";
      const confidenceThreshold = this.options.confidenceThreshold ?? 0.8;

      // Log strategy selection if debugging enabled
      if (this.options.debugStrategy) {
        console.log(`FASTQ Parser (file): Strategy = ${strategy}, File = ${filePath}`);
      }

      // Determine which parser to use
      let useStateMachine = false;
      let detectedFormat: "simple" | "complex" | undefined;
      let detectedConfidence: number | undefined;

      if (strategy === "fast") {
        // Force fast path
        useStateMachine = false;
      } else if (strategy === "state-machine") {
        // Force state machine
        useStateMachine = true;
      } else {
        // Auto-detect by sampling the file
        // Read first ~10KB for format detection (enough for ~50 FASTQ records)
        const sampleSize = 10240;
        const file = Bun.file(validatedPath);
        const fileSize = file.size;
        const bytesToRead = Math.min(sampleSize, fileSize);

        // Read sample from beginning of file
        const sampleBuffer = await file.slice(0, bytesToRead).arrayBuffer();
        const sampleText = new TextDecoder().decode(sampleBuffer);

        // Detect format from sample
        const detection = detectFastqComplexity(sampleText);
        detectedFormat = detection.format;
        detectedConfidence = detection.confidence;

        if (this.options.debugStrategy) {
          console.log(`Format detected: ${detection.format}, Confidence: ${detection.confidence}`);
        }

        // Use state machine if complex format or low confidence
        useStateMachine =
          detection.format === "complex" || detection.confidence < confidenceThreshold;

        if (this.options.debugStrategy) {
          console.log(useStateMachine ? "Using state machine parser" : "Using fast path parser");
        }
      }

      // Update metrics for parser selection
      this.updateMetrics(
        strategy,
        useStateMachine ? "state-machine" : "fast",
        detectedFormat,
        detectedConfidence
      );

      // Create fresh stream for actual parsing
      const stream = await createStream(validatedPath, options);
      const lines = StreamUtils.readLines(stream, options?.encoding || "utf8");

      // Use the appropriate parser
      if (useStateMachine) {
        // For state machine, we need to collect lines into batches
        // because the state machine needs to see multiple lines at once
        const batchSize = 1000; // Process in batches of 1000 lines
        let lineBuffer: string[] = [];
        let lineNumber = 0;

        for await (const line of lines) {
          lineBuffer.push(line);
          lineNumber++;

          // Process batch when buffer is full
          if (lineBuffer.length >= batchSize) {
            const sequences = parseMultiLineFastq(lineBuffer, lineNumber - lineBuffer.length + 1, {
              maxLineLength: this.options.maxLineLength,
              onError: this.options.onError,
              ...(this.options.qualityEncoding && {
                qualityEncoding: this.options.qualityEncoding,
              }),
              ...(this.options.trackLineNumbers !== undefined && {
                trackLineNumbers: this.options.trackLineNumbers,
              }),
            });

            for (const seq of sequences) {
              // Add quality scores if needed
              if (this.options.parseQualityScores && seq.quality && !seq.qualityScores) {
                const qualityScores = qualityToScores(seq.quality, seq.qualityEncoding);
                const qualityStats = calculateQualityStatistics(qualityScores);

                const enrichedSeq = {
                  ...seq,
                  ...(qualityScores && { qualityScores }),
                  ...(qualityStats && { qualityStats }),
                };
                this.parsingMetrics.totalSequences++;
                yield enrichedSeq;
              } else {
                this.parsingMetrics.totalSequences++;
                yield seq;
              }
            }

            lineBuffer = [];
          }
        }

        // Process remaining lines
        if (lineBuffer.length > 0) {
          const sequences = parseMultiLineFastq(lineBuffer, lineNumber - lineBuffer.length + 1, {
            maxLineLength: this.options.maxLineLength,
            onError: this.options.onError,
            ...(this.options.qualityEncoding && {
              qualityEncoding: this.options.qualityEncoding,
            }),
            ...(this.options.trackLineNumbers !== undefined && {
              trackLineNumbers: this.options.trackLineNumbers,
            }),
          });

          for (const seq of sequences) {
            if (this.options.parseQualityScores && seq.quality && !seq.qualityScores) {
              const qualityScores = qualityToScores(seq.quality, seq.qualityEncoding);
              const qualityStats = calculateQualityStatistics(qualityScores);

              const enrichedSeq = {
                ...seq,
                ...(qualityScores && { qualityScores }),
                ...(qualityStats && { qualityStats }),
              };
              this.parsingMetrics.totalSequences++;
              yield enrichedSeq;
            } else {
              this.parsingMetrics.totalSequences++;
              yield seq;
            }
          }
        }
      } else {
        // Fast path for streaming
        for await (const seq of this.parseLinesFromAsyncIterable(lines)) {
          this.parsingMetrics.totalSequences++;
          yield seq;
        }
      }
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

      if (line.length > this.options.maxLineLength) {
        this.options.onError(
          `Line too long (${line.length} > ${this.options.maxLineLength})`,
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
          this.options.onError(
            error instanceof Error ? error.message : String(error),
            lineNumber - 3
          );
        }
        lineBuffer.length = 0; // Clear buffer
      }
    }

    // Handle incomplete record at end
    if (lineBuffer.length > 0) {
      this.options.onError(
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

    // Parse quality scores if requested (before building object)
    let qualityScores: number[] | undefined;
    let qualityStats: FastqSequence["qualityStats"] | undefined;

    if (this.options.parseQualityScores) {
      try {
        qualityScores = qualityToScores(quality, qualityEncoding);

        // Calculate quality statistics using declarative function
        qualityStats = calculateQualityStatistics(qualityScores);
      } catch (error) {
        // Build comprehensive error context
        const context = buildErrorContext(
          "quality score parsing",
          id,
          startLineNumber + 3,
          qualityLine
        );

        // Get helpful suggestion based on error type
        const suggestion = getQualityErrorSuggestion(qualityEncoding, error);

        // Create enhanced error message
        const message = [
          error instanceof Error ? error.message : String(error),
          context,
          suggestion,
        ]
          .filter(Boolean)
          .join(". ");

        throw new QualityError(message, id, qualityEncoding, startLineNumber + 3, qualityLine);
      }
    }

    // Build FASTQ sequence object with all properties in one step
    const fastqSequence: FastqSequence = {
      format: "fastq",
      id,
      ...(description && { description }),
      sequence,
      quality,
      qualityEncoding,
      length: sequence.length,
      ...(qualityScores && { qualityScores }),
      ...(qualityStats && { qualityStats }),
      ...(this.options.trackLineNumbers && { lineNumber: startLineNumber }),
    };

    // Validate if required (all validation logic consolidated)
    this.validateIfRequired(fastqSequence, { id, startLineNumber });

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
      return detectEncoding(quality);
    } catch (error) {
      this.options.onWarning(
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
        this.options.onWarning(
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

        if (rawLine.length > this.options.maxLineLength) {
          this.options.onError(
            `Line too long (${rawLine.length} > ${this.options.maxLineLength})`,
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
            this.options.onError(
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

        this.options.onError(error.message, lineNumber);
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

  // ============================================================================
  // VALIDATION LOGIC CONSOLIDATION
  // ============================================================================

  /**
   * Validate FASTQ sequence if required by parser options
   *
   * Encapsulates all validation logic including:
   * - Checking if validation is needed
   * - Performing appropriate validation level
   * - Building comprehensive error messages
   * - Handling warnings for full validation
   *
   * @param sequence - FASTQ sequence to validate
   * @param context - Context for error messages
   * @throws {SequenceError} If validation fails
   */
  private validateIfRequired(
    sequence: FastqSequence,
    context: {
      id: string;
      startLineNumber: number;
    }
  ): void {
    // Early return if validation skipped
    if (this.options.skipValidation || this.options.validationLevel === "none") {
      return;
    }

    const validationLevel = this.options.validationLevel ?? "quick";
    const result = validateFastqRecord(sequence, validationLevel);

    // Handle validation success
    if (result.valid) {
      // Log warnings if in full validation mode
      if (validationLevel === "full" && result.warnings && result.warnings.length > 0) {
        this.logValidationWarnings(result.warnings, context);
      }
      return;
    }

    // Handle validation failure
    this.throwValidationError(result, validationLevel, context, sequence);
  }

  /**
   * Log validation warnings to the configured warning handler
   *
   * @param warnings - Array of validation warnings
   * @param context - Context for warning messages
   */
  private logValidationWarnings(
    warnings: Array<{ message: string; severity: string }>,
    context: { id: string; startLineNumber: number }
  ): void {
    for (const warning of warnings) {
      this.options.onWarning?.(
        `${warning.message} (severity: ${warning.severity})`,
        context.startLineNumber
      );
    }
  }

  /**
   * Build and throw comprehensive validation error
   *
   * Creates detailed error message with context and suggestions,
   * then throws SequenceError for validation failures.
   *
   * @param result - Validation result containing errors
   * @param level - Validation level used
   * @param context - Context for error messages
   * @param sequence - FASTQ sequence that failed validation
   * @throws {SequenceError} Always throws with detailed message
   */
  private throwValidationError(
    result: {
      valid: boolean;
      errors?: string[];
      warnings?: Array<{ message: string; severity: string }>;
    },
    level: string,
    context: { id: string; startLineNumber: number },
    sequence: FastqSequence
  ): never {
    const errorContext = buildErrorContext(
      `${level} validation`,
      context.id,
      context.startLineNumber,
      sequence.sequence.substring(0, 50)
    );

    const suggestion = getValidationErrorSuggestion(result.errors);
    const errorDetails = result.errors?.join("; ") || "Unknown validation error";

    const message = [`FASTQ validation failed: ${errorDetails}`, errorContext, suggestion]
      .filter(Boolean)
      .join(". ");

    throw new SequenceError(message, context.id, context.startLineNumber);
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate context-aware suggestions for quality-related errors
 *
 * @param encoding - Quality encoding being used
 * @param error - Original error or error message
 * @returns Helpful suggestion for fixing the error
 * @internal
 */
function getQualityErrorSuggestion(encoding: QualityEncoding, error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const msg = errorMessage.toLowerCase();

  // Encoding mismatch suggestions
  if (msg.includes("out of range") || msg.includes("invalid character")) {
    if (encoding === "phred64") {
      return "File may use modern Phred+33 encoding (most files after 2011). Try setting qualityEncoding: 'phred33'";
    } else if (encoding === "phred33") {
      return "File may use legacy Phred+64 encoding (Illumina 1.3-1.7). Try setting qualityEncoding: 'phred64'";
    }
    return "Check if quality encoding matches file format. Use autodetection if unsure.";
  }

  // Length mismatch
  if (msg.includes("length")) {
    return "Quality string length must match sequence length. File may be corrupted or truncated.";
  }

  // Generic quality score issues
  if (msg.includes("quality") || msg.includes("score")) {
    return `Verify quality scores are valid for ${encoding} encoding (ASCII ${
      encoding === "phred33" ? "33-126" : encoding === "phred64" ? "64-157" : "59-126"
    })`;
  }

  return "Check FASTQ file format and quality encoding settings";
}

/**
 * Generate suggestions for sequence validation errors
 *
 * @param errors - Array of validation error messages
 * @returns Actionable suggestion for fixing the errors
 * @internal
 */
function getValidationErrorSuggestion(errors?: string[]): string {
  if (!errors || errors.length === 0) {
    return "Check FASTQ record structure and format compliance";
  }

  // Analyze error patterns
  const errorStr = errors.join(" ").toLowerCase();

  if (errorStr.includes("header")) {
    return "FASTQ headers must start with '@' followed by sequence ID. Check for file corruption.";
  }

  if (errorStr.includes("separator")) {
    return "FASTQ separator line must start with '+'. Note: '+' can also appear in quality scores.";
  }

  if (errorStr.includes("quality") && errorStr.includes("length")) {
    return "Quality string length must exactly match sequence length. File may have wrapped lines.";
  }

  if (errorStr.includes("nucleotide") || errorStr.includes("sequence")) {
    return "Sequence contains invalid characters. Valid: A,C,G,T,U,N and IUPAC ambiguity codes.";
  }

  if (errorStr.includes("empty")) {
    return "FASTQ records cannot have empty sequences or quality strings.";
  }

  // Multiple errors
  if (errors.length > 3) {
    return "Multiple validation errors detected. File may be corrupted or not in FASTQ format.";
  }

  return `Fix these issues: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "..." : ""}`;
}

/**
 * Build detailed error context for debugging
 *
 * @param operation - What operation was being performed
 * @param id - Sequence ID
 * @param lineNumber - Line number where error occurred
 * @param sample - Sample of problematic data
 * @returns Formatted error context
 * @internal
 */
function buildErrorContext(
  operation: string,
  id: string,
  lineNumber?: number,
  sample?: string
): string {
  const parts: string[] = [`Failed during: ${operation}`];

  if (id) {
    parts.push(`Sequence ID: ${id}`);
  }

  if (lineNumber !== undefined && lineNumber !== null) {
    parts.push(`At line: ${lineNumber}`);
  }

  if (sample) {
    // Truncate long samples for readability
    const truncated =
      sample.length > 50 ? `${sample.slice(0, 50)}... (${sample.length} chars total)` : sample;
    parts.push(`Data sample: ${truncated}`);
  }

  return parts.join(" | ");
}

/**
 * Calculate comprehensive quality statistics from scores
 *
 * Pure function for computing quality metrics in a single efficient pass.
 * Avoids multiple array iterations for better performance.
 *
 * @param scores - Array of numeric quality scores
 * @param options - Configuration for statistics calculation
 * @returns Quality statistics object or undefined if no scores
 * @internal
 */
function calculateQualityStatistics(
  scores: number[] | undefined,
  options: { lowQualityThreshold?: number } = {}
): FastqSequence["qualityStats"] | undefined {
  if (!scores || scores.length === 0) {
    return undefined;
  }

  const { lowQualityThreshold = QUALITY_THRESHOLDS.LOW_BASE } = options;

  // Single pass for efficiency - O(n) time, O(1) space
  let sum = 0;
  let min = Number.MAX_SAFE_INTEGER;
  let max = Number.MIN_SAFE_INTEGER;
  let lowQualityCount = 0;

  for (let i = 0; i < scores.length; i++) {
    const score = scores[i];
    if (score === undefined) continue; // Skip undefined values (shouldn't happen but be safe)

    sum += score;
    if (score < min) min = score;
    if (score > max) max = score;
    if (score < lowQualityThreshold) lowQualityCount++;
  }

  return {
    mean: sum / scores.length,
    min,
    max,
    lowQualityBases: lowQualityCount,
  };
}

/**
 * Optimized parser for simple 4-line FASTQ format
 *
 * Assumptions:
 * - Exactly 4 lines per record
 * - No wrapped sequences or quality strings
 * - '@' and '+' only appear as record markers
 *
 * @param lines - Async iterable of input lines
 * @returns Async generator of parsed FASTQ sequences
 *
 * @performance O(n) single pass, minimal allocations
 * @internal
 */
export async function* parseFastPath(
  lines: AsyncIterable<string>,
  qualityEncoding: QualityEncoding = "phred33",
  validationLevel: ValidationLevel = "quick"
): AsyncGenerator<FastqSequence> {
  let lineNumber = 0;
  let record: Partial<{
    id: string;
    description: string | undefined;
    sequence: string;
    quality: string;
  }> = {};

  for await (const line of lines) {
    const position = lineNumber % 4;

    switch (position) {
      case 0: // Header
        if (!isValidHeader(line)) {
          throw new ParseError(
            `Invalid FASTQ header at line ${lineNumber + 1}: must start with '@'`,
            "FASTQ",
            lineNumber + 1
          );
        }
        record.id = extractId(line);
        record.description = extractDescription(line);
        break;

      case 1: // Sequence
        record.sequence = line.trim();
        break;

      case 2: // Separator
        if (!isValidSeparator(line, record.id)) {
          throw new ParseError(
            `Invalid separator at line ${lineNumber + 1}: must start with '+'`,
            "FASTQ",
            lineNumber + 1
          );
        }
        break;

      case 3: {
        // Quality
        record.quality = line.trim();

        // Validate state machine invariant: by case 3, id and sequence must be set
        if (record.id === undefined || record.sequence === undefined) {
          throw new ParseError(
            `Invalid state: reached quality line without id/sequence at line ${lineNumber + 1}`,
            "FASTQ",
            lineNumber + 1
          );
        }

        if (!lengthsMatch(record.sequence, record.quality)) {
          throw new ValidationError(
            `Quality length (${record.quality.length}) doesn't match sequence length (${record.sequence.length}) at line ${lineNumber + 1}`,
            undefined,
            "FASTQ quality validation"
          );
        }

        // Build the record conditionally (all required fields are present)
        const fastqRecord: FastqSequence =
          record.description !== undefined
            ? {
                format: "fastq" as const,
                id: record.id,
                description: record.description,
                sequence: record.sequence,
                quality: record.quality,
                qualityEncoding,
                length: record.sequence.length,
                lineNumber: lineNumber - 3,
              }
            : {
                format: "fastq" as const,
                id: record.id,
                sequence: record.sequence,
                quality: record.quality,
                qualityEncoding,
                length: record.sequence.length,
                lineNumber: lineNumber - 3,
              };

        // Validate if requested
        if (validationLevel !== "none") {
          const result = validateFastqRecord(fastqRecord, validationLevel);
          if (!result.valid) {
            throw new ValidationError(
              result.errors?.join("; ") || "Validation failed",
              undefined,
              "FASTQ validation"
            );
          }
          // Emit the validated record if present, otherwise the original
          if (result.record) {
            yield result.record;
          } else {
            // Validation passed but no modified record, use original
            yield fastqRecord;
          }
        } else {
          // No validation - emit directly
          yield fastqRecord;
        }

        record = {}; // Reset for next record
        break;
      }
    }

    lineNumber++;
  }

  // Check for incomplete record at end
  if (Object.keys(record).length > 0) {
    throw new ParseError(
      `Incomplete FASTQ record at end of file (${Object.keys(record).length}/4 lines)`,
      "FASTQ",
      lineNumber
    );
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

// Re-export for backward compatibility
export { FastqWriter };
export {
  parseFastqHeader,
  validateFastqQuality,
  detectFastqFormat,
  countFastqReads,
  extractFastqIds,
  validateFastqSequence,
};

export { parseMultiLineFastq } from "./state-machine";
export type { FastqParserContext, FastqWriterOptions } from "./types";
export { FastqParsingState } from "./types";

// Quality operations are now in the core quality module:
// import from "@/operations/core/quality" for all quality score operations
