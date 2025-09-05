/**
 * Tests for RmdupProcessor - Sequence deduplication operations
 *
 * Comprehensive test suite for deduplication functionality leveraging
 * existing Bloom filter and exact deduplication infrastructure.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { RmdupProcessor } from "../../src/operations/rmdup";
import type { AbstractSequence, FastqSequence, RmdupOptions } from "../../src/types";

describe("RmdupProcessor", () => {
  let processor: RmdupProcessor;
  let testSequences: AbstractSequence[];
  let duplicateSequences: AbstractSequence[];

  beforeEach(() => {
    processor = new RmdupProcessor();

    // Test sequences with intentional duplicates
    testSequences = [
      {
        id: "unique_1",
        sequence: "ATCGATCGATCG",
        length: 12,
        description: "First unique sequence",
      },
      {
        id: "duplicate_id",
        sequence: "GGCCAATTGGCC",
        length: 12,
        description: "First occurrence",
      },
      {
        id: "duplicate_id", // Same ID as above
        sequence: "TTAACCGGTTAA", // Different sequence
        length: 12,
        description: "Second occurrence with same ID",
      },
      {
        id: "unique_2",
        sequence: "GGCCAATTGGCC", // Same sequence as duplicate_id
        length: 12,
        description: "Different ID, same sequence",
      },
      {
        id: "unique_3",
        sequence: "GCGCGCGCGCGC",
        length: 12,
        description: "Another unique sequence",
      },
    ];

    // Sequences with exact duplicates for testing
    duplicateSequences = [
      { id: "seq1", sequence: "ATCGATCG", length: 8 },
      { id: "seq2", sequence: "GGCCAATT", length: 8 },
      { id: "seq1", sequence: "ATCGATCG", length: 8 }, // Exact duplicate
      { id: "seq3", sequence: "TTAACCGG", length: 8 },
      { id: "seq2", sequence: "GGCCAATT", length: 8 }, // Exact duplicate
      { id: "seq4", sequence: "ATCGATCG", length: 8 }, // Same sequence, different ID
    ];
  });

  describe("sequence-based deduplication", () => {
    test("removes duplicate sequences (keeps first occurrence)", async () => {
      const options: RmdupOptions = {
        by: "sequence",
      };

      const results = [];
      for await (const seq of processor.process(duplicateSequences, options)) {
        results.push(seq);
      }

      // Should have 4 unique sequences (ATCGATCG, GGCCAATT, TTAACCGG)
      expect(results).toHaveLength(3);

      // Check that first occurrences are kept
      expect(results.find((s) => s.sequence === "ATCGATCG")?.id).toBe("seq1");
      expect(results.find((s) => s.sequence === "GGCCAATT")?.id).toBe("seq2");
      expect(results.find((s) => s.sequence === "TTAACCGG")?.id).toBe("seq3");
    });

    test("case-insensitive sequence deduplication", async () => {
      const caseTestSeqs: AbstractSequence[] = [
        { id: "seq1", sequence: "ATCG", length: 4 },
        { id: "seq2", sequence: "atcg", length: 4 }, // Same sequence, different case
        { id: "seq3", sequence: "GGCC", length: 4 },
      ];

      const options: RmdupOptions = {
        by: "sequence",
        caseSensitive: false,
      };

      const results = [];
      for await (const seq of processor.process(caseTestSeqs, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(2); // ATCG and GGCC (case-insensitive)
      expect(results[0].id).toBe("seq1"); // First occurrence kept
    });
  });

  describe("ID-based deduplication", () => {
    test("removes duplicate IDs (keeps first occurrence)", async () => {
      const options: RmdupOptions = {
        by: "id",
      };

      const results = [];
      for await (const seq of processor.process(duplicateSequences, options)) {
        results.push(seq);
      }

      // Should have 4 unique IDs (seq1, seq2, seq3, seq4)
      expect(results).toHaveLength(4);

      // Check that first occurrences are kept
      const seq1Result = results.find((s) => s.id === "seq1");
      expect(seq1Result?.sequence).toBe("ATCGATCG");

      const seq2Result = results.find((s) => s.id === "seq2");
      expect(seq2Result?.sequence).toBe("GGCCAATT");
    });
  });

  describe("both ID and sequence deduplication", () => {
    test("removes duplicates matching both ID and sequence", async () => {
      const options: RmdupOptions = {
        by: "both",
      };

      const results = [];
      for await (const seq of processor.process(duplicateSequences, options)) {
        results.push(seq);
      }

      // Should remove any duplicates based on both ID and sequence
      expect(results).toHaveLength(4); // Actual result from deduplication

      // Verify unique combinations remain
      const combinations = results.map((s) => `${s.id}:${s.sequence}`);
      const uniqueCombinations = new Set(combinations);
      expect(combinations.length).toBe(uniqueCombinations.size);
    });
  });

  describe("exact vs probabilistic deduplication", () => {
    test("exact deduplication provides 100% accuracy", async () => {
      const options: RmdupOptions = {
        by: "sequence",
        exact: true,
      };

      const results = [];
      for await (const seq of processor.process(duplicateSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(3); // Exact count
    });

    test("probabilistic deduplication with Bloom filters", async () => {
      const options: RmdupOptions = {
        by: "sequence",
        exact: false,
        expectedUnique: 10,
        falsePositiveRate: 0.001,
      };

      const results = [];
      for await (const seq of processor.process(duplicateSequences, options)) {
        results.push(seq);
      }

      // Should be close to exact count (allowing for minimal false positives)
      expect(results.length).toBeGreaterThanOrEqual(3);
      expect(results.length).toBeLessThanOrEqual(4);
    });
  });

  describe("large dataset simulation", () => {
    test("handles large dataset with many duplicates efficiently", async () => {
      // Create dataset with intentional duplicates
      const largeDataset: AbstractSequence[] = [];

      // Add 100 unique sequences
      for (let i = 0; i < 100; i++) {
        largeDataset.push({
          id: `unique_${i}`,
          sequence: `ATCG${"N".repeat(i)}CGTA`,
          length: 8 + i,
        });
      }

      // Add 100 duplicates of the first 10 sequences
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
          largeDataset.push({
            id: `duplicate_${i}_${j}`,
            sequence: `ATCG${"N".repeat(i)}CGTA`, // Same sequence as unique_i
            length: 8 + i,
          });
        }
      }

      const options: RmdupOptions = {
        by: "sequence",
        expectedUnique: 100,
        falsePositiveRate: 0.001,
      };

      const startTime = Date.now();
      const results = [];
      for await (const seq of processor.process(largeDataset, options)) {
        results.push(seq);
      }
      const duration = Date.now() - startTime;

      // Should keep approximately 100 unique sequences
      expect(results.length).toBeGreaterThanOrEqual(100);
      expect(results.length).toBeLessThanOrEqual(105); // Allow small error margin
      expect(duration).toBeLessThan(1000); // Should be fast
    });
  });

  describe("error handling", () => {
    test("throws error for invalid deduplication strategy", async () => {
      const options = {
        by: "invalid",
      } as RmdupOptions;

      await expect(async () => {
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw
        }
      }).toThrow('by must be "both", "id" or "sequence"');
    });

    test("throws error for invalid expected unique count", async () => {
      const options: RmdupOptions = {
        by: "sequence",
        expectedUnique: -100,
      };

      await expect(async () => {
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw
        }
      }).toThrow("expectedUnique must be positive");
    });

    test("throws error for invalid false positive rate", async () => {
      const options: RmdupOptions = {
        by: "sequence",
        falsePositiveRate: 0.5, // Too high
      };

      await expect(async () => {
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw
        }
      }).toThrow("falsePositiveRate must be at most 0.1");
    });
  });

  describe("edge cases", () => {
    test("handles empty input", async () => {
      const options: RmdupOptions = {
        by: "sequence",
      };

      const results = [];
      for await (const seq of processor.process([], options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(0);
    });

    test("handles single sequence", async () => {
      const singleSeq = [testSequences[0]];
      const options: RmdupOptions = {
        by: "both",
      };

      const results = [];
      for await (const seq of processor.process(singleSeq, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("unique_1");
    });

    test("handles sequences with empty descriptions", async () => {
      const seqsNoDesc: AbstractSequence[] = [
        { id: "seq_1", sequence: "ATCGATCG", length: 8 },
        { id: "seq_2", sequence: "ATCGATCG", length: 8 }, // Duplicate sequence
        { id: "seq_3", sequence: "GGCCAATT", length: 8 },
      ];

      const options: RmdupOptions = {
        by: "sequence",
      };

      const results = [];
      for await (const seq of processor.process(seqsNoDesc, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(2); // Two unique sequences
    });
  });

  describe("genomic workflow integration", () => {
    test("PCR duplicate removal simulation", async () => {
      // Simulate PCR duplicates - same sequence, different IDs
      const pcrDuplicates: AbstractSequence[] = [
        { id: "read_1", sequence: "ATCGATCGATCG", length: 12 },
        { id: "read_2", sequence: "GGCCAATTGGCC", length: 12 },
        { id: "read_1_dup1", sequence: "ATCGATCGATCG", length: 12 }, // PCR duplicate
        { id: "read_1_dup2", sequence: "ATCGATCGATCG", length: 12 }, // PCR duplicate
        { id: "read_3", sequence: "TTAACCGGTTAA", length: 12 },
        { id: "read_2_dup1", sequence: "GGCCAATTGGCC", length: 12 }, // PCR duplicate
      ];

      const options: RmdupOptions = {
        by: "sequence", // Remove by sequence content (ignore ID differences)
        caseSensitive: true,
      };

      const results = [];
      for await (const seq of processor.process(pcrDuplicates, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(3); // 3 unique sequences

      // Should keep first occurrence of each unique sequence
      expect(results.find((s) => s.sequence === "ATCGATCGATCG")?.id).toBe("read_1");
      expect(results.find((s) => s.sequence === "GGCCAATTGGCC")?.id).toBe("read_2");
      expect(results.find((s) => s.sequence === "TTAACCGGTTAA")?.id).toBe("read_3");
    });

    test("assembly redundancy removal simulation", async () => {
      // Simulate assembly contigs with redundant sequences
      const assemblyContigs: AbstractSequence[] = [
        { id: "contig_1", sequence: "ATCGATCGATCGATCG", length: 16 },
        { id: "contig_2", sequence: "GGCCAATTGGCCAATT", length: 16 },
        { id: "contig_1_v2", sequence: "ATCGATCGATCGATCG", length: 16 }, // Redundant
        { id: "contig_3", sequence: "TTAACCGGTTAACCGG", length: 16 },
      ];

      const options: RmdupOptions = {
        by: "sequence",
        exact: true, // Use exact matching for assembly data
      };

      const results = [];
      for await (const seq of processor.process(assemblyContigs, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(3); // Remove redundant contig
      expect(results.find((s) => s.sequence === "ATCGATCGATCGATCG")?.id).toBe("contig_1");
    });
  });

  describe("performance and memory characteristics", () => {
    test("Bloom filter deduplication scales with large datasets", async () => {
      // Create larger dataset for performance testing
      const largeDataset: AbstractSequence[] = [];

      // 500 unique sequences + 500 duplicates
      for (let i = 0; i < 500; i++) {
        largeDataset.push({
          id: `unique_${i}`,
          sequence: `ATCG${"N".repeat(i % 100)}CGTA`,
          length: 8 + (i % 100),
        });

        // Add duplicate
        largeDataset.push({
          id: `dup_${i}`,
          sequence: `ATCG${"N".repeat(i % 100)}CGTA`, // Same sequence
          length: 8 + (i % 100),
        });
      }

      const options: RmdupOptions = {
        by: "sequence",
        exact: false, // Use Bloom filter
        expectedUnique: 500,
        falsePositiveRate: 0.001,
      };

      const startTime = Date.now();
      const results = [];
      for await (const seq of processor.process(largeDataset, options)) {
        results.push(seq);
      }
      const duration = Date.now() - startTime;

      // Should keep approximately 100 unique sequences (not 500)
      // The dataset has 500 unique + 500 duplicates, so ~100 unique patterns
      expect(results.length).toBeGreaterThan(90); // Allow for false positives
      expect(results.length).toBeLessThan(110);
      expect(duration).toBeLessThan(2000); // Should be efficient
    });

    test("exact deduplication provides perfect accuracy", async () => {
      const options: RmdupOptions = {
        by: "sequence",
        exact: true,
      };

      const results = [];
      for await (const seq of processor.process(duplicateSequences, options)) {
        results.push(seq);
      }

      // Should be exactly 3 unique sequences with perfect accuracy
      expect(results).toHaveLength(3);

      // Verify no duplicates remain
      const sequences = results.map((s) => s.sequence);
      const uniqueSequences = new Set(sequences);
      expect(sequences.length).toBe(uniqueSequences.size);
    });
  });
});
