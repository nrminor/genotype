/**
 * Shared Effect layers for file I/O operations.
 */

import { Layer } from "effect";
import { CompressionService } from "../compression";
import { getPlatform } from "./runtime";

export const PlatformLayer = getPlatform();
export const IOLayer = Layer.merge(PlatformLayer, CompressionService.WithZstd);
