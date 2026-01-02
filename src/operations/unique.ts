/**
 * Sequence deduplication processor
 *
 * @module operations/unique
 */

import type { AbstractSequence } from "../types";
import type { Processor } from "./types";

/**
 * Options for sequence deduplication
 */
export interface UniqueOptions {
  /**
   * Deduplication key - what makes a sequence unique?
   *
   * - "sequence": By sequence content (default)
   * - "id": By sequence ID
   * - "both": Both ID and sequence must match
   * - Function: Custom key extraction
   *
   * @default "sequence"
   */
  readonly by?: "sequence" | "id" | "both" | ((seq: AbstractSequence) => string);

  /**
   * Case sensitivity for sequence comparison
   *
   * @default true
   */
  readonly caseSensitive?: boolean;

  /**
   * When duplicates are found, which one to keep?
   *
   * - "first": Keep first occurrence (default, fastest)
   * - "last": Keep last occurrence
   * - "longest": Keep longest sequence
   * - "highest-quality": Keep sequence with highest average quality (FASTQ only)
   *
   * @default "first"
   */
  readonly conflictResolution?: "first" | "last" | "longest" | "highest-quality";
}

/**
 * Streaming sequence deduplication processor
 *
 * Removes duplicate sequences based on configurable key extraction and
 * conflict resolution strategies. Supports memory-efficient streaming
 * deduplication (for "first" strategy) and batch deduplication (for
 * other strategies).
 *
 * @template T - Sequence type extending AbstractSequence
 *
 * @example
 * ```typescript
 * // Basic usage - remove duplicate sequences
 * const processor = new UniqueProcessor();
 * for await (const seq of processor.process(sequences, { by: "sequence" })) {
 *   console.log(seq.id);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Keep longest when duplicates found
 * const processor = new UniqueProcessor();
 * const unique = processor.process(sequences, {
 *   by: "id",
 *   conflictResolution: "longest"
 * });
 * ```
 *
 * @example
 * ```typescript
 * // FASTQ quality-based deduplication
 * const processor = new UniqueProcessor<FastqSequence>();
 * const highQuality = processor.process(reads, {
 *   conflictResolution: "highest-quality"
 * });
 * ```
 *
 * @see UniqueOptions for configuration options
 */
export class UniqueProcessor<
  T extends AbstractSequence = AbstractSequence,
> implements Processor<UniqueOptions> {
  /**
   * Process sequences and remove duplicates
   *
   * Streams deduplicated sequences based on the provided options.
   * For "first" conflict resolution (default), sequences are yielded
   * immediately for memory efficiency. For other strategies, all
   * sequences must be seen before yielding results.
   *
   * @param source - Input sequences to deduplicate
   * @param options - Deduplication configuration
   * @returns AsyncIterable of unique sequences
   *
   * @example
   * ```typescript
   * const processor = new UniqueProcessor();
   * const sequences = await readFasta("input.fasta");
   *
   * for await (const seq of processor.process(sequences, {})) {
   *   console.log(`Unique: ${seq.id}`);
   * }
   * ```
   */
  async *process(source: AsyncIterable<T>, options: UniqueOptions = {}): AsyncIterable<T> {
    const { by = "sequence", caseSensitive = true, conflictResolution = "first" } = options;

    const keyFn = this.getKeyFunction(by, caseSensitive);
    const seen = new Map<string, T>();

    for await (const seq of source) {
      const key = keyFn(seq);

      if (!seen.has(key)) {
        // First occurrence - always track it
        seen.set(key, seq);

        // For "first" strategy, yield immediately
        if (conflictResolution === "first") {
          yield seq;
        }
      } else if (conflictResolution !== "first") {
        // Duplicate found - apply conflict resolution
        const existing = seen.get(key);
        if (existing !== undefined) {
          const winner = this.resolveConflict(existing, seq, conflictResolution);
          seen.set(key, winner);
        }
      }
    }

    // For non-"first" strategies, yield after seeing all sequences
    if (conflictResolution !== "first") {
      for (const seq of seen.values()) {
        yield seq;
      }
    }
  }

  private getKeyFunction(
    by: "sequence" | "id" | "both" | ((seq: AbstractSequence) => string),
    caseSensitive: boolean
  ): (seq: AbstractSequence) => string {
    if (typeof by === "function") {
      return by;
    }

    switch (by) {
      case "sequence":
        return (seq) => (caseSensitive ? seq.sequence : seq.sequence.toLowerCase());
      case "id":
        return (seq) => seq.id;
      case "both":
        return (seq) => {
          const seqKey = caseSensitive ? seq.sequence : seq.sequence.toLowerCase();
          return `${seq.id}:${seqKey}`;
        };
    }
  }

  private resolveConflict(
    existing: T,
    candidate: T,
    strategy: "last" | "longest" | "highest-quality"
  ): T {
    switch (strategy) {
      case "last":
        return candidate;

      case "longest":
        return candidate.length > existing.length ? candidate : existing;

      case "highest-quality": {
        // Only works for FASTQ sequences with quality scores
        const existingQuality = this.getAverageQuality(existing);
        const candidateQuality = this.getAverageQuality(candidate);

        if (existingQuality === null || candidateQuality === null) {
          // Fall back to "first" if quality not available
          return existing;
        }

        return candidateQuality > existingQuality ? candidate : existing;
      }
    }
  }

  private getAverageQuality(seq: T): number | null {
    // Check if this is a FASTQ sequence with quality field
    if ("quality" in seq && typeof seq.quality === "string") {
      const quality = seq.quality as string;
      let sum = 0;
      for (let i = 0; i < quality.length; i++) {
        // Assume Phred+33 encoding (most common)
        sum += quality.charCodeAt(i) - 33;
      }
      return sum / quality.length;
    }
    return null;
  }
}
