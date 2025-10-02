/**
 * FASTA indexing and subsequence extraction (faidx)
 *
 * Similar to samtools/seqkit faidx but with TypeScript type safety
 * and integration with our DSV modules.
 *
 * @module operations/faidx
 */

import { type } from "arktype";
import { CompressionDetector } from "../compression/detector";
import { ParseError, ValidationError } from "../errors";
import { exists, readToString } from "../io/file-reader";
import { detectRuntime, getRuntimeGlobals } from "../io/runtime";
import type { FastaSequence } from "../types";
import { reverseComplement } from "./core/sequence-manipulation";

/**
 * ArkType schema for validating FaidxRecord data
 *
 * Ensures .fai file records meet biological and format constraints:
 * - name must be non-empty
 * - length must be at least 1 base
 * - offset must be non-negative
 * - linebases must be at least 1
 * - linewidth must account for bases + newline
 */
const FaidxRecordSchema = type({
  name: "string>0",
  length: "number>=1",
  offset: "number>=0",
  linebases: "number>=1",
  linewidth: "number>=2",
}).narrow((record, ctx) => {
  // Validate linewidth >= linebases (linewidth includes newline character)
  if (record.linewidth < record.linebases) {
    return ctx.reject({
      expected: "linewidth >= linebases (linewidth includes newline bytes)",
      actual: `linewidth=${record.linewidth}, linebases=${record.linebases}`,
      path: ["linewidth"],
    });
  }
  return true;
});

/**
 * ArkType schema for validating Faidx initialization options
 */
const FaidxOptionsSchema = type({
  "fullHeader?": "boolean",
  "updateIndex?": "boolean",
});

/**
 * ArkType schema for validating extraction options
 */
const ExtractOptionsSchema = type({
  "caseInsensitive?": "boolean",
  "onError?": "'throw' | 'skip'",
});

/**
 * Coordinate pattern definitions
 *
 * Order matters: patterns are tested sequentially.
 * More specific patterns should come before more general ones.
 */
const REGION_PATTERNS: readonly RegionPattern[] = [
  {
    name: "single_position",
    regex: /^(\d+)$/,
    parse: (match) => {
      const pos = Number.parseInt(match[1]!, 10);
      return { start: pos, end: pos };
    },
  },
  {
    name: "negative_range",
    regex: /^(-\d+):(-\d+)$/,
    parse: (match) => ({
      start: Number.parseInt(match[1]!, 10),
      end: Number.parseInt(match[2]!, 10),
    }),
  },
  {
    name: "positive_range",
    regex: /^(\d+)-(\d+)$/,
    parse: (match) => ({
      start: Number.parseInt(match[1]!, 10),
      end: Number.parseInt(match[2]!, 10),
    }),
  },
  {
    name: "start_to_end",
    regex: /^(\d+)-$/,
    parse: (match) => ({
      start: Number.parseInt(match[1]!, 10),
      end: -1,
    }),
  },
  {
    name: "beginning_to_position",
    regex: /^-(\d+)$/,
    parse: (match) => ({
      start: 1,
      end: Number.parseInt(match[1]!, 10),
    }),
  },
] as const;

/**
 * Options for Faidx initialization
 */
export type FaidxOptions = typeof FaidxOptionsSchema.infer;

/**
 * Options for extraction methods (extractMany, extractByPattern)
 */
export type ExtractOptions = typeof ExtractOptionsSchema.infer;

/**
 * FASTA index entry representing one sequence in the index
 *
 * Format matches samtools .fai specification:
 * - name: Sequence identifier (or full header with fullHeader option)
 * - length: Total sequence length in bases
 * - offset: Byte offset in file to first sequence base (after header line)
 * - linebases: Number of bases per sequence line
 * - linewidth: Number of bytes per line including newline character(s)
 */
export interface FaidxRecord {
  name: string;
  length: number;
  offset: number;
  linebases: number;
  linewidth: number;
}

/**
 * Parsed region specification
 *
 * Internal representation of a region string after parsing.
 * Coordinates are 1-based, -1 means "to sequence end".
 */
interface ParsedRegion {
  seqId: string;
  start: number;
  end: number;
}

/**
 * Region coordinate pattern definition
 *
 * Declarative pattern matching for genomic coordinate formats.
 * Each pattern has a name, regex, and parser function.
 */
