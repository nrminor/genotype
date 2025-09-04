/**
 * Cross-platform file reading utilities for Node.js, Deno, and Bun
 *
 * Provides a unified interface for file I/O operations across different
 * JavaScript runtimes while maintaining optimal performance and memory
 * efficiency for genomic data processing.
 */

import { type } from "arktype";
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
import { detectRuntime, getOptimalBufferSize, getRuntimeGlobals, type Runtime } from "./runtime";

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
 * Merge user options with runtime-optimized defaults
 */
function mergeOptions(options: FileReaderOptions, runtime: Runtime): Required<FileReaderOptions> {
  // TypeScript guarantees types - no defensive checking needed

  const defaults = {
    ...DEFAULT_OPTIONS,
    bufferSize: getOptimalBufferSize(runtime),
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
 * Create base file stream without decompression
 */
async function createBaseStream(
  validatedPath: FilePath,
  mergedOptions: Required<FileReaderOptions>,
  runtime: Runtime
): Promise<ReadableStream<Uint8Array>> {
  switch (runtime) {
    case "node":
      return createNodeStream(validatedPath, mergedOptions);
    case "bun":
      return createBunStream(validatedPath, mergedOptions);
    default:
      throw new CompatibilityError(`Unsupported runtime: ${runtime}`, runtime, "filesystem");
  }
}

function createNodeStream(
  validatedPath: FilePath,
  mergedOptions: Required<FileReaderOptions>
): ReadableStream<Uint8Array> {
  const { fs } = getRuntimeGlobals("node") as { fs: any };
  if (fs === undefined || fs === null)
    throw new CompatibilityError("Node.js fs module not available", "node", "filesystem");

  const nodeStream = fs.createReadStream(validatedPath, {
    highWaterMark: mergedOptions.bufferSize,
  });

  return new ReadableStream({
    start(controller): void {
      nodeStream.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });

      nodeStream.on("end", () => {
        controller.close();
      });

      nodeStream.on("error", (error: Error) => {
        controller.error(FileError.fromSystemError("read", validatedPath, error));
      });

      // Handle abort signal with optional chaining
      mergedOptions.signal?.addEventListener("abort", () => {
        nodeStream.destroy();
        controller.error(new Error("Read operation aborted"));
      });
    },
  });
}

