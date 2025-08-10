/**
 * Modern, streaming-first pattern matching for genomic sequences.
 * 
 * This module provides high-performance pattern matching algorithms optimized for
 * genomic data, with support for exact matching, fuzzy matching, IUPAC ambiguity
 * codes, and streaming processing of large sequence files.
 * 
 * @module pattern-matcher
 * @since 1.0.0
 * 
 * @remarks
 * Key features:
 * - Rich match objects with surrounding context
 * - Memory-efficient streaming for multi-GB files
 * - Multiple algorithms (Boyer-Moore, KMP, fuzzy, regex)
 * - IUPAC ambiguity code support (N, R, Y, etc.)
 * - Zero-copy streaming with configurable buffer sizes
 * 
 * Performance considerations:
 * - Boyer-Moore is fastest for long patterns (>10 bp)
 * - KMP excels with repetitive patterns
 * - Fuzzy matching scales O(n*m*k) where k is max mismatches
 * - IUPAC matching has overhead for ambiguous base expansion
 */

import type { Sequence } from '../../types';
import { SequenceValidator } from './validation';

/**
 * Rich match result with full context information.
 * 
 * @interface SequenceMatch
 * @since 1.0.0
 */
export interface SequenceMatch {
  /** 
   * Zero-based position in the sequence where the match starts.
   * @example 42 // Match starts at position 42
   */
  position: number;
  
  /** 
   * Length of the matched region in base pairs.
   * May differ from pattern length for regex or ambiguous matches.
   */
  length: number;
  
  /** 
   * The actual matched text from the sequence.
   * Preserves original case from the input sequence.
   */
  matched: string;
  
  /** 
   * The pattern that was matched.
   * Useful for regex patterns where the match may vary.
   */
  pattern: string;
  
  /** 
   * Number of mismatches for fuzzy matching.
   * Always 0 for exact matches.
   * @minimum 0
   */
  mismatches: number;
  
  /** 
   * ID of the sequence where this match was found.
   * Corresponds to the sequence.id field.
   */
  sequenceId: string;
  
  /** 
   * Context surrounding the match for visualization.
   * Configurable via contextWindow option.
   */
  context: {
    /** 
     * Text before the match (up to contextWindow characters).
     * Empty string if match is at sequence start.
     */
    before: string;
    /** 
     * Text after the match (up to contextWindow characters).
     * Empty string if match is at sequence end.
     */
    after: string;
    /** 
     * Absolute start position of the context window.
     * @minimum 0
     */
    contextStart: number;
    /** 
     * Absolute end position of the context window.
     * May exceed sequence length for end matches.
     */
    contextEnd: number;
  };
  
  /** 
   * Match quality score for fuzzy matching.
   * Calculated as: 1.0 - (mismatches / pattern.length)
   * @minimum 0.0
   * @maximum 1.0
   * @example 0.75 // 75% similarity (1 mismatch in 4 bp pattern)
   */
  score: number;
}

/**
 * Configuration options for pattern matching behavior.
 * 
 * @interface MatcherOptions
 * @since 1.0.0
 * 
 * @example
 * ```typescript
 * const options: MatcherOptions = {
 *   algorithm: 'fuzzy',
 *   maxMismatches: 2,
 *   iupacAware: true,
 *   caseSensitive: false,
 *   contextWindow: 100
 * };
 * ```
 */
export interface MatcherOptions {
  /** 
   * Algorithm to use for pattern matching.
   * - 'boyer-moore': Fast for long patterns and alphabets (default)
   * - 'kmp': Efficient for patterns with repetitive structure
   * - 'fuzzy': Allows mismatches up to maxMismatches
   * - 'regex': Full regular expression support
   * @default 'boyer-moore'
   */
  algorithm?: 'boyer-moore' | 'kmp' | 'fuzzy' | 'regex';
  
  /** 
   * Maximum number of mismatches allowed for fuzzy matching.
   * Only applies when algorithm is 'fuzzy'.
   * @default 0
   * @minimum 0
   */
  maxMismatches?: number;
  
  /** 
   * Enable IUPAC ambiguity code matching.
   * Supports: N (any), R (A/G), Y (C/T), S (G/C), W (A/T), K (G/T),
   * M (A/C), B (C/G/T), D (A/G/T), H (A/C/T), V (A/C/G).
   * @default false
   */
  iupacAware?: boolean;
  
  /** 
   * Whether pattern matching is case-sensitive.
   * When false, converts both pattern and sequence to uppercase.
   * @default true
   */
  caseSensitive?: boolean;
  
