/**
 * Sequence composition and content calculations
 *
 * Provides functions for calculating GC content, AT content,
 * base composition, and simple translation operations.
 *
 * @module calculations
 * @since v0.1.0
 */

import * as QualityUtils from "./encoding";
import { getGeneticCode } from "./genetic-codes";

// =============================================================================
// EXPORTED FUNCTIONS
// =============================================================================

/**
 * Calculate GC content percentage of a sequence
 *
 * @example
 * ```typescript
 * const gc = gcContent('ATCG');
 * console.log(gc); // 50
 *
 * const gcRNA = gcContent('AUCG');
 * console.log(gcRNA); // 50
 * ```
 *
 * @param sequence - DNA or RNA sequence
 * @returns GC content as percentage (0-100)
 *
 * 🔥 NATIVE: Base counting could use SIMD population count
 */
export function gcContent(sequence: string): number {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }

  const upper = sequence.toUpperCase();
  let gcCount = 0;
  let totalBases = 0;

  // 🔥 NATIVE: SIMD character counting
  for (let i = 0; i < upper.length; i++) {
    const base = upper[i];
    if (base === "G" || base === "C" || base === "S") {
      // S = Strong (G or C)
      gcCount++;
      totalBases++;
    } else if (base === "A" || base === "T" || base === "U" || base === "W") {
      // W = Weak (A or T)
      totalBases++;
    } else if (base === "R" || base === "Y" || base === "K" || base === "M") {
      // Ambiguous with partial GC
      gcCount += 0.5;
      totalBases++;
    } else if (base === "N" || base === "B" || base === "D" || base === "H" || base === "V") {
      // Ambiguous bases - assume average
      gcCount += 0.5;
      totalBases++;
    }
    // Skip gaps and other characters
  }

  return totalBases === 0 ? 0 : (gcCount / totalBases) * 100;
}

/**
 * Calculate AT content percentage of a sequence
 *
 * @example
 * ```typescript
 * const at = atContent('ATCG');
 * console.log(at); // 50
 *
 * const atRNA = atContent('AUCG');
 * console.log(atRNA); // 50
 * ```
 *
 * @param sequence - DNA or RNA sequence
 * @returns AT content as percentage (0-100)
 *
 * 🔥 NATIVE: Base counting could use SIMD population count
 */
export function atContent(sequence: string): number {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }

  const upper = sequence.toUpperCase();
  let atCount = 0;
  let totalBases = 0;

  // 🔥 NATIVE: SIMD character counting
  for (let i = 0; i < upper.length; i++) {
    const base = upper[i];
    if (base === "A" || base === "T" || base === "U" || base === "W") {
      // W = Weak (A or T)
      atCount++;
      totalBases++;
    } else if (base === "G" || base === "C" || base === "S") {
      // S = Strong (G or C)
      totalBases++;
    } else if (base === "R" || base === "Y" || base === "K" || base === "M") {
      // Ambiguous with partial AT
      atCount += 0.5;
      totalBases++;
    } else if (base === "N" || base === "B" || base === "D" || base === "H" || base === "V") {
      // Ambiguous bases - assume average
      atCount += 0.5;
      totalBases++;
    }
    // Skip gaps and other characters
  }

  return totalBases === 0 ? 0 : (atCount / totalBases) * 100;
}

/**
 * Calculate base composition of a sequence
 *
 * @example
 * ```typescript
 * const comp = baseComposition('ATCG');
 * console.log(comp); // { A: 1, T: 1, C: 1, G: 1 }
 *
 * const compRNA = baseComposition('AUCG');
 * console.log(compRNA); // { A: 1, U: 1, C: 1, G: 1 }
 * ```
 *
 * @param sequence - DNA or RNA sequence
 * @returns Object with base counts
 *
 * 🔥 NATIVE: Character histogram - perfect for SIMD
 */
export function baseComposition(sequence: string): Record<string, number> {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }

  const composition: Record<string, number> = {};

  // 🔥 NATIVE: SIMD histogram calculation
  for (let i = 0; i < sequence.length; i++) {
    const base = sequence[i]?.toUpperCase();
    if (base !== undefined && base !== null && base !== "" && /[A-Z\-.*]/.test(base)) {
      composition[base] =
        (composition[base] !== undefined &&
        composition[base] !== null &&
        !Number.isNaN(composition[base])
          ? composition[base]
          : 0) + 1;
    }
  }

  return composition;
}

