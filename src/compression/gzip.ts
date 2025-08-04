/**
 * Gzip decompression for genomic files with Bun optimization
 *
 * Provides high-performance gzip decompression optimized for large genomic
 * datasets. Implements both buffer-based and streaming decompression with
 * runtime-specific optimizations for Bun, Node.js, and Deno.
 */

import type { DecompressorOptions, CompressedStream } from '../types';
import { DecompressorOptionsSchema } from '../types';
import { CompressionError } from '../errors';
import {
  detectRuntime,
  getOptimalBufferSize,
  getRuntimeGlobals,
  type Runtime,
} from '../io/runtime';

/**
 * Default options for gzip decompression with genomics-optimized values
 */
const DEFAULT_GZIP_OPTIONS: Required<DecompressorOptions> = {
  bufferSize: 65536, // Will be overridden by runtime detection
  maxOutputSize: 10_737_418_240, // 10GB safety limit for genomic files
  onProgress: () => {},
  signal: new AbortController().signal,
  validateIntegrity: true,
};

/**
 * High-performance Gzip decompressor with runtime optimizations
 *
 * Implements Tiger Style patterns with comprehensive error handling and
 * memory safety. Provides both synchronous buffer decompression and
 * streaming decompression for large genomic files.
 *
 * @example Buffer decompression for small files
 * ```typescript
 * const compressed = await fs.readFile('sequences.fasta.gz');
 * const decompressed = await GzipDecompressor.decompress(compressed);
 * console.log(`Decompressed ${decompressed.length} bytes`);
 * ```
 *
 * @example Streaming decompression for large files
 * ```typescript
 * const compressedStream = await FileReader.createStream('genome.fasta.gz');
 * const decompressed = GzipDecompressor.wrapStream(compressedStream);
 *
 * for await (const chunk of decompressed) {
 *   console.log(`Processing ${chunk.length} bytes`);
 * }
 * ```
 *
 * @example Transform stream for pipeline processing
 * ```typescript
 * const transform = GzipDecompressor.createStream({
 *   bufferSize: 1024 * 1024, // 1MB buffer for large genomic files
 *   onProgress: (bytes) => console.log(`Processed ${bytes} bytes`)
 * });
 *
 * const pipeline = compressedStream.pipeThrough(transform);
 * ```
 */
