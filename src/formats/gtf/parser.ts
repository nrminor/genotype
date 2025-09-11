/**
 * Core GTF format parser with Tiger Style compliance
 *
 * Provides fundamental GTF parsing capabilities with exceptional error quality,
 * streaming architecture, and comprehensive validation. Forms the foundation
 * for enhanced GTF processing capabilities.
 *
 * @module gtf/parser
 */

import { type } from "arktype";
import { GenotypeError, ParseError, ValidationError } from "../../errors";
import {
  parseEndPosition,
  parseStartPosition,
  validateFinalCoordinates,
} from "../../operations/core/coordinates";
import type { Strand } from "../../types";
import { AbstractParser } from "../abstract-parser";
import type {
  DatabaseVariant,
  GtfFeature,
  GtfFeatureType,
  GtfParserOptions,
  HumanChromosome,
  NormalizedGtfAttributes,
  StandardGeneType,
  ValidGenomicRegion,
} from "./types";
import { GTF_LIMITS, STANDARD_GTF_FEATURES } from "./types";

/**
 * ArkType validation for GTF parser options
 * Eliminates defensive programming anti-patterns
 */
const GtfParserOptionsSchema = type({
  "skipValidation?": "boolean",
  "maxLineLength?": "number>0",
  "trackLineNumbers?": "boolean",
  "includeFeatures?": "string[]",
  "excludeFeatures?": "string[]",
  "requiredAttributes?": "string[]",
  "parseAttributeValues?": "boolean",
  "normalizeAttributes?": "boolean",
  "detectDatabaseVariant?": "boolean",
  "preserveOriginalAttributes?": "boolean",
}).narrow((options, ctx) => {
  if (options.maxLineLength && options.maxLineLength > 10_000_000) {
    return ctx.reject("maxLineLength cannot exceed 10MB for memory safety");
  }
  return true;
});

/**
 * Detect database variant from attribute patterns
 * Tiger Style: Function under 70 lines, pattern recognition
 *
 * @param attributes Parsed GTF attributes
 * @returns Detected database variant
 *
 * @public
 */
export function detectDatabaseVariant(
  attributes: Record<string, string | string[]>
): DatabaseVariant {
  // GENCODE indicators: gene_type, level, havana_gene, embedded versions
  if (attributes.gene_type || attributes.level || attributes.havana_gene) {
    return "GENCODE";
  }

  // Ensembl indicators: gene_biotype, gene_version, gene_source
  if (attributes.gene_biotype || attributes.gene_version || attributes.gene_source) {
    return "Ensembl";
  }

  // RefSeq indicators: locus_tag, product, Dbxref
  if (attributes.locus_tag || attributes.product || attributes.Dbxref) {
    return "RefSeq";
  }

  return "unknown";
}

/**
 * Extract version number from gene ID with type-safe handling
 * Handles GENCODE embedded version pattern (ENSG00000123.7) with biological context
 *
 * @param geneId Gene ID value (string or string[] from attributes)
 * @returns Version number if found, undefined otherwise
 */
function extractGeneVersion(geneId: string | string[]): string | undefined {
  if (typeof geneId === "string") {
    const match = geneId.match(/\.(\d+)$/);
    return match?.[1];
  }
  return undefined; // Array case handled gracefully (unusual but possible)
}

/**
 * Normalize tag values to consistent array format
 * Handles both single tags and multiple tag attributes from GENCODE
 *
 * @param tagValue Tag attribute value (string, string[], or undefined)
 * @returns Array of tag values for consistent access
 */
function normalizeTagsToArray(tagValue: string | string[] | undefined): string[] {
  if (!tagValue) return [];
  return typeof tagValue === "string" ? [tagValue] : tagValue;
}

/**
 * Normalize attributes for cross-database compatibility
 * Tiger Style: Function under 70 lines, database-aware normalization
 *
 * @param attributes Original parsed attributes
 * @param sourceDatabase Detected database variant
 * @returns Normalized attributes for consistent access
 *
 * @public
 */
