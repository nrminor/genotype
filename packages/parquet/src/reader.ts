/**
 * Parquet reader
 *
 * Reads Parquet files as a stream of record batches via parquet-wasm.
 * Uses Effect's acquireRelease for ParquetFile handle cleanup and
 * Stream for lazy batch-at-a-time iteration.
 */

import { Effect, Stream } from "effect";
import { tableFromIPC } from "apache-arrow";
import type { Table as ArrowTable } from "apache-arrow";
import { readFileSync } from "fs";
import { initParquetWasm } from "./wasm-init";
import { ParquetReadError } from "./errors";

/**
 * Options for reading Parquet files
 */
export interface ParquetReadOptions {
  /** Number of rows per batch (default: 1024, parquet-wasm's default) */
  batchSize?: number;
  /** Only read these columns (default: all columns) */
  columns?: string[];
  /** Maximum number of rows to read */
  limit?: number;
  /** Number of rows to skip from the start */
  offset?: number;
}

/**
 * A single row from a Parquet file, with named columns.
 */
export type ParquetRow = Record<string, string | number | bigint | boolean | null>;

/**
 * Extract rows from an Arrow table batch.
 */
function extractRows(arrowTable: ArrowTable): ParquetRow[] {
  const rows: ParquetRow[] = [];
  const schema = arrowTable.schema;

  for (let i = 0; i < arrowTable.numRows; i++) {
    const row: ParquetRow = {};
    for (const field of schema.fields) {
      const col = arrowTable.getChild(field.name);
      row[field.name] = col ? (col.get(i) as string | number | bigint | boolean | null) : null;
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Create an Effect Stream of ParquetRows from a file path.
 *
 * Uses acquireRelease for ParquetFile handle cleanup, and streams
 * record batches lazily via parquet-wasm's .stream() API. Each batch
 * is converted from Arrow IPC to JS rows.
 *
 * The ParquetFile handle is freed automatically when the stream
 * finishes — whether by exhaustion, early break, or error.
 */
export const readParquetStream = (
  path: string,
  options?: ParquetReadOptions
): Stream.Stream<ParquetRow, ParquetReadError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const parquetWasm = yield* initParquetWasm.pipe(
        Effect.mapError((e) => new ParquetReadError({ message: e.message, path, cause: e }))
      );

      const blob = yield* Effect.try({
        try: () => {
          const bytes = readFileSync(path);
          return new Blob([bytes]);
        },
        catch: (cause) =>
          new ParquetReadError({
            message: `Failed to read file: ${cause instanceof Error ? cause.message : String(cause)}`,
            path,
            cause,
          }),
      });

      const pf = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => parquetWasm.ParquetFile.fromFile(blob),
          catch: (cause) =>
            new ParquetReadError({
              message: `Failed to open parquet file: ${cause instanceof Error ? cause.message : String(cause)}`,
              path,
              cause,
            }),
        }),
        (handle) => Effect.sync(() => handle.free())
      );

      const readableStream = yield* Effect.tryPromise({
        try: () =>
          pf.stream({
            batchSize: options?.batchSize ?? 1024,
            ...(options?.columns && { columns: options.columns }),
            ...(options?.limit !== undefined && { limit: options.limit }),
            ...(options?.offset !== undefined && { offset: options.offset }),
          }),
        catch: (cause) =>
          new ParquetReadError({
            message: `Failed to create record batch stream: ${cause instanceof Error ? cause.message : String(cause)}`,
            path,
            cause,
          }),
      });

      return Stream.fromAsyncIterable(
        readableStream as AsyncIterable<{ intoIPCStream(): Uint8Array }>,
        (cause) =>
          new ParquetReadError({
            message: `Error reading record batch: ${cause instanceof Error ? cause.message : String(cause)}`,
            path,
            cause,
          })
      ).pipe(
        Stream.mapEffect((wasmBatch) =>
          Effect.try({
            try: () => {
              const ipcBytes = wasmBatch.intoIPCStream();
              const arrowTable = tableFromIPC(ipcBytes);
              return extractRows(arrowTable);
            },
            catch: (cause) =>
              new ParquetReadError({
                message: `Failed to convert record batch: ${cause instanceof Error ? cause.message : String(cause)}`,
                path,
                cause,
              }),
          })
        ),
        Stream.flatMap((rows) => Stream.fromIterable(rows))
      );
    })
  );

/**
 * Read a Parquet file as an async iterable of rows.
 *
 * This is the public boundary function — it runs the Effect Stream
 * and returns an AsyncIterable for consumers who don't use Effect directly.
 *
 * Pass a signal to support cancellation — when the signal is aborted,
 * the Effect fiber is interrupted and the ParquetFile handle is freed.
 */
export async function* readParquet(
  path: string,
  options?: ParquetReadOptions & { signal?: AbortSignal }
): AsyncIterable<ParquetRow> {
  const { signal, ...readOptions } = options ?? {};
  yield* await Effect.runPromise(
    Stream.toAsyncIterableEffect(readParquetStream(path, readOptions)),
    signal ? { signal } : undefined
  );
}
