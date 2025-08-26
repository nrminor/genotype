/**
 * Memory management strategies for large-scale genomic data processing
 *
 * Provides constant-memory algorithms for operations on datasets larger than available RAM
 * Includes external sorting, memory monitoring, and disk-based processing strategies
 */

/**
 * Memory management strategy for operations
 */
export enum MemoryStrategy {
  STREAMING = 'streaming', // Pure streaming, O(1) memory
  BUFFERED = 'buffered', // Small buffer for performance
  EXTERNAL = 'external', // Disk-based for huge datasets
  BLOOM_FILTER = 'bloom_filter', // Probabilistic for deduplication
}

/**
 * Memory monitor interface for tracking and managing memory usage
 */
export interface MemoryMonitor {
  heapUsed(): number;
  heapLimit(): number;
  shouldSwitchToExternal(): boolean;
  suggestGC(): void;
}

/**
 * Default memory monitor implementation
 * Switches to external algorithms when heap usage exceeds threshold
 */
export class DefaultMemoryMonitor implements MemoryMonitor {
  private readonly threshold: number;

  constructor(thresholdBytes: number = 1_000_000_000) {
    // Default 1GB
    this.threshold = thresholdBytes;
  }

  heapUsed(): number {
    return process.memoryUsage().heapUsed;
  }

  heapLimit(): number {
    return process.memoryUsage().heapTotal;
  }

  shouldSwitchToExternal(): boolean {
    return this.heapUsed() > this.threshold;
  }

  suggestGC(): void {
    if (typeof global !== 'undefined' && global.gc) {
      global.gc();
    }
  }
}

/**
 * External merge sort for datasets larger than available RAM
 * Sorts data in chunks that fit in memory, then merges the sorted chunks
 *
 * 🔥 ZIG OPTIMIZATION: File I/O and sorting could be significantly optimized
 */
export class ExternalSorter<T> {
  private chunkFiles: string[] = [];
  private chunkIndex = 0;

  constructor(
    private readonly chunkSize: number = 100_000_000, // 100MB chunks
    private readonly tempDir: string = '/tmp',
    private readonly serialize: (item: T) => string,
    private readonly deserialize: (line: string) => T
  ) {}

  /**
   * Sort items using external merge sort algorithm
   * Handles datasets larger than available RAM
   */
  async *sort(items: AsyncIterable<T>, compareFn: (a: T, b: T) => number): AsyncIterable<T> {
    // Phase 1: Sort chunks and write to temp files
    await this.createSortedChunks(items, compareFn);

    // Phase 2: Merge sorted chunks
    yield* this.mergeSortedChunks(compareFn);

    // Cleanup temp files
    await this.cleanup();
  }

  /**
   * Create sorted chunks and write to disk
   * 🔥 ZIG: In-memory sorting could use parallel quicksort
   */
  private async createSortedChunks(
    items: AsyncIterable<T>,
    compareFn: (a: T, b: T) => number
  ): Promise<void> {
    let chunk: T[] = [];
    let chunkBytes = 0;

    for await (const item of items) {
      chunk.push(item);
      chunkBytes += this.serialize(item).length;

      if (chunkBytes >= this.chunkSize) {
        chunk.sort(compareFn);
        await this.writeChunk(chunk);
        chunk = [];
        chunkBytes = 0;
      }
    }

    // Write final chunk if not empty
    if (chunk.length > 0) {
      chunk.sort(compareFn);
      await this.writeChunk(chunk);
    }
  }

  /**
   * Write sorted chunk to temporary file
   */
  private async writeChunk(chunk: T[]): Promise<void> {
    const fileName = `${this.tempDir}/sort_${Date.now()}_${this.chunkIndex++}.tmp`;
    const lines = chunk.map((item) => this.serialize(item)).join('\n');
    const file = Bun.file(fileName);
    await Bun.write(file, lines);
    this.chunkFiles.push(fileName);
  }

  /**
   * Merge sorted chunks using k-way merge
   * 🔥 ZIG: Could optimize with binary heap for merge
   */
  private async *mergeSortedChunks(compareFn: (a: T, b: T) => number): AsyncIterable<T> {
    if (this.chunkFiles.length === 0) return;

    // Open all chunk files
    const iterators = await Promise.all(
      this.chunkFiles.map((file) => this.createFileIterator(file))
    );

    // Create heap for k-way merge
    const heap = new MinHeap<{ value: T; source: number }>((a, b) => compareFn(a.value, b.value));

    // Initialize heap with first element from each file
    for (let i = 0; i < iterators.length; i++) {
      const iterator = iterators[i];
      if (iterator) {
        const { value, done } = await iterator.next();
        if (done === false && value !== undefined) {
          heap.insert({ value, source: i });
        }
      }
    }

    // Merge process
    while (!heap.isEmpty()) {
      const min = heap.extractMin();
      if (!min) break;

      yield min.value;

      // Get next element from same source
      const iterator = iterators[min.source];
      if (iterator) {
        const { value, done } = await iterator.next();
        if (done === false && value !== undefined) {
          heap.insert({ value, source: min.source });
        }
      }
    }
  }

