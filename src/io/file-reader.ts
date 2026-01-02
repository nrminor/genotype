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
import {
  CompressionDetector,
  CompressionService,
  createDecompressor,
  MultiFormatCompressionService,
} from "../compression";
import { CompatibilityError, FileError } from "../errors";
import type { FileIOContext, FileMetadata, FilePath, FileReaderOptions } from "../types";
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
  options: FileReaderOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  const runtime = detectRuntime();
  const validatedPath = validatePath(path);
  const mergedOptions = mergeOptions(options);

  const context: FileIOContext = {
    filePath: validatedPath,
    operation: "read",
    runtime,
    startTime: Date.now(),
    bufferSize: mergedOptions.bufferSize,
  };

  try {
    // ✅ SINGLE runtime launch at boundary
    // Composes validateFileEffect + createBaseStreamEffect + decompression
    return await Effect.runPromise(
      createStreamEffect(path, options).pipe(Effect.provide(getPlatform())),
    );
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
 * Automatically decompresses gzip files when `.gz` extension is detected.
 * Uses Effect dependency injection for compression, enabling transparent
 * layer swapping for testing or custom implementations.
 *
 * **Implementation Note (Internal):**
 * - Uses dual-path optimization: fast path for uncompressed files, slow path with
 *   CompressionService dependency injection for compressed files
 * - Compression format auto-detected from file extension
 * - For testing with mock compression, see `test/utils/compression-layers.ts`
 *
 * @param path File path to read
 * @param options Reading options (bufferSize, encoding, maxFileSize, autoDecompress, etc.)
 * @returns Promise resolving to file content as string
 * @throws {FileError} If file cannot be read, is too large, or path is invalid
 *
 * @example Plain text file
 * ```typescript
 * const content = await readToString("data.txt");
 * ```
 *
 * @example Auto-decompressed gzip file
 * ```typescript
 * // Automatically detects .gz and decompresses
 * const content = await readToString("data.txt.gz");
 * ```
 *
 * @example Disable auto-decompression
 * ```typescript
 * const compressed = await readToString("data.txt.gz", { autoDecompress: false });
 * ```
 *
 * @internal Uses CompressionService via Effect DI for decompression operations
 */
export async function readToString(path: string, options: FileReaderOptions = {}): Promise<string> {
  const validatedPath = validatePath(path);
  const mergedOptions = mergeOptions(options);

  // Auto-detect compression format from file extension
  let compressionFormat = mergedOptions.compressionFormat;
  if (compressionFormat === "none") {
    compressionFormat = CompressionDetector.fromExtension(validatedPath);
  }

  // Build the Effect program that describes the computation
  const program = Effect.gen(function* () {
    // Validate file size
    yield* validateFileSizeEffect(validatedPath, mergedOptions);

    // Fast path: no decompression needed
    if (!mergedOptions.autoDecompress || compressionFormat === "none") {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.readFileString(validatedPath);
    }

    // Slow path: read and decompress
    const compressionService = yield* CompressionService;
    const fs = yield* FileSystem.FileSystem;

    const compressedBytes = yield* fs.readFile(validatedPath);
    const decompressedBytes = yield* compressionService.decompress(
      compressedBytes,
      compressionFormat,
    );

    return new TextDecoder().decode(decompressedBytes);
  });

  try {
    return await Effect.runPromise(
      program.pipe(Effect.provide(getPlatform()), Effect.provide(MultiFormatCompressionService)),
    );
  } catch (error) {
    // Unwrap FileError from Effect FiberFailure
    if (error instanceof FileError) {
      throw error;
    }
    throw FileError.fromSystemError("read", validatedPath, error);
  }
}

/**
 * Read a specific byte range from a file
 *
 * Optimized for random access patterns like FASTA indexing (faidx) where only
 * specific portions of large genomic files need to be read.
 *
 * **Optimization Details:**
 * - **Uncompressed files:** Direct byte-range read using platform filesystem APIs (fast)
 * - **Compressed files:** Full decompression via Effect DI, then slice to requested range (necessary)
 * - Format auto-detected from file extension
 *
 * **Implementation Note (Internal):**
 * Uses CompressionService dependency injection for compressed files, enabling
 * transparent layer swapping for testing or custom compression implementations.
 * See `test/utils/compression-layers.ts` for mock service patterns.
 *
 * @param path File path to read from
 * @param start Starting byte offset (inclusive, must be >= 0)
 * @param end Ending byte offset (exclusive, must be > start)
 * @returns Promise resolving to byte array of requested range
 * @throws {FileError} If file cannot be read, range is invalid, or range exceeds file size
 *
 * @example FASTA file random access
 * ```typescript
 * // Read bytes 1000-2000 from indexed FASTA file
 * const bytes = await readByteRange('genome.fasta', 1000, 2000);
 * const sequence = new TextDecoder().decode(bytes);
 * ```
 *
 * @example Compressed file access
 * ```typescript
 * // For compressed files (.gz), decompresses entire file then returns slice
 * const bytes = await readByteRange('genome.fasta.gz', 500, 1500);
 * ```
 *
 * @internal Uses CompressionService via Effect DI for decompression of compressed files
 */
export async function readByteRange(path: string, start: number, end: number): Promise<Uint8Array> {
  const validatedPath = validatePath(path);

  if (start < 0 || end < 0) {
    throw new FileError("Byte range must be non-negative", validatedPath, "read");
  }
  if (start >= end) {
    throw new FileError("Start byte must be less than end byte", validatedPath, "read");
  }

  // Check if file is compressed
  const compressionFormat = CompressionDetector.fromExtension(validatedPath);

  // Fast path: uncompressed file - direct byte-range read (no decompression overhead)
  if (compressionFormat === "none") {
    const program = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const fullData = yield* fs.readFile(validatedPath);

      // Validate byte range is within file
      if (start >= fullData.length || end > fullData.length) {
        return yield* Effect.fail(
          new FileError(
            `Byte range [${start}, ${end}) exceeds file size ${fullData.length}`,
            validatedPath,
            "read",
          ),
        );
      }

      // Return the requested slice
      return fullData.slice(start, end);
    });

    try {
      return await Effect.runPromise(program.pipe(Effect.provide(getPlatform())));
    } catch (error) {
      if (error instanceof FileError) {
        throw error;
      }
      throw FileError.fromSystemError("read", validatedPath, error);
    }
  }

  // Slow path: compressed file - must decompress entire content using Effect DI
  // (can't random-access compressed data without full decompression)
  const program = Effect.gen(function* () {
    const compressionService = yield* CompressionService;
    const fs = yield* FileSystem.FileSystem;

    const compressedBytes = yield* fs.readFile(validatedPath);
    const decompressedBytes = yield* compressionService.decompress(
      compressedBytes,
      compressionFormat,
    );

    // Validate byte range is within decompressed content
    if (start >= decompressedBytes.length || end > decompressedBytes.length) {
      return yield* Effect.fail(
        new FileError(
          `Byte range [${start}, ${end}) exceeds decompressed file size ${decompressedBytes.length}`,
          validatedPath,
          "read",
        ),
      );
    }

    return decompressedBytes.slice(start, end);
  });

  try {
    return await Effect.runPromise(
      program.pipe(Effect.provide(getPlatform()), Effect.provide(MultiFormatCompressionService)),
    );
  } catch (error) {
    if (error instanceof FileError) {
      throw error;
    }
    throw FileError.fromSystemError("read", validatedPath, error);
  }
}

