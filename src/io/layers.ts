/**
 * Shared Effect layers for genotype's runtime environment.
 *
 * PlatformLayer provides filesystem access (Node/Bun/Deno).
 * IOLayer adds compression services on top of the platform.
 * RuntimeEnvLayer will compose all services the library needs
 * once the backend service is added.
 */

import { Layer } from "effect";
import { CompressionService } from "@genotype/core/compression";
import { getPlatform } from "./runtime";

/** Filesystem access for the current runtime (Node, Bun, or Deno). */
export const PlatformLayer = getPlatform();

/** Platform filesystem plus compression services (gzip + zstd). */
export const IOLayer = Layer.merge(PlatformLayer, CompressionService.WithZstd);

/**
 * The full runtime environment layer. Currently the same as IOLayer;
 * will grow to include BackendService when the backend becomes an
 * Effect service.
 */
export const RuntimeEnvLayer = IOLayer;
