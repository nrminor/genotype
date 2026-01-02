/**
 * Quality encoding detection algorithms
 *
 * This module provides multiple strategies for detecting quality encoding
 * from FASTQ data, including fast heuristic and statistical approaches.
 */

import { QualityError } from "../../../errors";
import type { QualityEncoding } from "../../../types";
import type { DetectionResult } from "./types";

/**
 * Fast quality encoding detection using ASCII range heuristics
 *
 * Uses min/max ASCII values to determine encoding with distribution awareness.
 * Optimized for modern sequencing data (95% Phred+33 prevalence).
 *
 * @param quality - Quality string to analyze
 * @returns Detected quality encoding
 * @throws QualityError if encoding cannot be determined
 *
 * @example
 * ```typescript
 * const encoding = detectEncoding('IIIIIIIIII'); // 'phred33'
 * const encoding = detectEncoding('hhhhhhhhhh'); // 'phred64'
 * ```
 */
export function detectEncoding(quality: string): QualityEncoding {
  if (!quality || quality.length === 0) {
    return "phred33"; // Default to modern standard
  }

  // Find min/max ASCII values in quality string
  let minAscii = 255;
  let maxAscii = 0;

  for (let i = 0; i < quality.length; i++) {
    const ascii = quality.charCodeAt(i);
    minAscii = Math.min(minAscii, ascii);
    maxAscii = Math.max(maxAscii, ascii);
  }

  // Distribution-aware detection patterns

  // Pattern 1: Uniform high quality (modern Q40+ data)
  if (minAscii >= 70 && maxAscii <= 93 && maxAscii - minAscii <= 5) {
    return "phred33"; // Uniform high quality = modern sequencing
  }

  // Pattern 2: High ASCII values that are impossible for Phred+33
  if (minAscii > 93) {
    // ASCII values above 93 are impossible for Phred+33 (max Q60 = ASCII 93)
    return "phred64"; // Must be Phred+64 or Solexa
  }

  // Pattern 3: Solexa-specific range
  if (minAscii >= 59 && minAscii < 64) {
    return "solexa"; // Historical Solexa/early Illumina (has negative scores)
  }

  // Pattern 4: Constrained legacy patterns (filtered data)
  if (minAscii >= 64 && maxAscii <= 104) {
    return "phred64"; // Legacy Illumina 1.3-1.7
  }

  // Pattern 5: Modern quality distributions (most common)
  if (minAscii >= 33 && maxAscii <= 126) {
    return "phred33"; // Modern standard (Illumina 1.8+)
  }

  // Unable to detect - invalid range
  throw new QualityError(
    `Cannot detect quality encoding: ASCII range ${minAscii}-${maxAscii} outside known standards`,
    "unknown",
    undefined,
    undefined,
    `Expected ranges: Phred+33 (33-126), Phred+64 (64-126), or Solexa (59-126). ` +
      `Invalid characters may indicate corrupted data or non-standard encoding.`,
  );
}

/**
 * Detect quality encoding with confidence score and evidence
 *
 * Provides detailed analysis including confidence level and reasoning.
 *
 * @param quality - Quality string to analyze
 * @returns Detection result with confidence and evidence
 *
 * @example
 * ```typescript
 * const result = detectEncodingWithConfidence('IIIIIIIIII');
 * console.log(result.encoding); // 'phred33'
 * console.log(result.confidence); // 0.95
 * console.log(result.evidence); // ['ASCII range: 73-73', ...]
 * ```
 */
export function detectEncodingWithConfidence(quality: string): DetectionResult {
  if (!quality || quality.length === 0) {
    return {
      encoding: "phred33",
      confidence: 0.5,
      evidence: ["Empty quality string, defaulting to modern standard"],
    };
  }

  const evidence: string[] = [];
  let confidence = 0;

  // Collect ASCII statistics
  let minAscii = 255;
  let maxAscii = 0;
  const asciiCounts = new Map<number, number>();

  for (let i = 0; i < quality.length; i++) {
    const ascii = quality.charCodeAt(i);
    minAscii = Math.min(minAscii, ascii);
    maxAscii = Math.max(maxAscii, ascii);
    asciiCounts.set(ascii, (asciiCounts.get(ascii) || 0) + 1);
  }

  evidence.push(`ASCII range: ${minAscii}-${maxAscii}`);
  evidence.push(`Quality string length: ${quality.length}`);

  // Analyze distribution patterns
  const range = maxAscii - minAscii;
  const uniqueChars = asciiCounts.size;

  evidence.push(`Range width: ${range}`);
  evidence.push(`Unique characters: ${uniqueChars}`);

  // Decision logic with confidence scoring
  let encoding: QualityEncoding;

  // Strong Phred+33 indicators
  if (minAscii >= 33 && maxAscii <= 73) {
    encoding = "phred33";
    confidence = 0.95;
    evidence.push("Strong Phred+33: Exclusively in low ASCII range (33-73)");
  }
  // Uniform high quality pattern (modern Q40+)
  else if (minAscii >= 70 && maxAscii <= 93 && range <= 5) {
    encoding = "phred33";
    confidence = 0.9;
    evidence.push("Modern high-quality pattern detected (Q37-Q60)");
  }
  // Strong Phred+64 indicators
  else if (minAscii >= 64 && maxAscii <= 104 && minAscii > 73) {
    encoding = "phred64";
    confidence = 0.85;
    evidence.push("Strong Phred+64: High ASCII values incompatible with Phred+33");
  }
  // Overlap zone - need statistical analysis
  else if (minAscii >= 64 && maxAscii <= 93) {
    // Count characters below 64 (would be invalid for Phred+64)
    let below64Count = 0;
    for (const [ascii, count] of asciiCounts) {
      if (ascii < 64) below64Count += count;
    }

    if (below64Count > 0) {
      encoding = "phred33";
      confidence = 0.8;
      evidence.push(`Characters below ASCII 64 found: ${below64Count} occurrences`);
    } else {
      // Ambiguous - use prevalence
      encoding = "phred33";
      confidence = 0.6;
      evidence.push("Ambiguous range - defaulting to modern standard (95% prevalence)");
    }
  }
  // Solexa detection
  else if (minAscii >= 59 && minAscii < 64) {
    encoding = "solexa";
    confidence = 0.75;
    evidence.push("Solexa/early Illumina: Characters in 59-63 range");
  }
  // Default to Phred+33
  else {
    encoding = "phred33";
    confidence = 0.5;
    evidence.push("Unable to determine conclusively - using modern default");
  }

  return { encoding, confidence, evidence };
}

