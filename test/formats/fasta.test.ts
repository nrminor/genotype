/**
 * Tests for FASTA format parsing
 */

import { describe, expect, test } from "bun:test";
import "../matchers";
import { FastaParser, type FastaSequence } from "@genotype/core/index";

describe("FastaParser", () => {
  const parser = new FastaParser();

  test("should parse simple FASTA sequence", async () => {
    const fasta = ">seq1\nATCG";
    const sequences: FastaSequence[] = [];

    for await (const seq of parser.parseString(fasta)) {
      sequences.push(seq);
    }

    expect(sequences).toHaveLength(1);
    expect(sequences[0]!.id).toBe("seq1");
    expect(sequences[0]!.sequence).toEqualSequence("ATCG");
  });

  test("should parse FASTA with description", async () => {
    const fasta = ">seq1 Sample sequence description\nATCGATCG";
    const sequences: FastaSequence[] = [];

    for await (const seq of parser.parseString(fasta)) {
      sequences.push(seq);
    }

    expect(sequences[0]!.id).toBe("seq1");
    expect(sequences[0]!.description).toBe("Sample sequence description");
    expect(sequences[0]!.sequence).toEqualSequence("ATCGATCG");
  });

  test("should parse multiline sequences", async () => {
    const fasta = ">seq1\nATCG\nATCG\nATCG";
    const sequences: FastaSequence[] = [];

    for await (const seq of parser.parseString(fasta)) {
      sequences.push(seq);
    }

    expect(sequences[0]!.sequence).toEqualSequence("ATCGATCGATCG");
  });

  test("should parse multiple sequences", async () => {
    const fasta = ">seq1\nATCG\n>seq2\nGGGG\n>seq3\nTTTT";
    const sequences: FastaSequence[] = [];

    for await (const seq of parser.parseString(fasta)) {
      sequences.push(seq);
    }

    expect(sequences).toHaveLength(3);
    expect(sequences[0]!.id).toBe("seq1");
    expect(sequences[1]!.id).toBe("seq2");
    expect(sequences[2]!.id).toBe("seq3");
  });

  test("should handle IUPAC ambiguity codes", async () => {
    const fasta = ">seq1\nATCGRYSWKMBDHVN";
    const sequences: FastaSequence[] = [];

    for await (const seq of parser.parseString(fasta)) {
      sequences.push(seq);
    }

    expect(sequences[0]!.sequence).toEqualSequence("ATCGRYSWKMBDHVN");
  });

  test("should handle case-insensitive sequences", async () => {
    const fasta = ">seq1\natcgATCG";
    const sequences: FastaSequence[] = [];

    for await (const seq of parser.parseString(fasta)) {
      sequences.push(seq);
    }

    expect(sequences[0]!.sequence).toEqualSequence("atcgATCG");
  });
});
