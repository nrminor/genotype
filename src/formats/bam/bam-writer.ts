/**
 * BAM (Binary Alignment/Map) format writer with BGZF compression
 *
 * Provides comprehensive BAM file writing capabilities with:
 * - BGZF compression for random access
 * - Binary encoding of alignment records
 * - 4-bit packed sequence encoding
 * - Binary CIGAR operations
 * - Streaming architecture for memory efficiency with large datasets
 * - Type-safe operations with comprehensive error handling
 *
 * BAM files are the binary equivalent of SAM files, providing:
 * - ~3-5x smaller file size than SAM
 * - Faster writing due to binary format
 * - Random access capability with BAI index files
 * - Native support for BGZF compression
 */

import * as fs from "node:fs";
import { BamError, CompressionError } from "../../errors";
import type { SAMAlignment, SAMHeader } from "../../types";
import { BGZFCompressor } from "./bgzf-compressor";
import {
  calculateAlignmentSize,
  createOptimizedSerializer,
  packCIGAR,
  packQualityScores,
  packSequence,
  packTags,
  writeCString,
  writeInt32LE,
  writeUInt32LE,
} from "./binary-serializer";

// Constants for BAM writer configuration
const DEFAULT_BUFFER_SIZE = 256 * 1024; // 256KB
const DEFAULT_MAX_ALIGNMENT_SIZE = 1024 * 1024; // 1MB

/**
 * Options for configuring BAM writer behavior
 */
export interface BAMWriterOptions {
  /** BGZF compression level (0-9, default: 6) */
  compressionLevel?: number;
  /** BGZF block size in bytes (default: 65536) */
  blockSize?: number;
  /** Buffer size for streaming operations (default: 256KB) */
  bufferSize?: number;
  /** Skip validation for better performance (default: false) */
  skipValidation?: boolean;
  /** Enable warnings for data quality issues (default: true) */
  enableWarnings?: boolean;
  /** Maximum alignment record size in bytes (default: 1MB) */
  maxAlignmentSize?: number;
}

/**
 * BAM writer with BGZF compression and binary serialization
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
 * const writer = new BAMWriter();
 * const bamData = await writer.writeString(header, alignments);
 * ```
 *
 * @example File writing
 * ```typescript
 * const writer = new BAMWriter({ compressionLevel: 9 });
 * await writer.writeFile('output.bam', header, alignments);
 * ```
 *
 * @example Streaming
 * ```typescript
 * const writer = new BAMWriter();
 * const stream = writer.createWriteStream();
 * await writer.writeHeader(stream, header);
 * for (const alignment of alignments) {
 *   await writer.writeAlignment(stream, alignment, references);
 * }
 * await writer.finalize(stream);
 * ```
 */
export class BAMWriter {
  private readonly options: Required<BAMWriterOptions>;
  private readonly compressor: BGZFCompressor;
  private readonly serializer: ReturnType<typeof createOptimizedSerializer>;

  /**
   * Create a new BAM writer with specified options
   * @param options Writer configuration options
   */
  constructor(options: BAMWriterOptions = {}) {
    // Tiger Style: Assert constructor arguments
    console.assert(typeof options === "object", "options must be an object");

    this.options = {
      compressionLevel: 6,
      blockSize: 65536, // 64KB
      bufferSize: DEFAULT_BUFFER_SIZE,
      skipValidation: false,
      enableWarnings: true,
      maxAlignmentSize: DEFAULT_MAX_ALIGNMENT_SIZE,
      ...options,
    };

    // Validate configuration
    if (this.options.compressionLevel < 0 || this.options.compressionLevel > 9) {
      throw new BamError(
        `Invalid compression level: ${this.options.compressionLevel} (must be 0-9)`,
        undefined,
        "config"
      );
    }
    console.assert(
      this.options.blockSize >= 1024 && this.options.blockSize <= 65536,
      "block size must be between 1KB and 64KB"
    );
    console.assert(this.options.bufferSize >= 1024, "buffer size must be at least 1KB");

    // Initialize compressor and serializer
    this.compressor = new BGZFCompressor({
      compressionLevel: this.options.compressionLevel,
      blockSize: this.options.blockSize,
    });

    this.serializer = createOptimizedSerializer({
      maxAlignmentSize: this.options.maxAlignmentSize,
      bufferPoolSize: 10,
    });
  }

