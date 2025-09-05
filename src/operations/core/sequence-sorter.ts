/**
 * High-performance, memory-efficient sorting for genomic sequences.
 *
 * This module provides streaming-first sorting with support for external sorting
 * of multi-GB datasets, various sorting strategies (length, GC content, quality),
 * and integrated deduplication.
 *
 * @module sequence-sorter
 * @since v0.1.0
 *
 * @remarks
 * Key features:
 * - External sorting for datasets larger than memory
 * - Multiple built-in sort strategies (length, GC, quality, ID)
 * - Optional deduplication during sort
 * - Top-N selection without full sort
 * - Streaming API with constant memory usage
 *
 * Performance considerations:
 * - In-memory sorting for datasets < chunkSize (default 100MB)
 * - External merge sort for larger datasets
 * - Top-N uses min-heap for O(n*log(k)) complexity
 * - Deduplication adds ~20% overhead with Set tracking
 */

import type { AbstractSequence, FastqSequence } from "../../types";
import { ExternalSorter } from "./memory";

/**
 * Sorting strategy for sequences.
 *
 * Built-in strategies:
 * - 'length': By sequence length (longest first)
 * - 'length-asc': By sequence length (shortest first)
 * - 'gc': By GC content percentage (highest first)
 * - 'gc-asc': By GC content percentage (lowest first)
 * - 'quality': By average quality score for FASTQ (highest first)
 * - 'quality-asc': By average quality score (lowest first)
 * - 'id': Alphabetically by sequence ID (A-Z)
 * - 'id-desc': Reverse alphabetically by ID (Z-A)
 * - Custom function: (a, b) => number for custom comparison
 *
 * @typedef {string | Function} SortBy
 * @since v0.1.0
 *
 * @example
 * ```typescript
 * // Sort by custom criteria (e.g., AT content)
 * const customSort: SortBy = (a, b) => {
 *   const atA = (a.sequence.match(/[AT]/g) || []).length / a.sequence.length;
 *   const atB = (b.sequence.match(/[AT]/g) || []).length / b.sequence.length;
 *   return atB - atA; // Descending by AT content
 * };
 * ```
 */
export type SortBy =
  | "length" // Sort by sequence length (default: longest first)
  | "length-asc" // Sort by sequence length (shortest first)
  | "gc" // Sort by GC content (highest first)
  | "gc-asc" // Sort by GC content (lowest first)
  | "id" // Sort alphabetically by ID
  | "id-desc" // Sort reverse alphabetically by ID
  | "quality" // Sort by average quality (FASTQ only, highest first)
  | "quality-asc" // Sort by average quality (FASTQ only, lowest first)
  | ((a: AbstractSequence, b: AbstractSequence) => number); // Custom comparison function

/**
 * Configuration options for sequence sorting.
 *
 * @interface SortOptions
 * @since v0.1.0
 *
 * @example
 * ```typescript
 * const options: SortOptions = {
 *   sortBy: 'gc',
 *   unique: true,
 *   tempDir: '/tmp/sort',
 *   chunkSize: 500_000_000, // 500MB chunks
 *   qualityEncoding: 'phred33'
 * };
 * ```
 */
export interface SortOptions {
  /**
   * Sorting strategy to use.
   * @default 'length' (sort by sequence length, longest first)
   */
  sortBy?: SortBy;

  /**
   * Directory for temporary files during external sorting.
   * Must have sufficient space for the entire dataset.
   * @default '/tmp'
   */
  tempDir?: string;

  /**
   * Maximum memory to use before switching to external sort.
   * Larger chunks improve performance but use more memory.
   * @default 104857600 (100MB)
   * @minimum 1048576 (1MB)
   */
  chunkSize?: number;

  /**
   * Remove duplicate sequences during sort.
   * Uses Set for memory-efficient deduplication.
   * @default false
   */
  unique?: boolean;

  /**
   * Quality score encoding for FASTQ sorting.
   * Required when sortBy is 'quality' or 'quality-asc'.
   * @default 'phred33'
   */
  qualityEncoding?: "phred33" | "phred64";
}

