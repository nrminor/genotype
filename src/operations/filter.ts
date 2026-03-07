/**
 * FilterProcessor - Remove sequences based on criteria
 *
 * This processor implements filtering logic for sequences based on
 * length, GC content, patterns, and custom functions. All criteria
 * within a single filter call are combined with AND logic.
 *
 * When GC content or ambiguous base filters are active, sequences that
 * pass cheap filters accumulate into batches for the native SIMD classify
 * kernel. The kernel's 12-class counts derive both GC content (fractional
 * weighting) and ambiguity detection in a single batched pass.
 */

import { type } from "arktype";
import { ValidationError } from "../errors";
import {
  type NativeKernel,
  getNativeKernel,
  packSequences,
  NUM_CLASSES,
  CLASS_A,
  CLASS_T,
  CLASS_U,
  CLASS_G,
  CLASS_C,
  CLASS_N,
  CLASS_STRONG,
  CLASS_WEAK,
  CLASS_TWO_BASE,
  CLASS_BDHV,
} from "../native";
import type { AbstractSequence } from "../types";
import { gcContent } from "./core/calculations";
import type { FilterOptions, Processor } from "./types";

/** Byte budget per native batch. Sequences accumulate until this threshold. */
const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

/**
 * ArkType schema for FilterOptions validation
 *
 * Validates:
 * - minLength and maxLength must be > 0
 * - minGC and maxGC must be in range [0, 100]
 * - Cross-field constraints: minLength <= maxLength, minGC <= maxGC
 */
const FilterOptionsSchema = type({
  "minLength?": "number>0",
  "maxLength?": "number>0",
  "minGC?": "0 <= number <= 100",
  "maxGC?": "0 <= number <= 100",
  "pattern?": "RegExp",
  "ids?": "string[]",
  "excludeIds?": "string[]",
  "hasAmbiguous?": "boolean",
  "custom?": "Function",
}).narrow((options, ctx) => {
  // Cross-field validation: minLength <= maxLength
  if (
    options.minLength !== undefined &&
    options.maxLength !== undefined &&
    options.minLength > options.maxLength
  ) {
    return ctx.reject({
      expected: `minLength (${options.minLength}) <= maxLength (${options.maxLength})`,
      path: ["minLength", "maxLength"],
    });
  }

  // Cross-field validation: minGC <= maxGC
  if (options.minGC !== undefined && options.maxGC !== undefined && options.minGC > options.maxGC) {
    return ctx.reject({
      expected: `minGC (${options.minGC}) <= maxGC (${options.maxGC})`,
      path: ["minGC", "maxGC"],
    });
  }

  return true;
});

/**
 * Processor for filtering sequences based on various criteria
 *
 * @example
 * ```typescript
 * const processor = new FilterProcessor();
 * const filtered = processor.process(sequences, {
 *   minLength: 100,
 *   maxGC: 60,
 *   hasAmbiguous: false
 * });
 * ```
 */
export class FilterProcessor implements Processor<FilterOptions> {
  /**
   * Process sequences with filtering criteria
   *
   * @param source - Input sequences
   * @param options - Filter options
   * @yields Sequences that pass all filter criteria
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: FilterOptions
  ): AsyncIterable<AbstractSequence> {
    const validationResult = FilterOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid filter options: ${validationResult.summary}`);
    }

    const needsClassify =
      options.minGC !== undefined ||
      options.maxGC !== undefined ||
      options.hasAmbiguous !== undefined;
    const nativeKernel = needsClassify ? getNativeKernel() : undefined;

    if (nativeKernel === undefined) {
      for await (const seq of source) {
        if (this.passesFilter(seq, options)) {
          yield seq;
        }
      }
      return;
    }

    let batch: AbstractSequence[] = [];
    let batchBytes = 0;

    for await (const seq of source) {
      if (!passesCheapFilters(seq, options)) {
        continue;
      }
      batch.push(seq);
      batchBytes += seq.sequence.length;
      if (batchBytes >= BATCH_BYTE_BUDGET) {
        yield* flushFilterBatch(batch, nativeKernel, options);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* flushFilterBatch(batch, nativeKernel, options);
    }
  }

  /**
   * Check if a sequence passes all filter criteria
   *
   * @param seq - Sequence to check
   * @param options - Filter criteria
   * @returns True if sequence passes all criteria
   */
  private passesFilter(seq: AbstractSequence, options: FilterOptions): boolean {
    // Length filters - early returns for better readability
    if (options.minLength && seq.length < options.minLength) {
      return false;
    }
    if (options.maxLength && seq.length > options.maxLength) {
      return false;
    }

    // GC content filters - calculate only if needed
    if (options.minGC || options.maxGC) {
      const gc = gcContent(seq.sequence);
      if (options.minGC && gc < options.minGC) {
        return false;
      }
      if (options.maxGC && gc > options.maxGC) {
        return false;
      }
    }

    // Pattern matching
    if (options.pattern) {
      const matchesId = options.pattern.test(seq.id);
      const matchesSeq = options.pattern.test(seq.sequence.toString());
      if (!matchesId && !matchesSeq) {
        return false;
      }
    }

    // ID whitelist
    if (options.ids && !options.ids.includes(seq.id)) {
      return false;
    }

    // ID blacklist
    if (options.excludeIds?.includes(seq.id)) {
      return false;
    }

    // Ambiguous base filter
    if (options.hasAmbiguous !== undefined) {
      // NATIVE_CANDIDATE: Character validation loop
      // Native implementation would be faster than regex
      const hasAmbiguous = /[^ACGTU]/i.test(seq.sequence.toString());
      if (options.hasAmbiguous !== hasAmbiguous) {
        return false;
      }
    }

    // Custom filter function
    if (options.custom && !options.custom(seq)) {
      return false;
    }

    return true;
  }
}

