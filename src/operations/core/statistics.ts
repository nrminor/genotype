/**
 * Statistics accumulator for streaming sequence analysis
 * 
 * Provides constant-memory statistics calculation for arbitrarily large datasets
 * Uses Welford's algorithm for numerical stability in variance calculations
 */

import type { Sequence } from '../../types';

/**
 * Sequence statistics result
 */
export interface SequenceStats {
  count: number;
  totalLength: number;
  minLength: number;
  maxLength: number;
  meanLength: number;
  medianLength: number;
  n50: number;
  n90: number;
  gcContent: number;
  baseComposition: Record<string, number>;
  qualityStats?: {
    meanQuality: number;
    minQuality: number;
    maxQuality: number;
  } | undefined;
}

/**
 * Streaming statistics accumulator
 * Maintains O(1) memory regardless of dataset size
 */
export class SequenceStatsAccumulator {
  private count = 0;
  private totalLength = 0;
  private minLength = Number.MAX_SAFE_INTEGER;
  private maxLength = 0;
  
  // For variance calculation (Welford's algorithm)
  private mean = 0;
  private m2 = 0;
  
  // Base composition
  private baseCount: Record<string, number> = {};
  private gcCount = 0;
  
  // For N50/N90 calculation, we need to keep lengths
  // In production, might use reservoir sampling for huge datasets
  private lengths: number[] = [];
  private readonly maxLengthsStored = 1000000; // Limit for memory
  
  // Quality statistics (if FASTQ)
  private qualitySum = 0;
  private qualityCount = 0;
  private minQuality = Number.MAX_SAFE_INTEGER;
  private maxQuality = 0;

  /**
   * Add a sequence to the accumulator
   * 
   * @param sequence - Sequence to accumulate statistics for
   * 
   * 🔥 ZIG OPTIMIZATION: Statistics calculation in single pass
   */
  add(sequence: Sequence): void {
    // Tiger Style: Assert input
    if (!sequence || !sequence.sequence) {
      throw new Error('Valid sequence required for statistics');
    }

    this.count++;
    const length = sequence.length || sequence.sequence.length;
    
    // Update length statistics
    this.totalLength += length;
    this.minLength = Math.min(this.minLength, length);
    this.maxLength = Math.max(this.maxLength, length);
    
    // Update mean and variance (Welford's algorithm)
    const delta = length - this.mean;
    this.mean += delta / this.count;
    const delta2 = length - this.mean;
    this.m2 += delta * delta2;
    
    // Store length for N50/N90 calculation (with limit)
    if (this.lengths.length < this.maxLengthsStored) {
      this.lengths.push(length);
    }
    
    // Update base composition
    const seq = sequence.sequence.toUpperCase();
    for (let i = 0; i < seq.length; i++) {
      const base = seq[i];
      if (base) {
        this.baseCount[base] = (this.baseCount[base] || 0) + 1;
        if (base === 'G' || base === 'C' || base === 'S') {
          this.gcCount++;
        }
      }
    }
    
    // Update quality statistics if available (FASTQ)
    if ('quality' in sequence && (sequence as any).quality) {
      const quality = (sequence as any).quality;
      for (let i = 0; i < quality.length; i++) {
        const qual = quality.charCodeAt(i) - 33; // Assume Phred33
        this.qualitySum += qual;
        this.qualityCount++;
        this.minQuality = Math.min(this.minQuality, qual);
        this.maxQuality = Math.max(this.maxQuality, qual);
      }
    }
  }

  /**
   * Add multiple sequences
   */
  addMany(sequences: Iterable<Sequence>): void {
    for (const seq of sequences) {
      this.add(seq);
    }
  }

  /**
   * Add sequences from async iterable (streaming)
   */
  async addStream(sequences: AsyncIterable<Sequence>): Promise<void> {
    for await (const seq of sequences) {
      this.add(seq);
    }
  }

  /**
   * Get accumulated statistics
   */
  getStats(): SequenceStats {
    if (this.count === 0) {
      return {
        count: 0,
        totalLength: 0,
        minLength: 0,
        maxLength: 0,
        meanLength: 0,
        medianLength: 0,
        n50: 0,
        n90: 0,
        gcContent: 0,
        baseComposition: {}
      };
    }

    // Calculate N50 and N90
    const { n50, n90, median } = this.calculateNStats();
    
    // Calculate GC content
    const gcContent = this.totalLength > 0 ? this.gcCount / this.totalLength : 0;
    
    // Prepare quality stats if available
    const qualityStats = this.qualityCount > 0 ? {
      meanQuality: this.qualitySum / this.qualityCount,
      minQuality: this.minQuality,
      maxQuality: this.maxQuality
    } : undefined;

    return {
      count: this.count,
      totalLength: this.totalLength,
      minLength: this.minLength,
      maxLength: this.maxLength,
      meanLength: this.mean,
      medianLength: median,
      n50,
      n90,
      gcContent,
      baseComposition: { ...this.baseCount },
      qualityStats
    };
  }

