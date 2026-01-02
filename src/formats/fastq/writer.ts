/**
 * FASTQ format writer
 *
 * Provides functionality to format and write FASTQ sequences with support for:
 * - Multiple quality encoding formats
 * - Quality score conversion between encodings
 * - Streaming output for memory efficiency
 * - Optional description field inclusion
 */

import { type } from "arktype";
import { ValidationError } from "../../errors";
import { qualityToScores, scoresToQuality } from "../../operations/core/quality";
import type { FastqSequence, QualityEncoding } from "../../types";
import { PARSING_DEFAULTS } from "./constants";
import {
  assembleFastqRecord,
  chunkQuality,
  chunkSequence,
  extractPlatformInfo,
  formatHeader,
  formatSeparator,
  isValidHeader,
} from "./primitives";
import type { FastqWriterOptions, OutputStrategy } from "./types";
import { type PlatformInfo, type ValidationLevel, validateFastqRecord } from "./validation";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Threshold for considering a sequence "long" for auto-wrapping decisions */
const DEFAULT_LONG_SEQUENCE_THRESHOLD = 100;

// ============================================================================
// TYPES
// ============================================================================

/** Supported sequencing platforms for format-specific handling - uses validation module's type */
type Platform = PlatformInfo["platform"];

// ============================================================================
// ARKTYPE VALIDATION SCHEMAS
// ============================================================================

/**
 * ArkType schema for FASTQ writer options validation
 *
 * Ensures valid option combinations at construction time:
 * - Prevents wrapped strategy without lineLength
 * - Validates line length is positive
 * - Ensures validation level requires validateOutput
 */
const FastqWriterOptionsSchema = type({
  "includeDescription?": "boolean",
  "qualityEncoding?": '"phred33"|"phred64"|"solexa"',
  "lineLength?": "number>=0",
  "validateOutput?": "boolean",
  "validationLevel?": '"none"|"quick"|"full"',
  "preservePlatformFormat?": "boolean",
  "preserveSeparatorId?": "boolean",
  "outputStrategy?": '"simple"|"wrapped"|"auto"',
  "debug?": "boolean",
}).narrow((options, ctx) => {
  // Wrapped strategy requires positive line length
  if (options.outputStrategy === "wrapped" && (!options.lineLength || options.lineLength === 0)) {
    return ctx.reject({
      expected: "outputStrategy 'wrapped' requires lineLength > 0",
      actual: `lineLength=${options.lineLength || 0}`,
      path: ["outputStrategy", "lineLength"],
      message: "Wrapped output format requires a positive line length for wrapping sequences",
    });
  }

  // Validation level only makes sense with validateOutput enabled
  if (options.validationLevel && options.validationLevel !== "none" && !options.validateOutput) {
    return ctx.reject({
      expected: "validationLevel requires validateOutput=true",
      actual: `validationLevel='${options.validationLevel}' with validateOutput=${options.validateOutput || false}`,
      path: ["validationLevel", "validateOutput"],
      message: "Setting a validation level has no effect unless validateOutput is enabled",
    });
  }

  // Line length guidance for modern sequencing
  if (options.lineLength && options.lineLength > 0 && options.lineLength < 50) {
    console.warn(
      `FASTQ Writer: lineLength=${options.lineLength} is very short. ` +
        `Standard FASTQ uses 80, while 50-100 is typical for readability.`
    );
  }

  return true;
});

/**
 * FASTQ format writer with quality encoding conversion support
 *
 * Provides symmetry with the FastqParser for round-trip compatibility.
 * Uses the same validation infrastructure and quality handling as the parser.
 *
 * @example Basic usage
 * ```typescript
 * const writer = new FastqWriter({ qualityEncoding: 'phred33' });
 * const formatted = writer.formatSequence(sequence);
 * ```
 *
 * @example With validation
 * ```typescript
 * const writer = new FastqWriter({
 *   qualityEncoding: 'phred33',
 *   validateOutput: true,
 *   validationLevel: 'full'
 * });
 * const formatted = writer.formatSequence(sequence);
 * // Output is validated using the same rules as the parser
 * ```
 *
 * @example Platform-aware formatting
 * ```typescript
 * const writer = new FastqWriter({
 *   preservePlatformFormat: true,
 *   outputStrategy: 'auto'
 * });
 * // Automatically detects and preserves Illumina/PacBio/Nanopore formats
 * ```
 */
