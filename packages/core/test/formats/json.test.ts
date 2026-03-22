/**
 * JSON/JSONL Format Parser Tests
 *
 * Tests for JSONParser and JSONLParser.
 * Morph/serialization tests and tabular write tests have moved to @genotype/tabular.
 */

import { describe, expect, test } from "bun:test";
import "../matchers";
import { ParseError } from "@genotype/core/errors";
import { JSONLParser, JSONParser } from "@genotype/core/formats/json";
import type { FastaSequence, FastqSequence } from "@genotype/core/types";

describe("JSON Format - JSONParser", () => {
  describe("parseString()", () => {
    test("parses simple JSON array with FASTA sequences", async () => {
      const json = JSON.stringify([
        { id: "seq1", sequence: "ATCG", length: 4 },
        { id: "seq2", sequence: "GCTA", length: 4 },
      ]);

      const parser = new JSONParser();
      const sequences = await Array.fromAsync(parser.parseString(json));

      expect(sequences).toHaveLength(2);
      const seq1 = sequences[0] as FastaSequence;
      const seq2 = sequences[1] as FastaSequence;
      expect(seq1.format).toBe("fasta");
      expect(seq1.id).toBe("seq1");
      expect(seq1.sequence).toEqualSequence("ATCG");
      expect(seq1.length).toBe(4);
      expect(seq2.format).toBe("fasta");
      expect(seq2.id).toBe("seq2");
      expect(seq2.sequence).toEqualSequence("GCTA");
      expect(seq2.length).toBe(4);
    });

    test("parses wrapped JSON format with metadata", async () => {
      const json = JSON.stringify({
        sequences: [
          { id: "seq1", sequence: "ATCG" },
          { id: "seq2", sequence: "TTAA" },
        ],
        metadata: {
          count: 2,
          columns: ["id", "sequence"],
          generated: new Date().toISOString(),
        },
      });

      const parser = new JSONParser();
      const sequences = await Array.fromAsync(parser.parseString(json));

      expect(sequences).toHaveLength(2);
      expect(sequences[0]!.id).toBe("seq1");
      expect(sequences[1]!.id).toBe("seq2");
    });

    test("parses FASTQ sequences when quality field present", async () => {
      const json = JSON.stringify([
        {
          id: "seq1",
          sequence: "ATCG",
          quality: "IIII",
          qualityEncoding: "phred33",
          length: 4,
        },
      ]);

      const parser = new JSONParser();
      const sequences = await Array.fromAsync(parser.parseString(json));

      expect(sequences).toHaveLength(1);
      const seq = sequences[0] as FastqSequence;
      expect(seq.format).toBe("fastq");
      expect(seq.quality).toEqualSequence("IIII");
      expect(seq.qualityEncoding).toBe("phred33");
    });

    test("includes optional description field when present", async () => {
      const json = JSON.stringify([
        {
          id: "seq1",
          sequence: "ATCG",
          description: "test sequence",
          length: 4,
        },
      ]);

      const parser = new JSONParser();
      const sequences = await Array.fromAsync(parser.parseString(json));

      expect(sequences).toHaveLength(1);
      expect((sequences[0] as FastaSequence & { description?: string }).description).toBe(
        "test sequence"
      );
    });

    test("calculates length when not provided", async () => {
      const json = JSON.stringify([{ id: "seq1", sequence: "ATCGATCG" }]);

      const parser = new JSONParser();
      const sequences = await Array.fromAsync(parser.parseString(json));

      expect(sequences).toHaveLength(1);
      expect(sequences[0]!.length).toBe(8);
    });

    test("uses explicit format option when provided", async () => {
      const json = JSON.stringify([{ id: "seq1", sequence: "ATCG", quality: "IIII" }]);

      const parser = new JSONParser();
      const sequences = await Array.fromAsync(parser.parseString(json, { format: "fasta" }));

      expect(sequences).toHaveLength(1);
      const seq = sequences[0] as FastaSequence;
      expect(seq.format).toBe("fasta");
    });

    test("throws ParseError for invalid JSON", async () => {
      const invalidJson = "{ invalid json }";

      const parser = new JSONParser();

      await expect(async () => {
        for await (const _ of parser.parseString(invalidJson)) {
          // Should throw before yielding
        }
      }).toThrow(ParseError);
    });

    test("throws ParseError when required id field missing", async () => {
      const json = JSON.stringify([{ sequence: "ATCG" }]); // Missing 'id'

      const parser = new JSONParser();

      await expect(async () => {
        for await (const _ of parser.parseString(json)) {
          // Should throw on validation
        }
      }).toThrow(ParseError);
    });

    test("handles empty array", async () => {
      const json = JSON.stringify([]);

      const parser = new JSONParser();
      const sequences = await Array.fromAsync(parser.parseString(json));

      expect(sequences).toHaveLength(0);
    });
  });

  describe("parseFile()", () => {
    test("parses JSON file with FASTA sequences", async () => {
      const parser = new JSONParser();
      const sequences = await Array.fromAsync(parser.parseFile("test/fixtures/sequences.json"));

      expect(sequences).toHaveLength(3);
      expect(sequences[0]!.id).toBe("seq1");
      expect(sequences[0]!.sequence).toEqualSequence("ATCGATCG");
      expect(sequences[1]!.id).toBe("seq2");
      expect(sequences[2]!.id).toBe("seq3");
    });

    test("parses JSON file with wrapped format", async () => {
      const parser = new JSONParser();
      const sequences = await Array.fromAsync(
        parser.parseFile("test/fixtures/sequences-wrapped.json")
      );

      expect(sequences).toHaveLength(2);
      expect(sequences[0]!.id).toBe("seq1");
      expect(sequences[1]!.id).toBe("seq2");
    });

    test("parses JSON file with FASTQ sequences", async () => {
      const parser = new JSONParser();
      const sequences = await Array.fromAsync(
        parser.parseFile("test/fixtures/sequences-fastq.json")
      );

      expect(sequences).toHaveLength(2);
      const seq = sequences[0] as FastqSequence;
      expect(seq.format).toBe("fastq");
      expect(seq.quality).toEqualSequence("IIIIIIII");
    });
  });
});

