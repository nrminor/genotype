/**
 * JSON Parser Classes
 *
 * Provides class-based parser interface consistent with other format modules.
 * Uses ArkType morphs internally for type-safe validation.
 */

import { type } from "arktype";
import { ParseError } from "../../errors";
import { convertRecordToSequence } from "../../operations/fx2tab";
import type { AbstractSequence, FastaSequence, FastqSequence } from "../../types";
import { deserializeJSON, deserializeJSONWrapped, jsonlToRows } from "./morphs";
import type { JSONParseOptions } from "./types";

/**
 * Parser for JSON array format sequence files
 *
 * Parses sequences from JSON files containing arrays of sequence objects.
 * Supports both simple array format and wrapped format with metadata.
 * Uses ArkType morphs internally for type-safe validation.
 *
 * @example Basic usage
 * ```typescript
 * const parser = new JSONParser();
 * for await (const seq of parser.parseFile('sequences.json')) {
 *   console.log(`${seq.id}: ${seq.length} bp`);
 * }
 * ```
 *
 * @example With format specification
 * ```typescript
 * const parser = new JSONParser();
 * for await (const seq of parser.parseFile('data.json', { format: 'fastq' })) {
 *   console.log(`${seq.id}: Q${seq.quality}`);
 * }
 * ```
 *
 * @example Simple array format
 * ```json
 * [
 *   { "id": "seq1", "sequence": "ATCG", "length": 4 },
 *   { "id": "seq2", "sequence": "GCTA", "length": 4 }
 * ]
 * ```
 *
 * @example Wrapped format with metadata
 * ```json
 * {
 *   "sequences": [
 *     { "id": "seq1", "sequence": "ATCG" }
 *   ],
 *   "metadata": { "count": 1, "columns": ["id", "sequence"] }
 * }
 * ```
 *
 * @performance O(n) memory usage - loads entire JSON file into memory.
 * For large datasets (>100K sequences), use JSONLParser instead.
 *
 * @since 0.1.0
 */
export class JSONParser {
  /**
   * Parse sequences from a JSON file
   *
   * Reads and parses a JSON file containing sequence data. Automatically detects
   * whether the file uses simple array format or wrapped format with metadata.
   *
   * @param path - Path to JSON file
   * @param options - Parsing options
   * @yields AbstractSequence objects (FastaSequence or FastqSequence)
   *
   * @throws {ParseError} When JSON is malformed or validation fails
   * @throws {FileError} When file cannot be read
   *
   * @example
   * ```typescript
   * const parser = new JSONParser();
   * for await (const seq of parser.parseFile('/data/sequences.json')) {
   *   console.log(`${seq.id}: ${seq.sequence}`);
   * }
   * ```
   *
   * @performance Loads entire file into memory. Use JSONLParser for streaming.
   */
  async *parseFile(path: string, options?: JSONParseOptions): AsyncIterable<AbstractSequence> {
    const content = await Bun.file(path).text();
    yield* this.parseString(content, options);
  }

  /**
   * Parse sequences from a JSON string
   *
   * Parses JSON content and yields sequences. Tries simple array format first,
   * then wrapped format with metadata. Uses ArkType validation to ensure
   * type safety.
   *
   * @param content - JSON string to parse
   * @param options - Parsing options
   * @yields AbstractSequence objects (FastaSequence or FastqSequence)
   *
   * @throws {ParseError} When JSON is malformed or validation fails
   *
   * @example
   * ```typescript
   * const json = '[{"id":"seq1","sequence":"ATCG"}]';
   * const parser = new JSONParser();
   * for await (const seq of parser.parseString(json)) {
   *   console.log(seq.id);
   * }
   * ```
   */
  async *parseString(content: string, options?: JSONParseOptions): AsyncIterable<AbstractSequence> {
    const arrayResult = deserializeJSON(content);

    if (!(arrayResult instanceof type.errors)) {
      for (const row of arrayResult) {
        yield this.rowToSequence(row, options);
      }
      return;
    }

    const wrappedResult = deserializeJSONWrapped(content);

    if (!(wrappedResult instanceof type.errors)) {
      for (const row of wrappedResult.sequences) {
        yield this.rowToSequence(row, options);
      }
      return;
    }

    throw new ParseError(`JSON validation failed: ${arrayResult.summary}`, "JSON");
  }

  /**
   * Convert validated JSON row to AbstractSequence
   *
   * Uses shared conversion logic from fx2tab module to maintain consistency
   * across all parsers. Determines format based on presence of quality field
   * or explicit format option.
   *
   * @param row - Validated sequence row from JSON
   * @param options - Parsing options including format override
   * @returns AbstractSequence (FastaSequence or FastqSequence)
   *
   * @private
   */
  private rowToSequence(
    row: Record<string, unknown>,
    options?: JSONParseOptions
  ): AbstractSequence {
    // Detect format from row or use provided format
    const format = options?.format || this.detectFormat(row);

    // Extract quality encoding with fallback chain
    const qualityEncoding =
      (row.qualityEncoding as "phred33" | "phred64" | "solexa") ||
      options?.qualityEncoding ||
      "phred33";

    // Build record with required and optional fields
    const record: {
      id: string;
      sequence: string;
      quality?: string;
      description?: string;
      length?: number;
    } = {
      id: row.id as string,
      sequence: row.sequence as string,
    };

    if (row.quality) {
      record.quality = row.quality as string;
    }
    if (row.description) {
      record.description = row.description as string;
    }
    if (row.length) {
      record.length = row.length as number;
    }

    // Use shared conversion helper
    return convertRecordToSequence(record, format, qualityEncoding);
  }

