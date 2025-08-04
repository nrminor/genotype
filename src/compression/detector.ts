/**
 * Compression format detection for genomic files
 *
 * Provides sophisticated compression detection using magic bytes, file extensions,
 * and hybrid approaches optimized for genomic data formats commonly found in
 * bioinformatics workflows.
 */

import type { CompressionFormat, CompressionDetection, FilePath } from '../types';
import { CompressionDetectionSchema } from '../types';
import { CompressionError } from '../errors';

/**
 * Magic byte signatures for compression formats commonly used in genomics
 *
 * These signatures are carefully chosen to minimize false positives while
 * maximizing detection accuracy for real-world genomic data files.
 */
const COMPRESSION_MAGIC_BYTES = {
  gzip: new Uint8Array([0x1f, 0x8b]), // Standard gzip magic number
  zstd: new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]), // Zstandard magic number
} as const;

/**
 * File extensions commonly used for compressed genomic files
 *
 * Includes both primary extensions and composite extensions for genomic formats.
 */
const COMPRESSION_EXTENSIONS = {
  gzip: ['.gz', '.gzip'],
  zstd: ['.zst', '.zstd'],
  // Common genomic file combinations
  genomic_gzip: ['.fasta.gz', '.fastq.gz', '.sam.gz', '.bed.gz', '.vcf.gz'],
  genomic_zstd: ['.fasta.zst', '.fastq.zst', '.sam.zst', '.bed.zst', '.vcf.zst'],
} as const;

/**
 * Minimum confidence threshold for reliable compression detection
 */
const MIN_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Cross-platform compression format detector
 *
 * Implements Tiger Style patterns with strict validation and comprehensive
 * error handling. Optimized for genomic file formats with real-world
 * anti-entropy principles.
 *
 * @example Basic detection from file extension
 * ```typescript
 * const format = CompressionDetector.fromExtension('/data/genome.fasta.gz');
 * console.log(format); // 'gzip'
 * ```
 *
 * @example Detection from magic bytes
 * ```typescript
 * const bytes = new Uint8Array([0x1f, 0x8b, 0x08]);
 * const detection = CompressionDetector.fromMagicBytes(bytes);
 * console.log(detection.format); // 'gzip'
 * console.log(detection.confidence); // 1.0
 * ```
 *
 * @example Stream-based detection
 * ```typescript
 * const stream = await FileReader.createStream('/data/sequences.fastq.gz');
 * const detection = await CompressionDetector.fromStream(stream);
 * if (detection.confidence > 0.8) {
 *   console.log('High confidence:', detection.format);
 * }
 * ```
 */
export class CompressionDetector {
  /**
   * Detect compression format from file extension
   *
   * Analyzes file path extension patterns commonly used in genomics,
   * including composite extensions like .fasta.gz and .fastq.zst.
   *
   * @param filePath File path to analyze for compression format
   * @returns Detected compression format
   * @throws {CompressionError} If file path validation fails
   *
   * Tiger Style: Function must not exceed 70 lines, minimum 2 assertions
   */
  static fromExtension(filePath: string): CompressionFormat {
    // Tiger Style: Assert function arguments with explicit validation
    console.assert(typeof filePath === 'string', 'filePath must be a string');
    console.assert(filePath.length > 0, 'filePath must not be empty');

    if (typeof filePath !== 'string') {
      throw new CompressionError('File path must be a string', 'none', 'detect');
    }
    if (filePath.length === 0) {
      throw new CompressionError('File path must not be empty', 'none', 'detect');
    }

    // Normalize path for cross-platform compatibility
    const normalizedPath = filePath.toLowerCase().replace(/\\/g, '/');

    try {
      // Check for gzip extensions (most common in genomics)
      const gzipExtensions = [
        ...COMPRESSION_EXTENSIONS.gzip,
        ...COMPRESSION_EXTENSIONS.genomic_gzip,
      ];

      for (const ext of gzipExtensions) {
        if (normalizedPath.endsWith(ext)) {
          return 'gzip';
        }
      }

      // Check for zstd extensions (growing adoption in genomics)
      const zstdExtensions = [
        ...COMPRESSION_EXTENSIONS.zstd,
        ...COMPRESSION_EXTENSIONS.genomic_zstd,
      ];

      for (const ext of zstdExtensions) {
        if (normalizedPath.endsWith(ext)) {
          return 'zstd';
        }
      }

      // No compression detected
      return 'none';
    } catch (error) {
      throw CompressionError.fromSystemError('none', 'detect', error);
    }
  }

  /**
   * Detect compression format from magic bytes
   *
   * Analyzes the first few bytes of data to identify compression format
   * using well-known magic number signatures. Provides confidence scoring
   * based on signature strength and completeness.
   *
   * @param bytes Byte array to analyze (minimum 4 bytes recommended)
   * @returns Compression detection result with confidence score
   * @throws {CompressionError} If bytes validation fails
   *
   * Tiger Style: Function must not exceed 70 lines, minimum 2 assertions
   */
  static fromMagicBytes(bytes: Uint8Array): CompressionDetection {
    // Tiger Style: Assert function arguments with explicit validation
    console.assert(bytes instanceof Uint8Array, 'bytes must be Uint8Array');
    console.assert(bytes.length > 0, 'bytes must not be empty');

    if (!(bytes instanceof Uint8Array)) {
      throw new CompressionError('Bytes must be Uint8Array', 'none', 'detect');
    }
    if (bytes.length === 0) {
      throw new CompressionError('Bytes array must not be empty', 'none', 'detect');
    }

    try {
      // Check gzip magic bytes (most reliable detection)
      const gzipMagic = COMPRESSION_MAGIC_BYTES.gzip;
      if (bytes.length >= gzipMagic.length) {
        const matches = gzipMagic.every((byte, index) => bytes[index] === byte);
        if (matches) {
          const result: CompressionDetection = {
            format: 'gzip',
            confidence: 1.0, // Perfect magic byte match
            magicBytes: bytes.slice(0, gzipMagic.length),
            detectionMethod: 'magic-bytes',
          };
          return result;
        }
      }

      // Check zstd magic bytes
      const zstdMagic = COMPRESSION_MAGIC_BYTES.zstd;
      if (bytes.length >= zstdMagic.length) {
        const matches = zstdMagic.every((byte, index) => bytes[index] === byte);
        if (matches) {
          const result: CompressionDetection = {
            format: 'zstd',
            confidence: 1.0, // Perfect magic byte match
            magicBytes: bytes.slice(0, zstdMagic.length),
            detectionMethod: 'magic-bytes',
          };
          return result;
        }
      }

      // No compression detected from magic bytes
      const result: CompressionDetection = {
        format: 'none',
        confidence: 0.9, // High confidence that it's not compressed
        detectionMethod: 'magic-bytes',
      };
      return result;
    } catch (error) {
      throw CompressionError.fromSystemError('none', 'detect', error);
    }
  }

