/**
 * GenoType - A TypeScript library for genomic data processing
 *
 * Built by bioinformaticians, for bioinformaticians.
 * Handles the messiness of real-world genomic data with a focus on
 * developer experience, performance, and type safety.
 */

// Compression infrastructure
export {
  CompressionDetector,
  createDecompressor,
  estimateCompressionRatio,
  GzipDecompressor,
  getRecommendedCompression,
  isCompressionSupported,
  ZstdDecompressor,
} from './compression';
// Error types
export {
  BamError,
  BedError,
  BufferError,
  CompatibilityError,
  CompressionError,
  createContextualError,
  ERROR_SUGGESTIONS,
  FileError,
  FormatDetectionError,
  GenotypeError,
  getErrorSuggestion,
  MemoryError,
  ParseError,
  QualityError,
  SamError,
  SequenceError,
  StreamError,
  TimeoutError,
  ValidationError,
} from './errors';
// BAM format and BAI indexing
export {
  BAIReader,
  BAIWriter,
  BAMParser,
  BAMUtils,
  BAMWriter,
  type BAMWriterOptions,
  BGZFCompressor,
  BinarySerializer,
  BinningUtils,
  VirtualOffsetUtils,
} from './formats/bam';
// BED format
export { BedFormat, BedParser, BedUtils, BedWriter } from './formats/bed';
// FASTA format
export { FastaParser, FastaUtils, FastaWriter } from './formats/fasta';
// FASTQ format
export { FastqParser, FastqUtils, FastqWriter, QualityScores } from './formats/fastq';

// SAM format
export { SAMParser, SAMUtils, SAMWriter } from './formats/sam';
// File I/O infrastructure
export { FileReader } from './io/file-reader';
export {
  detectRuntime,
  getOptimalBufferSize,
  getRuntimeCapabilities,
  getRuntimeGlobals,
  getRuntimeInfo,
  type Runtime,
  type RuntimeCapabilities,
} from './io/runtime';

export { StreamUtils } from './io/stream-utils';
// Core types
export type {
  BAIBin,
  BAIBinNumber,
  BAIChunk,
  BAIIndex,
  BAILinearIndex,
  BAIQueryResult,
  BAIReaderOptions,
  BAIReference,
  BAIStatistics,
  BAIWriterOptions,
  BAMAlignment,
  BAMHeader,
  BedInterval,
  BGZFBlock,
  CIGARString,
  CompressedStream,
  CompressionDetection,
  CompressionFormat,
  DecompressorOptions,
  FastaSequence,
  FastqSequence,
  FileHandle,
  FileIOContext,
  FileMetadata,
  FilePath,
  FileReaderOptions,
  FileValidationResult,
  FormatDetection,
  InferSchema,
  LineProcessingResult,
  MAPQScore,
  ParseResult,
  ParserOptions,
  QualityEncoding,
  SAMAlignment,
  SAMFlag,
  SAMHeader,
  SAMTag,
  SamRecord,
  Sequence,
  Strand,
  StreamChunk,
  StreamStats,
  VirtualOffset,
} from './types';
export {
  BAIBinNumberSchema,
  BAIBinSchema,
  BAIChunkSchema,
  BAIIndexSchema,
  BAILinearIndexSchema,
  BAIQueryResultSchema,
  BAIReaderOptionsSchema,
  BAIReferenceSchema,
  BAIWriterOptionsSchema,
  BedIntervalSchema,
  CIGAROperationSchema,
  CompressionDetectionSchema,
  CompressionFormatSchema,
  DecompressorOptionsSchema,
  FastaSequenceSchema,
  FastqSequenceSchema,
  FileMetadataSchema,
  FilePathSchema,
  FileReaderOptionsSchema,
  MAPQScoreSchema,
  QualitySchema,
  SAMAlignmentSchema,
  SAMFlagSchema,
  SAMHeaderSchema,
  SAMTagSchema,
  SequenceIdSchema,
  SequenceSchema,
  StreamChunkSchema,
  // BAI Index schemas
  VirtualOffsetSchema,
} from './types';

// Native performance library (Zig FFI)
export {
  getCurrentPlatformTarget,
  isNativeLibAvailable,
  type LibGenotype,
  resolveGenotypeLib,
  setGenotypeLibPath,
} from './zig';

import { ParseError } from './errors';
import { BedParser } from './formats/bed';
import { FastaParser } from './formats/fasta';
import { FastqParser } from './formats/fastq';
// Import types for internal use
import type {
  BedInterval,
  FastaSequence,
  FastqSequence,
  FormatDetection,
  ParserOptions,
} from './types';

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
