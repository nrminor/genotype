/**
 * Comprehensive Tests for PairProcessor
 *
 * Tests paired-end read matching functionality with:
 * - Dual-stream mode (matching R1 and R2 from separate files)
 * - Single-stream mode (repairing pairing within mixed stream)
 * - Buffer management and memory limits
 * - Unpaired read handling (warn/skip/error modes)
 * - ID extraction and matching logic
 *
 * Follows established test patterns with Bun test framework.
 */

import { describe, expect, test } from "bun:test";
import { MemoryError, PairSyncError } from "../../src/errors";
import { SeqOps } from "../../src/operations";
import { PairProcessor } from "../../src/operations/pair";
import type { FastaSequence, FastqSequence } from "../../src/types";

describe("PairProcessor", () => {
  const processor = new PairProcessor();

  // Helper to create FASTQ sequences
  function createFastq(id: string, sequence: string, quality: string): FastqSequence {
    return {
      format: "fastq" as const,
      id,
      sequence,
      quality,
      qualityEncoding: "phred33" as const,
      length: sequence.length,
    };
  }

  // Helper to convert sequences to async iterable
  async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item;
    }
  }

  describe("Dual-stream mode", () => {
    test("matches reads with /1 and /2 suffixes", async () => {
      const r1 = toAsyncIterable([
        createFastq("read1/1", "ATCG", "IIII"),
        createFastq("read2/1", "GGCC", "IIII"),
      ]);
      const r2 = toAsyncIterable([
        createFastq("read1/2", "CGAT", "IIII"),
        createFastq("read2/2", "GGAA", "IIII"),
      ]);

      const results = await Array.fromAsync(
        processor.process({ mode: "dual", source1: r1, source2: r2 }),
      );

      expect(results).toHaveLength(4);
      expect(results[0].id).toBe("read1/1");
      expect(results[1].id).toBe("read1/2");
      expect(results[2].id).toBe("read2/1");
      expect(results[3].id).toBe("read2/2");
    });

    test("yields in interleaved order (R1, R2, R1, R2)", async () => {
      const r1 = toAsyncIterable([createFastq("A/1", "AAAA", "IIII")]);
      const r2 = toAsyncIterable([createFastq("A/2", "TTTT", "IIII")]);

      const results = await Array.fromAsync(
        processor.process({ mode: "dual", source1: r1, source2: r2 }),
      );

      expect(results[0].sequence).toBe("AAAA");
      expect(results[1].sequence).toBe("TTTT");
    });

    test("handles synchronized streams without buffering", async () => {
      const r1 = toAsyncIterable([
        createFastq("read1/1", "AAAA", "IIII"),
        createFastq("read2/1", "CCCC", "IIII"),
        createFastq("read3/1", "GGGG", "IIII"),
      ]);
      const r2 = toAsyncIterable([
        createFastq("read1/2", "TTTT", "IIII"),
        createFastq("read2/2", "GGGG", "IIII"),
        createFastq("read3/2", "CCCC", "IIII"),
      ]);

      const results = await Array.fromAsync(
        processor.process({ mode: "dual", source1: r1, source2: r2 }),
      );

      expect(results).toHaveLength(6);
      expect(results[0].id).toBe("read1/1");
      expect(results[1].id).toBe("read1/2");
      expect(results[2].id).toBe("read2/1");
      expect(results[3].id).toBe("read2/2");
      expect(results[4].id).toBe("read3/1");
      expect(results[5].id).toBe("read3/2");
    });

    test("handles shuffled streams with buffering", async () => {
      const r1 = toAsyncIterable([
        createFastq("readA/1", "AAAA", "IIII"),
        createFastq("readC/1", "CCCC", "IIII"),
        createFastq("readB/1", "GGGG", "IIII"),
      ]);
      const r2 = toAsyncIterable([
        createFastq("readB/2", "TTTT", "IIII"),
        createFastq("readA/2", "GGGG", "IIII"),
        createFastq("readC/2", "CCCC", "IIII"),
      ]);

      const results = await Array.fromAsync(
        processor.process({ mode: "dual", source1: r1, source2: r2 }),
      );

      expect(results).toHaveLength(6);
      expect(results[0].id).toBe("readA/1");
      expect(results[1].id).toBe("readA/2");
      expect(results[2].id).toBe("readB/1");
      expect(results[3].id).toBe("readB/2");
      expect(results[4].id).toBe("readC/1");
      expect(results[5].id).toBe("readC/2");
    });

    test("handles partial overlap between streams", async () => {
      const r1 = toAsyncIterable([
        createFastq("shared1/1", "AAAA", "IIII"),
        createFastq("only_r1/1", "TTTT", "IIII"),
        createFastq("shared2/1", "CCCC", "IIII"),
      ]);
      const r2 = toAsyncIterable([
        createFastq("shared1/2", "GGGG", "IIII"),
        createFastq("only_r2/2", "AAGG", "IIII"),
        createFastq("shared2/2", "TTCC", "IIII"),
      ]);

      const results = await Array.fromAsync(
        processor.process({ mode: "dual", source1: r1, source2: r2 }, { onUnpaired: "skip" }),
      );

      expect(results).toHaveLength(4);
      expect(results[0].id).toBe("shared1/1");
      expect(results[1].id).toBe("shared1/2");
      expect(results[2].id).toBe("shared2/1");
      expect(results[3].id).toBe("shared2/2");
    });
  });

  describe("Single-stream mode", () => {
    test("repairs pairing from mixed stream", async () => {
      const mixed = toAsyncIterable([
        createFastq("read1/2", "CGAT", "IIII"),
        createFastq("read1/1", "ATCG", "IIII"),
      ]);

      const results = await Array.fromAsync(processor.process({ mode: "single", source: mixed }));

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("read1/1");
      expect(results[1].id).toBe("read1/2");
    });

    test("detects R1/R2 from /1 and /2 suffixes", async () => {
      const mixed = toAsyncIterable([
        createFastq("A/2", "TTTT", "IIII"),
        createFastq("A/1", "AAAA", "IIII"),
        createFastq("B/1", "CCCC", "IIII"),
        createFastq("B/2", "GGGG", "IIII"),
      ]);

      const results = await Array.fromAsync(processor.process({ mode: "single", source: mixed }));

      expect(results[0].sequence).toBe("AAAA");
      expect(results[1].sequence).toBe("TTTT");
      expect(results[2].sequence).toBe("CCCC");
      expect(results[3].sequence).toBe("GGGG");
    });

    test("handles correctly ordered input", async () => {
      const ordered = toAsyncIterable([
        createFastq("read1/1", "AAAA", "IIII"),
        createFastq("read1/2", "TTTT", "IIII"),
        createFastq("read2/1", "CCCC", "IIII"),
        createFastq("read2/2", "GGGG", "IIII"),
      ]);

      const results = await Array.fromAsync(processor.process({ mode: "single", source: ordered }));

      expect(results).toHaveLength(4);
      expect(results[0].id).toBe("read1/1");
      expect(results[1].id).toBe("read1/2");
      expect(results[2].id).toBe("read2/1");
      expect(results[3].id).toBe("read2/2");
    });

    test("detects R1/R2 from first/second occurrence when no suffix", async () => {
      const extractNoSuffix = (id: string) => id;
      const mixed = toAsyncIterable([
        createFastq("readA", "AAAA", "IIII"),
        createFastq("readA", "TTTT", "IIII"),
        createFastq("readB", "CCCC", "IIII"),
        createFastq("readB", "GGGG", "IIII"),
      ]);

      const results = await Array.fromAsync(
        processor.process({ mode: "single", source: mixed }, { extractPairId: extractNoSuffix }),
      );

      expect(results).toHaveLength(4);
      expect(results[0].sequence).toBe("AAAA");
      expect(results[1].sequence).toBe("TTTT");
      expect(results[2].sequence).toBe("CCCC");
      expect(results[3].sequence).toBe("GGGG");
    });
  });

  describe("Buffer management", () => {
    test("handles buffer size within limit", async () => {
      const r1 = toAsyncIterable([
        createFastq("read1/1", "AAAA", "IIII"),
        createFastq("read2/1", "CCCC", "IIII"),
        createFastq("read3/1", "GGGG", "IIII"),
      ]);
      const r2 = toAsyncIterable([
        createFastq("read3/2", "TTTT", "IIII"),
        createFastq("read1/2", "GGGG", "IIII"),
        createFastq("read2/2", "CCCC", "IIII"),
      ]);

      const results = await Array.fromAsync(
        processor.process({ mode: "dual", source1: r1, source2: r2 }, { maxBufferSize: 10 }),
      );

      expect(results).toHaveLength(6);
    });

    test("throws MemoryError when buffer limit exceeded", async () => {
      const r1 = toAsyncIterable([
        createFastq("read1/1", "AAAA", "IIII"),
        createFastq("read2/1", "TTTT", "IIII"),
      ]);
      const r2 = toAsyncIterable([createFastq("read3/2", "CCCC", "IIII")]);

      await expect(async () => {
        await Array.fromAsync(
          processor.process({ mode: "dual", source1: r1, source2: r2 }, { maxBufferSize: 1 }),
        );
      }).toThrow(MemoryError);
    });

    test("warns at 80% buffer threshold", async () => {
      const r1 = toAsyncIterable([
        createFastq("read1/1", "AAAA", "IIII"),
        createFastq("read2/1", "CCCC", "IIII"),
        createFastq("read3/1", "GGGG", "IIII"),
        createFastq("read4/1", "TTTT", "IIII"),
      ]);
      const r2 = toAsyncIterable([
        createFastq("read4/2", "AAAA", "IIII"),
        createFastq("read3/2", "CCCC", "IIII"),
        createFastq("read2/2", "GGGG", "IIII"),
        createFastq("read1/2", "TTTT", "IIII"),
      ]);

      const results = await Array.fromAsync(
        processor.process({ mode: "dual", source1: r1, source2: r2 }, { maxBufferSize: 5 }),
      );

      expect(results).toHaveLength(8);
    });
  });

  describe("Unpaired read handling", () => {
    test("warns on unpaired reads by default", async () => {
      const r1 = toAsyncIterable([
        createFastq("read1/1", "AAAA", "IIII"),
        createFastq("orphan/1", "TTTT", "IIII"),
      ]);
      const r2 = toAsyncIterable([createFastq("read1/2", "CCCC", "IIII")]);

      const results = await Array.fromAsync(
        processor.process({ mode: "dual", source1: r1, source2: r2 }),
      );

      expect(results).toHaveLength(3);
    });

    test("skips unpaired reads when configured", async () => {
      const r1 = toAsyncIterable([
        createFastq("read1/1", "AAAA", "IIII"),
        createFastq("orphan/1", "TTTT", "IIII"),
      ]);
      const r2 = toAsyncIterable([createFastq("read1/2", "CCCC", "IIII")]);

      const results = await Array.fromAsync(
        processor.process({ mode: "dual", source1: r1, source2: r2 }, { onUnpaired: "skip" }),
      );

      expect(results).toHaveLength(2);
    });

    test("throws PairSyncError when onUnpaired is error", async () => {
      const r1 = toAsyncIterable([createFastq("orphan/1", "AAAA", "IIII")]);
      const r2 = toAsyncIterable([createFastq("other/2", "TTTT", "IIII")]);

      await expect(async () => {
        await Array.fromAsync(
          processor.process({ mode: "dual", source1: r1, source2: r2 }, { onUnpaired: "error" }),
        );
      }).toThrow(PairSyncError);
    });
  });
});

