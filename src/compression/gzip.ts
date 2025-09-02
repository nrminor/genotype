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

// Helper functions (not exported)
function validateCompressedData(compressed: Uint8Array): void {
  if (!(compressed instanceof Uint8Array)) {
    throw new CompressionError('Compressed data must be Uint8Array', 'gzip', 'decompress');
  }
  if (compressed.length === 0) {
    throw new CompressionError('Compressed data must not be empty', 'gzip', 'decompress');
  }
}

function validateGzipFormat(compressed: Uint8Array): void {
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

function checkSizeLimits(compressed: Uint8Array, options: Required<DecompressorOptions>): void {
  if (compressed.length > options.maxOutputSize) {
    throw new CompressionError(
      `Compressed size ${compressed.length} exceeds maximum ${options.maxOutputSize}`,
      'gzip',
      'decompress',
      0
    );
  }
}

async function performDecompression(
  compressed: Uint8Array,
  options: Required<DecompressorOptions>,
  runtime: Runtime
): Promise<Uint8Array> {
  // Always call progress callback at start, even if decompression fails later
  const bytesProcessed = compressed.length;
  options.onProgress(bytesProcessed, compressed.length);

  // Bun optimization: Use native gunzipSync for superior performance
  if (runtime === 'bun') {
    const bunResult = await decompressWithBun(compressed);
    if (bunResult) {
      return bunResult;
    }
  }

  // Node.js optimization: Use built-in zlib
  if (runtime === 'node') {
    const nodeResult = await decompressWithNode(compressed);
    if (nodeResult) {
      return nodeResult;
    }
  }

  // Fallback to streaming decompression for other runtimes
  return await decompressViaStream(compressed, options);
}

async function decompressWithBun(compressed: Uint8Array): Promise<Uint8Array | null> {
  const { Bun } = getRuntimeGlobals('bun') as { Bun: any };
  const bunHasMethod = Boolean(Bun) && 'gunzipSync' in Bun && typeof Bun.gunzipSync === 'function';
  const hasGunzipSync = Boolean(bunHasMethod);
  if (!hasGunzipSync) {
    return null;
  }

  const result = Bun.gunzipSync(compressed);
  return new Uint8Array(result);
}

async function decompressWithNode(compressed: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { gunzip } = await import('zlib');
    const { promisify } = await import('util');
    const gunzipAsync = promisify(gunzip);

    const result = await gunzipAsync(Buffer.from(compressed));
    return new Uint8Array(result);
  } catch {
    return null;
  }
}

