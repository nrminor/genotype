/**
 * Quality encoding information and constants
 *
 * This module provides comprehensive information about different quality
 * encoding schemes used in sequencing data formats.
 */

import { QualityEncoding } from "../../../types";
import type { AsciiOffset, QualityEncodingInfo, QualityScore } from "./types";

/**
 * Encoding information lookup table
 */
const ENCODING_INFO: Record<QualityEncoding, QualityEncodingInfo> = {
  phred33: {
    name: "phred33",
    offset: 33 as AsciiOffset,
    minScore: 0 as QualityScore,
    maxScore: 93 as QualityScore,
    minChar: "!", // ASCII 33
    maxChar: "~", // ASCII 126
    description: "Phred+33 (Sanger, Illumina 1.8+): Standard modern encoding",
  },
  phred64: {
    name: "phred64",
    offset: 64 as AsciiOffset,
    minScore: 0 as QualityScore,
    maxScore: 62 as QualityScore,
    minChar: "@", // ASCII 64
    maxChar: "~", // ASCII 126
    description: "Phred+64 (Illumina 1.3-1.7): Legacy Illumina encoding",
  },
  solexa: {
    name: "solexa",
    offset: 64 as AsciiOffset,
    minScore: -5 as QualityScore, // Solexa has negative scores
    maxScore: 62 as QualityScore,
    minChar: ";", // ASCII 59 (64 - 5)
    maxChar: "~", // ASCII 126
    description: "Solexa+64: Historic Solexa/early Illumina encoding",
  },
};

/**
 * Get comprehensive information about a quality encoding
 *
 * @param encoding - Quality encoding scheme
 * @returns Encoding information including offsets and ranges
 *
 * @example
 * ```typescript
 * const info = getEncodingInfo('phred33');
 * console.log(info.offset); // 33
 * console.log(info.minScore); // 0
 * console.log(info.maxScore); // 93
 * ```
 */
export function getEncodingInfo(encoding: QualityEncoding): QualityEncodingInfo {
  const info = ENCODING_INFO[encoding];
  if (!info) {
    throw new Error(`Unknown quality encoding: ${encoding}`);
  }
  return info;
}

/**
 * List all supported quality encodings
 *
 * @returns Array of supported encoding names
 *
 * @example
 * ```typescript
 * const encodings = getSupportedEncodings();
 * console.log(encodings); // ['phred33', 'phred64', 'solexa']
 * ```
 */
export function getSupportedEncodings(): QualityEncoding[] {
  return Object.keys(ENCODING_INFO) as QualityEncoding[];
}

/**
 * Check if an encoding is supported
 *
 * @param encoding - Encoding name to check
 * @returns True if encoding is supported
 */
export function isValidEncoding(encoding: string): encoding is QualityEncoding {
  return encoding in ENCODING_INFO;
}
