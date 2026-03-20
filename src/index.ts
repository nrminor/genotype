// GenotypeString — dual-representation string type for sequence/quality data
export { GenotypeString, CharSet, Bases } from "./genotype-string";
// Record constructors and immutable update helpers
export {
  type AlignmentRecordInput,
  createAlignmentRecord,
  createFastaRecord,
  createFastqRecord,
  createKmerRecord,
  type FastaRecordInput,
  type FastqRecordInput,
  type KmerRecordInput,
  withQuality,
  withSequence,
} from "./constructors";
// Compression infrastructure
export {
  CompressionDetector,
  createDecompressor,
  GzipDecompressor,
  ZstdDecompressor,
} from "./compression";
// Error types
export {
  AlphabetValidationError,
  BamError,
  BedError,
  BufferError,
  ChromosomeNamingError,
  CompatibilityError,
  CompressionError,
  ConcatError,
  DSVParseError,
  FileError,
  FormatDetectionError,
  GenomicCoordinateError,
  GenotypeError,
  GrepError,
  LocateError,
  MemoryError,
  PairSyncError,
  ParseError,
  QualityError,
  ResourceLimitError,
  SamError,
  SecurityPathError,
  SequenceError,
  SplitError,
  StreamError,
  TimeoutError,
  ValidationError,
} from "./errors";
// Alignment format (noodles-backed BAM/SAM parser)
export { AlignmentParser } from "./formats/alignment";
// Backend abstraction (future browser/wasm-compatible presentation layer)
export {
  createNodeNativeBackend,
  getBackend,
  isBackendAvailable,
  isNodeNativeBackendAvailable,
} from "./backend";
// BED format
export { BedFormat, BedParser, BedUtils, BedWriter } from "./formats/bed";
// DSV/CSV/TSV format
export {
  CSVParser,
  CSVWriter,
  DSVParser,
  type DSVParserOptions,
  type DSVRecord,
  DSVWriter,
  type DSVWriterOptions,
  detectDelimiter,
  protectFromExcel,
  TSVParser,
  TSVWriter,
} from "./formats/dsv";
// FASTA format
export { FastaParser, FastaUtils, FastaWriter } from "./formats/fasta";
// FASTQ format
export { FastqParser, FastqUtils, FastqWriter } from "./formats/fastq";

// File I/O infrastructure
// Note: `src/native.ts` remains available as an internal/legacy Node-native
// implementation detail and for native-kernel tests, but it is no longer
// re-exported from the package root. New code should depend on the backend
// abstraction exported above.
// SeqOps - Unix pipeline-style sequence operations
export {
  type CleanOptions,
  type ConcatOptions,
  // New semantic API types
  type FilterOptions,
  type PairOptions,
  type QualityOptions,
  SeqOps,
  type SequenceStats,
  SequenceStatsCalculator,
  type StatsOptions,
  SubseqExtractor,
  type SubseqOptions,
  seqops,
  type TransformOptions,
  type ValidateOptions,
  type WindowOptions,
} from "./operations";
// Sequence manipulation functions
export {
  complement,
  removeGaps,
  replaceAmbiguousBases,
  reverse,
  reverseComplement,
  toDNA,
  toRNA,
} from "./operations/core/sequence-manipulation";
// Quality score operations (shared functionality)
export {
  // Branded types
  type AsciiOffset,
  calculateAverageQuality,
  calculateQualityStats,
  charToScore,
  convertQuality,
  type DetectionResult,
  detectEncoding,
  detectEncodingWithConfidence,
  getEncodingInfo,
  type QualityScore,
  qualityToScores,
  scoresToQuality,
  scoreToChar,
} from "./operations/core/quality";
// Core types
export type {
  AbstractSequence,
  AbstractSequence as Sequence,
  AlignmentRecord,
  BedInterval,
  CompressedStream,
  CompressionDetection,
  CompressionFormat,
  DecompressorOptions,
  // Alphabet validation types
  DNASequence,
  // Alphabet validation template literal tags
  dna,
  FASTXSequence,
  FastaSequence,
  FastqSequence,
  QualityScoreBearing,
  FileMetadata,
  FilePath,
  FileReaderOptions,
  FormatDetection,
  IUPACSequence,
  isDNASequence,
  isIUPACSequence,
  isPrimerSequence,
  isRNASequence,
  iupac,
  KmerSequence,
  LineProcessingResult,
  MotifLocation,
  ParseResult,
  ParserOptions,
  PrimerSequence,
  primer,
  QualityEncoding,
  RNASequence,
  rna,
  Strand,
  StreamChunk,
  StreamStats,
} from "./types";
import { ParseError } from "./errors";
import { BedParser, FastaParser, FastqParser } from "./formats";
// Import types for internal use
import type {
  BedInterval,
  FastaSequence,
  FastqSequence,
  FormatDetection,
  ParserOptions,
} from "./types";

/**
 * Auto-detect file format from content
 */
export function detectFormat(data: string): FormatDetection {
  const trimmed = data.trim();

  // FASTA detection
  if (trimmed.startsWith(">")) {
    return {
      format: "fasta",
      compression: "none",
      confidence: 0.95,
      metadata: {
        estimatedSequences: (trimmed.match(/^>/gm) || []).length,
      },
    };
  }

  // FASTQ detection
  if (trimmed.startsWith("@")) {
    const lines = trimmed.split(/\r?\n/);
    if (
      lines.length >= 4 &&
      lines[2] !== undefined &&
      lines[2] !== null &&
      lines[2].startsWith("+")
    ) {
      return {
        format: "fastq",
        compression: "none",
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
    return (
      t !== undefined &&
      t !== null &&
      t !== "" &&
      !t.startsWith("#") &&
      !t.startsWith("track") &&
      !t.startsWith("browser")
    );
  });

  if (dataLines.length > 0) {
    const fields = (dataLines[0] ?? "").split(/\s+/);
    if (
      fields.length >= 3 &&
      !Number.isNaN(parseInt(fields[1] ?? "", 10)) &&
      !Number.isNaN(parseInt(fields[2] ?? "", 10))
    ) {
      const start = parseInt(fields[1] ?? "", 10);
      const end = parseInt(fields[2] ?? "", 10);
      if (start >= 0 && end > start) {
        return {
          format: "bed",
          compression: "none",
          confidence: 0.8,
          metadata: {
            estimatedIntervals: dataLines.length,
            bedVariant: detectVariant(fields.length),
          },
        };
      }
    }
  }

  // SAM detection (basic heuristic)
  if (
    trimmed.includes("\t") &&
    (trimmed.includes("@SQ") ||
      trimmed.includes("@HD") ||
      trimmed.split(/\r?\n/).some((line) => line.split("\t").length >= 11))
  ) {
    return {
      format: "sam",
      compression: "none",
      confidence: 0.7,
      metadata: {},
    };
  }

  return {
    format: "unknown",
    compression: "none",
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
    case "fasta": {
      const parser = new FastaParser(options);
      yield* parser.parseString(data);
      break;
    }

    case "fastq": {
      const parser = new FastqParser(options);
      yield* parser.parseString(data);
      break;
    }

    case "bed": {
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
import { detectVariant } from "./formats";

/**
 * Library version and metadata
 */
export const VERSION = "0.1.0";
export const SUPPORTED_FORMATS = ["fasta", "fastq", "bed", "sam", "bam"] as const;
export const SUPPORTED_COMPRESSIONS = ["gzip", "zstd"] as const;