interface RegionPattern {
  readonly name: string;
  readonly regex: RegExp;
  readonly parse: (match: RegExpExecArray) => { start: number; end: number };
}

/**
 * FASTA index builder and manager
 *
 * Builds and manages the in-memory index structure from FASTA files
 * or existing .fai index files. Provides methods to create, persist,
 * and query the index.
 *
 * Use this class when you need direct control over index creation and
 * management. For sequence extraction, use {@link Faidx} instead.
 */
export class FaiBuilder {
  private records: Map<string, FaidxRecord>;
  private fastaPath: string;

  constructor(fastaPath: string) {
    this.fastaPath = fastaPath;
    this.records = new Map();
  }

  /**
   * Get index record by sequence ID
   */
  get(seqId: string): FaidxRecord | undefined {
    return this.records.get(seqId);
  }

  /**
   * Get all sequence IDs in the index
   */
  getSequenceIds(): string[] {
    return Array.from(this.records.keys());
  }

  /**
   * Check if sequence exists in index
   */
  has(seqId: string): boolean {
    return this.records.has(seqId);
  }

  /**
   * Get total number of sequences in index
   */
  size(): number {
    return this.records.size;
  }

  /**
   * Build index from FASTA file
   *
   * Parses the FASTA file and creates index records tracking:
   * - Sequence ID (or full header if fullHeader=true)
   * - Total sequence length
   * - Byte offset to first sequence base
   * - Bases per line and bytes per line (including newline)
   *
   * @param options - Build options
   * @param options.fullHeader - Use full header line as ID instead of just first word
   */
  async build(options?: { fullHeader?: boolean }): Promise<void> {
    const fullHeader = options?.fullHeader ?? false;

    if (!(await exists(this.fastaPath))) {
      throw new ParseError(`FASTA file not found: ${this.fastaPath}`, "fasta");
    }

    const text = await readToString(this.fastaPath);
    const lines = text.split("\n");

    let byteOffset = 0;
    let currentRecord: {
      name: string;
      offset: number;
      linebases: number;
      linewidth: number;
      length?: number;
    } | null = null;
    let seqLength = 0;
    let linebases = 0;
    let linewidth = 0;
    let firstSeqLine = true;

    for (const line of lines) {
      const lineBytes = new TextEncoder().encode(`${line}\n`).length;

      if (line.startsWith(">")) {
        if (currentRecord) {
          currentRecord.length = seqLength;
          this.records.set(currentRecord.name, currentRecord as FaidxRecord);
        }

        const header = line.slice(1);
        const name = fullHeader ? header : header.split(/\s+/)[0] || header;

        byteOffset += lineBytes;

        currentRecord = {
          name,
          offset: byteOffset,
          linebases: 0,
          linewidth: 0,
        };
        seqLength = 0;
        firstSeqLine = true;
      } else if (line.trim() && currentRecord) {
        seqLength += line.length;

        if (firstSeqLine) {
          linebases = line.length;
          linewidth = lineBytes;
          currentRecord.linebases = linebases;
          currentRecord.linewidth = linewidth;
          firstSeqLine = false;
        }

        byteOffset += lineBytes;
      } else {
        byteOffset += lineBytes;
      }
    }

    if (currentRecord) {
      currentRecord.length = seqLength;
      this.records.set(currentRecord.name, currentRecord as FaidxRecord);
    }
  }

  /**
   * Write index to .fai file
   *
   * Writes the index in samtools .fai format:
   * Tab-delimited, no header, 5 columns per sequence
   *
   * @param faiPath - Output path for .fai file
   */
  async write(faiPath: string): Promise<void> {
    const lines: string[] = [];

    for (const record of this.records.values()) {
      const line = [
        record.name,
        record.length.toString(),
        record.offset.toString(),
        record.linebases.toString(),
        record.linewidth.toString(),
      ].join("\t");
      lines.push(line);
    }

    const content = `${lines.join("\n")}\n`;

    const runtime = detectRuntime();
    if (runtime === "bun") {
      const { Bun } = getRuntimeGlobals("bun") as { Bun: any };
      await Bun.write(faiPath, content);
    } else {
      const fs = await import("node:fs/promises");
      await fs.writeFile(faiPath, content, "utf-8");
    }
  }

