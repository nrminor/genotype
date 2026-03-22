/**
 * Tests for the noodles-backed AlignmentParser.
 *
 * Uses valid-alignments.sam and valid-alignments.bam fixtures that
 * contain 7 alignment records: 3 paired-end read pairs on chr1 and
 * chr2, plus one unmapped read. The fixtures were generated with
 * samtools and include soft clips, insertions, and varying mapping
 * qualities.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { beforeAll, describe, expect, test } from "bun:test";
import { AlignmentParser } from "@genotype/core/formats/alignment";
import type { AlignmentRecord } from "@genotype/core/types";

const FIXTURES = join(process.cwd(), "test", "fixtures");
const SAM_PATH = join(FIXTURES, "valid-alignments.sam");
const BAM_PATH = join(FIXTURES, "valid-alignments.bam");
const HEADERS_ONLY_PATH = join(FIXTURES, "sample-headers.sam");

async function collectRecords(path: string): Promise<AlignmentRecord[]> {
  const parser = new AlignmentParser();
  const records: AlignmentRecord[] = [];
  for await (const record of parser.parseFile(path)) {
    records.push(record);
  }
  return records;
}

describe("AlignmentParser", () => {
  // Parse fixtures once and share across tests within each describe block.
  let samRecords: AlignmentRecord[];
  let bamRecords: AlignmentRecord[];

  beforeAll(async () => {
    samRecords = await collectRecords(SAM_PATH);
    bamRecords = await collectRecords(BAM_PATH);
  });

  describe("SAM parsing", () => {
    test("should parse all records from SAM file", () => {
      expect(samRecords).toHaveLength(7);
    });

    test("should populate AbstractSequence fields correctly", () => {
      const first = samRecords[0]!;

      expect(first.id).toBe("read1");
      expect(first.sequence.toString()).toBe("ACGTACGTAC");
      expect(first.length).toBe(10);
      expect(first.format).toBe("sam");
    });

    test("should populate alignment-specific fields correctly", () => {
      const first = samRecords[0]!;

      expect(first.flag).toBe(99);
      expect(first.referenceSequence).toBe("chr1");
      expect(first.position).toBe(100);
      expect(first.mappingQuality).toBe(60);
      expect(first.cigar).toBe("10M");
    });

    test("should populate quality scores as Phred+33", () => {
      const first = samRecords[0]!;

      expect(first.quality.toString()).toBe("IIIIIIIIII");
      expect(first.qualityEncoding).toBe("phred33");
    });

    test("should handle unmapped reads", () => {
      const unmapped = samRecords.find((r) => r.id === "read3");
      expect(unmapped).toBeDefined();
      expect(unmapped!.flag).toBe(4);
      expect(unmapped!.referenceSequence).toBe("*");
      expect(unmapped!.position).toBe(0);
      expect(unmapped!.cigar).toBe("*");
    });

    test("should handle soft-clipped reads", () => {
      const softClipped = samRecords.find((r) => r.id === "read2" && r.flag === 99);
      expect(softClipped).toBeDefined();
      expect(softClipped!.cigar).toBe("8M2S");
    });

    test("should handle insertions in CIGAR", () => {
      const withInsertion = samRecords.find((r) => r.id === "read4" && r.flag === 163);
      expect(withInsertion).toBeDefined();
      expect(withInsertion!.cigar).toBe("5M1I4M");
    });

    test("should parse reads from multiple references", () => {
      const refs = new Set(samRecords.map((r) => r.referenceSequence));
      expect(refs.has("chr1")).toBe(true);
      expect(refs.has("chr2")).toBe(true);
      expect(refs.has("*")).toBe(true);
    });

    test("should preserve different mapping qualities", () => {
      const mapqs = new Set(samRecords.map((r) => r.mappingQuality));
      expect(mapqs.has(60)).toBe(true);
      expect(mapqs.has(50)).toBe(true);
      expect(mapqs.has(30)).toBe(true);
      expect(mapqs.has(0)).toBe(true);
    });
  });

  describe("BAM parsing", () => {
    test("should parse all records from BAM file", () => {
      expect(bamRecords).toHaveLength(7);
    });

    test("should populate fields correctly from BAM", () => {
      const first = bamRecords[0]!;

      expect(first.id).toBe("read1");
      expect(first.sequence.toString()).toBe("ACGTACGTAC");
      expect(first.length).toBe(10);
      expect(first.format).toBe("bam");
      expect(first.flag).toBe(99);
      expect(first.referenceSequence).toBe("chr1");
      expect(first.position).toBe(100);
      expect(first.mappingQuality).toBe(60);
      expect(first.cigar).toBe("10M");
      expect(first.quality.toString()).toBe("IIIIIIIIII");
    });
  });

  describe("cross-format consistency", () => {
    test("SAM and BAM should produce identical record content", () => {
      expect(samRecords).toHaveLength(bamRecords.length);

      for (let i = 0; i < samRecords.length; i++) {
        const sam = samRecords[i]!;
        const bam = bamRecords[i]!;

        expect(bam.id).toBe(sam.id);
        expect(bam.sequence.toString()).toBe(sam.sequence.toString());
        expect(bam.quality.toString()).toBe(sam.quality.toString());
        expect(bam.flag).toBe(sam.flag);
        expect(bam.referenceSequence).toBe(sam.referenceSequence);
        expect(bam.position).toBe(sam.position);
        expect(bam.mappingQuality).toBe(sam.mappingQuality);
        expect(bam.cigar).toBe(sam.cigar);
        expect(bam.length).toBe(sam.length);
      }
    });

    test("only the format field should differ between SAM and BAM records", () => {
      for (let i = 0; i < samRecords.length; i++) {
        expect(samRecords[i]!.format).toBe("sam");
        expect(bamRecords[i]!.format).toBe("bam");
      }
    });
  });

  describe("edge cases", () => {
    test("should throw for nonexistent file", async () => {
      const parser = new AlignmentParser();
      await expect(async () => {
        for await (const _record of parser.parseFile("/nonexistent/path.bam")) {
          // should not reach here
        }
      }).toThrow();
    });

    test("should produce zero records for a headers-only SAM file", async () => {
      const records = await collectRecords(HEADERS_ONLY_PATH);
      expect(records).toHaveLength(0);
    });
  });

  describe("parseString", () => {
    test("should parse SAM text from a string", async () => {
      const samText = readFileSync(SAM_PATH, "utf8");

      const parser = new AlignmentParser();
      const records: AlignmentRecord[] = [];
      for await (const record of parser.parseString(samText)) {
        records.push(record);
      }

      expect(records).toHaveLength(7);
      expect(records[0]!.id).toBe("read1");
      expect(records[0]!.sequence.toString()).toBe("ACGTACGTAC");
    });
  });

  describe("parse (stream)", () => {
    test("should parse SAM data from a ReadableStream", async () => {
      const samBytes = readFileSync(SAM_PATH);

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(samBytes));
          controller.close();
        },
      });

      const parser = new AlignmentParser();
      const records: AlignmentRecord[] = [];
      for await (const record of parser.parse(stream)) {
        records.push(record);
      }

      expect(records).toHaveLength(7);
      expect(records[0]!.id).toBe("read1");
    });

    test("should parse BAM binary data from a ReadableStream", async () => {
      const bamBytes = readFileSync(BAM_PATH);

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(bamBytes));
          controller.close();
        },
      });

      const parser = new AlignmentParser();
      const records: AlignmentRecord[] = [];
      for await (const record of parser.parse(stream)) {
        records.push(record);
      }

      expect(records).toHaveLength(7);
      expect(records[0]!.id).toBe("read1");
      expect(records[0]!.format).toBe("bam");
    });
  });

  describe("batch boundaries", () => {
    test("should handle more records than a single batch", async () => {
      // Generate a SAM string with 5000 records (exceeds the 4096 batch size).
      const header = "@HD\tVN:1.6\n@SQ\tSN:chr1\tLN:100000\n";
      const lines: string[] = [];
      for (let i = 0; i < 5000; i++) {
        lines.push(`read${i}\t0\tchr1\t${i + 1}\t60\t4M\t*\t0\t0\tACGT\tIIII`);
      }
      const samText = header + lines.join("\n") + "\n";

      const parser = new AlignmentParser();
      const records: AlignmentRecord[] = [];
      for await (const record of parser.parseString(samText)) {
        records.push(record);
      }

      expect(records).toHaveLength(5000);
      expect(records[0]!.id).toBe("read0");
      expect(records[4999]!.id).toBe("read4999");
      expect(records[4999]!.position).toBe(5000);
    });
  });

  describe("pipeline integration", () => {
    test("AlignmentRecord should work with seqops-style iteration", () => {
      const mapped = samRecords.filter((r) => (r.flag & 4) === 0);
      expect(mapped.length).toBe(6);

      for (const r of mapped) {
        expect(r.referenceSequence).not.toBe("*");
        expect(r.position).toBeGreaterThan(0);
      }
    });

    test("AlignmentRecord has all AbstractSequence fields", () => {
      const record = samRecords[0]!;

      expect(typeof record.id).toBe("string");
      expect(record.sequence).toBeDefined();
      expect(typeof record.length).toBe("number");
      expect(record.lineNumber).toBeDefined();
    });

    test("AlignmentRecord has QualityScoreBearing fields", () => {
      const record = samRecords[0]!;

      expect(record.quality).toBeDefined();
      expect(record.qualityEncoding).toBe("phred33");
    });
  });
});
