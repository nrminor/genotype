/**
 * Core primitives and abstractions for SeqOps operations
 *
 * These modules provide the foundational infrastructure for all
 * sequence operations in the Genotype library.
 */

// Bloom filters for deduplication (low-level)
export {
	BloomFilter,
	CountingBloomFilter,
	ScalableBloomFilter,
} from "./bloom-filter";
// NCBI genetic code tables
export {
	GeneticCode,
	GeneticCodeTable,
} from "./genetic-codes";
// Core interfaces and pipeline composition
export {
	BaseSeqOp,
	MemoryStrategy,
	type SeqOp,
} from "./interfaces";
// Pattern matching algorithms (legacy - use pattern-matcher instead)
export {
	type PatternMatch,
	PatternMatcher,
} from "./matching";
// Memory management strategies (low-level)
export {
	AdaptiveBuffer,
	DefaultMemoryMonitor,
	DiskCache,
	ExternalSorter,
	type MemoryMonitor,
} from "./memory";
// Modern pattern matching with better DX
export {
	findPattern,
	hasPattern,
	type MatcherOptions,
	type SequenceMatch,
	SequenceMatcher,
} from "./pattern-matcher";
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
	QualityEncoding,
	// Grouped object for convenience
	QualityEncodingDetector,
	scoreToChar,
	scoreToErrorProbability,
	validateQualityString,
} from "./quality";
// Reservoir sampling for streaming
export {
	BernoulliSampler,
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
// User-friendly sequence sorting
export {
	getTopSequences,
	SequenceSorter,
	type SortBy,
	type SortOptions,
	sortSequences,
} from "./sequence-sorter";
// Statistics accumulator for streaming analysis
export {
	calculateSequenceStats,
	type SequenceStats,
	SequenceStatsAccumulator,
} from "./statistics";
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
} from "./transforms";
// Sequence validation with IUPAC handling
export {
	IUPAC_DNA,
	IUPAC_PROTEIN,
	IUPAC_RNA,
	SequenceValidator,
	ValidationMode,
} from "./validation";
