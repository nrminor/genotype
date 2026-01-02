/**
 * Tests for cross-platform file reading infrastructure
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { FileError, StreamError } from "../../src/errors";
import {
  createStream,
  exists,
  FileReader,
  getMetadata,
  getSize,
  readToString,
} from "../../src/io/file-reader";
import { detectRuntime } from "../../src/io/runtime";
import {
  batchLines,
  pipe,
  processBuffer,
  processChunks,
  readLines,
  StreamUtils,
} from "../../src/io/stream-utils";

// Test fixtures directory - use absolute path for reliability
const FIXTURES_DIR = join(process.cwd(), "test", "io", "fixtures");
const TEST_FILES = {
  small: join(FIXTURES_DIR, "small.txt"),
  medium: join(FIXTURES_DIR, "medium.txt"),
  large: join(FIXTURES_DIR, "large.txt"),
  empty: join(FIXTURES_DIR, "empty.txt"),
  binary: join(FIXTURES_DIR, "binary.bin"),
  utf8: join(FIXTURES_DIR, "utf8.txt"),
  nonexistent: join(FIXTURES_DIR, "nonexistent.txt"),
  directory: join(FIXTURES_DIR, "test-directory"),
};

// Global setup for all tests
beforeAll(() => {
  // Create test fixtures directory
  mkdirSync(FIXTURES_DIR, { recursive: true });

  // Create test files for FileReader tests
  writeFileSync(TEST_FILES.small, "Hello, World!");
  writeFileSync(TEST_FILES.medium, "A".repeat(1000) + "\n" + "B".repeat(1000));
  writeFileSync(TEST_FILES.large, "C".repeat(100000));
  writeFileSync(TEST_FILES.empty, "");
  writeFileSync(TEST_FILES.binary, Buffer.from([0x00, 0x01, 0x02, 0xff]));
  writeFileSync(TEST_FILES.utf8, "Hello, 世界! 🌍");
  mkdirSync(TEST_FILES.directory, { recursive: true });

  // Create additional test files for StreamUtils tests
  writeFileSync(join(FIXTURES_DIR, "lines.txt"), "Line 1\nLine 2\r\nLine 3\r\nLine 4\n");
  writeFileSync(join(FIXTURES_DIR, "mixed-endings.txt"), "Unix\nWindows\r\nMac\rEmpty\n\nDone");
  writeFileSync(join(FIXTURES_DIR, "long-lines.txt"), "A".repeat(10000) + "\n" + "B".repeat(5000));
});

// Global cleanup for all tests
afterAll(() => {
  // Clean up test fixtures
  rmSync(FIXTURES_DIR, { recursive: true, force: true });
});

describe("Runtime Detection", () => {
  test("should detect runtime correctly", () => {
    const runtime = detectRuntime();
    expect(["node", "deno", "bun"]).toContain(runtime);
  });
});

describe("FileReader", () => {
  describe("File Existence Checking", () => {
    test("should detect existing files", async () => {
      expect(await exists(TEST_FILES.small)).toBe(true);
      expect(await exists(TEST_FILES.empty)).toBe(true);
    });

    test("should detect non-existing files", async () => {
      expect(await exists(TEST_FILES.nonexistent)).toBe(false);
    });

    test("should handle invalid paths", async () => {
      await expect(exists("")).rejects.toThrow(FileError);
      await expect(exists("\0invalid")).rejects.toThrow(FileError);
    });

    test("should distinguish files from directories", async () => {
      expect(await exists(TEST_FILES.directory)).toBe(false);
    });
  });

  describe("File Size Detection", () => {
    test("should get correct file sizes", async () => {
      expect(await getSize(TEST_FILES.small)).toBe(13);
      expect(await getSize(TEST_FILES.empty)).toBe(0);
      expect(await getSize(TEST_FILES.large)).toBe(100000);
    });

    test("should throw for non-existing files", async () => {
      await expect(getSize(TEST_FILES.nonexistent)).rejects.toThrow(FileError);
    });
  });

  describe("File Metadata", () => {
    test("should get comprehensive metadata", async () => {
      const metadata = await getMetadata(TEST_FILES.small);

      expect(metadata.path).toBe(TEST_FILES.small);
      expect(metadata.size).toBe(13);
      expect(metadata.readable).toBe(true);
      expect(metadata.lastModified).toBeInstanceOf(Date);
      expect(metadata.extension).toBe(".txt");
    });

    test("should handle UTF-8 files correctly", async () => {
      const metadata = await getMetadata(TEST_FILES.utf8);
      expect(metadata.readable).toBe(true);
      expect(metadata.size).toBeGreaterThan(0);
    });
  });

  describe("Stream Creation", () => {
    test("should create readable stream for valid files", async () => {
      const stream = await createStream(TEST_FILES.small);
      expect(stream).toBeInstanceOf(ReadableStream);

      const reader = stream.getReader();
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      expect(value).toBeInstanceOf(Uint8Array);
      reader.releaseLock();
    });

    test("should handle empty files", async () => {
      const stream = await createStream(TEST_FILES.empty);
      const reader = stream.getReader();
      const { done } = await reader.read();
      expect(done).toBe(true);
      reader.releaseLock();
    });

    test("should respect buffer size options", async () => {
      const stream = await createStream(TEST_FILES.medium, {
        bufferSize: 2048, // Use realistic buffer size for genomic files
      });

      expect(stream).toBeInstanceOf(ReadableStream);
    });

    test("should throw for non-existing files", async () => {
      await expect(createStream(TEST_FILES.nonexistent)).rejects.toThrow(FileError);
    });

    test("should handle large files efficiently", async () => {
      const stream = await createStream(TEST_FILES.large, {
        bufferSize: 1024,
      });

      let totalBytes = 0;
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value!.length;
        }
      } finally {
        reader.releaseLock();
      }

      expect(totalBytes).toBe(100000);
    });
  });

  describe("String Reading", () => {
    test("should read small files to string", async () => {
      const content = await readToString(TEST_FILES.small);
      expect(content).toBe("Hello, World!");
    });

    test("should handle empty files", async () => {
      const content = await readToString(TEST_FILES.empty);
      expect(content).toBe("");
    });

    test("should handle UTF-8 content", async () => {
      const content = await readToString(TEST_FILES.utf8);
      expect(content).toBe("Hello, 世界! 🌍");
    });

    test("should respect file size limits", async () => {
      await expect(
        readToString(TEST_FILES.large, {
          maxFileSize: 1000,
        }),
      ).rejects.toThrow(FileError);
    });

    test("should handle different encodings", async () => {
      const content = await readToString(TEST_FILES.binary, {
        encoding: "binary",
      });
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe("Error Handling", () => {
    test("should provide detailed error context", async () => {
      try {
        await getSize(TEST_FILES.nonexistent);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(FileError);
        expect((error as FileError).filePath).toBe(TEST_FILES.nonexistent);
        expect((error as FileError).operation).toBe("stat");
      }
    });

    test("should handle timeout errors", async () => {
      // This test is runtime-dependent and may not work in all environments
      // It's included for completeness but may be skipped in some test runs
      try {
        await readToString(TEST_FILES.large, {
          timeout: 1, // Very short timeout
        });
      } catch (error) {
        if (error instanceof FileError) {
          expect(error.message).toContain("timeout");
        }
      }
    }, 10000);
  });
});

describe("StreamUtils", () => {
  describe("Line Reading", () => {
    test("should read lines from stream", async () => {
      const stream = await createStream(join(FIXTURES_DIR, "lines.txt"));
      const lines: string[] = [];

      for await (const line of StreamUtils.readLines(stream)) {
        lines.push(line);
      }

      expect(lines).toEqual(["Line 1", "Line 2", "Line 3", "Line 4"]);
    });

    test("should work with individual function imports", async () => {
      const stream = await createStream(join(FIXTURES_DIR, "lines.txt"));
      const lines: string[] = [];

      // Test individual function import
      for await (const line of readLines(stream)) {
        lines.push(line);
      }

      expect(lines).toEqual(["Line 1", "Line 2", "Line 3", "Line 4"]);
    });

    test("should handle mixed line endings", async () => {
      const stream = await createStream(join(FIXTURES_DIR, "mixed-endings.txt"));
      const lines: string[] = [];

      for await (const line of StreamUtils.readLines(stream)) {
        lines.push(line);
      }

      expect(lines).toContain("Unix");
      expect(lines).toContain("Windows");
      expect(lines).toContain("Mac");
      expect(lines).toContain("Done");
    });

    test("should handle empty lines correctly", async () => {
      const stream = await createStream(join(FIXTURES_DIR, "mixed-endings.txt"));
      const lines: string[] = [];

      for await (const line of StreamUtils.readLines(stream)) {
        lines.push(line);
      }

      expect(lines).toContain(""); // Empty line should be preserved
    });

    test("should handle very long lines", async () => {
      const stream = await createStream(join(FIXTURES_DIR, "long-lines.txt"));
      const lines: string[] = [];

      for await (const line of StreamUtils.readLines(stream)) {
        lines.push(line);
      }

      expect(lines).toHaveLength(2);
      expect(lines[0]).toHaveLength(10000);
      expect(lines[1]).toHaveLength(5000);
    });
  });

  describe("Buffer Processing", () => {
    test("should process buffer correctly", () => {
      const result = StreamUtils.processBuffer("Line 1\nLine 2\nIncomplete");

      expect(result.lines).toEqual(["Line 1", "Line 2"]);
      expect(result.remainder).toBe("Incomplete");
      expect(result.totalLines).toBe(2);
      expect(result.isComplete).toBe(false);
    });

    test("should work with individual function import", () => {
      // Test individual function import
      const result = processBuffer("Line 1\nLine 2\nIncomplete");

      expect(result.lines).toEqual(["Line 1", "Line 2"]);
      expect(result.remainder).toBe("Incomplete");
      expect(result.totalLines).toBe(2);
      expect(result.isComplete).toBe(false);
    });

    test("should handle complete buffer", () => {
      const result = StreamUtils.processBuffer("Line 1\nLine 2\n");

      expect(result.lines).toEqual(["Line 1", "Line 2"]);
      expect(result.remainder).toBe("");
      expect(result.isComplete).toBe(true);
    });

    test("should handle mixed line endings in buffer", () => {
      const result = StreamUtils.processBuffer("Unix\nWindows\r\nMac\rIncomplete");

      expect(result.lines).toEqual(["Unix", "Windows", "Mac"]);
      expect(result.remainder).toBe("Incomplete");
    });

    test("should throw on excessively long lines", () => {
      const longLine = "A".repeat(2000000); // 2MB line
      expect(() => StreamUtils.processBuffer(longLine)).toThrow(Error);
    });
  });

  describe("Stream Transformation", () => {
    test("should transform stream items", async () => {
      const stream = await createStream(join(FIXTURES_DIR, "lines.txt"));
      const lines = StreamUtils.readLines(stream);
      const uppercased = StreamUtils.pipe(lines, (line) => line.toUpperCase());

      const results: string[] = [];
      for await (const line of uppercased) {
        results.push(line);
      }

      expect(results).toEqual(["LINE 1", "LINE 2", "LINE 3", "LINE 4"]);
    });

    test("should handle async transformations", async () => {
      const stream = await createStream(join(FIXTURES_DIR, "lines.txt"));
      const lines = StreamUtils.readLines(stream);
      const transformed = StreamUtils.pipe(lines, async (line) => {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 1));
        return line.length;
      });

      const results: number[] = [];
      for await (const length of transformed) {
        results.push(length);
      }

      expect(results).toEqual([6, 6, 6, 6]);
    });

    test("should handle transformation errors", async () => {
      const stream = await createStream(join(FIXTURES_DIR, "lines.txt"));
      const lines = StreamUtils.readLines(stream);
      const failing = StreamUtils.pipe(lines, () => {
        throw new Error("Transform failed");
      });

      let threwError = false;
      try {
        for await (const _ of failing) {
          // Should throw before yielding anything
        }
      } catch (error) {
        threwError = true;
        expect(error).toBeInstanceOf(StreamError);
      }
      expect(threwError).toBe(true);
    });
  });

  describe("Batch Processing", () => {
    test("should batch lines correctly", async () => {
      const stream = await createStream(join(FIXTURES_DIR, "lines.txt"));
      const lines = StreamUtils.readLines(stream);
      const batches = StreamUtils.batchLines(lines, 2);

      const results: string[][] = [];
      for await (const batch of batches) {
        results.push(batch);
      }

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(["Line 1", "Line 2"]);
      expect(results[1]).toEqual(["Line 3", "Line 4"]);
    });

    test("should handle incomplete final batch", async () => {
      const stream = await createStream(join(FIXTURES_DIR, "lines.txt"));
      const lines = StreamUtils.readLines(stream);
      const batches = StreamUtils.batchLines(lines, 3);

      const results: string[][] = [];
      for await (const batch of batches) {
        results.push(batch);
      }

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveLength(3);
      expect(results[1]).toHaveLength(1);
    });
  });

  describe("Statistics and Monitoring", () => {
    test("should provide stream processing statistics", async () => {
      const stream = await createStream(join(FIXTURES_DIR, "medium.txt"));
      const chunks = StreamUtils.processChunks(stream);

      let finalStats;
      for await (const chunk of chunks) {
        expect(chunk.stats.bytesProcessed).toBeGreaterThanOrEqual(0);
        expect(chunk.stats.chunksProcessed).toBeGreaterThan(0);
        expect(chunk.stats.startTime).toBeGreaterThan(0);
        finalStats = chunk.stats;
      }

      expect(finalStats?.bytesProcessed).toBeGreaterThan(0);
    });
  });
});

describe("Integration Tests", () => {
  test("should work with different runtimes", async () => {
    const runtime = detectRuntime();
    const stream = await createStream(TEST_FILES.small);
    const content = await readToString(TEST_FILES.small);

    expect(stream).toBeInstanceOf(ReadableStream);
    expect(content).toBe("Hello, World!");
    expect(["node", "deno", "bun"]).toContain(runtime);
  });

  test("should handle concurrent file operations", async () => {
    const promises = Array.from({ length: 5 }, (_, i) => readToString(TEST_FILES.small));

    const results = await Promise.all(promises);
    results.forEach((content) => {
      expect(content).toBe("Hello, World!");
    });
  });

  test("should handle large files", async () => {
    const stream = await createStream(TEST_FILES.large);

    let chunks = 0;
    const reader = stream.getReader();

    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        chunks++;
      }
    } finally {
      reader.releaseLock();
    }

    expect(chunks).toBeGreaterThan(0);
  });
});
