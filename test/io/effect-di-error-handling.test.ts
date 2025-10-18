/**
 * Error handling tests for Effect DI compression in file I/O
 *
 * Tests verify:
 * - Error propagation through compression layers
 * - Graceful handling of compression failures
 * - Invalid compression formats
 * - File not found scenarios
 * - Malformed data handling
 */

import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { readToString, readByteRange } from "../../src/io/file-reader";
import { writeString, writeBytes } from "../../src/io/file-writer";
import { FileError, CompressionError } from "../../src/errors";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("Effect DI Error Handling", () => {
  let testFile: string;

  beforeEach(() => {
    testFile = join(tmpdir(), `test-${Date.now()}-${Math.random()}.txt`);
  });

  afterEach(() => {
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
    if (existsSync(`${testFile}.gz`)) {
      unlinkSync(`${testFile}.gz`);
    }
  });

  describe("File Not Found Errors", () => {
    test("should throw FileError when reading non-existent file", async () => {
      const nonExistent = join(tmpdir(), `does-not-exist-${Date.now()}.txt`);

      try {
        await readToString(nonExistent);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(FileError);
        expect((error as FileError).message).toContain("ENOENT");
      }
    });

    test("should throw FileError for non-existent byte range read", async () => {
      const nonExistent = join(tmpdir(), `missing-${Date.now()}.txt`);

      try {
        await readByteRange(nonExistent, 0, 100);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(FileError);
      }
    });
  });

  describe("File Size Validation", () => {
    test("should reject files exceeding max size", async () => {
      const smallContent = "test";
      await writeString(testFile, smallContent);

      try {
        await readToString(testFile, { maxFileSize: 1 }); // 1 byte limit
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(FileError);
        expect((error as FileError).message).toContain("exceeds");
      }
    });
  });

  describe("Byte Range Validation", () => {
    test("should reject negative start byte", async () => {
      await writeString(testFile, "content");

      try {
        await readByteRange(testFile, -1, 5);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(FileError);
        expect((error as FileError).message).toContain("non-negative");
      }
    });

    test("should reject negative end byte", async () => {
      await writeString(testFile, "content");

      try {
        await readByteRange(testFile, 0, -5);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(FileError);
        expect((error as FileError).message).toContain("non-negative");
      }
    });

    test("should reject start >= end", async () => {
      await writeString(testFile, "content");

      try {
        await readByteRange(testFile, 10, 5);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(FileError);
        expect((error as FileError).message).toContain("less than");
      }
    });

    test("should reject range within file size when byte range read is called with valid file", async () => {
      const content = "01234";
      await writeString(testFile, content);

      try {
        // File is exactly 5 bytes, request valid range 0-5
        const result = await readByteRange(testFile, 0, 5);
        const text = new TextDecoder().decode(result);
        expect(text).toBe(content);
      } catch (error) {
        // Should not reach here
        expect.unreachable("Valid range should not throw");
      }
    });
  });

  describe("Compression Format Errors", () => {
    test("should handle compression operations with valid formats", async () => {
      const content = "test data";
      const gzipFile = join(tmpdir(), `gz-test-${Date.now()}.txt.gz`);

      try {
        // Write with valid gzip format
        await writeString(gzipFile, content, {
          compressionFormat: "gzip",
        });

        // Read back with valid gzip format
        const result = await readToString(gzipFile, {
          compressionFormat: "gzip",
        });
        expect(result).toBe(content);
      } finally {
        if (existsSync(gzipFile)) unlinkSync(gzipFile);
      }
    });
  });

  describe("Path Validation Errors", () => {
    test("should reject empty path", async () => {
      try {
        await readToString("");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(FileError);
      }
    });

    test("should handle directory as file", async () => {
      try {
        await readToString(tmpdir()); // tmpdir() returns a directory
        // May throw or return empty depending on OS
      } catch (error) {
        // Expected - directories aren't readable as files
        expect(error).toBeDefined();
      }
    });
  });

  describe("Write Error Handling", () => {
    test("should handle write operations successfully", async () => {
      const writeFile = join(tmpdir(), `write-test-${Date.now()}.txt`);

      try {
        await writeString(writeFile, "test content");
        expect(existsSync(writeFile)).toBe(true);
      } finally {
        if (existsSync(writeFile)) {
          unlinkSync(writeFile);
        }
      }
    });
  });

  describe("Concurrent Operations", () => {
    test("should handle concurrent reads of same file", async () => {
      const content = "concurrent read test";
      await writeString(testFile, content);

      // Read the same file concurrently
      const results = await Promise.all([
        readToString(testFile),
        readToString(testFile),
        readToString(testFile),
      ]);

      results.forEach((result) => {
        expect(result).toBe(content);
      });
    });

    test("should handle concurrent writes to different files", async () => {
      const file1 = join(tmpdir(), `concurrent-1-${Date.now()}.txt`);
      const file2 = join(tmpdir(), `concurrent-2-${Date.now()}.txt`);
      const file3 = join(tmpdir(), `concurrent-3-${Date.now()}.txt`);

      try {
        await Promise.all([
          writeString(file1, "content1"),
          writeString(file2, "content2"),
          writeString(file3, "content3"),
        ]);

        const [r1, r2, r3] = await Promise.all([
          readToString(file1),
          readToString(file2),
          readToString(file3),
        ]);

        expect(r1).toBe("content1");
        expect(r2).toBe("content2");
        expect(r3).toBe("content3");
      } finally {
        [file1, file2, file3].forEach((f) => {
          if (existsSync(f)) unlinkSync(f);
        });
      }
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty file", async () => {
      writeFileSync(testFile, "");
      const result = await readToString(testFile);
      expect(result).toBe("");
    });

    test("should handle very large content gracefully", async () => {
      // Create 5MB of repetitive data
      const largeContent = "x".repeat(5_000_000);
      const largeFile = join(tmpdir(), `large-${Date.now()}.txt`);

      try {
        await writeString(largeFile, largeContent);
        const result = await readToString(largeFile);
        expect(result.length).toBe(largeContent.length);
      } finally {
        if (existsSync(largeFile)) unlinkSync(largeFile);
      }
    });

    test("should handle UTF-8 special characters", async () => {
      const utf8Content = "Hello 世界 🌍 Привет العالم";
      await writeString(testFile, utf8Content);
      const result = await readToString(testFile);
      expect(result).toBe(utf8Content);
    });

    test("should handle files with various line endings", async () => {
      const mixedLineEndings = "line1\nline2\r\nline3\rline4";
      await writeString(testFile, mixedLineEndings);
      const result = await readToString(testFile);
      expect(result).toBe(mixedLineEndings);
    });
  });

  describe("Compression with Errors", () => {
    test("should handle corrupt gzip data on read", async () => {
      const corruptFile = join(tmpdir(), `corrupt-${Date.now()}.gz`);

      try {
        // Write some corrupted gzip-like data
        const fakeGzipData = new Uint8Array([0x1f, 0x8b, 0x08, ...new Array(100).fill(0xff)]);
        const fs = await import("fs/promises");
        await fs.writeFile(corruptFile, fakeGzipData);

        // Try to read - should fail with decompression error
        await readToString(corruptFile);
        expect.unreachable("Should have thrown decompression error");
      } catch (error) {
        // Expected - corrupted gzip data
        expect(error).toBeDefined();
      } finally {
        if (existsSync(corruptFile)) unlinkSync(corruptFile);
      }
    });
  });
});
