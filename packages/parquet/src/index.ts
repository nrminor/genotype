/**
 * @genotype/parquet — Apache Parquet read/write for genotype
 *
 * Provides parquet reading and writing backed by parquet-wasm
 * and Apache Arrow. Integrates with @genotype/tabular's fx2tab column types
 * for typed sequence-to-parquet conversion.
 *
 * Importing this module augments TabularOps with writeParquet().
 */

import "@genotype/parquet/tabular-ext";

export {
  writeParquet,
  serializeToParquet,
  type ParquetWriteOptions,
} from "@genotype/parquet/writer";
export {
  readParquet,
  readParquetStream,
  type ParquetReadOptions,
  type ParquetRow,
} from "@genotype/parquet/reader";
export { ParquetWriteError, ParquetReadError } from "@genotype/parquet/errors";
export { initParquetWasm, ParquetWasmInitError } from "@genotype/parquet/wasm-init";
export { PARQUET_VERSION } from "@genotype/parquet/version";
