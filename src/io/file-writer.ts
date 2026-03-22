/**
 * Cross-platform file writing utilities for Node.js, Deno, and Bun.
 *
 * Provides runtime-agnostic file writing operations using Effect Platform.
 * All Effect complexity is hidden behind Promise-based public APIs.
 */

import { Effect, FileSystem, Path } from "effect";
import { CompressionDetector, CompressionService } from "@genotype/core/compression";
import type { WriteOptions } from "@genotype/core/types";
import { FileIOError } from "./file-reader";
import { IOLayer, PlatformLayer } from "./layers";

/**
 * Handle for writing to a file multiple times within a scope.
 */
export interface FileWriteHandle {
  /** Write string content to the file. */
  writeString(content: string): Promise<void>;
  /** Write binary data to the file. */
  writeBytes(content: Uint8Array): Promise<void>;
}

const compressIfNeeded = Effect.fn("FileWriter.compressIfNeeded")(function* (
  data: Uint8Array,
  filePath: string,
  options: WriteOptions = {}
) {
  if (options.autoCompress === false) return data;

  let format = options.compressionFormat ?? "none";
  if (format === "none") {
    format = CompressionDetector.fromExtension(filePath);
  }
  if (format === "none") return data;

  const compressionService = yield* CompressionService;
  return yield* compressionService.compress(data, format, options.compressionLevel ?? 6);
});

const mapWriteError = (filePath: string) =>
  Effect.mapError(
    (e: unknown) =>
      new FileIOError({
        message: e instanceof Error ? e.message : String(e),
        filePath,
        operation: "write",
        cause: e,
      })
  );

/** Write string to file (overwrites if exists, creates if not). Automatically compresses based on file extension. */
export const writeString = (path: string, content: string, options?: WriteOptions): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const data = new TextEncoder().encode(content);
      const finalData = yield* compressIfNeeded(data, path, options);
      yield* fs.writeFile(path, finalData);
    }).pipe(mapWriteError(path), Effect.provide(IOLayer))
  );

/** Write binary data to file (overwrites if exists, creates if not). Automatically compresses based on file extension. */
export const writeBytes = (
  path: string,
  content: Uint8Array,
  options?: WriteOptions
): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const finalData = yield* compressIfNeeded(content, path, options);
      yield* fs.writeFile(path, finalData);
    }).pipe(mapWriteError(path), Effect.provide(IOLayer))
  );

/** Append string to file (creates if not exists). */
export const appendString = (path: string, content: string): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;

      const parentDir = pathService.dirname(path);
      const dirExists = yield* fs.exists(parentDir);
      if (!dirExists) {
        yield* fs.makeDirectory(parentDir, { recursive: true });
      }

      const fileExists = yield* fs.exists(path);
      if (!fileExists) {
        yield* fs.writeFile(path, new Uint8Array(0));
      }

      const file = yield* fs.open(path, { flag: "a" });
      const data = new TextEncoder().encode(content);
      yield* file.writeAll(data);
    }).pipe(mapWriteError(path), Effect.scoped, Effect.provide(PlatformLayer))
  );

/**
 * Open file for writing and execute callback with write handle.
 * File is automatically closed when callback completes, even on error.
 */
export const openForWriting = <T>(
  path: string,
  callback: (handle: FileWriteHandle) => Promise<T>,
  options?: WriteOptions
): Promise<T> => {
  const writeQueue: Array<
    Effect.Effect<void, unknown, FileSystem.FileSystem | CompressionService>
  > = [];

  return Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const file = yield* fs.open(path, { flag: "w", mode: 0o644 });

      const handle = {
        writeString: (content: string) => {
          const data = new TextEncoder().encode(content);
          writeQueue.push(
            compressIfNeeded(data, path, options).pipe(
              Effect.flatMap((compressed) => file.writeAll(compressed))
            )
          );
          return Promise.resolve();
        },
        writeBytes: (content: Uint8Array) => {
          writeQueue.push(
            compressIfNeeded(content, path, options).pipe(
              Effect.flatMap((compressed) => file.writeAll(compressed))
            )
          );
          return Promise.resolve();
        },
      } satisfies FileWriteHandle;

      const result = yield* Effect.promise(() => callback(handle));

      for (const operation of writeQueue) {
        yield* operation;
      }

      return result;
    }).pipe(mapWriteError(path), Effect.scoped, Effect.provide(IOLayer))
  );
};

/** Delete file from filesystem. Does not throw if file doesn't exist. */
export const deleteFile = (path: string): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.remove(path);
    }).pipe(mapWriteError(path), Effect.provide(PlatformLayer))
  );
