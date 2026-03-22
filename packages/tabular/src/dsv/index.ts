/**

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

export type {
  DelimiterType,
  DSVFormat,
  DSVParserOptions,
  DSVParserState,
  DSVRecord,
  DSVWriterOptions,
} from "@genotype/tabular/dsv/types";

export { CSVParseState } from "@genotype/tabular/dsv/types";

export { CSVParser, DSVParser, TSVParser } from "@genotype/tabular/dsv/parser";

export { CSVWriter, DSVWriter, TSVWriter } from "@genotype/tabular/dsv/writer";

export {
  detectDelimiter,
  detectFormat,
  detectHeaders,
  extractHeaders,
  FormatDetector,
  sniff,
} from "@genotype/tabular/dsv/detection";

export {
  DSVParserOptionsSchema,
  DSVWriterOptionsSchema,
  FieldValidator,
  validateDSV,
  validateFieldSize,
} from "@genotype/tabular/dsv/validation";

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
} from "@genotype/tabular/dsv/utils";

export { ExcelProtector, protectFromExcel } from "@genotype/tabular/dsv/excel-protection";

export {
  CSVFieldParser,
  countUnescapedQuotes,
  hasBalancedQuotes,
  parseCSVRow,
} from "@genotype/tabular/dsv/state-machine";

export {
  COMMENT_PREFIXES,
  DEFAULT_DELIMITERS,
  DEFAULT_ESCAPE,
  DEFAULT_QUOTE,
  EXCEL_GENE_PATTERNS,
  MAX_DETECTION_LINES,
  MAX_FIELD_SIZE,
  MAX_ROW_SIZE,
} from "@genotype/tabular/dsv/constants";
