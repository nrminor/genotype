/**
 * Centralized record constructor functions for genomic data types.
 *
 * These functions are the single normalization point where plain strings
 * become GenotypeString instances. They accept `GenotypeString | string`
 * for sequence and quality fields, compute derived fields like `length`,
 * and return fully typed record objects.
 *
 * @module
 */

import { GenotypeString } from "./genotype-string";
import type {
  AbstractSequence,
  AlignmentRecord,
  FastaSequence,
  FastqSequence,
  KmerSequence,
  QualityEncoding,
} from "./types";

/**
 * Input fields for creating a FASTA record.
 *
 * The `sequence` field accepts either a plain string or an existing
 * GenotypeString. Plain strings are wrapped automatically.
 */
export interface FastaRecordInput {
  readonly id: string;
  readonly sequence: GenotypeString | string;
  readonly description?: string | undefined;
  readonly lineNumber?: number | undefined;
  readonly gcContent?: number | undefined;
}

/**
 * Creates a fully typed FASTA record from the given fields.
 *
 * The `length` field is derived from the sequence. The `format`
 * discriminant is set automatically. Optional fields from the input
 * are carried through as-is.
 */
export function createFastaRecord(input: FastaRecordInput): FastaSequence {
  const sequence = GenotypeString.fromString(input.sequence);
  const { sequence: _, ...rest } = input;
  return { ...rest, format: "fasta", sequence, length: sequence.length } as FastaSequence;
}

/**
 * Input fields for creating a FASTQ record.
 *
 * Both `sequence` and `quality` accept either a plain string or an
 * existing GenotypeString. Plain strings are wrapped automatically.
 */
export interface FastqRecordInput {
  readonly id: string;
  readonly sequence: GenotypeString | string;
  readonly quality: GenotypeString | string;
  readonly qualityEncoding: QualityEncoding;
  readonly description?: string | undefined;
  readonly lineNumber?: number | undefined;
  readonly qualityScores?: number[] | undefined;
  readonly qualityStats?:
    | {
        readonly mean: number;
        readonly min: number;
        readonly max: number;
        readonly lowQualityBases: number;
      }
    | undefined;
}

/**
 * Creates a fully typed FASTQ record from the given fields.
 *
 * The `length` field is derived from the sequence. The `format`
 * discriminant is set automatically. Optional fields from the input
 * are carried through as-is.
 */
export function createFastqRecord(input: FastqRecordInput): FastqSequence {
  const sequence = GenotypeString.fromString(input.sequence);
  const quality = GenotypeString.fromString(input.quality);
  const { sequence: _s, quality: _q, ...rest } = input;
  return { ...rest, format: "fastq", sequence, quality, length: sequence.length } as FastqSequence;
}

/**
 * Input fields for creating a k-mer record.
 *
 * The `sequence` field accepts either a plain string or an existing
 * GenotypeString. The generic parameter `K` tracks k-mer size at
 * compile time.
 */
export interface KmerRecordInput<K extends number> {
  readonly id: string;
  readonly sequence: GenotypeString | string;
  readonly kmerSize: K;
  readonly stepSize: number;
  readonly originalId: string;
  readonly startPosition: number;
  readonly endPosition: number;
  readonly coordinateSystem: "0-based" | "1-based";
  readonly suffix: string;
  readonly isWrapped: boolean;
  readonly windowIndex: number;
  readonly description?: string | undefined;
  readonly lineNumber?: number | undefined;
}

/**
 * Creates a fully typed k-mer record from the given fields.
 *
 * The `length` field is derived from the sequence. The generic
 * parameter `K` is inferred from the `kmerSize` value.
 */
export function createKmerRecord<K extends number>(input: KmerRecordInput<K>): KmerSequence<K> {
  const sequence = GenotypeString.fromString(input.sequence);
  const { sequence: _, ...rest } = input;
  return { ...rest, sequence, length: sequence.length } as KmerSequence<K>;
}

/**
 * Input fields for creating an alignment record.
 *
 * The `sequence` and `quality` fields accept either a plain string or
 * an existing GenotypeString. The `format` discriminant ("sam" or
 * "bam") must be provided by the caller since the constructor doesn't
 * know which parser produced the record.
 */
export interface AlignmentRecordInput {
  readonly format: "sam" | "bam";
  readonly id: string;
  readonly sequence: GenotypeString | string;
  readonly quality: GenotypeString | string;
  readonly qualityEncoding: QualityEncoding;
  readonly flag: number;
  readonly referenceSequence: string;
  readonly position: number;
  readonly mappingQuality: number;
  readonly cigar: string;
  readonly description?: string | undefined;
  readonly lineNumber?: number | undefined;
}

/**
 * Creates a fully typed alignment record from the given fields.
 *
 * The `length` field is derived from the sequence. The `sequence` and
 * `quality` fields are normalized to GenotypeString if provided as
 * plain strings.
 */
export function createAlignmentRecord(input: AlignmentRecordInput): AlignmentRecord {
  const sequence = GenotypeString.fromString(input.sequence);
  const quality = GenotypeString.fromString(input.quality);
  const { sequence: _s, quality: _q, ...rest } = input;
  return { ...rest, sequence, quality, length: sequence.length } as AlignmentRecord;
}

/**
 * Returns a copy of the record with a new sequence value.
 *
 * The `length` field is updated to match the new sequence. All other
 * fields are preserved. Accepts either a plain string or an existing
 * GenotypeString — plain strings are wrapped automatically.
 */
export function withSequence<T extends AbstractSequence>(
  record: T,
  sequence: GenotypeString | string
): T {
  const gs = GenotypeString.fromString(sequence);
  return { ...record, sequence: gs, length: gs.length } as T;
}

/**
 * Returns a copy of the record with a new quality value.
 *
 * All other fields (including `length`) are preserved. Accepts either
 * a plain string or an existing GenotypeString — plain strings are
 * wrapped automatically.
 */
export function withQuality<T extends { quality: GenotypeString }>(
  record: T,
  quality: GenotypeString | string
): T {
  return { ...record, quality: GenotypeString.fromString(quality) } as T;
}

/**
 * Convert a plain record object to a typed sequence.
 *
 * Delegates to createFastaRecord or createFastqRecord based on format.
 * Used by JSON and tabular parsers for uniform record-to-sequence conversion.
 */
export function convertRecordToSequence(
  record: {
    id: string;
    sequence: string;
    description?: string;
    length?: number;
  },
  format: "fasta",
  qualityEncoding?: never
): FastaSequence;
export function convertRecordToSequence(
  record: {
    id: string;
    sequence: string;
    quality: string;
    description?: string;
    length?: number;
  },
  format: "fastq",
  qualityEncoding: "phred33" | "phred64" | "solexa"
): FastqSequence;
export function convertRecordToSequence(
  record: {
    id: string;
    sequence: string;
    quality?: string;
    description?: string;
    length?: number;
  },
  format: "fasta" | "fastq",
  qualityEncoding?: "phred33" | "phred64" | "solexa"
): AbstractSequence;
export function convertRecordToSequence(
  record: {
    id: string;
    sequence: string;
    quality?: string;
    description?: string;
    length?: number;
  },
  format: "fasta" | "fastq" = "fasta",
  qualityEncoding: "phred33" | "phred64" | "solexa" = "phred33"
): AbstractSequence {
  const { id, sequence, quality, description } = record;

  if (format === "fastq" && quality) {
    return createFastqRecord({ id, sequence, quality, qualityEncoding, description });
  }
  return createFastaRecord({ id, sequence, description });
}
