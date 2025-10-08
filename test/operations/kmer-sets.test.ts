import { describe, expect, test } from "bun:test";
import { KmerSet } from "../../src/operations/types";
import type { KmerSequence } from "../../src/types";

describe("KmerSet type safety", () => {
  describe("constructor", () => {
    test("preserves K type parameter", () => {
      const kmers: KmerSequence<21>[] = [
        {
          id: "kmer1",
          sequence: "A".repeat(21),
          length: 21,
          lineNumber: 1,
          description: "",
          kmerSize: 21,
          stepSize: 1,
          originalId: "seq1",
          startPosition: 1,
          endPosition: 21,
          coordinateSystem: "1-based",
          suffix: "_window",
          isWrapped: false,
          windowIndex: 0,
        },
      ];

      const set = new KmerSet<21>(kmers);
      expect(set.size).toBe(1);

      const arr = set.toArray();
      const size: 21 = arr[0].kmerSize;
      expect(size).toBe(21);
    });
  });

  describe("union", () => {
    test("enforces K type matching and preserves K", () => {
      const kmers21: KmerSequence<21>[] = [
        {
          id: "kmer1",
          sequence: "A".repeat(21),
          length: 21,
          lineNumber: 1,
          description: "",
          kmerSize: 21,
          stepSize: 1,
          originalId: "seq1",
          startPosition: 1,
          endPosition: 21,
          coordinateSystem: "1-based",
          suffix: "_window",
          isWrapped: false,
          windowIndex: 0,
        },
      ];

      const set1 = new KmerSet<21>(kmers21);
      const set2 = new KmerSet<21>(kmers21);

      const union = set1.union(set2);

      const arr = union.toArray();
      const size: 21 = arr[0].kmerSize;
      expect(size).toBe(21);
    });
  });

  describe("intersection", () => {
    test("preserves K type", () => {
      const kmers31: KmerSequence<31>[] = [
        {
          id: "kmer1",
          sequence: "A".repeat(31),
          length: 31,
          lineNumber: 1,
          description: "",
          kmerSize: 31,
          stepSize: 1,
          originalId: "seq1",
          startPosition: 1,
          endPosition: 31,
          coordinateSystem: "1-based",
          suffix: "_window",
          isWrapped: false,
          windowIndex: 0,
        },
      ];

      const set1 = new KmerSet<31>(kmers31);
      const set2 = new KmerSet<31>(kmers31);

      const intersection = set1.intersection(set2);

      const arr = intersection.toArray();
      const size: 31 = arr[0].kmerSize;
      expect(size).toBe(31);
    });
  });

  describe("difference", () => {
    test("preserves K type", () => {
      const kmer1: KmerSequence<15> = {
        id: "kmer1",
        sequence: "A".repeat(15),
        length: 15,
        lineNumber: 1,
        description: "",
        kmerSize: 15,
        stepSize: 1,
        originalId: "seq1",
        startPosition: 1,
        endPosition: 15,
        coordinateSystem: "1-based",
        suffix: "_window",
        isWrapped: false,
        windowIndex: 0,
      };

      const kmer2: KmerSequence<15> = {
        ...kmer1,
        id: "kmer2",
        sequence: "T".repeat(15),
      };

      const set1 = new KmerSet<15>([kmer1, kmer2]);
      const set2 = new KmerSet<15>([kmer2]);

      const difference = set1.difference(set2);

      expect(difference.size).toBe(1);
      const arr = difference.toArray();
      const size: 15 = arr[0].kmerSize;
      expect(size).toBe(15);
    });
  });

  describe("symmetricDifference", () => {
    test("preserves K type", () => {
      const kmer: KmerSequence<7> = {
        id: "kmer1",
        sequence: "ATCGATC",
        length: 7,
        lineNumber: 1,
        description: "",
        kmerSize: 7,
        stepSize: 1,
        originalId: "seq1",
        startPosition: 1,
        endPosition: 7,
        coordinateSystem: "1-based",
        suffix: "_window",
        isWrapped: false,
        windowIndex: 0,
      };

      const set1 = new KmerSet<7>([kmer]);
      const set2 = new KmerSet<7>([]);

      const symDiff = set1.symmetricDifference(set2);

      const arr = symDiff.toArray();
      const size: 7 = arr[0].kmerSize;
      expect(size).toBe(7);
    });
  });

  describe("filter", () => {
    test("preserves K type", () => {
      const kmers: KmerSequence<10>[] = [
        {
          id: "kmer1",
          sequence: "ATCGATCGAT",
          length: 10,
          lineNumber: 1,
          description: "",
          kmerSize: 10,
          stepSize: 1,
          originalId: "seq1",
          startPosition: 1,
          endPosition: 10,
          coordinateSystem: "1-based",
          suffix: "_window",
          isWrapped: false,
          windowIndex: 0,
        },
        {
          id: "kmer2",
          sequence: "GCTAGCTAGC",
          length: 10,
          lineNumber: 1,
          description: "",
          kmerSize: 10,
          stepSize: 1,
          originalId: "seq1",
          startPosition: 2,
          endPosition: 11,
          coordinateSystem: "1-based",
          suffix: "_window",
          isWrapped: false,
          windowIndex: 1,
        },
      ];

      const set = new KmerSet<10>(kmers);
      const filtered = set.filter((k) => k.sequence.startsWith("A"));

      expect(filtered.size).toBe(1);
      const arr = filtered.toArray();
      const size: 10 = arr[0].kmerSize;
      expect(size).toBe(10);
    });
  });

  describe("delegation to parent class", () => {
    test("delegates to SequenceSet methods correctly", () => {
      const kmer: KmerSequence<5> = {
        id: "kmer1",
        sequence: "ATCGA",
        length: 5,
        lineNumber: 1,
        description: "",
        kmerSize: 5,
        stepSize: 1,
        originalId: "seq1",
        startPosition: 1,
        endPosition: 5,
        coordinateSystem: "1-based",
        suffix: "_window",
        isWrapped: false,
        windowIndex: 0,
      };

      const set1 = new KmerSet<5>([kmer]);
      const set2 = new KmerSet<5>([kmer]);

      expect(set1.equals(set2)).toBe(true);
      expect(set1.isSubsetOf(set2)).toBe(true);
      expect(set1.jaccardSimilarity(set2)).toBe(1.0);
    });
  });

  describe("inherited methods maintain K type", () => {
    test("has, get, toArray preserve K type information", () => {
      const kmer: KmerSequence<3> = {
        id: "kmer1",
        sequence: "ATC",
        length: 3,
        lineNumber: 1,
        description: "",
        kmerSize: 3,
        stepSize: 1,
        originalId: "seq1",
        startPosition: 1,
        endPosition: 3,
        coordinateSystem: "1-based",
        suffix: "_window",
        isWrapped: false,
        windowIndex: 0,
      };

      const set = new KmerSet<3>([kmer]);

      expect(set.has("ATC")).toBe(true);
      const retrieved = set.get("ATC");
      if (retrieved) {
        const size: 3 = retrieved.kmerSize;
        expect(size).toBe(3);
      }

      const arr = set.toArray();
      const size: 3 = arr[0].kmerSize;
      expect(size).toBe(3);
    });
  });
});
