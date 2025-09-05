/**
 * Tests for SeqOps - main fluent interface for sequence operations
 */

import { describe, expect, test } from "bun:test";
import { Bun } from "bun";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SeqOps, seqops } from "../../src/operations";
import type { AbstractSequence, FastqSequence } from "../../src/types";

describe("SeqOps", () => {
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

  describe("constructor and factory", () => {
    test("creates SeqOps instance with constructor", () => {
      const sequences = arrayToAsync([createSequence("seq1", "ATCG")]);
      const ops = new SeqOps(sequences);
      expect(ops).toBeInstanceOf(SeqOps);
    });

    test("creates SeqOps instance with factory function", () => {
      const sequences = arrayToAsync([createSequence("seq1", "ATCG")]);
      const ops = seqops(sequences);
      expect(ops).toBeInstanceOf(SeqOps);
    });
  });

  describe("method chaining", () => {
    test("chains transformation methods with new API", async () => {
      const sequences = [
        createSequence("seq1", "atcgatcg"),
        createSequence("seq2", "at"),
        createSequence("seq3", "ggccaatt"),
      ];

      const results = await seqops(arrayToAsync(sequences))
        .filter({ minLength: 4 })
        .transform({ upperCase: true })
        .filter((s) => s.sequence.includes("A"))
        .head(2)
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.sequence).toBe("ATCGATCG");
      expect(results[1]?.sequence).toBe("GGCCAATT");
    });

    test("chains multiple transform operations", async () => {
      const sequences = [createSequence("seq1", "atcgatcg")];

      const results = await seqops(arrayToAsync(sequences))
        .transform({ upperCase: true })
        .transform({ reverseComplement: true })
        .collect();

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("CGATCGAT");
    });
  });

  describe("filter method", () => {
    test("filters sequences with predicate", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGG"),
        createSequence("seq3", "AAAA"),
      ];

      const results = await seqops(arrayToAsync(sequences))
        .filter((s) => s.sequence.includes("G"))
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("seq1");
      expect(results[1]?.id).toBe("seq2");
    });

    test("chains multiple filters", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGGCCCC"),
        createSequence("seq3", "AAAATTTT"),
      ];

      const results = await seqops(arrayToAsync(sequences))
        .filter((s) => s.length > 4)
        .filter((s) => s.sequence.includes("G"))
        .collect();

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("seq2");
    });
  });

  describe("head method", () => {
    test("takes first n sequences", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGG"),
        createSequence("seq3", "CCCC"),
        createSequence("seq4", "TTTT"),
      ];

      const results = await seqops(arrayToAsync(sequences)).head(2).collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("seq1");
      expect(results[1]?.id).toBe("seq2");
    });

    test("handles n greater than sequence count", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const results = await seqops(arrayToAsync(sequences)).head(10).collect();

      expect(results).toHaveLength(2);
    });

    test("handles zero n", async () => {
      const sequences = [createSequence("seq1", "ATCG")];

      const results = await seqops(arrayToAsync(sequences)).head(0).collect();

      expect(results).toHaveLength(0);
    });
  });

  describe("stats method", () => {
    test("calculates basic statistics", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "ATCGATCG"),
        createSequence("seq3", "AT"),
      ];

      const stats = await seqops(arrayToAsync(sequences)).stats();

      expect(stats.numSequences).toBe(3);
      expect(stats.totalLength).toBe(14);
      expect(stats.minLength).toBe(2);
      expect(stats.maxLength).toBe(8);
      expect(stats.avgLength).toBeCloseTo(4.67, 1);
    });

    test("calculates detailed statistics", async () => {
      const sequences = [
        createSequence("seq1", "A".repeat(100)),
        createSequence("seq2", "G".repeat(200)),
        createSequence("seq3", "C".repeat(300)),
      ];

      const stats = await seqops(arrayToAsync(sequences)).stats({
        detailed: true,
      });

      expect(stats.n50).toBeDefined();
      expect(stats.n50).toBe(300);
      expect(stats.gcContent).toBeDefined();
    });

    test("stats after transformations", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "AT"),
        createSequence("seq3", "ATCGATCG"),
      ];

      const stats = await seqops(arrayToAsync(sequences)).filter({ minLength: 4 }).stats();

      expect(stats.numSequences).toBe(2);
      expect(stats.totalLength).toBe(12);
    });
  });

  describe("collect method", () => {
    test("collects all sequences into array", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const results = await seqops(arrayToAsync(sequences)).collect();

      expect(results).toBeInstanceOf(Array);
      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("seq1");
      expect(results[1]?.id).toBe("seq2");
    });

    test("collects empty result", async () => {
      const sequences = [createSequence("seq1", "ATCG")];

      const results = await seqops(arrayToAsync(sequences))
        .filter(() => false)
        .collect();

      expect(results).toHaveLength(0);
    });
  });

  describe("count method", () => {
    test("counts sequences", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGG"),
        createSequence("seq3", "CCCC"),
      ];

      const count = await seqops(arrayToAsync(sequences)).count();

      expect(count).toBe(3);
    });

    test("counts after filtering", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGG"),
        createSequence("seq3", "AAAA"),
      ];

      const count = await seqops(arrayToAsync(sequences))
        .filter((s) => s.sequence.includes("G"))
        .count();

      expect(count).toBe(2);
    });

    test("counts empty pipeline", async () => {
      const sequences: AbstractSequence[] = [];

      const count = await seqops(arrayToAsync(sequences)).count();

      expect(count).toBe(0);
    });
  });

  describe("forEach method", () => {
    test("processes each sequence", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const processed: string[] = [];
      await seqops(arrayToAsync(sequences)).forEach((seq) => {
        processed.push(seq.id);
      });

      expect(processed).toEqual(["seq1", "seq2"]);
    });

    test("processes with async callback", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const processed: string[] = [];
      await seqops(arrayToAsync(sequences)).forEach(async (seq) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        processed.push(seq.id);
      });

      expect(processed).toEqual(["seq1", "seq2"]);
    });
  });

  describe("async iteration", () => {
    test("supports for-await-of iteration", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const results: string[] = [];
      for await (const seq of seqops(arrayToAsync(sequences)).transform({
        upperCase: true,
      })) {
        results.push(seq.sequence);
      }

      expect(results).toEqual(["ATCG", "GGGG"]);
    });
  });

  describe("writeFasta method", () => {
    test("writes sequences to FASTA file", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG"), createSequence("seq2", "GGGGCCCC")];

      const tempFile = join(tmpdir(), `test-${Date.now()}.fasta`);

      await seqops(arrayToAsync(sequences)).writeFasta(tempFile);

      const content = await fs.readFile(tempFile, "utf-8");
      expect(content).toContain(">seq1");
      expect(content).toContain("ATCGATCG");
      expect(content).toContain(">seq2");
      expect(content).toContain("GGGGCCCC");

      await fs.unlink(tempFile);
    });

    test("writes with custom wrap width", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCGATCGATCG")];

      const tempFile = join(tmpdir(), `test-${Date.now()}.fasta`);

      await seqops(arrayToAsync(sequences)).writeFasta(tempFile, {
        wrapWidth: 10,
      });

      const content = await fs.readFile(tempFile, "utf-8");
      const lines = content.split("\n");
      expect(lines[1]).toBe("ATCGATCGAT");
      expect(lines[2]).toBe("CGATCGATCG");

      await fs.unlink(tempFile);
    });
  });

  describe("writeFastq method", () => {
    test("writes FASTQ sequences to file", async () => {
      const sequences = [createFastq("seq1", "ATCG", "IIII"), createFastq("seq2", "GGGG", "@@@@")];

      const tempFile = join(tmpdir(), `test-${Date.now()}.fastq`);

      await seqops(arrayToAsync(sequences)).writeFastq(tempFile);

      const content = await fs.readFile(tempFile, "utf-8");
      expect(content).toContain("@seq1");
      expect(content).toContain("ATCG");
      expect(content).toContain("+");
      expect(content).toContain("IIII");

      await fs.unlink(tempFile);
    });

    test("converts FASTA to FASTQ with default quality", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const tempFile = join(tmpdir(), `test-${Date.now()}.fastq`);

      await seqops(arrayToAsync(sequences)).writeFastq(tempFile, "I");

      const content = await fs.readFile(tempFile, "utf-8");
      expect(content).toContain("@seq1");
      expect(content).toContain("IIII");
      expect(content).toContain("@seq2");

      await fs.unlink(tempFile);
    });
  });

  describe("complex pipelines", () => {
    test("complex filtering and transformation pipeline", async () => {
      const sequences = [
        createSequence("gene1", "atcgatcgatcg"),
        createSequence("control1", "ggggcccc"),
        createSequence("gene2", "at"),
        createSequence("gene3", "aaaattttcccc"),
        createSequence("control2", "ttttaaaa"),
      ];

      const results = await seqops(arrayToAsync(sequences))
        .filter((s) => s.id.startsWith("gene"))
        .filter({ minLength: 4 })
        .transform({ upperCase: true })
        .transform({ reverseComplement: true })
        .head(2) // Take first 2 results instead of subseq
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.sequence).toBe("CGATCGATCGAT"); // Full reversed complement
      expect(results[1]?.sequence).toBe("GGGGAAAATTTT"); // Full reversed complement
    });

    test("statistics after complex pipeline", async () => {
      const sequences = [
        createFastq("seq1", "ATCGATCG", "IIIIIIII"),
        createFastq("seq2", "GGGG", "!!!!"),
        createFastq("seq3", "AAAATTTT", "55555555"),
      ];

      const stats = await seqops(arrayToAsync(sequences))
        .quality({ minScore: 20 })
        .transform({ reverseComplement: true })
        .stats({ detailed: true, includeQuality: true });

      expect(stats.numSequences).toBe(2);
      expect(stats.avgQuality).toBeDefined();
      expect(stats.n50).toBeDefined();
    });

    test("write after complex transformations", async () => {
      const sequences = [
        createSequence("seq1", "atcgatcgatcg"),
        createSequence("seq2", "at"),
        createSequence("seq3", "ggggccccaaaa"),
      ];

      const tempFile = join(tmpdir(), `test-${Date.now()}.fasta`);

      await seqops(arrayToAsync(sequences))
        .filter({ minLength: 4 })
        .transform({ upperCase: true })
        .transform({ reverseComplement: true })
        // Note: subseq not implemented yet, using full sequences
        .writeFasta(tempFile);

      const content = await fs.readFile(tempFile, "utf-8");
      const lines = content.trim().split("\n");
      const seqLines = lines.filter((l) => l && !l.startsWith(">"));

      expect(seqLines).toHaveLength(2);
      expect(seqLines[0]).toBe("CGATCGATCGAT"); // seq1 reversed complement
      expect(seqLines[1]).toBe("TTTTGGGGCCCC"); // seq3 reversed complement

      await fs.unlink(tempFile);
    });
  });

  describe("error handling", () => {
    test("filters out invalid sequences with validate", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "INVALID!")];

      const results = await seqops(arrayToAsync(sequences))
        .validate({ mode: "strict", action: "reject" })
        .collect();

      // Validate with 'reject' filters out invalid sequences rather than throwing
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("seq1");
    });

    test("handles errors in forEach", async () => {
      const sequences = [createSequence("seq1", "ATCG")];

      await expect(async () => {
        await seqops(arrayToAsync(sequences)).forEach(() => {
          throw new Error("Test error");
        });
      }).toThrow("Test error");
    });

    test("handles write errors gracefully", async () => {
      const sequences = [createSequence("seq1", "ATCG")];
      const invalidPath = "/invalid/path/file.fasta";

      await expect(async () => {
        await seqops(arrayToAsync(sequences)).writeFasta(invalidPath);
      }).toThrow();
    });
  });
});
