/**
 * Arrow conversion utilities
 *
 * Bridges between Fx2TabRow (row-oriented) and Apache Arrow (columnar).
 * Collects rows into column arrays, builds Arrow Tables for parquet-wasm.
 *
 * These are internal to @genotype/parquet — not part of the public API.
 */

import { Effect } from "effect";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import type { Table } from "apache-arrow";
import type { Fx2TabRow, ColumnId } from "@genotype/tabular/fx2tab";
import { ParquetWriteError } from "@genotype/parquet/errors";

/**
 * Infer whether a column holds numeric or string values based on collected data.
 * Returns true if all non-null values are numeric.
 */
function isNumericColumn(values: (string | number | null)[]): boolean {
  for (const v of values) {
    if (v === null) continue;
    if (typeof v === "number") continue;
    const n = Number(v);
    if (!Number.isFinite(n)) return false;
  }
  return values.some((v) => v !== null);
}

interface CollectedColumns<Columns extends readonly (ColumnId | string)[]> {
  columns: Columns;
  data: Map<string, (string | number | null)[]>;
}

/**
 * Collect rows from an AsyncIterable into columnar arrays.
 */
export const collectColumns = <Columns extends readonly (ColumnId | string)[]>(
  source: AsyncIterable<Fx2TabRow<Columns>>
): Effect.Effect<CollectedColumns<Columns>, ParquetWriteError> =>
  Effect.tryPromise({
    try: async () => {
      const data = new Map<string, (string | number | null)[]>();
      let columns: Columns | undefined;

      for await (const row of source) {
        if (!columns) {
          columns = row.__columns;
          for (const col of columns) {
            data.set(col, []);
          }
        }

        for (const col of columns) {
          const value = row[col as keyof typeof row] as string | number | null;
          data.get(col)!.push(value);
        }
      }

      if (!columns) {
        throw new Error("No rows to collect — source was empty");
      }

      return { columns, data };
    },
    catch: (cause) =>
      new ParquetWriteError({
        message: `Failed to collect rows: ${cause instanceof Error ? cause.message : String(cause)}`,
        path: "",
        cause,
      }),
  });

/**
 * Build an Apache Arrow Table from collected columnar data.
 *
 * Numeric columns become Float64 arrays, string columns become string arrays.
 * Null values are preserved in both cases.
 */
export const buildArrowTable = (
  columns: readonly string[],
  data: Map<string, (string | number | null)[]>
): Effect.Effect<Table, ParquetWriteError> =>
  Effect.try({
    try: () => {
      const input: Record<string, (number | null)[] | (string | null)[]> = {};

      for (const col of columns) {
        const values = data.get(col)!;

        if (isNumericColumn(values)) {
          input[col] = values.map((v) => (v === null ? null : Number(v)));
        } else {
          input[col] = values.map((v) => (v === null ? null : String(v)));
        }
      }

      return tableFromArrays(input);
    },
    catch: (cause) =>
      new ParquetWriteError({
        message: `Failed to build Arrow table: ${cause instanceof Error ? cause.message : String(cause)}`,
        path: "",
        cause,
      }),
  });

/**
 * Serialize an Apache Arrow Table to IPC stream format (for parquet-wasm).
 */
export const arrowTableToIPC = (table: Table): Effect.Effect<Uint8Array, ParquetWriteError> =>
  Effect.try({
    try: () => tableToIPC(table, "stream"),
    catch: (cause) =>
      new ParquetWriteError({
        message: `Failed to serialize Arrow table to IPC: ${cause instanceof Error ? cause.message : String(cause)}`,
        path: "",
        cause,
      }),
  });
