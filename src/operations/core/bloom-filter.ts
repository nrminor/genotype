/**
 * Bloom filter implementation for space-efficient deduplication
 *
 * Probabilistic data structure for set membership testing
 * Used for deduplication of large sequence datasets with controlled false positive rate
 */

/**
 * Space-efficient probabilistic data structure for set membership
 * Used for deduplication of large sequence datasets
 */
export class BloomFilter {
  private bits: Uint8Array;
  private numHashes: number;
  private numBits: number;
  private hashSeeds: number[];
  private itemCount = 0;

  /**
   * Create Bloom filter with specified false positive rate
   *
   * @param expectedItems - Expected number of items to be added
   * @param falsePositiveRate - Desired false positive rate (default 0.01 = 1%)
   *
   * 🔥 NATIVE CRITICAL: Bit operations and hashing
   */
  constructor(expectedItems: number, falsePositiveRate: number = 0.01) {
    // Tiger Style: Assert inputs
    if (expectedItems <= 0) {
      throw new Error("Expected items must be positive");
    }
    if (falsePositiveRate <= 0 || falsePositiveRate >= 1) {
      throw new Error("False positive rate must be between 0 and 1");
    }

    // Calculate optimal size and hash functions
    // Formula: m = -n * ln(p) / (ln(2)^2)
    this.numBits = Math.ceil((-expectedItems * Math.log(falsePositiveRate)) / Math.log(2) ** 2);

    // Formula: k = m/n * ln(2)
    this.numHashes = Math.ceil((this.numBits / expectedItems) * Math.log(2));

    // Allocate bit array
    this.bits = new Uint8Array(Math.ceil(this.numBits / 8));

    // Generate hash seeds using golden ratio for good distribution
    this.hashSeeds = Array.from(
      { length: this.numHashes },
      (_, i) => (i + 1) * 0x9e3779b9 // Golden ratio constant
    );
  }

  /**
   * Add item to filter
   *
   * 🔥 NATIVE CRITICAL: Bit manipulation operations
   */
  add(item: string): void {
    // Set bits for all hash functions
    for (const seed of this.hashSeeds) {
      const hash = this.hash(item, seed);
      const bitIndex = hash % this.numBits;
      this.setBit(bitIndex);
    }
    this.itemCount++;
  }

  /**
   * Check if item might be in set
   * Returns false if definitely not in set (no false negatives)
   * Returns true if might be in set (possible false positive)
   *
   * 🔥 NATIVE CRITICAL: Bit testing operations
   */
  contains(item: string): boolean {
    // Check bits for all hash functions
    for (const seed of this.hashSeeds) {
      const hash = this.hash(item, seed);
      const bitIndex = hash % this.numBits;

      if (!this.getBit(bitIndex)) {
        return false; // Definitely not in set
      }
    }

    return true; // Might be in set (or false positive)
  }

  /**
   * Add multiple items efficiently
   */
  addMany(items: Iterable<string>): void {
    for (const item of items) {
      this.add(item);
    }
  }

  /**
   * Check multiple items efficiently
   */
  containsMany(items: Iterable<string>): Map<string, boolean> {
    const results = new Map<string, boolean>();
    for (const item of items) {
      results.set(item, this.contains(item));
    }
    return results;
  }

  /**
   * Set bit at specific index
   */
  private setBit(bitIndex: number): void {
    const byteIndex = Math.floor(bitIndex / 8);
    const bitOffset = bitIndex % 8;
    const byte = this.bits[byteIndex];
    if (byte !== undefined) {
      this.bits[byteIndex] = byte | (1 << bitOffset);
    }
  }

  /**
   * Get bit at specific index
   */
  private getBit(bitIndex: number): boolean {
    const byteIndex = Math.floor(bitIndex / 8);
    const bitOffset = bitIndex % 8;
    const byte = this.bits[byteIndex];
    return byte !== undefined && (byte & (1 << bitOffset)) !== 0;
  }

  /**
   * MurmurHash3 implementation for fast, high-quality hashing
   *
   * 🔥 NATIVE CRITICAL: Hash function performance
   */
  private hash(str: string, seed: number): number {
    let h1 = seed;
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;
    const r1 = 15;
    const r2 = 13;
    const m = 5;
    const n = 0xe6546b64;

    // Process string 4 bytes at a time
    let i = 0;
    const len = str.length;
    const nblocks = Math.floor(len / 4);

    for (let block = 0; block < nblocks; block++) {
      let k1 = 0;
      for (let j = 0; j < 4; j++) {
        k1 |= (str.charCodeAt(i++) & 0xff) << (j * 8);
      }

      k1 = Math.imul(k1, c1);
      k1 = (k1 << r1) | (k1 >>> (32 - r1));
      k1 = Math.imul(k1, c2);

      h1 ^= k1;
      h1 = (h1 << r2) | (h1 >>> (32 - r2));
      h1 = Math.imul(h1, m) + n;
    }

    // Process remaining bytes
    let k1 = 0;
    const remainder = len % 4;
    for (let j = 0; j < remainder; j++) {
      k1 |= (str.charCodeAt(i++) & 0xff) << (j * 8);
    }

    if (remainder > 0) {
      k1 = Math.imul(k1, c1);
      k1 = (k1 << r1) | (k1 >>> (32 - r1));
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
    }

    // Finalization
    h1 ^= len;
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x85ebca6b);
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;

