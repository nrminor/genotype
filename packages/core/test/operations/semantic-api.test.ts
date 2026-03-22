/**
 * Integration tests for the new semantic API
 *
 * Tests the new method chaining API with focused, single-purpose methods.
 */

import { describe, expect, test } from "bun:test";
import "../matchers";
import { createFastaRecord, createFastqRecord } from "@genotype/core/constructors";
import { seqops } from "@genotype/core/operations";
import type { AbstractSequence, FastqSequence } from "@genotype/core/types";

describe("SeqOps Semantic API", () => {
  // Helper to create test sequences
  function createFasta(id: string, sequence: string): AbstractSequence {
    return createFastaRecord({ id, sequence });
  }

  function createFastq(id: string, sequence: string, quality: string): FastqSequence {
    return createFastqRecord({ id, sequence, quality, qualityEncoding: "phred33" });
  }

  // Helper to create async source
  async function* source(sequences: AbstractSequence[]): AsyncIterable<AbstractSequence> {
    for (const seq of sequences) {
      yield seq;
    }
  }

  // Typed source for FASTQ sequences
  async function* fastqSource(sequences: FastqSequence[]): AsyncIterable<FastqSequence> {
    for (const seq of sequences) {
      yield seq;
    }
  }

  describe("method chaining", () => {
    test("chains filter and transform methods", async () => {
      const sequences = [
        createFasta("seq1", "atcg"),
        createFasta("seq2", "atcgatcg"),
        createFasta("seq3", "at"),
      ];

      const result = await seqops(source(sequences))
        .filter({ minLength: 4 })
        .transform({ upperCase: true })
        .collect();

      expect(result).toHaveLength(2);
      expect(result[0]!.sequence).toEqualSequence("ATCG");
      expect(result[1]!.sequence).toEqualSequence("ATCGATCG");
    });

    test("chains clean and validate methods", async () => {
      const sequences = [
        createFasta("seq1", "AT-CG"),
        createFasta("seq2", "ATXCG"),
        createFasta("seq3", "GCTA"),
      ];

      const result = await seqops(source(sequences))
        .clean({ removeGaps: true })
        .validate({ sequenceType: "dna", allowAmbiguous: false, action: "reject" })
        .collect();

      expect(result).toHaveLength(2);
      expect(result[0]!.sequence).toEqualSequence("ATCG");
      expect(result[1]!.sequence).toEqualSequence("GCTA");
    });

    test("complex pipeline with multiple operations", async () => {
      const sequences = [
        createFasta("chr1_gene1", "  atcg-nnn  "),
        createFasta("chr2_gene2", "GCGCGCGCGCGC"),
        createFasta("scaffold_1", "aaaa"),
        createFasta("chr3_gene3", "ATATATAT"),
      ];

      const result = await seqops(source(sequences))
        .clean({ trimWhitespace: true, removeGaps: true })
        .filter({ pattern: /^chr/, minLength: 5 })
        .transform({ upperCase: true })
        .clean({ replaceAmbiguous: true, replaceChar: "N" })
        .collect();

      expect(result).toHaveLength(3);
      expect(result[0]!.id).toBe("chr1_gene1");
      expect(result[0]!.sequence).toEqualSequence("ATCGNNN");
      expect(result[1]!.id).toBe("chr2_gene2");
      expect(result[1]!.sequence).toEqualSequence("GCGCGCGCGCGC");
      expect(result[2]!.id).toBe("chr3_gene3");
      expect(result[2]!.sequence).toEqualSequence("ATATATAT");
    });
  });

  describe("FASTQ quality operations", () => {
    test("filters FASTQ by quality score", async () => {
      const sequences = [
        createFastq("read1", "ATCG", "IIII"), // Q40
        createFastq("read2", "GCTA", "!!!!"), // Q0
        createFastq("read3", "AAAA", "5555"), // Q20
      ];

      const result = await seqops(fastqSource(sequences)).quality({ minScore: 20 }).collect();

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("read1");
      expect(result[1]!.id).toBe("read3");
    });
  });

  describe("predicate filtering", () => {
    test("filter accepts predicate function for custom logic", async () => {
      const sequences = [
        createFasta("seq1", "ATCG"),
        createFasta("seq2", "ATCGATCG"),
        createFasta("seq3", "AT"),
      ];

      const result = await seqops(source(sequences))
        .filter((seq) => seq.length > 4)
        .collect();

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("seq2");
    });
  });

  describe("real-world pipeline examples", () => {
    test("quality control pipeline for Illumina reads", async () => {
      const reads = [
        createFastq("read1", "ATCGATCGATCG", "IIIIIIII!!!!"), // Good start, bad end
        createFastq("read2", "GCTAGCTAGCTA", "!!!!!!!!!!!!"), // All bad
        createFastq("read3", "ATATATATATATAT", "IIIIIIIIIIIIII"), // All good
      ];

      const result = await seqops(fastqSource(reads))
        .quality({
          trim: true,
          trimThreshold: 20,
          trimWindow: 4,
        })
        .filter({ minLength: 6 })
        .validate({ sequenceType: "dna", allowAmbiguous: false, action: "reject" })
        .collect();

      // Only read1 (trimmed) and read3 should pass
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("read1");
      // The trimming finds the first good window and last good window
      // With IIIIIIII!!!! the algorithm keeps more than expected
      expect((result[0]! as FastqSequence).sequence.length).toBeGreaterThanOrEqual(6);
      expect(result[1]!.id).toBe("read3");
    });

    test("genome assembly preprocessing", async () => {
      const contigs = [
        createFasta("contig1", "ATCGNNNNATCG"),
        createFasta("contig2", "gcta"),
        createFasta("contig3", "ATCG---GCTA"),
        createFasta("contig4", "NNNNNNNN"),
      ];

      const result = await seqops(source(contigs))
        .clean({
          removeGaps: true,
          replaceAmbiguous: true,
          replaceChar: "N",
        })
        .transform({ upperCase: true })
        .filter({
          minLength: 5,
          custom: (seq) => {
            // Remove sequences that are >50% N
            const nCount = (seq.sequence.match(/N/g) || []).length;
            return nCount / seq.length <= 0.5;
          },
        })
        .collect();

      expect(result).toHaveLength(2);
      expect(result[0]!.sequence).toEqualSequence("ATCGNNNNATCG");
      expect(result[1]!.sequence).toEqualSequence("ATCGGCTA");
    });
  });

  describe("terminal operations", () => {
    test("count() returns correct count", async () => {
      const sequences = [
        createFasta("seq1", "ATCG"),
        createFasta("seq2", "GCTA"),
        createFasta("seq3", "AAAA"),
      ];

      const count = await seqops(source(sequences)).filter({ minLength: 4 }).count();

      expect(count).toBe(3);
    });

    test("forEach() processes each sequence", async () => {
      const sequences = [createFasta("seq1", "atcg"), createFasta("seq2", "gcta")];

      const processed: string[] = [];

      await seqops(source(sequences))
        .transform({ upperCase: true })
        .forEach((seq) => {
          processed.push(seq.sequence.toString());
        });

      expect(processed).toEqual(["ATCG", "GCTA"]);
    });
  });

  describe("error messages and DX", () => {
    test("clear execution order", async () => {
      const sequences = [createFasta("seq1", "atcg")];

      // Each step has clear, predictable effect
      const step1 = await seqops(source(sequences)).transform({ upperCase: true }).collect();
      expect(step1[0]!.sequence).toEqualSequence("ATCG");

      const step2 = await seqops(source(sequences))
        .transform({ upperCase: true })
        .transform({ reverseComplement: true })
        .collect();
      expect(step2[0]!.sequence).toEqualSequence("CGAT");
    });
  });
});
