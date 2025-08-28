/**
 * Core primitives and abstractions for SeqOps operations
 *
 * These modules provide the foundational infrastructure for all
 * sequence operations in the Genotype library.
 */

// Re-export quality encoding from types to maintain backward compatibility
export { QualityEncoding } from '../../types';

// Note: SeqOps is now exported from operations/index.ts, not here
// Bloom filters for deduplication (low-level)
export { BloomFilter, CountingBloomFilter, ScalableBloomFilter } from './bloom-filter';
// NCBI genetic code tables
export { GeneticCode, GeneticCodeTable } from './genetic-codes';
// Memory management strategies
export { MemoryStrategy } from './interfaces';
// Memory management strategies (low-level)
export {
  AdaptiveBuffer,
  DefaultMemoryMonitor,
  DiskCache,
  ExternalSorter,
  type MemoryMonitor,
} from './memory';
// Pattern matching algorithms and utilities
export {
  // Low-level algorithm functions
  boyerMoore,
  findOverlapping,
  findPalindromes,
  findPattern,
  findTandemRepeats,
  fuzzyMatch,
  hasPattern,
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
} from './pattern-matching';
// Quality score encoding detection and conversion
// Export both individual functions and grouped object for flexibility
export {
  averageQuality,
  charToScore,
  convertScore,
  detect,
  // Individual functions (tree-shakeable)
  detectEncoding,
  errorProbabilityToScore,
  getEncodingRange,
  // Grouped object for convenience
  QualityEncodingDetector,
  scoreToChar,
  scoreToErrorProbability,
  validateQualityString,
} from './encoding';
// Reservoir sampling for streaming
export {
  BernoulliSampler,
  ReservoirSampler,
  StratifiedSampler,
  SystematicSampler,
  WeightedReservoirSampler,
} from './sampling';
// User-friendly sequence deduplication
export {
  type DeduplicationOptions,
  type DeduplicationStats,
  type DeduplicationStrategy,
  deduplicateSequences,
  ExactDeduplicator,
  findDuplicates,
  SequenceDeduplicator,
} from './sequence-deduplicator';
// User-friendly sequence sorting
export {
  getTopSequences,
  SequenceSorter,
  type SortBy,
  type SortOptions,
  sortSequences,
} from './sequence-sorter';
// Statistics accumulator for streaming analysis
export { calculateSequenceStats, type SequenceStats, SequenceStatsAccumulator } from './statistics';
// Sequence manipulation operations (from sequence-manipulation.ts)
export {
  complement,
  reverse,
  reverseComplement,
  toRNA,
  toDNA,
  SequenceManipulation,
} from './sequence-manipulation';

// Sequence calculations (from calculations.ts)
export {
  gcContent,
  atContent,
  baseComposition,
  translateSimple,
  SequenceCalculations,
} from './calculations';

// Pattern matching additions (from pattern-matching.ts)
export {
  isPalindromic,
  findSimplePattern,
  findPattern as findPatternTransform,
} from './pattern-matching';
// Sequence validation with IUPAC handling
export {
  IUPAC_DNA,
  IUPAC_PROTEIN,
  IUPAC_RNA,
  // Note: SequenceValidator and ValidationMode moved to operations/validate.ts
} from './sequence-validation';

// Common validation utilities for operations
export {
  createOptionsValidator,
  createSafeOptionsValidator,
  CommonValidators,
  createValidationError,
} from './validation-utils';

// Re-export SequenceValidator and ValidationMode from operations for backward compatibility
export { SequenceValidator, ValidationMode } from '../validate';

// Import all items needed for backward compatibility object
import * as seqManip from './sequence-manipulation';
import * as calcs from './calculations';
import { isPalindromic as isPalin, findSimplePattern as findPat } from './pattern-matching';

// Backward compatibility: SequenceTransforms combined from new modules
export const SequenceTransforms = {
  complement: seqManip.complement,
  reverse: seqManip.reverse,
  reverseComplement: seqManip.reverseComplement,
  toRNA: seqManip.toRNA,
  toDNA: seqManip.toDNA,
  gcContent: calcs.gcContent,
  atContent: calcs.atContent,
  baseComposition: calcs.baseComposition,
  translateSimple: calcs.translateSimple,
  isPalindromic: isPalin,
  findPattern: findPat,
} as const;
