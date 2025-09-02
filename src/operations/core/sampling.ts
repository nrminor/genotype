/**
 * Reservoir sampling for selecting random samples from streams
 *
 * Maintains fixed memory usage regardless of stream size
 * Critical for sampling large genomic datasets that don't fit in memory
 */

/**
 * Reservoir sampling for selecting random samples from streams
 * Maintains fixed memory regardless of stream size
 */
export class ReservoirSampler<T> {
  private reservoir: T[] = [];
  private seen = 0;
  private readonly rng: () => number;

  constructor(
    private readonly size: number,
    seed?: number
  ) {
    // Tiger Style: Assert inputs
    if (size <= 0) {
      throw new Error('Reservoir size must be positive');
    }

    // Initialize RNG with optional seed for reproducibility
    this.rng = seed !== undefined ? this.createSeededRNG(seed) : Math.random;
  }

  /**
   * Add item to reservoir using reservoir sampling algorithm
   * Each item has equal probability of being selected
   *
   * 🔥 NATIVE OPTIMIZATION: Random number generation
   */
  add(item: T): void {
    this.seen++;

    if (this.reservoir.length < this.size) {
      // Fill reservoir until full
      this.reservoir.push(item);
    } else {
      // Randomly replace items with decreasing probability
      // Probability of keeping new item = size / seen
      const j = Math.floor(this.rng() * this.seen);
      if (j < this.size) {
        this.reservoir[j] = item;
      }
    }
  }

  /**
   * Process entire stream and return sample
   */
  async sampleStream(stream: AsyncIterable<T>): Promise<T[]> {
    for await (const item of stream) {
      this.add(item);
    }
    return this.getSample();
  }

  /**
   * Get current sample
   * Returns copy to prevent external modification
   */
  getSample(): T[] {
    return [...this.reservoir];
  }

  /**
   * Get number of items seen so far
   */
  getSeenCount(): number {
    return this.seen;
  }

  /**
   * Get current reservoir fill level
   */
  getCurrentSize(): number {
    return this.reservoir.length;
  }

  /**
   * Reset sampler for reuse
   */
  reset(): void {
    this.reservoir = [];
    this.seen = 0;
  }

  /**
   * Create seeded random number generator using xorshift algorithm
   * Provides reproducible sampling when seed is specified
   *
   * 🔥 NATIVE OPTIMIZATION: Fast PRNG implementation
   */
  private createSeededRNG(seed: number): () => number {
    // Use xorshift32 for fast, good-quality random numbers
    let state = seed;

    return () => {
      // xorshift32 algorithm
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      // Convert to [0, 1) range
      return (state >>> 0) / 0x100000000;
    };
  }
}

/**
 * Systematic sampling - select every Nth item
 * Useful for regular sampling from ordered data
 */
export class SystematicSampler<T> {
  private count = 0;

  constructor(
    private readonly interval: number,
    private readonly offset: number = 0
  ) {
    // Tiger Style: Assert inputs
    if (interval <= 0) {
      throw new Error('Sampling interval must be positive');
    }
    if (offset < 0) {
      throw new Error('Offset must be non-negative');
    }
  }

  /**
   * Sample items systematically from stream
   */
  async *sample(stream: AsyncIterable<T>): AsyncIterable<T> {
    for await (const item of stream) {
      if ((this.count - this.offset) % this.interval === 0 && this.count >= this.offset) {
        yield item;
      }
      this.count++;
    }
  }

  /**
   * Reset sampler for reuse
   */
  reset(): void {
    this.count = 0;
  }

  /**
   * Get number of items seen
   */
  getSeenCount(): number {
    return this.count;
  }
}

/**
 * Stratified sampling - sample from different groups proportionally
 * Useful for maintaining representation across different sequence types
 */
export class StratifiedSampler<T> {
  private readonly strata = new Map<string, ReservoirSampler<T>>();
  private readonly samplesPerStratum: number;

  constructor(
    private readonly totalSamples: number,
    private readonly getStratum: (item: T) => string,
    private readonly expectedStrata?: number,
    seed?: number
  ) {
    // Tiger Style: Assert inputs
    if (totalSamples <= 0) {
      throw new Error('Total samples must be positive');
    }

    // Calculate samples per stratum
    this.samplesPerStratum =
      expectedStrata !== undefined && expectedStrata !== null && expectedStrata !== 0
        ? Math.ceil(totalSamples / expectedStrata)
        : totalSamples;

    // Create initial sampler with seed for reproducibility
    this.createSamplerForStratum('__default__', seed);
  }

  /**
   * Add item to appropriate stratum
   */
  add(item: T): void {
    const stratum = this.getStratum(item);

    if (!this.strata.has(stratum)) {
      // Create new sampler for this stratum
      // Use stratum hash as seed offset for reproducibility
      const seed = this.hashString(stratum);
      this.createSamplerForStratum(stratum, seed);
    }

    const sampler = this.strata.get(stratum);
    sampler?.add(item);
  }

