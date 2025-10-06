/**
 * JSON Format Type Definitions
 *
 * Type definitions for JSON and JSONL (JSON Lines) support in genotype library.
 * Enables bidirectional conversion: sequences ↔ JSON.
 */

import { type } from "arktype";
import type { ParserOptions } from "../../types";

/**
 * JSON format type
 */
export type JSONFormat = "json" | "jsonl";

/**
 * Options for writing JSON/JSONL files
 *
 * Controls output formatting and metadata inclusion for JSON serialization.
 *
 * @example
 * ```typescript
 * // Pretty-printed with metadata
 * await seqops.writeJSON('output.json', {
 *   pretty: true,
 *   includeMetadata: true
 * });
 * ```
 */
export interface JSONWriteOptions {
  /**
   * Pretty-print JSON with indentation (default: false)
   *
   * When true, produces human-readable formatted JSON.
   * Not applicable to JSONL format (line-delimited).
   */
  pretty?: boolean;

  /**
   * Wrap sequences with collection metadata (default: false)
   *
   * When true, outputs: { sequences: [...], metadata: {...} }
   * When false, outputs: [...]
   *
   * Not applicable to JSONL format.
   */
  includeMetadata?: boolean;

  /**
   * How to represent null values (default: null)
   *
   * Controls serialization of null/undefined values in optional fields.
   */
  nullValue?: string | null;
}

/**
 * Options for parsing JSON/JSONL files
 *
 * Controls how JSON data is parsed and validated as sequences.
 *
 * @example
 * ```typescript
 * // Parse as FASTQ with specific encoding
 * const seqs = await SeqOps.fromJSON('data.json', {
 *   format: 'fastq',
 *   qualityEncoding: 'phred33'
 * }).collect();
 * ```
 */
export interface JSONParseOptions extends ParserOptions {
  /**
   * Force output format (default: auto-detect from data)
   *
   * When specified, all sequences are treated as the given format.
   */
  format?: "fasta" | "fastq";

  /**
   * Quality score encoding for FASTQ sequences (default: 'phred33')
   */
  qualityEncoding?: "phred33" | "phred64";

  /**
   * Enable strict validation (default: true)
   *
   * When true, throws errors on invalid data.
   * When false, attempts to parse with lenient validation.
   */
  strict?: boolean;

  /**
   * Skip invalid entries instead of throwing (default: false)
   *
   * When true, invalid sequences are silently skipped.
   * Requires strict: false.
   */
  skipInvalid?: boolean;
}

/**
 * Metadata for JSON sequence collections
 *
 * Provides information about the sequence collection when includeMetadata is true.
 */
export interface JSONCollectionMetadata {
  /**
   * Total number of sequences in collection
   */
  count: number;

  /**
   * Column names included in the output
   */
  columns: string[];

  /**
   * ISO 8601 timestamp when collection was generated
   */
  generated?: string;

  /**
   * Library version that generated the file
   */
  version?: string;
}

export const SequenceRowSchema = type({
  id: "string",
  "sequence?": "string",
  "quality?": "string",
  "description?": "string",
  "gc?": "0<=number<=100",
  "length?": "number.integer>=0",
  "avgQuality?": "number",
  "minQuality?": "number",
  "maxQuality?": "number",
  "qualityEncoding?": "'phred33' | 'phred64' | 'solexa'",
  "format?": "'fasta' | 'fastq' | 'sam' | 'bed' | 'gtf'",
  "lineNumber?": "number.integer>=0",
});

export const MetadataSchema = type({
  count: "number.integer >= 0",
  columns: "string[]",
  "generated?": "string.date.iso",
});

export const SequenceArraySchema = SequenceRowSchema.array();

export const WrappedSequenceSchema = type({
  sequences: SequenceArraySchema,
  metadata: MetadataSchema,
});

export type SequenceRow = typeof SequenceRowSchema.infer;
export type SequenceArray = typeof SequenceArraySchema.infer;
export type WrappedSequence = typeof WrappedSequenceSchema.infer;