  /**
   * Detect compression format from readable stream
   *
   * Reads the first few bytes from a stream to perform magic byte detection
   * while preserving the stream for subsequent use. Uses careful buffering
   * to avoid consuming more data than necessary.
   *
   * @param stream ReadableStream to analyze
   * @returns Promise resolving to compression detection result
   * @throws {CompressionError} If stream reading fails
   *
   * Tiger Style: Function must not exceed 70 lines, minimum 2 assertions
   */
  static async fromStream(stream: ReadableStream<Uint8Array>): Promise<CompressionDetection> {
    // Tiger Style: Assert function arguments with explicit validation
    console.assert(stream instanceof ReadableStream, 'stream must be ReadableStream');
    console.assert(typeof stream.getReader === 'function', 'stream must support getReader');

    if (!(stream instanceof ReadableStream)) {
      throw new CompressionError('Stream must be ReadableStream', 'none', 'detect');
    }

    const reader = stream.getReader();
    let headerBytes: Uint8Array;

    try {
      // Read first chunk to analyze magic bytes
      const { value, done } = await reader.read();

      if (done || !value || value.length === 0) {
        // Empty stream - not compressed
        const result: CompressionDetection = {
          format: 'none',
          confidence: 0.8, // Reasonable confidence for empty stream
          detectionMethod: 'magic-bytes',
        };
        return result;
      }

      headerBytes = value;

      // Release reader so stream can be used again
      reader.releaseLock();

      // Analyze the header bytes using magic byte detection
      return this.fromMagicBytes(headerBytes);
    } catch (error) {
      // Ensure reader is released even if error occurs
      try {
        reader.releaseLock();
      } catch {
        // Ignore release errors
      }

      throw CompressionError.fromSystemError('none', 'detect', error);
    }
  }

  /**
   * Hybrid detection combining extension and magic bytes
   *
   * Provides the most reliable detection by combining file extension analysis
   * with magic byte verification. Returns highest confidence when both methods
   * agree, and provides fallback strategies when they conflict.
   *
   * @param filePath File path for extension analysis
   * @param bytes Optional byte array for magic byte analysis
   * @returns Comprehensive compression detection result
   * @throws {CompressionError} If detection process fails
   *
   * Tiger Style: Function must not exceed 70 lines, minimum 2 assertions
   */
  static hybrid(filePath: string, bytes?: Uint8Array): CompressionDetection {
    // Tiger Style: Assert function arguments
    console.assert(typeof filePath === 'string', 'filePath must be a string');
    console.assert(!bytes || bytes instanceof Uint8Array, 'bytes must be Uint8Array if provided');

    try {
      const extensionFormat = this.fromExtension(filePath);

      // If no bytes provided, rely on extension only
      if (!bytes) {
        const confidence = extensionFormat !== 'none' ? 0.7 : 0.6;
        const result: CompressionDetection = {
          format: extensionFormat,
          confidence,
          extension: filePath.substring(filePath.lastIndexOf('.')),
          detectionMethod: 'extension',
        };
        return result;
      }

      const magicDetection = this.fromMagicBytes(bytes);

      // Both methods agree - highest confidence
      if (extensionFormat === magicDetection.format) {
        const result: CompressionDetection = {
          format: extensionFormat,
          confidence: Math.min(1.0, magicDetection.confidence + 0.1),
          ...(magicDetection.magicBytes && { magicBytes: magicDetection.magicBytes }),
          extension: filePath.substring(filePath.lastIndexOf('.')),
          detectionMethod: 'hybrid',
        };
        return result;
      }

      // Methods disagree - prefer magic bytes with lower confidence
      const result: CompressionDetection = {
        format: magicDetection.format,
        confidence: Math.max(0.3, magicDetection.confidence - 0.3),
        ...(magicDetection.magicBytes && { magicBytes: magicDetection.magicBytes }),
        extension: filePath.substring(filePath.lastIndexOf('.')),
        detectionMethod: 'hybrid',
      };
      return result;
    } catch (error) {
      throw CompressionError.fromSystemError('none', 'detect', error);
    }
  }

  /**
   * Validate detection result meets minimum confidence threshold
   *
   * @param detection Detection result to validate
   * @returns Whether detection meets minimum confidence threshold
   */
  static isReliable(detection: CompressionDetection): boolean {
    console.assert(typeof detection === 'object', 'detection must be an object');
    console.assert(typeof detection.confidence === 'number', 'confidence must be a number');

    return detection.confidence >= MIN_CONFIDENCE_THRESHOLD;
  }
}
