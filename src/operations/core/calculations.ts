/**
 * Sequence composition and content calculations
 *
 * Provides functions for calculating GC content, AT content,
 * base composition, and simple translation operations.
 *
 */

import { GenotypeString, CharSet, Bases } from "../../genotype-string";
import { ValidationError } from "../../errors";
import { getGeneticCode } from "./genetic-codes";

const PARTIAL_GC = CharSet.from("RYKM");
const PARTIAL_AMBIGUOUS = CharSet.from("NBDHV");
const COMPOSITION_CHARS = CharSet.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ-.*");

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
 */
export function gcContent(sequence: GenotypeString | string): number {
  const gs = GenotypeString.fromString(sequence);
  if (gs.length === 0) {
    throw new ValidationError("Sequence must be non-empty");
  }

  const upper = gs.toUpperCase();
  let gcCount = 0;
  let totalBases = 0;

  for (let i = 0; i < upper.length; i++) {
    if (upper.isAnyOf(i, Bases.Strong)) {
      gcCount++;
      totalBases++;
    } else if (upper.isAnyOf(i, Bases.Weak)) {
      totalBases++;
    } else if (upper.isAnyOf(i, PARTIAL_GC)) {
      gcCount += 0.5;
      totalBases++;
    } else if (upper.isAnyOf(i, PARTIAL_AMBIGUOUS)) {
      gcCount += 0.5;
      totalBases++;
    }
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
 */
export function atContent(sequence: GenotypeString | string): number {
  const gs = GenotypeString.fromString(sequence);
  if (gs.length === 0) {
    throw new ValidationError("Sequence must be non-empty");
  }

  const upper = gs.toUpperCase();
  let atCount = 0;
  let totalBases = 0;

  for (let i = 0; i < upper.length; i++) {
    if (upper.isAnyOf(i, Bases.Weak)) {
      atCount++;
      totalBases++;
    } else if (upper.isAnyOf(i, Bases.Strong)) {
      totalBases++;
    } else if (upper.isAnyOf(i, PARTIAL_GC)) {
      atCount += 0.5;
      totalBases++;
    } else if (upper.isAnyOf(i, PARTIAL_AMBIGUOUS)) {
      atCount += 0.5;
      totalBases++;
    }
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
 */
export function baseComposition(sequence: GenotypeString | string): Record<string, number> {
  const gs = GenotypeString.fromString(sequence);
  if (gs.length === 0) {
    throw new ValidationError("Sequence must be non-empty");
  }

  const upper = gs.toUpperCase();
  const composition: Record<string, number> = {};

  for (let i = 0; i < upper.length; i++) {
    if (upper.isAnyOf(i, COMPOSITION_CHARS)) {
      const base = upper.charAt(i);
      composition[base] = (composition[base] ?? 0) + 1;
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
 */
export function translateSimple(
  sequence: GenotypeString | string,
  geneticCodeId: number = 1
): string[] {
  const gs = GenotypeString.fromString(sequence);
  if (gs.length === 0) {
    throw new ValidationError("Sequence must be non-empty");
  }

  const geneticCode = getGeneticCode(geneticCodeId);
  if (!geneticCode) {
    throw new ValidationError(`Unknown genetic code: ${geneticCodeId}`);
  }

  const table = geneticCode.codons;
  const upper = gs.toUpperCase().replace(/U/g, "T").toString();
  const results: string[] = [];

  for (let frame = 0; frame < 3; frame++) {
    let protein = "";

    for (let i = frame; i + 2 < upper.length; i += 3) {
      const codon = upper.substring(i, i + 3);

      if (codon.length === 3 && /^[ACGT]{3}$/.test(codon)) {
        const aa = table[codon] !== undefined ? table[codon] : "X";
        protein += aa;

        if (aa === "*") break;
      }
    }

    results.push(protein);
  }

  return results;
}

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
 */
export function baseContent(
  sequence: GenotypeString | string,
  bases: string,
  caseSensitive = false
): number {
  const gs = GenotypeString.fromString(sequence);
  if (gs.length === 0) {
    throw new ValidationError("Sequence must be non-empty");
  }
  if (!bases || typeof bases !== "string") {
    throw new ValidationError("Bases must be a non-empty string");
  }

  const seq = caseSensitive ? gs : gs.toUpperCase();
  const charSet = CharSet.from(caseSensitive ? bases : bases.toUpperCase());
  let count = 0;

  for (let i = 0; i < seq.length; i++) {
    if (seq.isAnyOf(i, charSet)) {
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
 */
export function baseCount(
  sequence: GenotypeString | string,
  bases: string,
  caseSensitive = false
): number {
  const gs = GenotypeString.fromString(sequence);
  if (gs.length === 0) {
    throw new ValidationError("Sequence must be non-empty");
  }
  if (!bases || typeof bases !== "string") {
    throw new ValidationError("Bases must be a non-empty string");
  }

  const seq = caseSensitive ? gs : gs.toUpperCase();
  const charSet = CharSet.from(caseSensitive ? bases : bases.toUpperCase());
  let count = 0;

  for (let i = 0; i < seq.length; i++) {
    if (seq.isAnyOf(i, charSet)) {
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
 */
export function sequenceAlphabet(sequence: GenotypeString | string, caseSensitive = false): string {
  const gs = GenotypeString.fromString(sequence);
  if (gs.length === 0) {
    throw new ValidationError("Sequence must be non-empty");
  }

  const seq = caseSensitive ? gs : gs.toUpperCase();
  const chars = new Set<string>();

  for (let i = 0; i < seq.length; i++) {
    chars.add(seq.charAt(i));
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
} as const;