describe("SeqOps.pair() integration", () => {
  function createFastq(id: string, sequence: string, quality: string): FastqSequence {
    return {
      format: "fastq" as const,
      id,
      sequence,
      quality,
      qualityEncoding: "phred33" as const,
      length: sequence.length,
    };
  }

  async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item;
    }
  }

  describe("dual-stream mode", () => {
    test("pairs two SeqOps instances", async () => {
      const r1Data = [
        createFastq("read1/1", "AAAA", "IIII"),
        createFastq("read2/1", "CCCC", "IIII"),
      ];
      const r2Data = [
        createFastq("read1/2", "TTTT", "IIII"),
        createFastq("read2/2", "GGGG", "IIII"),
      ];

      const r1 = new SeqOps(toAsyncIterable(r1Data));
      const r2 = new SeqOps(toAsyncIterable(r2Data));

      const results = await Array.fromAsync(r1.pair(r2));

      expect(results).toHaveLength(4);
      expect(results[0].id).toBe("read1/1");
      expect(results[1].id).toBe("read1/2");
      expect(results[2].id).toBe("read2/1");
      expect(results[3].id).toBe("read2/2");
    });

    test("pairs SeqOps with AsyncIterable", async () => {
      const r1Data = [createFastq("read1/1", "AAAA", "IIII")];
      const r2Iterable = toAsyncIterable([createFastq("read1/2", "TTTT", "IIII")]);

      const r1 = new SeqOps(toAsyncIterable(r1Data));
      const results = await Array.fromAsync(r1.pair(r2Iterable));

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("read1/1");
      expect(results[1].id).toBe("read1/2");
    });
  });

  describe("single-stream mode", () => {
    test("repairs pairing without second stream", async () => {
      const mixed = [
        createFastq("read1/2", "TTTT", "IIII"),
        createFastq("read1/1", "AAAA", "IIII"),
      ];

      const seqOps = new SeqOps(toAsyncIterable(mixed));
      const results = await Array.fromAsync(seqOps.pair());

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("read1/1");
      expect(results[1].id).toBe("read1/2");
    });
  });

  describe("composability", () => {
    test("chains with other operations", async () => {
      const r1Data = [
        createFastq("read1/1", "AAAA", "IIII"),
        createFastq("read2/1", "CCCC", "IIII"),
      ];
      const r2Data = [
        createFastq("read1/2", "TTTT", "IIII"),
        createFastq("read2/2", "GGGG", "IIII"),
      ];

      const r1 = new SeqOps(toAsyncIterable(r1Data));
      const r2 = new SeqOps(toAsyncIterable(r2Data));

      const results = await Array.fromAsync(
        r1.pair(r2).filter((seq) => seq.sequence.includes("A")),
      );

      expect(results).toHaveLength(1);
      expect(results[0].sequence).toBe("AAAA");
    });
  });

  describe("type preservation", () => {
    test("preserves FastqSequence type", async () => {
      const r1Data: FastqSequence[] = [createFastq("read1/1", "AAAA", "IIII")];
      const r2Data: FastqSequence[] = [createFastq("read1/2", "TTTT", "IIII")];

      const r1 = new SeqOps<FastqSequence>(toAsyncIterable(r1Data));
      const r2 = new SeqOps<FastqSequence>(toAsyncIterable(r2Data));

      const results = await Array.fromAsync(r1.pair(r2));

      const fastqResult = results[0] as FastqSequence;
      expect(fastqResult.format).toBe("fastq");
      expect(fastqResult.quality).toBeDefined();
      expect(fastqResult.qualityEncoding).toBe("phred33");
    });

    test("preserves FastaSequence type", async () => {
      function createFasta(id: string, sequence: string): FastaSequence {
        return {
          format: "fasta" as const,
          id,
          sequence,
          length: sequence.length,
        };
      }

      const r1Data: FastaSequence[] = [createFasta("read1/1", "AAAA")];
      const r2Data: FastaSequence[] = [createFasta("read1/2", "TTTT")];

      const r1 = new SeqOps<FastaSequence>(toAsyncIterable(r1Data));
      const r2 = new SeqOps<FastaSequence>(toAsyncIterable(r2Data));

      const results = await Array.fromAsync(r1.pair(r2));

      const fastaResult = results[0] as FastaSequence;
      expect(fastaResult.format).toBe("fasta");
      expect(fastaResult.sequence).toBeDefined();
      expect((fastaResult as any).quality).toBeUndefined();
    });

    test("enforces generic type constraint", async () => {
      const fastqData = [createFastq("read1/1", "AAAA", "IIII")];

      const seqOps = new SeqOps<FastqSequence>(toAsyncIterable(fastqData));
      const results = await Array.fromAsync(seqOps.pair());

      const fastqResult = results[0] as FastqSequence;
      expect(fastqResult.format).toBe("fastq");
      expect(fastqResult).toHaveProperty("quality");
      expect(fastqResult).toHaveProperty("qualityEncoding");
    });
  });

  describe("real-world scenarios", () => {
    test("compares interleave() vs pair() output", async () => {
      const r1Data = [
        createFastq("read1/1", "AAAA", "IIII"),
        createFastq("read2/1", "CCCC", "IIII"),
      ];
      const r2Data = [
        createFastq("read1/2", "TTTT", "IIII"),
        createFastq("read2/2", "GGGG", "IIII"),
      ];

      const paired = await Array.fromAsync(
        new SeqOps(toAsyncIterable(r1Data)).pair(new SeqOps(toAsyncIterable(r2Data))),
      );

      const interleaved = await Array.fromAsync(
        new SeqOps(toAsyncIterable(r1Data)).interleave(new SeqOps(toAsyncIterable(r2Data))),
      );

      expect(paired).toHaveLength(4);
      expect(interleaved).toHaveLength(4);
      expect(paired[0].id).toBe("read1/1");
      expect(interleaved[0].id).toBe("read1/1");
      expect(paired[1].id).toBe("read1/2");
      expect(interleaved[1].id).toBe("read1/2");
    });

    test("integrates with quality filtering pipeline", async () => {
      const r1Data = [
        createFastq("read1/1", "AAAA", "####"),
        createFastq("read2/1", "CCCC", "IIII"),
      ];
      const r2Data = [
        createFastq("read1/2", "TTTT", "####"),
        createFastq("read2/2", "GGGG", "IIII"),
      ];

      const results = await Array.fromAsync(
        new SeqOps(toAsyncIterable(r1Data))
          .pair(new SeqOps(toAsyncIterable(r2Data)))
          .filter((seq) => !seq.quality.includes("#")),
      );

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("read2/1");
      expect(results[1].id).toBe("read2/2");
    });

    test("handles large dataset efficiently", async () => {
      const r1Data: FastqSequence[] = [];
      const r2Data: FastqSequence[] = [];

      for (let i = 0; i < 1000; i++) {
        r1Data.push(createFastq(`read${i}/1`, "AAAA", "IIII"));
        r2Data.push(createFastq(`read${i}/2`, "TTTT", "IIII"));
      }

      const r1 = new SeqOps(toAsyncIterable(r1Data));
      const r2 = new SeqOps(toAsyncIterable(r2Data));

      const results = await Array.fromAsync(r1.pair(r2));

      expect(results).toHaveLength(2000);
      expect(results[0].id).toBe("read0/1");
      expect(results[1].id).toBe("read0/2");
      expect(results[1998].id).toBe("read999/1");
      expect(results[1999].id).toBe("read999/2");
    });
  });

  describe("edge cases", () => {
    test("handles empty streams", async () => {
      const r1 = new SeqOps(toAsyncIterable([]));
      const r2 = new SeqOps(toAsyncIterable([]));

      const results = await Array.fromAsync(r1.pair(r2));

      expect(results).toHaveLength(0);
    });

    test("handles single read in each stream", async () => {
      const r1Data = [createFastq("read1/1", "AAAA", "IIII")];
      const r2Data = [createFastq("read1/2", "TTTT", "IIII")];

      const r1 = new SeqOps(toAsyncIterable(r1Data));
      const r2 = new SeqOps(toAsyncIterable(r2Data));

      const results = await Array.fromAsync(r1.pair(r2));

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("read1/1");
      expect(results[1].id).toBe("read1/2");
    });

    test("handles all unpaired reads with skip mode", async () => {
      const r1Data = [
        createFastq("readA/1", "AAAA", "IIII"),
        createFastq("readB/1", "CCCC", "IIII"),
      ];
      const r2Data = [
        createFastq("readC/2", "TTTT", "IIII"),
        createFastq("readD/2", "GGGG", "IIII"),
      ];

      const r1 = new SeqOps(toAsyncIterable(r1Data));
      const r2 = new SeqOps(toAsyncIterable(r2Data));

      const results = await Array.fromAsync(r1.pair(r2, { onUnpaired: "skip" }));

      expect(results).toHaveLength(0);
    });

    test("handles identical IDs without suffixes", async () => {
      const extractNoSuffix = (id: string) => id;
      const r1Data = [createFastq("readA", "AAAA", "IIII")];
      const r2Data = [createFastq("readA", "TTTT", "IIII")];

      const r1 = new SeqOps(toAsyncIterable(r1Data));
      const r2 = new SeqOps(toAsyncIterable(r2Data));

      const results = await Array.fromAsync(r1.pair(r2, { extractPairId: extractNoSuffix }));

      expect(results).toHaveLength(2);
      expect(results[0].sequence).toBe("AAAA");
      expect(results[1].sequence).toBe("TTTT");
    });

    test("handles missing R1 for every read", async () => {
      const r1Data: FastqSequence[] = [];
      const r2Data = [
        createFastq("read1/2", "TTTT", "IIII"),
        createFastq("read2/2", "GGGG", "IIII"),
      ];

      const r1 = new SeqOps(toAsyncIterable(r1Data));
      const r2 = new SeqOps(toAsyncIterable(r2Data));

      const results = await Array.fromAsync(r1.pair(r2, { onUnpaired: "skip" }));

      expect(results).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    test("throws MemoryError with maxBufferSize of 0", async () => {
      const r1Data = [createFastq("read1/1", "AAAA", "IIII")];
      const r2Data = [createFastq("read2/2", "TTTT", "IIII")];

      const r1 = new SeqOps(toAsyncIterable(r1Data));
      const r2 = new SeqOps(toAsyncIterable(r2Data));

      await expect(async () => {
        await Array.fromAsync(r1.pair(r2, { maxBufferSize: 0 }));
      }).toThrow(MemoryError);
    });

    test("handles negative maxBufferSize by treating as invalid", async () => {
      const r1Data = [createFastq("read1/1", "AAAA", "IIII")];
      const r2Data = [createFastq("read2/2", "TTTT", "IIII")];

      const r1 = new SeqOps(toAsyncIterable(r1Data));
      const r2 = new SeqOps(toAsyncIterable(r2Data));

      await expect(async () => {
        await Array.fromAsync(r1.pair(r2, { maxBufferSize: -1 }));
      }).toThrow(MemoryError);
    });

    test("validates onUnpaired mode at runtime", async () => {
      const r1Data = [createFastq("read1/1", "AAAA", "IIII")];
      const r2Data = [createFastq("read1/2", "TTTT", "IIII")];

      const r1 = new SeqOps(toAsyncIterable(r1Data));
      const r2 = new SeqOps(toAsyncIterable(r2Data));

      const results = await Array.fromAsync(r1.pair(r2, { onUnpaired: "warn" as const }));

      expect(results).toHaveLength(2);
    });
  });
});
