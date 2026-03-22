/**
 * Effect-based compression service for symmetric I/O.
 *
 * Provides centralized, dependency-injected compression/decompression
 * that works across Node.js, Bun, and Deno transparently.
 *
 * Two layers are available with different tradeoffs:
 *
 * `CompressionService.Live` provides gzip-only support with synchronous
 * initialization. `CompressionService.WithZstd` adds zstd support but
 * requires async WASM initialization.
 *
 * For code that doesn't use Effect, the standalone functions in `zstd.ts`
 * and `gzip.ts` use internal lazy-loading and can be called directly.
 */

import { Effect, Layer, Schema, ServiceMap } from "effect";
import { Zstd } from "@hpcc-js/wasm-zstd";
import type { CompressionFormat } from "@genotype/core/types";
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

export class CompressionError extends Schema.TaggedErrorClass<CompressionError>()(
  "CompressionError",
  {
    message: Schema.String,
    format: Schema.Literals(["gzip", "zstd", "none"] as const),
    operation: Schema.Literals(["detect", "decompress", "stream", "validate", "compress"] as const),
    cause: Schema.optional(Schema.Defect),
  }
) {}

export interface CompressionServiceShape {
  readonly compress: (
    data: Uint8Array,
    format: CompressionFormat,
    level?: number
  ) => Effect.Effect<Uint8Array, CompressionError>;

  readonly decompress: (
    data: Uint8Array,
    format: CompressionFormat
  ) => Effect.Effect<Uint8Array, CompressionError>;

  readonly createCompressionStream: (
    format: CompressionFormat,
    level?: number
  ) => Effect.Effect<TransformStream<Uint8Array, Uint8Array>, CompressionError>;

  readonly createDecompressionStream: (
    format: CompressionFormat
  ) => Effect.Effect<TransformStream<Uint8Array, Uint8Array>, CompressionError>;
}

const MULTI_FORMAT_SUPPORTED: readonly CompressionFormat[] = ["gzip", "zstd", "none"] as const;

const validateMultiFormat = (
  format: CompressionFormat,
  operation: "compress" | "decompress" | "stream"
) =>
  MULTI_FORMAT_SUPPORTED.includes(format)
    ? Effect.succeed(format)
    : Effect.fail(
        new CompressionError({
          message: `Unsupported compression format: ${format}`,
          format,
          operation,
        })
      );

const validateGzipOnlyFormat = (
  format: CompressionFormat,
  operation: "compress" | "decompress" | "stream"
) =>
  format === "gzip" || format === "none"
    ? Effect.succeed(format)
    : Effect.fail(
        new CompressionError({
          message: `CompressionService.Live only supports gzip format, got: ${format}. Use CompressionService.WithZstd for zstd support.`,
          format,
          operation,
        })
      );

function createPassthroughStream(): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
  });
}

const gzipCompress = Effect.fn("CompressionService.compress")(function* (
  data: Uint8Array,
  format: CompressionFormat,
  level?: number
) {
  const validFormat = yield* validateGzipOnlyFormat(format, "compress");
  if (validFormat === "none") return data;
  return yield* Effect.tryPromise({
    try: () => compressGzip(data, { level: level ?? 6 }),
    catch: (cause) =>
      new CompressionError({
        message: `compress failed for gzip: ${cause instanceof Error ? cause.message : String(cause)}`,
        format: "gzip",
        operation: "compress",
        cause,
      }),
  });
});

const gzipDecompress = Effect.fn("CompressionService.decompress")(function* (
  data: Uint8Array,
  format: CompressionFormat
) {
  const validFormat = yield* validateGzipOnlyFormat(format, "decompress");
  if (validFormat === "none") return data;
  return yield* Effect.tryPromise({
    try: () => decompressGzip(data),
    catch: (cause) =>
      new CompressionError({
        message: `decompress failed for gzip: ${cause instanceof Error ? cause.message : String(cause)}`,
        format: "gzip",
        operation: "decompress",
        cause,
      }),
  });
});

export class CompressionService extends ServiceMap.Service<
  CompressionService,
  CompressionServiceShape
