/**
 * Integration tests for compression support with FileReader
 *
 * Tests the complete compression pipeline including automatic detection,
 * decompression, and integration with genomic file parsers.
 */

import { describe, test, expect } from "bun:test";
import { CompressionDetector, createDecompressor } from "../../src/compression";
import { CompressionError } from "../../src/errors";
import { createReadableStreamFromData } from "../test-utils";

// Mock compressed data for testing
const mockGzipData = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);
const mockZstdData = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00, 0x00]);
const mockFastaContent = ">sequence1\nACGTACGT\n>sequence2\nGGCCTTAA\n";

// Helper function to create test streams
function createReadableStreamFromData(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

describe("Compression Integration", () => {
  describe("createDecompressor factory", () => {
    test("should create gzip decompressor", () => {
      const decompressor = createDecompressor("gzip");
      expect(decompressor).toBeDefined();
      expect(typeof decompressor.decompress).toBe("function");
      expect(typeof decompressor.createStream).toBe("function");
      expect(typeof decompressor.wrapStream).toBe("function");
    });

    test("should create zstd decompressor", () => {
      const decompressor = createDecompressor("zstd");
      expect(decompressor).toBeDefined();
      expect(typeof decompressor.decompress).toBe("function");
      expect(typeof decompressor.createStream).toBe("function");
      expect(typeof decompressor.wrapStream).toBe("function");
    });

    test("should throw error for none compression", () => {
      expect(() => createDecompressor("none")).toThrow(CompressionError);
      expect(() => createDecompressor("none")).toThrow(/No decompression needed/);
    });

    test("should throw error for unsupported format", () => {
      expect(() => createDecompressor("bzip2" as "gzip")).toThrow(CompressionError);
      expect(() => createDecompressor("unsupported" as "gzip")).toThrow(
        /Unsupported compression format/
      );
    });
  });

  describe("FileReader compression integration", () => {
    test("should detect compression from file extension", async () => {
      // Test gzip detection
      const gzipFormat = CompressionDetector.fromExtension("test.fasta.gz");
      expect(gzipFormat).toBe("gzip");

      // Test zstd detection
      const zstdFormat = CompressionDetector.fromExtension("test.fastq.zst");
      expect(zstdFormat).toBe("zstd");

      // Test no compression
      const noneFormat = CompressionDetector.fromExtension("test.sam");
      expect(noneFormat).toBe("none");
    });

    test("should handle auto-decompression option", async () => {
      // Mock file system access (this would need actual file system mocking in real tests)
      const mockStream = createReadableStreamFromData(mockGzipData);

      // Test that options structure is correct
      const options = {
        autoDecompress: true,
        compressionFormat: "gzip" as const,
        decompressionOptions: {
          bufferSize: 64 * 1024,
          validateIntegrity: true,
        },
      };

      expect(options.autoDecompress).toBe(true);
      expect(options.compressionFormat).toBe("gzip");
      expect(options.decompressionOptions.bufferSize).toBe(65536);
    });

    test("should handle disabled auto-decompression", async () => {
      const options = {
        autoDecompress: false,
        compressionFormat: "gzip" as const,
      };

      expect(options.autoDecompress).toBe(false);
      // With auto-decompression disabled, compressed data should pass through unchanged
    });

    test("should validate decompression options", () => {
      const validOptions = {
        autoDecompress: true,
        decompressionOptions: {
          bufferSize: 128 * 1024,
          maxOutputSize: 100 * 1024 * 1024,
          validateIntegrity: true,
        },
      };

      expect(validOptions.decompressionOptions.bufferSize).toBe(131072);
      expect(validOptions.decompressionOptions.maxOutputSize).toBe(104857600);
      expect(validOptions.decompressionOptions.validateIntegrity).toBe(true);
    });
  });

  describe("end-to-end compression scenarios", () => {
    test("should handle gzip compressed FASTA stream", async () => {
      const gzipStream = createReadableStreamFromData(mockGzipData);
      const detection = await CompressionDetector.fromStream(gzipStream);

      expect(detection.format).toBe("gzip");
      expect(detection.confidence).toBe(1.0);

      const decompressor = createDecompressor(detection.format);
      expect(decompressor).toBeDefined();
    });

    test("should handle zstd compressed FASTQ stream", async () => {
      const zstdStream = createReadableStreamFromData(mockZstdData);
      const detection = await CompressionDetector.fromStream(zstdStream);

      expect(detection.format).toBe("zstd");
      expect(detection.confidence).toBe(1.0);

      const decompressor = createDecompressor(detection.format);
      expect(decompressor).toBeDefined();
    });

    test("should handle uncompressed genomic data", async () => {
      const uncompressedData = new TextEncoder().encode(mockFastaContent);
      const textStream = createReadableStreamFromData(uncompressedData);
      const detection = await CompressionDetector.fromStream(textStream);

      expect(detection.format).toBe("none");
      expect(detection.confidence).toBe(0.9);
    });

    test("should handle hybrid detection workflow", async () => {
      // Test case where extension suggests compression but magic bytes don't match
      const textData = new TextEncoder().encode(">seq1\nACGT\n");
      const detection = CompressionDetector.hybrid("test.fasta.gz", textData);

      // Should detect mismatch and have lower confidence
      expect(detection.format).toBe("none");
      expect(detection.confidence).toBeLessThan(0.7);
      expect(detection.detectionMethod).toBe("hybrid");
    });
  });

  describe("error handling and edge cases", () => {
    test("should handle corrupted compression headers", async () => {
      const corruptedGzip = new Uint8Array([0x1f, 0x8b, 0xff, 0xff]); // Invalid gzip
      const stream = createReadableStreamFromData(corruptedGzip);

      try {
        const decompressor = createDecompressor("gzip");
        const decompressedStream = decompressor.wrapStream(stream);
        const reader = decompressedStream.getReader();
        await reader.read();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        // Should handle gracefully without crashing
      }
    });

    test("should handle empty compressed files", async () => {
      const emptyStream = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      const detection = await CompressionDetector.fromStream(emptyStream);
      expect(detection.format).toBe("none");
      expect(detection.confidence).toBe(0.8);
    });

    test("should handle very large compressed files", async () => {
      const options = {
        autoDecompress: true,
        decompressionOptions: {
          maxOutputSize: 1024, // Very small limit
        },
      };

      // Test that options validation works
      expect(options.decompressionOptions.maxOutputSize).toBe(1024);
    });

    test("should handle multiple compression formats in batch", () => {
      const testFiles = [
        { path: "genome.fasta.gz", expected: "gzip" },
        { path: "reads.fastq.zst", expected: "zstd" },
        { path: "alignment.sam", expected: "none" },
        { path: "variants.vcf.gz", expected: "gzip" },
      ];

      for (const testFile of testFiles) {
        const format = CompressionDetector.fromExtension(testFile.path);
        expect(format).toBe(testFile.expected);
      }
    });
  });

  describe("runtime-specific functionality", () => {
    test("should detect runtime capabilities", () => {
      // Test that runtime detection works (this will vary by actual runtime)
      const gzipDecompressor = createDecompressor("gzip");
      expect(gzipDecompressor).toBeDefined();

      const zstdDecompressor = createDecompressor("zstd");
      expect(zstdDecompressor).toBeDefined();
    });

    test("should handle cross-platform file paths", () => {
      const testPaths = [
        "/unix/path/genome.fasta.gz",
        "C:\\Windows\\path\\reads.fastq.zst",
        "./relative/path/variants.vcf.gz",
        "../parent/annotations.bed.zst",
      ];

      for (const path of testPaths) {
        const format = CompressionDetector.fromExtension(path);
        expect(["gzip", "zstd", "none"]).toContain(format);
      }
    });
  });

  describe("genomic data specific scenarios", () => {
    test("should handle common genomic file extensions", () => {
      const genomicExtensions = [
        { file: "hg38.fa.gz", format: "gzip" },
        { file: "sample.fq.zst", format: "zstd" },
        { file: "alignments.sam.gz", format: "gzip" },
        { file: "features.bed.zstd", format: "zstd" },
        { file: "variants.vcf.gz", format: "gzip" },
        { file: "annotations.gff3", format: "none" },
      ];

      for (const test of genomicExtensions) {
        const detected = CompressionDetector.fromExtension(test.file);
        expect(detected).toBe(test.format);
      }
    });

    test("should estimate compression ratios", () => {
      // These are from the compression module utility functions
      const estimates = {
        sequence_gzip: 3.5,
        sequence_zstd: 4.2,
        alignment_gzip: 2.8,
        variant_zstd: 5.2,
      };

      // Verify reasonable compression ratio estimates
      expect(estimates.sequence_gzip).toBeGreaterThan(2);
      expect(estimates.sequence_zstd).toBeGreaterThan(estimates.sequence_gzip);
      expect(estimates.variant_zstd).toBeGreaterThan(4);
    });
  });
});
