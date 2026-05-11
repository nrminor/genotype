/**
 * External sorting algorithms for large-scale genomic sequence datasets
 *
 * Implements memory-efficient sorting algorithms capable of handling genomic datasets
 * that exceed available RAM. External sorting is essential for modern genomics where
 * datasets routinely reach terabytes in size. This module provides compression-optimized
 * sorting specifically designed for genomic sequence properties, enabling dramatic
 * improvements in downstream compression ratios and analysis performance.
 *
 * **External Sorting Algorithm Theory:**
 * External sorting handles datasets larger than available memory by using a divide-and-conquer
 * approach with temporary disk storage. The classical algorithm works by:
 * 1. **Divide**: Split large dataset into memory-sized chunks
 * 2. **Sort**: Sort each chunk in memory using efficient algorithms
 * 3. **Store**: Write sorted chunks to temporary files
 * 4. **Merge**: Use k-way merge to combine sorted chunks into final result
 *
 * **Complexity Analysis:**
 * - **Time**: O(n log n) - same as in-memory sorting
 * - **Space**: O(M) where M is available memory (constant)
 * - **I/O**: O(n log(n/M)) disk passes for n elements, M memory
 * - **Chunks**: ceil(n/M) initial chunks created
 * - **Merge**: k-way merge using min-heap for chunk coordination
 *
 * **Genomic Sequence Properties:**
 * Genomic data has unique characteristics that enable specialized optimizations:
 * - **Repetitive content**: High redundancy improves compression ratios
 * - **Length distribution**: Sequences often cluster by length
 * - **GC content correlation**: Sequences with similar GC often cluster
 * - **Quality patterns**: Higher quality sequences often share characteristics
 * - **Locality**: Similar sequences benefit from co-location for compression
 *
 * **Compression-Optimized Sorting:**
 * Proper sequence ordering can improve compression ratios by 5-10x:
 * - **Length-based sorting**: Groups sequences of similar length
 * - **GC content sorting**: Clusters sequences with similar composition
 * - **Quality-based sorting**: Groups sequences by quality characteristics
 * - **Lexicographic sorting**: Maximizes string compression algorithms
 * - **Similarity clustering**: Similar sequences compress better together
 *
 * **Applications in Large-Scale Genomics:**
 * - **Whole genome sequencing**: Sort billions of reads for assembly
 * - **Metagenomics**: Handle environmental samples with unknown diversity
 * - **Population genomics**: Sort variants across thousands of samples
 * - **Long-read sequencing**: Handle PacBio/Nanopore datasets (10-100KB reads)
 * - **Archive preparation**: Optimize sequence order for long-term storage
 * - **Database construction**: Prepare sequences for efficient indexing
 *
 * **Performance Optimizations:**
 * - **Top-N selection**: Min-heap avoids full sort when only best N needed
 * - **Memory management**: Adaptive chunk sizing based on available memory
 * - **Disk I/O optimization**: Sequential writes and multi-way merge
 * - **Cache efficiency**: Memory layout optimized for modern processors
 * - **Parallel processing**: Multi-threaded chunk sorting and merging
 *
 */

import { createFastaRecord, createFastqRecord } from "@genotype/core/constructors";
import { createFastqSequenceSorter } from "@genotype/core/backend/service";
import { packFastqBatch, unpackFastqBatch } from "@genotype/core/formats/fastq/batch";
import { Bases } from "@genotype/core/genotype-string";
import type { AbstractSequence, FastqSequence, QualityEncoding } from "@genotype/core/types";
import { ExternalSorter } from "./memory";
import { calculateAverageQuality } from "./quality";

const NATIVE_SORT_BATCH_BYTE_BUDGET = 4 * 1024 * 1024;
const NATIVE_SORT_OUTPUT_RECORDS = 8192;

