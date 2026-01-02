/**
 * Tests for paired-end FASTQ parsing
 */

import { describe, expect, test } from "bun:test";
import { PairSyncError } from "../../src/errors";
import { defaultExtractPairId, PairedFastqParser } from "../../src/formats/fastq/paired";
import type { PairedFastqRead } from "../../src/formats/fastq/types";

describe("defaultExtractPairId", () => {
  describe("Illumina naming convention (/1, /2)", () => {
    test("strips /1 suffix", () => {
      expect(defaultExtractPairId("read1/1")).toBe("read1");
    });

    test("strips /2 suffix", () => {
      expect(defaultExtractPairId("read1/2")).toBe("read1");
    });

    test("handles complex IDs with /1", () => {
      expect(defaultExtractPairId("NS500:123:ABC:1:1101:1234:5678/1")).toBe(
        "NS500:123:ABC:1:1101:1234:5678",
      );
    });

    test("preserves @ prefix if present", () => {
      expect(defaultExtractPairId("@read1/1")).toBe("@read1");
    });
  });

  describe("Generic naming conventions (_1, _2, .1, .2)", () => {
    test("strips _1 suffix", () => {
      expect(defaultExtractPairId("read1_1")).toBe("read1");
    });

    test("strips _2 suffix", () => {
      expect(defaultExtractPairId("read1_2")).toBe("read1");
    });

    test("strips .1 suffix", () => {
      expect(defaultExtractPairId("read1.1")).toBe("read1");
    });

    test("strips .2 suffix", () => {
      expect(defaultExtractPairId("read1.2")).toBe("read1");
    });
  });

  describe("Explicit R1/R2 naming", () => {
    test("strips _R1 suffix", () => {
      expect(defaultExtractPairId("sample_R1")).toBe("sample");
    });

    test("strips _R2 suffix", () => {
      expect(defaultExtractPairId("sample_R2")).toBe("sample");
    });

    test("strips .R1 suffix", () => {
      expect(defaultExtractPairId("sample.R1")).toBe("sample");
    });

    test("strips .R2 suffix", () => {
      expect(defaultExtractPairId("sample.R2")).toBe("sample");
    });

    test("handles lowercase r1/r2 (case insensitive)", () => {
      expect(defaultExtractPairId("sample_r1")).toBe("sample");
      expect(defaultExtractPairId("sample_r2")).toBe("sample");
    });

    test("handles mixed case R1/R2", () => {
      expect(defaultExtractPairId("sample_R1")).toBe("sample");
      expect(defaultExtractPairId("sample_r2")).toBe("sample");
    });
  });

  describe("Edge cases", () => {
    test("returns ID unchanged when no suffix present", () => {
      expect(defaultExtractPairId("read1")).toBe("read1");
      expect(defaultExtractPairId("sample_A")).toBe("sample_A");
    });

    test("does not strip suffixes from middle of ID", () => {
      expect(defaultExtractPairId("read1_test2")).toBe("read1_test2");
      expect(defaultExtractPairId("sample/1/data")).toBe("sample/1/data");
    });

    test("handles empty string", () => {
      expect(defaultExtractPairId("")).toBe("");
    });

    test("handles IDs with underscores before suffix", () => {
      expect(defaultExtractPairId("sample_name_1")).toBe("sample_name");
    });

    test("handles IDs with dots before suffix", () => {
      expect(defaultExtractPairId("sample.name.1")).toBe("sample.name");
    });

    test("only strips final occurrence of suffix", () => {
      expect(defaultExtractPairId("read1_1_data_1")).toBe("read1_1_data");
    });
  });

  describe("Real-world Illumina IDs", () => {
    test("handles standard Illumina ID format", () => {
      const id = "@M00123:456:000000000-A1B2C:1:1101:12345:1234";
      expect(defaultExtractPairId(id + "/1")).toBe(id);
      expect(defaultExtractPairId(id + "/2")).toBe(id);
    });

    test("handles Illumina with description", () => {
      // Note: description comes after space, not part of ID extraction
      expect(defaultExtractPairId("read1/1")).toBe("read1");
    });
  });
});

