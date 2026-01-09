/**
 * Effect-based compression service for symmetric I/O
 *
 * Provides centralized, dependency-injected compression/decompression
 * that works across Node.js, Bun, and Deno transparently.
 *
 * ## Layer Selection Guide
 *
 * This module provides two layers with different tradeoffs:
 *
 * ### `CompressionService.Live` (Gzip-only)
 * - **Use when:** You only need gzip compression (most common case)
 * - **Initialization:** Synchronous, no async overhead
 * - **Bundle impact:** Minimal (uses fflate, already a dependency)
 * - **Zstd behavior:** Returns error if zstd format is requested
 *
 * ### `CompressionService.WithZstd` (Gzip + Zstd)
 * - **Use when:** You need to handle `.zst` files or want better compression
 * - **Initialization:** Async (loads ~160KB WASM module on first use)
 * - **Bundle impact:** Adds @hpcc-js/wasm-zstd WASM module
 * - **Resource management:** Uses `Layer.scoped` for proper lifecycle
 *
 * ## Direct Function Usage (Non-Effect)
 *
 * For code that doesn't use Effect, the standalone functions in `zstd.ts`
 * and `gzip.ts` use internal lazy-loading and can be called directly:
 *
 * ```typescript
 * import { compress, decompress } from "./compression/zstd";
 *
 * const compressed = await compress(data);
 * const decompressed = await decompress(compressed);
 * ```
 *
 * @example Using the compression service with Effect
 * ```typescript
 * import { Effect } from "effect";
 * import { CompressionService } from "./compression";
 *
 * const program = Effect.gen(function* () {
 *   const compressor = yield* CompressionService;
 *   const compressed = yield* compressor.compress(data, "gzip", 6);
 *   return compressed;
 * });
 *
 * // Run with gzip-only support (no async init required)
 * await Effect.runPromise(program.pipe(Effect.provide(CompressionService.Live)));
 *
 * // Run with gzip + zstd support (initializes Zstd WASM)
 * await Effect.runPromise(program.pipe(Effect.provide(CompressionService.WithZstd)));
 * ```
 *
 * @module compression/service
 */

import { Context, Effect, Layer } from "effect";
import { Zstd } from "@hpcc-js/wasm-zstd";
import { CompressionError } from "../errors";
import type { CompressionFormat } from "../types";
import {
  compress as compressGzip,
  createCompressionStream as createGzipCompressionStream,
  createStream as createGzipDecompressionStream,
  decompress as decompressGzip,
} from "./gzip";
import {
  createCompressionStream as createZstdCompressionStream,
  createStream as createZstdDecompressionStream,
} from "./zstd";

// =============================================================================
// SERVICE SHAPE (Interface)
// =============================================================================

/**
 * Shape of the compression service - defines the available operations.
 *
 * This interface is separate from the service tag to allow for clear
 * documentation and type inference.
 */
export interface CompressionServiceShape {
  /**
   * Compress data using the specified format
   *
   * @param data - Uncompressed data
   * @param format - Compression format (gzip, zstd, none)
   * @param level - Compression level (format-specific, typically 1-9 or 1-22)
   * @returns Effect that produces compressed data
   */
  readonly compress: (
    data: Uint8Array,
    format: CompressionFormat,
    level?: number
  ) => Effect.Effect<Uint8Array, CompressionError>;

  /**
   * Decompress data using the specified format
   *
   * @param data - Compressed data
   * @param format - Compression format used to compress the data
   * @returns Effect that produces decompressed data
   */
  readonly decompress: (
    data: Uint8Array,
    format: CompressionFormat
  ) => Effect.Effect<Uint8Array, CompressionError>;

  /**
   * Create a compression transform stream
   *
   * @param format - Compression format
   * @param level - Compression level
   * @returns TransformStream for use with Web Streams API
   */
  readonly createCompressionStream: (
    format: CompressionFormat,
    level?: number
  ) => TransformStream<Uint8Array, Uint8Array>;

  /**
   * Create a decompression transform stream
   *
   * @param format - Compression format
   * @returns TransformStream for use with Web Streams API
   */
  readonly createDecompressionStream: (
    format: CompressionFormat
  ) => TransformStream<Uint8Array, Uint8Array>;
}

