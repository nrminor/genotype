/**
 * BGZF (Block GZIP Format) compressor for BAM files
 *
 * BGZF is a variant of GZIP that enables random access to compressed data
 * by organizing data into independent, seekable blocks. Each block is a
 * complete gzip stream with specific header/footer structure.
 *
 * BGZF Block Structure for Writing:
 * - Standard gzip header with extra fields
 * - BC field (2 bytes): Block size minus 1
 * - Compressed data
 * - CRC32 (4 bytes): Uncompressed data checksum
 * - ISIZE (4 bytes): Uncompressed data size
 */

import { CompressionError } from '../../errors';

/**
 * BGZF compressor for creating BAM files
 *
 * Implements streaming compression with block-level compression for efficient
 * writing of large BAM files. Follows Tiger Style with comprehensive
 * validation and error handling.
 */
export class BGZFCompressor {
  private readonly compressionLevel: number;
  private readonly blockSize: number;

  /**
   * Create a new BGZF compressor
   * @param options Compression configuration
   */
  constructor(
    options: {
      compressionLevel?: number;
      blockSize?: number;
    } = {}
  ) {
    // Tiger Style: Assert constructor arguments
    console.assert(typeof options === 'object', 'options must be an object');

    this.compressionLevel = options.compressionLevel ?? 6; // Default to balanced compression
    this.blockSize = options.blockSize ?? 65536; // 64KB default uncompressed block size

    // Tiger Style: Validate configuration
    console.assert(
      this.compressionLevel >= 0 && this.compressionLevel <= 9,
      'compression level must be between 0 and 9'
    );
    console.assert(
      this.blockSize >= 1024 && this.blockSize <= 65536,
      'block size must be between 1KB and 64KB'
    );
  }

  /**
   * Compress a single block of data into BGZF format
   * @param data Uncompressed data to compress
   * @returns Promise resolving to compressed BGZF block
   * @throws {CompressionError} If compression fails
   */
  async compressBlock(data: Uint8Array): Promise<Uint8Array> {
    // Tiger Style: Assert function arguments
    console.assert(data instanceof Uint8Array, 'data must be Uint8Array');

    if (data.length === 0) {
      return this.createEmptyBlock();
    }

    if (data.length > this.blockSize) {
      throw new CompressionError(
        `Data block too large: ${data.length} bytes (max ${this.blockSize})`,
        'gzip',
        'compress',
        data.length,
        `Consider splitting data into smaller blocks or increasing blockSize`
      );
    }

    try {
      // Calculate CRC32 for uncompressed data
      const crc32 = await this.calculateCRC32(data);

      // Compress data using appropriate method
      const compressedData = await this.deflateData(data);

      // Create BGZF header
      const header = this.createBGZFHeader(compressedData.length + 25); // +25 for header+footer

      // Create BGZF footer
      const footer = this.createBGZFFooter(crc32, data.length);

      // Combine header + compressed data + footer
      const totalSize = header.length + compressedData.length + footer.length;
      const result = new Uint8Array(totalSize);

      let offset = 0;
      result.set(header, offset);
      offset += header.length;
      result.set(compressedData, offset);
      offset += compressedData.length;
      result.set(footer, offset);

      // Tiger Style: Assert postconditions
      console.assert(result.length >= 26, 'BGZF block must be at least 26 bytes');
      console.assert(result.length <= 65536, 'BGZF block must not exceed 64KB');
      console.assert(offset === totalSize, 'all data must be written to result');

      return result;
    } catch (error) {
      if (error instanceof CompressionError) {
        throw error;
      }

      throw CompressionError.fromSystemError('gzip', 'compress', error, data.length);
    }
  }

