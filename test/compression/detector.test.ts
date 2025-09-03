/**
 * Tests for compression format detection
 *
 * Validates magic byte detection, extension-based detection, and hybrid
 * approaches for genomic file compression formats.
 */

import { describe, test, expect } from "bun:test";
import { CompressionDetector } from "../../src/compression/detector";
import type { CompressionFormat } from "../../src/types";

describe("CompressionDetector", () => {
  describe("fromExtension", () => {
    test("should detect gzip compression from .gz extension", () => {
      const format = CompressionDetector.fromExtension("test.fasta.gz");
      expect(format).toBe("gzip");
    });

    test("should detect gzip compression from .gzip extension", () => {
      const format = CompressionDetector.fromExtension("test.fastq.gzip");
      expect(format).toBe("gzip");
    });

    test("should detect zstd compression from .zst extension", () => {
      const format = CompressionDetector.fromExtension("genome.sam.zst");
      expect(format).toBe("zstd");
    });

    test("should detect zstd compression from .zstd extension", () => {
      const format = CompressionDetector.fromExtension("variants.vcf.zstd");
      expect(format).toBe("zstd");
    });

    test("should return none for uncompressed files", () => {
      const format = CompressionDetector.fromExtension("sequences.fasta");
      expect(format).toBe("none");
    });

    test("should handle case insensitive extensions", () => {
      const format = CompressionDetector.fromExtension("TEST.FASTA.GZ");
      expect(format).toBe("gzip");
    });

    test("should handle Windows-style paths", () => {
      const format = CompressionDetector.fromExtension("C:\\data\\genome.fasta.gz");
      expect(format).toBe("gzip");
    });

    test("should throw error for empty path", () => {
      expect(() => CompressionDetector.fromExtension("")).toThrow();
    });

    test("should throw error for non-string path", () => {
      expect(() => CompressionDetector.fromExtension(null as unknown as string)).toThrow();
    });
  });

  describe("fromMagicBytes", () => {
    test("should detect gzip from magic bytes", () => {
      const gzipMagic = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
      const detection = CompressionDetector.fromMagicBytes(gzipMagic);

      expect(detection.format).toBe("gzip");
      expect(detection.confidence).toBe(1.0);
      expect(detection.detectionMethod).toBe("magic-bytes");
      expect(detection.magicBytes).toEqual(new Uint8Array([0x1f, 0x8b]));
    });

    test("should detect zstd from magic bytes", () => {
      const zstdMagic = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00]);
      const detection = CompressionDetector.fromMagicBytes(zstdMagic);

      expect(detection.format).toBe("zstd");
      expect(detection.confidence).toBe(1.0);
      expect(detection.detectionMethod).toBe("magic-bytes");
      expect(detection.magicBytes).toEqual(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]));
    });

    test("should return none for uncompressed data", () => {
      const textData = new Uint8Array([0x3e, 0x73, 0x65, 0x71]); // ">seq"
      const detection = CompressionDetector.fromMagicBytes(textData);

      expect(detection.format).toBe("none");
      expect(detection.confidence).toBe(0.9);
      expect(detection.detectionMethod).toBe("magic-bytes");
    });

    test("should handle partial magic bytes", () => {
      const partialGzip = new Uint8Array([0x1f]); // Only first byte
      const detection = CompressionDetector.fromMagicBytes(partialGzip);

      expect(detection.format).toBe("none");
      expect(detection.confidence).toBe(0.9);
    });

    test("should throw error for empty bytes", () => {
      expect(() => CompressionDetector.fromMagicBytes(new Uint8Array(0))).toThrow();
    });

    test("should throw error for non-Uint8Array", () => {
      expect(() =>
        CompressionDetector.fromMagicBytes([0x1f, 0x8b] as unknown as Uint8Array)
      ).toThrow();
    });
  });

  describe("fromStream", () => {
    test("should detect gzip from stream", async () => {
      const gzipData = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x12, 0x34]);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(gzipData);
          controller.close();
        },
      });

      const detection = await CompressionDetector.fromStream(stream);
      expect(detection.format).toBe("gzip");
      expect(detection.confidence).toBe(1.0);
    });

    test("should detect zstd from stream", async () => {
      const zstdData = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x12, 0x34]);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(zstdData);
          controller.close();
        },
      });

      const detection = await CompressionDetector.fromStream(stream);
      expect(detection.format).toBe("zstd");
      expect(detection.confidence).toBe(1.0);
    });

    test("should handle empty stream", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      const detection = await CompressionDetector.fromStream(stream);
      expect(detection.format).toBe("none");
      expect(detection.confidence).toBe(0.8);
    });

    test("should throw error for non-ReadableStream", async () => {
      await expect(
        CompressionDetector.fromStream(null as unknown as ReadableStream)
      ).rejects.toThrow();
    });
  });

  describe("hybrid", () => {
    test("should return high confidence when extension and magic bytes agree", () => {
      const gzipMagic = new Uint8Array([0x1f, 0x8b, 0x08]);
      const detection = CompressionDetector.hybrid("test.fasta.gz", gzipMagic);

      expect(detection.format).toBe("gzip");
      expect(detection.confidence).toBeGreaterThan(1.0);
      expect(detection.detectionMethod).toBe("hybrid");
      expect(detection.extension).toBe(".gz");
    });

    test("should prefer magic bytes when methods disagree", () => {
      const zstdMagic = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]);
      const detection = CompressionDetector.hybrid("test.fasta.gz", zstdMagic);

      expect(detection.format).toBe("zstd");
      expect(detection.confidence).toBeLessThan(1.0);
      expect(detection.detectionMethod).toBe("hybrid");
    });

    test("should work with extension only", () => {
      const detection = CompressionDetector.hybrid("test.fastq.zst");

      expect(detection.format).toBe("zstd");
      expect(detection.confidence).toBe(0.7);
      expect(detection.detectionMethod).toBe("extension");
    });

    test("should handle uncompressed files", () => {
      const textMagic = new Uint8Array([0x3e, 0x73, 0x65, 0x71]); // ">seq"
      const detection = CompressionDetector.hybrid("test.fasta", textMagic);

      expect(detection.format).toBe("none");
      expect(detection.confidence).toBeGreaterThan(0.8);
      expect(detection.detectionMethod).toBe("hybrid");
    });
  });

  describe("isReliable", () => {
    test("should return true for high confidence detection", () => {
      const detection = {
        format: "gzip" as CompressionFormat,
        confidence: 0.9,
        detectionMethod: "magic-bytes" as const,
      };

      expect(CompressionDetector.isReliable(detection)).toBe(true);
    });

    test("should return false for low confidence detection", () => {
      const detection = {
        format: "gzip" as CompressionFormat,
        confidence: 0.5,
        detectionMethod: "extension" as const,
      };

      expect(CompressionDetector.isReliable(detection)).toBe(false);
    });

    test("should return true for threshold confidence", () => {
      const detection = {
        format: "zstd" as CompressionFormat,
        confidence: 0.7,
        detectionMethod: "hybrid" as const,
      };

      expect(CompressionDetector.isReliable(detection)).toBe(true);
    });
  });

  describe("genomic file patterns", () => {
    test("should handle common genomic compressed file extensions", () => {
      const genomicFiles = [
        "genome.fasta.gz",
        "reads.fastq.gz",
        "alignments.sam.gz",
        "annotations.bed.gz",
        "variants.vcf.gz",
        "assembly.fa.zst",
        "sequences.fq.zstd",
      ];

      for (const file of genomicFiles) {
        const format = CompressionDetector.fromExtension(file);
        expect(["gzip", "zstd"]).toContain(format);
      }
    });

    test("should maintain consistency across detection methods", async () => {
      const testCases = [
        {
          file: "test.fasta.gz",
          magic: new Uint8Array([0x1f, 0x8b, 0x08]),
          expected: "gzip",
        },
        {
          file: "test.vcf.zst",
          magic: new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]),
          expected: "zstd",
        },
      ];

      for (const testCase of testCases) {
        const extFormat = CompressionDetector.fromExtension(testCase.file);
        const magicDetection = CompressionDetector.fromMagicBytes(testCase.magic);
        const hybridDetection = CompressionDetector.hybrid(testCase.file, testCase.magic);

        expect(extFormat).toBe(testCase.expected);
        expect(magicDetection.format).toBe(testCase.expected);
        expect(hybridDetection.format).toBe(testCase.expected);
      }
    });
  });
});