/**
 * Simple 3-frame translation (all reading frames)
 *
 * @example
 * ```typescript
 * const proteins = translateSimple('ATGATCTAG');
 * console.log(proteins);
 * // Returns translations for all 3 forward frames
 * ```
 *
 * @param sequence - DNA sequence to translate
 * @param geneticCodeId - Genetic code ID to use (default: 1 for standard)
 * @returns Array of protein sequences for each reading frame
 *
 * 🔥 NATIVE: Codon lookup could be optimized with perfect hashing
 */
export function translateSimple(sequence: string, geneticCodeId: number = 1): string[] {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }

  const geneticCode = getGeneticCode(geneticCodeId);
  if (!geneticCode) {
    throw new Error(`Unknown genetic code: ${geneticCodeId}`);
  }

  const table = geneticCode.codons;
  const upper = sequence.toUpperCase().replace(/U/g, "T"); // Convert RNA to DNA
  const results: string[] = [];

  // Translate all 3 reading frames
  for (let frame = 0; frame < 3; frame++) {
    let protein = "";

    // 🔥 NATIVE: Vectorized codon extraction and lookup
    for (let i = frame; i + 2 < upper.length; i += 3) {
      const codon = upper.substring(i, i + 3);

      // Skip incomplete or ambiguous codons
      if (codon.length === 3 && /^[ACGT]{3}$/.test(codon)) {
        const aa = table[codon] !== undefined ? table[codon] : "X";
        protein += aa;

        // Stop at stop codon
        if (aa === "*") break;
      }
    }

    results.push(protein);
  }

  return results;
}

/**
 * Find quality trim position from start of sequence using sliding window
 *
 * @example
 * ```typescript
 * const trimPos = findQualityTrimStart('!!!IIIIII', 20, 4, 'phred33');
 * console.log(trimPos); // 3 (where quality becomes acceptable)
 * ```
 *
 * @param quality - Quality string
 * @param threshold - Quality threshold
 * @param windowSize - Sliding window size
 * @param encoding - Quality encoding
 * @returns Start position for trimming
 *
 * 🔥 NATIVE: Sliding window quality analysis - vectorizable
 */
export function findQualityTrimStart(
  quality: string,
  threshold: number,
  windowSize: number,
  encoding: "phred33" | "phred64" | "solexa",
): number {
  // Tiger Style: Assert inputs
  if (!quality || typeof quality !== "string") {
    throw new Error("Quality string must be non-empty");
  }
  if (windowSize <= 0) {
    throw new Error("Window size must be positive");
  }

  // 🔥 NATIVE: Sliding window analysis with quality score conversion
  for (let i = 0; i <= quality.length - windowSize; i++) {
    const window = quality.slice(i, i + windowSize);
    const avgQual = QualityUtils.averageQuality(window, encoding);

    if (avgQual >= threshold) {
      return i;
    }
  }

  return quality.length; // No good quality found
}

/**
 * Find quality trim position from end of sequence using sliding window
 *
 * @example
 * ```typescript
 * const trimPos = findQualityTrimEnd('IIIIII!!!', 20, 4, 'phred33', 0);
 * console.log(trimPos); // 6 (where quality becomes unacceptable)
 * ```
 *
 * @param quality - Quality string
 * @param threshold - Quality threshold
 * @param windowSize - Sliding window size
 * @param encoding - Quality encoding
 * @param start - Start position (don't trim before this)
 * @returns End position for trimming
 *
 * 🔥 NATIVE: Sliding window quality analysis - vectorizable
 */
export function findQualityTrimEnd(
  quality: string,
  threshold: number,
  windowSize: number,
  encoding: "phred33" | "phred64" | "solexa",
  start: number,
): number {
  // Tiger Style: Assert inputs
  if (!quality || typeof quality !== "string") {
    throw new Error("Quality string must be non-empty");
  }
  if (windowSize <= 0) {
    throw new Error("Window size must be positive");
  }
  if (start < 0 || start > quality.length) {
    throw new Error("Start position out of range");
  }

  // 🔥 NATIVE: Sliding window analysis from end
  for (let i = quality.length - windowSize; i >= start; i--) {
    const window = quality.slice(i, i + windowSize);
    const avgQual = QualityUtils.averageQuality(window, encoding);

    if (avgQual >= threshold) {
      return i + windowSize;
    }
  }

  return start; // No good quality found
}

// =============================================================================
// GROUPED EXPORT
// =============================================================================

