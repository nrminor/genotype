/**
 * Parquet WASM module loading
 *
 * Lazily loads parquet-wasm. Under Node/Bun, the node build self-initializes
 * the wasm runtime — no explicit init() call is needed (unlike the ESM/browser
 * build which requires `await initWasm()`).
 */

import { Effect } from "effect";
import { Schema } from "effect";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as wasmModule from "parquet-wasm/esm";

const resolveParquetWasm = createRequire(import.meta.url).resolve;

export class ParquetWasmInitError extends Schema.TaggedErrorClass<ParquetWasmInitError>()(
  "ParquetWasmInitError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect) }
) {}

export type ParquetWasmModule = typeof wasmModule;

let cachedModule: ParquetWasmModule | undefined;

export const initParquetWasm: Effect.Effect<ParquetWasmModule, ParquetWasmInitError> = Effect.try({
  try: () => {
    if (cachedModule) return cachedModule;
    const wasmPath = resolveParquetWasm("parquet-wasm/esm/parquet_wasm_bg.wasm");
    const wasmBytes = readFileSync(wasmPath);
    wasmModule.initSync({ module: wasmBytes });
    cachedModule = wasmModule;
    return cachedModule;
  },
  catch: (cause) =>
    new ParquetWasmInitError({
      message: `Failed to load parquet-wasm: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    }),
});
