/**
 * Parquet WASM module loading
 *
 * Lazily loads parquet-wasm. Under Node/Bun, the node build self-initializes
 * the wasm runtime — no explicit init() call is needed (unlike the ESM/browser
 * build which requires `await initWasm()`).
 */

import { Effect } from "effect";
import { Schema } from "effect";

export class ParquetWasmInitError extends Schema.TaggedErrorClass<ParquetWasmInitError>()(
  "ParquetWasmInitError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect) }
) {}

export type ParquetWasmModule = typeof import("parquet-wasm");

let cachedModule: ParquetWasmModule | undefined;

export const initParquetWasm: Effect.Effect<ParquetWasmModule, ParquetWasmInitError> = Effect.try({
  try: () => {
    if (cachedModule) return cachedModule;
    // Node/Bun build self-initializes; no async init needed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require("parquet-wasm") as ParquetWasmModule;
    return cachedModule;
  },
  catch: (cause) =>
    new ParquetWasmInitError({
      message: `Failed to load parquet-wasm: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    }),
});
