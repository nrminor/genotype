/**
 * Tests for Zstd compression and decompression functionality
 *
 * Validates Zstd compression/decompression for genomic data using
 * the @hpcc-js/wasm-zstd WASM implementation.
 */

import { describe, expect, test } from "bun:test";
import {
  compress,
  createCompressionStream,
  createStream,
  decompress,
  wrapCompressionStream,
  wrapStream,
  ZstdDecompressor,
} from "../../src/compression/zstd";
import { CompressionError } from "../../src/errors";

// Test data
const MOCK_FASTA_DATA = new TextEncoder().encode(
  ">sequence1\nACGTACGTACGTACGT\n>sequence2\nGGCCTTAAGGCCTTAA\n"
);

const MOCK_LARGE_DATA = new TextEncoder().encode("A".repeat(100_000));

describe("Zstd Compression", () => {
  describe("compress", () => {
    test("should compress data successfully", async () => {
      const compressed = await compress(MOCK_FASTA_DATA);

      expect(compressed).toBeInstanceOf(Uint8Array);
      expect(compressed.length).toBeGreaterThan(0);
      // Zstd magic bytes: 0x28 0xB5 0x2F 0xFD
      expect(compressed[0]).toBe(0x28);
      expect(compressed[1]).toBe(0xb5);
      expect(compressed[2]).toBe(0x2f);
      expect(compressed[3]).toBe(0xfd);
    });

    test("should compress with custom level", async () => {
      const level1 = await compress(MOCK_LARGE_DATA, 1);
      const level19 = await compress(MOCK_LARGE_DATA, 19);

      // Higher compression level should produce smaller output (usually)
      // Note: For small data this may not always hold
      expect(level1).toBeInstanceOf(Uint8Array);
      expect(level19).toBeInstanceOf(Uint8Array);
      expect(level19.length).toBeLessThanOrEqual(level1.length);
    });

    test("should reject empty data", async () => {
      const emptyData = new Uint8Array(0);

      await expect(compress(emptyData)).rejects.toThrow(CompressionError);
      await expect(compress(emptyData)).rejects.toThrow(/empty/i);
    });

    test("should reject non-Uint8Array input", async () => {
      await expect(compress("string" as unknown as Uint8Array)).rejects.toThrow(CompressionError);
      await expect(compress([1, 2, 3] as unknown as Uint8Array)).rejects.toThrow(CompressionError);
    });
  });

  describe("decompress", () => {
    test("should decompress data successfully", async () => {
      // First compress, then decompress
      const original = MOCK_FASTA_DATA;
      const compressed = await compress(original);
      const decompressed = await decompress(compressed);

      expect(decompressed).toBeInstanceOf(Uint8Array);
      expect(decompressed.length).toBe(original.length);
      expect(decompressed).toEqual(original);
    });

    test("should handle large data round-trip", async () => {
      const original = MOCK_LARGE_DATA;
      const compressed = await compress(original);
      const decompressed = await decompress(compressed);

      expect(decompressed.length).toBe(original.length);
      expect(decompressed).toEqual(original);
    });

    test("should reject invalid magic bytes", async () => {
      const invalidData = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]); // Gzip magic

      await expect(decompress(invalidData)).rejects.toThrow(CompressionError);
      await expect(decompress(invalidData)).rejects.toThrow(/magic bytes/i);
    });

    test("should reject empty data", async () => {
      const emptyData = new Uint8Array(0);

      await expect(decompress(emptyData)).rejects.toThrow(CompressionError);
      await expect(decompress(emptyData)).rejects.toThrow(/empty/i);
    });

    test("should reject non-Uint8Array input", async () => {
      await expect(decompress("string" as unknown as Uint8Array)).rejects.toThrow(CompressionError);
    });

    test("should handle size limits on compressed input", async () => {
      // Use random-ish data that doesn't compress as well
      const randomData = new Uint8Array(10000);
      for (let i = 0; i < randomData.length; i++) {
        randomData[i] = (i * 17 + 31) % 256;
      }
      const compressed = await compress(randomData);

      // Set limit smaller than compressed size
      const options = { maxOutputSize: 10 };

      await expect(decompress(compressed, options)).rejects.toThrow(CompressionError);
      await expect(decompress(compressed, options)).rejects.toThrow(/exceeds maximum/);
    });

    test("should handle abort signal", async () => {
      const compressed = await compress(MOCK_FASTA_DATA);
      const controller = new AbortController();
      controller.abort();

      await expect(decompress(compressed, { signal: controller.signal })).rejects.toThrow(
        CompressionError
      );
      await expect(decompress(compressed, { signal: controller.signal })).rejects.toThrow(
        /aborted/i
      );
    });

    test("should skip magic validation when disabled", async () => {
      // This should still fail because the data is invalid, but not on magic bytes
      const invalidData = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00]);

      await expect(decompress(invalidData, { validateIntegrity: false })).rejects.toThrow(
        CompressionError
      );
      // Should not mention magic bytes
    });
  });

  describe("round-trip compression", () => {
    test("should preserve genomic data exactly", async () => {
      const testCases = [
        ">chr1\nACGTACGTACGT\n",
        ">gene1 description here\nATGCATGCATGC\n>gene2\nGGGGCCCCAAAATTTT\n",
        "@read1\nACGT\n+\nIIII\n",
        "chr1\t100\t200\tfeature1\t0\t+\n",
      ];

      for (const testCase of testCases) {
        const original = new TextEncoder().encode(testCase);
        const compressed = await compress(original);
        const decompressed = await decompress(compressed);
        const result = new TextDecoder().decode(decompressed);

        expect(result).toBe(testCase);
      }
    });

    test("should handle binary data", async () => {
      // Binary data with all byte values
      const binaryData = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        binaryData[i] = i;
      }

      const compressed = await compress(binaryData);
      const decompressed = await decompress(compressed);

      expect(decompressed).toEqual(binaryData);
    });

    test("should handle repetitive data efficiently", async () => {
      // Highly compressible data
      const repetitive = new TextEncoder().encode("AAAA".repeat(10000));
      const compressed = await compress(repetitive);

      // Should achieve good compression ratio
      expect(compressed.length).toBeLessThan(repetitive.length / 10);

      const decompressed = await decompress(compressed);
      expect(decompressed).toEqual(repetitive);
    });
  });

  describe("createStream (decompression)", () => {
    test("should create transform stream", () => {
      const stream = createStream();

      expect(stream).toBeInstanceOf(TransformStream);
      expect(stream.readable).toBeInstanceOf(ReadableStream);
      expect(stream.writable).toBeInstanceOf(WritableStream);
    });

    test("should decompress streamed data", async () => {
      const original = MOCK_FASTA_DATA;
      const compressed = await compress(original);

      // Create input stream
      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue(compressed);
          controller.close();
        },
      });

      // Pipe through decompression
      const decompressedStream = inputStream.pipeThrough(createStream());

      // Collect output
      const chunks: Uint8Array[] = [];
      const reader = decompressedStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Concatenate and verify
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      expect(result).toEqual(original);
    });
  });

  describe("createCompressionStream", () => {
    test("should create compression transform stream", () => {
      const stream = createCompressionStream();

      expect(stream).toBeInstanceOf(TransformStream);
    });

    test("should compress streamed data", async () => {
      const original = MOCK_FASTA_DATA;

      // Create input stream
      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue(original);
          controller.close();
        },
      });

      // Pipe through compression
      const compressedStream = inputStream.pipeThrough(createCompressionStream());

      // Collect output
      const chunks: Uint8Array[] = [];
      const reader = compressedStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Concatenate
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const compressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        compressed.set(chunk, offset);
        offset += chunk.length;
      }

      // Verify it's valid Zstd
      expect(compressed[0]).toBe(0x28);
      expect(compressed[1]).toBe(0xb5);

      // Verify round-trip
      const decompressed = await decompress(compressed);
      expect(decompressed).toEqual(original);
    });

    test("should accept compression level", async () => {
      const original = MOCK_LARGE_DATA;

      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue(original);
          controller.close();
        },
      });

      const compressedStream = inputStream.pipeThrough(createCompressionStream(9));

      const chunks: Uint8Array[] = [];
      const reader = compressedStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe("wrapStream", () => {
    test("should wrap readable stream for decompression", async () => {
      const original = MOCK_FASTA_DATA;
      const compressed = await compress(original);

      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue(compressed);
          controller.close();
        },
      });

      const decompressedStream = wrapStream(inputStream);
      expect(decompressedStream).toBeInstanceOf(ReadableStream);

      // Read and verify
      const chunks: Uint8Array[] = [];
      const reader = decompressedStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      expect(result).toEqual(original);
    });

    test("should reject invalid input", () => {
      expect(() => wrapStream(null as unknown as ReadableStream)).toThrow(CompressionError);
      expect(() => wrapStream("not a stream" as unknown as ReadableStream)).toThrow(
        CompressionError
      );
    });
  });

  describe("wrapCompressionStream", () => {
    test("should wrap readable stream for compression", async () => {
      const original = MOCK_FASTA_DATA;

      const inputStream = new ReadableStream({
        start(controller) {
          controller.enqueue(original);
          controller.close();
        },
      });

      const compressedStream = wrapCompressionStream(inputStream);
      expect(compressedStream).toBeInstanceOf(ReadableStream);

      // Read compressed data
      const chunks: Uint8Array[] = [];
      const reader = compressedStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const compressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        compressed.set(chunk, offset);
        offset += chunk.length;
      }

      // Verify it decompresses correctly
      const decompressed = await decompress(compressed);
      expect(decompressed).toEqual(original);
    });

    test("should reject invalid input", () => {
      expect(() => wrapCompressionStream(null as unknown as ReadableStream)).toThrow(
        CompressionError
      );
    });
  });

  describe("ZstdDecompressor namespace", () => {
    test("should export all functions", () => {
      expect(typeof ZstdDecompressor.decompress).toBe("function");
      expect(typeof ZstdDecompressor.compress).toBe("function");
      expect(typeof ZstdDecompressor.createStream).toBe("function");
      expect(typeof ZstdDecompressor.createCompressionStream).toBe("function");
      expect(typeof ZstdDecompressor.wrapStream).toBe("function");
      expect(typeof ZstdDecompressor.wrapCompressionStream).toBe("function");
    });

    test("should work via namespace", async () => {
      const original = MOCK_FASTA_DATA;
      const compressed = await ZstdDecompressor.compress(original);
      const decompressed = await ZstdDecompressor.decompress(compressed);

      expect(decompressed).toEqual(original);
    });
  });

  describe("error handling", () => {
    test("should provide detailed error messages", async () => {
      const invalidData = new Uint8Array([0x00, 0x00, 0x00, 0x00]);

      try {
        await decompress(invalidData);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CompressionError);
        if (error instanceof CompressionError) {
          expect(error.format).toBe("zstd");
          expect(error.operation).toBe("validate");
        }
      }
    });

    test("should handle corrupted compressed data", async () => {
      // Valid magic bytes but corrupted content
      const corrupted = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0xff, 0xff, 0xff]);

      await expect(decompress(corrupted)).rejects.toThrow(CompressionError);
    });
  });

  describe("genomic data scenarios", () => {
    test("should handle typical FASTA content", async () => {
      const fasta = `>chr1 Homo sapiens chromosome 1
ACGTACGTACGTACGTACGTACGTACGTACGT
NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN
GCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTA
>chr2 Homo sapiens chromosome 2
TTTTAAAACCCCGGGGTTTTAAAACCCCGGGG
`;
      const original = new TextEncoder().encode(fasta);
      const compressed = await compress(original);
      const decompressed = await decompress(compressed);

      expect(new TextDecoder().decode(decompressed)).toBe(fasta);
    });

    test("should handle typical FASTQ content", async () => {
      const fastq = `@read1 length=50
ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTAC
+
IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII
@read2 length=50
GCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAG
+
HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH
`;
      const original = new TextEncoder().encode(fastq);
      const compressed = await compress(original);
      const decompressed = await decompress(compressed);

      expect(new TextDecoder().decode(decompressed)).toBe(fastq);
    });

    test("should achieve reasonable compression on genomic data", async () => {
      // Real genomic data is moderately compressible
      const sequence = "ACGT".repeat(10000); // 40KB of sequence
      const original = new TextEncoder().encode(sequence);
      const compressed = await compress(original);

      // Should achieve at least 2:1 compression
      expect(compressed.length).toBeLessThan(original.length / 2);
    });
  });
});
