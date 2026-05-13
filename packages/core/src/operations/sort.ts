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
 */

import { type } from "arktype";
import { ValidationError } from "@genotype/core/errors";
import type { AbstractSequence } from "@genotype/core/types";
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
  "by?": "'length' | 'gc' | 'quality' | 'id' | 'sequence' | Function",
  "order?": "'asc' | 'desc'",
  "tempDir?": "string",
  "memoryBudget?": "number>=1048576",
  "unique?": "boolean",
  "qualityEncoding?": "'phred33' | 'phred64'",
}).narrow((options, ctx) => {
  if (options.by === "quality") {
    if (!options.qualityEncoding) {
      return ctx.reject({
        expected: "qualityEncoding required for quality-based sorting",
        path: ["qualityEncoding"],
        description: "Specify 'phred33' or 'phred64' when sorting by quality",
      });
    }
  }

  if (options.memoryBudget && options.memoryBudget > 2147483648) {
    return ctx.reject({
      expected: "memory budget <= 2GB",
      actual: `${Math.round(options.memoryBudget / 1024 / 1024)}MB`,
      path: ["memoryBudget"],
      description: "Large memory budgets may cause memory issues",
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
 *   by: 'gc',               // GC content
 *   order: 'desc',
 *   unique: true,           // Remove duplicates during sort
 *   memoryBudget: 100_000_000
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
    options: CoreSortOptions
  ): AsyncIterable<AbstractSequence> {
    // Rust-style validation with comprehensive error context
    const validationResult = SortOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(
        `Invalid sort configuration: ${validationResult.summary}`,
        undefined,
        "Check by strategy, memoryBudget, and qualityEncoding requirements"
      );
    }

    // Create memory-safe sorter with validated options
    const sorter = new SequenceSorter(options);

    // Delegate to superior core implementation - maintains streaming!
    yield* sorter.sort(source);
  }
}
