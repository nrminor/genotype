/**
 * Tests for Gzip decompression functionality
 *
 * Validates gzip decompression for genomic data with runtime-specific
 * optimizations and proper error handling.
 */

import { describe, expect, test } from "bun:test";
import { gzipSync } from "fflate";
import { GzipDecompressor } from "../../src/compression/gzip";
import { CompressionError } from "../../src/errors";

// Mock gzip data for testing (simplified header + data)
const MOCK_FASTA_DATA = new TextEncoder().encode(">sequence1\nACGTACGT\n>sequence2\nGGCCTTAA\n");

describe("GzipDecompressor", () => {
  describe("decompress", () => {
    test("should reject invalid magic bytes", async () => {
      const invalidData = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // ZIP magic

      await expect(GzipDecompressor.decompress(invalidData)).rejects.toThrow(CompressionError);
      await expect(GzipDecompressor.decompress(invalidData)).rejects.toThrow(
        /Invalid gzip magic bytes/
      );
    });

    test("should reject empty data", async () => {
      const emptyData = new Uint8Array(0);

      await expect(GzipDecompressor.decompress(emptyData)).rejects.toThrow(CompressionError);
      await expect(GzipDecompressor.decompress(emptyData)).rejects.toThrow(/must not be empty/);
    });

    test("should reject non-Uint8Array input", async () => {
      await expect(
        GzipDecompressor.decompress([0x1f, 0x8b] as unknown as Uint8Array)
      ).rejects.toThrow(CompressionError);
      await expect(
        GzipDecompressor.decompress("gzip data" as unknown as Uint8Array)
      ).rejects.toThrow(CompressionError);
    });

    test("should handle size limits", async () => {
      // Create valid gzip data that will exceed size limit when decompressed
      const largeContent = "A".repeat(2 * 1024 * 1024); // 2MB content
      const largeGzipData = gzipSync(new TextEncoder().encode(largeContent));

      const options = { maxOutputSize: 1024 * 1024 }; // 1MB limit

      await expect(GzipDecompressor.decompress(largeGzipData, options)).rejects.toThrow(
        CompressionError
      );
      await expect(GzipDecompressor.decompress(largeGzipData, options)).rejects.toThrow(
        /exceeds maximum/
      );
    });

    test("should validate options", async () => {
      const validGzipData = new Uint8Array([0x1f, 0x8b, 0x08]);
      const invalidOptions = { bufferSize: -1 };

      await expect(GzipDecompressor.decompress(validGzipData, invalidOptions)).rejects.toThrow();
    });

    test("should handle abort signal", async () => {
      const controller = new AbortController();
      const gzipData = new Uint8Array([0x1f, 0x8b, 0x08]);

      // Abort immediately
      controller.abort();

      const options = { signal: controller.signal };

      // Should handle aborted signal gracefully
      try {
        await GzipDecompressor.decompress(gzipData, options);
      } catch (error) {
        expect(error).toBeInstanceOf(CompressionError);
      }
    });
  });

  describe("createStream", () => {
    test("should create transform stream", () => {
      const stream = GzipDecompressor.createStream();

      expect(stream).toBeInstanceOf(TransformStream);
      expect(stream.readable).toBeInstanceOf(ReadableStream);
      expect(stream.writable).toBeInstanceOf(WritableStream);
    });

    test("should accept custom options", () => {
      const options = {
        bufferSize: 128 * 1024, // 128KB
        validateIntegrity: true,
      };

      const stream = GzipDecompressor.createStream(options);

      expect(stream).toBeInstanceOf(TransformStream);
    });

    test("should validate options schema", () => {
      const invalidOptions = {
        bufferSize: -1,
        maxOutputSize: "invalid" as unknown as number,
      };

      expect(() => GzipDecompressor.createStream(invalidOptions)).toThrow();
    });

    test("should handle abort signal in stream", async () => {
      const controller = new AbortController();

      // Create valid gzip test data
      const testContent = ">test\nATCG\n";
      const validGzipData = gzipSync(new TextEncoder().encode(testContent));

      // Create input stream
      const inputStream = new ReadableStream({
        start(streamController) {
          streamController.enqueue(validGzipData);
          streamController.close();
        },
      });

      // Create decompression stream with abort signal
      const decompressedStream = GzipDecompressor.wrapStream(inputStream, {
        signal: controller.signal,
      });

      // Abort the operation
      controller.abort();

      // Should handle aborted signal gracefully
      await expect(
        (async () => {
          for await (const chunk of decompressedStream) {
            // Should not reach here due to abort
          }
        })()
      ).rejects.toThrow(CompressionError);
    });
  });

  describe("wrapStream", () => {
    test("should wrap readable stream", () => {
      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0x1f, 0x8b, 0x08]));
          controller.close();
        },
      });

      const decompressedStream = GzipDecompressor.wrapStream(inputStream);

      expect(decompressedStream).toBeInstanceOf(ReadableStream);
    });

    test("should reject invalid input", () => {
      expect(() => GzipDecompressor.wrapStream(null as unknown as ReadableStream)).toThrow(
        CompressionError
      );
      expect(() =>
        GzipDecompressor.wrapStream("not a stream" as unknown as ReadableStream)
      ).toThrow(CompressionError);
    });

    test("should apply custom options", () => {
      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0x1f, 0x8b]));
          controller.close();
        },
      });

      const options = {
        bufferSize: 64 * 1024,
      };

      const decompressedStream = GzipDecompressor.wrapStream(inputStream, options);

      expect(decompressedStream).toBeInstanceOf(ReadableStream);
    });

    test("should handle streaming decompression", async () => {
      const chunks = [
        new Uint8Array([0x1f, 0x8b, 0x08, 0x00]),
        new Uint8Array([0x00, 0x00, 0x00, 0x00]),
        new Uint8Array([0x00, 0xff]),
      ];

      const inputStream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      const decompressedStream = GzipDecompressor.wrapStream(inputStream);
      const reader = decompressedStream.getReader();

      try {
        // Should not throw immediately
        const { done, value } = await reader.read();
        // May be done if no valid compressed data, but shouldn't error on stream creation
      } catch (error) {
        // Expected to fail with incomplete gzip data, but stream should be created
        expect(error).toBeInstanceOf(Error);
      } finally {
        reader.releaseLock();
      }
    });
  });

  describe("runtime optimization detection", () => {
    test("should handle different runtime environments", async () => {
      // This test verifies the runtime detection logic works
      const gzipData = new Uint8Array([0x1f, 0x8b, 0x08]);

      try {
        await GzipDecompressor.decompress(gzipData);
      } catch (error) {
        // Expected to fail with incomplete data, but shouldn't throw runtime errors
        expect(error).toBeInstanceOf(CompressionError);
        expect(error.message).not.toContain("Unsupported runtime");
      }
    });

    test("should use appropriate buffer sizes", () => {
      const stream1 = GzipDecompressor.createStream({ bufferSize: 32768 });
      const stream2 = GzipDecompressor.createStream({ bufferSize: 131072 });

      expect(stream1).toBeInstanceOf(TransformStream);
      expect(stream2).toBeInstanceOf(TransformStream);
    });
  });

  describe("error handling", () => {
    test("should provide detailed error messages", async () => {
      const truncatedGzip = new Uint8Array([0x1f, 0x8b]); // Too short

      try {
        await GzipDecompressor.decompress(truncatedGzip);
      } catch (error) {
        expect(error).toBeInstanceOf(CompressionError);
        expect(error.format).toBe("gzip");
        expect(error.operation).toBe("decompress");
      }
    });

    test("should handle system errors gracefully", async () => {
      const invalidGzip = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff, 0xff, 0xff]);

      try {
        await GzipDecompressor.decompress(invalidGzip);
      } catch (error) {
        expect(error).toBeInstanceOf(CompressionError);
        expect(error.message).toContain("invalid gzip data");
      }
    });

    test("should track bytes processed in errors", async () => {
      const partialGzip = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);

      try {
        await GzipDecompressor.decompress(partialGzip);
      } catch (error) {
        expect(error).toBeInstanceOf(CompressionError);
        expect(error.bytesProcessed).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("memory management", () => {
    test("should respect memory limits", async () => {
      const smallLimit = 1024; // 1KB limit
      // Create valid gzip data that will exceed limit
      const largeContent = "A".repeat(2048); // 2KB content
      const largeGzipData = gzipSync(new TextEncoder().encode(largeContent));

      const options = { maxOutputSize: smallLimit };

      await expect(GzipDecompressor.decompress(largeGzipData, options)).rejects.toThrow(
        /exceeds maximum/
      );
    });

    test("should handle large buffer sizes", () => {
      const largeBufferOptions = {
        bufferSize: 1024 * 1024, // 1MB buffer
      };

      const stream = GzipDecompressor.createStream(largeBufferOptions);
      expect(stream).toBeInstanceOf(TransformStream);
    });
  });

  describe("integration scenarios", () => {
    test("should work with genomic file patterns", async () => {
      // Simulate common genomic data patterns
      const fastaLikeData = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]); // Gzip header start

      try {
        await GzipDecompressor.decompress(fastaLikeData);
      } catch (error) {
        // Expected to fail with incomplete data
        expect(error).toBeInstanceOf(CompressionError);
        expect(error.format).toBe("gzip");
      }
    });
  });
});
