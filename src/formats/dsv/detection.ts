/**
 * DSV Format Detection Module
 *
 * Automatic detection of delimiters, headers, and format characteristics
 * for CSV, TSV, and other delimiter-separated value formats.
 */

import type { CompressionFormat } from "../../types";
import { parseCSVRow } from "./state-machine";

/**
 * Detect the delimiter used in DSV content
 *
 * Uses heuristics to determine the most likely delimiter:
 * - Consistency across rows
 * - Average field count
 * - Low variance in field counts
 *
 * @param lines - Sample lines from the file
 * @param candidates - Delimiters to test (defaults to common DSV delimiters)
 * @returns The detected delimiter or null if detection fails
 */
export function detectDelimiter(
  lines: string[],
  candidates: string[] = [",", "\t", "|", ";"] // Common DSV delimiters
): string | null {
  const scores = new Map<string, number>();

  for (const delimiter of candidates) {
    let consistentCount = 0;
    let lastCount = -1;
    const counts: number[] = [];

    for (const line of lines) {
      // Skip empty lines and comments
      if (!line.trim() || line.startsWith("#")) continue;

      const count = line.split(delimiter).length - 1;
      if (count > 0) {
        counts.push(count);
        if (lastCount === -1) {
          lastCount = count;
        } else if (lastCount === count) {
          consistentCount++;
        }
      }
    }

    // Enhanced scoring: consider consistency, average count, and variance
    if (counts.length > 0) {
      const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
      const variance = counts.reduce((sum, val) => sum + (val - avgCount) ** 2, 0) / counts.length;

      // Score based on consistency, average count, and low variance
      // Higher consistency, higher avg count, and lower variance = better score
      const score = consistentCount * avgCount * (1 / (1 + variance));
      scores.set(delimiter, score);
    } else {
      scores.set(delimiter, 0);
    }
  }

  // Return delimiter with highest score
  let bestDelimiter: string | null = null;
  let bestScore = 0;

  for (const [delimiter, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestScore > 0 ? bestDelimiter : null;
}

/**
 * Detect if the first row contains headers
 *
 * Uses heuristics to determine if the first row contains column names:
 * - Checks for common genomic header keywords (gene, chr, pos, seq, etc.)
 * - Compares numeric content between first and second rows
 * - Returns false if all values in first row are numeric
 *
 * @param lines - Sample lines from the file (minimum 2 required)
 * @param delimiter - The delimiter to use for parsing
 * @returns True if first row appears to be headers, false otherwise
 *
 * @example
 * ```typescript
 * const hasHeaders = detectHeaders(
 *   ["gene,expression", "BRCA1,5.2"],
 *   ","
 * ); // Returns true
 *
 * const noHeaders = detectHeaders(
 *   ["1,2,3", "4,5,6"],
 *   ","
 * ); // Returns false
 * ```
 */
export function detectHeaders(lines: string[], delimiter: string): boolean {
  if (lines.length < 2) return false;

  const firstLine = lines[0];
  const secondLine = lines[1];
  if (!firstLine || !secondLine) return false;

  const firstRow = parseCSVRow(firstLine, delimiter);
  const secondRow = parseCSVRow(secondLine, delimiter);

  // If only single column, default to no headers (likely sequence data)
  if (firstRow.length === 1 && secondRow.length === 1) {
    // Unless it's clearly a header keyword
    const firstValue = firstRow[0];
    if (!firstValue) return false;
    const headerKeywords = ["id", "sequence", "gene", "name", "seq", "quality", "chr", "pos"];
    return headerKeywords.some((keyword) => firstValue.toLowerCase() === keyword);
  }

  // Check if first row looks like headers:
  // 1. All values are non-numeric or contain typical header patterns
  // 2. Pattern differs from subsequent data rows
  // 3. No special characters except underscores/hyphens

  const looksLikeHeaders = firstRow.every((field: string) => {
    // Check for common header patterns
    if (
      /^(id|name|seq|sequence|qual|quality|chr|chrom|chromosome|pos|position|ref|alt|gene|expression)$/i.test(
        field
      )
    ) {
      return true;
    }
    // Check if non-numeric
    return Number.isNaN(Number(field)) && !/^[0-9.+-]+$/.test(field);
  });

  // Compare with second row pattern
  const secondRowNumeric = secondRow.filter((f: string) => !Number.isNaN(Number(f))).length;
  const firstRowNumeric = firstRow.filter((f: string) => !Number.isNaN(Number(f))).length;

  // Headers are detected if first row looks like headers AND:
  // - Second row has more numeric fields, OR
  // - Both have same numeric count but first row contains header keywords
  return looksLikeHeaders && secondRowNumeric >= firstRowNumeric;
}

/**
 * Format detector class for comprehensive DSV format analysis
 */
export class FormatDetector {
  /**
   * Detect delimiter from lines
   */
  detectDelimiter(lines: string[]): string | null {
    return detectDelimiter(lines);
  }

  /**
   * Detect headers from lines
   */
  detectHeaders(lines: string[], delimiter: string): boolean {
    return detectHeaders(lines, delimiter);
  }

  /**
   * Combined format detection with confidence scoring
   *
   * @param input - String or binary data to analyze
   * @returns Detected format characteristics with confidence
   */
  async detectFormat(input: string | Uint8Array): Promise<{
    delimiter: string;
    hasHeaders: boolean;
    compression: CompressionFormat;
    confidence: number;
  }> {
    // Convert binary to string if needed
    const text = typeof input === "string" ? input : new TextDecoder().decode(input);

    // Split into lines
    const lines = text.split(/\r?\n/).filter((line) => line.trim());

    // Detect delimiter
    const delimiter = this.detectDelimiter(lines) || ",";

    // Detect headers
    const hasHeaders = lines.length >= 2 ? this.detectHeaders(lines.slice(0, 5), delimiter) : false;

    // Calculate confidence based on detection success
    let confidence = 0.5; // Base confidence

    if (delimiter && delimiter !== ",") {
      confidence += 0.2; // Higher confidence if delimiter was detected
    }

    if (lines.length >= 5) {
      confidence += 0.2; // More lines = better detection
    }

    if (hasHeaders) {
      confidence += 0.1; // Headers detected adds confidence
    }

    // Note: Compression detection would be handled by CompressionDetector
    // This is just for the DSV format itself
    const compression: CompressionFormat = "none";

    return {
      delimiter,
      hasHeaders,
      compression,
      confidence: Math.min(confidence, 1.0),
    };
  }
}

/**
 * Detect DSV format and delimiter from content
 */
export function detectFormat(content: string): {
  format: "csv" | "tsv" | "psv" | "ssv" | "dsv";
  delimiter: string;
} {
  const lines = content.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  if (lines.length === 0) {
    return { format: "dsv", delimiter: "\t" };
  }

  // Count delimiter occurrences in first few lines
  const delimiters = [
    { char: ",", format: "csv" as const },
    { char: "\t", format: "tsv" as const },
    { char: "|", format: "psv" as const },
    { char: ";", format: "ssv" as const },
  ];

  const counts = delimiters.map((d) => {
    const sampleLines = lines.slice(0, Math.min(5, lines.length));
    let totalCount = 0;
    let consistent = true;
    let lastCount = -1;

    for (const line of sampleLines) {
      const count = line.split(d.char).length - 1;
      totalCount += count;
      if (lastCount >= 0 && count !== lastCount) {
        consistent = false;
      }
      lastCount = count;
    }

    return {
      ...d,
      count: totalCount,
      consistent,
      avgPerLine: totalCount / sampleLines.length,
    };
  });

  // Sort by consistency and count
  counts.sort((a, b) => {
    if (a.consistent && !b.consistent) return -1;
    if (!a.consistent && b.consistent) return 1;
    return b.avgPerLine - a.avgPerLine;
  });

  const best = counts[0];
  if (best && best.avgPerLine > 0) {
    return { format: best.format, delimiter: best.char };
  }

  return { format: "dsv", delimiter: "\t" };
}

/**
 * Extract headers from DSV content
 */
export function extractHeaders(
  content: string,
  options: { delimiter?: string } = {}
): string[] | null {
  const delimiter = options.delimiter || detectDelimiter(content.split(/\r?\n/).slice(0, 5)) || ",";
  const lines = content.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));

  if (lines.length === 0) {
    return null;
  }

  const firstLine = lines[0];
  if (!firstLine) return null;
  const headers = firstLine.split(delimiter).map((h) => h.trim());

  // Basic validation - headers should be non-empty
  if (headers.length === 0 || headers.every((h) => !h)) {
    return null;
  }

  return headers;
}

