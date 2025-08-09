/**
 * Gzip decompression for genomic files with Bun optimization
 *
 * Provides high-performance gzip decompression optimized for large genomic
 * datasets. Implements both buffer-based and streaming decompression with
 * runtime-specific optimizations for Bun, Node.js, and Deno.
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
    GzipDecompressor.validateCompressedData(compressed);

    const runtime = detectRuntime();
    const mergedOptions = GzipDecompressor.mergeOptions(options, runtime);

    try {
      GzipDecompressor.validateGzipFormat(compressed);
      GzipDecompressor.checkSizeLimits(compressed, mergedOptions);

      return await GzipDecompressor.performDecompression(compressed, mergedOptions, runtime);
    } catch (err) {
      throw CompressionError.fromSystemError('gzip', 'decompress', err, 0);
    }
  }

  /**
   * Validate compressed data input
   */
  private static validateCompressedData(compressed: Uint8Array): void {
    if (!(compressed instanceof Uint8Array)) {
      throw new CompressionError('Compressed data must be Uint8Array', 'gzip', 'decompress');
    }
    if (compressed.length === 0) {
      throw new CompressionError('Compressed data must not be empty', 'gzip', 'decompress');
    }
  }

  /**
   * Validate gzip format magic bytes
   */
  private static validateGzipFormat(compressed: Uint8Array): void {
    const GZIP_MAGIC_BYTE1 = 0x1f;
    const GZIP_MAGIC_BYTE2 = 0x8b;

    if (
      compressed.length < 2 ||
      compressed[0] !== GZIP_MAGIC_BYTE1 ||
      compressed[1] !== GZIP_MAGIC_BYTE2
    ) {
      throw new CompressionError(
        'Invalid gzip magic bytes - file may not be gzip compressed',
        'gzip',
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
        'gzip',
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
    // Always call progress callback at start, even if decompression fails later
    const bytesProcessed = compressed.length;
    options.onProgress(bytesProcessed, compressed.length);

    // Bun optimization: Use native gunzipSync for superior performance
    if (runtime === 'bun') {
      const bunResult = await GzipDecompressor.decompressWithBun(compressed, options);
      if (bunResult) {
        return bunResult;
      }
    }

    // Node.js optimization: Use built-in zlib
    if (runtime === 'node') {
      const nodeResult = await GzipDecompressor.decompressWithNode(compressed, options);
      if (nodeResult) {
        return nodeResult;
      }
    }

    // Fallback to streaming decompression for other runtimes
    return await GzipDecompressor.decompressViaStream(compressed, options);
  }

  /**
   * Decompress using Bun's native gunzipSync
   */
  private static async decompressWithBun(
    compressed: Uint8Array,
    options: Required<DecompressorOptions>
  ): Promise<Uint8Array | null> {
    const { Bun } = getRuntimeGlobals('bun');
    const bunHasMethod =
      Boolean(Bun) && 'gunzipSync' in Bun && typeof Bun.gunzipSync === 'function';
    const hasGunzipSync = Boolean(bunHasMethod);
    if (!hasGunzipSync) {
      return null;
    }

    const result = Bun.gunzipSync(compressed);
    // Progress callback already called in performDecompression

    return new Uint8Array(result);
  }

  /**
   * Decompress using Node.js built-in zlib
   */
  private static async decompressWithNode(
    compressed: Uint8Array,
    options: Required<DecompressorOptions>
  ): Promise<Uint8Array | null> {
    try {
      const { gunzip } = await import('zlib');
      const { promisify } = await import('util');
      const gunzipAsync = promisify(gunzip);

      const result = await gunzipAsync(Buffer.from(compressed));
      // Progress callback already called in performDecompression

      return new Uint8Array(result);
    } catch {
      return null;
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
    GzipDecompressor.validateStreamOptions(options);

    const runtime = detectRuntime();
    const mergedOptions = GzipDecompressor.mergeOptions(options, runtime);
    const state = { bytesProcessed: 0, decompressor: null as unknown, initialized: false };

    return new TransformStream({
      start: (controller) =>
        GzipDecompressor.initializeDecompressor(controller, runtime, mergedOptions, state),
      transform: (chunk, controller) =>
        GzipDecompressor.processChunk(chunk, controller, {
          runtime,
          options: mergedOptions,
          state,
        }),
      flush: (controller) => GzipDecompressor.finalizeDecompression(controller, runtime, state),
    });
  }

  /**
   * Validate stream options
   */
  private static validateStreamOptions(options: DecompressorOptions): void {
    if (typeof options !== 'object' || options === null) {
      throw new CompressionError('Options must be an object', 'gzip', 'stream');
    }
    if (options.signal && !(options.signal instanceof AbortSignal)) {
      throw new CompressionError('Signal must be AbortSignal if provided', 'gzip', 'stream');
    }

    // Validate buffer size
    if (
      options.bufferSize !== undefined &&
      (typeof options.bufferSize !== 'number' || options.bufferSize <= 0)
    ) {
      throw new CompressionError('Buffer size must be a positive number', 'gzip', 'stream');
    }

    // Validate max output size
    if (
      options.maxOutputSize !== undefined &&
      (typeof options.maxOutputSize !== 'number' || options.maxOutputSize <= 0)
    ) {
      throw new CompressionError('Max output size must be a positive number', 'gzip', 'stream');
    }
  }

  /**
   * Initialize decompressor for transform stream
   */
  private static initializeDecompressor(
    controller: { error: (error: Error) => void },
    runtime: Runtime,
    options: Required<DecompressorOptions>,
    state: { bytesProcessed: number; decompressor: unknown; initialized: boolean }
  ): void {
    try {
      if (runtime === 'node') {
        void GzipDecompressor.initializeNodeDecompressor(
          controller as { enqueue: (chunk: Uint8Array) => void; error: (error: Error) => void },
          options,
          state
        );
      } else {
        // For non-Node runtimes, try to initialize web decompressor
        // If it fails, we'll handle errors gracefully during processing
        try {
          GzipDecompressor.initializeWebDecompressor(state);
        } catch {
          // Mark as initialized anyway to allow processing and error handling
          state.decompressor = null;
        }
      }
      state.initialized = true;
    } catch (err) {
      controller.error(CompressionError.fromSystemError('gzip', 'stream', err));
    }
  }

  /**
   * Initialize Node.js specific decompressor
   */
  private static async initializeNodeDecompressor(
    controller: { enqueue: (chunk: Uint8Array) => void; error: (error: Error) => void },
    options: Required<DecompressorOptions>,
    state: { bytesProcessed: number; decompressor: unknown; initialized: boolean }
  ): Promise<void> {
    const nodeGlobals = getRuntimeGlobals('node');
    const zlib = nodeGlobals?.stream ?? (await import('zlib'));
    state.decompressor = zlib.createGunzip({
      chunkSize: options.bufferSize,
    });

    const gunzipStream = state.decompressor as {
      on: (event: string, callback: (arg: unknown) => void) => void;
    };

    gunzipStream.on('data', (chunk: unknown) => {
      controller.enqueue(new Uint8Array(chunk as Buffer));
    });

    gunzipStream.on('error', (error: unknown) => {
      controller.error(
        CompressionError.fromSystemError('gzip', 'stream', error, state.bytesProcessed)
      );
    });
  }

  /**
   * Initialize web-compatible decompressor
   */
  private static initializeWebDecompressor(state: {
    bytesProcessed: number;
    decompressor: unknown;
    initialized: boolean;
  }): void {
    if (typeof DecompressionStream !== 'undefined') {
      state.decompressor = new DecompressionStream('gzip');
    } else {
      throw new CompressionError(
        'No gzip decompression support available in this runtime',
        'gzip',
        'stream'
      );
    }
  }

  /**
   * Process chunk in transform stream
   */
  private static processChunk(
    chunk: Uint8Array,
    controller: { error: (error: Error) => void },
    context: {
      runtime: Runtime;
      options: Required<DecompressorOptions>;
      state: { bytesProcessed: number; decompressor: unknown; initialized: boolean };
    }
  ): void {
    const { runtime, options, state } = context;

    if (!state.initialized) {
      controller.error(new CompressionError('Decompressor not initialized', 'gzip', 'stream'));
      return;
    }

    try {
      state.bytesProcessed += chunk.length;

      // Always call progress callback first, even if processing fails
      options.onProgress(state.bytesProcessed);

      // Check abort signal
      const isAborted = options.signal?.aborted ?? false;
      if (isAborted) {
        controller.error(
          new CompressionError('Decompression aborted', 'gzip', 'stream', state.bytesProcessed)
        );
        return;
      }

      // If no decompressor is available, throw error after progress callback
      if (!state.decompressor) {
        controller.error(
          new CompressionError(
            'No gzip decompression support available in this runtime',
            'gzip',
            'stream',
            state.bytesProcessed
          )
        );
        return;
      }

      GzipDecompressor.writeChunkToDecompressor(chunk, runtime, state);
    } catch (err) {
      controller.error(
        CompressionError.fromSystemError('gzip', 'stream', err, state.bytesProcessed)
      );
    }
  }

  /**
   * Write chunk to appropriate decompressor
   */
  private static writeChunkToDecompressor(
    chunk: Uint8Array,
    runtime: Runtime,
    state: { decompressor: unknown }
  ): void {
    if (runtime === 'node') {
      const nodeStream = state.decompressor as { write: (data: Uint8Array) => void };
      nodeStream.write(chunk);
    } else if (state.decompressor instanceof DecompressionStream) {
      const writer = state.decompressor.writable.getWriter();
      void writer.write(chunk);
      writer.releaseLock();
    }
  }

  /**
   * Finalize decompression in transform stream
   */
  private static finalizeDecompression(
    controller: { terminate: () => void; error: (error: Error) => void },
    runtime: Runtime,
    state: { bytesProcessed: number; decompressor: unknown }
  ): void {
    try {
      if (runtime === 'node') {
        const nodeStream = state.decompressor as { end: () => void };
        nodeStream.end();
      }
      controller.terminate();
    } catch (err) {
      controller.error(
        CompressionError.fromSystemError('gzip', 'stream', err, state.bytesProcessed)
      );
    }
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
      const transform = GzipDecompressor.createStream(options);
      return input.pipeThrough(transform);
    } catch (err) {
      throw CompressionError.fromSystemError('gzip', 'stream', err);
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
    } catch (err) {
      throw new CompressionError(
        `Invalid decompressor options: ${err instanceof Error ? err.message : String(err)}`,
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
      start(controller): void {
        controller.enqueue(compressed);
        controller.close();
      },
    });

    // Use transform stream to decompress
    const transform = GzipDecompressor.createStream(options);
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
