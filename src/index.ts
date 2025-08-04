/**
 * Genotype - A TypeScript library for genomic data parsing
 *
 * Built by bioinformaticians, for bioinformaticians.
 * Handles the messiness of real-world genomic data with a focus on
 * developer experience, performance, and type safety.
 */

// Core types
export type {
  Sequence,
  FastaSequence,
  FastqSequence,
  QualityEncoding,
  SamRecord,
  SAMAlignment,
  SAMHeader,
  SAMTag,
  SAMFlag,
  CIGARString,
  MAPQScore,
  BAMAlignment,
  BAMHeader,
  BGZFBlock,
  // BAI Index types
  BAIIndex,
  BAIReference,
  BAIBin,
  BAIChunk,
  BAILinearIndex,
  BAIQueryResult,
  BAIStatistics,
  BAIWriterOptions,
  BAIReaderOptions,
  VirtualOffset,
  BAIBinNumber,
  BedInterval,
  Strand,
  ParserOptions,
  ParseResult,
  CompressionFormat,
  CompressedStream,
  CompressionDetection,
  DecompressorOptions,
  FormatDetection,
  InferSchema,
  // File I/O types
  FilePath,
  FileHandle,
  FileReaderOptions,
  StreamChunk,
  FileMetadata,
  LineProcessingResult,
  FileValidationResult,
  StreamStats,
  FileIOContext,
} from './types';

export {
  SequenceIdSchema,
  SequenceSchema,
  QualitySchema,
  FastaSequenceSchema,
  FastqSequenceSchema,
  BedIntervalSchema,
  SAMAlignmentSchema,
  SAMHeaderSchema,
  SAMFlagSchema,
  CIGAROperationSchema,
  MAPQScoreSchema,
  SAMTagSchema,
  // BAI Index schemas
  VirtualOffsetSchema,
  BAIBinNumberSchema,
  BAIChunkSchema,
  BAIBinSchema,
  BAILinearIndexSchema,
  BAIReferenceSchema,
  BAIIndexSchema,
  BAIQueryResultSchema,
  BAIWriterOptionsSchema,
  BAIReaderOptionsSchema,
  // Compression schemas
  CompressionFormatSchema,
  CompressionDetectionSchema,
  DecompressorOptionsSchema,
  // File I/O schemas
  FilePathSchema,
  FileReaderOptionsSchema,
  StreamChunkSchema,
  FileMetadataSchema,
} from './types';

// Error types
export {
  GenotypeError,
  ValidationError,
  ParseError,
  CompressionError,
  BamError,
  FileError,
  MemoryError,
  SequenceError,
  QualityError,
  BedError,
  SamError,
  StreamError,
  BufferError,
  TimeoutError,
  CompatibilityError,
  FormatDetectionError,
  createContextualError,
  getErrorSuggestion,
  ERROR_SUGGESTIONS,
} from './errors';

// FASTA format
export { FastaParser, FastaWriter, FastaUtils } from './formats/fasta';

// FASTQ format
export { FastqParser, FastqWriter, FastqUtils, QualityScores } from './formats/fastq';

// BED format
export { BedParser, BedWriter, BedUtils, BedFormat } from './formats/bed';

// SAM format
export { SAMParser, SAMWriter, SAMUtils } from './formats/sam';

// BAM format and BAI indexing
export {
  BAMParser,
  BAMWriter,
  BAMUtils,
  BGZFCompressor,
  BinarySerializer,
  type BAMWriterOptions,
  // BAI Index support
  BAIReader,
  BAIWriter,
  VirtualOffsetUtils,
  BinningUtils,
} from './formats/bam';

// File I/O infrastructure
export { FileReader } from './io/file-reader';

export { StreamUtils } from './io/stream-utils';

export {
  detectRuntime,
  getRuntimeCapabilities,
  getRuntimeGlobals,
  getOptimalBufferSize,
  getRuntimeInfo,
  type Runtime,
  type RuntimeCapabilities,
} from './io/runtime';

