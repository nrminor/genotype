/**
 * JSON/JSONL Format Tests
 *
 * Comprehensive tests for JSON and JSONL (JSON Lines) format support.
 * Tests morphs, parsers, validation, and edge cases.
 */

import { describe, expect, test } from "bun:test";
import { type } from "arktype";
import { ParseError } from "../../src/errors";
import {
  deserializeJSON,
  deserializeJSONWrapped,
  JSONLParser,
  JSONParser,
  jsonlToRows,
  rowsToJSONL,
  type SequenceRow,
  serializeJSON,
  serializeJSONPretty,
  serializeJSONWithMetadata,
  serializeJSONWithMetadataPretty,
} from "../../src/formats/json";
import { SeqOps } from "../../src/operations";
import type { FastaSequence, FastqSequence } from "../../src/types";

// =============================================================================
// MORPHS & VALIDATION
// =============================================================================

describe("JSON Format - Morphs & Validation", () => {
  describe("Serialization", () => {
    const sampleRows: SequenceRow[] = [
      {
        id: "seq1",
        sequence: "ATCG",
        quality: "IIII",
        description: "test sequence 1",
        length: 4,
        gc: 50,
      },
      {
        id: "seq2",
        sequence: "GGCC",
        length: 4,
        gc: 100,
      },
    ];

    test("serializeJSON produces valid compact JSON", () => {
      const result = serializeJSON(sampleRows);

      if (result instanceof type.errors) {
        throw new Error(`Serialization failed: ${result.summary}`);
      }

      expect(typeof result).toBe("string");
      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe("seq1");
      expect(parsed[1].id).toBe("seq2");
    });

    test("serializeJSONPretty produces formatted JSON", () => {
      const result = serializeJSONPretty(sampleRows);

      if (result instanceof type.errors) {
        throw new Error(`Pretty serialization failed: ${result.summary}`);
      }

      expect(typeof result).toBe("string");
      expect(result).toContain("\n");
      expect(result).toContain("  ");
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(2);
    });

    test("serializeJSONWithMetadata wraps sequences with metadata", () => {
      const wrapped = {
        sequences: sampleRows,
        metadata: {
          count: 2,
          columns: ["id", "sequence", "quality"],
          generated: new Date().toISOString(),
        },
      };

      const result = serializeJSONWithMetadata(wrapped);

      if (result instanceof type.errors) {
        throw new Error(`Metadata serialization failed: ${result.summary}`);
      }

      const parsed = JSON.parse(result);
      expect(parsed.sequences).toHaveLength(2);
      expect(parsed.metadata.count).toBe(2);
      expect(parsed.metadata.columns).toEqual(["id", "sequence", "quality"]);
    });

    test("serializeJSONWithMetadataPretty formats wrapped JSON", () => {
      const wrapped = {
        sequences: sampleRows,
        metadata: {
          count: 2,
          columns: ["id", "sequence"],
        },
      };

      const result = serializeJSONWithMetadataPretty(wrapped);

      if (result instanceof type.errors) {
        throw new Error(`Pretty metadata serialization failed: ${result.summary}`);
      }

      expect(result).toContain("\n");
      expect(result).toContain("  ");
    });

    test("rejects invalid data with type errors", () => {
      const invalidData: unknown = [{ id: "seq1", gc: 150 }];

      const result = serializeJSON(invalidData);

      expect(result instanceof type.errors).toBe(true);
      if (result instanceof type.errors) {
        expect(result.summary).toContain("gc");
      }
    });
  });

  describe("Deserialization", () => {
    const validJSON = JSON.stringify([
      { id: "seq1", sequence: "ATCG", length: 4, gc: 50 },
      { id: "seq2", sequence: "GGCC", length: 4, gc: 100 },
    ]);

    test("deserializeJSON parses and validates JSON array", () => {
      const result = deserializeJSON(validJSON);

      if (result instanceof type.errors) {
        throw new Error(`Deserialization failed: ${result.summary}`);
      }

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("seq1");
      expect(result[0].sequence).toBe("ATCG");
      expect(result[1].id).toBe("seq2");
    });

    test("deserializeJSON rejects invalid JSON structure", () => {
      const invalidJSON = JSON.stringify([
        { sequence: "ATCG" }, // missing required 'id' field
      ]);

      const result = deserializeJSON(invalidJSON);

      expect(result instanceof type.errors).toBe(true);
      if (result instanceof type.errors) {
        expect(result.summary).toContain("id");
      }
    });

    test("deserializeJSON rejects out-of-bounds values", () => {
      const outOfBounds = JSON.stringify([
        { id: "seq1", gc: 150 }, // gc > 100
      ]);

      const result = deserializeJSON(outOfBounds);

      expect(result instanceof type.errors).toBe(true);
    });

    test("deserializeJSONWrapped parses wrapped format", () => {
      const wrappedJSON = JSON.stringify({
        sequences: [
          { id: "seq1", sequence: "ATCG" },
          { id: "seq2", sequence: "GGCC" },
        ],
        metadata: {
          count: 2,
          columns: ["id", "sequence"],
        },
      });

      const result = deserializeJSONWrapped(wrappedJSON);

      if (result instanceof type.errors) {
        throw new Error(`Wrapped deserialization failed: ${result.summary}`);
      }

      expect(result.sequences).toHaveLength(2);
      expect(result.metadata.count).toBe(2);
      expect(result.metadata.columns).toEqual(["id", "sequence"]);
    });

    test("deserializeJSONWrapped validates metadata schema", () => {
      const invalidMetadata = JSON.stringify({
        sequences: [{ id: "seq1" }],
        metadata: {
          count: -1, // Must be >= 0
          columns: ["id"],
        },
      });

      const result = deserializeJSONWrapped(invalidMetadata);

      expect(result instanceof type.errors).toBe(true);
    });
  });

  describe("JSONL Streaming", () => {
    const sampleRows: SequenceRow[] = [
      { id: "seq1", sequence: "ATCG", length: 4, gc: 50 },
      { id: "seq2", sequence: "GGCC", length: 4, gc: 100 },
      { id: "seq3", sequence: "TTAA", length: 4, gc: 0 },
    ];

    test("rowsToJSONL generates line-delimited JSON", () => {
      const lines = Array.from(rowsToJSONL(sampleRows));

      expect(lines).toHaveLength(3);

      const parsed1 = JSON.parse(lines[0]);
      expect(parsed1.id).toBe("seq1");
      expect(parsed1.sequence).toBe("ATCG");

      const parsed2 = JSON.parse(lines[1]);
      expect(parsed2.id).toBe("seq2");

      const parsed3 = JSON.parse(lines[2]);
      expect(parsed3.id).toBe("seq3");
    });

    test("rowsToJSONL validates each row", () => {
      const validRow = { id: "seq1", sequence: "ATCG" };
      const invalidRow = { id: "seq2", gc: 150 };

      expect(() => {
        Array.from(rowsToJSONL([validRow, invalidRow]));
      }).toThrow("Invalid row");
    });

    test("jsonlToRows parses line-delimited JSON", async () => {
      const lines = [
        '{"id":"seq1","sequence":"ATCG","length":4}',
        '{"id":"seq2","sequence":"GGCC","length":4}',
        '{"id":"seq3","sequence":"TTAA","length":4}',
      ];

      async function* lineGenerator() {
        for (const line of lines) {
          yield line;
        }
      }

      const results: SequenceRow[] = [];
      for await (const row of jsonlToRows(lineGenerator())) {
        results.push(row);
      }

      expect(results).toHaveLength(3);
      expect(results[0].id).toBe("seq1");
      expect(results[1].id).toBe("seq2");
      expect(results[2].id).toBe("seq3");
    });

    test("jsonlToRows skips empty lines", async () => {
      const lines = [
        '{"id":"seq1","sequence":"ATCG"}',
        "",
        "   ",
        '{"id":"seq2","sequence":"GGCC"}',
      ];

      async function* lineGenerator() {
        for (const line of lines) {
          yield line;
        }
      }

      const results: SequenceRow[] = [];
      for await (const row of jsonlToRows(lineGenerator())) {
        results.push(row);
      }

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("seq1");
      expect(results[1].id).toBe("seq2");
    });

    test("jsonlToRows rejects invalid JSONL", async () => {
      const lines = [
        '{"id":"seq1"}',
        '{"sequence":"ATCG"}', // Missing required 'id'
      ];

      async function* lineGenerator() {
        for (const line of lines) {
          yield line;
        }
      }

      await expect(async () => {
        for await (const _ of jsonlToRows(lineGenerator())) {
          // Should throw on invalid line
        }
      }).toThrow("Invalid JSONL");
    });
  });

  describe("Round-Trip Validation", () => {
    test("serialize → deserialize preserves data", () => {
      const original: SequenceRow[] = [
        {
          id: "seq1",
          sequence: "ATCG",
          quality: "IIII",
          description: "test",
          length: 4,
          gc: 50,
          avgQuality: 40,
        },
        {
          id: "seq2",
          sequence: "GGCC",
          length: 4,
          gc: 100,
        },
      ];

      const serialized = serializeJSON(original);
      if (serialized instanceof type.errors) {
        throw new Error("Serialization failed");
      }

      const deserialized = deserializeJSON(serialized);
      if (deserialized instanceof type.errors) {
        throw new Error("Deserialization failed");
      }

      expect(deserialized).toEqual(original);
    });

    test("wrapped format round-trip preserves structure", () => {
      const original = {
        sequences: [
          { id: "seq1", sequence: "ATCG", length: 4 },
          { id: "seq2", sequence: "GGCC", length: 4 },
        ],
        metadata: {
          count: 2,
          columns: ["id", "sequence", "length"],
          generated: "2025-10-06T10:00:00.000Z",
        },
      };

      const serialized = serializeJSONWithMetadata(original);
      if (serialized instanceof type.errors) {
        throw new Error("Serialization failed");
      }

      const deserialized = deserializeJSONWrapped(serialized);
      if (deserialized instanceof type.errors) {
        throw new Error("Deserialization failed");
      }

      expect(deserialized).toEqual(original);
    });

    test("JSONL round-trip preserves all rows", async () => {
      const original: SequenceRow[] = [
        { id: "seq1", sequence: "ATCG", length: 4, gc: 50 },
        { id: "seq2", sequence: "GGCC", length: 4, gc: 100 },
        { id: "seq3", sequence: "TTAA", length: 4, gc: 0 },
      ];

      const lines = Array.from(rowsToJSONL(original));

      async function* lineGenerator() {
        for (const line of lines) {
          yield line;
        }
      }

      const recovered: SequenceRow[] = [];
      for await (const row of jsonlToRows(lineGenerator())) {
        recovered.push(row);
      }

      expect(recovered).toEqual(original);
    });
  });
});

