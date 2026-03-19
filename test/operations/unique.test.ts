import { describe, expect, test } from "bun:test";
import "../matchers";
import { createFastaRecord, createFastqRecord } from "../../src/constructors";
import { seqops } from "../../src/operations";
import { UniqueProcessor } from "../../src/operations/unique";
import type { AbstractSequence, FastqSequence } from "../../src/types";

describe("UniqueProcessor", () => {
  async function* makeAsync<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item;
    }
  }

  function createSequence(
    id: string,
    sequence: string,
    lineNumber?: number,
    description?: string
  ): AbstractSequence {
    return createFastaRecord({
      id,
      sequence,
      ...(lineNumber !== undefined && { lineNumber }),
      ...(description !== undefined && { description }),
    });
  }

  function createFastq(
    id: string,
    sequence: string,
    quality: string,
    lineNumber?: number,
    description?: string
  ): FastqSequence {
    return createFastqRecord({
      id,
      sequence,
      quality,
      qualityEncoding: "phred33",
      ...(lineNumber !== undefined && { lineNumber }),
      ...(description !== undefined && { description }),
    });
  }

  describe("basic deduplication", () => {
    test("removes duplicate sequences (by sequence content)", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, ""),
        createSequence("seq2", "ATCG", 2, ""),
        createSequence("seq3", "GCTA", 3, ""),
      ];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), { by: "sequence" })) {
        result.push(seq);
      }

      expect(result.length).toBe(2);
      expect(result[0]!.id).toBe("seq1");
      expect(result[1]!.id).toBe("seq3");
    });

    test("removes duplicate IDs (by id)", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, ""),
        createSequence("seq1", "GCTA", 2, ""),
        createSequence("seq2", "TTTT", 3, ""),
      ];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), { by: "id" })) {
        result.push(seq);
      }

      expect(result.length).toBe(2);
      expect(result[0]!.id).toBe("seq1");
      expect(result[0]!.sequence).toEqualSequence("ATCG");
      expect(result[1]!.id).toBe("seq2");
    });

    test("deduplicates by both id and sequence", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, ""),
        createSequence("seq1", "ATCG", 2, ""),
        createSequence("seq1", "GCTA", 3, ""),
        createSequence("seq2", "ATCG", 4, ""),
      ];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), { by: "both" })) {
        result.push(seq);
      }

      expect(result.length).toBe(3);
      expect(result[0]!.id).toBe("seq1");
      expect(result[0]!.sequence).toEqualSequence("ATCG");
      expect(result[1]!.id).toBe("seq1");
      expect(result[1]!.sequence).toEqualSequence("GCTA");
      expect(result[2]!.id).toBe("seq2");
    });
  });

  describe("conflict resolution strategies", () => {
    test("keeps first occurrence (default)", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("first", "ATCG", 1, "first"),
        createSequence("second", "ATCG", 2, "second"),
      ];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        conflictResolution: "first",
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(1);
      expect(result[0]!.id).toBe("first");
      expect(result[0]!.description).toBe("first");
    });

    test("keeps last occurrence", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("first", "ATCG", 1, "first"),
        createSequence("second", "ATCG", 2, "second"),
      ];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        conflictResolution: "last",
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(1);
      expect(result[0]!.id).toBe("second");
      expect(result[0]!.description).toBe("second");
    });

    test("keeps longest sequence", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("short", "ATCG", 1, ""),
        createSequence("long", "ATCGAAAA", 2, ""),
      ];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        by: "id",
        conflictResolution: "longest",
      })) {
        result.push(seq);
      }

      // Only need 1 unique ID, should keep the longer one
      expect(result.length).toBe(2);

      // Now test with same ID
      const sameIdSeqs: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, ""),
        createSequence("seq1", "ATCGAAAA", 2, ""),
      ];

      const result2: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sameIdSeqs), {
        by: "id",
        conflictResolution: "longest",
      })) {
        result2.push(seq);
      }

      expect(result2.length).toBe(1);
      expect(result2[0]!.length).toBe(8);
      expect(result2[0]!.sequence).toEqualSequence("ATCGAAAA");
    });

    test("keeps highest quality for FASTQ sequences", async () => {
      const sequences: FastqSequence[] = [
        createFastq("low", "ATCG", "!!!!", 1, ""), // Phred+33: 0,0,0,0 (avg=0)
        createFastq("high", "ATCG", "IIII", 2, ""), // Phred+33: 40,40,40,40 (avg=40)
      ];

      const processor = new UniqueProcessor<FastqSequence>();
      const result: FastqSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        conflictResolution: "highest-quality",
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(1);
      expect(result[0]!.id).toBe("high");
      expect(result[0]!.quality).toEqualSequence("IIII");
    });
  });

  describe("case sensitivity", () => {
    test("case-sensitive deduplication (default)", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, ""),
        createSequence("seq2", "atcg", 2, ""),
      ];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        caseSensitive: true,
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(2);
    });

    test("case-insensitive deduplication", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, ""),
        createSequence("seq2", "atcg", 2, ""),
      ];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        caseSensitive: false,
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(1);
      expect(result[0]!.sequence).toEqualSequence("ATCG");
    });
  });

  describe("custom key function", () => {
    test("deduplicates by custom key function", async () => {
      const sequences: AbstractSequence[] = [
        {
          id: "sample1_read1",
          sequence: createFastaRecord({ id: "sample1_read1_seq", sequence: "ATCG" }).sequence,
          length: 4,
          lineNumber: 1,
          description: "",
        },
        {
          id: "sample1_read2",
          sequence: createFastaRecord({ id: "sample1_read2_seq", sequence: "GCTA" }).sequence,
          length: 4,
          lineNumber: 2,
          description: "",
        },
        {
          id: "sample2_read1",
          sequence: createFastaRecord({ id: "sample2_read1_seq", sequence: "TTTT" }).sequence,
          length: 4,
          lineNumber: 3,
          description: "",
        },
      ];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        by: (seq) => seq.id.split("_")[0] ?? seq.id, // Group by sample prefix
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(2);
      expect(result[0]!.id).toBe("sample1_read1");
      expect(result[1]!.id).toBe("sample2_read1");
    });
  });

  describe("edge cases", () => {
    test("handles empty input", async () => {
      const sequences: AbstractSequence[] = [];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), {})) {
        result.push(seq);
      }

      expect(result.length).toBe(0);
    });

    test("handles all duplicates", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, ""),
        createSequence("seq2", "ATCG", 2, ""),
        createSequence("seq3", "ATCG", 3, ""),
      ];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), {})) {
        result.push(seq);
      }

      expect(result.length).toBe(1);
    });

    test("handles no duplicates", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, ""),
        createSequence("seq2", "GCTA", 2, ""),
        createSequence("seq3", "TTTT", 3, ""),
      ];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), {})) {
        result.push(seq);
      }

      expect(result.length).toBe(3);
    });
  });

  describe("SeqOps integration", () => {
    test(".unique() method works via SeqOps", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, ""),
        createSequence("seq2", "ATCG", 2, ""),
        createSequence("seq3", "GCTA", 3, ""),
      ];

      const unique = await seqops(makeAsync(sequences)).unique().collect();

      expect(unique.length).toBe(2);
      expect(unique[0]!.id).toBe("seq1");
      expect(unique[1]!.id).toBe("seq3");
    });

    test(".unique() with options works via SeqOps", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, "first"),
        createSequence("seq2", "ATCG", 2, "second"),
      ];

      const unique = await seqops(makeAsync(sequences))
        .unique({ conflictResolution: "last" })
        .collect();

      expect(unique.length).toBe(1);
      expect(unique[0]!.id).toBe("seq2");
      expect(unique[0]!.description).toBe("second");
    });

    test(".unique() can be chained with other operations", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, ""),
        createSequence("seq2", "ATCG", 2, ""),
        createSequence("seq3", "GCTA", 3, ""),
        createSequence("seq4", "AT", 4, ""),
      ];

      const result = await seqops(makeAsync(sequences)).filter({ minLength: 4 }).unique().collect();

      expect(result.length).toBe(2);
      expect(result[0]!.sequence).toEqualSequence("ATCG");
      expect(result[1]!.sequence).toEqualSequence("GCTA");
    });
  });

  describe("cross-batch deduplication", () => {
    // These tests use sequences large enough to span multiple native
    // batch flushes (the batch byte budget is 4MB). This exercises the
    // case where duplicate sequences land in different batches and the
    // deduplication state must persist correctly across flushes.

    const MB = 1024 * 1024;

    function createLongSequence(id: string, base: string, length: number): AbstractSequence {
      const repeated = base.repeat(Math.ceil(length / base.length)).slice(0, length);
      return createFastaRecord({ id, sequence: repeated });
    }

    test("detects duplicates that span different batches (by sequence)", async () => {
      // 3 sequences at ~2MB each = ~6MB total, forcing at least 2 batch flushes.
      // The first and third have identical content.
      const sequences = [
        createLongSequence("first", "ATCG", 2 * MB),
        createLongSequence("middle", "GGCC", 2 * MB),
        createLongSequence("duplicate", "ATCG", 2 * MB),
      ];

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync(sequences), { by: "sequence" })) {
        result.push(seq);
      }

      expect(result.length).toBe(2);
      expect(result[0]!.id).toBe("first");
      expect(result[1]!.id).toBe("middle");
    });

    test("detects duplicates across batches with case-insensitive mode", async () => {
      const upper = createLongSequence("upper", "ATCG", 2 * MB);
      const spacer = createLongSequence("spacer", "GGCC", 2 * MB);
      const lower = createLongSequence("lower", "atcg", 2 * MB);

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync([upper, spacer, lower]), {
        by: "sequence",
        caseSensitive: false,
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(2);
      expect(result[0]!.id).toBe("upper");
      expect(result[1]!.id).toBe("spacer");
    });

    test("composite key (by both) works across batches", async () => {
      // Same ID + same sequence in different batches should be detected.
      // Different ID + same sequence should NOT be detected.
      const seq1 = createLongSequence("shared_id", "ATCG", 2 * MB);
      const spacer = createLongSequence("spacer", "GGCC", 2 * MB);
      const seq1dup = createLongSequence("shared_id", "ATCG", 2 * MB);
      const seq1diffId = createLongSequence("other_id", "ATCG", 2 * MB);

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync([seq1, spacer, seq1dup, seq1diffId]), {
        by: "both",
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(3);
      expect(result[0]!.id).toBe("shared_id");
      expect(result[1]!.id).toBe("spacer");
      expect(result[2]!.id).toBe("other_id");
    });

    test("conflict resolution works across batches", async () => {
      // "last" strategy: the duplicate in the second batch should win.
      const short = createLongSequence("short", "ATCG", 2 * MB);
      const spacer = createLongSequence("spacer", "GGCC", 2 * MB);
      const long = createFastaRecord({
        id: "long",
        sequence: "ATCG".repeat(Math.ceil((2 * MB) / 4)).slice(0, 2 * MB),
      });

      const processor = new UniqueProcessor();
      const result: AbstractSequence[] = [];
      for await (const seq of processor.process(makeAsync([short, spacer, long]), {
        by: "sequence",
        conflictResolution: "last",
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(2);
      // The winner for the ATCG sequence should be "long" (last occurrence)
      const atcgResult = result.find((s) => s.id === "long" || s.id === "short");
      expect(atcgResult!.id).toBe("long");
    });
  });
});
