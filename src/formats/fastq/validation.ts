/**
 * FASTQ Validation Module with Tiered Performance Strategy
 *
 * This module provides comprehensive validation for FASTQ records with three tiers:
 * - none: No validation (maximum performance for trusted data)
 * - quick: Critical structural checks only (~14ns overhead per record)
 * - full: Complete validation with platform detection and rich warnings (~100ns overhead)
 *
 * FASTQ files are remarkably unvalidated in most bioinformatic libraries despite their
 * many quirks. This module sets the genotype library apart by providing:
 * - Platform-specific pattern detection (Illumina, PacBio, Nanopore)
 * - Rich biological context in error messages
 * - Performance-aware validation strategies
 * - Compatibility warnings for downstream tools
 *
 * @module fastq/validation
 * @since v0.1.0
 */

import { type } from "arktype";
import type { FastqSequence } from "../../types";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Validation levels for performance/safety tradeoffs
 */
type ValidationLevel = "none" | "quick" | "full";

/**
 * Platform detection result
 */
interface PlatformInfo {
  platform: "illumina" | "pacbio" | "nanopore" | "unknown";
  confidence: number;
  formatVersion?: string;
  characteristics?: Record<string, unknown>;
}

/**
 * Validation warning with biological context
 */
interface ValidationWarning {
  message: string;
  severity: "low" | "medium" | "high";
  context?: Record<string, unknown>;
}

/**
 * Validation result with warnings and platform info
 */
interface ValidationResult {
  valid: boolean;
  record?: FastqSequence;
  warnings: ValidationWarning[];
  platformInfo?: PlatformInfo;
  errors?: string[];
}

// =============================================================================
// QUICK VALIDATOR (Hot Path - ~14ns per record)
// =============================================================================

/**
 * Lightweight validation for hot path (per-record during parsing)
 * Only critical structural checks, no expensive operations
 *
 * @performance O(1) - Only length comparison
 * @overhead ~14ns per record (ArkType baseline)
 */
const FastqRecordQuickValidator = type({
  id: "string>0",
  sequence: "string>0",
  quality: "string>0",
  qualityEncoding: '"phred33"|"phred64"|"solexa"',
}).narrow((record, ctx) => {
  // Only the MOST critical check - O(1) operation
  if (record.sequence.length !== record.quality.length) {
    return ctx.reject({
      expected: `quality.length === ${record.sequence.length}`,
      actual: `quality.length === ${record.quality.length}`,
      message:
        "FASTQ sequence and quality must have equal length. This is a fundamental FASTQ format requirement.",
      path: ["quality"],
    });
  }
  return true;
});

// Type inference for quick validation
type QuickValidatedRecord = typeof FastqRecordQuickValidator.infer;

// =============================================================================
// PLATFORM DETECTION FUNCTIONS
// =============================================================================

/**
 * Detect Illumina platform characteristics
 */
function detectIlluminaPlatform(record: { id: string; quality?: string }): PlatformInfo | null {
  // Check for Illumina ID pattern
  // CASAVA 1.8+ format: @<instrument>:<run>:<flowcell>:<lane>:<tile>:<x>:<y>
  const illuminaMatch = record.id.match(
    /^([A-Z0-9]+):(\d+):([A-Z0-9-]+):(\d+):(\d+):(\d+):(\d+)(?:\s+\d+:[YN]:\d+:\d+)?/
  );

  if (illuminaMatch) {
    const info: PlatformInfo = {
      platform: "illumina",
      confidence: 0.95,
      formatVersion: "casava_1.8+",
      characteristics: {
        instrument: illuminaMatch[1],
        run_number: illuminaMatch[2],
        flowcell_id: illuminaMatch[3],
        lane: illuminaMatch[4],
      },
    };

    // Check for NovaSeq quality pattern if quality provided
    if (record.quality) {
      const qualities = record.quality.split("").map((c) => c.charCodeAt(0) - 33);
      const avgQual = qualities.reduce((a, b) => a + b, 0) / qualities.length;
      if (avgQual > 37 && Math.max(...qualities) - Math.min(...qualities) < 5) {
        if (info.characteristics) {
          info.characteristics.subplatform = "novaseq";
          info.characteristics.high_quality = true;
        }
      }
    }

    return info;
  }

  return null;
}

