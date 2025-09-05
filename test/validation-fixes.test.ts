import { describe, expect, test } from "bun:test";
import {
  BAIIndexError,
  ChromosomeNamingError,
  GenomicCoordinateError,
  ResourceLimitError,
  SecurityPathError,
  ValidationError,
} from "../src/errors";
import {
  ChromosomeSchema,
  FilePathSchema,
  GenomicCoordinate,
  SequenceIdSchema,
} from "../src/types";

describe("Empty Validation Audit Fixes - Proper Error Handling", () => {
  describe("Security Path Validation", () => {
    test("should block access to sensitive system paths", () => {
      const sensitivePaths = [
        "/etc/passwd",
        "/proc/meminfo",
        "/sys/kernel",
        "/dev/null",
        "C:\\Windows\\System32\\cmd.exe",
        "C:\\System32\\config",
        "/System/Library/Kernels",
        "/Library/System/Components",
      ];

      for (const path of sensitivePaths) {
        expect(() => FilePathSchema(path)).toThrow(SecurityPathError);
      }
    });

    test("should allow safe paths", () => {
      const safePaths = [
        "/home/user/data.fasta",
        "/tmp/analysis.fastq",
        "./local/genome.bam",
        "C:\\Users\\Data\\sequences.fa",
      ];

      for (const path of safePaths) {
        expect(() => FilePathSchema(path)).not.toThrow();
      }
    });
  });

  describe("Resource Limit Enforcement", () => {
    test("should throw ResourceLimitError for buffer size violations", () => {
      const largeBufferSize = 2_000_000; // 2MB > 1MB limit

      expect(() => {
        throw ResourceLimitError.forBufferSize(largeBufferSize, 1_048_576, "Test operation");
      }).toThrow(ResourceLimitError);

      expect(() => {
        throw ResourceLimitError.forBufferSize(largeBufferSize, 1_048_576, "Test operation");
      }).toThrow(/buffer size too large.*2MB.*maximum 1MB/);
    });

    test("should throw ResourceLimitError for timeout violations", () => {
      const longTimeout = 600_000; // 10 minutes > 5 minute limit

      expect(() => {
        throw ResourceLimitError.forTimeout(longTimeout, 300_000, "Test operation");
      }).toThrow(ResourceLimitError);

      expect(() => {
        throw ResourceLimitError.forTimeout(longTimeout, 300_000, "Test operation");
      }).toThrow(/timeout too long.*10 minutes.*maximum 5 minutes/);
    });
  });

  describe("BAI Index Validation", () => {
    test("should throw BAIIndexError for performance-impacting conditions", () => {
      // Test large chunk
      expect(() => {
        throw BAIIndexError.forPerformanceImpact("chunk", 2048, 1024, "MB");
      }).toThrow(BAIIndexError);

      // Test excessive chunks
      expect(() => {
        throw BAIIndexError.forPerformanceImpact("bin", 15000, 10000, "chunks");
      }).toThrow(/may impact performance.*15000 chunks/);

      // Test non-standard interval size
      expect(() => {
        throw new BAIIndexError(
          "Non-standard interval size",
          "interval-size",
          32768,
          "Use standard 16384 for compatibility"
        );
      }).toThrow(BAIIndexError);
    });
  });

  describe("Sequence ID Validation", () => {
    test("should throw ValidationError for invalid sequence IDs", () => {
      const dirtyId = "seq@#$%^&*()1";

      expect(() => SequenceIdSchema(dirtyId)).toThrow(ValidationError);
      expect(() => SequenceIdSchema(dirtyId)).toThrow(/Sequence ID contains invalid characters/);
    });

    test("should accept clean sequence IDs", () => {
      const cleanId = "seq_1";
      const result = SequenceIdSchema(cleanId);

      expect(result).toBe("seq_1");
    });
  });

  describe("Genomic Coordinate Bounds Validation", () => {
    test("should throw GenomicCoordinateError for unusually large coordinates", () => {
      const largeCoordinate = 400_000_000; // > 300MB limit

      expect(() => GenomicCoordinate(largeCoordinate)).toThrow(GenomicCoordinateError);
      expect(() => GenomicCoordinate(largeCoordinate)).toThrow(/coordinate unusually large/);
    });

    test("should accept normal coordinates", () => {
      const normalCoordinate = 150_000_000; // 150MB - within normal range
      const result = GenomicCoordinate(normalCoordinate);

      expect(result).toBe(normalCoordinate);
    });

    test("should reject non-integer coordinates", () => {
      expect(() => GenomicCoordinate(123.45)).toThrow(/Genomic coordinates must be integers/);
    });
  });

  describe("Chromosome Name Validation", () => {
    test("should throw ChromosomeNamingError for non-standard chromosome names", () => {
      const weirdChromosome = "weird-scaffold@name#123";

      expect(() => ChromosomeSchema(weirdChromosome)).toThrow(ChromosomeNamingError);
      expect(() => ChromosomeSchema(weirdChromosome)).toThrow(/Non-standard chromosome name/);
    });

    test("should accept standard chromosome names", () => {
      const standardNames = ["chr1", "chr22", "chrX", "chrY", "chrM", "scaffold1"];

      for (const name of standardNames) {
        const result = ChromosomeSchema(name);
        expect(result).toBe(name);
      }
    });
  });
});
