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

import type { AbstractSequence, MotifLocation } from '../types';
import { LocateError, createContextualError } from '../errors';
import type { LocateOptions } from './types';

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
    // Validate options before processing
    this.validateOptions(options);

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
        '+',
        options
      );
      results.push(...forwardMatches);

      // Reverse strand search if enabled
      if (options.searchBothStrands === true) {
        const reversePattern = this.reverseComplement(stringPattern);
        const reverseMatches = this.findStringMatches(
          seq,
          searchSequence,
          reversePattern,
          '-',
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
    if (options.ignoreCase === true && !pattern.flags.includes('i')) {
      searchPattern = new RegExp(pattern.source, pattern.flags + 'i');
    }

    // Add global flag if not present to find all matches
    if (!searchPattern.flags.includes('g')) {
      searchPattern = new RegExp(searchPattern.source, searchPattern.flags + 'g');
    }

    let match;
    while ((match = searchPattern.exec(seq.sequence)) !== null) {
      const location: MotifLocation = {
        sequenceId: seq.id,
        start: match.index,
        end: match.index + match[0].length,
        length: match[0].length,
        strand: '+',
        matchedSequence: match[0],
        mismatches: 0,
        score: 1.0,
        pattern: pattern.source,
        ...(options.outputFormat !== 'bed' && {
          context: this.extractContext(seq.sequence, match.index, match[0].length),
        }),
      };

      results.push(location);

      // Prevent infinite loop with zero-width matches
      if (match[0].length === 0) {
        searchPattern.lastIndex++;
      }
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
    strand: '+' | '-',
    options: LocateOptions
  ): MotifLocation[] {
    const results: MotifLocation[] = [];
    const maxMismatches = options.allowMismatches ?? 0;
    const minLength = options.minLength ?? pattern.length;

    // ZIG_CRITICAL: Hot loop - sliding window pattern matching across entire sequence
    // Perfect candidate for SIMD string comparison and Boyer-Moore optimization
    for (let i = 0; i <= searchSequence.length - minLength; i++) {
      const window = searchSequence.substring(i, i + pattern.length);

      if (window.length < minLength) {
        continue;
      }

      // ZIG_CRITICAL: Character-by-character comparison in tight loop
      const mismatches = this.countMismatches(window, pattern);

      if (mismatches <= maxMismatches) {
        const score = this.calculateScore(mismatches, pattern.length);

        const location: MotifLocation = {
          sequenceId: seq.id,
          start: i,
          end: i + pattern.length,
          length: pattern.length,
          strand,
          matchedSequence: seq.sequence.substring(i, i + pattern.length),
          mismatches,
          score,
          pattern: options.pattern as string,
          ...(options.outputFormat !== 'bed' && {
            context: this.extractContext(seq.sequence, i, pattern.length),
          }),
        };

        results.push(location);
      }
    }

    return results;
  }

  /**
   * Count mismatches between two strings
   */
  private countMismatches(str1: string, str2: string): number {
    const minLen = Math.min(str1.length, str2.length);
    let mismatches = 0;

    for (let i = 0; i < minLen; i++) {
      if (str1[i] !== str2[i]) {
        mismatches++;
      }
    }

    // Count length difference as mismatches
    mismatches += Math.abs(str1.length - str2.length);

    return mismatches;
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
   * Generate reverse complement of DNA sequence
   */
  private reverseComplement(sequence: string): string {
    const complement: Record<string, string> = {
      A: 'T',
      T: 'A',
      C: 'G',
      G: 'C',
      U: 'A',
      R: 'Y',
      Y: 'R',
      S: 'S',
      W: 'W',
      K: 'M',
      M: 'K',
      B: 'V',
      D: 'H',
      H: 'D',
      V: 'B',
      N: 'N',
      a: 't',
      t: 'a',
      c: 'g',
      g: 'c',
      u: 'a',
      r: 'y',
      y: 'r',
      s: 's',
      w: 'w',
      k: 'm',
      m: 'k',
      b: 'v',
      d: 'h',
      h: 'd',
      v: 'b',
      n: 'n',
    };

    return sequence
      .split('')
      .reverse()
      .map((base) => complement[base] ?? base)
      .join('');
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

  /**
   * Validate locate options
   */
  private validateOptions(options: LocateOptions): void {
    this.validatePattern(options);
    this.validateMismatchOptions(options);
    this.validateOutputOptions(options);
  }

  /**
   * Validate pattern requirement
   */
  private validatePattern(options: LocateOptions): void {
    if (options.pattern === undefined || options.pattern === null || options.pattern === '') {
      throw createContextualError(LocateError, 'Pattern is required for locate operation', {
        context: 'Provide a pattern string or RegExp',
        data: { providedOptions: Object.keys(options) },
      });
    }
  }

  /**
   * Validate mismatch-related options
   */
  private validateMismatchOptions(options: LocateOptions): void {
    if (options.allowMismatches !== undefined) {
      if (options.allowMismatches < 0) {
        throw createContextualError(LocateError, 'allowMismatches must be non-negative', {
          context: 'Mismatch count cannot be negative',
          data: { provided: options.allowMismatches },
        });
      }

      if (options.pattern instanceof RegExp && options.allowMismatches > 0) {
        throw createContextualError(
          LocateError,
          'allowMismatches not supported for regex patterns',
          {
            context: 'Use string patterns for fuzzy matching',
            data: { patternType: 'RegExp' },
          }
        );
      }
    }

    if (options.maxMatches !== undefined && options.maxMatches < 1) {
      throw createContextualError(LocateError, 'maxMatches must be positive', {
        context: 'Specify a positive number for maximum matches',
        data: { provided: options.maxMatches },
      });
    }

    if (options.minLength !== undefined && options.minLength < 1) {
      throw createContextualError(LocateError, 'minLength must be positive', {
        context: 'Minimum match length must be at least 1',
        data: { provided: options.minLength },
      });
    }
  }

  /**
   * Validate output-related options
   */
  private validateOutputOptions(options: LocateOptions): void {
    const validFormats = ['default', 'bed', 'custom'];
    if (options.outputFormat && !validFormats.includes(options.outputFormat)) {
      throw createContextualError(LocateError, `Invalid output format: ${options.outputFormat}`, {
        context: `Valid formats: ${validFormats.join(', ')}`,
        data: { providedFormat: options.outputFormat },
      });
    }
  }
}
