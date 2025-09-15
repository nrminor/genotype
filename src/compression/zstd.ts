/**
 * Zstandard decompression for genomic files with streaming support
 *
 * Provides high-performance Zstandard decompression optimized for genomic
 * datasets. Zstd offers superior compression ratios and speed compared to gzip,
 * making it increasingly popular for large-scale genomic data storage.
 */

import { CompressionError } from "../errors";
import {
  detectRuntime,
  getOptimalBufferSize,
  getRuntimeGlobals,
  type Runtime,
} from "../io/runtime";
import type { DecompressorOptions } from "../types";
import { DecompressorOptionsSchema } from "../types";

/**
 * Default options for Zstd decompression with genomics-optimized values
 */
const DEFAULT_ZSTD_OPTIONS = {
  bufferSize: 131072, // 128KB - Zstd works well with larger buffers
  maxOutputSize: 10_737_418_240, // 10GB safety limit for genomic files
  signal: new AbortController().signal,
  validateIntegrity: true,
};

/**
 * Zstd magic number for format validation
 */
// Constants for Zstd magic bytes
const ZSTD_MAGIC_BYTE1 = 0x28;
const ZSTD_MAGIC_BYTE2 = 0xb5;
const ZSTD_MAGIC_BYTE3 = 0x2f;
const ZSTD_MAGIC_BYTE4 = 0xfd;

const ZSTD_MAGIC_NUMBER = new Uint8Array([
  ZSTD_MAGIC_BYTE1,
  ZSTD_MAGIC_BYTE2,
  ZSTD_MAGIC_BYTE3,
  ZSTD_MAGIC_BYTE4,
]);

// Helper functions (not exported)
export async function decompress(
  compressed: Uint8Array,
  options: DecompressorOptions = {}
): Promise<Uint8Array> {
  validateCompressedData(compressed);

  const runtime = detectRuntime();
  const mergedOptions = mergeOptions(options, runtime);

  try {
    validateZstdFormat(compressed);
    checkSizeLimits(compressed, mergedOptions);

    return await performDecompression(compressed, mergedOptions, runtime);
  } catch (error) {
    throw CompressionError.fromSystemError("zstd", "decompress", error, 0);
  }
}

/**
 * Create Zstd decompression transform stream
 *
 * Returns a TransformStream that can be used in streaming pipelines
 * for processing large genomic files without loading everything into memory.
 * Optimized for Zstd's frame-based structure.
 *
 * @param options Optional decompression configuration
 * @returns TransformStream for Zstd decompression
 * @throws {CompressionError} If stream creation fails
 *
 * @example Transform stream with progress tracking
 * ```typescript
 * const transform = createStream({
 *   bufferSize: 512 * 1024, // 512KB buffer for optimal Zstd performance
 *   onProgress: (bytes, total) => {
 *     console.log(`Decompressed ${bytes}/${total} bytes (${(bytes/total*100).toFixed(1)}%)`);
 *   }
 * });
 * ```
 *
 */
function initializeZstdDecompressor(
  controller: any,
  runtime: Runtime,
  mergedOptions: Required<DecompressorOptions>,
  state: {
    bytesProcessed: number;
    decompressor: unknown;
    initialized: boolean;
  }
): void {
  try {
    // Initialize runtime-specific decompressor
    if (runtime === "node") {
      // Try Node.js native Zstd support
      import("zlib")
        .then((zlib) => {
          if (zlib.createZstdDecompress !== undefined) {
            state.decompressor = zlib.createZstdDecompress({
              chunkSize: mergedOptions.bufferSize,
            });

            const decompStream = state.decompressor as {
              on: (event: string, callback: (arg: unknown) => void) => void;
            };
            decompStream.on("data", (chunk: unknown) => {
              controller.enqueue(new Uint8Array(chunk as Buffer));
            });

            decompStream.on("error", (error: unknown) => {
              controller.error(
                CompressionError.fromSystemError("zstd", "stream", error, state.bytesProcessed)
              );
            });

            state.initialized = true;
          } else {
            // Fallback to manual streaming decompression
            state.initialized = true;
          }
        })
        .catch(() => {
          state.initialized = true; // Use manual implementation
        });
    } else {
      // For Deno and other runtimes, check for DecompressionStream
      if (typeof DecompressionStream !== "undefined") {
        try {
          state.decompressor = new DecompressionStream("deflate-raw"); // Fallback approach
          state.initialized = true;
        } catch {
          // Manual implementation fallback
          state.initialized = true;
        }
      } else {
        state.initialized = true; // Use manual implementation
      }
    }
  } catch (error) {
    controller.error(CompressionError.fromSystemError("zstd", "stream", error));
  }
}

