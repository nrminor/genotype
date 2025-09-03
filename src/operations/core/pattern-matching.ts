/**
 * High-performance pattern matching algorithms for genomic sequences.
 *
 * This module provides both low-level algorithm implementations and high-level
 * streaming pattern matching for genomic data. Supports exact matching, fuzzy
 * matching, IUPAC ambiguity codes, and streaming processing of large sequence files.
 *
 * @module pattern-matching
 * @since v0.1.0
 *
 * @remarks
 * Key features:
 * - Low-level algorithms available as named exports for direct use
 * - High-level SequenceMatcher class for rich features and streaming
 * - Multiple algorithms (Boyer-Moore, KMP, fuzzy, regex, Rabin-Karp)
 * - IUPAC ambiguity code support (N, R, Y, etc.)
 * - Memory-efficient streaming for multi-GB files
 * - Rich match objects with surrounding context
 *
 * Performance considerations:
 * - Boyer-Moore is fastest for long patterns (>10 bp)
 * - KMP excels with repetitive patterns
 * - Rabin-Karp is efficient for multiple pattern search
 * - Fuzzy matching scales O(n*m*k) where k is max mismatches
 * - IUPAC matching has overhead for ambiguous base expansion
 */

import type { AbstractSequence } from "../../types";
import { expandAmbiguous } from "./sequence-validation";
import { reverseComplement } from "./sequence-manipulation";

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Simple match result with position and mismatch information
 * Used by low-level algorithm functions
 */
export interface PatternMatch {
  position: number;
  length: number;
  mismatches: number;
  matched: string;
}

/**
 * Rich match result with full context information.
 * Used by high-level SequenceMatcher class
 *
 * @interface SequenceMatch
 * @since v0.1.0
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
 * @since v0.1.0
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
  algorithm?: "boyer-moore" | "kmp" | "fuzzy" | "regex";

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

// =============================================================================
// LOW-LEVEL ALGORITHM FUNCTIONS (Named Exports)
// =============================================================================

/**
 * Build bad character table for Boyer-Moore algorithm
 * @private
 */
function buildBadCharTable(pattern: string): Map<number, number> {
  const table = new Map<number, number>();

  for (let i = 0; i < pattern.length - 1; i++) {
    table.set(pattern.charCodeAt(i), i);
  }

  return table;
}

/**
 * Boyer-Moore string search for exact matches
 * One of the most efficient string search algorithms
 *
 * @param text - Text to search in
 * @param pattern - Pattern to search for
 * @returns Array of match positions
 *
 * 🔥 NATIVE CRITICAL: Core string search algorithm
 */
export function boyerMoore(text: string, pattern: string): number[] {
  // Tiger Style: Assert inputs
  if (!pattern || pattern.length === 0) return [];
  if (!text || pattern.length > text.length) return [];

  // Build bad character table for skip optimization
  const badChar = buildBadCharTable(pattern);
  const matches: number[] = [];

  let shift = 0;
  while (shift <= text.length - pattern.length) {
    let j = pattern.length - 1;

    // Match from right to left
    while (j >= 0 && pattern[j] === text[shift + j]) {
      j--;
    }

    if (j < 0) {
      // Pattern found at position shift
      matches.push(shift);

      // Calculate next shift
      if (shift + pattern.length < text.length) {
        const nextChar = text.charCodeAt(shift + pattern.length);
        const skip = badChar.get(nextChar) ?? -1;
        shift += pattern.length - skip;
      } else {
        shift += 1;
      }
    } else {
      // Mismatch found, calculate shift
      const mismatchChar = text.charCodeAt(shift + j);
      const skip = badChar.get(mismatchChar) ?? -1;
      shift += Math.max(1, j - skip);
    }
  }

  return matches;
}

/**
 * Fuzzy matching allowing mismatches
 * Uses naive approach with mismatch counting
 *
 * @param text - Text to search in
 * @param pattern - Pattern to search for
 * @param maxMismatches - Maximum allowed mismatches
 * @returns Array of pattern matches with mismatch information
 *
 * 🔥 NATIVE CRITICAL: Approximate string matching
 */
