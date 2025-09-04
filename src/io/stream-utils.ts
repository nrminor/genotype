/**
 * Stream processing utilities for efficient text and binary data handling
 *
 * Provides memory-efficient streaming capabilities for processing large
 * genomic files with proper line buffering, backpressure handling, and
 * cross-platform compatibility.
 */

import { BufferError, MemoryError, StreamError } from "../errors";
import type { LineProcessingResult, StreamChunk, StreamStats } from "../types";
import { detectRuntime } from "./runtime";

// Constants for stream processing
const MAX_LINE_LENGTH = 1_000_000; // 1MB max line length
const MAX_BUFFER_SIZE = 10_485_760; // 10MB max buffer
const MEMORY_CHECK_INTERVAL = 1000; // Check memory every 1000 lines

/**
 * Convert ReadableStream<Uint8Array> to async iterable of lines
 *
 * Handles line buffering properly to ensure complete lines are yielded
 * even when chunks don't align with line boundaries.
 *
 * @param stream Stream of binary data to process
 * @param encoding Text encoding to use (default: 'utf8')
 * @yields Complete lines of text
 * @throws {StreamError} If stream processing fails
 * @throws {BufferError} If line is too long or buffer overflow occurs
 * @example Line-by-line processing
 * ```typescript
 * const stream = await createStream('/path/to/genome.fasta');
 * for await (const line of readLines(stream)) {
 *   if (line.startsWith('>')) {
 *     console.log('Found header:', line);
 *   }
 * }
 * ```
 */
export async function* readLines(
  stream: ReadableStream<Uint8Array>,
  encoding: "utf8" | "ascii" | "binary" = "utf8"
): AsyncIterable<string> {
  // TypeScript guarantees types - no defensive checking needed

  const reader = stream.getReader();
  // TextDecoder doesn't support 'ascii', use 'utf-8' for both utf8 and ascii
  // For binary encoding, use 'iso-8859-1' (which is the standard label for latin1)
  const decoderEncoding: any = encoding === "binary" ? "iso-8859-1" : "utf-8";
  const decoder = new TextDecoder(decoderEncoding);
  let buffer = "";
  let lineCount = 0;
  let totalBytesProcessed = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining data in buffer
        if (buffer.trim()) {
          yield buffer;
          lineCount++;
        }
        break;
      }

      // Decode chunk and add to buffer
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      totalBytesProcessed += value.length;

      // Process complete lines
      const result = processBuffer(buffer);
      buffer = result.remainder;

      // Yield complete lines
      for (const line of result.lines) {
        yield line;
        lineCount++;

        // Periodic memory check
        if (lineCount % MEMORY_CHECK_INTERVAL === 0) {
          checkMemoryUsage(buffer.length, totalBytesProcessed);
        }
      }

      // Check buffer size to prevent memory exhaustion
      if (buffer.length > MAX_BUFFER_SIZE) {
        throw new BufferError(
          `Buffer overflow: ${buffer.length} bytes exceeds maximum ${MAX_BUFFER_SIZE}`,
          buffer.length,
          "overflow"
        );
      }
    }

    // Final decode call
    const finalChunk = decoder.decode();
    if (finalChunk) {
      buffer += finalChunk;
      if (buffer.trim()) {
        yield buffer;
        lineCount++;
      }
    }
  } catch (error) {
    if (error instanceof BufferError || error instanceof MemoryError) {
      throw error;
    }
    throw new StreamError(
      `Line reading failed: ${error instanceof Error ? error.message : String(error)}`,
      "read",
      totalBytesProcessed
    );
  } finally {
    reader.releaseLock();
  }
}

/**
 * Process text buffer to extract complete lines
 *
 * Handles different line ending styles (\n, \r\n, \r) and preserves
 * incomplete lines for the next processing cycle.
 *
 * @param buffer Text buffer to process
 * @returns Object with complete lines and remainder
 * @throws {BufferError} If a single line exceeds maximum length
 */
