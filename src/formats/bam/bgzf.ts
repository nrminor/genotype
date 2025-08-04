/**
 * BGZF (Block GZIP Format) handler for BAM files
 *
 * BGZF is a variant of GZIP that enables random access to compressed data
 * by organizing data into independent, seekable blocks. Each block is a
 * complete gzip stream with specific header/footer structure.
 *
 * BGZF Block Structure:
 * - Standard gzip header with extra fields
 * - BC field (2 bytes): Block size minus 1
 * - Compressed data
 * - CRC32 (4 bytes): Uncompressed data checksum
 * - ISIZE (4 bytes): Uncompressed data size
 */

import type { BGZFBlock } from '../../types';
import { BamError, CompressionError } from '../../errors';
import { BinaryParser } from './binary';

/**
 * BGZF reader for decompressing BAM files
 *
 * Implements streaming decompression with block-level access for efficient
 * processing of large BAM files. Follows Tiger Style with comprehensive
 * validation and error handling.
 */
export class BGZFReader {
  /**
   * Read and validate BGZF block header
   *
   * BGZF header format:
   * - ID1, ID2: 0x1f, 0x8b (gzip magic)
   * - CM: 0x08 (compression method: deflate)
   * - FLG: 0x04 (extra field present)
   * - MTIME: 0x00000000 (modification time)
   * - XFL: 0x00 (extra flags)
   * - OS: 0xff (operating system)
   * - XLEN: 0x0006 (extra field length)
   * - SI1, SI2: 0x42, 0x43 (BC subfield identifier)
   * - SLEN: 0x0002 (BC subfield length)
   * - BC: Block size minus 1 (2 bytes, little-endian)
   *
   * @param buffer Buffer containing potential BGZF block
   * @param offset Offset where block starts
   * @returns BGZFBlock information if valid
   * @throws {BamError} If block header is invalid
   */
  static readBlockHeader(buffer: Uint8Array, offset: number): BGZFBlock {
    // Tiger Style: Assert function arguments
    console.assert(buffer instanceof Uint8Array, 'buffer must be a Uint8Array');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');

    if (buffer.length < offset + 18) {
      throw new BamError(
        `Buffer too small for BGZF header: need 18 bytes at offset ${offset}, have ${buffer.length - offset}`,
        undefined,
        'bgzf'
      );
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset + offset);

    // Validate gzip magic bytes
    const id1 = view.getUint8(0);
    const id2 = view.getUint8(1);
    if (id1 !== 0x1f || id2 !== 0x8b) {
      throw new BamError(
        `Invalid gzip magic bytes: expected 0x1f 0x8b, got 0x${id1.toString(16)} 0x${id2.toString(16)}`,
        undefined,
        'bgzf'
      );
    }

    // Validate compression method (deflate)
    const cm = view.getUint8(2);
    if (cm !== 0x08) {
      throw new BamError(
        `Invalid compression method: expected 0x08 (deflate), got 0x${cm.toString(16)}`,
        undefined,
        'bgzf'
      );
    }

    // Validate flags (must have extra field)
    const flg = view.getUint8(3);
    if ((flg & 0x04) === 0) {
      throw new BamError(
        `Invalid BGZF flags: extra field bit not set (0x${flg.toString(16)})`,
        undefined,
        'bgzf'
      );
    }

    // Skip MTIME (4 bytes), XFL (1 byte), OS (1 byte) - total offset now 10

    // Validate extra field length
    const xlen = view.getUint16(10, true); // little-endian
    if (xlen !== 6) {
      throw new BamError(
        `Invalid BGZF extra field length: expected 6, got ${xlen}`,
        undefined,
        'bgzf'
      );
    }

    // Validate BC subfield identifier
    const si1 = view.getUint8(12);
    const si2 = view.getUint8(13);
    if (si1 !== 0x42 || si2 !== 0x43) {
      throw new BamError(
        `Invalid BGZF subfield identifier: expected BC (0x42 0x43), got 0x${si1.toString(16)} 0x${si2.toString(16)}`,
        undefined,
        'bgzf'
      );
    }

    // Validate BC subfield length
    const slen = view.getUint16(14, true); // little-endian
    if (slen !== 2) {
      throw new BamError(
        `Invalid BGZF BC subfield length: expected 2, got ${slen}`,
        undefined,
        'bgzf'
      );
    }

    // Read block size
    const bc = view.getUint16(16, true); // little-endian
    const compressedSize = bc + 1;

    // Validate block size bounds
    if (compressedSize < 26) {
      // Minimum BGZF block size
      throw new BamError(
        `Invalid BGZF block size: ${compressedSize} bytes (minimum 26)`,
        undefined,
        'bgzf'
      );
    }

    if (compressedSize > 65536) {
      // Maximum BGZF block size
      throw new BamError(
        `Invalid BGZF block size: ${compressedSize} bytes (maximum 65536)`,
        undefined,
        'bgzf'
      );
    }

    // Check if we have the complete block
    if (buffer.length < offset + compressedSize) {
      throw new BamError(
        `Incomplete BGZF block: need ${compressedSize} bytes, have ${buffer.length - offset}`,
        undefined,
        'bgzf'
      );
    }

    // Read uncompressed size from block footer (last 4 bytes)
    const isizeOffset = offset + compressedSize - 4;
    const uncompressedSize = BinaryParser.readUInt32LE(
      new DataView(buffer.buffer, buffer.byteOffset),
      isizeOffset
    );

    // Read CRC32 from block footer (4 bytes before ISIZE)
    const crc32Offset = offset + compressedSize - 8;
    const crc32 = BinaryParser.readUInt32LE(
      new DataView(buffer.buffer, buffer.byteOffset),
      crc32Offset
    );

    const block: BGZFBlock = {
      offset,
      compressedSize,
      uncompressedSize,
      crc32,
    };

    // Tiger Style: Assert postconditions
    console.assert(block.compressedSize >= 26, 'block size must be at least 26 bytes');
    console.assert(block.compressedSize <= 65536, 'block size must not exceed 65536 bytes');
    console.assert(
      block.uncompressedSize <= 65536,
      'uncompressed size must not exceed 65536 bytes'
    );

    return block;
  }

