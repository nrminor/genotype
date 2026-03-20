import { createNodeNativeBackend } from "./node-native";
import { createWasmBackend } from "./wasm";
import type { GenotypeBackend, NullBackend } from "./types";

const null_backend: NullBackend = {
  kind: "none",
};

let cached_backend: GenotypeBackend | undefined;
let backend_load_attempted = false;

/**
 * Get the active genotype backend.
 *
 * Tries backends in order of preference: native napi addon first (best
 * performance), then wasm (browser-compatible), then a null backend
 * with no capabilities. The result is cached after the first call.
 */
export async function getBackend(): Promise<GenotypeBackend> {
  if (backend_load_attempted) {
    return cached_backend ?? null_backend;
  }

  backend_load_attempted = true;

  // Try native first — best performance, requires napi addon
  const native = createNodeNativeBackend();
  if (native !== undefined) {
    cached_backend = native;
    return cached_backend;
  }

  // Try wasm — browser-compatible, requires wasm-pack build
  const wasm = await createWasmBackend();
  if (wasm !== undefined) {
    cached_backend = wasm;
    return cached_backend;
  }

  cached_backend = null_backend;
  return cached_backend;
}

/**
 * Whether any accelerated backend is available.
 */
export async function isBackendAvailable(): Promise<boolean> {
  const backend = await getBackend();
  return backend.kind !== "none";
}

export type {
  AlignmentBatch,
  AlignmentReaderHandle,
  FindPatternBatchOptions,
  GenotypeBackend,
  GrepBatchOptions,
  NullBackend,
  ReferenceSequenceInfo,
} from "./types";

export { createNodeNativeBackend, isNodeNativeBackendAvailable } from "./node-native";
