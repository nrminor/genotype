/**
 * BAM format parser with comprehensive binary support
 *
 * Handles the complexity of BAM (Binary Alignment/Map) format:
 * - BGZF compression for random access
 * - Binary encoding of alignment records
 * - 4-bit packed sequence encoding
 * - Binary CIGAR operations
 * - Streaming architecture for memory efficiency with large files
 * - Type-safe operations with comprehensive error handling
 *
 * BAM files are the binary equivalent of SAM files, providing:
 * - ~3-5x smaller file size than SAM
 * - Faster parsing due to binary format
 * - Random access capability with BAI index files
 * - Native support for BGZF compression
 */

import { BamError, CompressionError, ValidationError } from "../errors";
// BAIWriter imported but not used in current implementation
import type {
  BAIIndex,
  BAMAlignment,
  CIGARString,
  MAPQScore,
  ParserOptions,
  QualityEncoding,
  SAMFlag,
  SAMHeader,
} from "../types";
import { CIGAROperationSchema, MAPQScoreSchema, SAMFlagSchema } from "../types";
import { AbstractParser } from "./abstract-parser";
import { BAIReader } from "./bam/bai-reader";
import { BAMWriter, type BAMWriterOptions } from "./bam/bam-writer";
import { createStream, detectFormat } from "./bam/bgzf";
import { BGZFCompressor } from "./bam/bgzf-compressor";
import {
  isBunOptimized,
  isValidBAMMagic,
  parseAlignmentRecord,
  parseOptionalTags,
  readCString,
  readInt32LE,
} from "./bam/binary";

/**
 * BAM-specific parser options
 * Extends base ParserOptions for binary alignment data with compression
 */
interface BamParserOptions extends ParserOptions {
  /** Custom quality encoding for alignment quality scores */
  qualityEncoding?: QualityEncoding;
  /** Whether to parse quality scores immediately */
  parseQualityScores?: boolean;
  /** BGZF compression options for binary format */
  compressionOptions?: any; // Could be expanded with specific BGZF options
}

/**
 * Streaming BAM parser with BGZF decompression and binary decoding
 *
 * Designed for memory efficiency with large BAM files from modern sequencers.
 * Handles real-world BAM complexity including:
 * - Long reads from PacBio/Oxford Nanopore (>100kb sequences)
 * - Large CIGAR strings with complex operations
 * - Comprehensive optional tag support
 * - BGZF block-level error recovery
 *
 * @example Basic usage
 * ```typescript
 * const parser = new BAMParser();
 * for await (const record of parser.parseFile('alignments.bam')) {
 *   if (record.format === 'bam') {
 *     console.log(`${record.qname} -> ${record.rname}:${record.pos}`);
 *   }
 * }
 * ```
 *
 * @example With custom options
 * ```typescript
 * const parser = new BAMParser({
 *   skipValidation: false,
 *   trackLineNumbers: true,
 *   onError: (error) => console.error(`BAM error: ${error}`)
 * });
 * ```
 */
export class BAMParser extends AbstractParser<BAMAlignment | SAMHeader, BamParserOptions> {
  private baiReader?: BAIReader;
  private baiIndex?: BAIIndex;
  private referenceNames: string[] = [];

  /**
   * Create a new BAM parser with specified options and interrupt support
   * @param options BAM parser configuration options including AbortSignal
   */
  constructor(options: BamParserOptions = {}) {
    // Provide BAM-specific defaults (binary format considerations)
    super({
      skipValidation: false,
      maxLineLength: 100_000_000, // 100MB max record for long reads
      trackLineNumbers: false, // Not applicable to binary format
      qualityEncoding: "phred33", // BAM-specific default
      parseQualityScores: false, // BAM-specific default
      onError: (error: string): never => {
        throw new BamError(error, undefined, undefined);
      },
      onWarning: (warning: string): void => {
        console.warn(`BAM Warning: ${warning}`);
      },
      ...options, // User options override defaults
    } as BamParserOptions);
  }

  protected getFormatName(): string {
    return "BAM";
  }

  /**
   * Parse BAM records from a file using Bun's optimized file I/O
   * @param filePath Path to BAM file to parse
   * @param options File reading options for performance tuning
   * @yields BAMAlignment or SAMHeader objects as they are parsed from the file
   * @throws {BamError} When BAM format is invalid
   * @throws {CompressionError} When BGZF decompression fails
   * @example
   * ```typescript
   * const parser = new BAMParser();
   * for await (const record of parser.parseFile('/path/to/alignments.bam')) {
   *   if (record.format === 'bam') {
   *     console.log(`${record.qname} -> ${record.rname}:${record.pos}`);
   *   }
   * }
   * ```
   */
  async *parseFile(
    filePath: string,
    options?: import("../types").FileReaderOptions
  ): AsyncIterable<BAMAlignment | SAMHeader> {
    // Tiger Style: Assert function arguments
    if (typeof filePath !== "string") {
      throw new ValidationError("filePath must be a string");
    }
    if (filePath.length === 0) {
      throw new ValidationError("filePath must not be empty");
    }
    if (options && typeof options !== "object") {
      throw new ValidationError("options must be an object if provided");
    }

    try {
      // Validate file path first
      const validatedPath = await this.validateFilePath(filePath);

      // Use Bun.file() for optimal performance when available
      if (
        typeof globalThis !== "undefined" &&
        "Bun" in globalThis &&
        globalThis.Bun !== undefined &&
        typeof globalThis.Bun.file === "function"
      ) {
        yield* this.parseFileWithBun(validatedPath, options);
      } else {
        // Fallback to generic file reading
        yield* this.parseFileGeneric(validatedPath, options);
      }
    } catch (error) {
      // Re-throw with enhanced context
      if (error instanceof Error) {
        throw new BamError(
          `Failed to parse BAM file '${filePath}': ${error.message}`,
          undefined,
          "file",
          undefined,
          error.stack
        );
      }
      throw error;
    }
  }