export function processBuffer(buffer: string): LineProcessingResult {
  // TypeScript guarantees buffer is string - no defensive checking needed

  const lines: string[] = [];
  let remainder = "";
  let currentPosition = 0;
  let lineStart = 0;

  // Process buffer character by character to handle mixed line endings
  while (currentPosition < buffer.length) {
    const char = buffer[currentPosition];

    if (char === "\n") {
      // Unix line ending or end of Windows line ending
      let lineEnd = currentPosition;

      // Check for Windows line ending (\r\n)
      if (currentPosition > 0 && buffer[currentPosition - 1] === "\r") {
        lineEnd = currentPosition - 1;
      }

      const line = buffer.slice(lineStart, lineEnd);

      // Check line length
      if (line.length > MAX_LINE_LENGTH) {
        throw new BufferError(
          `Line too long: ${line.length} characters exceeds maximum ${MAX_LINE_LENGTH}`,
          line.length,
          "overflow",
          `Line starts with: ${line.slice(0, 100)}...`
        );
      }

      lines.push(line);
      lineStart = currentPosition + 1;
    } else if (
      char === "\r" &&
      currentPosition + 1 < buffer.length &&
      buffer[currentPosition + 1] !== "\n"
    ) {
      // Mac classic line ending (\r not followed by \n)
      const line = buffer.slice(lineStart, currentPosition);

      if (line.length > MAX_LINE_LENGTH) {
        throw new BufferError(
          `Line too long: ${line.length} characters exceeds maximum ${MAX_LINE_LENGTH}`,
          line.length,
          "overflow"
        );
      }

      lines.push(line);
      lineStart = currentPosition + 1;
    }

    currentPosition++;
  }

  // Remaining data becomes the remainder for next processing
  if (lineStart < buffer.length) {
    remainder = buffer.slice(lineStart);

    // Check if remainder is getting too long (potential infinite line)
    if (remainder.length > MAX_LINE_LENGTH) {
      throw new BufferError(
        `Incomplete line too long: ${remainder.length} characters exceeds maximum ${MAX_LINE_LENGTH}`,
        remainder.length,
        "overflow",
        "This might indicate a file without proper line endings"
      );
    }
  }

  const result: LineProcessingResult = {
    lines,
    remainder,
    totalLines: lines.length,
    isComplete: remainder.length === 0,
  };

  return result;
}

/**
 * Transform stream through a processing function
 *
 * Provides a streaming transform pattern that maintains backpressure
 * and handles errors gracefully.
 *
 * @param input Input async iterable
 * @param transform Transform function to apply to each item
 * @yields Transformed items
 * @throws {StreamError} If transformation fails
 */
export async function* pipe<T, U>(
  input: AsyncIterable<T>,
  transform: (item: T, index: number) => U | Promise<U>
): AsyncIterable<U> {
  // TypeScript guarantees types - no defensive checking needed

  let index = 0;
  let processedCount = 0;

  try {
    for await (const item of input) {
      try {
        const result = await transform(item, index);
        yield result;
        processedCount++;
      } catch (error) {
        throw new StreamError(
          `Transform failed at index ${index}: ${error instanceof Error ? error.message : String(error)}`,
          "transform",
          processedCount
        );
      }

      index++;
    }
  } catch (error) {
    if (error instanceof StreamError) throw error;
    throw new StreamError(
      `Stream processing failed: ${error instanceof Error ? error.message : String(error)}`,
      "read",
      processedCount
    );
  }
}

/**
 * Create stream processing statistics tracker
 *
 * Provides real-time statistics about stream processing performance
 * and resource usage.
 *
 * @param stream Stream to process
 * @yields Stream chunks with statistics
 * @example Chunked processing with statistics
 * ```typescript
 * const stream = await createStream('/path/to/large-file.fastq');
 *
 * for await (const chunk of processChunks(stream)) {
 *   console.log(`Processing rate: ${chunk.stats.processingRate} bytes/sec`);
 * }
 * ```
 */
