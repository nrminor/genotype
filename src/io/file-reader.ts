/**
 * Cross-platform file reading utilities for Node.js, Deno, and Bun
 *
 * Provides a unified interface for file I/O operations across different
 * JavaScript runtimes using Effect Platform for runtime abstraction.
 */

import { FileSystem } from "@effect/platform";
import { type } from "arktype";
import { Effect, Layer, Stream } from "effect";
import {
  CompressionDetector,
  CompressionService,
  createDecompressor,
  MultiFormatCompressionService,
} from "../compression";
import { CompatibilityError, FileError } from "../errors";
import type { FileMetadata, FilePath, FileReaderOptions } from "../types";
import { FilePathSchema, FileReaderOptionsSchema } from "../types";
import { getPlatform } from "./runtime";

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_OPTIONS: Required<FileReaderOptions> = {
  bufferSize: 65536,
  encoding: "utf8",
  maxFileSize: 104_857_600, // 100MB
  timeout: 30000,
  concurrent: false,
  signal: new AbortController().signal,
  autoDecompress: true,
  compressionFormat: "none",
  decompressionOptions: {},
};

/** Merged layer providing both platform and compression services */
const FullLayer = Layer.merge(getPlatform(), MultiFormatCompressionService);

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/** Validate file path using ArkType */
function validatePath(path: string): FilePath {
  try {
    const result = FilePathSchema(path);
    if (result instanceof type.errors) {
      throw new FileError(`Invalid file path: ${result.summary}`, path, "stat");
    }
    return result;
  } catch (error) {
    // FilePathSchema.pipe() throws raw Error for validation failures
    if (error instanceof FileError) throw error;
    throw new FileError(
      `Invalid file path: ${error instanceof Error ? error.message : String(error)}`,
      path,
      "stat"
    );
  }
}

/** Merge user options with defaults */
function mergeOptions(options: FileReaderOptions): Required<FileReaderOptions> {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  const result = FileReaderOptionsSchema(merged);
  if (result instanceof type.errors) {
    throw new FileError(`Invalid options: ${result.summary}`, "", "read");
  }
  return merged;
}

/** Run an Effect program with full layer, converting errors to FileError */
async function runWithLayer<A>(
  program: Effect.Effect<A, unknown, FileSystem.FileSystem | CompressionService>,
  path: string,
  operation: "read" | "stat"
): Promise<A> {
  try {
    return await Effect.runPromise(program.pipe(Effect.provide(FullLayer)));
  } catch (error) {
    if (error instanceof FileError) throw error;
    throw FileError.fromSystemError(operation, path, error);
  }
}

/** Run an Effect program with platform layer only */
async function runWithPlatform<A>(
  program: Effect.Effect<A, unknown, FileSystem.FileSystem>,
  path: string,
  operation: "read" | "stat"
): Promise<A> {
  try {
    return await Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
  } catch (error) {
    if (error instanceof FileError) throw error;
    throw FileError.fromSystemError(operation, path, error);
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Check if a file exists and is accessible
 *
 * @param path - File path to check
 * @returns true if file exists and is readable
 */
export async function exists(path: string): Promise<boolean> {
  const validatedPath = validatePath(path);

  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathExists = yield* fs.exists(validatedPath);
    if (!pathExists) return false;

    const info = yield* fs.stat(validatedPath);
    return info.type === "File";
  });

  return runWithPlatform(program, validatedPath, "stat");
}

/**
 * Get file size in bytes
 *
 * @param path - File path to check
 * @returns File size in bytes
 */
export async function getSize(path: string): Promise<number> {
  const validatedPath = validatePath(path);

  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(validatedPath);
    return Number(info.size);
  });

  return runWithPlatform(program, validatedPath, "stat");
}

/**
 * Get comprehensive file metadata
 *
 * @param path - File path to analyze
 * @returns File metadata
 */
export async function getMetadata(path: string): Promise<FileMetadata> {
  const validatedPath = validatePath(path);

  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(validatedPath);

    return {
      path: validatedPath,
      size: Number(info.size),
      lastModified: new Date(Number(info.mtime)),
      readable: true,
      writable: false,
      extension: validatedPath.substring(validatedPath.lastIndexOf(".")),
    };
  });

  return runWithPlatform(program, validatedPath, "stat");
}

/**
 * Read entire file to string
 *
 * Automatically decompresses gzip/zstd files based on extension.
 *
 * @param path - File path to read
 * @param options - Reading options
 * @returns File content as string
 */
