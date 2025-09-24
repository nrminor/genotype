/**
 * Type definitions for FASTQ format parsing and writing
 *
 * Contains all interfaces, enums, and type aliases used by the FASTQ module.
 * Separated for better organization and to prevent circular dependencies.
 */

import type { ParserOptions, QualityEncoding } from "../../types";

/**
 * Parsing strategy for FASTQ format selection
 *
 * Determines which parsing algorithm to use:
 * - 'auto': Automatically detect format complexity and choose optimal parser
 * - 'fast': Force fast path parser for simple 4-line FASTQ (will fail on complex)
 * - 'state-machine': Force state machine parser for any valid FASTQ format
 */
export type ParsingStrategy = "auto" | "fast" | "state-machine";

/**
 * State machine states for multi-line FASTQ parsing
 *
 * FASTQ records can span multiple lines, requiring stateful parsing to handle:
 * - Multi-line sequences (wrapped like FASTA)
 * - Multi-line quality scores
 * - Contamination of '@' and '+' markers in quality data
 */
export enum FastqParsingState {
  WAITING_HEADER, // Looking for @ line to start new record
  READING_SEQUENCE, // Accumulating sequence lines until + separator
  WAITING_SEPARATOR, // Looking for + line (may be contaminated in quality)
  READING_QUALITY, // Accumulating quality until length matches sequence
}

/**
 * State machine parser context for multi-line FASTQ parsing
 * Tracks parsing state and accumulated data for robust record detection
 */
export interface FastqParserContext {
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
export interface FastqParserOptions extends ParserOptions {
  /** Custom quality encoding for FASTQ format */
  qualityEncoding?: QualityEncoding;
  /** Whether to parse quality scores immediately */
  parseQualityScores?: boolean;
  /** Validation level: none (fastest), quick (default), or full (comprehensive) */
  validationLevel?: "none" | "quick" | "full";
  /**
   * Parsing strategy selection
   * - 'auto': Automatically detect and choose (default)
   * - 'fast': Force fast path parser (4-line format only)
   * - 'state-machine': Force state machine parser (handles all formats)
   */
  parsingStrategy?: ParsingStrategy;
  /**
   * Confidence threshold for auto-detection
   * When format detection confidence is below this, use state machine
   * Default: 0.8
   */
  confidenceThreshold?: number;
  /**
   * Enable debug logging for strategy selection
   */
  debugStrategy?: boolean;
}

/**
 * FASTQ writer options
 */
/** Output formatting strategy */
export type OutputStrategy = "simple" | "wrapped" | "auto";

export interface FastqWriterOptions {
  /** Whether to include the optional description after the ID */
  includeDescription?: boolean;
  /** Quality encoding to use for quality scores */
  qualityEncoding?: QualityEncoding;
  /** Maximum line length for wrapping (0 = no wrapping) */
  lineLength?: number;
  /** Whether to validate output before returning */
  validateOutput?: boolean;
  /** Validation level for output checking */
  validationLevel?: "none" | "quick" | "full";
  /** Whether to preserve platform-specific header formats */
  preservePlatformFormat?: boolean;
  /** Whether to preserve separator ID (old FASTQ format) */
  preserveSeparatorId?: boolean;
  /** Output strategy for formatting ('simple', 'wrapped', or 'auto') */
  outputStrategy?: OutputStrategy;
  /** Enable debug logging for strategy selection and format decisions */
  debug?: boolean;
}
