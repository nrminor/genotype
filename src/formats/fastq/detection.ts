/**
 * FASTQ Format Detection Module
 *
 * Consolidates all format detection and platform identification functions.
 * These functions help determine FASTQ format complexity, quality encoding,
 * and sequencing platform characteristics.
 *
 * @module fastq/detection
 */

import { detectEncoding } from "../../operations/core/quality";
import type { FastqSequence, QualityEncoding } from "../../types";
import { ASCII_BOUNDARIES, CONFIDENCE_LEVELS } from "./constants";
import { isSimpleFourLineFastq } from "./primitives";
import type { PlatformInfo } from "./validation";
import { detectIlluminaPlatform, detectNanoporePlatform, detectPacBioPlatform } from "./validation";

// ============================================================================
// FORMAT COMPLEXITY DETECTION
// ============================================================================

/**
 * Detect FASTQ format complexity by sampling input
 *
 * @param input - String or array of lines to analyze
 * @param sampleSize - Number of lines to sample (default: 100)
 * @returns Format type and confidence score
 *
 * @example
 * ```typescript
 * const { format, confidence } = detectFastqComplexity(lines);
 * if (format === 'simple' && confidence > 0.9) {
 *   // Use fast path parser
 * } else {
 *   // Use state machine parser
 * }
 * ```
 */
export function detectFastqComplexity(
  input: string | string[],
  sampleSize = 100
): {
  format: "simple" | "complex";
  confidence: number;
  sampledLines: number;
} {
  const lines =
    typeof input === "string"
      ? input.split(/\r?\n/).filter((line) => line.trim())
      : input.filter((line) => line.trim());

  if (lines.length < 4) {
    return {
      format: "complex", // Default to safe option
      confidence: 0.0,
      sampledLines: lines.length,
    };
  }

  const isSimple = isSimpleFourLineFastq(lines, sampleSize);

  // Calculate confidence based on sample size
  const sampledRecords = Math.min(lines.length / 4, sampleSize / 4);
  const confidence = isSimple
    ? Math.min(0.95, 0.8 + sampledRecords / 50) // Start at 0.8, reach 0.95 with 7+ records
    : 0.9; // High confidence when complexity detected

  return {
    format: isSimple ? "simple" : "complex",
    confidence,
    sampledLines: Math.min(lines.length, sampleSize),
  };
}

// ============================================================================
// QUALITY ENCODING DETECTION
// ============================================================================

/**
 * Confidence zone rules for quality encoding detection
 *
 * Data-driven approach for determining confidence based on ASCII character ranges.
 * Each zone has a condition, confidence level, and explanatory reason.
 */
const CONFIDENCE_ZONES = [
  {
    name: "Clear Phred+33",
    condition: (min: number, max: number) => min < ASCII_BOUNDARIES.CLEAR_PHRED33_BOUNDARY,
    confidence: CONFIDENCE_LEVELS.HIGH,
    reason: "Characters below ASCII 59 are unique to Phred+33",
  },
  {
    name: "Overlap zone",
    condition: (min: number, max: number) =>
      min >= ASCII_BOUNDARIES.OVERLAP_START && max <= ASCII_BOUNDARIES.OVERLAP_END,
    confidence: CONFIDENCE_LEVELS.MEDIUM,
    reason: "ASCII 64-126 could be either Phred+33 or Phred+64",
  },
  {
    name: "Clear Phred+64/Solexa",
    condition: (min: number, max: number) => max > ASCII_BOUNDARIES.PHRED33_MAX,
    confidence: CONFIDENCE_LEVELS.HIGH,
    reason: "Characters above ASCII 126 are not valid in Phred+33",
  },
] as const;

/**
 * Determine confidence level based on character range
 *
 * Uses declarative zone rules to determine confidence rather than imperative if-else.
 * Returns confidence level with zone name and reason for transparency.
 *
 * @param minChar - Minimum ASCII character code
 * @param maxChar - Maximum ASCII character code
 * @returns Confidence information with zone and reason
 * @internal
 */