// =============================================================================
// SERVICE TAG (Effect 3.x Class-Based Pattern)
// =============================================================================

/**
 * Compression service for Effect-based dependency injection
 *
 * Provides two layer options:
 * - `CompressionService.Live` - Gzip-only, no async initialization required
 * - `CompressionService.WithZstd` - Gzip + Zstd, requires async WASM initialization
 *
 * @example Basic usage with gzip
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const svc = yield* CompressionService;
 *   return yield* svc.compress(data, "gzip", 6);
 * });
 *
 * await Effect.runPromise(program.pipe(Effect.provide(CompressionService.Live)));
 * ```
 *
 * @example With Zstd support
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const svc = yield* CompressionService;
 *   return yield* svc.compress(data, "zstd", 3);
 * });
 *
 * await Effect.runPromise(program.pipe(Effect.provide(CompressionService.WithZstd)));
 * ```
 */
export class CompressionService extends Context.Tag("@genotype/CompressionService")<
  CompressionService,
  CompressionServiceShape
>() {
  /**
   * Gzip-only compression service layer
   *
   * Use this when you only need gzip support. No async initialization required.
   * Attempting to use zstd format will result in an error.
   */
  static readonly Live: Layer.Layer<CompressionService> = Layer.succeed(
    CompressionService,
    createGzipOnlyService()
  );

  /**
   * Multi-format compression service layer with Zstd support
   *
   * Initializes the Zstd WASM module on layer construction.
   * Supports gzip, zstd, and passthrough (none) formats.
   */
  static readonly WithZstd: Layer.Layer<CompressionService, CompressionError> = Layer.scoped(
    CompressionService,
    Effect.gen(function* () {
      // Load Zstd WASM module
      const zstd = yield* Effect.tryPromise({
        try: () => Zstd.load(),
        catch: (error) =>
          new CompressionError(
            `Failed to initialize Zstd WASM: ${error instanceof Error ? error.message : String(error)}`,
            "zstd",
            "validate"
          ),
      });

      return createMultiFormatService(zstd);
    })
  );
}

// =============================================================================
// FORMAT VALIDATION
// =============================================================================

/**
 * Supported formats for the multi-format service
 */
const MULTI_FORMAT_SUPPORTED: readonly CompressionFormat[] = ["gzip", "zstd", "none"] as const;

/**
 * Validate that a format is supported by the multi-format service
 *
 * Returns the format if valid, fails with CompressionError if not.
 */
function validateMultiFormat(
  format: CompressionFormat,
  operation: "compress" | "decompress" | "stream"
): Effect.Effect<CompressionFormat, CompressionError> {
  if (MULTI_FORMAT_SUPPORTED.includes(format)) {
    return Effect.succeed(format);
  }
  return Effect.fail(
    new CompressionError(`Unsupported compression format: ${format}`, format, operation)
  );
}

/**
 * Validate that a format is supported by the gzip-only service
 *
 * Returns the format if valid, fails with CompressionError if not.
 */
function validateGzipOnlyFormat(
  format: CompressionFormat,
  operation: "compress" | "decompress" | "stream"
): Effect.Effect<CompressionFormat, CompressionError> {
  if (format === "gzip" || format === "none") {
    return Effect.succeed(format);
  }
  return Effect.fail(
    new CompressionError(
      `CompressionService.Live only supports gzip format, got: ${format}. Use CompressionService.WithZstd for zstd support.`,
      format,
      operation
    )
  );
}

/**
 * Run a validation Effect synchronously, throwing on failure
 *
 * Used by streaming methods to maintain the synchronous public API
 * while using Effect internally for validation.
 */
function runValidation<A>(effect: Effect.Effect<A, CompressionError>): A {
  return Effect.runSync(effect);
}

// =============================================================================
// SERVICE IMPLEMENTATIONS
// =============================================================================

/**
 * Create a gzip-only compression service implementation
 */