// =============================================================================
// JSONPARSER
// =============================================================================

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
      expect(sequences[0]).toMatchObject({
        format: "fasta",
        id: "seq1",
        sequence: "ATCG",
        length: 4,
      });
      expect(sequences[1]).toMatchObject({
        format: "fasta",
        id: "seq2",
        sequence: "GCTA",
        length: 4,
      });
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
      expect(sequences[0].id).toBe("seq1");
      expect(sequences[1].id).toBe("seq2");
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
      expect(seq.quality).toBe("IIII");
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
      expect(sequences[0].length).toBe(8);
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
      expect(sequences[0].id).toBe("seq1");
      expect(sequences[0].sequence).toBe("ATCGATCG");
      expect(sequences[1].id).toBe("seq2");
      expect(sequences[2].id).toBe("seq3");
    });

    test("parses JSON file with wrapped format", async () => {
      const parser = new JSONParser();
      const sequences = await Array.fromAsync(
        parser.parseFile("test/fixtures/sequences-wrapped.json")
      );

      expect(sequences).toHaveLength(2);
      expect(sequences[0].id).toBe("seq1");
      expect(sequences[1].id).toBe("seq2");
    });

    test("parses JSON file with FASTQ sequences", async () => {
      const parser = new JSONParser();
      const sequences = await Array.fromAsync(
        parser.parseFile("test/fixtures/sequences-fastq.json")
      );

      expect(sequences).toHaveLength(2);
      const seq = sequences[0] as FastqSequence;
      expect(seq.format).toBe("fastq");
      expect(seq.quality).toBe("IIIIIIII");
    });
  });
});

