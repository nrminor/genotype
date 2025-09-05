/**
 * Integration tests for SequenceDeduplicator
 *
 * Tests deduplication strategies, statistics, and memory efficiency
 */

import { describe, expect, test } from "bun:test";
import {
  deduplicateSequences,
  ExactDeduplicator,
  findDuplicates,
  SequenceDeduplicator,
} from "../../../src/operations/core/sequence-deduplicator";
import type { Sequence } from "../../../src/types";

describe("SequenceDeduplicator", () => {
  // Test data with various duplicates
  const sequences: Sequence[] = [
    { id: "seq1", sequence: "ATCGATCG", type: "dna", description: "First" },
    { id: "seq2", sequence: "GCGCGCGC", type: "dna", description: "Unique" },
    { id: "seq1", sequence: "ATCGATCG", type: "dna", description: "First" }, // Exact duplicate
    {
      id: "seq3",
      sequence: "ATCGATCG",
      type: "dna",
      description: "Different ID",
    }, // Same sequence
    {
      id: "seq1",
      sequence: "GCGCGCGC",
      type: "dna",
      description: "Different seq",
    }, // Same ID
    { id: "seq4", sequence: "atcgatcg", type: "dna", description: "Lowercase" },
    {
      id: "seq5",
      sequence: "TTTTTTTT",
      type: "dna",
      description: "Another unique",
    },
  ];

  async function* createAsyncSequences(): AsyncGenerator<Sequence> {
    for (const seq of sequences) {
      yield seq;
    }
  }

  describe("Basic Deduplication", () => {
    test("deduplicates by both ID and sequence (default)", async () => {
      const dedup = new SequenceDeduplicator();
      const unique: Sequence[] = [];

      for await (const seq of dedup.deduplicate(createAsyncSequences())) {
        unique.push(seq);
      }

      // seq1:ATCGATCG appears at index 0 and 2 (duplicate)
      // All others are unique combinations
      expect(unique).toHaveLength(6);

      const stats = dedup.getStats();
      expect(stats.totalProcessed).toBe(7);
      expect(stats.uniqueCount).toBe(6);
      expect(stats.duplicateCount).toBe(1);
    });

    test("deduplicates by sequence only", async () => {
      const dedup = new SequenceDeduplicator({ strategy: "sequence" });
      const unique: Sequence[] = [];

      for await (const seq of dedup.deduplicate(createAsyncSequences())) {
        unique.push(seq);
      }

      // ATCGATCG appears 3 times (seq1 x2, seq3)
      // GCGCGCGC appears 2 times (seq2, seq1 with different sequence)
      // atcgatcg and TTTTTTTT are unique
      expect(unique).toHaveLength(4);

      const stats = dedup.getStats();
      expect(stats.duplicateCount).toBe(3);
    });

    test("deduplicates by ID only", async () => {
      const dedup = new SequenceDeduplicator({ strategy: "id" });
      const unique: Sequence[] = [];

      for await (const seq of dedup.deduplicate(createAsyncSequences())) {
        unique.push(seq);
      }

      // seq1 appears 3 times
      // seq2, seq3, seq4, seq5 are unique
      expect(unique).toHaveLength(5);

      const stats = dedup.getStats();
      expect(stats.duplicateCount).toBe(2);
    });

    test("exact matching strategy", async () => {
      const dedup = new SequenceDeduplicator({ strategy: "exact" });
      const unique: Sequence[] = [];

      for await (const seq of dedup.deduplicate(createAsyncSequences())) {
        unique.push(seq);
      }

      // Only exact matches (all fields) are considered duplicates
      // seq1:ATCGATCG:"First" appears twice
      expect(unique).toHaveLength(6);
    });
  });

  describe("Case Sensitivity", () => {
    test("case-sensitive deduplication (default)", async () => {
      const dedup = new SequenceDeduplicator({
        strategy: "sequence",
        caseSensitive: true,
      });

      const testSeqs = [
        { id: "a", sequence: "ATCG", type: "dna" as const },
        { id: "b", sequence: "atcg", type: "dna" as const },
        { id: "c", sequence: "AtCg", type: "dna" as const },
      ];

      async function* testStream(): AsyncGenerator<Sequence> {
        for (const seq of testSeqs) yield seq;
      }

      const unique: Sequence[] = [];
      for await (const seq of dedup.deduplicate(testStream())) {
        unique.push(seq);
      }

      // All three are different when case-sensitive
      expect(unique).toHaveLength(3);
    });

    test("case-insensitive deduplication", async () => {
      const dedup = new SequenceDeduplicator({
        strategy: "sequence",
        caseSensitive: false,
      });

      const testSeqs = [
        { id: "a", sequence: "ATCG", type: "dna" as const },
        { id: "b", sequence: "atcg", type: "dna" as const },
        { id: "c", sequence: "AtCg", type: "dna" as const },
      ];

      async function* testStream(): AsyncGenerator<Sequence> {
        for (const seq of testSeqs) yield seq;
      }

      const unique: Sequence[] = [];
      for await (const seq of dedup.deduplicate(testStream())) {
        unique.push(seq);
      }

      // All three are the same when case-insensitive
      expect(unique).toHaveLength(1);
      expect(unique[0].id).toBe("a"); // First one is kept
    });
  });

  describe("Custom Deduplication Strategy", () => {
    test("custom key function", async () => {
      // Deduplicate by first 4 bases only
      const customKey = (seq: Sequence) => seq.sequence.substring(0, 4);

      const dedup = new SequenceDeduplicator({ strategy: customKey });
      const unique: Sequence[] = [];

      const testSeqs = [
        { id: "a", sequence: "ATCGATCG", type: "dna" as const },
        { id: "b", sequence: "ATCGTTTT", type: "dna" as const }, // Same first 4
        { id: "c", sequence: "GCGCATCG", type: "dna" as const }, // Different first 4
      ];

      async function* testStream(): AsyncGenerator<Sequence> {
        for (const seq of testSeqs) yield seq;
      }

      for await (const seq of dedup.deduplicate(testStream())) {
        unique.push(seq);
      }

      expect(unique).toHaveLength(2);
      expect(unique[0].id).toBe("a");
      expect(unique[1].id).toBe("c");
    });
  });

  describe("Duplicate Tracking", () => {
    test("tracks duplicate counts when enabled", async () => {
      const dedup = new SequenceDeduplicator({
        strategy: "sequence",
        trackDuplicates: true,
      });

      await dedup.process(createAsyncSequences());

      const stats = dedup.getStats();
      expect(stats.topDuplicates).toBeDefined();
      expect(stats.topDuplicates?.length).toBeGreaterThan(0);

      // seq1 appears multiple times
      const seq1Dups = stats.topDuplicates?.find((d) => d.id === "seq1");
      expect(seq1Dups).toBeDefined();
      expect(seq1Dups?.count).toBeGreaterThan(0);
    });

    test("returns top 10 duplicates sorted by count", async () => {
      const dedup = new SequenceDeduplicator({
        strategy: "id",
        trackDuplicates: true,
      });

      // Create many duplicates
      async function* manyDuplicates(): AsyncGenerator<Sequence> {
        for (let i = 0; i < 5; i++) {
          yield { id: "common", sequence: `SEQ${i}`, type: "dna" };
        }
        for (let i = 0; i < 3; i++) {
          yield { id: "medium", sequence: `SEQ${i}`, type: "dna" };
        }
        yield { id: "rare", sequence: "SEQ", type: "dna" };
      }

      await dedup.process(manyDuplicates());

      const stats = dedup.getStats();
      expect(stats.topDuplicates?.[0].id).toBe("common");
      expect(stats.topDuplicates?.[0].count).toBe(4); // 5 total, 4 duplicates
    });
  });

  describe("Bloom Filter Statistics", () => {
    test("reports memory usage and false positive rate", async () => {
      const dedup = new SequenceDeduplicator({
        expectedSequences: 100,
        falsePositiveRate: 0.01,
      });

      await dedup.process(createAsyncSequences());

      const stats = dedup.getStats();
      expect(stats.memoryUsage).toBeGreaterThan(0);
      expect(stats.estimatedFPR).toBeGreaterThanOrEqual(0);
      expect(stats.estimatedFPR).toBeLessThan(0.01);
    });
  });

  describe("Scalable Bloom Filter", () => {
    test("uses scalable filter when enabled", async () => {
      const dedup = new SequenceDeduplicator({
        scalable: true,
        expectedSequences: 10,
      });

      // Add more sequences than expected
      async function* manySequences(): AsyncGenerator<Sequence> {
        for (let i = 0; i < 100; i++) {
          yield { id: `seq${i}`, sequence: `ATCG${i}`, type: "dna" };
        }
      }

      const unique: Sequence[] = [];
      for await (const seq of dedup.deduplicate(manySequences())) {
        unique.push(seq);
      }

      expect(unique).toHaveLength(100);

      const stats = dedup.getStats();
      expect(stats.uniqueCount).toBe(100);
      // Scalable filter should maintain low FPR despite exceeding expected size
      expect(stats.estimatedFPR).toBeLessThan(0.01);
    });
  });

  describe("Helper Methods", () => {
    test("isUnique checks if sequence has been seen", () => {
      const dedup = new SequenceDeduplicator({ strategy: "sequence" });

      const seq1 = { id: "a", sequence: "ATCG", type: "dna" as const };
      const seq2 = { id: "b", sequence: "GCTA", type: "dna" as const };

      expect(dedup.isUnique(seq1)).toBe(true);
      dedup.markAsSeen(seq1);
      expect(dedup.isUnique(seq1)).toBe(false);
      expect(dedup.isUnique(seq2)).toBe(true);
    });

    test("reset clears all state", async () => {
      const dedup = new SequenceDeduplicator({ trackDuplicates: true });

      await dedup.process(createAsyncSequences());
      let stats = dedup.getStats();
      expect(stats.totalProcessed).toBeGreaterThan(0);

      dedup.reset();
      stats = dedup.getStats();
      expect(stats.totalProcessed).toBe(0);
      expect(stats.uniqueCount).toBe(0);
      expect(stats.duplicateCount).toBe(0);

      // Should work normally after reset
      const seq = { id: "test", sequence: "ATCG", type: "dna" as const };
      expect(dedup.isUnique(seq)).toBe(true);
    });

    test("process method only collects statistics", async () => {
      const dedup = new SequenceDeduplicator();

      // process() doesn't yield sequences, only counts
      await dedup.process(createAsyncSequences());

      const stats = dedup.getStats();
      expect(stats.totalProcessed).toBe(7);
      expect(stats.uniqueCount).toBeGreaterThan(0);
    });
  });

  describe("Bloom Filter Merging", () => {
    test("merges two deduplicators", async () => {
      const dedup1 = new SequenceDeduplicator({ scalable: false });
      const dedup2 = new SequenceDeduplicator({ scalable: false });

      const seqs1 = [
        { id: "a", sequence: "AAAA", type: "dna" as const },
        { id: "b", sequence: "BBBB", type: "dna" as const },
      ];

      const seqs2 = [
        { id: "c", sequence: "CCCC", type: "dna" as const },
        { id: "d", sequence: "DDDD", type: "dna" as const },
      ];

      async function* stream1(): AsyncGenerator<Sequence> {
        for (const s of seqs1) yield s;
      }

      async function* stream2(): AsyncGenerator<Sequence> {
        for (const s of seqs2) yield s;
      }

      await dedup1.process(stream1());
      await dedup2.process(stream2());

      const merged = dedup1.merge(dedup2);

      // Merged filter should recognize all sequences
      expect(merged.isUnique(seqs1[0])).toBe(false);
      expect(merged.isUnique(seqs2[0])).toBe(false);
      expect(merged.isUnique({ id: "e", sequence: "EEEE", type: "dna" })).toBe(true);
    });

    test("throws error when merging scalable filters", () => {
      const dedup1 = new SequenceDeduplicator({ scalable: true });
      const dedup2 = new SequenceDeduplicator({ scalable: true });

      expect(() => dedup1.merge(dedup2)).toThrow("Can only merge non-scalable Bloom filters");
    });
  });

  describe("ExactDeduplicator", () => {
    test("provides 100% accuracy with Set", async () => {
      const dedup = new ExactDeduplicator("sequence");
      const unique: Sequence[] = [];

      for await (const seq of dedup.deduplicate(createAsyncSequences())) {
        unique.push(seq);
      }

      // No false positives with exact deduplication
      expect(unique).toHaveLength(4); // ATCGATCG, GCGCGCGC, atcgatcg, TTTTTTTT

      const stats = dedup.getStats();
      expect(stats.totalProcessed).toBe(7);
      expect(stats.duplicateCount).toBe(3);
    });

    test("supports all deduplication strategies", async () => {
      const byId = new ExactDeduplicator("id");
      const byBoth = new ExactDeduplicator("both");
      const custom = new ExactDeduplicator((seq) => seq.sequence.length.toString());

      async function* testSeqs(): AsyncGenerator<Sequence> {
        yield { id: "a", sequence: "ATCG", type: "dna" };
        yield { id: "a", sequence: "GCTA", type: "dna" };
        yield { id: "b", sequence: "ATCG", type: "dna" };
      }

      const uniqueById: Sequence[] = [];
      for await (const seq of byId.deduplicate(testSeqs())) {
        uniqueById.push(seq);
      }
      expect(uniqueById).toHaveLength(2); // 'a' and 'b'

      const uniqueByBoth: Sequence[] = [];
      for await (const seq of byBoth.deduplicate(testSeqs())) {
        uniqueByBoth.push(seq);
      }
      expect(uniqueByBoth).toHaveLength(3); // All unique combinations

      const uniqueByLength: Sequence[] = [];
      for await (const seq of custom.deduplicate(testSeqs())) {
        uniqueByLength.push(seq);
      }
      expect(uniqueByLength).toHaveLength(1); // All have length 4
    });

    test("reports memory usage estimate", async () => {
      const dedup = new ExactDeduplicator();

      const seqs = [
        { id: "a", sequence: "ATCG", type: "dna" as const },
        { id: "b", sequence: "GCTA", type: "dna" as const },
      ];

      async function* testSequences() {
        for (const seq of seqs) {
          yield seq;
        }
      }

      // Consume the generator to process sequences
      const results = [];
      for await (const seq of dedup.deduplicate(testSequences())) {
        results.push(seq);
      }

      const stats = dedup.getStats();
      expect(stats.memoryUsage).toBeGreaterThan(0);
      expect(results).toHaveLength(2); // Both should be unique
    });
  });

  describe("Convenience Functions", () => {
    test("deduplicateSequences returns array", async () => {
      const unique = await deduplicateSequences(createAsyncSequences(), {
        strategy: "sequence",
      });

      expect(Array.isArray(unique)).toBe(true);
      expect(unique).toHaveLength(4);
    });

    test("findDuplicates reports statistics without removing", async () => {
      const stats = await findDuplicates(createAsyncSequences(), {
        strategy: "sequence",
      });

      expect(stats.totalProcessed).toBe(7);
      expect(stats.duplicateCount).toBe(3);
      expect(stats.topDuplicates).toBeDefined();
      expect(stats.topDuplicates?.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    test("handles empty stream", async () => {
      const dedup = new SequenceDeduplicator();
      const unique: Sequence[] = [];

      async function* empty(): AsyncGenerator<Sequence> {
        // Yield nothing
      }

      for await (const seq of dedup.deduplicate(empty())) {
        unique.push(seq);
      }

      expect(unique).toHaveLength(0);

      const stats = dedup.getStats();
      expect(stats.totalProcessed).toBe(0);
    });

    test("handles single sequence", async () => {
      const dedup = new SequenceDeduplicator();

      async function* single(): AsyncGenerator<Sequence> {
        yield { id: "only", sequence: "ATCG", type: "dna" };
      }

      const unique: Sequence[] = [];
      for await (const seq of dedup.deduplicate(single())) {
        unique.push(seq);
      }

      expect(unique).toHaveLength(1);
    });

    test("handles all duplicates", async () => {
      const dedup = new SequenceDeduplicator({ strategy: "sequence" });

      async function* allDuplicates(): AsyncGenerator<Sequence> {
        for (let i = 0; i < 10; i++) {
          yield { id: `seq${i}`, sequence: "SAME", type: "dna" };
        }
      }

      const unique: Sequence[] = [];
      for await (const seq of dedup.deduplicate(allDuplicates())) {
        unique.push(seq);
      }

      expect(unique).toHaveLength(1);
      expect(unique[0].id).toBe("seq0"); // First one kept

      const stats = dedup.getStats();
      expect(stats.duplicateCount).toBe(9);
    });
  });

  describe("Performance", () => {
    test("handles large number of sequences efficiently", async () => {
      const dedup = new SequenceDeduplicator({
        expectedSequences: 10000,
        falsePositiveRate: 0.001,
      });

      async function* largeDataset(): AsyncGenerator<Sequence> {
        for (let i = 0; i < 10000; i++) {
          yield {
            id: `seq${i}`,
            sequence: `ATCG${i}`,
            type: "dna",
          };
        }
      }

      const start = Date.now();
      let count = 0;

      for await (const seq of dedup.deduplicate(largeDataset())) {
        count++;
      }

      const elapsed = Date.now() - start;

      // With Bloom filter, false positives are possible
      expect(count).toBeGreaterThan(9900); // Allow for up to 1% false positives
      expect(count).toBeLessThanOrEqual(10000);
      expect(elapsed).toBeLessThan(1000); // Should complete in < 1 second

      const stats = dedup.getStats();
      // FPR should be close to the configured 0.001
      expect(stats.estimatedFPR).toBeLessThan(0.002); // Allow some variance
    });

    test("bloom filter uses less memory than exact deduplication", async () => {
      const bloomDedup = new SequenceDeduplicator({
        expectedSequences: 1000,
        falsePositiveRate: 0.01,
      });

      const exactDedup = new ExactDeduplicator();

      async function* dataset(): AsyncGenerator<Sequence> {
        for (let i = 0; i < 1000; i++) {
          yield {
            id: `seq${i}`,
            sequence: "A".repeat(100), // Long sequences
            type: "dna",
          };
        }
      }

      // Process with bloom filter
      await bloomDedup.process(dataset());

      // Process with exact deduplicator (use deduplicate method)
      for await (const seq of exactDedup.deduplicate(dataset())) {
        // Just consume the generator
      }

      const bloomStats = bloomDedup.getStats();
      const exactStats = exactDedup.getStats();

      // Bloom filter should use significantly less memory
      expect(bloomStats.memoryUsage).toBeLessThan(exactStats.memoryUsage);
    });
  });
});
