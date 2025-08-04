/**
 * Cross-platform file reading utilities for Node.js, Deno, and Bun
 *
 * Provides a unified interface for file I/O operations across different
 * JavaScript runtimes while maintaining optimal performance and memory
 * efficiency for genomic data processing.
 */

import type {
  FilePath,
  FileHandle,
  FileReaderOptions,
  FileMetadata,
  FileValidationResult,
  StreamChunk,
  FileIOContext,
} from '../types';
import { FilePathSchema, FileReaderOptionsSchema } from '../types';
import { FileError, StreamError, TimeoutError, CompatibilityError } from '../errors';
import {
  detectRuntime,
  getRuntimeCapabilities,
  getRuntimeGlobals,
  getOptimalBufferSize,
  type Runtime,
} from './runtime';
import { CompressionDetector, createDecompressor } from '../compression';

/**
 * Cross-platform file reading class with streaming capabilities
 *
 * Implements the Tiger Style pattern with strict validation and error handling.
 * Provides memory-efficient streaming for large genomic files across all
 * supported JavaScript runtimes.
 *
 * @example Basic file reading
 * ```typescript
 * const content = await FileReader.readToString('/path/to/genome.fasta');
 * console.log(`File size: ${content.length} characters`);
 * ```
 *
 * @example Streaming large files
 * ```typescript
 * const stream = await FileReader.createStream('/path/to/large-genome.fasta');
 * for await (const chunk of FileReader.chunks(stream)) {
 *   console.log(`Processed ${chunk.bytesRead} bytes`);
 * }
 * ```
 */
export class FileReader {
  private static readonly DEFAULT_OPTIONS: Required<FileReaderOptions> = {
    bufferSize: 65536, // Will be overridden by runtime detection
    encoding: 'utf8',
    maxFileSize: 104_857_600, // 100MB default
    timeout: 30000, // 30 seconds
    concurrent: false,
    signal: new AbortController().signal,
    onProgress: () => {},
    autoDecompress: true, // Enable automatic decompression by default
    compressionFormat: 'none', // Will be auto-detected
    decompressionOptions: {},
  };

  /**
   * Check if a file exists and is accessible
   *
   * @param path File path to check
   * @returns Promise resolving to true if file exists and is readable
   * @throws {FileError} If path validation fails
   */
  static async exists(path: string): Promise<boolean> {
    // Tiger Style: Assert function arguments with explicit validation
    if (typeof path !== 'string') {
      throw new FileError('Path must be a string', path, 'stat');
    }
    if (path.length === 0) {
      throw new FileError('Path must not be empty', path, 'stat');
    }

    const validatedPath = this.validatePath(path);
    const runtime = detectRuntime();

    try {
      switch (runtime) {
        case 'node': {
          const { fs } = getRuntimeGlobals('node');
          if (!fs)
            throw new CompatibilityError('Node.js fs module not available', 'node', 'filesystem');

          try {
            await fs.promises.access(validatedPath, fs.constants.F_OK | fs.constants.R_OK);
            return true;
          } catch {
            return false;
          }
        }

        case 'deno': {
          const { Deno } = getRuntimeGlobals('deno');
          if (!Deno)
            throw new CompatibilityError('Deno global not available', 'deno', 'filesystem');

          try {
            const stat = await Deno.stat(validatedPath);
            return stat.isFile;
          } catch {
            return false;
          }
        }

        case 'bun': {
          const { Bun } = getRuntimeGlobals('bun');
          if (!Bun || !Bun.file)
            throw new CompatibilityError('Bun.file not available', 'bun', 'filesystem');

          try {
            const file = Bun.file(validatedPath);
            return await file.exists();
          } catch {
            return false;
          }
        }

        default:
          throw new CompatibilityError(`Unsupported runtime: ${runtime}`, runtime, 'filesystem');
      }
    } catch (error) {
      if (error instanceof CompatibilityError) throw error;
      throw FileError.fromSystemError('stat', validatedPath, error);
    }
  }