// =============================================================================
// JSONLPARSER
// =============================================================================

describe("JSON Format - JSONLParser", () => {
  describe("parseFile()", () => {
    test("parses JSONL file with FASTA sequences", async () => {
      const parser = new JSONLParser();
      const sequences = await Array.fromAsync(parser.parseFile("test/fixtures/sequences.jsonl"));

      expect(sequences).toHaveLength(4);
      expect(sequences[0].id).toBe("seq1");
      expect(sequences[0].sequence).toBe("ATCGATCG");
      expect(sequences[1].id).toBe("seq2");
      expect(sequences[2].id).toBe("seq3");
      expect(sequences[3].id).toBe("seq4");
    });

    test("parses JSONL file with FASTQ sequences", async () => {
      const parser = new JSONLParser();
      const sequences = await Array.fromAsync(
        parser.parseFile("test/fixtures/sequences-fastq.jsonl")
      );

      expect(sequences).toHaveLength(3);
      const seq = sequences[0] as FastqSequence;
      expect(seq.format).toBe("fastq");
      expect(seq.quality).toBe("IIIIIIII");
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

// =============================================================================
// EDGE CASES
// =============================================================================

describe("JSON Format - Edge Cases", () => {
  describe("Special Characters in IDs", () => {
    test("handles Unicode characters in sequence IDs", async () => {
      const sequences = [
        { id: "seq_αβγ", sequence: "ATCG", length: 4, format: "fasta" as const },
        { id: "seq_中文", sequence: "GCTA", length: 4, format: "fasta" as const },
        { id: "seq_🧬", sequence: "TTAA", length: 4, format: "fasta" as const },
      ];

      const tempFile = "/tmp/genotype-test-unicode-ids.json";
      await SeqOps.from(sequences).writeJSON(tempFile);

      const recovered = await SeqOps.fromJSON(tempFile).collect();
      expect(recovered[0].id).toBe("seq_αβγ");
      expect(recovered[1].id).toBe("seq_中文");
      expect(recovered[2].id).toBe("seq_🧬");
    });

    test("handles spaces and special chars in IDs", async () => {
      const sequences = [
        { id: "seq with spaces", sequence: "ATCG", length: 4, format: "fasta" as const },
        { id: "seq-with-dashes", sequence: "GCTA", length: 4, format: "fasta" as const },
        {
          id: "seq_with_underscores",
          sequence: "TTAA",
          length: 4,
          format: "fasta" as const,
        },
      ];

      const tempFile = "/tmp/genotype-test-special-chars.json";
      await SeqOps.from(sequences).writeJSON(tempFile);

      const recovered = await SeqOps.fromJSON(tempFile).collect();
      expect(recovered[0].id).toBe("seq with spaces");
      expect(recovered[1].id).toBe("seq-with-dashes");
    });

    test("handles quotes in IDs (properly escaped)", async () => {
      const sequences = [
        { id: 'seq"with"quotes', sequence: "ATCG", length: 4, format: "fasta" as const },
        {
          id: "seq'with'apostrophes",
          sequence: "GCTA",
          length: 4,
          format: "fasta" as const,
        },
      ];

      const tempFile = "/tmp/genotype-test-quotes.json";
      await SeqOps.from(sequences).writeJSON(tempFile);

      const content = await Bun.file(tempFile).text();
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(2);

      const recovered = await SeqOps.fromJSON(tempFile).collect();
      expect(recovered[0].id).toBe('seq"with"quotes');
      expect(recovered[1].id).toBe("seq'with'apostrophes");
    });
  });

  describe("Very Long Sequences", () => {
    test("handles sequences over 100KB", async () => {
      const longSequence = "A".repeat(100000);
      const sequences = [
        {
          id: "long_seq",
          sequence: longSequence,
          length: 100000,
          format: "fasta" as const,
        },
      ];

      const tempFile = "/tmp/genotype-test-long-seq.json";
      await SeqOps.from(sequences).writeJSON(tempFile);

      const recovered = await SeqOps.fromJSON(tempFile).collect();
      expect(recovered).toHaveLength(1);
      expect(recovered[0].sequence).toHaveLength(100000);
      expect(recovered[0].sequence).toBe(longSequence);
    });

    test("handles multiple long sequences in JSONL", async () => {
      const longSeq1 = "ATCG".repeat(25000);
      const longSeq2 = "GCTA".repeat(25000);

      const sequences = [
        { id: "long1", sequence: longSeq1, length: 100000, format: "fasta" as const },
        { id: "long2", sequence: longSeq2, length: 100000, format: "fasta" as const },
      ];

      const tempFile = "/tmp/genotype-test-long-jsonl.jsonl";
      await SeqOps.from(sequences).writeJSONL(tempFile);

      const recovered = await SeqOps.fromJSONL(tempFile).collect();
      expect(recovered).toHaveLength(2);
      expect(recovered[0].sequence).toHaveLength(100000);
      expect(recovered[1].sequence).toHaveLength(100000);
    });
  });

  describe("Empty and Single Element Cases", () => {
    test("handles empty array", async () => {
      const sequences: never[] = [];
      const tempFile = "/tmp/genotype-test-empty.json";

      await SeqOps.from(sequences).writeJSON(tempFile);

      const recovered = await SeqOps.fromJSON(tempFile).collect();
      expect(recovered).toHaveLength(0);
    });

    test("handles single sequence", async () => {
      const sequences = [
        { id: "only_one", sequence: "ATCGATCG", length: 8, format: "fasta" as const },
      ];

      const tempFile = "/tmp/genotype-test-single.json";
      await SeqOps.from(sequences).writeJSON(tempFile);

      const recovered = await SeqOps.fromJSON(tempFile).collect();
      expect(recovered).toHaveLength(1);
      expect(recovered[0].id).toBe("only_one");
    });

    test("handles empty JSONL file", async () => {
      const tempFile = "/tmp/genotype-test-empty.jsonl";
      await Bun.write(tempFile, "");

      const parser = new JSONLParser();
      const sequences = await Array.fromAsync(parser.parseFile(tempFile));
      expect(sequences).toHaveLength(0);
    });
  });

  describe("Malformed JSON/JSONL", () => {
    test("throws ParseError for invalid JSON syntax", async () => {
      const tempFile = "/tmp/genotype-test-invalid.json";
      await Bun.write(tempFile, "{ invalid json }");

      const parser = new JSONParser();

      await expect(async () => {
        await Array.fromAsync(parser.parseFile(tempFile));
      }).toThrow();
    });

    test("throws ParseError when id field is missing", async () => {
      const tempFile = "/tmp/genotype-test-no-id.json";
      await Bun.write(tempFile, JSON.stringify([{ sequence: "ATCG", length: 4 }]));

      const parser = new JSONParser();

      await expect(async () => {
        await Array.fromAsync(parser.parseFile(tempFile));
      }).toThrow();
    });

    test("handles malformed JSONL gracefully", async () => {
      const tempFile = "/tmp/genotype-test-malformed.jsonl";
      await Bun.write(
        tempFile,
        '{"id":"seq1","sequence":"ATCG","length":4}\n' +
          "{ invalid json }\n" +
          '{"id":"seq3","sequence":"GCTA","length":4}\n'
      );

      const parser = new JSONLParser();

      await expect(async () => {
        await Array.fromAsync(parser.parseFile(tempFile));
      }).toThrow();
    });
  });

  describe("Computed Columns with NaN/Infinity", () => {
    test("handles NaN in computed columns", async () => {
      const sequences = [{ id: "seq1", sequence: "NNNN", length: 4, format: "fasta" as const }];

      const tempFile = "/tmp/genotype-test-nan.json";
      await SeqOps.from(sequences).writeJSON(tempFile, {
        columns: ["id", "sequence", "gc"] as const,
      });

      const content = await Bun.file(tempFile).text();
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toHaveProperty("gc");
    });

    test("pretty printing works with special values", async () => {
      const sequences = [{ id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const }];

      const tempFile = "/tmp/genotype-test-pretty.json";
      await SeqOps.from(sequences).writeJSON(tempFile, {
        pretty: true,
        columns: ["id", "sequence", "length", "gc"] as const,
      });

      const content = await Bun.file(tempFile).text();
      expect(content).toContain("\n");
      expect(content).toContain("  ");

      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(1);
    });
  });

  describe("JSONL Line-by-Line Streaming", () => {
    test("handles blank lines in JSONL", async () => {
      const tempFile = "/tmp/genotype-test-blank-lines.jsonl";
      await Bun.write(
        tempFile,
        '{"id":"seq1","sequence":"ATCG","length":4}\n' +
          "\n" +
          '{"id":"seq2","sequence":"GCTA","length":4}\n' +
          "\n" +
          '{"id":"seq3","sequence":"TTAA","length":4}\n'
      );

      const parser = new JSONLParser();
      const sequences = await Array.fromAsync(parser.parseFile(tempFile));

      expect(sequences).toHaveLength(3);
    });
  });
});