export function normalizeGtfAttributes(
  attributes: Record<string, string | string[]>,
  sourceDatabase: DatabaseVariant
): NormalizedGtfAttributes {
  const normalized: NormalizedGtfAttributes = {
    tags: [],
    sourceDatabase,
  };

  // Normalize gene type classification
  if (attributes.gene_type) {
    normalized.geneType = attributes.gene_type as string;
  } else if (attributes.gene_biotype) {
    normalized.geneType = attributes.gene_biotype as string;
  }

  // Normalize transcript type
  if (attributes.transcript_type) {
    normalized.transcriptType = attributes.transcript_type as string;
  } else if (attributes.transcript_biotype) {
    normalized.transcriptType = attributes.transcript_biotype as string;
  }

  // Extract version information using type-safe helper
  if (attributes.gene_version) {
    normalized.version = attributes.gene_version as string;
  } else if (attributes.gene_id) {
    // Extract embedded version (GENCODE pattern: ENSG00000123.1) with type safety
    const version = extractGeneVersion(attributes.gene_id);
    if (version) {
      normalized.version = version;
    }
  }

  // Normalize tags using type-safe helper function
  normalized.tags = normalizeTagsToArray(attributes.tag);

  return normalized;
}

/**
 * Validate GTF coordinates with genomics domain knowledge
 * Tiger Style: Function under 70 lines, 1-based coordinate validation
 *
 * @param start Start coordinate (must be >= 1 for GTF)
 * @param end End coordinate (must be >= start)
 * @returns Validation result with error message if invalid
 *
 * @public
 */

/**
 * Parse GTF attributes with robust real-world handling
 * Tiger Style: Function under 70 lines, handles GENCODE/Ensembl variations
 *
 * @param attributeString Raw attribute string from GTF line
 * @returns Parsed attribute key-value pairs with multi-tag support
 *
 * @example
 * ```typescript
 * const attrs = parseGtfAttributes('gene_id "ENSG001"; tag "basic"; tag "MANE_Select";');
 * console.log(attrs.gene_id); // "ENSG001"
 * console.log(attrs.tag); // "MANE_Select" (current implementation behavior)
 * ```
 *
 * @public
 */
export function parseGtfAttributes(attributeString: string): Record<string, string | string[]> {
  const attributes: Record<string, string | string[]> = {};

  if (!attributeString || attributeString.trim() === "") {
    return attributes;
  }

  // Split by semicolon, handling quoted values and edge cases
  const parts = attributeString.split(";");
  const multiValueAttributes: Record<string, string[]> = {};

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Match key value pattern: key "value" or key value
    const match = trimmed.match(/^([^=\s]+)\s+(.+)$/);
    if (!match) continue;

    const key = match[1]?.trim();
    let value = match[2]?.trim();

    if (!key || !value) continue;

    // Remove quotes if present (handles both " and ')
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Handle multiple values for same key (e.g., multiple tag attributes)
    if (key in attributes || key in multiValueAttributes) {
      if (!multiValueAttributes[key]) {
        multiValueAttributes[key] = [attributes[key] as string];
        delete attributes[key];
      }
      multiValueAttributes[key].push(value);
    } else {
      attributes[key] = value;
    }
  }

  // Merge multi-value attributes back
  for (const [key, values] of Object.entries(multiValueAttributes)) {
    attributes[key] = values;
  }

  return attributes;
}

/**
 * Validate strand annotation for GTF format
 * Tiger Style: Function under 70 lines, genomics strand validation
 *
 * @param strand Strand string to validate
 * @returns True if valid GTF strand annotation
 *
 * @public
 */
export function validateGtfStrand(strand: string): strand is Strand {
  return strand === "+" || strand === "-" || strand === ".";
}

/**
 * Parse score field with GTF standards
 * Tiger Style: Function under 70 lines, handles missing values
 *
 * @param scoreStr Score string from GTF (may be "." for missing)
 * @returns Parsed score or null if missing/invalid
 *
 * @public
 */
