/**
 * Core primitives and abstractions for SeqOps operations
 *
 * These modules provide the foundational infrastructure for all
 * sequence operations in the Genotype library.
 */

// Re-export quality encoding from types to maintain backward compatibility
export { QualityEncoding } from "../../types";
// Re-export SequenceValidator from operations for backward compatibility
export { SequenceValidator } from "../validate";
// Note: SeqOps is now exported from operations/index.ts, not here
// Bloom filters for deduplication (low-level)
export { BloomFilter, CountingBloomFilter, ScalableBloomFilter } from "./bloom-filter";
// Sequence calculations (from calculations.ts)
export {
  atContent,
  baseComposition,
  findQualityTrimEnd,
  findQualityTrimStart,
  gcContent,
  SequenceCalculations,
  translateSimple,
} from "./calculations";
// Genomic coordinate parsing and validation
export {
  type ParsedCoordinates,
  parseEndPosition,
  parseStartPosition,
  validateFinalCoordinates,
  validateRegionParts,
  validateRegionString,
} from "./coordinates";
// Quality score encoding detection and conversion
// Export both individual functions and grouped object for flexibility
export {
  averageQuality,
  charToScore,
  convertScore,
  // Individual functions (tree-shakeable)
  detectEncoding,
  detectEncodingImmediate,
  detectEncodingStatistical,
  errorProbabilityToScore,
  getEncodingRange,
  // Grouped object for convenience
  QualityEncodingDetector,
  scoreToChar,
  scoreToErrorProbability,
  validateQualityString,
} from "./encoding";
// NCBI genetic code tables (tree-shakeable functions)
export {
  findORFs,
  GeneticCode,
  GeneticCodes,
  getGeneticCode,
  isAlternativeStart,
  isStartCodon,
  isStopCodon,
  listGeneticCodes,
  translate,
  translateCodon,
  translateSixFrames,
} from "./genetic-codes";
// Memory management strategies
export { MemoryStrategy } from "./interfaces";
// Memory management strategies (low-level)
export {
  AdaptiveBuffer,
  DefaultMemoryMonitor,
  DiskCache,
  ExternalSorter,
  type MemoryMonitor,
} from "./memory";
// Pattern matching algorithms and utilities
// Pattern matching additions (from pattern-matching.ts)
export {
  // Low-level algorithm functions
  boyerMoore,
  findOverlapping,
  findPalindromes,
  findPattern,
  findPattern as findPatternTransform,
  findSimplePattern,
  findTandemRepeats,
  fuzzyMatch,
  hasPattern,
  hasPatternWithMismatches,
  isPalindromic,
  kmpSearch,
  longestCommonSubstring,
  type MatcherOptions,
  matchWithAmbiguous,
  type PatternMatch,
  // Legacy compatibility
  PatternMatcher,
  rabinKarp,
  type SequenceMatch,
  // High-level class
  SequenceMatcher,
} from "./pattern-matching";
// Reservoir sampling for streaming
export {
  BernoulliSampler,
  RandomSampler,
  ReservoirSampler,
  StratifiedSampler,
  SystematicSampler,
  WeightedReservoirSampler,
} from "./sampling";
// User-friendly sequence deduplication
export {
  type DeduplicationOptions,
  type DeduplicationStats,
  type DeduplicationStrategy,
  deduplicateSequences,
  ExactDeduplicator,
  findDuplicates,
  SequenceDeduplicator,
} from "./sequence-deduplicator";
// Sequence manipulation operations (from sequence-manipulation.ts)
export {
  complement,
  removeGaps,
  replaceAmbiguousBases,
  reverse,
  reverseComplement,
  SequenceManipulation,
  toDNA,
  toRNA,
} from "./sequence-manipulation";
// User-friendly sequence sorting
export {
  getTopSequences,
  SequenceSorter,
  type SortBy,
  type SortOptions,
  sortSequences,
} from "./sequence-sorter";
// Sequence validation with IUPAC handling
export {
  expandAmbiguous,
  IUPAC_DNA,
  IUPAC_PROTEIN,
  IUPAC_RNA,
  SequenceType,
  ValidationMode,
  // Note: SequenceValidator class moved to operations/validate.ts
} from "./sequence-validation";
// Statistics accumulator for streaming analysis
export {
  calculateSequenceStats,
  type SequenceStats,
  SequenceStatsAccumulator,
} from "./statistics";
// Common validation utilities for operations
export {
  CommonValidators,
  createOptionsValidator,
  createSafeOptionsValidator,
  createValidationError,
} from "./validation-utils";

import * as calcs from "./calculations";
import { findSimplePattern as findPat, isPalindromic as isPalin } from "./pattern-matching";
// Import all items needed for backward compatibility object
import * as seqManip from "./sequence-manipulation";

// Backward compatibility: SequenceTransforms combined from new modules
export const SequenceTransforms = {
  complement: seqManip.complement,
  reverse: seqManip.reverse,
  reverseComplement: seqManip.reverseComplement,
  toRNA: seqManip.toRNA,
  toDNA: seqManip.toDNA,
  removeGaps: seqManip.removeGaps,
  replaceAmbiguousBases: seqManip.replaceAmbiguousBases,
  gcContent: calcs.gcContent,
  atContent: calcs.atContent,
  baseComposition: calcs.baseComposition,
  translateSimple: calcs.translateSimple,
  isPalindromic: isPalin,
  findPattern: findPat,
} as const;
