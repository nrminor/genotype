/**
 * Statistical sampling algorithms for large-scale genomic data analysis
 *
 * Implements sophisticated sampling methodologies essential for statistical genomics,
 * population genetics, and computational biology. These algorithms enable representative
 * sampling from massive genomic datasets that exceed memory capacity, providing
 * statistically valid subsets for downstream analysis while maintaining rigorous
 * mathematical guarantees about sample properties.
 *
 * **Statistical Sampling in Genomics:**
 * Modern genomic datasets often exceed computational capacity, requiring statistical
 * sampling to obtain representative subsets:
 * - **Population genomics**: Sample individuals from large cohorts (100K+ genomes)
 * - **Metagenomics**: Sample reads from diverse environmental communities
 * - **Quality control**: Sample sequences for QC analysis without processing all data
 * - **Algorithm development**: Create test datasets from large reference collections
 * - **Computational efficiency**: Reduce dataset size while preserving statistical properties
 *
 * **Sampling Challenges in Genomics:**
 * - **Unknown population size**: Cannot know total sequences before processing begins
 * - **Streaming data**: Sequencing produces continuous data streams
 * - **Memory constraints**: Cannot store entire datasets for sampling
 * - **Bias prevention**: Avoid systematic bias in sample selection
 * - **Stratification needs**: Ensure representation across different sequence types/qualities
 * - **Statistical validity**: Maintain mathematical properties for downstream analysis
 */

/**
 * Reservoir Sampling for unbiased random sampling from genomic data streams
 *
 * Implements the classic reservoir sampling algorithm (Vitter, 1985) that maintains
 * a uniformly random sample of k elements from a stream of unknown size. This is
 * the gold standard for unbiased sampling when the total population size cannot be
 * known in advance, making it essential for genomic applications where data streams
 * continuously from sequencing instruments.
 *
 * **Algorithm Foundation (Vitter, 1985):**
 * The reservoir sampling algorithm solves the fundamental problem of sampling k items
 * uniformly at random from a stream of n items where n is unknown:
 * 1. **Fill reservoir**: Store first k items in reservoir array
 * 2. **Streaming phase**: For each subsequent item i (where i > k):
 *    - Generate random number j in range [1, i]
 *    - If j ≤ k, replace reservoir[j-1] with current item
 * 3. **Uniform guarantee**: Each item has exactly k/n probability of being in final sample
 *
 * **Mathematical Properties:**
 * - **Unbiased**: Each element has equal probability k/n of selection
 * - **Memory**: O(k) - constant memory regardless of stream size
 * - **Time**: O(n) - single pass through data stream
 * - **Randomness**: Requires high-quality random number generator
 * - **No replacement**: Each element appears at most once in sample
 *
 * **Genomics Applications:**
 * - **Population sampling**: Select representative individuals from large cohorts
 * - **Read subsampling**: Sample sequencing reads for QC or algorithm testing
 * - **Variant discovery**: Sample variants from large population databases
 * - **Expression analysis**: Sample transcripts for pilot studies
 * - **Quality control**: Sample sequences for contamination screening
 * - **Method development**: Create test datasets from reference collections
 *
 * **Statistical Genomics Context:**
 * Reservoir sampling ensures statistical validity for downstream analysis:
 * - **Population genetics**: Maintains allele frequency distributions
 * - **Association studies**: Preserves case/control ratios in sampled data
 * - **Diversity estimates**: Unbiased sampling for species richness calculation
 * - **Coverage analysis**: Representative sampling for depth distribution studies
 * - **Quality metrics**: Unbiased quality score distribution preservation
 *
 * **Advantages for Genomic Workflows:**
 * - **Streaming compatibility**: Works with sequencing data as it's generated
 * - **Memory efficiency**: Constant memory usage for any dataset size
 * - **Statistical rigor**: Mathematically guaranteed unbiased sampling
 * - **Implementation simplicity**: Single-pass algorithm with minimal complexity
 * - **Reproducibility**: Seed-based randomization for reproducible sampling
 *
 * @example Population genomics sampling
 * ```typescript
 * // Sample 1000 individuals from large population cohort
 * const popSampler = new ReservoirSampler<Individual>(1000, 42);
 *
 * for await (const individual of ukBiobankCohort) {
 *   popSampler.add(individual);
 * }
 *
 * const representative = popSampler.getSample();
 * console.log(`Sampled ${representative.length} from ${popSampler.getTotal()} individuals`);
 * ```
 *
 * @example Sequencing read subsampling
 * ```typescript
 * // Sample 100K reads from large FASTQ for QC analysis
 * const qcSampler = new ReservoirSampler<FastqSequence>(100_000);
 *
 * for await (const read of massiveFastqStream) {
 *   qcSampler.add(read);
 * }
 *
 * const qcSample = qcSampler.getSample();
 * await performQualityControl(qcSample); // Analyze representative subset
 * ```
 *
 * @example Metagenomics diversity sampling
 * ```typescript
 * // Sample environmental reads for species diversity estimation
 * const diversitySampler = new ReservoirSampler<EnvironmentalRead>(50_000);
 *
 * environmentalStream.forEach(read => diversitySampler.add(read));
 * const diversitySample = diversitySampler.getSample();
 * const speciesCount = estimateSpeciesRichness(diversitySample);
 * ```
 *
 * @see {@link https://dl.acm.org/doi/10.1145/3147.3165} Random Sampling with a Reservoir (ACM)
 * @see {@link https://academic.oup.com/bib/article/7/3/297/328352} Statistical Methods in Genetics (Briefings in Bioinformatics)
 * @see {@link https://en.wikipedia.org/wiki/Reservoir_sampling} Reservoir Sampling Algorithm (Wikipedia)
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
      throw new Error("Reservoir size must be positive");
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
 * Random sampler using Fisher-Yates shuffle for perfect randomness
 *
 * Superior implementation with proper seeded RNG and optimized partial shuffling.
 * More memory-efficient than full shuffling when sampleSize << datasetSize.
 */