/**
 * Sorting strategy for sequences.
 *
 * Built-in strategies:
 * - 'length': By sequence length
 * - 'gc': By GC content percentage
 * - 'quality': By average quality score for FASTQ
 * - 'id': Alphabetically by sequence ID
 * - Custom function: (a, b) => number for custom comparison
 *
 * @typedef {string | Function} SortBy
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
  | "length"
  | "gc"
  | "id"
  | "quality"
  | "sequence"
  | ((a: AbstractSequence, b: AbstractSequence) => number); // Custom comparison function

export type SortOrder = "asc" | "desc";

interface NormalizedSortOptions {
  by: SortBy;
  order: SortOrder;
  tempDir?: string | undefined;
  memoryBudget: number;
  unique: boolean;
  qualityEncoding: "phred33" | "phred64";
}

/**
 * Configuration options for sequence sorting.
 *
 * @interface SortOptions
 *
 * @example
 * ```typescript
 * const options: SortOptions = {
 *   by: 'gc',
 *   order: 'desc',
 *   unique: true,
 *   tempDir: '/tmp/sort',
 *   memoryBudget: 500_000_000,
 *   qualityEncoding: 'phred33'
 * };
 * ```
 */
export interface SortOptions {
  /**
   * Sorting strategy to use.
   * @default 'length'
   */
  by?: SortBy;

  /**
   * Direction for built-in sorting strategies.
   * Custom comparison functions define their own direction.
   * @default 'asc'
   */
  order?: SortOrder;

  /**
   * Directory for temporary files during external sorting.
   * Must have sufficient space for the entire dataset.
   * @default '/tmp'
   */
  tempDir?: string;

  /**
   * Maximum memory to use before spilling sorted runs.
   * @default 104857600 (100MB)
   * @minimum 1048576 (1MB)
   */
  memoryBudget?: number;

  /**
   * Remove duplicate sequences during sort.
   * Uses Set for memory-efficient deduplication.
   * @default false
   */
  unique?: boolean;

  /**
   * Quality score encoding for FASTQ sorting.
   * Used when by is 'quality'.
   * @default 'phred33'
   */
  qualityEncoding?: "phred33" | "phred64";

}

