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

import { BamError, CompressionError } from "../../errors";
import type { BGZFBlock } from "../../types";
import { readUInt32LE } from "./binary";

// Module-level constants for BGZF format
const BGZF_HEADER_SIZE = 18;
const GZIP_ID1 = 0x1f;
const GZIP_ID2 = 0x8b;
const GZIP_CM_DEFLATE = 0x08;
const GZIP_FLG_FEXTRA = 0x04;
const BGZF_XLEN = 6;
const BGZF_SI1 = 0x42; // 'B'
const BGZF_SI2 = 0x43; // 'C'
const BGZF_SLEN = 2;
const MIN_BGZF_BLOCK_SIZE = 26;
const MAX_BGZF_BLOCK_SIZE = 65536;

/**
 * Validate buffer has enough data for BGZF header
 */
export function readBlockHeader(buffer: Uint8Array, offset: number): BGZFBlock {
  validateBuffer(buffer, offset);
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset);

  validateGzipHeader(view);
  validateExtraField(view);

  const compressedSize = readBlockSize(view);
  validateBlockSize(compressedSize, buffer, offset);

  const { uncompressedSize, crc32 } = readBlockFooter(buffer, offset, compressedSize);

  return {
    offset,
    compressedSize,
    uncompressedSize,
    crc32,
  };
}

/**
 * Decompress a single BGZF block
 *
 * @param blockData Complete BGZF block data
 * @returns Promise resolving to decompressed data
 * @throws {CompressionError} If decompression fails
 */
export async function decompressBlock(blockData: Uint8Array): Promise<Uint8Array> {
  // Tiger Style: Assert function arguments
  if (!(blockData instanceof Uint8Array)) {
    throw new CompressionError("blockData must be Uint8Array", "gzip", "decompress");
  }

  if (blockData.length < 26) {
    throw new CompressionError(
      `BGZF block too small: ${blockData.length} bytes (minimum 26)`,
      "gzip",
      "decompress"
    );
  }

  try {
    // Validate block header first
    const blockInfo = readBlockHeader(blockData, 0);

    // Extract compressed data (skip 18-byte header, exclude 8-byte footer)
    const compressedData = blockData.slice(18, blockData.length - 8);

    // Create gzip-compatible stream for decompression
    // BGZF blocks are standard deflate streams with gzip wrapper
    const decompressedData = await inflateData(compressedData);

    // Validate decompressed size matches header
    if (decompressedData.length !== blockInfo.uncompressedSize) {
      throw new CompressionError(
        `Size mismatch: expected ${blockInfo.uncompressedSize}, got ${decompressedData.length}`,
        "gzip",
        "validate"
      );
    }

    // Validate CRC32 if available
    if (blockInfo.crc32 !== undefined) {
      const calculatedCrc = await calculateCRC32(decompressedData);
      if (calculatedCrc !== blockInfo.crc32) {
        throw new CompressionError(
          `CRC32 mismatch: expected 0x${blockInfo.crc32.toString(16)}, got 0x${calculatedCrc.toString(16)}`,
          "gzip",
          "validate"
        );
      }
    }

    // Tiger Style: Assert postconditions
    if (!(decompressedData instanceof Uint8Array)) {
      throw new CompressionError("result must be Uint8Array", "gzip", "validate");
    }
    if (decompressedData.length !== blockInfo.uncompressedSize) {
      throw new CompressionError("result size must match header", "gzip", "validate");
    }

    return decompressedData;
  } catch (error) {
    if (error instanceof CompressionError || error instanceof BamError) {
      throw error;
    }

    throw CompressionError.fromSystemError("gzip", "decompress", error, blockData.length);
  }
}

/**
 * Create a streaming BGZF decompressor
 *
 * @returns TransformStream for streaming BGZF decompression
 */