/**
 * Calculate content percentage of specified bases in a sequence
 *
 * This is a generalized version of gcContent/atContent that works with any base set.
 * Used for SeqKit fx2tab compatibility.
 *
 * @example
 * ```typescript
 * baseContent('ATCGATCG', 'AT') // 50
 * baseContent('ATCGATCG', 'GC') // 50
 * baseContent('NNNATCG', 'N') // 42.86
 * baseContent('atcg', 'AT', true) // 0 (case sensitive)
 * ```
 *
 * @param sequence - DNA or RNA sequence
 * @param bases - Bases to count (e.g., "AT", "GC", "N")
 * @param caseSensitive - Whether to use case-sensitive matching (default: false)
 * @returns Percentage of specified bases (0-100)
 *
 * 🔥 NATIVE: SIMD character counting for specific base sets
 */
export function baseContent(sequence: string, bases: string, caseSensitive = false): number {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }
  if (!bases || typeof bases !== "string") {
    throw new Error("Bases must be a non-empty string");
  }

  const seq = caseSensitive ? sequence : sequence.toUpperCase();
  const baseSet = new Set(caseSensitive ? bases : bases.toUpperCase());
  let count = 0;

  // 🔥 NATIVE: SIMD character matching against set
  for (let i = 0; i < seq.length; i++) {
    const char = seq[i];
    if (char && baseSet.has(char)) {
      count++;
    }
  }

  return seq.length === 0 ? 0 : (count / seq.length) * 100;
}

/**
 * Count occurrences of specified bases in a sequence
 *
 * @example
 * ```typescript
 * baseCount('ATCGATCG', 'AT') // 4
 * baseCount('NNNATCG', 'N') // 3
 * baseCount('atcg', 'AT', true) // 0 (case sensitive)
 * ```
 *
 * @param sequence - DNA or RNA sequence
 * @param bases - Bases to count (e.g., "AT", "GC", "N")
 * @param caseSensitive - Whether to use case-sensitive matching (default: false)
 * @returns Count of specified bases
 *
 * 🔥 NATIVE: SIMD population count for base matching
 */
export function baseCount(sequence: string, bases: string, caseSensitive = false): number {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }
  if (!bases || typeof bases !== "string") {
    throw new Error("Bases must be a non-empty string");
  }

  const seq = caseSensitive ? sequence : sequence.toUpperCase();
  const baseSet = new Set(caseSensitive ? bases : bases.toUpperCase());
  let count = 0;

  // 🔥 NATIVE: SIMD character counting
  for (let i = 0; i < seq.length; i++) {
    const char = seq[i];
    if (char && baseSet.has(char)) {
      count++;
    }
  }

  return count;
}

/**
 * Extract unique alphabet (characters) from a sequence
 *
 * Returns a sorted string of all unique characters found in the sequence.
 * Useful for determining sequence type and detecting non-standard characters.
 *
 * @example
 * ```typescript
 * sequenceAlphabet('AAACCCGGGTTT') // 'ACGT'
 * sequenceAlphabet('ACGTNNNN') // 'ACGNT'
 * sequenceAlphabet('AACCggtt', false) // 'ACGT' (case insensitive)
 * sequenceAlphabet('AACCggtt', true) // 'ACgtg' (case sensitive)
 * ```
 *
 * @param sequence - Input sequence
 * @param caseSensitive - Whether to preserve case (default: false)
 * @returns Sorted string of unique characters
 *
 * 🔥 NATIVE: Bit vector for character presence
 */
export function sequenceAlphabet(sequence: string, caseSensitive = false): string {
  // Tiger Style: Assert input
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }

  const seq = caseSensitive ? sequence : sequence.toUpperCase();
  const chars = new Set<string>();

  // 🔥 NATIVE: Bit vector character accumulation
  for (let i = 0; i < seq.length; i++) {
    const char = seq[i];
    if (char) {
      chars.add(char);
    }
  }

  return Array.from(chars).sort().join("");
}

/**
 * Grouped export of all calculation functions
 *
 * @example
 * ```typescript
 * import { SequenceCalculations } from './calculations';
 * const gc = SequenceCalculations.gcContent('ATCG');
 * ```
 */
export const SequenceCalculations = {
  gcContent,
  atContent,
  baseComposition,
  baseContent,
  baseCount,
  sequenceAlphabet,
  translateSimple,
  findQualityTrimStart,
  findQualityTrimEnd,
} as const;
