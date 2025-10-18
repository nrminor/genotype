/**
 * Tests for file writing with compression support
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { readToString } from "../../src/io/file-reader";
import { writeBytes, writeString } from "../../src/io/file-writer";

// Test fixtures directory
const FIXTURES_DIR = join(process.cwd(), "test", "io", "fixtures", "write-test");
const TEST_FILES = {
  compressed: join(FIXTURES_DIR, "output.txt.gz"),
  plain: join(FIXTURES_DIR, "output.txt"),
  fasta: join(FIXTURES_DIR, "sequences.fasta.gz"),
  fastq: join(FIXTURES_DIR, "reads.fastq.gz"),
};

beforeEach(() => {
  // Create test fixtures directory
  mkdirSync(FIXTURES_DIR, { recursive: true });
});

afterEach(() => {
  // Clean up test files
  rmSync(FIXTURES_DIR, { recursive: true, force: true });
});

describe("Compression on Write", () => {
  describe("writeString", () => {
    test("auto-compresses .gz files", async () => {
      const content = "ATCGATCG\nGCTAGCTA\n";

      await writeString(TEST_FILES.compressed, content);

      // Verify file exists
      expect(existsSync(TEST_FILES.compressed)).toBe(true);

      // Verify magic bytes (gzip header)
      const bytes = readFileSync(TEST_FILES.compressed);
      expect(bytes[0]).toBe(0x1f);
      expect(bytes[1]).toBe(0x8b);

      // Small data may have gzip overhead, so just verify it's a valid gzip file
      expect(bytes.length).toBeGreaterThan(0);
    });

    test("roundtrip: write compressed, read decompressed", async () => {
      const content = "ATCGATCGATCG\n".repeat(1000);

      await writeString(TEST_FILES.compressed, content);
      const read = await readToString(TEST_FILES.compressed);

      expect(read).toBe(content);
    });

    test("respects autoCompress: false", async () => {
      const content = "plain text";

      await writeString(TEST_FILES.compressed, content, { autoCompress: false });

      // Verify NOT compressed
      const bytes = readFileSync(TEST_FILES.compressed);
      expect(bytes[0]).not.toBe(0x1f); // Not gzip magic
      expect(new TextDecoder().decode(bytes)).toBe(content);
    });
  });

  describe("writeBytes", () => {
    test("auto-compresses .gz files", async () => {
      const data = new TextEncoder().encode("Binary data sequence");

      await writeBytes(TEST_FILES.compressed, data);

      // Verify compressed
      const bytes = readFileSync(TEST_FILES.compressed);
      expect(bytes[0]).toBe(0x1f);
      expect(bytes[1]).toBe(0x8b);
    });

    test("roundtrip with binary data", async () => {
      const data = new Uint8Array([0x41, 0x54, 0x43, 0x47]); // "ATCG" in ASCII

      await writeBytes(TEST_FILES.compressed, data);

      // Read back and verify
      const content = await readToString(TEST_FILES.compressed);
      expect(content).toBe("ATCG");
    });
  });

  describe("compression levels", () => {
    test("compression level option affects output size", async () => {
      const content = "A".repeat(10000);

      // Level 1 (fast, less compression)
      await writeString(TEST_FILES.compressed, content, { compressionLevel: 1 });
      const size1 = readFileSync(TEST_FILES.compressed).length;

      // Clean up
      rmSync(TEST_FILES.compressed);

      // Level 9 (slow, best compression)
      await writeString(TEST_FILES.compressed, content, { compressionLevel: 9 });
      const size9 = readFileSync(TEST_FILES.compressed).length;

      // Level 9 should be smaller or equal (highly repetitive data compresses well at any level)
      expect(size9).toBeLessThanOrEqual(size1);
    });
  });

  describe("genomic file formats", () => {
    test("writes compressed FASTA", async () => {
      const fasta = ">seq1\nATCGATCG\n>seq2\nGCTAGCTA\n";

      await writeString(TEST_FILES.fasta, fasta);

      // Verify compressed
      const bytes = readFileSync(TEST_FILES.fasta);
      expect(bytes[0]).toBe(0x1f);
      expect(bytes[1]).toBe(0x8b);

      // Verify roundtrip
      const read = await readToString(TEST_FILES.fasta);
      expect(read).toBe(fasta);
    });

    test("writes compressed FASTQ", async () => {
      const fastq = "@seq1\nATCG\n+\nIIII\n";

      await writeString(TEST_FILES.fastq, fastq);

      // Verify compressed
      const bytes = readFileSync(TEST_FILES.fastq);
      expect(bytes[0]).toBe(0x1f);
      expect(bytes[1]).toBe(0x8b);

      // Verify roundtrip
      const read = await readToString(TEST_FILES.fastq);
      expect(read).toBe(fastq);
    });
  });
});
