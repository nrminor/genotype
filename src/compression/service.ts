/**
 * Effect-based compression service for symmetric I/O
 *
 * Provides centralized, dependency-injected compression/decompression
 * that works across Node.js, Bun, and Deno transparently.
 */

import { Context, Effect, Layer } from "effect";
import { CompressionError } from "../errors";
import type { CompressionFormat } from "../types";
import {
  compress as compressGzip,
  createCompressionStream as createGzipCompressionStream,
  createStream as createGzipDecompressionStream,
  decompress as decompressGzip,
} from "./gzip";

/**
 * Service interface for compression operations
 *
 * Enables dependency injection of different compression implementations
 * (gzip, zstd, brotli, etc.) without coupling to specific implementations.
 */
export interface CompressionService {
  /**
   * Compress data using configured format
   *
   * @param data - Uncompressed data
   * @param format - Compression format (gzip, zstd, etc)
   * @param level - Compression level (1-9)
   * @returns Effect that produces compressed data
   */
  compress(
    data: Uint8Array,
    format: CompressionFormat,
    level?: number,
  ): Effect.Effect<Uint8Array, CompressionError>;

  /**
   * Decompress data using auto-detected or specified format
   *
   * @param data - Compressed data
   * @param format - Compression format (auto-detect if "none")
   * @returns Effect that produces decompressed data
   */
  decompress(
    data: Uint8Array,
    format: CompressionFormat,
  ): Effect.Effect<Uint8Array, CompressionError>;

  /**
   * Create compression transform stream
   *
   * @param format - Compression format
   * @param level - Compression level
   * @returns TransformStream for pipethrough
   */
  createCompressionStream(
    format: CompressionFormat,
    level?: number,
  ): TransformStream<Uint8Array, Uint8Array>;

  /**
   * Create decompression transform stream
   *
   * @param format - Compression format
   * @returns TransformStream for pipethrough
   */
  createDecompressionStream(format: CompressionFormat): TransformStream<Uint8Array, Uint8Array>;
}

/**
 * Tag for dependency injection
 *
 * Use with Effect.gen():
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const compressor = yield* CompressionService;
 *   const compressed = yield* compressor.compress(data, "gzip", 6);
 * });
 * ```
 */
export const CompressionService = Context.GenericTag<CompressionService>("CompressionService");

/**
 * Gzip compression service implementation
 *
 * Uses fflate library for efficient, zero-dependency compression
 */
export const GzipCompressionService: Layer.Layer<CompressionService> = Layer.succeed(
  CompressionService,
  {
    compress: (data, format, level) => {
      if (format !== "gzip") {
        return Effect.fail(
          new CompressionError(
            `GzipCompressionService only supports gzip format, got: ${format}`,
            format,
            "compress",
          ),
        );
      }

      return Effect.promise(() => compressGzip(data, { level: level ?? 6 }));
    },

    decompress: (data, format) => {
      if (format !== "gzip") {
        return Effect.fail(
          new CompressionError(
            `GzipCompressionService only supports gzip format, got: ${format}`,
            format,
            "decompress",
          ),
        );
      }

      return Effect.promise(() => decompressGzip(data));
    },

    createCompressionStream: (format, level) => {
      if (format !== "gzip") {
        throw new CompressionError(
          `GzipCompressionService only supports gzip format, got: ${format}`,
          format,
          "stream",
        );
      }
      return createGzipCompressionStream({ level: level ?? 6 });
    },

    createDecompressionStream: (format) => {
      if (format !== "gzip") {
        throw new CompressionError(
          `GzipCompressionService only supports gzip format, got: ${format}`,
          format,
          "stream",
        );
      }

      return createGzipDecompressionStream();
    },
  },
);

// ============================================================================
// MULTI-FORMAT IMPLEMENTATION (FUTURE)
// ============================================================================

/**
 * Universal compression service that supports multiple formats
 *
 * Routes to appropriate implementation based on format.
 * Can be extended with new formats without modifying routing logic.
 *
 * Usage:
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const compressor = yield* CompressionService;
 *
 *   // Works with any format
 *   const gzipped = yield* compressor.compress(data, "gzip", 9);
 *   const zstd = yield* compressor.compress(data, "zstd", 3);
 * });
 *
 * await Effect.runPromise(
 *   program.pipe(Effect.provide(MultiFormatCompressionService))
 * );
 * ```
 */
export const MultiFormatCompressionService: Layer.Layer<CompressionService> = Layer.succeed(
  CompressionService,
  {
    compress: (data, format, level) =>
      Effect.gen(function* () {
        switch (format) {
          case "gzip":
            return yield* Effect.promise(() => compressGzip(data, { level: level ?? 6 }));

          case "zstd":
            return yield* Effect.fail(
              new CompressionError("Zstd compression not yet implemented", "zstd", "compress"),
            );

          case "none":
            return data;

          default:
            return yield* Effect.fail(
              new CompressionError(
                `Unsupported compression format: ${format}`,
                format as CompressionFormat,
                "compress",
              ),
            );
        }
      }),

    decompress: (data, format) =>
      Effect.gen(function* () {
        switch (format) {
          case "gzip":
            return yield* Effect.promise(() => decompressGzip(data));

          case "zstd":
            return yield* Effect.fail(
              new CompressionError("Zstd decompression not yet implemented", "zstd", "decompress"),
            );

          case "none":
            return data;

          default:
            return yield* Effect.fail(
              new CompressionError(
                `Unsupported compression format: ${format}`,
                format as CompressionFormat,
                "decompress",
              ),
            );
        }
      }),

    createCompressionStream: (format, level) => {
      switch (format) {
        case "gzip":
          return createGzipCompressionStream({ level: level ?? 6 });
        case "zstd":
          throw new CompressionError("Zstd compression not yet implemented", "zstd", "stream");
        case "none":
          return new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              controller.enqueue(chunk);
            },
          });
        default:
          throw new CompressionError(
            `Unsupported compression format: ${format}`,
            format as CompressionFormat,
            "stream",
          );
      }
    },

    createDecompressionStream: (format) => {
      switch (format) {
        case "gzip":
          return createGzipDecompressionStream();
        case "zstd":
          throw new CompressionError("Zstd decompression not yet implemented", "zstd", "stream");
        case "none":
          return new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              controller.enqueue(chunk);
            },
          });
        default:
          throw new CompressionError(
            `Unsupported compression format: ${format}`,
            format as CompressionFormat,
            "stream",
          );
      }
    },
  },
);