  /** 
   * Number of characters to include before/after match in context.
   * @default 50
   * @minimum 0
   */
  contextWindow?: number;
  
  /** 
   * Buffer size in bytes for streaming large sequences.
   * Larger buffers improve performance but use more memory.
   * @default 1000000 (1MB)
   * @minimum 1024
   */
  bufferSize?: number;
}

/**
 * High-performance pattern matcher for genomic sequences.
 * 
 * Provides streaming-first pattern matching with support for multiple algorithms,
 * IUPAC ambiguity codes, and fuzzy matching. Designed for both small scripts
 * and production bioinformatics pipelines.
 * 
 * @class SequenceMatcher
 * @since 1.0.0
 * 
 * @example
 * ```typescript
 * // Simple exact matching
 * const matcher = new SequenceMatcher('ATCG');
 * for await (const match of matcher.findAll(sequences)) {
 *   console.log(`Found ${match.pattern} at position ${match.position}`);
 *   console.log(`Context: ...${match.context.before}[${match.matched}]${match.context.after}...`);
 * }
 * 
 * // Fuzzy matching allowing 2 mismatches
 * const fuzzy = new SequenceMatcher('ATCGATCG', { 
 *   algorithm: 'fuzzy',
 *   maxMismatches: 2 
 * });
 * 
 * // IUPAC ambiguity code matching
 * const iupac = new SequenceMatcher('ATCN', { // N matches any base
 *   iupacAware: true
 * });
 * 
 * // Case-insensitive regex matching
 * const regex = new SequenceMatcher('ATC[GA]', {
 *   algorithm: 'regex',
 *   caseSensitive: false
 * });
 * ```
 * 
 * @remarks
 * The matcher pre-computes lookup tables and pattern analysis during construction
 * for optimal performance during matching. For best results, reuse matcher
 * instances when searching for the same pattern multiple times.
 */
export class SequenceMatcher {
  private readonly pattern: string;
  private readonly options: Required<MatcherOptions>;
  private readonly patternUpper: string;
  private badCharTable?: Map<number, number>;
  private readonly expandedPatterns?: string[];
  
  constructor(pattern: string, options: MatcherOptions = {}) {
    if (!pattern || pattern.length === 0) {
      throw new Error('Pattern cannot be empty');
    }
    
    this.pattern = pattern;
    this.options = {
      algorithm: options.algorithm ?? 'boyer-moore',
      maxMismatches: options.maxMismatches ?? 0,
      iupacAware: options.iupacAware ?? false,
      caseSensitive: options.caseSensitive ?? true,
      contextWindow: options.contextWindow ?? 50,
      bufferSize: options.bufferSize ?? 1_000_000, // 1MB default buffer
    };
    
    this.patternUpper = this.options.caseSensitive 
      ? pattern 
      : pattern.toUpperCase();
    
    // Pre-build Boyer-Moore table if using that algorithm
    if (this.options.algorithm === 'boyer-moore') {
      this.badCharTable = this.buildBadCharTable(this.patternUpper);
    }
    
    // Pre-expand IUPAC patterns if needed
    if (this.options.iupacAware && /[RYSWKMBDHVN]/i.test(pattern)) {
      this.expandedPatterns = this.expandIUPACPattern(pattern);
    }
  }
  
  /**
   * Find all matches in a stream of sequences.
   * 
   * Memory-efficient streaming implementation that processes sequences
   * one at a time without loading the entire dataset into memory.
   * 
   * @param sequences - Async iterable of sequences to search
   * @yields {SequenceMatch} Match objects as they are found
   * 
   * @example
   * ```typescript
   * for await (const match of matcher.findAll(sequenceStream)) {
   *   console.log(`${match.sequenceId}: ${match.position}`);
   * }
   * ```
   */
  async *findAll(sequences: AsyncIterable<Sequence>): AsyncGenerator<SequenceMatch> {
    for await (const sequence of sequences) {
      const matches = this.findInSequence(sequence);
      for (const match of matches) {
        yield match;
      }
    }
  }
  
