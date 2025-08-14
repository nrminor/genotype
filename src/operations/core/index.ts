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
} from './quality';
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
// Sequence transformation operations
// Export both individual functions and grouped object for flexibility
export {
  atContent,
  baseComposition,
  // Individual functions (tree-shakeable)
  complement,
  findPattern as findPatternTransform,
  gcContent,
  isPalindromic,
  reverse,
  reverseComplement,
  // Grouped object for convenience
  SequenceTransforms,
  toDNA,
  toRNA,
  translateSimple,
} from './transforms';
// Sequence validation with IUPAC handling
export {
  IUPAC_DNA,
  IUPAC_PROTEIN,
  IUPAC_RNA,
  SequenceValidator,
  ValidationMode,
} from './validation';
