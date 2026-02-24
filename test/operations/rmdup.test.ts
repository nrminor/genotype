/**
 * Tests for RmdupProcessor - Sequence deduplication operations
 *
 * Comprehensive test suite for deduplication functionality leveraging
 * existing Bloom filter and exact deduplication infrastructure.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import "../matchers";
import { createFastaRecord } from "../../src/constructors";
import { RmdupProcessor } from "../../src/operations/rmdup";
import type { RmdupOptions } from "../../src/operations/types";
import type { AbstractSequence } from "../../src/types";

function createSequence(id: string, sequence: string, description?: string): AbstractSequence {
  return createFastaRecord({ id, sequence, description });
}

/** Convert an array to an async iterable */
async function* toAsync<T>(arr: T[]): AsyncGenerator<T> {
  for (const item of arr) {
    yield item;
  }
}

describe("RmdupProcessor", () => {
  let processor: RmdupProcessor;
  let testSequences: AbstractSequence[];
  let duplicateSequences: AbstractSequence[];

  beforeEach(() => {
    processor = new RmdupProcessor();

    // Test sequences with intentional duplicates
    testSequences = [
      createSequence("unique_1", "ATCGATCGATCG", "First unique sequence"),
      createSequence("duplicate_id", "GGCCAATTGGCC", "First occurrence"),
      createSequence("duplicate_id", "TTAACCGGTTAA", "Second occurrence with same ID"),
      createSequence("unique_2", "GGCCAATTGGCC", "Different ID, same sequence"),
      createSequence("unique_3", "GCGCGCGCGCGC", "Another unique sequence"),
    ];

    // Sequences with exact duplicates for testing
    duplicateSequences = [
      createSequence("seq1", "ATCGATCG"),
      createSequence("seq2", "GGCCAATT"),
      createSequence("seq1", "ATCGATCG"), // Exact duplicate
      createSequence("seq3", "TTAACCGG"),
      createSequence("seq2", "GGCCAATT"), // Exact duplicate
      createSequence("seq4", "ATCGATCG"), // Same sequence, different ID
    ];
  });

  describe("sequence-based deduplication", () => {
    test("removes duplicate sequences (keeps first occurrence)", async () => {
      const options: RmdupOptions = {
        by: "sequence",
      };

      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(duplicateSequences), options)) {
        results.push(seq);
      }

      // Should have 4 unique sequences (ATCGATCG, GGCCAATT, TTAACCGG)
      expect(results).toHaveLength(3);

      // Check that first occurrences are kept
      expect(results.find((s) => s.sequence.equals("ATCGATCG"))?.id).toBe("seq1");
      expect(results.find((s) => s.sequence.equals("GGCCAATT"))?.id).toBe("seq2");
      expect(results.find((s) => s.sequence.equals("TTAACCGG"))?.id).toBe("seq3");
    });

    test("case-insensitive sequence deduplication", async () => {
      const caseTestSeqs: AbstractSequence[] = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "atcg"), // Same sequence, different case
        createSequence("seq3", "GGCC"),
      ];

      const options: RmdupOptions = {
        by: "sequence",
        caseSensitive: false,
      };

      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(caseTestSeqs), options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(2); // ATCG and GGCC (case-insensitive)
      expect(results[0]!.id).toBe("seq1"); // First occurrence kept
    });
  });

  describe("ID-based deduplication", () => {
    test("removes duplicate IDs (keeps first occurrence)", async () => {
      const options: RmdupOptions = {
        by: "id",
      };

      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(duplicateSequences), options)) {
        results.push(seq);
      }

      // Should have 4 unique IDs (seq1, seq2, seq3, seq4)
      expect(results).toHaveLength(4);

      // Check that first occurrences are kept
      const seq1Result = results.find((s) => s.id === "seq1");
      expect(seq1Result?.sequence).toEqualSequence("ATCGATCG");

      const seq2Result = results.find((s) => s.id === "seq2");
      expect(seq2Result?.sequence).toEqualSequence("GGCCAATT");
    });
  });

  describe("both ID and sequence deduplication", () => {
    test("removes duplicates matching both ID and sequence", async () => {
      const options: RmdupOptions = {
        by: "both",
      };

      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(duplicateSequences), options)) {
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

      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(duplicateSequences), options)) {
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

      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(duplicateSequences), options)) {
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
        largeDataset.push(createSequence(`unique_${i}`, `ATCG${"N".repeat(i)}CGTA`));
      }

      // Add 100 duplicates of the first 10 sequences
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
          largeDataset.push(createSequence(`duplicate_${i}_${j}`, `ATCG${"N".repeat(i)}CGTA`)); // Same sequence as unique_i
        }
      }

      const options: RmdupOptions = {
        by: "sequence",
        expectedUnique: 100,
        falsePositiveRate: 0.001,
      };

      const startTime = Date.now();
      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(largeDataset), options)) {
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
      } as unknown as RmdupOptions;

      await expect(async () => {
        for await (const _seq of processor.process(toAsync(testSequences), options)) {
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
        for await (const _seq of processor.process(toAsync(testSequences), options)) {
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
        for await (const _seq of processor.process(toAsync(testSequences), options)) {
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

      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync([]), options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(0);
    });

    test("handles single sequence", async () => {
      const singleSeq: AbstractSequence[] = [testSequences[0]!];
      const options: RmdupOptions = {
        by: "both",
      };

      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(singleSeq), options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("unique_1");
    });

    test("handles sequences with empty descriptions", async () => {
      const seqsNoDesc: AbstractSequence[] = [
        createSequence("seq_1", "ATCGATCG"),
        createSequence("seq_2", "ATCGATCG"), // Duplicate sequence
        createSequence("seq_3", "GGCCAATT"),
      ];

      const options: RmdupOptions = {
        by: "sequence",
      };

      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(seqsNoDesc), options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(2); // Two unique sequences
    });
  });

  describe("genomic workflow integration", () => {
    test("PCR duplicate removal simulation", async () => {
      // Simulate PCR duplicates - same sequence, different IDs
      const pcrDuplicates: AbstractSequence[] = [
        createSequence("read_1", "ATCGATCGATCG"),
        createSequence("read_2", "GGCCAATTGGCC"),
        createSequence("read_1_dup1", "ATCGATCGATCG"), // PCR duplicate
        createSequence("read_1_dup2", "ATCGATCGATCG"), // PCR duplicate
        createSequence("read_3", "TTAACCGGTTAA"),
        createSequence("read_2_dup1", "GGCCAATTGGCC"), // PCR duplicate
      ];

      const options: RmdupOptions = {
        by: "sequence", // Remove by sequence content (ignore ID differences)
        caseSensitive: true,
      };

      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(pcrDuplicates), options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(3); // 3 unique sequences

      // Should keep first occurrence of each unique sequence
      expect(results.find((s) => s.sequence.equals("ATCGATCGATCG"))?.id).toBe("read_1");
      expect(results.find((s) => s.sequence.equals("GGCCAATTGGCC"))?.id).toBe("read_2");
      expect(results.find((s) => s.sequence.equals("TTAACCGGTTAA"))?.id).toBe("read_3");
    });

    test("assembly redundancy removal simulation", async () => {
      // Simulate assembly contigs with redundant sequences
      const assemblyContigs: AbstractSequence[] = [
        createSequence("contig_1", "ATCGATCGATCGATCG"),
        createSequence("contig_2", "GGCCAATTGGCCAATT"),
        createSequence("contig_1_v2", "ATCGATCGATCGATCG"), // Redundant
        createSequence("contig_3", "TTAACCGGTTAACCGG"),
      ];

      const options: RmdupOptions = {
        by: "sequence",
        exact: true, // Use exact matching for assembly data
      };

      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(assemblyContigs), options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(3); // Remove redundant contig
      expect(results.find((s) => s.sequence.equals("ATCGATCGATCGATCG"))?.id).toBe("contig_1");
    });
  });

  describe("performance and memory characteristics", () => {
    test("Bloom filter deduplication scales with large datasets", async () => {
      // Create larger dataset for performance testing
      const largeDataset: AbstractSequence[] = [];

      // 500 unique sequences + 500 duplicates
      for (let i = 0; i < 500; i++) {
        largeDataset.push(createSequence(`unique_${i}`, `ATCG${"N".repeat(i % 100)}CGTA`));

        // Add duplicate
        largeDataset.push(createSequence(`dup_${i}`, `ATCG${"N".repeat(i % 100)}CGTA`)); // Same sequence
      }

      const options: RmdupOptions = {
        by: "sequence",
        exact: false, // Use Bloom filter
        expectedUnique: 500,
        falsePositiveRate: 0.001,
      };

      const startTime = Date.now();
      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(largeDataset), options)) {
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

      const results: AbstractSequence[] = [];
      for await (const seq of processor.process(toAsync(duplicateSequences), options)) {
        results.push(seq);
      }

      // Should be exactly 3 unique sequences with perfect accuracy
      expect(results).toHaveLength(3);

      // Verify no duplicates remain
      const sequences = results.map((s) => s.sequence.toString());
      const uniqueSequences = new Set(sequences);
      expect(sequences.length).toBe(uniqueSequences.size);
    });
  });
});