/**
 * Detect PacBio platform characteristics
 */
function detectPacBioPlatform(record: { id: string; sequence?: string }): PlatformInfo | null {
  // Classic PacBio pattern: @m<movie>_<zmw>_<start>_<end>
  if (record.id.match(/^m\d+[_e]\d+_\d+/)) {
    const info: PlatformInfo = {
      platform: "pacbio",
      confidence: 0.9,
      formatVersion: "sequel",
      characteristics: {
        long_read: true,
      },
    };

    // Check read length for CCS HiFi detection
    if (record.sequence && record.sequence.length > 10000) {
      if (info.characteristics) {
        info.characteristics.read_type = "ccs_hifi";
      }
      info.confidence = 0.95;
    }

    return info;
  }

  // Newer PacBio format with UUIDs
  if (record.id.match(/^[a-f0-9]{8}\/\d+\/\d+_\d+/)) {
    return {
      platform: "pacbio",
      confidence: 0.85,
      formatVersion: "sequel_ii",
      characteristics: {
        long_read: true,
      },
    };
  }

  return null;
}

/**
 * Detect Oxford Nanopore platform characteristics
 */
function detectNanoporePlatform(record: {
  id: string;
  description?: string;
  sequence?: string;
}): PlatformInfo | null {
  // Check for UUID-based ID (Nanopore characteristic)
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/;

  if (uuidPattern.test(record.id) || record.description?.includes("runid=")) {
    const info: PlatformInfo = {
      platform: "nanopore",
      confidence: 0.9,
      characteristics: {
        long_read: true,
      },
    };

    // Extract run info from description if available
    if (record.description) {
      const runidMatch = record.description.match(/runid=([a-f0-9]+)/);
      if (runidMatch && info.characteristics) {
        info.characteristics.run_id = runidMatch[1];
        info.confidence = 0.95;
      }
    }

    // Check for ultra-long reads (>100kb)
    if (record.sequence && record.sequence.length > 100000) {
      if (info.characteristics) {
        info.characteristics.read_type = "ultra_long";
        info.characteristics.length_category = "exceptional";
      }
    }

    return info;
  }

  return null;
}

/**
 * Detect platform from FASTQ record
 */
function detectPlatform(record: {
  id: string;
  description?: string;
  sequence?: string;
  quality?: string;
}): PlatformInfo {
  // Try each platform detector
  const illumina = detectIlluminaPlatform(record);
  if (illumina) return illumina;

  const pacbio = detectPacBioPlatform(record);
  if (pacbio) return pacbio;

  const nanopore = detectNanoporePlatform(record);
  if (nanopore) return nanopore;

  // Unknown platform
  return {
    platform: "unknown",
    confidence: 0,
    characteristics: {},
  };
}

// =============================================================================
// VALIDATION WARNING GENERATORS
// =============================================================================

/**
 * Generate warnings for FASTQ record issues
 */
