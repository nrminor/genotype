/**
 * GrepProcessor - Pattern search and filtering for sequences
 *
 * This processor implements pattern matching functionality similar to Unix grep,
 * allowing searches across sequence content, IDs, and descriptions with support
 * for regex patterns, case-insensitive matching, and fuzzy matching with mismatches.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import type { AbstractSequence } from '../types';
import { GrepError } from '../errors';
import type { GrepOptions } from './types';

/**
 * Processor for pattern search operations
 *
 * Implements Unix grep-style pattern matching with bioinformatics enhancements.
 * Maintains streaming behavior and single responsibility principle.
 *
 * @example
 * ```typescript
 * const processor = new GrepProcessor();
 * const matches = processor.process(sequences, {
 *   pattern: /^chr\d+/,
 *   target: 'id',
 *   ignoreCase: true
 * });
 * ```
 */
export class GrepProcessor {
  /**
   * Process sequences with pattern matching
   *
   * @param source - Input sequences
   * @param options - Grep options
   * @yields Sequences that match the pattern criteria
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: GrepOptions
  ): AsyncIterable<AbstractSequence> {
    this.validateOptions(options);

    for await (const seq of source) {
      const matches = this.sequenceMatches(seq, options);

      // Apply invert logic
      const shouldYield = options.invert === true ? !matches : matches;

      if (shouldYield) {
        yield seq;
      }
    }
  }

  /**
   * Check if a sequence matches the pattern criteria
   *
   * @param seq - Sequence to check
   * @param options - Pattern matching options
   * @returns True if sequence matches criteria
   */
  private sequenceMatches(seq: AbstractSequence, options: GrepOptions): boolean {
    const target = this.getSearchTarget(seq, options.target);
    if (target === null || target === '') return false;

    return this.patternMatches(target, options);
  }

  /**
   * Extract the target field for searching
   *
   * @param seq - Sequence object
   * @param target - Field to extract
   * @returns Target string or null if not available
   */
  private getSearchTarget(seq: AbstractSequence, target: string): string | null {
    switch (target) {
      case 'sequence':
        return seq.sequence;
      case 'id':
        return seq.id;
      case 'description':
        return seq.description ?? null;
      default:
        throw new GrepError(
          `Invalid search target: ${target}. Valid targets: ${['sequence', 'id', 'description'].join(', ')}`
        );
    }
  }

  /**
   * Check if target string matches the pattern
   *
   * @param target - String to search in
   * @param options - Pattern matching options
   * @returns True if pattern matches
   */
  private patternMatches(target: string, options: GrepOptions): boolean {
    const { pattern, ignoreCase, wholeWord, allowMismatches, searchBothStrands } = options;

    // Handle regex patterns
    if (pattern instanceof RegExp) {
      return this.regexMatches(target, pattern, ignoreCase === true);
    }

    // Handle string patterns
    const searchTarget = ignoreCase === true ? target.toLowerCase() : target;
    const searchPattern = ignoreCase === true ? pattern.toLowerCase() : pattern;

    // Handle sequence matching (including both strands and fuzzy matching)
    if (options.target === 'sequence') {
      const maxMismatches = allowMismatches ?? 0;
      return this.fuzzyMatches(
        searchTarget,
        searchPattern,
        maxMismatches,
        searchBothStrands === true
      );
    }

    // Handle whole word matching
    if (wholeWord === true) {
      const wordRegex = new RegExp(
        `\\b${this.escapeRegex(searchPattern)}\\b`,
        ignoreCase === true ? 'i' : ''
      );
      return wordRegex.test(target);
    }

    // Simple string inclusion
    return searchTarget.includes(searchPattern);
  }

  /**
   * Check regex pattern matching with case sensitivity handling
   */
  private regexMatches(target: string, pattern: RegExp, ignoreCase: boolean): boolean {
    if (ignoreCase === true && !pattern.flags.includes('i')) {
      // Create case-insensitive version if needed
      const flags = pattern.flags + 'i';
      const caseInsensitivePattern = new RegExp(pattern.source, flags);
      return caseInsensitivePattern.test(target);
    }
    return pattern.test(target);
  }

  /**
   * Fuzzy pattern matching with mismatches for sequences
   *
   * NATIVE_CANDIDATE: String matching with mismatches is computationally expensive
   * Native implementation with SIMD could provide significant performance gains
   */
  private fuzzyMatches(
    sequence: string,
    pattern: string,
    maxMismatches: number,
    bothStrands?: boolean
  ): boolean {
    // Check forward strand
    if (this.countMismatches(sequence, pattern) <= maxMismatches) {
      return true;
    }

    // Check reverse complement if requested
    if (bothStrands === true) {
      const patternReverseComplement = this.reverseComplement(pattern);
      if (this.countMismatches(sequence, patternReverseComplement) <= maxMismatches) {
        return true;
      }
    }

    return false;
  }

  /**
   * Count mismatches between pattern and all positions in sequence
   */
  private countMismatches(sequence: string, pattern: string): number {
    let minMismatches = Infinity;

    // Sliding window approach
    for (let i = 0; i <= sequence.length - pattern.length; i++) {
      const window = sequence.substr(i, pattern.length);
      let mismatches = 0;

      for (let j = 0; j < pattern.length; j++) {
        if (window[j] !== pattern[j]) {
          mismatches++;
        }
      }

      minMismatches = Math.min(minMismatches, mismatches);

      // Early exit if perfect match found
      if (minMismatches === 0) break;
    }

    return minMismatches === Infinity ? pattern.length : minMismatches;
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
    };

    return sequence
      .toUpperCase()
      .split('')
      .reverse()
      .map((base) => complement[base] ?? base)
      .join('');
  }

  /**
   * Validate grep options
   */
  private validateOptions(options: GrepOptions): void {
    if (options.pattern === undefined || options.pattern === null || options.pattern === '') {
      throw new GrepError('Pattern is required for grep operation');
    }

    const validTargets = ['sequence', 'id', 'description'];
    if (!validTargets.includes(options.target)) {
      throw new GrepError(
        `Invalid target: ${options.target}. Valid targets: ${validTargets.join(', ')}`
      );
    }

    if (options.allowMismatches !== undefined && options.allowMismatches < 0) {
      throw new GrepError('allowMismatches must be non-negative');
    }

    if (options.allowMismatches !== undefined && options.target !== 'sequence') {
      throw new GrepError('allowMismatches only supported for sequence searches');
    }
  }

  /**
   * Escape special regex characters in string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
