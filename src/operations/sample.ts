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
  /**
   * Process sequences with statistical sampling using superior core implementations
   *
   * @param source - Input sequences
   * @param options - Sample options
   * @yields Sampled sequences according to specified strategy
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: SampleOptions
  ): AsyncIterable<AbstractSequence> {
    // Direct ArkType validation
    const validationResult = SampleOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid sample options: ${validationResult.summary}`);
    }

    const sampleSize = this.getSampleSize(options);
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
   * Get effective sample size from options
   */
  private getSampleSize(options: SampleOptions): number {
    if (options.n !== undefined) {
      return options.n;
    }

    if (options.fraction !== undefined) {
      throw new Error("Fraction-based sampling requires known dataset size");
    }

    throw new Error("Either n or fraction must be specified");
  }
}
