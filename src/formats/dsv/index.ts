/**
 * @module formats/dsv
 * @description DSV (Delimiter-Separated Values) format support
 *
 * This module provides comprehensive support for parsing and writing CSV, TSV,
 * and other delimiter-separated formats.
 *
 * Features:
 * - RFC 4180 compliant CSV parsing
 * - Automatic format and delimiter detection
 * - Excel protection for genomic data
 * - Streaming support for large files
 * - Transparent compression handling (gzip/zstd)
 * - Multi-line field support with proper quoting
 * - Configurable error recovery
 *
 * @example Basic CSV parsing
 * ```typescript
 * import { CSVParser } from './formats/dsv';
 *
 * const parser = new CSVParser({ header: true });
 * for await (const record of parser.parseFile('data.csv')) {
 *   console.log(record);
 * }
 * ```
 *
 * @example Format detection
 * ```typescript
 * import { sniff } from './formats/dsv';
 *
 * const info = await sniff(fileContent);
 * console.log(`Format: ${info.format}, Delimiter: ${info.delimiter}`);
 * ```
 *
 * @example Excel protection
 * ```typescript
 * import { ExcelProtector } from './formats/dsv';
 *
 * const protector = new ExcelProtector();
 * const safeValue = protector.protect("SEPT1"); // Returns "'SEPT1"
 * ```
 */

// =============================================================================
// RE-EXPORTS - TYPES
// =============================================================================

export type {
  DelimiterType,
  DSVFormat,
  DSVParserOptions,
  DSVParserState,
  DSVRecord,
  DSVWriterOptions,
} from "./types";

export { CSVParseState } from "./types";

// =============================================================================
// RE-EXPORTS - MAIN CLASSES
// =============================================================================

export { CSVParser, DSVParser, TSVParser } from "./parser";

export { CSVWriter, DSVWriter, TSVWriter } from "./writer";

// =============================================================================
// RE-EXPORTS - DETECTION
// =============================================================================

export {
  detectDelimiter,
  detectFormat,
  detectHeaders,
  extractHeaders,
  FormatDetector,
  sniff,
} from "./detection";

// =============================================================================
// RE-EXPORTS - VALIDATION
// =============================================================================

export {
  DSVParserOptionsSchema,
  DSVWriterOptionsSchema,
  FieldValidator,
  validateDSV,
  validateFieldSize,
} from "./validation";

// =============================================================================
// RE-EXPORTS - UTILITIES
// =============================================================================

export {
  calculateBaseCount,
  calculateGC,
  calculateGCSkew,
  countColumns,
  extractHeaders as simpleExtractHeaders,
  handleRaggedRow,
  normalizeLineEndings,
  removeBOM,
  summarizeDSV,
} from "./utils";

// =============================================================================
// RE-EXPORTS - EXCEL PROTECTION
// =============================================================================

export { ExcelProtector, protectFromExcel } from "./excel-protection";

// =============================================================================
// RE-EXPORTS - STATE MACHINE (Low-level CSV parsing)
// =============================================================================

export {
  CSVFieldParser,
  countUnescapedQuotes,
  hasBalancedQuotes,
  parseCSVRow,
} from "./state-machine";

// =============================================================================
// RE-EXPORTS - CONSTANTS
// =============================================================================

export {
  COMMENT_PREFIXES,
  DEFAULT_DELIMITERS,
  DEFAULT_ESCAPE,
  DEFAULT_QUOTE,
  EXCEL_GENE_PATTERNS,
  MAX_DETECTION_LINES,
  MAX_FIELD_SIZE,
  MAX_ROW_SIZE,
} from "./constants";