/**
 * Apply only the filters that don't need sequence content analysis.
 * These are O(1) or depend on metadata, not on the sequence bytes.
 */
function passesCheapFilters(seq: AbstractSequence, options: FilterOptions): boolean {
  if (options.minLength !== undefined && seq.length < options.minLength) {
    return false;
  }
  if (options.maxLength !== undefined && seq.length > options.maxLength) {
    return false;
  }
  if (options.pattern) {
    const matchesId = options.pattern.test(seq.id);
    const matchesSeq = options.pattern.test(seq.sequence.toString());
    if (!matchesId && !matchesSeq) {
      return false;
    }
  }
  if (options.ids && !options.ids.includes(seq.id)) {
    return false;
  }
  if (options.excludeIds?.includes(seq.id)) {
    return false;
  }
  return true;
}

/**
 * Compute GC content percentage from 12-class counts using fractional
 * weighting, matching the semantics of `gcContent()` in calculations.ts.
 */
function gcContentFromCounts(counts: number[], base: number): number {
  const g = counts[base + CLASS_G]!;
  const c = counts[base + CLASS_C]!;
  const s = counts[base + CLASS_STRONG]!;
  const a = counts[base + CLASS_A]!;
  const t = counts[base + CLASS_T]!;
  const u = counts[base + CLASS_U]!;
  const w = counts[base + CLASS_WEAK]!;
  const twoBase = counts[base + CLASS_TWO_BASE]!;
  const n = counts[base + CLASS_N]!;
  const bdhv = counts[base + CLASS_BDHV]!;

  const gcWeighted = g + c + s + 0.5 * twoBase + 0.5 * (n + bdhv);
  const atWeighted = a + t + u + w + 0.5 * twoBase + 0.5 * (n + bdhv);
  const total = gcWeighted + atWeighted;
  return total === 0 ? 0 : (gcWeighted / total) * 100;
}

/**
 * Run the classify kernel on a batch of pre-filtered sequences and yield
 * those that pass the GC content and/or ambiguity checks.
 */
function* flushFilterBatch(
  batch: AbstractSequence[],
  kernel: NativeKernel,
  options: FilterOptions
): Iterable<AbstractSequence> {
  const { data, offsets } = packSequences(batch);
  const result = kernel.classifyBatch(data, offsets);
  const counts = result.counts;

  for (let i = 0; i < batch.length; i++) {
    const base = i * NUM_CLASSES;

    if (options.minGC !== undefined || options.maxGC !== undefined) {
      const gc = gcContentFromCounts(counts, base);
      if (options.minGC !== undefined && gc < options.minGC) continue;
      if (options.maxGC !== undefined && gc > options.maxGC) continue;
    }

    if (options.hasAmbiguous !== undefined) {
      const atgcu =
        counts[base + CLASS_A]! +
        counts[base + CLASS_T]! +
        counts[base + CLASS_U]! +
        counts[base + CLASS_G]! +
        counts[base + CLASS_C]!;
      const seqLen = batch[i]!.sequence.length;
      const hasNonStandard = seqLen > atgcu;
      if (options.hasAmbiguous !== hasNonStandard) continue;
    }

    if (options.custom && !options.custom(batch[i]!)) continue;

    yield batch[i]!;
  }
}