// Backward compatibility namespace export
export const FileReader = {
  exists,
  getSize,
  getMetadata,
  createStream,
  readToString,
} as const;

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
      "stat",
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

/**
 * Effect-based file validation - returns Effect instead of launching runtime
 * @internal Used by createStreamEffect for composition
 */
function validateFileEffect(path: FilePath, options: Required<FileReaderOptions>) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Check if file exists
    const pathExists = yield* fs.exists(path);
    if (!pathExists) {
      return {
        isValid: false as const,
        error: "File does not exist or is not accessible",
      };
    }

    // Get metadata
    const info = yield* fs.stat(path);
    const metadata: FileMetadata = {
      path,
      size: Number(info.size),
      lastModified: new Date(Number(info.mtime)),
      readable: true,
      writable: false,
      extension: path.substring(path.lastIndexOf(".")),
    };

    // Check file size
    if (metadata.size > options.maxFileSize) {
      return {
        isValid: false as const,
        metadata,
        error: `File size ${metadata.size} exceeds maximum ${options.maxFileSize}`,
      };
    }

    // Check readability
    if (!metadata.readable) {
      return {
        isValid: false as const,
        metadata,
        error: "File is not readable",
      };
    }

    return {
      isValid: true as const,
      metadata,
    };
  });
}

/**
 * Effect-based stream creation - returns Effect instead of launching runtime
 * @internal Used by createStreamEffect for composition
 */
function createBaseStreamEffect(
  validatedPath: FilePath,
  mergedOptions: Required<FileReaderOptions>,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const effectStream = fs.stream(validatedPath, {
      bufferSize: mergedOptions.bufferSize,
    });
    return Stream.toReadableStream(effectStream);
  });
}

/**
 * Private function: Compose all effects for stream creation
 * Combines validation, stream creation, and optional decompression in a single Effect
 * @internal Not for external use - use createStream() instead
 */
function createStreamEffect(path: string, options: FileReaderOptions = {}) {
  const validatedPath = validatePath(path);
  const mergedOptions = mergeOptions(options);

  return Effect.gen(function* () {
    // Step 1: Validate file (requires FileSystem)
    const validation = yield* validateFileEffect(validatedPath, mergedOptions);
    if (validation.isValid === false) {
      return yield* Effect.fail(
        new FileError(validation.error ?? "File validation failed", validatedPath, "read"),
      );
    }

    // Step 2: Create base stream (requires FileSystem)
    let stream = yield* createBaseStreamEffect(validatedPath, mergedOptions);

    // Step 3: Apply decompression if needed (wrapped in Effect.promise)
    if (mergedOptions.autoDecompress) {
      stream = yield* Effect.promise(() =>
        applyDecompression(stream, validatedPath, mergedOptions),
      );
    }

    return stream;
  });
}

/**
 * Apply decompression to stream if needed
 */
async function applyDecompression(
  stream: ReadableStream<Uint8Array>,
  filePath: FilePath,
  options: Required<FileReaderOptions>,
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
 * Effect-based version of validateFileSize
 * Returns Effect with FileSystem requirement instead of launching runtime
 * @internal
 */
function validateFileSizeEffect(
  validatedPath: FilePath,
  mergedOptions: Required<FileReaderOptions>,
) {
  return Effect.gen(function* () {
    // Get file size using Effect version
    const fileSize = yield* Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const info = yield* fs.stat(validatedPath);
      return Number(info.size);
    });

    if (fileSize > mergedOptions.maxFileSize) {
      return yield* Effect.fail(
        new FileError(
          `File too large: ${fileSize} bytes exceeds limit of ${mergedOptions.maxFileSize} bytes`,
          validatedPath,
          "read",
        ),
      );
    }
    return fileSize;
  });
}
