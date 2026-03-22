/**
 * Runtime detection and Effect platform layer selection
 *
 * Provides runtime detection for Node.js, Bun, and Deno, and returns
 * appropriate Effect platform layers for cross-platform file I/O.
 */

import * as BunServices from "@effect/platform-bun/BunServices";
import * as NodeServices from "@effect/platform-node/NodeServices";

/**
 * Detect the current JavaScript runtime
 *
 * Used for telemetry/logging and platform layer selection.
 * Checks for runtime-specific global objects in order of preference.
 *
 * @returns The detected runtime identifier
 * @example
 * ```typescript
 * const runtime = detectRuntime();
 * console.log(`Running on ${runtime}`);
 * ```
 */
export const detectRuntime = (): "node" | "bun" | "deno" => {
  // Check for Bun first (most specific)
  if (typeof (globalThis as any).Bun !== "undefined") return "bun";

  // Check for Deno
  if (typeof (globalThis as any).Deno !== "undefined") return "deno";

  // Default to Node.js (most compatible)
  return "node";
};

/**
 * Get appropriate Effect platform layer for current runtime
 *
 * Returns a Layer that provides FileSystem, Path, and other platform services.
 * Effect handles ALL platform differences internally via these layers.
 *
 * @returns Effect platform layer for the current runtime
 */
export function getPlatform() {
  const runtime = detectRuntime();

  switch (runtime) {
    case "bun":
      return BunServices.layer;
    case "deno":
      return NodeServices.layer; // Deno uses Node.js compatibility layer
    case "node":
      return NodeServices.layer;
  }
}