    return h1 >>> 0; // Convert to unsigned 32-bit
  }

  /**
   * Estimate current false positive rate based on fill ratio
   */
  getFalsePositiveRate(): number {
    const setBits = this.countSetBits();
    const fillRatio = setBits / this.numBits;

    // Formula: (1 - e^(-k*n/m))^k
    // Approximation: fillRatio^k
    return fillRatio ** this.numHashes;
  }

  /**
   * Count number of set bits (popcount)
   */
  private countSetBits(): number {
    let count = 0;

    for (const byte of this.bits) {
      // Brian Kernighan's algorithm for counting set bits
      let b = byte;
      while (b) {
        count++;
        b &= b - 1;
      }
    }

    return count;
  }

  /**
   * Get filter statistics
   */
  getStats(): {
    numBits: number;
    numHashes: number;
    itemCount: number;
    fillRatio: number;
    estimatedFPR: number;
    sizeBytes: number;
  } {
    const setBits = this.countSetBits();

    return {
      numBits: this.numBits,
      numHashes: this.numHashes,
      itemCount: this.itemCount,
      fillRatio: setBits / this.numBits,
      estimatedFPR: this.getFalsePositiveRate(),
      sizeBytes: this.bits.length,
    };
  }

  /**
   * Reset filter for reuse
   */
  reset(): void {
    this.bits.fill(0);
    this.itemCount = 0;
  }

  /**
   * Create union of two bloom filters
   * Both filters must have same parameters
   */
  union(other: BloomFilter): BloomFilter {
    if (this.numBits !== other.numBits || this.numHashes !== other.numHashes) {
      throw new Error("Bloom filters must have same parameters for union");
    }

    const result = new BloomFilter(1, 0.01); // Dummy params, will override
    result.numBits = this.numBits;
    result.numHashes = this.numHashes;
    result.hashSeeds = [...this.hashSeeds];
    result.bits = new Uint8Array(this.bits.length);

    // OR the bit arrays
    for (let i = 0; i < this.bits.length; i++) {
      const thisBit = this.bits[i];
      const otherBit = other.bits[i];
      if (thisBit !== undefined && otherBit !== undefined) {
        result.bits[i] = thisBit | otherBit;
      }
    }

    result.itemCount = this.itemCount + other.itemCount; // Approximate
    return result;
  }

  /**
   * Create intersection of two bloom filters
   * Both filters must have same parameters
   */
  intersection(other: BloomFilter): BloomFilter {
    if (this.numBits !== other.numBits || this.numHashes !== other.numHashes) {
      throw new Error("Bloom filters must have same parameters for intersection");
    }

    const result = new BloomFilter(1, 0.01); // Dummy params, will override
    result.numBits = this.numBits;
    result.numHashes = this.numHashes;
    result.hashSeeds = [...this.hashSeeds];
    result.bits = new Uint8Array(this.bits.length);

    // AND the bit arrays
    for (let i = 0; i < this.bits.length; i++) {
      const thisBit = this.bits[i];
      const otherBit = other.bits[i];
      if (thisBit !== undefined && otherBit !== undefined) {
        result.bits[i] = thisBit & otherBit;
      }
    }

    // Item count is unknown for intersection
    result.itemCount = 0;
    return result;
  }
}

/**
 * Counting Bloom filter for removable items
 * Uses more memory but allows deletion
 */
export class CountingBloomFilter {
  private counts: Uint8Array;
  private readonly numHashes: number;
  private readonly numBuckets: number;
  private readonly hashSeeds: number[];
  private itemCount = 0;

  constructor(expectedItems: number, falsePositiveRate: number = 0.01) {
    // Tiger Style: Assert inputs
    if (expectedItems <= 0) {
      throw new Error("Expected items must be positive");
    }
    if (falsePositiveRate <= 0 || falsePositiveRate >= 1) {
      throw new Error("False positive rate must be between 0 and 1");
    }

    // Similar setup to regular Bloom filter but with counters
    this.numBuckets = Math.ceil((-expectedItems * Math.log(falsePositiveRate)) / Math.log(2) ** 2);

    this.numHashes = Math.ceil((this.numBuckets / expectedItems) * Math.log(2));

    // Use counters instead of bits (max count 255)
    this.counts = new Uint8Array(this.numBuckets);

    this.hashSeeds = Array.from({ length: this.numHashes }, (_, i) => (i + 1) * 0x9e3779b9);
  }

  /**
   * Add item (increment counters)
   *
   * 🔥 NATIVE OPTIMIZATION: Vectorized counter updates
   */
  add(item: string): void {
    for (const seed of this.hashSeeds) {
      const index = this.hash(item, seed) % this.numBuckets;
      const count = this.counts[index];
      if (count !== undefined && count < 255) {
        this.counts[index] = count + 1;
      }
    }
    this.itemCount++;
  }

