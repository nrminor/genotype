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
import { createFastaRecord } from "../../../src/constructors";
import type { AbstractSequence } from "../../../src/types";

/** Helper to create test sequences with required length field */
function seq(id: string, sequence: string, description?: string): AbstractSequence {
  return createFastaRecord({ id, sequence, description });
}

describe("SequenceDeduplicator", () => {
  // Test data with various duplicates
  const sequences: AbstractSequence[] = [
    seq("seq1", "ATCGATCG", "First"),
    seq("seq2", "GCGCGCGC", "Unique"),
    seq("seq1", "ATCGATCG", "First"), // Exact duplicate
    seq("seq3", "ATCGATCG", "Different ID"), // Same sequence
    seq("seq1", "GCGCGCGC", "Different seq"), // Same ID
    seq("seq4", "atcgatcg", "Lowercase"),
    seq("seq5", "TTTTTTTT", "Another unique"),
  ];

  async function* createAsyncSequences(): AsyncGenerator<AbstractSequence> {
    for (const seq of sequences) {
      yield seq;
    }
  }

  describe("Basic Deduplication", () => {
    test("deduplicates by both ID and sequence (default)", async () => {
      const dedup = new SequenceDeduplicator();
      const unique: AbstractSequence[] = [];

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
      const unique: AbstractSequence[] = [];

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
      const unique: AbstractSequence[] = [];

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
      const unique: AbstractSequence[] = [];

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

      const testSeqs = [seq("a", "ATCG"), seq("b", "atcg"), seq("c", "AtCg")];

      async function* testStream(): AsyncGenerator<AbstractSequence> {
        for (const s of testSeqs) yield s;
      }

      const unique: AbstractSequence[] = [];
      for await (const s of dedup.deduplicate(testStream())) {
        unique.push(s);
      }

      // All three are different when case-sensitive
      expect(unique).toHaveLength(3);
    });

    test("case-insensitive deduplication", async () => {
      const dedup = new SequenceDeduplicator({
        strategy: "sequence",
        caseSensitive: false,
      });

      const testSeqs = [seq("a", "ATCG"), seq("b", "atcg"), seq("c", "AtCg")];

      async function* testStream(): AsyncGenerator<AbstractSequence> {
        for (const s of testSeqs) yield s;
      }

      const unique: AbstractSequence[] = [];
      for await (const s of dedup.deduplicate(testStream())) {
        unique.push(s);
      }

      // All three are the same when case-insensitive
      expect(unique).toHaveLength(1);
      expect(unique[0]!.id).toBe("a"); // First one is kept
    });
  });

  describe("Custom Deduplication Strategy", () => {
    test("custom key function", async () => {
      // Deduplicate by first 4 bases only
      const customKey = (seq: AbstractSequence) => seq.sequence.slice(0, 4).toString();

      const dedup = new SequenceDeduplicator({ strategy: customKey });
      const unique: AbstractSequence[] = [];

      const testSeqs = [
        seq("a", "ATCGATCG"),
        seq("b", "ATCGTTTT"), // Same first 4
        seq("c", "GCGCATCG"), // Different first 4
      ];

      async function* testStream(): AsyncGenerator<AbstractSequence> {
        for (const s of testSeqs) yield s;
      }

      for await (const s of dedup.deduplicate(testStream())) {
        unique.push(s);
      }

      expect(unique).toHaveLength(2);
      expect(unique[0]!.id).toBe("a");
      expect(unique[1]!.id).toBe("c");
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
      async function* manyDuplicates(): AsyncGenerator<AbstractSequence> {
        for (let i = 0; i < 5; i++) {
          yield seq("common", `SEQ${i}`);
        }
        for (let i = 0; i < 3; i++) {
          yield seq("medium", `SEQ${i}`);
        }
        yield seq("rare", "SEQ");
      }

      await dedup.process(manyDuplicates());

      const stats = dedup.getStats();
      expect(stats.topDuplicates?.[0]!.id).toBe("common");
      expect(stats.topDuplicates?.[0]!.count).toBe(4); // 5 total, 4 duplicates
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
      async function* manySequences(): AsyncGenerator<AbstractSequence> {
        for (let i = 0; i < 100; i++) {
          yield seq(`seq${i}`, `ATCG${i}`);
        }
      }

      const unique: AbstractSequence[] = [];
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

      const seq1 = seq("a", "ATCG");
      const seq2 = seq("b", "GCTA");

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
      const testSeq = seq("test", "ATCG");
      expect(dedup.isUnique(testSeq)).toBe(true);
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

      const seqs1 = [seq("a", "AAAA"), seq("b", "BBBB")];
      const seqs2 = [seq("c", "CCCC"), seq("d", "DDDD")];

      async function* stream1(): AsyncGenerator<AbstractSequence> {
        for (const s of seqs1) yield s;
      }

      async function* stream2(): AsyncGenerator<AbstractSequence> {
        for (const s of seqs2) yield s;
      }

      await dedup1.process(stream1());
      await dedup2.process(stream2());

      const merged = dedup1.merge(dedup2);

      // Merged filter should recognize all sequences
      expect(merged.isUnique(seqs1[0]!)).toBe(false);
      expect(merged.isUnique(seqs2[0]!)).toBe(false);
      expect(merged.isUnique(seq("e", "EEEE"))).toBe(true);
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
      const unique: AbstractSequence[] = [];

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
      const custom = new ExactDeduplicator((s) => s.sequence.length.toString());

      async function* testSeqs(): AsyncGenerator<AbstractSequence> {
        yield seq("a", "ATCG");
        yield seq("a", "GCTA");
        yield seq("b", "ATCG");
      }

      const uniqueById: AbstractSequence[] = [];
      for await (const s of byId.deduplicate(testSeqs())) {
        uniqueById.push(s);
      }
      expect(uniqueById).toHaveLength(2); // 'a' and 'b'

      const uniqueByBoth: AbstractSequence[] = [];
      for await (const s of byBoth.deduplicate(testSeqs())) {
        uniqueByBoth.push(s);
      }
      expect(uniqueByBoth).toHaveLength(3); // All unique combinations

      const uniqueByLength: AbstractSequence[] = [];
      for await (const s of custom.deduplicate(testSeqs())) {
        uniqueByLength.push(s);
      }
      expect(uniqueByLength).toHaveLength(1); // All have length 4
    });

    test("reports memory usage estimate", async () => {
      const dedup = new ExactDeduplicator();

      const seqs = [seq("a", "ATCG"), seq("b", "GCTA")];

      async function* testSequences(): AsyncGenerator<AbstractSequence> {
        for (const s of seqs) {
          yield s;
        }
      }

      // Consume the generator to process sequences
      const results: AbstractSequence[] = [];
      for await (const s of dedup.deduplicate(testSequences())) {
        results.push(s);
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
      const unique: AbstractSequence[] = [];

      async function* empty(): AsyncGenerator<AbstractSequence> {
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

      async function* single(): AsyncGenerator<AbstractSequence> {
        yield seq("only", "ATCG");
      }

      const unique: AbstractSequence[] = [];
      for await (const s of dedup.deduplicate(single())) {
        unique.push(s);
      }

      expect(unique).toHaveLength(1);
    });

    test("handles all duplicates", async () => {
      const dedup = new SequenceDeduplicator({ strategy: "sequence" });

      async function* allDuplicates(): AsyncGenerator<AbstractSequence> {
        for (let i = 0; i < 10; i++) {
          yield seq(`seq${i}`, "SAME");
        }
      }

      const unique: AbstractSequence[] = [];
      for await (const s of dedup.deduplicate(allDuplicates())) {
        unique.push(s);
      }

      expect(unique).toHaveLength(1);
      expect(unique[0]!.id).toBe("seq0"); // First one kept

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

      async function* largeDataset(): AsyncGenerator<AbstractSequence> {
        for (let i = 0; i < 10000; i++) {
          yield seq(`seq${i}`, `ATCG${i}`);
        }
      }

      const start = Date.now();
      let count = 0;

      for await (const _s of dedup.deduplicate(largeDataset())) {
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

      async function* dataset(): AsyncGenerator<AbstractSequence> {
        for (let i = 0; i < 1000; i++) {
          yield seq(`seq${i}`, "A".repeat(100)); // Long sequences
        }
      }

      // Process with bloom filter
      await bloomDedup.process(dataset());

      // Process with exact deduplicator (use deduplicate method)
      for await (const _s of exactDedup.deduplicate(dataset())) {
        // Just consume the generator
      }

      const bloomStats = bloomDedup.getStats();
      const exactStats = exactDedup.getStats();

      // Bloom filter should use significantly less memory
      expect(bloomStats.memoryUsage).toBeLessThan(exactStats.memoryUsage);
    });
  });
});