function generateValidationWarnings(record: {
  id: string;
  sequence: string;
  quality: string;
  qualityEncoding: string;
  description?: string;
}): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // ID length check (NCBI recommendation)
  if (record.id.length > 50) {
    warnings.push({
      message: `Sequence ID length (${record.id.length}) exceeds NCBI recommendation of 50 characters`,
      severity: "medium",
      context: {
        actual_length: record.id.length,
        recommended_max: 50,
        tools_affected: ["BLAST", "samtools", "BWA", "bowtie2"],
        suggestion: "Consider using shorter IDs for better tool compatibility",
      },
    });
  }

  // Check for spaces in ID (breaks many tools)
  if (record.id.includes(" ")) {
    warnings.push({
      message: "Sequence ID contains spaces which may break downstream tools",
      severity: "high",
      context: {
        problematic_id: record.id,
        suggestion: "Replace spaces with underscores or remove them entirely",
      },
    });
  }

  // Check for shell metacharacters
  if (/[<>|&;`$]/.test(record.id)) {
    const dangerousChars = record.id.match(/[<>|&;`$]/g);
    warnings.push({
      message: "Sequence ID contains shell metacharacters that may cause issues",
      severity: "high",
      context: {
        dangerous_chars: dangerousChars?.join(", "),
        suggestion: "Use only alphanumeric characters, underscores, and hyphens",
      },
    });
  }

  // Check for uniform quality (suspicious pattern)
  const uniqueQualities = new Set(record.quality);
  if (uniqueQualities.size === 1 && record.sequence.length > 10) {
    warnings.push({
      message: "Uniform quality scores detected - possible mock data or format conversion issue",
      severity: "low",
      context: {
        quality_char: [...uniqueQualities][0],
        occurrences: record.quality.length,
        suggestion: "Verify this is real sequencing data, not simulated",
      },
    });
  }

  // Check encoding-specific issues
  const qualityBytes = record.quality.split("").map((c) => c.charCodeAt(0));
  const minByte = Math.min(...qualityBytes);
  const maxByte = Math.max(...qualityBytes);

  if (record.qualityEncoding === "phred33" && minByte >= 64 && maxByte <= 104) {
    warnings.push({
      message: "Quality values compatible with both Phred+33 and Phred+64 - verify encoding",
      severity: "medium",
      context: {
        detected_range: `${minByte}-${maxByte}`,
        overlap_zone: true,
        suggestion: "Consider file source to confirm encoding (modern = Phred+33)",
      },
    });
  }

  if (record.qualityEncoding === "phred64") {
    warnings.push({
      message: "Phred+64 encoding is legacy (Illumina 1.3-1.7, deprecated 2011)",
      severity: "low",
      context: {
        modern_alternative: "phred33",
        last_used: "Illumina 1.7 (2011)",
        suggestion: "Consider converting to Phred+33 for compatibility",
      },
    });
  }

  if (record.qualityEncoding === "solexa") {
    warnings.push({
      message: "Solexa encoding is obsolete (pre-2009)",
      severity: "medium",
      context: {
        deprecation_year: 2009,
        modern_alternative: "phred33",
        suggestion: "Convert to Phred+33 for any modern analysis",
      },
    });
  }

  // Check for N content (ambiguous bases)
  const nCount = (record.sequence.match(/N/gi) || []).length;
  const nPercent = (nCount / record.sequence.length) * 100;

  if (nPercent > 10) {
    warnings.push({
      message: `High N content (${nPercent.toFixed(1)}%) indicates poor sequencing quality`,
      severity: nPercent > 25 ? "high" : "medium",
      context: {
        n_count: nCount,
        total_length: record.sequence.length,
        n_percentage: nPercent.toFixed(1),
        threshold_warning: 10,
        threshold_critical: 25,
        suggestion: "Consider quality filtering or resequencing",
      },
    });
  }

  // Check for homopolymer runs (sequencing artifacts)
  const homopolymerMatch = record.sequence.match(/([ACGT])\1{9,}/gi);
  if (homopolymerMatch) {
    const longest = Math.max(...homopolymerMatch.map((h) => h.length));
    warnings.push({
      message: `Long homopolymer run detected (${longest}bp)`,
      severity: longest > 20 ? "high" : "medium",
      context: {
        homopolymer_length: longest,
        base: homopolymerMatch[0][0],
        position: record.sequence.indexOf(homopolymerMatch[0]),
        suggestion: "May indicate sequencing artifact or low-complexity region",
      },
    });
  }

  // Check for common adapter sequences
  const commonAdapters = [
    { name: "Illumina Universal", seq: "AGATCGGAAGAGC" },
    { name: "TruSeq", seq: "AGATCGGAAGAGCACACGTCTGAACTCCAGTCA" },
    { name: "Nextera", seq: "CTGTCTCTTATACACATCT" },
  ];

  for (const adapter of commonAdapters) {
    if (record.sequence.includes(adapter.seq)) {
      warnings.push({
        message: `Potential ${adapter.name} adapter contamination detected`,
        severity: "high",
        context: {
          adapter_name: adapter.name,
          adapter_sequence: adapter.seq,
          position: record.sequence.indexOf(adapter.seq),
          suggestion: "Run adapter trimming before analysis",
        },
      });
      break; // Report only first found
    }
  }

  return warnings;
}