function validateStreamOptions(options: DecompressorOptions): void {
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

function initializeDecompressor(
  controller: { error: (error: Error) => void },
  runtime: Runtime,
  options: Required<DecompressorOptions>,
  state: {
    bytesProcessed: number;
    decompressor: unknown;
    initialized: boolean;
  }
): void {
  try {
    if (runtime === 'node') {
      void initializeNodeDecompressor(
        controller as {
          enqueue: (chunk: Uint8Array) => void;
          error: (error: Error) => void;
        },
        options,
        state
      );
    } else {
      // For non-Node runtimes, try to initialize web decompressor
      try {
        initializeWebDecompressor(state);
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

async function initializeNodeDecompressor(
  controller: {
    enqueue: (chunk: Uint8Array) => void;
    error: (error: Error) => void;
  },
  options: Required<DecompressorOptions>,
  state: {
    bytesProcessed: number;
    decompressor: unknown;
    initialized: boolean;
  }
): Promise<void> {
  const zlib = await import('zlib');
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

function initializeWebDecompressor(state: {
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

function processChunk(
  chunk: Uint8Array,
  controller: { error: (error: Error) => void },
  context: {
    runtime: Runtime;
    options: Required<DecompressorOptions>;
    state: {
      bytesProcessed: number;
      decompressor: unknown;
      initialized: boolean;
    };
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
    if (state.decompressor === null || state.decompressor === undefined) {
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

    writeChunkToDecompressor(chunk, runtime, state);
  } catch (err) {
    controller.error(CompressionError.fromSystemError('gzip', 'stream', err, state.bytesProcessed));
  }
}

function writeChunkToDecompressor(
  chunk: Uint8Array,
  runtime: Runtime,
  state: { decompressor: unknown }
): void {
  if (runtime === 'node') {
    const nodeStream = state.decompressor as {
      write: (data: Uint8Array) => void;
    };
    nodeStream.write(chunk);
  } else if (state.decompressor instanceof DecompressionStream) {
    const writer = state.decompressor.writable.getWriter();
    void writer.write(chunk);
    writer.releaseLock();
  }
}

function finalizeDecompression(
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
    controller.error(CompressionError.fromSystemError('gzip', 'stream', err, state.bytesProcessed));
  }
}

function mergeOptions(
  options: DecompressorOptions,
  runtime: Runtime
): Required<DecompressorOptions> {
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

async function decompressViaStream(
  compressed: Uint8Array,
  options: Required<DecompressorOptions>
): Promise<Uint8Array> {
  // Create a readable stream from the buffer
  const stream = new ReadableStream({
    start(controller): void {
      controller.enqueue(compressed);
      controller.close();
    },
  });

  // Use transform stream to decompress
  const transform = createStream(options);
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
 * @example Buffer decompression for small files
 * ```typescript
 * const compressed = await fs.readFile('sequences.fasta.gz');
 * const decompressed = await decompress(compressed);
 * console.log(`Decompressed ${decompressed.length} bytes`);
 * ```
 *
 * Tiger Style: Function must not exceed 70 lines, minimum 2 assertions
 */
export async function decompress(
  compressed: Uint8Array,
  options: DecompressorOptions = {}
): Promise<Uint8Array> {
  validateCompressedData(compressed);

  const runtime = detectRuntime();
  const mergedOptions = mergeOptions(options, runtime);

  try {
    validateGzipFormat(compressed);
    checkSizeLimits(compressed, mergedOptions);

    return await performDecompression(compressed, mergedOptions, runtime);
  } catch (err) {
    throw CompressionError.fromSystemError('gzip', 'decompress', err, 0);
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
 * @example Transform stream for pipeline processing
 * ```typescript
 * const transform = createStream({
 *   bufferSize: 1024 * 1024, // 1MB buffer for large genomic files
 *   onProgress: (bytes) => console.log(`Processed ${bytes} bytes`)
 * });
 * const pipeline = compressedStream.pipeThrough(transform);
 * ```
 *
 * Tiger Style: Function must not exceed 70 lines, minimum 2 assertions
 */
export function createStream(
  options: DecompressorOptions = {}
): TransformStream<Uint8Array, Uint8Array> {
  validateStreamOptions(options);

  const runtime = detectRuntime();
  const mergedOptions = mergeOptions(options, runtime);
  const state = {
    bytesProcessed: 0,
    decompressor: null as unknown,
    initialized: false,
  };

  return new TransformStream({
    start: (controller) => initializeDecompressor(controller, runtime, mergedOptions, state),
    transform: (chunk, controller) =>
      processChunk(chunk, controller, {
        runtime,
        options: mergedOptions,
        state,
      }),
    flush: (controller) => finalizeDecompression(controller, runtime, state),
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
 * @example Streaming decompression for large files
 * ```typescript
 * const compressedStream = await FileReader.createStream('genome.fasta.gz');
 * const decompressed = wrapStream(compressedStream);
 * for await (const chunk of decompressed) {
 *   console.log(`Processing ${chunk.length} bytes`);
 * }
 * ```
 *
 * Tiger Style: Function must not exceed 70 lines, minimum 2 assertions
 */
export function wrapStream(
  input: ReadableStream<Uint8Array>,
  options: DecompressorOptions = {}
): ReadableStream<Uint8Array> {
  if (!(input instanceof ReadableStream)) {
    throw new CompressionError('Input must be ReadableStream', 'gzip', 'stream');
  }

  try {
    const transform = createStream(options);
    return input.pipeThrough(transform);
  } catch (err) {
    throw CompressionError.fromSystemError('gzip', 'stream', err);
  }
}

/**
 * Backward compatibility namespace export
 *
 * Provides the same API as the original static class for existing code.
 * New code should use the standalone exported functions directly.
 */
export const GzipDecompressor = {
  decompress,
  createStream,
  wrapStream,
} as const;
