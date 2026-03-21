/**
 * Cross-platform file reading utilities for Node.js, Deno, and Bun.
 *
 * Provides a unified interface for file I/O operations across different
 * JavaScript runtimes using Effect Platform for runtime abstraction.
 *
 * The primary exports are Effect-returning functions (createStream, exists,
 * getSize, etc.) that compose into Effect pipelines without spawning
 * additional runtimes. Promise-suffixed wrappers (createStreamPromise, etc.)
 * are provided for non-Effect callers.
 */

import { type } from "arktype";
import { Effect, FileSystem, Schema, Stream } from "effect";
import { CompressionDetector, CompressionService, createDecompressor } from "../compression";
import type { FileMetadata, FileReaderOptions } from "../types";
import { FilePathSchema, FileReaderOptionsSchema } from "../types";
import { IOLayer, PlatformLayer } from "./layers";

/** Typed error for file I/O failures within Effect pipelines. */
export class FileIOError extends Schema.TaggedErrorClass<FileIOError>()("FileIOError", {
  message: Schema.String,
  filePath: Schema.String,
  operation: Schema.Literals(["read", "write", "stat", "open", "close", "seek"] as const),
  cause: Schema.optional(Schema.Defect),
}) {}

const DEFAULT_OPTIONS = {
  bufferSize: 65536,
  encoding: "utf8" as const,
  maxFileSize: 104_857_600,
  timeout: 30000,
  concurrent: false,
  autoDecompress: true,
  compressionFormat: "none" as const,
  decompressionOptions: {},
} satisfies FileReaderOptions;

const validatePath = (path: string) =>
  Effect.try({
    try: () => {
      const result = FilePathSchema(path);
      if (result instanceof type.errors) throw result;
      return result;
    },
    catch: (error) =>
      new FileIOError({
        message: `Invalid file path: ${error instanceof type.errors ? error.summary : error instanceof Error ? error.message : String(error)}`,
        filePath: path,
        operation: "stat",
        cause: error instanceof type.errors ? undefined : error,
      }),
  });

const mergeAndValidateOptions = (options: FileReaderOptions) => {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  const result = FileReaderOptionsSchema(merged);
  if (result instanceof type.errors) {
    return Effect.fail(
      new FileIOError({
        message: `Invalid options: ${result.summary}`,
        filePath: "",
        operation: "read",
      })
    );
  }
  return Effect.succeed(merged);
};

const mapPlatformError = (filePath: string, operation: "read" | "stat") =>
  Effect.mapError(
    (e: unknown) =>
      new FileIOError({
        message: e instanceof Error ? e.message : String(e),
        filePath,
        operation,
        cause: e,
      })
  );

const exists = Effect.fn("FileReader.exists")(function* (path: string) {
  const validatedPath = yield* validatePath(path);
  const fs = yield* FileSystem.FileSystem;
  const pathExists = yield* fs.exists(validatedPath);
  if (!pathExists) return false;
  const info = yield* fs.stat(validatedPath);
  return info.type === "File";
});

const getSize = Effect.fn("FileReader.getSize")(function* (path: string) {
  const validatedPath = yield* validatePath(path);
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(validatedPath);
  return Number(info.size);
});

const getMetadata = Effect.fn("FileReader.getMetadata")(function* (path: string) {
  const validatedPath = yield* validatePath(path);
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(validatedPath);
  return {
    path: validatedPath,
    size: Number(info.size),
    lastModified: new Date(Number(info.mtime)),
    readable: true,
    writable: false,
    extension: validatedPath.substring(validatedPath.lastIndexOf(".")),
  } satisfies FileMetadata;
});

const readToString = Effect.fn("FileReader.readToString")(function* (
  path: string,
  options: FileReaderOptions
) {
  const validatedPath = yield* validatePath(path);
  const mergedOptions = yield* mergeAndValidateOptions(options);

  let compressionFormat = mergedOptions.compressionFormat;
  if (compressionFormat === "none") {
    compressionFormat = CompressionDetector.fromExtension(validatedPath);
  }

  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(validatedPath);
  if (Number(info.size) > mergedOptions.maxFileSize) {
    return yield* new FileIOError({
      message: `File too large: ${info.size} bytes exceeds limit of ${mergedOptions.maxFileSize} bytes`,
      filePath: validatedPath,
      operation: "read",
    });
  }

  if (!mergedOptions.autoDecompress || compressionFormat === "none") {
    return yield* fs.readFileString(validatedPath);
  }

  const compressionService = yield* CompressionService;
  const compressedBytes = yield* fs.readFile(validatedPath);
  const decompressedBytes = yield* compressionService.decompress(
    compressedBytes,
    compressionFormat
  );
  return new TextDecoder().decode(decompressedBytes);
});

