/**
 * Cross-platform file reading utilities for Node.js, Deno, and Bun
 *
 * Provides a unified interface for file I/O operations across different
 * JavaScript runtimes while maintaining optimal performance and memory
 * efficiency for genomic data processing.
 */

import { FileSystem } from "@effect/platform";
import { type } from "arktype";
import { Effect, Stream } from "effect";
import { CompressionDetector, createDecompressor } from "../compression";
import { CompatibilityError, FileError } from "../errors";
import type {
  FileIOContext,
  FileMetadata,
  FilePath,
  FileReaderOptions,
  FileValidationResult,
} from "../types";
import { FilePathSchema, FileReaderOptionsSchema } from "../types";
import { detectRuntime, getPlatform } from "./runtime";

// Module-level constants for default options
const DEFAULT_OPTIONS: Required<FileReaderOptions> = {
  bufferSize: 65536, // Will be overridden by runtime detection
  encoding: "utf8",
  maxFileSize: 104_857_600, // 100MB default
  timeout: 30000, // 30 seconds
  concurrent: false,
  signal: new AbortController().signal,
  autoDecompress: true, // Enable automatic decompression by default
  compressionFormat: "none", // Will be auto-detected
  decompressionOptions: {},
};

/**
 * Validate file accessibility and constraints
 */
async function validateFile(
  path: FilePath,
  options: Required<FileReaderOptions>
): Promise<FileValidationResult> {
  // TypeScript guarantees types - no defensive checking needed

  try {
    // Check if file exists
    if (!(await exists(path))) {
      return {
        isValid: false,
        error: "File does not exist or is not accessible",
      };
    }

    // Get metadata
    const metadata = await getMetadata(path);

    // Check file size
    if (metadata.size > options.maxFileSize) {
      return {
        isValid: false,
        metadata,
        error: `File size ${metadata.size} exceeds maximum ${options.maxFileSize}`,
      };
    }

    // Check readability
    if (!metadata.readable) {
      return {
        isValid: false,
        metadata,
        error: "File is not readable",
      };
    }

    return {
      isValid: true,
      metadata,
    };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create base file stream using Effect Platform
 * Works across Node.js, Bun, and Deno automatically via platform layers
 */
async function createBaseStream(
  validatedPath: FilePath,
  mergedOptions: Required<FileReaderOptions>
): Promise<ReadableStream<Uint8Array>> {
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const effectStream = fs.stream(validatedPath, {
      bufferSize: mergedOptions.bufferSize,
    });
    return Stream.toReadableStream(effectStream);
  });

  return Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
}

/**
 * Apply decompression to stream if needed
 */
async function applyDecompression(
  stream: ReadableStream<Uint8Array>,
  filePath: FilePath,
  options: Required<FileReaderOptions>
): Promise<ReadableStream<Uint8Array>> {
  // TypeScript guarantees types - no defensive checking needed

  try {
    // Determine compression format
    let compressionFormat = options.compressionFormat;

    if (compressionFormat === "none") {
      // Auto-detect compression from file extension
      compressionFormat = CompressionDetector.fromExtension(filePath);
    }

    // If no compression detected, return original stream
    if (compressionFormat === "none") {
      return stream;
    }

    // Create appropriate decompressor
    const decompressor = createDecompressor(compressionFormat);

    // Apply decompression with merged options
    const decompressionOptions = {
      ...options.decompressionOptions,
      bufferSize: options.bufferSize,
      signal: options.signal,
    };

    return decompressor.wrapStream(stream, decompressionOptions);
  } catch (error) {
    throw FileError.fromSystemError("read", filePath, error);
  }
}

/**
 * Check if a file exists and is accessible
 *
 * @param path File path to check
 * @returns Promise resolving to true if file exists and is readable
 * @throws {FileError} If path validation fails
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

  try {
    return await Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
  } catch (error) {
    throw FileError.fromSystemError("stat", validatedPath, error);
  }
}

/**
 * Get file size in bytes
 *
 * @param path File path to check
 * @returns Promise resolving to file size in bytes
 * @throws {FileError} If file cannot be accessed or doesn't exist
 */
export async function getSize(path: string): Promise<number> {
  const validatedPath = validatePath(path);

  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(validatedPath);
    return Number(info.size);
  });

  try {
    return await Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
  } catch (error) {
    throw FileError.fromSystemError("stat", validatedPath, error);
  }
}

/**
 * Get comprehensive file metadata
 *
 * @param path File path to analyze
 * @returns Promise resolving to file metadata
 * @throws {FileError} If file cannot be accessed
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

  try {
    return await Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
  } catch (error) {
    throw FileError.fromSystemError("stat", validatedPath, error);
  }
}

/**
 * Create a streaming reader for a file
 *
 * @param path File path to read
 * @param options Reading options
 * @returns Promise resolving to ReadableStream of file data
 * @throws {FileError} If file cannot be opened or read
 */