export class FastqWriter {
  private readonly qualityEncoding: QualityEncoding;
  private readonly includeDescription: boolean;
  private readonly lineLength: number;
  private readonly validateOutput: boolean;
  private readonly validationLevel: ValidationLevel;
  private readonly preservePlatformFormat: boolean;
  private readonly preserveSeparatorId: boolean;
  private readonly outputStrategy: OutputStrategy;
  private readonly debug: boolean;

  constructor(options: FastqWriterOptions = {}) {
    // Validate options with ArkType schema
    const validationResult = FastqWriterOptionsSchema(options);

    if (validationResult instanceof type.errors) {
      throw new ValidationError(
        `Invalid FASTQ writer options: ${validationResult.summary}`,
        undefined,
        "FASTQ writer configuration"
      );
    }

    // Set defaults for validated options - use constant instead of hardcoded value
    this.qualityEncoding = options.qualityEncoding || PARSING_DEFAULTS.DEFAULT_ENCODING;
    this.includeDescription = options.includeDescription ?? true;
    this.lineLength = options.lineLength ?? 0;
    this.validateOutput = options.validateOutput ?? false;

    // Set validation level based on validateOutput
    if (this.validateOutput) {
      this.validationLevel = options.validationLevel ?? PARSING_DEFAULTS.DEFAULT_VALIDATION;
    } else {
      this.validationLevel = "none";
    }

    this.preservePlatformFormat = options.preservePlatformFormat ?? false;
    this.preserveSeparatorId = options.preserveSeparatorId ?? false;
    this.outputStrategy = options.outputStrategy ?? "auto";
    this.debug = options.debug ?? false;

    // Log configuration if debug mode is enabled
    if (this.debug) {
      console.log("[FastqWriter] Initialized with options:", {
        qualityEncoding: this.qualityEncoding,
        includeDescription: this.includeDescription,
        lineLength: this.lineLength,
        validateOutput: this.validateOutput,
        validationLevel: this.validationLevel,
        preservePlatformFormat: this.preservePlatformFormat,
        preserveSeparatorId: this.preserveSeparatorId,
        outputStrategy: this.outputStrategy,
      });
    }
  }

  /**
   * Format a single FASTQ sequence as string
   *
   * This is the primary method for writing FASTQ data, symmetric to the parser's parse methods.
   *
   * @param sequence - FASTQ sequence to format
   * @returns Formatted FASTQ string with header, sequence, separator, and quality
   * @throws ValidationError if validateOutput is true and output is invalid
   *
   * @performance O(n) where n is sequence length
   * @memory O(n) for the formatted output string
   *
   * @example
   * ```typescript
   * const formatted = writer.formatSequence({
   *   format: 'fastq',
   *   id: 'seq1',
   *   sequence: 'ATCG',
   *   quality: 'IIII',
   *   qualityEncoding: 'phred33',
   *   length: 4
   * });
   * ```
   */
  formatSequence(sequence: FastqSequence): string {
    // Trust TypeScript types - no need to validate typed input
    // Select strategy and format accordingly
    const strategy = this.selectStrategy(sequence);

    // Route to appropriate formatter
    const formatted =
      strategy === "wrapped" ? this.formatWrapped(sequence) : this.formatSimple(sequence);

    // Validate output if configured
    if (this.validateOutput) {
      this.validateFormattedOutput(formatted);
    }

    return formatted;
  }

