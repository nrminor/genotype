/**
 * High-performance pattern matching algorithms for genomic sequences
 * 
 * Critical for grep, locate, and amplicon operations
 * Includes exact and fuzzy matching with support for IUPAC ambiguity codes
 */

import { SequenceValidator } from './validation';

/**
 * Match result with position and mismatch information
 */
export interface PatternMatch {
  position: number;
  length: number;
  mismatches: number;
  matched: string;
}

/**
 * High-performance pattern matching algorithms
 * Critical for grep, locate, and amplicon operations
 */
export class PatternMatcher {
  /**
   * Boyer-Moore string search for exact matches
   * One of the most efficient string search algorithms
   * 
   * 🔥 ZIG CRITICAL: Core string search algorithm
   */
  static boyerMoore(text: string, pattern: string): number[] {
    // Tiger Style: Assert inputs
    if (!pattern || pattern.length === 0) return [];
    if (!text || pattern.length > text.length) return [];
    
    // Build bad character table for skip optimization
    const badChar = this.buildBadCharTable(pattern);
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
   * Build bad character table for Boyer-Moore algorithm
   */
  private static buildBadCharTable(pattern: string): Map<number, number> {
    const table = new Map<number, number>();
    
    for (let i = 0; i < pattern.length - 1; i++) {
      table.set(pattern.charCodeAt(i), i);
    }
    
    return table;
  }
  
  /**
   * Fuzzy matching allowing mismatches
   * Uses naive approach with mismatch counting
   * 
   * 🔥 ZIG CRITICAL: Approximate string matching
   */
  static fuzzyMatch(
    text: string, 
    pattern: string, 
    maxMismatches: number
  ): PatternMatch[] {
    // Tiger Style: Assert inputs
    if (!pattern || pattern.length === 0) return [];
    if (!text || pattern.length > text.length) return [];
    if (maxMismatches < 0) {
      throw new Error('Max mismatches must be non-negative');
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
          matched: text.substring(i, i + pattern.length)
        });
      }
    }
    
    return matches;
  }
  
  /**
   * Match with IUPAC ambiguity codes
   * Handles degenerate bases in both pattern and text
   * 
   * 🔥 ZIG OPTIMIZATION: Degenerate base matching
   */
  static matchWithAmbiguous(
    sequence: string,
    pattern: string
  ): number[] {
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
        if (patBase === 'N' || seqBase === 'N') {
          continue;
        }
        
        // Check if bases are compatible considering ambiguity
        if (seqBase !== undefined && patBase !== undefined && !this.areBasesCompatible(seqBase, patBase)) {
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
   * Check if two bases are compatible considering IUPAC ambiguity codes
   */
  private static areBasesCompatible(base1: string, base2: string): boolean {
    // Exact match
    if (base1 === base2) return true;
    
    // Expand ambiguous bases and check for overlap
    const expanded1 = SequenceValidator.expandAmbiguous(base1);
    const expanded2 = SequenceValidator.expandAmbiguous(base2);
    
    // Check if there's any overlap in possible bases
    return expanded1.some(b1 => expanded2.includes(b1));
  }
  
  /**
   * Knuth-Morris-Pratt (KMP) algorithm for pattern matching
   * Efficient for patterns with repetitive subpatterns
   * 
   * ⚡ ZIG BENEFICIAL: Alternative to Boyer-Moore for specific patterns
   */
  static kmpSearch(text: string, pattern: string): number[] {
    // Tiger Style: Assert inputs
    if (!pattern || pattern.length === 0) return [];
    if (!text || pattern.length > text.length) return [];
    
    // Build failure function (partial match table)
    const lps = this.buildLPSArray(pattern);
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
   * Build Longest Proper Prefix array for KMP algorithm
   */
  private static buildLPSArray(pattern: string): number[] {
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
   * Rabin-Karp rolling hash algorithm
   * Efficient for multiple pattern search
   * 
   * ⚡ ZIG BENEFICIAL: Good for searching multiple patterns
   */
  static rabinKarp(
    text: string, 
    pattern: string, 
    prime: number = 101
  ): number[] {
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
        textHash = (256 * (textHash - text.charCodeAt(i) * h) + 
                   text.charCodeAt(i + patternLength)) % prime;
        
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
   */
  static findOverlapping(text: string, pattern: string): number[] {
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
   * ⚡ ZIG BENEFICIAL: Matrix operations could be optimized
   */
  static longestCommonSubstring(seq1: string, seq2: string): {
    substring: string;
    position1: number;
    position2: number;
    length: number;
  } {
    // Tiger Style: Assert inputs
    if (!seq1 || !seq2) {
      return { substring: '', position1: -1, position2: -1, length: 0 };
    }
    
    const m = seq1.length;
    const n = seq2.length;
    let maxLength = 0;
    let endPos1 = 0;
    
    // Create DP table
    const dp: number[][] = Array(m + 1).fill(null).map(() => 
      Array(n + 1).fill(0)
    );
    
    // Fill DP table
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (seq1[i - 1] === seq2[j - 1]) {
          const prevRow = dp[i - 1];
          const prevValue = prevRow ? prevRow[j - 1] ?? 0 : 0;
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
      length: maxLength
    };
  }
  
  /**
   * Find palindromic sequences
   * Important for finding restriction sites and structural features
   */
  static findPalindromes(
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
        
        if (this.isPalindrome(substring)) {
          palindromes.push({
            position: i,
            length,
            mismatches: 0,
            matched: substring
          });
        }
      }
    }
    
    return palindromes;
  }
  
  /**
   * Check if a sequence is a palindrome
   */
  private static isPalindrome(sequence: string): boolean {
    const len = sequence.length;
    for (let i = 0; i < len / 2; i++) {
      if (sequence[i] !== sequence[len - 1 - i]) {
        return false;
      }
    }
    return true;
  }
  
  /**
   * Find tandem repeats in a sequence
   * Important for microsatellite detection
   */
  static findTandemRepeats(
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
            totalLength: unitSize * repeatCount
          });
          
          // Skip past this repeat region
          i = j - 1;
        }
      }
    }
    
    return repeats;
  }
}