/**
 * Tests for SeqOps conversion methods with compile-time validation
 */

import { describe, expect, test } from "bun:test";
import "../matchers";
import { createFastaRecord, createFastqRecord } from "@genotype/core/constructors";
import { seqops } from "@genotype/core/operations";
import type { FastaSequence, FastqSequence } from "@genotype/core/types";

// Helper to create test FASTA sequences
async function* createFastaSource(): AsyncIterable<FastaSequence> {
  yield createFastaRecord({ id: "test", sequence: "ATCG" });
}

// Helper to create test FASTQ sequences
async function* createFastqSource(): AsyncIterable<FastqSequence> {
  yield createFastqRecord({
    id: "test",
    sequence: "ATCG",
    quality: "IIII",
    qualityEncoding: "phred33",
  });
}

describe("SeqOps Conversion Methods", () => {
  describe("toFastqSequence", () => {
    test("accepts valid quality characters", async () => {
      const result = await seqops(createFastaSource()).toFastqSequence({ quality: "I" }).collect();

      expect(result).toHaveLength(1);
      const fastq = result[0] as FastqSequence;
      expect(fastq.quality).toEqualSequence("IIII");
    });

    test("accepts valid quality scores", async () => {
      const result = await seqops(createFastaSource())
        .toFastqSequence({ qualityScore: 40 })
        .collect();

      expect(result).toHaveLength(1);
      // Score 40 is 'I' in Phred+33
      const fastq = result[0] as FastqSequence;
      expect(fastq.quality).toEqualSequence("IIII");
    });

    test("works with no options", async () => {
      const result = await seqops(createFastaSource()).toFastqSequence().collect();

      expect(result).toHaveLength(1);
      const fastq = result[0] as FastqSequence;
      expect(fastq.quality).toEqualSequence("IIII"); // Default quality
    });

    test("works with Solexa encoding", async () => {
      const result = await seqops(createFastaSource())
        .toFastqSequence({ qualityScore: 30, encoding: "solexa" })
        .collect();

      expect(result).toHaveLength(1);
      const fastq = result[0] as FastqSequence;
      expect(fastq.qualityEncoding).toBe("solexa");
    });
  });

  describe("Direct function calls", () => {
    test("fa2fq function still works with compile-time validation", async () => {
      // Direct use of the fa2fq function (not through SeqOps)
      const { fa2fq } = await import("../../src/operations/convert");
      const sequences: FastqSequence[] = [];
      for await (const seq of fa2fq(createFastaSource(), { quality: "I" })) {
        sequences.push(seq);
      }

      expect(sequences).toHaveLength(1);
      expect(sequences[0]!.quality).toEqualSequence("IIII");
    });
  });

  describe("toFastaSequence", () => {
    test("converts FASTQ to FASTA", async () => {
      const result = await seqops(createFastqSource()).toFastaSequence().collect();

      expect(result).toHaveLength(1);
      const fasta = result[0] as FastaSequence;
      expect(fasta.format).toBe("fasta");
      expect(fasta.sequence).toEqualSequence("ATCG");
      expect("quality" in fasta).toBe(false);
    });
  });
});

/**
 * Compile-time validation examples
 * These would cause compile errors if uncommented:
 */

// Invalid quality character - would show error: "Invalid quality character '€' for encoding 'phred33'"
// const invalid1 = seqops(createFastaSource()).toFastqSequence({ quality: '€' });

// Invalid quality score - would show error: "Invalid quality score 94 for encoding 'phred33'"
// const invalid2 = seqops(createFastaSource()).toFastqSequence({ qualityScore: 94 });

// Invalid Solexa score - would show error: "Invalid quality score -6 for encoding 'solexa'"
// const invalid3 = seqops(createFastaSource()).toFastqSequence({ qualityScore: -6, encoding: 'solexa' as const });