export function parseGtfScore(scoreStr: string): number | null {
  if (scoreStr === "." || scoreStr === "") {
    return null;
  }

  const score = parseFloat(scoreStr);
  if (isNaN(score)) {
    throw new ParseError(`Invalid score: ${scoreStr}`, "GTF");
  }

  return score;
}

/**
 * Parse frame field for CDS features
 * Tiger Style: Function under 70 lines, validates frame values
 *
 * @param frameStr Frame string from GTF (0, 1, 2, or "." for missing)
 * @returns Parsed frame or null if missing/not applicable
 *
 * @public
 */
export function parseGtfFrame(frameStr: string): number | null {
  if (frameStr === "." || frameStr === "") {
    return null;
  }

  const frame = parseInt(frameStr, 10);
  if (isNaN(frame) || frame < 0 || frame > 2) {
    throw new ParseError(`Invalid frame: ${frameStr} (must be 0, 1, 2, or '.')`, "GTF");
  }

  return frame;
}

/**
 * GTF-specific coordinate validation for 1-based inclusive system
 * Tiger Style: Function under 70 lines, biological domain expertise
 */
export function validateGtfCoordinates(
  start: number,
  end: number,
  sequenceLength = Number.MAX_SAFE_INTEGER,
  region = `${start}-${end}`
): { valid: boolean; error?: string } {
  if (start < 1) {
    return {
      valid: false,
      error: `Invalid start position: ${start} (GTF is 1-based, minimum value is 1) in region ${region}`,
    };
  }
  if (end > sequenceLength) {
    return {
      valid: false,
      error: `Invalid end position: ${end} (exceeds sequence length ${sequenceLength}) in region ${region}`,
    };
  }
  // GTF 1-based inclusive: start=end is VALID for single-base features (SNPs, regulatory sites)
  if (start > end) {
    return {
      valid: false,
      error: `Invalid coordinates: start ${start} > end ${end} in region ${region}`,
    };
  }

  return { valid: true };
}

/**
 * Parse GTF coordinates using core coordinate functions
 * Leverages battle-tested coordinate handling with GTF-specific context
 * Tiger Style: Function under 70 lines, reuses core functionality
 */
function parseGtfCoordinates(
  startStr: string,
  endStr: string,
  lineNumber: number,
  seqname: string
): { start: number; end: number } {
  try {
    // Use core functions for comprehensive coordinate parsing and validation
    const LARGE_SEQUENCE_LENGTH = GTF_LIMITS.MAX_CHROMOSOME_SIZE;
    // Parse coordinates directly for GTF 1-based display (no conversion needed)
    const startValue = parseInt(startStr, 10);
    const endValue = parseInt(endStr, 10);

    if (isNaN(startValue) || isNaN(endValue)) {
      throw new Error(`Invalid coordinates: start=${startStr}, end=${endStr} (not numbers)`);
    }

    const startResult = { value: startValue, hasNegative: false };
    const endResult = { value: endValue, hasNegative: false };

    // GTF-specific validation preserving biological context
    if (startResult.value < GTF_LIMITS.MIN_COORDINATE) {
      throw new Error(
        `Start coordinate ${startResult.value} is invalid (GTF coordinates are 1-based, minimum value is 1)`
      );
    }

    // GTF-specific validation (allows start=end for single-base features)
    const validation = validateGtfCoordinates(
      startResult.value,
      endResult.value,
      LARGE_SEQUENCE_LENGTH,
      `${seqname}:${startStr}-${endStr}`
    );

    if (!validation.valid) {
      throw new Error(validation.error!);
    }

    return { start: startResult.value, end: endResult.value };
  } catch (error) {
    throw new ParseError(
      `Invalid coordinates for ${seqname}: ${error instanceof Error ? error.message : String(error)}`,
      "GTF",
      lineNumber,
      "GTF uses 1-based inclusive coordinates (both start and end positions are included)"
    );
  }
}

/**
 * Parse GTF line fields with exceptional error quality
 * Tiger Style: Function under 70 lines, delegates validation to helpers
 */
