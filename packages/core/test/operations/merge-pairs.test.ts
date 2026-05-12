import { describe, expect, test } from "vitest";
import { createFastqRecord } from "@genotype/core/constructors";
import { SeqOps } from "@genotype/core/operations";
import type { FastqSequence } from "@genotype/core/types";

function fastq(id: string, sequence: string, quality: string): FastqSequence {
  return createFastqRecord({ id, sequence, quality, qualityEncoding: "phred33" });
}

async function collect(source: AsyncIterable<FastqSequence>): Promise<FastqSequence[]> {
  const out: FastqSequence[] = [];
  for await (const item of source) out.push(item);
  return out;
}

describe("SeqOps.mergePairs", () => {
  test("merges overlapping dual-stream reads using normalized pair IDs", async () => {
    const r1 = fastq(
      "read-1/1",
      "ACGTTGCAGTACGATCGTACGGAATTCGCCGATGACTGACCTAGGTCAGTACGATC",
      "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII"
    );
    const r2 = fastq(
      "read-1/2",
      "GATCGTACTGACCTAGGTCAGTCATCGGCGAATTCCGTACGATCGTACTGCAACGT",
      "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII"
    );

    const result = await collect(SeqOps.from([r1]).mergePairs(SeqOps.from([r2])));

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("read-1");
    expect(result[0]!.sequence.length).toBe(result[0]!.quality.length);
    expect(result[0]!.sequence.length).toBeGreaterThan(0);
  });

  test("keeps original reads for no-overlap pairs by default", async () => {
    const r1 = fastq("read-1/1", "AAAAAAAAAAAA", "IIIIIIIIIIII");
    const r2 = fastq("read-1/2", "CCCCCCCCCCCC", "IIIIIIIIIIII");

    const result = await collect(SeqOps.from([r1]).mergePairs(SeqOps.from([r2])));

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("read-1/1");
    expect(result[1]!.id).toBe("read-1/2");
  });

  test("can skip no-overlap pairs", async () => {
    const r1 = fastq("read-1/1", "AAAAAAAAAAAA", "IIIIIIIIIIII");
    const r2 = fastq("read-1/2", "CCCCCCCCCCCC", "IIIIIIIIIIII");

    const result = await collect(
      SeqOps.from([r1]).mergePairs(SeqOps.from([r2]), { onNoOverlap: "skip" })
    );

    expect(result).toHaveLength(0);
  });

  test("accepts validation and correction pipeline options", async () => {
    const r1 = fastq("read-1/1", "AAAAAAAAAAAA", "IIIIIIIIIIII");
    const r2 = fastq("read-1/2", "CCCCCCCCCCCC", "IIIIIIIIIIII");

    const result = await collect(
      SeqOps.from([r1]).mergePairs(SeqOps.from([r2]), {
        validateOverlap: false,
        validationPreset: "strict",
        correctOverlap: false,
        onNoOverlap: "skip",
      })
    );

    expect(result).toHaveLength(0);
  });

  test("can merge from a serial paired-read stream with nested options", async () => {
    const r1 = fastq("read-1/1", "AAAAAAAAAAAA", "IIIIIIIIIIII");
    const r2 = fastq("read-1/2", "CCCCCCCCCCCC", "IIIIIIIIIIII");

    const result = await collect(
      SeqOps.from([r1, r2]).mergePairs({ merge: { onNoOverlap: "skip" } })
    );

    expect(result).toHaveLength(0);
  });

  test("exposes checked pairs as an intermediate stream", async () => {
    const r1 = fastq("read-1/1", "AAAAAAAAAAAA", "IIIIIIIIIIII");
    const r2 = fastq("read-1/2", "CCCCCCCCCCCC", "IIIIIIIIIIII");

    const pairs = [];
    for await (const pair of SeqOps.from([r1]).pairs(SeqOps.from([r2]))) {
      pairs.push(pair);
    }

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.id).toBe("read-1");
    expect(pairs[0]!.r1.id).toBe("read-1/1");
    expect(pairs[0]!.r2.id).toBe("read-1/2");
  });
});