function determineConfidence(
  minChar: number,
  maxChar: number
): {
  confidence: number;
  zone: string;
  reason: string;
} {
  const matchedZone = CONFIDENCE_ZONES.find((z) => z.condition(minChar, maxChar));

  if (matchedZone) {
    return {
      confidence: matchedZone.confidence,
      zone: matchedZone.name,
      reason: matchedZone.reason,
    };
  }

  return {
    confidence: CONFIDENCE_LEVELS.DEFAULT,
    zone: "Unknown",
    reason: "No clear pattern detected",
  };
}

/**
 * Find minimum and maximum ASCII character codes in a string
 *
 * Optimized single-pass algorithm with O(1) memory usage.
 * Avoids creating intermediate arrays for better performance with large strings.
 *
 * @param str - String to analyze
 * @returns Object with minimum and maximum character codes
 * @internal
 */
function findCharRange(str: string): { minChar: number; maxChar: number } {
  if (str.length === 0) {
    return { minChar: 0, maxChar: 0 };
  }

  let minChar = Number.MAX_SAFE_INTEGER;
  let maxChar = Number.MIN_SAFE_INTEGER;

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < minChar) minChar = code;
    if (code > maxChar) maxChar = code;
  }

  return { minChar, maxChar };
}

/**
 * Detect quality encoding from FASTQ records
 *
 * Analyzes quality strings to determine the most likely encoding scheme.
 * Handles overlap zones between encodings using statistical analysis.
 *
 * @param records - Array of FASTQ records with quality strings
 * @returns Detected encoding with confidence
 */
export function detectQualityEncoding(records: Array<{ quality: string }>): {
  encoding: QualityEncoding;
  confidence: number;
  evidence: {
    minChar: number;
    maxChar: number;
    hasLowASCII: boolean;
    hasHighASCII: boolean;
  };
} {
  if (records.length === 0 || !records[0]?.quality) {
    return {
      encoding: "phred33", // Modern default
      confidence: 0.5,
      evidence: {
        minChar: 0,
        maxChar: 0,
        hasLowASCII: false,
        hasHighASCII: false,
      },
    };
  }

  // Collect all quality characters
  const qualityStrings = records.map((r) => r.quality).join("");

  // detectEncoding returns QualityEncoding directly
  const encoding = detectEncoding(qualityStrings);

  // Calculate confidence based on character range (optimized for memory)
  const { minChar, maxChar } = findCharRange(qualityStrings);

  // Determine confidence using declarative zone rules
  const { confidence } = determineConfidence(minChar, maxChar);

  return {
    encoding,
    confidence,
    evidence: {
      minChar,
      maxChar,
      hasLowASCII: minChar < ASCII_BOUNDARIES.CLEAR_PHRED33_BOUNDARY,
      hasHighASCII: maxChar > ASCII_BOUNDARIES.HIGH_ASCII_BOUNDARY,
    },
  };
}

// ============================================================================
// PLATFORM DETECTION
// ============================================================================

/**
 * Detect sequencing platform from FASTQ record characteristics
 *
 * Analyzes header format, quality patterns, and read length to identify
 * the likely sequencing platform.
 *
 * @param record - FASTQ record to analyze
 * @returns Platform information with confidence scores
 */
export function detectSequencingPlatform(record: FastqSequence): PlatformInfo {
  // Try each platform detector
  const illumina = detectIlluminaPlatform(record);
  const pacbio = detectPacBioPlatform(record);
  const nanopore = detectNanoporePlatform(record);

  // Find highest confidence
  const platforms = [
    { info: illumina, type: "illumina" },
    { info: pacbio, type: "pacbio" },
    { info: nanopore, type: "nanopore" },
  ];

  const best = platforms.reduce((prev, curr) => {
    if (!curr.info || !prev.info) return prev;
    return curr.info.confidence > prev.info.confidence ? curr : prev;
  });

  // If no platform detected with reasonable confidence
  if (!best.info || best.info.confidence < CONFIDENCE_LEVELS.MINIMUM) {
    const unknownPlatform: PlatformInfo = {
      platform: "unknown",
      confidence: 0,
    };
    return unknownPlatform;
  }

  return best.info;
}