export function createStream(): TransformStream<Uint8Array, Uint8Array> {
  let buffer: Uint8Array = new Uint8Array(0);

  return new TransformStream({
    async transform(chunk, controller): Promise<void> {
      try {
        // Tiger Style: Assert chunk validity
        if (!(chunk instanceof Uint8Array)) {
          throw new CompressionError("chunk must be Uint8Array", "gzip", "stream");
        }

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

            const blockInfo = readBlockHeader(buffer, offset);

            // Check if we have complete block
            if (buffer.length - offset < blockInfo.compressedSize) {
              break; // Incomplete block
            }

            // Extract and decompress block
            const blockData = buffer.slice(offset, offset + blockInfo.compressedSize);
            const decompressed = await decompressBlock(blockData);

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
        controller.error(CompressionError.fromSystemError("gzip", "stream", error, chunk.length));
      }
    },

    async flush(controller): Promise<void> {
      // Process any remaining data
      if (buffer.length > 0) {
        try {
          const blockInfo = readBlockHeader(buffer, 0);
          if (buffer.length >= blockInfo.compressedSize) {
            const blockData = buffer.slice(0, blockInfo.compressedSize);
            const decompressed = await decompressBlock(blockData);
            controller.enqueue(decompressed);
          }
        } catch (error) {
          // Log incomplete data errors for debugging - helps with corrupted files
          console.warn(
            `BGZF flush warning: ${error instanceof Error ? error.message : String(error)} - possibly incomplete block data`
          );
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
export function detectFormat(data: Uint8Array): boolean {
  // Tiger Style: Assert function arguments
  if (!(data instanceof Uint8Array)) {
    throw new CompressionError("data must be Uint8Array", "gzip", "detect");
  }

  if (data.length < 18) {
    return false;
  }

  try {
    readBlockHeader(data, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find all BGZF blocks in a buffer
 * @param buffer Buffer to scan
 * @returns Array of BGZFBlock information
 */
export function findBlocks(buffer: Uint8Array): BGZFBlock[] {
  // Tiger Style: Assert function arguments
  if (!(buffer instanceof Uint8Array)) {
    throw new CompressionError("buffer must be Uint8Array", "gzip", "detect");
  }

  const blocks: BGZFBlock[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    try {
      const block = readBlockHeader(buffer, offset);
      blocks.push(block);
      offset += block.compressedSize;
    } catch {
      // If we can't read a valid block header, we're done
      break;
    }
  }

  // Tiger Style: Assert postconditions
  if (!Array.isArray(blocks)) {
    throw new CompressionError("result must be an array", "gzip", "detect");
  }

  return blocks;
}

// Backward compatibility namespace export
export const BGZFReader = {
  readBlockHeader,
  decompressBlock,
  createStream,
  detectFormat,
  findBlocks,
} as const;

// =============================================================================
// PRIVATE HELPER FUNCTIONS
// =============================================================================

function validateBuffer(buffer: Uint8Array, offset: number): void {
  if (buffer.length < offset + BGZF_HEADER_SIZE) {
    throw new BamError(
      `Buffer too small for BGZF header: need ${BGZF_HEADER_SIZE} bytes at offset ${offset}, have ${buffer.length - offset}`,
      undefined,
      "bgzf"
    );
  }
}

/**
 * Validate gzip header fields
 */
function validateGzipHeader(view: DataView): void {
  // Validate gzip magic bytes
  const id1 = view.getUint8(0);
  const id2 = view.getUint8(1);
  if (id1 !== GZIP_ID1 || id2 !== GZIP_ID2) {
    throw new BamError(
      `Invalid gzip magic bytes: expected 0x1f 0x8b, got 0x${id1.toString(16)} 0x${id2.toString(16)}`,
      undefined,
      "bgzf"
    );
  }

  // Validate compression method (deflate)
  const cm = view.getUint8(2);
  if (cm !== GZIP_CM_DEFLATE) {
    throw new BamError(
      `Invalid compression method: expected 0x08 (deflate), got 0x${cm.toString(16)}`,
      undefined,
      "bgzf"
    );
  }

  // Validate flags (must have extra field)
  const flg = view.getUint8(3);
  if ((flg & GZIP_FLG_FEXTRA) === 0) {
    throw new BamError(
      `Invalid BGZF flags: extra field bit not set (0x${flg.toString(16)})`,
      undefined,
      "bgzf"
    );
  }
}

/**
 * Validate BGZF extra field
 */
function validateExtraField(view: DataView): void {
  // Validate extra field length
  const xlen = view.getUint16(10, true); // little-endian
  if (xlen !== BGZF_XLEN) {
    throw new BamError(
      `Invalid BGZF extra field length: expected ${BGZF_XLEN}, got ${xlen}`,
      undefined,
      "bgzf"
    );
  }

  // Validate BC subfield identifier
  const si1 = view.getUint8(12);
  const si2 = view.getUint8(13);
  if (si1 !== BGZF_SI1 || si2 !== BGZF_SI2) {
    throw new BamError(
      `Invalid BGZF subfield identifier: expected BC (0x42 0x43), got 0x${si1.toString(16)} 0x${si2.toString(16)}`,
      undefined,
      "bgzf"
    );
  }

  // Validate BC subfield length
  const slen = view.getUint16(14, true); // little-endian
  if (slen !== BGZF_SLEN) {
    throw new BamError(
      `Invalid BGZF BC subfield length: expected ${BGZF_SLEN}, got ${slen}`,
      undefined,
      "bgzf"
    );
  }
}

/**
 * Read block size from BGZF header
 */
function readBlockSize(view: DataView): number {
  const bc = view.getUint16(16, true); // little-endian
  return bc + 1;
}

/**
 * Validate block size and buffer completeness
 */
function validateBlockSize(compressedSize: number, buffer: Uint8Array, offset: number): void {
  if (compressedSize < MIN_BGZF_BLOCK_SIZE) {
    throw new BamError(
      `Invalid BGZF block size: ${compressedSize} bytes (minimum ${MIN_BGZF_BLOCK_SIZE})`,
      undefined,
      "bgzf"
    );
  }

  if (compressedSize > MAX_BGZF_BLOCK_SIZE) {
    throw new BamError(
      `Invalid BGZF block size: ${compressedSize} bytes (maximum ${MAX_BGZF_BLOCK_SIZE})`,
      undefined,
      "bgzf"
    );
  }

  // Check if we have the complete block
  if (buffer.length < offset + compressedSize) {
    throw new BamError(
      `Incomplete BGZF block: need ${compressedSize} bytes, have ${buffer.length - offset}`,
      undefined,
      "bgzf"
    );
  }
}

/**
 * Read block footer (CRC32 and uncompressed size)
 */
function readBlockFooter(
  buffer: Uint8Array,
  offset: number,
  compressedSize: number
): { uncompressedSize: number; crc32: number } {
  const view = new DataView(buffer.buffer, buffer.byteOffset);

  // Read uncompressed size from block footer (last 4 bytes)
  const isizeOffset = offset + compressedSize - 4;
  const uncompressedSize = readUInt32LE(view, isizeOffset);

  // Read CRC32 from block footer (4 bytes before ISIZE)
  const crc32Offset = offset + compressedSize - 8;
  const crc32 = readUInt32LE(view, crc32Offset);

  return { uncompressedSize, crc32 };
}

/**
 * Inflate deflate-compressed data
 * @param compressedData Deflate-compressed data
 * @returns Promise resolving to inflated data
 */
async function inflateData(compressedData: Uint8Array): Promise<Uint8Array> {
  // Tiger Style: Assert function arguments
  if (!(compressedData instanceof Uint8Array)) {
    throw new CompressionError("compressedData must be Uint8Array", "gzip", "decompress");
  }

  // Use native DecompressionStream if available (modern browsers/runtimes)
  if (typeof CompressionStream !== "undefined") {
    const decompressor = new DecompressionStream("deflate");
    const writer = decompressor.writable.getWriter();
    const reader = decompressor.readable.getReader();

    // Write compressed data (cast to BufferSource for DOM compatibility)
    await writer.write(compressedData as BufferSource);
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
  const { GzipDecompressor } = await import("../../compression/gzip");
  return (GzipDecompressor as any).inflateRaw(compressedData);
}

/**
 * Calculate CRC32 checksum for data validation
 * @param data Data to checksum
 * @returns Promise resolving to CRC32 value
 */
async function calculateCRC32(data: Uint8Array): Promise<number> {
  // Tiger Style: Assert function arguments
  if (!(data instanceof Uint8Array)) {
    throw new CompressionError("data must be Uint8Array", "gzip", "validate");
  }

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
    if (byte === undefined) {
      throw new CompressionError(`data byte undefined at index ${i}`, "gzip", "validate");
    }
    const tableIndex = (crc ^ byte) & 0xff;
    const tableValue = crcTable[tableIndex];
    if (tableValue === undefined) {
      throw new CompressionError(
        `CRC table value undefined at index ${tableIndex}`,
        "gzip",
        "validate"
      );
    }
    crc = tableValue ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0; // Ensure unsigned 32-bit result
}

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
