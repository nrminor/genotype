/**
 * Compression module for genomic file formats
 *
 * Provides high-performance compression and decompression capabilities
 * optimized for genomic data processing. Supports gzip and Zstandard
 * formats with runtime-specific optimizations.
 *
 * @example Auto-detection and decompression
 * ```typescript
 * import { CompressionDetector, createDecompressor } from '@/compression';
 *
 * const detection = CompressionDetector.fromExtension('genome.fasta.gz');
 * if (detection !== 'none') {
 *   const decompressor = createDecompressor(detection);
 *   const decompressed = await decompressor.decompress(compressedData);
 * }
 * ```
 *
 * @example Streaming decompression
 * ```typescript
 * import { GzipDecompressor } from '@/compression';
 *
 * const compressedStream = await FileReader.createStream('large-genome.fasta.gz');
 * const decompressedStream = GzipDecompressor.wrapStream(compressedStream);
 *
 * for await (const chunk of decompressedStream) {
 *   // Process decompressed genomic data
 * }
 * ```
 */

// Import for internal use
import { CompressionError } from "../errors";
import type { CompressionFormat } from "../types";
import { GzipDecompressor } from "./gzip";
import { ZstdDecompressor } from "./zstd";

// Core compression components
export { CompressionDetector } from "./detector";
export { compress, createCompressionStream, GzipDecompressor } from "./gzip";
// Effect-based service layer
export {
  CompressionService,
  GzipCompressionService,
  MultiFormatCompressionService,
} from "./service";
export { ZstdDecompressor } from "./zstd";

// Error exports
export { CompressionError } from "../errors";
// Type exports for external use
export type {
  CompressedStream,
  CompressionDetection,
  CompressionFormat,
  DecompressorOptions,
} from "../types";
// Validation schema exports
export {
  CompressionDetectionSchema,
  CompressionFormatSchema,
  DecompressorOptionsSchema,
} from "../types";

/**
 * Factory function to create appropriate decompressor based on format
 *
 * Provides a unified interface for creating decompressors while maintaining
 * the flexibility to use format-specific optimizations.
 *
 * @param format Compression format to create decompressor for
 * @returns Decompressor class with consistent interface
 * @throws {CompressionError} If format is not supported
 *
 * @example
 * ```typescript
 * const decompressor = createDecompressor('gzip');
 * const result = await decompressor.decompress(compressedData);
 * ```
 */
export function createDecompressor(
  format: CompressionFormat
): typeof GzipDecompressor | typeof ZstdDecompressor {
  switch (format) {
    case "gzip":
      return GzipDecompressor;
    case "zstd":
      return ZstdDecompressor;
    case "none":
      throw new CompressionError(
        "No decompression needed for uncompressed data",
        "none",
        "validate"
      );
    default:
      throw new CompressionError(
        `Unsupported compression format: ${format}`,
        format as CompressionFormat,
        "validate"
      );
  }
}

/**
 * Utility function to check if a compression format is supported
 *
 * @param format Compression format to check
 * @returns Whether the format is supported by this library
 */
export function isCompressionSupported(format: string): format is CompressionFormat {
  return ["gzip", "zstd", "none"].includes(format);
}
