import { describe, expect, test } from "bun:test";
import {
  sequenceContainment,
  sequenceDifference,
  sequenceEquals,
  sequenceIntersection,
  sequenceIsDisjoint,
  sequenceIsSubset,
  sequenceJaccardSimilarity,
  sequenceOverlap,
  sequenceSymmetricDifference,
  sequenceUnion,
  sequenceUnique,
} from "../../src/operations/core/sequence-sets";
import { SequenceSet } from "../../src/operations/types";
import type { AbstractSequence } from "../../src/types";

describe("Internal sequence set functions", () => {
  describe("sequenceUnion", () => {
    test("combines sets and deduplicates by sequence content", () => {
      const setA: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCG",
          length: 4,
          lineNumber: 1,
          description: "",
        },
        {
          id: "seq2",
          sequence: "GCTA",
          length: 4,
          lineNumber: 2,
          description: "",
        },
      ];
      const setB: AbstractSequence[] = [
        {
          id: "seq3",
          sequence: "GCTA",
          length: 4,
          lineNumber: 3,
          description: "",
        },
        {
          id: "seq4",
          sequence: "TTTT",
          length: 4,
          lineNumber: 4,
          description: "",
        },
      ];

      const union = sequenceUnion(setA, setB);

      expect(union.length).toBe(3);
      expect(union.map((s) => s.sequence).sort()).toEqual(["ATCG", "GCTA", "TTTT"]);
    });
  });

  describe("sequenceIntersection", () => {
    test("finds common sequences between sets", () => {
      const setA: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCG",
          length: 4,
          lineNumber: 1,
          description: "",
        },
        {
          id: "seq2",
          sequence: "GCTA",
          length: 4,
          lineNumber: 2,
          description: "",
        },
        {
          id: "seq3",
          sequence: "TTTT",
          length: 4,
          lineNumber: 3,
          description: "",
        },
      ];
      const setB: AbstractSequence[] = [
        {
          id: "seq4",
          sequence: "GCTA",
          length: 4,
          lineNumber: 4,
          description: "",
        },
        {
          id: "seq5",
          sequence: "AAAA",
          length: 4,
          lineNumber: 5,
          description: "",
        },
      ];

      const intersection = sequenceIntersection(setA, setB);

      expect(intersection.length).toBe(1);
      expect(intersection[0].sequence).toBe("GCTA");
    });
  });

  describe("sequenceDifference", () => {
    test("returns sequences in A but not in B", () => {
      const setA: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCG",
          length: 4,
          lineNumber: 1,
          description: "",
        },
        {
          id: "seq2",
          sequence: "GCTA",
          length: 4,
          lineNumber: 2,
          description: "",
        },
      ];
      const setB: AbstractSequence[] = [
        {
          id: "seq3",
          sequence: "GCTA",
          length: 4,
          lineNumber: 3,
          description: "",
        },
      ];

      const difference = sequenceDifference(setA, setB);

      expect(difference.length).toBe(1);
      expect(difference[0].sequence).toBe("ATCG");
    });
  });

  describe("sequenceSymmetricDifference", () => {
    test("returns sequences in either set but not both", () => {
      const setA: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCG",
          length: 4,
          lineNumber: 1,
          description: "",
        },
        {
          id: "seq2",
          sequence: "GCTA",
          length: 4,
          lineNumber: 2,
          description: "",
        },
      ];
      const setB: AbstractSequence[] = [
        {
          id: "seq3",
          sequence: "GCTA",
          length: 4,
          lineNumber: 3,
          description: "",
        },
        {
          id: "seq4",
          sequence: "TTTT",
          length: 4,
          lineNumber: 4,
          description: "",
        },
      ];

      const symDiff = sequenceSymmetricDifference(setA, setB);

      expect(symDiff.length).toBe(2);
      expect(symDiff.map((s) => s.sequence).sort()).toEqual(["ATCG", "TTTT"]);
    });
  });

  describe("sequenceUnique", () => {
    test("deduplicates and preserves first occurrence", () => {
      const sequences: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCG",
          length: 4,
          lineNumber: 1,
          description: "",
        },
        {
          id: "seq2",
          sequence: "GCTA",
          length: 4,
          lineNumber: 2,
          description: "",
        },
        {
          id: "seq3",
          sequence: "ATCG",
          length: 4,
          lineNumber: 3,
          description: "",
        },
        {
          id: "seq4",
          sequence: "GCTA",
          length: 4,
          lineNumber: 4,
          description: "",
        },
      ];

      const unique = sequenceUnique(sequences);

      expect(unique.length).toBe(2);
      expect(unique[0].id).toBe("seq1");
      expect(unique[1].id).toBe("seq2");
    });
  });

  describe("sequenceEquals", () => {
    test("detects set equality", () => {
      const setA: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCG",
          length: 4,
          lineNumber: 1,
          description: "",
        },
        {
          id: "seq2",
          sequence: "GCTA",
          length: 4,
          lineNumber: 2,
          description: "",
        },
      ];
      const setB: AbstractSequence[] = [
        {
          id: "seq3",
          sequence: "GCTA",
          length: 4,
          lineNumber: 3,
          description: "",
        },
        {
          id: "seq4",
          sequence: "ATCG",
          length: 4,
          lineNumber: 4,
          description: "",
        },
      ];
      const setC: AbstractSequence[] = [
        {
          id: "seq5",
          sequence: "ATCG",
          length: 4,
          lineNumber: 5,
          description: "",
        },
      ];

      expect(sequenceEquals(setA, setB)).toBe(true);
      expect(sequenceEquals(setA, setC)).toBe(false);
    });
  });

  describe("sequenceIsSubset", () => {
    test("detects subset relationships", () => {
      const setA: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCG",
          length: 4,
          lineNumber: 1,
          description: "",
        },
      ];
      const setB: AbstractSequence[] = [
        {
          id: "seq2",
          sequence: "ATCG",
          length: 4,
          lineNumber: 2,
          description: "",
        },
        {
          id: "seq3",
          sequence: "GCTA",
          length: 4,
          lineNumber: 3,
          description: "",
        },
      ];

      expect(sequenceIsSubset(setA, setB)).toBe(true);
      expect(sequenceIsSubset(setB, setA)).toBe(false);
    });
  });

  describe("sequenceIsDisjoint", () => {
    test("detects disjoint sets", () => {
      const setA: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCG",
          length: 4,
          lineNumber: 1,
          description: "",
        },
      ];
      const setB: AbstractSequence[] = [
        {
          id: "seq2",
          sequence: "GCTA",
          length: 4,
          lineNumber: 2,
          description: "",
        },
      ];
      const setC: AbstractSequence[] = [
        {
          id: "seq3",
          sequence: "ATCG",
          length: 4,
          lineNumber: 3,
          description: "",
        },
      ];

      expect(sequenceIsDisjoint(setA, setB)).toBe(true);
      expect(sequenceIsDisjoint(setA, setC)).toBe(false);
    });
  });

  describe("sequenceJaccardSimilarity", () => {
    test("calculates correct Jaccard coefficient", () => {
      const setA: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCG",
          length: 4,
          lineNumber: 1,
          description: "",
        },
        {
          id: "seq2",
          sequence: "GCTA",
          length: 4,
          lineNumber: 2,
          description: "",
        },
      ];
      const setB: AbstractSequence[] = [
        {
          id: "seq3",
          sequence: "GCTA",
          length: 4,
          lineNumber: 3,
          description: "",
        },
        {
          id: "seq4",
          sequence: "TTTT",
          length: 4,
          lineNumber: 4,
          description: "",
        },
      ];

      const jaccard = sequenceJaccardSimilarity(setA, setB);

      expect(jaccard).toBeCloseTo(0.333, 2);
    });
  });

  describe("sequenceContainment", () => {
    test("calculates correct containment coefficient", () => {
      const setA: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCG",
          length: 4,
          lineNumber: 1,
          description: "",
        },
      ];
      const setB: AbstractSequence[] = [
        {
          id: "seq2",
          sequence: "ATCG",
          length: 4,
          lineNumber: 2,
          description: "",
        },
        {
          id: "seq3",
          sequence: "GCTA",
          length: 4,
          lineNumber: 3,
          description: "",
        },
      ];

      const containment = sequenceContainment(setA, setB);

      expect(containment).toBe(1.0);
    });
  });

  describe("sequenceOverlap", () => {
    test("calculates correct overlap coefficient", () => {
      const setA: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCG",
          length: 4,
          lineNumber: 1,
          description: "",
        },
        {
          id: "seq2",
          sequence: "GCTA",
          length: 4,
          lineNumber: 2,
          description: "",
        },
      ];
      const setB: AbstractSequence[] = [
        {
          id: "seq3",
          sequence: "GCTA",
          length: 4,
          lineNumber: 3,
          description: "",
        },
        {
          id: "seq4",
          sequence: "TTTT",
          length: 4,
          lineNumber: 4,
          description: "",
        },
        {
          id: "seq5",
          sequence: "AAAA",
          length: 4,
          lineNumber: 5,
          description: "",
        },
      ];

      const overlap = sequenceOverlap(setA, setB);

      expect(overlap).toBe(0.5);
    });
  });

  describe("SequenceSet class", () => {
    describe("constructor", () => {
      test("deduplicates sequences by sequence content", () => {
        const sequences: AbstractSequence[] = [
          {
            id: "seq1",
            sequence: "ATCG",
            length: 4,
            lineNumber: 1,
            description: "",
          },
          {
            id: "seq2",
            sequence: "GCTA",
            length: 4,
            lineNumber: 2,
            description: "",
          },
          {
            id: "seq3",
            sequence: "ATCG",
            length: 4,
            lineNumber: 3,
            description: "",
          },
        ];

        const set = new SequenceSet(sequences);

        expect(set.size).toBe(2);
        expect(set.toArray().length).toBe(2);
      });
    });

    describe("set operations", () => {
      test("all four set operations work correctly", () => {
        const setA = new SequenceSet([
          {
            id: "seq1",
            sequence: "ATCG",
            length: 4,
            lineNumber: 1,
            description: "",
          },
          {
            id: "seq2",
            sequence: "GCTA",
            length: 4,
            lineNumber: 2,
            description: "",
          },
        ]);
        const setB = new SequenceSet([
          {
            id: "seq3",
            sequence: "GCTA",
            length: 4,
            lineNumber: 3,
            description: "",
          },
          {
            id: "seq4",
            sequence: "TTTT",
            length: 4,
            lineNumber: 4,
            description: "",
          },
        ]);

        const union = setA.union(setB);
        expect(union.size).toBe(3);

        const intersection = setA.intersection(setB);
        expect(intersection.size).toBe(1);

        const difference = setA.difference(setB);
        expect(difference.size).toBe(1);
        expect(difference.toArray()[0].sequence).toBe("ATCG");

        const symDiff = setA.symmetricDifference(setB);
        expect(symDiff.size).toBe(2);
      });
    });

    describe("comparison methods", () => {
      test("equals, isSubsetOf, isSupersetOf, isDisjointFrom work correctly", () => {
        const setA = new SequenceSet([
          {
            id: "seq1",
            sequence: "ATCG",
            length: 4,
            lineNumber: 1,
            description: "",
          },
        ]);
        const setB = new SequenceSet([
          {
            id: "seq2",
            sequence: "ATCG",
            length: 4,
            lineNumber: 2,
            description: "",
          },
        ]);
        const setC = new SequenceSet([
          {
            id: "seq3",
            sequence: "ATCG",
            length: 4,
            lineNumber: 3,
            description: "",
          },
          {
            id: "seq4",
            sequence: "GCTA",
            length: 4,
            lineNumber: 4,
            description: "",
          },
        ]);
        const setD = new SequenceSet([
          {
            id: "seq5",
            sequence: "TTTT",
            length: 4,
            lineNumber: 5,
            description: "",
          },
        ]);

        expect(setA.equals(setB)).toBe(true);
        expect(setA.isSubsetOf(setC)).toBe(true);
        expect(setC.isSupersetOf(setA)).toBe(true);
        expect(setA.isDisjointFrom(setD)).toBe(true);
      });
    });

    describe("similarity metrics", () => {
      test("jaccardSimilarity, containment, overlap work correctly", () => {
        const setA = new SequenceSet([
          {
            id: "seq1",
            sequence: "ATCG",
            length: 4,
            lineNumber: 1,
            description: "",
          },
          {
            id: "seq2",
            sequence: "GCTA",
            length: 4,
            lineNumber: 2,
            description: "",
          },
        ]);
        const setB = new SequenceSet([
          {
            id: "seq3",
            sequence: "GCTA",
            length: 4,
            lineNumber: 3,
            description: "",
          },
          {
            id: "seq4",
            sequence: "TTTT",
            length: 4,
            lineNumber: 4,
            description: "",
          },
        ]);

        const jaccard = setA.jaccardSimilarity(setB);
        expect(jaccard).toBeCloseTo(0.333, 2);

        const containment = setA.containment(setB);
        expect(containment).toBe(0.5);

        const overlap = setA.overlap(setB);
        expect(overlap).toBe(0.5);
      });
    });

    describe("utility methods", () => {
      test("has, get, toArray, filter, map work correctly", () => {
        const set = new SequenceSet([
          {
            id: "seq1",
            sequence: "ATCG",
            length: 4,
            lineNumber: 1,
            description: "",
          },
          {
            id: "seq2",
            sequence: "GCTA",
            length: 4,
            lineNumber: 2,
            description: "",
          },
        ]);

        expect(set.has("ATCG")).toBe(true);
        expect(set.has("TTTT")).toBe(false);

        const seq = set.get("ATCG");
        expect(seq?.id).toBe("seq1");

        const arr = set.toArray();
        expect(arr.length).toBe(2);

        const filtered = set.filter((s) => s.sequence.startsWith("A"));
        expect(filtered.size).toBe(1);

        const mapped = set.map((s) => ({ ...s, id: s.id.toUpperCase() }));
        expect(mapped.toArray()[0].id).toBe("SEQ1");
      });
    });

    describe("iterators", () => {
      test("Symbol.iterator and Symbol.asyncIterator work correctly", async () => {
        const set = new SequenceSet([
          {
            id: "seq1",
            sequence: "ATCG",
            length: 4,
            lineNumber: 1,
            description: "",
          },
          {
            id: "seq2",
            sequence: "GCTA",
            length: 4,
            lineNumber: 2,
            description: "",
          },
        ]);

        const syncItems = [];
        for (const seq of set) {
          syncItems.push(seq);
        }
        expect(syncItems.length).toBe(2);

        const asyncItems = [];
        for await (const seq of set) {
          asyncItems.push(seq);
        }
        expect(asyncItems.length).toBe(2);
      });
    });

    describe("Edge cases", () => {
      test("set operations handle all-duplicate input", () => {
        const sequences: AbstractSequence[] = [
          { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
          { id: "seq2", sequence: "ATCG", length: 4, lineNumber: 2, description: "" },
          { id: "seq3", sequence: "ATCG", length: 4, lineNumber: 3, description: "" },
        ];

        const set = new SequenceSet(sequences);
        expect(set.size).toBe(1);
      });

      test("set operations handle empty sets", () => {
        const emptySet = new SequenceSet([]);
        const nonEmptySet = new SequenceSet([
          { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        ]);

        expect(emptySet.union(nonEmptySet).size).toBe(1);
        expect(emptySet.intersection(nonEmptySet).size).toBe(0);
        expect(emptySet.difference(nonEmptySet).size).toBe(0);
      });
    });
  });
});