  /**
   * Create BGZF header with proper magic bytes and extra fields
   * @param blockSize Total block size including header and footer
   * @returns BGZF header bytes
   */
  private createBGZFHeader(blockSize: number): Uint8Array {
    // Tiger Style: Assert function arguments
    console.assert(
      Number.isInteger(blockSize) && blockSize > 0,
      'blockSize must be positive integer'
    );

    // BGZF header is 18 bytes
    const header = new Uint8Array(18);
    const view = new DataView(header.buffer);

    let offset = 0;

    // Gzip magic bytes
    view.setUint8(offset++, 0x1f); // ID1
    view.setUint8(offset++, 0x8b); // ID2

    // Compression method (deflate)
    view.setUint8(offset++, 0x08); // CM

    // Flags (extra field present)
    view.setUint8(offset++, 0x04); // FLG

    // Modification time (set to 0)
    view.setUint32(offset, 0x00000000, true); // MTIME (little-endian)
    offset += 4;

    // Extra flags
    view.setUint8(offset++, 0x00); // XFL

    // Operating system
    view.setUint8(offset++, 0xff); // OS

    // Extra field length
    view.setUint16(offset, 0x0006, true); // XLEN (little-endian)
    offset += 2;

    // BC subfield identifier
    view.setUint8(offset++, 0x42); // SI1 ('B')
    view.setUint8(offset++, 0x43); // SI2 ('C')

    // BC subfield length
    view.setUint16(offset, 0x0002, true); // SLEN (little-endian)
    offset += 2;

    // Block size minus 1
    view.setUint16(offset, blockSize - 1, true); // BC (little-endian)

    // Tiger Style: Assert postconditions
    console.assert(header.length === 18, 'header must be exactly 18 bytes');
    console.assert(offset + 2 === 18, 'all header bytes must be written');

    return header;
  }

  /**
   * Create BGZF footer with CRC32 and uncompressed size
   * @param crc32 CRC32 checksum of uncompressed data
   * @param uncompressedSize Size of uncompressed data
   * @returns BGZF footer bytes
   */
  private createBGZFFooter(crc32: number, uncompressedSize: number): Uint8Array {
    // Tiger Style: Assert function arguments
    console.assert(Number.isInteger(crc32) && crc32 >= 0, 'crc32 must be non-negative integer');
    console.assert(
      Number.isInteger(uncompressedSize) && uncompressedSize >= 0,
      'uncompressedSize must be non-negative integer'
    );

    // BGZF footer is 8 bytes
    const footer = new Uint8Array(8);
    const view = new DataView(footer.buffer);

    // CRC32 of uncompressed data
    view.setUint32(0, crc32, true); // little-endian

    // Size of uncompressed data
    view.setUint32(4, uncompressedSize, true); // little-endian

    // Tiger Style: Assert postconditions
    console.assert(footer.length === 8, 'footer must be exactly 8 bytes');

    return footer;
  }