  /**
   * Get file size in bytes
   *
   * @param path File path to check
   * @returns Promise resolving to file size in bytes
   * @throws {FileError} If file cannot be accessed or doesn't exist
   */
  static async getSize(path: string): Promise<number> {
    // Tiger Style: Assert function arguments with explicit validation
    if (typeof path !== 'string') {
      throw new FileError('Path must be a string', path, 'stat');
    }
    if (path.length === 0) {
      throw new FileError('Path must not be empty', path, 'stat');
    }

    const validatedPath = this.validatePath(path);
    const runtime = detectRuntime();

    try {
      switch (runtime) {
        case 'node': {
          const { fs } = getRuntimeGlobals('node');
          if (!fs)
            throw new CompatibilityError('Node.js fs module not available', 'node', 'filesystem');

          const stats = await fs.promises.stat(validatedPath);
          return stats.size;
        }

        case 'deno': {
          const { Deno } = getRuntimeGlobals('deno');
          if (!Deno)
            throw new CompatibilityError('Deno global not available', 'deno', 'filesystem');

          const stat = await Deno.stat(validatedPath);
          return stat.size;
        }

        case 'bun': {
          const { Bun } = getRuntimeGlobals('bun');
          if (!Bun || !Bun.file)
            throw new CompatibilityError('Bun.file not available', 'bun', 'filesystem');

          const file = Bun.file(validatedPath);
          // Check if file exists first
          if (!(await file.exists())) {
            throw new Error(`ENOENT: no such file or directory, stat '${validatedPath}'`);
          }
          return file.size;
        }

        default:
          throw new CompatibilityError(`Unsupported runtime: ${runtime}`, runtime, 'filesystem');
      }
    } catch (error) {
      if (error instanceof CompatibilityError) throw error;
      throw FileError.fromSystemError('stat', validatedPath, error);
    }
  }

