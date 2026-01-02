/**
 * Tests for sequence statistics accumulator
 */

import { describe, expect, test } from "bun:test";
import {
  calculateSequenceStats,
  type SequenceStats,
  SequenceStatsAccumulator,
} from "../../../src/operations/core/statistics";
import type { FastqSequence, Sequence } from "../../../src/types";

describe("SequenceStatsAccumulator", () => {
  describe("basic statistics", () => {
    test("should calculate basic stats for simple sequences", () => {
      const accumulator = new SequenceStatsAccumulator();

      const sequences: Sequence[] = [
        { id: "1", sequence: "ATCG", length: 4 },
        { id: "2", sequence: "ATCGATCG", length: 8 },
        { id: "3", sequence: "AT", length: 2 },
      ];

      accumulator.addMany(sequences);
      const stats = accumulator.getStats();

      expect(stats.count).toBe(3);
      expect(stats.totalLength).toBe(14);
      expect(stats.minLength).toBe(2);
      expect(stats.maxLength).toBe(8);
      expect(stats.meanLength).toBeCloseTo(14 / 3, 2);
    });

    test("should handle empty accumulator", () => {
      const accumulator = new SequenceStatsAccumulator();
      const stats = accumulator.getStats();

      expect(stats.count).toBe(0);
      expect(stats.totalLength).toBe(0);
      expect(stats.minLength).toBe(0);
      expect(stats.maxLength).toBe(0);
      expect(stats.meanLength).toBe(0);
      expect(stats.n50).toBe(0);
    });

    test("should handle single sequence", () => {
      const accumulator = new SequenceStatsAccumulator();
      accumulator.add({ id: "1", sequence: "ATCGATCG", length: 8 });

      const stats = accumulator.getStats();
      expect(stats.count).toBe(1);
      expect(stats.minLength).toBe(8);
      expect(stats.maxLength).toBe(8);
      expect(stats.meanLength).toBe(8);
      expect(stats.medianLength).toBe(8);
    });
  });

  describe("GC content and base composition", () => {
    test("should calculate GC content correctly", () => {
      const accumulator = new SequenceStatsAccumulator();

      accumulator.add({ id: "1", sequence: "GGCC", length: 4 }); // 100% GC
      accumulator.add({ id: "2", sequence: "AATT", length: 4 }); // 0% GC
      accumulator.add({ id: "3", sequence: "ATCG", length: 4 }); // 50% GC

      const stats = accumulator.getStats();
      expect(stats.gcContent).toBeCloseTo(0.5, 2); // Overall 50%
    });

    test("should count base composition", () => {
      const accumulator = new SequenceStatsAccumulator();
      accumulator.add({ id: "1", sequence: "AATTTCCCGGGG", length: 12 });

      const stats = accumulator.getStats();
      expect(stats.baseComposition["A"]).toBe(2);
      expect(stats.baseComposition["T"]).toBe(3);
      expect(stats.baseComposition["C"]).toBe(3);
      expect(stats.baseComposition["G"]).toBe(4);
    });

    test("should handle IUPAC ambiguity codes", () => {
      const accumulator = new SequenceStatsAccumulator();
      accumulator.add({ id: "1", sequence: "ATCGNRYS", length: 8 });

      const stats = accumulator.getStats();
      expect(stats.baseComposition["N"]).toBe(1);
      expect(stats.baseComposition["R"]).toBe(1);
      expect(stats.baseComposition["Y"]).toBe(1);
      expect(stats.baseComposition["S"]).toBe(1); // S counts as GC
      expect(stats.gcContent).toBeCloseTo(3 / 8, 2); // C, G, S
    });

    test("should handle lowercase sequences", () => {
      const accumulator = new SequenceStatsAccumulator();
      accumulator.add({ id: "1", sequence: "atcg", length: 4 });

      const stats = accumulator.getStats();
      expect(stats.baseComposition["A"]).toBe(1);
      expect(stats.baseComposition["T"]).toBe(1);
      expect(stats.baseComposition["C"]).toBe(1);
      expect(stats.baseComposition["G"]).toBe(1);
    });
  });

  describe("N50 and N90 calculation", () => {
    test("should calculate N50 correctly", () => {
      const accumulator = new SequenceStatsAccumulator();

      // Add sequences of lengths: 10, 8, 6, 4, 2
      // Total: 30 bp, 50% = 15 bp
      // Cumulative: 10, 18, 24, 28, 30
      // N50 should be 8 (first length where cumsum >= 15)
      accumulator.add({ id: "1", sequence: "A".repeat(10), length: 10 });
      accumulator.add({ id: "2", sequence: "A".repeat(8), length: 8 });
      accumulator.add({ id: "3", sequence: "A".repeat(6), length: 6 });
      accumulator.add({ id: "4", sequence: "A".repeat(4), length: 4 });
      accumulator.add({ id: "5", sequence: "AA", length: 2 });

      const stats = accumulator.getStats();
      expect(stats.n50).toBe(8);
    });

    test("should calculate N90 correctly", () => {
      const accumulator = new SequenceStatsAccumulator();

      // Same sequences, 90% of 30 = 27 bp
      // N90 should be 4
      accumulator.add({ id: "1", sequence: "A".repeat(10), length: 10 });
      accumulator.add({ id: "2", sequence: "A".repeat(8), length: 8 });
      accumulator.add({ id: "3", sequence: "A".repeat(6), length: 6 });
      accumulator.add({ id: "4", sequence: "A".repeat(4), length: 4 });
      accumulator.add({ id: "5", sequence: "AA", length: 2 });

      const stats = accumulator.getStats();
      expect(stats.n90).toBe(4);
    });

    test("should calculate median correctly", () => {
      const accumulator = new SequenceStatsAccumulator();

      // Odd number of sequences
      accumulator.add({ id: "1", sequence: "A".repeat(5), length: 5 });
      accumulator.add({ id: "2", sequence: "A".repeat(3), length: 3 });
      accumulator.add({ id: "3", sequence: "A".repeat(7), length: 7 });

      let stats = accumulator.getStats();
      expect(stats.medianLength).toBe(5); // Middle value when sorted: 3, 5, 7

      // Even number of sequences
      accumulator.add({ id: "4", sequence: "A".repeat(9), length: 9 });
      stats = accumulator.getStats();
      expect(stats.medianLength).toBe(6); // Average of middle two: (5+7)/2
    });
  });

  describe("quality statistics (FASTQ)", () => {
    test("should calculate quality stats for FASTQ sequences", () => {
      const accumulator = new SequenceStatsAccumulator();

      const fastqSeq: FastqSequence = {
        id: "1",
        sequence: "ATCG",
        quality: "IIII", // All Q40 (73 - 33 = 40)
        length: 4,
        format: "fastq",
      };

      accumulator.add(fastqSeq as Sequence);
      const stats = accumulator.getStats();

      expect(stats.qualityStats).toBeDefined();
      expect(stats.qualityStats?.meanQuality).toBe(40);
      expect(stats.qualityStats?.minQuality).toBe(40);
      expect(stats.qualityStats?.maxQuality).toBe(40);
    });

    test("should handle mixed quality scores", () => {
      const accumulator = new SequenceStatsAccumulator();

      const fastqSeq: FastqSequence = {
        id: "1",
        sequence: "ATCG",
        quality: '!"#I', // Q0, Q1, Q2, Q40
        length: 4,
        format: "fastq",
      };

      accumulator.add(fastqSeq as Sequence);
      const stats = accumulator.getStats();

      expect(stats.qualityStats?.meanQuality).toBeCloseTo(10.75, 2);
      expect(stats.qualityStats?.minQuality).toBe(0);
      expect(stats.qualityStats?.maxQuality).toBe(40);
    });

    test("should handle sequences without quality", () => {
      const accumulator = new SequenceStatsAccumulator();

      accumulator.add({ id: "1", sequence: "ATCG", length: 4 });
      const stats = accumulator.getStats();

      expect(stats.qualityStats).toBeUndefined();
    });
  });

  describe("variance and standard deviation", () => {
    test("should calculate variance using Welford algorithm", () => {
      const accumulator = new SequenceStatsAccumulator();

      // Lengths: 2, 4, 6, 8, 10
      // Mean: 6, Variance: 10
      accumulator.add({ id: "1", sequence: "AA", length: 2 });
      accumulator.add({ id: "2", sequence: "A".repeat(4), length: 4 });
      accumulator.add({ id: "3", sequence: "A".repeat(6), length: 6 });
      accumulator.add({ id: "4", sequence: "A".repeat(8), length: 8 });
      accumulator.add({ id: "5", sequence: "A".repeat(10), length: 10 });

      expect(accumulator.getVariance()).toBeCloseTo(10, 1);
      expect(accumulator.getStandardDeviation()).toBeCloseTo(3.16, 1);
    });

    test("should handle single sequence variance", () => {
      const accumulator = new SequenceStatsAccumulator();
      accumulator.add({ id: "1", sequence: "ATCG", length: 4 });

      expect(accumulator.getVariance()).toBe(0);
      expect(accumulator.getStandardDeviation()).toBe(0);
    });
  });

  describe("streaming and async operations", () => {
    test("should handle async iterable input", async () => {
      const accumulator = new SequenceStatsAccumulator();

      async function* generateSequences(): AsyncGenerator<Sequence> {
        yield { id: "1", sequence: "ATCG", length: 4 };
        yield { id: "2", sequence: "GGCCAATT", length: 8 };
        yield { id: "3", sequence: "AT", length: 2 };
      }

      await accumulator.addStream(generateSequences());
      const stats = accumulator.getStats();

      expect(stats.count).toBe(3);
      expect(stats.totalLength).toBe(14);
    });

    test("should work with calculateSequenceStats utility", async () => {
      const sequences: Sequence[] = [
        { id: "1", sequence: "GGCC", length: 4 },
        { id: "2", sequence: "AATT", length: 4 },
      ];

      const stats = await calculateSequenceStats(sequences);
      expect(stats.count).toBe(2);
      expect(stats.gcContent).toBe(0.5);
    });
  });

  describe("merge operations", () => {
    test("should merge two accumulators correctly", () => {
      const acc1 = new SequenceStatsAccumulator();
      const acc2 = new SequenceStatsAccumulator();

      // First accumulator
      acc1.add({ id: "1", sequence: "ATCG", length: 4 });
      acc1.add({ id: "2", sequence: "GG", length: 2 });

      // Second accumulator
      acc2.add({ id: "3", sequence: "AAAAAA", length: 6 });
      acc2.add({ id: "4", sequence: "CCCCCCCC", length: 8 });

      // Merge
      acc1.merge(acc2);
      const stats = acc1.getStats();

      expect(stats.count).toBe(4);
      expect(stats.totalLength).toBe(20);
      expect(stats.minLength).toBe(2);
      expect(stats.maxLength).toBe(8);
      expect(stats.meanLength).toBe(5);
    });

    test("should handle merging empty accumulator", () => {
      const acc1 = new SequenceStatsAccumulator();
      const acc2 = new SequenceStatsAccumulator();

      acc1.add({ id: "1", sequence: "ATCG", length: 4 });
      acc1.merge(acc2); // Merge empty

      const stats = acc1.getStats();
      expect(stats.count).toBe(1);
      expect(stats.totalLength).toBe(4);
    });

    test("should merge base composition correctly", () => {
      const acc1 = new SequenceStatsAccumulator();
      const acc2 = new SequenceStatsAccumulator();

      acc1.add({ id: "1", sequence: "AAA", length: 3 });
      acc2.add({ id: "2", sequence: "TTT", length: 3 });

      acc1.merge(acc2);
      const stats = acc1.getStats();

      expect(stats.baseComposition["A"]).toBe(3);
      expect(stats.baseComposition["T"]).toBe(3);
    });
  });

  describe("reset functionality", () => {
    test("should reset all statistics", () => {
      const accumulator = new SequenceStatsAccumulator();

      accumulator.add({ id: "1", sequence: "ATCGATCG", length: 8 });
      accumulator.add({ id: "2", sequence: "GGCC", length: 4 });

      accumulator.reset();
      const stats = accumulator.getStats();

      expect(stats.count).toBe(0);
      expect(stats.totalLength).toBe(0);
      expect(stats.baseComposition).toEqual({});
    });
  });

  describe("toString output", () => {
    test("should generate readable summary", () => {
      const accumulator = new SequenceStatsAccumulator();

      accumulator.add({ id: "1", sequence: "ATCGATCG", length: 8 });
      accumulator.add({ id: "2", sequence: "GGCC", length: 4 });

      const summary = accumulator.toString();

      expect(summary).toContain("Sequences: 2");
      expect(summary).toContain("Total length: 12 bp");
      expect(summary).toContain("GC content:");
      expect(summary).toContain("N50:");
    });
  });

  describe("edge cases", () => {
    test("should handle very long sequences", () => {
      const accumulator = new SequenceStatsAccumulator();
      const longSeq = "A".repeat(1000000);

      accumulator.add({ id: "1", sequence: longSeq, length: 1000000 });
      const stats = accumulator.getStats();

      expect(stats.totalLength).toBe(1000000);
      expect(stats.baseComposition["A"]).toBe(1000000);
    });

    test("should handle invalid sequences gracefully", () => {
      const accumulator = new SequenceStatsAccumulator();

      expect(() => accumulator.add(null as unknown as FastaSequence)).toThrow(
        "Valid sequence required for statistics"
      );

      expect(() => accumulator.add({ id: "1" } as FastaSequence)).toThrow(
        "Valid sequence required for statistics"
      );
    });

    test("should handle sequences with special characters", () => {
      const accumulator = new SequenceStatsAccumulator();

      accumulator.add({ id: "1", sequence: "ATCG-N.", length: 7 });
      const stats = accumulator.getStats();

      expect(stats.baseComposition["-"]).toBe(1);
      expect(stats.baseComposition["N"]).toBe(1);
      expect(stats.baseComposition["."]).toBe(1);
    });
  });
});
