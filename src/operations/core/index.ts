/**
 * Core primitives and abstractions for SeqOps operations
 *
 * These modules provide the foundational infrastructure for all
 * sequence operations in the Genotype library.
 */

// Re-export quality encoding from types to maintain backward compatibility
export { QualityEncoding } from "@genotype/core/types";
export { SequenceValidator } from "./sequence-validation";
export type { DNASequence, IUPACSequence, PrimerSequence, RNASequence } from "./alphabet";
// Alphabet validation and template literal tags
export {
  dna,
  isDNASequence,
  isIUPACSequence,
  isPrimerSequence,
  isRNASequence,
  iupac,
  primer,
  rna,
  validateAndBrand,
} from "./alphabet";
// Note: SeqOps is now exported from operations/index.ts, not here
// Bloom filters for deduplication (low-level)
export { BloomFilter, CountingBloomFilter, ScalableBloomFilter } from "./bloom-filter";
// Sequence calculations (from calculations.ts)
export {
  atContent,
  baseComposition,
  baseContent,
  baseCount,
  gcContent,
  SequenceCalculations,
  sequenceAlphabet,
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
// Hashing utilities
export {
  type HashAlgorithm,
  hash,
  hashMD5,
  hashSHA1,
  hashSHA256,
  hashString,
  murmurHash3,
} from "./hashing";
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
  rabinKarp,
  type SequenceMatch,
  SequenceMatcher,
} from "./pattern-matching";
// Quality score encoding detection and conversion
// Now re-exported from the unified quality module
export {
  calculateAverageQuality,
  // Statistics
  calculateQualityStats,
  // Core conversions
  charToScore,
  convertQuality,
  // Types
  type DetectionResult,
  // Detection
  detectEncoding,
  detectEncodingWithConfidence,
  errorProbabilityToScore,
  // Encoding info
  getEncodingInfo,
  type QualityEncodingInfo,
  type QualityStats,
  qualityToScores,
  scoresToQuality,
  scoreToChar,
  scoreToErrorProbability,
} from "./quality";
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
// String utilities
export { escapeRegex } from "./string-utils";
// Sequence validation with IUPAC handling
export {
  expandAmbiguous,
  IUPAC_DNA,
  IUPAC_PROTEIN,
  IUPAC_RNA,
  SequenceType,
  ValidationMode,
} from "./sequence-validation";
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

/**
 * @deprecated Use individual function imports instead of this combined object.
 * Import directly from the specific modules for better tree-shaking:
 * - `complement`, `reverse`, `reverseComplement`, etc. from "./sequence-manipulation"
 * - `gcContent`, `atContent`, `baseComposition`, etc. from "./calculations"
 * - `isPalindromic`, `findPattern` from "./pattern-matching"
 */
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
