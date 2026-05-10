import { Buffer } from "node:buffer";
import { getNodeNativeKernelSync } from "@genotype/core/backend/node-native";
import type { TransformOp } from "@genotype/core/backend/kernel-types";

const kernel = getNodeNativeKernelSync();
if (!kernel) throw new Error("expected native engine package to resolve");

const result = kernel.transformBatch(
  Buffer.from("ACGT"),
  new Uint32Array([0, 4]),
  "Reverse" as TransformOp
);
const text = new TextDecoder().decode(result.data);

if (text !== "TGCA") {
  throw new Error(`native engine returned unexpected transform result: ${text}`);
}

console.log("native engine runtime smoke passed");