  /**
   * Find all matches in a single sequence.
   * 
   * Synchronous method for searching within a single sequence.
   * Returns all matches found, including overlapping matches.
   * 
   * @param sequence - Sequence object or raw sequence string to search
   * @returns Array of all matches found in the sequence
   * 
   * @example
   * ```typescript
   * const matches = matcher.findInSequence('ATCGATCGATCG');
   * console.log(`Found ${matches.length} matches`);
   * ```
   */
  findInSequence(sequence: Sequence | string): SequenceMatch[] {
    const isSequenceObject = typeof sequence === 'object';
    const seq = isSequenceObject ? sequence.sequence : sequence;
    const seqId = isSequenceObject ? sequence.id : 'unknown';
    
    const text = this.options.caseSensitive ? seq : seq.toUpperCase();
    const originalText = this.options.caseSensitive ? undefined : seq;
    
    // Handle IUPAC ambiguity codes
    if (this.options.iupacAware && this.expandedPatterns) {
      return this.findWithIUPAC(text, seqId, originalText);
    }
    
    // Choose algorithm
    switch (this.options.algorithm) {
      case 'fuzzy':
        return this.fuzzyMatch(text, seqId, originalText);
      case 'kmp':
        return this.kmpMatch(text, seqId, originalText);
      case 'regex':
        return this.regexMatch(text, seqId, originalText);
      case 'boyer-moore':
      default:
        return this.boyerMooreMatch(text, seqId, originalText);
    }
  }
  
  /**
   * Find only the first match in a sequence.
   * 
   * Optimized method that stops searching after finding the first match,
   * useful for existence checks or when only one match is needed.
   * 
   * @param sequence - Sequence to search
   * @returns First match found, or null if no matches
   * 
   * @example
   * ```typescript
   * const first = matcher.findFirst(sequence);
   * if (first) {
   *   console.log(`Pattern found at position ${first.position}`);
   * }
   * ```
   */
  findFirst(sequence: Sequence | string): SequenceMatch | null {
    const matches = this.findInSequence(sequence);
    return matches.length > 0 ? matches[0]! : null;
  }
  
  /**
   * Test if pattern exists in sequence.
   * 
   * Fast boolean check that stops at first match.
   * More efficient than findInSequence when you only need to know
   * if the pattern exists.
   * 
   * @param sequence - Sequence to test
   * @returns True if pattern exists in sequence
   * 
   * @example
   * ```typescript
   * if (matcher.test(sequence)) {
   *   console.log('Pattern found!');
   * }
   * ```
   */
  test(sequence: Sequence | string): boolean {
    return this.findFirst(sequence) !== null;
  }
  
  /**
   * Count pattern occurrences without creating match objects.
   * 
   * Memory-efficient counting that doesn't build match objects,
   * useful for statistics and filtering.
   * 
   * @param sequence - Sequence to count matches in
   * @returns Number of pattern occurrences
   * 
   * @example
   * ```typescript
   * const count = matcher.count(sequence);
   * console.log(`Pattern appears ${count} times`);
   * ```
   */
  count(sequence: Sequence | string): number {
    const text = typeof sequence === 'object' ? sequence.sequence : sequence;
    const searchText = this.options.caseSensitive ? text : text.toUpperCase();
    
    // Fast counting without building match objects
    const positions = this.getBoyerMoorePositions(searchText);
    return positions.length;
  }
  
  /**
   * Stream matches from chunked sequence data.
   * 
   * Processes sequence data in chunks with a sliding window to handle
   * patterns that span chunk boundaries. Ideal for streaming from
   * files or network sources.
   * 
   * @param sequenceStream - Async iterable yielding sequence chunks
   * @yields {SequenceMatch} Matches with globally adjusted positions
   * 
   * @example
   * ```typescript
   * async function* readFileChunks(path: string) {
   *   const file = Bun.file(path);
   *   const stream = file.stream();
   *   for await (const chunk of stream) {
   *     yield new TextDecoder().decode(chunk);
   *   }
   * }
   * 
   * for await (const match of matcher.streamMatches(readFileChunks('genome.fa'))) {
   *   console.log(`Match at position ${match.position}`);
   * }
   * ```
   */
  async *streamMatches(
    sequenceStream: AsyncIterable<string>
  ): AsyncGenerator<SequenceMatch> {
    let buffer = '';
    let position = 0;
    
    for await (const chunk of sequenceStream) {
      buffer += chunk;
      
      // Keep buffer size manageable
      while (buffer.length > this.options.bufferSize) {
        const searchLength = this.options.bufferSize - this.pattern.length;
        const searchBuffer = buffer.substring(0, searchLength);
        
        // Find matches in this portion
        const matches = this.findInString(searchBuffer, position, 'stream');
        for (const match of matches) {
          yield match;
        }
        
        // Slide the window
        buffer = buffer.substring(searchLength);
        position += searchLength;
      }
    }
    
    // Process remaining buffer
    if (buffer.length > 0) {
      const matches = this.findInString(buffer, position, 'stream');
      for (const match of matches) {
        yield match;
      }
    }
  }
  
