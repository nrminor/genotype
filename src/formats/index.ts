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

// FASTA format exports
export { FastaParser, FastaWriter, FastaUtils } from './fasta';

// FASTQ format exports
export {
  FastqParser,
  FastqWriter,
  FastqUtils,
  QualityScores,
  toNumbers,
  toString,
  getOffset,
  detectEncoding,
  calculateStats,
} from './fastq';

// BED format exports
export {
  BedParser,
  BedWriter,
  BedFormat,
  BedUtils,
  detectVariant,
  validateStrand,
  parseRgb,
  validateCoordinates,
  detectFormat,
  countIntervals,
  calculateStats as calculateBedStats,
  sortIntervals,
  mergeOverlapping,
} from './bed';

// SAM format exports
export { SAMParser, SAMWriter, SAMUtils } from './sam';

// BAM format exports
export {
  BAMParser,
  BAMWriter,
  BAMUtils,
  BGZFCompressor,
  BAIReader,
  BAIWriter,
  VirtualOffsetUtils,
  BinningUtils,
} from './bam';

// GTF format exports
export {
  GtfParser,
  GtfWriter,
  GtfFormat,
  GtfUtils,
  type GtfFeature,
  type GtfParserOptions,
  validateGtfCoordinates,
  parseGtfAttributes,
  validateGtfStrand,
  parseGtfScore,
  parseGtfFrame,
  detectGtfFormat,
  countGtfFeatures,
  filterFeaturesByType,
} from './gtf';