function processZstdChunk(
  chunk: Uint8Array,
  controller: any,
  runtime: Runtime,
  mergedOptions: Required<DecompressorOptions>,
  state: {
    bytesProcessed: number;
    decompressor: unknown;
    initialized: boolean;
    buffer: Uint8Array;
  }
): void {
  if (!state.initialized) {
    controller.error(new CompressionError("Decompressor not initialized", "zstd", "stream"));
    return;
  }

  try {
    state.bytesProcessed += chunk.length;

    // Check abort signal
    if (mergedOptions.signal?.aborted) {
      controller.error(
        new CompressionError("Decompression aborted", "zstd", "stream", state.bytesProcessed)
      );
      return;
    }

    // Progress tracking removed - users can implement their own

    if (runtime === "node" && state.decompressor !== null) {
      const nodeStream = state.decompressor as {
        write?: (chunk: Uint8Array) => void;
      };
      if (nodeStream.write !== undefined) {
        nodeStream.write(chunk);
      }
    } else {
      // Manual decompression - accumulate data for frame processing
      const newBuffer = new Uint8Array(state.buffer.length + chunk.length);
      newBuffer.set(state.buffer);
      newBuffer.set(chunk, state.buffer.length);
      state.buffer = newBuffer;

      // Process complete Zstd frames when available
      processZstdFrames(state.buffer, controller);
    }
  } catch (error) {
    controller.error(
      CompressionError.fromSystemError("zstd", "stream", error, state.bytesProcessed)
    );
  }
}

export function createStream(
  options: DecompressorOptions = {}
): TransformStream<Uint8Array, Uint8Array> {
  if (typeof options !== "object" || options === null) {
    throw new CompressionError("Options must be an object", "zstd", "stream");
  }
  if (options.signal && !(options.signal instanceof AbortSignal)) {
    throw new CompressionError("Signal must be AbortSignal if provided", "zstd", "stream");
  }

  const runtime = detectRuntime();
  const mergedOptions = mergeOptions(options, runtime);
  const state = {
    bytesProcessed: 0,
    decompressor: null as unknown,
    initialized: false,
    buffer: new Uint8Array(0),
  };

  return new TransformStream({
    start(controller): void {
      initializeZstdDecompressor(controller, runtime, mergedOptions, state);
    },

    transform(chunk, controller): void {
      processZstdChunk(chunk, controller, runtime, mergedOptions, state);
    },

    flush(controller): void {
      try {
        if (runtime === "node" && state.decompressor !== null) {
          const nodeStream = state.decompressor as { end?: () => void };
          if (nodeStream.end !== undefined) {
            nodeStream.end();
          }
        } else if (state.buffer.length > 0) {
          // Process any remaining data
          processZstdFrames(state.buffer, controller, true);
        }
        controller.terminate();
      } catch (error) {
        controller.error(
          CompressionError.fromSystemError("zstd", "stream", error, state.bytesProcessed)
        );
      }
    },
  });
}

/**
 * Wrap compressed readable stream with Zstd decompression
 *
 * Takes a stream of compressed data and returns a stream of decompressed data.
 * Optimized for large genomic files with proper backpressure handling.
 *
 * @param input Compressed data stream
 * @param options Optional decompression configuration
 * @returns Decompressed data stream
 * @throws {CompressionError} If stream wrapping fails
 *
 * @example Streaming decompression for large files
 * ```typescript
 * const compressedStream = await FileReader.createStream('genome.fasta.zst');
 * const decompressed = wrapStream(compressedStream);
 * for await (const chunk of decompressed) {
 *   console.log(`Processing ${chunk.length} bytes of genomic data`);
 * }
 * ```
 *
 */
export function wrapStream(
  input: ReadableStream<Uint8Array>,
  options: DecompressorOptions = {}
): ReadableStream<Uint8Array> {
  if (!(input instanceof ReadableStream)) {
    throw new CompressionError("Input must be ReadableStream", "zstd", "stream");
  }

  try {
    const transform = createStream(options);
    return input.pipeThrough(transform);
  } catch (error) {
    throw CompressionError.fromSystemError("zstd", "stream", error);
  }
}

/**
 * Backward compatibility namespace export
 *
 * Provides the same API as the original static class for existing code.
 * New code should use the standalone exported functions directly.
 */
export const ZstdDecompressor = {
  decompress,
  createStream,
  wrapStream,
} as const;

// =============================================================================
// PRIVATE HELPER FUNCTIONS
// =============================================================================

function validateCompressedData(compressed: Uint8Array): void {
  if (!(compressed instanceof Uint8Array)) {
    throw new CompressionError("Compressed data must be Uint8Array", "zstd", "decompress");
  }
  if (compressed.length === 0) {
    throw new CompressionError("Compressed data must not be empty", "zstd", "decompress");
  }
}

