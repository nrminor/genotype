/**
 * Generic sequence set operations internals
 *
 * Provides core set algebra algorithms that work on any AbstractSequence type.
 * These functions use sequence content as the deduplication key (no other options).
 *
 * Used internally by both SequenceSet<T> and KmerSet<K> classes as thin wrappers.
 *
 * @module operations/core/sequence-sets
 */

import type { AbstractSequence } from "../../types";

/**
 * Union (A ∪ B): All sequences in either set A or set B
 *
 * Combines two arrays of sequences, deduplicating by sequence content.
 * Preserves first occurrence when duplicates are found.
 *
 * @param setA - First set of sequences
 * @param setB - Second set of sequences
 * @returns Array of unique sequences from both sets
 */
export function sequenceUnion<T extends AbstractSequence>(setA: T[], setB: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const seq of [...setA, ...setB]) {
    if (!seen.has(seq.sequence)) {
      seen.add(seq.sequence);
      result.push(seq);
    }
  }

  return result;
}

/**
 * Intersection (A ∩ B): Sequences present in both set A and set B
 *
 * Returns sequences whose content appears in both input arrays.
 * Preserves sequences from first set (setA).
 *
 * @param setA - First set of sequences
 * @param setB - Second set of sequences
 * @returns Array of sequences present in both sets
 */
export function sequenceIntersection<T extends AbstractSequence>(setA: T[], setB: T[]): T[] {
  const setBSequences = new Set(setB.map((s) => s.sequence));
  const seen = new Set<string>();
  const result: T[] = [];

  for (const seq of setA) {
    if (setBSequences.has(seq.sequence) && !seen.has(seq.sequence)) {
      seen.add(seq.sequence);
      result.push(seq);
    }
  }

  return result;
}

/**
 * Difference (A - B): Sequences in set A but not in set B
 *
 * Returns sequences from A whose content does not appear in B.
 *
 * @param setA - Set to subtract from
 * @param setB - Set to subtract
 * @returns Array of sequences unique to setA
 */
export function sequenceDifference<T extends AbstractSequence>(setA: T[], setB: T[]): T[] {
  const setBSequences = new Set(setB.map((s) => s.sequence));
  const seen = new Set<string>();
  const result: T[] = [];

  for (const seq of setA) {
    if (!setBSequences.has(seq.sequence) && !seen.has(seq.sequence)) {
      seen.add(seq.sequence);
      result.push(seq);
    }
  }

  return result;
}

/**
 * Symmetric Difference (A Δ B): Sequences in either set but not both
 *
 * Equivalent to (A - B) ∪ (B - A).
 * Returns sequences unique to either set.
 *
 * @param setA - First set of sequences
 * @param setB - Second set of sequences
 * @returns Array of sequences unique to either set
 */
export function sequenceSymmetricDifference<T extends AbstractSequence>(setA: T[], setB: T[]): T[] {
  const onlyInA = sequenceDifference(setA, setB);
  const onlyInB = sequenceDifference(setB, setA);
  return sequenceUnion(onlyInA, onlyInB as T[]);
}

/**
 * Remove duplicate sequences from an array
 *
 * Deduplicates by sequence content, preserving first occurrence.
 *
 * @param sequences - Array of sequences with potential duplicates
 * @returns Array of unique sequences
 */
export function sequenceUnique<T extends AbstractSequence>(sequences: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const seq of sequences) {
    if (!seen.has(seq.sequence)) {
      seen.add(seq.sequence);
      result.push(seq);
    }
  }

  return result;
}

/**
 * Check if two sequence sets are equal
 *
 * Sets are equal if they contain the same sequences (by content),
 * regardless of order.
 *
 * @param setA - First set of sequences
 * @param setB - Second set of sequences
 * @returns True if sets contain identical sequences
 */
export function sequenceEquals<T extends AbstractSequence>(setA: T[], setB: T[]): boolean {
  const uniqueA = new Set(setA.map((s) => s.sequence));
  const uniqueB = new Set(setB.map((s) => s.sequence));

  if (uniqueA.size !== uniqueB.size) return false;

  for (const seq of uniqueA) {
    if (!uniqueB.has(seq)) return false;
  }

  return true;
}