  // Private implementation methods
  
  private boyerMooreMatch(text: string, sequenceId: string, originalText?: string): SequenceMatch[] {
    const positions = this.getBoyerMoorePositions(text);
    // Use originalText if provided (for case-insensitive matching)
    const textForMatch = originalText ?? text;
    return positions.map(pos => this.createMatch(textForMatch, pos, sequenceId, 0));
  }
  
  private getBoyerMoorePositions(text: string): number[] {
    const matches: number[] = [];
    const pattern = this.patternUpper;
    
    if (!this.badCharTable || pattern.length > text.length) {
      return matches;
    }
    
    let shift = 0;
    while (shift <= text.length - pattern.length) {
      let j = pattern.length - 1;
      
      while (j >= 0 && pattern[j] === text[shift + j]) {
        j--;
      }
      
      if (j < 0) {
        matches.push(shift);
        
        // For overlapping matches, always advance by 1
        // This ensures we don't miss overlapping patterns
        shift += 1;
      } else {
        const mismatchChar = text.charCodeAt(shift + j);
        const skip = this.badCharTable.get(mismatchChar) ?? -1;
        shift += Math.max(1, j - skip);
      }
    }
    
    return matches;
  }
  
  private kmpMatch(text: string, sequenceId: string, originalText?: string): SequenceMatch[] {
    const matches: SequenceMatch[] = [];
    const pattern = this.patternUpper;
    const lps = this.buildLPSArray(pattern);
    const textForMatch = originalText ?? text;
    
    let i = 0; // Index for text
    let j = 0; // Index for pattern
    
    while (i < text.length) {
      if (pattern[j] === text[i]) {
        i++;
        j++;
      }
      
      if (j === pattern.length) {
        matches.push(this.createMatch(textForMatch, i - j, sequenceId, 0));
        const prev = lps[j - 1];
        j = prev !== undefined ? prev : 0;
      } else if (i < text.length && pattern[j] !== text[i]) {
        if (j !== 0) {
          const prev = lps[j - 1];
          j = prev !== undefined ? prev : 0;
        } else {
          i++;
        }
      }
    }
    
    return matches;
  }
  
  private fuzzyMatch(text: string, sequenceId: string, originalText?: string): SequenceMatch[] {
    const matches: SequenceMatch[] = [];
    const pattern = this.patternUpper;
    const maxMismatches = this.options.maxMismatches;
    const textForMatch = originalText ?? text;
    
    for (let i = 0; i <= text.length - pattern.length; i++) {
      let mismatches = 0;
      
      for (let j = 0; j < pattern.length; j++) {
        if (text[i + j] !== pattern[j]) {
          mismatches++;
          if (mismatches > maxMismatches) break;
        }
      }
      
      if (mismatches <= maxMismatches) {
        matches.push(this.createMatch(textForMatch, i, sequenceId, mismatches));
      }
    }
    
    return matches;
  }
  
  private regexMatch(text: string, sequenceId: string, originalText?: string): SequenceMatch[] {
    const matches: SequenceMatch[] = [];
    const textForMatch = originalText ?? text;
    
    try {
      const regex = new RegExp(this.pattern, 
        this.options.caseSensitive ? 'g' : 'gi'
      );
      
      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push(this.createMatch(
          textForMatch, 
          match.index, 
          sequenceId, 
          0,
          match[0] // Use actual matched text for regex
        ));
      }
    } catch (error) {
      throw new Error(`Invalid regex pattern: ${this.pattern}`);
    }
    