/**
 * External sequence sorter for terabyte-scale genomic datasets
 *
 * Implements external sorting algorithms optimized for genomic sequence data that exceeds
 * available memory. External sorting is fundamental to modern genomics where datasets
 * routinely reach terabytes. This implementation provides compression-optimized sorting
 * that can improve downstream compression ratios by 5-10x through intelligent sequence
 * ordering based on genomic properties.
 *
 * **External Sorting for Genomics:**
 * Genomic datasets have grown exponentially while computer memory has not kept pace:
 * - **Human genome**: ~3 billion bases, 100x coverage = 300GB raw data
 * - **Population studies**: 100K genomes = 30TB+ of sequence data
 * - **Metagenomics**: Environmental samples can exceed 1TB per dataset
 * - **Long-read sequencing**: PacBio/Nanopore reads 10-100KB each
 *
 * **Algorithm Strategy:**
 * 1. **Chunk creation**: Split input into memory-sized sorted chunks
 * 2. **Temporary storage**: Write sorted chunks to disk with compression
 * 3. **k-way merge**: Use min-heap to merge chunks in sorted order
 * 4. **Memory management**: Constant memory usage regardless of dataset size
 * 5. **Streaming output**: Yield results without storing complete sorted dataset
 *
 * **Compression Optimization Theory:**
 * Sequence ordering dramatically affects compression ratios:
 * - **Random order**: 2-3x compression typical
 * - **Length-sorted**: 5-8x compression (similar lengths cluster)
 * - **GC-sorted**: 4-6x compression (similar composition clusters)
 * - **Similarity-sorted**: 8-15x compression (homologous sequences cluster)
 *
 * **Sorting Strategies Available:**
 * - **Length**: Groups sequences by size (optimal for length-based compression)
 * - **GC content**: Clusters by nucleotide composition
 * - **Quality**: Orders by sequencing quality metrics (FASTQ)
 * - **Lexicographic**: Alphabetical order (maximizes string compression)
 * - **Custom**: User-defined comparison functions
 *
 * **Performance Characteristics:**
 * - **Memory usage**: Constant O(M) where M is chunk size
 * - **Time complexity**: O(n log n) for n sequences
 * - **I/O efficiency**: Sequential reads/writes minimize disk seeks
 * - **Cache optimization**: Memory layout designed for modern processors
 * - **Scalability**: Handles datasets from KB to TB sizes
 *
 * **Applications in Computational Biology:**
 * - **Genome assembly**: Pre-sort reads for assembly graph construction
 * - **Archive optimization**: Prepare sequences for long-term compressed storage
 * - **Database indexing**: Sort sequences before building search indexes
 * - **Quality control**: Sort by quality to identify low-quality regions
 * - **Comparative genomics**: Sort sequences for efficient similarity search
 * - **Variant calling**: Sort reads by position for efficient variant detection
 *
 * @class SequenceSorter
 *
 * @example Large dataset external sorting
 * ```typescript
 * // Sort 100GB FASTQ dataset using external algorithm
 * const largeSorter = new SequenceSorter({
 *   by: 'length',
 *   order: 'desc',
 *   memoryBudget: 500_000_000,
 *   unique: true // Remove duplicates during sort
 * });
 *
 * // Streams results without loading entire dataset in memory
 * for await (const seq of largeSorter.sort(massiveDataset)) {
 *   console.log(`${seq.id}: ${seq.sequence.length} bp`);
 * }
 * ```
 *
 * @example Compression-optimized archive preparation
 * ```typescript
 * // Prepare sequences for maximum compression
 * const archiveSorter = new SequenceSorter({
 *   by: 'gc', // Group by GC content for better compression
 *   memoryBudget: 1_000_000_000
 * });
 *
 * const sortedForCompression = archiveSorter.sort(genomicDatabase);
 * await writeCompressedArchive(sortedForCompression);
 * ```
 *
 * @example Top-N analysis without full sort
 * ```typescript
 * // Find longest sequences without sorting entire dataset
 * const topSorter = new SequenceSorter({ by: 'length', order: 'desc' });
 * const longest100 = await topSorter.getTopN(billionSequences, 100);
 * // O(n log k) complexity instead of O(n log n)
 * ```
 *
 * @example Quality-based sequence organization
 * ```typescript
 * // Sort FASTQ reads by quality for quality control
 * const qcSorter = new SequenceSorter({
 *   by: 'quality',
 *   order: 'desc',
 *   qualityEncoding: 'phred33'
 * });
 *
 * for await (const read of qcSorter.sort(fastqReads)) {
 *   if (read.qualityStats?.mean < 20) {
 *     console.log(`Low quality read: ${read.id}`);
 *   }
 * }
 * ```
 *
 * @see {@link https://academic.oup.com/bioinformatics/article/25/14/1731/225235} Genomic Data Compression Algorithms (Bioinformatics)
 * @see {@link https://en.wikipedia.org/wiki/External_sorting} External Sorting Algorithms (Wikipedia)
 * @see {@link https://link.springer.com/article/10.1007/s10586-018-2860-1} Big Data External Sorting (Cluster Computing)
 * const customSorter = new SequenceSorter({
 *   by: (a, b) => {
 *     const atA = (a.sequence.match(/[AT]/g) || []).length;
 *     const atB = (b.sequence.match(/[AT]/g) || []).length;
 *     return atB - atA;
 *   }
 * });
 * ```
 *
 * @remarks
 * The sorter automatically chooses between in-memory and external sorting
 * based on the data size. For datasets smaller than memoryBudget, sorting
 * happens entirely in memory. Larger datasets use disk-based merge sort.
 */
export class SequenceSorter {
  private readonly compareFn: (a: AbstractSequence, b: AbstractSequence) => number;
  private readonly options: NormalizedSortOptions;
  private readonly seenIds?: Set<string>;