export async function readToString(
  path: string,
  options: FileReaderOptions = {}
): Promise<string> {
  const validatedPath = validatePath(path);
  const mergedOptions = mergeOptions(options);

  // Detect compression format
  let compressionFormat = mergedOptions.compressionFormat;
  if (compressionFormat === "none") {
    compressionFormat = CompressionDetector.fromExtension(validatedPath);
  }

  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Validate file size
    const info = yield* fs.stat(validatedPath);
    if (Number(info.size) > mergedOptions.maxFileSize) {
      return yield* Effect.fail(
        new FileError(
          `File too large: ${info.size} bytes exceeds limit of ${mergedOptions.maxFileSize} bytes`,
          validatedPath,
          "read"
        )
      );
    }

    // Fast path: no decompression needed
    if (!mergedOptions.autoDecompress || compressionFormat === "none") {
      return yield* fs.readFileString(validatedPath);
    }

    // Slow path: decompress
    const compressionService = yield* CompressionService;
    const compressedBytes = yield* fs.readFile(validatedPath);
    const decompressedBytes = yield* compressionService.decompress(
      compressedBytes,
      compressionFormat
    );

    return new TextDecoder().decode(decompressedBytes);
  });

  return runWithLayer(program, validatedPath, "read");
}

/**
 * Read a specific byte range from a file
 *
 * For compressed files, decompresses entire content then slices.
 *
 * @param path - File path to read from
 * @param start - Starting byte offset (inclusive)
 * @param end - Ending byte offset (exclusive)
 * @returns Byte array of requested range
 */
export async function readByteRange(
  path: string,
  start: number,
  end: number
): Promise<Uint8Array> {
  const validatedPath = validatePath(path);

  if (start < 0 || end < 0) {
    throw new FileError("Byte range must be non-negative", validatedPath, "read");
  }
  if (start >= end) {
    throw new FileError("Start byte must be less than end byte", validatedPath, "read");
  }

  const compressionFormat = CompressionDetector.fromExtension(validatedPath);

  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Get file data (decompress if needed)
    let data: Uint8Array;
    if (compressionFormat === "none") {
      data = yield* fs.readFile(validatedPath);
    } else {
      const compressionService = yield* CompressionService;
      const compressedBytes = yield* fs.readFile(validatedPath);
      data = yield* compressionService.decompress(compressedBytes, compressionFormat);
    }

    // Validate range
    if (start >= data.length || end > data.length) {
      return yield* Effect.fail(
        new FileError(
          `Byte range [${start}, ${end}) exceeds file size ${data.length}`,
          validatedPath,
          "read"
        )
      );
    }

    return data.slice(start, end);
  });

  return runWithLayer(program, validatedPath, "read");
}

/**
 * Create a streaming reader for a file
 *
 * @param path - File path to read
 * @param options - Reading options
 * @returns ReadableStream of file data
 */
export async function createStream(
  path: string,
  options: FileReaderOptions = {}
): Promise<ReadableStream<Uint8Array>> {
  const validatedPath = validatePath(path);
  const mergedOptions = mergeOptions(options);

  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Validate file exists and check size
    const pathExists = yield* fs.exists(validatedPath);
    if (!pathExists) {
      return yield* Effect.fail(
        new FileError("File does not exist", validatedPath, "read")
      );
    }

    const info = yield* fs.stat(validatedPath);
    if (Number(info.size) > mergedOptions.maxFileSize) {
      return yield* Effect.fail(
        new FileError(
          `File size ${info.size} exceeds maximum ${mergedOptions.maxFileSize}`,
          validatedPath,
          "read"
        )
      );
    }

    // Create base stream
    const effectStream = fs.stream(validatedPath, {
      bufferSize: mergedOptions.bufferSize,
    });
    let stream = Stream.toReadableStream(effectStream);

    // Apply decompression if needed
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
          signal: mergedOptions.signal,
        });
      }
    }

    return stream;
  });

  try {
    return await Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
  } catch (error) {
    if (error instanceof CompatibilityError) throw error;
    if (error instanceof FileError) throw error;
    throw FileError.fromSystemError("read", validatedPath, error);
  }
}

// =============================================================================
// NAMESPACE EXPORT
// =============================================================================

/** Backward compatibility namespace export */
export const FileReader = {
  exists,
  getSize,
  getMetadata,
  createStream,
  readToString,
} as const;