export async function* processChunks(
  stream: ReadableStream<Uint8Array>
): AsyncIterable<StreamChunk & { stats: StreamStats }> {
  // TypeScript guarantees stream type - no defensive checking needed

  const reader = stream.getReader();
  const startTime = Date.now();
  let totalBytes = 0;
  let chunkCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      const currentTime = Date.now();
      const elapsedTime = currentTime - startTime;
      totalBytes += value.length;
      chunkCount++;

      const processingRate = elapsedTime > 0 ? (totalBytes / elapsedTime) * 1000 : 0;
      const memoryUsage = estimateMemoryUsage();

      const chunk: StreamChunk = {
        data: value,
        isLast: false,
        bytesRead: value.length,
        chunkNumber: chunkCount,
      };

      const stats: StreamStats = {
        bytesProcessed: totalBytes,
        chunksProcessed: chunkCount,
        startTime,
        processingRate,
        memoryUsage,
      };

      yield { ...chunk, stats };
    }

    // Final chunk with completion stats
    if (chunkCount > 0) {
      const finalStats: StreamStats = {
        bytesProcessed: totalBytes,
        chunksProcessed: chunkCount,
        startTime,
        processingRate: totalBytes / ((Date.now() - startTime) / 1000),
        memoryUsage: estimateMemoryUsage(),
      };

      yield {
        data: new Uint8Array(0),
        isLast: true,
        bytesRead: 0,
        totalBytes: totalBytes,
        chunkNumber: chunkCount + 1,
        stats: finalStats,
      };
    }
  } catch (error) {
    throw new StreamError(
      `Chunk processing failed: ${error instanceof Error ? error.message : String(error)}`,
      "read",
      totalBytes
    );
  } finally {
    reader.releaseLock();
  }
}

/**
 * Batch lines into groups for efficient processing
 *
 * Useful for processing genomic data that comes in multi-line records
 * (like FASTA sequences or FASTQ records).
 *
 * @param lines Async iterable of lines
 * @param batchSize Number of lines per batch
 * @yields Arrays of lines in batches
 */
export async function* batchLines(
  lines: AsyncIterable<string>,
  batchSize: number = 1000
): AsyncIterable<string[]> {
  // TypeScript guarantees types - no defensive checking needed

  let batch: string[] = [];
  let batchCount = 0;

  try {
    for await (const line of lines) {
      batch.push(line);

      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
        batchCount++;
      }
    }

    // Yield remaining batch if not empty
    if (batch.length > 0) {
      yield batch;
      batchCount++;
    }
  } catch (error) {
    throw new StreamError(
      `Batch processing failed: ${error instanceof Error ? error.message : String(error)}`,
      "transform",
      batchCount * batchSize
    );
  }
}

/**
 * Check memory usage and throw error if excessive
 */
function checkMemoryUsage(bufferSize: number, totalProcessed: number): void {
  // TypeScript guarantees types - check meaningful invariants only

  const estimatedMemory = estimateMemoryUsage();
  const runtime = detectRuntime();

  // Runtime-specific memory limits based on performance characteristics
  const memoryLimits = {
    node: 1_073_741_824, // 1GB for Node.js - conservative due to V8 limits
    bun: 8_589_934_592, // 8GB for Bun - higher limit due to superior memory management and performance
  };

  const limit = memoryLimits[runtime];

  if (estimatedMemory > limit) {
    throw new MemoryError(
      `Memory usage ${estimatedMemory} bytes exceeds ${runtime} limit of ${limit} bytes`,
      "Consider using smaller buffer sizes or processing files in chunks"
    );
  }
}

/**
 * Estimate current memory usage
 */
function estimateMemoryUsage(): number {
  const runtime = detectRuntime();

  try {
    switch (runtime) {
      case "node": {
        const process = globalThis.process;
        return process?.memoryUsage?.()?.heapUsed || 0;
      }

      case "bun": {
        // Bun has access to process.memoryUsage() and it's highly optimized
        const process = globalThis.process;
        const memoryUsage = process?.memoryUsage?.();

        // Bun's memory reporting is more accurate, include RSS for better estimates
        return memoryUsage !== null && memoryUsage !== undefined
          ? memoryUsage.heapUsed + (memoryUsage.rss ?? 0) * 0.1
          : 0;
      }

      default:
        return 0;
    }
  } catch {
    return 0;
  }
}

/**
 * Stream utility class with Tiger Style compliance
 * @deprecated Use individual function imports for better tree-shaking
 *
 * Implements streaming algorithms optimized for genomic data formats
 * with proper memory management and error handling.
 */
export const StreamUtils = {
  readLines,
  processBuffer,
  pipe,
  processChunks,
  batchLines,
} as const;
