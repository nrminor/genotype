/**
 * DSV Format Constants
 *
 * All constants and magic values for the DSV module.
 * Includes delimiters, limits, patterns, and configuration values.
 */

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