  /**
   * Calculate N50, N90, and median
   * N50: length such that 50% of bases are in sequences >= this length
   */
  private calculateNStats(): { n50: number; n90: number; median: number } {
    if (this.lengths.length === 0) {
      return { n50: 0, n90: 0, median: 0 };
    }

    // Sort lengths in descending order
    const sorted = [...this.lengths].sort((a, b) => b - a);
    
    // Calculate median
    const mid = Math.floor(sorted.length / 2);
    let median = 0;
    if (sorted.length % 2 === 0) {
      const val1 = sorted[mid - 1];
      const val2 = sorted[mid];
      if (val1 !== undefined && val2 !== undefined) {
        median = (val1 + val2) / 2;
      }
    } else {
      median = sorted[mid] ?? 0;
    }
    
    // Calculate N50 and N90
    let cumSum = 0;
    let n50 = 0;
    let n90 = 0;
    const threshold50 = this.totalLength * 0.5;
    const threshold90 = this.totalLength * 0.9;
    
    for (const length of sorted) {
      cumSum += length;
      if (n50 === 0 && cumSum >= threshold50) {
        n50 = length;
      }
      if (n90 === 0 && cumSum >= threshold90) {
        n90 = length;
        break;
      }
    }
    
    return { n50, n90, median };
  }

  /**
   * Get variance of sequence lengths
   */
  getVariance(): number {
    if (this.count < 2) return 0;
    return this.m2 / (this.count - 1);
  }

  /**
   * Get standard deviation of sequence lengths
   */
  getStandardDeviation(): number {
    return Math.sqrt(this.getVariance());
  }

  /**
   * Reset the accumulator
   */
  reset(): void {
    this.count = 0;
    this.totalLength = 0;
    this.minLength = Number.MAX_SAFE_INTEGER;
    this.maxLength = 0;
    this.mean = 0;
    this.m2 = 0;
    this.baseCount = {};
    this.gcCount = 0;
    this.lengths = [];
    this.qualitySum = 0;
    this.qualityCount = 0;
    this.minQuality = Number.MAX_SAFE_INTEGER;
    this.maxQuality = 0;
  }

  /**
   * Merge another accumulator into this one
   * Useful for parallel processing
   */
  merge(other: SequenceStatsAccumulator): void {
    if (other.count === 0) return;
    
    // Merge length statistics
    const combinedCount = this.count + other.count;
    const delta = other.mean - this.mean;
    const newMean = (this.count * this.mean + other.count * other.mean) / combinedCount;
    const newM2 = this.m2 + other.m2 + delta * delta * this.count * other.count / combinedCount;
    
    this.count = combinedCount;
    this.totalLength += other.totalLength;
    this.minLength = Math.min(this.minLength, other.minLength);
    this.maxLength = Math.max(this.maxLength, other.maxLength);
    this.mean = newMean;
    this.m2 = newM2;
    
    // Merge base composition
    for (const [base, count] of Object.entries(other.baseCount)) {
      this.baseCount[base] = (this.baseCount[base] || 0) + count;
    }
    this.gcCount += other.gcCount;
    
    // Merge lengths array (with limit)
    const remainingSpace = this.maxLengthsStored - this.lengths.length;
    if (remainingSpace > 0) {
      this.lengths.push(...other.lengths.slice(0, remainingSpace));
    }
    
    // Merge quality statistics
    this.qualitySum += other.qualitySum;
    this.qualityCount += other.qualityCount;
    if (other.qualityCount > 0) {
      this.minQuality = Math.min(this.minQuality, other.minQuality);
      this.maxQuality = Math.max(this.maxQuality, other.maxQuality);
    }
  }

  /**
   * Create a summary string
   */
  toString(): string {
    const stats = this.getStats();
    return `
Sequences: ${stats.count}
Total length: ${stats.totalLength} bp
Length range: ${stats.minLength}-${stats.maxLength} bp
Mean length: ${stats.meanLength.toFixed(2)} bp
Median length: ${stats.medianLength} bp
N50: ${stats.n50} bp
N90: ${stats.n90} bp
GC content: ${(stats.gcContent * 100).toFixed(2)}%
${stats.qualityStats ? `Mean quality: ${stats.qualityStats.meanQuality.toFixed(2)}` : ''}
    `.trim();
  }
}

/**
 * Utility function to calculate stats for a complete sequence collection
 */
export async function calculateSequenceStats(
  sequences: AsyncIterable<Sequence> | Iterable<Sequence>
): Promise<SequenceStats> {
  const accumulator = new SequenceStatsAccumulator();
  
  // Check if async iterable
  if (Symbol.asyncIterator in sequences) {
    await accumulator.addStream(sequences as AsyncIterable<Sequence>);
  } else {
    accumulator.addMany(sequences as Iterable<Sequence>);
  }
  
  return accumulator.getStats();
}