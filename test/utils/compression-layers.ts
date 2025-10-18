/**
 * Mock and test compression layers for Effect DI testing
 *
 * Provides reusable Layer implementations for testing compression-dependent
 * operations without actual compression/decompression overhead.
 *
 * Usage:
 * ```typescript
 * // In tests, swap layers easily
 * const result = await Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(MockCompressionService),  // Fast tests
 *   ),
 * );
 * ```
 */

import { Context, Effect, Layer } from "effect";
import { CompressionError } from "../../src/errors";
import type { CompressionFormat } from "../../src/types";
import { CompressionService } from "../../src/compression";

/**
 * Mock compression service that passes through data unchanged
 *
 * Useful for testing compression-dependent I/O without actual compression overhead.
 * All compress/decompress operations return data unchanged.
 */
export const MockCompressionService: Layer.Layer<CompressionService> = Layer.succeed(
  CompressionService,
  {
    compress: (data: Uint8Array, format: CompressionFormat) => {
      // Simulate compression by adding a marker byte
      if (format === "none") {
        return Effect.succeed(data);
      }
      // Pass through unchanged for testing
      return Effect.succeed(data);
    },

    decompress: (data: Uint8Array, format: CompressionFormat) => {
      // Simulate decompression by removing the marker byte if present
      if (format === "none") {
        return Effect.succeed(data);
      }
      // Pass through unchanged for testing
      return Effect.succeed(data);
    },

    createCompressionStream: (format: CompressionFormat) => {
      return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      });
    },

    createDecompressionStream: (format: CompressionFormat) => {
      return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      });
    },
  }
);

/**
 * Failing compression service for error handling tests
 *
 * All operations fail with specified error message.
 * Useful for testing error propagation through I/O operations.
 */
export function createFailingCompressionService(
  errorMessage: string = "Simulated compression failure"
): Layer.Layer<CompressionService> {
  return Layer.succeed(CompressionService, {
    compress: () => {
      return Effect.fail(new CompressionError(errorMessage, "gzip", "compress"));
    },

    decompress: () => {
      return Effect.fail(new CompressionError(errorMessage, "gzip", "decompress"));
    },

    createCompressionStream: () => {
      throw new CompressionError(errorMessage, "gzip", "stream");
    },

    createDecompressionStream: () => {
      throw new CompressionError(errorMessage, "gzip", "stream");
    },
  });
}

/**
 * Tracking compression service for observing operations
 *
 * Records all compression/decompression calls for assertions in tests.
 * Wraps real compression service with tracking.
 */
export interface CompressionTracker {
  compressCalls: Array<{
    data: Uint8Array;
    format: CompressionFormat;
    level?: number;
  }>;
  decompressCalls: Array<{
    data: Uint8Array;
    format: CompressionFormat;
  }>;
  reset(): void;
}

export function createTrackingCompressionService(
  tracker: CompressionTracker,
  baseService: CompressionService
): Layer.Layer<CompressionService> {
  return Layer.succeed(CompressionService, {
    compress: (data: Uint8Array, format: CompressionFormat, level?: number) => {
      tracker.compressCalls.push({ data, format, level });
      return baseService.compress(data, format, level);
    },

    decompress: (data: Uint8Array, format: CompressionFormat) => {
      tracker.decompressCalls.push({ data, format });
      return baseService.decompress(data, format);
    },

    createCompressionStream: (format: CompressionFormat, level?: number) => {
      return baseService.createCompressionStream(format, level);
    },

    createDecompressionStream: (format: CompressionFormat) => {
      return baseService.createDecompressionStream(format);
    },
  });
}

/**
 * Slow compression service for simulating performance issues
 *
 * Adds artificial delay before operations. Useful for testing
 * timeout handling and concurrent operation behavior.
 */
export function createSlowCompressionService(
  delayMs: number = 100,
  baseService?: CompressionService
): Layer.Layer<CompressionService> {
  return Layer.succeed(CompressionService, {
    compress: (data: Uint8Array, format: CompressionFormat, level?: number) => {
      return Effect.gen(function* () {
        yield* Effect.sleep(delayMs);
        if (baseService) {
          return yield* baseService.compress(data, format, level);
        }
        return data;
      });
    },

    decompress: (data: Uint8Array, format: CompressionFormat) => {
      return Effect.gen(function* () {
        yield* Effect.sleep(delayMs);
        if (baseService) {
          return yield* baseService.decompress(data, format);
        }
        return data;
      });
    },

    createCompressionStream: (format: CompressionFormat, level?: number) => {
      if (baseService) {
        return baseService.createCompressionStream(format, level);
      }
      return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      });
    },

    createDecompressionStream: (format: CompressionFormat) => {
      if (baseService) {
        return baseService.createDecompressionStream(format);
      }
      return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      });
    },
  });
}

/**
 * Format-restricted compression service
 *
 * Only allows specific compression formats.
 * Useful for testing format validation in I/O operations.
 */
export function createFormatRestrictedCompressionService(
  allowedFormats: CompressionFormat[]
): Layer.Layer<CompressionService> {
  return Layer.succeed(CompressionService, {
    compress: (data: Uint8Array, format: CompressionFormat, level?: number) => {
      if (!allowedFormats.includes(format)) {
        return Effect.fail(
          new CompressionError(
            `Format ${format} not allowed. Allowed: ${allowedFormats.join(", ")}`,
            format,
            "compress"
          )
        );
      }
      return Effect.succeed(data);
    },

    decompress: (data: Uint8Array, format: CompressionFormat) => {
      if (!allowedFormats.includes(format)) {
        return Effect.fail(
          new CompressionError(
            `Format ${format} not allowed. Allowed: ${allowedFormats.join(", ")}`,
            format,
            "decompress"
          )
        );
      }
      return Effect.succeed(data);
    },

    createCompressionStream: (format: CompressionFormat) => {
      if (!allowedFormats.includes(format)) {
        throw new CompressionError(
          `Format ${format} not allowed. Allowed: ${allowedFormats.join(", ")}`,
          format,
          "stream"
        );
      }
      return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      });
    },

    createDecompressionStream: (format: CompressionFormat) => {
      if (!allowedFormats.includes(format)) {
        throw new CompressionError(
          `Format ${format} not allowed. Allowed: ${allowedFormats.join(", ")}`,
          format,
          "stream"
        );
      }
      return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      });
    },
  });
}