function parseGtfLineFields(
  line: string,
  lineNumber: number
): {
  seqname: string;
  source: string;
  feature: string;
  start: number;
  end: number;
  scoreStr: string;
  strandStr: string;
  frameStr: string;
  attributeStr: string;
} {
  const fields = line.split("\t");

  if (fields.length !== 9) {
    throw new ParseError(
      `GTF format requires exactly 9 tab-separated fields, got ${fields.length}`,
      "GTF",
      lineNumber,
      "Each GTF line must have: seqname, source, feature, start, end, score, strand, frame, attributes"
    );
  }

  const [seqname, source, feature, startStr, endStr, scoreStr, strandStr, frameStr, attributeStr] =
    fields;

  // Validate required fields are present
  if (!seqname || !source || !feature || !startStr || !endStr || !strandStr) {
    throw new ParseError(
      "Missing required GTF fields",
      "GTF",
      lineNumber,
      `Required: seqname, source, feature, start, end, strand`
    );
  }

  // Parse coordinates using enhanced core functions
  const coordinates = parseGtfCoordinates(startStr, endStr, lineNumber, seqname);

  return {
    seqname,
    source,
    feature,
    start: coordinates.start,
    end: coordinates.end,
    scoreStr: scoreStr || "",
    strandStr,
    frameStr: frameStr || "",
    attributeStr: attributeStr || "",
  };
}

/**
 * Build GTF feature with calculated genomics fields
 * Tiger Style: Function under 70 lines, focused on feature construction
 */
function buildGtfFeature(
  parsedFields: ReturnType<typeof parseGtfLineFields>,
  lineNumber: number,
  trackLineNumbers: boolean,
  normalizeAttributes?: boolean,
  shouldDetectDatabase?: boolean
): GtfFeature {
  const { seqname, source, feature, start, end, scoreStr, strandStr, frameStr, attributeStr } =
    parsedFields;

  // Validate coordinates with genomics knowledge
  const coordValidation = validateGtfCoordinates(start, end);
  if (!coordValidation.valid) {
    throw new ParseError(
      coordValidation.error!,
      "GTF",
      lineNumber,
      `Feature coordinates: ${seqname}:${start}-${end} (${feature})`
    );
  }

  // Validate strand
  if (!validateGtfStrand(strandStr)) {
    throw new ParseError(
      `Invalid strand '${strandStr}', must be '+', '-', or '.'`,
      "GTF",
      lineNumber,
      "Valid strand annotations: + (forward), - (reverse), . (unknown/not applicable)"
    );
  }

  // Parse optional fields
  const score = scoreStr ? parseGtfScore(scoreStr) : null;
  const frame = frameStr ? parseGtfFrame(frameStr) : null;
  const attributes = parseGtfAttributes(attributeStr);

  // Add normalization if requested
  let normalized: NormalizedGtfAttributes | undefined = undefined;
  if (normalizeAttributes || shouldDetectDatabase) {
    const databaseVariant = shouldDetectDatabase ? detectDatabaseVariant(attributes) : "unknown";
    normalized = normalizeGtfAttributes(attributes, databaseVariant);
  }

  const gtfFeature: GtfFeature = {
    seqname,
    source,
    feature,
    start,
    end,
    score,
    strand: strandStr as Strand,
    frame,
    attributes,
    length: end - start + 1, // GTF is 1-based inclusive
    ...(trackLineNumbers && { lineNumber }),
    ...(normalized && { normalized }),
  };

  return gtfFeature;
}

/**
 * Streaming GTF parser with exceptional quality
 * Tiger Style: All methods under 70 lines, focused responsibilities
 *
 * @example Basic GTF parsing
 * ```typescript
 * const parser = new GtfParser();
 * for await (const feature of parser.parseString(gtfData)) {
 *   console.log(`${feature.seqname}:${feature.start}-${feature.end} (${feature.feature})`);
 * }
 * ```
 *
 * @example Multi-database parsing with normalization
 * ```typescript
 * const parser = new GtfParser({
 *   normalizeAttributes: true,
 *   detectDatabaseVariant: true
 * });
 * for await (const feature of parser.parseString(gencodeOrEnsemblData)) {
 *   console.log(`Gene type: ${feature.normalized?.geneType}`); // Works for both!
 * }
 * ```
 *
 * @public
 */
