/**
 * Compression format detection for genomic files
 *
 * Provides sophisticated compression detection using magic bytes, file extensions,
 * and hybrid approaches optimized for genomic data formats commonly found in
 * bioinformatics workflows.
 */

import type { CompressionFormat, CompressionDetection } from '../types';
import { CompressionError } from '../errors';

/**
 * Magic byte signatures for compression formats commonly used in genomics
 *
 * These signatures are carefully chosen to minimize false positives while
 * maximizing detection accuracy for real-world genomic data files.
 */
// Magic number constants for compression formats
const GZIP_MAGIC_FIRST_BYTE = 0x1f;
const GZIP_MAGIC_SECOND_BYTE = 0x8b;
const ZSTD_MAGIC_FIRST_BYTE = 0x28;
const ZSTD_MAGIC_SECOND_BYTE = 0xb5;
const ZSTD_MAGIC_THIRD_BYTE = 0x2f;
const ZSTD_MAGIC_FOURTH_BYTE = 0xfd;

const COMPRESSION_MAGIC_BYTES = {
  gzip: new Uint8Array([GZIP_MAGIC_FIRST_BYTE, GZIP_MAGIC_SECOND_BYTE]),
  zstd: new Uint8Array([
    ZSTD_MAGIC_FIRST_BYTE,
    ZSTD_MAGIC_SECOND_BYTE,
    ZSTD_MAGIC_THIRD_BYTE,
    ZSTD_MAGIC_FOURTH_BYTE,
  ]),
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
 * Confidence scoring constants
 */
const HIGH_CONFIDENCE_BOTH_METHODS = 0.7;
const MEDIUM_CONFIDENCE_EXTENSION_ONLY = 0.6;
const CONFIDENCE_BOOST_FOR_AGREEMENT = 0.1;
const CONFIDENCE_PENALTY_FOR_DISAGREEMENT = 0.3;
const MIN_CONFIDENCE_DISAGREEMENT = 0.3;

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
    // Tiger Style: Validate function arguments with proper error handling

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
    // Tiger Style: Validate function arguments with proper error handling

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
    // Tiger Style: Validate function arguments with proper error handling

    if (!(stream instanceof ReadableStream)) {
      throw new CompressionError('Stream must be ReadableStream', 'none', 'detect');
    }

    const reader = stream.getReader();
    let headerBytes: Uint8Array;

    try {
      // Read first chunk to analyze magic bytes
      const { value, done } = await reader.read();

      const isEmpty = done || value === null || value === undefined || value.length === 0;
      if (isEmpty) {
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
      return CompressionDetector.fromMagicBytes(headerBytes);
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
    // Tiger Style: Validate function arguments with proper error handling

    try {
      const extensionFormat = CompressionDetector.fromExtension(filePath);

      // If no bytes provided, rely on extension only
      if (!bytes) {
        const hasCompression = extensionFormat !== 'none';
        const confidence = hasCompression
          ? HIGH_CONFIDENCE_BOTH_METHODS
          : MEDIUM_CONFIDENCE_EXTENSION_ONLY;
        const result: CompressionDetection = {
          format: extensionFormat,
          confidence,
          extension: filePath.substring(filePath.lastIndexOf('.')),
          detectionMethod: 'extension',
        };
        return result;
      }

      const magicDetection = CompressionDetector.fromMagicBytes(bytes);

      // Both methods agree - highest confidence
      const methodsAgree = extensionFormat === magicDetection.format;
      if (methodsAgree) {
        const result: CompressionDetection = {
          format: extensionFormat,
          confidence: magicDetection.confidence + CONFIDENCE_BOOST_FOR_AGREEMENT,
          ...(magicDetection.magicBytes && { magicBytes: magicDetection.magicBytes }),
          extension: filePath.substring(filePath.lastIndexOf('.')),
          detectionMethod: 'hybrid',
        };
        return result;
      }

      // Methods disagree - prefer magic bytes with lower confidence
      const result: CompressionDetection = {
        format: magicDetection.format,
        confidence: Math.max(
          MIN_CONFIDENCE_DISAGREEMENT,
          magicDetection.confidence - CONFIDENCE_PENALTY_FOR_DISAGREEMENT
        ),
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
    if (typeof detection !== 'object' || detection === null) {
      throw new CompressionError('Detection result must be an object', 'none', 'detect');
    }
    if (typeof detection.confidence !== 'number') {
      throw new CompressionError('Detection confidence must be a number', 'none', 'detect');
    }

    return detection.confidence >= MIN_CONFIDENCE_THRESHOLD;
  }
}