  /**
   * Create an empty BGZF block (used for EOF marker)
   * @returns Empty BGZF block
   */
  private createEmptyBlock(): Uint8Array {
    // Empty BGZF block is a standard EOF marker
    const emptyBlock = new Uint8Array([
      // Header (18 bytes)
      0x1f, 0x8b, 0x08, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x06, 0x00, 0x42, 0x43, 0x02,
      0x00, 0x1b, 0x00,
      // Empty deflate block (2 bytes)
      0x03, 0x00,
      // Footer (8 bytes)
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);

    // Tiger Style: Assert postconditions
    console.assert(emptyBlock.length === 28, 'empty block must be exactly 28 bytes');

    return emptyBlock;
  }

  /**
   * Deflate compress data using Bun's native compression when available
   * @param data Data to compress
   * @returns Promise resolving to compressed data
   */
  private async deflateData(data: Uint8Array): Promise<Uint8Array> {
    // Tiger Style: Assert function arguments
    console.assert(data instanceof Uint8Array, 'data must be Uint8Array');

    try {
      // Use Bun's native compression if available
      if (this.isBunAvailable()) {
        return await this.compressWithBun(data);
      }

      // Use standard compression streams
      return await this.compressWithStreams(data);
    } catch (error) {
      throw new CompressionError(
        `Deflate compression failed: ${error instanceof Error ? error.message : String(error)}`,
        'gzip',
        'compress',
        data.length,
        'Try reducing compression level or using smaller blocks'
      );
    }
  }

  /**
   * Compress data using Bun's native gzip compression
   * @param data Data to compress
   * @returns Promise resolving to compressed data
   */
  private async compressWithBun(data: Uint8Array): Promise<Uint8Array> {
    // Tiger Style: Assert function arguments and availability
    console.assert(data instanceof Uint8Array, 'data must be Uint8Array');
    console.assert(this.isBunAvailable(), 'Bun must be available');

    // Use Bun.gzipSync with raw deflate for BGZF compatibility
    const compressed = (Bun as any).gzipSync(data, {
      level: this.compressionLevel as any,
      // Use raw deflate format (no gzip wrapper)
      windowBits: -15,
      memLevel: 8,
    });

    // Extract raw deflate data (skip gzip header/footer)
    // Bun.gzipSync returns full gzip stream, we need just the deflate part
    if (compressed.length < 18) {
      throw new CompressionError(
        'Compressed data too small for gzip format',
        'gzip',
        'compress',
        data.length
      );
    }

    // Skip gzip header (varies, but at least 10 bytes) and footer (8 bytes)
    // For BGZF, we create our own header/footer
    const deflateData = compressed.slice(10, compressed.length - 8);

    // Tiger Style: Assert postconditions
    console.assert(deflateData.length > 0, 'deflate data must not be empty');
    console.assert(
      deflateData.length < data.length || data.length < 100,
      'compression should reduce size for non-trivial data'
    );

    return deflateData;
  }

  /**
   * Compress data using standard compression streams
   * @param data Data to compress
   * @returns Promise resolving to compressed data
   */
  private async compressWithStreams(data: Uint8Array): Promise<Uint8Array> {
    // Tiger Style: Assert function arguments
    console.assert(data instanceof Uint8Array, 'data must be Uint8Array');

    if (typeof CompressionStream === 'undefined') {
      throw new CompressionError(
        'No compression method available - CompressionStream not supported',
        'gzip',
        'compress',
        data.length,
        'Consider using a runtime that supports CompressionStream or install a compression library'
      );
    }

    // Use raw deflate compression
    const compressor = new CompressionStream('deflate');
    const writer = compressor.writable.getWriter();
    const reader = compressor.readable.getReader();

    // Write data to compressor
    await writer.write(data);
    await writer.close();

    // Read compressed chunks
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }

    // Combine chunks into single array
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    // Tiger Style: Assert postconditions
    console.assert(result.length === totalLength, 'result length must match calculated total');
    console.assert(result.length > 0, 'compressed data must not be empty');

    return result;
  }

