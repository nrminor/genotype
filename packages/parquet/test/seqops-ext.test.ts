/**
 * Tests for SeqOps parquet extension methods.
 *
 * Verifies that importing @genotype/parquet augments SeqOps with
 * fromParquet() and writeParquet(), enabling full round-trip:
 *
 *   sequences → seqops().writeParquet() → SeqOps.fromParquet() → sequences
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import "../../core/test/matchers";
import { createFastaRecord, createFastqRecord } from "@genotype/core/constructors";
import { SeqOps, seqops } from "@genotype/core/operations";
import type { FastaSequence, FastqSequence } from "@genotype/core/types";
import "@genotype/tabular";
import "@genotype/parquet";

const tempDir = "/tmp/genotype-parquet-seqops-test";

beforeEach(() => {
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function* toAsync<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

describe("SeqOps parquet extension methods", () => {
  describe("writeParquet()", () => {
    test("writes sequences to parquet via SeqOps chain", async () => {
      const sequences = [
        createFastaRecord({ id: "seq1", sequence: "ATCGATCG" }),
        createFastaRecord({ id: "seq2", sequence: "GCTAGCTA" }),
      ];

      const path = `${tempDir}/seqops-write.parquet`;
      await seqops(toAsync(sequences)).writeParquet(path);

      expect(existsSync(path)).toBe(true);
    });

    test("chains after filter", async () => {
      const sequences = [
        createFastaRecord({ id: "short", sequence: "AT" }),
        createFastaRecord({ id: "long", sequence: "ATCGATCGATCG" }),
      ];

      const path = `${tempDir}/filtered.parquet`;
      await seqops(toAsync(sequences))
        .filter({ minLength: 5 })
        .writeParquet(path);

      const recovered = [];
      for await (const seq of SeqOps.fromParquet(path)) {
        recovered.push(seq);
      }

      expect(recovered).toHaveLength(1);
      expect(recovered[0]!.id).toBe("long");
    });
  });

  describe("fromParquet()", () => {
    test("reads FASTA sequences from parquet", async () => {
      const sequences = [
        createFastaRecord({ id: "seq1", sequence: "ATCGATCG" }),
        createFastaRecord({ id: "seq2", sequence: "GCTAGCTA" }),
        createFastaRecord({ id: "seq3", sequence: "TTTTAAAA" }),
      ];

      const path = `${tempDir}/fasta.parquet`;
      await seqops(toAsync(sequences)).writeParquet(path);

      const recovered = await SeqOps.fromParquet(path).collect();

      expect(recovered).toHaveLength(3);
      expect((recovered[0] as FastaSequence).format).toBe("fasta");
      expect(recovered[0]!.id).toBe("seq1");
      expect(recovered[0]!.sequence).toEqualSequence("ATCGATCG");
    });

    test("reads FASTQ sequences when quality column present", async () => {
      const sequences = [
        createFastqRecord({ id: "read1", sequence: "ATCG", quality: "IIII", qualityEncoding: "phred33" }),
        createFastqRecord({ id: "read2", sequence: "GCTA", quality: "HHHH", qualityEncoding: "phred33" }),
      ];

      const path = `${tempDir}/fastq.parquet`;
      await seqops(toAsync(sequences))
        .toTabular({
          columns: ["id", "sequence", "quality"] as const,
          header: false,
        })
        .writeParquet(path);

      const recovered = await SeqOps.fromParquet(path).collect();

      expect(recovered).toHaveLength(2);
      expect((recovered[0] as FastqSequence).format).toBe("fastq");
      expect((recovered[0] as FastqSequence).quality).toEqualSequence("IIII");
    });

    test("chains into SeqOps operations", async () => {
      const sequences = [
        createFastaRecord({ id: "seq1", sequence: "ATCG" }),
        createFastaRecord({ id: "seq2", sequence: "ATCGATCGATCG" }),
        createFastaRecord({ id: "seq3", sequence: "GC" }),
      ];

      const path = `${tempDir}/chain.parquet`;
      await seqops(toAsync(sequences)).writeParquet(path);

      const filtered = await SeqOps.fromParquet(path)
        .filter({ minLength: 4 })
        .collect();

      expect(filtered).toHaveLength(2);
      expect(filtered[0]!.id).toBe("seq1");
      expect(filtered[1]!.id).toBe("seq2");
    });

    test("supports column projection for efficiency", async () => {
      const sequences = [
        createFastaRecord({ id: "seq1", sequence: "ATCGATCG" }),
      ];

      const path = `${tempDir}/projection.parquet`;
      await seqops(toAsync(sequences)).writeParquet(path);

      const recovered = await SeqOps.fromParquet(path, {
        columns: ["id", "sequence"],
      }).collect();

      expect(recovered).toHaveLength(1);
      expect(recovered[0]!.id).toBe("seq1");
      expect(recovered[0]!.sequence).toEqualSequence("ATCGATCG");
    });
  });

  describe("full round-trip", () => {
    test("sequences → writeParquet → fromParquet → identical sequences", async () => {
      const original = [
        createFastaRecord({ id: "alpha", sequence: "ATCGATCGATCG" }),
        createFastaRecord({ id: "beta", sequence: "GCTAGCTAGCTA" }),
        createFastaRecord({ id: "gamma", sequence: "TTTTAAAACCCC" }),
      ];

      const path = `${tempDir}/roundtrip.parquet`;
      await seqops(toAsync(original)).writeParquet(path);
      const recovered = await SeqOps.fromParquet(path).collect();

      expect(recovered).toHaveLength(3);
      for (let i = 0; i < original.length; i++) {
        expect(recovered[i]!.id).toBe(original[i]!.id);
        expect(recovered[i]!.sequence).toEqualSequence(
          original[i]!.sequence.toString()
        );
      }
    });
  });
});