export class GzipDecompressor {
  /**
   * Decompress entire gzip buffer in memory
   *
   * Optimized for small to medium genomic files that can fit in memory.
   * Uses runtime-specific native APIs when available for best performance.
   *
   * @param compressed Gzip-compressed data buffer
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
    // Tiger Style: Assert function arguments with explicit validation
    console.assert(compressed instanceof Uint8Array, 'compressed must be Uint8Array');
    console.assert(compressed.length > 0, 'compressed data must not be empty');

    if (!(compressed instanceof Uint8Array)) {
      throw new CompressionError('Compressed data must be Uint8Array', 'gzip', 'decompress');
    }
    if (compressed.length === 0) {
      throw new CompressionError('Compressed data must not be empty', 'gzip', 'decompress');
    }

    const runtime = detectRuntime();
    const mergedOptions = this.mergeOptions(options, runtime);
    let bytesProcessed = 0;

    try {
      // Validate gzip magic bytes
      if (compressed.length < 2 || compressed[0] !== 0x1f || compressed[1] !== 0x8b) {
        throw new CompressionError(
          'Invalid gzip magic bytes - file may not be gzip compressed',
          'gzip',
          'decompress',
          0
        );
      }

      // Check size limits before decompression
      if (compressed.length > mergedOptions.maxOutputSize) {
        throw new CompressionError(
          `Compressed size ${compressed.length} exceeds maximum ${mergedOptions.maxOutputSize}`,
          'gzip',
          'decompress',
          0
        );
      }

      // Bun optimization: Use native gunzipSync for superior performance
      if (runtime === 'bun') {
        const { Bun } = getRuntimeGlobals('bun');
        if (Bun && typeof (Bun as any).gunzipSync === 'function') {
          const result = (Bun as any).gunzipSync(compressed);
          bytesProcessed = compressed.length;

          // Progress callback
          if (mergedOptions.onProgress) {
            mergedOptions.onProgress(bytesProcessed, compressed.length);
          }

          return new Uint8Array(result);
        }
      }

      // Node.js optimization: Use built-in zlib
      if (runtime === 'node') {
        const { gunzip } = await import('zlib');
        const { promisify } = await import('util');
        const gunzipAsync = promisify(gunzip);

        const result = await gunzipAsync(Buffer.from(compressed));
        bytesProcessed = compressed.length;

        // Progress callback
        if (mergedOptions.onProgress) {
          mergedOptions.onProgress(bytesProcessed, compressed.length);
        }

        return new Uint8Array(result);
      }

      // Fallback to streaming decompression for other runtimes
      return await this.decompressViaStream(compressed, mergedOptions);
    } catch (error) {
      throw CompressionError.fromSystemError('gzip', 'decompress', error, bytesProcessed);
    }
  }

  /**
   * Create gzip decompression transform stream
   *
   * Returns a TransformStream that can be used in streaming pipelines
   * for processing large genomic files without loading everything into memory.
   *
   * @param options Optional decompression configuration
   * @returns TransformStream for gzip decompression
   * @throws {CompressionError} If stream creation fails
   *
   * Tiger Style: Function must not exceed 70 lines, minimum 2 assertions
   */
  static createStream(options: DecompressorOptions = {}): TransformStream<Uint8Array, Uint8Array> {
    // Tiger Style: Assert function arguments
    console.assert(typeof options === 'object', 'options must be an object');
    console.assert(
      options.signal instanceof AbortSignal || !options.signal,
      'signal must be AbortSignal if provided'
    );

    const runtime = detectRuntime();
    const mergedOptions = this.mergeOptions(options, runtime);
    let bytesProcessed = 0;
    let decompressor: any = null;
    let initialized = false;

    return new TransformStream({
      start(controller) {
        try {
          // Initialize runtime-specific decompressor
          if (runtime === 'node') {
            const zlib = getRuntimeGlobals('node')?.stream || require('zlib');
            decompressor = zlib.createGunzip({
              chunkSize: mergedOptions.bufferSize,
            });

            decompressor.on('data', (chunk: Buffer) => {
              controller.enqueue(new Uint8Array(chunk));
            });

            decompressor.on('error', (error: Error) => {
              controller.error(
                CompressionError.fromSystemError('gzip', 'stream', error, bytesProcessed)
              );
            });
          } else {
            // For Deno and fallback cases, use DecompressionStream if available
            if (typeof DecompressionStream !== 'undefined') {
              decompressor = new DecompressionStream('gzip');
            } else {
              throw new CompressionError(
                'No gzip decompression support available in this runtime',
                'gzip',
                'stream'
              );
            }
          }

          initialized = true;
        } catch (error) {
          controller.error(CompressionError.fromSystemError('gzip', 'stream', error));
        }
      },

      transform(chunk, controller) {
        if (!initialized) {
          controller.error(new CompressionError('Decompressor not initialized', 'gzip', 'stream'));
          return;
        }

        try {
          bytesProcessed += chunk.length;

          // Check abort signal
          if (mergedOptions.signal?.aborted) {
            controller.error(
              new CompressionError('Decompression aborted', 'gzip', 'stream', bytesProcessed)
            );
            return;
          }

          // Progress callback
          if (mergedOptions.onProgress) {
            mergedOptions.onProgress(bytesProcessed);
          }

          if (runtime === 'node' && decompressor) {
            decompressor.write(chunk);
          } else if (decompressor instanceof DecompressionStream) {
            // For web-compatible runtimes
            const writer = decompressor.writable.getWriter();
            writer.write(chunk);
            writer.releaseLock();
          }
        } catch (error) {
          controller.error(
            CompressionError.fromSystemError('gzip', 'stream', error, bytesProcessed)
          );
        }
      },

      flush(controller) {
        try {
          if (runtime === 'node' && decompressor) {
            decompressor.end();
          }
          controller.terminate();
        } catch (error) {
          controller.error(
            CompressionError.fromSystemError('gzip', 'stream', error, bytesProcessed)
          );
        }
      },
    });
  }

  /**
   * Wrap compressed readable stream with gzip decompression
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
      throw new CompressionError('Input must be ReadableStream', 'gzip', 'stream');
    }

    try {
      const transform = this.createStream(options);
      return input.pipeThrough(transform);
    } catch (error) {
      throw CompressionError.fromSystemError('gzip', 'stream', error);
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
      ...DEFAULT_GZIP_OPTIONS,
      bufferSize: getOptimalBufferSize(runtime),
    };

    const merged = { ...defaults, ...options };

    // Validate merged options
    try {
      DecompressorOptionsSchema(merged);
    } catch (error) {
      throw new CompressionError(
        `Invalid decompressor options: ${error instanceof Error ? error.message : String(error)}`,
        'gzip',
        'validate'
      );
    }

    return merged;
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

    // Create a readable stream from the buffer
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(compressed);
        controller.close();
      },
    });

    // Use transform stream to decompress
    const transform = this.createStream(options);
    const decompressedStream = stream.pipeThrough(transform);

    // Collect all chunks
    const chunks: Uint8Array[] = [];
    const reader = decompressedStream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Combine chunks into single buffer
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;

      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      return result;
    } finally {
      reader.releaseLock();
    }
  }
}
