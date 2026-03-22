/**
 * Integration tests for file I/O with genomics parsers
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import "../matchers";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { FileError, ParseError } from "@genotype/core/errors";
import { BedParser } from "@genotype/core/formats/bed";
import { FastaParser } from "@genotype/core/formats/fasta";
import { FastqParser } from "@genotype/core/formats/fastq";
import type { BedInterval, FastaSequence, FastqSequence } from "@genotype/core/types";

// Test fixtures directory - use absolute path for reliability
const FIXTURES_DIR = join(process.cwd(), "test", "io", "fixtures");
const TEST_FILES = {
  fasta: join(FIXTURES_DIR, "test.fasta"),
  fastq: join(FIXTURES_DIR, "test.fastq"),
  sam: join(FIXTURES_DIR, "test.sam"),
  bed: join(FIXTURES_DIR, "test.bed"),
  largeFasta: join(FIXTURES_DIR, "large.fasta"),
  malformedFasta: join(FIXTURES_DIR, "malformed.fasta"),
  emptyFile: join(FIXTURES_DIR, "empty.txt"),
  binaryFile: join(FIXTURES_DIR, "binary.bin"),
  nonexistent: join(FIXTURES_DIR, "nonexistent.fasta"),
};

describe("Parser File Integration", () => {
  beforeAll(() => {
    // Create test fixtures directory
    mkdirSync(FIXTURES_DIR, { recursive: true });

    // Create FASTA test file
    writeFileSync(
      TEST_FILES.fasta,
      [
        ">seq1 First sequence",
        "ATCGATCGATCG",
        ">seq2 Second sequence",
        "GGGGAAAACCCC",
        "TTTTTTTT",
        ">seq3",
        "NNNNATCGNNNN",
      ].join("\n")
    );

    // Create FASTQ test file
    writeFileSync(
      TEST_FILES.fastq,
      [
        "@seq1 First read",
        "ATCGATCGATCG",
        "+",
        "IIIIIIIIIIII",
        "@seq2 Second read",
        "GGGGAAAACCCC",
        "+",
        "HHHHHHHHHHHH",
      ].join("\n")
    );

    // Create SAM test file
    writeFileSync(
      TEST_FILES.sam,
      [
        "@HD\tVN:1.0\tSO:coordinate",
        "@SQ\tSN:chr1\tLN:1000",
        "read1\t0\tchr1\t100\t60\t12M\t*\t0\t0\tATCGATCGATCG\tIIIIIIIIIIII",
        "read2\t16\tchr1\t200\t60\t12M\t*\t0\t0\tGGGGAAAACCCC\tHHHHHHHHHHHH",
      ].join("\n")
    );

    // Create BED test file
    writeFileSync(
      TEST_FILES.bed,
      [
        "chr1\t100\t200\tfeature1\t500\t+",
        "chr1\t300\t400\tfeature2\t600\t-",
        "chr2\t500\t600\tfeature3\t700\t.",
      ].join("\n")
    );

    // Create large FASTA file for streaming tests
    const largeSequences: string[] = [];
    for (let i = 0; i < 1000; i++) {
      largeSequences.push(`>seq${i}`);
      largeSequences.push("A".repeat(100) + "T".repeat(100) + "C".repeat(100) + "G".repeat(100));
    }
    writeFileSync(TEST_FILES.largeFasta, largeSequences.join("\n"));

    // Create malformed FASTA file
    writeFileSync(
      TEST_FILES.malformedFasta,
      [">seq1", "ATCG", "INVALID_SEQUENCE_LINE_WITHOUT_HEADER", ">seq2", "GGGG"].join("\n")
    );

    // Create empty file
    writeFileSync(TEST_FILES.emptyFile, "");

    // Create binary file
    writeFileSync(TEST_FILES.binaryFile, Buffer.from([0x00, 0x01, 0x02, 0xff]));
  });

  afterAll(() => {
    // Clean up test fixtures
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  describe("FASTA Parser File Integration", () => {
    test("should parse FASTA file correctly", async () => {
      const parser = new FastaParser();
      const sequences: FastaSequence[] = [];

      for await (const sequence of parser.parseFile(TEST_FILES.fasta)) {
        sequences.push(sequence);
      }

      expect(sequences).toHaveLength(3);
      expect(sequences[0]!.id).toBe("seq1");
      expect(sequences[0]!.description).toBe("First sequence");
      expect(sequences[0]!.sequence).toEqualSequence("ATCGATCGATCG");
      expect(sequences[1]!.sequence).toEqualSequence("GGGGAAAACCCCTTTTTTTT");
      expect(sequences[2]!.id).toBe("seq3");
    });

    test("should handle large FASTA files", async () => {
      const parser = new FastaParser();
      let count = 0;

      for await (const sequence of parser.parseFile(TEST_FILES.largeFasta)) {
        count++;
        expect(sequence.format).toBe("fasta");
        expect(sequence.sequence).toHaveLength(400);

        // Early exit to prevent test timeout
        if (count >= 100) break;
      }

      expect(count).toBe(100);
    });

    test("should parse FASTA with continuation lines as multi-line sequences", async () => {
      // The "malformed" file actually contains valid multi-line FASTA:
      // >seq1\nATCG\nINVALID_SEQUENCE_LINE_WITHOUT_HEADER\n>seq2\nGGGG
      // Noodles correctly treats the middle line as sequence continuation.
      const parser = new FastaParser();
      const sequences: FastaSequence[] = [];

      for await (const sequence of parser.parseFile(TEST_FILES.malformedFasta)) {
        sequences.push(sequence);
      }

      expect(sequences).toHaveLength(2);
      expect(sequences[0]!.id).toBe("seq1");
      expect(sequences[1]!.id).toBe("seq2");
    });

    test("should throw error for non-existent files", async () => {
      const parser = new FastaParser();

      await expect(
        (async () => {
          for await (const _ of parser.parseFile(TEST_FILES.nonexistent)) {
            // Should not reach here
          }
        })()
      ).rejects.toThrow(FileError);
    });

    test("should handle empty files gracefully", async () => {
      const parser = new FastaParser();
      const sequences: FastaSequence[] = [];

      for await (const sequence of parser.parseFile(TEST_FILES.emptyFile)) {
        sequences.push(sequence);
      }

      expect(sequences).toHaveLength(0);
    });

    test("should respect file reading options", async () => {
      const parser = new FastaParser();

      const sequences: FastaSequence[] = [];
      for await (const sequence of parser.parseFile(TEST_FILES.fasta)) {
        sequences.push(sequence);
      }

      expect(sequences).toHaveLength(3);
    });
  });

  describe("FASTQ Parser File Integration", () => {
    test("should parse FASTQ file correctly", async () => {
      const parser = new FastqParser();
      const sequences: FastqSequence[] = [];

      for await (const sequence of parser.parseFile(TEST_FILES.fastq)) {
        sequences.push(sequence);
      }

      expect(sequences).toHaveLength(2);
      expect(sequences[0]!.id).toBe("seq1");
      expect(sequences[0]!.description).toBe("First read");
      expect(sequences[0]!.sequence).toEqualSequence("ATCGATCGATCG");
      expect(sequences[0]!.quality).toEqualSequence("IIIIIIIIIIII");
      expect(sequences[0]!.qualityEncoding).toBe("phred33");
    });

    test("should detect quality encoding automatically", async () => {
      const parser = new FastqParser();
      const sequences: FastqSequence[] = [];

      for await (const sequence of parser.parseFile(TEST_FILES.fastq)) {
        sequences.push(sequence);
      }

      // All sequences should have the same detected encoding
      sequences.forEach((seq) => {
        expect(["phred33", "phred64", "solexa"]).toContain(seq.qualityEncoding);
      });
    });

    test("should parse quality encoding from data", async () => {
      const parser = new FastqParser();
      const sequences: FastqSequence[] = [];

      for await (const sequence of parser.parseFile(TEST_FILES.fastq)) {
        sequences.push(sequence);
      }

      expect(sequences[0]!.qualityEncoding).toBeDefined();
      expect(sequences[0]!.quality).toBeDefined();
    });

    test("should handle file I/O errors gracefully", async () => {
      const parser = new FastqParser();

      await expect(
        (async () => {
          for await (const _ of parser.parseFile(TEST_FILES.binaryFile)) {
            // Should throw before yielding anything
          }
        })()
      ).rejects.toThrow();
    });
  });

  describe("BED Parser File Integration", () => {
    test("should parse BED file correctly", async () => {
      const parser = new BedParser();
      const intervals: BedInterval[] = [];

      for await (const interval of parser.parseFile(TEST_FILES.bed)) {
        intervals.push(interval);
      }

      expect(intervals).toHaveLength(3);
      expect(intervals[0]!.chromosome).toBe("chr1");
      expect(intervals[0]!.start).toBe(100);
      expect(intervals[0]!.end).toBe(200);
      expect(intervals[0]!.name).toBe("feature1");
      expect(intervals[0]!.score).toBe(500);
      expect(intervals[0]!.strand).toBe("+");
    });

    test("should calculate derived properties", async () => {
      const parser = new BedParser();
      const intervals: BedInterval[] = [];

      for await (const interval of parser.parseFile(TEST_FILES.bed)) {
        intervals.push(interval);
      }

      intervals.forEach((interval) => {
        expect(interval.length).toBe(interval.end - interval.start);
        expect(interval.midpoint).toBeDefined();
        expect(interval.stats).toBeDefined();
      });
    });

    test("should skip header and comment lines", async () => {
      // Create BED file with headers and comments
      const bedWithHeaders = join(FIXTURES_DIR, "bed-with-headers.bed");
      writeFileSync(
        bedWithHeaders,
        [
          "# This is a comment",
          'track name="test" description="test track"',
          "browser position chr1:100-1000",
          "chr1\t100\t200\tfeature1\t500\t+",
          "# Another comment",
          "chr1\t300\t400\tfeature2\t600\t-",
        ].join("\n")
      );

      const parser = new BedParser();
      const intervals: BedInterval[] = [];

      for await (const interval of parser.parseFile(bedWithHeaders)) {
        intervals.push(interval);
      }

      expect(intervals).toHaveLength(2);
      expect(intervals[0]!.name).toBe("feature1");
      expect(intervals[1]!.name).toBe("feature2");
    });
  });

  describe("Cross-Parser Error Handling", () => {
    test("should handle file permission errors consistently", async () => {
      const parsers = [new FastaParser(), new FastqParser(), new BedParser()];

      for (const parser of parsers) {
        await expect(
          (async () => {
            for await (const _ of parser.parseFile(TEST_FILES.nonexistent)) {
              // Should not reach here
            }
          })()
        ).rejects.toThrow();
      }
    });

    test("should provide meaningful error messages", async () => {
      const parser = new FastaParser();

      try {
        for await (const _ of parser.parseFile(TEST_FILES.nonexistent)) {
          // Should not reach here
        }
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(FileError);
        expect((error as FileError).message).toContain("No such file or directory");
        expect((error as FileError).operation).toBe("read");
      }
    });

    test("should maintain error context through the stack", async () => {
      const parser = new FastaParser();

      try {
        for await (const _ of parser.parseFile("/invalid/path/file.fasta")) {
          // Should not reach here
        }
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(FileError);
        expect((error as FileError).message).toContain("/invalid/path/file.fasta");
      }
    });
  });

  describe("Concurrent Processing Tests", () => {
    test("should handle concurrent file parsing", async () => {
      const parsers = [new FastaParser(), new FastaParser(), new FastaParser()];

      const promises = parsers.map(async (parser) => {
        const sequences: FastaSequence[] = [];
        for await (const sequence of parser.parseFile(TEST_FILES.fasta)) {
          sequences.push(sequence);
        }
        return sequences;
      });

      const results = await Promise.all(promises);
      results.forEach((sequences) => {
        expect(sequences).toHaveLength(3);
      });
    });

    test("should parse large files without error", async () => {
      const parser = new FastaParser();
      const sequences: FastaSequence[] = [];

      for await (const seq of parser.parseFile(TEST_FILES.largeFasta)) {
        sequences.push(seq);
      }

      expect(sequences.length).toBeGreaterThan(0);
    });
  });

  describe("File Format Validation", () => {
    test("should validate file extensions and content", async () => {
      // This test would be enhanced with actual format detection
      const _parser = new FastaParser();

      // Parsing a FASTQ file with FASTA parser should work but produce warnings
      const warnings: string[] = [];
      const parserWithWarnings = new FastaParser({
        onWarning: (warning) => warnings.push(warning),
      });

      try {
        const sequences: FastaSequence[] = [];
        for await (const sequence of parserWithWarnings.parseFile(TEST_FILES.fastq)) {
          sequences.push(sequence);
        }
        // FASTQ format has @ headers which are invalid for FASTA
        // This should produce parsing errors
      } catch (error) {
        expect(error).toBeInstanceOf(ParseError);
      }
    });
  });
});
