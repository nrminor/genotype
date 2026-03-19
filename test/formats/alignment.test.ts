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
import { describe, expect, test } from "bun:test";
import { AlignmentParser } from "../../src/formats/alignment";
import type { AlignmentRecord } from "../../src/types";

const FIXTURES = join(process.cwd(), "test", "fixtures");
const SAM_PATH = join(FIXTURES, "valid-alignments.sam");
const BAM_PATH = join(FIXTURES, "valid-alignments.bam");

async function collectRecords(path: string): Promise<AlignmentRecord[]> {
  const parser = new AlignmentParser();
  const records: AlignmentRecord[] = [];
  for await (const record of parser.parseFile(path)) {
    records.push(record);
  }
  return records;
}

describe("AlignmentParser", () => {
  describe("SAM parsing", () => {
    test("should parse all records from SAM file", async () => {
      const records = await collectRecords(SAM_PATH);
      expect(records).toHaveLength(7);
    });

    test("should populate AbstractSequence fields correctly", async () => {
      const records = await collectRecords(SAM_PATH);
      const first = records[0]!;

      expect(first.id).toBe("read1");
      expect(first.sequence.toString()).toBe("ACGTACGTAC");
      expect(first.length).toBe(10);
      expect(first.format).toBe("sam");
    });

    test("should populate alignment-specific fields correctly", async () => {
      const records = await collectRecords(SAM_PATH);
      const first = records[0]!;

      expect(first.flag).toBe(99);
      expect(first.referenceSequence).toBe("chr1");
      expect(first.position).toBe(100);
      expect(first.mappingQuality).toBe(60);
      expect(first.cigar).toBe("10M");
    });

    test("should populate quality scores as Phred+33", async () => {
      const records = await collectRecords(SAM_PATH);
      const first = records[0]!;

      expect(first.quality.toString()).toBe("IIIIIIIIII");
      expect(first.qualityEncoding).toBe("phred33");
    });

    test("should handle unmapped reads", async () => {
      const records = await collectRecords(SAM_PATH);
      // read3 is the unmapped read (flag=4, rname=*, pos=0)
      const unmapped = records.find((r) => r.id === "read3");
      expect(unmapped).toBeDefined();
      expect(unmapped!.flag).toBe(4);
      expect(unmapped!.referenceSequence).toBe("*");
      expect(unmapped!.position).toBe(0);
      expect(unmapped!.cigar).toBe("*");
    });

    test("should handle soft-clipped reads", async () => {
      const records = await collectRecords(SAM_PATH);
      // read2 forward has CIGAR 8M2S
      const softClipped = records.find((r) => r.id === "read2" && r.flag === 99);
      expect(softClipped).toBeDefined();
      expect(softClipped!.cigar).toBe("8M2S");
    });

    test("should handle insertions in CIGAR", async () => {
      const records = await collectRecords(SAM_PATH);
      // read4 forward has CIGAR 5M1I4M
      const withInsertion = records.find((r) => r.id === "read4" && r.flag === 163);
      expect(withInsertion).toBeDefined();
      expect(withInsertion!.cigar).toBe("5M1I4M");
    });

    test("should parse reads from multiple references", async () => {
      const records = await collectRecords(SAM_PATH);
      const refs = new Set(records.map((r) => r.referenceSequence));
      expect(refs.has("chr1")).toBe(true);
      expect(refs.has("chr2")).toBe(true);
      expect(refs.has("*")).toBe(true);
    });

    test("should preserve different mapping qualities", async () => {
      const records = await collectRecords(SAM_PATH);
      const mapqs = new Set(records.map((r) => r.mappingQuality));
      expect(mapqs.has(60)).toBe(true);
      expect(mapqs.has(50)).toBe(true);
      expect(mapqs.has(30)).toBe(true);
      expect(mapqs.has(0)).toBe(true); // unmapped
    });
  });

  describe("BAM parsing", () => {
    test("should parse all records from BAM file", async () => {
      const records = await collectRecords(BAM_PATH);
      expect(records).toHaveLength(7);
    });

    test("should populate fields correctly from BAM", async () => {
      const records = await collectRecords(BAM_PATH);
      const first = records[0]!;

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
    test("SAM and BAM should produce identical record content", async () => {
      const samRecords = await collectRecords(SAM_PATH);
      const bamRecords = await collectRecords(BAM_PATH);

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

    test("only the format field should differ between SAM and BAM records", async () => {
      const samRecords = await collectRecords(SAM_PATH);
      const bamRecords = await collectRecords(BAM_PATH);

      for (let i = 0; i < samRecords.length; i++) {
        expect(samRecords[i]!.format).toBe("sam");
        expect(bamRecords[i]!.format).toBe("bam");
      }
    });
  });

  describe("error handling", () => {
    test("should throw for nonexistent file", async () => {
      const parser = new AlignmentParser();
      await expect(async () => {
        for await (const _record of parser.parseFile("/nonexistent/path.bam")) {
          // should not reach here
        }
      }).toThrow();
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
  });

  describe("pipeline integration", () => {
    test("AlignmentRecord should work with seqops-style iteration", async () => {
      const records = await collectRecords(SAM_PATH);

      // Filter to mapped reads only (flag & 4 === 0)
      const mapped = records.filter((r) => (r.flag & 4) === 0);
      expect(mapped.length).toBe(6); // 7 total minus 1 unmapped

      // All mapped reads should have a reference sequence
      for (const r of mapped) {
        expect(r.referenceSequence).not.toBe("*");
        expect(r.position).toBeGreaterThan(0);
      }
    });

    test("AlignmentRecord has all AbstractSequence fields", async () => {
      const records = await collectRecords(SAM_PATH);
      const record = records[0]!;

      // These are the AbstractSequence contract fields
      expect(typeof record.id).toBe("string");
      expect(record.sequence).toBeDefined();
      expect(typeof record.length).toBe("number");
      expect(record.lineNumber).toBeDefined();
    });

    test("AlignmentRecord has QualityScoreBearing fields", async () => {
      const records = await collectRecords(SAM_PATH);
      const record = records[0]!;

      expect(record.quality).toBeDefined();
      expect(record.qualityEncoding).toBe("phred33");
    });
  });
});