export class GtfParser extends AbstractParser<GtfFeature, GtfParserOptions> {
  /**
   * Create new GTF parser with specified options
   *
   * @param options Parser configuration options
   */
  constructor(options: GtfParserOptions = {}) {
    // Step 1: Prepare options with GTF-specific defaults
    const optionsWithDefaults = {
      skipValidation: false,
      maxLineLength: 1_000_000,
      trackLineNumbers: true,
      parseAttributeValues: false,
      normalizeAttributes: false,
      detectDatabaseVariant: true,
      preserveOriginalAttributes: true,
      onError: (error: string, lineNumber?: number): never => {
        throw new ParseError(error, "GTF", lineNumber);
      },
      onWarning: (warning: string, lineNumber?: number): void => {
        console.warn(`GTF Warning (line ${lineNumber}): ${warning}`);
      },
      ...options, // User options override defaults
    };

    // Step 2: ArkType validation with domain expertise
    const validationResult = GtfParserOptionsSchema(optionsWithDefaults);

    if (validationResult instanceof type.errors) {
      throw new ValidationError(
        `Invalid GTF parser options: ${validationResult.summary}`,
        undefined,
        "GTF parser configuration with biological context"
      );
    }

    // Step 3: Pass validated options to type-safe parent
    super(validationResult);
  }

  protected getFormatName(): string {
    return "GTF";
  }

  /**
   * Parse GTF features from string data
   * Tiger Style: Function under 70 lines, delegates to parseLines
   *
   * @param data GTF format string data
   * @yields GTF features with parsed attributes and optional normalization
   */
  override async *parseString(data: string): AsyncIterable<GtfFeature> {
    const lines = data.split(/\r?\n/);
    yield* this.parseLines(lines);
  }

  /**
   * Parse GTF features from file using streaming I/O
   * Tiger Style: Function under 70 lines, follows proven FASTA pattern
   *
   * @param filePath Path to GTF file
   * @param options File reading options
   * @yields GTF features from file content
   */
  override async *parseFile(
    filePath: string,
    options?: { encoding?: string }
  ): AsyncIterable<GtfFeature> {
    if (filePath.length === 0) {
      throw new ValidationError("filePath cannot be empty");
    }

    try {
      const { createStream } = await import("../../io/file-reader");
      const stream = await createStream(filePath, {
        encoding: (options?.encoding as "utf8") || "utf8",
        maxFileSize: 10_000_000_000, // 10GB max for large annotation files
      });

      const { StreamUtils } = await import("../../io/stream-utils");
      const lines = StreamUtils.readLines(stream, "utf8");
      yield* this.parseLinesFromAsyncIterable(lines);
    } catch (error) {
      throw new ParseError(
        `Failed to parse GTF file '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
        "GTF",
        undefined,
        `File path: ${filePath}`
      );
    }
  }

  /**
   * Parse lines with streaming architecture
   * Tiger Style: Function under 70 lines, focused on line processing
   */
  private async *parseLines(lines: string[], startLineNumber = 1): AsyncIterable<GtfFeature> {
    let lineNumber = startLineNumber;

    for (const line of lines) {
      lineNumber++;

      if (line.length > this.options.maxLineLength) {
        this.options.onError(
          `Line too long (${line.length} > ${this.options.maxLineLength})`,
          lineNumber
        );
        continue;
      }

      const trimmedLine = line.trim();

      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith("#") || trimmedLine.startsWith("//")) {
        continue;
      }

      try {
        const feature = this.parseSingleLine(trimmedLine, lineNumber);
        if (feature && this.shouldIncludeFeature(feature)) {
          yield feature;
        }
      } catch (error) {
        if (!this.options.skipValidation) {
          throw error;
        }
        this.options.onError(error instanceof Error ? error.message : String(error), lineNumber);
      }
    }
  }

  /**
   * Parse GTF features from ReadableStream
   * @param stream Binary data stream
   * @returns AsyncIterable of GTF features
   */
  override async *parse(stream: ReadableStream<Uint8Array>): AsyncIterable<GtfFeature> {
    // Extract stream parsing logic (following proven SAM pattern)
    const { StreamUtils } = await import("../../io/stream-utils");
    const lines = StreamUtils.readLines(stream, "utf8");
    yield* this.parseLinesFromAsyncIterable(lines);
  }

  /**
   * Parse lines from async iterable
   * Tiger Style: Function under 70 lines, maintains streaming contract
   */
  private async *parseLinesFromAsyncIterable(
    lines: AsyncIterable<string>
  ): AsyncIterable<GtfFeature> {
    let lineNumber = 0;

    try {
      for await (const rawLine of lines) {
        lineNumber++;
        const line = rawLine.trim();

        if (!line || line.startsWith("#") || line.startsWith("//")) {
          continue;
        }

        if (line.length > this.options.maxLineLength) {
          this.options.onError(
            `Line too long (${line.length} > ${this.options.maxLineLength})`,
            lineNumber
          );
          continue;
        }

        try {
          const feature = this.parseSingleLine(line, lineNumber);
          if (feature && this.shouldIncludeFeature(feature)) {
            yield feature;
          }
        } catch (error) {
          if (!this.options.skipValidation) {
            throw error;
          }
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.options.onError(errorMsg, lineNumber);
        }
      }
    } catch (error) {
      throw new ParseError(
        `GTF parsing failed at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
        "GTF",
        lineNumber
      );
    }
  }

