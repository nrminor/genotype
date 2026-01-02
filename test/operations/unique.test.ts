import { describe, expect, test } from "bun:test";
import { seqops } from "../../src/operations";
import { UniqueProcessor } from "../../src/operations/unique";
import type { AbstractSequence, FastqSequence } from "../../src/types";

describe("UniqueProcessor", () => {
  async function* makeAsync<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item;
    }
  }

  describe("basic deduplication", () => {
    test("removes duplicate sequences (by sequence content)", async () => {
      const sequences: AbstractSequence[] = [
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        { id: "seq2", sequence: "ATCG", length: 4, lineNumber: 2, description: "" },
        { id: "seq3", sequence: "GCTA", length: 4, lineNumber: 3, description: "" },
      ];

      const processor = new UniqueProcessor();
      const result = [];
      for await (const seq of processor.process(makeAsync(sequences), { by: "sequence" })) {
        result.push(seq);
      }

      expect(result.length).toBe(2);
      expect(result[0].id).toBe("seq1");
      expect(result[1].id).toBe("seq3");
    });

    test("removes duplicate IDs (by id)", async () => {
      const sequences: AbstractSequence[] = [
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        { id: "seq1", sequence: "GCTA", length: 4, lineNumber: 2, description: "" },
        { id: "seq2", sequence: "TTTT", length: 4, lineNumber: 3, description: "" },
      ];

      const processor = new UniqueProcessor();
      const result = [];
      for await (const seq of processor.process(makeAsync(sequences), { by: "id" })) {
        result.push(seq);
      }

      expect(result.length).toBe(2);
      expect(result[0].id).toBe("seq1");
      expect(result[0].sequence).toBe("ATCG");
      expect(result[1].id).toBe("seq2");
    });

    test("deduplicates by both id and sequence", async () => {
      const sequences: AbstractSequence[] = [
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 2, description: "" },
        { id: "seq1", sequence: "GCTA", length: 4, lineNumber: 3, description: "" },
        { id: "seq2", sequence: "ATCG", length: 4, lineNumber: 4, description: "" },
      ];

      const processor = new UniqueProcessor();
      const result = [];
      for await (const seq of processor.process(makeAsync(sequences), { by: "both" })) {
        result.push(seq);
      }

      expect(result.length).toBe(3);
      expect(result[0].id).toBe("seq1");
      expect(result[0].sequence).toBe("ATCG");
      expect(result[1].id).toBe("seq1");
      expect(result[1].sequence).toBe("GCTA");
      expect(result[2].id).toBe("seq2");
    });
  });

  describe("conflict resolution strategies", () => {
    test("keeps first occurrence (default)", async () => {
      const sequences: AbstractSequence[] = [
        { id: "first", sequence: "ATCG", length: 4, lineNumber: 1, description: "first" },
        { id: "second", sequence: "ATCG", length: 4, lineNumber: 2, description: "second" },
      ];

      const processor = new UniqueProcessor();
      const result = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        conflictResolution: "first",
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(1);
      expect(result[0].id).toBe("first");
      expect(result[0].description).toBe("first");
    });

    test("keeps last occurrence", async () => {
      const sequences: AbstractSequence[] = [
        { id: "first", sequence: "ATCG", length: 4, lineNumber: 1, description: "first" },
        { id: "second", sequence: "ATCG", length: 4, lineNumber: 2, description: "second" },
      ];

      const processor = new UniqueProcessor();
      const result = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        conflictResolution: "last",
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(1);
      expect(result[0].id).toBe("second");
      expect(result[0].description).toBe("second");
    });

    test("keeps longest sequence", async () => {
      const sequences: AbstractSequence[] = [
        { id: "short", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        { id: "long", sequence: "ATCGAAAA", length: 8, lineNumber: 2, description: "" },
      ];

      const processor = new UniqueProcessor();
      const result = [];
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
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        { id: "seq1", sequence: "ATCGAAAA", length: 8, lineNumber: 2, description: "" },
      ];

      const result2 = [];
      for await (const seq of processor.process(makeAsync(sameIdSeqs), {
        by: "id",
        conflictResolution: "longest",
      })) {
        result2.push(seq);
      }

      expect(result2.length).toBe(1);
      expect(result2[0].length).toBe(8);
      expect(result2[0].sequence).toBe("ATCGAAAA");
    });

    test("keeps highest quality for FASTQ sequences", async () => {
      const sequences: FastqSequence[] = [
        {
          id: "low",
          sequence: "ATCG",
          quality: "!!!!", // Phred+33: 0,0,0,0 (avg=0)
          length: 4,
          lineNumber: 1,
          description: "",
          format: "fastq",
        },
        {
          id: "high",
          sequence: "ATCG",
          quality: "IIII", // Phred+33: 40,40,40,40 (avg=40)
          length: 4,
          lineNumber: 2,
          description: "",
          format: "fastq",
        },
      ];

      const processor = new UniqueProcessor<FastqSequence>();
      const result = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        conflictResolution: "highest-quality",
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(1);
      expect(result[0].id).toBe("high");
      expect(result[0].quality).toBe("IIII");
    });
  });

  describe("case sensitivity", () => {
    test("case-sensitive deduplication (default)", async () => {
      const sequences: AbstractSequence[] = [
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        { id: "seq2", sequence: "atcg", length: 4, lineNumber: 2, description: "" },
      ];

      const processor = new UniqueProcessor();
      const result = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        caseSensitive: true,
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(2);
    });

    test("case-insensitive deduplication", async () => {
      const sequences: AbstractSequence[] = [
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        { id: "seq2", sequence: "atcg", length: 4, lineNumber: 2, description: "" },
      ];

      const processor = new UniqueProcessor();
      const result = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        caseSensitive: false,
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(1);
      expect(result[0].sequence).toBe("ATCG");
    });
  });

  describe("custom key function", () => {
    test("deduplicates by custom key function", async () => {
      const sequences: AbstractSequence[] = [
        {
          id: "sample1_read1",
          sequence: "ATCG",
          length: 4,
          lineNumber: 1,
          description: "",
        },
        {
          id: "sample1_read2",
          sequence: "GCTA",
          length: 4,
          lineNumber: 2,
          description: "",
        },
        {
          id: "sample2_read1",
          sequence: "TTTT",
          length: 4,
          lineNumber: 3,
          description: "",
        },
      ];

      const processor = new UniqueProcessor();
      const result = [];
      for await (const seq of processor.process(makeAsync(sequences), {
        by: (seq) => seq.id.split("_")[0], // Group by sample prefix
      })) {
        result.push(seq);
      }

      expect(result.length).toBe(2);
      expect(result[0].id).toBe("sample1_read1");
      expect(result[1].id).toBe("sample2_read1");
    });
  });

  describe("edge cases", () => {
    test("handles empty input", async () => {
      const sequences: AbstractSequence[] = [];

      const processor = new UniqueProcessor();
      const result = [];
      for await (const seq of processor.process(makeAsync(sequences), {})) {
        result.push(seq);
      }

      expect(result.length).toBe(0);
    });

    test("handles all duplicates", async () => {
      const sequences: AbstractSequence[] = [
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        { id: "seq2", sequence: "ATCG", length: 4, lineNumber: 2, description: "" },
        { id: "seq3", sequence: "ATCG", length: 4, lineNumber: 3, description: "" },
      ];

      const processor = new UniqueProcessor();
      const result = [];
      for await (const seq of processor.process(makeAsync(sequences), {})) {
        result.push(seq);
      }

      expect(result.length).toBe(1);
    });

    test("handles no duplicates", async () => {
      const sequences: AbstractSequence[] = [
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        { id: "seq2", sequence: "GCTA", length: 4, lineNumber: 2, description: "" },
        { id: "seq3", sequence: "TTTT", length: 4, lineNumber: 3, description: "" },
      ];

      const processor = new UniqueProcessor();
      const result = [];
      for await (const seq of processor.process(makeAsync(sequences), {})) {
        result.push(seq);
      }

      expect(result.length).toBe(3);
    });
  });

  describe("SeqOps integration", () => {
    test(".unique() method works via SeqOps", async () => {
      const sequences: AbstractSequence[] = [
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        { id: "seq2", sequence: "ATCG", length: 4, lineNumber: 2, description: "" },
        { id: "seq3", sequence: "GCTA", length: 4, lineNumber: 3, description: "" },
      ];

      const unique = await seqops(makeAsync(sequences)).unique().collect();

      expect(unique.length).toBe(2);
      expect(unique[0].id).toBe("seq1");
      expect(unique[1].id).toBe("seq3");
    });

    test(".unique() with options works via SeqOps", async () => {
      const sequences: AbstractSequence[] = [
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "first" },
        { id: "seq2", sequence: "ATCG", length: 4, lineNumber: 2, description: "second" },
      ];

      const unique = await seqops(makeAsync(sequences))
        .unique({ conflictResolution: "last" })
        .collect();

      expect(unique.length).toBe(1);
      expect(unique[0].id).toBe("seq2");
      expect(unique[0].description).toBe("second");
    });

    test(".unique() can be chained with other operations", async () => {
      const sequences: AbstractSequence[] = [
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        { id: "seq2", sequence: "ATCG", length: 4, lineNumber: 2, description: "" },
        { id: "seq3", sequence: "GCTA", length: 4, lineNumber: 3, description: "" },
        { id: "seq4", sequence: "AT", length: 2, lineNumber: 4, description: "" },
      ];

      const result = await seqops(makeAsync(sequences)).filter({ minLength: 4 }).unique().collect();

      expect(result.length).toBe(2);
      expect(result[0].sequence).toBe("ATCG");
      expect(result[1].sequence).toBe("GCTA");
    });
  });
});