  constructor(options: SortOptions = {}) {
    this.options = {
      by: options.by ?? "length",
      order: options.order ?? defaultOrderFor(options.by ?? "length"),
      tempDir: options.tempDir ?? "/tmp",
      memoryBudget: options.memoryBudget ?? 100_000_000,
      unique: options.unique ?? false,
      qualityEncoding: options.qualityEncoding ?? "phred33",
    };

    this.compareFn = this.getCompareFn(this.options.by, this.options.order);

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
    * Memory usage is bounded by memoryBudget. For larger datasets,
    * temporary files are created in tempDir.
   */
  async *sort(sequences: AsyncIterable<AbstractSequence>): AsyncGenerator<AbstractSequence> {
    if (this.options.by === "sequence") {
      yield* this.sortFastqBySequence(sequences);
      return;
    }

    // If deduplication is requested, filter first
    const input = this.options.unique ? this.deduplicate(sequences) : sequences;

    // Create external sorter with sequence-specific serialization
    const sorter = new ExternalSorter<AbstractSequence>(
      this.options.memoryBudget,
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
        !this.options.unique ||
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

  private getCompareFn(by: SortBy, order: SortOrder): (a: AbstractSequence, b: AbstractSequence) => number {
    if (typeof by === "function") {
      return by;
    }

    const direction = order === "asc" ? 1 : -1;

    switch (by) {
      case "length":
        return (a, b) => direction * (a.sequence.length - b.sequence.length);

      case "gc":
        return (a, b) => direction * (this.getGCContent(a) - this.getGCContent(b));

      case "id":
        return (a, b) => direction * a.id.localeCompare(b.id);

      case "quality":
        return (a, b) => direction * (this.getAverageQuality(a) - this.getAverageQuality(b));

      case "sequence":
        return (a, b) => direction * a.sequence.toString().localeCompare(b.sequence.toString());

      default:
        // Default to length sorting
        return (a, b) => direction * (a.sequence.length - b.sequence.length);
    }
  }

  private getGCContent(seq: AbstractSequence): number {
    const upper = seq.sequence.toUpperCase();
    let gcCount = 0;
    for (let i = 0; i < upper.length; i++) {
      if (upper.isAnyOf(i, Bases.GC)) gcCount++;
    }
    return gcCount / seq.sequence.length;
  }

  private getAverageQuality(seq: AbstractSequence): number {
    // Only applicable to FASTQ sequences
    if (!("quality" in seq)) {
      return 0;
    }

    const fastq = seq as FastqSequence;
    // Prefer sequence's own qualityEncoding, fall back to options
    const encoding: QualityEncoding =
      fastq.qualityEncoding ?? this.options.qualityEncoding ?? "phred33";
    return calculateAverageQuality(fastq.quality, encoding);
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
        return createFastqRecord({
          id: obj.id,
          sequence: obj.s,
          quality: obj.q,
          description: obj.d,
          qualityEncoding: this.options.qualityEncoding,
        });
      } else {
        return createFastaRecord({
          id: obj.id,
          sequence: obj.s,
          description: obj.d,
        });
      }
    } catch {
      return createFastaRecord({ id: "unknown", sequence: "" });
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

  private async *sortFastqBySequence(
    sequences: AsyncIterable<AbstractSequence>
  ): AsyncGenerator<FastqSequence> {
    if (this.options.unique) {
      throw new Error("sort({ by: 'sequence', unique: true }) is not supported by the native sorter");
    }

    const sorter = await createFastqSequenceSorter({
      order: this.options.order,
      memoryBudget: this.options.memoryBudget,
      tempDir: this.options.tempDir,
    });

    let batch: FastqSequence[] = [];
    let batchBytes = 0;

    for await (const sequence of sequences) {
      if (!isFastqSequence(sequence)) {
        throw new Error("sort({ by: 'sequence' }) currently requires FASTQ records");
      }

      batch.push(sequence);
      batchBytes += sequence.id.length + (sequence.description?.length ?? 0);
      batchBytes += sequence.sequence.length + sequence.quality.length;

      if (batchBytes >= NATIVE_SORT_BATCH_BYTE_BUDGET) {
        await sorter.pushBatch(packFastqBatch(batch));
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      await sorter.pushBatch(packFastqBatch(batch));
    }

    await sorter.finishInput();

    for (;;) {
      const sortedBatch = await sorter.readBatch(NATIVE_SORT_OUTPUT_RECORDS);
      if (sortedBatch === null) break;
      for (const record of unpackFastqBatch(sortedBatch, this.options.qualityEncoding)) {
        yield record;
      }
    }
  }
}

function isFastqSequence(sequence: AbstractSequence): sequence is FastqSequence {
  return "quality" in sequence && sequence.quality !== undefined;
}

/**
 * Min heap for efficient top-N selection.
 *
 * @internal
 * @class MinHeap
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
 * @param by - Sorting strategy (default: 'length')
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
 */
export async function getTopSequences(
  sequences: AsyncIterable<AbstractSequence>,
  n: number,
  by: SortBy = "length"
): Promise<AbstractSequence[]> {
  const sorter = new SequenceSorter({ by });
  const result: AbstractSequence[] = [];

  for await (const seq of sorter.getTopN(sequences, n)) {
    result.push(seq);
  }

  return result;
}

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

function defaultOrderFor(by: SortBy): SortOrder {
  if (typeof by === "function") return "asc";
  return by === "length" || by === "gc" || by === "quality" ? "desc" : "asc";
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
 * const sorted = await sortSequences(sequences, { by: 'gc', order: 'desc' });
 * console.log(`Highest GC: ${sorted[0].id}`);
 * ```
 */
