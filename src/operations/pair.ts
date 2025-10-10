/**
 * Pair operation - repair paired-end read ordering through buffered ID matching
 *
 * This module provides functionality for matching paired-end reads from shuffled
 * or out-of-order streams, then outputting them in correctly interleaved order.
 *
 * Supports two modes:
 * - Dual-stream: Match reads from two separate streams (R1 and R2 files)
 * - Single-stream: Repair pairing within one mixed stream
 *
 * @module operations/pair
 * @since 0.1.0
 */

import { MemoryError, PairSyncError } from "../errors";
import { defaultExtractPairId } from "../formats/fastq/paired";
import type { AbstractSequence } from "../types";

/**
 * Dual-stream pairing mode configuration
 *
 * Matches reads from two separate streams (e.g., R1.fastq and R2.fastq).
 * Type system ensures both sources are provided.
 *
 * @template T - Sequence type extending AbstractSequence
 */
export interface DualStreamMode<T extends AbstractSequence> {
  readonly mode: "dual";
  readonly source1: AsyncIterable<T>;
  readonly source2: AsyncIterable<T>;
}

/**
 * Single-stream pairing mode configuration
 *
 * Repairs pairing within one mixed stream where R1 and R2 reads
 * are interleaved but potentially out of order.
 *
 * @template T - Sequence type extending AbstractSequence
 */
export interface SingleStreamMode<T extends AbstractSequence> {
  readonly mode: "single";
  readonly source: AsyncIterable<T>;
}

/**
 * Discriminated union for pairing mode selection
 *
 * Type-safe configuration that makes it impossible to pass wrong
 * number of sources for a given mode.
 *
 * @template T - Sequence type extending AbstractSequence
 *
 * @example
 * ```typescript
 * // Dual-stream mode - type system requires both sources
 * const dualConfig: PairMode<FastqSequence> = {
 *   mode: 'dual',
 *   source1: r1Stream,
 *   source2: r2Stream
 * };
 *
 * // Single-stream mode - type system requires only one source
 * const singleConfig: PairMode<FastqSequence> = {
 *   mode: 'single',
 *   source: mixedStream
 * };
 * ```
 */
export type PairMode<T extends AbstractSequence> =
  | DualStreamMode<T>
  | SingleStreamMode<T>;

/**
 * Read type classification for paired-end data
 *
 * Used in single-stream mode to categorize reads as R1 (forward)
 * or R2 (reverse) for proper pairing and output ordering.
 */
export type ReadType = "r1" | "r2";

/**
 * Branded type for base sequence IDs
 *
 * Base ID is the sequence ID with pair suffixes stripped
 * (e.g., "READ_001/1" → "READ_001").
 *
 * Branding prevents accidentally using non-normalized IDs as keys.
 */
export type BaseId = string & { readonly __brand: "BaseId" };

/**
 * Create a branded BaseId from a raw sequence ID
 *
 * @param rawId - Raw sequence ID
 * @param extractFn - Function to extract base ID (strips suffixes)
 * @returns Branded BaseId
 */
function createBaseId(rawId: string, extractFn: (id: string) => string): BaseId {
  return extractFn(rawId) as BaseId;
}

/**
 * Branded buffer type for stream 1 (R1) reads
 *
 * Type-level distinction prevents accidentally swapping buffers.
 *
 * @template T - Sequence type
 */
export type Stream1Buffer<T> = Map<BaseId, T> & { readonly __stream: 1 };

/**
 * Branded buffer type for stream 2 (R2) reads
 *
 * Type-level distinction prevents accidentally swapping buffers.
 *
 * @template T - Sequence type
 */
export type Stream2Buffer<T> = Map<BaseId, T> & { readonly __stream: 2 };

/**
 * Create a branded Stream1Buffer
 */
function createStream1Buffer<T>(): Stream1Buffer<T> {
  return new Map() as Stream1Buffer<T>;
}

/**
 * Create a branded Stream2Buffer
 */
function createStream2Buffer<T>(): Stream2Buffer<T> {
  return new Map() as Stream2Buffer<T>;
}

/**
 * Options for paired-end read matching and ordering
 *
 * Controls how reads are matched by ID, memory limits for buffering,
 * and handling of unpaired reads at end-of-file.
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * seqops(r1Stream).pair(r2Stream);
 *
 * // Custom ID extraction for non-standard formats
 * seqops(r1Stream).pair(r2Stream, {
 *   extractPairId: (id) => id.split('_')[0]
 * });
 *
 * // Strict mode - error on unpaired reads
 * seqops(mixedStream).pair({
 *   onUnpaired: 'error',
 *   maxBufferSize: 50000
 * });
 * ```
 */
