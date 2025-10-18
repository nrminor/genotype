/**
 * File writing operations using Effect Platform
 *
 * Provides runtime-agnostic file writing operations that work across
 * Node.js, Bun, and Deno. All Effect complexity is hidden behind
 * Promise-based APIs for ease of use.
 *
 * @module file-writer
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";
import {
  CompressionDetector,
  CompressionService,
  MultiFormatCompressionService,
} from "../compression";
import type { WriteOptions } from "../types";
import { getPlatform } from "./runtime";

// =============================================================================
// PRIVATE HELPER FUNCTIONS
// =============================================================================

/**
 * Apply compression to data if needed based on options and file extension
 *
 * Internal helper used by writeString, writeBytes, and openForWriting.
 * Mirrors the applyDecompression pattern from file-reader.ts for API symmetry.
 *
 * **Implementation Note (Internal):**
 * Uses CompressionService dependency injection via Effect, enabling transparent
 * layer swapping for testing or custom compression implementations.
 * See test/utils/compression-layers.ts for mock service patterns.
 *
 * **Format Detection:**
 * - Auto-detects format from file extension (e.g., ".gz" → gzip)
 * - Respects explicit compressionFormat option if provided
 * - Can be disabled via autoCompress: false option
 *
 * @param data - Uncompressed data to potentially compress
 * @param filePath - File path (used for extension detection)
 * @param options - Write options with compression settings
 * @returns Promise resolving to compressed or original data depending on options
 * @internal Used internally by writeString, writeBytes, and openForWriting
 */
async function applyCompression(
  data: Uint8Array,
  filePath: string,
  options: WriteOptions = {}
): Promise<Uint8Array> {
  // Check if auto-compression is disabled
  const autoCompress = options.autoCompress ?? true; // Default true
  if (!autoCompress) {
    return data; // Return original data uncompressed
  }

  // Determine compression format
  let compressionFormat = options.compressionFormat ?? "none";

  if (compressionFormat === "none") {
    // Auto-detect compression from file extension
    compressionFormat = CompressionDetector.fromExtension(filePath);
  }

  // If no compression detected, return original data
  if (compressionFormat === "none") {
    return data;
  }

  // Build the Effect program that describes the compression
  const program = Effect.gen(function* () {
    // Declare dependency: "I need a CompressionService"
    const compressionService = yield* CompressionService;

    // Compress using injected service with configured level
    const compressed = yield* compressionService.compress(
      data,
      compressionFormat,
      options.compressionLevel ?? 6
    );

    return compressed;
  });

  // Run the Effect with the compression service layer provided
  return Effect.runPromise(program.pipe(Effect.provide(MultiFormatCompressionService)));
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Handle for writing to a file multiple times within a scope
 *
 * The file is automatically closed when the callback completes or throws.
 */
export interface FileWriteHandle {
  /**
   * Write string content to the file
   *
   * @param content - String to write
   */
  writeString(content: string): Promise<void>;

  /**
   * Write binary data to the file
   *
   * @param content - Binary data to write
   */
  writeBytes(content: Uint8Array): Promise<void>;
}

/**
 * Write string to file (overwrites if exists, creates if not)
 *
 * Automatically compresses based on file extension by default using Effect
 * dependency injection for compression services.
 * Use `.gz` extension for gzip compression.
 *
 * **Implementation Note (Internal):**
 * Compression is handled via `applyCompression()` which uses CompressionService
 * dependency injection, enabling transparent layer swapping for testing or custom
 * compression implementations. See `test/utils/compression-layers.ts` for mock patterns.
 *
 * @param path - File path to write to
 * @param content - String content to write
 * @param options - Write options (compression settings, compression level, etc.)
 * @throws {FileError} When write operation fails or path is invalid
 *
 * @example Basic write
 * ```typescript
 * await writeString("output.txt", "Hello, world!");
 * ```
 *
 * @example Automatic gzip compression
 * ```typescript
 * // Auto-detects .gz extension and compresses
 * await writeString("output.fasta.gz", data);
 * ```
 *
 * @example Disable auto-compression
 * ```typescript
 * // Write to .gz file without compression
 * await writeString("output.fasta.gz", data, { autoCompress: false });
 * ```
 *
 * @example Custom compression level
 * ```typescript
 * // Gzip with compression level 9 (maximum compression)
 * await writeString("output.txt.gz", data, { compressionLevel: 9 });
 * ```
 *
 * @internal Uses CompressionService via Effect DI for compression operations
 * @since v0.1.0
 */
export async function writeString(
  path: string,
  content: string,
  options?: WriteOptions
): Promise<void> {
  // Convert string to bytes
  const encoder = new TextEncoder();
  const data = encoder.encode(content);

  // Apply compression if needed
  const finalData = await applyCompression(data, path, options);

  // Write to file
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFile(path, finalData);
  });

  await Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
}

