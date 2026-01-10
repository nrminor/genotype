/**
 * Cross-platform file writing utilities for Node.js, Deno, and Bun
 *
 * Provides runtime-agnostic file writing operations using Effect Platform.
 * All Effect complexity is hidden behind Promise-based APIs.
 */

import { FileSystem, Path } from "@effect/platform";
import { Effect, Layer } from "effect";
import {
  CompressionDetector,
  CompressionService,
  MultiFormatCompressionService,
} from "../compression";
import type { WriteOptions } from "../types";
import { getPlatform } from "./runtime";

// =============================================================================
// CONSTANTS
// =============================================================================

/** Merged layer providing both platform and compression services */
const FullLayer = Layer.merge(getPlatform(), MultiFormatCompressionService);

// =============================================================================
// TYPES
// =============================================================================

/**
 * Handle for writing to a file multiple times within a scope
 */
export interface FileWriteHandle {
  /** Write string content to the file */
  writeString(content: string): Promise<void>;
  /** Write binary data to the file */
  writeBytes(content: Uint8Array): Promise<void>;
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Effect that compresses data if needed based on options and file extension
 *
 * This is the single source of truth for compression logic.
 */
function compressEffect(
  data: Uint8Array,
  filePath: string,
  options: WriteOptions = {}
): Effect.Effect<Uint8Array, unknown, CompressionService> {
  return Effect.gen(function* () {
    // Check if auto-compression is disabled
    if (options.autoCompress === false) {
      return data;
    }

    // Determine compression format
    let format = options.compressionFormat ?? "none";
    if (format === "none") {
      format = CompressionDetector.fromExtension(filePath);
    }

    // No compression needed
    if (format === "none") {
      return data;
    }

    // Compress using injected service
    const compressionService = yield* CompressionService;
    return yield* compressionService.compress(
      data,
      format,
      options.compressionLevel ?? 6
    );
  });
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Write string to file (overwrites if exists, creates if not)
 *
 * Automatically compresses based on file extension (.gz for gzip, .zst for zstd).
 *
 * @param path - File path to write to
 * @param content - String content to write
 * @param options - Write options (compression settings)
 *
 * @example Basic write
 * ```typescript
 * await writeString("output.txt", "Hello, world!");
 * ```
 *
 * @example Auto-compressed gzip
 * ```typescript
 * await writeString("output.fasta.gz", data);
 * ```
 *
 * @example Disable compression
 * ```typescript
 * await writeString("output.gz", data, { autoCompress: false });
 * ```
 */
export async function writeString(
  path: string,
  content: string,
  options?: WriteOptions
): Promise<void> {
  const data = new TextEncoder().encode(content);

  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const finalData = yield* compressEffect(data, path, options);
    yield* fs.writeFile(path, finalData);
  });

  await Effect.runPromise(program.pipe(Effect.provide(FullLayer)));
}

/**
 * Write binary data to file (overwrites if exists, creates if not)
 *
 * Automatically compresses based on file extension (.gz for gzip, .zst for zstd).
 *
 * @param path - File path to write to
 * @param content - Binary data to write
 * @param options - Write options (compression settings)
 *
 * @example Basic binary write
 * ```typescript
 * await writeBytes("output.bin", new Uint8Array([1, 2, 3]));
 * ```
 */
export async function writeBytes(
  path: string,
  content: Uint8Array,
  options?: WriteOptions
): Promise<void> {
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const finalData = yield* compressEffect(content, path, options);
    yield* fs.writeFile(path, finalData);
  });

  await Effect.runPromise(program.pipe(Effect.provide(FullLayer)));
}

/**
 * Append string to file (creates if not exists)
 *
 * @param path - File path to append to
 * @param content - String content to append
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

    // Open file in append mode and write
    const file = yield* fs.open(path, { flag: "a" });
    const data = new TextEncoder().encode(content);
    yield* file.writeAll(data);
  });

  await Effect.runPromise(
    program.pipe(Effect.scoped, Effect.provide(getPlatform()))
  );
}

/**
 * Open file for writing and execute callback with write handle
 *
 * File is automatically closed when callback completes.
 * Each write is compressed incrementally if compression is enabled.
 *
 * @param path - File path to open
 * @param callback - Function that receives write handle
 * @param options - Write options (compression settings)
 * @returns Callback's return value
 *
 * @example Sequential writes
 * ```typescript
 * await openForWriting("output.txt", async (handle) => {
 *   await handle.writeString("Line 1\n");
 *   await handle.writeString("Line 2\n");
 * });
 * ```
 *
 * @example Streaming with compression
 * ```typescript
 * await openForWriting("sequences.fasta.gz", async (handle) => {
 *   for (const seq of sequences) {
 *     await handle.writeString(`>${seq.id}\n${seq.sequence}\n`);
 *   }
 * });
 * ```
 */
export async function openForWriting<T>(
  path: string,
  callback: (handle: FileWriteHandle) => Promise<T>,
  options?: WriteOptions
): Promise<T> {
  // Queue of write operations to execute within Effect scope
  const writeQueue: Array<Effect.Effect<void, unknown, FileSystem.FileSystem | CompressionService>> = [];

  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Open file for writing
    const file = yield* fs.open(path, { flag: "w", mode: 0o644 });

    // Create handle that queues operations
    const handle: FileWriteHandle = {
      writeString: (content: string) => {
        const data = new TextEncoder().encode(content);
        writeQueue.push(
          compressEffect(data, path, options).pipe(
            Effect.flatMap((compressed) => file.writeAll(compressed))
          )
        );
        return Promise.resolve();
      },

      writeBytes: (content: Uint8Array) => {
        writeQueue.push(
          compressEffect(content, path, options).pipe(
            Effect.flatMap((compressed) => file.writeAll(compressed))
          )
        );
        return Promise.resolve();
      },
    };

    // Execute callback (queues operations)
    const result = yield* Effect.promise(() => callback(handle));

    // Execute all queued writes
    for (const operation of writeQueue) {
      yield* operation;
    }

    return result;
  });

  return await Effect.runPromise(
    program.pipe(Effect.scoped, Effect.provide(FullLayer))
  );
}

/**
 * Delete file from filesystem
 *
 * Does not throw if file doesn't exist.
 *
 * @param path - File path to delete
 *
 * @example
 * ```typescript
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