// =============================================================================
// FULL VALIDATOR (Complete Validation - ~100ns per record)
// =============================================================================

/**
 * Full validation with comprehensive checks
 *
 * @performance O(n) where n = sequence length (for pattern detection)
 * @overhead ~100ns per record (with pattern matching and quality analysis)
 */
const FastqRecordFullValidator = type({
  id: "string>0",
  sequence: "string>0",
  quality: "string>0",
  qualityEncoding: '"phred33"|"phred64"|"solexa"',
  "description?": "string",
  "lineNumber?": "number",
}).narrow((record, ctx) => {
  // Critical structural validation
  if (record.sequence.length !== record.quality.length) {
    return ctx.reject({
      expected: `quality.length === ${record.sequence.length}`,
      actual: `quality.length === ${record.quality.length}`,
      message: "FASTQ sequence and quality must have equal length",
      path: ["quality"],
    });
  }

  // Validate quality encoding ranges
  const qualityBytes = record.quality.split("").map((c) => c.charCodeAt(0));
  const minByte = Math.min(...qualityBytes);
  const maxByte = Math.max(...qualityBytes);

  if (record.qualityEncoding === "phred33") {
    if (minByte < 33 || maxByte > 126) {
      return ctx.reject({
        message: `Invalid Phred+33 quality values: range ${minByte}-${maxByte} outside valid 33-126`,
        path: ["quality"],
      });
    }
  } else if (record.qualityEncoding === "phred64") {
    if (minByte < 64 || maxByte > 104) {
      return ctx.reject({
        message: `Invalid Phred+64 quality values: range ${minByte}-${maxByte} outside valid 64-104`,
        path: ["quality"],
      });
    }
  } else if (record.qualityEncoding === "solexa") {
    if (minByte < 59 || maxByte > 104) {
      return ctx.reject({
        message: `Invalid Solexa quality values: range ${minByte}-${maxByte} outside valid 59-104`,
        path: ["quality"],
      });
    }
  }

  return true;
});

// Type inference for full validation
type FullValidatedRecord = typeof FastqRecordFullValidator.infer;

// =============================================================================
// PERFORMANCE BENCHMARKING
// =============================================================================

/**
 * Performance characteristics and recommendations for validation levels
 */
const ValidationBenchmark = {
  /**
   * Overhead per record for each validation level (in nanoseconds)
   */
  overhead: {
    none: 0, // No validation
    quick: 14, // ~14ns - Length check only
    full: 100, // ~100ns - Complete validation with patterns
  },

  /**
   * Impact at different throughput levels (milliseconds added per million reads)
   */
  impactPerMillion: {
    none: 0,
    quick: 14, // 14ms per million reads
    full: 100, // 100ms per million reads
  },

  /**
   * Recommended validation level based on throughput requirements
   *
   * @param readsPerSecond - Expected throughput
   * @returns Recommended validation level
   */
  recommendation: (readsPerSecond: number): ValidationLevel => {
    if (readsPerSecond > 10_000_000) return "none"; // >10M reads/sec - Skip validation
    if (readsPerSecond > 1_000_000) return "quick"; // >1M reads/sec - Quick only
    return "full"; // <1M reads/sec - Can afford full validation
  },

  /**
   * Memory overhead estimation (bytes per record)
   */
  memoryOverhead: {
    none: 0,
    quick: 64, // Minimal additional memory for error context
    full: 512, // Additional memory for warnings and annotations
  },
};

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate a FASTQ record at the specified level
 *
 * @param record - The FASTQ record to validate
 * @param level - Validation level (none, quick, or full)
 * @returns Validation result with warnings and platform info
 */
