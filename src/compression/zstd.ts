/**
 * Zstandard compression and decompression for genomic files
 *
 * Provides high-performance Zstandard compression using @hpcc-js/wasm-zstd,
 * a cross-platform WASM implementation that works on Node.js, Bun, Deno,
 * and browsers.
 *
 * Zstd offers superior compression ratios and speed compared to gzip,
 * making it increasingly popular for large-scale genomic data storage.
 *
 * @module compression/zstd
 */

import { Zstd } from "@hpcc-js/wasm-zstd";
import { CompressionError } from "../errors";
import type { DecompressorOptions } from "../types";
import { DecompressorOptionsSchema } from "../types";

/**
 * Zstd magic number for format validation (0xFD2FB528 little-endian)
 */
const ZSTD_MAGIC = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Default options for Zstd operations (signal is intentionally omitted)
 */
const DEFAULT_OPTIONS = {
  bufferSize: 131072, // 128KB - Zstd works well with larger buffers
  maxOutputSize: 10_737_418_240, // 10GB safety limit for genomic files
  validateIntegrity: true,
} as const;

/**
 * Lazy-loaded Zstd instance
 *
 * WASM modules require async initialization. We load once and cache
 * for subsequent operations.
 */
let zstdInstance: Zstd | null = null;

/**
 * Get or initialize the Zstd WASM instance
 *
 * @returns Promise resolving to initialized Zstd instance
 * @throws {CompressionError} If WASM initialization fails
 */
async function getZstd(): Promise<Zstd> {
  if (zstdInstance === null) {
    try {
      zstdInstance = await Zstd.load();
    } catch (error) {
      throw new CompressionError(
        `Failed to initialize Zstd WASM: ${error instanceof Error ? error.message : String(error)}`,
        "zstd",
        "validate"
      );
    }
  }
  return zstdInstance;
}

/**
 * Validate that data has valid Zstd magic bytes
 */
function validateZstdMagic(data: Uint8Array): void {
  if (data.length < 4) {
    throw new CompressionError(
      "Data too small to be valid Zstd format (minimum 4 bytes for magic number)",
      "zstd",
      "validate"
    );
  }

  const hasMagic = ZSTD_MAGIC.every((byte, i) => data[i] === byte);
  if (!hasMagic) {
    throw new CompressionError(
      "Invalid Zstd magic bytes - data may not be Zstd compressed",
      "zstd",
      "validate"
    );
  }
}

/**
 * Merged options with all required fields filled in
 */
interface MergedOptions {
  readonly bufferSize: number;
  readonly maxOutputSize: number;
  readonly signal: AbortSignal | undefined;
  readonly validateIntegrity: boolean;
}

/**
 * Merge user options with defaults
 */
function mergeOptions(options: DecompressorOptions = {}): MergedOptions {
  const merged: MergedOptions = {
    bufferSize: options.bufferSize ?? DEFAULT_OPTIONS.bufferSize,
    maxOutputSize: options.maxOutputSize ?? DEFAULT_OPTIONS.maxOutputSize,
    validateIntegrity: options.validateIntegrity ?? DEFAULT_OPTIONS.validateIntegrity,
    signal: options.signal,
  };

  // Validate with ArkType schema
  const validation = DecompressorOptionsSchema(options);
  if (validation instanceof Error) {
    throw new CompressionError(
      `Invalid decompressor options: ${validation.message}`,
      "zstd",
      "validate"
    );
  }

  return merged;
}

/**
 * Compress data using Zstandard
 *
 * @param data - Uncompressed data
 * @param level - Compression level (1-22, default 3). Higher = better compression but slower.
 *                Levels >= 20 require significantly more memory.
 * @returns Compressed data
 * @throws {CompressionError} If compression fails
 *
 * @example
 * ```typescript
 * const data = new TextEncoder().encode(fastaContent);
 * const compressed = await compress(data);
 * // Or with custom compression level
 * const maxCompressed = await compress(data, 19);
 * ```
 */
export async function compress(data: Uint8Array, level?: number): Promise<Uint8Array> {
  if (!(data instanceof Uint8Array)) {
    throw new CompressionError("Data must be Uint8Array", "zstd", "compress");
  }

  if (data.length === 0) {
    throw new CompressionError("Cannot compress empty data", "zstd", "compress");
  }

  try {
    const zstd = await getZstd();
    return zstd.compress(data, level);
  } catch (error) {
    if (error instanceof CompressionError) {
      throw error;
    }
    throw new CompressionError(
      `Zstd compression failed: ${error instanceof Error ? error.message : String(error)}`,
      "zstd",
      "compress"
    );
  }
}

/**
 * Decompress Zstd-compressed data
 *
 * @param compressed - Zstd-compressed data
 * @param options - Decompression options
 * @returns Decompressed data
 * @throws {CompressionError} If decompression fails or data is invalid
 *
 * @example
 * ```typescript
 * const compressed = await Bun.file('genome.fasta.zst').arrayBuffer();
 * const data = await decompress(new Uint8Array(compressed));
 * const text = new TextDecoder().decode(data);
 * ```
 */