export interface PairOptions {
  /**
   * Custom function to extract base ID from sequence ID
   *
   * Used to match R1 and R2 reads that have different suffixes.
   * Default implementation strips common suffixes like /1, /2, _R1, _R2, etc.
   *
   * @param id - Full sequence ID
   * @returns Base ID for matching
   *
   * @default defaultExtractPairId
   *
   * @example
   * ```typescript
   * // Default handles standard formats:
   * // "READ_001/1" → "READ_001"
   * // "READ_001_R1" → "READ_001"
   *
   * // Custom extraction for special format:
   * extractPairId: (id) => id.split('_')[0]
   * // "Sample_001_forward" → "Sample"
   * ```
   */
  readonly extractPairId?: (id: string) => string;

  /**
   * Maximum reads to buffer before throwing MemoryError
   *
   * Prevents memory overload when processing highly shuffled data.
   * Warning emitted at 80% of limit.
   *
   * @default 100000
   *
   * @example
   * ```typescript
   * // Conservative limit for large files
   * { maxBufferSize: 50000 }
   *
   * // Generous limit for heavily shuffled data
   * { maxBufferSize: 500000 }
   * ```
   */
  readonly maxBufferSize?: number;

  /**
   * How to handle unpaired reads at end-of-file
   *
   * Controls behavior when reads don't have matching pairs:
   * - `'warn'`: Emit read and log warning (default)
   * - `'skip'`: Drop unpaired reads silently
   * - `'error'`: Throw error on first unpaired read
   *
   * @default 'warn'
   *
   * @example
   * ```typescript
   * // Production: skip unpaired reads
   * { onUnpaired: 'skip' }
   *
   * // Development: strict validation
   * { onUnpaired: 'error' }
   *
   * // QC: emit warnings for investigation
   * { onUnpaired: 'warn' }
   * ```
   */
  readonly onUnpaired?: "warn" | "skip" | "error";
}

/**
 * Processor for repairing paired-end read ordering through buffered ID matching
 *
 * Matches reads from shuffled or out-of-order streams using hash-based buffering,
 * then outputs them in correctly interleaved order (R1, R2, R1, R2...).
 *
 * **Two Operating Modes:**
 *
 * 1. **Dual-stream mode**: Match reads from two separate streams (R1 and R2 files)
 * 2. **Single-stream mode**: Repair pairing within one mixed stream
 *
 * **Algorithm:**
 * - Buffers reads in Map<baseId, sequence> until match found
 * - Extracts base ID (strips /1, /2 suffixes)
 * - Yields matched pairs immediately
 * - Handles unpaired reads according to configuration
 * - Enforces buffer size limits to prevent OOM
 *
 * **Memory Usage:**
 * - Best case (synchronized): O(1) - minimal buffering
 * - Average case (partially shuffled): O(k) where k = shuffle distance
 * - Worst case (fully shuffled): O(n) - all reads buffered
 *
 * @example
 * ```typescript
 * // Dual-stream mode
 * const processor = new PairProcessor();
 * const paired = processor.process(r1Stream, r2Stream, {
 *   maxBufferSize: 100000
 * });
 *
 * for await (const read of paired) {
 *   console.log(read.id); // Interleaved: R1, R2, R1, R2...
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Single-stream mode
 * const processor = new PairProcessor();
 * const repaired = processor.process(mixedStream, null, {
 *   onUnpaired: 'error'
 * });
 * ```
 *
 * @since 0.1.0
 */
export class PairProcessor {
  private hasWarned80Percent = false;

  /**
   * Check if buffer sizes exceed limits
   *
   * Throws MemoryError if total buffered reads exceed maxBufferSize.
   * Emits warning when reaching 80% of limit.
   *
   * Accepts branded buffer types for type safety.
   *
   * @param buffer1 - Stream 1 buffer (R1 reads)
   * @param buffer2 - Stream 2 buffer (R2 reads)
   * @param maxSize - Maximum allowed total buffer size
   * @throws {MemoryError} When buffer size exceeds limit
   */
  private checkBufferSize<T>(
    buffer1: Stream1Buffer<T> | Map<BaseId, T>,
    buffer2: Stream2Buffer<T> | Map<BaseId, T>,
    maxSize: number,
  ): void {
    const total = buffer1.size + buffer2.size;

    // Throw error if exceeds limit
    if (total > maxSize) {
      throw new MemoryError(
        `Pair buffer exceeded limit: ${total} reads buffered (max: ${maxSize}). ` +
          `Files may be too shuffled or contain many unpaired reads.`,
      );
    }

    // Warn at 80% threshold (once)
    if (total > maxSize * 0.8 && !this.hasWarned80Percent) {
      console.warn(
        `⚠️  Pair buffer at ${total}/${maxSize} reads (${Math.round((total / maxSize) * 100)}%)`,
      );
      this.hasWarned80Percent = true;
    }
  }

