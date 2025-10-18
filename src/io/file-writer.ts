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
import { getPlatform } from "./runtime";

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
 * @param path - File path to write to
 * @param content - String content to write
 * @throws {FileError} When write operation fails
 *
 * @example
 * ```typescript
 * await writeString("output.txt", "Hello, world!");
 * ```
 */
export async function writeString(path: string, content: string): Promise<void> {
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(path, content);
  });

  await Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
}

/**
 * Write binary data to file (overwrites if exists, creates if not)
 *
 * @param path - File path to write to
 * @param content - Binary data to write
 * @throws {FileError} When write operation fails
 *
 * @example
 * ```typescript
 * const data = new TextEncoder().encode("Hello");
 * await writeBytes("output.bin", data);
 * ```
 */
export async function writeBytes(path: string, content: Uint8Array): Promise<void> {
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFile(path, content);
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
 * The file is automatically closed when the callback completes.
 * This is the recommended way to write multiple pieces of data to
 * the same file efficiently.
 *
 * @param path - File path to open
 * @param callback - Function that receives write handle
 * @returns Promise resolving to callback's return value
 * @throws {FileError} When file operations fail
 *
 * @example
 * ```typescript
 * await openForWriting("output.txt", async (handle) => {
 *   await handle.writeString("Line 1\n");
 *   await handle.writeString("Line 2\n");
 *   await handle.writeString("Line 3\n");
 * });
 * // File is automatically closed here
 * ```
 */
export async function openForWriting<T>(
  path: string,
  callback: (handle: FileWriteHandle) => Promise<T>
): Promise<T> {
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Open file for writing (creates if not exists)
    const file = yield* fs.open(path, {
      flag: "w",
      mode: 0o644,
    });

    // Create handle that wraps the file
    const handle: FileWriteHandle = {
      writeString: async (content: string): Promise<void> => {
        const writeProgram = Effect.gen(function* () {
          const encoder = new TextEncoder();
          const data = encoder.encode(content);
          yield* file.writeAll(data);
        });

        await Effect.runPromise(writeProgram);
      },

      writeBytes: async (content: Uint8Array): Promise<void> => {
        const writeProgram = Effect.gen(function* () {
          yield* file.writeAll(content);
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
      Effect.provide(getPlatform())
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