  /**
   * Process stream with stratified sampling
   */
  async sampleStream(stream: AsyncIterable<T>): Promise<Map<string, T[]>> {
    for await (const item of stream) {
      this.add(item);
    }
    return this.getSamples();
  }

  /**
   * Get samples from all strata
   */
  getSamples(): Map<string, T[]> {
    const samples = new Map<string, T[]>();

    for (const [stratum, sampler] of this.strata) {
      const stratumSamples = sampler.getSample();
      if (stratumSamples.length > 0) {
        samples.set(stratum, stratumSamples);
      }
    }

    return samples;
  }

  /**
   * Get flat array of all samples
   */
  getAllSamples(): T[] {
    const allSamples: T[] = [];

    for (const sampler of this.strata.values()) {
      allSamples.push(...sampler.getSample());
    }

    // Limit to requested total if necessary
    if (allSamples.length > this.totalSamples) {
      // Randomly select subset
      const finalSampler = new ReservoirSampler<T>(this.totalSamples);
      for (const sample of allSamples) {
        finalSampler.add(sample);
      }
      return finalSampler.getSample();
    }

    return allSamples;
  }

  /**
   * Reset all samplers
   */
  reset(): void {
    for (const sampler of this.strata.values()) {
      sampler.reset();
    }
  }

  /**
   * Create sampler for a stratum
   */
  private createSamplerForStratum(stratum: string, seed?: number): void {
    this.strata.set(stratum, new ReservoirSampler<T>(this.samplesPerStratum, seed));
  }

  /**
   * Simple string hash for reproducible seeding
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
}

/**
 * Weighted reservoir sampling
 * Sample items with probability proportional to their weight
 */
export class WeightedReservoirSampler<T> {
  private reservoir: Array<{ item: T; key: number }> = [];
  private readonly rng: () => number;

  constructor(
    private readonly size: number,
    seed?: number
  ) {
    // Tiger Style: Assert inputs
    if (size <= 0) {
      throw new Error('Reservoir size must be positive');
    }

    this.rng = seed !== undefined ? this.createSeededRNG(seed) : Math.random;
  }

  /**
   * Add weighted item to reservoir
   * Uses A-Res algorithm (Algorithm A with Reservoir)
   */
  add(item: T, weight: number): void {
    // Tiger Style: Assert inputs
    if (weight <= 0) {
      throw new Error('Weight must be positive');
    }

    // Generate key = random^(1/weight)
    const key = this.rng() ** (1 / weight);

    if (this.reservoir.length < this.size) {
      // Reservoir not full, add item
      this.reservoir.push({ item, key });

      // Keep reservoir sorted by key (max-heap property)
      if (this.reservoir.length === this.size) {
        this.reservoir.sort((a, b) => b.key - a.key);
      }
    } else {
      // Reservoir full, potentially replace smallest key
      const lastItem = this.reservoir[this.size - 1];
      if (lastItem && key > lastItem.key) {
        // Replace item with smallest key
        this.reservoir[this.size - 1] = { item, key };

        // Maintain sorted order
        let i = this.size - 1;
        while (i > 0) {
          const current = this.reservoir[i];
          const prev = this.reservoir[i - 1];
          if (current && prev && current.key > prev.key) {
            // Swap with previous element
            this.reservoir[i] = prev;
            this.reservoir[i - 1] = current;
            i--;
          } else {
            break;
          }
        }
      }
    }
  }

  /**
   * Process weighted stream
   */
  async sampleStream(stream: AsyncIterable<{ item: T; weight: number }>): Promise<T[]> {
    for await (const { item, weight } of stream) {
      this.add(item, weight);
    }
    return this.getSample();
  }

  /**
   * Get current sample
   */
  getSample(): T[] {
    return this.reservoir.map((r) => r.item);
  }

  /**
   * Reset sampler
   */
  reset(): void {
    this.reservoir = [];
  }

  /**
   * Create seeded RNG
   */
  private createSeededRNG(seed: number): () => number {
    let state = seed;

    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x100000000;
    };
  }
}

/**
 * Bernoulli sampling - each item independently selected with probability p
 * Useful when sample size is not fixed
 */
export class BernoulliSampler<T> {
  private readonly rng: () => number;

  constructor(
    private readonly probability: number,
    seed?: number
  ) {
    // Tiger Style: Assert inputs
    if (probability < 0 || probability > 1) {
      throw new Error('Probability must be between 0 and 1');
    }

    this.rng = seed !== undefined ? this.createSeededRNG(seed) : Math.random;
  }

  /**
   * Sample items with fixed probability
   */
  async *sample(stream: AsyncIterable<T>): AsyncIterable<T> {
    for await (const item of stream) {
      if (this.rng() < this.probability) {
        yield item;
      }
    }
  }

  /**
   * Check if item should be sampled
   */
  shouldSample(): boolean {
    return this.rng() < this.probability;
  }

  /**
   * Create seeded RNG
   */
  private createSeededRNG(seed: number): () => number {
    let state = seed;

    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x100000000;
    };
  }
}
