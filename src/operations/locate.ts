/**
 * LocateProcessor - Pattern location finding for sequences
 *
 * This processor implements motif location functionality for finding all
 * occurrences of patterns within sequences with support for fuzzy matching,
 * strand searching, and various output formats.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { type } from "arktype";
import { ValidationError } from "../errors";
import type { AbstractSequence, MotifLocation } from "../types";
import { fuzzyMatch } from "./core/pattern-matching";
import { reverseComplement } from "./core/sequence-manipulation";
import type { LocateOptions } from "./types";

/**
 * Schema for validating LocateOptions using ArkType
 */
const LocateOptionsSchema = type({
  pattern: "string | RegExp",
  "ignoreCase?": "boolean",
  "allowMismatches?": "number>=0",
  "searchBothStrands?": "boolean",
  "outputFormat?": "'default' | 'bed' | 'custom'",
  "allowOverlaps?": "boolean",
  "minLength?": "number>=1",
  "maxMatches?": "number>=1",
}).narrow((options, ctx) => {
  // Pattern validation - ensure string patterns aren't empty
  if (typeof options.pattern === "string" && options.pattern.trim() === "") {
    return ctx.reject({
      expected: "non-empty pattern string",
      actual: "empty string",
      path: ["pattern"],
    });
  }

  // Validate mismatch/regex compatibility
  if (options.pattern instanceof RegExp && options.allowMismatches && options.allowMismatches > 0) {
    return ctx.reject({
      expected: "string pattern for fuzzy matching",
      actual: "RegExp with allowMismatches > 0",
      path: ["allowMismatches"],
    });
  }

  return true;
});

/**
 * Processor for motif location operations
 *
 * Implements comprehensive pattern finding with bioinformatics enhancements.
 * Returns location information rather than filtering sequences.
 *
 * @example
 * ```typescript
 * const processor = new LocateProcessor();
 * const locations = processor.process(sequences, {
 *   pattern: 'ATCG',
 *   allowMismatches: 1,
 *   searchBothStrands: true
 * });
 *
 * for await (const location of locations) {
 *   console.log(`Found at ${location.start}-${location.end} on ${location.strand}`);
 * }
 * ```
 */
