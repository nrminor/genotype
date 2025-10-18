/**
 * DSV Utility Functions Module
 *
 * General utility functions for DSV processing including
 * text normalization, calculations, and data manipulation.
 */

/**
 * Remove Byte Order Mark (BOM) from text
 * Handles UTF-8, UTF-16 BE, and UTF-16 LE BOMs
 *
 * @param text - Text potentially containing BOM
 * @returns Text without BOM
 */
export function removeBOM(text: string): string {
  // UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  // UTF-16 BE BOM
  if (text.charCodeAt(0) === 0xfe && text.charCodeAt(1) === 0xff) {
    return text.slice(2);
  }
  // UTF-16 LE BOM
  if (text.charCodeAt(0) === 0xff && text.charCodeAt(1) === 0xfe) {
    return text.slice(2);
  }
  return text;
}

/**
 * Normalize line endings to Unix format (LF)
 * Handles Windows (CRLF), Classic Mac (CR), and Unix (LF)
 *
 * @param text - Text with mixed line endings
 * @returns Text with normalized line endings
 */
export function normalizeLineEndings(text: string): string {
  // Replace CRLF with LF first, then CR with LF
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Handle ragged rows (rows with inconsistent column counts)
 *
 * @param fields - Parsed fields from a row
 * @param expectedColumns - Expected number of columns
 * @param handling - How to handle mismatch: "error", "pad", "truncate", or "ignore"
 * @returns Adjusted fields array
 */
export function handleRaggedRow(
  fields: string[],
  expectedColumns: number,
  handling: "error" | "pad" | "truncate" | "ignore" = "pad"
): string[] {
  if (fields.length === expectedColumns || handling === "ignore") {
    return fields;
  }

  switch (handling) {
    case "error":
      throw new Error(`Row has ${fields.length} columns, expected ${expectedColumns}`);
    case "pad":
      // Add empty fields
      while (fields.length < expectedColumns) {
        fields.push("");
      }
      return fields;
    case "truncate":
      // Remove extra fields
      return fields.slice(0, expectedColumns);
    default:
      return fields;
  }
}

/**
 * Calculate base counts for a sequence
 *
 * @param sequence - DNA/RNA sequence
 * @returns Map of base to count
 */
export function calculateBaseCount(sequence: string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const base of sequence.toUpperCase()) {
    counts[base] = (counts[base] || 0) + 1;
  }

  return counts;
}

/**
 * Calculate GC content percentage
 *
 * @param sequence - DNA/RNA sequence
 * @returns GC percentage (0-100)
 */
export function calculateGC(sequence: string): number {
  // Handle empty sequence
  if (!sequence || sequence.length === 0) {
    return 0;
  }

  // Count only A, T, C, G (ignore ambiguous bases)
  const upper = sequence.toUpperCase();
  let gcCount = 0;
  let totalBases = 0;

  for (let i = 0; i < upper.length; i++) {
    const base = upper[i];
    if (base === "G" || base === "C") {
      gcCount++;
      totalBases++;
    } else if (base === "A" || base === "T" || base === "U") {
      totalBases++;
    }
    // Ignore all other characters including N and ambiguous codes
  }

  return totalBases === 0 ? 0 : (gcCount / totalBases) * 100;
}

/**
 * Calculate GC skew
 * GC skew = (G - C) / (G + C)
 *
 * @param sequence - DNA sequence
 * @returns GC skew value (-1 to 1)
 */
export function calculateGCSkew(sequence: string): number {
  const seq = sequence.toUpperCase();
  let g = 0;
  let c = 0;

  for (const base of seq) {
    if (base === "G") g++;
    else if (base === "C") c++;
  }

  if (g + c === 0) return 0;
  return (g - c) / (g + c);
}

/**
 * Count columns in a CSV row
 *
 * @param line - CSV line
 * @param delimiter - Field delimiter
 * @returns Number of columns
 */
export function countColumns(line: string, delimiter: string): number {
  // Simple approximation - use parseCSVRow for accurate count
  return line.split(delimiter).length;
}

/**
 * Extract headers from first line
 *
 * @param firstLine - First line of the file
 * @param delimiter - Field delimiter
 * @returns Array of header names
 */
export function extractHeaders(firstLine: string, delimiter: string): string[] {
  // Simple split - use parseCSVRow for proper CSV parsing
  return firstLine.split(delimiter).map((h) => h.trim());
}

/**
 * Generate summary statistics for DSV content
 */
export function summarizeDSV(
  content: string,
  options: {
    delimiter?: string;
    includeStats?: boolean;
  } = {}
): {
  rows: number;
  columns: number;
  delimiter: string;
  hasHeaders: boolean;
  stats?: Record<string, any>;
} {
  const lines = content.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  const delimiter: string = options.delimiter || ",";

  if (lines.length === 0) {
    return {
      rows: 0,
      columns: 0,
      delimiter,
      hasHeaders: false,
    };
  }

  const firstLine = lines[0] || "";
  const columns = firstLine ? countColumns(firstLine, delimiter) : 0;
  // Simple header detection - check if first line looks like headers
  const hasHeaders = firstLine && !/^\d/.test(firstLine.split(delimiter)[0] || "");

  const summary: any = {
    rows: hasHeaders ? lines.length - 1 : lines.length,
    columns,
    delimiter,
    hasHeaders,
  };

  if (options.includeStats && lines.length > 0) {
    // Calculate field length statistics
    let totalFields = 0;
    let minFieldLength = Infinity;
    let maxFieldLength = 0;
    let totalLength = 0;

    for (const line of lines) {
      const fields = line.split(delimiter);
      for (const field of fields) {
        const length = field.length;
        totalFields++;
        totalLength += length;
        minFieldLength = Math.min(minFieldLength, length);
        maxFieldLength = Math.max(maxFieldLength, length);
      }
    }

    summary.stats = {
      avgFieldLength: totalFields > 0 ? Math.round(totalLength / totalFields) : 0,
      minFieldLength: minFieldLength === Infinity ? 0 : minFieldLength,
      maxFieldLength,
      totalFields,
    };
  }

  return summary;
}
