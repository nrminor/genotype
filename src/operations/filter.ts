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
import type { AlignmentFilterOptions, FilterOptions, Processor } from "./types";

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
  "minMapQ?": "0 <= number <= 255",
  "maxMapQ?": "0 <= number <= 255",
  "excludeFlags?": "0 <= number <= 65535",
  "includeFlags?": "0 <= number <= 65535",
  "referenceSequence?": "string",
  "region?": "string",
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

  // Cross-field validation: minMapQ <= maxMapQ
  if (
    options.minMapQ !== undefined &&
    options.maxMapQ !== undefined &&
    options.minMapQ > options.maxMapQ
  ) {
    return ctx.reject({
      expected: `minMapQ (${options.minMapQ}) <= maxMapQ (${options.maxMapQ})`,
      path: ["minMapQ", "maxMapQ"],
    });
  }

  // Validate region format if provided
  if (options.region !== undefined) {
    const regionPattern = /^[^:]+:\d+-\d+$/;
    if (!regionPattern.test(options.region)) {
      return ctx.reject({
        expected: `region in format "chr:start-end" (e.g. "chr1:1000-2000"), got "${options.region}"`,
        path: ["region"],
      });
    }
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
    options: FilterOptions & Partial<AlignmentFilterOptions>
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
  private passesFilter(
    seq: AbstractSequence,
    options: FilterOptions & Partial<AlignmentFilterOptions>
  ): boolean {
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

    // Ambiguous base filter (fallback — native path uses classifyBatch)
    if (options.hasAmbiguous !== undefined) {
      const hasAmbiguous = /[^ACGTU]/i.test(seq.sequence.toString());
      if (options.hasAmbiguous !== hasAmbiguous) {
        return false;
      }
    }

    // Custom filter function
    if (options.custom && !options.custom(seq)) {
      return false;
    }

    // Alignment-specific filters
    if (!passesAlignmentFilters(seq, options)) {
      return false;
    }

    return true;
  }
}

/**
 * Apply alignment-specific filters. These check fields that only exist
 * on AlignmentRecord (flag, mappingQuality, referenceSequence, position).
 * If the record doesn't have these fields, the filters are skipped.
 */
function passesAlignmentFilters(
  seq: AbstractSequence,
  options: Partial<AlignmentFilterOptions>
): boolean {
  const hasAlignmentFields = "flag" in seq && "mappingQuality" in seq;
  if (!hasAlignmentFields) return true;

  const record = seq as AbstractSequence & {
    flag: number;
    mappingQuality: number;
    referenceSequence: string;
    position: number;
  };

  if (options.minMapQ !== undefined && record.mappingQuality < options.minMapQ) {
    return false;
  }
  if (options.maxMapQ !== undefined && record.mappingQuality > options.maxMapQ) {
    return false;
  }
  if (options.excludeFlags !== undefined && (record.flag & options.excludeFlags) !== 0) {
    return false;
  }
  if (
    options.includeFlags !== undefined &&
    (record.flag & options.includeFlags) !== options.includeFlags
  ) {
    return false;
  }
  if (
    options.referenceSequence !== undefined &&
    record.referenceSequence !== options.referenceSequence
  ) {
    return false;
  }
  if (options.region !== undefined) {
    const parsed = parseRegion(options.region);
    if (parsed !== null) {
      if (record.referenceSequence !== parsed.ref) return false;
      if (record.position === 0) return false; // unmapped
      if (record.position > parsed.end) return false;
      // Without CIGAR-aware span calculation, we assume the read
      // extends at least seq.length bases from its start position.
      const readEnd = record.position + seq.length - 1;
      if (readEnd < parsed.start) return false;
    }
  }

  return true;
}

/**
 * Parse a genomic region string like "chr1:1000-2000" into its components.
 * Returns null if the string doesn't match the expected format.
 */
function parseRegion(region: string): { ref: string; start: number; end: number } | null {
  const match = region.match(/^([^:]+):(\d+)-(\d+)$/);
  if (match === null) return null;
  return { ref: match[1]!, start: parseInt(match[2]!, 10), end: parseInt(match[3]!, 10) };
}

/**
 * Apply only the filters that don't need sequence content analysis.
 * These are O(1) or depend on metadata, not on the sequence bytes.
 */
function passesCheapFilters(
  seq: AbstractSequence,
  options: FilterOptions & Partial<AlignmentFilterOptions>
): boolean {
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
  // Alignment-specific filters are cheap too
  if (!passesAlignmentFilters(seq, options)) {
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
  options: FilterOptions & Partial<AlignmentFilterOptions>
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