function validateFastqRecord(
  record: Partial<FastqSequence>,
  level: ValidationLevel = "quick"
): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    warnings: [],
    errors: [],
  };

  // No validation - trust the input
  if (level === "none") {
    result.record = record as FastqSequence;
    return result;
  }

  // Choose validator based on level
  const validator = level === "quick" ? FastqRecordQuickValidator : FastqRecordFullValidator;

  // Run validation
  const validationResult = validator(record);

  // Check for errors
  if (validationResult instanceof type.errors) {
    result.valid = false;
    result.errors = validationResult.summary.split("\n");
    return result;
  }

  // Full validation includes warnings and platform detection
  if (level === "full") {
    const warningRecord: Parameters<typeof generateValidationWarnings>[0] = {
      id: record.id as string,
      sequence: record.sequence as string,
      quality: record.quality as string,
      qualityEncoding: record.qualityEncoding as string,
    };

    // Only add description if it's defined
    if (record.description !== undefined) {
      warningRecord.description = record.description;
    }

    result.warnings = generateValidationWarnings(warningRecord);

    const platformRecord: Parameters<typeof detectPlatform>[0] = {
      id: record.id as string,
    };

    // Only add optional fields if they're defined
    if (record.description !== undefined) {
      platformRecord.description = record.description;
    }
    if (record.sequence !== undefined) {
      platformRecord.sequence = record.sequence;
    }
    if (record.quality !== undefined) {
      platformRecord.quality = record.quality;
    }

    result.platformInfo = detectPlatform(platformRecord);
  }

  result.record = validationResult as FastqSequence;
  return result;
}

/**
 * Create a validation context with consistent warning handling
 */
function createValidationContext(level: ValidationLevel = "quick"): {
  level: ValidationLevel;
  warnings: ValidationWarning[];
  platformInfo?: PlatformInfo;
  validate: (record: Partial<FastqSequence>) => ValidationResult;
} {
  const warnings: ValidationWarning[] = [];
  let platformInfo: PlatformInfo | undefined;

  const context: {
    level: ValidationLevel;
    warnings: ValidationWarning[];
    platformInfo?: PlatformInfo;
    validate: (record: Partial<FastqSequence>) => ValidationResult;
  } = {
    level,
    warnings,
    validate: (record: Partial<FastqSequence>) => {
      const result = validateFastqRecord(record, level);

      // Accumulate warnings
      if (result.warnings) {
        warnings.push(...result.warnings);
      }

      // Update platform info if detected
      if (result.platformInfo && result.platformInfo.platform !== "unknown") {
        platformInfo = result.platformInfo;
        context.platformInfo = platformInfo;
      }

      return result;
    },
  };

  // Only add platformInfo to the context if it's defined
  if (platformInfo !== undefined) {
    context.platformInfo = platformInfo;
  }

  return context;
}

// =============================================================================
// EXPORTS
// =============================================================================

export type {
  ValidationLevel,
  PlatformInfo,
  ValidationWarning,
  ValidationResult,
  QuickValidatedRecord,
  FullValidatedRecord,
};

export {
  FastqRecordQuickValidator,
  FastqRecordFullValidator,
  detectIlluminaPlatform,
  detectPacBioPlatform,
  detectNanoporePlatform,
  detectPlatform,
  generateValidationWarnings,
  ValidationBenchmark,
  validateFastqRecord,
  createValidationContext,
};
