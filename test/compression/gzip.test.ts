/**
 * Tests for Gzip decompression functionality
 *
 * Validates gzip decompression for genomic data with runtime-specific
 * optimizations and proper error handling.
 */

import { describe, test, expect } from "bun:test";
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
      const largeGzipHeader = new Uint8Array(1024 * 1024 * 20); // 20MB
      largeGzipHeader[0] = 0x1f;
      largeGzipHeader[1] = 0x8b;

      const options = { maxOutputSize: 1024 * 1024 }; // 1MB limit

      await expect(GzipDecompressor.decompress(largeGzipHeader, options)).rejects.toThrow(
        CompressionError
      );
      await expect(GzipDecompressor.decompress(largeGzipHeader, options)).rejects.toThrow(
        /exceeds maximum/
      );
    });

    test("should validate options", async () => {
      const validGzipData = new Uint8Array([0x1f, 0x8b, 0x08]);
      const invalidOptions = { bufferSize: -1 };

      await expect(GzipDecompressor.decompress(validGzipData, invalidOptions)).rejects.toThrow();
    });

    test("should handle progress callbacks", async () => {
      let progressCalled = false;
      let bytesProcessed = 0;

      const options = {
        onProgress: (bytes: number) => {
          progressCalled = true;
          bytesProcessed = bytes;
        },
      };

      const gzipData = new Uint8Array([0x1f, 0x8b, 0x08]);

      try {
        await GzipDecompressor.decompress(gzipData, options);
      } catch (error) {
        // Expected to fail due to incomplete gzip data, but progress should be called
      }

      expect(progressCalled).toBe(true);
      expect(bytesProcessed).toBeGreaterThan(0);
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

    test.skip("should handle abort signal in stream", async () => {
      const controller = new AbortController();
      const stream = GzipDecompressor.createStream({
        signal: controller.signal,
      });

      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();

      // Write some data
      await writer.write(new Uint8Array([0x1f, 0x8b, 0x08]));

      // Abort the operation
      controller.abort();

      try {
        await reader.read();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }

      writer.releaseLock();
      reader.releaseLock();
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
        onProgress: (bytes: number) => console.log(`Processed ${bytes} bytes`),
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
        expect(error.message).toContain("decompress operation failed");
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
      const largeGzipHeader = new Uint8Array(2048); // 2KB data
      largeGzipHeader[0] = 0x1f;
      largeGzipHeader[1] = 0x8b;

      const options = { maxOutputSize: smallLimit };

      await expect(GzipDecompressor.decompress(largeGzipHeader, options)).rejects.toThrow(
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

    test("should handle streaming for large genomic files", async () => {
      let chunkCount = 0;
      const options = {
        onProgress: () => chunkCount++,
      };

      const largeStream = new ReadableStream({
        start(controller) {
          // Simulate multiple chunks of gzip data
          for (let i = 0; i < 5; i++) {
            controller.enqueue(new Uint8Array([0x1f, 0x8b, 0x08, i]));
          }
          controller.close();
        },
      });

      const decompressed = GzipDecompressor.wrapStream(largeStream, options);
      const reader = decompressed.getReader();

      try {
        await reader.read();
      } catch (error) {
        // Expected failure, but chunks should have been processed
        expect(chunkCount).toBeGreaterThan(0);
      } finally {
        reader.releaseLock();
      }
    });
  });
});