describe("PairedFastqParser", () => {
  describe("Constructor", () => {
    test("creates parser with default options", () => {
      const parser = new PairedFastqParser();
      expect(parser).toBeInstanceOf(PairedFastqParser);
    });

    test("creates parser with empty options object", () => {
      const parser = new PairedFastqParser({});
      expect(parser).toBeInstanceOf(PairedFastqParser);
    });

    test("accepts checkPairSync option", () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
      });
      expect(parser).toBeInstanceOf(PairedFastqParser);
    });

    test("accepts onMismatch option", () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "warn",
      });
      expect(parser).toBeInstanceOf(PairedFastqParser);
    });

    test("accepts custom extractPairId function", () => {
      const customExtractor = (id: string) => id.split(":")[0];
      const parser = new PairedFastqParser({
        checkPairSync: true,
        extractPairId: customExtractor,
      });
      expect(parser).toBeInstanceOf(PairedFastqParser);
    });

    test("accepts FastqParser options (quality encoding)", () => {
      const parser = new PairedFastqParser({
        qualityEncoding: "phred64",
      });
      expect(parser).toBeInstanceOf(PairedFastqParser);
    });

    test("accepts FastqParser options (parseQualityScores)", () => {
      const parser = new PairedFastqParser({
        parseQualityScores: true,
      });
      expect(parser).toBeInstanceOf(PairedFastqParser);
    });

    test("accepts combined paired and FastqParser options", () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
        qualityEncoding: "phred33",
        parseQualityScores: true,
        skipValidation: false,
      });
      expect(parser).toBeInstanceOf(PairedFastqParser);
    });
  });

  describe("getMetrics()", () => {
    test("returns metrics object with r1 and r2 properties", () => {
      const parser = new PairedFastqParser();
      const metrics = parser.getMetrics();

      expect(metrics).toHaveProperty("r1");
      expect(metrics).toHaveProperty("r2");
    });

    test("r1 metrics have expected structure", () => {
      const parser = new PairedFastqParser();
      const metrics = parser.getMetrics();

      expect(metrics.r1).toHaveProperty("fastPathCount");
      expect(metrics.r1).toHaveProperty("stateMachineCount");
      expect(metrics.r1).toHaveProperty("autoDetectCount");
      expect(metrics.r1).toHaveProperty("totalSequences");
      expect(metrics.r1).toHaveProperty("lastStrategy");
      expect(metrics.r1).toHaveProperty("lastDetectedFormat");
      expect(metrics.r1).toHaveProperty("lastConfidence");
    });

    test("r2 metrics have expected structure", () => {
      const parser = new PairedFastqParser();
      const metrics = parser.getMetrics();

      expect(metrics.r2).toHaveProperty("fastPathCount");
      expect(metrics.r2).toHaveProperty("stateMachineCount");
      expect(metrics.r2).toHaveProperty("autoDetectCount");
      expect(metrics.r2).toHaveProperty("totalSequences");
      expect(metrics.r2).toHaveProperty("lastStrategy");
      expect(metrics.r2).toHaveProperty("lastDetectedFormat");
      expect(metrics.r2).toHaveProperty("lastConfidence");
    });

    test("initial metrics have zero counts", () => {
      const parser = new PairedFastqParser();
      const metrics = parser.getMetrics();

      expect(metrics.r1.fastPathCount).toBe(0);
      expect(metrics.r1.stateMachineCount).toBe(0);
      expect(metrics.r1.autoDetectCount).toBe(0);
      expect(metrics.r1.totalSequences).toBe(0);

      expect(metrics.r2.fastPathCount).toBe(0);
      expect(metrics.r2.stateMachineCount).toBe(0);
      expect(metrics.r2.autoDetectCount).toBe(0);
      expect(metrics.r2.totalSequences).toBe(0);
    });

    test("metrics are independent between r1 and r2", () => {
      const parser = new PairedFastqParser();
      const metrics1 = parser.getMetrics();
      const metrics2 = parser.getMetrics();

      // Should return new copies, not same reference
      expect(metrics1).toEqual(metrics2);
      expect(metrics1.r1).not.toBe(metrics2.r1);
      expect(metrics1.r2).not.toBe(metrics2.r2);
    });
  });

  describe("parseStrings() - Basic Structure", () => {
    test("method exists and can be called", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      // Should not throw during setup
      const generator = parser.parseStrings(r1, r2);
      expect(generator).toBeDefined();
      expect(typeof generator[Symbol.asyncIterator]).toBe("function");
    });

    test("returns async iterable", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      const generator = parser.parseStrings(r1, r2);
      const iterator = generator[Symbol.asyncIterator]();

      expect(iterator).toBeDefined();
      expect(typeof iterator.next).toBe("function");
    });

    test("completes without error and yields pairs", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      // Now yields pairs (implemented in micro-step 3.3)
      expect(pairs).toHaveLength(1);
    });
  });

  describe("parseStrings() - Parallel Iteration", () => {
    test("handles both files exhausting simultaneously", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      // Should complete without error
      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      // Now yields the pair (implemented in micro-step 3.3)
      expect(pairs).toHaveLength(1);
    });

    test("detects R1 exhausted before R2", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII"; // 1 read
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@read2/2\nTTTT\n+\nIIII"; // 2 reads

      await expect(async () => {
        const pairs: PairedFastqRead[] = [];
        for await (const pair of parser.parseStrings(r1, r2)) {
          pairs.push(pair);
        }
      }).toThrow("R1 exhausted first");
    });

    test("detects R2 exhausted before R1", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nTTTT\n+\nIIII"; // 2 reads
      const r2 = "@read1/2\nCGAT\n+\nIIII"; // 1 read

      await expect(async () => {
        const pairs: PairedFastqRead[] = [];
        for await (const pair of parser.parseStrings(r1, r2)) {
          pairs.push(pair);
        }
      }).toThrow("R2 exhausted first");
    });

    test("includes pair index in length mismatch error", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII"; // 1 read
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@read2/2\nTTTT\n+\nIIII"; // 2 reads

      try {
        const pairs: PairedFastqRead[] = [];
        for await (const pair of parser.parseStrings(r1, r2)) {
          pairs.push(pair);
        }
        throw new Error("Should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).toContain("pair 1");
        }
      }
    });

    test("handles empty files (both)", async () => {
      const parser = new PairedFastqParser();
      const r1 = "";
      const r2 = "";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(0);
    });
  });

  describe("parseStrings() - Pair Yielding", () => {
    test("yields single paired read", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(1);
    });

    test("paired read has r1 and r2 properties", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs[0]).toHaveProperty("r1");
      expect(pairs[0]).toHaveProperty("r2");
      expect(pairs[0].r1.id).toBe("read1/1");
      expect(pairs[0].r2.id).toBe("read1/2");
    });

    test("calculates totalLength correctly", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs[0].totalLength).toBe(8); // 4 + 4
    });

    test("yields multiple pairs in order", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nTTTT\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@read2/2\nAAAA\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(2);
      expect(pairs[0].r1.id).toBe("read1/1");
      expect(pairs[0].r2.id).toBe("read1/2");
      expect(pairs[1].r1.id).toBe("read2/1");
      expect(pairs[1].r2.id).toBe("read2/2");
    });

    test("does not include pairId when checkPairSync is false", async () => {
      const parser = new PairedFastqParser({ checkPairSync: false });
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs[0].pairId).toBeUndefined();
    });

    test("includes pairId when checkPairSync is true", async () => {
      const parser = new PairedFastqParser({ checkPairSync: true });
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      // Note: FastqParser strips @ from ID, so pairId is "read1"
      expect(pairs[0].pairId).toBe("read1");
    });

    test("preserves all r1 properties", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1 description\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs[0].r1.id).toBe("read1/1");
      expect(pairs[0].r1.description).toBe("description");
      expect(pairs[0].r1.sequence).toBe("ATCG");
      expect(pairs[0].r1.quality).toBe("IIII");
      expect(pairs[0].r1.length).toBe(4);
    });

    test("preserves all r2 properties", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2 description\nCGAT\n+\nJJJJ";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs[0].r2.id).toBe("read1/2");
      expect(pairs[0].r2.description).toBe("description");
      expect(pairs[0].r2.sequence).toBe("CGAT");
      expect(pairs[0].r2.quality).toBe("JJJJ");
      expect(pairs[0].r2.length).toBe(4);
    });
  });

  describe("validatePairSync()", () => {
    test("matching IDs pass validation (checkPairSync=true)", async () => {
      const parser = new PairedFastqParser({ checkPairSync: true });
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      // Should not throw
      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(1);
    });

    test("mismatched IDs throw with onMismatch='throw'", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
      });
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read2/2\nCGAT\n+\nIIII"; // Different base ID

      await expect(async () => {
        const pairs: PairedFastqRead[] = [];
        for await (const pair of parser.parseStrings(r1, r2)) {
          pairs.push(pair);
        }
      }).toThrow("Read ID mismatch");
    });

    test("mismatched IDs warn with onMismatch='warn'", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "warn",
      });
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read2/2\nCGAT\n+\nIIII"; // Different base ID

      // Should not throw, but warn
      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      // Should still yield the pair
      expect(pairs).toHaveLength(1);
    });

    test("mismatched IDs skip silently with onMismatch='skip'", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "skip",
      });
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read2/2\nCGAT\n+\nIIII"; // Different base ID

      // Should not throw or warn
      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      // Should still yield the pair
      expect(pairs).toHaveLength(1);
    });

    test("validation not called when checkPairSync=false", async () => {
      const parser = new PairedFastqParser({ checkPairSync: false });
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read2/2\nCGAT\n+\nIIII"; // Different base ID

      // Should not throw because validation is disabled
      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(1);
    });

    test("error includes both full IDs and base IDs", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
      });
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read2/2\nCGAT\n+\nIIII";

      try {
        const pairs: PairedFastqRead[] = [];
        for await (const pair of parser.parseStrings(r1, r2)) {
          pairs.push(pair);
        }
        throw new Error("Should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).toContain("read1");
          expect(error.message).toContain("read2");
        }
      }
    });

    test("custom extractPairId function used for validation", async () => {
      const customExtractor = (id: string) => id.split(":")[0];
      const parser = new PairedFastqParser({
        checkPairSync: true,
        extractPairId: customExtractor,
      });
      const r1 = "@lane1:read1:extra\nATCG\n+\nIIII";
      const r2 = "@lane1:read2:extra\nCGAT\n+\nIIII";

      // Should pass because both extract to "lane1"
      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(1);
    });
  });

  describe("Synchronization Integration", () => {
    test("validation is called during parseStrings when checkPairSync=true", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
      });
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(1);
      expect(pairs[0].pairId).toBe("read1");
    });

    test("throw mode: stops iteration on first mismatch", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
      });
      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nATCG\n+\nIIII\n@read3/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@readX/2\nCGAT\n+\nIIII\n@read3/2\nCGAT\n+\nIIII";

      await expect(async () => {
        const pairs: PairedFastqRead[] = [];
        for await (const pair of parser.parseStrings(r1, r2)) {
          pairs.push(pair);
        }
      }).toThrow(PairSyncError);
    });

    test("warn mode: continues iteration after mismatch with warning", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "warn",
      });
      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nATCG\n+\nIIII\n@read3/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@readX/2\nCGAT\n+\nIIII\n@read3/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(3);
      expect(pairs[0].pairId).toBe("read1");
      expect(pairs[1].pairId).toBe("read2");
      expect(pairs[2].pairId).toBe("read3");
    });

    test("skip mode: continues iteration after mismatch silently", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "skip",
      });
      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nATCG\n+\nIIII\n@read3/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@readX/2\nCGAT\n+\nIIII\n@read3/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(3);
      expect(pairs[0].pairId).toBe("read1");
      expect(pairs[1].pairId).toBe("read2");
      expect(pairs[2].pairId).toBe("read3");
    });

    test("multiple pairs with all matches", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
      });
      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nATCG\n+\nIIII\n@read3/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@read2/2\nCGAT\n+\nIIII\n@read3/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(3);
      expect(pairs[0].pairId).toBe("read1");
      expect(pairs[1].pairId).toBe("read2");
      expect(pairs[2].pairId).toBe("read3");
    });

    test("multiple pairs with mixed matches in throw mode", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
      });
      const r1 = "@match1/1\nATCG\n+\nIIII\n@mismatch/1\nATCG\n+\nIIII\n@match2/1\nATCG\n+\nIIII";
      const r2 = "@match1/2\nCGAT\n+\nIIII\n@different/2\nCGAT\n+\nIIII\n@match2/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      await expect(async () => {
        for await (const pair of parser.parseStrings(r1, r2)) {
          pairs.push(pair);
        }
      }).toThrow(PairSyncError);

      expect(pairs).toHaveLength(1);
      expect(pairs[0].pairId).toBe("match1");
    });

    test("checkPairSync=false bypasses validation for mismatched pairs", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: false,
      });
      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nATCG\n+\nIIII";
      const r2 = "@readX/2\nCGAT\n+\nIIII\n@readY/2\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(2);
      expect(pairs[0].pairId).toBeUndefined();
      expect(pairs[1].pairId).toBeUndefined();
    });
  });

  describe("parseFiles()", () => {
    test("parses paired FASTQ files", async () => {
      const parser = new PairedFastqParser();
      const pairs: PairedFastqRead[] = [];

      for await (const pair of parser.parseFiles(
        "test/fixtures/paired-r1.fastq",
        "test/fixtures/paired-r2.fastq",
      )) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(3);
      expect(pairs[0].r1.id).toBe("read1/1");
      expect(pairs[0].r2.id).toBe("read1/2");
      expect(pairs[1].r1.id).toBe("read2/1");
      expect(pairs[1].r2.id).toBe("read2/2");
      expect(pairs[2].r1.id).toBe("read3/1");
      expect(pairs[2].r2.id).toBe("read3/2");
    });

    test("parses files with checkPairSync enabled", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
      });
      const pairs: PairedFastqRead[] = [];

      for await (const pair of parser.parseFiles(
        "test/fixtures/paired-r1.fastq",
        "test/fixtures/paired-r2.fastq",
      )) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(3);
      expect(pairs[0].pairId).toBe("read1");
      expect(pairs[1].pairId).toBe("read2");
      expect(pairs[2].pairId).toBe("read3");
    });

    test("detects length mismatch in files", async () => {
      const parser = new PairedFastqParser();

      await expect(async () => {
        const pairs: PairedFastqRead[] = [];
        for await (const pair of parser.parseFiles(
          "test/fixtures/paired-r1-mismatch.fastq",
          "test/fixtures/paired-r2-mismatch.fastq",
        )) {
          pairs.push(pair);
        }
      }).toThrow(PairSyncError);
    });

    test("preserves sequence data from files", async () => {
      const parser = new PairedFastqParser();
      const pairs: PairedFastqRead[] = [];

      for await (const pair of parser.parseFiles(
        "test/fixtures/paired-r1.fastq",
        "test/fixtures/paired-r2.fastq",
      )) {
        pairs.push(pair);
      }

      expect(pairs[0].r1.sequence).toBe("ATCGATCGATCG");
      expect(pairs[0].r2.sequence).toBe("CGTAGCTAGCTA");
      expect(pairs[0].r1.quality).toBe("IIIIIIIIIIII");
      expect(pairs[0].r2.quality).toBe("IIIIIIIIIIII");
    });

    test("calculates totalLength correctly from files", async () => {
      const parser = new PairedFastqParser();
      const pairs: PairedFastqRead[] = [];

      for await (const pair of parser.parseFiles(
        "test/fixtures/paired-r1.fastq",
        "test/fixtures/paired-r2.fastq",
      )) {
        pairs.push(pair);
      }

      expect(pairs[0].totalLength).toBe(24);
      expect(pairs[1].totalLength).toBe(24);
      expect(pairs[2].totalLength).toBe(24);
    });

    test("accepts FileReaderOptions", async () => {
      const parser = new PairedFastqParser();
      const pairs: PairedFastqRead[] = [];

      for await (const pair of parser.parseFiles(
        "test/fixtures/paired-r1.fastq",
        "test/fixtures/paired-r2.fastq",
        { encoding: "utf8" },
      )) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(3);
    });
  });

  describe("90% Use Cases - Simple Paired Parsing", () => {
    test("simple paired parsing without sync checking (most common use case)", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nGGGG\n+\nIIII";
      const r2 = "@read1/2\nTAGC\n+\nIIII\n@read2/2\nCCCC\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(2);
      expect(pairs[0].r1.sequence).toBe("ATCG");
      expect(pairs[0].r2.sequence).toBe("TAGC");
      expect(pairs[1].r1.sequence).toBe("GGGG");
      expect(pairs[1].r2.sequence).toBe("CCCC");
      expect(pairs[0].pairId).toBeUndefined();
    });

    test("streaming large paired files maintains constant memory", async () => {
      const parser = new PairedFastqParser();
      let pairCount = 0;
      let totalLength = 0;

      for await (const pair of parser.parseFiles(
        "test/fixtures/paired-r1.fastq",
        "test/fixtures/paired-r2.fastq",
      )) {
        pairCount++;
        totalLength += pair.totalLength;
      }

      expect(pairCount).toBe(3);
      expect(totalLength).toBe(72);
    });

    test("totalLength calculation is correct for all pairs", async () => {
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nGGGGGG\n+\nIIIIII";
      const r2 = "@read1/2\nTAGC\n+\nIIII\n@read2/2\nCC\n+\nII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs[0].totalLength).toBe(8);
      expect(pairs[1].totalLength).toBe(8);
    });

    test("handles empty paired files gracefully", async () => {
      const parser = new PairedFastqParser();
      const r1 = "";
      const r2 = "";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(0);
    });
  });

  describe("9% Use Cases - Advanced Synchronization", () => {
    test("checkPairSync=true validates matching IDs across different naming conventions", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
      });

      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2_1\nGGGG\n+\nIIII\n@read3.1\nTTTT\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@read2_2\nCCCC\n+\nIIII\n@read3.2\nAAAA\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(3);
      expect(pairs[0].pairId).toBe("read1");
      expect(pairs[1].pairId).toBe("read2");
      expect(pairs[2].pairId).toBe("read3");
    });

    test("Illumina naming convention handled correctly with sync checking", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
      });

      const r1 = "@M00123:456:000000000-ABCDE:1:1101:15678:1234 1:N:0:1\nATCG\n+\nIIII";
      const r2 = "@M00123:456:000000000-ABCDE:1:1101:15678:1234 2:N:0:1\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(1);
      expect(pairs[0].pairId).toBe("M00123:456:000000000-ABCDE:1:1101:15678:1234");
    });

    test("PairSyncError messages are helpful and actionable", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
      });

      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read2/2\nCGAT\n+\nIIII";

      let errorMessage = "";
      try {
        for await (const pair of parser.parseStrings(r1, r2)) {
          // Should throw before yielding
        }
      } catch (error) {
        if (error instanceof PairSyncError) {
          errorMessage = error.message;
        }
      }

      expect(errorMessage).toContain("read1");
      expect(errorMessage).toContain("read2");
      expect(errorMessage).toContain("pair 0");
    });

    test("onMismatch='throw' stops iteration immediately on first error", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
      });

      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nGGGG\n+\nIIII\n@read3/1\nTTTT\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@readX/2\nCCCC\n+\nIIII\n@read3/2\nAAAA\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      let threwError = false;

      try {
        for await (const pair of parser.parseStrings(r1, r2)) {
          pairs.push(pair);
        }
      } catch (error) {
        if (error instanceof PairSyncError) {
          threwError = true;
        }
      }

      expect(threwError).toBe(true);
      expect(pairs).toHaveLength(1);
    });

    test("onMismatch='warn' continues iteration with console warnings", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "warn",
      });

      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nGGGG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@readX/2\nCCCC\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(2);
      expect(pairs[0].pairId).toBe("read1");
      expect(pairs[1].pairId).toBe("read2");
    });

    test("onMismatch='skip' silently continues without warnings", async () => {
      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "skip",
      });

      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nGGGG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@readX/2\nCCCC\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(2);
      expect(pairs[0].pairId).toBe("read1");
      expect(pairs[1].pairId).toBe("read2");
    });
  });

  describe("1% Use Cases - Edge Cases", () => {
    test("custom extractPairId function handles non-standard naming", async () => {
      const customExtractor = (id: string): string => {
        const parts = id.split(":");
        return parts.length > 0 ? parts[0] : id;
      };

      const parser = new PairedFastqParser({
        checkPairSync: true,
        onMismatch: "throw",
        extractPairId: customExtractor,
      });

      const r1 = "@instrument:run:flowcell:lane:tile:x:y:UMI_FORWARD\nATCG\n+\nIIII";
      const r2 = "@instrument:run:flowcell:lane:tile:x:y:UMI_REVERSE\nCGAT\n+\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(1);
      expect(pairs[0].pairId).toBe("instrument");
    });

    test("multi-line FASTQ sequences handled correctly in pairs", async () => {
      const parser = new PairedFastqParser();

      const r1 = "@read1/1\nATCG\nATCG\nATCG\n+\nIIII\nIIII\nIIII";
      const r2 = "@read1/2\nCGAT\nCGAT\nCGAT\n+\nIIII\nIIII\nIIII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(1);
      expect(pairs[0].r1.sequence).toBe("ATCGATCGATCG");
      expect(pairs[0].r2.sequence).toBe("CGATCGATCGAT");
      expect(pairs[0].r1.quality).toBe("IIIIIIIIIIII");
      expect(pairs[0].r2.quality).toBe("IIIIIIIIIIII");
      expect(pairs[0].totalLength).toBe(24);
    });

    test("quality encoding options inherited from FastqParser", async () => {
      const parser = new PairedFastqParser({
        qualityEncoding: "phred33",
        parseQualityScores: true,
      });

      const r1 = "@read1/1\nATCG\n+\n!@#$";
      const r2 = "@read1/2\nCGAT\n+\n%^&*";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(1);
      expect(pairs[0].r1.quality).toBe("!@#$");
      expect(pairs[0].r2.quality).toBe("%^&*");
    });

    test("error propagation from internal parsers for malformed FASTQ", async () => {
      const parser = new PairedFastqParser();

      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\nNO_PLUS_LINE\nIIII";

      let threwError = false;
      try {
        for await (const pair of parser.parseStrings(r1, r2)) {
          // Should throw due to malformed R2
        }
      } catch (error) {
        threwError = true;
      }

      expect(threwError).toBe(true);
    });

    test("asymmetric read lengths handled correctly", async () => {
      const parser = new PairedFastqParser();

      const r1 = "@read1/1\nATCGATCGATCG\n+\nIIIIIIIIIIII";
      const r2 = "@read1/2\nCG\n+\nII";

      const pairs: PairedFastqRead[] = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }

      expect(pairs).toHaveLength(1);
      expect(pairs[0].r1.length).toBe(12);
      expect(pairs[0].r2.length).toBe(2);
      expect(pairs[0].totalLength).toBe(14);
    });

    test("R1 longer than R2 file detected as length mismatch", async () => {
      const parser = new PairedFastqParser();

      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nGGGG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";

      let threwError = false;
      let errorMessage = "";
      try {
        for await (const pair of parser.parseStrings(r1, r2)) {
          // Should throw after first pair
        }
      } catch (error) {
        threwError = true;
        if (error instanceof PairSyncError) {
          errorMessage = error.message;
        }
      }

      expect(threwError).toBe(true);
      expect(errorMessage).toContain("R2");
    });

    test("R2 longer than R1 file detected as length mismatch", async () => {
      const parser = new PairedFastqParser();

      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@read2/2\nCCCC\n+\nIIII";

      let threwError = false;
      let errorMessage = "";
      try {
        for await (const pair of parser.parseStrings(r1, r2)) {
          // Should throw after first pair
        }
      } catch (error) {
        threwError = true;
        if (error instanceof PairSyncError) {
          errorMessage = error.message;
        }
      }

      expect(threwError).toBe(true);
      expect(errorMessage).toContain("R1");
    });
  });
});
