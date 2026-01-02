/**
 * SampleProcessor - Statistical sampling of sequences
 *
 * This processor implements statistical sampling functionality including
 * random sampling, systematic sampling, and reservoir sampling for
 * streaming data with unknown size.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { type } from "arktype";
import { ValidationError } from "../errors";
import type { AbstractSequence } from "../types";
import { RandomSampler, ReservoirSampler, SystematicSampler } from "./core/sampling";
import type { SampleOptions } from "./types";

/**
 * ArkType schema for SampleOptions validation
 */
const SampleOptionsSchema = type({
  "n?": "number>0",
  "fraction?": "0 < number <= 1",
  "seed?": "number",
  "withReplacement?": "boolean",
  "strategy?": "'random' | 'systematic' | 'reservoir'",
}).narrow((options, ctx) => {
  // Mutually exclusive n/fraction validation
  const hasN = options.n !== undefined;
  const hasFraction = options.fraction !== undefined;

  if (!hasN && !hasFraction) {
    return ctx.reject({
      expected: "either n or fraction must be specified",
      path: ["n", "fraction"],
    });
  }

  if (hasN && hasFraction) {
    return ctx.reject({
      expected: "cannot specify both n and fraction",
      path: ["n", "fraction"],
    });
  }

  return true;
});

/**
 * Processor for sampling sequences using various strategies
 *
 * Supports two sampling modes:
 *
 * ## Number-based sampling (exact count)
 * Samples exactly N sequences using one of three strategies:
 * - **Reservoir** (default): O(k) memory, single-pass, optimal for unknown-size streams
 * - **Systematic**: O(n) memory, even distribution across input
 * - **Random**: O(n) memory, Fisher-Yates shuffle for perfect randomness
 *
 * ## Fraction-based sampling (streaming, approximate count)
 * Samples approximately fraction*N sequences using single-pass streaming.
 * Memory-efficient (O(1)) but produces probabilistic counts.
 *
 * @example Number-based sampling
 * ```typescript
 * // Sample exactly 1000 sequences (default reservoir strategy)
 * await seqops('input.fastq')
 *   .sample({ n: 1000 })
 *   .writeFastq('sampled.fastq');
 *
 * // Reproducible systematic sampling
 * await seqops('genome.fasta')
 *   .sample({ n: 5000, strategy: 'systematic', seed: 42 })
 *   .writeFasta('evenly-sampled.fasta');
 * ```
 *
 * @example Fraction-based sampling
 * ```typescript
 * // Sample ~10% of sequences (fast, low memory)
 * await seqops('huge-dataset.fastq')
 *   .sample({ fraction: 0.1 })
 *   .writeFastq('subset.fastq');
 *
 * // Reproducible paired-end sampling
 * const seed = 42;
 * await seqops('reads_R1.fastq')
 *   .sample({ fraction: 0.05, seed })
 *   .writeFastq('sampled_R1.fastq');
 *
 * await seqops('reads_R2.fastq')
 *   .sample({ fraction: 0.05, seed })
 *   .writeFastq('sampled_R2.fastq');
 * // Result: Matching read pairs in both sampled files
 * ```
 *
 * @see Comparable to seqkit's `seqkit sample` command
 * @performance
 * - Fraction mode: O(1) memory, O(n) time
 * - Reservoir mode: O(k) memory, O(n) time
 * - Systematic mode: O(n) memory, O(n) time (two-pass)
 * - Random mode: O(n) memory, O(n log n) time
 */
export class SampleProcessor {
  /**
   * Process sequences with statistical sampling using superior core implementations
   *
   * @param source - Input sequences
   * @param options - Sample options
   * @yields Sampled sequences according to specified strategy
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: SampleOptions,
  ): AsyncIterable<AbstractSequence> {
    // Direct ArkType validation
    const validationResult = SampleOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid sample options: ${validationResult.summary}`);
    }

    // Fraction mode: streaming single-pass sampling
    if (options.fraction !== undefined) {
      yield* this.sampleByFraction(source, options.fraction, options.seed);
      return;
    }

    // Number mode: use strategy-based sampling
    if (options.n === undefined) {
      throw new ValidationError("Sample size (n) must be specified when fraction is not provided");
    }
    const sampleSize = options.n;
    const strategy = options.strategy ?? "reservoir";

    switch (strategy) {
      case "reservoir": {
        // Use superior core ReservoirSampler
        const sampler = new ReservoirSampler<AbstractSequence>(sampleSize, options.seed);
        for await (const seq of source) {
          sampler.add(seq);
        }
        yield* sampler.getSample();
        break;
      }

      case "systematic": {
        // Use superior core SystematicSampler with size-based factory
        yield* SystematicSampler.sampleBySize(source, sampleSize);
        break;
      }

      case "random": {
        // Use superior core RandomSampler with optimized Fisher-Yates
        const sampler = new RandomSampler<AbstractSequence>(sampleSize, options.seed);
        yield* sampler.sample(source);
        break;
      }

      default:
        throw new Error(`Invalid sampling strategy: ${strategy}`);
    }
  }

  /**
   * Get seeded random number generator or use Math.random
   *
   * Uses Linear Congruential Generator (LCG) algorithm for reproducibility.
   * Same algorithm as used in core/sampling.ts for consistency.
   *
   * @param seed - Random seed (optional)
   * @returns Random number generator function (0 to 1)
   */
  private getSeededRandom(seed?: number): () => number {
    if (seed === undefined) {
      return () => Math.random();
    }

    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 0x100000000;
      return state / 0x100000000;
    };
  }

  /**
   * Stream-based fraction sampling (like seqkit -p)
   *
   * Makes pseudo-random decision for each sequence: include if random() < fraction.
   * Result count is PROBABILISTIC, not exact (e.g., 0.1 fraction → ~10% ± variance).
   *
   * Memory usage: O(1) - streams sequences without buffering
   * Time complexity: O(n) - single pass through source
   *
   * @param source - Input sequences
   * @param fraction - Probability of including each sequence (0 < fraction <= 1)
   * @param seed - Random seed for reproducibility (critical for paired-end reads)
   *
   * @example
   * ```typescript
   * // Sample approximately 10% of sequences
   * yield* this.sampleByFraction(sequences, 0.1);
   *
   * // Reproducible sampling with seed
   * yield* this.sampleByFraction(sequences, 0.1, 42);
   * ```
   */
  private async *sampleByFraction<T extends AbstractSequence>(
    source: AsyncIterable<T>,
    fraction: number,
    seed?: number,
  ): AsyncIterable<T> {
    const rng = this.getSeededRandom(seed);

    for await (const seq of source) {
      if (rng() < fraction) {
        yield seq;
      }
    }
  }
}
