/**
 * Sliding window extraction (k-mer generation)
 *
 * @module operations/windows
 */

import { type } from "arktype";
import { ValidationError } from "../errors";
import type { AbstractSequence, KmerSequence } from "../types";
import type { Processor, WindowOptions } from "./types";

const WindowOptionsSchema = type({
  size: "0 < number < 1000000",
  "step?": "number>0",
  "greedy?": "boolean",
  "circular?": "boolean",
  "zeroBased?": "boolean",
  "suffix?": "string>0",
}).narrow((options, ctx) => {
  // Validate suffix length
  if (options.suffix && options.suffix.length >= 100) {
    return ctx.reject({
      expected: "suffix length < 100",
      actual: `suffix.length=${options.suffix.length}`,
      message: "Suffix must be shorter than 100 characters",
    });
  }

  // Circular mode with step > size creates ambiguous boundaries
  if (options.circular && options.step && options.step > options.size) {
    return ctx.reject({
      expected: "step must be <= size when circular=true",
      actual: `step=${options.step}, size=${options.size}`,
      message: "Circular mode with step > size creates ambiguous window boundaries",
    });
  }

  return true;
});

/**
 * Sliding window processor for generating k-mers from sequences
 *
 * Extracts fixed-size windows (k-mers) from sequences with configurable
 * step size, circular wrapping, and greedy mode. Preserves literal type
 * parameter K for compile-time type safety.
 *
 * @template K - K-mer size as literal number type (e.g., 21, 31)
 *
 * @example
 * ```typescript
 * // Extract 21-mers with step=1 (overlapping)
 * const processor = new WindowsProcessor<21>();
 * for await (const kmer of processor.process(sequences, { size: 21 })) {
 *   console.log(kmer.sequence); // K=21 preserved in type
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Tiling windows (non-overlapping)
 * const processor = new WindowsProcessor<100>();
 * const windows = processor.process(sequences, { size: 100, step: 100 });
 * ```
 *
 * @example
 * ```typescript
 * // Circular mode for plasmids
 * const processor = new WindowsProcessor<31>();
 * const circular = processor.process(plasmid, {
 *   size: 31,
 *   circular: true
 * });
 * ```
 *
 * @see WindowOptions for configuration options
 * @see KmerSequence for output sequence type
 */
export class WindowsProcessor<K extends number = number> implements Processor<WindowOptions<K>> {
  /**
   * Generate sliding windows (k-mers) from input sequences
   *
   * Streams windows from each input sequence according to the provided options.
   * Windows are generated lazily, so this method is memory-efficient even for
   * large genomes.
   *
   * @param source - Input sequences to extract windows from
   * @param options - Window extraction configuration
   * @returns AsyncIterable of k-mer sequences with type K preserved
   *
   * @throws {ValidationError} If options fail ArkType validation (e.g., size=0)
   *
   * @example
   * ```typescript
   * const processor = new WindowsProcessor<21>();
   * const sequences = await readFasta("genome.fasta");
   *
   * for await (const kmer of processor.process(sequences, { size: 21 })) {
   *   console.log(`${kmer.id}: ${kmer.sequence}`);
   * }
   * ```
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: WindowOptions<K>
  ): AsyncIterable<KmerSequence<K>> {
    const result = WindowOptionsSchema(options);

    if (result instanceof type.errors) {
      throw new ValidationError(`Invalid window options: ${result.summary}`);
    }

    for await (const sequence of source) {
      yield* this.generateWindows(sequence, options);
    }
  }

  private *generateWindows(
    sequence: AbstractSequence,
    options: WindowOptions<K>
  ): Generator<KmerSequence<K>> {
    const { size, step = 1, greedy = false, circular = false } = options;
    const length = sequence.sequence.length;
    let windowIndex = 0;

    for (let start = 0; start < length; start += step) {
      const end = start + size;

      if (end <= length) {
        yield this.createKmer(sequence, start, end, options, windowIndex++, false);
      } else if (circular && end > length) {
        // Wrapped window (circular mode)
        yield this.createKmer(sequence, start, end, options, windowIndex++, true);
      } else if (greedy && start < length) {
        // Short final window
        yield this.createKmer(sequence, start, length, options, windowIndex++, false);
      }
    }
  }

  private createKmer(
    source: AbstractSequence,
    start: number,
    end: number,
    options: WindowOptions<K>,
    windowIndex: number,
    isWrapped = false
  ): KmerSequence<K> {
    const { size, step = 1, suffix = "_window", zeroBased = false } = options;
    const length = source.sequence.length;

    // Extract sequence (handle wrapping for circular mode)
    let seq: string;
    if (isWrapped) {
      seq = source.sequence.slice(start) + source.sequence.slice(0, end - length);
    } else {
      seq = source.sequence.slice(start, end);
    }

    // Calculate display coordinates
    const displayStart = zeroBased ? start : start + 1;
    const displayEnd = zeroBased ? end : Math.min(end, length);

    // Format ID with suffix and coordinates
    const id = `${source.id}${suffix}:${displayStart}-${displayEnd}`;

    return {
      id,
      description: source.description,
      sequence: seq,
      length: seq.length,
      lineNumber: source.lineNumber,
      kmerSize: size,
      stepSize: step,
      originalId: source.id,
      startPosition: displayStart,
      endPosition: displayEnd,
      coordinateSystem: zeroBased ? "0-based" : "1-based",
      suffix,
      isWrapped,
      windowIndex,
    } as KmerSequence<K>;
  }
}
