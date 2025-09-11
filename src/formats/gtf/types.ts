/**
 * Core GTF format type definitions
 *
 * Provides essential type definitions for GTF (Gene Transfer Format) parsing
 * with focus on core functionality and Tiger Style compliance.
 *
 * @module gtf/types
 */

import type { ParserOptions, Strand } from "../../types";

/**
 * GTF feature annotation
 * Represents a single feature from GTF format with parsed attributes
 *
 * @public
 */
export interface GtfFeature {
  /** Chromosome or sequence name (e.g., "chr1", "chrX") */
  readonly seqname: string;
  /** Annotation source (e.g., "HAVANA", "GENCODE", "Ensembl") */
  readonly source: string;
  /** Feature type (e.g., "gene", "transcript", "exon", "CDS") */
  readonly feature: string;
  /** Start coordinate (1-based inclusive) */
  readonly start: number;
  /** End coordinate (1-based inclusive) */
  readonly end: number;
  /** Optional score value or null if not specified */
  readonly score: number | null;
  /** Strand orientation: + (forward), - (reverse), . (unknown) */
  readonly strand: Strand;
  /** Reading frame for CDS features (0, 1, 2) or null */
  readonly frame: number | null;
  /** Parsed attribute key-value pairs (supports multiple tag values as arrays) */
  readonly attributes: Record<string, string | string[]>;
  /** Calculated feature length (end - start + 1 for 1-based inclusive) */
  readonly length: number;
  /** Source line number for debugging */
  readonly lineNumber?: number;
  /** Normalized attributes for multi-database compatibility */
  readonly normalized?: NormalizedGtfAttributes;
}

/**
 * Normalized GTF attributes for consistent cross-database access
 * Provides unified interface regardless of source database (GENCODE, Ensembl, RefSeq)
 *
 * @public
 */
export interface NormalizedGtfAttributes {
  /** Normalized gene classification (from gene_type or gene_biotype) */
  geneType?: string;
  /** Normalized transcript classification */
  transcriptType?: string;
  /** Extracted version number (from embedded or separate version attributes) */
  version?: string;
  /** All tag values as array (handles multiple tag attributes) */
  tags: string[];
  /** Detected source database */
  sourceDatabase: DatabaseVariant;
}

/**
 * GTF parser configuration options
 *
 * @public
 */
export interface GtfParserOptions extends ParserOptions {
  /** Feature types to include (default: all) */
  includeFeatures?: string[];
  /** Feature types to exclude */
  excludeFeatures?: string[];
  /** Required attributes (parser will error if missing) */
  requiredAttributes?: string[];
  /** Parse attribute values as typed values */
  parseAttributeValues?: boolean;
  /** Automatically normalize attributes for cross-database compatibility */
  normalizeAttributes?: boolean;
  /** Detect and tag source database variant */
  detectDatabaseVariant?: boolean;
  /** Preserve original attributes alongside normalized ones */
  preserveOriginalAttributes?: boolean;
}

/**
 * Database variant types for GTF format sources
 *
 * @public
 */
export type DatabaseVariant = "GENCODE" | "Ensembl" | "RefSeq" | "unknown";

/**
 * Standard GTF feature types per specification
 * Constrained set compared to GFF3's extensive Sequence Ontology terms
 *
 * @public
 */
export type GtfFeatureType =
  | "gene"
  | "transcript"
  | "exon"
  | "CDS"
  | "UTR"
  | "start_codon"
  | "stop_codon"
  | "Selenocysteine";

/**
 * Human chromosome names with template literal validation
 * Prevents common typos in chromosome specifications
 *
 * @public
 */
export type HumanChromosome =
  | `chr${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22}`
  | "chrX"
  | "chrY"
  | "chrM"
  | "chrMT";

/**
 * Valid genomic region string with compile-time format validation
 * Parses and validates genomic region format (chr:start-end) with biological constraints
 *
 * @example
 * ```typescript
 * type Valid1 = ValidGenomicRegion<'chr1:1000-2000'>;  // ✅ Valid
 * type Valid2 = ValidGenomicRegion<'chrX:500-1500'>;   // ✅ Valid
 * type Invalid1 = ValidGenomicRegion<'chr25:1000-2000'>; // ❌ Compile error: Invalid chromosome
 * type Invalid2 = ValidGenomicRegion<'invalid-format'>; // ❌ Compile error: Bad format
 * ```
 *
 * @public
 */
export type ValidGenomicRegion<T extends string> =
  T extends `${infer Chr}:${infer Start}-${infer End}`
    ? Chr extends HumanChromosome
      ? Start extends `${number}`
        ? End extends `${number}`
          ? T // Valid region format with human chromosome
          : never
        : never
      : never
    : never;

/**
 * Standard gene biotype classifications
 * Based on GENCODE and Ensembl biotype ontologies
 *
 * @public
 */
export type StandardGeneType =
  | "protein_coding"
  | "lncRNA"
  | "miRNA"
  | "pseudogene"
  | "antisense"
  | "misc_RNA"
  | "processed_pseudogene"
  | "unprocessed_pseudogene";