  /**
   * Calculate CRC32 checksum for uncompressed data
   * @param data Data to checksum
   * @returns Promise resolving to CRC32 value
   */
  private async calculateCRC32(data: Uint8Array): Promise<number> {
    // Tiger Style: Assert function arguments
    console.assert(data instanceof Uint8Array, 'data must be Uint8Array');

    // Use optimized CRC32 calculation
    const crcTable = this.getCRC32Table();

    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];
      console.assert(byte !== undefined, 'data byte must be defined');
      const tableIndex = (crc ^ byte!) & 0xff;
      const tableValue = crcTable![tableIndex];
      console.assert(tableValue !== undefined, 'CRC table value must be defined');
      crc = tableValue! ^ (crc >>> 8);
    }

    const result = (crc ^ 0xffffffff) >>> 0;

    // Tiger Style: Assert postconditions
    console.assert(Number.isInteger(result), 'CRC32 must be an integer');
    console.assert(
      result >= 0 && result <= 0xffffffff,
      'CRC32 must be valid 32-bit unsigned integer'
    );

    return result;
  }

  /**
   * Get or create CRC32 lookup table for performance
   * @returns CRC32 lookup table
   */
  private getCRC32Table(): Uint32Array {
    // Static table for performance - created once and reused
    if (!BGZFCompressor.crc32Table) {
      const table = new Uint32Array(256);

      for (let i = 0; i < 256; i++) {
        let crc = i;
        for (let j = 0; j < 8; j++) {
          crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
        }
        table[i] = crc;
      }

      BGZFCompressor.crc32Table = table;
    }

    return BGZFCompressor.crc32Table;
  }

  /**
   * Static CRC32 lookup table for performance
   */
  private static crc32Table: Uint32Array | undefined;

  /**
   * Write a compressed block to a stream or writer
   * @param writer Writer or stream to write to
   * @param data Uncompressed data to compress and write
   * @returns Promise resolving when write is complete
   */
  async writeBlock(
    writer: WritableStreamDefaultWriter<Uint8Array> | { write(data: Uint8Array): Promise<void> },
    data: Uint8Array
  ): Promise<void> {
    // Tiger Style: Assert function arguments
    console.assert(writer && typeof writer === 'object', 'writer must be an object');
    console.assert(data instanceof Uint8Array, 'data must be Uint8Array');
    console.assert('write' in writer, 'writer must have write method');

    try {
      const compressedBlock = await this.compressBlock(data);
      await writer.write(compressedBlock);

      // Tiger Style: Assert postconditions
      console.assert(compressedBlock.length > 0, 'compressed block must not be empty');
    } catch (error) {
      if (error instanceof CompressionError) {
        throw error;
      }

      throw new CompressionError(
        `Failed to write BGZF block: ${error instanceof Error ? error.message : String(error)}`,
        'gzip',
        'stream',
        data.length,
        'Check writer/stream status and available memory'
      );
    }
  }

  /**
   * Create EOF block for BGZF stream termination
   * @returns EOF block bytes
   */
  createEOFBlock(): Uint8Array {
    return this.createEmptyBlock();
  }

  /**
   * Create a streaming BGZF compressor transform
   * @returns TransformStream for streaming BGZF compression
   */
  createStream(): TransformStream<Uint8Array, Uint8Array> {
    let buffer = new Uint8Array(0);

    return new TransformStream({
      transform: async (chunk, controller) => {
        try {
          // Tiger Style: Assert chunk validity
          console.assert(chunk instanceof Uint8Array, 'chunk must be Uint8Array');

          // Append chunk to buffer
          const newBuffer = new Uint8Array(buffer.length + chunk.length);
          newBuffer.set(buffer);
          newBuffer.set(chunk, buffer.length);
          buffer = newBuffer;

          // Compress complete blocks
          while (buffer.length >= this.blockSize) {
            const blockData = buffer.slice(0, this.blockSize);
            const compressedBlock = await this.compressBlock(blockData);

            controller.enqueue(compressedBlock);
            buffer = buffer.slice(this.blockSize);
          }
        } catch (error) {
          controller.error(CompressionError.fromSystemError('gzip', 'stream', error, chunk.length));
        }
      },

      flush: async (controller) => {
        try {
          // Compress any remaining data
          if (buffer.length > 0) {
            const compressedBlock = await this.compressBlock(buffer);
            controller.enqueue(compressedBlock);
          }

          // Add EOF block
          const eofBlock = this.createEOFBlock();
          controller.enqueue(eofBlock);
        } catch (error) {
          controller.error(
            CompressionError.fromSystemError('gzip', 'stream', error, buffer.length)
          );
        }
      },
    });
  }

  /**
   * Check if Bun's native compression is available
   * @returns True if Bun compression is available
   */
  private isBunAvailable(): boolean {
    return (
      typeof globalThis !== 'undefined' &&
      'Bun' in globalThis &&
      globalThis.Bun &&
      typeof globalThis.Bun.gzipSync === 'function'
    );
  }

  /**
   * Get compression statistics and performance info
   * @returns Compression configuration and capabilities
   */
  getCompressionInfo(): {
    compressionLevel: number;
    blockSize: number;
    bunOptimized: boolean;
    streamingSupported: boolean;
    maxBlockSize: number;
  } {
    return {
      compressionLevel: this.compressionLevel,
      blockSize: this.blockSize,
      bunOptimized: this.isBunAvailable(),
      streamingSupported: typeof CompressionStream !== 'undefined' || this.isBunAvailable(),
      maxBlockSize: 65536,
    };
  }

  /**
   * Create an optimized compressor for high-performance scenarios
   * @param options Performance tuning options
   * @returns Optimized compressor instance
   */
  static createOptimized(
    options: {
      compressionLevel?: number;
      blockSize?: number;
      prioritizeSpeed?: boolean;
    } = {}
  ): BGZFCompressor {
    const {
      compressionLevel = options.prioritizeSpeed ? 1 : 6,
      blockSize = 65536,
      prioritizeSpeed = false,
    } = options;

    return new BGZFCompressor({
      compressionLevel: prioritizeSpeed ? Math.min(compressionLevel, 3) : compressionLevel,
      blockSize,
    });
  }
}