/**
 * Statistical quality encoding detection across multiple sequences
 *
 * Analyzes up to 10,000 sequences to determine encoding with high confidence.
 * Best for ambiguous cases where single-sequence detection is uncertain.
 *
 * @param sequences - Async iterable of sequences with quality strings
 * @returns Detection result with statistical confidence
 *
 * @example
 * ```typescript
 * const result = await detectEncodingStatistical(sequences);
 * console.log(`Detected ${result.encoding} with ${result.confidence} confidence`);
 * ```
 */
export async function detectEncodingStatistical(
  sequences: AsyncIterable<{ quality?: string }>,
): Promise<DetectionResult> {
  let globalMinAscii = 255;
  let globalMaxAscii = 0;
  let totalChars = 0;
  let sequenceCount = 0;
  const maxSamples = 10000;

  // Collect character frequency distribution
  const asciiFrequency = new Map<number, number>();

  for await (const seq of sequences) {
    if (!seq.quality) continue;

    for (let i = 0; i < seq.quality.length; i++) {
      const ascii = seq.quality.charCodeAt(i);
      globalMinAscii = Math.min(globalMinAscii, ascii);
      globalMaxAscii = Math.max(globalMaxAscii, ascii);
      asciiFrequency.set(ascii, (asciiFrequency.get(ascii) || 0) + 1);
      totalChars++;
    }

    sequenceCount++;
    if (sequenceCount >= maxSamples) break;
  }

  // Handle empty input
  if (sequenceCount === 0 || totalChars === 0) {
    return {
      encoding: "phred33",
      confidence: 0.1,
      evidence: ["No quality data found in sequences"],
    };
  }

  const evidence: string[] = [];
  evidence.push(`Analyzed ${sequenceCount} sequences, ${totalChars} total characters`);
  evidence.push(`Global ASCII range: ${globalMinAscii}-${globalMaxAscii}`);

  // Calculate distribution statistics
  let below64Count = 0;
  let above93Count = 0;

  for (const [ascii, count] of asciiFrequency) {
    if (ascii < 64) below64Count += count;
    if (ascii > 93) above93Count += count;
  }

  const below64Percent = (below64Count / totalChars) * 100;
  const above93Percent = (above93Count / totalChars) * 100;

  evidence.push(`Characters < ASCII 64: ${below64Percent.toFixed(2)}%`);
  evidence.push(`Characters > ASCII 93: ${above93Percent.toFixed(2)}%`);

  // Decision with statistical confidence
  let encoding: QualityEncoding;
  let confidence: number;

  if (below64Count > 0 && globalMinAscii < 59) {
    // Definitive Phred+33
    encoding = "phred33";
    confidence = 1.0;
    evidence.push("Conclusive: Characters below ASCII 59 only valid in Phred+33");
  } else if (below64Count > 0 && globalMinAscii >= 59) {
    // Could be Solexa or Phred+33
    if (below64Percent > 10) {
      encoding = "phred33";
      confidence = 0.85;
      evidence.push("High frequency of low ASCII suggests Phred+33");
    } else {
      encoding = "solexa";
      confidence = 0.7;
      evidence.push("Low ASCII 59-63 range suggests Solexa encoding");
    }
  } else if (above93Count > 0) {
    // Must be Phred+64 or Solexa
    encoding = "phred64";
    confidence = 0.9;
    evidence.push("High ASCII values (>93) indicate Phred+64");
  } else if (globalMinAscii >= 64) {
    // Could be any encoding - use statistical prevalence
    encoding = "phred33";
    confidence = 0.6;
    evidence.push("Ambiguous range - using modern standard (95% prevalence in 2024)");
  } else {
    encoding = "phred33";
    confidence = 0.95;
    evidence.push("Standard Phred+33 range with typical distribution");
  }

  return { encoding, confidence, evidence };
}