/**
 * Memory-efficient sequence sorter with external sorting support.
 *
 * Provides streaming-first sorting for genomic sequences with automatic
 * fallback to external sorting for datasets larger than memory. Supports
 * multiple sorting strategies and optional deduplication.
 *
 * @class SequenceSorter
 * @since v0.1.0
 *
 * @example
 * ```typescript
 * // Sort by length with deduplication
 * const sorter = new SequenceSorter({
 *   sortBy: 'length',
 *   unique: true
 * });
 *
 * for await (const seq of sorter.sort(sequences)) {
 *   console.log(`${seq.id}: ${seq.sequence.length} bp`);
 * }
 *
 * // Sort FASTQ by quality
 * const qualitySorter = new SequenceSorter({
 *   sortBy: 'quality',
 *   qualityEncoding: 'phred33'
 * });
 *
 * // Get top 100 longest sequences
 * for await (const seq of sorter.getTopN(sequences, 100)) {
 *   console.log(`Top sequence: ${seq.id}`);
 * }
 *
 * // Custom sort by AT content
 * const customSorter = new SequenceSorter({
 *   sortBy: (a, b) => {
 *     const atA = (a.sequence.match(/[AT]/g) || []).length;
 *     const atB = (b.sequence.match(/[AT]/g) || []).length;
 *     return atB - atA;
 *   }
 * });
 * ```
 *
 * @remarks
 * The sorter automatically chooses between in-memory and external sorting
 * based on the data size. For datasets smaller than chunkSize, sorting
 * happens entirely in memory. Larger datasets use disk-based merge sort.
 */
export class SequenceSorter {
  private readonly compareFn: (a: AbstractSequence, b: AbstractSequence) => number;
  private readonly options: Required<SortOptions>;
  private readonly seenIds?: Set<string>;

  constructor(options: SortOptions = {}) {
    this.options = {
      sortBy: options.sortBy ?? "length",
      tempDir: options.tempDir ?? "/tmp",
      chunkSize: options.chunkSize ?? 100_000_000, // 100MB
      unique: options.unique ?? false,
      qualityEncoding: options.qualityEncoding ?? "phred33",
    };

    this.compareFn = this.getCompareFn(this.options.sortBy);

    if (this.options.unique) {
      this.seenIds = new Set<string>();
    }
  }

  /**
   * Sort sequences using the configured strategy.
   *
   * Automatically chooses between in-memory and external sorting based on
   * data size. Yields sequences in sorted order as they become available.
   *
   * @param sequences - Async iterable of sequences to sort
   * @yields {Sequence} Sequences in sorted order
   *
   * @example
   * ```typescript
   * for await (const seq of sorter.sort(readFasta('genome.fa'))) {
   *   console.log(`${seq.id}: ${seq.sequence.length} bp`);
   * }
   * ```
   *
   * @remarks
   * Memory usage is bounded by chunkSize option. For datasets larger than
   * chunkSize, temporary files are created in tempDir.
   */
  async *sort(sequences: AsyncIterable<AbstractSequence>): AsyncGenerator<AbstractSequence> {
    // If deduplication is requested, filter first
    const input = this.options.unique ? this.deduplicate(sequences) : sequences;

    // Create external sorter with sequence-specific serialization
    const sorter = new ExternalSorter<AbstractSequence>(
      this.options.chunkSize,
      this.options.tempDir,
      this.serializeSequence.bind(this),
      this.deserializeSequence.bind(this)
    );

    yield* sorter.sort(input, this.compareFn);
  }

  /**
   * Sort sequences entirely in memory.
   *
   * Collects all sequences into memory and returns a sorted array.
   * Use this when you need random access to sorted results or when
   * the dataset is known to fit in memory.
   *
   * @param sequences - Async iterable of sequences to sort
   * @returns Promise resolving to sorted array
   *
   * @example
   * ```typescript
   * const sorted = await sorter.sortInMemory(sequences);
   * console.log(`Total sequences: ${sorted.length}`);
   * console.log(`Longest: ${sorted[0].id}`);
   * ```
   *
   * @warning
   * This method loads all sequences into memory. For large datasets,
   * use the streaming sort() method instead.
   */
  async sortInMemory(sequences: AsyncIterable<AbstractSequence>): Promise<AbstractSequence[]> {
    const array: AbstractSequence[] = [];

    for await (const seq of sequences) {
      if (
        this.options.unique !== true ||
        (this.seenIds !== undefined &&
          this.seenIds !== null &&
          !this.seenIds.has(this.getSequenceKey(seq)))
      ) {
        array.push(seq);
        if (this.options.unique) {
          this.seenIds?.add(this.getSequenceKey(seq));
        }
      }
    }

    return array.sort(this.compareFn);
  }