  /**
   * Decompress a single BGZF block
   *
   * @param blockData Complete BGZF block data
   * @returns Promise resolving to decompressed data
   * @throws {CompressionError} If decompression fails
   */
  static async decompressBlock(blockData: Uint8Array): Promise<Uint8Array> {
    // Tiger Style: Assert function arguments
    console.assert(blockData instanceof Uint8Array, 'blockData must be a Uint8Array');

    if (blockData.length < 26) {
      throw new CompressionError(
        `BGZF block too small: ${blockData.length} bytes (minimum 26)`,
        'gzip',
        'decompress'
      );
    }

    try {
      // Validate block header first
      const blockInfo = this.readBlockHeader(blockData, 0);

      // Extract compressed data (skip 18-byte header, exclude 8-byte footer)
      const compressedData = blockData.slice(18, blockData.length - 8);

      // Create gzip-compatible stream for decompression
      // BGZF blocks are standard deflate streams with gzip wrapper
      const decompressedData = await this.inflateData(compressedData);

      // Validate decompressed size matches header
      if (decompressedData.length !== blockInfo.uncompressedSize) {
        throw new CompressionError(
          `Size mismatch: expected ${blockInfo.uncompressedSize}, got ${decompressedData.length}`,
          'gzip',
          'validate'
        );
      }

      // Validate CRC32 if available
      if (blockInfo.crc32 !== undefined) {
        const calculatedCrc = await this.calculateCRC32(decompressedData);
        if (calculatedCrc !== blockInfo.crc32) {
          throw new CompressionError(
            `CRC32 mismatch: expected 0x${blockInfo.crc32.toString(16)}, got 0x${calculatedCrc.toString(16)}`,
            'gzip',
            'validate'
          );
        }
      }

      // Tiger Style: Assert postconditions
      console.assert(decompressedData instanceof Uint8Array, 'result must be Uint8Array');
      console.assert(
        decompressedData.length === blockInfo.uncompressedSize,
        'result size must match header'
      );

      return decompressedData;
    } catch (error) {
      if (error instanceof CompressionError || error instanceof BamError) {
        throw error;
      }

      throw CompressionError.fromSystemError('gzip', 'decompress', error, blockData.length);
    }
  }

