/**
 * LocateProcessor - Pattern location finding for sequences
 *
 * This processor implements motif location functionality for finding all
 * occurrences of patterns within sequences with support for fuzzy matching,
 * strand searching, and various output formats.
 *
 */

import { type } from "arktype";
import { findPatternBatch } from "../backend/service";
import { ValidationError } from "../errors";
import { packSequences } from "../backend/batch";
import type { PatternSearchResult } from "../backend/kernel-types";
import type { AbstractSequence, MotifLocation } from "../types";
import { fuzzyMatch } from "./core/pattern-matching";
import { reverseComplement } from "./core/sequence-manipulation";
import type { LocateOptions } from "./types";

const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

interface LocateSearchJob {
  readonly pattern: Uint8Array;
  readonly searchPattern: string;
  readonly strand: "+" | "-";
}

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

    if (options.pattern instanceof RegExp) {
      const regexOptions = options as LocateOptions & { pattern: RegExp };
      yield* this.locateRegex(source, regexOptions);
      return;
    }

    if (options.allowOverlaps !== true) {
      const stringOptions = options as LocateOptions & { pattern: string };
      yield* this.locateNative(source, stringOptions);
      return;
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

  private async *locateRegex(
    source: AsyncIterable<AbstractSequence>,
    options: LocateOptions & { pattern: RegExp }
  ): AsyncIterable<MotifLocation> {
    let totalYielded = 0;

    for await (const seq of source) {
      const locations = this.findRegexMatches(seq, options);
      const filtered = options.allowOverlaps === true ? locations : this.filterOverlaps(locations);

      for (const location of filtered) {
        if (options.maxMatches !== undefined && totalYielded >= options.maxMatches) {
          return;
        }
        yield location;
        totalYielded++;
      }
    }
  }

  private async *locateNative(
    source: AsyncIterable<AbstractSequence>,
    options: LocateOptions & { pattern: string }
  ): AsyncIterable<MotifLocation> {
    const minLength = options.minLength ?? options.pattern.length;
    if (options.pattern.length < minLength) {
      return;
    }

    const jobs = this.buildSearchJobs(options);
    let batch: AbstractSequence[] = [];
    let batchBytes = 0;
    let totalYielded = 0;

    for await (const seq of source) {
      batch.push(seq);
      batchBytes += seq.sequence.length;

      if (batchBytes >= BATCH_BYTE_BUDGET) {
        totalYielded += yield* this.flushNativeBatch(batch, jobs, options, totalYielded);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* this.flushNativeBatch(batch, jobs, options, totalYielded);
    }
  }

  private buildSearchJobs(
    options: LocateOptions & { pattern: string }
  ): readonly LocateSearchJob[] {
    const jobs: LocateSearchJob[] = [
      {
        pattern: new Uint8Array(Buffer.from(options.pattern, "latin1")),
        searchPattern: options.pattern,
        strand: "+",
      },
    ];

    if (options.searchBothStrands === true) {
      const reversePattern = reverseComplement(options.pattern);
      jobs.push({
        pattern: new Uint8Array(Buffer.from(reversePattern, "latin1")),
        searchPattern: reversePattern,
        strand: "-",
      });
    }

    return jobs;
  }

  private async *flushNativeBatch(
    batch: readonly AbstractSequence[],
    jobs: readonly LocateSearchJob[],
    options: LocateOptions & { pattern: string },
    totalYieldedSoFar: number
  ): AsyncGenerator<MotifLocation, number> {
    const { data, offsets } = packSequences(batch);
    const caseInsensitive = options.ignoreCase === true;
    const maxEdits = options.allowMismatches ?? 0;
    const results = new Map<LocateSearchJob, PatternSearchResult>();
    let yielded = 0;

    for (const job of jobs) {
      results.set(
        job,
        await findPatternBatch(data, offsets, job.pattern, {
          maxEdits,
          caseInsensitive,
        })
      );
    }

    for (let seqIndex = 0; seqIndex < batch.length; seqIndex++) {
      const matches: MotifLocation[] = [];

      for (const job of jobs) {
        matches.push(
          ...this.decodeNativeMatches(batch[seqIndex]!, seqIndex, results.get(job)!, job, options)
        );
      }

      const filtered = this.filterOverlaps(matches);

      for (const location of filtered) {
        if (options.maxMatches !== undefined && totalYieldedSoFar + yielded >= options.maxMatches) {
          return yielded;
        }
        yield location;
        yielded++;
      }
    }

    return yielded;
  }

  private decodeNativeMatches(
    seq: AbstractSequence,
    seqIndex: number,
    result: PatternSearchResult,
    job: LocateSearchJob,
    options: LocateOptions & { pattern: string }
  ): MotifLocation[] {
    const rangeStart = result.matchOffsets[seqIndex]!;
    const rangeEnd = result.matchOffsets[seqIndex + 1]!;
    const seqStr = seq.sequence.toString();
    const maxMismatches = options.allowMismatches ?? 0;
    const caseInsensitive = options.ignoreCase === true;
    const matches: MotifLocation[] = [];

    for (let i = rangeStart; i < rangeEnd; i++) {
      const start = result.starts[i]!;
      const end = result.ends[i]!;
      const length = end - start;
      if (length !== job.searchPattern.length) {
        continue;
      }

      const matchedSequence = seqStr.slice(start, end);
      const mismatches = this.countLiteralMismatches(
        matchedSequence,
        job.searchPattern,
        caseInsensitive
      );
      if (mismatches > maxMismatches) {
        continue;
      }

      matches.push({
        sequenceId: seq.id,
        start,
        end,
        length,
        strand: job.strand,
        matchedSequence,
        mismatches,
        score: this.calculateScore(mismatches, job.searchPattern.length),
        pattern: options.pattern,
        ...(options.outputFormat !== "bed" && {
          context: this.extractContext(seqStr, start, length),
        }),
      });
    }

    return matches;
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
    const sequence = seq.sequence.toString();

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
    const seqStr = seq.sequence.toString();

    // Create case-insensitive version if needed
    let searchPattern = pattern;
    if (options.ignoreCase === true && !pattern.flags.includes("i")) {
      searchPattern = new RegExp(pattern.source, `${pattern.flags}i`);
    }

    // Add global flag if not present to find all matches
    if (!searchPattern.flags.includes("g")) {
      searchPattern = new RegExp(searchPattern.source, `${searchPattern.flags}g`);
    }

    let match: RegExpExecArray | null = searchPattern.exec(seqStr);
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
          context: this.extractContext(seqStr, match.index, match[0].length),
        }),
      };

      results.push(location);

      // Prevent infinite loop with zero-width matches
      if (match[0].length === 0) {
        searchPattern.lastIndex++;
      }

      // Get next match for next iteration
      match = searchPattern.exec(seqStr);
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
    const seqStr = seq.sequence.toString();

    return matches
      .map((match) => {
        const score = this.calculateScore(match.mismatches, pattern.length);

        // Preserve original case from the source sequence, not the search sequence
        const originalMatchedSequence = seqStr.slice(match.position, match.position + match.length);

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
            context: this.extractContext(seqStr, match.position, match.length),
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

  private countLiteralMismatches(sequence: string, pattern: string, ignoreCase: boolean): number {
    let mismatches = 0;

    for (let i = 0; i < pattern.length; i++) {
      const seqChar = sequence[i];
      const patternChar = pattern[i];

      if (seqChar === undefined || patternChar === undefined) {
        return pattern.length;
      }

      const matches =
        ignoreCase === true
          ? seqChar.toLowerCase() === patternChar.toLowerCase()
          : seqChar === patternChar;

      if (!matches) {
        mismatches++;
      }
    }

    return mismatches;
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