// Compression infrastructure
export {
  CompressionDetector,
  GzipDecompressor,
  ZstdDecompressor,
  createDecompressor,
  isCompressionSupported,
  getRecommendedCompression,
  estimateCompressionRatio,
} from './compression';

// Native performance library (Zig FFI)
export {
  resolveGenotypeLib,
  setGenotypeLibPath,
  isNativeLibAvailable,
  getCurrentPlatformTarget,
  type LibGenotype,
} from './zig';

// Import types for internal use
import type {
  FormatDetection,
  ParserOptions,
  FastaSequence,
  FastqSequence,
  BedInterval,
} from './types';
import { ParseError } from './errors';
import { FastaParser } from './formats/fasta';
import { FastqParser } from './formats/fastq';
import { BedParser } from './formats/bed';

/**
 * Auto-detect file format from content
 */
export function detectFormat(data: string): FormatDetection {
  const trimmed = data.trim();

  // FASTA detection
  if (trimmed.startsWith('>')) {
    return {
      format: 'fasta',
      compression: 'none',
      confidence: 0.95,
      metadata: {
        estimatedSequences: (trimmed.match(/^>/gm) || []).length,
      },
    };
  }

  // FASTQ detection
  if (trimmed.startsWith('@')) {
    const lines = trimmed.split(/\r?\n/);
    if (lines.length >= 4 && lines[2]?.startsWith('+')) {
      return {
        format: 'fastq',
        compression: 'none',
        confidence: 0.95,
        metadata: {
          estimatedSequences: Math.floor(lines.filter((l) => l.trim()).length / 4),
        },
      };
    }
  }

  // BED detection
  const dataLines = trimmed.split(/\r?\n/).filter((line) => {
    const t = line.trim();
    return t && !t.startsWith('#') && !t.startsWith('track') && !t.startsWith('browser');
  });

  if (dataLines.length > 0) {
    const fields = (dataLines[0] ?? '').split(/\s+/);
    if (
      fields.length >= 3 &&
      !isNaN(parseInt(fields[1] ?? '', 10)) &&
      !isNaN(parseInt(fields[2] ?? '', 10))
    ) {
      const start = parseInt(fields[1] ?? '', 10);
      const end = parseInt(fields[2] ?? '', 10);
      if (start >= 0 && end > start) {
        return {
          format: 'bed',
          compression: 'none',
          confidence: 0.8,
          metadata: {
            estimatedIntervals: dataLines.length,
            bedVariant: BedFormat.detectVariant(fields.length),
          },
        };
      }
    }
  }

  // SAM detection (basic heuristic)
  if (
    trimmed.includes('\t') &&
    (trimmed.includes('@SQ') ||
      trimmed.includes('@HD') ||
      trimmed.split(/\r?\n/).some((line) => line.split('\t').length >= 11))
  ) {
    return {
      format: 'sam',
      compression: 'none',
      confidence: 0.7,
      metadata: {},
    };
  }

  return {
    format: 'unknown',
    compression: 'none',
    confidence: 0.0,
    metadata: {},
  };
}

/**
 * Convenience function to parse any supported format
 */
export async function* parseAny(
  data: string,
  options?: ParserOptions
): AsyncIterable<FastaSequence | FastqSequence | BedInterval> {
  const detection = detectFormat(data);

  switch (detection.format) {
    case 'fasta': {
      const parser = new FastaParser(options);
      yield* parser.parseString(data);
      break;
    }

    case 'fastq': {
      const parser = new FastqParser(options);
      yield* parser.parseString(data);
      break;
    }

    case 'bed': {
      const parser = new BedParser(options);
      yield* parser.parseString(data);
      break;
    }

    default:
      throw new ParseError(
        `Unsupported or unrecognized format: ${detection.format}`,
        detection.format
      );
  }
}

// Re-export from formats for convenience
import { BedFormat } from './formats/bed';

/**
 * Library version and metadata
 */
export const VERSION = '0.1.0';
export const SUPPORTED_FORMATS = ['fasta', 'fastq', 'bed', 'sam', 'bam'] as const;
export const SUPPORTED_COMPRESSIONS = ['gzip', 'zstd'] as const;
