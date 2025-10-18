/**
 * DSV Format Type Definitions
 *
 * All types and interfaces for the DSV (Delimiter-Separated Values) module.
 * Supports CSV, TSV, and other delimiter-separated formats with full RFC 4180 compliance.
 */

import type { ParserOptions } from "../../types";

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
  lineNumber?: number; // Source line number for error reporting
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

/**
 * Parser state for resumable DSV parsing
 * Allows parseString to work with both full strings and streaming chunks
 */
export interface DSVParserState {
  accumulatedRow: string; // Current row being built (may span lines)
  rowStartLine: number; // Line number where current row started
  inMultiLineField: boolean; // Whether currently in a quoted field that spans lines
  linesInCurrentField: number; // Track lines for maxFieldLines limit
  currentLineNumber: number; // Current line number being processed
  headerProcessed: boolean; // Whether header row has been processed
  expectedColumns: number; // Expected column count for validation
}