  /**
   * Get the top N sequences without sorting the entire dataset.
   *
   * Uses a min-heap to efficiently track the top N sequences with
   * O(n*log(k)) time complexity and O(k) space complexity, where
   * n is the total number of sequences and k is the requested count.
   *
   * @param sequences - Async iterable of sequences to process
   * @param n - Number of top sequences to return
   * @yields {Sequence} Top N sequences in sorted order
   *
   * @example
   * ```typescript
   * // Get 10 longest sequences from a large file
   * const top10 = [];
   * for await (const seq of sorter.getTopN(readFasta('genome.fa'), 10)) {
   *   top10.push(seq);
   * }
   * console.log(`Longest sequence: ${top10[0].sequence.length} bp`);
   * ```
   *
   * @remarks
   * This method is much more efficient than sorting the entire dataset
   * when you only need a small number of top sequences. Memory usage
   * is proportional to N, not the dataset size.
   */
  async *getTopN(
    sequences: AsyncIterable<AbstractSequence>,
    n: number
  ): AsyncGenerator<AbstractSequence> {
    // For top-N, we need to invert the comparison
    // The heap keeps the "smallest" N items according to its compareFn
    // So to keep the largest N, we invert the comparison
    const invertedCompareFn = (a: AbstractSequence, b: AbstractSequence): number =>
      -this.compareFn(a, b);
    const heap = new MinHeap<AbstractSequence>(n, invertedCompareFn);

    for await (const seq of sequences) {
      heap.add(seq);
    }

    // Extract from heap in sorted order
    const results = heap.getSorted();
    for (const seq of results) {
      yield seq;
    }
  }

  // Private helper methods

  private getCompareFn(sortBy: SortBy): (a: AbstractSequence, b: AbstractSequence) => number {
    if (typeof sortBy === "function") {
      return sortBy;
    }

    switch (sortBy) {
      case "length":
        return (a, b) => b.sequence.length - a.sequence.length;

      case "length-asc":
        return (a, b) => a.sequence.length - b.sequence.length;

      case "gc":
        return (a, b) => this.getGCContent(b) - this.getGCContent(a);

      case "gc-asc":
        return (a, b) => this.getGCContent(a) - this.getGCContent(b);

      case "id":
        return (a, b) => a.id.localeCompare(b.id);

      case "id-desc":
        return (a, b) => b.id.localeCompare(a.id);

      case "quality":
        return (a, b) => this.getAverageQuality(b) - this.getAverageQuality(a);

      case "quality-asc":
        return (a, b) => this.getAverageQuality(a) - this.getAverageQuality(b);

      default:
        // Default to length sorting
        return (a, b) => b.sequence.length - a.sequence.length;
    }
  }

  private getGCContent(seq: AbstractSequence): number {
    const gcCount = (seq.sequence.match(/[GCgc]/g) || []).length;
    return gcCount / seq.sequence.length;
  }

  private getAverageQuality(seq: AbstractSequence): number {
    // Only applicable to FASTQ sequences
    if (!("quality" in seq)) {
      return 0;
    }

    const fastq = seq as FastqSequence;
    const offset = this.options.qualityEncoding === "phred33" ? 33 : 64;
    let sum = 0;

    for (let i = 0; i < fastq.quality.length; i++) {
      sum += fastq.quality.charCodeAt(i) - offset;
    }

    return sum / fastq.quality.length;
  }

  private serializeSequence(seq: AbstractSequence): string {
    // Use a compact JSON format for serialization
    if ("quality" in seq) {
      // FASTQ format
      const fastq = seq as FastqSequence;
      return JSON.stringify({
        id: fastq.id,
        s: fastq.sequence,
        q: fastq.quality,
        d: fastq.description,
      });
    } else {
      // FASTA format
      return JSON.stringify({
        id: seq.id,
        s: seq.sequence,
        d: seq.description,
      });
    }
  }

  private deserializeSequence(line: string): AbstractSequence {
    try {
      const obj = JSON.parse(line);

      if ("q" in obj) {
        // FASTQ
        const fastq: FastqSequence = {
          id: obj.id,
          sequence: obj.s,
          quality: obj.q,
          description: obj.d,
          format: "fastq",
          qualityEncoding: this.options.qualityEncoding,
          length: obj.s.length,
        };
        return fastq;
      } else {
        // FASTA
        const fasta: AbstractSequence = {
          id: obj.id,
          sequence: obj.s,
          description: obj.d,
          length: obj.s.length,
        };
        return fasta;
      }
    } catch {
      // Fallback for malformed data
      return {
        id: "unknown",
        sequence: "",
        length: 0,
      };
    }
  }

  private async *deduplicate(
    sequences: AsyncIterable<AbstractSequence>
  ): AsyncGenerator<AbstractSequence> {
    for await (const seq of sequences) {
      const key = this.getSequenceKey(seq);
      if (this.seenIds !== undefined && this.seenIds !== null && !this.seenIds.has(key)) {
        this.seenIds?.add(key);
        yield seq;
      }
    }
  }

  private getSequenceKey(seq: AbstractSequence): string {
    // Use both ID and sequence for uniqueness
    return `${seq.id}:${seq.sequence}`;
  }
}

