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
 * Combines two maps of sequences, deduplicating by sequence content.
 * Preserves first occurrence when duplicates are found.
 *
 * @param setA - First set of sequences
 * @param setB - Second set of sequences
 * @returns Map of unique sequences from both sets
 */
export function sequenceUnion<T extends AbstractSequence>(
  setA: Map<string, T>,
  setB: Map<string, T>,
): Map<string, T> {
  const result = new Map(setA);

  for (const [key, value] of setB) {
    if (!result.has(key)) {
      result.set(key, value);
    }
  }

  return result;
}

/**
 * Intersection (A ∩ B): Sequences present in both set A and set B
 *
 * Returns sequences whose content appears in both input maps.
 * Preserves sequences from first set (setA).
 *
 * @param setA - First set of sequences
 * @param setB - Second set of sequences
 * @returns Map of sequences present in both sets
 */
export function sequenceIntersection<T extends AbstractSequence>(
  setA: Map<string, T>,
  setB: Map<string, T>,
): Map<string, T> {
  const result = new Map<string, T>();

  for (const [key, value] of setA) {
    if (setB.has(key)) {
      result.set(key, value);
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
 * @returns Map of sequences unique to setA
 */
export function sequenceDifference<T extends AbstractSequence>(
  setA: Map<string, T>,
  setB: Map<string, T>,
): Map<string, T> {
  const result = new Map<string, T>();

  for (const [key, value] of setA) {
    if (!setB.has(key)) {
      result.set(key, value);
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
 * @returns Map of sequences unique to either set
 */
export function sequenceSymmetricDifference<T extends AbstractSequence>(
  setA: Map<string, T>,
  setB: Map<string, T>,
): Map<string, T> {
  const result = new Map<string, T>();

  // Add from A if not in B
  for (const [key, value] of setA) {
    if (!setB.has(key)) {
      result.set(key, value);
    }
  }

  // Add from B if not in A
  for (const [key, value] of setB) {
    if (!setA.has(key)) {
      result.set(key, value);
    }
  }

  return result;
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
 * Convert array to deduplicated Map
 *
 * Used by SequenceSet constructor to convert input arrays to internal Map format.
 * Deduplicates by sequence content (first occurrence wins).
 *
 * @param sequences - Array of sequences to deduplicate
 * @returns Map with sequence strings as keys, sequence objects as values
 * @internal
 */
export function sequenceArrayToMap<T extends AbstractSequence>(sequences: T[]): Map<string, T> {
  const map = new Map<string, T>();

  for (const seq of sequences) {
    if (!map.has(seq.sequence)) {
      map.set(seq.sequence, seq);
    }
  }

  return map;
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
export function sequenceEquals<T extends AbstractSequence>(
  setA: Map<string, T>,
  setB: Map<string, T>,
): boolean {
  if (setA.size !== setB.size) {
    return false;
  }

  for (const key of setA.keys()) {
    if (!setB.has(key)) {
      return false;
    }
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
export function sequenceIsSubset<T extends AbstractSequence>(
  setA: Map<string, T>,
  setB: Map<string, T>,
): boolean {
  if (setA.size > setB.size) {
    return false;
  }

  for (const key of setA.keys()) {
    if (!setB.has(key)) {
      return false;
    }
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
export function sequenceIsDisjoint<T extends AbstractSequence>(
  setA: Map<string, T>,
  setB: Map<string, T>,
): boolean {
  // Optimization: iterate smaller set
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];

  for (const key of smaller.keys()) {
    if (larger.has(key)) {
      return false;
    }
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
  setA: Map<string, T>,
  setB: Map<string, T>,
): number {
  let intersectionSize = 0;

  for (const key of setA.keys()) {
    if (setB.has(key)) {
      intersectionSize++;
    }
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
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
export function sequenceContainment<T extends AbstractSequence>(
  setA: Map<string, T>,
  setB: Map<string, T>,
): number {
  if (setA.size === 0) {
    return 0;
  }

  let intersectionSize = 0;
  for (const key of setA.keys()) {
    if (setB.has(key)) {
      intersectionSize++;
    }
  }

  return intersectionSize / setA.size;
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
export function sequenceOverlap<T extends AbstractSequence>(
  setA: Map<string, T>,
  setB: Map<string, T>,
): number {
  const minSize = Math.min(setA.size, setB.size);
  if (minSize === 0) {
    return 0;
  }

  let intersectionSize = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;

  for (const key of smaller.keys()) {
    if (larger.has(key)) {
      intersectionSize++;
    }
  }

  return intersectionSize / minSize;
}
