/**
 * Integration tests verifying that AlignmentRecord flows through
 * real seqops() chains end-to-end.
 *
 * These tests exercise both format-agnostic operations (grep, filter,
 * unique, transform, stats) and quality-aware operations (quality
 * trimming, quality filtering) on alignment records parsed from the
 * valid-alignments.sam fixture.
 */

import { join } from "path";
import { beforeAll, describe, expect, test } from "bun:test";
import { createFastaRecord } from "../../src/constructors";
import { AlignmentParser } from "../../src/formats/alignment";
import { seqops } from "../../src/operations";
import type { AlignmentRecord } from "../../src/types";

const SAM_PATH = join(process.cwd(), "test", "fixtures", "valid-alignments.sam");

async function* makeAsync<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

describe("SeqOps alignment integration", () => {
  let records: AlignmentRecord[];

  beforeAll(async () => {
    const parser = new AlignmentParser();
    records = [];
    for await (const record of parser.parseFile(SAM_PATH)) {
      records.push(record);
    }
  });

  describe("format-agnostic operations", () => {
    test("grep filters alignment records by sequence content", async () => {
      const results = await seqops(makeAsync(records)).grep("ACGT").collect();

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.sequence.toString()).toContain("ACGT");
      }
    });

    test("filter by minimum length", async () => {
      const results = await seqops(makeAsync(records)).filter({ minLength: 10 }).collect();

      expect(results.length).toBe(7);
      for (const r of results) {
        expect(r.length).toBeGreaterThanOrEqual(10);
      }
    });

    test("unique deduplicates by sequence content", async () => {
      // Our fixture has some reads with identical sequences (e.g. read1 reverse and read4 reverse
      // both have TGCATGCATG). Dedup by sequence should reduce the count.
      const allSeqs = records.map((r) => r.sequence.toString());
      const uniqueSeqs = new Set(allSeqs);

      const results = await seqops(makeAsync(records)).unique({ by: "sequence" }).collect();

      expect(results.length).toBe(uniqueSeqs.size);
    });

    test("transform reverse-complements alignment records", async () => {
      const results = await seqops(makeAsync(records.slice(0, 1)))
        .transform({ reverseComplement: true })
        .collect();

      expect(results).toHaveLength(1);
      // ACGTACGTAC reverse complement is GTACGTACGT
      expect(results[0]!.sequence.toString()).toBe("GTACGTACGT");
    });

    test("stats computes statistics on alignment records", async () => {
      const stats = await seqops(makeAsync(records)).stats();

      expect(stats.numSequences).toBe(7);
      expect(stats.totalLength).toBeGreaterThan(0);
      expect(stats.avgLength).toBe(10);
    });

    test("chained operations: filter then unique", async () => {
      const results = await seqops(makeAsync(records))
        .filter({ minLength: 10 })
        .unique({ by: "sequence" })
        .collect();

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(7);
    });
  });

  describe("quality-aware operations", () => {
    test("quality filtering by minimum score", async () => {
      // All our fixture records have high quality (I = Phred 40, H = Phred 39,
      // J = Phred 41). A threshold of 30 should keep all mapped reads.
      // The unmapped read has ! quality (Phred 0) and should be filtered out.
      const results = await seqops(makeAsync(records)).quality({ minScore: 30 }).collect();

      // The unmapped read (read3) has ! quality (Phred 0), should be filtered
      const unmapped = results.find((r) => (r as AlignmentRecord).flag === 4);
      expect(unmapped).toBeUndefined();
    });

    test("quality trimming works on alignment records", async () => {
      const results = await seqops(makeAsync(records))
        .quality({ trim: true, trimThreshold: 20 })
        .collect();

      // All our fixture records have uniformly high quality, so trimming
      // shouldn't change their lengths (no low-quality tails to trim).
      // The unmapped read with ! quality should be trimmed to nothing and removed.
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.length).toBeGreaterThan(0);
      }
    });

    test("quality stats include quality encoding for alignment records", async () => {
      const stats = await seqops(makeAsync(records)).stats({ includeQuality: true });

      expect(stats.numSequences).toBe(7);
      // Quality encoding should be detected since alignment records have quality scores
      expect(stats.qualityEncoding).toBeDefined();
    });
  });

  describe("multi-step pipelines", () => {
    test("filter unmapped → grep → unique → collect", async () => {
      // Filter to mapped reads, grep for a pattern, deduplicate
      const results = await seqops(makeAsync(records))
        .filter({ minLength: 1 })
        .grep("ACGT")
        .unique({ by: "sequence" })
        .collect();

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.sequence.toString()).toContain("ACGT");
      }
    });

    test("quality trim → filter → stats", async () => {
      const stats = await seqops(makeAsync(records))
        .quality({ trim: true, trimThreshold: 20 })
        .filter({ minLength: 5 })
        .stats();

      expect(stats.numSequences).toBeGreaterThan(0);
      expect(stats.avgLength).toBeGreaterThan(0);
    });

    test("alignment records preserve alignment fields through pipeline", async () => {
      const results = await seqops(makeAsync(records)).filter({ minLength: 10 }).collect();

      for (const r of results) {
        const alignment = r as AlignmentRecord;
        expect(typeof alignment.flag).toBe("number");
        expect(typeof alignment.referenceSequence).toBe("string");
        expect(typeof alignment.position).toBe("number");
        expect(typeof alignment.mappingQuality).toBe("number");
        expect(typeof alignment.cigar).toBe("string");
      }
    });
  });

  describe("parseFile directly into seqops", () => {
    test("parser output feeds directly into seqops chain", async () => {
      const parser = new AlignmentParser();
      const results = await seqops(parser.parseFile(SAM_PATH))
        .filter({ minLength: 10 })
        .unique({ by: "sequence" })
        .collect();

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("alignment-specific filter options", () => {
    test("filter by minimum mapping quality", async () => {
      const results = await seqops(makeAsync(records)).filter({ minMapQ: 50 }).collect();

      // mapQ 60: read1 pair (2), mapQ 50: read2 pair (2), mapQ 30: read4 pair (2), mapQ 0: read3 (1)
      // minMapQ 50 keeps mapQ >= 50: read1 pair + read2 pair = 4
      expect(results).toHaveLength(4);
      for (const r of results) {
        expect((r as AlignmentRecord).mappingQuality).toBeGreaterThanOrEqual(50);
      }
    });

    test("filter by maximum mapping quality", async () => {
      const results = await seqops(makeAsync(records)).filter({ maxMapQ: 50 }).collect();

      // mapQ <= 50: read2 pair (2) + read4 pair (2) + read3 (1) = 5
      expect(results).toHaveLength(5);
      for (const r of results) {
        expect((r as AlignmentRecord).mappingQuality).toBeLessThanOrEqual(50);
      }
    });

    test("filter by excludeFlags removes unmapped reads", async () => {
      const results = await seqops(makeAsync(records)).filter({ excludeFlags: 0x4 }).collect();

      // 7 total - 1 unmapped = 6
      expect(results).toHaveLength(6);
      for (const r of results) {
        expect((r as AlignmentRecord).flag & 0x4).toBe(0);
      }
    });

    test("filter by includeFlags keeps only first-in-pair reads", async () => {
      const results = await seqops(makeAsync(records)).filter({ includeFlags: 0x40 }).collect();

      // First-in-pair (0x40): read1 fwd (99), read2 fwd (99), read4 rev (83) = 3
      expect(results).toHaveLength(3);
      for (const r of results) {
        expect((r as AlignmentRecord).flag & 0x40).toBe(0x40);
      }
    });

    test("filter by reference sequence", async () => {
      const results = await seqops(makeAsync(records))
        .filter({ referenceSequence: "chr2" })
        .collect();

      // chr2: read4 pair = 2
      expect(results).toHaveLength(2);
      for (const r of results) {
        expect((r as AlignmentRecord).referenceSequence).toBe("chr2");
      }
    });

    test("filter by genomic region", async () => {
      const results = await seqops(makeAsync(records)).filter({ region: "chr1:150-350" }).collect();

      // chr1 reads with positions overlapping 150-350:
      // read1 fwd: pos=100, len=10, end=109 — does NOT overlap 150-350
      // read1 rev: pos=200, len=10, end=209 — overlaps
      // read2 fwd: pos=300, len=10, end=309 — overlaps
      // read2 rev: pos=400, len=10, end=409 — does NOT overlap
      expect(results).toHaveLength(2);
    });

    test("combine alignment filters with generic filters", async () => {
      const results = await seqops(makeAsync(records))
        .filter({ minLength: 10, minMapQ: 30, excludeFlags: 0x4 })
        .collect();

      // All mapped reads have length 10 and mapQ >= 30: 6 mapped reads
      expect(results).toHaveLength(6);
    });

    test("alignment filters are rejected by the type system for non-alignment records", () => {
      const fastaRecords = [
        createFastaRecord({ id: "seq1", sequence: "ACGT" }),
        createFastaRecord({ id: "seq2", sequence: "GGCC" }),
      ];

      // @ts-expect-error Alignment-specific filter options require AlignmentRecord streams
      void seqops(makeAsync(fastaRecords)).filter({ minMapQ: 30 });

      // Generic filters remain available on non-alignment records
      void seqops(makeAsync(fastaRecords)).filter({ minLength: 4 });
    });
  });

  describe("alignment-specific transform options", () => {
    test("trimSoftClips removes trailing soft clips", async () => {
      // read2 forward has CIGAR 8M2S — 2 trailing soft-clipped bases
      const read2fwd = records.find((r) => r.id === "read2" && r.flag === 99)!;

      const results = await seqops(makeAsync([read2fwd]))
        .transform({ trimSoftClips: true })
        .collect();

      expect(results).toHaveLength(1);
      const trimmed = results[0]!;
      // Original: GGCCTTAAGG (10bp), after trimming 2S from end: GGCCTTAA (8bp)
      expect(trimmed.sequence.toString()).toBe("GGCCTTAA");
      expect(trimmed.length).toBe(8);
      // Quality should also be trimmed
      expect((trimmed as AlignmentRecord).quality.toString()).toBe("HHHHHHHH");
      // CIGAR should be updated
      expect((trimmed as AlignmentRecord).cigar).toBe("8M");
    });

    test("trimSoftClips leaves reads without soft clips unchanged", async () => {
      // read1 forward has CIGAR 10M — no soft clips
      const read1fwd = records.find((r) => r.id === "read1" && r.flag === 99)!;

      const results = await seqops(makeAsync([read1fwd]))
        .transform({ trimSoftClips: true })
        .collect();

      expect(results).toHaveLength(1);
      expect(results[0]!.sequence.toString()).toBe("ACGTACGTAC");
      expect(results[0]!.length).toBe(10);
    });

    test("trimSoftClips leaves unmapped reads unchanged", async () => {
      const unmapped = records.find((r) => r.flag === 4)!;

      const results = await seqops(makeAsync([unmapped]))
        .transform({ trimSoftClips: true })
        .collect();

      expect(results).toHaveLength(1);
      expect(results[0]!.sequence.toString()).toBe("NNNNNNNNNN");
    });

    test("trimSoftClips combined with other transforms", async () => {
      const read2fwd = records.find((r) => r.id === "read2" && r.flag === 99)!;

      const results = await seqops(makeAsync([read2fwd]))
        .transform({ trimSoftClips: true, upperCase: true })
        .collect();

      expect(results).toHaveLength(1);
      expect(results[0]!.sequence.toString()).toBe("GGCCTTAA");
    });

    test("alignment-specific transform options are rejected by the type system for non-alignment records", () => {
      const fastaRecords = [createFastaRecord({ id: "seq1", sequence: "ACGT" })];

      // @ts-expect-error Alignment-specific transform options require AlignmentRecord streams
      void seqops(makeAsync(fastaRecords)).transform({ trimSoftClips: true });

      // Generic transforms remain available on non-alignment records
      void seqops(makeAsync(fastaRecords)).transform({ upperCase: true });
    });
  });
});