export function fuzzyMatch(text: string, pattern: string, maxMismatches: number): PatternMatch[] {
  // Tiger Style: Assert inputs
  if (!pattern || pattern.length === 0) return [];
  if (!text || pattern.length > text.length) return [];
  if (maxMismatches < 0) {
    throw new Error("Max mismatches must be non-negative");
  }

  const matches: PatternMatch[] = [];

  for (let i = 0; i <= text.length - pattern.length; i++) {
    let mismatches = 0;
    let j = 0;

    // Count mismatches at current position
    for (j = 0; j < pattern.length; j++) {
      if (text[i + j] !== pattern[j]) {
        mismatches++;
        if (mismatches > maxMismatches) break;
      }
    }

    // Record match if within mismatch threshold
    if (mismatches <= maxMismatches) {
      matches.push({
        position: i,
        length: pattern.length,
        mismatches,
        matched: text.substring(i, i + pattern.length),
      });
    }
  }

  return matches;
}

/**
 * Check if two bases are compatible considering IUPAC ambiguity codes
 * @private
 */
function areBasesCompatible(base1: string, base2: string): boolean {
  // Exact match
  if (base1 === base2) return true;

  // Expand ambiguous bases and check for overlap
  const expanded1 = expandAmbiguous(base1);
  const expanded2 = expandAmbiguous(base2);

  // Check if there's any overlap in possible bases
  return expanded1.some((b1) => expanded2.includes(b1));
}

/**
 * Match with IUPAC ambiguity codes
 * Handles degenerate bases in both pattern and text
 *
 * @param sequence - Sequence to search in
 * @param pattern - Pattern with potential ambiguity codes
 * @returns Array of match positions
 *
 * 🔥 NATIVE OPTIMIZATION: Degenerate base matching
 */
export function matchWithAmbiguous(sequence: string, pattern: string): number[] {
  // Tiger Style: Assert inputs
  if (!pattern || pattern.length === 0) return [];
  if (!sequence || pattern.length > sequence.length) return [];

  const matches: number[] = [];
  const patternUpper = pattern.toUpperCase();
  const sequenceUpper = sequence.toUpperCase();

  for (let i = 0; i <= sequenceUpper.length - patternUpper.length; i++) {
    let isMatch = true;

    for (let j = 0; j < patternUpper.length; j++) {
      const seqBase = sequenceUpper[i + j];
      const patBase = patternUpper[j];

      // N matches anything
      if (patBase === "N" || seqBase === "N") {
        continue;
      }

      // Check if bases are compatible considering ambiguity
      if (seqBase !== undefined && patBase !== undefined && !areBasesCompatible(seqBase, patBase)) {
        isMatch = false;
        break;
      }
    }

    if (isMatch) {
      matches.push(i);
    }
  }

  return matches;
}

/**
 * Build Longest Proper Prefix array for KMP algorithm
 * @private
 */