export async function createStream(
  path: string,
  options: FileReaderOptions = {}
): Promise<ReadableStream<Uint8Array>> {
  // TypeScript guarantees types - delegate to ArkType for domain validation

  const validatedPath = validatePath(path);
  const runtime = detectRuntime();
  const mergedOptions = mergeOptions(options);

  // Validate file before creating stream
  const validation = await validateFile(validatedPath, mergedOptions);
  if (validation.isValid === false) {
    throw new FileError(validation.error ?? "File validation failed", validatedPath, "read");
  }

  const context: FileIOContext = {
    filePath: validatedPath,
    operation: "read",
    runtime,
    startTime: Date.now(),
    bufferSize: mergedOptions.bufferSize,
  };

  try {
    // Create base stream first
    let stream = await createBaseStream(validatedPath, mergedOptions);

    // Apply decompression if enabled and needed
    if (mergedOptions.autoDecompress) {
      stream = await applyDecompression(stream, validatedPath, mergedOptions);
    }

    return stream;
  } catch (error) {
    if (error instanceof CompatibilityError) throw error;

    // Enhanced error with context for debugging
    const elapsed = Date.now() - context.startTime;
    const enhanced = FileError.fromSystemError("read", validatedPath, error);
    enhanced.message += ` (failed after ${elapsed}ms, runtime: ${context.runtime}, bufferSize: ${context.bufferSize})`;
    throw enhanced;
  }
}

/**
 * Read entire file to string (with size limits for safety)
 *
 * @param path File path to read
 * @param options Reading options
 * @returns Promise resolving to file content as string
 * @throws {FileError} If file cannot be read or is too large
 */
export async function readToString(path: string, options: FileReaderOptions = {}): Promise<string> {
  const validatedPath = validatePath(path);
  const mergedOptions = mergeOptions(options);
  await validateFileSize(validatedPath, mergedOptions);

  return readFileToString(validatedPath);
}

/**
 * Read a specific byte range from a file
 *
 * Useful for random access patterns like FASTA indexing (faidx) where only
 * specific portions of large genomic files need to be read.
 *
 * @param path File path to read from
 * @param start Starting byte offset (inclusive)
 * @param end Ending byte offset (exclusive)
 * @returns Promise resolving to byte array of requested range
 * @throws {FileError} If file cannot be read or range is invalid
 *
 * @example
 * ```typescript
 * // Read bytes 1000-2000 from indexed FASTA file
 * const bytes = await readByteRange('genome.fasta', 1000, 2000);
 * const sequence = new TextDecoder().decode(bytes);
 * ```
 */
export async function readByteRange(path: string, start: number, end: number): Promise<Uint8Array> {
  const validatedPath = validatePath(path);

  if (start < 0 || end < 0) {
    throw new FileError("Byte range must be non-negative", validatedPath, "read");
  }
  if (start >= end) {
    throw new FileError("Start byte must be less than end byte", validatedPath, "read");
  }

  const program = Effect.promise(async () => {
    const fs = await import("node:fs/promises");
    const fileHandle = await fs.open(validatedPath, "r");
    try {
      const buffer = Buffer.alloc(end - start);
      await fileHandle.read(buffer, 0, buffer.length, start);
      return new Uint8Array(buffer);
    } finally {
      await fileHandle.close();
    }
  });

  try {
    return await Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
  } catch (error) {
    throw FileError.fromSystemError("read", validatedPath, error);
  }
}

async function validateFileSize(
  validatedPath: FilePath,
  mergedOptions: Required<FileReaderOptions>
): Promise<number> {
  const fileSize = await getSize(validatedPath);
  if (fileSize > mergedOptions.maxFileSize) {
    throw new FileError(
      `File too large: ${fileSize} bytes exceeds limit of ${mergedOptions.maxFileSize} bytes`,
      validatedPath,
      "read"
    );
  }
  return fileSize;
}

async function readFileToString(validatedPath: FilePath): Promise<string> {
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(validatedPath);
  });

  return Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
}

// Backward compatibility namespace export
export const FileReader = {
  exists,
  getSize,
  getMetadata,
  createStream,
  readToString,
} as const;

// =============================================================================
// PRIVATE HELPER FUNCTIONS
// =============================================================================

/**
 * Validate file path using ArkType and return branded type
 * Maintains FileError interface contract for callers
 */
function validatePath(path: string): FilePath {
  // TypeScript guarantees path is string - delegate to ArkType for domain validation
  try {
    const validationResult = FilePathSchema(path);
    if (validationResult instanceof type.errors) {
      throw new FileError(`Invalid file path: ${validationResult.summary}`, path, "stat");
    }
    return validationResult;
  } catch (error) {
    // Ensure all validation errors become FileError to maintain interface contract
    throw new FileError(
      `Invalid file path: ${error instanceof Error ? error.message : String(error)}`,
      path,
      "stat"
    );
  }
}

/**
 * Merge user options with defaults
 */
function mergeOptions(options: FileReaderOptions): Required<FileReaderOptions> {
  // TypeScript guarantees types - no defensive checking needed

  const defaults = {
    ...DEFAULT_OPTIONS,
    bufferSize: 65536, // 64KB standard buffer size
  };

  const merged = { ...defaults, ...options };

  // Validate merged options with ArkType
  const validationResult = FileReaderOptionsSchema(merged);
  if (validationResult instanceof type.errors) {
    throw new FileError(`Invalid file reader options: ${validationResult.summary}`, "", "read");
  }

  return merged;
}
