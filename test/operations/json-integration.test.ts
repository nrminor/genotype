/**
 * JSON/JSONL Integration Tests
 *
 * Tests SeqOps and TabularOps integration with JSON/JSONL formats.
 * Includes cross-format conversions and pipeline operations.
 */

import { describe, expect, test } from "bun:test";
import { FastaParser } from "../../src/formats/fasta";
import { SeqOps } from "../../src/operations";
import type { AbstractSequence, FastqSequence } from "../../src/types";

/**
 * Type guard to check if a sequence is a FASTQ sequence
 */
function isFastqSequence(seq: AbstractSequence): seq is FastqSequence {
  return "format" in seq && seq.format === "fastq" && "quality" in seq && "qualityEncoding" in seq;
}

// =============================================================================
// SEQOPS STATIC METHODS
// =============================================================================

describe("JSON Integration - SeqOps Static Methods", () => {
  describe("fromJSON()", () => {
    test("creates SeqOps pipeline from JSON file", async () => {
      const sequences = await SeqOps.fromJSON("test/fixtures/sequences.json").collect();

      expect(sequences).toHaveLength(3);
      expect(sequences[0]).toMatchObject({
        id: "seq1",
        sequence: "ATCGATCG",
        length: 8,
      });
      expect(sequences[1]).toMatchObject({
        id: "seq2",
        sequence: "GGCCGGCC",
        length: 8,
      });
    });

    test("supports method chaining with filter", async () => {
      const sequences = await SeqOps.fromJSON("test/fixtures/sequences.json")
        .filter({ minLength: 8 })
        .collect();

      expect(sequences).toHaveLength(3);
    });

    test("parses FASTQ from JSON", async () => {
      const sequences = await SeqOps.fromJSON("test/fixtures/sequences-fastq.json").collect();

      expect(sequences).toHaveLength(2);
      expect(sequences[0]).toHaveProperty("quality");

      if (isFastqSequence(sequences[0])) {
        expect(sequences[0].quality).toBe("IIIIIIII");
      } else {
        throw new Error("Expected FASTQ sequence");
      }
    });
  });

  describe("fromJSONL()", () => {
    test("creates SeqOps pipeline from JSONL file", async () => {
      const sequences = await SeqOps.fromJSONL("test/fixtures/sequences.jsonl").collect();

      expect(sequences).toHaveLength(4);
      expect(sequences[0].id).toBe("seq1");
      expect(sequences[0].sequence).toBe("ATCGATCG");
      expect(sequences[0].length).toBe(8);
    });

    test("supports async iteration", async () => {
      let count = 0;
      const pipeline = SeqOps.fromJSONL("test/fixtures/sequences.jsonl");

      for await (const seq of pipeline) {
        count++;
        expect(seq).toHaveProperty("id");
        expect(seq).toHaveProperty("sequence");
      }

      expect(count).toBe(4);
    });

    test("parses FASTQ from JSONL", async () => {
      const sequences = await SeqOps.fromJSONL("test/fixtures/sequences-fastq.jsonl").collect();

      expect(sequences).toHaveLength(3);
      expect(sequences[0]).toHaveProperty("quality");

      if (isFastqSequence(sequences[0])) {
        expect(sequences[0].quality).toBe("IIIIIIII");
      } else {
        throw new Error("Expected FASTQ sequence");
      }
    });
  });

  describe("asRows() alias", () => {
    test("asRows() returns same type as toTabular()", () => {
      const sequences = [{ id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const }];

      const withAsRows = SeqOps.from(sequences).asRows();
      const withToTabular = SeqOps.from(sequences).toTabular();

      expect(withAsRows).toBeDefined();
      expect(withToTabular).toBeDefined();

      expect(typeof withAsRows.writeJSON).toBe("function");
      expect(typeof withToTabular.writeJSON).toBe("function");
    });

    test("asRows() is semantically clearer for JSON output", async () => {
      const sequences = [
        { id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const },
        { id: "seq2", sequence: "GCTA", length: 4, format: "fasta" as const },
      ];

      const tabular = SeqOps.from(sequences).asRows({
        columns: ["id", "sequence"] as const,
      });

      expect(tabular).toBeDefined();

      const rows: unknown[] = [];
      for await (const row of tabular) {
        rows.push(row);
      }

      expect(rows.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// SEQOPS WRITE METHODS
// =============================================================================

describe("JSON Integration - SeqOps Write Methods", () => {
  describe("writeJSON()", () => {
    test("writes sequences to JSON file", async () => {
      const tempFile = "/tmp/genotype-test-writejson-1.json";
      const sequences = [
        { id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const },
        { id: "seq2", sequence: "GCTA", length: 4, format: "fasta" as const },
      ];

      await SeqOps.from(sequences).writeJSON(tempFile);

      const recovered = await SeqOps.fromJSON(tempFile).collect();
      expect(recovered).toHaveLength(2);
      expect(recovered[0].id).toBe("seq1");
      expect(recovered[0].sequence).toBe("ATCG");
    });

    test("supports column selection", async () => {
      const tempFile = "/tmp/genotype-test-writejson-2.json";
      const sequences = [
        { id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const },
        { id: "seq2", sequence: "GCTA", length: 4, format: "fasta" as const },
      ];

      await SeqOps.from(sequences).writeJSON(tempFile, {
        columns: ["id", "sequence"] as const,
      });

      const recovered = await SeqOps.fromJSON(tempFile).collect();
      expect(recovered).toHaveLength(2);
      expect(recovered[0]).toHaveProperty("id");
      expect(recovered[0]).toHaveProperty("sequence");
      expect(recovered[0]).not.toHaveProperty("gc");
    });

    test("supports pretty printing", async () => {
      const tempFile = "/tmp/genotype-test-writejson-3.json";
      const sequences = [{ id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const }];

      await SeqOps.from(sequences).writeJSON(tempFile, {
        pretty: true,
      });

      const content = await Bun.file(tempFile).text();
      expect(content).toContain("\n");
      expect(content).toContain("  ");
    });

    test("includes metadata when requested", async () => {
      const tempFile = "/tmp/genotype-test-writejson-4.json";
      const sequences = [
        { id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const },
        { id: "seq2", sequence: "GCTA", length: 4, format: "fasta" as const },
      ];

      await SeqOps.from(sequences).writeJSON(tempFile, {
        includeMetadata: true,
      });

      const content = await Bun.file(tempFile).text();
      const parsed = JSON.parse(content);

      expect(parsed).toHaveProperty("sequences");
      expect(parsed).toHaveProperty("metadata");
      expect(parsed.metadata.count).toBe(2);
    });
  });

  describe("writeJSONL()", () => {
    test("writes sequences to JSONL file", async () => {
      const tempFile = "/tmp/genotype-test-writejsonl-1.jsonl";
      const sequences = [
        { id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const },
        { id: "seq2", sequence: "GCTA", length: 4, format: "fasta" as const },
        { id: "seq3", sequence: "TTAA", length: 4, format: "fasta" as const },
      ];

      await SeqOps.from(sequences).writeJSONL(tempFile);

      const recovered = await SeqOps.fromJSONL(tempFile).collect();
      expect(recovered).toHaveLength(3);
      expect(recovered[0].id).toBe("seq1");
      expect(recovered[1].id).toBe("seq2");
      expect(recovered[2].id).toBe("seq3");
    });

    test("supports column selection", async () => {
      const tempFile = "/tmp/genotype-test-writejsonl-2.jsonl";
      const sequences = [
        { id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const },
        { id: "seq2", sequence: "GCTA", length: 4, format: "fasta" as const },
      ];

      await SeqOps.from(sequences).writeJSONL(tempFile, {
        columns: ["id", "sequence"] as const,
      });

      const recovered = await SeqOps.fromJSONL(tempFile).collect();
      expect(recovered).toHaveLength(2);
      expect(recovered[0]).toHaveProperty("id");
      expect(recovered[0]).toHaveProperty("sequence");
      expect(recovered[0]).not.toHaveProperty("gc");
    });

    test("streams with O(1) memory (line-by-line)", async () => {
      const tempFile = "/tmp/genotype-test-writejsonl-3.jsonl";
      const sequences = [
        { id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const },
        { id: "seq2", sequence: "GCTA", length: 4, format: "fasta" as const },
        { id: "seq3", sequence: "TTAA", length: 4, format: "fasta" as const },
      ];

      await SeqOps.from(sequences).writeJSONL(tempFile);

      const content = await Bun.file(tempFile).text();
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(3);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty("id");
        expect(parsed).toHaveProperty("sequence");
      }
    });

    test("does not include metadata (incompatible with JSONL)", async () => {
      const tempFile = "/tmp/genotype-test-writejsonl-4.jsonl";
      const sequences = [{ id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const }];

      await SeqOps.from(sequences).writeJSONL(tempFile);

      const content = await Bun.file(tempFile).text();
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed).not.toHaveProperty("sequences");
      expect(parsed).not.toHaveProperty("metadata");
      expect(parsed).toHaveProperty("id");
    });
  });
});

// =============================================================================
// TABULAROPS DIRECT USAGE
// =============================================================================

describe("JSON Integration - TabularOps Direct Usage", () => {
  test("TabularOps.writeJSON() works when called directly", async () => {
    const tempFile = "/tmp/genotype-test-tabular-json-1.json";
    const sequences = [
      { id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const },
      { id: "seq2", sequence: "GCTA", length: 4, format: "fasta" as const },
    ];

    const tabular = SeqOps.from(sequences).asRows({
      columns: ["id", "sequence", "length"] as const,
      header: false,
    });

    await tabular.writeJSON(tempFile);

    const recovered = await SeqOps.fromJSON(tempFile).collect();
    expect(recovered).toHaveLength(2);
    expect(recovered[0].id).toBe("seq1");
    expect(recovered[0].sequence).toBe("ATCG");
  });

  test("TabularOps.writeJSONL() works when called directly", async () => {
    const tempFile = "/tmp/genotype-test-tabular-jsonl-1.jsonl";
    const sequences = [
      { id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const },
      { id: "seq2", sequence: "GCTA", length: 4, format: "fasta" as const },
      { id: "seq3", sequence: "TTAA", length: 4, format: "fasta" as const },
    ];

    const tabular = SeqOps.from(sequences).asRows({
      columns: ["id", "sequence", "length"] as const,
      header: false,
    });

    await tabular.writeJSONL(tempFile);

    const content = await Bun.file(tempFile).text();
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toHaveProperty("id");
      expect(parsed).toHaveProperty("sequence");
    }
  });

  test("TabularOps.writeJSON() with pretty printing", async () => {
    const tempFile = "/tmp/genotype-test-tabular-json-2.json";
    const sequences = [{ id: "seq1", sequence: "ATCG", length: 4, format: "fasta" as const }];

    const tabular = SeqOps.from(sequences).asRows({
      columns: ["id", "sequence"] as const,
      header: false,
    });

    await tabular.writeJSON(tempFile, { pretty: true });

    const content = await Bun.file(tempFile).text();
    expect(content).toContain("\n");
    expect(content).toContain("  ");
  });

  test("TabularOps round-trip preserves data", async () => {
    const tempFile = "/tmp/genotype-test-tabular-roundtrip.json";
    const sequences = [
      { id: "seq1", sequence: "ATCGATCG", length: 8, format: "fasta" as const },
      { id: "seq2", sequence: "GGCCGGCC", length: 8, format: "fasta" as const },
      { id: "seq3", sequence: "TTAATTAA", length: 8, format: "fasta" as const },
    ];

    const tabular = SeqOps.from(sequences).asRows({
      columns: ["id", "sequence", "length"] as const,
      header: false,
    });
    await tabular.writeJSON(tempFile);

    const recovered = await SeqOps.fromJSON(tempFile).collect();

    expect(recovered).toHaveLength(3);
    expect(recovered[0]).toMatchObject({
      id: "seq1",
      sequence: "ATCGATCG",
      length: 8,
    });
    expect(recovered[1]).toMatchObject({
      id: "seq2",
      sequence: "GGCCGGCC",
      length: 8,
    });
    expect(recovered[2]).toMatchObject({
      id: "seq3",
      sequence: "TTAATTAA",
      length: 8,
    });
  });
});

// =============================================================================
// CROSS-FORMAT PIPELINES
// =============================================================================

describe("JSON Integration - Cross-Format Pipelines", () => {
  describe("JSON → Operations → Other Formats", () => {
    test("fromJSON() → filter() → writeFasta()", async () => {
      const jsonFile = "test/fixtures/sequences.json";
      const outputFile = "/tmp/genotype-test-json-to-fasta.fa";

      await SeqOps.fromJSON(jsonFile).filter({ minLength: 8 }).writeFasta(outputFile);

      const parser = new FastaParser();
      const sequences = await Array.fromAsync(parser.parseFile(outputFile));

      expect(sequences).toHaveLength(3);
      expect(sequences[0].id).toBe("seq1");
      expect(sequences[0].sequence).toBe("ATCGATCG");
    });

    test("fromJSONL() → collect → writeFasta()", async () => {
      const jsonlFile = "test/fixtures/sequences.jsonl";
      const outputFile = "/tmp/genotype-test-jsonl-to-fasta.fa";

      await SeqOps.fromJSONL(jsonlFile).writeFasta(outputFile);

      const parser = new FastaParser();
      const sequences = await Array.fromAsync(parser.parseFile(outputFile));

      expect(sequences.length).toBeGreaterThan(0);
      expect(sequences[0]).toHaveProperty("id");
      expect(sequences[0]).toHaveProperty("sequence");
    });
  });

  describe("Format Conversions via JSON", () => {
    test("FASTA → JSON → FASTA preserves sequences", async () => {
      const jsonInput = "test/fixtures/sequences.json";
      const fastaTemp = "/tmp/genotype-test-json-fasta-roundtrip.fa";
      const jsonOutput = "/tmp/genotype-test-fasta-json-fasta.json";

      const original = await SeqOps.fromJSON(jsonInput).collect();

      await SeqOps.fromJSON(jsonInput).writeFasta(fastaTemp);

      const parser = new FastaParser();
      await new SeqOps(parser.parseFile(fastaTemp)).writeJSON(jsonOutput);

      const recovered = await SeqOps.fromJSON(jsonOutput).collect();

      expect(recovered).toHaveLength(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(recovered[i].id).toBe(original[i].id);
        expect(recovered[i].sequence).toBe(original[i].sequence);
      }
    });

    test("FASTQ JSON → JSONL → JSON preserves quality scores", async () => {
      const jsonInput = "test/fixtures/sequences-fastq.json";
      const jsonlTemp = "/tmp/genotype-test-fastq-json-jsonl.jsonl";
      const jsonOutput = "/tmp/genotype-test-fastq-jsonl-json.json";

      const original = await SeqOps.fromJSON(jsonInput).collect();

      await SeqOps.fromJSON(jsonInput).writeJSONL(jsonlTemp);
      await SeqOps.fromJSONL(jsonlTemp).writeJSON(jsonOutput);

      const recovered = await SeqOps.fromJSON(jsonOutput).collect();

      expect(recovered).toHaveLength(original.length);

      for (let i = 0; i < original.length; i++) {
        const origSeq = original[i] as FastqSequence;
        const recSeq = recovered[i] as FastqSequence;

        expect(recSeq.id).toBe(origSeq.id);
        expect(recSeq.sequence).toBe(origSeq.sequence);

        if (origSeq.quality && recSeq.quality) {
          expect(recSeq.quality).toBe(origSeq.quality);
        }
      }
    });
  });

  describe("Complex Pipelines", () => {
    test("JSON → filter → writeFasta()", async () => {
      const jsonFile = "test/fixtures/sequences.json";
      const outputFile = "/tmp/genotype-test-complex-pipeline.fa";

      await SeqOps.fromJSON(jsonFile).filter({ minLength: 5 }).writeFasta(outputFile);

      const parser = new FastaParser();
      const sequences = await Array.fromAsync(parser.parseFile(outputFile));

      expect(sequences.length).toBeGreaterThan(0);

      for (const seq of sequences) {
        expect(seq.length).toBeGreaterThanOrEqual(5);
      }
    });

    test("JSON → writeJSON with column selection → fromJSON", async () => {
      const jsonInput = "test/fixtures/sequences.json";
      const jsonOutput = "/tmp/genotype-test-column-selection.json";

      await SeqOps.fromJSON(jsonInput).writeJSON(jsonOutput, {
        columns: ["id", "sequence", "length"] as const,
      });

      const sequences = await SeqOps.fromJSON(jsonOutput).collect();

      expect(sequences.length).toBeGreaterThan(0);
      expect(sequences[0]).toHaveProperty("id");
      expect(sequences[0]).toHaveProperty("sequence");
      expect(sequences[0]).toHaveProperty("length");
    });
  });
});
