/**
 * Mock and test compression layers for Effect DI testing.
 *
 * Provides reusable Layer implementations for testing compression-dependent
 * operations without actual compression/decompression overhead.
 */

import { Effect, Layer } from "effect";
import {
  CompressionError,
  CompressionService,
  type CompressionServiceShape,
} from "../../src/compression/service";
import type { CompressionFormat } from "../../src/types";

/**
 * Mock compression service that passes through data unchanged.
 */
export const MockCompressionService: Layer.Layer<CompressionService> = Layer.succeed(
  CompressionService,
  {
    compress: (data: Uint8Array, format: CompressionFormat) => {
      if (format === "none") return Effect.succeed(data);
      return Effect.succeed(data);
    },

    decompress: (data: Uint8Array, format: CompressionFormat) => {
      if (format === "none") return Effect.succeed(data);
      return Effect.succeed(data);
    },

    createCompressionStream: () =>
      Effect.succeed(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
        })
      ),

    createDecompressionStream: () =>
      Effect.succeed(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
        })
      ),
  }
);

/**
 * Failing compression service for error handling tests.
 */
export function createFailingCompressionService(
  errorMessage: string = "Simulated compression failure"
): Layer.Layer<CompressionService> {
  return Layer.succeed(CompressionService, {
    compress: () =>
      Effect.fail(
        new CompressionError({ message: errorMessage, format: "gzip", operation: "compress" })
      ),

    decompress: () =>
      Effect.fail(
        new CompressionError({ message: errorMessage, format: "gzip", operation: "decompress" })
      ),

    createCompressionStream: () =>
      Effect.fail(
        new CompressionError({ message: errorMessage, format: "gzip", operation: "stream" })
      ),

    createDecompressionStream: () =>
      Effect.fail(
        new CompressionError({ message: errorMessage, format: "gzip", operation: "stream" })
      ),
  });
}

/**
 * Tracking compression service for observing operations.
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
  baseService: CompressionServiceShape
): Layer.Layer<CompressionService> {
  return Layer.succeed(CompressionService, {
    compress: (data: Uint8Array, format: CompressionFormat, level?: number) => {
      tracker.compressCalls.push({
        data,
        format,
        ...(level !== undefined && { level }),
      });
      return level !== undefined
        ? baseService.compress(data, format, level)
        : baseService.compress(data, format);
    },

    decompress: (data: Uint8Array, format: CompressionFormat) => {
      tracker.decompressCalls.push({ data, format });
      return baseService.decompress(data, format);
    },

    createCompressionStream: (format: CompressionFormat, level?: number) =>
      baseService.createCompressionStream(format, level),

    createDecompressionStream: (format: CompressionFormat) =>
      baseService.createDecompressionStream(format),
  });
}

/**
 * Slow compression service for simulating performance issues.
 */
export function createSlowCompressionService(
  delayMs: number = 100,
  baseService?: CompressionServiceShape
): Layer.Layer<CompressionService> {
  return Layer.succeed(CompressionService, {
    compress: (data: Uint8Array, format: CompressionFormat, level?: number) =>
      Effect.gen(function* () {
        yield* Effect.sleep(delayMs);
        if (baseService) return yield* baseService.compress(data, format, level);
        return data;
      }),

    decompress: (data: Uint8Array, format: CompressionFormat) =>
      Effect.gen(function* () {
        yield* Effect.sleep(delayMs);
        if (baseService) return yield* baseService.decompress(data, format);
        return data;
      }),

    createCompressionStream: (format: CompressionFormat, level?: number) => {
      if (baseService) return baseService.createCompressionStream(format, level);
      return Effect.succeed(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
        })
      );
    },

    createDecompressionStream: (format: CompressionFormat) => {
      if (baseService) return baseService.createDecompressionStream(format);
      return Effect.succeed(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
        })
      );
    },
  });
}

/**
 * Format-restricted compression service for testing format validation.
 */
export function createFormatRestrictedCompressionService(
  allowedFormats: CompressionFormat[]
): Layer.Layer<CompressionService> {
  return Layer.succeed(CompressionService, {
    compress: (data: Uint8Array, format: CompressionFormat) => {
      if (!allowedFormats.includes(format)) {
        return Effect.fail(
          new CompressionError({
            message: `Format ${format} not allowed. Allowed: ${allowedFormats.join(", ")}`,
            format,
            operation: "compress",
          })
        );
      }
      return Effect.succeed(data);
    },

    decompress: (data: Uint8Array, format: CompressionFormat) => {
      if (!allowedFormats.includes(format)) {
        return Effect.fail(
          new CompressionError({
            message: `Format ${format} not allowed. Allowed: ${allowedFormats.join(", ")}`,
            format,
            operation: "decompress",
          })
        );
      }
      return Effect.succeed(data);
    },

    createCompressionStream: (format: CompressionFormat) => {
      if (!allowedFormats.includes(format)) {
        return Effect.fail(
          new CompressionError({
            message: `Format ${format} not allowed. Allowed: ${allowedFormats.join(", ")}`,
            format,
            operation: "stream",
          })
        );
      }
      return Effect.succeed(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
        })
      );
    },

    createDecompressionStream: (format: CompressionFormat) => {
      if (!allowedFormats.includes(format)) {
        return Effect.fail(
          new CompressionError({
            message: `Format ${format} not allowed. Allowed: ${allowedFormats.join(", ")}`,
            format,
            operation: "stream",
          })
        );
      }
      return Effect.succeed(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
        })
      );
    },
  });
}
