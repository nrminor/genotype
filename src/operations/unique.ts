/**
 * Sequence deduplication processor
 */

import type { AbstractSequence, QualityEncoding } from "../types";
import { hashBatch } from "../backend/service";
import { extractHashKey, packSequences } from "../backend/batch";
import type { Processor } from "./types";
import { calculateAverageQuality } from "./core/quality";

const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

function toBufferView(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

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

    if ((by === "sequence" || by === "both") && typeof by !== "function") {
      yield* this.processNative(source, by, caseSensitive, conflictResolution);
      return;
    }

    yield* this.processScalar(source, by, caseSensitive, conflictResolution);
  }

  private async *processScalar(
    source: AsyncIterable<T>,
    by: "sequence" | "id" | "both" | ((seq: AbstractSequence) => string),
    caseSensitive: boolean,
    conflictResolution: NonNullable<UniqueOptions["conflictResolution"]>
  ): AsyncIterable<T> {
    const keyFn = this.getKeyFunction(by, caseSensitive);
    const seen = new Map<string, T>();

    for await (const seq of source) {
      const key = keyFn(seq);

      if (!seen.has(key)) {
        seen.set(key, seq);
        if (conflictResolution === "first") {
          yield seq;
        }
      } else if (conflictResolution !== "first") {
        const existing = seen.get(key);
        if (existing !== undefined) {
          const winner = this.resolveConflict(existing, seq, conflictResolution);
          seen.set(key, winner);
        }
      }
    }

    if (conflictResolution !== "first") {
      for (const seq of seen.values()) {
        yield seq;
      }
    }
  }

  private async *processNative(
    source: AsyncIterable<T>,
    by: "sequence" | "both",
    caseSensitive: boolean,
    conflictResolution: NonNullable<UniqueOptions["conflictResolution"]>
  ): AsyncIterable<T> {
    const seen = new Map<string, T>();
    let batch: T[] = [];
    let batchBytes = 0;

    for await (const seq of source) {
      batch.push(seq);
      batchBytes += seq.sequence.length;

      if (batchBytes >= BATCH_BYTE_BUDGET) {
        yield* await this.flushNativeBatch(batch, by, caseSensitive, conflictResolution, seen);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* await this.flushNativeBatch(batch, by, caseSensitive, conflictResolution, seen);
    }

    if (conflictResolution !== "first") {
      for (const seq of seen.values()) {
        yield seq;
      }
    }
  }

  private async *flushNativeBatch(
    batch: readonly T[],
    by: "sequence" | "both",
    caseSensitive: boolean,
    conflictResolution: NonNullable<UniqueOptions["conflictResolution"]>,
    seen: Map<string, T>
  ): AsyncIterable<T> {
    const { data, offsets } = packSequences(batch);
    const hashBuffer = toBufferView(await hashBatch(data, offsets, !caseSensitive));

    for (let i = 0; i < batch.length; i++) {
      const seqHash = extractHashKey(hashBuffer, i);
      const key = by === "both" ? `${batch[i]!.id}:${seqHash}` : seqHash;

      if (!seen.has(key)) {
        seen.set(key, batch[i]!);
        if (conflictResolution === "first") {
          yield batch[i]!;
        }
      } else if (conflictResolution !== "first") {
        const existing = seen.get(key);
        if (existing !== undefined) {
          const winner = this.resolveConflict(existing, batch[i]!, conflictResolution);
          seen.set(key, winner);
        }
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
        return (seq) =>
          caseSensitive ? seq.sequence.toString() : seq.sequence.toString().toLowerCase();
      case "id":
        return (seq) => seq.id;
      case "both":
        return (seq) => {
          const seqKey = caseSensitive
            ? seq.sequence.toString()
            : seq.sequence.toString().toLowerCase();
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
    if ("quality" in seq && seq.quality !== undefined) {
      const quality = seq.quality as string;
      // Respect the sequence's qualityEncoding if present, default to phred33
      const encoding: QualityEncoding =
        "qualityEncoding" in seq && typeof seq.qualityEncoding === "string"
          ? (seq.qualityEncoding as QualityEncoding)
          : "phred33";
      return calculateAverageQuality(quality, encoding);
    }
    return null;
  }
}