function createGzipOnlyService(): CompressionServiceShape {
  return {
    compress: (data, format, level) =>
      Effect.gen(function* () {
        const validFormat = yield* validateGzipOnlyFormat(format, "compress");

        if (validFormat === "none") {
          return data;
        }

        return yield* Effect.tryPromise({
          try: () => compressGzip(data, { level: level ?? 6 }),
          catch: (error) => CompressionError.fromSystemError("gzip", "compress", error),
        });
      }),

    decompress: (data, format) =>
      Effect.gen(function* () {
        const validFormat = yield* validateGzipOnlyFormat(format, "decompress");

        if (validFormat === "none") {
          return data;
        }

        return yield* Effect.tryPromise({
          try: () => decompressGzip(data),
          catch: (error) => CompressionError.fromSystemError("gzip", "decompress", error),
        });
      }),

    createCompressionStream: (format, level) => {
      // Validate format using Effect, throw if invalid (preserves public API)
      const validFormat = runValidation(validateGzipOnlyFormat(format, "stream"));

      if (validFormat === "none") {
        return createPassthroughStream();
      }

      return createGzipCompressionStream({ level: level ?? 6 });
    },

    createDecompressionStream: (format) => {
      // Validate format using Effect, throw if invalid (preserves public API)
      const validFormat = runValidation(validateGzipOnlyFormat(format, "stream"));

      if (validFormat === "none") {
        return createPassthroughStream();
      }

      return createGzipDecompressionStream();
    },
  };
}

/**
 * Create a multi-format compression service implementation
 *
 * @param zstd - Initialized Zstd WASM instance
 */
function createMultiFormatService(zstd: Zstd): CompressionServiceShape {
  return {
    compress: (data, format, level) =>
      Effect.gen(function* () {
        const validFormat = yield* validateMultiFormat(format, "compress");

        switch (validFormat) {
          case "gzip":
            return yield* Effect.tryPromise({
              try: () => compressGzip(data, { level: level ?? 6 }),
              catch: (error) => CompressionError.fromSystemError("gzip", "compress", error),
            });

          case "zstd":
            return yield* Effect.try({
              try: () => zstd.compress(data, level ?? 3),
              catch: (error) => CompressionError.fromSystemError("zstd", "compress", error),
            });

          case "none":
            return data;
        }
      }),

    decompress: (data, format) =>
      Effect.gen(function* () {
        const validFormat = yield* validateMultiFormat(format, "decompress");

        switch (validFormat) {
          case "gzip":
            return yield* Effect.tryPromise({
              try: () => decompressGzip(data),
              catch: (error) => CompressionError.fromSystemError("gzip", "decompress", error),
            });

          case "zstd":
            return yield* Effect.try({
              try: () => zstd.decompress(data),
              catch: (error) => CompressionError.fromSystemError("zstd", "decompress", error),
            });

          case "none":
            return data;
        }
      }),

    createCompressionStream: (format, level) => {
      // Validate format using Effect, throw if invalid (preserves public API)
      const validFormat = runValidation(validateMultiFormat(format, "stream"));

      switch (validFormat) {
        case "gzip":
          return createGzipCompressionStream({ level: level ?? 6 });
        case "zstd":
          return createZstdCompressionStream(level);
        case "none":
          return createPassthroughStream();
      }
    },

    createDecompressionStream: (format) => {
      // Validate format using Effect, throw if invalid (preserves public API)
      const validFormat = runValidation(validateMultiFormat(format, "stream"));

      switch (validFormat) {
        case "gzip":
          return createGzipDecompressionStream();
        case "zstd":
          return createZstdDecompressionStream();
        case "none":
          return createPassthroughStream();
      }
    },
  };
}

/**
 * Create a passthrough stream that forwards data unchanged
 */
function createPassthroughStream(): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
  });
}

// =============================================================================
// BACKWARD COMPATIBILITY EXPORTS
// =============================================================================

/**
 * @deprecated Use `CompressionService.Live` instead
 */
export const GzipCompressionService: Layer.Layer<CompressionService> = CompressionService.Live;

/**
 * @deprecated Use `CompressionService.WithZstd` instead
 */
export const MultiFormatCompressionService: Layer.Layer<CompressionService, CompressionError> =
  CompressionService.WithZstd;