export class RandomSampler<T> {
  private readonly rng: () => number;

  constructor(
    private readonly sampleSize: number,
    seed?: number
  ) {
    // Tiger Style: Assert inputs
    if (sampleSize <= 0) {
      throw new Error("Sample size must be positive");
    }

    this.rng = seed !== undefined ? this.createSeededRNG(seed) : Math.random;
  }

  /**
   * Sample items using optimized Fisher-Yates shuffle
   *
   * 🔥 NATIVE OPTIMIZATION: Array shuffling and random number generation
   * Perfect candidate for SIMD shuffle operations
   */
  async *sample(source: AsyncIterable<T>): AsyncIterable<T> {
    // Collect items first (necessary for Fisher-Yates)
    const items: T[] = [];
    for await (const item of source) {
      items.push(item);
    }

    if (items.length === 0) return;

    const actualSampleSize = Math.min(this.sampleSize, items.length);

    // Optimized Fisher-Yates: only shuffle the portion we need
    // More efficient than full shuffle when sampleSize << items.length
    for (let i = 0; i < actualSampleSize; i++) {
      // Pick random element from remaining unshuffled portion
      const j = i + Math.floor(this.rng() * (items.length - i));

      // Swap current position with random selection
      const temp = items[i];
      const selected = items[j];
      if (temp !== undefined && selected !== undefined) {
        items[i] = selected;
        items[j] = temp;
      }
    }

    // Yield first n shuffled items
    for (let i = 0; i < actualSampleSize; i++) {
      const item = items[i];
      if (item !== undefined) {
        yield item;
      }
    }
  }

  /**
   * Create seeded pseudo-random number generator
   * Uses xorshift32 for better quality than LCG
   */
  private createSeededRNG(seed: number): () => number {
    let state = seed;
    return () => {
      // xorshift32 algorithm (same as ReservoirSampler for consistency)
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
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
      throw new Error("Sampling interval must be positive");
    }
    if (offset < 0) {
      throw new Error("Offset must be non-negative");
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

  /**
   * Create systematic sampler from desired sample size
   *
   * Factory method that calculates optimal interval for given sample size.
   * Requires two-pass algorithm: first pass counts, second pass samples.
   */
  static async *sampleBySize<T>(
    source: AsyncIterable<T>,
    sampleSize: number,
    offset: number = 0
  ): AsyncIterable<T> {
    // Tiger Style: Assert inputs
    if (sampleSize <= 0) {
      throw new Error("Sample size must be positive");
    }

    // First pass: collect all items (necessary to calculate interval)
    const items: T[] = [];
    for await (const item of source) {
      items.push(item);
    }

    if (items.length === 0 || sampleSize >= items.length) {
      // Return all items if sample size >= total
      for (const item of items) {
        yield item;
      }
      return;
    }

    // Calculate optimal interval for desired sample size
    const interval = Math.max(1, Math.floor(items.length / sampleSize));

    // Second pass: systematic sampling
    for (let i = offset; i < items.length && (i - offset) / interval < sampleSize; i += interval) {
      const item = items[i];
      if (item !== undefined) {
        yield item;
      }
    }
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
    readonly expectedStrata?: number,
    seed?: number
  ) {
    // Tiger Style: Assert inputs
    if (totalSamples <= 0) {
      throw new Error("Total samples must be positive");
    }

    // Calculate samples per stratum
    this.samplesPerStratum =
      expectedStrata !== undefined && expectedStrata !== null && expectedStrata !== 0
        ? Math.ceil(totalSamples / expectedStrata)
        : totalSamples;

    // Create initial sampler with seed for reproducibility
    this.createSamplerForStratum("__default__", seed);
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
      throw new Error("Reservoir size must be positive");
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
      throw new Error("Weight must be positive");
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
      throw new Error("Probability must be between 0 and 1");
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