const readByteRange = Effect.fn("FileReader.readByteRange")(function* (
  path: string,
  start: number,
  end: number
) {
  const validatedPath = yield* validatePath(path);

  if (start < 0 || end < 0) {
    return yield* new FileIOError({
      message: "Byte range must be non-negative",
      filePath: validatedPath,
      operation: "read",
    });
  }
  if (start >= end) {
    return yield* new FileIOError({
      message: "Start byte must be less than end byte",
      filePath: validatedPath,
      operation: "read",
    });
  }

  const compressionFormat = CompressionDetector.fromExtension(validatedPath);
  const fs = yield* FileSystem.FileSystem;

  let data: Uint8Array;
  if (compressionFormat === "none") {
    data = yield* fs.readFile(validatedPath);
  } else {
    const compressionService = yield* CompressionService;
    const compressedBytes = yield* fs.readFile(validatedPath);
    data = yield* compressionService.decompress(compressedBytes, compressionFormat);
  }

  if (start >= data.length || end > data.length) {
    return yield* new FileIOError({
      message: `Byte range [${start}, ${end}) exceeds file size ${data.length}`,
      filePath: validatedPath,
      operation: "read",
    });
  }

  return data.slice(start, end);
});

const createStream = Effect.fn("FileReader.createStream")(function* (
  path: string,
  options: FileReaderOptions
) {
  const validatedPath = yield* validatePath(path);
  const mergedOptions = yield* mergeAndValidateOptions(options);
  const fs = yield* FileSystem.FileSystem;

  const pathExists = yield* fs.exists(validatedPath);
  if (!pathExists) {
    return yield* new FileIOError({
      message: `File not found: ${validatedPath}`,
      filePath: validatedPath,
      operation: "read",
    });
  }

  const info = yield* fs.stat(validatedPath);
  if (Number(info.size) > mergedOptions.maxFileSize) {
    return yield* new FileIOError({
      message: `File size ${info.size} exceeds maximum ${mergedOptions.maxFileSize}`,
      filePath: validatedPath,
      operation: "read",
    });
  }

  const effectStream = fs.stream(validatedPath, { chunkSize: mergedOptions.bufferSize });
  let stream = Stream.toReadableStream(effectStream);

  if (mergedOptions.autoDecompress) {
    let compressionFormat = mergedOptions.compressionFormat;
    if (compressionFormat === "none") {
      compressionFormat = CompressionDetector.fromExtension(validatedPath);
    }
    if (compressionFormat !== "none") {
      const decompressor = createDecompressor(compressionFormat);
      stream = decompressor.wrapStream(stream, {
        ...mergedOptions.decompressionOptions,
        bufferSize: mergedOptions.bufferSize,
      });
    }
  }

  return stream;
});

// ---------------------------------------------------------------------------
// Effect API (primary) — compose into pipelines without spawning runtimes
// ---------------------------------------------------------------------------

export { exists, getSize, getMetadata, readToString, readByteRange, createStream };
export { mapPlatformError, validatePath };

// ---------------------------------------------------------------------------
// Promise API — for non-Effect callers. The unsuffixed aliases preserve
// backwards compatibility with existing consumers; the suffixed variants
// make the async nature explicit at the call site.
// ---------------------------------------------------------------------------

/** Check if a file exists and is accessible. */
const existsPromise = (path: string, runOptions?: Effect.RunOptions): Promise<boolean> =>
  Effect.runPromise(
    exists(path).pipe(mapPlatformError(path, "stat"), Effect.provide(PlatformLayer)),
    runOptions
  );

/** Get file size in bytes. */
const getSizePromise = (path: string, runOptions?: Effect.RunOptions): Promise<number> =>
  Effect.runPromise(
    getSize(path).pipe(mapPlatformError(path, "stat"), Effect.provide(PlatformLayer)),
    runOptions
  );

/** Get comprehensive file metadata. */
const getMetadataPromise = (path: string, runOptions?: Effect.RunOptions): Promise<FileMetadata> =>
  Effect.runPromise(
    getMetadata(path).pipe(mapPlatformError(path, "stat"), Effect.provide(PlatformLayer)),
    runOptions
  );

/**
 * Read entire file to string. Automatically decompresses gzip/zstd
 * files based on extension. Pass { signal } in runOptions for cancellation.
 */
const readToStringPromise = (
  path: string,
  options: FileReaderOptions = {},
  runOptions?: Effect.RunOptions
): Promise<string> =>
  Effect.runPromise(
    readToString(path, options).pipe(mapPlatformError(path, "read"), Effect.provide(IOLayer)),
    runOptions
  );

/** Read a specific byte range from a file. */
const readByteRangePromise = (
  path: string,
  start: number,
  end: number,
  runOptions?: Effect.RunOptions
): Promise<Uint8Array> =>
  Effect.runPromise(
    readByteRange(path, start, end).pipe(mapPlatformError(path, "read"), Effect.provide(IOLayer)),
    runOptions
  );

/** Create a streaming reader for a file with optional auto-decompression. */
const createStreamPromise = (
  path: string,
  options: FileReaderOptions = {},
  runOptions?: Effect.RunOptions
): Promise<ReadableStream<Uint8Array>> =>
  Effect.runPromise(
    createStream(path, options).pipe(mapPlatformError(path, "read"), Effect.provide(PlatformLayer)),
    runOptions
  );

export {
  existsPromise,
  getSizePromise,
  getMetadataPromise,
  readToStringPromise,
  readByteRangePromise,
  createStreamPromise,
};