// Feature-specific types with type safety constraints
/** Gene feature with type safety constraints */
export type GtfGeneFeature = GtfFeature & {
  feature: "gene";
  frame: null;
  attributes: { gene_id: string } & { transcript_id?: never };
};

/** Transcript feature with required attributes */
export type GtfTranscriptFeature = GtfFeature & {
  feature: "transcript";
  attributes: { gene_id: string; transcript_id: string };
};

/** Exon feature with transcript relationship */
export type GtfExonFeature = GtfFeature & {
  feature: "exon";
  attributes: { gene_id: string; transcript_id: string; exon_number: string };
};

/** CDS feature with required frame */
export type GtfCdsFeature = GtfFeature & {
  feature: "CDS";
  frame: 0 | 1 | 2;
  attributes: { gene_id: string; transcript_id: string };
};

/** UTR feature variants */
export type GtfUtrFeature = GtfFeature & {
  feature: "UTR" | "5UTR" | "3UTR";
  attributes: { gene_id: string; transcript_id: string };
};

/** Codon features (start/stop) */
export type GtfCodonFeature = GtfFeature & {
  feature: "start_codon" | "stop_codon";
  frame: 0;
  attributes: { gene_id: string; transcript_id: string };
};

/**
 * Hierarchical gene model structure
 * Represents complete gene annotation with all associated features
 *
 * @public
 */
export interface GeneModel {
  /** Gene-level feature */
  gene: GtfGeneFeature;
  /** All transcript isoforms with their components */
  transcripts: Array<TranscriptModel>;
  /** Calculated genomic metadata */
  metadata: GeneModelMetadata;
}

/**
 * Transcript model with associated features
 *
 * @public
 */
export interface TranscriptModel {
  /** Transcript feature */
  transcript: GtfTranscriptFeature;
  /** All exons for this transcript */
  exons: GtfExonFeature[];
  /** Coding sequences (protein-coding transcripts only) */
  cds?: GtfCdsFeature[];
  /** UTR features */
  utrs?: GtfUtrFeature[];
  /** Start codon (protein-coding transcripts only) */
  startCodon?: GtfCodonFeature;
  /** Stop codon (protein-coding transcripts only) */
  stopCodon?: GtfCodonFeature;
}

/**
 * Calculated metadata for gene models
 * Provides genomics insights derived from feature analysis
 *
 * @public
 */
export interface GeneModelMetadata {
  /** Number of transcript isoforms */
  transcriptCount: number;
  /** Total exon count across all isoforms */
  totalExonCount: number;
  /** Number of protein-coding transcripts */
  codingTranscriptCount: number;
  /** Length of longest transcript isoform */
  longestTranscriptLength: number;
  /** Total gene span (end - start + 1) */
  geneLength: number;
  /** Whether gene has multiple transcript isoforms */
  hasAlternativeSplicing: boolean;
  /** Primary gene biotype classification */
  biotype: StandardGeneType | "unknown";
}

/** Protein-coding gene model with required CDS components */
export type ProteinCodingGeneModel = GeneModel & {
  gene: GtfGeneFeature & { attributes: { gene_type: "protein_coding" } };
  transcripts: Array<
    TranscriptModel & {
      cds: GtfCdsFeature[];
      startCodon: GtfCodonFeature;
      stopCodon: GtfCodonFeature;
    }
  >;
  metadata: GeneModelMetadata & { biotype: "protein_coding"; codingTranscriptCount: number };
};

/** Long non-coding RNA gene model */
export type LncRNAGeneModel = GeneModel & {
  gene: GtfGeneFeature & { attributes: { gene_type: "lncRNA" } };
  transcripts: Array<
    TranscriptModel & {
      cds?: never;
      startCodon?: never;
      stopCodon?: never;
    }
  >;
  metadata: GeneModelMetadata & { biotype: "lncRNA"; codingTranscriptCount: 0 };
};

/** Gene model with alternative splicing */
export type AlternativeSplicingGeneModel = GeneModel & {
  transcripts: [TranscriptModel, TranscriptModel, ...TranscriptModel[]]; // At least 2
  metadata: GeneModelMetadata & { hasAlternativeSplicing: true; transcriptCount: number };
};

/**
 * Standard GTF feature types from specification
 * Useful for validation, user guidance, and ensuring GTF compliance
 *
 * @public
 */
export const STANDARD_GTF_FEATURES = [
  "gene",
  "transcript",
  "exon",
  "CDS",
  "UTR",
  "start_codon",
  "stop_codon",
  "Selenocysteine",
] as const;

/**
 * GTF coordinate limits based on genomics domain knowledge
 *
 * @public
 */
export const GTF_LIMITS = {
  /** Maximum chromosome size - larger than any known chromosome */
  MAX_CHROMOSOME_SIZE: 2_500_000_000, // 2.5GB (aligned with enhanced coordinate system for large genomes)
  /** Minimum coordinate value - GTF is 1-based */
  MIN_COORDINATE: 1,
} as const;