function buildLPSArray(pattern: string): number[] {
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

/**
 * Knuth-Morris-Pratt (KMP) algorithm for pattern matching
 * Efficient for patterns with repetitive subpatterns
 *
 * @param text - Text to search in
 * @param pattern - Pattern to search for
 * @returns Array of match positions
 *
 * ⚡ NATIVE BENEFICIAL: Alternative to Boyer-Moore for specific patterns
 */
export function kmpSearch(text: string, pattern: string): number[] {
  // Tiger Style: Assert inputs
  if (!pattern || pattern.length === 0) return [];
  if (!text || pattern.length > text.length) return [];

  // Build failure function (partial match table)
  const lps = buildLPSArray(pattern);
  const matches: number[] = [];

  let i = 0; // Index for text
  let j = 0; // Index for pattern

  while (i < text.length) {
    if (pattern[j] === text[i]) {
      i++;
      j++;
    }

    if (j === pattern.length) {
      // Pattern found
      matches.push(i - j);
      const prev = lps[j - 1];
      j = prev !== undefined ? prev : 0;
    } else if (i < text.length && pattern[j] !== text[i]) {
      // Mismatch after j matches
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

/**
 * Rabin-Karp rolling hash algorithm
 * Efficient for multiple pattern search
 *
 * @param text - Text to search in
 * @param pattern - Pattern to search for
 * @param prime - Prime number for hash computation (default: 101)
 * @returns Array of match positions
 *
 * ⚡ NATIVE BENEFICIAL: Good for searching multiple patterns
 */
export function rabinKarp(text: string, pattern: string, prime: number = 101): number[] {
  // Tiger Style: Assert inputs
  if (!pattern || pattern.length === 0) return [];
  if (!text || pattern.length > text.length) return [];

  const matches: number[] = [];
  const patternLength = pattern.length;
  const textLength = text.length;

  // Calculate hash value for pattern and first window
  let patternHash = 0;
  let textHash = 0;
  let h = 1;

  // Calculate h = pow(256, patternLength - 1) % prime
  for (let i = 0; i < patternLength - 1; i++) {
    h = (h * 256) % prime;
  }

  // Calculate initial hash values
  for (let i = 0; i < patternLength; i++) {
    patternHash = (256 * patternHash + pattern.charCodeAt(i)) % prime;
    textHash = (256 * textHash + text.charCodeAt(i)) % prime;
  }

  // Slide pattern over text
  for (let i = 0; i <= textLength - patternLength; i++) {
    // Check if hash values match
    if (patternHash === textHash) {
      // Verify character by character
      let match = true;
      for (let j = 0; j < patternLength; j++) {
        if (text[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        matches.push(i);
      }
    }

    // Calculate hash for next window
    if (i < textLength - patternLength) {
      textHash =
        (256 * (textHash - text.charCodeAt(i) * h) + text.charCodeAt(i + patternLength)) % prime;

      // Handle negative hash value
      if (textHash < 0) {
        textHash += prime;
      }
    }
  }

  return matches;
}

/**
 * Find all overlapping matches of a pattern
 * Useful for finding tandem repeats
 *
 * @param text - Text to search in
 * @param pattern - Pattern to search for
 * @returns Array of match positions (including overlaps)
 */
export function findOverlapping(text: string, pattern: string): number[] {
  // Tiger Style: Assert inputs
  if (!pattern || pattern.length === 0) return [];
  if (!text || pattern.length > text.length) return [];

  const matches: number[] = [];
  let pos = 0;

  while (pos <= text.length - pattern.length) {
    if (text.substring(pos, pos + pattern.length) === pattern) {
      matches.push(pos);
      pos++; // Move by 1 to find overlapping matches
    } else {
      pos++;
    }
  }

  return matches;
}

/**
 * Find longest common substring between two sequences
 * Uses dynamic programming approach
 *
 * @param seq1 - First sequence
 * @param seq2 - Second sequence
 * @returns Object with substring details
 *
 * ⚡ NATIVE BENEFICIAL: Matrix operations could be optimized
 */
export function longestCommonSubstring(
  seq1: string,
  seq2: string
): {
  substring: string;
  position1: number;
  position2: number;
  length: number;
} {
  // Tiger Style: Assert inputs
  if (!seq1 || !seq2) {
    return { substring: "", position1: -1, position2: -1, length: 0 };
  }

  const m = seq1.length;
  const n = seq2.length;
  let maxLength = 0;
  let endPos1 = 0;

  // Create DP table
  const dp: number[][] = new Array(m + 1)
    .fill(null)
    .map(() => new Array(n + 1).fill(0));

  // Fill DP table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (seq1[i - 1] === seq2[j - 1]) {
        const prevRow = dp[i - 1];
        const prevValue = prevRow ? (prevRow[j - 1] ?? 0) : 0;
        const currentRow = dp[i];
        if (currentRow) {
          currentRow[j] = prevValue + 1;
          const currentValue = currentRow[j];
          if (currentValue !== undefined && currentValue > maxLength) {
            maxLength = currentValue;
            endPos1 = i;
          }
        }
      }
    }
  }

  // Extract the longest common substring
  const substring = seq1.substring(endPos1 - maxLength, endPos1);

  return {
    substring,
    position1: endPos1 - maxLength,
    position2: seq2.indexOf(substring),
    length: maxLength,
  };
}

/**
 * Check if a sequence is a palindrome
 * @private
 */
function isPalindrome(sequence: string): boolean {
  const len = sequence.length;
  for (let i = 0; i < len / 2; i++) {
    if (sequence[i] !== sequence[len - 1 - i]) {
      return false;
    }
  }
  return true;
}

/**
 * Find palindromic sequences
 * Important for finding restriction sites and structural features
 *
 * @param sequence - Sequence to search in
 * @param minLength - Minimum palindrome length (default: 4)
 * @param maxLength - Maximum palindrome length (optional)
 * @returns Array of palindrome matches
 */
export function findPalindromes(
  sequence: string,
  minLength: number = 4,
  maxLength?: number
): PatternMatch[] {
  // Tiger Style: Assert inputs
  if (!sequence || sequence.length < minLength) return [];

  const palindromes: PatternMatch[] = [];
  const maxLen = maxLength ?? sequence.length;

  // Check all possible substrings
  for (let length = minLength; length <= Math.min(maxLen, sequence.length); length++) {
    for (let i = 0; i <= sequence.length - length; i++) {
      const substring = sequence.substring(i, i + length);

      if (isPalindrome(substring)) {
        palindromes.push({
          position: i,
          length,
          mismatches: 0,
          matched: substring,
        });
      }
    }
  }

  return palindromes;
}

/**
 * Find tandem repeats in a sequence
 * Important for microsatellite detection
 *
 * @param sequence - Sequence to search in
 * @param minRepeatUnit - Minimum repeat unit size (default: 1)
 * @param maxRepeatUnit - Maximum repeat unit size (default: 6)
 * @param minRepeats - Minimum number of repeats (default: 2)
 * @returns Array of tandem repeat objects
 */
export function findTandemRepeats(
  sequence: string,
  minRepeatUnit: number = 1,
  maxRepeatUnit: number = 6,
  minRepeats: number = 2
): Array<{
  position: number;
  unit: string;
  repeats: number;
  totalLength: number;
}> {
  // Tiger Style: Assert inputs
  if (!sequence || sequence.length < minRepeatUnit * minRepeats) return [];

  const repeats: Array<{
    position: number;
    unit: string;
    repeats: number;
    totalLength: number;
  }> = [];

  // Try different repeat unit sizes
  for (let unitSize = minRepeatUnit; unitSize <= maxRepeatUnit; unitSize++) {
    for (let i = 0; i <= sequence.length - unitSize * minRepeats; i++) {
      const unit = sequence.substring(i, i + unitSize);
      let repeatCount = 1;
      let j = i + unitSize;

      // Count consecutive repeats
      while (j + unitSize <= sequence.length) {
        const nextUnit = sequence.substring(j, j + unitSize);
        if (nextUnit === unit) {
          repeatCount++;
          j += unitSize;
        } else {
          break;
        }
      }

      // Record if meets minimum repeat threshold
      if (repeatCount >= minRepeats) {
        repeats.push({
          position: i,
          unit,
          repeats: repeatCount,
          totalLength: unitSize * repeatCount,
        });

        // Skip past this repeat region
        i = j - 1;
      }
    }
  }

  return repeats;
}

// =============================================================================
// HIGH-LEVEL SEQUENCE MATCHER CLASS
// =============================================================================

/**
 * High-performance pattern matcher for genomic sequences.
 *
 * Provides streaming-first pattern matching with support for multiple algorithms,
 * IUPAC ambiguity codes, and fuzzy matching. Designed for both small scripts
 * and production bioinformatics pipelines.
 *
 * @class SequenceMatcher
 * @since v0.1.0
 *
 * @example
 * ```typescript
 * // Simple exact matching
 * const matcher = new SequenceMatcher('ATCG');
 * for await (const match of matcher.findAll(sequences)) {
 *   console.log(`Found ${match.pattern} at position ${match.position}`);
 * }
 *
 * // Fuzzy matching allowing 2 mismatches
 * const fuzzy = new SequenceMatcher('ATCGATCG', {
 *   algorithm: 'fuzzy',
 *   maxMismatches: 2
 * });
 * ```
 */
export class SequenceMatcher {
  private readonly pattern: string;
  private readonly options: Required<MatcherOptions>;
  private readonly patternUpper: string;
  private readonly badCharTable?: Map<number, number>;
  private readonly expandedPatterns?: string[];

  constructor(pattern: string, options: MatcherOptions = {}) {
    if (!pattern || pattern.length === 0) {
      throw new Error("Pattern cannot be empty");
    }

    this.pattern = pattern;
    this.options = {
      algorithm: options.algorithm ?? "boyer-moore",
      maxMismatches: options.maxMismatches ?? 0,
      iupacAware: options.iupacAware ?? false,
      caseSensitive: options.caseSensitive ?? true,
      contextWindow: options.contextWindow ?? 50,
      bufferSize: options.bufferSize ?? 1_000_000, // 1MB default buffer
    };

    this.patternUpper = this.options.caseSensitive ? pattern : pattern.toUpperCase();

    // Pre-build Boyer-Moore table if using that algorithm
    if (this.options.algorithm === "boyer-moore") {
      this.badCharTable = buildBadCharTable(this.patternUpper);
    }

    // Pre-expand IUPAC patterns if needed
    if (this.options.iupacAware && /[RYSWKMBDHVN]/i.test(pattern)) {
      this.expandedPatterns = this.expandIUPACPattern(pattern);
    }
  }

  /**
   * Find all matches in a stream of sequences.
   *
   * @param sequences - Async iterable of sequences to search
   * @yields {SequenceMatch} Match objects as they are found
   */
  async *findAll(sequences: AsyncIterable<AbstractSequence>): AsyncGenerator<SequenceMatch> {
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
   * @param sequence - Sequence object or raw sequence string to search
   * @returns Array of all matches found in the sequence
   */
  findInSequence(sequence: AbstractSequence | string): SequenceMatch[] {
    const isSequenceObject = typeof sequence === "object";
    const seq = isSequenceObject ? sequence.sequence : sequence;
    const seqId = isSequenceObject ? sequence.id : "unknown";

    const text = this.options.caseSensitive ? seq : seq.toUpperCase();
    const originalText = this.options.caseSensitive ? undefined : seq;

    // Handle IUPAC ambiguity codes
    if (this.options.iupacAware && this.expandedPatterns) {
      return this.findWithIUPAC(text, seqId, originalText);
    }

    // Choose algorithm
    switch (this.options.algorithm) {
      case "fuzzy":
        return this.fuzzyMatchInternal(text, seqId, originalText);
      case "kmp":
        return this.kmpMatchInternal(text, seqId, originalText);
      case "regex":
        return this.regexMatch(text, seqId, originalText);
      default:
        // Default to boyer-moore for best performance
        return this.boyerMooreMatchInternal(text, seqId, originalText);
    }
  }

  /**
   * Find only the first match in a sequence.
   *
   * @param sequence - Sequence to search
   * @returns First match found, or null if no matches
   */
  findFirst(sequence: AbstractSequence | string): SequenceMatch | null {
    const matches = this.findInSequence(sequence);
    if (matches.length > 0) {
      const firstMatch = matches[0];
      // TypeScript should infer this is defined, but we'll be explicit
      return firstMatch !== undefined ? firstMatch : null;
    }
    return null;
  }

  /**
   * Test if pattern exists in sequence.
   *
   * @param sequence - Sequence to test
   * @returns True if pattern exists in sequence
   */
  test(sequence: AbstractSequence | string): boolean {
    return this.findFirst(sequence) !== null;
  }

  /**
   * Count pattern occurrences without creating match objects.
   *
   * @param sequence - Sequence to count matches in
   * @returns Number of pattern occurrences
   */
  count(sequence: AbstractSequence | string): number {
    const text = typeof sequence === "object" ? sequence.sequence : sequence;
    const searchText = this.options.caseSensitive ? text : text.toUpperCase();

    // Fast counting without building match objects
    const positions = this.getBoyerMoorePositions(searchText);
    return positions.length;
  }

  /**
   * Stream matches from chunked sequence data.
   *
   * @param sequenceStream - Async iterable yielding sequence chunks
   * @yields {SequenceMatch} Matches with globally adjusted positions
   */
  async *streamMatches(sequenceStream: AsyncIterable<string>): AsyncGenerator<SequenceMatch> {
    let buffer = "";
    let position = 0;

    for await (const chunk of sequenceStream) {
      buffer += chunk;

      // Keep buffer size manageable
      while (buffer.length > this.options.bufferSize) {
        const searchLength = this.options.bufferSize - this.pattern.length;
        const searchBuffer = buffer.substring(0, searchLength);

        // Find matches in this portion
        const matches = this.findInString(searchBuffer, position, "stream");
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
      const matches = this.findInString(buffer, position, "stream");
      for (const match of matches) {
        yield match;
      }
    }
  }

  // Private implementation methods

  private boyerMooreMatchInternal(
    text: string,
    sequenceId: string,
    originalText?: string
  ): SequenceMatch[] {
    const positions = this.getBoyerMoorePositions(text);
    const textForMatch = originalText ?? text;
    return positions.map((pos) => this.createMatch(textForMatch, pos, sequenceId, 0));
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
        shift += 1; // For overlapping matches
      } else {
        const mismatchChar = text.charCodeAt(shift + j);
        const skip = this.badCharTable.get(mismatchChar) ?? -1;
        shift += Math.max(1, j - skip);
      }
    }

    return matches;
  }

  private kmpMatchInternal(
    text: string,
    sequenceId: string,
    originalText?: string
  ): SequenceMatch[] {
    const matches: SequenceMatch[] = [];
    const pattern = this.patternUpper;
    const lps = buildLPSArray(pattern);
    const textForMatch = originalText ?? text;

    let i = 0;
    let j = 0;

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

  private fuzzyMatchInternal(
    text: string,
    sequenceId: string,
    originalText?: string
  ): SequenceMatch[] {
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
      const regex = new RegExp(this.pattern, this.options.caseSensitive ? "g" : "gi");

      let match: RegExpExecArray | null = regex.exec(text);
      while (match !== null) {
        matches.push(this.createMatch(textForMatch, match.index, sequenceId, 0, match[0]));
        match = regex.exec(text);
      }
    } catch (error) {
      throw new Error(`Invalid regex pattern '${this.pattern}': ${error}"`);
    }

    return matches;
  }

  private findWithIUPAC(text: string, sequenceId: string, originalText?: string): SequenceMatch[] {
    const matches: SequenceMatch[] = [];
    const textForMatch = originalText ?? text;

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
      if (patternBase === "N" || textBase === "N") continue;

      // Check if bases are compatible
      const patternExpanded =
        patternBase !== undefined && patternBase !== null && patternBase !== ""
          ? expandAmbiguous(patternBase)
          : [];
      const textExpanded =
        textBase !== undefined && textBase !== null && textBase !== ""
          ? expandAmbiguous(textBase)
          : [];

      // Check for overlap
      const hasOverlap = patternExpanded.some((p) => textExpanded.includes(p));
      if (!hasOverlap) return false;
    }

    return true;
  }

  private findInString(text: string, globalPosition: number, sequenceId: string): SequenceMatch[] {
    const searchText = this.options.caseSensitive ? text : text.toUpperCase();
    const originalText = this.options.caseSensitive ? undefined : text;
    const localMatches = this.boyerMooreMatchInternal(searchText, sequenceId, originalText);

    // Adjust positions to global coordinates
    return localMatches.map((match) => ({
      ...match,
      position: match.position + globalPosition,
      context: {
        ...match.context,
        contextStart: match.context.contextStart + globalPosition,
        contextEnd: match.context.contextEnd + globalPosition,
      },
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
        contextEnd: afterEnd,
      },
      score: mismatches === 0 ? 1.0 : 1.0 - mismatches / matched.length,
    };
  }

  private expandIUPACPattern(pattern: string): string[] {
    // For now, return single pattern
    // Full implementation would expand all ambiguous positions
    return [pattern];
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Find all occurrences of a pattern in a sequence.
 *
 * @param pattern - Pattern to search for
 * @param sequence - Sequence to search in
 * @param options - Optional matching configuration
 * @returns Array of all matches found
 *
 * @since v0.1.0
 */
export function findPattern(
  pattern: string,
  sequence: AbstractSequence | string,
  options?: MatcherOptions
): SequenceMatch[] {
  const matcher = new SequenceMatcher(pattern, options);
  return matcher.findInSequence(sequence);
}

/**
 * Check if a pattern exists in a sequence.
 *
 * @param pattern - Pattern to search for
 * @param sequence - Sequence to search in
 * @param options - Optional matching configuration
 * @returns True if pattern exists in sequence
 *
 * @since v0.1.0
 */
export function hasPattern(
  pattern: string,
  sequence: AbstractSequence | string,
  options?: MatcherOptions
): boolean {
  const matcher = new SequenceMatcher(pattern, options);
  return matcher.test(sequence);
}

/**
 * Check if pattern matches with up to maxMismatches, including reverse complement
 *
 * Optimized for grep-style boolean matching (no position information needed)
 *
 * @param sequence - Text to search in
 * @param pattern - Pattern to search for
 * @param maxMismatches - Maximum allowed mismatches
 * @param searchBothStrands - Whether to check reverse complement
 * @returns True if pattern matches within mismatch threshold
 */
export function hasPatternWithMismatches(
  sequence: string,
  pattern: string,
  maxMismatches: number,
  searchBothStrands: boolean = false
): boolean {
  // Check forward strand
  const forwardMatches = fuzzyMatch(sequence, pattern, maxMismatches);
  if (forwardMatches.length > 0) {
    return true;
  }

  // Check reverse complement if requested
  if (searchBothStrands) {
    const patternRC = reverseComplement(pattern);
    const reverseMatches = fuzzyMatch(sequence, patternRC, maxMismatches);
    if (reverseMatches.length > 0) {
      return true;
    }
  }

  return false;
}

// =============================================================================
// ADDITIONAL PATTERN UTILITIES (moved from transforms.ts)
// =============================================================================

/**
 * Check if a sequence is palindromic (equals its reverse complement)
 *
 * @example
 * ```typescript
 * const isPalin = isPalindromic('GAATTC');
 * console.log(isPalin); // true (EcoRI site is palindromic)
 *
 * const notPalin = isPalindromic('ATCG');
 * console.log(notPalin); // false
 * ```
 *
 * @param sequence - DNA sequence to check
 * @returns True if sequence equals its reverse complement
 *
 * 🔥 NATIVE: Vectorized comparison could speed up palindrome checking
 */
export function isPalindromic(sequence: string): boolean {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }

  const revComp = reverseComplement(sequence);
  return sequence.toUpperCase() === revComp.toUpperCase();
}

/**
 * Simple pattern finding with overlapping matches
 *
 * This is a simpler version than the full SequenceMatcher,
 * useful for basic pattern finding needs.
 *
 * @example
 * ```typescript
 * const positions = findSimplePattern('ATATA', 'ATA');
 * console.log(positions); // [0, 2] (overlapping matches)
 * ```
 *
 * @param sequence - Sequence to search in
 * @param pattern - Pattern to find
 * @returns Array of zero-based positions where pattern occurs
 */
export function findSimplePattern(sequence: string, pattern: string): number[] {
  // Tiger Style: Assert inputs
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }
  if (!pattern || typeof pattern !== "string") {
    throw new Error("Pattern must be a non-empty string");
  }

  const positions: number[] = [];
  const upperSeq = sequence.toUpperCase();
  const upperPat = pattern.toUpperCase();

  let index = upperSeq.indexOf(upperPat);
  while (index !== -1) {
    positions.push(index);
    // Look for overlapping matches
    index = upperSeq.indexOf(upperPat, index + 1);
  }

  return positions;
}

// =============================================================================
// LEGACY COMPATIBILITY EXPORT
// =============================================================================

/**
 * @deprecated Use individual function exports instead
 * Grouped object for backwards compatibility
 */
export const PatternMatcher = {
  boyerMoore,
  fuzzyMatch,
  matchWithAmbiguous,
  kmpSearch,
  rabinKarp,
  findOverlapping,
  longestCommonSubstring,
  findPalindromes,
  findTandemRepeats,
  isPalindromic,
  findSimplePattern,
} as const;
