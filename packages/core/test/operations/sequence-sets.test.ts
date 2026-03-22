import { describe, expect, test } from "bun:test";
import "../matchers";
import { createFastaRecord, type FastaRecordInput } from "@genotype/core/constructors";
import {
  sequenceArrayToMap,
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
} from "@genotype/core/operations/core/sequence-sets";
import { SequenceSet } from "@genotype/core/operations/types";
import type { AbstractSequence } from "@genotype/core/types";

function toSequences(records: FastaRecordInput[]): AbstractSequence[] {
  return records.map((record) => createFastaRecord(record));
}

describe("Internal sequence set functions", () => {
  describe("sequenceUnion", () => {
    test("combines sets and deduplicates by sequence content", () => {
      const setA = toSequences([
        {
          id: "seq1",
          sequence: "ATCG",
        },
        {
          id: "seq2",
          sequence: "GCTA",
        },
      ]);
      const setB = toSequences([
        {
          id: "seq3",
          sequence: "GCTA",
        },
        {
          id: "seq4",
          sequence: "TTTT",
        },
      ]);

      const union = sequenceUnion(sequenceArrayToMap(setA), sequenceArrayToMap(setB));

      expect(union.size).toBe(3);
      expect(
        Array.from(union.values())
          .map((s) => s.sequence.toString())
          .sort((a, b) => a.localeCompare(b))
      ).toEqual(["ATCG", "GCTA", "TTTT"]);
    });
  });

  describe("sequenceIntersection", () => {
    test("finds common sequences between sets", () => {
      const setA = toSequences([
        {
          id: "seq1",
          sequence: "ATCG",
        },
        {
          id: "seq2",
          sequence: "GCTA",
        },
        {
          id: "seq3",
          sequence: "TTTT",
        },
      ]);
      const setB = toSequences([
        {
          id: "seq4",
          sequence: "GCTA",
        },
        {
          id: "seq5",
          sequence: "AAAA",
        },
      ]);

      const intersection = sequenceIntersection(sequenceArrayToMap(setA), sequenceArrayToMap(setB));

      expect(intersection.size).toBe(1);
      expect(Array.from(intersection.values())[0]!.sequence).toEqualSequence("GCTA");
    });
  });

  describe("sequenceDifference", () => {
    test("returns sequences in A but not in B", () => {
      const setA = toSequences([
        {
          id: "seq1",
          sequence: "ATCG",
        },
        {
          id: "seq2",
          sequence: "GCTA",
        },
      ]);
      const setB = toSequences([
        {
          id: "seq3",
          sequence: "GCTA",
        },
      ]);

      const difference = sequenceDifference(sequenceArrayToMap(setA), sequenceArrayToMap(setB));

      expect(difference.size).toBe(1);
      expect(Array.from(difference.values())[0]!.sequence).toEqualSequence("ATCG");
    });
  });

  describe("sequenceSymmetricDifference", () => {
    test("returns sequences in either set but not both", () => {
      const setA = toSequences([
        {
          id: "seq1",
          sequence: "ATCG",
        },
        {
          id: "seq2",
          sequence: "GCTA",
        },
      ]);
      const setB = toSequences([
        {
          id: "seq3",
          sequence: "GCTA",
        },
        {
          id: "seq4",
          sequence: "TTTT",
        },
      ]);

      const symDiff = sequenceSymmetricDifference(
        sequenceArrayToMap(setA),
        sequenceArrayToMap(setB)
      );

      expect(symDiff.size).toBe(2);
      expect(
        Array.from(symDiff.values())
          .map((s) => s.sequence.toString())
          .sort((a, b) => a.localeCompare(b))
      ).toEqual(["ATCG", "TTTT"]);
    });
  });

  describe("sequenceUnique", () => {
    test("deduplicates and preserves first occurrence", () => {
      const sequences = toSequences([
        {
          id: "seq1",
          sequence: "ATCG",
        },
        {
          id: "seq2",
          sequence: "GCTA",
        },
        {
          id: "seq3",
          sequence: "ATCG",
        },
        {
          id: "seq4",
          sequence: "GCTA",
        },
      ]);

      const unique = sequenceUnique(sequences);

      expect(unique.length).toBe(2);
      expect(unique[0]!.id).toBe("seq1");
      expect(unique[1]!.id).toBe("seq2");
    });
  });

  describe("sequenceEquals", () => {
    test("detects set equality", () => {
      const setA = toSequences([
        {
          id: "seq1",
          sequence: "ATCG",
        },
        {
          id: "seq2",
          sequence: "GCTA",
        },
      ]);
      const setB = toSequences([
        {
          id: "seq3",
          sequence: "GCTA",
        },
        {
          id: "seq4",
          sequence: "ATCG",
        },
      ]);
      const setC = toSequences([
        {
          id: "seq5",
          sequence: "ATCG",
        },
      ]);

      expect(sequenceEquals(sequenceArrayToMap(setA), sequenceArrayToMap(setB))).toBe(true);
      expect(sequenceEquals(sequenceArrayToMap(setA), sequenceArrayToMap(setC))).toBe(false);
    });
  });

  describe("sequenceIsSubset", () => {
    test("detects subset relationships", () => {
      const setA = toSequences([
        {
          id: "seq1",
          sequence: "ATCG",
        },
      ]);
      const setB = toSequences([
        {
          id: "seq2",
          sequence: "ATCG",
        },
        {
          id: "seq3",
          sequence: "GCTA",
        },
      ]);

      expect(sequenceIsSubset(sequenceArrayToMap(setA), sequenceArrayToMap(setB))).toBe(true);
      expect(sequenceIsSubset(sequenceArrayToMap(setB), sequenceArrayToMap(setA))).toBe(false);
    });
  });

  describe("sequenceIsDisjoint", () => {
    test("detects disjoint sets", () => {
      const setA = toSequences([
        {
          id: "seq1",
          sequence: "ATCG",
        },
      ]);
      const setB = toSequences([
        {
          id: "seq2",
          sequence: "GCTA",
        },
      ]);
      const setC = toSequences([
        {
          id: "seq3",
          sequence: "ATCG",
        },
      ]);

      expect(sequenceIsDisjoint(sequenceArrayToMap(setA), sequenceArrayToMap(setB))).toBe(true);
      expect(sequenceIsDisjoint(sequenceArrayToMap(setA), sequenceArrayToMap(setC))).toBe(false);
    });
  });

  describe("sequenceJaccardSimilarity", () => {
    test("calculates correct Jaccard coefficient", () => {
      const setA = toSequences([
        {
          id: "seq1",
          sequence: "ATCG",
        },
        {
          id: "seq2",
          sequence: "GCTA",
        },
      ]);
      const setB = toSequences([
        {
          id: "seq3",
          sequence: "GCTA",
        },
        {
          id: "seq4",
          sequence: "TTTT",
        },
      ]);

      const jaccard = sequenceJaccardSimilarity(sequenceArrayToMap(setA), sequenceArrayToMap(setB));

      expect(jaccard).toBeCloseTo(0.333, 2);
    });
  });

  describe("sequenceContainment", () => {
    test("calculates correct containment coefficient", () => {
      const setA = toSequences([
        {
          id: "seq1",
          sequence: "ATCG",
        },
      ]);
      const setB = toSequences([
        {
          id: "seq2",
          sequence: "ATCG",
        },
        {
          id: "seq3",
          sequence: "GCTA",
        },
      ]);

      const containment = sequenceContainment(sequenceArrayToMap(setA), sequenceArrayToMap(setB));

      expect(containment).toBe(1.0);
    });
  });

  describe("sequenceOverlap", () => {
    test("calculates correct overlap coefficient", () => {
      const setA = toSequences([
        {
          id: "seq1",
          sequence: "ATCG",
        },
        {
          id: "seq2",
          sequence: "GCTA",
        },
      ]);
      const setB = toSequences([
        {
          id: "seq3",
          sequence: "GCTA",
        },
        {
          id: "seq4",
          sequence: "TTTT",
        },
        {
          id: "seq5",
          sequence: "AAAA",
        },
      ]);

      const overlap = sequenceOverlap(sequenceArrayToMap(setA), sequenceArrayToMap(setB));

      expect(overlap).toBe(0.5);
    });
  });

  describe("SequenceSet class", () => {
    describe("constructor", () => {
      test("deduplicates sequences by sequence content", () => {
        const sequences = toSequences([
          {
            id: "seq1",
            sequence: "ATCG",
          },
          {
            id: "seq2",
            sequence: "GCTA",
          },
          {
            id: "seq3",
            sequence: "ATCG",
          },
        ]);

        const set = new SequenceSet(sequences);

        expect(set.size).toBe(2);
        expect(set.toArray().length).toBe(2);
      });
    });

    describe("set operations", () => {
      test("all four set operations work correctly", () => {
        const setA = new SequenceSet(
          toSequences([
            {
              id: "seq1",
              sequence: "ATCG",
            },
            {
              id: "seq2",
              sequence: "GCTA",
            },
          ])
        );
        const setB = new SequenceSet(
          toSequences([
            {
              id: "seq3",
              sequence: "GCTA",
            },
            {
              id: "seq4",
              sequence: "TTTT",
            },
          ])
        );

        const union = setA.union(setB);
        expect(union.size).toBe(3);

        const intersection = setA.intersection(setB);
        expect(intersection.size).toBe(1);

        const difference = setA.difference(setB);
        expect(difference.size).toBe(1);
        expect(difference.toArray()[0]!.sequence).toEqualSequence("ATCG");

        const symDiff = setA.symmetricDifference(setB);
        expect(symDiff.size).toBe(2);
      });
    });

    describe("comparison methods", () => {
      test("equals, isSubsetOf, isSupersetOf, isDisjointFrom work correctly", () => {
        const setA = new SequenceSet(
          toSequences([
            {
              id: "seq1",
              sequence: "ATCG",
            },
          ])
        );
        const setB = new SequenceSet(
          toSequences([
            {
              id: "seq2",
              sequence: "ATCG",
            },
          ])
        );
        const setC = new SequenceSet(
          toSequences([
            {
              id: "seq3",
              sequence: "ATCG",
            },
            {
              id: "seq4",
              sequence: "GCTA",
            },
          ])
        );
        const setD = new SequenceSet(
          toSequences([
            {
              id: "seq5",
              sequence: "TTTT",
            },
          ])
        );

        expect(setA.equals(setB)).toBe(true);
        expect(setA.isSubsetOf(setC)).toBe(true);
        expect(setC.isSupersetOf(setA)).toBe(true);
        expect(setA.isDisjointFrom(setD)).toBe(true);
      });
    });

    describe("similarity metrics", () => {
      test("jaccardSimilarity, containment, overlap work correctly", () => {
        const setA = new SequenceSet(
          toSequences([
            {
              id: "seq1",
              sequence: "ATCG",
            },
            {
              id: "seq2",
              sequence: "GCTA",
            },
          ])
        );
        const setB = new SequenceSet(
          toSequences([
            {
              id: "seq3",
              sequence: "GCTA",
            },
            {
              id: "seq4",
              sequence: "TTTT",
            },
          ])
        );

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
        const set = new SequenceSet(
          toSequences([
            {
              id: "seq1",
              sequence: "ATCG",
            },
            {
              id: "seq2",
              sequence: "GCTA",
            },
          ])
        );

        expect(set.has("ATCG")).toBe(true);
        expect(set.has("TTTT")).toBe(false);

        const seq = set.get("ATCG");
        expect(seq?.id).toBe("seq1");

        const arr = set.toArray();
        expect(arr.length).toBe(2);

        const filtered = set.filter((s) => s.sequence.startsWith("A"));
        expect(filtered.size).toBe(1);

        const mapped = set.map((s) => ({ ...s, id: s.id.toUpperCase() }));
        expect(mapped.toArray()[0]!.id).toBe("SEQ1");
      });
    });

    describe("iterators", () => {
      test("Symbol.iterator and Symbol.asyncIterator work correctly", async () => {
        const set = new SequenceSet(
          toSequences([
            {
              id: "seq1",
              sequence: "ATCG",
            },
            {
              id: "seq2",
              sequence: "GCTA",
            },
          ])
        );

        const syncItems: AbstractSequence[] = [];
        for (const seq of set) {
          syncItems.push(seq);
        }
        expect(syncItems.length).toBe(2);

        const asyncItems: AbstractSequence[] = [];
        for await (const seq of set) {
          asyncItems.push(seq);
        }
        expect(asyncItems.length).toBe(2);
      });
    });

    describe("Edge cases", () => {
      test("set operations handle all-duplicate input", () => {
        const sequences = toSequences([
          { id: "seq1", sequence: "ATCG" },
          { id: "seq2", sequence: "ATCG" },
          { id: "seq3", sequence: "ATCG" },
        ]);

        const set = new SequenceSet(sequences);
        expect(set.size).toBe(1);
      });

      test("set operations handle empty sets", () => {
        const emptySet = new SequenceSet<AbstractSequence>([]);
        const nonEmptySet = new SequenceSet<AbstractSequence>(
          toSequences([{ id: "seq1", sequence: "ATCG" }])
        );

        expect(emptySet.union(nonEmptySet).size).toBe(1);
        expect(emptySet.intersection(nonEmptySet).size).toBe(0);
        expect(emptySet.difference(nonEmptySet).size).toBe(0);
      });
    });
  });
});
