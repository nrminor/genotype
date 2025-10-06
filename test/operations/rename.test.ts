import { describe, expect, test } from "bun:test";
import { ValidationError } from "../../src/errors";
import { seqops } from "../../src/operations";
import { rename } from "../../src/operations/rename";
import type { FastaSequence, FastqSequence } from "../../src/types";

async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

describe("rename operation", () => {
  test("appends suffix to duplicate IDs", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", sequence: "GCTA", length: 4 },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input)));

    expect(result[0].id).toBe("seq1");
    expect(result[1].id).toBe("seq1_2");
  });

  test("handles no duplicates", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq2", sequence: "GCTA", length: 4 },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input)));

    expect(result[0].id).toBe("seq1");
    expect(result[1].id).toBe("seq2");
  });

  test("handles empty input", async () => {
    const input: FastaSequence[] = [];

    const result = await Array.fromAsync(rename(toAsyncIterable(input)));

    expect(result).toHaveLength(0);
  });

  test("byName: false - same ID, different descriptions treated as duplicates", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", description: "comment1", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", description: "comment2", sequence: "GCTA", length: 4 },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input), { byName: false }));

    expect(result[0].id).toBe("seq1");
    expect(result[1].id).toBe("seq1_2");
  });

  test("byName: true - same ID, different descriptions NOT treated as duplicates", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", description: "comment1", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", description: "comment2", sequence: "GCTA", length: 4 },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input), { byName: true }));

    expect(result[0].id).toBe("seq1");
    expect(result[1].id).toBe("seq1");
  });

  test("byName: true - same full name treated as duplicates", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", description: "comment", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", description: "comment", sequence: "GCTA", length: 4 },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input), { byName: true }));

    expect(result[0].id).toBe("seq1");
    expect(result[1].id).toBe("seq1_2");
  });

  test("custom separator: dot", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", sequence: "GCTA", length: 4 },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input), { separator: "." }));

    expect(result[0].id).toBe("seq1");
    expect(result[1].id).toBe("seq1.2");
  });

  test("custom separator: hyphen", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", sequence: "GCTA", length: 4 },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input), { separator: "-" }));

    expect(result[0].id).toBe("seq1");
    expect(result[1].id).toBe("seq1-2");
  });

  test("custom startNum: 0", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", sequence: "GCTA", length: 4 },
      { format: "fasta", id: "seq1", sequence: "TGAC", length: 4 },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input), { startNum: 0 }));

    expect(result[0].id).toBe("seq1");
    expect(result[1].id).toBe("seq1_0");
    expect(result[2].id).toBe("seq1_1");
  });

  test("custom startNum: 100", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", sequence: "GCTA", length: 4 },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input), { startNum: 100 }));

    expect(result[0].id).toBe("seq1");
    expect(result[1].id).toBe("seq1_100");
  });

  test("renameFirst: true with default startNum", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", sequence: "GCTA", length: 4 },
      { format: "fasta", id: "seq1", sequence: "TGAC", length: 4 },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input), { renameFirst: true }));

    expect(result[0].id).toBe("seq1_2");
    expect(result[1].id).toBe("seq1_3");
    expect(result[2].id).toBe("seq1_4");
  });

  test("renameFirst: true with startNum: 1", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", sequence: "GCTA", length: 4 },
      { format: "fasta", id: "seq1", sequence: "TGAC", length: 4 },
    ];

    const result = await Array.fromAsync(
      rename(toAsyncIterable(input), { renameFirst: true, startNum: 1 })
    );

    expect(result[0].id).toBe("seq1_1");
    expect(result[1].id).toBe("seq1_2");
    expect(result[2].id).toBe("seq1_3");
  });

  test("multiple duplicates (4 sequences with same ID)", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", sequence: "GCTA", length: 4 },
      { format: "fasta", id: "seq1", sequence: "TGAC", length: 4 },
      { format: "fasta", id: "seq1", sequence: "CGAT", length: 4 },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input)));

    expect(result[0].id).toBe("seq1");
    expect(result[1].id).toBe("seq1_2");
    expect(result[2].id).toBe("seq1_3");
    expect(result[3].id).toBe("seq1_4");
  });

  test("validation: rejects empty separator", async () => {
    const input: FastaSequence[] = [{ format: "fasta", id: "seq1", sequence: "ATCG", length: 4 }];

    await expect(async () => {
      await Array.fromAsync(rename(toAsyncIterable(input), { separator: "" }));
    }).toThrow(ValidationError);
  });

  test("validation: empty separator error message is helpful", async () => {
    const input: FastaSequence[] = [{ format: "fasta", id: "seq1", sequence: "ATCG", length: 4 }];

    try {
      await Array.fromAsync(rename(toAsyncIterable(input), { separator: "" }));
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as Error).message).toContain("separator");
      expect((error as Error).message).toContain("non-empty");
    }
  });

  test("validation: rejects negative startNum", async () => {
    const input: FastaSequence[] = [{ format: "fasta", id: "seq1", sequence: "ATCG", length: 4 }];

    await expect(async () => {
      await Array.fromAsync(rename(toAsyncIterable(input), { startNum: -1 }));
    }).toThrow(ValidationError);
  });

  test("validation: negative startNum error message is helpful", async () => {
    const input: FastaSequence[] = [{ format: "fasta", id: "seq1", sequence: "ATCG", length: 4 }];

    try {
      await Array.fromAsync(rename(toAsyncIterable(input), { startNum: -1 }));
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as Error).message).toContain("startNum");
      expect((error as Error).message).toContain("-1");
    }
  });

  test("integration: SeqOps chaining with rename", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", sequence: "GCTA", length: 4 },
      { format: "fasta", id: "seq2", sequence: "A", length: 1 },
    ];

    const result = await seqops(toAsyncIterable(input))
      .filter({ minLength: 2 })
      .rename({ separator: "-" })
      .collect();

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("seq1");
    expect(result[1].id).toBe("seq1-2");
  });

  test("integration: works with FASTQ sequences", async () => {
    const input: FastqSequence[] = [
      {
        format: "fastq",
        id: "seq1",
        sequence: "ATCG",
        quality: "IIII",
        qualityEncoding: "phred33",
        length: 4,
      },
      {
        format: "fastq",
        id: "seq1",
        sequence: "GCTA",
        quality: "JJJJ",
        qualityEncoding: "phred33",
        length: 4,
      },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input)));

    expect(result[0].id).toBe("seq1");
    expect(result[0].quality).toBe("IIII");
    expect(result[1].id).toBe("seq1_2");
    expect(result[1].quality).toBe("JJJJ");
  });

  test("integration: preserves descriptions", async () => {
    const input: FastaSequence[] = [
      { format: "fasta", id: "seq1", description: "original comment", sequence: "ATCG", length: 4 },
      { format: "fasta", id: "seq1", description: "another comment", sequence: "GCTA", length: 4 },
    ];

    const result = await Array.fromAsync(rename(toAsyncIterable(input)));

    expect(result[0].description).toBe("original comment");
    expect(result[1].description).toBe("another comment");
  });

  test("integration: memory efficient with large unique ID count", async () => {
    // Note: This test doesn't assert memory usage, just verifies correctness
    // with a large number of unique IDs (memory usage should be O(U) where U = unique IDs)
    const input: FastaSequence[] = [];
    for (let i = 0; i < 1000; i++) {
      input.push({ format: "fasta", id: `seq${i}`, sequence: "ATCG", length: 4 });
    }

    const result = await Array.fromAsync(rename(toAsyncIterable(input)));

    expect(result).toHaveLength(1000);
    expect(result[0].id).toBe("seq0");
    expect(result[999].id).toBe("seq999");
  });
});