  /**
   * Create a streaming BGZF decompressor
   *
   * @returns TransformStream for streaming BGZF decompression
   */
  static createStream(): TransformStream<Uint8Array, Uint8Array> {
    let buffer: Uint8Array = new Uint8Array(0);

    return new TransformStream({
      async transform(chunk, controller) {
        try {
          // Tiger Style: Assert chunk validity
          console.assert(chunk instanceof Uint8Array, 'chunk must be Uint8Array');

          // Append new chunk to buffer
          const newBuffer = new Uint8Array(buffer.length + chunk.length);
          newBuffer.set(buffer);
          newBuffer.set(chunk, buffer.length);
          buffer = newBuffer;

          // Process complete blocks
          let offset = 0;
          while (offset < buffer.length) {
            try {
              // Try to read block header
              if (buffer.length - offset < 18) {
                break; // Not enough data for header
              }

              const blockInfo = BGZFReader.readBlockHeader(buffer, offset);

              // Check if we have complete block
              if (buffer.length - offset < blockInfo.compressedSize) {
                break; // Incomplete block
              }

              // Extract and decompress block
              const blockData = buffer.slice(offset, offset + blockInfo.compressedSize);
              const decompressed = await BGZFReader.decompressBlock(blockData);

              // Enqueue decompressed data
              controller.enqueue(decompressed);

              offset += blockInfo.compressedSize;
            } catch (error) {
              if (error instanceof BamError) {
                // If header is invalid, might be end of stream or corruption
                break;
              }
              throw error;
            }
          }

          // Keep remaining data for next chunk
          if (offset > 0) {
            buffer = buffer.slice(offset);
          }
        } catch (error) {
          controller.error(CompressionError.fromSystemError('gzip', 'stream', error, chunk.length));
        }
      },

      async flush(controller) {
        // Process any remaining data
        if (buffer.length > 0) {
          try {
            const blockInfo = BGZFReader.readBlockHeader(buffer, 0);
            if (buffer.length >= blockInfo.compressedSize) {
              const blockData = buffer.slice(0, blockInfo.compressedSize);
              const decompressed = await BGZFReader.decompressBlock(blockData);
              controller.enqueue(decompressed);
            }
          } catch (error) {
            // Ignore errors during flush - might be incomplete data
            console.warn('BGZF flush error:', error);
          }
        }
      },
    });
  }

  /**
   * Detect if data contains BGZF blocks
   * @param data Data to examine
   * @returns True if BGZF format detected
   */
  static detectFormat(data: Uint8Array): boolean {
    // Tiger Style: Assert function arguments
    console.assert(data instanceof Uint8Array, 'data must be Uint8Array');

    if (data.length < 18) {
      return false;
    }

    try {
      this.readBlockHeader(data, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Inflate deflate-compressed data
   * @param compressedData Deflate-compressed data
   * @returns Promise resolving to inflated data
   */
  private static async inflateData(compressedData: Uint8Array): Promise<Uint8Array> {
    // Tiger Style: Assert function arguments
    console.assert(compressedData instanceof Uint8Array, 'compressedData must be Uint8Array');

    // Use native DecompressionStream if available (modern browsers/runtimes)
    if (typeof CompressionStream !== 'undefined') {
      const decompressor = new DecompressionStream('deflate');
      const writer = decompressor.writable.getWriter();
      const reader = decompressor.readable.getReader();

      // Write compressed data
      await writer.write(compressedData);
      await writer.close();

      // Read decompressed result
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLength += value.length;
      }

      // Combine chunks
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      return result;
    }

    // Fallback: Import compression library dynamically
    const { GzipDecompressor } = await import('../../compression/gzip');
    return (GzipDecompressor as any).inflateRaw(compressedData);
  }

  /**
   * Calculate CRC32 checksum for data validation
   * @param data Data to checksum
   * @returns Promise resolving to CRC32 value
   */
  private static async calculateCRC32(data: Uint8Array): Promise<number> {
    // Tiger Style: Assert function arguments
    console.assert(data instanceof Uint8Array, 'data must be Uint8Array');

    // Simple CRC32 implementation for validation
    // Production code should use optimized CRC32 library
    const crcTable = new Uint32Array(256);

    // Generate CRC table
    for (let i = 0; i < 256; i++) {
      let crc = i;
      for (let j = 0; j < 8; j++) {
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      }
      crcTable[i] = crc;
    }

    // Calculate CRC32
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];
      console.assert(byte !== undefined, 'data byte must be defined');
      const tableIndex = (crc ^ byte!) & 0xff;
      const tableValue = crcTable![tableIndex];
      console.assert(tableValue !== undefined, 'CRC table value must be defined');
      crc = tableValue! ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0; // Ensure unsigned 32-bit result
  }

  /**
   * Find all BGZF blocks in a buffer
   * @param buffer Buffer to scan
   * @returns Array of BGZFBlock information
   */
  static findBlocks(buffer: Uint8Array): BGZFBlock[] {
    // Tiger Style: Assert function arguments
    console.assert(buffer instanceof Uint8Array, 'buffer must be Uint8Array');

    const blocks: BGZFBlock[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      try {
        const block = this.readBlockHeader(buffer, offset);
        blocks.push(block);
        offset += block.compressedSize;
      } catch {
        // If we can't read a valid block header, we're done
        break;
      }
    }

    // Tiger Style: Assert postconditions
    console.assert(Array.isArray(blocks), 'result must be an array');

    return blocks;
  }
}