  /**
   * Get comprehensive file metadata
   *
   * @param path File path to analyze
   * @returns Promise resolving to file metadata
   * @throws {FileError} If file cannot be accessed
   */
  static async getMetadata(path: string): Promise<FileMetadata> {
    // Tiger Style: Assert function arguments
    console.assert(typeof path === 'string', 'path must be a string');
    console.assert(path.length > 0, 'path must not be empty');

    const validatedPath = this.validatePath(path);
    const runtime = detectRuntime();

    try {
      switch (runtime) {
        case 'node': {
          const { fs, path: pathModule } = getRuntimeGlobals('node');
          if (!fs || !pathModule)
            throw new CompatibilityError('Node.js modules not available', 'node', 'filesystem');

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

        case 'deno': {
          const { Deno } = getRuntimeGlobals('deno');
          if (!Deno)
            throw new CompatibilityError('Deno global not available', 'deno', 'filesystem');

          const stat = await Deno.stat(validatedPath);

          // Deno doesn't have easy permission checking, assume readable if we can stat
          const readable = true;
          const writable = stat.mode !== null ? (stat.mode & 0o200) !== 0 : false;

          return {
            path: validatedPath,
            size: stat.size,
            lastModified: stat.mtime || new Date(),
            readable,
            writable,
            extension: validatedPath.substring(validatedPath.lastIndexOf('.')),
          };
        }

        case 'bun': {
          const { Bun } = getRuntimeGlobals('bun');
          if (!Bun || !Bun.file)
            throw new CompatibilityError('Bun.file not available', 'bun', 'filesystem');

          const file = Bun.file(validatedPath);
          const lastModified = new Date(file.lastModified);

          return {
            path: validatedPath,
            size: file.size,
            lastModified,
            readable: await file.exists(),
            writable: false, // Bun doesn't expose write permissions easily
            extension: validatedPath.substring(validatedPath.lastIndexOf('.')),
          };
        }

        default:
          throw new CompatibilityError(`Unsupported runtime: ${runtime}`, runtime, 'filesystem');
      }
    } catch (error) {
      if (error instanceof CompatibilityError) throw error;
      throw FileError.fromSystemError('stat', validatedPath, error);
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
  static async createStream(
    path: string,
    options: FileReaderOptions = {}
  ): Promise<ReadableStream<Uint8Array>> {
    // Tiger Style: Assert function arguments
    console.assert(typeof path === 'string', 'path must be a string');
    console.assert(path.length > 0, 'path must not be empty');
    console.assert(typeof options === 'object', 'options must be an object');

    const validatedPath = this.validatePath(path);
    const runtime = detectRuntime();
    const mergedOptions = this.mergeOptions(options, runtime);

    // Validate file before creating stream
    const validation = await this.validateFile(validatedPath, mergedOptions);
    if (!validation.isValid) {
      throw new FileError(validation.error || 'File validation failed', validatedPath, 'read');
    }

    const context: FileIOContext = {
      filePath: validatedPath,
      operation: 'read',
      runtime,
      startTime: Date.now(),
      bufferSize: mergedOptions.bufferSize,
    };

    try {
      // Create base stream first
      let stream = await this.createBaseStream(validatedPath, mergedOptions, runtime);

      // Apply decompression if enabled and needed
      if (mergedOptions.autoDecompress) {
        stream = await this.applyDecompression(stream, validatedPath, mergedOptions);
      }

      return stream;
    } catch (error) {
      if (error instanceof CompatibilityError) throw error;
      throw FileError.fromSystemError('open', validatedPath, error);
    }
  }

  /**
   * Create base file stream without decompression
   */
  private static async createBaseStream(
    validatedPath: FilePath,
    mergedOptions: Required<FileReaderOptions>,
    runtime: Runtime
  ): Promise<ReadableStream<Uint8Array>> {
    switch (runtime) {
      case 'node': {
        const { fs } = getRuntimeGlobals('node');
        if (!fs)
          throw new CompatibilityError('Node.js fs module not available', 'node', 'filesystem');

        const nodeStream = fs.createReadStream(validatedPath, {
          highWaterMark: mergedOptions.bufferSize,
        });

        return new ReadableStream({
          start(controller) {
            nodeStream.on('data', (chunk: Buffer) => {
              controller.enqueue(new Uint8Array(chunk));
            });

            nodeStream.on('end', () => {
              controller.close();
            });

            nodeStream.on('error', (error: Error) => {
              controller.error(FileError.fromSystemError('read', validatedPath, error));
            });

            // Handle abort signal
            if (mergedOptions.signal) {
              mergedOptions.signal.addEventListener('abort', () => {
                nodeStream.destroy();
                controller.error(new Error('Read operation aborted'));
              });
            }
          },
        });
      }

      case 'deno': {
        const { Deno } = getRuntimeGlobals('deno');
        if (!Deno) throw new CompatibilityError('Deno global not available', 'deno', 'filesystem');

        const file = await Deno.open(validatedPath, { read: true });

        return new ReadableStream({
          async start(controller) {
            try {
              const buffer = new Uint8Array(mergedOptions.bufferSize);

              while (true) {
                const bytesRead = await file.read(buffer);
                if (bytesRead === null) break;

                controller.enqueue(buffer.slice(0, bytesRead));

                // Check for abort
                if (mergedOptions.signal?.aborted) {
                  throw new Error('Read operation aborted');
                }
              }

              controller.close();
            } catch (error) {
              controller.error(FileError.fromSystemError('read', validatedPath, error));
            } finally {
              file.close();
            }
          },
        });
      }

      case 'bun': {
        const { Bun } = getRuntimeGlobals('bun');
        if (!Bun || !Bun.file)
          throw new CompatibilityError('Bun.file not available', 'bun', 'filesystem');

        const file = Bun.file(validatedPath);

        // Use Bun's optimized streaming with custom buffer size
        // Bun.file().stream() is highly optimized for large files
        const stream = file.stream();

        // Wrap Bun's native stream with enhanced error handling and progress tracking
        return new ReadableStream({
          async start(controller) {
            try {
              const reader = stream.getReader();
              let totalBytesRead = 0;

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                totalBytesRead += value.length;
                controller.enqueue(value);

                // Progress callback for Bun (more efficient than other runtimes)
                if (mergedOptions.onProgress) {
                  mergedOptions.onProgress(totalBytesRead, file.size);
                }

                // Check for abort signal
                if (mergedOptions.signal?.aborted) {
                  reader.releaseLock();
                  throw new Error('Read operation aborted');
                }
              }

              controller.close();
            } catch (error) {
              controller.error(FileError.fromSystemError('read', validatedPath, error));
            }
          },
        });
      }

      default:
        throw new CompatibilityError(`Unsupported runtime: ${runtime}`, runtime, 'filesystem');
    }
  }

  /**
   * Apply decompression to stream if needed
   */
  private static async applyDecompression(
    stream: ReadableStream<Uint8Array>,
    filePath: FilePath,
    options: Required<FileReaderOptions>
  ): Promise<ReadableStream<Uint8Array>> {
    // Tiger Style: Assert function arguments
    console.assert(stream instanceof ReadableStream, 'stream must be ReadableStream');
    console.assert(typeof filePath === 'string', 'filePath must be string');
    console.assert(typeof options === 'object', 'options must be object');

    try {
      // Determine compression format
      let compressionFormat = options.compressionFormat;

      if (compressionFormat === 'none') {
        // Auto-detect compression from file extension
        compressionFormat = CompressionDetector.fromExtension(filePath);
      }

      // If no compression detected, return original stream
      if (compressionFormat === 'none') {
        return stream;
      }

      // Create appropriate decompressor
      const decompressor = createDecompressor(compressionFormat);

      // Apply decompression with merged options
      const decompressionOptions = {
        ...options.decompressionOptions,
        bufferSize: options.bufferSize,
        signal: options.signal,
        onProgress: options.onProgress,
      };

      return decompressor.wrapStream(stream, decompressionOptions);
    } catch (error) {
      throw FileError.fromSystemError('read', filePath, error);
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
  static async readToString(path: string, options: FileReaderOptions = {}): Promise<string> {
    // Tiger Style: Assert function arguments
    console.assert(typeof path === 'string', 'path must be a string');
    console.assert(path.length > 0, 'path must not be empty');
    console.assert(typeof options === 'object', 'options must be an object');

    const validatedPath = this.validatePath(path);
    const runtime = detectRuntime();
    const mergedOptions = this.mergeOptions(options, runtime);

    // Check file size before reading
    const fileSize = await this.getSize(validatedPath);
    if (fileSize > mergedOptions.maxFileSize) {
      throw new FileError(
        `File too large: ${fileSize} bytes exceeds limit of ${mergedOptions.maxFileSize} bytes`,
        validatedPath,
        'read'
      );
    }

    // Bun optimization: Use native text() method for better performance
    if (
      runtime === 'bun' &&
      mergedOptions.encoding === 'utf8' &&
      !mergedOptions.signal &&
      !mergedOptions.onProgress
    ) {
      try {
        const { Bun } = getRuntimeGlobals('bun');
        if (Bun && Bun.file) {
          const file = Bun.file(validatedPath);
          const result = await file.text();

          // Tiger Style: Assert postconditions
          console.assert(typeof result === 'string', 'result must be a string');
          return result;
        }
      } catch (error) {
        // Fall back to streaming approach if Bun optimization fails
        throw FileError.fromSystemError('read', validatedPath, error);
      }
    }

    // Fallback to streaming approach for other runtimes or when options require it
    const stream = await this.createStream(validatedPath, mergedOptions);
    const reader = stream.getReader();

    // Handle binary encoding by reading as bytes instead of text
    if (mergedOptions.encoding === 'binary') {
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          totalLength += value.length;

          // Progress callback
          if (mergedOptions.onProgress) {
            mergedOptions.onProgress(totalLength, fileSize);
          }
        }

        // Combine chunks and convert to Latin-1 string for binary compatibility
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        const result = Array.from(combined, (byte) => String.fromCharCode(byte)).join('');
        return result;
      } finally {
        reader.releaseLock();
      }
    }

    // Standard text decoding
    const decoderEncoding: BufferEncoding = mergedOptions.encoding === 'ascii' ? 'ascii' : 'utf-8';
    const decoder = new TextDecoder(decoderEncoding as any);
    let result = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        result += decoder.decode(value, { stream: true });

        // Progress callback
        if (mergedOptions.onProgress) {
          mergedOptions.onProgress(result.length, fileSize);
        }
      }

      // Final decode call
      result += decoder.decode();
    } finally {
      reader.releaseLock();
    }

    // Tiger Style: Assert postconditions
    console.assert(typeof result === 'string', 'result must be a string');
    console.assert(
      result.length <= fileSize * 4,
      'decoded string should not be excessively larger than file size'
    );

    return result;
  }