  /**
   * Auto-detect sequence format from JSON row
   *
   * Determines whether a sequence should be parsed as FASTA or FASTQ based on:
   * 1. Explicit 'format' field in the row
   * 2. Presence of 'quality' field (indicates FASTQ)
   * 3. Default to FASTA if neither present
   *
   * @param row - JSON object representing a sequence
   * @returns "fasta" or "fastq"
   *
   * @private
   */
  private detectFormat(row: Record<string, unknown>): "fasta" | "fastq" {
    if (row.format) {
      return row.format as "fasta" | "fastq";
    }

    return row.quality ? "fastq" : "fasta";
  }
}

/**
 * Parser for JSONL (JSON Lines) format sequence files
 *
 * Parses sequences from JSONL files where each line contains a separate JSON object.
 * Provides streaming, memory-efficient parsing suitable for large datasets.
 * Each line is parsed independently, enabling O(1) memory usage.
 *
 * @example Basic usage
 * ```typescript
 * const parser = new JSONLParser();
 * for await (const seq of parser.parseFile('sequences.jsonl')) {
 *   console.log(`${seq.id}: ${seq.length} bp`);
 * }
 * ```
 *
 * @example Processing large datasets
 * ```typescript
 * const parser = new JSONLParser();
 * let count = 0;
 * for await (const seq of parser.parseFile('huge-dataset.jsonl')) {
 *   if (seq.length > 100) count++;
 * }
 * console.log(`Found ${count} sequences > 100bp`);
 * ```
 *
 * @example JSONL format
 * ```jsonl
 * {"id":"seq1","sequence":"ATCG","length":4}
 * {"id":"seq2","sequence":"GCTA","length":4}
 * {"id":"seq3","sequence":"TTAA","length":4}
 * ```
 *
 * @performance O(1) memory usage - streams line-by-line.
 * Suitable for datasets with millions of sequences.
 *
 * @since 0.1.0
 */
export class JSONLParser {
  /**
   * Parse sequences from a JSONL file
   *
   * Reads a JSONL file line-by-line and parses each line as a separate JSON object.
   * Empty lines are automatically skipped. Provides streaming behavior with O(1)
   * memory usage, suitable for very large datasets.
   *
   * @param path - Path to JSONL file
   * @param options - Parsing options
   * @yields AbstractSequence objects (FastaSequence or FastqSequence)
   *
   * @throws {ParseError} When JSON line is malformed or validation fails
   * @throws {FileError} When file cannot be read
   *
   * @example
   * ```typescript
   * const parser = new JSONLParser();
   * for await (const seq of parser.parseFile('/data/sequences.jsonl')) {
   *   console.log(`${seq.id}: ${seq.sequence}`);
   * }
   * ```
   *
   * @performance Streaming with O(1) memory. Ideal for large files.
   */
  async *parseFile(path: string, options?: JSONParseOptions): AsyncIterable<AbstractSequence> {
    const file = Bun.file(path);

    async function* readLines() {
      const text = await file.text();
      const lines = text.split("\n");
      for (const line of lines) {
        yield line;
      }
    }

    for await (const row of jsonlToRows(readLines())) {
      yield this.rowToSequence(row, options);
    }
  }

  /**
   * Convert validated JSON row to AbstractSequence
   *
   * Uses shared conversion logic from fx2tab module to maintain consistency
   * across all parsers. Determines format based on presence of quality field
   * or explicit format option.
   *
   * @param row - Validated sequence row from JSON
   * @param options - Parsing options including format override
   * @returns AbstractSequence (FastaSequence or FastqSequence)
   *
   * @private
   */
  private rowToSequence(
    row: Record<string, unknown>,
    options?: JSONParseOptions
  ): AbstractSequence {
    // Detect format from row or use provided format
    const format = options?.format || this.detectFormat(row);

    // Extract quality encoding with fallback chain
    const qualityEncoding =
      (row.qualityEncoding as "phred33" | "phred64" | "solexa") ||
      options?.qualityEncoding ||
      "phred33";

    // Build record with required and optional fields
    const record: {
      id: string;
      sequence: string;
      quality?: string;
      description?: string;
      length?: number;
    } = {
      id: row.id as string,
      sequence: row.sequence as string,
    };

    if (row.quality) {
      record.quality = row.quality as string;
    }
    if (row.description) {
      record.description = row.description as string;
    }
    if (row.length) {
      record.length = row.length as number;
    }

    // Use shared conversion helper
    return convertRecordToSequence(record, format, qualityEncoding);
  }

  /**
   * Auto-detect sequence format from JSON row
   *
   * Determines whether a sequence should be parsed as FASTA or FASTQ based on:
   * 1. Explicit 'format' field in the row
   * 2. Presence of 'quality' field (indicates FASTQ)
   * 3. Default to FASTA if neither present
   *
   * @param row - JSON object representing a sequence
   * @returns "fasta" or "fastq"
   *
   * @private
   */
  private detectFormat(row: Record<string, unknown>): "fasta" | "fastq" {
    if (row.format) {
      return row.format as "fasta" | "fastq";
    }

    return row.quality ? "fastq" : "fasta";
  }
}