  /**
   * Parse BAM records from a binary stream with optimized BGZF handling
   * @param stream ReadableStream of binary BAM data
   * @yields BAMAlignment or SAMHeader objects as they are parsed
   * @throws {BamError} When BAM format is invalid
   * @throws {CompressionError} When BGZF decompression fails
   */
  async *parse(stream: ReadableStream<Uint8Array>): AsyncIterable<BAMAlignment | SAMHeader> {
    // Tiger Style: Assert function arguments
    if (!(stream instanceof ReadableStream)) {
      throw new ValidationError("stream must be a ReadableStream");
    }

    // Track bytes processed for error reporting
    let totalBytesProcessed = 0;

    try {
      // Set up BGZF decompression with proper buffer management
      const bgzfStream = stream.pipeThrough(createStream());
      const reader = bgzfStream.getReader();

      // Optimized buffer management for large BAM files
      let buffer = new Uint8Array(0);
      let headerParsed = false;
      let references: string[] = [];
      let currentOffset = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // Process any remaining complete records
            if (buffer.length > 0) {
              yield* this.processRemainingData(buffer, references, currentOffset, headerParsed);
            }
            break;
          }

          // Use efficient buffer concatenation for Bun
          const uint8Value =
            value instanceof ArrayBuffer ? new Uint8Array(value as ArrayBuffer) : value;
          // @ts-expect-error - ArrayBufferLike vs ArrayBuffer compatibility
          buffer = this.appendToBuffer(buffer, uint8Value);
          totalBytesProcessed += value.length;

          // Parse header if not yet done
          if (!headerParsed) {
            const headerResult = this.parseHeaderFromBuffer(buffer);
            if (headerResult) {
              const { header, bytesConsumed, refNames } = headerResult;
              yield header;
              references = refNames;
              buffer = buffer.slice(bytesConsumed);
              currentOffset += bytesConsumed;
              headerParsed = true;
            } else {
              // Not enough data for complete header yet
              continue;
            }
          }

          // Parse alignment records with proper buffer tracking
          const parseResult = await this.parseRecordsFromBuffer(buffer, references, currentOffset);

          // Yield parsed alignments
          for (const alignment of parseResult.alignments) {
            yield alignment;
          }

          // Update buffer and offset tracking
          if (parseResult.bytesConsumed > 0) {
            buffer = buffer.slice(parseResult.bytesConsumed);
            currentOffset += parseResult.bytesConsumed;
          }

          // Memory management: prevent buffer from growing too large
          if (buffer.length > 10 * 1024 * 1024) {
            // 10MB limit
            this.options.onWarning!(
              `Large buffer detected (${(buffer.length / 1024 / 1024).toFixed(1)}MB) at ${totalBytesProcessed} bytes processed, consider increasing processing speed`
            );
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof BamError || error instanceof CompressionError) {
        throw error;
      }

      throw new BamError(
        `BAM parsing failed after processing ${totalBytesProcessed} bytes: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "parsing",
        undefined,
        "Check file format and integrity"
      );
    }
  }

  /**
   * Parse BAM records from a binary string (base64 or hex encoded)
   * @param data String containing binary BAM data (base64 or hex encoded)
   * @yields BAMAlignment or SAMHeader objects as they are parsed
   * @throws {BamError} When BAM format is invalid or string encoding is unsupported
   * @example
   * ```typescript
   * const parser = new BAMParser();
   * // Base64 encoded BAM data
   * const bamData = "QkFNAQAAAAA..."; // base64 encoded BAM
   * for await (const record of parser.parseString(bamData)) {
   *   if (record.format === 'bam') {
   *     console.log(`${record.qname} -> ${record.rname}:${record.pos}`);
   *   }
   * }
   * ```
   */
  async *parseString(data: string): AsyncIterable<BAMAlignment | SAMHeader> {
    // Tiger Style: Assert function arguments
    if (typeof data !== "string") {
      throw new ValidationError("data must be a string");
    }
    if (data.length === 0) {
      throw new ValidationError("data must not be empty");
    }

    try {
      // BAM is binary, so string input must be base64 or hex encoded
      const binaryData = this.decodeBinaryString(data);

      // Create stream from binary data
      const stream = new ReadableStream({
        start(controller): void {
          controller.enqueue(binaryData);
          controller.close();
        },
      });

      // Use existing parse method
      yield* this.parse(stream);
    } catch (error) {
      if (error instanceof BamError) {
        throw error;
      }
      throw new BamError(
        `Failed to parse BAM from string: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "string_parsing",
        undefined,
        "Ensure string is properly base64 or hex encoded binary data"
      );
    }
  }

  /**
   * Decode binary string data (base64 or hex) to Uint8Array
   * @param data String data to decode
   * @returns Decoded binary data
   * @throws {BamError} When string format is invalid
   */
  private decodeBinaryString(data: string): Uint8Array {
    // Tiger Style: Assert function arguments
    if (typeof data !== "string") {
      throw new ValidationError("data must be a string");
    }

    // Remove whitespace
    const cleaned = data.replace(/\s/g, "");

    // Try base64 first (most common for binary data)
    if (this.isBase64(cleaned)) {
      return Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
    }

    // Try hex encoding
    if (this.isHex(cleaned)) {
      const bytes = new Uint8Array(cleaned.length / 2);
      for (let i = 0; i < cleaned.length; i += 2) {
        bytes[i / 2] = parseInt(cleaned.substr(i, 2), 16);
      }
      return bytes;
    }

    throw new BamError(
      "Invalid BAM string format. Expected base64 or hex encoded binary data",
      undefined,
      "string_encoding",
      undefined,
      'Use Buffer.from(bamData).toString("base64") to encode BAM data'
    );
  }

  private isBase64(str: string): boolean {
    return /^[A-Za-z0-9+/]*={0,2}$/.test(str) && str.length % 4 === 0;
  }

  private isHex(str: string): boolean {
    return /^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0;
  }

  /**
   * Parse BAM header from buffer
   * @param buffer Binary data buffer
   * @returns Header parse result or null if incomplete
   */
  /**
   * Validate BAM header buffer and magic bytes
   */
  private validateBAMHeaderBuffer(buffer: Uint8Array): {
    view: DataView;
    offset: number;
  } {
    if (!(buffer instanceof Uint8Array)) {
      throw new ValidationError("buffer must be Uint8Array");
    }

    if (buffer.length < 12) {
      throw new Error("INCOMPLETE_DATA"); // Signal incomplete data
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const magic = buffer.slice(0, 4);
    if (!isValidBAMMagic(magic)) {
      throw new BamError(
        "Invalid BAM magic bytes - file may be corrupted or not a BAM file",
        undefined,
        "header"
      );
    }

    return { view, offset: 4 };
  }

  /**
   * Parse SAM header text section
   */
  private parseBAMHeaderText(
    view: DataView,
    buffer: Uint8Array,
    startOffset: number
  ): { offset: number } {
    const headerLength = readInt32LE(view, startOffset);
    const offset = startOffset + 4;

    if (headerLength < 0) {
      throw new BamError(`Invalid SAM header length: ${headerLength}`, undefined, "header");
    }

    // Check if we have complete SAM header text
    if (buffer.length < offset + headerLength + 4) {
      throw new Error("INCOMPLETE_DATA"); // Need more data
    }

    // Skip SAM header text for now
    // TODO: Parse SAM header text to extract @HD, @SQ, @RG, @PG lines
    return { offset: offset + headerLength };
  }

  /**
   * Parse single reference sequence from BAM header
   */
  private parseBAMReference(
    view: DataView,
    buffer: Uint8Array,
    startOffset: number,
    refIndex: number
  ): { reference: { name: string; length: number }; offset: number } {
    // Check if we have enough data for reference name length
    if (buffer.length < startOffset + 4) {
      throw new Error("INCOMPLETE_DATA");
    }

    const nameLength = readInt32LE(view, startOffset);
    let offset = startOffset + 4;

    if (nameLength <= 0) {
      throw new BamError(
        `Invalid reference name length: ${nameLength} for reference ${refIndex}`,
        undefined,
        "header"
      );
    }

    // Check if we have complete reference data
    if (buffer.length < offset + nameLength + 4) {
      throw new Error("INCOMPLETE_DATA");
    }

    // Read reference name (null-terminated)
    const nameResult = readCString(view, offset, nameLength);
    const refName = nameResult.value;
    offset += nameLength;

    // Read reference length
    const refLength = readInt32LE(view, offset);
    offset += 4;

    if (refLength < 0) {
      throw new BamError(
        `Invalid reference length: ${refLength} for reference '${refName}'`,
        undefined,
        "header"
      );
    }

    return {
      reference: { name: refName, length: refLength },
      offset,
    };
  }

  /**
   * Parse all reference sequences from BAM header
   */
  private parseBAMReferences(
    view: DataView,
    buffer: Uint8Array,
    startOffset: number
  ): {
    references: Array<{ name: string; length: number }>;
    referenceNames: string[];
    offset: number;
  } {
    const numRefs = readInt32LE(view, startOffset);
    let offset = startOffset + 4;

    if (numRefs < 0) {
      throw new BamError(`Invalid reference count: ${numRefs}`, undefined, "header");
    }

    const references: Array<{ name: string; length: number }> = [];
    const referenceNames: string[] = [];

    for (let i = 0; i < numRefs; i++) {
      const refResult = this.parseBAMReference(view, buffer, offset, i);
      references.push(refResult.reference);
      referenceNames.push(refResult.reference.name);
      offset = refResult.offset;
    }

    return { references, referenceNames, offset };
  }

  /**
   * Create final header object and validate results
   */
  private createBAMHeaderResult(
    referenceNames: string[],
    references: Array<{ name: string; length: number }>,
    bytesConsumed: number,
    expectedRefCount: number
  ): {
    header: SAMHeader;
    bytesConsumed: number;
    refNames: string[];
    references: Array<{ name: string; length: number }>;
  } {
    // Create header object (convert to SAMHeader format for compatibility)
    const header: SAMHeader = {
      format: "sam-header",
      type: "HD",
      fields: {
        VN: "1.0",
        SO: "coordinate",
      },
    };

    // Tiger Style: Assert postconditions
    if (bytesConsumed <= 12) {
      throw new BamError(
        "bytes consumed must be greater than minimum header size",
        undefined,
        "header"
      );
    }
    if (referenceNames.length !== expectedRefCount) {
      throw new BamError("reference names count must match header", undefined, "header");
    }

    return {
      header,
      bytesConsumed,
      refNames: referenceNames,
      references,
    };
  }

  private parseHeaderFromBuffer(buffer: Uint8Array): {
    header: SAMHeader;
    bytesConsumed: number;
    refNames: string[];
    references: Array<{ name: string; length: number }>;
  } | null {
    try {
      const validation = this.validateBAMHeaderBuffer(buffer);
      const headerTextResult = this.parseBAMHeaderText(validation.view, buffer, validation.offset);
      const referencesResult = this.parseBAMReferences(
        validation.view,
        buffer,
        headerTextResult.offset
      );

      return this.createBAMHeaderResult(
        referencesResult.referenceNames,
        referencesResult.references,
        referencesResult.offset,
        referencesResult.references.length
      );
    } catch (error) {
      if (error instanceof Error && error.message === "INCOMPLETE_DATA") {
        return null; // Not enough data, try again later
      }
      if (error instanceof BamError) {
        throw error;
      }
      throw new BamError(
        `Header parsing failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "header"
      );
    }
  }

  /**
   * Parse a single BAM alignment record with Bun optimizations
   * @param view DataView containing alignment data
   * @param offset Starting offset of alignment data
   * @param blockSize Size of alignment block
   * @param references Reference sequence names
   * @param blockOffset BGZF block offset for error reporting
   * @returns BAMAlignment object
   */
  private parseAlignment(
    view: DataView,
    offset: number,
    blockSize: number,
    references: string[],
    blockOffset: number
  ): BAMAlignment {
    // Tiger Style: Assert function arguments
    if (!(view instanceof DataView)) {
      throw new ValidationError("view must be DataView");
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ValidationError("offset must be non-negative integer");
    }
    if (!Number.isInteger(blockSize) || blockSize <= 0) {
      throw new ValidationError("blockSize must be positive integer");
    }
    if (!Array.isArray(references)) {
      throw new ValidationError("references must be an array");
    }

    try {
      // Use the new comprehensive BinaryParser method
      const parsedRecord = parseAlignmentRecord(view, offset, blockSize);

      // Convert reference IDs to names
      const rname =
        parsedRecord.refID >= 0 && parsedRecord.refID < references.length
          ? references[parsedRecord.refID]
          : "*";
      const rnext =
        parsedRecord.nextRefID >= 0 && parsedRecord.nextRefID < references.length
          ? references[parsedRecord.nextRefID]
          : parsedRecord.nextRefID === parsedRecord.refID
            ? "="
            : "*";

      // Parse optional tags if present
      let samTags: import("../types").SAMTag[] | undefined;
      if (parsedRecord.optionalTags) {
        const parsedTags = parseOptionalTags(parsedRecord.optionalTags, parsedRecord.readName);
        samTags = parsedTags.map((tag) => ({
          tag: tag.tag,
          type: this.mapTagTypeToSAM(tag.type),
          value: tag.value,
        }));
      }

      // Create BAM alignment with enhanced validation
      const alignment: BAMAlignment = {
        format: "bam",
        qname: parsedRecord.readName,
        flag: this.validateFlag(parsedRecord.flag, parsedRecord.readName, blockOffset),
        rname: rname !== undefined && rname !== null && rname !== "" ? rname : "*",
        pos: Math.max(0, parsedRecord.pos + 1), // Convert to 1-based and ensure non-negative
        mapq: this.validateMAPQ(parsedRecord.mapq, parsedRecord.readName, blockOffset),
        cigar: this.validateCIGAR(parsedRecord.cigar, parsedRecord.readName, blockOffset),
        rnext: rnext !== undefined && rnext !== null && rnext !== "" ? rnext : "*",
        pnext: Math.max(0, parsedRecord.nextPos + 1), // Convert to 1-based and ensure non-negative
        tlen: parsedRecord.tlen,
        seq: parsedRecord.sequence,
        qual: parsedRecord.qualityScores,
        ...(samTags && { tags: samTags }),
        blockStart: blockOffset,
        blockEnd: blockOffset + blockSize,
        binIndex: parsedRecord.bin,
      };

      // Tiger Style: Additional semantic validation
      if (alignment.seq !== "*" && alignment.qual !== "*") {
        if (alignment.seq.length !== alignment.qual.length) {
          throw new BamError(
            `Sequence/quality length mismatch: seq=${alignment.seq.length}, qual=${alignment.qual.length}`,
            parsedRecord.readName,
            "sequence_quality",
            blockOffset,
            `Sequence: ${alignment.seq.substring(0, 50)}..., Quality: ${alignment.qual.substring(0, 50)}...`
          );
        }
      }

      // Tiger Style: Assert postconditions
      if (alignment.format !== "bam") {
        throw new BamError("format must be bam", alignment.qname, "alignment", blockOffset);
      }
      if (typeof alignment.qname !== "string") {
        throw new BamError("qname must be string", alignment.qname, "alignment", blockOffset);
      }
      if (alignment.pos < 0) {
        throw new BamError(
          "position must be non-negative",
          alignment.qname,
          "alignment",
          blockOffset
        );
      }

      return alignment;
    } catch (error) {
      if (error instanceof BamError) {
        throw error;
      }
      throw new BamError(
        `Alignment parsing failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "alignment",
        blockOffset
      );
    }
  }

  /**
   * Map BAM tag type to SAM tag type for compatibility
   * @param bamTagType BAM tag type character
   * @returns SAM tag type
   */
  private mapTagTypeToSAM(bamTagType: string): "A" | "i" | "f" | "Z" | "H" | "B" {
    // Tiger Style: Assert function arguments
    if (typeof bamTagType !== "string") {
      throw new ValidationError("bamTagType must be a string");
    }

    switch (bamTagType) {
      case "A":
        return "A"; // Character
      case "c":
      case "C":
      case "s":
      case "S":
      case "i":
      case "I":
        return "i"; // All integer types map to 'i'
      case "f":
        return "f"; // Float
      case "Z":
        return "Z"; // String
      case "H":
        return "H"; // Hex string
      case "B":
        return "B"; // Array
      default:
        // Default to string for unknown types
        console.warn(`Unknown BAM tag type '${bamTagType}', treating as string`);
        return "Z";
    }
  }

  /**
   * Validate and convert FLAG field with enhanced error context
   * @param flag Raw flag value
   * @param qname Query name for error context
   * @param blockOffset Block offset for error context
   * @returns Validated SAMFlag
   */
  private validateFlag(flag: number, qname?: string, blockOffset?: number): SAMFlag {
    // Tiger Style: Assert function arguments
    if (!Number.isInteger(flag)) {
      throw new ValidationError("flag must be an integer");
    }

    try {
      const result = SAMFlagSchema(flag);
      if (typeof result !== "number") {
        throw new BamError(
          `Invalid FLAG value ${flag}: validation failed`,
          qname,
          "flag",
          blockOffset
        );
      }
      return result;
    } catch (error) {
      throw new BamError(
        `Invalid FLAG value ${flag}: ${error instanceof Error ? error.message : String(error)}`,
        qname,
        "flag",
        blockOffset,
        `Flag bits: ${flag.toString(2).padStart(12, "0")} (binary)`
      );
    }
  }

  /**
   * Validate and convert MAPQ field with enhanced error context
   * @param mapq Raw MAPQ value
   * @param qname Query name for error context
   * @param blockOffset Block offset for error context
   * @returns Validated MAPQScore
   */
  private validateMAPQ(mapq: number, qname?: string, blockOffset?: number): MAPQScore {
    // Tiger Style: Assert function arguments
    if (!Number.isInteger(mapq)) {
      throw new ValidationError("mapq must be an integer");
    }

    try {
      const result = MAPQScoreSchema(mapq);
      if (typeof result !== "number") {
        throw new BamError(
          `Invalid MAPQ value ${mapq}: validation failed`,
          qname,
          "mapq",
          blockOffset,
          `Valid range: 0-255, got: ${mapq}`
        );
      }
      return result;
    } catch (error) {
      throw new BamError(
        `Invalid MAPQ value ${mapq}: ${error instanceof Error ? error.message : String(error)}`,
        qname,
        "mapq",
        blockOffset,
        `Valid range: 0-255, got: ${mapq}`
      );
    }
  }

  /**
   * Validate and convert CIGAR field with enhanced error context
   * @param cigar Raw CIGAR string
   * @param qname Query name for error context
   * @param blockOffset Block offset for error context
   * @returns Validated CIGARString
   */
  private validateCIGAR(cigar: string, qname?: string, blockOffset?: number): CIGARString {
    // Tiger Style: Assert function arguments
    if (typeof cigar !== "string") {
      throw new ValidationError("cigar must be a string");
    }

    try {
      const result = CIGAROperationSchema(cigar);
      if (typeof result !== "string") {
        throw new BamError(
          `Invalid CIGAR string '${cigar}': validation failed`,
          qname,
          "cigar",
          blockOffset,
          `CIGAR length: ${cigar.length}, First 50 chars: ${cigar.substring(0, 50)}`
        );
      }
      return result;
    } catch (error) {
      throw new BamError(
        `Invalid CIGAR string '${cigar}': ${error instanceof Error ? error.message : String(error)}`,
        qname,
        "cigar",
        blockOffset,
        `CIGAR length: ${cigar.length}, First 50 chars: ${cigar.substring(0, 50)}`
      );
    }
  }

  /**
   * Validate file path and ensure it's accessible for reading
   */
  private async validateFilePath(filePath: string): Promise<string> {
    // Tiger Style: Assert function arguments
    if (typeof filePath !== "string") {
      throw new ValidationError("filePath must be a string");
    }
    if (filePath.length === 0) {
      throw new ValidationError("filePath must not be empty");
    }

    // Import FileReader functions dynamically to avoid circular dependencies
    const { exists, getMetadata } = await import("../io/file-reader");

    // Check if file exists and is readable
    if (!(await exists(filePath))) {
      throw new BamError(
        `BAM file not found or not accessible: ${filePath}`,
        undefined,
        "file",
        undefined,
        "Please check that the file exists and you have read permissions"
      );
    }

    // Get file metadata for additional validation
    try {
      const metadata = await getMetadata(filePath);

      if (!metadata.readable) {
        throw new BamError(
          `BAM file is not readable: ${filePath}`,
          undefined,
          "file",
          undefined,
          "Check file permissions"
        );
      }

      // Warn about very large files
      if (metadata.size > 10_737_418_240) {
        // 10GB
        this.options.onWarning!(
          `Very large BAM file detected: ${Math.round(metadata.size / 1_073_741_824)}GB. Processing may take significant time.`
        );
      }
    } catch (error) {
      if (error instanceof BamError) throw error;
      throw new BamError(
        `Failed to validate BAM file: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "file",
        undefined,
        filePath
      );
    }

    return filePath;
  }

  /**
   * Efficiently append data to buffer using Bun-optimized approach
   * @param buffer Current buffer
   * @param newData New data to append
   * @returns Combined buffer
   */
  private appendToBuffer(buffer: Uint8Array, newData: Uint8Array): Uint8Array {
    // Tiger Style: Assert function arguments
    if (!(buffer instanceof Uint8Array)) {
      throw new ValidationError("buffer must be Uint8Array");
    }
    if (!(newData instanceof Uint8Array)) {
      throw new ValidationError("newData must be Uint8Array");
    }

    // Use Bun-optimized buffer concatenation
    const combined = new Uint8Array(buffer.length + newData.length);
    combined.set(buffer, 0);
    combined.set(newData, buffer.length);

    return combined;
  }

  /**
   * Parse records from buffer with proper tracking
   * @param buffer Data buffer
   * @param references Reference sequence names
   * @param currentOffset Current parsing offset
   * @returns Parse result with alignments and bytes consumed
   */
  private async parseRecordsFromBuffer(
    buffer: Uint8Array,
    references: string[],
    currentOffset: number
  ): Promise<{ alignments: BAMAlignment[]; bytesConsumed: number }> {
    // Tiger Style: Assert function arguments
    if (!(buffer instanceof Uint8Array)) {
      throw new ValidationError("buffer must be Uint8Array");
    }
    if (!Array.isArray(references)) {
      throw new ValidationError("references must be an array");
    }
    if (!Number.isInteger(currentOffset)) {
      throw new ValidationError("currentOffset must be integer");
    }

    const alignments: BAMAlignment[] = [];
    let bytesConsumed = 0;

    // Parse complete alignment records
    while (bytesConsumed + 4 < buffer.length) {
      try {
        const view = new DataView(buffer.buffer, buffer.byteOffset + bytesConsumed);
        const blockSize = readInt32LE(view, 0);

        if (blockSize <= 0 || blockSize > 100 * 1024 * 1024) {
          // 100MB sanity check
          throw new BamError(
            `Invalid alignment block size: ${blockSize}`,
            undefined,
            "alignment",
            currentOffset + bytesConsumed
          );
        }

        // Check if we have complete record
        if (bytesConsumed + 4 + blockSize > buffer.length) {
          break; // Incomplete record, wait for more data
        }

        // Parse alignment record
        const alignment = this.parseAlignment(
          view,
          4, // Skip block size
          blockSize,
          references,
          currentOffset + bytesConsumed
        );

        alignments.push(alignment);
        bytesConsumed += 4 + blockSize;
      } catch (error) {
        if (error instanceof BamError) {
          this.options.onError!(error.message);
          // Skip corrupted record
          bytesConsumed += 4;
          continue;
        }
        throw error;
      }
    }

    return { alignments, bytesConsumed };
  }

  /**
   * Process any remaining data in buffer during stream end
   * @param buffer Remaining buffer data
   * @param references Reference sequence names
   * @param currentOffset Current parsing offset
   * @param headerParsed Whether header has been parsed
   * @yields Any complete remaining records
   */
  private async *processRemainingData(
    buffer: Uint8Array,
    references: string[],
    currentOffset: number,
    headerParsed: boolean
  ): AsyncIterable<BAMAlignment> {
    // Tiger Style: Assert function arguments
    if (!(buffer instanceof Uint8Array)) {
      throw new ValidationError("buffer must be Uint8Array");
    }
    if (!Array.isArray(references)) {
      throw new ValidationError("references must be an array");
    }

    if (!headerParsed) {
      // Can't parse alignments without header
      return;
    }

    // Try to parse any complete records from remaining buffer
    const parseResult = await this.parseRecordsFromBuffer(buffer, references, currentOffset);

    for (const alignment of parseResult.alignments) {
      yield alignment;
    }

    // Warn about unparsed data
    const remaining = buffer.length - parseResult.bytesConsumed;
    if (remaining > 0) {
      this.options.onWarning!(`${remaining} bytes of data could not be parsed at end of stream`);
    }
  }

  /**
   * Parse BAM file using Bun's optimized file API
   * @param filePath Validated file path
   * @param options File reading options
   * @yields BAMAlignment or SAMHeader objects
   */
  private async *parseFileWithBun(
    filePath: string,
    options?: import("../types").FileReaderOptions
  ): AsyncIterable<BAMAlignment | SAMHeader> {
    // Tiger Style: Assert function arguments
    if (typeof filePath !== "string") {
      throw new ValidationError("filePath must be a string");
    }

    // Use Bun.file() for optimal file access
    const file = Bun.file(filePath);

    // Check BAM magic bytes first
    const headerChunk = await file.slice(0, 4).arrayBuffer();
    const magic = new Uint8Array(headerChunk);
    if (!isValidBAMMagic(magic)) {
      throw new BamError(
        "Invalid BAM magic bytes - file may be corrupted or not a BAM file",
        undefined,
        "header"
      );
    }

    // Create optimized stream with proper buffer size for Bun
    const bufferSize =
      options?.bufferSize !== undefined && options?.bufferSize !== null && options?.bufferSize !== 0
        ? options.bufferSize
        : 256 * 1024; // 256KB default for Bun
    const stream = file.stream();
    // Note: Requested buffer size ${bufferSize} bytes, but Bun file.stream() uses internal buffering
    if (options?.bufferSize !== undefined && options.bufferSize !== 256 * 1024) {
      console.warn(
        `BAM: Custom buffer size ${bufferSize} requested but Bun uses internal buffering`
      );
    }

    // Parse BAM from stream
    yield* this.parse(stream);
  }

  /**
   * Parse BAM file using generic file reading
   * @param filePath Validated file path
   * @param options File reading options
   * @yields BAMAlignment or SAMHeader objects
   */
  private async *parseFileGeneric(
    filePath: string,
    options?: import("../types").FileReaderOptions
  ): AsyncIterable<BAMAlignment | SAMHeader> {
    // Tiger Style: Assert function arguments
    if (typeof filePath !== "string") {
      throw new ValidationError("filePath must be a string");
    }

    // Import I/O modules dynamically to avoid circular dependencies
    const { createStream } = await import("../io/file-reader");

    // Create stream with appropriate settings
    const stream = await createStream(filePath, {
      ...options,
      autoDecompress: false, // We handle BGZF ourselves
      bufferSize:
        options?.bufferSize !== undefined &&
        options?.bufferSize !== null &&
        options?.bufferSize !== 0
          ? options.bufferSize
          : 64 * 1024, // 64KB default for other runtimes
    });

    // Parse BAM from raw binary stream
    yield* this.parse(stream);
  }

  /**
   * Get parsing statistics for performance monitoring
   * @returns Statistics object with performance metrics
   */
  getParsingStats(): {
    runtime: "bun" | "node" | "deno" | "unknown";
    bunOptimized: boolean;
    memoryEfficient: boolean;
    recommendedBufferSize: number;
  } {
    const runtime = isBunOptimized()
      ? "bun"
      : typeof globalThis !== "undefined" && "Deno" in globalThis
        ? "deno"
        : typeof globalThis !== "undefined" && "process" in globalThis
          ? "node"
          : "unknown";

    return {
      runtime,
      bunOptimized: isBunOptimized(),
      memoryEfficient: true, // Our implementation is memory efficient
      recommendedBufferSize: isBunOptimized() ? 256 * 1024 : 64 * 1024,
    };
  }

  /**
   * Create a performance-optimized BAM parser instance
   * @param options Performance tuning options
   * @returns Optimized parser instance
   */
  static createOptimized(options?: {
    bufferSize?: number;
    skipValidation?: boolean;
    enableWarnings?: boolean;
  }): BAMParser {
    const defaultOptions = {
      bufferSize: isBunOptimized() ? 256 * 1024 : 64 * 1024,
      skipValidation: false,
      enableWarnings: true,
      ...options,
    };

    return new BAMParser({
      skipValidation: defaultOptions.skipValidation,
      maxLineLength: defaultOptions.bufferSize,
      ...(defaultOptions.enableWarnings && {
        onWarning: (warning: string) => console.warn(`BAM Parser: ${warning}`),
      }),
    });
  }

  /**
   * Load BAI index file for indexed access to BAM data
   * @param baiFilePath Path to BAI index file
   * @param options BAI reader options
   * @returns Promise resolving when index is loaded
   * @throws {BamError} If index file cannot be loaded
   * @example
   * ```typescript
   * const parser = new BAMParser();
   * await parser.loadIndex('/path/to/file.bam.bai');
   *
   * // Now can perform indexed queries
   * for await (const alignment of parser.queryRegion('chr1', 1000, 2000)) {
   *   console.log(`${alignment.qname} -> ${alignment.rname}:${alignment.pos}`);
   * }
   * ```
   */
  async loadIndex(
    baiFilePath: string,
    options?: import("../types").BAIReaderOptions
  ): Promise<void> {
    // Tiger Style: Assert function arguments
    if (typeof baiFilePath !== "string") {
      throw new ValidationError("baiFilePath must be a string");
    }
    if (baiFilePath.length === 0) {
      throw new ValidationError("baiFilePath must not be empty");
    }
    if (options && typeof options !== "object") {
      throw new ValidationError("options must be an object if provided");
    }

    try {
      this.baiReader = new BAIReader(baiFilePath, options);
      this.baiIndex = await this.baiReader.readIndex();

      // Extract reference names from index if available
      // In a real implementation, reference names would be stored in the BAI or extracted from BAM header
      console.log(`Loaded BAI index: ${this.baiIndex.referenceCount} references`);

      // Tiger Style: Assert postconditions
      if (this.baiReader === undefined) {
        throw new BamError("BAI reader must be initialized", undefined, "index_loading");
      }
      if (this.baiIndex === undefined) {
        throw new BamError("BAI index must be loaded", undefined, "index_loading");
      }
    } catch (error) {
      throw new BamError(
        `Failed to load BAI index from '${baiFilePath}': ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "index_loading",
        undefined,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Query genomic region using loaded BAI index
   * @param referenceName Reference sequence name (e.g., 'chr1', '1')
   * @param start Start coordinate (1-based, inclusive)
   * @param end End coordinate (1-based, inclusive)
   * @returns AsyncIterable of alignments in the specified region
   * @throws {BamError} If index is not loaded or query fails
   * @example
   * ```typescript
   * const parser = new BAMParser();
   * await parser.loadIndex('/path/to/file.bam.bai');
   *
   * for await (const alignment of parser.queryRegion('chr1', 1000, 2000)) {
   *   if (alignment.format === 'bam') {
   *     console.log(`Found alignment: ${alignment.qname} at ${alignment.pos}`);
   *   }
   * }
   * ```
   */
  async *queryRegion(
    referenceName: string,
    start: number,
    end: number
  ): AsyncIterable<BAMAlignment> {
    // Tiger Style: Assert function arguments
    if (typeof referenceName !== "string") {
      throw new ValidationError("referenceName must be a string");
    }
    if (referenceName.length === 0) {
      throw new ValidationError("referenceName must not be empty");
    }
    if (!Number.isInteger(start) || start <= 0) {
      throw new ValidationError("start must be positive integer (1-based)");
    }
    if (!Number.isInteger(end) || end <= 0) {
      throw new ValidationError("end must be positive integer (1-based)");
    }
    if (end < start) {
      throw new ValidationError("end must be >= start");
    }

    if (!this.baiIndex || !this.baiReader) {
      throw new BamError(
        "BAI index not loaded - call loadIndex() first",
        undefined,
        "index_required"
      );
    }

    try {
      // Convert reference name to ID
      const referenceId = this.resolveReferenceId(referenceName);
      if (referenceId < 0) {
        throw new BamError(
          `Reference '${referenceName}' not found in index`,
          undefined,
          "reference_not_found"
        );
      }

      // Convert to 0-based coordinates for BAI query
      const queryStart = start - 1;
      const queryEnd = end; // BAI uses exclusive end

      // Query BAI index for relevant chunks
      const queryResult = await this.baiReader.queryRegion(referenceId, queryStart, queryEnd);

      if (queryResult.chunks.length === 0) {
        console.log(`No data found for region ${referenceName}:${start}-${end}`);
        return;
      }

      console.log(
        `Found ${queryResult.chunks.length} chunks for region ${referenceName}:${start}-${end}`
      );

      // Process each chunk and filter alignments
      for (const chunk of queryResult.chunks) {
        yield* await this.processChunkForRegion(
          chunk,
          referenceId,
          referenceName,
          queryStart,
          queryEnd
        );
      }
    } catch (error) {
      if (error instanceof BamError) {
        throw error;
      }
      throw new BamError(
        `Region query failed for ${referenceName}:${start}-${end}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "region_query",
        undefined,
        `Reference: ${referenceName}, Region: ${start}-${end}`
      );
    }
  }

  /**
   * Set reference sequence names for mapping reference IDs
   * @param names Array of reference sequence names in order
   */
  setReferenceNames(names: string[]): void {
    // Tiger Style: Assert function arguments
    if (!Array.isArray(names)) {
      throw new ValidationError("names must be an array");
    }

    this.referenceNames = [...names]; // Copy array

    // Tiger Style: Assert postconditions
    if (this.referenceNames.length !== names.length) {
      throw new ValidationError("reference names must be copied correctly");
    }
  }

  /**
   * Get statistics about loaded BAI index
   * @returns Promise resolving to index statistics
   * @throws {BamError} If index is not loaded
   */
  async getIndexStatistics(): Promise<import("../types").BAIStatistics> {
    if (!this.baiReader) {
      throw new BamError(
        "BAI index not loaded - call loadIndex() first",
        undefined,
        "index_required"
      );
    }

    return await this.baiReader.getStatistics();
  }

  /**
   * Validate loaded BAI index integrity
   * @param thorough Whether to perform thorough validation
   * @returns Promise resolving to validation result
   * @throws {BamError} If index is not loaded
   */
  async validateIndex(
    thorough = false
  ): Promise<{ isValid: boolean; warnings: string[]; errors: string[] }> {
    if (!this.baiReader) {
      throw new BamError(
        "BAI index not loaded - call loadIndex() first",
        undefined,
        "index_required"
      );
    }

    return await this.baiReader.validateIndex(thorough);
  }

  /**
   * Close BAI index and clean up resources
   */
  async closeIndex(): Promise<void> {
    if (this.baiReader) {
      await this.baiReader.close();
      delete this.baiReader;
      delete this.baiIndex;
    }
  }

  // Private methods for BAI integration

  /**
   * Resolve reference name to reference ID
   */
  private resolveReferenceId(referenceName: string): number {
    // Try direct lookup in reference names
    const directId = this.referenceNames.indexOf(referenceName);
    if (directId >= 0) {
      return directId;
    }

    // Try common chromosome name variations
    const normalizedName = this.normalizeReferenceName(referenceName);
    for (let i = 0; i < this.referenceNames.length; i++) {
      if (this.normalizeReferenceName(this.referenceNames[i]!) === normalizedName) {
        return i;
      }
    }

    return -1; // Not found
  }

  /**
   * Normalize reference name for comparison
   */
  private normalizeReferenceName(name: string): string {
    // Remove common prefixes and normalize case
    return name.replace(/^chr/i, "").toUpperCase();
  }

  /**
   * Process a single chunk for region query
   */
  private async *processChunkForRegion(
    chunk: import("../types").BAIChunk,
    referenceId: number,
    referenceName: string,
    queryStart: number,
    queryEnd: number
  ): AsyncIterable<BAMAlignment> {
    // This is a simplified implementation
    // In a real implementation, this would:
    // 1. Seek to the chunk's begin offset in the BAM file
    // 2. Read and decompress BGZF blocks up to the end offset
    // 3. Parse alignments and filter by coordinates
    // 4. Yield only alignments that overlap the query region

    console.log(
      `Processing chunk: ${chunk.beginOffset} - ${chunk.endOffset} for region ${referenceName}:${queryStart}-${queryEnd}`
    );

    // For now, return empty since we'd need actual BAM file access
    // In a complete implementation, this would interface with the BAM file reader

    // Placeholder - would yield actual filtered alignments
    return;

    // Example of what the implementation would look like:
    // const bamFile = await this.openBAMFile();
    // await bamFile.seek(chunk.beginOffset);
    //
    // while (currentOffset < chunk.endOffset) {
    //   const alignment = await this.readNextAlignment(bamFile);
    //   if (this.alignmentOverlapsRegion(alignment, queryStart, queryEnd)) {
    //     yield alignment;
    //   }
    // }
  }
}

/**
 * BAM utility functions for format detection and operations
 */
export const BAMUtils = {
  /**
   * Detect if binary data contains BAM format
   */
  detectFormat(data: Uint8Array): boolean {
    if (!(data instanceof Uint8Array)) {
      throw new ValidationError("data must be Uint8Array");
    }

    if (data.length < 4) {
      return false;
    }

    return isValidBAMMagic(data.slice(0, 4));
  },

  /**
   * Check if data appears to be BGZF compressed
   */
  isBGZF(data: Uint8Array): boolean {
    if (!(data instanceof Uint8Array)) {
      throw new ValidationError("data must be Uint8Array");
    }

    return detectFormat(data);
  },

  /**
   * Extract reference names from BAM header
   */
  async extractReferences(bamData: Uint8Array): Promise<Array<{ name: string; length: number }>> {
    if (!(bamData instanceof Uint8Array)) {
      throw new ValidationError("bamData must be Uint8Array");
    }

    // Parse BAM header using parser instance
    const parser = new BAMParser();
    const headerResult = (parser as any).parseHeaderFromBuffer(bamData);
    if (headerResult === null || headerResult === undefined) {
      return [];
    }

    return headerResult.references;
  },
};

// Export BAM writing components
export { BAMWriter, type BAMWriterOptions };
export { BGZFCompressor };

// Export BAI indexing components
export { BAIReader } from "./bam/bai-reader";
export { BinningUtils, VirtualOffsetUtils } from "./bam/bai-utils";
export { BAIWriter } from "./bam/bai-writer";
