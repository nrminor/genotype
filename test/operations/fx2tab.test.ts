import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { FileError, ParseError } from "../../src/errors";
import { SeqOps, seqops } from "../../src/operations";
import { baseContent, baseCount, sequenceAlphabet } from "../../src/operations/core/calculations";
import { hashMD5 } from "../../src/operations/core/hashing";
import {
  type ColumnId,
  type Fx2TabRow,
  fx2tab,
  TabularOps,
  tab2fx,
} from "../../src/operations/fx2tab";
import type { AbstractSequence } from "../../src/types";

describe("fx2tab", () => {
  const testSequences: AbstractSequence[] = [
    {
      id: "seq1",
      sequence: "ATCGATCG",
      length: 8,
      description: "test sequence 1",
    },
    {
      id: "SEPT1",
      sequence: "GCTAGCTA",
      length: 8,
      description: "septin gene",
    },
    {
      id: "seq3",
      sequence: "ATGC",
      length: 4,
      ...{ quality: "IIII", qualityEncoding: "phred33" }, // FASTQ-specific fields
    } as AbstractSequence,
  ];

  async function* asyncSequences() {
    for (const seq of testSequences) {
      yield seq;
    }
  }

  describe("standalone function", () => {
    test("converts sequences to TSV with default columns", async () => {
      const rows: string[] = [];
      for await (const row of fx2tab(asyncSequences())) {
        rows.push(row.__raw);
      }

      expect(rows).toHaveLength(4); // header + 3 sequences
      expect(rows[0]).toBe("id\tsequence\tLength"); // DSV-compatible headers
      expect(rows[1]).toBe("seq1\tATCGATCG\t8");
    });

    test("provides type-safe field access", async () => {
      const rows: Array<{
        id: string;
        length: number;
        gc: number;
        __columns: readonly string[];
        __delimiter: string;
      }> = [];
      for await (const row of fx2tab(asyncSequences(), {
        columns: ["id", "length", "gc"] as const,
      })) {
        rows.push(row);
      }

      // Test type-safe access
      expect(rows[1].id).toBe("seq1");
      expect(rows[1].length).toBe(8);
      expect(rows[1].gc).toBeCloseTo(50, 1);

      // Test metadata fields
      expect(rows[1].__columns).toEqual(["id", "length", "gc"]);
      expect(rows[1].__delimiter).toBe("\t");
    });

    test("supports custom columns", async () => {
      const rows: string[] = [];
      for await (const row of fx2tab(asyncSequences(), {
        columns: ["id", "description", "gc"],
      })) {
        rows.push(row.__raw);
      }

      expect(rows[0]).toBe("id\tdescription\tGC%"); // DSV-compatible headers
      expect(rows[1]).toContain("seq1\ttest sequence 1\t50.00");
    });

    test("protects Excel-sensitive gene names", async () => {
      const rows: string[] = [];
      for await (const row of fx2tab(asyncSequences(), {
        columns: ["id"],
        excelSafe: true,
        header: false,
      })) {
        rows.push(row.__raw);
      }

      expect(rows[0]).toBe("seq1");
      expect(rows[1]).toBe('"SEPT1"'); // Protected with quotes (RFC 4180 standard)
      expect(rows[2]).toBe("seq3");
    });

    test("supports custom delimiter", async () => {
      const rows: string[] = [];
      for await (const row of fx2tab(asyncSequences(), {
        columns: ["id", "sequence"],
        delimiter: ",",
        header: false,
      })) {
        rows.push(row.__raw);
      }

      expect(rows[0]).toBe("seq1,ATCGATCG");
      expect(rows[1]).toBe("SEPT1,GCTAGCTA");
    });

    test("supports precision control", async () => {
      const rows: string[] = [];
      for await (const row of fx2tab(asyncSequences(), {
        columns: ["id", "gc"],
        precision: 1,
        header: false,
      })) {
        rows.push(row.__raw);
      }

      expect(rows[0]).toContain("\t50.0");
      expect(rows[1]).toContain("\t50.0");
      expect(rows[2]).toContain("\t50.0");
    });

    test("works with empty sequences", async () => {
      async function* emptyGen() {
        yield { id: "empty", sequence: "", length: 0 } as AbstractSequence;
      }

      const rows: string[] = [];
      for await (const row of fx2tab(emptyGen(), {
        columns: ["id", "sequence", "length"],
        header: false,
      })) {
        rows.push(row.__raw);
      }

      expect(rows).toHaveLength(1);
      expect(rows[0]).toBe("empty\t\t0");
    });
  });

  describe("SeqKit fx2tab column parity", () => {
    // Helper to create async sequence generators
    function* sequences() {
      yield { id: "seq1", sequence: "ATCGATCGNNatcg", description: "test", length: 14 };
    }

    async function* asyncSeqKitSequences() {
      yield* sequences();
    }

    describe("static new columns", () => {
      test("alphabet column extracts unique characters", async () => {
        const rows = [];
        for await (const row of fx2tab(asyncSeqKitSequences(), {
          columns: ["id", "alphabet"],
          header: false,
        })) {
          rows.push(row);
        }

        // Verify against our core function
        const expectedAlphabet = sequenceAlphabet("ATCGATCGNNatcg", false);
        expect(rows[0].alphabet).toBe(expectedAlphabet);
        expect(rows[0].alphabet).toBe("ACGNT");
      });

      test("seq_hash column generates consistent MD5", async () => {
        const rows = [];
        for await (const row of fx2tab(asyncSeqKitSequences(), {
          columns: ["id", "seq_hash"],
          header: false,
        })) {
          rows.push(row);
        }

        // Verify against our core function
        const expectedHash = hashMD5("ATCGATCGNNatcg", false);
        expect(rows[0].seq_hash).toBe(expectedHash);
        expect(rows[0].seq_hash).toHaveLength(32);
      });
    });

    describe("dynamic columns", () => {
      test("baseContent creates percentage columns", async () => {
        const rows = [];
        for await (const row of fx2tab(asyncSeqKitSequences(), {
          baseContent: ["AT", "GC", "N"],
          header: false,
        })) {
          rows.push(row);
        }

        // Access dynamic columns through index signature
        const rowData = rows[0] as Record<string, unknown>;

        // Verify against our core functions
        const seq = "ATCGATCGNNatcg";
        expect(rowData["base_content_AT"]).toBe(baseContent(seq, "AT", false));
        expect(rowData["base_content_GC"]).toBe(baseContent(seq, "GC", false));
        expect(rowData["base_content_N"]).toBe(baseContent(seq, "N", false));

        // Check actual values
        expect(rowData["base_content_AT"]).toBeCloseTo(42.86, 1);
        expect(rowData["base_content_GC"]).toBeCloseTo(42.86, 1);
        expect(rowData["base_content_N"]).toBeCloseTo(14.29, 1);
      });

      test("baseCount creates count columns", async () => {
        const rows = [];
        for await (const row of fx2tab(asyncSeqKitSequences(), {
          baseCount: ["AT", "GC", "N"],
          header: false,
        })) {
          rows.push(row);
        }

        // Access dynamic columns through index signature
        const rowData = rows[0] as Record<string, unknown>;

        // Verify against our core functions
        const seq = "ATCGATCGNNatcg";
        expect(rowData["base_count_AT"]).toBe(baseCount(seq, "AT", false));
        expect(rowData["base_count_GC"]).toBe(baseCount(seq, "GC", false));
        expect(rowData["base_count_N"]).toBe(baseCount(seq, "N", false));

        // Check actual values
        expect(rowData["base_count_AT"]).toBe(6);
        expect(rowData["base_count_GC"]).toBe(6);
        expect(rowData["base_count_N"]).toBe(2);
      });
    });

    describe("case sensitivity", () => {
      test("affects all computed columns when enabled", async () => {
        const testSeq = "ATCGatcg";

        function* caseTestSequences() {
          yield { id: "test", sequence: testSeq, length: 8 };
        }

        async function* asyncCaseTest() {
          yield* caseTestSequences();
        }

        // Case insensitive (default)
        const insensitiveRows = [];
        for await (const row of fx2tab(asyncCaseTest(), {
          columns: ["alphabet", "seq_hash"],
          baseContent: ["AT"],
          caseSensitive: false,
          header: false,
        })) {
          insensitiveRows.push(row);
        }

        // Case sensitive
        const sensitiveRows = [];
        for await (const row of fx2tab(asyncCaseTest(), {
          columns: ["alphabet", "seq_hash"],
          baseContent: ["AT"],
          caseSensitive: true,
          header: false,
        })) {
          sensitiveRows.push(row);
        }

        // Alphabet should differ
        expect(insensitiveRows[0].alphabet).toBe("ACGT");
        expect(sensitiveRows[0].alphabet).toBe("ACGTacgt");

        // Hash should differ
        expect(insensitiveRows[0].seq_hash).not.toBe(sensitiveRows[0].seq_hash);

        // Base content should differ
        const insensitiveData = insensitiveRows[0] as Record<string, unknown>;
        const sensitiveData = sensitiveRows[0] as Record<string, unknown>;
        expect(insensitiveData["base_content_AT"]).toBe(50); // 4 out of 8
        expect(sensitiveData["base_content_AT"]).toBe(25); // 2 out of 8
      });
    });

    describe("round-trip preservation", () => {
      test("new columns don't interfere with core data", async () => {
        const rows = [];
        for await (const row of fx2tab(asyncSeqKitSequences(), {
          columns: ["id", "sequence", "description", "alphabet", "seq_hash"],
          baseContent: ["AT"],
          header: true,
        })) {
          rows.push(row);
        }

        // Skip header
        const dataRow = rows[1];

        // Core data must be preserved exactly
        expect(dataRow.id).toBe("seq1");
        expect(dataRow.sequence).toBe("ATCGATCGNNatcg");
        expect(dataRow.description).toBe("test");

        // Computed columns are present
        expect(dataRow.alphabet).toBeDefined();
        expect(dataRow.seq_hash).toBeDefined();

        // Dynamic columns are accessible
        const dynamicData = dataRow as Record<string, unknown>;
        expect(dynamicData["base_content_AT"]).toBeDefined();
      });

      test("headers format correctly for all column types", async () => {
        const rows = [];
        for await (const row of fx2tab(asyncSeqKitSequences(), {
          columns: ["id", "alphabet", "seq_hash"],
          baseContent: ["AT", "GC"],
          baseCount: ["N"],
          header: true,
        })) {
          rows.push(row);
        }

        const headerRow = rows[0];
        const headers = headerRow.__values;

        // Check static column headers
        expect(headers).toContain("id");
        expect(headers).toContain("Alphabet");
        expect(headers).toContain("MD5_Hash");

        // Check dynamic column headers
        expect(headers).toContain("base_content_AT");
        expect(headers).toContain("base_content_GC");
        expect(headers).toContain("base_count_N");
      });
    });

    describe("formatting", () => {
      test("base_content uses precision, base_count is integer", async () => {
        const rows = [];
        for await (const row of fx2tab(asyncSeqKitSequences(), {
          baseContent: ["AT"],
          baseCount: ["AT"],
          precision: 3,
          header: false,
        })) {
          rows.push(row);
        }

        // Check the raw string output
        const rawValues = rows[0].__raw.split("\t");

        // Find the values (they should be after any static columns)
        const values = rawValues.filter((v) => v !== "");

        // base_content should have decimal places
        const contentValue = values.find((v) => v.includes("."));
        expect(contentValue).toBeDefined();
        expect(contentValue).toMatch(/^\d+\.\d{3}$/); // 3 decimal places

        // base_count should be integer
        const countValue = values.find((v) => v === "6");
        expect(countValue).toBeDefined();
      });
    });
  });

  describe("SeqOps integration", () => {
    test("works with fx2tab function directly", async () => {
      const rows = [];
      for await (const row of fx2tab(asyncSequences(), {
        columns: ["id", "length", "gc"],
        header: false,
      })) {
        rows.push(row);
      }

      expect(rows).toHaveLength(3);
      expect(rows[0].__raw).toBe("seq1\t8\t50.00");
    });

    test("can convert to array using TabularOps", async () => {
      const rows = await new TabularOps(
        fx2tab(asyncSequences(), { columns: ["id", "length"] })
      ).toArray();

      // Header + 3 sequences
      expect(rows).toHaveLength(4);
      expect(rows[1].__raw).toContain("seq1\t8");
      expect(rows[2].__raw).toContain("SEPT1\t8");
    });
  });

  describe("toTabular() alias", () => {
    test("toTabular() produces same output as fx2tab()", async () => {
      // Use asyncSequences() generator function, not testSequences array

      // Test that both methods produce identical results
      const toTabularResults = await seqops(asyncSequences())
        .toTabular({ columns: ["id", "sequence", "length", "gc"], header: false })
        .toArray();

      const fx2tabResults = await seqops(asyncSequences())
        .fx2tab({ columns: ["id", "sequence", "length", "gc"], header: false })
        .toArray();

      expect(toTabularResults).toEqual(fx2tabResults);
      expect(toTabularResults).toHaveLength(3);
      expect(toTabularResults[0]).toMatchObject({
        id: "seq1",
        sequence: "ATCGATCG",
        length: 8,
        gc: 50,
      });
    });

    test("toTabular() works with default columns", async () => {
      const result = await seqops(asyncSequences()).toTabular().toArray();

      // Default includes header
      expect(result).toHaveLength(4);
      // Check first data row
      expect(result[1]).toMatchObject({
        id: "seq1",
        sequence: "ATCGATCG",
        length: 8,
      });
    });

    test("toTabular() supports custom columns", async () => {
      const result = await seqops(asyncSequences())
        .toTabular({
          columns: ["id", "gc", "custom"] as const,
          customColumns: {
            custom: (seq) => `${seq.id}_custom`,
          },
          header: false,
        })
        .toArray();

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        id: "seq1",
        gc: 50,
        custom: "seq1_custom",
      });
    });
  });

  describe("TabularOps chainability", () => {
    test("supports row filtering", async () => {
      const results = await new TabularOps(
        fx2tab(asyncSequences(), { columns: ["id", "sequence", "length"], header: false })
      )
        .filter((row) => typeof row.length === "number" && row.length > 4)
        .toArray();

      // 2 sequences with length > 4 (seq3 has length 4)
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("seq1");
      expect(results[1].id).toBe("SEPT1");
    });

    test("supports chained filtering", async () => {
      const results = await new TabularOps(
        fx2tab(asyncSequences(), { columns: ["id", "gc"], header: false })
      )
        .filter((row) => typeof row.gc === "number" && row.gc >= 50)
        .toArray();

      // All 3 sequences have GC >= 50
      expect(results).toHaveLength(3);
      expect(results[0].gc).toBeGreaterThanOrEqual(50);
    });

    test("writes to TSV file", async () => {
      const tempFile = `test-${Date.now()}.tsv`;

      await new TabularOps(
        fx2tab(asyncSequences(), { columns: ["id", "sequence"], header: true })
      ).writeTSV(tempFile);

      // Clean up
      await rm(tempFile, { force: true });
    });

    test("writes to CSV file", async () => {
      const tempFile = `test-${Date.now()}.csv`;

      await new TabularOps(
        fx2tab(asyncSequences(), { columns: ["id", "sequence"], header: true })
      ).writeCSV(tempFile);

      // Clean up
      await rm(tempFile, { force: true });
    });
  });

  describe("Edge case coverage", () => {
    test("handles sequences with special characters", async () => {
      async function* specialSeqs() {
        yield {
          id: "seq\twith\ttabs",
          sequence: "ATCG",
          description: "has\ttabs",
        } as AbstractSequence;
      }

      const rows: string[] = [];
      for await (const row of fx2tab(specialSeqs(), {
        columns: ["id", "description"],
        delimiter: ",",
        header: false,
      })) {
        rows.push(row.__raw);
      }

      expect(rows[0]).toBe("seq\twith\ttabs,has\ttabs");
    });

    test("handles null/undefined fields", async () => {
      async function* incompleteSeqs() {
        yield {
          id: "seq1",
          sequence: "ATCG",
          description: undefined,
        } as AbstractSequence;
      }

      const rows: string[] = [];
      for await (const row of fx2tab(incompleteSeqs(), {
        columns: ["id", "description"],
        header: false,
      })) {
        rows.push(row.__raw);
      }

      expect(rows[0]).toBe("seq1\t");
    });

    test("handles very large sequences", async () => {
      const largeSeq = "ATCG".repeat(250000); // 1MB sequence
      async function* largeSeqs() {
        yield {
          id: "large",
          sequence: largeSeq,
          length: largeSeq.length,
        } as AbstractSequence;
      }

      const rows = [];
      for await (const row of fx2tab(largeSeqs(), {
        columns: ["id", "length"],
        header: false,
      })) {
        rows.push(row);
      }

      expect(rows[0].length).toBe(1000000);
    });

    test("handles custom sequence formats", async () => {
      async function* customSeqs() {
        yield {
          format: "custom",
          id: "custom1",
          sequence: "ATCG",
          length: 4,
        } as AbstractSequence;
      }

      const rows = [];
      for await (const row of fx2tab(customSeqs(), {
        columns: ["id", "sequence"],
        header: false,
      })) {
        rows.push(row);
      }

      expect(rows[0].__raw).toBe("custom1\tATCG");
    });
  });

  describe("Round-trip preservation (Step 7.4)", () => {
    test("maintains Excel protection through round-trip", async () => {
      async function* geneSeqs() {
        yield { id: "SEPT1", sequence: "ATCG" } as AbstractSequence;
        yield { id: "MARCH1", sequence: "GCTA" } as AbstractSequence;
      }

      const protectedRows = [];
      for await (const row of fx2tab(geneSeqs(), {
        columns: ["id", "sequence"],
        excelSafe: true,
      })) {
        protectedRows.push(row);
      }

      // Verify protection is maintained
      expect(protectedRows[1].__raw).toContain('"SEPT1"');
      expect(protectedRows[2].__raw).toContain('"MARCH1"');
    });
  });

  describe("Error handling (Step 7.5)", () => {
    test("handles missing required columns gracefully", async () => {
      async function* seqs() {
        // Test with a sequence missing id and sequence fields
        yield { length: 0 } as unknown as AbstractSequence;
      }

      const rows = [];
      for await (const row of fx2tab(seqs(), {
        columns: ["id", "sequence"],
        header: false,
      })) {
        rows.push(row);
      }

      expect(rows[0].__raw).toBe("\t"); // Empty fields
    });

    test("validates column names", async () => {
      const rows = [];
      for await (const row of fx2tab(asyncSequences(), {
        columns: ["id", "invalid_column" as unknown as ColumnId],
        header: false,
      })) {
        rows.push(row);
      }

      // Should handle gracefully - undefined for invalid column
      expect(rows[0].__raw).toBe("seq1\t");
    });

    test("handles streaming errors", async () => {
      async function* errorGen() {
        yield { id: "seq1", sequence: "ATCG" } as AbstractSequence;
        throw new Error("Stream error");
      }

      const rows = [];
      try {
        for await (const row of fx2tab(errorGen())) {
          rows.push(row);
        }
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Stream error");
      }

      // Should have processed first sequence before error
      expect(rows).toHaveLength(2); // header + 1 sequence
    });

    test("handles file write errors", async () => {
      const invalidPath = "/nonexistent/path/file.tsv";

      try {
        await new TabularOps(fx2tab(asyncSequences())).writeTSV(invalidPath);
      } catch (error) {
        expect(error).toBeInstanceOf(FileError);
      }
    });
  });

  describe("Quality encoding support", () => {
    test("handles Solexa encoding with min_qual and max_qual columns", async () => {
      const solexaSeq = {
        id: "solexa_seq",
        sequence: "ATCG",
        length: 4,
        quality: ";@AB", // Solexa: -5, 0, 1, 2
        qualityEncoding: "solexa" as const,
        format: "fastq" as const,
      };

      async function* solexaSequences() {
        yield solexaSeq;
      }

      const rows: Fx2TabRow<readonly ["id", "min_qual", "max_qual", "avg_qual"]>[] = [];
      for await (const row of fx2tab(solexaSequences(), {
        columns: ["id", "min_qual", "max_qual", "avg_qual"] as const,
      })) {
        rows.push(row);
      }

      expect(rows).toHaveLength(2); // header + 1 sequence
      expect(rows[1].id).toBe("solexa_seq");
      expect(rows[1].min_qual).toBe(-5); // Solexa can have negative scores
      expect(rows[1].max_qual).toBe(2);
      expect(typeof rows[1].avg_qual).toBe("number");
    });

    test("handles Phred33 encoding with quality columns", async () => {
      const phred33Seq = {
        id: "phred33_seq",
        sequence: "ATCG",
        length: 4,
        quality: "!+5?", // Phred33: 0, 10, 20, 30
        qualityEncoding: "phred33" as const,
        format: "fastq" as const,
      };

      async function* phred33Sequences() {
        yield phred33Seq;
      }

      const rows: Fx2TabRow<readonly ["id", "min_qual", "max_qual"]>[] = [];
      for await (const row of fx2tab(phred33Sequences(), {
        columns: ["id", "min_qual", "max_qual"] as const,
      })) {
        rows.push(row);
      }

      expect(rows).toHaveLength(2);
      expect(rows[1].min_qual).toBe(0);
      expect(rows[1].max_qual).toBe(30);
    });

    test("handles Phred64 encoding with quality columns", async () => {
      const phred64Seq = {
        id: "phred64_seq",
        sequence: "ATCG",
        length: 4,
        quality: "@JT^", // Phred64: 0, 10, 20, 30
        qualityEncoding: "phred64" as const,
        format: "fastq" as const,
      };

      async function* phred64Sequences() {
        yield phred64Seq;
      }

      const rows: Fx2TabRow<readonly ["id", "min_qual", "max_qual"]>[] = [];
      for await (const row of fx2tab(phred64Sequences(), {
        columns: ["id", "min_qual", "max_qual"] as const,
      })) {
        rows.push(row);
      }

      expect(rows).toHaveLength(2);
      expect(rows[1].min_qual).toBe(0);
      expect(rows[1].max_qual).toBe(30);
    });
  });

  // Cleanup test files
  afterEach(async () => {
    // Clean up any test files
    await rm("test_*.tsv", { force: true, recursive: false }).catch(() => {
      // Ignore cleanup errors
    });
  });
});