  /**
   * Parse single GTF line with exceptional error quality
   * Tiger Style: Function under 70 lines - major reduction from original 136 lines
   */
  private parseSingleLine(line: string, lineNumber: number): GtfFeature | null {
    try {
      // Parse and validate fields using focused helper
      const parsedFields = parseGtfLineFields(line, lineNumber);

      // Build feature with calculated genomics fields and optional normalization
      const feature = buildGtfFeature(
        parsedFields,
        lineNumber,
        this.options.trackLineNumbers,
        this.options.normalizeAttributes,
        this.options.detectDatabaseVariant
      );

      // Validate required attributes if specified
      if (this.options.requiredAttributes) {
        this.validateRequiredAttributes(feature, lineNumber);
      }

      return feature;
    } catch (error) {
      if (error instanceof ParseError) {
        throw error;
      }

      throw new ParseError(
        `Failed to parse GTF line: ${error instanceof Error ? error.message : String(error)}`,
        "GTF",
        lineNumber,
        `Line content: ${line}`
      );
    }
  }

  /**
   * Validate required attributes are present
   * Tiger Style: Function under 70 lines, focused validation
   */
  private validateRequiredAttributes(feature: GtfFeature, lineNumber: number): void {
    if (!this.options.requiredAttributes) return;

    for (const required of this.options.requiredAttributes) {
      if (!(required in feature.attributes)) {
        throw new ParseError(
          `Required attribute '${required}' not found`,
          "GTF",
          lineNumber,
          `Available attributes: ${Object.keys(feature.attributes).join(", ")}`
        );
      }
    }
  }