export class LocateProcessor {
  /**
   * Process sequences to find pattern locations
   *
   * @param source - Input sequences
   * @param options - Locate options
   * @yields Pattern location information
   */
  async *locate(
    source: AsyncIterable<AbstractSequence>,
    options: LocateOptions
  ): AsyncIterable<MotifLocation> {
    // Direct ArkType validation
    const validationResult = LocateOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid locate options: ${validationResult.summary}`);
    }

    let totalYielded = 0;

    for await (const seq of source) {
      const locations = this.findPatternInSequence(seq, options);

      // Apply max matches limit globally if specified
      for (const location of locations) {
        if (options.maxMatches !== undefined && totalYielded >= options.maxMatches) {
          return;
        }
        yield location;
        totalYielded++;
      }
    }
  }

  /**
   * Find all pattern matches within a single sequence
   *
   * @param seq - Sequence to search
   * @param options - Locate options
   * @returns Array of location matches
   */
  private findPatternInSequence(seq: AbstractSequence, options: LocateOptions): MotifLocation[] {
    const results: MotifLocation[] = [];
    const sequence = seq.sequence;

    if (!sequence || sequence.length === 0) {
      return results;
    }

    // Handle regex patterns
    if (options.pattern instanceof RegExp) {
      const matches = this.findRegexMatches(seq, options);
      results.push(...matches);
    } else {
      // Handle string patterns
      const stringPattern =
        options.ignoreCase === true ? options.pattern.toLowerCase() : options.pattern;
      const searchSequence = options.ignoreCase === true ? sequence.toLowerCase() : sequence;

      // Forward strand search
      const forwardMatches = this.findStringMatches(
        seq,
        searchSequence,
        stringPattern,
        "+",
        options
      );
      results.push(...forwardMatches);

      // Reverse strand search if enabled
      if (options.searchBothStrands === true) {
        const reversePattern = reverseComplement(stringPattern);
        const reverseMatches = this.findStringMatches(
          seq,
          searchSequence,
          reversePattern,
          "-",
          options
        );
        results.push(...reverseMatches);
      }
    }

    // Filter overlaps if not allowed
    if (options.allowOverlaps !== true) {
      return this.filterOverlaps(results);
    }

    return results;
  }

  /**
   * Find matches using regular expressions
   */
  private findRegexMatches(seq: AbstractSequence, options: LocateOptions): MotifLocation[] {
    const results: MotifLocation[] = [];
    const pattern = options.pattern as RegExp;

    // Create case-insensitive version if needed
    let searchPattern = pattern;
    if (options.ignoreCase === true && !pattern.flags.includes("i")) {
      searchPattern = new RegExp(pattern.source, `${pattern.flags}i`);
    }

    // Add global flag if not present to find all matches
    if (!searchPattern.flags.includes("g")) {
      searchPattern = new RegExp(searchPattern.source, `${searchPattern.flags}g`);
    }

    let match: RegExpExecArray | null = searchPattern.exec(seq.sequence);
    while (match !== null) {
      const location: MotifLocation = {
        sequenceId: seq.id,
        start: match.index,
        end: match.index + match[0].length,
        length: match[0].length,
        strand: "+",
        matchedSequence: match[0],
        mismatches: 0,
        score: 1.0,
        pattern: pattern.source,
        ...(options.outputFormat !== "bed" && {
          context: this.extractContext(seq.sequence, match.index, match[0].length),
        }),
      };

      results.push(location);

      // Prevent infinite loop with zero-width matches
      if (match[0].length === 0) {
        searchPattern.lastIndex++;
      }

      // Get next match for next iteration
      match = searchPattern.exec(seq.sequence);
    }

    return results;
  }

  /**
   * Find matches using string patterns (with fuzzy matching support)
   */
  private findStringMatches(
    seq: AbstractSequence,
    searchSequence: string,
    pattern: string,
    strand: "+" | "-",
    options: LocateOptions
  ): MotifLocation[] {
    const maxMismatches = options.allowMismatches ?? 0;
    const minLength = options.minLength ?? pattern.length;

    // Early return if pattern is shorter than minimum length
    if (pattern.length < minLength) {
      return [];
    }

    // Use core fuzzy matching function instead of reimplementing
    const matches = fuzzyMatch(searchSequence, pattern, maxMismatches);

    return matches
      .map((match) => {
        const score = this.calculateScore(match.mismatches, pattern.length);

        // Preserve original case from the source sequence, not the search sequence
        const originalMatchedSequence = seq.sequence.substring(
          match.position,
          match.position + match.length
        );

        const location: MotifLocation = {
          sequenceId: seq.id,
          start: match.position,
          end: match.position + match.length,
          length: match.length,
          strand,
          matchedSequence: originalMatchedSequence, // Use original case from seq.sequence
          mismatches: match.mismatches,
          score,
          pattern: options.pattern as string,
          ...(options.outputFormat !== "bed" && {
            context: this.extractContext(seq.sequence, match.position, match.length),
          }),
        };

        return location;
      })
      .filter((location) => location.length >= minLength); // Apply minLength filter
  }

  /**
   * Calculate match score based on mismatches
   */
  private calculateScore(mismatches: number, patternLength: number): number {
    if (patternLength === 0) return 0;
    return Math.max(0, 1 - mismatches / patternLength);
  }

  /**
   * Extract sequence context around a match
   */
  private extractContext(
    sequence: string,
    start: number,
    length: number,
    contextSize: number = 10
  ): { upstream: string; downstream: string } {
    const upstreamStart = Math.max(0, start - contextSize);
    const downstreamEnd = Math.min(sequence.length, start + length + contextSize);

    return {
      upstream: sequence.substring(upstreamStart, start),
      downstream: sequence.substring(start + length, downstreamEnd),
    };
  }

  /**
   * Filter overlapping matches, keeping the highest scoring ones
   */
  private filterOverlaps(locations: MotifLocation[]): MotifLocation[] {
    if (locations.length <= 1) {
      return locations;
    }

    // Sort by start position, then by score (descending)
    const sorted = locations.sort((a, b) => {
      if (a.start !== b.start) {
        return a.start - b.start;
      }
      return b.score - a.score;
    });

    const filtered: MotifLocation[] = [];

    for (const current of sorted) {
      const hasOverlap = filtered.some((existing) => this.locationsOverlap(existing, current));

      if (!hasOverlap) {
        filtered.push(current);
      }
    }

    return filtered;
  }

  /**
   * Check if two locations overlap
   */
  private locationsOverlap(loc1: MotifLocation, loc2: MotifLocation): boolean {
    return !(loc1.end <= loc2.start || loc2.end <= loc1.start);
  }
}
