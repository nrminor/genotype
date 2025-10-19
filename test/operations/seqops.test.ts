/**
 * Tests for SeqOps - main fluent interface for sequence operations
 */

import { describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SeqOps, seqops } from "../../src/operations";
import type { UnpairedStats } from "../../src/operations/interleave";
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

    test("filters with async predicate", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGG"),
        createSequence("seq3", "AAAA"),
      ];

      const results = await seqops(arrayToAsync(sequences))
        .filter(async (seq) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return seq.length === 4;
        })
        .collect();

      expect(results).toHaveLength(3);
    });

    test("preserves FastqSequence type through filter", async () => {
      const sequences = [
        createFastq("read1", "ATCG", "IIII"),
        createFastq("read2", "GGGG", "!!!!"),
        createFastq("read3", "AAAA", "####"),
      ];

      const results = await seqops<FastqSequence>(arrayToAsync(sequences))
        .filter((seq) => seq.sequence.includes("G"))
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.quality).toBe("IIII");
      expect(results[1]?.quality).toBe("!!!!");
    });

    test("propagates errors from filter predicate", async () => {
      const sequences = [createSequence("seq1", "ATCG")];

      await expect(async () => {
        await seqops(arrayToAsync(sequences))
          .filter(() => {
            throw new Error("Filter error");
          })
          .collect();
      }).toThrow("Filter error");
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

  describe("take method (alias for head)", () => {
    test("takes first n sequences", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGG"),
        createSequence("seq3", "CCCC"),
      ];

      const results = await seqops(arrayToAsync(sequences)).take(2).collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("seq1");
      expect(results[1]?.id).toBe("seq2");
    });

    test("produces same results as head", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGG"),
        createSequence("seq3", "CCCC"),
      ];

      const headResults = await seqops(arrayToAsync(sequences)).head(2).collect();
      const takeResults = await seqops(arrayToAsync(sequences)).take(2).collect();

      expect(takeResults).toEqual(headResults);
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

  describe("map method", () => {
    test("transforms sequences without index", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGG"),
        createSequence("seq3", "AAAA"),
      ];

      const results = await seqops(arrayToAsync(sequences))
        .map((seq) => ({ ...seq, id: `prefix_${seq.id}` }))
        .collect();

      expect(results).toHaveLength(3);
      expect(results[0]?.id).toBe("prefix_seq1");
      expect(results[1]?.id).toBe("prefix_seq2");
      expect(results[2]?.id).toBe("prefix_seq3");
    });

    test("preserves FastqSequence type through transformation", async () => {
      const sequences = [
        createFastq("read1", "ATCG", "IIII"),
        createFastq("read2", "GGGG", "!!!!"),
      ];

      const results = await seqops<FastqSequence>(arrayToAsync(sequences))
        .map((seq) => ({ ...seq, id: `sample1_${seq.id}` }))
        .collect();

      expect(results).toHaveLength(2);
      expect((results[0] as FastqSequence)?.quality).toBe("IIII");
      expect((results[1] as FastqSequence)?.quality).toBe("!!!!");
      expect(results[0]?.id).toBe("sample1_read1");
    });

    test("transforms with async function", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const results = await seqops(arrayToAsync(sequences))
        .map(async (seq) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { ...seq, description: "processed" };
        })
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.description).toBe("processed");
      expect(results[1]?.description).toBe("processed");
    });

    test("handles empty stream", async () => {
      const sequences: AbstractSequence[] = [];

      const results = await seqops(arrayToAsync(sequences))
        .map((seq) => ({ ...seq, id: `prefix_${seq.id}` }))
        .collect();

      expect(results).toHaveLength(0);
    });

    test("chains with other operations", async () => {
      const sequences = [
        createSequence("seq1", "atcg"),
        createSequence("seq2", "at"),
        createSequence("seq3", "gggg"),
      ];

      const results = await seqops(arrayToAsync(sequences))
        .filter({ minLength: 3 })
        .map((seq) => ({ ...seq, id: `filtered_${seq.id}` }))
        .transform({ upperCase: true })
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("filtered_seq1");
      expect(results[0]?.sequence).toBe("ATCG");
      expect(results[1]?.id).toBe("filtered_seq3");
      expect(results[1]?.sequence).toBe("GGGG");
    });

    test("transforms to different type", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const results = await seqops(arrayToAsync(sequences))
        .map<FastqSequence>((seq) => ({
          ...seq,
          format: "fastq" as const,
          quality: "I".repeat(seq.length),
          qualityEncoding: "phred33" as const,
        }))
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.quality).toBe("IIII");
      expect(results[1]?.quality).toBe("IIII");
    });

    test("propagates errors from mapping function", async () => {
      const sequences = [createSequence("seq1", "ATCG")];

      await expect(async () => {
        await seqops(arrayToAsync(sequences))
          .map(() => {
            throw new Error("Mapping error");
          })
          .collect();
      }).toThrow("Mapping error");
    });
  });

  describe("tap method", () => {
    test("executes side effect without modifying sequence", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const sideEffects: string[] = [];

      const results = await seqops(arrayToAsync(sequences))
        .tap((seq) => {
          sideEffects.push(seq.id);
        })
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("seq1");
      expect(results[1]?.id).toBe("seq2");
      expect(sideEffects).toEqual(["seq1", "seq2"]);
    });

    test("enables index parameter after enumerate", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGG"),
        createSequence("seq3", "AAAA"),
      ];

      const logged: Array<{ id: string; idx: number }> = [];

      const results = await seqops(arrayToAsync(sequences))
        .enumerate()
        .tap((seq, idx) => {
          logged.push({ id: seq.id, idx });
        })
        .collect();

      expect(results).toHaveLength(3);
      expect(logged).toEqual([
        { id: "seq1", idx: 0 },
        { id: "seq2", idx: 1 },
        { id: "seq3", idx: 2 },
      ]);
    });

    test("supports async side effects", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const asyncLog: string[] = [];

      const results = await seqops(arrayToAsync(sequences))
        .tap(async (seq) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          asyncLog.push(seq.id);
        })
        .collect();

      expect(results).toHaveLength(2);
      expect(asyncLog).toEqual(["seq1", "seq2"]);
    });

    test("chains with other operations", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GG"),
        createSequence("seq3", "AAAA"),
      ];

      let tappedCount = 0;

      const results = await seqops(arrayToAsync(sequences))
        .filter({ minLength: 3 })
        .tap(() => {
          tappedCount++;
        })
        .map((seq) => ({ ...seq, id: `modified_${seq.id}` }))
        .collect();

      expect(results).toHaveLength(2);
      expect(tappedCount).toBe(2); // Only tapped filtered sequences
      expect(results[0]?.id).toBe("modified_seq1");
    });

    test("preserves type through tap", async () => {
      const sequences = [
        createFastq("read1", "ATCG", "IIII"),
        createFastq("read2", "GGGG", "!!!!"),
      ];

      const results = await seqops<FastqSequence>(arrayToAsync(sequences))
        .tap((seq) => {
          // Side effect - just accessing property
          const _quality = seq.quality;
        })
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.quality).toBe("IIII");
    });

    test("handles empty stream", async () => {
      const sequences: AbstractSequence[] = [];
      let called = false;

      const results = await seqops(arrayToAsync(sequences))
        .tap(() => {
          called = true;
        })
        .collect();

      expect(results).toHaveLength(0);
      expect(called).toBe(false);
    });

    test("collects statistics without modifying stream", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGGGG"),
        createSequence("seq3", "AA"),
      ];

      const stats = { totalLength: 0, count: 0 };

      const results = await seqops(arrayToAsync(sequences))
        .tap((seq) => {
          stats.totalLength += seq.length;
          stats.count++;
        })
        .filter({ minLength: 3 })
        .collect();

      expect(results).toHaveLength(2); // Filtered
      expect(stats.count).toBe(3); // Tapped all before filter
      expect(stats.totalLength).toBe(12); // 4 + 6 + 2
    });

    test("supports progress tracking with index", async () => {
      const sequences = Array.from({ length: 15 }, (_, i) => createSequence(`seq${i}`, "ATCG"));

      const milestones: number[] = [];

      await seqops(arrayToAsync(sequences))
        .enumerate()
        .tap((seq, idx) => {
          if (idx % 5 === 0) milestones.push(idx);
        })
        .collect();

      expect(milestones).toEqual([0, 5, 10]);
    });
  });

  describe("flatMap method", () => {
    test("maps and flattens array results", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const results = await seqops(arrayToAsync(sequences))
        .flatMap((seq) => [
          { ...seq, id: `${seq.id}_a` },
          { ...seq, id: `${seq.id}_b` },
        ])
        .collect();

      expect(results).toHaveLength(4);
      expect(results[0]?.id).toBe("seq1_a");
      expect(results[1]?.id).toBe("seq1_b");
      expect(results[2]?.id).toBe("seq2_a");
      expect(results[3]?.id).toBe("seq2_b");
    });

    test("handles empty array results", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const results = await seqops(arrayToAsync(sequences))
        .flatMap((seq) => (seq.id === "seq1" ? [{ ...seq, id: "expanded" }] : []))
        .collect();

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("expanded");
    });

    test("supports async iterable results", async () => {
      const sequences = [createSequence("seq1", "ATCG")];

      async function* expand(seq: AbstractSequence) {
        yield { ...seq, id: `${seq.id}_1` };
        yield { ...seq, id: `${seq.id}_2` };
      }

      const results = await seqops(arrayToAsync(sequences))
        .flatMap((seq) => expand(seq))
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("seq1_1");
      expect(results[1]?.id).toBe("seq1_2");
    });

    test("enables index parameter after enumerate", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const results = await seqops(arrayToAsync(sequences))
        .enumerate()
        .flatMap((seq, idx) => {
          const count = idx + 1; // First seq: 1 copy, second seq: 2 copies
          return Array.from({ length: count }, (_, i) => ({
            ...seq,
            id: `${seq.id}_copy${i}`,
          }));
        })
        .collect();

      expect(results).toHaveLength(3); // 1 + 2
      expect(results[0]?.id).toBe("seq1_copy0");
      expect(results[1]?.id).toBe("seq2_copy0");
      expect(results[2]?.id).toBe("seq2_copy1");
    });

    test("supports async array results", async () => {
      const sequences = [createSequence("seq1", "ATCG")];

      const results = await seqops(arrayToAsync(sequences))
        .flatMap(async (seq) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return [
            { ...seq, id: `${seq.id}_a` },
            { ...seq, id: `${seq.id}_b` },
          ];
        })
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("seq1_a");
      expect(results[1]?.id).toBe("seq1_b");
    });

    test("preserves type through flatMap", async () => {
      const sequences = [createFastq("read1", "ATCG", "IIII")];

      const results = await seqops<FastqSequence>(arrayToAsync(sequences))
        .flatMap((seq) => [
          { ...seq, id: `${seq.id}_1` },
          { ...seq, id: `${seq.id}_2` },
        ])
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.quality).toBe("IIII");
      expect(results[1]?.quality).toBe("IIII");
    });

    test("handles empty stream", async () => {
      const sequences: AbstractSequence[] = [];

      const results = await seqops(arrayToAsync(sequences))
        .flatMap((seq) => [seq, seq])
        .collect();

      expect(results).toHaveLength(0);
    });

    test("chains with other operations", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "AA")];

      const results = await seqops(arrayToAsync(sequences))
        .filter({ minLength: 3 })
        .flatMap((seq) => [{ ...seq, id: `${seq.id}_expanded` }])
        .collect();

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("seq1_expanded");
    });

    test("can expand to different counts per sequence", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGG"),
        createSequence("seq3", "AAAA"),
      ];

      const results = await seqops(arrayToAsync(sequences))
        .flatMap((seq) => {
          const copies = seq.length / 2; // 2, 2, 2
          return Array.from({ length: copies }, () => ({ ...seq }));
        })
        .collect();

      expect(results).toHaveLength(6); // 2 + 2 + 2
    });
  });

  describe("forEach method", () => {
    test("executes callback for each sequence without modifying", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
        { format: "fasta" as const, id: "seq3", sequence: "TTAA", length: 4 },
      ];

      const collected: string[] = [];
      await seqops(arrayToAsync(sequences)).forEach((seq) => {
        collected.push(seq.id);
      });

      expect(collected).toEqual(["seq1", "seq2", "seq3"]);
    });

    test("enables index parameter after enumerate", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
        { format: "fasta" as const, id: "seq3", sequence: "TTAA", length: 4 },
      ];

      const collected: Array<{ id: string; index: number }> = [];
      await seqops(arrayToAsync(sequences))
        .enumerate()
        .forEach((seq, idx) => {
          collected.push({ id: seq.id, index: idx });
        });

      expect(collected).toEqual([
        { id: "seq1", index: 0 },
        { id: "seq2", index: 1 },
        { id: "seq3", index: 2 },
      ]);
    });

    test("supports async callbacks", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
      ];

      const collected: string[] = [];
      await seqops(arrayToAsync(sequences)).forEach(async (seq) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        collected.push(seq.id);
      });

      expect(collected).toEqual(["seq1", "seq2"]);
    });

    test("preserves FastqSequence type", async () => {
      const sequences: FastqSequence[] = [
        {
          format: "fastq",
          id: "read1",
          sequence: "ATCG",
          quality: "IIII",
          qualityEncoding: "phred33",
          length: 4,
        },
      ];

      let qualityFound = false;
      await seqops<FastqSequence>(arrayToAsync(sequences)).forEach((seq) => {
        if (seq.quality !== undefined) {
          qualityFound = true;
        }
      });

      expect(qualityFound).toBe(true);
    });

    test("handles empty stream", async () => {
      const sequences: AbstractSequence[] = [];
      let count = 0;

      await seqops(arrayToAsync(sequences)).forEach(() => {
        count++;
      });

      expect(count).toBe(0);
    });

    test("executes in order", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
        { format: "fasta" as const, id: "seq3", sequence: "TTAA", length: 4 },
      ];

      const order: string[] = [];
      await seqops(arrayToAsync(sequences)).forEach((seq) => {
        order.push(seq.id);
      });

      expect(order).toEqual(["seq1", "seq2", "seq3"]);
    });

    test("propagates errors from callback", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
      ];

      await expect(async () => {
        await seqops(arrayToAsync(sequences)).forEach((seq) => {
          if (seq.id === "seq2") {
            throw new Error("Test error");
          }
        });
      }).toThrow("Test error");
    });

    test("works with progress tracking using index", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
        { format: "fasta" as const, id: "seq3", sequence: "TTAA", length: 4 },
      ];

      const progress: number[] = [];
      await seqops(arrayToAsync(sequences))
        .enumerate()
        .forEach((seq, idx) => {
          if (idx % 1 === 0) {
            progress.push(idx);
          }
        });

      expect(progress).toEqual([0, 1, 2]);
    });
  });

  describe("reduce method", () => {
    test("finds longest sequence without index", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "ATCGATCG", length: 8 },
        { format: "fasta" as const, id: "seq3", sequence: "ATG", length: 3 },
      ];

      const longest = await seqops(arrayToAsync(sequences)).reduce((acc, seq) =>
        seq.length > acc.length ? seq : acc
      );

      expect(longest?.id).toBe("seq2");
      expect(longest?.length).toBe(8);
    });

    test("enables index parameter after enumerate", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
        { format: "fasta" as const, id: "seq3", sequence: "TTAA", length: 4 },
      ];

      const indices: number[] = [];
      const result = await seqops(arrayToAsync(sequences))
        .enumerate()
        .reduce((acc, seq, idx) => {
          indices.push(idx);
          return seq.length > acc.length ? seq : acc;
        });

      expect(result).toBeDefined();
      expect(indices).toEqual([1, 2]); // Starts at 1 since first is accumulator
    });

    test("returns undefined for empty stream", async () => {
      const sequences: AbstractSequence[] = [];

      const result = await seqops(arrayToAsync(sequences)).reduce((acc, seq) =>
        seq.length > acc.length ? seq : acc
      );

      expect(result).toBeUndefined();
    });

    test("returns first element when stream has only one element", async () => {
      const sequences = [{ format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 }];

      const result = await seqops(arrayToAsync(sequences)).reduce((acc, seq) =>
        seq.length > acc.length ? seq : acc
      );

      expect(result?.id).toBe("seq1");
    });

    test("preserves FastqSequence type", async () => {
      const sequences: FastqSequence[] = [
        {
          format: "fastq",
          id: "read1",
          sequence: "ATCG",
          quality: "IIII",
          qualityEncoding: "phred33",
          length: 4,
        },
        {
          format: "fastq",
          id: "read2",
          sequence: "ATCGATCG",
          quality: "IIIIIIII",
          qualityEncoding: "phred33",
          length: 8,
        },
      ];

      const longest = await seqops<FastqSequence>(arrayToAsync(sequences)).reduce((acc, seq) =>
        seq.length > acc.length ? seq : acc
      );

      expect(longest?.quality).toBeDefined();
      expect(longest?.id).toBe("read2");
    });

    test("supports async reducer function", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
        { format: "fasta" as const, id: "seq3", sequence: "TTAA", length: 4 },
      ];

      const result = await seqops(arrayToAsync(sequences)).reduce(async (acc, seq) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return seq.id > acc.id ? seq : acc;
      });

      expect(result?.id).toBe("seq3"); // Alphabetically last
    });

    test("accumulates correctly through all elements", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "A", length: 1 },
        { format: "fasta" as const, id: "seq2", sequence: "AT", length: 2 },
        { format: "fasta" as const, id: "seq3", sequence: "ATG", length: 3 },
        { format: "fasta" as const, id: "seq4", sequence: "ATGC", length: 4 },
      ];

      const result = await seqops(arrayToAsync(sequences)).reduce((acc, seq) =>
        seq.length > acc.length ? seq : acc
      );

      expect(result?.id).toBe("seq4");
      expect(result?.length).toBe(4);
    });

    test("propagates errors from reducer function", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
      ];

      await expect(async () => {
        await seqops(arrayToAsync(sequences)).reduce((acc, seq) => {
          if (seq.id === "seq2") {
            throw new Error("Test error");
          }
          return seq;
        });
      }).toThrow("Test error");
    });

    test("uses index from enumerate correctly", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
        { format: "fasta" as const, id: "seq3", sequence: "TTAA", length: 4 },
      ];

      let lastIndex = -1;
      const result = await seqops(arrayToAsync(sequences))
        .enumerate()
        .reduce((acc, seq, idx) => {
          lastIndex = idx;
          return seq;
        });

      expect(result?.id).toBe("seq3");
      expect(lastIndex).toBe(2); // Last index in enumerated stream
    });
  });

  describe("fold method", () => {
    test("calculates total length", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "ATCGATCG", length: 8 },
        { format: "fasta" as const, id: "seq3", sequence: "ATG", length: 3 },
      ];

      const totalLength = await seqops(arrayToAsync(sequences)).fold(
        (sum, seq) => sum + seq.length,
        0
      );

      expect(totalLength).toBe(15);
    });

    test("builds index mapping", async () => {
      const sequences: FastqSequence[] = [
        {
          format: "fastq",
          id: "read1",
          sequence: "ATCG",
          quality: "IIII",
          qualityEncoding: "phred33",
          length: 4,
        },
        {
          format: "fastq",
          id: "read2",
          sequence: "GCTA",
          quality: "JJJJ",
          qualityEncoding: "phred33",
          length: 4,
        },
      ];

      const index = await seqops<FastqSequence>(arrayToAsync(sequences)).fold(
        (map, seq) => map.set(seq.id, seq),
        new Map<string, FastqSequence>()
      );

      expect(index.size).toBe(2);
      expect(index.get("read1")?.sequence).toBe("ATCG");
      expect(index.get("read2")?.sequence).toBe("GCTA");
    });

    test("enables index parameter after enumerate", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
        { format: "fasta" as const, id: "seq3", sequence: "TTAA", length: 4 },
      ];

      const result = await seqops(arrayToAsync(sequences))
        .enumerate()
        .fold(
          (acc, seq, idx) => {
            acc.positions.push(idx);
            acc.count++;
            return acc;
          },
          { count: 0, positions: [] as number[] }
        );

      expect(result.count).toBe(3);
      expect(result.positions).toEqual([0, 1, 2]);
    });

    test("returns initial value for empty stream", async () => {
      const sequences: AbstractSequence[] = [];

      const result = await seqops(arrayToAsync(sequences)).fold(
        (sum, seq) => sum + seq.length,
        100
      );

      expect(result).toBe(100);
    });

    test("transforms to different type", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
      ];

      const ids = await seqops(arrayToAsync(sequences)).fold(
        (arr, seq) => [...arr, seq.id],
        [] as string[]
      );

      expect(ids).toEqual(["seq1", "seq2"]);
    });

    test("supports async folder function", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
      ];

      const result = await seqops(arrayToAsync(sequences)).fold(async (sum, seq) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return sum + seq.length;
      }, 0);

      expect(result).toBe(8);
    });

    test("collects statistics", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "ATCGATCG", length: 8 },
        { format: "fasta" as const, id: "seq3", sequence: "AT", length: 2 },
      ];

      const stats = await seqops(arrayToAsync(sequences)).fold(
        (acc, seq) => ({
          min: Math.min(acc.min, seq.length),
          max: Math.max(acc.max, seq.length),
          sum: acc.sum + seq.length,
          count: acc.count + 1,
        }),
        { min: Infinity, max: -Infinity, sum: 0, count: 0 }
      );

      expect(stats).toEqual({
        min: 2,
        max: 8,
        sum: 14,
        count: 3,
      });
    });

    test("propagates errors from folder function", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
      ];

      await expect(async () => {
        await seqops(arrayToAsync(sequences)).fold((sum, seq) => {
          if (seq.id === "seq2") {
            throw new Error("Test error");
          }
          return sum + seq.length;
        }, 0);
      }).toThrow("Test error");
    });

    test("accumulates complex object with position tracking", async () => {
      const sequences = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
        { format: "fasta" as const, id: "seq3", sequence: "TTAA", length: 4 },
      ];

      const result = await seqops(arrayToAsync(sequences))
        .enumerate()
        .fold(
          (acc, seq, idx) => ({
            ids: [...acc.ids, seq.id],
            indices: [...acc.indices, idx],
            totalLength: acc.totalLength + seq.length,
          }),
          { ids: [] as string[], indices: [] as number[], totalLength: 0 }
        );

      expect(result).toEqual({
        ids: ["seq1", "seq2", "seq3"],
        indices: [0, 1, 2],
        totalLength: 12,
      });
    });
  });

  describe("zipWith method", () => {
    test("combines two streams without indices", async () => {
      const stream1 = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
      ];
      const stream2 = [
        { format: "fasta" as const, id: "rev1", sequence: "TTAA", length: 4 },
        { format: "fasta" as const, id: "rev2", sequence: "AAGG", length: 4 },
      ];

      const results = await seqops(arrayToAsync(stream1))
        .zipWith(seqops(arrayToAsync(stream2)), (a, b) => ({
          format: "fasta" as const,
          id: `${a.id}_${b.id}`,
          sequence: a.sequence + b.sequence,
          length: a.length + b.length,
        }))
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("seq1_rev1");
      expect(results[0]?.sequence).toBe("ATCGTTAA");
      expect(results[1]?.id).toBe("seq2_rev2");
    });

    test("enables indexA when left stream is enumerated", async () => {
      const stream1 = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
      ];
      const stream2 = [
        { format: "fasta" as const, id: "rev1", sequence: "TTAA", length: 4 },
        { format: "fasta" as const, id: "rev2", sequence: "AAGG", length: 4 },
      ];

      const indices: number[] = [];
      const results = await seqops(arrayToAsync(stream1))
        .enumerate()
        .zipWith(seqops(arrayToAsync(stream2)), (a, b, idxA) => {
          indices.push(idxA);
          return {
            format: "fasta" as const,
            id: `${a.id}_${b.id}`,
            sequence: a.sequence,
            length: a.length,
          };
        })
        .collect();

      expect(results).toHaveLength(2);
      expect(indices).toEqual([0, 1]);
    });

    test("enables indexB when right stream is enumerated", async () => {
      const stream1 = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
      ];
      const stream2 = [
        { format: "fasta" as const, id: "rev1", sequence: "TTAA", length: 4 },
        { format: "fasta" as const, id: "rev2", sequence: "AAGG", length: 4 },
      ];

      const indices: number[] = [];
      const results = await seqops(arrayToAsync(stream1))
        .zipWith(seqops(arrayToAsync(stream2)).enumerate(), (a, b, idxB) => {
          indices.push(idxB);
          return {
            format: "fasta" as const,
            id: `${a.id}_${b.id}`,
            sequence: a.sequence,
            length: a.length,
          };
        })
        .collect();

      expect(results).toHaveLength(2);
      expect(indices).toEqual([0, 1]);
    });

    test("enables both indices when both streams are enumerated", async () => {
      const stream1 = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
      ];
      const stream2 = [
        { format: "fasta" as const, id: "rev1", sequence: "TTAA", length: 4 },
        { format: "fasta" as const, id: "rev2", sequence: "AAGG", length: 4 },
      ];

      const pairs: Array<[number, number]> = [];
      const results = await seqops(arrayToAsync(stream1))
        .enumerate()
        .zipWith(seqops(arrayToAsync(stream2)).enumerate(), (a, b, idxA, idxB) => {
          pairs.push([idxA, idxB]);
          return {
            format: "fasta" as const,
            id: `${a.id}_${b.id}`,
            sequence: a.sequence,
            length: a.length,
          };
        })
        .collect();

      expect(results).toHaveLength(2);
      expect(pairs).toEqual([
        [0, 0],
        [1, 1],
      ]);
    });

    test("stops at shortest stream", async () => {
      const stream1 = [
        { format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta" as const, id: "seq2", sequence: "GCTA", length: 4 },
        { format: "fasta" as const, id: "seq3", sequence: "TTAA", length: 4 },
      ];
      const stream2 = [{ format: "fasta" as const, id: "rev1", sequence: "AAAA", length: 4 }];

      const results = await seqops(arrayToAsync(stream1))
        .zipWith(seqops(arrayToAsync(stream2)), (a, b) => ({
          format: "fasta" as const,
          id: `${a.id}_${b.id}`,
          sequence: a.sequence,
          length: a.length,
        }))
        .collect();

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("seq1_rev1");
    });

    test("works with raw AsyncIterable", async () => {
      const stream1 = [{ format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 }];

      async function* generator() {
        yield { format: "fasta" as const, id: "rev1", sequence: "TTAA", length: 4 };
      }

      const results = await seqops(arrayToAsync(stream1))
        .zipWith(generator(), (a, b) => ({
          format: "fasta" as const,
          id: `${a.id}_${b.id}`,
          sequence: a.sequence + b.sequence,
          length: a.length + b.length,
        }))
        .collect();

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("ATCGTTAA");
    });

    test("supports async combining function", async () => {
      const stream1 = [{ format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 }];
      const stream2 = [{ format: "fasta" as const, id: "rev1", sequence: "TTAA", length: 4 }];

      const results = await seqops(arrayToAsync(stream1))
        .zipWith(seqops(arrayToAsync(stream2)), async (a, b) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return {
            format: "fasta" as const,
            id: `${a.id}_${b.id}`,
            sequence: a.sequence,
            length: a.length,
          };
        })
        .collect();

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("seq1_rev1");
    });

    test("preserves FastqSequence type", async () => {
      const stream1: FastqSequence[] = [
        {
          format: "fastq",
          id: "read1",
          sequence: "ATCG",
          quality: "IIII",
          qualityEncoding: "phred33",
          length: 4,
        },
      ];
      const stream2: FastqSequence[] = [
        {
          format: "fastq",
          id: "read2",
          sequence: "GCTA",
          quality: "JJJJ",
          qualityEncoding: "phred33",
          length: 4,
        },
      ];

      const results = await seqops<FastqSequence>(arrayToAsync(stream1))
        .zipWith(seqops<FastqSequence>(arrayToAsync(stream2)), (a, b) => ({
          format: "fastq" as const,
          id: `${a.id}_${b.id}`,
          sequence: a.sequence + b.sequence,
          quality: a.quality + b.quality,
          qualityEncoding: "phred33" as const,
          length: a.length + b.length,
        }))
        .collect();

      expect(results[0]?.quality).toBe("IIIIJJJJ");
    });

    test("propagates errors from combining function", async () => {
      const stream1 = [{ format: "fasta" as const, id: "seq1", sequence: "ATCG", length: 4 }];
      const stream2 = [{ format: "fasta" as const, id: "rev1", sequence: "TTAA", length: 4 }];

      await expect(async () => {
        await seqops(arrayToAsync(stream1))
          .zipWith(seqops(arrayToAsync(stream2)), (a, b) => {
            throw new Error("Test error");
          })
          .collect();
      }).toThrow("Test error");
    });
  });

  describe("enumerate method", () => {
    test("attaches zero-based index to sequences", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GGGG"),
        createSequence("seq3", "AAAA"),
      ];

      const results = await seqops(arrayToAsync(sequences)).enumerate().collect();

      expect(results).toHaveLength(3);
      expect(results[0]?.index).toBe(0);
      expect(results[1]?.index).toBe(1);
      expect(results[2]?.index).toBe(2);
    });

    test("enables index parameter in map", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const results = await seqops(arrayToAsync(sequences))
        .enumerate()
        .map((seq, idx) => ({
          ...seq,
          description: `position=${idx}`,
        }))
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.description).toBe("position=0");
      expect(results[1]?.description).toBe("position=1");
    });

    test("enables index parameter in filter", async () => {
      const sequences = [
        createSequence("seq0", "AAAA"),
        createSequence("seq1", "TTTT"),
        createSequence("seq2", "GGGG"),
        createSequence("seq3", "CCCC"),
        createSequence("seq4", "ATCG"),
      ];

      const results = await seqops(arrayToAsync(sequences))
        .enumerate()
        .filter((seq, idx) => idx % 2 === 0) // Keep even positions
        .collect();

      expect(results).toHaveLength(3);
      expect(results[0]?.id).toBe("seq0");
      expect(results[0]?.index).toBe(0);
      expect(results[1]?.id).toBe("seq2");
      expect(results[1]?.index).toBe(2);
      expect(results[2]?.id).toBe("seq4");
      expect(results[2]?.index).toBe(4);
    });

    test("preserves FastqSequence type with index", async () => {
      const sequences = [
        createFastq("read1", "ATCG", "IIII"),
        createFastq("read2", "GGGG", "!!!!"),
      ];

      const results = await seqops<FastqSequence>(arrayToAsync(sequences)).enumerate().collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.quality).toBe("IIII");
      expect(results[0]?.index).toBe(0);
      expect(results[1]?.quality).toBe("!!!!");
      expect(results[1]?.index).toBe(1);
    });

    test("works with async map and index", async () => {
      const sequences = [createSequence("seq1", "ATCG"), createSequence("seq2", "GGGG")];

      const results = await seqops(arrayToAsync(sequences))
        .enumerate()
        .map(async (seq, idx) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { ...seq, description: `async_${idx}` };
        })
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.description).toBe("async_0");
      expect(results[1]?.description).toBe("async_1");
    });

    test("handles empty stream", async () => {
      const sequences: AbstractSequence[] = [];

      const results = await seqops(arrayToAsync(sequences)).enumerate().collect();

      expect(results).toHaveLength(0);
    });

    test("chains with multiple operations", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "GG"),
        createSequence("seq3", "AAAA"),
      ];

      const results = await seqops(arrayToAsync(sequences))
        .filter({ minLength: 3 })
        .enumerate()
        .map((seq, idx) => ({
          ...seq,
          id: `${seq.id}_pos${idx}`,
        }))
        .collect();

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("seq1_pos0");
      expect(results[1]?.id).toBe("seq3_pos1");
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

  // Iterator Combinator: .interleave()
  describe(".interleave()", () => {
    describe("basic functionality", () => {
      test("interleaves two streams in alternating order", async () => {
        const left = [
          createSequence("L1", "AAA"),
          createSequence("L2", "CCC"),
          createSequence("L3", "GGG"),
        ];
        const right = [
          createSequence("R1", "TTT"),
          createSequence("R2", "AAA"),
          createSequence("R3", "CCC"),
        ];

        const result = await seqops(arrayToAsync(left)).interleave(arrayToAsync(right)).collect();

        expect(result).toHaveLength(6);
        expect(result[0]?.id).toBe("L1"); // Left first
        expect(result[1]?.id).toBe("R1"); // Right second
        expect(result[2]?.id).toBe("L2"); // Left third
        expect(result[3]?.id).toBe("R2"); // Right fourth
        expect(result[4]?.id).toBe("L3"); // Left fifth
        expect(result[5]?.id).toBe("R3"); // Right sixth
      });

      test("throws on length mismatch by default (strict mode)", async () => {
        const left = [createSequence("L1", "AAA"), createSequence("L2", "CCC")];
        const right = [
          createSequence("R1", "TTT"),
          createSequence("R2", "AAA"),
          createSequence("R3", "CCC"),
          createSequence("R4", "GGG"),
          createSequence("R5", "TTT"),
        ];

        await expect(async () => {
          await seqops(arrayToAsync(left)).interleave(arrayToAsync(right)).collect();
        }).toThrow(/left stream exhausted.*right stream continues/);
      });

      test("strict mode throws when left stream is longer", async () => {
        const left = [
          createSequence("L1", "AAA"),
          createSequence("L2", "CCC"),
          createSequence("L3", "GGG"),
        ];
        const right = [createSequence("R1", "TTT"), createSequence("R2", "AAA")];

        await expect(async () => {
          await seqops(arrayToAsync(left))
            .interleave(arrayToAsync(right), { mode: "strict" })
            .collect();
        }).toThrow(/right stream exhausted.*left stream continues/);
      });

      test("strict mode throws when right stream is longer", async () => {
        const left = [createSequence("L1", "AAA"), createSequence("L2", "CCC")];
        const right = [
          createSequence("R1", "TTT"),
          createSequence("R2", "AAA"),
          createSequence("R3", "GGG"),
        ];

        await expect(async () => {
          await seqops(arrayToAsync(left))
            .interleave(arrayToAsync(right), { mode: "strict" })
            .collect();
        }).toThrow(/left stream exhausted.*right stream continues/);
      });

      test("strict mode succeeds when lengths match exactly", async () => {
        const left = [createSequence("L1", "AAA"), createSequence("L2", "CCC")];
        const right = [createSequence("R1", "TTT"), createSequence("R2", "GGG")];

        const result = await seqops(arrayToAsync(left))
          .interleave(arrayToAsync(right), { mode: "strict" })
          .collect();

        expect(result).toHaveLength(4);
        expect(result.map((s) => s.id)).toEqual(["L1", "R1", "L2", "R2"]);
      });

      test("lossless mode preserves unpaired sequences from left", async () => {
        const left = [
          createSequence("L1", "AAA"),
          createSequence("L2", "CCC"),
          createSequence("L3", "GGG"),
          createSequence("L4", "TTT"),
        ];
        const right = [createSequence("R1", "TTT"), createSequence("R2", "AAA")];

        const result = await seqops(arrayToAsync(left))
          .interleave(arrayToAsync(right), { mode: "lossless" })
          .collect();

        expect(result).toHaveLength(6);
        expect(result.map((s) => s.id)).toEqual(["L1", "R1", "L2", "R2", "L3", "L4"]);
      });

      test("lossless mode preserves unpaired sequences from right", async () => {
        const left = [createSequence("L1", "AAA"), createSequence("L2", "CCC")];
        const right = [
          createSequence("R1", "TTT"),
          createSequence("R2", "AAA"),
          createSequence("R3", "GGG"),
          createSequence("R4", "CCC"),
        ];

        const result = await seqops(arrayToAsync(left))
          .interleave(arrayToAsync(right), { mode: "lossless" })
          .collect();

        expect(result).toHaveLength(6);
        expect(result.map((s) => s.id)).toEqual(["L1", "R1", "L2", "R2", "R3", "R4"]);
      });

      test("lossless mode calls onUnpaired callback with left stats", async () => {
        const left = [
          createSequence("L1", "AAA"),
          createSequence("L2", "CCC"),
          createSequence("L3", "GGG"),
        ];
        const right = [createSequence("R1", "TTT"), createSequence("R2", "AAA")];

        let capturedStats: UnpairedStats | undefined;

        await seqops(arrayToAsync(left))
          .interleave(arrayToAsync(right), {
            mode: "lossless",
            onUnpaired: (stats) => {
              capturedStats = stats;
            },
          })
          .collect();

        expect(capturedStats).toEqual({
          pairedCount: 2,
          unpairedSource: "left",
          unpairedCount: 1,
        });
      });

      test("lossless mode calls onUnpaired callback with right stats", async () => {
        const left = [createSequence("L1", "AAA"), createSequence("L2", "CCC")];
        const right = [
          createSequence("R1", "TTT"),
          createSequence("R2", "AAA"),
          createSequence("R3", "GGG"),
        ];

        let capturedStats: UnpairedStats | undefined;

        await seqops(arrayToAsync(left))
          .interleave(arrayToAsync(right), {
            mode: "lossless",
            onUnpaired: (stats) => {
              capturedStats = stats;
            },
          })
          .collect();

        expect(capturedStats).toEqual({
          pairedCount: 2,
          unpairedSource: "right",
          unpairedCount: 1,
        });
      });

      test("lossless mode does not call onUnpaired when lengths match", async () => {
        const left = [createSequence("L1", "AAA"), createSequence("L2", "CCC")];
        const right = [createSequence("R1", "TTT"), createSequence("R2", "GGG")];

        let callbackInvoked = false;

        await seqops(arrayToAsync(left))
          .interleave(arrayToAsync(right), {
            mode: "lossless",
            onUnpaired: () => {
              callbackInvoked = true;
            },
          })
          .collect();

        expect(callbackInvoked).toBe(false);
      });
    });
  });

  describe("ID validation", () => {
    test("validates matching IDs when enabled", async () => {
      const left = [createSequence("read_001", "AAA"), createSequence("read_002", "CCC")];
      const right = [createSequence("read_001", "TTT"), createSequence("read_002", "GGG")];

      const result = await seqops(arrayToAsync(left))
        .interleave(arrayToAsync(right), { validateIds: true })
        .collect();

      // Should succeed - IDs match
      expect(result).toHaveLength(4);
      expect(result[0]?.id).toBe("read_001");
      expect(result[1]?.id).toBe("read_001");
      expect(result[2]?.id).toBe("read_002");
      expect(result[3]?.id).toBe("read_002");
    });

    test("throws error on ID mismatch", async () => {
      const left = [createSequence("read_001", "AAA"), createSequence("read_002", "CCC")];
      const right = [
        createSequence("read_001", "TTT"),
        createSequence("read_999", "GGG"), // Mismatched ID
      ];

      await expect(async () => {
        await seqops(arrayToAsync(left))
          .interleave(arrayToAsync(right), { validateIds: true })
          .collect();
      }).toThrow('ID mismatch at position 1: left="read_002", right="read_999"');
    });

    test("works without validation by default", async () => {
      const left = [createSequence("read_001", "AAA"), createSequence("read_002", "CCC")];
      const right = [
        createSequence("read_999", "TTT"), // Different ID
        createSequence("read_888", "GGG"), // Different ID
      ];

      const result = await seqops(arrayToAsync(left))
        .interleave(arrayToAsync(right)) // No validateIds option
        .collect();

      // Should succeed - validation disabled by default
      expect(result).toHaveLength(4);
      expect(result[0]?.id).toBe("read_001");
      expect(result[1]?.id).toBe("read_999");
      expect(result[2]?.id).toBe("read_002");
      expect(result[3]?.id).toBe("read_888");
    });

    test("uses custom ID comparator", async () => {
      // Illumina paired-end format: forward has /1 suffix, reverse has /2 suffix
      const forward = [
        createSequence("SRR123_READ001/1", "ATCGATCG"),
        createSequence("SRR123_READ002/1", "GCTAGCTA"),
      ];
      const reverse = [
        createSequence("SRR123_READ001/2", "CGTAGCTA"),
        createSequence("SRR123_READ002/2", "TAGCTAGC"),
      ];

      // Custom comparator that strips /1 and /2 suffixes for comparison
      const result = await seqops(arrayToAsync(forward))
        .interleave(arrayToAsync(reverse), {
          validateIds: true,
          idComparator: (idA, idB) => {
            const stripSuffix = (id: string) => id.replace(/\/[12]$/, "");
            return stripSuffix(idA) === stripSuffix(idB);
          },
        })
        .collect();

      // Should succeed - base IDs match after stripping suffixes
      expect(result).toHaveLength(4);
      expect(result[0]?.id).toBe("SRR123_READ001/1");
      expect(result[1]?.id).toBe("SRR123_READ001/2");
      expect(result[2]?.id).toBe("SRR123_READ002/1");
      expect(result[3]?.id).toBe("SRR123_READ002/2");
    });
  });

  describe("type safety", () => {
    test("preserves FastqSequence type through chain", async () => {
      // Create FastqSequence objects with quality scores
      const forward: FastqSequence[] = [
        {
          format: "fastq" as const,
          id: "read1",
          sequence: "ATCG",
          length: 4,
          quality: "IIII",
          qualityEncoding: "phred33" as const,
        },
        {
          format: "fastq" as const,
          id: "read2",
          sequence: "GCTA",
          length: 4,
          quality: "JJJJ",
          qualityEncoding: "phred33" as const,
        },
      ];
      const reverse: FastqSequence[] = [
        {
          format: "fastq" as const,
          id: "read1",
          sequence: "CGAT",
          length: 4,
          quality: "KKKK",
          qualityEncoding: "phred33" as const,
        },
        {
          format: "fastq" as const,
          id: "read2",
          sequence: "TAGC",
          length: 4,
          quality: "LLLL",
          qualityEncoding: "phred33" as const,
        },
      ];

      const result = await seqops<FastqSequence>(arrayToAsync(forward))
        .interleave(arrayToAsync(reverse))
        .collect();

      // Type is preserved - quality property exists
      expect(result).toHaveLength(4);
      expect(result[0]?.quality).toBe("IIII");
      expect(result[1]?.quality).toBe("KKKK");
      expect(result[2]?.quality).toBe("JJJJ");
      expect(result[3]?.quality).toBe("LLLL");
    });

    test("works with both SeqOps and AsyncIterable", async () => {
      const left = [createSequence("L1", "AAA"), createSequence("L2", "CCC")];
      const right = [createSequence("R1", "TTT"), createSequence("R2", "GGG")];

      // Left: SeqOps, Right: raw AsyncIterable
      const result1 = await seqops(arrayToAsync(left)).interleave(arrayToAsync(right)).collect();

      expect(result1).toHaveLength(4);
      expect(result1[0]?.id).toBe("L1");
      expect(result1[1]?.id).toBe("R1");

      // Left: SeqOps, Right: SeqOps
      const result2 = await seqops(arrayToAsync(left))
        .interleave(seqops(arrayToAsync(right)))
        .collect();

      expect(result2).toHaveLength(4);
      expect(result2[0]?.id).toBe("L1");
      expect(result2[1]?.id).toBe("R1");
    });
  });

  describe("edge cases", () => {
    test("handles empty left stream", async () => {
      const left: AbstractSequence[] = [];
      const right = [
        createSequence("R1", "TTT"),
        createSequence("R2", "AAA"),
        createSequence("R3", "CCC"),
      ];

      // Strict mode should throw
      await expect(async () => {
        await seqops(arrayToAsync(left)).interleave(arrayToAsync(right)).collect();
      }).toThrow(/left stream exhausted.*right stream continues/);

      // Lossless mode should preserve all right sequences
      const result = await seqops(arrayToAsync(left))
        .interleave(arrayToAsync(right), { mode: "lossless" })
        .collect();

      expect(result).toHaveLength(3);
      expect(result.map((s) => s.id)).toEqual(["R1", "R2", "R3"]);
    });

    test("handles empty right stream", async () => {
      const left = [
        createSequence("L1", "AAA"),
        createSequence("L2", "CCC"),
        createSequence("L3", "GGG"),
      ];
      const right: AbstractSequence[] = [];

      // Strict mode should throw
      await expect(async () => {
        await seqops(arrayToAsync(left)).interleave(arrayToAsync(right)).collect();
      }).toThrow(/right stream exhausted.*left stream continues/);

      // Lossless mode should preserve all left sequences
      const result = await seqops(arrayToAsync(left))
        .interleave(arrayToAsync(right), { mode: "lossless" })
        .collect();

      expect(result).toHaveLength(3);
      expect(result.map((s) => s.id)).toEqual(["L1", "L2", "L3"]);
    });

    test("handles both streams empty", async () => {
      const left: AbstractSequence[] = [];
      const right: AbstractSequence[] = [];

      const result = await seqops(arrayToAsync(left)).interleave(arrayToAsync(right)).collect();

      // Should return empty array
      expect(result).toHaveLength(0);
    });
  });

  describe("integration", () => {
    test("works with enumerate after interleaving", async () => {
      const left = [createSequence("L1", "AAA"), createSequence("L2", "CCC")];
      const right = [createSequence("R1", "TTT"), createSequence("R2", "GGG")];

      const result = await seqops(arrayToAsync(left))
        .interleave(arrayToAsync(right))
        .enumerate()
        .collect();

      // Should have indices attached
      expect(result).toHaveLength(4);
      expect(result[0]?.index).toBe(0); // L1
      expect(result[1]?.index).toBe(1); // R1
      expect(result[2]?.index).toBe(2); // L2
      expect(result[3]?.index).toBe(3); // R2
      // Alternating pattern should be preserved
      expect(result[0]?.id).toBe("L1");
      expect(result[1]?.id).toBe("R1");
      expect(result[2]?.id).toBe("L2");
      expect(result[3]?.id).toBe("R2");
    });

    test("strict mode with filter before interleaving throws on mismatch", async () => {
      const left = [
        createSequence("L1", "AA"), // length 2
        createSequence("L2", "CCCCCC"), // length 6
        createSequence("L3", "GG"), // length 2
      ];
      const right = [
        createSequence("R1", "TTTTTT"), // length 6
        createSequence("R2", "AAAA"), // length 4
        createSequence("R3", "CC"), // length 2
      ];

      // Left after filter: L2 (length 6)
      // Right after filter: R1 (length 6), R2 (length 4)
      // Strict mode should throw because streams have different lengths (1 vs 2)
      await expect(async () => {
        await seqops(arrayToAsync(left))
          .filter((seq) => seq.length > 3)
          .interleave(seqops(arrayToAsync(right)).filter((seq) => seq.length > 3))
          .collect();
      }).toThrow(/left stream exhausted.*right stream continues/);
    });

    test("lossless mode with filter before interleaving preserves all sequences", async () => {
      const left = [
        createSequence("L1", "AA"), // length 2
        createSequence("L2", "CCCCCC"), // length 6
        createSequence("L3", "GG"), // length 2
      ];
      const right = [
        createSequence("R1", "TTTTTT"), // length 6
        createSequence("R2", "AAAA"), // length 4
        createSequence("R3", "CC"), // length 2
      ];

      // Left after filter: L2 (length 6)
      // Right after filter: R1 (length 6), R2 (length 4)
      // Lossless mode should preserve both unpaired from right
      const result = await seqops(arrayToAsync(left))
        .filter((seq) => seq.length > 3)
        .interleave(
          seqops(arrayToAsync(right)).filter((seq) => seq.length > 3),
          {
            mode: "lossless",
          }
        )
        .collect();

      expect(result).toHaveLength(3);
      expect(result[0]?.id).toBe("L2");
      expect(result[0]?.length).toBe(6);
      expect(result[1]?.id).toBe("R1");
      expect(result[1]?.length).toBe(6);
      expect(result[2]?.id).toBe("R2");
      expect(result[2]?.length).toBe(4);
    });
  });
});