  /**
   * Handle unpaired reads according to configuration
   *
   * @param read - The unpaired read
   * @param onUnpaired - How to handle: 'warn', 'skip', or 'error'
   * @yields The read (if mode is 'warn')
   * @throws {PairSyncError} When mode is 'error'
   */
  private *handleUnpaired<T extends AbstractSequence>(
    read: T,
    onUnpaired: "warn" | "skip" | "error",
  ): Generator<T, void, undefined> {
    switch (onUnpaired) {
      case "warn":
        console.warn(`⚠️  Unpaired read: ${read.id}`);
        yield read;
        break;
      case "skip":
        // Drop silently
        break;
      case "error":
        throw PairSyncError.forUnpairedRead(read.id);
    }
  }

  /**
   * Determine if read is R1 or R2 in single-stream mode
   *
   * Detection logic:
   * 1. If ID contains '/1' → R1
   * 2. If ID contains '/2' → R2
   * 3. If baseId exists in r1Buffer → this is R2 (second occurrence)
   * 4. If baseId exists in r2Buffer → this is R1 (second occurrence)
   * 5. Otherwise → R1 (first occurrence)
   *
   * @param id - Full sequence ID
   * @param baseId - Branded base ID for buffer lookup
   * @param r1Buffer - Branded buffer of R1 reads
   * @param r2Buffer - Branded buffer of R2 reads
   * @returns Read type classification
   */
  private getReadType<T>(
    id: string,
    baseId: BaseId,
    r1Buffer: Stream1Buffer<T>,
    r2Buffer: Stream2Buffer<T>,
  ): ReadType {
    if (id.endsWith("/1")) return "r1";
    if (id.endsWith("/2")) return "r2";

    if (r1Buffer.has(baseId)) return "r2";
    if (r2Buffer.has(baseId)) return "r1";

    return "r1";
  }

  /**
   * Process single-stream mode with read type detection
   *
   * Repairs pairing within a single mixed stream where R1 and R2 reads
   * are interleaved but potentially out of order. Uses read type detection
   * to categorize each read, then matches pairs and outputs in interleaved order.
   *
   * @private
   * @template T - Sequence type extending AbstractSequence
   * @param source - Single stream containing mixed R1/R2 reads
   * @param extractPairId - Function to extract base ID from sequence ID
   * @param maxBufferSize - Maximum number of reads to buffer before error
   * @param onUnpaired - How to handle unpaired reads at EOF
   * @yields Sequences in interleaved order (R1, R2, R1, R2...)
   */
  private async *processSingleStream<T extends AbstractSequence>(
    source: AsyncIterable<T>,
    extractPairId: (id: string) => string,
    maxBufferSize: number,
    onUnpaired: "warn" | "skip" | "error",
  ): AsyncIterable<T> {
    const r1Buffer = createStream1Buffer<T>();
    const r2Buffer = createStream2Buffer<T>();

    for await (const read of source) {
      const baseId = createBaseId(read.id, extractPairId);
      const readType = this.getReadType(read.id, baseId, r1Buffer, r2Buffer);

      if (readType === "r1") {
        if (r2Buffer.has(baseId)) {
          yield read;
          yield r2Buffer.get(baseId)!;
          r2Buffer.delete(baseId);
        } else {
          r1Buffer.set(baseId, read);
          this.checkBufferSize(r1Buffer, r2Buffer, maxBufferSize);
        }
      } else {
        if (r1Buffer.has(baseId)) {
          yield r1Buffer.get(baseId)!;
          yield read;
          r1Buffer.delete(baseId);
        } else {
          r2Buffer.set(baseId, read);
          this.checkBufferSize(r1Buffer, r2Buffer, maxBufferSize);
        }
      }
    }

    for (const [baseId, read1] of r1Buffer) {
      if (r2Buffer.has(baseId)) {
        yield read1;
        yield r2Buffer.get(baseId)!;
        r2Buffer.delete(baseId);
      } else {
        yield* this.handleUnpaired(read1, onUnpaired);
      }
    }

    for (const [, read2] of r2Buffer) {
      yield* this.handleUnpaired(read2, onUnpaired);
    }
  }

