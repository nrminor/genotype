/**
 * GTF (Gene Transfer Format) module exports
 *
 * Provides comprehensive GTF format support with exceptional quality standards.
 * Supports multi-database variants (GENCODE, Ensembl, RefSeq) with enhanced
 * parsing capabilities, hierarchical gene model understanding, and type-safe
 * query operations.
 *
 * @example Basic GTF parsing
 * ```typescript
 * import { GtfParser } from '@/formats/gtf';
 *
 * const parser = new GtfParser();
 * for await (const feature of parser.parseString(gtfData)) {
 *   console.log(`${feature.seqname}:${feature.start}-${feature.end}`);
 * }
 * ```
 *
 * @example Multi-database normalization
 * ```typescript
 * import { GtfParser } from '@/formats/gtf';
 *
 * const parser = new GtfParser({ normalizeAttributes: true });
 * for await (const feature of parser.parseString(gencodeOrEnsemblData)) {
 *   console.log(`Gene type: ${feature.normalized?.geneType}`); // Works for both!
 * }
 * ```
 *
 * @module gtf
 */

// Core parsing functionality
// Parsing functions (for advanced usage)
export {
  detectDatabaseVariant,
  GtfParser,
  GtfQueryBuilder,
  normalizeGtfAttributes,
  parseGtfAttributes,
  parseGtfFrame,
  parseGtfScore,
  queryGtf,
  validateGtfCoordinates,
  validateGtfStrand,
} from "./parser";
// Type definitions and interfaces
export type {
  AlternativeSplicingGeneModel,
  DatabaseVariant,
  GeneModel,
  GeneModelMetadata,
  GtfCdsFeature,
  GtfCodonFeature,
  GtfExonFeature,
  GtfFeature,
  GtfFeatureType,
  GtfGeneFeature,
  GtfParserOptions,
  GtfTranscriptFeature,
  GtfUtrFeature,
  HumanChromosome,
  LncRNAGeneModel,
  NormalizedGtfAttributes,
  ProteinCodingGeneModel,
  StandardGeneType,
  TranscriptModel,
  ValidGenomicRegion,
} from "./types";
// Constants for user guidance
export { GTF_LIMITS, STANDARD_GTF_FEATURES } from "./types";
// Utility functions
export {
  countGtfFeatures,
  detectGtfFormat,
  filterFeaturesByType,
} from "./utils";
export { GtfWriter } from "./writer";

// Import for namespace creation
import {
  parseGtfAttributes,
  parseGtfFrame,
  parseGtfScore,
  validateGtfCoordinates,
  validateGtfStrand,
} from "./parser";

import { countGtfFeatures, detectGtfFormat, filterFeaturesByType } from "./utils";

// Namespace exports for backward compatibility
export const GtfFormat = {
  validateGtfCoordinates,
  parseGtfAttributes,
  validateGtfStrand,
  parseGtfScore,
  parseGtfFrame,
} as const;

export const GtfUtils = {
  detectGtfFormat,
  countGtfFeatures,
  filterFeaturesByType,
} as const;