/**
 * Write binary data to file (overwrites if exists, creates if not)
 *
 * Automatically compresses based on file extension by default using Effect
 * dependency injection for compression services.
 * Use `.gz` extension for gzip compression.
 *
 * **Implementation Note (Internal):**
 * Compression is handled via `applyCompression()` which uses CompressionService
 * dependency injection, enabling transparent layer swapping for testing or custom
 * compression implementations. See `test/utils/compression-layers.ts` for mock patterns.
 *
 * @param path - File path to write to
 * @param content - Binary data to write as Uint8Array
 * @param options - Write options (compression settings, compression level, etc.)
 * @throws {FileError} When write operation fails or path is invalid
 *
 * @example Basic binary write
 * ```typescript
 * const data = new TextEncoder().encode("Hello");
 * await writeBytes("output.bin", data);
 * ```
 *
 * @example Automatic gzip compression
 * ```typescript
 * // Auto-detects .gz extension and compresses
 * await writeBytes("output.bin.gz", data);
 * ```
 *
 * @example Custom compression level
 * ```typescript
 * // Gzip with compression level 9 (maximum compression)
 * await writeBytes("output.bin.gz", data, { compressionLevel: 9 });
 * ```
 *
 * @internal Uses CompressionService via Effect DI for compression operations
 * @since v0.1.0
 */
export async function writeBytes(
  path: string,
  content: Uint8Array,
  options?: WriteOptions
): Promise<void> {
  // Apply compression if needed
  const finalData = await applyCompression(content, path, options);

  // Write to file
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFile(path, finalData);
  });

  await Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
}

/**
 * Append string to file (creates if not exists)
 *
 * @param path - File path to append to
 * @param content - String content to append
 * @throws {FileError} When append operation fails
 *
 * @example
 * ```typescript
 * await appendString("log.txt", "New log entry\n");
 * ```
 */
export async function appendString(path: string, content: string): Promise<void> {
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    // Ensure parent directory exists
    const parentDir = pathService.dirname(path);
    const dirExists = yield* fs.exists(parentDir);
    if (!dirExists) {
      yield* fs.makeDirectory(parentDir, { recursive: true });
    }

    // Create empty file if it doesn't exist
    const fileExists = yield* fs.exists(path);
    if (!fileExists) {
      yield* fs.writeFile(path, new Uint8Array(0));
    }

    // Open file in append mode
    const file = yield* fs.open(path, { flag: "a" });

    // Encode content to bytes
    const encoder = new TextEncoder();
    const data = encoder.encode(content);

    // Write (append) data to file
    yield* file.writeAll(data);

    // File automatically closes when scope exits
  });

  await Effect.runPromise(
    program.pipe(
      Effect.scoped, // Required for automatic file handle cleanup
      Effect.provide(getPlatform())
    )
  );
}