  /**
   * Remove item (decrement counters)
   * Allows deletion unlike regular Bloom filter
   */
  remove(item: string): void {
    // First check if item might be present
    if (!this.contains(item)) {
      return;
    }

    for (const seed of this.hashSeeds) {
      const index = this.hash(item, seed) % this.numBuckets;
      const count = this.counts[index];
      if (count !== undefined && count > 0) {
        this.counts[index] = count - 1;
      }
    }
    this.itemCount = Math.max(0, this.itemCount - 1);
  }

  /**
   * Check if item might be in set
   */
  contains(item: string): boolean {
    for (const seed of this.hashSeeds) {
      const index = this.hash(item, seed) % this.numBuckets;
      if (this.counts[index] === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get filter statistics
   */
  getStats(): {
    numBuckets: number;
    numHashes: number;
    itemCount: number;
    nonZeroBuckets: number;
    maxCount: number;
    avgCount: number;
  } {
    let nonZero = 0;
    let maxCount = 0;
    let totalCount = 0;

    for (const count of this.counts) {
      if (count > 0) {
        nonZero++;
        totalCount += count;
        maxCount = Math.max(maxCount, count);
      }
    }

    return {
      numBuckets: this.numBuckets,
      numHashes: this.numHashes,
      itemCount: this.itemCount,
      nonZeroBuckets: nonZero,
      maxCount,
      avgCount: nonZero > 0 ? totalCount / nonZero : 0,
    };
  }

  /**
   * Reset filter
   */
  reset(): void {
    this.counts.fill(0);
    this.itemCount = 0;
  }

  /**
   * MurmurHash3 (same as BloomFilter)
   */
  private hash(str: string, seed: number): number {
    let h1 = seed;
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;

    for (let i = 0; i < str.length; i++) {
      let k1 = str.charCodeAt(i);

      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);

      h1 ^= k1;
      h1 = (h1 << 13) | (h1 >>> 19);
      h1 = Math.imul(h1, 5) + 0xe6546b64;
    }

    h1 ^= str.length;
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x85ebca6b);
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;

    return h1 >>> 0;
  }
}

/**
 * Scalable Bloom Filter that grows as needed
 * Maintains target false positive rate as items are added
 */
export class ScalableBloomFilter {
  private filters: BloomFilter[] = [];
  private readonly initialSize: number;
  private readonly growthFactor: number;
  private readonly targetFPR: number;
  private totalItems = 0;

  constructor(initialSize: number = 1000, targetFPR: number = 0.01, growthFactor: number = 2) {
    // Tiger Style: Assert inputs
    if (initialSize <= 0) {
      throw new Error("Initial size must be positive");
    }
    if (targetFPR <= 0 || targetFPR >= 1) {
      throw new Error("False positive rate must be between 0 and 1");
    }
    if (growthFactor <= 1) {
      throw new Error("Growth factor must be greater than 1");
    }

    this.initialSize = initialSize;
    this.targetFPR = targetFPR;
    this.growthFactor = growthFactor;

    // Create initial filter
    this.addNewFilter();
  }

  /**
   * Add item to the scalable filter
   */
  add(item: string): void {
    // Check if item already exists
    if (this.contains(item)) {
      return;
    }

    // Add to current filter
    const currentFilter = this.filters[this.filters.length - 1];
    if (currentFilter) {
      currentFilter.add(item);
      this.totalItems++;

      // Check if we need a new filter
      const stats = currentFilter.getStats();
      if (stats.estimatedFPR > this.targetFPR * 0.9) {
        this.addNewFilter();
      }
    }
  }

  /**
   * Check if item exists in any filter
   */
  contains(item: string): boolean {
    for (const filter of this.filters) {
      if (filter.contains(item)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Add a new filter with increased capacity
   */
  private addNewFilter(): void {
    const filterIndex = this.filters.length;
    const size = this.initialSize * this.growthFactor ** filterIndex;

    // Tighter FPR for newer filters to maintain overall target
    const fpr = this.targetFPR * 0.5 ** (filterIndex + 1);

    this.filters.push(new BloomFilter(Math.ceil(size), fpr));
  }

  /**
   * Get statistics for all filters
   */
  getStats(): {
    numFilters: number;
    totalItems: number;
    totalSizeBytes: number;
    filters: Array<ReturnType<BloomFilter["getStats"]>>;
  } {
    let totalSize = 0;
    const filterStats = [];

    for (const filter of this.filters) {
      const stats = filter.getStats();
      totalSize += stats.sizeBytes;
      filterStats.push(stats);
    }

    return {
      numFilters: this.filters.length,
      totalItems: this.totalItems,
      totalSizeBytes: totalSize,
      filters: filterStats,
    };
  }

  /**
   * Reset all filters
   */
  reset(): void {
    this.filters = [];
    this.totalItems = 0;
    this.addNewFilter();
  }
}