  /**
   * Write complete BAM data to memory as binary string
   * @param header SAM header information
   * @param alignments Iterable of SAM alignment records
   * @returns Promise resolving to BAM binary data
   * @throws {BamError} If writing fails
   */
  async writeString(
    header: SAMHeader | SAMHeader[],
    alignments: Iterable<SAMAlignment> | AsyncIterable<SAMAlignment>
  ): Promise<Uint8Array> {
    // Tiger Style: Assert function arguments
    console.assert(header !== undefined, "header must be provided");
    console.assert(alignments !== undefined, "alignments must be provided");

    try {
      // Collect all data chunks
      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      // Create a mock writer that collects chunks
      const mockWriter = {
        write: async (data: Uint8Array): Promise<void> => {
          chunks.push(data);
          totalSize += data.length;
        },
      };

      // Write BAM data using stream interface
      await this.writeToWriter(mockWriter, header, alignments);

      // Combine all chunks
      const result = new Uint8Array(totalSize);
      let offset = 0;

      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      // Tiger Style: Assert postconditions
      console.assert(result.length === totalSize, "result size must match calculated total");
      console.assert(result.length > 0, "result must not be empty");

      return result;
    } catch (error) {
      if (error instanceof BamError || error instanceof CompressionError) {
        throw error;
      }

      throw new BamError(
        `Failed to write BAM to memory: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "writing",
        undefined,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Write BAM data to file using Bun's optimized file I/O
   * @param filePath Path to output BAM file
   * @param header SAM header information
   * @param alignments Iterable of SAM alignment records
   * @throws {BamError} If file writing fails
   */
  async writeFile(
    filePath: string,
    header: SAMHeader | SAMHeader[],
    alignments: Iterable<SAMAlignment> | AsyncIterable<SAMAlignment>
  ): Promise<void> {
    // Tiger Style: Assert function arguments
    console.assert(typeof filePath === "string", "filePath must be a string");
    console.assert(filePath.length > 0, "filePath must not be empty");
    console.assert(header !== undefined, "header must be provided");
    console.assert(alignments !== undefined, "alignments must be provided");

    try {
      // Use Bun.file() for optimal performance when available
      if (this.isBunAvailable()) {
        await this.writeFileWithBun(filePath, header, alignments);
      } else {
        await this.writeFileGeneric(filePath, header, alignments);
      }
    } catch (error) {
      if (error instanceof BamError || error instanceof CompressionError) {
        throw error;
      }

      throw new BamError(
        `Failed to write BAM file '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        "file",
        undefined,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Create a writable stream for streaming BAM output
   * @returns Writable stream for BAM data
   */
  createWriteStream(): WritableStream<Uint8Array> {
    const bgzfStream = this.compressor.createStream();

    return new WritableStream({
      start: async (controller): Promise<void> => {
        // Stream initialization - controller available for error signaling if needed
        try {
          // Validate BGZF stream is ready
          if (bgzfStream === null || bgzfStream === undefined) {
            controller.error(
              new BamError("BGZF compression stream failed to initialize", undefined, "stream")
            );
          }
        } catch (error) {
          controller.error(
            new BamError(
              `Stream initialization failed: ${error instanceof Error ? error.message : String(error)}`,
              undefined,
              "stream"
            )
          );
        }
      },

      write: async (chunk, controller): Promise<void> => {
        try {
          // Tiger Style: Assert chunk validity
          console.assert(chunk instanceof Uint8Array, "chunk must be Uint8Array");

          // Transform through BGZF compression
          const writer = bgzfStream.writable.getWriter();
          await writer.write(chunk);
          writer.releaseLock();
        } catch (error) {
          const bamError = new BamError(
            `Stream write failed: ${error instanceof Error ? error.message : String(error)}`,
            undefined,
            "stream"
          );
          controller.error(bamError);
          throw bamError;
        }
      },

      close: async (): Promise<void> => {
        try {
          // Close BGZF stream
          const writer = bgzfStream.writable.getWriter();
          await writer.close();
        } catch (error) {
          throw new BamError(
            `Stream close failed: ${error instanceof Error ? error.message : String(error)}`,
            undefined,
            "stream"
          );
        }
      },

      abort: async (reason): Promise<void> => {
        try {
          const writer = bgzfStream.writable.getWriter();
          await writer.abort(reason);
        } catch (error) {
          // Log but don't throw during abort
          console.warn("BAM stream abort error:", error);
        }
      },
    });
  }

  /**
   * Serialize BAM header to binary format
   * @param header SAM header information
   * @returns Serialized header binary data
   */
  async serializeHeader(header: SAMHeader | SAMHeader[]): Promise<Uint8Array> {
    // Tiger Style: Assert function arguments
    console.assert(header !== undefined, "header must be provided");

    const headers = Array.isArray(header) ? header : [header];

    // Calculate header size
    let headerTextSize = 0;
    let samHeaderText = "";

    // Build SAM header text
    for (const h of headers) {
      let line = `@${h.type}`;

      for (const [key, value] of Object.entries(h.fields)) {
        line += `\t${key}:${value}`;
      }

      samHeaderText += `${line}\n`;
    }

    headerTextSize = new TextEncoder().encode(samHeaderText).length;

    // Extract reference sequences from @SQ headers
    const references: Array<{ name: string; length: number }> = [];

    // Parse SAM header for @SQ lines
    const lines = samHeaderText.split("\n");
    for (const line of lines) {
      if (line.startsWith("@SQ")) {
        const fields = line.split("\t");
        let name = "";
        let length = 0;

        for (const field of fields) {
          if (field.startsWith("SN:")) {
            name = field.substring(3);
          } else if (field.startsWith("LN:")) {
            length = parseInt(field.substring(3), 10);
          }
        }

        if (name && length > 0) {
          references.push({ name, length });
        }
      }
    }

    // Calculate total header size
    let totalSize = 4; // BAM magic
    totalSize += 4; // SAM header text length
    totalSize += headerTextSize; // SAM header text
    totalSize += 4; // Number of references

    for (const ref of references) {
      totalSize += 4; // Name length
      totalSize += new TextEncoder().encode(ref.name).length + 1; // Name + null terminator
      totalSize += 4; // Reference length
    }

    // Create header buffer
    const buffer = new Uint8Array(totalSize);
    const view = new DataView(buffer.buffer);
    let offset = 0;

    // Write BAM magic bytes "BAM\1"
    buffer[offset++] = 0x42; // 'B'
    buffer[offset++] = 0x41; // 'A'
    buffer[offset++] = 0x4d; // 'M'
    buffer[offset++] = 0x01; // version

    // Write SAM header text length
    writeInt32LE(view, offset, headerTextSize);
    offset += 4;

    // Write SAM header text
    if (headerTextSize > 0) {
      const headerBytes = new TextEncoder().encode(samHeaderText);
      buffer.set(headerBytes, offset);
      offset += headerBytes.length;
    }

    // Write number of reference sequences
    writeInt32LE(view, offset, references.length);
    offset += 4;

    // Write reference sequence information
    for (const ref of references) {
      const nameBytes = new TextEncoder().encode(ref.name);

      // Name length (including null terminator)
      writeInt32LE(view, offset, nameBytes.length + 1);
      offset += 4;

      // Reference name
      buffer.set(nameBytes, offset);
      offset += nameBytes.length;
      buffer[offset++] = 0; // null terminator

      // Reference length
      writeInt32LE(view, offset, ref.length);
      offset += 4;
    }

    // Tiger Style: Assert postconditions
    console.assert(offset === totalSize, "must write exactly the calculated size");
    console.assert(buffer.length === totalSize, "buffer size must match calculated size");

    return buffer;
  }

  /**
   * Serialize a single alignment record to binary format
   * @param alignment SAM alignment record
   * @param references Reference sequence names
   * @returns Serialized alignment binary data
   */
  async serializeAlignment(alignment: SAMAlignment, references: string[]): Promise<Uint8Array> {
    // Tiger Style: Assert function arguments
    console.assert(typeof alignment === "object", "alignment must be an object");
    console.assert(Array.isArray(references), "references must be an array");

    if (!this.options.skipValidation) {
      this.validateAlignment(alignment);
    }

    try {
      // Calculate alignment size
      const totalSize = calculateAlignmentSize(alignment, references);
      const buffer = this.serializer.getBuffer(totalSize + 4); // +4 for block size prefix
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

      let offset = 0;

      // Write block size (total record size - 4)
      writeInt32LE(view, offset, totalSize);
      offset += 4;

      // Write refID
      const refID = this.getRefID(alignment.rname, references);
      writeInt32LE(view, offset, refID);
      offset += 4;

      // Write pos (convert from 1-based to 0-based)
      writeInt32LE(view, offset, alignment.pos - 1);
      offset += 4;

      // Write bin_mq_nl (bin<<16 | MAPQ<<8 | l_read_name)
      const readNameLength = alignment.qname.length + 1; // +1 for null terminator
      const bin = this.calculateBin(alignment.pos - 1, this.calculateAlignmentEnd(alignment)); // Use 0-based for bin calculation
      const binMqNl = (bin << 16) | (alignment.mapq << 8) | readNameLength;
      writeUInt32LE(view, offset, binMqNl);
      offset += 4;

      // Count CIGAR operations
      const numCigarOps = alignment.cigar === "*" ? 0 : this.countCigarOperations(alignment.cigar);

      // Write flag_nc (FLAG<<16 | n_cigar_op)
      const flagNc = (alignment.flag << 16) | numCigarOps;
      writeUInt32LE(view, offset, flagNc);
      offset += 4;

      // Write l_seq
      const seqLength = alignment.seq === "*" ? 0 : alignment.seq.length;
      writeInt32LE(view, offset, seqLength);
      offset += 4;

      // Write next_refID
      const nextRefID = this.getRefID(
        alignment.rnext === "=" ? alignment.rname : alignment.rnext,
        references
      );
      writeInt32LE(view, offset, nextRefID);
      offset += 4;

      // Write next_pos (convert from 1-based to 0-based)
      writeInt32LE(view, offset, alignment.pnext - 1);
      offset += 4;

      // Write tlen
      writeInt32LE(view, offset, alignment.tlen);
      offset += 4;

      // Write read_name (null-terminated)
      offset += writeCString(view, offset, alignment.qname, 256);

      // Write CIGAR
      if (alignment.cigar !== "*") {
        offset += packCIGAR(alignment.cigar, buffer, offset);
      }

      // Write sequence (4-bit packed)
      if (alignment.seq !== "*") {
        offset += packSequence(alignment.seq, buffer, offset);
      }

      // Write quality scores
      if (alignment.qual !== "*") {
        offset += packQualityScores(alignment.qual, buffer, offset);
      }

      // Write optional tags
      if (alignment.tags) {
        offset += packTags(alignment.tags, buffer, offset);
      }

      // Return exact-sized buffer
      const result = buffer.slice(0, offset);

      // Tiger Style: Assert postconditions
      console.assert(result.length === offset, "result size must match bytes written");
      console.assert(
        result.length >= 36,
        "alignment must be at least 36 bytes (32 fixed + 4 block size)"
      );

      return result;
    } catch (error) {
      if (error instanceof BamError) {
        throw error;
      }

      throw new BamError(
        `Alignment serialization failed for '${alignment.qname}': ${error instanceof Error ? error.message : String(error)}`,
        alignment.qname,
        "alignment",
        undefined,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Validate alignment record for common issues
   * @param alignment Alignment to validate
   */
  private validateAlignment(alignment: SAMAlignment): void {
    // Tiger Style: Assert function arguments
    console.assert(typeof alignment === "object", "alignment must be an object");

    // Validate required fields
    if (!alignment.qname || alignment.qname.length === 0) {
      throw new BamError("Query name (QNAME) cannot be empty", alignment.qname, "qname");
    }

    if (alignment.qname.length > 254) {
      throw new BamError(
        `Query name too long: ${alignment.qname.length} characters (max 254)`,
        alignment.qname,
        "qname"
      );
    }

    if (alignment.pos < 0) {
      throw new BamError(
        `Invalid position: ${alignment.pos} (must be positive)`,
        alignment.qname,
        "pos"
      );
    }

    if (alignment.pnext < 0) {
      throw new BamError(
        `Invalid mate position: ${alignment.pnext} (must be positive)`,
        alignment.qname,
        "pnext"
      );
    }

    // Validate sequence and quality consistency
    if (alignment.seq !== "*" && alignment.qual !== "*") {
      if (alignment.seq.length !== alignment.qual.length) {
        throw new BamError(
          `Sequence/quality length mismatch: seq=${alignment.seq.length}, qual=${alignment.qual.length}`,
          alignment.qname,
          "sequence_quality"
        );
      }
    }

    // Validate CIGAR
    if (alignment.cigar !== "*" && alignment.seq !== "*") {
      try {
        const queryLength = this.calculateQueryLengthFromCIGAR(alignment.cigar);
        if (queryLength !== alignment.seq.length) {
          if (this.options.enableWarnings) {
            console.warn(
              `CIGAR query length (${queryLength}) doesn't match sequence length (${alignment.seq.length}) for ${alignment.qname}`
            );
          }
        }
      } catch (error) {
        throw new BamError(
          `Invalid CIGAR string '${alignment.cigar}': ${error instanceof Error ? error.message : String(error)}`,
          alignment.qname,
          "cigar"
        );
      }
    }
  }

  /**
   * Get reference ID from reference name
   * @param refName Reference name
   * @param references Array of reference names
   * @returns Reference ID (-1 if not found)
   */
  private getRefID(refName: string, references: string[]): number {
    // Tiger Style: Assert function arguments
    console.assert(typeof refName === "string", "refName must be a string");
    console.assert(Array.isArray(references), "references must be an array");

    if (refName === "*") {
      return -1; // Unmapped
    }

    const index = references.indexOf(refName);
    if (index === -1 && this.options.enableWarnings) {
      console.warn(`Reference '${refName}' not found in header, using -1`);
    }

    return index;
  }

  /**
   * Calculate alignment end position from CIGAR
   * @param alignment Alignment record
   * @returns End position (1-based)
   */
  private calculateAlignmentEnd(alignment: SAMAlignment): number {
    // Tiger Style: Assert function arguments
    console.assert(typeof alignment === "object", "alignment must be an object");

    if (alignment.cigar === "*" || alignment.pos <= 0) {
      return alignment.pos;
    }

    let refLength = 0;
    const cigarRegex = /(\d+)([MIDNSHP=X])/g;
    let match;

    while ((match = cigarRegex.exec(alignment.cigar)) !== null) {
      const length = parseInt(match[1]!, 10);
      const operation = match[2]!;

      // Operations that consume reference: M, D, N, =, X
      if ("MDN=X".includes(operation)) {
        refLength += length;
      }
    }

    return alignment.pos + refLength - 1; // Convert to 1-based end position
  }

  /**
   * Calculate BAM bin index for efficient random access
   * @param start 0-based start position
   * @param end 0-based end position
   * @returns BAM bin index
   */
  private calculateBin(start: number, end: number): number {
    // Tiger Style: Assert function arguments
    console.assert(Number.isInteger(start) && start >= 0, "start must be non-negative integer");
    console.assert(Number.isInteger(end) && end >= start, "end must be >= start");

    // BAM binning scheme for efficient random access
    if (start === end) {
      return 4681; // Special case for zero-length intervals
    }

    end -= 1; // Make end inclusive for binning calculation

    if (start >> 14 === end >> 14) return ((1 << 15) - 1) / 7 + (start >> 14);
    if (start >> 17 === end >> 17) return ((1 << 12) - 1) / 7 + (start >> 17);
    if (start >> 20 === end >> 20) return ((1 << 9) - 1) / 7 + (start >> 20);
    if (start >> 23 === end >> 23) return ((1 << 6) - 1) / 7 + (start >> 23);
    if (start >> 26 === end >> 26) return ((1 << 3) - 1) / 7 + (start >> 26);

    return 0; // Root bin
  }

  /**
   * Count CIGAR operations in a CIGAR string
   * @param cigar CIGAR string
   * @returns Number of CIGAR operations
   */
  private countCigarOperations(cigar: string): number {
    // Tiger Style: Assert function arguments
    console.assert(typeof cigar === "string", "cigar must be a string");

    if (cigar === "*") {
      return 0;
    }

    const matches = cigar.match(/\d+[MIDNSHP=X]/g);
    return matches ? matches.length : 0;
  }

  /**
   * Calculate query sequence length consumed by CIGAR
   * @param cigar CIGAR string
   * @returns Query length consumed by CIGAR
   */
  private calculateQueryLengthFromCIGAR(cigar: string): number {
    // Tiger Style: Assert function arguments
    console.assert(typeof cigar === "string", "cigar must be a string");

    if (cigar === "*") {
      return 0;
    }

    let queryLength = 0;
    const cigarRegex = /(\d+)([MIDNSHP=X])/g;
    let match;

    while ((match = cigarRegex.exec(cigar)) !== null) {
      const length = parseInt(match[1]!, 10);
      const operation = match[2]!;

      // Operations that consume query sequence: M, I, S, =, X
      if ("MIS=X".includes(operation)) {
        queryLength += length;
      }
    }

    return queryLength;
  }

  /**
   * Write BAM data to a generic writer interface
   * @param writer Writer object with write method
   * @param header SAM header information
   * @param alignments Alignment records
   */
  private async writeToWriter(
    writer: { write(data: Uint8Array): Promise<void> },
    header: SAMHeader | SAMHeader[],
    alignments: Iterable<SAMAlignment> | AsyncIterable<SAMAlignment>
  ): Promise<void> {
    // Tiger Style: Assert function arguments
    console.assert(
      writer !== undefined && writer !== null && typeof writer === "object",
      "writer must be an object"
    );
    console.assert("write" in writer, "writer must have write method");

    // Extract reference sequences from header
    const references = this.extractReferences(header);

    // Write and compress header
    const headerData = await this.serializeHeader(header);
    await this.compressor.writeBlock(writer, headerData);

    // Write alignments
    const isAsync = Symbol.asyncIterator in new Object(alignments);

    if (isAsync) {
      for await (const alignment of alignments as AsyncIterable<SAMAlignment>) {
        const alignmentData = await this.serializeAlignment(alignment, references);
        await this.compressor.writeBlock(writer, alignmentData);
      }
    } else {
      for (const alignment of alignments as Iterable<SAMAlignment>) {
        const alignmentData = await this.serializeAlignment(alignment, references);
        await this.compressor.writeBlock(writer, alignmentData);
      }
    }

    // Write EOF block
    const eofBlock = this.compressor.createEOFBlock();
    await writer.write(eofBlock);
  }

  /**
   * Extract reference sequence names from header
   * @param header SAM header
   * @returns Array of reference sequence names
   */
  private extractReferences(header: SAMHeader | SAMHeader[]): string[] {
    // Tiger Style: Assert function arguments
    console.assert(header !== undefined, "header must be provided");

    const headers = Array.isArray(header) ? header : [header];
    const references: string[] = [];

    for (const h of headers) {
      if (
        h.type === "SQ" &&
        h.fields.SN !== undefined &&
        h.fields.SN !== null &&
        h.fields.SN !== ""
      ) {
        references.push(h.fields.SN);
      }
    }

    return references;
  }

  /**
   * Write BAM file using Bun's optimized file I/O
   * @param filePath Output file path
   * @param header SAM header
   * @param alignments Alignment records
   */
  private async writeFileWithBun(
    filePath: string,
    header: SAMHeader | SAMHeader[],
    alignments: Iterable<SAMAlignment> | AsyncIterable<SAMAlignment>
  ): Promise<void> {
    // Tiger Style: Assert function arguments and availability
    console.assert(typeof filePath === "string", "filePath must be a string");
    console.assert(this.isBunAvailable(), "Bun must be available");

    // Create file writer using Bun.file()
    const file = Bun.file(filePath);

    // Collect all data first (for atomic write)
    const bamData = await this.writeString(header, alignments);

    // Write to file atomically
    await Bun.write(file, bamData);
  }

  /**
   * Write BAM file using generic file operations
   * @param filePath Output file path
   * @param header SAM header
   * @param alignments Alignment records
   */
  private async writeFileGeneric(
    filePath: string,
    header: SAMHeader | SAMHeader[],
    alignments: Iterable<SAMAlignment> | AsyncIterable<SAMAlignment>
  ): Promise<void> {
    // Tiger Style: Assert function arguments
    console.assert(typeof filePath === "string", "filePath must be a string");

    // Implement streaming file writer for Node.js runtime
    if (typeof process !== "undefined" && process.versions?.node) {
      // Node.js implementation
      const stream = fs.createWriteStream(filePath);

      // Write header first and extract references
      const headerData = await this.serializeHeader(header);
      const references = this.extractReferencesFromHeader(header);
      await new Promise((resolve, reject) => {
        stream.write(headerData, (err) => (err ? reject(err) : resolve(undefined)));
      });

      // Write alignments one by one for streaming
      for await (const alignment of alignments) {
        const alignmentData = await this.serializeAlignment(alignment, references);
        await new Promise((resolve, reject) => {
          stream.write(alignmentData, (err) => (err ? reject(err) : resolve(undefined)));
        });
      }

      await new Promise((resolve) => stream.end(resolve));
      return;
    }

    // For other runtimes, throw informative error
    throw new BamError(
      "File writing is currently only supported in Bun and Node.js runtimes",
      undefined,
      "file",
      undefined,
      "Use writeString() to get BAM data as Uint8Array, then write manually"
    );
  }

  /**
   * Extract reference names from header for alignment serialization
   * @param header SAM header(s) to extract references from
   * @returns Array of reference names
   */
  private extractReferencesFromHeader(header: SAMHeader | SAMHeader[]): string[] {
    const headers = Array.isArray(header) ? header : [header];
    const references: string[] = [];

    for (const h of headers) {
      if (
        h.type === "SQ" &&
        h.fields.SN !== undefined &&
        h.fields.SN !== null &&
        h.fields.SN !== ""
      ) {
        references.push(h.fields.SN);
      }
    }

    return references;
  }

  /**
   * Check if Bun's native APIs are available
   * @returns True if Bun APIs are available
   */
  private isBunAvailable(): boolean {
    return (
      typeof globalThis !== "undefined" &&
      "Bun" in globalThis &&
      globalThis.Bun !== undefined &&
      typeof globalThis.Bun.write === "function" &&
      typeof globalThis.Bun.file === "function"
    );
  }

  /**
   * Get writer performance statistics and configuration
   * @returns Writer statistics and capabilities
   */
  getWriterInfo(): {
    options: Required<BAMWriterOptions>;
    compressionInfo: ReturnType<BGZFCompressor["getCompressionInfo"]>;
    serializerStats: {
      maxAlignmentSize: number;
      bufferPoolSize: number;
      bufferUtilization: number;
      bunOptimized: boolean;
    };
    bunOptimized: boolean;
  } {
    return {
      options: this.options,
      compressionInfo: this.compressor.getCompressionInfo(),
      serializerStats: this.serializer.getStats(),
      bunOptimized: this.isBunAvailable(),
    };
  }

  /**
   * Create an optimized BAM writer for high-performance scenarios
   * @param options Performance tuning options
   * @returns Optimized writer instance
   */
  static createOptimized(
    options: BAMWriterOptions & {
      prioritizeSpeed?: boolean;
      prioritizeCompression?: boolean;
    } = {}
  ): BAMWriter {
    const { prioritizeSpeed = false, prioritizeCompression = false, ...writerOptions } = options;

    // Configure for speed vs compression tradeoff
    const optimizedOptions: BAMWriterOptions = {
      compressionLevel: prioritizeSpeed ? 1 : prioritizeCompression ? 9 : 6,
      blockSize: 65536,
      bufferSize: prioritizeSpeed ? 512 * 1024 : 256 * 1024, // Larger buffer for speed
      skipValidation: prioritizeSpeed,
      enableWarnings: !prioritizeSpeed,
      maxAlignmentSize: prioritizeSpeed ? 2 * 1024 * 1024 : 1024 * 1024, // 2MB for speed
      ...writerOptions,
    };

    return new BAMWriter(optimizedOptions);
  }
}