export async function decompress(
  compressed: Uint8Array,
  options: DecompressorOptions = {}
): Promise<Uint8Array> {
  if (!(compressed instanceof Uint8Array)) {
    throw new CompressionError("Compressed data must be Uint8Array", "zstd", "decompress");
  }

  if (compressed.length === 0) {
    throw new CompressionError("Compressed data must not be empty", "zstd", "decompress");
  }

  const mergedOptions = mergeOptions(options);

  // Validate magic bytes
  if (mergedOptions.validateIntegrity) {
    validateZstdMagic(compressed);
  }

  // Check size limits
  if (compressed.length > mergedOptions.maxOutputSize) {
    throw new CompressionError(
      `Compressed size ${compressed.length} exceeds maximum ${mergedOptions.maxOutputSize}`,
      "zstd",
      "decompress"
    );
  }

  // Check abort signal
  if (mergedOptions.signal?.aborted) {
    throw new CompressionError("Decompression aborted", "zstd", "decompress");
  }

  try {
    const zstd = await getZstd();
    return zstd.decompress(compressed);
  } catch (error) {
    if (error instanceof CompressionError) {
      throw error;
    }
    throw new CompressionError(
      `Zstd decompression failed: ${error instanceof Error ? error.message : String(error)}`,
      "zstd",
      "decompress"
    );
  }
}

/**
 * Create a Zstd decompression TransformStream
 *
 * For streaming decompression of large files. Note that Zstd streaming
 * requires knowing chunk boundaries, so this implementation buffers
 * the entire input before decompressing.
 *
 * For true streaming with large files, consider using the native
 * Rust implementation (when available) or processing in chunks
 * with known boundaries.
 *
 * @param options - Decompression options
 * @returns TransformStream for decompression
 *
 * @example
 * ```typescript
 * const compressedStream = file.stream();
 * const decompressedStream = compressedStream.pipeThrough(createStream());
 * ```
 */
export function createStream(
  options: DecompressorOptions = {}
): TransformStream<Uint8Array, Uint8Array> {
  const mergedOptions = mergeOptions(options);
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, _controller): void {
      // Check abort signal
      if (mergedOptions.signal?.aborted) {
        throw new CompressionError("Decompression aborted", "zstd", "stream");
      }

      // Accumulate chunks (Zstd WASM doesn't support true streaming yet)
      chunks.push(chunk);
      totalLength += chunk.length;

      // Check size limits
      if (totalLength > mergedOptions.maxOutputSize) {
        throw new CompressionError(
          `Input size ${totalLength} exceeds maximum ${mergedOptions.maxOutputSize}`,
          "zstd",
          "stream"
        );
      }
    },

    async flush(controller): Promise<void> {
      if (chunks.length === 0) {
        return;
      }

      // Concatenate all chunks
      const compressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        compressed.set(chunk, offset);
        offset += chunk.length;
      }

      try {
        // Decompress the complete buffer
        // Construct options compatible with decompress signature
        const decompressOptions: DecompressorOptions = {
          bufferSize: mergedOptions.bufferSize,
          maxOutputSize: mergedOptions.maxOutputSize,
          validateIntegrity: mergedOptions.validateIntegrity,
          ...(mergedOptions.signal !== undefined && { signal: mergedOptions.signal }),
        };
        const decompressed = await decompress(compressed, decompressOptions);
        controller.enqueue(decompressed);
      } catch (error) {
        if (error instanceof CompressionError) {
          controller.error(error);
        } else {
          controller.error(
            new CompressionError(
              `Stream decompression failed: ${error instanceof Error ? error.message : String(error)}`,
              "zstd",
              "stream"
            )
          );
        }
      }
    },
  });
}

/**
 * Create a Zstd compression TransformStream
 *
 * @param level - Compression level (1-22, default 3)
 * @returns TransformStream for compression
 *
 * @example
 * ```typescript
 * const dataStream = file.stream();
 * const compressedStream = dataStream.pipeThrough(createCompressionStream(6));
 * ```
 */
export function createCompressionStream(level?: number): TransformStream<Uint8Array, Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, _controller): void {
      chunks.push(chunk);
      totalLength += chunk.length;
    },

    async flush(controller): Promise<void> {
      if (chunks.length === 0) {
        return;
      }

      // Concatenate all chunks
      const data = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }

      try {
        const compressed = await compress(data, level);
        controller.enqueue(compressed);
      } catch (error) {
        if (error instanceof CompressionError) {
          controller.error(error);
        } else {
          controller.error(
            new CompressionError(
              `Stream compression failed: ${error instanceof Error ? error.message : String(error)}`,
              "zstd",
              "stream"
            )
          );
        }
      }
    },
  });
}

/**
 * Wrap a compressed ReadableStream with Zstd decompression
 *
 * @param input - Compressed data stream
 * @param options - Decompression options
 * @returns Decompressed data stream
 *
 * @example
 * ```typescript
 * const compressedStream = await FileReader.createStream('genome.fasta.zst');
 * const decompressed = wrapStream(compressedStream);
 * for await (const chunk of decompressed) {
 *   // Process decompressed data
 * }
 * ```
 */
export function wrapStream(
  input: ReadableStream<Uint8Array>,
  options: DecompressorOptions = {}
): ReadableStream<Uint8Array> {
  if (!(input instanceof ReadableStream)) {
    throw new CompressionError("Input must be ReadableStream", "zstd", "stream");
  }

  return input.pipeThrough(createStream(options));
}

/**
 * Wrap a ReadableStream with Zstd compression
 *
 * @param input - Uncompressed data stream
 * @param level - Compression level (1-22, default 3)
 * @returns Compressed data stream
 */
export function wrapCompressionStream(
  input: ReadableStream<Uint8Array>,
  level?: number
): ReadableStream<Uint8Array> {
  if (!(input instanceof ReadableStream)) {
    throw new CompressionError("Input must be ReadableStream", "zstd", "stream");
  }

  return input.pipeThrough(createCompressionStream(level));
}

/**
 * Namespace export for backward compatibility
 *
 * Provides the same API as the original implementation.
 * New code should use the standalone exported functions directly.
 */
export const ZstdDecompressor = {
  decompress,
  compress,
  createStream,
  createCompressionStream,
  wrapStream,
  wrapCompressionStream,
} as const;
