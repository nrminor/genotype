/**
 * Tests for sequence statistics accumulator
 */

import { describe, expect, test } from "bun:test";
import {
  calculateSequenceStats,
  SequenceStatsAccumulator,
} from "../../../src/operations/core/statistics";
import { createFastaRecord, createFastqRecord } from "../../../src/constructors";
import type { AbstractSequence, FastaSequence, FastqSequence } from "../../../src/types";

function createSequence(id: string, sequence: string): AbstractSequence {
  return createFastaRecord({ id, sequence });
}

function createFastqSequence(id: string, sequence: string, quality: string): FastqSequence {
  return createFastqRecord({ id, sequence, quality, qualityEncoding: "phred33" });
}

describe("SequenceStatsAccumulator", () => {
  describe("basic statistics", () => {
    test("should calculate basic stats for simple sequences", () => {
      const accumulator = new SequenceStatsAccumulator();

      const sequences: AbstractSequence[] = [
        createSequence("1", "ATCG"),
        createSequence("2", "ATCGATCG"),
        createSequence("3", "AT"),
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
      accumulator.add(createSequence("1", "ATCGATCG"));

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

      accumulator.add(createSequence("1", "GGCC")); // 100% GC
      accumulator.add(createSequence("2", "AATT")); // 0% GC
      accumulator.add(createSequence("3", "ATCG")); // 50% GC

      const stats = accumulator.getStats();
      expect(stats.gcContent).toBeCloseTo(0.5, 2); // Overall 50%
    });

    test("should count base composition", () => {
      const accumulator = new SequenceStatsAccumulator();
      accumulator.add(createSequence("1", "AATTTCCCGGGG"));

      const stats = accumulator.getStats();
      expect(stats.baseComposition["A"]).toBe(2);
      expect(stats.baseComposition["T"]).toBe(3);
      expect(stats.baseComposition["C"]).toBe(3);
      expect(stats.baseComposition["G"]).toBe(4);
    });

    test("should handle IUPAC ambiguity codes", () => {
      const accumulator = new SequenceStatsAccumulator();
      accumulator.add(createSequence("1", "ATCGNRYS"));

      const stats = accumulator.getStats();
      expect(stats.baseComposition["N"]).toBe(1);
      expect(stats.baseComposition["R"]).toBe(1);
      expect(stats.baseComposition["Y"]).toBe(1);
      expect(stats.baseComposition["S"]).toBe(1); // S counts as GC
      expect(stats.gcContent).toBeCloseTo(3 / 8, 2); // C, G, S
    });

    test("should handle lowercase sequences", () => {
      const accumulator = new SequenceStatsAccumulator();
      accumulator.add(createSequence("1", "atcg"));

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
      accumulator.add(createSequence("1", "A".repeat(10)));
      accumulator.add(createSequence("2", "A".repeat(8)));
      accumulator.add(createSequence("3", "A".repeat(6)));
      accumulator.add(createSequence("4", "A".repeat(4)));
      accumulator.add(createSequence("5", "AA"));

      const stats = accumulator.getStats();
      expect(stats.n50).toBe(8);
    });

    test("should calculate N90 correctly", () => {
      const accumulator = new SequenceStatsAccumulator();

      // Same sequences, 90% of 30 = 27 bp
      // N90 should be 4
      accumulator.add(createSequence("1", "A".repeat(10)));
      accumulator.add(createSequence("2", "A".repeat(8)));
      accumulator.add(createSequence("3", "A".repeat(6)));
      accumulator.add(createSequence("4", "A".repeat(4)));
      accumulator.add(createSequence("5", "AA"));

      const stats = accumulator.getStats();
      expect(stats.n90).toBe(4);
    });

    test("should calculate median correctly", () => {
      const accumulator = new SequenceStatsAccumulator();

      // Odd number of sequences
      accumulator.add(createSequence("1", "A".repeat(5)));
      accumulator.add(createSequence("2", "A".repeat(3)));
      accumulator.add(createSequence("3", "A".repeat(7)));

      let stats = accumulator.getStats();
      expect(stats.medianLength).toBe(5); // Middle value when sorted: 3, 5, 7

      // Even number of sequences
      accumulator.add(createSequence("4", "A".repeat(9)));
      stats = accumulator.getStats();
      expect(stats.medianLength).toBe(6); // Average of middle two: (5+7)/2
    });
  });

  describe("quality statistics (FASTQ)", () => {
    test("should calculate quality stats for FASTQ sequences", () => {
      const accumulator = new SequenceStatsAccumulator();

      const fastqSeq: FastqSequence = createFastqSequence("1", "ATCG", "IIII"); // All Q40 (73 - 33 = 40)

      accumulator.add(fastqSeq as AbstractSequence);
      const stats = accumulator.getStats();

      expect(stats.qualityStats).toBeDefined();
      expect(stats.qualityStats?.meanQuality).toBe(40);
      expect(stats.qualityStats?.minQuality).toBe(40);
      expect(stats.qualityStats?.maxQuality).toBe(40);
    });

    test("should handle mixed quality scores", () => {
      const accumulator = new SequenceStatsAccumulator();

      const fastqSeq: FastqSequence = createFastqSequence("1", "ATCG", '!"#I'); // Q0, Q1, Q2, Q40

      accumulator.add(fastqSeq as AbstractSequence);
      const stats = accumulator.getStats();

      expect(stats.qualityStats?.meanQuality).toBeCloseTo(10.75, 2);
      expect(stats.qualityStats?.minQuality).toBe(0);
      expect(stats.qualityStats?.maxQuality).toBe(40);
    });

    test("should handle sequences without quality", () => {
      const accumulator = new SequenceStatsAccumulator();

      accumulator.add(createSequence("1", "ATCG"));
      const stats = accumulator.getStats();

      expect(stats.qualityStats).toBeUndefined();
    });
  });

  describe("variance and standard deviation", () => {
    test("should calculate variance using Welford algorithm", () => {
      const accumulator = new SequenceStatsAccumulator();

      // Lengths: 2, 4, 6, 8, 10
      // Mean: 6, Variance: 10
      accumulator.add(createSequence("1", "AA"));
      accumulator.add(createSequence("2", "A".repeat(4)));
      accumulator.add(createSequence("3", "A".repeat(6)));
      accumulator.add(createSequence("4", "A".repeat(8)));
      accumulator.add(createSequence("5", "A".repeat(10)));

      expect(accumulator.getVariance()).toBeCloseTo(10, 1);
      expect(accumulator.getStandardDeviation()).toBeCloseTo(3.16, 1);
    });

    test("should handle single sequence variance", () => {
      const accumulator = new SequenceStatsAccumulator();
      accumulator.add(createSequence("1", "ATCG"));

      expect(accumulator.getVariance()).toBe(0);
      expect(accumulator.getStandardDeviation()).toBe(0);
    });
  });

  describe("streaming and async operations", () => {
    test("should handle async iterable input", async () => {
      const accumulator = new SequenceStatsAccumulator();

      async function* generateSequences(): AsyncGenerator<AbstractSequence> {
        yield createSequence("1", "ATCG");
        yield createSequence("2", "GGCCAATT");
        yield createSequence("3", "AT");
      }

      await accumulator.addStream(generateSequences());
      const stats = accumulator.getStats();

      expect(stats.count).toBe(3);
      expect(stats.totalLength).toBe(14);
    });

    test("should work with calculateSequenceStats utility", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("1", "GGCC"),
        createSequence("2", "AATT"),
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
      acc1.add(createSequence("1", "ATCG"));
      acc1.add(createSequence("2", "GG"));

      // Second accumulator
      acc2.add(createSequence("3", "AAAAAA"));
      acc2.add(createSequence("4", "CCCCCCCC"));

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

      acc1.add(createSequence("1", "ATCG"));
      acc1.merge(acc2); // Merge empty

      const stats = acc1.getStats();
      expect(stats.count).toBe(1);
      expect(stats.totalLength).toBe(4);
    });

    test("should merge base composition correctly", () => {
      const acc1 = new SequenceStatsAccumulator();
      const acc2 = new SequenceStatsAccumulator();

      acc1.add(createSequence("1", "AAA"));
      acc2.add(createSequence("2", "TTT"));

      acc1.merge(acc2);
      const stats = acc1.getStats();

      expect(stats.baseComposition["A"]).toBe(3);
      expect(stats.baseComposition["T"]).toBe(3);
    });
  });

  describe("reset functionality", () => {
    test("should reset all statistics", () => {
      const accumulator = new SequenceStatsAccumulator();

      accumulator.add(createSequence("1", "ATCGATCG"));
      accumulator.add(createSequence("2", "GGCC"));

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

      accumulator.add(createSequence("1", "ATCGATCG"));
      accumulator.add(createSequence("2", "GGCC"));

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

      accumulator.add(createSequence("1", longSeq));
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

      accumulator.add(createSequence("1", "ATCG-N."));
      const stats = accumulator.getStats();

      expect(stats.baseComposition["-"]).toBe(1);
      expect(stats.baseComposition["N"]).toBe(1);
      expect(stats.baseComposition["."]).toBe(1);
    });
  });
});
