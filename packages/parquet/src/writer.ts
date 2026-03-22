/**
 * Parquet writer
 *
 * Writes Fx2TabRow data to Parquet files via parquet-wasm.
 * Collects rows into an Arrow Table, converts to IPC for parquet-wasm,
 * then serializes to Parquet bytes and writes to disk.
 */

import { Effect } from "effect";
import { writeBytes } from "@genotype/core/io/file-writer";
import type { Fx2TabRow, ColumnId } from "@genotype/tabular/fx2tab";
import { collectColumns, buildArrowTable, arrowTableToIPC } from "@genotype/parquet/arrow";
import { initParquetWasm } from "@genotype/parquet/wasm-init";
import { ParquetWriteError } from "@genotype/parquet/errors";

/**
 * Options for writing Parquet files
 */
export interface ParquetWriteOptions {
  /** Compression codec (default: uncompressed) */
  compression?: "snappy" | "gzip" | "zstd" | "lz4" | "brotli" | "uncompressed";
}

/**
 * Build the Effect that serializes tabular rows to Parquet bytes.
 *
 * This is the composable Effect core — it produces Parquet bytes
 * without performing I/O, so it can be used in larger Effect pipelines.
 */
export const serializeToParquet = <Columns extends readonly (ColumnId | string)[]>(
  source: AsyncIterable<Fx2TabRow<Columns>>,
  options?: ParquetWriteOptions
): Effect.Effect<Uint8Array, ParquetWriteError> =>
  Effect.gen(function* () {
    const { columns, data } = yield* collectColumns(source);
    const arrowTable = yield* buildArrowTable(columns, data);
    const ipcBytes = yield* arrowTableToIPC(arrowTable);

    const parquetWasm = yield* initParquetWasm.pipe(
      Effect.mapError((e) => new ParquetWriteError({ message: e.message, path: "", cause: e }))
    );

    const wasmTable = yield* Effect.try({
      try: () => parquetWasm.Table.fromIPCStream(ipcBytes),
      catch: (cause) =>
        new ParquetWriteError({
          message: `Failed to create wasm table from IPC: ${cause instanceof Error ? cause.message : String(cause)}`,
          path: "",
          cause,
        }),
    });

    let writerProperties:
      | ReturnType<
          ReturnType<typeof parquetWasm.WriterPropertiesBuilder.prototype.setCompression>["build"]
        >
      | undefined;

    if (options?.compression && options.compression !== "uncompressed") {
      const compressionMap: Record<string, number> = {
        snappy: parquetWasm.Compression.SNAPPY,
        gzip: parquetWasm.Compression.GZIP,
        zstd: parquetWasm.Compression.ZSTD,
        lz4: parquetWasm.Compression.LZ4,
        brotli: parquetWasm.Compression.BROTLI,
      };

      const compression = compressionMap[options.compression];
      if (compression !== undefined) {
        writerProperties = new parquetWasm.WriterPropertiesBuilder()
          .setCompression(compression)
          .build();
      }
    }

    return yield* Effect.try({
      try: () => parquetWasm.writeParquet(wasmTable, writerProperties ?? null),
      catch: (cause) =>
        new ParquetWriteError({
          message: `parquet-wasm serialization failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          path: "",
          cause,
        }),
    });
    // Note: writeParquet consumes the wasm table; no .free() needed.
  });

/**
 * Write tabular rows to a Parquet file.
 *
 * Collects all rows from the source, builds an Arrow Table,
 * serializes to Parquet via parquet-wasm, and writes to disk.
 *
 * This is the public boundary — it runs the Effect pipeline and
 * returns a Promise.
 */
export async function writeParquet<Columns extends readonly (ColumnId | string)[]>(
  source: AsyncIterable<Fx2TabRow<Columns>>,
  path: string,
  options?: ParquetWriteOptions
): Promise<void> {
  const parquetBytes = await Effect.runPromise(
    serializeToParquet(source, options).pipe(
      Effect.mapError((e) => new ParquetWriteError({ message: e.message, path, cause: e.cause }))
    )
  );

  await writeBytes(path, parquetBytes);
}