  /**
   * Validate file path and return branded type
   */
  private static validatePath(path: string): FilePath {
    // Tiger Style: Assert function arguments with explicit validation
    if (typeof path !== 'string') {
      throw new FileError('Path must be a string', path, 'stat');
    }
    if (path.length === 0) {
      throw new FileError('Path must not be empty', path, 'stat');
    }

    try {
      const validatedPath = FilePathSchema(path);
      if (typeof validatedPath !== 'string') {
        throw new FileError(`Path validation failed: ${validatedPath.toString()}`, path, 'stat');
      }
      return validatedPath;
    } catch (error) {
      throw new FileError(
        `Invalid file path: ${error instanceof Error ? error.message : String(error)}`,
        path,
        'stat'
      );
    }
  }

  /**
   * Merge user options with runtime-optimized defaults
   */
  private static mergeOptions(
    options: FileReaderOptions,
    runtime: Runtime
  ): Required<FileReaderOptions> {
    // Tiger Style: Assert function arguments
    console.assert(typeof options === 'object', 'options must be an object');
    console.assert(['node', 'deno', 'bun'].includes(runtime), 'runtime must be valid');

    const defaults = {
      ...this.DEFAULT_OPTIONS,
      bufferSize: getOptimalBufferSize(runtime),
    };

    const merged = { ...defaults, ...options };

    // Validate merged options
    try {
      FileReaderOptionsSchema(merged);
    } catch (error) {
      throw new FileError(
        `Invalid file reader options: ${error instanceof Error ? error.message : String(error)}`,
        '',
        'read'
      );
    }

    return merged;
  }

  /**
   * Validate file accessibility and constraints
   */
  private static async validateFile(
    path: FilePath,
    options: Required<FileReaderOptions>
  ): Promise<FileValidationResult> {
    // Tiger Style: Assert function arguments
    console.assert(typeof path === 'string', 'path must be a string');
    console.assert(typeof options === 'object', 'options must be an object');

    try {
      // Check if file exists
      if (!(await this.exists(path))) {
        return {
          isValid: false,
          error: 'File does not exist or is not accessible',
        };
      }

      // Get metadata
      const metadata = await this.getMetadata(path);

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
          error: 'File is not readable',
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
}