  /**
   * Select the output strategy for a sequence
   * @param sequence - FASTQ sequence to format
   * @returns Selected output strategy
   */
  private selectStrategy(sequence: FastqSequence): "simple" | "wrapped" {
    // If explicit strategy is set (not auto), use it
    if (this.outputStrategy === "simple") {
      if (this.debug) {
        console.log("[FastqWriter] Strategy: 'simple' (explicit)");
      }
      return "simple";
    }

    if (this.outputStrategy === "wrapped") {
      // Can only wrap if lineLength is configured (validated in constructor)
      const strategy = this.lineLength > 0 ? "wrapped" : "simple";
      if (this.debug) {
        console.log(
          `[FastqWriter] Strategy: '${strategy}' (wrapped requested, lineLength=${this.lineLength})`
        );
      }
      return strategy;
    }

    // Auto strategy: intelligent selection
    if (this.outputStrategy === "auto") {
      // No wrapping possible if lineLength not configured
      if (this.lineLength <= 0) {
        if (this.debug) {
          console.log("[FastqWriter] Strategy: 'simple' (auto - no lineLength configured)");
        }
        return "simple";
      }

      // Consider sequence length
      const seqLength = sequence.sequence.length;

      // Long sequences benefit from wrapping for readability
      if (seqLength > DEFAULT_LONG_SEQUENCE_THRESHOLD && seqLength > this.lineLength) {
        if (this.debug) {
          console.log(
            `[FastqWriter] Strategy: 'wrapped' (auto - long sequence: ${seqLength} bp > threshold ${DEFAULT_LONG_SEQUENCE_THRESHOLD} and > lineLength ${this.lineLength})`
          );
        }
        return "wrapped";
      }

      // PacBio/Nanopore reads are often very long and should be wrapped
      const platform = this.detectPlatform(sequence);
      if ((platform === "pacbio" || platform === "nanopore") && seqLength > this.lineLength) {
        if (this.debug) {
          console.log(
            `[FastqWriter] Strategy: 'wrapped' (auto - ${platform} platform, ${seqLength} bp > lineLength ${this.lineLength})`
          );
        }
        return "wrapped";
      }

      // Default to simple for short sequences
      if (this.debug) {
        console.log(
          `[FastqWriter] Strategy: 'simple' (auto - default for short sequence: ${seqLength} bp)`
        );
      }
      return "simple";
    }

    // Fallback (should not reach here due to type system)
    if (this.debug) {
      console.log("[FastqWriter] Strategy: 'simple' (fallback)");
    }
    return "simple";
  }

  /**
   * Format sequence in simple 4-line FASTQ format
   * @param sequence - FASTQ sequence to format
   * @returns Simple 4-line FASTQ record
   */
  private formatSimple(sequence: FastqSequence): string {
    // Use platform-aware formatting
    const header = this.formatPlatformHeader(sequence);
    const separator = this.formatPlatformSeparator(sequence);

    // Convert quality if needed
    const quality = this.convertQuality(sequence);

    // Assemble the complete record
    return assembleFastqRecord(header, sequence.sequence, separator, quality);
  }

  /**
   * Format sequence with wrapped lines for long sequences
   * @param sequence - FASTQ sequence to format
   * @returns Multi-line wrapped FASTQ record
   */
  private formatWrapped(sequence: FastqSequence): string {
    // Use platform-aware formatting for header and separator
    const header = this.formatPlatformHeader(sequence);
    const separator = this.formatPlatformSeparator(sequence);

    // Chunk the sequence into lines of specified width
    const seqChunks = chunkSequence(sequence.sequence, this.lineLength);

    // Convert and chunk the quality string
    const quality = this.convertQuality(sequence);
    const qualChunks = chunkQuality(quality, this.lineLength);

    // Assemble wrapped format
    return [header, ...seqChunks, separator, ...qualChunks].join("\n");
  }