function createBunStream(
  validatedPath: FilePath,
  mergedOptions: Required<FileReaderOptions>
): ReadableStream<Uint8Array> {
  const { Bun } = getRuntimeGlobals("bun") as { Bun: any };
  if (Bun === undefined || Bun === null || Bun.file === undefined || Bun.file === null)
    throw new CompatibilityError("Bun.file not available", "bun", "filesystem");

  const file = Bun.file(validatedPath);
  const stream = file.stream();

  return new ReadableStream({
    async start(controller): Promise<void> {
      try {
        const reader = stream.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done === true) break;

          controller.enqueue(value);

          // Progress tracking removed - users can implement their own by wrapping streams

          // Check for abort signal with optional chaining
          if (mergedOptions.signal?.aborted) {
            reader.releaseLock();
            throw new Error("Read operation aborted");
          }
        }

        controller.close();
      } catch (error) {
        controller.error(FileError.fromSystemError("read", validatedPath, error));
      }
    },
  });
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
  // TypeScript guarantees path is string - delegate to ArkType for domain validation
  const validatedPath = validatePath(path);
  const runtime = detectRuntime();

  try {
    switch (runtime) {
      case "node": {
        const { fs } = getRuntimeGlobals("node") as { fs: any };
        if (fs === undefined || fs === null)
          throw new CompatibilityError("Node.js fs module not available", "node", "filesystem");

        try {
          await fs.promises.access(validatedPath, fs.constants.F_OK | fs.constants.R_OK);
          return true;
        } catch {
          return false;
        }
      }

      case "bun": {
        const { Bun } = getRuntimeGlobals("bun") as { Bun: any };
        if (Bun === undefined || Bun === null || Bun.file === undefined || Bun.file === null)
          throw new CompatibilityError("Bun.file not available", "bun", "filesystem");

        try {
          const file = Bun.file(validatedPath);
          return await file.exists();
        } catch {
          return false;
        }
      }

      default:
        throw new CompatibilityError(`Unsupported runtime: ${runtime}`, runtime, "filesystem");
    }
  } catch (error) {
    if (error instanceof CompatibilityError) throw error;
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
  // TypeScript guarantees path is string - delegate to ArkType for domain validation
  const validatedPath = validatePath(path);
  const runtime = detectRuntime();

  try {
    switch (runtime) {
      case "node": {
        const { fs } = getRuntimeGlobals("node") as { fs: any };
        if (fs === undefined || fs === null)
          throw new CompatibilityError("Node.js fs module not available", "node", "filesystem");

        const stats = await fs.promises.stat(validatedPath);
        return stats.size;
      }

      case "bun": {
        const { Bun } = getRuntimeGlobals("bun") as { Bun: any };
        if (Bun === undefined || Bun === null || Bun.file === undefined || Bun.file === null)
          throw new CompatibilityError("Bun.file not available", "bun", "filesystem");

        const file = Bun.file(validatedPath);
        // Check if file exists first
        if ((await file.exists()) === false) {
          throw new Error(`ENOENT: no such file or directory, stat '${validatedPath}'`);
        }
        return file.size;
      }

      default:
        throw new CompatibilityError(`Unsupported runtime: ${runtime}`, runtime, "filesystem");
    }
  } catch (error) {
    if (error instanceof CompatibilityError) throw error;
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
  // TypeScript guarantees path is string - delegate to ArkType for domain validation
  const validatedPath = validatePath(path);
  const runtime = detectRuntime();

  try {
    switch (runtime) {
      case "node": {
        const { fs, path: pathModule } = getRuntimeGlobals("node") as {
          fs: any;
          path: any;
        };
        if (fs === undefined || fs === null || pathModule === undefined || pathModule === null)
          throw new CompatibilityError("Node.js modules not available", "node", "filesystem");

        const stats = await fs.promises.stat(validatedPath);

        // Check permissions
        let readable = false,
          writable = false;
        try {
          await fs.promises.access(validatedPath, fs.constants.R_OK);
          readable = true;
        } catch {
          /* ignore */
        }

        try {
          await fs.promises.access(validatedPath, fs.constants.W_OK);
          writable = true;
        } catch {
          /* ignore */
        }

        return {
          path: validatedPath,
          size: stats.size,
          lastModified: stats.mtime,
          readable,
          writable,
          extension: pathModule.extname(validatedPath),
        };
      }

      case "bun": {
        const { Bun } = getRuntimeGlobals("bun") as { Bun: any };
        if (Bun === undefined || Bun === null || Bun.file === undefined || Bun.file === null)
          throw new CompatibilityError("Bun.file not available", "bun", "filesystem");

        const file = Bun.file(validatedPath);
        const lastModified = new Date(file.lastModified);

        return {
          path: validatedPath,
          size: file.size,
          lastModified,
          readable: await file.exists(),
          writable: false, // Bun doesn't expose write permissions easily
          extension: validatedPath.substring(validatedPath.lastIndexOf(".")),
        };
      }

      default:
        throw new CompatibilityError(`Unsupported runtime: ${runtime}`, runtime, "filesystem");
    }
  } catch (error) {
    if (error instanceof CompatibilityError) throw error;
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
  const mergedOptions = mergeOptions(options, runtime);

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
    let stream = await createBaseStream(validatedPath, mergedOptions, runtime);

    // Apply decompression if enabled and needed
    if (mergedOptions.autoDecompress) {
      stream = await applyDecompression(stream, validatedPath, mergedOptions);
    }

    return stream;
  } catch (error) {
    if (error instanceof CompatibilityError) throw error;

    // Enhanced error with context for debugging
    const elapsed = Date.now() - context.startTime;
    const enhanced = FileError.fromSystemError("open", validatedPath, error);
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
  // TypeScript guarantees types - delegate to ArkType for domain validation
  const validatedPath = validatePath(path);
  const runtime = detectRuntime();
  const mergedOptions = mergeOptions(options, runtime);
  const fileSize = await validateFileSize(validatedPath, mergedOptions);

  // Try Bun optimization first
  const bunResult = await tryBunOptimizedRead(runtime, validatedPath, mergedOptions);
  if (bunResult !== null) {
    return bunResult;
  }

  // Fallback to streaming approach
  const result = await readViaStream(validatedPath, options, fileSize);
  validateReadResult(result, validatedPath, fileSize);
  return result;
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

async function tryBunOptimizedRead(
  runtime: Runtime,
  validatedPath: FilePath,
  mergedOptions: Required<FileReaderOptions>
): Promise<string | null> {
  // Use Bun's optimized file.text() when conditions are right
  const canUseBunOptimization =
    runtime === "bun" && mergedOptions.encoding === "utf8" && !mergedOptions.signal;

  if (!canUseBunOptimization) {
    return null;
  }

  try {
    const { Bun } = getRuntimeGlobals("bun") as { Bun: any };
    if (Bun?.file) {
      const file = Bun.file(validatedPath);
      // Bun.file.text() always returns string - no defensive checking needed
      return await file.text();
    }
  } catch (error) {
    throw FileError.fromSystemError("read", validatedPath, error);
  }

  return null;
}

async function readViaStream(
  validatedPath: FilePath,
  options: FileReaderOptions,
  fileSize: number
): Promise<string> {
  const stream = await createStream(validatedPath, options);
  const reader = stream.getReader();
  const runtime = detectRuntime();
  const mergedOptions = mergeOptions(options, runtime);

  if (mergedOptions.encoding === "binary") {
    return readBinaryStream(reader, mergedOptions, fileSize);
  }

  return readTextStream(reader, mergedOptions, fileSize);
}

async function readBinaryStream(
  reader: any,
  mergedOptions: Required<FileReaderOptions>,
  fileSize: number
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done === true) break;

      chunks.push(value);
      totalLength += value.length;

      // Progress tracking removed - users can implement their own by counting bytes
    }

    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return Array.from(combined, (byte) => String.fromCharCode(byte)).join("");
  } finally {
    reader.releaseLock();
  }
}

async function readTextStream(
  reader: any,
  mergedOptions: Required<FileReaderOptions>,
  fileSize: number
): Promise<string> {
  const decoder = new TextDecoder("utf-8");
  let result = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done === true) break;

      result += decoder.decode(value, { stream: true });

      // Progress tracking removed - users can implement their own by counting bytes
    }

    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}

function validateReadResult(result: string, validatedPath: FilePath, fileSize: number): void {
  // TypeScript guarantees result is string - check meaningful invariants only
  // Tiger Style: Assert meaningful file size constraint (detect encoding issues)
  if (result.length > fileSize * 4) {
    throw new FileError(
      "decoded string should not be excessively larger than file size",
      validatedPath,
      "read"
    );
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
