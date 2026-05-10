import { transformBatch } from "@genotype/core/backend/service";
import { getNodeNativeKernelSync } from "@genotype/core/backend/node-native";
import type { TransformOp } from "@genotype/core/backend/kernel-types";

if (getNodeNativeKernelSync()) {
  throw new Error("wasm fallback check unexpectedly resolved a native engine");
}

const result = await transformBatch(
  new TextEncoder().encode("ACGT"),
  new Uint32Array([0, 4]),
  "Reverse" as TransformOp
);
const text = new TextDecoder().decode(result.data);

if (text !== "TGCA") {
  throw new Error(`wasm engine returned unexpected transform result: ${text}`);
}

console.log("wasm engine fallback runtime smoke passed");