  /**
   * Load index from existing .fai file
   *
   * Reads a samtools-format .fai file and populates the index.
   * Format: tab-delimited, 5 columns, no header
   *
   * @param faiPath - Path to .fai file
   */
  async load(faiPath: string): Promise<void> {
    if (!(await exists(faiPath))) {
      throw new ParseError(`Index file not found: ${faiPath}`, "fai");
    }

    const content = await readToString(faiPath);
    const lines = content.trim().split("\n");

    this.records.clear();

    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split("\t");
      if (parts.length !== 5) {
        throw new ParseError(
          `Invalid .fai format: expected 5 columns, got ${parts.length}. Line: ${line}`,
          "fai"
        );
      }

      const [name, lengthStr, offsetStr, linebasesStr, linewidthStr] = parts;

      // Fail fast on missing fields instead of defaulting
      if (!name || !lengthStr || !offsetStr || !linebasesStr || !linewidthStr) {
        throw new ParseError(
          `Incomplete .fai record: missing required fields. Line: ${line}`,
          "fai"
        );
      }

      // Parse numeric values
      const length = Number.parseInt(lengthStr, 10);
      const offset = Number.parseInt(offsetStr, 10);
      const linebases = Number.parseInt(linebasesStr, 10);
      const linewidth = Number.parseInt(linewidthStr, 10);

      // Check for parse failures
      if (
        Number.isNaN(length) ||
        Number.isNaN(offset) ||
        Number.isNaN(linebases) ||
        Number.isNaN(linewidth)
      ) {
        throw new ParseError(`Invalid numeric values in .fai record. Line: ${line}`, "fai");
      }

      const record: FaidxRecord = {
        name,
        length,
        offset,
        linebases,
        linewidth,
      };

      // Validate record with ArkType schema
      const validated = FaidxRecordSchema(record);
      if (validated instanceof type.errors) {
        throw new ParseError(`Invalid .fai record: ${validated.summary}. Line: ${line}`, "fai");
      }

      this.records.set(validated.name, validated);
    }
  }
}

/**
 * FASTA random access and sequence extraction
 *
 * Main user-facing API for extracting sequences from indexed FASTA files.
 * Provides fast random access to sequences and regions using a .fai index.
 *
 * @example
 * ```typescript
 * const faidx = new Faidx('genome.fasta');
 * await faidx.init();
 *
 * // Extract full sequence
 * const chr1 = await faidx.extract('chr1');
 *
 * // Extract region
 * const region = await faidx.extract('chr1:1000-2000');
 * ```
 */
export class Faidx {
  private fastaPath: string;
  private builder: FaiBuilder;
  private options: FaidxOptions;

  constructor(fastaPath: string, options?: FaidxOptions) {
    this.fastaPath = fastaPath;

    // Validate options with ArkType
    if (options) {
      const validated = FaidxOptionsSchema(options);
      if (validated instanceof type.errors) {
        throw new ValidationError(`Invalid Faidx options: ${validated.summary}`);
      }
      this.options = validated;
    } else {
      this.options = {};
    }

    this.builder = new FaiBuilder(fastaPath);
  }

  /**
   * Initialize the index
   *
   * Intelligently builds or loads the index:
   * - If .fai exists and updateIndex=false: load it
   * - Otherwise: build from FASTA and write .fai
   */
  async init(): Promise<void> {
    // Check if FASTA file is compressed (incompatible with FAIDX)
    // Use existing CompressionDetector module for consistency
    const detection = CompressionDetector.hybrid(this.fastaPath);
    if (detection.format !== "none" && detection.confidence > 0.5) {
      throw new ValidationError(
        `FASTA file appears to be compressed (${detection.format}). ` +
          `FAIDX requires uncompressed files for random byte access. ` +
          `Please decompress the file first:\n` +
          `  - For .gz files: gunzip ${this.fastaPath}\n` +
          `  - For .bgzf files: bgzip -d ${this.fastaPath}\n` +
          `  - For .zst files: zstd -d ${this.fastaPath}`
      );
    }

    const faiPath = this.getFaiPath();

    if ((await exists(faiPath)) && !this.options.updateIndex) {
      await this.builder.load(faiPath);
    } else {
      const buildOptions = this.options.fullHeader ? { fullHeader: true } : undefined;
      await this.builder.build(buildOptions);
      await this.builder.write(faiPath);
    }
  }