/**
 * Min heap for efficient top-N selection.
 *
 * @internal
 * @class MinHeap
 */
class MinHeap<T> {
  private heap: T[] = [];
  private readonly maxSize: number;

  constructor(
    maxSize: number,
    private readonly compareFn: (a: T, b: T) => number
  ) {
    this.maxSize = maxSize;
  }

  add(item: T): void {
    if (this.heap.length < this.maxSize) {
      this.heap.push(item);
      this.bubbleUp(this.heap.length - 1);
    } else {
      // Only add if better than worst item
      const worst = this.heap[0];
      if (worst !== undefined && this.compareFn(item, worst) > 0) {
        this.heap[0] = item;
        this.bubbleDown(0);
      }
    }
  }

  getSorted(): T[] {
    const result: T[] = [];
    const heapCopy = [...this.heap];

    while (this.heap.length > 0) {
      const item = this.extractMin();
      if (item !== undefined) {
        result.unshift(item); // Add to beginning for descending order
      }
    }

    this.heap = heapCopy; // Restore heap
    return result;
  }

  private extractMin(): T | undefined {
    if (this.heap.length === 0) return undefined;
    if (this.heap.length === 1) return this.heap.pop();

    const min = this.heap[0];
    const last = this.heap.pop();
    if (last !== undefined) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }

    return min;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const current = this.heap[index];
      const parent = this.heap[parentIndex];

      if (current === undefined || parent === undefined) break;
      if (this.compareFn(current, parent) >= 0) break;

      this.heap[index] = parent;
      this.heap[parentIndex] = current;
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;

    while (true) {
      const leftIndex = 2 * index + 1;
      const rightIndex = 2 * index + 2;
      let smallestIndex = index;

      const current = this.heap[smallestIndex];
      const left = this.heap[leftIndex];
      const right = this.heap[rightIndex];

      if (
        leftIndex < length &&
        left !== undefined &&
        current !== undefined &&
        this.compareFn(left, current) < 0
      ) {
        smallestIndex = leftIndex;
      }

      const smallest = this.heap[smallestIndex];
      if (
        rightIndex < length &&
        right !== undefined &&
        smallest !== undefined &&
        this.compareFn(right, smallest) < 0
      ) {
        smallestIndex = rightIndex;
      }

      if (smallestIndex === index) break;

      const temp = this.heap[index];
      const swap = this.heap[smallestIndex];
      if (temp !== undefined && swap !== undefined) {
        this.heap[index] = swap;
        this.heap[smallestIndex] = temp;
      }

      index = smallestIndex;
    }
  }
}

/**
 * Sort sequences without creating a SequenceSorter instance.
 *
 * Convenience function for one-off sorting operations.
 * Returns a sorted array of all sequences.
 *
 * @param sequences - Async iterable of sequences to sort
 * @param options - Optional sorting configuration
 * @returns Promise resolving to sorted array
 *
 * @example
 * ```typescript
 * const sorted = await sortSequences(sequences, { sortBy: 'gc' });
 * console.log(`Highest GC: ${sorted[0].id}`);
 * ```
 *
 * @since v0.1.0
 */
export async function sortSequences(
  sequences: AsyncIterable<AbstractSequence>,
  options?: SortOptions
): Promise<AbstractSequence[]> {
  const sorter = new SequenceSorter(options);
  const result: AbstractSequence[] = [];

  for await (const seq of sorter.sort(sequences)) {
    result.push(seq);
  }

  return result;
}

/**
 * Get top N sequences without creating a SequenceSorter instance.
 *
 * Convenience function for efficient top-N selection from large datasets.
 * Uses a min-heap for O(n*log(k)) performance.
 *
 * @param sequences - Async iterable of sequences to process
 * @param n - Number of top sequences to return
 * @param sortBy - Sorting strategy (default: 'length')
 * @returns Promise resolving to array of top N sequences
 *
 * @example
 * ```typescript
 * // Get 10 highest GC content sequences
 * const topGC = await getTopSequences(sequences, 10, 'gc');
 * topGC.forEach(seq => {
 *   const gc = (seq.sequence.match(/[GC]/gi) || []).length / seq.sequence.length;
 *   console.log(`${seq.id}: ${(gc * 100).toFixed(1)}% GC`);
 * });
 * ```
 *
 * @since v0.1.0
 */
export async function getTopSequences(
  sequences: AsyncIterable<AbstractSequence>,
  n: number,
  sortBy: SortBy = "length"
): Promise<AbstractSequence[]> {
  const sorter = new SequenceSorter({ sortBy });
  const result: AbstractSequence[] = [];

  for await (const seq of sorter.getTopN(sequences, n)) {
    result.push(seq);
  }

  return result;
}
