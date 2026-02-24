import { describe, expect, test } from "bun:test";
import { createKmerRecord } from "../../src/constructors";
import { KmerSet } from "../../src/operations/types";
import type { KmerSequence } from "../../src/types";

function createKmer<K extends number>(
  kmerSize: K,
  id: string,
  sequence: string,
  overrides: Partial<KmerSequence<K>> = {}
): KmerSequence<K> {
  return createKmerRecord({
    id,
    sequence,
    kmerSize,
    stepSize: 1,
    originalId: "seq1",
    startPosition: 1,
    endPosition: sequence.length,
    coordinateSystem: "1-based",
    suffix: "_window",
    isWrapped: false,
    windowIndex: 0,
    description: "",
    lineNumber: 1,
    ...overrides,
  });
}

describe("KmerSet type safety", () => {
  describe("constructor", () => {
    test("preserves K type parameter", () => {
      const kmers: KmerSequence<21>[] = [createKmer(21, "kmer1", "A".repeat(21))];

      const set = new KmerSet<21>(kmers);
      expect(set.size).toBe(1);

      const arr = set.toArray();
      const size: 21 = arr[0]!.kmerSize;
      expect(size).toBe(21);
    });
  });

  describe("union", () => {
    test("enforces K type matching and preserves K", () => {
      const kmers21: KmerSequence<21>[] = [createKmer(21, "kmer1", "A".repeat(21))];

      const set1 = new KmerSet<21>(kmers21);
      const set2 = new KmerSet<21>(kmers21);

      const union = set1.union(set2);

      const arr = union.toArray();
      const size: 21 = arr[0]!.kmerSize;
      expect(size).toBe(21);
    });
  });

  describe("intersection", () => {
    test("preserves K type", () => {
      const kmers31: KmerSequence<31>[] = [createKmer(31, "kmer1", "A".repeat(31))];

      const set1 = new KmerSet<31>(kmers31);
      const set2 = new KmerSet<31>(kmers31);

      const intersection = set1.intersection(set2);

      const arr = intersection.toArray();
      const size: 31 = arr[0]!.kmerSize;
      expect(size).toBe(31);
    });
  });

  describe("difference", () => {
    test("preserves K type", () => {
      const kmer1: KmerSequence<15> = createKmer(15, "kmer1", "A".repeat(15));

      const kmer2: KmerSequence<15> = createKmer(15, "kmer2", "T".repeat(15));

      const set1 = new KmerSet<15>([kmer1, kmer2]);
      const set2 = new KmerSet<15>([kmer2]);

      const difference = set1.difference(set2);

      expect(difference.size).toBe(1);
      const arr = difference.toArray();
      const size: 15 = arr[0]!.kmerSize;
      expect(size).toBe(15);
    });
  });

  describe("symmetricDifference", () => {
    test("preserves K type", () => {
      const kmer: KmerSequence<7> = createKmer(7, "kmer1", "ATCGATC");

      const set1 = new KmerSet<7>([kmer]);
      const set2 = new KmerSet<7>([]);

      const symDiff = set1.symmetricDifference(set2);

      const arr = symDiff.toArray();
      const size: 7 = arr[0]!.kmerSize;
      expect(size).toBe(7);
    });
  });

  describe("filter", () => {
    test("preserves K type", () => {
      const kmers: KmerSequence<10>[] = [
        createKmer(10, "kmer1", "ATCGATCGAT"),
        createKmer(10, "kmer2", "GCTAGCTAGC", {
          startPosition: 2,
          endPosition: 11,
          windowIndex: 1,
        }),
      ];

      const set = new KmerSet<10>(kmers);
      const filtered = set.filter((k) => k.sequence.startsWith("A"));

      expect(filtered.size).toBe(1);
      const arr = filtered.toArray();
      const size: 10 = arr[0]!.kmerSize;
      expect(size).toBe(10);
    });
  });

  describe("delegation to parent class", () => {
    test("delegates to SequenceSet methods correctly", () => {
      const kmer: KmerSequence<5> = createKmer(5, "kmer1", "ATCGA");

      const set1 = new KmerSet<5>([kmer]);
      const set2 = new KmerSet<5>([kmer]);

      expect(set1.equals(set2)).toBe(true);
      expect(set1.isSubsetOf(set2)).toBe(true);
      expect(set1.jaccardSimilarity(set2)).toBe(1.0);
    });
  });

  describe("inherited methods maintain K type", () => {
    test("has, get, toArray preserve K type information", () => {
      const kmer: KmerSequence<3> = createKmer(3, "kmer1", "ATC");

      const set = new KmerSet<3>([kmer]);

      expect(set.has("ATC")).toBe(true);
      const retrieved = set.get("ATC");
      if (retrieved) {
        const size: 3 = retrieved.kmerSize;
        expect(size).toBe(3);
      }

      const arr = set.toArray();
      const size: 3 = arr[0]!.kmerSize;
      expect(size).toBe(3);
    });
  });
});
