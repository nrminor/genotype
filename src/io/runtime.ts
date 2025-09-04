/**
 * Runtime detection and factory for cross-platform file I/O
 *
 * Provides compile-time optimized runtime detection and factory pattern
 * for creating platform-specific file readers that work across Node.js
 * and Bun environments.
 */

/**
 * Supported JavaScript runtimes
 */
export type Runtime = "node" | "bun";

/**
 * Runtime-specific capabilities
 */
export interface RuntimeCapabilities {
  readonly hasFileSystem: boolean;
  readonly hasStreams: boolean;
  readonly hasCompressionSupport: boolean;
  readonly maxFileSize: number;
  readonly supportsWorkers: boolean;
}

/**
 * Detect the current JavaScript runtime with compile-time optimization
 *
 * This function is designed to be tree-shaken and optimized by bundlers.
 * It checks for runtime-specific global objects in order of preference.
 *
 * @returns The detected runtime identifier
 * @example
 * ```typescript
 * const runtime = detectRuntime();
 * console.log(`Running on ${runtime}`);
 * ```
 */
export const detectRuntime = (): Runtime => {
  // Tiger Style: Assert meaningful invariant
  console.assert(typeof globalThis === "object", "globalThis must be available");

  // Check for Bun (has process but different from Node)
  if (
    typeof (globalThis as any).Bun !== "undefined" &&
    typeof (globalThis as any).Bun.version === "string"
  ) {
    return "bun";
  }

  // Check for Node.js (has process and versions)
  if (
    typeof (globalThis as any).process !== "undefined" &&
    typeof (globalThis as any).process.versions === "object" &&
    typeof (globalThis as any).process.versions.node === "string"
  ) {
    return "node";
  }

  // Default to Node.js if environment is ambiguous
  // This handles edge cases in testing environments
  return "node";
};

/**
 * Get runtime-specific capabilities
 *
 * Provides information about what the current runtime can do,
 * allowing code to gracefully degrade or select optimal paths.
 *
 * @param runtime The runtime to get capabilities for
 * @returns Runtime capabilities object
 */
export const getRuntimeCapabilities = (runtime: Runtime): RuntimeCapabilities => {
  // TypeScript guarantees runtime is valid - no defensive checking needed

  switch (runtime) {
    case "node":
      return {
        hasFileSystem: true,
        hasStreams: true,
        hasCompressionSupport: true,
        maxFileSize: 2_147_483_647, // 2GB - Node.js buffer limit
        supportsWorkers: true,
      };

    case "bun":
      return {
        hasFileSystem: true,
        hasStreams: true,
        hasCompressionSupport: true,
        maxFileSize: Number.MAX_SAFE_INTEGER, // Bun optimized for large files
        supportsWorkers: true,
      };

    default:
      // This should never happen due to type safety, but handle it
      throw new Error(`Unsupported runtime: ${runtime}`);
  }
};

/**
 * Check if current runtime supports a specific feature
 *
 * @param feature The feature to check for
 * @returns Whether the feature is supported
 */
export const supportsFeature = (feature: keyof RuntimeCapabilities): boolean => {
  // TypeScript guarantees feature is valid key - no defensive checking needed

  const runtime = detectRuntime();
  const capabilities = getRuntimeCapabilities(runtime);
  return capabilities[feature] as boolean;
};

/**
 * Runtime-specific global object access
 *
 * Provides type-safe access to runtime-specific globals while
 * maintaining compatibility across environments.
 */
export const getRuntimeGlobals = (runtime: Runtime): Record<string, unknown> => {
  // TypeScript guarantees runtime is valid - no defensive checking needed

  switch (runtime) {
    case "node":
      return {
        fs: (globalThis as any).require?.("fs"),
        path: (globalThis as any).require?.("path"),
        stream: (globalThis as any).require?.("stream"),
        process: (globalThis as any).process,
      };

    case "bun":
      return {
        Bun: (globalThis as any).Bun,
        process: (globalThis as any).process,
        fs: (globalThis as any).require?.("fs"),
        path: (globalThis as any).require?.("path"),
      };

    default:
      throw new Error(`Unsupported runtime: ${runtime}`);
  }
};

/**
 * Get optimal buffer size for file I/O based on runtime
 *
 * Different runtimes have different optimal buffer sizes for I/O operations.
 * This function returns the recommended buffer size for each runtime.
 *
 * @param runtime The runtime to get buffer size for
 * @returns Optimal buffer size in bytes
 */
export const getOptimalBufferSize = (runtime: Runtime): number => {
  // TypeScript guarantees runtime is valid - no defensive checking needed

  switch (runtime) {
    case "node":
      return 65536; // 64KB - Node.js default buffer size

    case "bun":
      // Bun is highly optimized for I/O operations and can handle larger buffers
      // efficiently, especially for genomic files which benefit from larger chunks
      return 262144; // 256KB - Bun can handle much larger buffers efficiently

    default:
      return 65536; // Default fallback
  }
};

/**
 * Runtime information for debugging and telemetry
 */
export const getRuntimeInfo = (): Record<string, unknown> => {
  const runtime = detectRuntime();
  const capabilities = getRuntimeCapabilities(runtime);

  return {
    runtime,
    capabilities,
    optimalBufferSize: getOptimalBufferSize(runtime),
    timestamp: Date.now(),
    // Runtime-specific version information
    version: ((): string => {
      switch (runtime) {
        case "node":
          return (globalThis as any).process?.versions?.node ?? "unknown";
        case "bun":
          return (globalThis as any).Bun?.version ?? "unknown";
        default:
          return "unknown";
      }
    })(),
  };
};
