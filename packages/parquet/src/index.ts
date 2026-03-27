/**
 * @genotype/parquet — Apache Parquet read/write for genotype
 *
 * Provides parquet reading and writing backed by parquet-wasm
 * and Apache Arrow. Integrates with @genotype/tabular's fx2tab column types
 * for typed sequence-to-parquet conversion.
 *
 * Importing this module augments TabularOps with writeParquet().
 */

import "./tabular-ext";
import "./seqops-ext";

export { writeParquet, serializeToParquet, type ParquetWriteOptions } from "./writer";
export { readParquet, readParquetStream, type ParquetReadOptions, type ParquetRow } from "./reader";
export { ParquetWriteError, ParquetReadError } from "./errors";
export { initParquetWasm, ParquetWasmInitError } from "./wasm-init";
export { PARQUET_VERSION } from "./version";