function validateZstdFormat(compressed: Uint8Array): void {
  if (compressed.length < 4) {
    throw new CompressionError("File too small to be valid Zstd format", "zstd", "decompress", 0);
  }

  const hasValidMagic = ZSTD_MAGIC_NUMBER.every((byte, index) => compressed[index] === byte);
  if (!hasValidMagic) {
    throw new CompressionError(
      "Invalid Zstd magic bytes - file may not be Zstd compressed",
      "zstd",
      "decompress",
      0
    );
  }
}

function checkSizeLimits(compressed: Uint8Array, options: Required<DecompressorOptions>): void {
  if (compressed.length > options.maxOutputSize) {
    throw new CompressionError(
      `Compressed size ${compressed.length} exceeds maximum ${options.maxOutputSize}`,
      "zstd",
      "decompress",
      0
    );
  }
}

async function performDecompression(
  compressed: Uint8Array,
  options: Required<DecompressorOptions>,
  runtime: Runtime
): Promise<Uint8Array> {
  // Bun optimization: Check for native Zstd support
  if (runtime === "bun") {
    const bunResult = await decompressWithBun(compressed);
    if (bunResult) {
      return bunResult;
    }
  }

  // Node.js optimization: Use built-in zlib
  if (runtime === "node") {
    const nodeResult = await decompressWithNode(compressed);
    if (nodeResult) {
      return nodeResult;
    }
  }

  // Fallback to streaming decompression for other runtimes
  return await decompressViaStream(compressed, options);
}

async function decompressWithBun(_compressed: Uint8Array): Promise<Uint8Array | null> {
  const { Bun } = getRuntimeGlobals("bun") as { Bun: any };
  const bunHasMethod = Boolean(Bun) && "inflateSync" in Bun;
  if (!bunHasMethod) {
    return null;
  }

  try {
    // Note: Bun currently doesn't have direct zstd support
    // This is a placeholder for future compatibility
    return null;
  } catch {
    return null;
  }
}

async function decompressWithNode(compressed: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { createZstdDecompress } = await import("zlib");
    if (createZstdDecompress === undefined) {
      return null;
    }

    const { promisify } = await import("util");
    const { pipeline } = await import("stream");
    const pipelineAsync = promisify(pipeline);

    // Create streams for decompression
    const readable = new (await import("stream")).Readable({
      read(): void {
        this.push(compressed);
        this.push(null);
      },
    });

    const chunks: Buffer[] = [];
    const writable = new (await import("stream")).Writable({
      write(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void
      ): void {
        chunks.push(chunk);
        callback();
      },
    });

    await pipelineAsync(readable, createZstdDecompress(), writable);

    const result = Buffer.concat(chunks);

    return new Uint8Array(result);
  } catch {
    return null;
  }
}

function mergeOptions(
  options: DecompressorOptions,
  runtime: Runtime
): DecompressorOptions & typeof DEFAULT_ZSTD_OPTIONS {
  const defaults = {
    ...DEFAULT_ZSTD_OPTIONS,
    bufferSize: getOptimalBufferSize(runtime) * 2, // Zstd works better with larger buffers
  };

  const merged = { ...defaults, ...options };

  // Validate merged options
  try {
    DecompressorOptionsSchema(merged);
  } catch (error) {
    throw new CompressionError(
      `Invalid decompressor options: ${error instanceof Error ? error.message : String(error)}`,
      "zstd",
      "validate"
    );
  }

  return merged;
}

function processZstdFrames(
  buffer: Uint8Array,
  controller: TransformStreamDefaultController<Uint8Array>,
  flush = false
): void {
  // This is a simplified implementation - in production, you'd want
  // to use a proper Zstd decompression library like @mongodb-js/zstd

  if (!flush && buffer.length < 8) {
    return; // Need more data to process a frame
  }

  // For now, throw an error indicating native support is needed
  controller.error(
    new CompressionError(
      "Manual Zstd decompression not implemented - native library support required",
      "zstd",
      "stream"
    )
  );
}

async function decompressViaStream(
  _compressed: Uint8Array,
  _options: Required<DecompressorOptions>
): Promise<Uint8Array> {
  // This would require a WebAssembly Zstd implementation or external library
  // For now, throw an informative error
  throw new CompressionError(
    "Zstd decompression requires native library support. Consider using gzip compression instead, or install a Zstd library.",
    "zstd",
    "decompress"
  );
}

/**
 * Decompress entire Zstd buffer in memory
 *
 * Optimized for small to medium genomic files that can fit in memory.
 * Uses runtime-specific native APIs when available for best performance.
 *
 * @param compressed Zstd-compressed data buffer
 * @param options Optional decompression configuration
 * @returns Promise resolving to decompressed data
 * @throws {CompressionError} If decompression fails or data is invalid
 *
 * @example Buffer decompression for small files
 * ```typescript
 * const compressed = await fs.readFile('variants.vcf.zst');
 * const decompressed = await decompress(compressed);
 * console.log(`Decompressed ${decompressed.length} bytes`);
 * ```
 *
 */
