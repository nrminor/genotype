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

import type { AbstractSequence } from '../types';
import type { SampleOptions } from './types';

/**
 * Processor for statistical sampling operations
 *
 * Implements various sampling strategies while maintaining streaming behavior.
 * Uses reservoir sampling for unknown-size datasets and efficient random sampling.
 *
 * @example
 * ```typescript
 * const processor = new SampleProcessor();
 * const sampled = processor.process(sequences, {
 *   n: 1000,
 *   seed: 42,
 *   strategy: 'reservoir'
 * });
 * ```
 */
export class SampleProcessor {
  private rng: () => number = Math.random;

  /**
   * Process sequences with statistical sampling
   *
   * @param source - Input sequences
   * @param options - Sample options
   * @yields Sampled sequences according to specified strategy
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: SampleOptions
  ): AsyncIterable<AbstractSequence> {
    // Validate options using common validation pattern
    this.validateOptions(options);
    this.initializeRandom(options.seed);

    const strategy = options.strategy ?? 'reservoir';

    switch (strategy) {
      case 'reservoir':
        yield* this.reservoirSample(source, options);
        break;
      case 'systematic':
        yield* this.systematicSample(source, options);
        break;
      case 'random':
        yield* this.randomSample(source, options);
        break;
      default:
        throw new Error(`Invalid sampling strategy: ${strategy}`);
    }
  }

  /**
   * Reservoir sampling for streaming data with unknown size
   *
   * Maintains a reservoir of the target sample size and randomly
   * replaces elements as new sequences arrive.
   */
  private async *reservoirSample(
    source: AsyncIterable<AbstractSequence>,
    options: SampleOptions
  ): AsyncIterable<AbstractSequence> {
    const sampleSize = this.getSampleSize(options);
    const reservoir: AbstractSequence[] = [];
    let count = 0;

    for await (const seq of source) {
      count++;

      if (reservoir.length < sampleSize) {
        // Fill reservoir
        reservoir.push(seq);
      } else {
        // Random replacement
        const randomIndex = Math.floor(this.rng() * count);
        if (randomIndex < sampleSize) {
          reservoir[randomIndex] = seq;
        }
      }
    }

    // Yield sampled sequences
    for (const seq of reservoir) {
      yield seq;
    }
  }

  /**
   * Systematic sampling with fixed intervals
   */
  private async *systematicSample(
    source: AsyncIterable<AbstractSequence>,
    options: SampleOptions
  ): AsyncIterable<AbstractSequence> {
    const sampleSize = this.getSampleSize(options);
    let count = 0;
    let interval = 1;

    // First pass to estimate interval
    const sequences: AbstractSequence[] = [];
    for await (const seq of source) {
      sequences.push(seq);
      count++;
    }

    if (count === 0) return;

    interval = Math.max(1, Math.floor(count / sampleSize));

    // Sample at systematic intervals
    for (let i = 0; i < count && i / interval < sampleSize; i += interval) {
      const seq = sequences[i];
      if (seq !== undefined) {
        yield seq;
      }
    }
  }

  /**
   * Random sampling (requires collecting sequences first)
   */
  private async *randomSample(
    source: AsyncIterable<AbstractSequence>,
    options: SampleOptions
  ): AsyncIterable<AbstractSequence> {
    const sequences: AbstractSequence[] = [];
    for await (const seq of source) {
      sequences.push(seq);
    }

    const sampleSize = Math.min(this.getSampleSize(options), sequences.length);

    // Fisher-Yates shuffle and take first n
    for (let i = sequences.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const temp = sequences[i];
      const other = sequences[j];
      if (temp !== undefined && other !== undefined) {
        sequences[i] = other;
        sequences[j] = temp;
      }
    }

    for (let i = 0; i < sampleSize; i++) {
      const seq = sequences[i];
      if (seq !== undefined) {
        yield seq;
      }
    }
  }

  /**
   * Get effective sample size from options
   */
  private getSampleSize(options: SampleOptions): number {
    if (options.n !== undefined) {
      return options.n;
    }

    if (options.fraction !== undefined) {
      throw new Error('Fraction-based sampling requires known dataset size');
    }

    throw new Error('Either n or fraction must be specified');
  }

  /**
   * Initialize random number generator with optional seed
   */
  private initializeRandom(seed?: number): void {
    if (seed !== undefined) {
      // Simple seeded PRNG (Linear Congruential Generator)
      let current = seed;
      this.rng = () => {
        current = (current * 1664525 + 1013904223) % 2 ** 32;
        return current / 2 ** 32;
      };
    } else {
      this.rng = Math.random;
    }
  }

  /**
   * Validate sample options
   */
  private validateOptions(options: SampleOptions): void {
    const hasN = options.n !== undefined;
    const hasFraction = options.fraction !== undefined;

    // Must specify either n or fraction, but not both
    if (!hasN && !hasFraction) {
      throw new Error('Either n or fraction must be specified');
    }
    if (hasN && hasFraction) {
      throw new Error('Cannot specify both n and fraction');
    }

    // Validate n if specified
    if (options.n !== undefined) {
      if (!Number.isInteger(options.n) || options.n <= 0) {
        throw new Error(`n must be a positive integer, got: ${options.n}`);
      }
    }

    // Validate fraction if specified
    if (options.fraction !== undefined) {
      if (typeof options.fraction !== 'number' || options.fraction <= 0 || options.fraction > 1) {
        throw new Error(`Fraction must be between 0 and 1, got: ${options.fraction}`);
      }
    }

    // Validate strategy
    if (options.strategy) {
      const validStrategies = ['random', 'systematic', 'reservoir'];
      if (!validStrategies.includes(options.strategy)) {
        throw new Error(
          `Invalid strategy: ${options.strategy}. Valid options: ${validStrategies.join(', ')}`
        );
      }
    }
  }
}