  /**
   * Convert quality encoding if needed
   * @param sequence - FASTQ sequence with quality scores
   * @returns Quality string in the target encoding
   */
  private convertQuality(sequence: FastqSequence): string {
    if (sequence.qualityEncoding === this.qualityEncoding) {
      if (this.debug) {
        console.log(
          `[FastqWriter] Quality encoding: no conversion needed (${this.qualityEncoding})`
        );
      }
      return sequence.quality;
    }

    if (this.debug) {
      console.log(
        `[FastqWriter] Converting quality: ${sequence.qualityEncoding} -> ${this.qualityEncoding}`
      );
    }

    // Let qualityToScores and scoresToQuality throw their own errors if conversion fails
    const scores = qualityToScores(sequence.quality, sequence.qualityEncoding);
    return scoresToQuality(scores, this.qualityEncoding);
  }

  /**
   * Validate formatted FASTQ output using the same validation infrastructure as the parser
   * @param formatted - Formatted FASTQ string to validate
   * @throws ValidationError if output is invalid
   */
  private validateFormattedOutput(formatted: string): void {
    if (!this.validateOutput || this.validationLevel === "none") {
      return;
    }

    const lines = formatted.split("\n");

    // Basic structural validation
    if (lines.length < 4) {
      throw new ValidationError(
        `Invalid FASTQ output: expected at least 4 lines, got ${lines.length}. ` +
          `A valid FASTQ record must have: header line, sequence line(s), separator line, and quality line(s).`
      );
    }

    // Parse the formatted output back into a sequence object
    const headerLine = lines[0];
    if (!headerLine || !isValidHeader(headerLine)) {
      throw new ValidationError(
        `Invalid FASTQ header in output at line 1: "${headerLine}". ` +
          `Header must start with '@' followed by a sequence identifier.`
      );
    }

    // Find separator line
    let separatorIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.startsWith("+")) {
        separatorIndex = i;
        break;
      }
    }

    if (separatorIndex === -1) {
      throw new ValidationError(
        `Invalid FASTQ output: no separator line found. ` +
          `Expected a line starting with '+' after the sequence data.`
      );
    }

    // Extract components
    const sequenceLines = lines.slice(1, separatorIndex);
    const qualityLines = lines.slice(separatorIndex + 1);
    const sequence = sequenceLines.join("");
    const quality = qualityLines.join("");

    // Parse header to extract ID and description
    const headerMatch = headerLine.match(/^@(\S+)(?:\s+(.*))?$/);
    if (!headerMatch) {
      throw new ValidationError(`Invalid FASTQ header format: "${headerLine}"`);
    }

    const [, id, description] = headerMatch;

    // Create a FastqSequence object for validation
    const reconstructed: Partial<FastqSequence> = {
      format: "fastq",
      id: id || "",
      ...(description !== undefined && { description }),
      sequence,
      quality,
      qualityEncoding: this.qualityEncoding,
      length: sequence.length,
    };

    // Use the same validation function as the parser
    const result = validateFastqRecord(reconstructed, this.validationLevel);

    if (!result.valid) {
      const errors = result.errors || ["Unknown validation error"];
      throw new ValidationError(`FASTQ output validation failed:\n${errors.join("\n")}`);
    }

    // Log warnings if in full validation mode
    if (this.validationLevel === "full" && result.warnings && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.warn(`FASTQ Writer Warning: ${warning.message}`);
      }
    }
  }

  /**
   * Detect platform from sequence header
   * @param sequence - FASTQ sequence to analyze
   * @returns Platform name if detected, 'unknown' otherwise
   */
  private detectPlatform(sequence: FastqSequence): Platform {
    // Construct full header line for platform detection
    const headerLine = `@${sequence.id}${sequence.description ? ` ${sequence.description}` : ""}`;
    const platformInfo = extractPlatformInfo(headerLine);

    // Ensure we return a valid Platform type
    const detectedPlatform = platformInfo?.platform;

    if (this.debug && platformInfo) {
      console.log(
        `[FastqWriter] Platform detected: ${detectedPlatform}` +
          (platformInfo.flowcell ? ` (flowcell: ${platformInfo.flowcell})` : "") +
          (platformInfo.lane ? ` (lane: ${platformInfo.lane})` : "")
      );
    }

    if (
      detectedPlatform === "illumina" ||
      detectedPlatform === "pacbio" ||
      detectedPlatform === "nanopore"
    ) {
      return detectedPlatform;
    }

    if (this.debug && !platformInfo) {
      console.log("[FastqWriter] Platform: unknown (no pattern match)");
    }

    return "unknown";
  }

  /**
   * Format header with platform-specific formatting
   * @param sequence - FASTQ sequence to format
   * @returns Formatted header line
   */
  private formatPlatformHeader(sequence: FastqSequence): string {
    if (!this.preservePlatformFormat) {
      // Use standard formatting
      return formatHeader(
        sequence.id,
        this.includeDescription && sequence.description ? sequence.description : undefined
      );
    }

    // Detect platform and preserve its specific format
    const platform = this.detectPlatform(sequence);

    // For recognized platforms, preserve the original format exactly
    if (platform === "illumina" || platform === "pacbio") {
      // Preserve the exact ID and description format
      const header = `@${sequence.id}`;
      return sequence.description ? `${header} ${sequence.description}` : header;
    }

    // For unknown platforms, use standard formatting
    return formatHeader(
      sequence.id,
      this.includeDescription && sequence.description ? sequence.description : undefined
    );
  }

  /**
   * Format separator with optional ID preservation
   * @param sequence - FASTQ sequence (for ID if needed)
   * @returns Formatted separator line
   */
  private formatPlatformSeparator(sequence: FastqSequence): string {
    if (this.preserveSeparatorId) {
      // Old FASTQ format includes ID in separator
      return formatSeparator(sequence.id);
    }
    // Modern format uses simple '+'
    return formatSeparator();
  }

  /**
   * Format multiple sequences as string
   *
   * @param sequences - Array of FASTQ sequences
   * @returns Formatted FASTQ string with all sequences
   *
   * Symmetric to the parser's ability to parse multiple sequences.
   * Memory consideration: For large datasets, use writeToStream instead.
   *
   * @param sequences - Array or iterable of FASTQ sequences to format
   * @returns Formatted FASTQ string with all sequences concatenated
   * @throws ValidationError if validateOutput is true and any output is invalid
   *
   * @performance O(n*m) where n is number of sequences, m is average sequence length
   * @memory O(n*m) - accumulates all formatted sequences in memory
   *
   * @example
   * ```typescript
   * const formatted = writer.formatSequences([seq1, seq2, seq3]);
   * // Returns multi-sequence FASTQ file content
   * ```
   */
  formatSequences(sequences: Iterable<FastqSequence>): string {
    const formatted: string[] = [];

    for (const sequence of sequences) {
      formatted.push(this.formatSequence(sequence));
    }

    if (formatted.length === 0) {
      console.warn("FastqWriter: No sequences to format");
    }

    return formatted.join("\n");
  }

  /**
   * Format sequences as an async iterable stream
   *
   * Memory-efficient streaming output for large datasets, symmetric to the parser's
   * async iteration support.
   *
   * @param sequences - Async iterable of sequences to format
   * @yields Formatted FASTQ strings
   *
   * @example
   * ```typescript
   * for await (const chunk of writer.formatStream(sequences)) {
   *   await writeToFile(chunk);
   * }
   * ```
   */
  async *formatStream(sequences: AsyncIterable<FastqSequence>): AsyncGenerator<string> {
    for await (const sequence of sequences) {
      yield `${this.formatSequence(sequence)}\n`;
    }
  }

  /**
   * Write sequences to a WritableStream
   *
   * Provides full streaming support symmetric to the parser's streaming capabilities.
   *
   * @param sequences - Async iterable of FASTQ sequences
   * @param stream - Writable stream to write to
   */
  async writeToStream(
    sequences: AsyncIterable<FastqSequence>,
    stream: WritableStream<Uint8Array>
  ): Promise<void> {
    const writer = stream.getWriter();
    const encoder = new TextEncoder();

    try {
      for await (const sequence of sequences) {
        const formatted = `${this.formatSequence(sequence)}\n`;
        await writer.write(encoder.encode(formatted));
      }
    } finally {
      writer.releaseLock();
    }
  }
}