/**
 * Comprehensive format detection for DSV content
 * Detects delimiter, headers, compression, and encoding
 */
export async function sniff(input: string | ReadableStream<Uint8Array> | Uint8Array): Promise<{
  format: string;
  delimiter: string;
  hasHeaders: boolean;
  compression: "none" | "gzip" | "zstd";
  encoding?: string;
  confidence: number;
  rows?: number;
  columns?: number;
}> {
  let content: string;
  let compression: "none" | "gzip" | "zstd" = "none";

  // Handle different input types
  if (typeof input === "string") {
    content = input;
  } else if (input instanceof Uint8Array) {
    // Check for compression magic bytes
    if (input[0] === 0x1f && input[1] === 0x8b) {
      compression = "gzip";
    } else if (input[0] === 0x28 && input[1] === 0xb5 && input[2] === 0x2f && input[3] === 0xfd) {
      compression = "zstd";
    }

    // For now, just decode as UTF-8
    // In production, would decompress first if needed
    const decoder = new TextDecoder();
    content = decoder.decode(input);
  } else {
    // Handle ReadableStream
    const chunks: Uint8Array[] = [];
    const reader = input.getReader();

    try {
      let totalBytes = 0;
      const maxBytes = 10000; // Read up to 10KB for detection

      while (totalBytes < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.length;
      }
    } finally {
      reader.releaseLock();
    }

    const combined = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Check compression
    if (combined[0] === 0x1f && combined[1] === 0x8b) {
      compression = "gzip";
    } else if (combined[0] === 0x28 && combined[1] === 0xb5) {
      compression = "zstd";
    }

    const decoder = new TextDecoder();
    content = decoder.decode(combined);
  }

  // Detect format
  const formatInfo = detectFormat(content);
  const delimiter = formatInfo.delimiter;

  // Detect headers
  const lines = content.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  const hasHeaders = lines.length > 0 ? detectHeaders(lines.slice(0, 5), delimiter) : false;

  // Count rows and columns
  const rows = lines.length;
  const columns = lines.length > 0 && lines[0] ? lines[0].split(delimiter).length : 0;

  // Calculate confidence
  let confidence = 0.5; // Base confidence

  // Boost confidence for consistent delimiters
  if (lines.length > 1) {
    const columnCounts = lines.slice(0, 10).map((l) => l.split(delimiter).length);
    const allSame = columnCounts.every((c) => c === columnCounts[0]);
    if (allSame) confidence += 0.3;
  }

  // Boost for detected headers
  if (hasHeaders) confidence += 0.1;

  // Boost for known formats
  if (["csv", "tsv"].includes(formatInfo.format)) confidence += 0.1;

  return {
    format: formatInfo.format,
    delimiter,
    hasHeaders,
    compression,
    encoding: "UTF-8", // Simplified - would need proper encoding detection
    confidence: Math.min(1, confidence),
    rows: hasHeaders ? rows - 1 : rows,
    columns,
  };
}
