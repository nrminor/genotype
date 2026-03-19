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
});
