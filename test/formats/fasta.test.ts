/**
 * Tests for FASTA format parsing and writing
 */

import { describe, expect, test } from "bun:test";
import "../matchers";
import {
  FastaParser,
  type FastaSequence,
  FastaUtils,
  FastaWriter,
  ParseError,
} from "../../src/index";
import { createFastaRecord } from "../../src/constructors";

describe("FastaParser", () => {
  const parser = new FastaParser();

  test("should parse simple FASTA sequence", async () => {
    const fasta = ">seq1\nATCG";
    const sequences: FastaSequence[] = [];

    for await (const seq of parser.parseString(fasta)) {
      sequences.push(seq);
    }

    expect(sequences).toHaveLength(1);
    expect(sequences[0]!.format).toBe("fasta");
    expect(sequences[0]!.id).toBe("seq1");
    expect(sequences[0]!.sequence).toEqualSequence("ATCG");
    expect(sequences[0]!.length).toBe(4);
    expect(sequences[0]!.lineNumber).toBe(1);
    expect(sequences[0]!.description).toBeUndefined();
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
    expect(sequences[0]!.length).toBe(12);
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

  test("should skip comments and empty lines", async () => {
    const fasta = ";This is a comment\n\n>seq1\nATCG\n\n;Another comment\n>seq2\nGGGG";
    const sequences: FastaSequence[] = [];

    for await (const seq of parser.parseString(fasta)) {
      sequences.push(seq);
    }

    expect(sequences).toHaveLength(2);
  });

  test("should throw ParseError for empty FASTA header by default", async () => {
    const fasta = ">\nATCG"; // Empty header after '>'

    await expect(async () => {
      for await (const _seq of parser.parseString(fasta)) {
        // Should throw before yielding any sequences
      }
    }).toThrow(ParseError);

    await expect(async () => {
      for await (const _seq of parser.parseString(fasta)) {
        // Should throw before yielding any sequences
      }
    }).toThrow(/Empty FASTA header.*identifier/);
  });

  test("should handle empty sequence ID with warning when validation skipped", async () => {
    const warnings: string[] = [];
    const parserWithoutValidation = new FastaParser({
      skipValidation: true,
      onWarning: (warning) => warnings.push(warning),
    });

    const fasta = ">\nATCG";
    const sequences: FastaSequence[] = [];

    for await (const seq of parserWithoutValidation.parseString(fasta)) {
      sequences.push(seq);
    }

    expect(warnings).toContain("Empty FASTA header");
    expect(sequences[0]!.id).toBe("");
  });

  test("should throw error for sequence without header", async () => {
    const fasta = "ATCG";

    await expect(async () => {
      for await (const _seq of parser.parseString(fasta)) {
        // Should not reach here
      }
    }).toThrow("Sequence data found before header");
  });

  test("should throw error for empty sequence", async () => {
    const fasta = ">seq1\n>seq2\nATCG";

    await expect(async () => {
      for await (const _seq of parser.parseString(fasta)) {
        // Should not reach here
      }
    }).toThrow("Empty sequence found");
  });

  test("should validate sequence characters", async () => {
    const fasta = ">seq1\nATCGXYZ123";

    await expect(async () => {
      for await (const _seq of parser.parseString(fasta)) {
        // Should not reach here
      }
    }).toThrow("Invalid sequence characters");
  });

  test("should skip validation when requested", async () => {
    const skipValidationParser = new FastaParser({ skipValidation: true });
    const fasta = ">seq1\nATCGXYZ123";
    const sequences: FastaSequence[] = [];

    for await (const seq of skipValidationParser.parseString(fasta)) {
      sequences.push(seq);
    }

    expect(sequences[0]!.sequence).toEqualSequence("ATCGXYZ123");
  });

  test("should handle case-insensitive sequences", async () => {
    const fasta = ">seq1\natcgATCG";
    const sequences: FastaSequence[] = [];

    for await (const seq of parser.parseString(fasta)) {
      sequences.push(seq);
    }

    expect(sequences[0]!.sequence).toEqualSequence("atcgATCG");
  });

  test("should remove whitespace from sequences", async () => {
    const fasta = ">seq1\nAT CG\n  AT   CG  ";
    const sequences: FastaSequence[] = [];

    for await (const seq of parser.parseString(fasta)) {
      sequences.push(seq);
    }

    expect(sequences[0]!.sequence).toEqualSequence("ATCGATCG");
  });
});

describe("FastaWriter", () => {
  const writer = new FastaWriter();

  test("should format simple sequence", () => {
    const sequence: FastaSequence = createFastaRecord({ id: "seq1", sequence: "ATCGATCGATCG" });

    const formatted = writer.formatSequence(sequence);
    expect(formatted).toBe(">seq1\nATCGATCGATCG");
  });

  test("should format sequence with description", () => {
    const sequence: FastaSequence = createFastaRecord({
      id: "seq1",
      description: "Sample sequence",
      sequence: "ATCGATCGATCG",
    });

    const formatted = writer.formatSequence(sequence);
    expect(formatted).toBe(">seq1 Sample sequence\nATCGATCGATCG");
  });

  test("should wrap long sequences", () => {
    const wrappingWriter = new FastaWriter({ lineWidth: 8 });
    const sequence: FastaSequence = createFastaRecord({ id: "seq1", sequence: "ATCGATCGATCGATCG" });

    const formatted = wrappingWriter.formatSequence(sequence);
    expect(formatted).toBe(">seq1\nATCGATCG\nATCGATCG");
  });

  test("should format multiple sequences", () => {
    const sequences: FastaSequence[] = [
      createFastaRecord({ id: "seq1", sequence: "ATCG" }),
      createFastaRecord({ id: "seq2", sequence: "GGGG" }),
    ];

    const formatted = writer.formatSequences(sequences);
    expect(formatted).toBe(">seq1\nATCG\n>seq2\nGGGG");
  });

  test("should exclude description when configured", () => {
    const noDescWriter = new FastaWriter({ includeDescription: false });
    const sequence: FastaSequence = createFastaRecord({
      id: "seq1",
      description: "Should be excluded",
      sequence: "ATCG",
    });

    const formatted = noDescWriter.formatSequence(sequence);
    expect(formatted).toBe(">seq1\nATCG");
  });
});

describe("FastaUtils", () => {
  test("should detect FASTA format", () => {
    expect(FastaUtils.detectFormat(">seq1\nATCG")).toBe(true);
    expect(FastaUtils.detectFormat("ATCG")).toBe(false);
    expect(FastaUtils.detectFormat("@seq1\nATCG\n+\nIIII")).toBe(false);
  });

  test("should count sequences", () => {
    const fasta = ">seq1\nATCG\n>seq2\nGGGG\n>seq3\nTTTT";
    expect(FastaUtils.countSequences(fasta)).toBe(3);
  });

  test("should extract sequence IDs", () => {
    const fasta = ">seq1 desc1\nATCG\n>seq2 desc2\nGGGG";
    const ids = FastaUtils.extractIds(fasta);
    expect(ids).toEqual(["seq1", "seq2"]);
  });

  test("should calculate sequence statistics", () => {
    const sequence = "ATCGATCGATCG";
    const stats = FastaUtils.calculateStats(sequence);

    expect(stats.length).toBe(12);
    expect(stats.gcContent).toBeCloseTo(0.5);
    expect(stats.composition).toEqual({
      A: 3,
      T: 3,
      C: 3,
      G: 3,
    });
  });

  test("should handle empty sequence statistics", () => {
    const stats = FastaUtils.calculateStats("");
    expect(stats.length).toBe(0);
    expect(stats.gcContent).toBe(0);
    expect(stats.composition).toEqual({});
  });

  test("should calculate GC content correctly", () => {
    expect(FastaUtils.calculateStats("AAAA").gcContent).toBe(0);
    expect(FastaUtils.calculateStats("GGGG").gcContent).toBe(1);
    expect(FastaUtils.calculateStats("ATCG").gcContent).toBe(0.5);
  });
});