  /**
   * Extract a sequence by ID or region
   *
   * Supports multiple extraction formats:
   * - Full sequence: `extract('chr1')`
   * - Range: `extract('chr1:100-200')` (1-based, inclusive)
   * - Single base: `extract('chr1:100')`
   * - From position to end: `extract('chr1:100-')`
   * - From start to position: `extract('chr1:-200')`
   * - Negative indices: `extract('chr1:-10:-1')` (last 10 bases)
   *
   * @param region - Sequence ID or region string
   * @returns Promise resolving to the extracted sequence
   *
   * @example
   * ```typescript
   * const chr1 = await faidx.extract('chr1');
   * const region = await faidx.extract('chr1:1000-2000');
   * const lastTen = await faidx.extract('chr1:-10:-1');
   * ```
   */
  async extract(region: string): Promise<FastaSequence> {
    const parsed = parseRegion(region);
    const record = this.builder.get(parsed.seqId);

    if (!record) {
      throw new ValidationError(
        `Sequence "${parsed.seqId}" not found in index. Available sequences: ${this.builder.getSequenceIds().slice(0, 5).join(", ")}${this.builder.size() > 5 ? "..." : ""}`
      );
    }

    // Resolve negative indices and -1 (end of sequence)
    let start = resolveNegativeIndex(parsed.start, record.length);
    let end = parsed.end === -1 ? record.length : resolveNegativeIndex(parsed.end, record.length);

    // Detect reverse complement request (start > end)
    const needsReverseComplement = start > end;

    // Swap coordinates for extraction if reverse complement needed
    if (needsReverseComplement) {
      [start, end] = [end, start];
    }

    // Validate coordinates with helpful error messages
    validateCoordinates(start, end, parsed.seqId, record.length);

    let sequence = await this.extractSubsequence(record, start, end);

    // Apply reverse complement if needed
    if (needsReverseComplement) {
      sequence = reverseComplement(sequence);
    }

    // Generate appropriate ID based on extraction type
    let id: string;

    if (start === 1 && end === record.length && !needsReverseComplement) {
      // Full sequence - use sequence name only
      id = record.name;
    } else if (region.includes(":")) {
      // Partial extraction - determine if we need to expand coordinates
      const parts = region.split(":");
      const coords = parts[1];

      if (!coords) {
        id = region;
      } else {
        // Determine if coordinates should be kept as-is or expanded
        const hasTrailingDash = coords.endsWith("-");
        const hasLeadingDash = coords.startsWith("-");
        const dashIndex = coords.indexOf("-");
        const hasExplicitRange = dashIndex > 0 && !hasTrailingDash && !hasLeadingDash;

        if (needsReverseComplement || hasExplicitRange) {
          // Keep original: explicit range like "10-20" or reverse complement "20-10"
          id = region;
        } else {
          // Expand: special syntax like "60-", "-5", "1", "-4:-1"
          id = `${record.name}:${start}-${end}`;
        }
      }
    } else {
      // Shouldn't happen, but fall back to region
      id = region;
    }

    return {
      format: "fasta",
      id,
      sequence,
      length: sequence.length,
    };
  }

  /**
   * Extract multiple sequences by region strings
   *
   * Efficiently extracts multiple sequences or regions in a streaming fashion.
   * Supports all region formats supported by extract().
   *
   * @param regions - Array of region strings (sequence IDs or regions)
   * @param options - Extraction options
   * @returns Async iterable of extracted sequences
   *
   * @example
   * ```typescript
   * const regions = ['chr1:100-200', 'chr2:500-600', 'chrX:1000-2000'];
   * for await (const seq of faidx.extractMany(regions)) {
   *   console.log(`${seq.id}: ${seq.length} bp`);
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Skip invalid regions instead of throwing
   * const regions = ['chr1:100-200', 'invalid', 'chr2:500-600'];
   * for await (const seq of faidx.extractMany(regions, { onError: 'skip' })) {
   *   console.log(seq.id);
   * }
   * ```
   */
  async *extractMany(regions: string[], options?: ExtractOptions): AsyncIterable<FastaSequence> {
    // Validate options if provided
    if (options) {
      const validated = ExtractOptionsSchema(options);
      if (validated instanceof type.errors) {
        throw new ValidationError(`Invalid extract options: ${validated.summary}`);
      }
    }

    const onError = options?.onError ?? "throw";

    for (const region of regions) {
      try {
        yield await this.extract(region);
      } catch (error) {
        if (onError === "throw") {
          throw error;
        }
        // onError === 'skip': silently skip invalid regions
      }
    }
  }

