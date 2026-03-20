import { createNodeNativeBackend } from "./node-native";
import type { GenotypeBackend, NullBackend } from "./types";

const null_backend: NullBackend = {
  kind: "none",
};

let cached_backend: GenotypeBackend | undefined;
let backend_load_attempted = false;

/**
 * Get the active genotype backend.
 *
 * Today this resolves to the Node/Bun native backend when the napi
 * addon is available, otherwise to a null backend with no capabilities.
 * Future phases will add wasm and other implementations here.
 */
export async function getBackend(): Promise<GenotypeBackend> {
  if (backend_load_attempted) {
    return cached_backend ?? null_backend;
  }

  backend_load_attempted = true;
  cached_backend = createNodeNativeBackend() ?? null_backend;
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
