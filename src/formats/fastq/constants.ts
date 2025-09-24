/**
 * Constants for FASTQ format parsing and quality score operations
 *
 * Central location for all magic numbers and thresholds used throughout
 * the FASTQ module. These constants ensure consistency and make the
 * code more maintainable and self-documenting.
 */

// ============================================================================
// QUALITY SCORE THRESHOLDS
// ============================================================================

/**
 * Quality score thresholds for assessment and filtering
 * Based on standard Phred score interpretations in bioinformatics
 */
export const QUALITY_THRESHOLDS = {
  /** Q30: Excellent quality, 1 in 1000 error rate */
  EXCELLENT: 30,
  /** Q20: Good quality, 1 in 100 error rate */
  GOOD: 20,
  /** Q10: Fair quality, 1 in 10 error rate */
  FAIR: 10,
  /** Threshold for counting low quality bases */
  LOW_BASE: 20,
  /** Minimum acceptable mean quality for most analyses */
  MIN_ACCEPTABLE: 20,
} as const;

// ============================================================================
// ASCII VALUE BOUNDARIES
// ============================================================================

/**
 * ASCII character code boundaries for different quality encoding schemes
 * Used for automatic encoding detection and validation
 */
export const ASCII_BOUNDARIES = {
  /** Phred+33 minimum ASCII value (!) */
  PHRED33_MIN: 33,
  /** Phred+33 maximum ASCII value (~) */
  PHRED33_MAX: 126,
  /** Phred+64 minimum ASCII value (@) */
  PHRED64_MIN: 64,
  /** Phred+64 maximum ASCII value (theoretical) */
  PHRED64_MAX: 157,
  /** Solexa minimum ASCII value (;) */
  SOLEXA_MIN: 59,
  /** Solexa maximum ASCII value (~) */
  SOLEXA_MAX: 126,
  /** Start of overlap zone between encodings */
  OVERLAP_START: 64,
  /** End of overlap zone (same as Phred+33 max) */
  OVERLAP_END: 126,
  /** Below this, definitely Phred+33 */
  CLEAR_PHRED33_BOUNDARY: 59,
  /** Above this, definitely not Phred+33 */
  HIGH_ASCII_BOUNDARY: 73,
} as const;

// ============================================================================
// PARSING CONFIGURATION
// ============================================================================

/**
 * Default configuration values for FASTQ parsing
 */
export const PARSING_DEFAULTS = {
  /** Maximum line length to prevent memory issues */
  MAX_LINE_LENGTH: 1_000_000,
  /** Default quality encoding for modern sequencing */
  DEFAULT_ENCODING: "phred33" as const,
  /** Default validation level */
  DEFAULT_VALIDATION: "quick" as const,
  /** Window size for quality analysis */
  DEFAULT_WINDOW_SIZE: 10,
  /** Minimum window size for meaningful analysis */
  MIN_WINDOW_SIZE: 5,
  /** Maximum reasonable window size */
  MAX_WINDOW_SIZE: 100,
} as const;

// ============================================================================
// CONFIDENCE LEVELS
// ============================================================================

/**
 * Confidence levels for quality encoding detection
 */
export const CONFIDENCE_LEVELS = {
  /** High confidence in detection */
  HIGH: 0.95,
  /** Medium confidence (overlap zone) */
  MEDIUM: 0.7,
  /** Default/fallback confidence */
  DEFAULT: 0.9,
  /** Minimum confidence for reliable detection */
  MINIMUM: 0.3,
} as const;

// ============================================================================
// PLATFORM DETECTION
// ============================================================================

/**
 * Platform-specific patterns and characteristics
 */
export const PLATFORM_PATTERNS = {
  /** Minimum quality for NovaSeq detection */
  NOVASEQ_MIN_QUALITY: 37,
  /** Maximum quality range for NovaSeq binning detection */
  NOVASEQ_MAX_RANGE: 5,
  /** Typical PacBio read length threshold */
  PACBIO_MIN_LENGTH: 1000,
  /** Typical Nanopore read length threshold */
  NANOPORE_MIN_LENGTH: 500,
} as const;

// ============================================================================
// QUALITY ANALYSIS
// ============================================================================

/**
 * Configuration for quality window analysis
 */
export const QUALITY_WINDOWS = {
  /** Default window size for quality analysis */
  DEFAULT_SIZE: 10,
  /** Minimum meaningful window size */
  MIN_SIZE: 5,
  /** Maximum reasonable window size */
  MAX_SIZE: 100,
} as const;

/**
 * Default values for quality trimming operations
 */
export const TRIMMING_DEFAULTS = {
  /** Minimum acceptable sequence length after trimming */
  MIN_LENGTH: 50,
  /** Default quality threshold for trimming */
  MIN_QUALITY: 20,
} as const;

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/** Type for quality threshold values */
export type QualityThreshold = (typeof QUALITY_THRESHOLDS)[keyof typeof QUALITY_THRESHOLDS];

/** Type for ASCII boundary values */
export type AsciiBoundary = (typeof ASCII_BOUNDARIES)[keyof typeof ASCII_BOUNDARIES];

/** Type for confidence values */
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[keyof typeof CONFIDENCE_LEVELS];
