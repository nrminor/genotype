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
  await validateFileSize(validatedPath, mergedOptions);

  // Auto-detect compression format from file extension
  let compressionFormat = mergedOptions.compressionFormat;
  if (compressionFormat === "none") {
    compressionFormat = CompressionDetector.fromExtension(validatedPath);
  }

  // Build the Effect program that describes the computation
  const program = Effect.gen(function* () {
    // Fast path: no decompression needed
    if (!mergedOptions.autoDecompress || compressionFormat === "none") {
      return yield* Effect.promise(() => readFileToString(validatedPath));
    }

    // Slow path: read and decompress
    // Declare dependency: "I need a CompressionService"
    const compressionService = yield* CompressionService;

    // Read file as binary (imperative wrapper in Effect)
    const compressedBytes = yield* Effect.promise(() => readFileToBinary(validatedPath));

    // Decompress using injected service (no coupling to implementation!)
    const decompressedBytes = yield* compressionService.decompress(
      compressedBytes,
      compressionFormat
    );

    // Decode back to string
    return new TextDecoder().decode(decompressedBytes);
  });

  // Run the Effect with the compression service layer provided
  // This is the ONLY place we need to decide which implementation to use
  return Effect.runPromise(program.pipe(Effect.provide(MultiFormatCompressionService)));
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

  // Slow path: compressed file - must decompress entire content using Effect DI
  // (can't random-access compressed data without full decompression)
  const program = Effect.gen(function* () {
    // Declare dependency: "I need a CompressionService"
    const compressionService = yield* CompressionService;

    // Read full file as binary
    const compressedBytes = yield* Effect.promise(() => readFileToBinary(validatedPath));

    // Decompress using injected service
    const decompressedBytes = yield* compressionService.decompress(
      compressedBytes,
      compressionFormat
    );

    // Validate byte range is within decompressed content
    if (start >= decompressedBytes.length || end > decompressedBytes.length) {
      return yield* Effect.fail(
        new FileError(
          `Byte range [${start}, ${end}) exceeds decompressed file size ${decompressedBytes.length}`,
          validatedPath,
          "read"
        )
      );
    }

    return decompressedBytes.slice(start, end);
  });

  try {
    return await Effect.runPromise(program.pipe(Effect.provide(MultiFormatCompressionService)));
  } catch (error) {
    if (error instanceof FileError) {
      throw error;
    }
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

async function readFileToBinary(validatedPath: FilePath): Promise<Uint8Array> {
  const program = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFile(validatedPath);
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
