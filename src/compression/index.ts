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

// Core compression components
export { CompressionDetector } from './detector';
export { GzipDecompressor } from './gzip';
export { ZstdDecompressor } from './zstd';

// Import for internal use
import { CompressionError } from '../errors';
import type { CompressionFormat } from '../types';
import { GzipDecompressor } from './gzip';
import { ZstdDecompressor } from './zstd';

// Constants for file size thresholds
const MIN_FILE_SIZE_FOR_COMPRESSION = 10_000;
const LARGE_FILE_SIZE_THRESHOLD = 1_000_000;
const DEFAULT_COMPRESSION_RATIO = 3.0;

// Type exports for external use
export type {
  CompressionFormat,
  CompressionDetection,
  DecompressorOptions,
  CompressedStream,
} from '../types';

// Validation schema exports
export {
  CompressionFormatSchema,
  CompressionDetectionSchema,
  DecompressorOptionsSchema,
} from '../types';

// Error exports
export { CompressionError } from '../errors';

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
    case 'gzip':
      return GzipDecompressor;
    case 'zstd':
      return ZstdDecompressor;
    case 'none':
      throw new CompressionError(
        'No decompression needed for uncompressed data',
        'none',
        'validate'
      );
    default:
      throw new CompressionError(
        `Unsupported compression format: ${format}`,
        format as CompressionFormat,
        'validate'
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
  return ['gzip', 'zstd', 'none'].includes(format);
}

/**
 * Get recommended compression format for genomic data
 *
 * Provides intelligent recommendations based on file size, data type,
 * and performance requirements.
 *
 * @param fileSize Estimated file size in bytes
 * @param priority Optimization priority
 * @returns Recommended compression format
 */
export function getRecommendedCompression(
  fileSize: number,
  priority: 'speed' | 'size' | 'compatibility' = 'compatibility'
): CompressionFormat {
  // For compatibility, gzip is still the gold standard in genomics
  if (priority === 'compatibility') {
    return 'gzip';
  }

  // For very small files, compression overhead may not be worth it
  if (fileSize < MIN_FILE_SIZE_FOR_COMPRESSION) {
    return 'none';
  }

  // For speed-critical applications with modern runtimes
  if (priority === 'speed' && fileSize > LARGE_FILE_SIZE_THRESHOLD) {
    return 'zstd'; // Better decompression speed for large files
  }

  // For maximum compression (space-critical)
  if (priority === 'size') {
    return 'zstd'; // Generally better compression ratios than gzip
  }

  // Default recommendation
  return 'gzip';
}

/**
 * Estimate compression ratio for genomic data types
 *
 * Provides rough estimates of compression ratios to help with capacity planning
 * and performance estimation.
 *
 * @param dataType Type of genomic data
 * @param format Compression format
 * @returns Estimated compression ratio (original_size / compressed_size)
 */
export function estimateCompressionRatio(
  dataType: 'sequence' | 'alignment' | 'variant' | 'annotation',
  format: CompressionFormat
): number {
  if (format === 'none') return 1.0;

  // Rough estimates based on genomic data characteristics
  const baseRatios = {
    sequence: { gzip: 3.5, zstd: 4.2 }, // FASTA/FASTQ compress very well
    alignment: { gzip: 2.8, zstd: 3.4 }, // SAM files have mixed compressibility
    variant: { gzip: 4.1, zstd: 5.2 }, // VCF files compress excellently
    annotation: { gzip: 3.2, zstd: 3.8 }, // BED/GFF compress moderately well
  };

  return (
    baseRatios[dataType][format as keyof (typeof baseRatios)[typeof dataType]] ||
    DEFAULT_COMPRESSION_RATIO
  );
}