/**
 * Open file for writing and execute callback with write handle
 *
 * The file is automatically closed when the callback completes via Effect's
 * scoped resource management. This is the recommended way to write multiple
 * pieces of data to the same file efficiently.
 *
 * Automatically compresses based on file extension by default using Effect
 * dependency injection for compression services.
 * For streaming compression, each write is compressed incrementally.
 *
 * **Implementation Note (Internal):**
 * Uses CompressionService dependency injection via Effect, enabling transparent
 * layer swapping for testing or custom compression implementations.
 * Write handle methods (writeString, writeBytes) use applyCompression internally.
 * See test/utils/compression-layers.ts for mock service patterns.
 *
 * **Resource Management:**
 * File is automatically opened with 644 permissions and closed when:
 * - Callback completes successfully
 * - Callback throws an error
 * - Any write operation fails
 *
 * @param path - File path to open (creates if not exists, overwrites if exists)
 * @param callback - Function that receives write handle and returns result
 * @param options - Write options (compression settings, compression level, etc.)
 * @returns Promise resolving to callback's return value
 * @throws {FileError} When file operations fail or path is invalid
 *
 * @example Basic sequential writes
 * ```typescript
 * await openForWriting("output.txt", async (handle) => {
 *   await handle.writeString("Line 1\n");
 *   await handle.writeString("Line 2\n");
 *   await handle.writeString("Line 3\n");
 * });
 * // File is automatically closed here
 * ```
 *
 * @example Streaming with automatic gzip compression
 * ```typescript
 * await openForWriting("sequences.fasta.gz", async (handle) => {
 *   for (const sequence of sequences) {
 *     await handle.writeString(`>${sequence.id}\n${sequence.sequence}\n`);
 *   }
 * }); // Each write is incrementally compressed
 * ```
 *
 * @example Custom compression level
 * ```typescript
 * await openForWriting("output.txt.gz", async (handle) => {
 *   await handle.writeString("High compression");
 * }, { compressionLevel: 9 });
 * ```
 *
 * @internal Uses CompressionService via Effect DI for compression operations
 * @since v0.1.0
 */
export async function openForWriting<T>(
  path: string,
  callback: (handle: FileWriteHandle) => Promise<T>,
  options?: WriteOptions
): Promise<T> {
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Open file for writing (creates if not exists)
    const file = yield* fs.open(path, {
      flag: "w",
      mode: 0o644,
    });

    // Create handle that wraps the file with compression support
    // Both writeString and writeBytes use applyCompression, which now uses Effect DI
    const handle: FileWriteHandle = {
      writeString: async (content: string): Promise<void> => {
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        // applyCompression now uses Effect DI internally
        const compressedData = await applyCompression(data, path, options);

        const writeProgram = Effect.gen(function* () {
          yield* file.writeAll(compressedData);
        });

        await Effect.runPromise(writeProgram);
      },

      writeBytes: async (content: Uint8Array): Promise<void> => {
        // applyCompression now uses Effect DI internally
        const compressedData = await applyCompression(content, path, options);

        const writeProgram = Effect.gen(function* () {
          yield* file.writeAll(compressedData);
        });

        await Effect.runPromise(writeProgram);
      },
    };

    // Execute callback with handle
    // Effect's scope will auto-close the file when this completes
    return yield* Effect.promise(() => callback(handle));
  });

  return await Effect.runPromise(
    program.pipe(
      Effect.scoped, // Enable scope for automatic file cleanup
      Effect.provide(getPlatform()),
      Effect.provide(MultiFormatCompressionService)
    )
  );
}

/**
 * Delete file from filesystem
 *
 * Removes a file if it exists. Does not throw if file doesn't exist.
 * Useful for cleanup operations like removing temporary files.
 *
 * @param path - File path to delete
 * @throws {FileError} When deletion fails (other than file not existing)
 *
 * @example
 * ```typescript
 * // Clean up temporary file
 * await deleteFile("/tmp/sort_12345.tmp");
 * ```
 */
export async function deleteFile(path: string): Promise<void> {
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(path);
  });

  await Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
}
