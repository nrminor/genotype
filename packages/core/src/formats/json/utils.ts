/**
 * JSON Utility Functions
 *
 * Helper functions for JSON format detection, validation, and metadata generation.
 */

import type { JSONCollectionMetadata } from "./types";

/**
 * Generate collection-level metadata for JSON output
 *
 * Used when `includeMetadata: true` to wrap sequences array with stats.
 *
 * @param options - Metadata generation options
 * @param options.count - Number of sequences in collection
 * @param options.columns - Column names included in output
 * @param options.includeTimestamp - Whether to include generation timestamp
 * @returns Metadata object for JSON wrapper
 *
 * @example
 * ```typescript
 * const meta = generateCollectionMetadata({
 *   count: 100,
 *   columns: ['id', 'sequence', 'gc'],
 *   includeTimestamp: true
 * });
 * // { count: 100, columns: ['id', 'sequence', 'gc'], generated: "2025-10-06T..." }
 * ```
 */
export function generateCollectionMetadata(options: {
  count: number;
  columns: string[];
  includeTimestamp?: boolean;
}): JSONCollectionMetadata {
  const metadata: JSONCollectionMetadata = {
    count: options.count,
    columns: options.columns,
  };

  if (options.includeTimestamp) {
    metadata.generated = new Date().toISOString();
  }

  return metadata;
}

/**
 * Detect whether content is JSON array or JSONL format
 *
 * JSON:   Starts with '[', contains array of objects
 * JSONL:  Each line is a separate JSON object (no array wrapper)
 *
 * @param content - String content to analyze
 * @returns 'json' | 'jsonl' | null if format cannot be determined
 *
 * @example
 * ```typescript
 * detectJSONFormat('[{"id":"seq1"}]')                    // 'json'
 * detectJSONFormat('{"id":"seq1"}\n{"id":"seq2"}')       // 'jsonl'
 * detectJSONFormat('')                                    // null
 * ```
 */
export function detectJSONFormat(content: string): "json" | "jsonl" | null {
  const trimmed = content.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("[")) {
    return "json";
  }

  if (trimmed.startsWith("{")) {
    const lines = trimmed.split("\n").filter((line) => line.trim());

    if (lines.length > 1 && lines.every((line) => line.trim().startsWith("{"))) {
      return "jsonl";
    }

    return "jsonl";
  }

  return null;
}