>()("@genotype/CompressionService") {
  static readonly Live: Layer.Layer<CompressionService> = Layer.succeed(CompressionService)(
    CompressionService.of({
      compress: gzipCompress,
      decompress: gzipDecompress,
      createCompressionStream: (format, level) =>
        Effect.gen(function* () {
          const validFormat = yield* validateGzipOnlyFormat(format, "stream");
          if (validFormat === "none") return createPassthroughStream();
          return createGzipCompressionStream({ level: level ?? 6 });
        }),
      createDecompressionStream: (format) =>
        Effect.gen(function* () {
          const validFormat = yield* validateGzipOnlyFormat(format, "stream");
          if (validFormat === "none") return createPassthroughStream();
          return createGzipDecompressionStream();
        }),
    })
  );

  static readonly WithZstd: Layer.Layer<CompressionService, CompressionError> = Layer.effect(
    CompressionService
  )(
    Effect.gen(function* () {
      const zstd = yield* Effect.tryPromise({
        try: () => Zstd.load(),
        catch: (cause) =>
          new CompressionError({
            message: `Failed to initialize Zstd WASM: ${cause instanceof Error ? cause.message : String(cause)}`,
            format: "zstd",
            operation: "validate",
            cause,
          }),
      });

      const compress = Effect.fn("CompressionService.compress")(function* (
        data: Uint8Array,
        format: CompressionFormat,
        level?: number
      ) {
        const validFormat = yield* validateMultiFormat(format, "compress");
        switch (validFormat) {
          case "gzip":
            return yield* Effect.tryPromise({
              try: () => compressGzip(data, { level: level ?? 6 }),
              catch: (cause) =>
                new CompressionError({
                  message: `compress failed for gzip: ${cause instanceof Error ? cause.message : String(cause)}`,
                  format: "gzip",
                  operation: "compress",
                  cause,
                }),
            });
          case "zstd":
            return yield* Effect.try({
              try: () => zstd.compress(data, level ?? 3),
              catch: (cause) =>
                new CompressionError({
                  message: `compress failed for zstd: ${cause instanceof Error ? cause.message : String(cause)}`,
                  format: "zstd",
                  operation: "compress",
                  cause,
                }),
            });
          case "none":
            return data;
        }
      });

      const decompress = Effect.fn("CompressionService.decompress")(function* (
        data: Uint8Array,
        format: CompressionFormat
      ) {
        const validFormat = yield* validateMultiFormat(format, "decompress");
        switch (validFormat) {
          case "gzip":
            return yield* Effect.tryPromise({
              try: () => decompressGzip(data),
              catch: (cause) =>
                new CompressionError({
                  message: `decompress failed for gzip: ${cause instanceof Error ? cause.message : String(cause)}`,
                  format: "gzip",
                  operation: "decompress",
                  cause,
                }),
            });
          case "zstd":
            return yield* Effect.try({
              try: () => zstd.decompress(data),
              catch: (cause) =>
                new CompressionError({
                  message: `decompress failed for zstd: ${cause instanceof Error ? cause.message : String(cause)}`,
                  format: "zstd",
                  operation: "decompress",
                  cause,
                }),
            });
          case "none":
            return data;
        }
      });

      return CompressionService.of({
        compress,
        decompress,
        createCompressionStream: (format, level) =>
          Effect.gen(function* () {
            const validFormat = yield* validateMultiFormat(format, "stream");
            switch (validFormat) {
              case "gzip":
                return createGzipCompressionStream({ level: level ?? 6 });
              case "zstd":
                return createZstdCompressionStream(level);
              case "none":
                return createPassthroughStream();
            }
          }),
        createDecompressionStream: (format) =>
          Effect.gen(function* () {
            const validFormat = yield* validateMultiFormat(format, "stream");
            switch (validFormat) {
              case "gzip":
                return createGzipDecompressionStream();
              case "zstd":
                return createZstdDecompressionStream();
              case "none":
                return createPassthroughStream();
            }
          }),
      });
    })
  );
}
