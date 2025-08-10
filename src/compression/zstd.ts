/**
 * Zstandard decompression for genomic files with streaming support
 *
 * Provides high-performance Zstandard decompression optimized for genomic
 * datasets. Zstd offers superior compression ratios and speed compared to gzip,
 * making it increasingly popular for large-scale genomic data storage.
 */

import type { DecompressorOptions } from '../types';
import { DecompressorOptionsSchema } from '../types';
import { CompressionError } from '../errors';
import {
  detectRuntime,
  getOptimalBufferSize,
  getRuntimeGlobals,
  type Runtime,
} from '../io/runtime';

/**
 * Default options for Zstd decompression with genomics-optimized values
 */
const DEFAULT_ZSTD_OPTIONS: Required<DecompressorOptions> = {
  bufferSize: 131072, // 128KB - Zstd works well with larger buffers
  maxOutputSize: 10_737_418_240, // 10GB safety limit for genomic files
  onProgress: () => {},
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

/**
 * High-performance Zstandard decompressor with streaming support
 *
 * Implements Tiger Style patterns with comprehensive error handling and
 * memory safety. Provides both synchronous buffer decompression and
 * streaming decompression optimized for genomic data processing.
 *
 * @example Buffer decompression for small files
 * ```typescript
 * const compressed = await fs.readFile('variants.vcf.zst');
 * const decompressed = await ZstdDecompressor.decompress(compressed);
 * console.log(`Decompressed ${decompressed.length} bytes`);
 * ```
 *
 * @example Streaming decompression for large files
 * ```typescript
 * const compressedStream = await FileReader.createStream('genome.fasta.zst');
 * const decompressed = ZstdDecompressor.wrapStream(compressedStream);
 *
 * for await (const chunk of decompressed) {
 *   console.log(`Processing ${chunk.length} bytes of genomic data`);
 * }
 * ```
 *
 * @example Transform stream with progress tracking
 * ```typescript
 * const transform = ZstdDecompressor.createStream({
 *   bufferSize: 512 * 1024, // 512KB buffer for optimal Zstd performance
 *   onProgress: (bytes, total) => {
 *     console.log(`Decompressed ${bytes}/${total} bytes (${(bytes/total*100).toFixed(1)}%)`);
 *   }
 * });
 * ```
 */
export class ZstdDecompressor {
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
   * Tiger Style: Function must not exceed 70 lines, minimum 2 assertions
   */
  static async decompress(
    compressed: Uint8Array,
    options: DecompressorOptions = {}
  ): Promise<Uint8Array> {
    ZstdDecompressor.validateCompressedData(compressed);

    const runtime = detectRuntime();
    const mergedOptions = ZstdDecompressor.mergeOptions(options, runtime);

    try {
      ZstdDecompressor.validateZstdFormat(compressed);
      ZstdDecompressor.checkSizeLimits(compressed, mergedOptions);

      return await ZstdDecompressor.performDecompression(compressed, mergedOptions, runtime);
    } catch (error) {
      throw CompressionError.fromSystemError('zstd', 'decompress', error, 0);
    }
  }

  /**
   * Validate compressed data input
   */
  private static validateCompressedData(compressed: Uint8Array): void {
    if (!(compressed instanceof Uint8Array)) {
      throw new CompressionError('Compressed data must be Uint8Array', 'zstd', 'decompress');
    }
    if (compressed.length === 0) {
      throw new CompressionError('Compressed data must not be empty', 'zstd', 'decompress');
    }
  }

  /**
   * Validate Zstd format magic bytes
   */
  private static validateZstdFormat(compressed: Uint8Array): void {
    if (compressed.length < 4) {
      throw new CompressionError('File too small to be valid Zstd format', 'zstd', 'decompress', 0);
    }

    const hasValidMagic = ZSTD_MAGIC_NUMBER.every((byte, index) => compressed[index] === byte);
    if (!hasValidMagic) {
      throw new CompressionError(
        'Invalid Zstd magic bytes - file may not be Zstd compressed',
        'zstd',
        'decompress',
        0
      );
    }
  }

  /**
   * Check size limits before decompression
   */
  private static checkSizeLimits(
    compressed: Uint8Array,
    options: Required<DecompressorOptions>
  ): void {
    if (compressed.length > options.maxOutputSize) {
      throw new CompressionError(
        `Compressed size ${compressed.length} exceeds maximum ${options.maxOutputSize}`,
        'zstd',
        'decompress',
        0
      );
    }
  }

  /**
   * Perform runtime-optimized decompression
   */
  private static async performDecompression(
    compressed: Uint8Array,
    options: Required<DecompressorOptions>,
    runtime: Runtime
  ): Promise<Uint8Array> {
    // Bun optimization: Check for native Zstd support
    if (runtime === 'bun') {
      const bunResult = await ZstdDecompressor.decompressWithBun(compressed);
      if (bunResult) {
        return bunResult;
      }
    }

    // Node.js optimization: Use built-in zlib
    if (runtime === 'node') {
      const nodeResult = await ZstdDecompressor.decompressWithNode(compressed);
      if (nodeResult) {
        return nodeResult;
      }
    }

    // Fallback to streaming decompression for other runtimes
    return await ZstdDecompressor.decompressViaStream(compressed, options);
  }

  /**
   * Attempt decompression using Bun's native support (future compatibility)
   */
  private static async decompressWithBun(compressed: Uint8Array): Promise<Uint8Array | null> {
    const { Bun } = getRuntimeGlobals('bun');
    const bunHasMethod = Boolean(Bun) && 'inflateSync' in Bun;
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

  /**
   * Decompress using Node.js built-in zlib (Node 19+)
   */
  private static async decompressWithNode(compressed: Uint8Array): Promise<Uint8Array | null> {
    try {
      const { createZstdDecompress } = await import('zlib');
      if (!createZstdDecompress) {
        return null;
      }

      const { promisify } = await import('util');
      const { pipeline } = await import('stream');
      const pipelineAsync = promisify(pipeline);

      // Create streams for decompression
      const readable = new (await import('stream')).Readable({
        read(): void {
          this.push(compressed);
          this.push(null);
        },
      });

      const chunks: Buffer[] = [];
      const writable = new (await import('stream')).Writable({
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
   * Tiger Style: Function must not exceed 70 lines, minimum 2 assertions
   */
  static createStream(options: DecompressorOptions = {}): TransformStream<Uint8Array, Uint8Array> {
    if (typeof options !== 'object' || options === null) {
      throw new CompressionError('Options must be an object', 'zstd', 'stream');
    }
    if (options.signal && !(options.signal instanceof AbortSignal)) {
      throw new CompressionError('Signal must be AbortSignal if provided', 'zstd', 'stream');
    }

    const runtime = detectRuntime();
    const mergedOptions = ZstdDecompressor.mergeOptions(options, runtime);
    let bytesProcessed = 0;
    let decompressor: unknown = null;
    let initialized = false;
    let buffer = new Uint8Array(0);

    return new TransformStream({
      start(controller): void {
        try {
          // Initialize runtime-specific decompressor
          if (runtime === 'node') {
            // Try Node.js native Zstd support
            import('zlib')
              .then((zlib) => {
                if (zlib.createZstdDecompress) {
                  decompressor = zlib.createZstdDecompress({
                    chunkSize: mergedOptions.bufferSize,
                  });

                  const decompStream = decompressor as {
                    on: (event: string, callback: (arg: unknown) => void) => void;
                  };
                  decompStream.on('data', (chunk: unknown) => {
                    controller.enqueue(new Uint8Array(chunk as Buffer));
                  });

                  decompStream.on('error', (error: unknown) => {
                    controller.error(
                      CompressionError.fromSystemError('zstd', 'stream', error, bytesProcessed)
                    );
                  });

                  initialized = true;
                } else {
                  // Fallback to manual streaming decompression
                  initialized = true;
                }
              })
              .catch(() => {
                initialized = true; // Use manual implementation
              });
          } else {
            // For Deno and other runtimes, check for DecompressionStream
            if (typeof DecompressionStream !== 'undefined') {
              try {
                decompressor = new DecompressionStream('deflate-raw'); // Fallback approach
                initialized = true;
              } catch {
                // Manual implementation fallback
                initialized = true;
              }
            } else {
              initialized = true; // Use manual implementation
            }
          }
        } catch (error) {
          controller.error(CompressionError.fromSystemError('zstd', 'stream', error));
        }
      },

      transform(chunk, controller): void {
        if (!initialized) {
          controller.error(new CompressionError('Decompressor not initialized', 'zstd', 'stream'));
          return;
        }

        try {
          bytesProcessed += chunk.length;

          // Check abort signal
          if (mergedOptions.signal?.aborted) {
            controller.error(
              new CompressionError('Decompression aborted', 'zstd', 'stream', bytesProcessed)
            );
            return;
          }

          // Progress callback
          if (mergedOptions.onProgress) {
            mergedOptions.onProgress(bytesProcessed);
          }

          if (runtime === 'node' && decompressor) {
            const nodeStream = decompressor as { write?: (chunk: Uint8Array) => void };
            if (nodeStream.write) {
              nodeStream.write(chunk);
            }
          } else {
            // Manual decompression - accumulate data for frame processing
            const newBuffer = new Uint8Array(buffer.length + chunk.length);
            newBuffer.set(buffer);
            newBuffer.set(chunk, buffer.length);
            buffer = newBuffer;

            // Process complete Zstd frames when available
            ZstdDecompressor.processZstdFrames(buffer, controller);
          }
        } catch (error) {
          controller.error(
            CompressionError.fromSystemError('zstd', 'stream', error, bytesProcessed)
          );
        }
      },

      flush(controller): void {
        try {
          if (runtime === 'node' && decompressor) {
            const nodeStream = decompressor as { end?: () => void };
            if (nodeStream.end) {
              nodeStream.end();
            }
          } else if (buffer.length > 0) {
            // Process any remaining data
            ZstdDecompressor.processZstdFrames(buffer, controller, true);
          }
          controller.terminate();
        } catch (error) {
          controller.error(
            CompressionError.fromSystemError('zstd', 'stream', error, bytesProcessed)
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
   * Tiger Style: Function must not exceed 70 lines, minimum 2 assertions
   */
  static wrapStream(
    input: ReadableStream<Uint8Array>,
    options: DecompressorOptions = {}
  ): ReadableStream<Uint8Array> {
    // Tiger Style: Assert function arguments
    console.assert(input instanceof ReadableStream, 'input must be ReadableStream');
    console.assert(typeof options === 'object', 'options must be an object');

    if (!(input instanceof ReadableStream)) {
      throw new CompressionError('Input must be ReadableStream', 'zstd', 'stream');
    }

    try {
      const transform = ZstdDecompressor.createStream(options);
      return input.pipeThrough(transform);
    } catch (error) {
      throw CompressionError.fromSystemError('zstd', 'stream', error);
    }
  }

  /**
   * Merge user options with runtime-optimized defaults
   */
  private static mergeOptions(
    options: DecompressorOptions,
    runtime: Runtime
  ): Required<DecompressorOptions> {
    // Tiger Style: Assert function arguments
    console.assert(typeof options === 'object', 'options must be an object');
    console.assert(['node', 'deno', 'bun'].includes(runtime), 'runtime must be valid');

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
        'zstd',
        'validate'
      );
    }

    return merged;
  }

  /**
   * Process Zstd frames manually when native support unavailable
   */
  private static processZstdFrames(
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
        'Manual Zstd decompression not implemented - native library support required',
        'zstd',
        'stream'
      )
    );
  }

  /**
   * Fallback streaming decompression for runtimes without native support
   */
  private static async decompressViaStream(
    compressed: Uint8Array,
    options: Required<DecompressorOptions>
  ): Promise<Uint8Array> {
    console.assert(compressed instanceof Uint8Array, 'compressed must be Uint8Array');
    console.assert(typeof options === 'object', 'options must be an object');

    // This would require a WebAssembly Zstd implementation or external library
    // For now, throw an informative error
    throw new CompressionError(
      'Zstd decompression requires native library support. Consider using gzip compression instead, or install a Zstd library.',
      'zstd',
      'decompress'
    );
  }
}