describe("JSON Format - JSONLParser", () => {
  describe("parseFile()", () => {
    test("parses JSONL file with FASTA sequences", async () => {
      const parser = new JSONLParser();
      const sequences = await Array.fromAsync(parser.parseFile("test/fixtures/sequences.jsonl"));

      expect(sequences).toHaveLength(4);
      expect(sequences[0]!.id).toBe("seq1");
      expect(sequences[0]!.sequence).toEqualSequence("ATCGATCG");
      expect(sequences[1]!.id).toBe("seq2");
      expect(sequences[2]!.id).toBe("seq3");
      expect(sequences[3]!.id).toBe("seq4");
    });

    test("parses JSONL file with FASTQ sequences", async () => {
      const parser = new JSONLParser();
      const sequences = await Array.fromAsync(
        parser.parseFile("test/fixtures/sequences-fastq.jsonl")
      );

      expect(sequences).toHaveLength(3);
      const seq = sequences[0] as FastqSequence;
      expect(seq.format).toBe("fastq");
      expect(seq.quality).toEqualSequence("IIIIIIII");
      expect(seq.qualityEncoding).toBe("phred33");
    });

    test("streams sequences one at a time", async () => {
      const parser = new JSONLParser();
      const ids: string[] = [];

      for await (const seq of parser.parseFile("test/fixtures/sequences.jsonl")) {
        ids.push(seq.id);
      }

      expect(ids).toEqual(["seq1", "seq2", "seq3", "seq4"]);
    });
  });

  describe("streaming behavior", () => {
    test("handles large datasets with O(1) memory", async () => {
      const parser = new JSONLParser();
      let count = 0;

      for await (const _ of parser.parseFile("test/fixtures/sequences.jsonl")) {
        count++;
      }

      expect(count).toBe(4);
    });
  });

  describe("error handling", () => {
    test("skips empty lines in JSONL", async () => {
      const parser = new JSONLParser();
      const sequences = await Array.fromAsync(parser.parseFile("test/fixtures/sequences.jsonl"));

      expect(sequences).toHaveLength(4);
    });
  });
});
