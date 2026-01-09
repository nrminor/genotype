/**
 * Gzip compression/decompression for genomic files
 *
 * Uses fflate for high-performance gzip operations. Provides both
 * one-shot and streaming APIs for compression and decompression.
 */

import { gunzipSync, gzipSync, Gunzip, Gzip } from "fflate";
import { CompressionError } from "../errors";
import type { DecompressorOptions } from "../types";

/** Maximum decompressed size (10GB safety limit for genomic files) */
const MAX_OUTPUT_SIZE = 10_737_418_240;

/** Clamp compression level to fflate's valid range (0-9) */
type GzipLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

function clampLevel(level: number | undefined): GzipLevel {
  const raw = level ?? 6;
  return Math.min(9, Math.max(0, Math.floor(raw))) as GzipLevel;
}

// =============================================================================
// VALIDATION
// =============================================================================

function validateInput(data: Uint8Array, operation: "compress" | "decompress"): void {
  if (!(data instanceof Uint8Array)) {
    throw new CompressionError(`Data must be Uint8Array`, "gzip", operation);
  }
  if (data.length === 0) {
    throw new CompressionError(`Data must not be empty`, "gzip", operation);
  }
}

function validateGzipMagic(data: Uint8Array): void {
  if (data.length < 2 || data[0] !== 0x1f || data[1] !== 0x8b) {
    throw new CompressionError(
      "Invalid gzip magic bytes - file may not be gzip compressed",
      "gzip",
      "decompress"
    );
  }

  // Detect BGZF and reject with helpful message
  if (data.length >= 18) {
    const flg = data[3];
    if (flg !== undefined && (flg & 0x04) !== 0) {
      const view = new DataView(data.buffer, data.byteOffset);
      const xlen = view.getUint16(10, true);
      if (xlen === 6) {
        const si1 = view.getUint8(12);
        const si2 = view.getUint8(13);
        if (si1 === 0x42 && si2 === 0x43) {
          throw new CompressionError(
            "This appears to be a BGZF file, not standard gzip. Use BGZFDecompressor instead.",
            "gzip",
            "decompress"
          );
        }
      }
    }
  }
}

// =============================================================================
// ONE-SHOT COMPRESSION/DECOMPRESSION
// =============================================================================

/**
 * Decompress gzip data
 *
 * @param compressed - Gzip compressed data
 * @param options - Decompression options
 * @returns Decompressed data
 * @throws {CompressionError} If decompression fails
 */
export async function decompress(
  compressed: Uint8Array,
  options: DecompressorOptions = {}
): Promise<Uint8Array> {
  validateInput(compressed, "decompress");
  validateGzipMagic(compressed);

  if (options.signal?.aborted) {
    throw new CompressionError("Operation was aborted", "gzip", "decompress");
  }

  const maxSize = options.maxOutputSize ?? MAX_OUTPUT_SIZE;

  try {
    const result = gunzipSync(compressed);

    if (result.length > maxSize) {
      throw new CompressionError(
        `Decompressed size ${result.length} exceeds maximum ${maxSize}`,
        "gzip",
        "decompress"
      );
    }

    return result;
  } catch (error) {
    if (error instanceof CompressionError) throw error;
    throw new CompressionError(
      error instanceof Error ? error.message : String(error),
      "gzip",
      "decompress"
    );
  }
}

/**
 * Compress data using gzip
 *
 * @param data - Uncompressed data
 * @param options - Compression options (level: 0-9)
 * @returns Gzip compressed data
 * @throws {CompressionError} If compression fails
 */
export async function compress(
  data: Uint8Array,
  options: { level?: number } = {}
): Promise<Uint8Array> {
  validateInput(data, "compress");

  try {
    return gzipSync(data, { level: clampLevel(options.level) });
  } catch (error) {
    throw new CompressionError(
      `Gzip compression failed: ${error instanceof Error ? error.message : String(error)}`,
      "gzip",
      "compress"
    );
  }
}

// =============================================================================
// STREAMING COMPRESSION/DECOMPRESSION
// =============================================================================

/**
 * Create gzip decompression transform stream
 *
 * @param options - Decompression options
 * @returns TransformStream for decompression
 */
export function createStream(
  options: DecompressorOptions = {}
): TransformStream<Uint8Array, Uint8Array> {
  const maxSize = options.maxOutputSize ?? MAX_OUTPUT_SIZE;
  let decompressor: Gunzip | null = null;
  let totalBytes = 0;

  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      decompressor = new Gunzip((chunk, final) => {
        if (chunk) {
          totalBytes += chunk.length;
          if (totalBytes > maxSize) {
            controller.error(
              new CompressionError(
                `Decompressed size ${totalBytes} exceeds maximum ${maxSize}`,
                "gzip",
                "stream"
              )
            );
            return;
          }
          controller.enqueue(chunk);
        }
        if (final) {
          controller.terminate();
        }
      });
    },

    transform(chunk) {
      if (options.signal?.aborted) {
        throw new CompressionError("Operation was aborted", "gzip", "stream");
      }
      if (!decompressor) {
        throw new CompressionError("Stream not initialized", "gzip", "stream");
      }
      try {
        decompressor.push(chunk, false);
      } catch (error) {
        throw new CompressionError(
          error instanceof Error ? error.message : String(error),
          "gzip",
          "stream"
        );
      }
    },

    flush() {
      if (!decompressor) {
        throw new CompressionError("Stream not initialized", "gzip", "stream");
      }
      try {
        decompressor.push(new Uint8Array(), true);
      } catch (error) {
        throw new CompressionError(
          error instanceof Error ? error.message : String(error),
          "gzip",
          "stream"
        );
      }
    },
  });
}

/**
 * Create gzip compression transform stream
 *
 * @param options - Compression options (level: 0-9)
 * @returns TransformStream for compression
 */
export function createCompressionStream(
  options: { level?: number } = {}
): TransformStream<Uint8Array, Uint8Array> {
  const compressor = new Gzip({ level: clampLevel(options.level) });

  return new TransformStream({
    start(controller) {
      compressor.ondata = (chunk, final) => {
        controller.enqueue(chunk);
        if (final) {
          controller.terminate();
        }
      };
    },

    transform(chunk) {
      compressor.push(chunk, false);
    },

    flush() {
      compressor.push(new Uint8Array(0), true);
    },
  });
}

/**
 * Wrap a readable stream with gzip decompression
 *
 * @param input - Compressed input stream
 * @param options - Decompression options
 * @returns Decompressed output stream
 */
export function wrapStream(
  input: ReadableStream<Uint8Array>,
  options: DecompressorOptions = {}
): ReadableStream<Uint8Array> {
  if (!(input instanceof ReadableStream)) {
    throw new CompressionError("Input must be ReadableStream", "gzip", "stream");
  }
  return input.pipeThrough(createStream(options));
}

// =============================================================================
// NAMESPACE EXPORT
// =============================================================================

/**
 * Gzip decompressor namespace for API compatibility
 */
export const GzipDecompressor = {
  decompress,
  createStream,
  wrapStream,
} as const;
