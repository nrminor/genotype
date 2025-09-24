/**
 * Central format module exports
 *
 * Provides a single import point for all format parsers, writers, and utilities.
 * This eliminates import fragmentation and ensures consistent module access patterns.
 *
 * @example
 * ```typescript
 * // Instead of scattered imports:
 * import { FastaParser, FastaWriter } from './fasta';
 * import { FastqParser } from './fastq';
 *
 * // Use central imports:
 * import { FastaParser, FastaWriter, FastqParser } from '../formats';
 * ```
 */

// BAM format exports
export {
  BAIReader,
  BAIWriter,
  BAMParser,
  BAMUtils,
  BAMWriter,
  BGZFCompressor,
  BinningUtils,
  VirtualOffsetUtils,
} from "./bam";
// BED format exports
export {
  BedFormat,
  BedParser,
  BedUtils,
  BedWriter,
  calculateStats as calculateBedStats,
  countIntervals,
  detectFormat,
  detectVariant,
  mergeOverlapping,
  parseRgb,
  sortIntervals,
  validateCoordinates,
  validateStrand,
} from "./bed";
// DSV/CSV/TSV format exports
export {
  CSVParser,
  CSVWriter,
  calculateBaseCount,
  calculateGC,
  type DSVFormat,
  DSVParser,
  type DSVParserOptions,
  type DSVRecord,
  DSVWriter,
  type DSVWriterOptions,
  detectDelimiter,
  detectHeaders,
  handleRaggedRow,
  normalizeLineEndings,
  parseCSVRow,
  protectFromExcel,
  removeBOM,
  TSVParser,
  TSVWriter,
  validateFieldSize,
} from "./dsv";
// FASTA format exports
export { FastaParser, FastaUtils, FastaWriter } from "./fasta";
// FASTQ format exports
export {
  FastqParser,
  FastqUtils,
  FastqWriter,
} from "./fastq";
// GTF format exports
export {
  countGtfFeatures,
  detectGtfFormat,
  filterFeaturesByType,
  type GtfFeature,
  GtfFormat,
  GtfParser,
  type GtfParserOptions,
  GtfUtils,
  GtfWriter,
  parseGtfAttributes,
  parseGtfFrame,
  parseGtfScore,
  validateGtfCoordinates,
  validateGtfStrand,
} from "./gtf";
// SAM format exports
export { SAMParser, SAMUtils, SAMWriter } from "./sam";