  /**
   * Check if feature should be included based on filters
   * Tiger Style: Function under 70 lines, clear filter logic
   */
  private shouldIncludeFeature(feature: GtfFeature): boolean {
    // Check include list
    if (this.options.includeFeatures && this.options.includeFeatures.length > 0) {
      if (!this.options.includeFeatures.includes(feature.feature)) {
        return false;
      }
    }

    // Check exclude list
    if (this.options.excludeFeatures && this.options.excludeFeatures.length > 0) {
      if (this.options.excludeFeatures.includes(feature.feature)) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Fluent query builder for biological GTF filtering with perfect IntelliSense
 * Provides type-safe, educational API for genomics researchers
 *
 * @example Basic biological filtering
 * ```typescript
 * const proteinGenes = await queryGtf(parser)
 *   .from(annotationData)
 *   .filterByFeature("gene")
 *   .filterByChromosome("chr1")
 *   .filterByGeneType("protein_coding")
 *   .collect();
 * ```
 *
 * @public
 */
export class GtfQueryBuilder<TCurrentFilter = GtfFeature> {
  /**
   * Create query builder with GTF feature source
   * @param source AsyncIterable of GTF features to query
   */
  constructor(private readonly source: AsyncIterable<TCurrentFilter>) {}

  /**
   * Filter features by chromosome with compile-time validation
   * Prevents invalid chromosome names (chr25, chr0) through template literal types
   *
   * @param chromosome Human chromosome name (chr1-chr22, chrX, chrY, chrM, chrMT)
   * @returns New query builder with chromosome-filtered type
   *
   * @example Compile-time chromosome validation
   * ```typescript
   * queryBuilder.filterByChromosome("chr1")   // ✅ Valid - autosomal chromosome
   * queryBuilder.filterByChromosome("chrX")   // ✅ Valid - sex chromosome
   * queryBuilder.filterByChromosome("chr25")  // ❌ Compile error - humans have 22 autosomes
   * ```
   */
  filterByChromosome<T extends HumanChromosome>(
    chromosome: T
  ): GtfQueryBuilder<TCurrentFilter & { seqname: T }> {
    const filteredSource = this.filterAsync(
      (feature) => (feature as GtfFeature).seqname === chromosome
    );
    return new GtfQueryBuilder(filteredSource as AsyncIterable<TCurrentFilter & { seqname: T }>);
  }

  /**
   * Filter features by GTF feature type with gene structure education
   * Constrains to valid GTF feature types, teaches gene model hierarchy through IntelliSense
   *
   * @param featureType GTF feature type (gene, transcript, exon, CDS, UTR, start_codon, stop_codon, Selenocysteine)
   * @returns New query builder with feature-type-filtered results
   *
   * @example Gene structure filtering
   * ```typescript
   * queryBuilder.filterByFeature("gene")       // ✅ Top-level gene loci
   * queryBuilder.filterByFeature("transcript") // ✅ Alternative splice variants
   * queryBuilder.filterByFeature("exon")       // ✅ Transcribed regions
   * queryBuilder.filterByFeature("CDS")        // ✅ Protein-coding sequences
   * queryBuilder.filterByFeature("invalid")    // ❌ Compile error - not a valid GTF feature
   * ```
   */
  filterByFeature<T extends GtfFeatureType>(
    featureType: T
  ): GtfQueryBuilder<TCurrentFilter & { feature: T }> {
    const filteredSource = this.filterAsync(
      (feature) => (feature as GtfFeature).feature === featureType
    );
    return new GtfQueryBuilder(filteredSource as AsyncIterable<TCurrentFilter & { feature: T }>);
  }

  /**
   * Filter features by gene type with biological classification education
   * Uses normalized attributes for cross-database compatibility (GENCODE/Ensembl)
   *
   * @param geneType Standard gene biotype classification
   * @returns New query builder filtered by gene classification
   *
   * @example Biological classification filtering
   * ```typescript
   * queryBuilder.filterByGeneType("protein_coding") // ✅ Protein-coding genes
   * queryBuilder.filterByGeneType("lncRNA")         // ✅ Long non-coding RNAs
   * queryBuilder.filterByGeneType("miRNA")          // ✅ MicroRNAs
   * queryBuilder.filterByGeneType("pseudogene")     // ✅ Non-functional gene copies
   * ```
   */
  filterByGeneType<T extends StandardGeneType>(
    geneType: T
  ): GtfQueryBuilder<TCurrentFilter & { normalized: { geneType: T } }> {
    const filteredSource = this.filterAsync((feature) => {
      const gtfFeature = feature as GtfFeature;
      const normalized = gtfFeature.normalized;
      return normalized?.geneType === geneType;
    });
    return new GtfQueryBuilder(
      filteredSource as AsyncIterable<TCurrentFilter & { normalized: { geneType: T } }>
    );
  }

  /**
   * Filter features by genomic region with compile-time format validation
   * Parses region format (chr:start-end) with biological coordinate understanding
   *
   * @param region Genomic region string with compile-time validation (chr1:1000-2000)
   * @returns New query builder filtered by genomic coordinates
   *
   * @example Compile-time region validation
   * ```typescript
   * queryBuilder.filterByRegion("chr1:1000-2000")   // ✅ Valid - proper format and chromosome
   * queryBuilder.filterByRegion("chrX:500-1500")    // ✅ Valid - sex chromosome
   * queryBuilder.filterByRegion("chr25:1000-2000")  // ❌ Compile error - invalid chromosome
   * queryBuilder.filterByRegion("invalid-format")   // ❌ Compile error - bad region format
   * ```
   */
  filterByRegion<T extends string>(
    region: T extends ValidGenomicRegion<T> ? T : never
  ): GtfQueryBuilder<TCurrentFilter> {
    // Parse region string for filtering (template literal validation ensures proper format)
    const regionStr = region as unknown as string;
    const [chr, coordinates] = regionStr.split(":");
    const coordinateParts = coordinates?.split("-") || ["0", "0"];
    const start = parseInt(coordinateParts[0] || "0", 10);
    const end = parseInt(coordinateParts[1] || "0", 10);

    const filteredSource = this.filterAsync((feature) => {
      const gtfFeature = feature as GtfFeature;
      return gtfFeature.seqname === chr && gtfFeature.start >= start && gtfFeature.end <= end;
    });

    return new GtfQueryBuilder(filteredSource);
  }

  /**
   * Internal helper for async filtering with biological context preservation
   * @private
   */
  private async *filterAsync(
    predicate: (feature: TCurrentFilter) => boolean
  ): AsyncIterable<TCurrentFilter> {
    for await (const feature of this.source) {
      if (predicate(feature)) {
        yield feature;
      }
    }
  }

  /**
   * Collect all filtered results into array
   * Terminal operation that materializes query results
   *
   * @returns Promise resolving to array of filtered features
   */
  async collect(): Promise<TCurrentFilter[]> {
    const results: TCurrentFilter[] = [];
    for await (const feature of this.source) {
      results.push(feature);
    }
    return results;
  }

  /**
   * Count filtered results without collecting them
   * Efficient terminal operation for large datasets
   *
   * @returns Promise resolving to count of matching features
   */
  async count(): Promise<number> {
    let count = 0;
    for await (const _feature of this.source) {
      count++;
    }
    return count;
  }

  /**
   * Get first matching result
   * Terminal operation for single result queries
   *
   * @returns Promise resolving to first match or undefined
   */
  async first(): Promise<TCurrentFilter | undefined> {
    for await (const feature of this.source) {
      return feature;
    }
    return undefined;
  }
}

/**
 * Factory function for creating biological GTF queries with perfect IntelliSense
 * Provides beautiful, type-safe API for genomics researchers
 *
 * @param parser GTF parser instance for data source
 * @returns Query factory with from() method for data input
 *
 * @example Beautiful biological filtering
 * ```typescript
 * const proteinGenes = await queryGtf(parser)
 *   .from(annotationData)
 *   .filterByChromosome("chr1")      // Template literal prevents chr25 errors
 *   .filterByFeature("gene")         // Teaches gene structure hierarchy
 *   .filterByGeneType("protein_coding") // Cross-database normalization
 *   .collect();                      // Perfect type inference
 * ```
 *
 * @public
 */
export function queryGtf(parser: GtfParser): {
  from: (data: string) => GtfQueryBuilder<GtfFeature>;
} {
  return {
    from: (data: string): GtfQueryBuilder<GtfFeature> => {
      const features = parser.parseString(data);
      return new GtfQueryBuilder(features);
    },
  };
}