/**
 * Check if setA is a subset of setB (A ⊆ B)
 *
 * True if all sequences in A are also in B.
 *
 * @param setA - Potential subset
 * @param setB - Potential superset
 * @returns True if setA is a subset of setB
 */
export function sequenceIsSubset<T extends AbstractSequence>(setA: T[], setB: T[]): boolean {
  const uniqueA = new Set(setA.map((s) => s.sequence));
  const uniqueB = new Set(setB.map((s) => s.sequence));

  if (uniqueA.size > uniqueB.size) return false;

  for (const seq of uniqueA) {
    if (!uniqueB.has(seq)) return false;
  }

  return true;
}

/**
 * Check if sets are disjoint (A ∩ B = ∅)
 *
 * True if sets have no sequences in common.
 *
 * @param setA - First set of sequences
 * @param setB - Second set of sequences
 * @returns True if sets have no shared sequences
 */
export function sequenceIsDisjoint<T extends AbstractSequence>(setA: T[], setB: T[]): boolean {
  const uniqueB = new Set(setB.map((s) => s.sequence));

  for (const seq of setA) {
    if (uniqueB.has(seq.sequence)) return false;
  }

  return true;
}

/**
 * Calculate Jaccard similarity coefficient
 *
 * J(A, B) = |A ∩ B| / |A ∪ B|
 * Range: [0, 1] where 1 = identical sets, 0 = no overlap
 *
 * @param setA - First set of sequences
 * @param setB - Second set of sequences
 * @returns Jaccard similarity coefficient
 */
export function sequenceJaccardSimilarity<T extends AbstractSequence>(
  setA: T[],
  setB: T[]
): number {
  const uniqueA = new Set(setA.map((s) => s.sequence));
  const uniqueB = new Set(setB.map((s) => s.sequence));

  if (uniqueA.size === 0 && uniqueB.size === 0) return 1;
  if (uniqueA.size === 0 || uniqueB.size === 0) return 0;

  let intersectionSize = 0;
  for (const seq of uniqueA) {
    if (uniqueB.has(seq)) intersectionSize++;
  }

  const unionSize = uniqueA.size + uniqueB.size - intersectionSize;
  return intersectionSize / unionSize;
}

/**
 * Calculate containment coefficient
 *
 * C(A, B) = |A ∩ B| / |A|
 * What fraction of A is contained in B?
 * Range: [0, 1]
 *
 * @param setA - Set to measure containment of
 * @param setB - Reference set
 * @returns Containment coefficient
 */
export function sequenceContainment<T extends AbstractSequence>(setA: T[], setB: T[]): number {
  const uniqueA = new Set(setA.map((s) => s.sequence));
  if (uniqueA.size === 0) return 0;

  const uniqueB = new Set(setB.map((s) => s.sequence));

  let intersectionSize = 0;
  for (const seq of uniqueA) {
    if (uniqueB.has(seq)) intersectionSize++;
  }

  return intersectionSize / uniqueA.size;
}

/**
 * Calculate overlap coefficient
 *
 * O(A, B) = |A ∩ B| / min(|A|, |B|)
 * Symmetric measure of overlap.
 * Range: [0, 1]
 *
 * @param setA - First set of sequences
 * @param setB - Second set of sequences
 * @returns Overlap coefficient
 */
export function sequenceOverlap<T extends AbstractSequence>(setA: T[], setB: T[]): number {
  const uniqueA = new Set(setA.map((s) => s.sequence));
  const uniqueB = new Set(setB.map((s) => s.sequence));

  const minSize = Math.min(uniqueA.size, uniqueB.size);
  if (minSize === 0) return 0;

  let intersectionSize = 0;
  const smaller = uniqueA.size <= uniqueB.size ? uniqueA : uniqueB;
  const larger = uniqueA.size <= uniqueB.size ? uniqueB : uniqueA;

  for (const seq of smaller) {
    if (larger.has(seq)) intersectionSize++;
  }

  return intersectionSize / minSize;
}