  /**
   * Create async iterator for reading sorted chunk file
   */
  private async createFileIterator(fileName: string): Promise<AsyncIterator<T>> {
    const file = Bun.file(fileName);
    const text = await file.text();
    const lines = text.split('\n').filter((line) => line.length > 0);
    let index = 0;
    const deserialize = this.deserialize;

    return {
      async next(): Promise<IteratorResult<T>> {
        if (index >= lines.length) {
          return { done: true, value: undefined };
        }
        const line = lines[index++];
        const value =
          line !== undefined && line !== null && line !== '' ? deserialize(line) : undefined;
        return { done: false, value: value as T };
      },
    };
  }

  /**
   * Clean up temporary files
   */
  private async cleanup(): Promise<void> {
    for (const fileName of this.chunkFiles) {
      try {
        await Bun.file(fileName).unlink();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.chunkFiles = [];
  }
}

/**
 * Min-heap implementation for k-way merge
 */
class MinHeap<T> {
  private heap: T[] = [];

  constructor(private readonly compareFn: (a: T, b: T) => number) {}

  insert(value: T): void {
    this.heap.push(value);
    this.bubbleUp(this.heap.length - 1);
  }

  extractMin(): T | undefined {
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

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const current = this.heap[index];
      const parent = this.heap[parentIndex];
      if (current === undefined || parent === undefined || this.compareFn(current, parent) >= 0) {
        break;
      }
      this.swap(index, parentIndex);
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;

    while (true) {
      const leftIndex = 2 * index + 1;
      const rightIndex = 2 * index + 2;
      let smallestIndex = index;

      const left = this.heap[leftIndex];
      const smallest = this.heap[smallestIndex];
      if (
        leftIndex < length &&
        left !== undefined &&
        smallest !== undefined &&
        this.compareFn(left, smallest) < 0
      ) {
        smallestIndex = leftIndex;
      }

      const right = this.heap[rightIndex];
      const currentSmallest = this.heap[smallestIndex];
      if (
        rightIndex < length &&
        right !== undefined &&
        currentSmallest !== undefined &&
        this.compareFn(right, currentSmallest) < 0
      ) {
        smallestIndex = rightIndex;
      }

      if (smallestIndex === index) break;

      this.swap(index, smallestIndex);
      index = smallestIndex;
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    if (temp !== undefined && this.heap[j] !== undefined) {
      this.heap[i] = this.heap[j];
      this.heap[j] = temp;
    }
  }
}

/**
 * Memory-aware buffering strategy
 * Automatically adjusts buffer size based on available memory
 */
export class AdaptiveBuffer<T> {
  private buffer: T[] = [];
  private readonly monitor: MemoryMonitor;

  constructor(
    private readonly maxSize: number = 10000,
    monitor?: MemoryMonitor
  ) {
    this.monitor = monitor ?? new DefaultMemoryMonitor();
  }

  /**
   * Add item to buffer, flushing if necessary
   */
  async add(item: T, flushCallback: (items: T[]) => Promise<void>): Promise<void> {
    this.buffer.push(item);

    if (this.shouldFlush()) {
      await this.flush(flushCallback);
    }
  }

  /**
   * Determine if buffer should be flushed
   */
  private shouldFlush(): boolean {
    return this.buffer.length >= this.maxSize || this.monitor.shouldSwitchToExternal();
  }

  /**
   * Flush buffer contents
   */
  async flush(callback: (items: T[]) => Promise<void>): Promise<void> {
    if (this.buffer.length === 0) return;

    const items = this.buffer;
    this.buffer = [];
    await callback(items);

    // Suggest GC after large flush
    if (items.length > this.maxSize / 2) {
      this.monitor.suggestGC();
    }
  }

  /**
   * Get current buffer size
   */
  size(): number {
    return this.buffer.length;
  }

  /**
   * Clear buffer without flushing
   */
  clear(): void {
    this.buffer = [];
  }
}

/**
 * Disk-based cache for intermediate results
 * Used when memory is constrained
 */
export class DiskCache<T> {
  private readonly cacheFiles = new Map<string, string>();
  private readonly tempDir: string;

  constructor(
    tempDir: string = '/tmp',
    private readonly serialize: (item: T) => string,
    private readonly deserialize: (data: string) => T
  ) {
    this.tempDir = tempDir;
  }

  /**
   * Store item to disk cache
   */
  async put(key: string, value: T): Promise<void> {
    const fileName = `${this.tempDir}/cache_${key}_${Date.now()}.tmp`;
    const data = this.serialize(value);
    await Bun.write(fileName, data);
    this.cacheFiles.set(key, fileName);
  }

  /**
   * Retrieve item from disk cache
   */
  async get(key: string): Promise<T | undefined> {
    const fileName = this.cacheFiles.get(key);
    if (fileName === undefined || fileName === null || fileName === '') return undefined;

    try {
      const file = Bun.file(fileName);
      const data = await file.text();
      return this.deserialize(data);
    } catch {
      return undefined;
    }
  }

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    return this.cacheFiles.has(key);
  }

  /**
   * Remove item from cache
   */
  async delete(key: string): Promise<boolean> {
    const fileName = this.cacheFiles.get(key);
    if (fileName === undefined || fileName === null || fileName === '') return false;

    try {
      await Bun.file(fileName).unlink();
      this.cacheFiles.delete(key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    for (const [key, fileName] of this.cacheFiles) {
      try {
        await Bun.file(fileName).unlink();
      } catch (error) {
        // Log cleanup errors for debugging cache issues
        console.warn(
          `Failed to cleanup cache file ${fileName} for key ${key}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    this.cacheFiles.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cacheFiles.size;
  }
}
