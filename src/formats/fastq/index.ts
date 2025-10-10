/**
 * FASTQ Format Module
 *
 * Comprehensive support for FASTQ format parsing, writing, and manipulation.
 * Handles the complexity of real-world sequencing data including:
 * - Multiple quality encoding schemes (Phred+33, Phred+64, Solexa)
 * - Multi-line sequences and quality strings (Sanger specification)
 * - Platform-specific variations (Illumina, PacBio, Nanopore)
 * - Robust parsing with '@' and '+' contamination in quality data
 * - Paired-end FASTQ parsing with optional read synchronization
 *
 * @module fastq
 * @since v0.1.0
 *
 * @example Basic FASTQ parsing
 * ```typescript
 * import { FastqParser } from '@/formats/fastq';
 *
 * const parser = new FastqParser();
 * for await (const read of parser.parseString(fastqData)) {
 *   console.log(`${read.id}: ${read.sequence.length} bp, Q${read.qualityEncoding}`);
 * }
 * ```
 *
 * @example Paired-end FASTQ parsing
 * ```typescript
 * import { PairedFastqParser } from '@/formats/fastq';
 *
 * const parser = new PairedFastqParser();
 * for await (const pair of parser.parseFiles('R1.fastq', 'R2.fastq')) {
 *   console.log(`${pair.r1.id}: ${pair.totalLength} bp total`);
 * }
 * ```
 *
 * @example Paired-end with synchronization checking
 * ```typescript
 * import { PairedFastqParser } from '@/formats/fastq';
 *
 * const parser = new PairedFastqParser({
 *   checkPairSync: true,
 *   onMismatch: 'throw',
 * });
 *
 * for await (const pair of parser.parseFiles('R1.fastq', 'R2.fastq')) {
 *   console.log(`Pair ${pair.pairId}: R1=${pair.r1.length}bp, R2=${pair.r2.length}bp`);
 * }
 * ```
 *
 * @example Quality score analysis
 * ```typescript
 * import { toNumbers, calculateStats } from '@/formats/fastq';
 *
 * const scores = toNumbers(quality, 'phred33');
 * const stats = calculateStats(scores);
 * console.log(`Mean quality: ${stats.mean.toFixed(1)}`);
 * ```
 *
 * @example Format conversion
 * ```typescript
 * import { FastqParser, FastqWriter } from '@/formats/fastq';
 *
 * const parser = new FastqParser({ qualityEncoding: 'phred64' });
 * const writer = new FastqWriter({ qualityEncoding: 'phred33' });
 *
 * // Convert from Phred+64 to Phred+33
 * for await (const read of parser.parseFile('old_illumina.fastq')) {
 *   console.log(writer.formatSequence(read));
 * }
 * ```
 */

// ============================================================================
// EXPORTS
// ============================================================================

// Re-exports from parent module
/**
 * FASTQ sequence record type
 * @group Types
 */
export type { FastqSequence } from "../../types";
/**
 * Quality encoding schemes
 * @group Types
 */
export { QualityEncoding } from "../../types";
// Detection Functions
/**
 * Detection functions for FASTQ format analysis
 * @group Detection
 */
export {
  autoDetectFastqFormat,
  detectFastqComplexity,
  detectFastqFormat,
  detectQualityEncoding,
  detectSequencingPlatform,
} from "./detection";
// Core Classes
/**
 * Primary FASTQ parser with streaming support and multi-line handling
 * @group Core
 */
export { FastqParser, parseFastPath } from "./parser";
// Quality Score Operations
/**
 * Quality score operations for FASTQ sequences
 *
 * These functions provide comprehensive quality score handling including:
 * - Validation of quality strings for specific encodings
 * - Conversion between different quality encoding schemes
 * - Statistical analysis of quality scores
 * - Conversion to/from numeric Phred scores
 * - Overall quality assessment and window-based analysis
 * - Quality-based trimming suggestions
 *
 * @group Quality
 */
export {
  analyzeQualityWindows,
  assessQuality,
  convertQualityEncoding,
  fromPhredScores,
  getQualityStatistics,
  suggestQualityTrimming,
  toPhredScores,
  validateQualityString,
} from "./quality";
// Advanced Exports
/**
 * Low-level state machine for multi-line FASTQ parsing
 * Used internally but exposed for advanced use cases
 * @group Advanced
 */
export { parseMultiLineFastq } from "./state-machine";

// Type Exports
/**
 * FASTQ type definitions for parser and writer configuration
 *
 * - FastqParserOptions: Configuration for parsing behavior
 * - FastqWriterOptions: Configuration for writing/formatting
 * - FastqParserContext: Internal state for multi-line parsing
 *
 * @group Types
 */
export type { FastqParserContext, FastqParserOptions, FastqWriterOptions } from "./types";

/**
 * State machine states for multi-line parsing
 * @group Types
 */
export { FastqParsingState } from "./types";
// Utility Functions
/**
 * FASTQ utility functions for common operations
 *
 * These utilities provide efficient operations without full parsing:
 * - Header line parsing to extract ID and description
 * - Quality string length validation against sequence
 * - Format detection for quick file type identification
 * - Read counting without loading full sequences
 * - Fast ID extraction for indexing
 * - Sequence character validation
 *
 * @group Utilities
 */
/**
 * Collection of FASTQ utility functions
 * @deprecated Import individual functions for better tree-shaking
 * @group Utilities
 */
export {
  countFastqReads,
  extractFastqIds,
  FastqUtils,
  parseFastqHeader,
  validateFastqQuality,
  validateFastqSequence,
} from "./utils";
/**
 * FASTQ writer with quality encoding conversion
 * @group Core
 */
export { FastqWriter } from "./writer";

// Paired-End Support
/**
 * Paired-end FASTQ parser with read synchronization
 *
 * Provides ergonomic parsing of paired-end sequencing data (R1/R2 files)
 * with optional read ID synchronization validation.
 *
 * @group Paired-End
 */
export { PairedFastqParser } from "./paired";

/**
 * Error thrown when paired reads are out of sync
 * @group Paired-End
 */
export { PairSyncError } from "../../errors";

/**
 * Paired-end parser configuration options
 * @group Paired-End
 */
export type { PairedFastqParserOptions, PairedFastqRead } from "./types";