// ============================================================================
// FASTQ FORMAT DETECTION (from utils)
// ============================================================================

/**
 * Detect if string contains FASTQ format data
 *
 * Performs a quick check for FASTQ format markers without full parsing.
 * Validates the basic 4-line structure: @header, sequence, +separator, quality.
 *
 * @param data - String to check for FASTQ format
 * @returns True if data appears to be FASTQ format
 *
 * @example
 * ```typescript
 * const isFastq = detectFastqFormat(fileContent);
 * if (isFastq) {
 *   // Process as FASTQ
 * }
 * ```
 */
export function detectFastqFormat(data: string): boolean {
  const lines = data.split(/\r?\n/).filter((line) => line.trim());

  // Need at least 4 lines for minimal FASTQ
  if (lines.length < 4) {
    return false;
  }

  // Safely access array elements without type casting
  const header = lines[0];
  const sequence = lines[1];
  const separator = lines[2];
  const quality = lines[3];

  // All elements must be defined (guaranteed by length check above)
  if (!header || !sequence || !separator || !quality) {
    return false;
  }

  // Check for FASTQ pattern: @header, sequence, +, quality
  // Length matching is essential for FASTQ format validity
  return header.startsWith("@") && separator.startsWith("+") && sequence.length === quality.length;
}

// ============================================================================
// AUTO-DETECTION ORCHESTRATOR
// ============================================================================

/**
 * Comprehensive FASTQ format auto-detection
 *
 * Analyzes input to determine all format characteristics:
 * - Format complexity (simple vs multi-line)
 * - Quality encoding scheme
 * - Sequencing platform
 *
 * @param input - String or lines to analyze
 * @param options - Detection options
 * @returns Complete format detection results
 */
export function autoDetectFastqFormat(
  input: string | string[],
  options: {
    sampleSize?: number;
    detectPlatform?: boolean;
  } = {}
): {
  complexity: {
    format: "simple" | "complex";
    confidence: number;
  };
  encoding: {
    type: QualityEncoding;
    confidence: number;
  };
  platform?: PlatformInfo;
} {
  const { sampleSize = 100, detectPlatform = false } = options;

  // Get lines for analysis
  const lines =
    typeof input === "string"
      ? input.split(/\r?\n/).filter((line) => line.trim())
      : input.filter((line) => line.trim());

  // Detect complexity
  const complexity = detectFastqComplexity(lines, sampleSize);

  // Parse sample records for quality/platform detection
  const sampleRecords: Array<{ quality: string; id: string; sequence: string }> = [];
  for (let i = 0; i < lines.length - 3 && sampleRecords.length < 25; i += 4) {
    const header = lines[i];
    const sequence = lines[i + 1];
    const separator = lines[i + 2];
    const quality = lines[i + 3];

    if (header?.startsWith("@") && separator?.startsWith("+") && sequence && quality) {
      sampleRecords.push({
        id: header.substring(1).split(" ")[0] || "unknown",
        sequence,
        quality,
      });
    }
  }

  // Detect encoding
  const encodingResult = detectQualityEncoding(sampleRecords);

  const result: ReturnType<typeof autoDetectFastqFormat> = {
    complexity: {
      format: complexity.format,
      confidence: complexity.confidence,
    },
    encoding: {
      type: encodingResult.encoding,
      confidence: encodingResult.confidence,
    },
  };

  // Optionally detect platform
  if (detectPlatform && sampleRecords.length > 0) {
    const firstRecord = sampleRecords[0];
    if (firstRecord) {
      const platformSample: FastqSequence = {
        format: "fastq",
        id: firstRecord.id,
        sequence: firstRecord.sequence,
        quality: firstRecord.quality,
        qualityEncoding: encodingResult.encoding,
        length: firstRecord.sequence.length,
        lineNumber: 1,
      };
      result.platform = detectSequencingPlatform(platformSample);
    }
  }

  return result;
}
