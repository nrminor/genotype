/**
 * FilterProcessor - Remove sequences based on criteria
 *
 * This processor implements filtering logic for sequences based on
 * length, GC content, patterns, and custom functions. All criteria
 * within a single filter call are combined with AND logic.
 *
 */

import { type } from "arktype";
import { ValidationError } from "../errors";
import type { AbstractSequence } from "../types";
import { gcContent } from "./core/calculations";
import type { FilterOptions, Processor } from "./types";

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
  if (
    options.minGC !== undefined &&
    options.maxGC !== undefined &&
    options.minGC > options.maxGC
  ) {
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
    // Validate options with ArkType schema
    const validationResult = FilterOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid filter options: ${validationResult.summary}`);
    }

    // NATIVE_CANDIDATE: Hot loop - processes every sequence
    // Native filtering could batch process sequences
    for await (const seq of source) {
      if (this.passesFilter(seq, options)) {
        yield seq;
      }
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
      const matchesSeq = options.pattern.test(seq.sequence);
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
      const hasAmbiguous = /[^ACGTU]/i.test(seq.sequence);
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