  /**
   * Extract sequences matching a regex pattern
   *
   * Efficiently extracts all sequences whose IDs match the given pattern.
   * Pattern matching is performed against sequence IDs (not full headers).
   *
   * @param pattern - String pattern or RegExp to match against sequence IDs
   * @param options - Extraction options (supports caseInsensitive)
   * @returns Async iterable of matching sequences
   *
   * @example
   * ```typescript
   * // Extract all numbered chromosomes (chr1, chr2, ..., chr22)
   * for await (const seq of faidx.extractByPattern(/^chr[0-9]+$/)) {
   *   console.log(`${seq.id}: ${seq.length} bp`);
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Case-insensitive pattern matching
   * for await (const seq of faidx.extractByPattern('CHR', { caseInsensitive: true })) {
   *   console.log(seq.id);
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Skip extraction errors for matched sequences
   * for await (const seq of faidx.extractByPattern(/^chr[XYM]$/, { onError: 'skip' })) {
   *   console.log(seq.id);
   * }
   * ```
   */
  async *extractByPattern(
    pattern: string | RegExp,
    options?: ExtractOptions
  ): AsyncIterable<FastaSequence> {
    // Validate options if provided
    if (options) {
      const validated = ExtractOptionsSchema(options);
      if (validated instanceof type.errors) {
        throw new ValidationError(`Invalid extract options: ${validated.summary}`);
      }
    }

    // Build regex with appropriate flags
    let regex: RegExp;
    try {
      if (typeof pattern === "string") {
        const flags = options?.caseInsensitive ? "i" : "";
        regex = new RegExp(pattern, flags);
      } else {
        // RegExp object provided
        if (options?.caseInsensitive && !pattern.flags.includes("i")) {
          // Add 'i' flag if not already present
          regex = new RegExp(pattern.source, pattern.flags + "i");
        } else {
          regex = pattern;
        }
      }
    } catch (error) {
      throw new ValidationError(
        `Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const onError = options?.onError ?? "throw";

    // Match against sequence IDs and extract
    for (const seqId of this.builder.getSequenceIds()) {
      if (regex.test(seqId)) {
        try {
          yield await this.extract(seqId);
        } catch (error) {
          if (onError === "throw") {
            throw error;
          }
          // onError === 'skip': silently skip failed extractions
        }
      }
    }
  }

  /**
   * Extract subsequence from FASTA file using byte offsets
   *
   * @param record - Index record with offset information
   * @param start - Start position (1-based, inclusive)
   * @param end - End position (1-based, inclusive)
   * @returns The extracted sequence string
   */
  private async extractSubsequence(
    record: FaidxRecord,
    start: number,
    end: number
  ): Promise<string> {
    const { startByte, endByte } = calculateByteRange(start, end, record);

    const runtime = detectRuntime();

    let rawBytes: Uint8Array;

    if (runtime === "bun") {
      const { Bun } = getRuntimeGlobals("bun") as { Bun: any };
      const file = Bun.file(this.fastaPath);
      const slice = file.slice(startByte, endByte);
      const buffer = await slice.arrayBuffer();
      rawBytes = new Uint8Array(buffer);
    } else {
      const fs = await import("node:fs/promises");
      const fileHandle = await fs.open(this.fastaPath, "r");
      const buffer = Buffer.alloc(endByte - startByte);
      await fileHandle.read(buffer, 0, buffer.length, startByte);
      await fileHandle.close();
      rawBytes = buffer;
    }

    const text = new TextDecoder().decode(rawBytes);
    const sequence = text.replace(/\r?\n/g, "");

    return sequence;
  }

  /**
   * Get the .fai index file path
   */
  private getFaiPath(): string {
    return this.options.fullHeader ? `${this.fastaPath}.seqkit.fai` : `${this.fastaPath}.fai`;
  }
}

/**
 * Calculate byte range for extracting a subsequence from FASTA
 *
 * Internal helper for converting 1-based genomic coordinates to byte offsets
 * in a FASTA file using .fai index information.
 *
 * @param start - Start position (1-based, inclusive)
 * @param end - End position (1-based, inclusive)
 * @param record - Index record with offset information
 * @returns Object with startByte and endByte for file reading
 */

function calculateByteRange(
  start: number,
  end: number,
  record: FaidxRecord
): { startByte: number; endByte: number } {
  const start0 = start - 1;
  const end0 = end - 1;

  const startLine = Math.floor(start0 / record.linebases);
  const endLine = Math.floor(end0 / record.linebases);

  const startByte = record.offset + startLine * record.linewidth + (start0 % record.linebases);

  const endByte = record.offset + endLine * record.linewidth + (end0 % record.linebases) + 1;

  return { startByte, endByte };
}

/**
 * Match coordinate string against known patterns
 *
 * @param coords - Coordinate portion of region string (after colon)
 * @returns Parsed coordinates or null if no pattern matched
 */
function matchCoordinatePattern(coords: string): { start: number; end: number } | null {
  for (const pattern of REGION_PATTERNS) {
    const match = pattern.regex.exec(coords);
    if (match) {
      return pattern.parse(match);
    }
  }
  return null;
}

/**
 * Parse region string into sequence ID and coordinates
 *
 * Supports multiple region formats:
 * - "chr1" - Full sequence
 * - "chr1:100-200" - Range (1-based, inclusive)
 * - "chr1:100" - Single base
 * - "chr1:100-" - From position to end
 * - "chr1:-200" - From start to position
 * - "chr1:-10:-1" - Negative range (last 10 bases)
 *
 * @param region - Region string to parse
 * @returns Parsed region with seqId, start, end
 */
function parseRegion(region: string): ParsedRegion {
  // Extract sequence ID and coordinate part
  const colonIndex = region.indexOf(":");

  // No colon = full sequence
  if (colonIndex === -1) {
    return { seqId: region, start: 1, end: -1 };
  }

  const seqId = region.slice(0, colonIndex);
  const coords = region.slice(colonIndex + 1);

  // Try to match coordinate patterns
  const coordResult = matchCoordinatePattern(coords);

  if (coordResult) {
    return { seqId, ...coordResult };
  }

  // Couldn't parse coordinates, treat whole thing as sequence ID
  return { seqId: region, start: 1, end: -1 };
}

/**
 * Resolve negative indices to positive 1-based coordinates
 *
 * Negative indices count from the end:
 * - -1 means last base
 * - -2 means second-to-last base
 * etc.
 *
 * @param pos - Position (positive or negative)
 * @param seqLength - Total sequence length
 * @returns Positive 1-based coordinate
 */
function resolveNegativeIndex(pos: number, seqLength: number): number {
  if (pos < 0) {
    return seqLength + pos + 1;
  }
  return pos;
}

/**
 * Validate genomic coordinates with helpful error suggestions
 *
 * @param start - Start position (1-based, after negative index resolution)
 * @param end - End position (1-based, after negative index resolution)
 * @param seqId - Sequence identifier for error messages
 * @param seqLength - Total sequence length
 * @throws ValidationError with helpful suggestions if coordinates are invalid
 */
function validateCoordinates(start: number, end: number, seqId: string, seqLength: number): void {
  // Check start bounds
  if (start < 1) {
    throw new ValidationError(
      `Start position ${start} is less than 1 for sequence "${seqId}". ` +
        `Coordinates are 1-based. Try using 1 for the first base.`
    );
  }

  if (start > seqLength) {
    throw new ValidationError(
      `Start position ${start} exceeds sequence length ${seqLength} for "${seqId}". ` +
        `Valid coordinates are 1-${seqLength}.`
    );
  }

  // Check end bounds
  if (end < 1) {
    throw new ValidationError(
      `End position ${end} is less than 1 for sequence "${seqId}". ` +
        `Use -1 to mean "end of sequence" or positive coordinates.`
    );
  }

  if (end > seqLength) {
    throw new ValidationError(
      `End position ${end} exceeds sequence length ${seqLength} for "${seqId}". ` +
        `Valid coordinates are 1-${seqLength}.`
    );
  }

  // Check range validity (after coordinate swapping for reverse complement)
  if (start > end) {
    throw new ValidationError(
      `Invalid range: start (${start}) > end (${end}) for sequence "${seqId}".`
    );
  }
}