  /**
   * Process paired-end reads with buffered ID matching
   *
   * Matches reads using type-safe mode configuration, buffering as needed
   * to handle out-of-order data, then yields them in interleaved order.
   *
   * **Type Safety:**
   * - Discriminated union ensures correct sources for each mode
   * - Branded buffer types prevent accidental buffer swapping
   *
   * **Output Order:**
   * Always yields in interleaved order: R1, R2, R1, R2, R1, R2...
   *
   * **Memory Management:**
   * - Buffers reads until match found
   * - Throws MemoryError if buffer exceeds `maxBufferSize`
   * - Emits warning at 80% of limit
   *
   * **Unpaired Reads:**
   * Handled according to `onUnpaired` option at end-of-file
   *
   * @template T - Sequence type extending AbstractSequence
   * @param config - Mode configuration (dual-stream or single-stream)
   * @param options - Pairing options (ID extraction, buffer limits, unpaired handling)
   * @yields Sequences in interleaved order (R1, R2, R1, R2...)
   * @throws {MemoryError} When buffer size exceeds maxBufferSize
   * @throws {PairSyncError} When onUnpaired is 'error' and unpaired reads found
   *
   * @example
   * ```typescript
   * // Dual-stream mode
   * const processor = new PairProcessor();
   * for await (const read of processor.process({
   *   mode: 'dual',
   *   source1: r1Stream,
   *   source2: r2Stream
   * })) {
   *   console.log(read.id);
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Single-stream mode
   * for await (const read of processor.process({
   *   mode: 'single',
   *   source: mixedStream
   * })) {
   *   console.log(read.id);
   * }
   * ```
   */
  async *process<T extends AbstractSequence>(
    config: PairMode<T>,
    options: PairOptions = {},
  ): AsyncIterable<T> {
    // Destructure options with defaults
    const {
      extractPairId = defaultExtractPairId,
      maxBufferSize = 100000,
      onUnpaired = "warn" as const,
    } = options;

    // Validate maxBufferSize
    if (maxBufferSize <= 0) {
      throw new MemoryError(
        `Invalid maxBufferSize: ${maxBufferSize}. Must be greater than 0.`,
      );
    }

    // Dispatch based on mode using discriminated union
    switch (config.mode) {
      case "dual":
        yield* this.processDualStream(
          config.source1,
          config.source2,
          extractPairId,
          maxBufferSize,
          onUnpaired,
        );
        break;

      case "single":
        yield* this.processSingleStream(
          config.source,
          extractPairId,
          maxBufferSize,
          onUnpaired,
        );
        break;
    }
  }

  /**
   * Process dual-stream mode with branded buffer types
   *
   * @private
   */
  private async *processDualStream<T extends AbstractSequence>(
    source1: AsyncIterable<T>,
    source2: AsyncIterable<T>,
    extractPairId: (id: string) => string,
    maxBufferSize: number,
    onUnpaired: "warn" | "skip" | "error",
  ): AsyncIterable<T> {
    // Initialize branded buffers
    const buffer1 = createStream1Buffer<T>();
    const buffer2 = createStream2Buffer<T>();

    // Create async iterators
    const iter1 = source1[Symbol.asyncIterator]();
    const iter2 = source2[Symbol.asyncIterator]();

    // Main processing loop - parallel iteration
    while (true) {
        // Fetch from both streams in parallel
        const [result1, result2] = await Promise.all([
          iter1.next(),
          iter2.next(),
        ]);

        // Stop when both streams exhausted
        if (result1.done && result2.done) {
          break;
        }

        // Process stream 1 reads
        if (!result1.done) {
          const seq1 = result1.value;
          const baseId1 = createBaseId(seq1.id, extractPairId);

          // Check if match exists in buffer2
          if (buffer2.has(baseId1)) {
            // Found match! Yield pair in interleaved order
            yield seq1; // R1
            yield buffer2.get(baseId1)!; // R2
            buffer2.delete(baseId1);
          } else {
            // No match yet, buffer this read
            buffer1.set(baseId1, seq1);
            this.checkBufferSize(buffer1, buffer2, maxBufferSize);
          }
        }

        // Process stream 2 reads
        if (!result2.done) {
          const seq2 = result2.value;
          const baseId2 = createBaseId(seq2.id, extractPairId);

          // Check if match exists in buffer1
          if (buffer1.has(baseId2)) {
            // Found match! Yield pair in interleaved order
            yield buffer1.get(baseId2)!; // R1
            yield seq2; // R2
            buffer1.delete(baseId2);
          } else {
            // No match yet, buffer this read
            buffer2.set(baseId2, seq2);
            this.checkBufferSize(buffer1, buffer2, maxBufferSize);
          }
        }
      }

      // Handle remaining buffered reads
      // First check if any reads in buffer1 have matches in buffer2
      for (const [baseId, read1] of buffer1) {
        if (buffer2.has(baseId)) {
          // Found late match
          yield read1; // R1
          yield buffer2.get(baseId)!; // R2
          buffer2.delete(baseId);
        } else {
          // Unpaired read from stream 1
          yield* this.handleUnpaired(read1, onUnpaired);
        }
      }

    // Handle remaining unpaired reads from buffer2
    for (const [, read2] of buffer2) {
      yield* this.handleUnpaired(read2, onUnpaired);
    }
  }
}
