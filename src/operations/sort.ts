/**
 * SortProcessor - Memory-safe sequence sorting with external sort support
 *
 * Rust-style declarative wrapper around the superior core SequenceSorter.
 * Provides memory-safe external sorting, integrated deduplication, and
 * quality encoding awareness for genomic workflows.
 *
 * Genomic Context: Proper sequence ordering can dramatically improve compression
 * ratios for large datasets by grouping similar sequences together, which is
 * critical for managing storage costs in genomics workflows.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { type } from "arktype";
import { ValidationError } from "../errors";
import type { AbstractSequence } from "../types";
import { type SortOptions as CoreSortOptions, SequenceSorter } from "./core/sequence-sorter";

/**
 * Rust-style declarative ArkType schema for comprehensive sorting options
 *
 * Uses the superior core SortOptions interface with advanced features:
 * - External sorting for memory safety
 * - Integrated deduplication
 * - Quality encoding awareness
 * - Declarative string-based sort strategies
 */
const SortOptionsSchema = type({
  "sortBy?":
    "'length' | 'length-asc' | 'gc' | 'gc-asc' | 'quality' | 'quality-asc' | 'id' | 'id-desc' | Function",
  "tempDir?": "string",
  "chunkSize?": "number>=1048576", // Minimum 1MB chunks
  "unique?": "boolean",
  "qualityEncoding?": "'phred33' | 'phred64'",
}).narrow((options, ctx) => {
  // Quality sorting requires quality encoding specification
  if (options.sortBy === "quality" || options.sortBy === "quality-asc") {
    if (!options.qualityEncoding) {
      return ctx.reject({
        expected: "qualityEncoding required for quality-based sorting",
        path: ["qualityEncoding"],
        description: "Specify 'phred33' or 'phred64' when sorting by quality",
      });
    }
  }

  // Validate chunk size is reasonable for genomic data
  if (options.chunkSize && options.chunkSize > 2147483648) {
    // 2GB max
    return ctx.reject({
      expected: "chunk size <= 2GB",
      actual: `${Math.round(options.chunkSize / 1024 / 1024)}MB`,
      path: ["chunkSize"],
      description: "Large chunks may cause memory issues",
    });
  }

  return true;
});

/**
 * Memory-safe, high-performance sequence sorting processor
 *
 * Rust-style declarative wrapper around the superior core SequenceSorter.
 * Eliminates the memory-unsafe collection strategy of the old implementation
 * in favor of true streaming external sort with constant memory usage.
 *
 * @example
 * ```typescript
 * // Declarative sorting with automatic memory management
 * const processor = new SortProcessor();
 * const sorted = processor.process(sequences, {
 *   sortBy: 'gc',           // GC content, highest first
 *   unique: true,           // Remove duplicates during sort
 *   chunkSize: 100_000_000  // 100MB chunks for external sort
 * });
 * ```
 */
export class SortProcessor {
  /**
   * Process sequences with memory-safe sorting using core SequenceSorter
   *
   * Automatically handles external sorting for datasets larger than memory.
   * Provides integrated deduplication and quality encoding awareness.
   * NO MEMORY COLLECTION - maintains streaming behavior throughout.
   *
   * @param source - Input sequences (streaming)
   * @param options - Declarative sort configuration
   * @yields Sequences in sorted order (memory-safe streaming)
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: CoreSortOptions,
  ): AsyncIterable<AbstractSequence> {
    // Rust-style validation with comprehensive error context
    const validationResult = SortOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(
        `Invalid sort configuration: ${validationResult.summary}`,
        undefined,
        "Check sortBy strategy, chunkSize, and qualityEncoding requirements",
      );
    }

    // Create memory-safe sorter with validated options
    const sorter = new SequenceSorter(options);

    // Delegate to superior core implementation - maintains streaming!
    yield* sorter.sort(source);
  }
}