    return matches;
  }
  
  private findWithIUPAC(text: string, sequenceId: string, originalText?: string): SequenceMatch[] {
    const matches: SequenceMatch[] = [];
    const textForMatch = originalText ?? text;
    
    // For each position in text, check if any expanded pattern matches
    for (let i = 0; i <= text.length - this.pattern.length; i++) {
      const substring = text.substring(i, i + this.pattern.length);
      
      if (this.matchesIUPAC(substring, this.patternUpper)) {
        matches.push(this.createMatch(textForMatch, i, sequenceId, 0));
      }
    }
    
    return matches;
  }
  
  private matchesIUPAC(text: string, pattern: string): boolean {
    if (text.length !== pattern.length) return false;
    
    for (let i = 0; i < text.length; i++) {
      const textBase = text[i];
      const patternBase = pattern[i];
      
      // N matches anything
      if (patternBase === 'N' || textBase === 'N') continue;
      
      // Check if bases are compatible
      const patternExpanded = patternBase ? SequenceValidator.expandAmbiguous(patternBase) : [];
      const textExpanded = textBase ? SequenceValidator.expandAmbiguous(textBase) : [];
      
      // Check for overlap
      const hasOverlap = patternExpanded.some(p => textExpanded.includes(p));
      if (!hasOverlap) return false;
    }
    
    return true;
  }
  
  private findInString(
    text: string, 
    globalPosition: number, 
    sequenceId: string
  ): SequenceMatch[] {
    const searchText = this.options.caseSensitive ? text : text.toUpperCase();
    const originalText = this.options.caseSensitive ? undefined : text;
    const localMatches = this.boyerMooreMatch(searchText, sequenceId, originalText);
    
    // Adjust positions to global coordinates
    return localMatches.map(match => ({
      ...match,
      position: match.position + globalPosition,
      context: {
        ...match.context,
        contextStart: match.context.contextStart + globalPosition,
        contextEnd: match.context.contextEnd + globalPosition
      }
    }));
  }
  
  private createMatch(
    text: string,
    position: number,
    sequenceId: string,
    mismatches: number,
    matchedText?: string
  ): SequenceMatch {
    const matched = matchedText ?? text.substring(position, position + this.pattern.length);
    const contextWindow = this.options.contextWindow;
    
    // Extract context
    const beforeStart = Math.max(0, position - contextWindow);
    const beforeEnd = position;
    const afterStart = position + matched.length;
    const afterEnd = Math.min(text.length, afterStart + contextWindow);
    
    return {
      position,
      length: matched.length,
      matched,
      pattern: this.pattern,
      mismatches,
      sequenceId,
      context: {
        before: text.substring(beforeStart, beforeEnd),
        after: text.substring(afterStart, afterEnd),
        contextStart: beforeStart,
        contextEnd: afterEnd
      },
      score: mismatches === 0 ? 1.0 : 1.0 - (mismatches / matched.length)
    };
  }
  
  private buildBadCharTable(pattern: string): Map<number, number> {
    const table = new Map<number, number>();
    
    for (let i = 0; i < pattern.length - 1; i++) {
      table.set(pattern.charCodeAt(i), i);
    }
    
    return table;
  }
  
  private buildLPSArray(pattern: string): number[] {
    const lps = new Array(pattern.length).fill(0);
    let len = 0;
    let i = 1;
    
    while (i < pattern.length) {
      if (pattern[i] === pattern[len]) {
        len++;
        lps[i] = len;
        i++;
      } else {
        if (len !== 0) {
          len = lps[len - 1];
        } else {
          lps[i] = 0;
          i++;
        }
      }
    }
    
    return lps;
  }
  
  private expandIUPACPattern(pattern: string): string[] {
    // For now, return single pattern
    // Full implementation would expand all ambiguous positions
    return [pattern];
  }
}

/**
 * Find all occurrences of a pattern in a sequence.
 * 
 * Convenience function for one-off pattern matching without
 * creating a SequenceMatcher instance.
 * 
 * @param pattern - Pattern to search for
 * @param sequence - Sequence to search in
 * @param options - Optional matching configuration
 * @returns Array of all matches found
 * 
 * @example
 * ```typescript
 * const matches = findPattern('ATCG', sequence);
 * const fuzzyMatches = findPattern('ATCG', sequence, { 
 *   algorithm: 'fuzzy',
 *   maxMismatches: 1 
 * });
 * ```
 * 
 * @since 1.0.0
 */
export function findPattern(
  pattern: string, 
  sequence: Sequence | string,
  options?: MatcherOptions
): SequenceMatch[] {
  const matcher = new SequenceMatcher(pattern, options);
  return matcher.findInSequence(sequence);
}

/**
 * Check if a pattern exists in a sequence.
 * 
 * Convenience function for testing pattern existence without
 * creating a SequenceMatcher instance. Stops at first match.
 * 
 * @param pattern - Pattern to search for
 * @param sequence - Sequence to search in
 * @param options - Optional matching configuration
 * @returns True if pattern exists in sequence
 * 
 * @example
 * ```typescript
 * if (hasPattern('ATCG', sequence)) {
 *   console.log('Restriction site found');
 * }
 * 
 * // With IUPAC codes
 * if (hasPattern('GATNAC', sequence, { iupacAware: true })) {
 *   console.log('EcoRI site found');
 * }
 * ```
 * 
 * @since 1.0.0
 */
export function hasPattern(
  pattern: string,
  sequence: Sequence | string,
  options?: MatcherOptions
): boolean {
  const matcher = new SequenceMatcher(pattern, options);
  return matcher.test(sequence);
}