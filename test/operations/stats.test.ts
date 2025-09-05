/**
 * Tests for SequenceStatsCalculator - statistics calculation
 */

import { describe, expect, test } from "bun:test";
import { SequenceStatsCalculator } from "../../src/operations/stats";
import type { AbstractSequence, FASTXSequence, FastqSequence } from "../../src/types";

describe("SequenceStatsCalculator", () => {
  // Helper functions
  function createSequence(id: string, sequence: string): AbstractSequence {
    return { id, sequence, length: sequence.length };
  }

  function createFastq(id: string, sequence: string, quality: string): FastqSequence {
    return {
      format: "fastq",
      id,
      sequence,
      quality,
      qualityEncoding: "phred33",
      length: sequence.length,
    };
  }

  async function* arrayToAsync<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item;
    }
  }

  describe("basic statistics", () => {
    test("calculates stats for single sequence", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences));

      expect(stats.numSequences).toBe(1);
      expect(stats.totalLength).toBe(8);
      expect(stats.minLength).toBe(8);
      expect(stats.maxLength).toBe(8);
      expect(stats.avgLength).toBe(8);
      expect(stats.format).toBe("FASTA");
      expect(stats.type).toBe("DNA");
    });

    test("calculates stats for multiple sequences", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "ATCGATCGATCG"),
        createSequence("seq3", "AT"),
      ];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences));

      expect(stats.numSequences).toBe(3);
      expect(stats.totalLength).toBe(18);
      expect(stats.minLength).toBe(2);
      expect(stats.maxLength).toBe(12);
      expect(stats.avgLength).toBe(6);
    });

    test("handles empty input", async () => {
      const sequences: AbstractSequence[] = [];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences));

      expect(stats.numSequences).toBe(0);
      expect(stats.totalLength).toBe(0);
      expect(stats.minLength).toBe(0);
      expect(stats.maxLength).toBe(0);
      expect(stats.avgLength).toBe(0);
      expect(stats.format).toBe("Unknown");
      expect(stats.type).toBe("Unknown");
    });
  });

  describe("GC content calculation", () => {
    test("calculates GC content", async () => {
      const sequences = [
        createSequence("seq1", "GGCC"), // 100% GC
        createSequence("seq2", "AATT"), // 0% GC
        createSequence("seq3", "ATGC"), // 50% GC
      ];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences));

      expect(stats.gcContent).toBeDefined();
      expect(stats.gcContent).toBeCloseTo(0.5, 2);
    });

    test("handles sequences with no nucleotides", async () => {
      const sequences = [createSequence("seq1", "---")];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences));

      expect(stats.gcContent).toBeUndefined();
      expect(stats.gapCount).toBe(3);
    });
  });

  describe("N50 calculation", () => {
    test("calculates N50 correctly", async () => {
      const sequences = [
        createSequence("seq1", "A".repeat(100)),
        createSequence("seq2", "A".repeat(200)),
        createSequence("seq3", "A".repeat(300)),
        createSequence("seq4", "A".repeat(400)),
        createSequence("seq5", "A".repeat(500)),
      ];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences), {
        detailed: true,
      });

      expect(stats.n50).toBeDefined();
      expect(stats.n50).toBe(400);
    });

    test("calculates N90 correctly", async () => {
      const sequences = [
        createSequence("seq1", "A".repeat(100)),
        createSequence("seq2", "A".repeat(200)),
        createSequence("seq3", "A".repeat(300)),
        createSequence("seq4", "A".repeat(400)),
        createSequence("seq5", "A".repeat(500)),
      ];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences), {
        detailed: true,
      });

      expect(stats.n90).toBeDefined();
      expect(stats.n90).toBe(200);
    });

    test("handles single sequence for N50", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences), {
        detailed: true,
      });

      expect(stats.n50).toBe(8);
      expect(stats.n90).toBe(8);
    });
  });

  describe("quartile calculation", () => {
    test("calculates quartiles correctly", async () => {
      const sequences = [
        createSequence("seq1", "A".repeat(10)),
        createSequence("seq2", "A".repeat(20)),
        createSequence("seq3", "A".repeat(30)),
        createSequence("seq4", "A".repeat(40)),
        createSequence("seq5", "A".repeat(50)),
      ];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences), {
        detailed: true,
      });

      expect(stats.q1Length).toBeDefined();
      expect(stats.q2Length).toBeDefined();
      expect(stats.q3Length).toBeDefined();
      expect(stats.q1Length).toBe(20);
      expect(stats.q2Length).toBe(30);
      expect(stats.q3Length).toBe(40);
    });
  });

  describe("sequence type detection", () => {
    test("detects DNA sequences", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences));

      expect(stats.type).toBe("DNA");
    });

    test("detects RNA sequences", async () => {
      const sequences = [createSequence("seq1", "AUCGAUCG")];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences));

      expect(stats.type).toBe("RNA");
    });

    test("detects protein sequences", async () => {
      const sequences = [createSequence("seq1", "ARNDCEQGHILKMFPSTWYV")];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences));

      expect(stats.type).toBe("Protein");
    });

    test("handles unknown sequences", async () => {
      const sequences = [createSequence("seq1", "---***")];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences));

      expect(stats.type).toBe("Unknown");
    });
  });

  describe("base composition", () => {
    test("calculates base composition", async () => {
      const sequences = [createSequence("seq1", "AATTGGCCNN")];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences), {
        includeComposition: true,
      });

      expect(stats.baseComposition).toBeDefined();
      expect(stats.baseComposition?.A).toBe(2);
      expect(stats.baseComposition?.T).toBe(2);
      expect(stats.baseComposition?.G).toBe(2);
      expect(stats.baseComposition?.C).toBe(2);
      expect(stats.baseComposition?.N).toBe(2);
    });

    test("counts gaps and ambiguous bases", async () => {
      const sequences = [createSequence("seq1", "ATCG--NNRR")];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences));

      expect(stats.gapCount).toBe(2);
      expect(stats.ambiguousCount).toBe(4); // N, N, R, R
    });

    test("handles custom gap and ambiguous characters", async () => {
      const sequences = [createSequence("seq1", "ATCG..NNNN")];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences), {
        gapChars: ".",
        ambiguousChars: "N",
      });

      expect(stats.gapCount).toBe(2);
      expect(stats.ambiguousCount).toBe(4);
    });
  });

  describe("FASTQ quality statistics", () => {
    test("calculates quality statistics", async () => {
      const sequences = [
        createFastq("seq1", "ATCG", "IIII"), // Q=40
        createFastq("seq2", "ATCG", "!!!!"), // Q=0
        createFastq("seq3", "ATCG", "5555"), // Q=20
      ];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences), {
        includeQuality: true,
      });

      expect(stats.format).toBe("FASTQ");
      expect(stats.avgQuality).toBeDefined();
      expect(stats.avgQuality).toBeCloseTo(20, 1);
      expect(stats.minQuality).toBe(0);
      expect(stats.maxQuality).toBe(40);
      expect(stats.qualityEncoding).toBe("phred33");
    });

    test("calculates Q20 and Q30 percentages", async () => {
      const sequences = [
        createFastq("seq1", "AAAA", "II55"), // Q=40,40,20,20
        createFastq("seq2", "AAAA", "@@!!"), // Q=31,31,0,0
      ];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences), {
        includeQuality: true,
      });

      expect(stats.q20Percentage).toBeDefined();
      expect(stats.q30Percentage).toBeDefined();
      expect(stats.q20Percentage).toBeCloseTo(75, 1); // 6/8 bases >= Q20
      expect(stats.q30Percentage).toBeCloseTo(50, 1); // 4/8 bases >= Q30
    });

    test("handles mixed FASTA and FASTQ", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createFastq("seq2", "ATCG", "IIII")];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences));

      expect(stats.format).toBe("Mixed");
    });
  });

  describe("options handling", () => {
    test("respects detailed option", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const calculator = new SequenceStatsCalculator();

      const basicStats = await calculator.calculateStats(arrayToAsync(sequences), {
        detailed: false,
      });
      expect(basicStats.n50).toBeUndefined();
      expect(basicStats.q1Length).toBeUndefined();

      const detailedStats = await calculator.calculateStats(arrayToAsync(sequences), {
        detailed: true,
      });
      expect(detailedStats.n50).toBeDefined();
      expect(detailedStats.q1Length).toBeDefined();
    });

    test("respects includeQuality option", async () => {
      const sequences = [createFastq("seq1", "ATCG", "IIII")];
      const calculator = new SequenceStatsCalculator();

      const withQuality = await calculator.calculateStats(arrayToAsync(sequences), {
        includeQuality: true,
      });
      expect(withQuality.avgQuality).toBeDefined();

      const withoutQuality = await calculator.calculateStats(arrayToAsync(sequences), {
        includeQuality: false,
      });
      expect(withoutQuality.avgQuality).toBeUndefined();
    });

    test("respects includeComposition option", async () => {
      const sequences = [createSequence("seq1", "ATCG")];
      const calculator = new SequenceStatsCalculator();

      const withComposition = await calculator.calculateStats(arrayToAsync(sequences), {
        includeComposition: true,
      });
      expect(withComposition.baseComposition).toBeDefined();

      const withoutComposition = await calculator.calculateStats(arrayToAsync(sequences), {
        includeComposition: false,
      });
      expect(withoutComposition.baseComposition).toBeUndefined();
    });

    test("includes fileName when provided", async () => {
      const sequences = [createSequence("seq1", "ATCG")];
      const calculator = new SequenceStatsCalculator();
      const stats = await calculator.calculateStats(arrayToAsync(sequences), {
        fileName: "test.fasta",
      });

      expect(stats.file).toBe("test.fasta");
    });
  });

  describe("error handling", () => {
    test("handles errors during processing", async () => {
      async function* errorGenerator(): AsyncIterable<AbstractSequence> {
        yield createSequence("seq1", "ATCG");
        throw new Error("Test error");
      }

      const calculator = new SequenceStatsCalculator();

      await expect(async () => {
        await calculator.calculateStats(errorGenerator());
      }).toThrow("Statistics calculation failed");
    });

    test("provides context in error messages", async () => {
      async function* errorGenerator(): AsyncIterable<AbstractSequence> {
        yield createSequence("seq1", "ATCG");
        yield createSequence("seq2", "ATCG");
        throw new Error("Test error");
      }

      const calculator = new SequenceStatsCalculator();

      try {
        await calculator.calculateStats(errorGenerator());
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).toContain("Statistics calculation failed");
          // Check if error details contain the processed count
          const errorWithDetails = error as Error & { details?: string };
          if (errorWithDetails.details) {
            expect(errorWithDetails.details).toContain("Processed 2 sequences");
          }
        }
      }
    });
  });

  describe("NX calculation", () => {
    test("calculates various percentiles", () => {
      const calculator = new SequenceStatsCalculator();
      const lengths = [100, 200, 300, 400, 500];

      expect(calculator.calculateNX(lengths, 50)).toBe(400);
      expect(calculator.calculateNX(lengths, 90)).toBe(200);
      expect(calculator.calculateNX(lengths, 10)).toBe(500);
      expect(calculator.calculateNX(lengths, 100)).toBe(100);
    });

    test("handles empty array", () => {
      const calculator = new SequenceStatsCalculator();
      expect(calculator.calculateNX([], 50)).toBe(0);
    });

    test("handles single element", () => {
      const calculator = new SequenceStatsCalculator();
      expect(calculator.calculateNX([100], 50)).toBe(100);
    });

    test("throws on invalid percentile", () => {
      const calculator = new SequenceStatsCalculator();
      expect(() => calculator.calculateNX([100], -1)).toThrow("Invalid percentile");
      expect(() => calculator.calculateNX([100], 101)).toThrow("Invalid percentile");
    });
  });
});
