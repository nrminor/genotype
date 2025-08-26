/**
 * Subsequence extraction operations for SeqOps
 *
 * This module provides subsequence extraction functionality that mirrors
 * the `seqkit subseq` command, offering flexible region extraction from
 * sequences using various coordinate specifications.
 *
 * Key features:
 * - Region extraction by coordinates (1:100, 50:-1, etc.)
 * - BED/GTF file support for batch extraction
 * - Flanking sequence extraction
 * - Strand-aware extraction with reverse complement
 * - Support for both 0-based and 1-based coordinate systems
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import type { AbstractSequence, FastqSequence, BedInterval } from '../types';
import { SequenceError } from '../errors';
import { reverseComplement } from './core/sequence-manipulation';
import { BedParser } from '../formats/bed';
import { GtfParser, type GtfFeature } from '../formats/gtf';

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Configuration options for subsequence extraction
 *
 * Provides flexible ways to specify regions to extract, including
 * simple coordinates, region files, and flanking sequences.
 */
export interface SubseqOptions {
  // Region specification
  /** Single region string like "1:100", "50:-1", "-100:-1" */
  region?: string;
  /** Multiple region strings */
  regions?: string[];
  /** Start position (alternative to region) */
  start?: number;
  /** End position (alternative to region) */
  end?: number;

  // File-based regions (in-memory for now)
  /** BED file path to load regions from */
  bedFile?: string;
  /** BED regions to extract (alternative to bedFile) */
  bedRegions?: Array<{ chromosome: string; chromStart: number; chromEnd: number }>;
  /** GTF file path to load features from */
  gtfFile?: string;
  /** GTF features to extract (alternative to gtfFile) */
  gtfFeatures?: Array<{ seqname: string; start: number; end: number; feature: string }>;
  /** Feature type to filter (for GTF) */
  featureType?: string;

  // ID-based filtering
  /** Pattern to match sequence IDs */
  idPattern?: RegExp;
  /** List of sequence IDs to extract */
  idList?: string[];

  // Flanking sequences
  /** Number of bases to include upstream of region */
  upstream?: number;
  /** Number of bases to include downstream of region */
  downstream?: number;
  /** Extract only flanking sequences, not the region itself */
  onlyFlank?: boolean;

  // Coordinate system
  /** Use 1-based coordinates (default: true for biological convention) */
  oneBased?: boolean;

  // Strand handling
  /** Strand orientation for extraction */
  strand?: '+' | '-' | 'both';
  /** Reverse complement if on minus strand */
  reverseComplementMinus?: boolean;

  // Circular sequences
  /** Treat sequences as circular */
  circular?: boolean;

  // Output options
  /** Include region coordinates in sequence ID */
  includeCoordinates?: boolean;
  /** Separator for coordinate suffix in ID */
  coordinateSeparator?: string;
  /** Concatenate multiple regions */
  concatenate?: boolean;
}

/**
 * Parsed region specification
 *
 * Internal representation of a region after parsing from string format.
 */
export interface ParsedRegion {
  /** Start position (0-based, inclusive) */
  start: number;
  /** End position (0-based, exclusive) */
  end: number;
  /** Original region string for reference */
  original: string;
  /** Whether region uses negative indices */
  hasNegativeIndices: boolean;
}

/**
 * Extracted subsequence with metadata
 *
 * Contains the extracted sequence and information about its origin.
 */
export interface ExtractedSubsequence<T extends AbstractSequence> extends AbstractSequence {
  /** Original sequence this was extracted from */
  sourceId: string;
  /** Region that was extracted */
  region: ParsedRegion;
  /** Strand if reverse complemented */
  strand?: '+' | '-';
  /** Original sequence type information */
  _originalType?: T;
}

// =============================================================================
// MAIN EXTRACTOR CLASS
// =============================================================================

/**
 * High-performance subsequence extractor with flexible region specification
 *
 * Extracts subsequences from biological sequences using various coordinate
 * systems and region specifications. Supports both simple coordinate ranges
 * and complex region files.
 *
 * @example
 * ```typescript
 * // Extract specific region
 * const extractor = new SubseqExtractor();
 * const subseqs = extractor.extract(sequences, {
 *   region: "100:500",
 *   includeCoordinates: true
 * });
 *
 * // Extract with flanking sequences
 * const withFlanks = extractor.extract(sequences, {
 *   region: "1000:2000",
 *   upstream: 100,
 *   downstream: 100
 * });
 *
 * // Extract multiple regions
 * const multiRegions = extractor.extract(sequences, {
 *   regions: ["1:100", "200:300", "-100:-1"]
 * });
 * ```
 */
export class SubseqExtractor {
  /**
   * Extract subsequences from input sequences
   *
   * Processes sequences and extracts specified regions, handling
   * various coordinate formats and options.
   *
   * @param sequences - Input sequences to extract from
   * @param options - Extraction configuration
   * @yields Extracted subsequences
   *
   * @example
   * ```typescript
   * for await (const subseq of extractor.extract(sequences, options)) {
   *   console.log(`Extracted ${subseq.length} bases from ${subseq.sourceId}`);
   * }
   * ```
   */
  async *extract<T extends AbstractSequence>(
    sequences: AsyncIterable<T>,
    options: SubseqOptions
  ): AsyncIterable<T> {
    this.validateOptions(options);

    try {
      for await (const sequence of sequences) {
        yield* this.processSequence(sequence, options);
      }
    } catch (error) {
      throw new SequenceError(
        `Subsequence extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        '<subseq>',
        undefined,
        'Check region specifications and sequence lengths'
      );
    }
  }

  /**
   * Process a single sequence with extraction options
   * @private
   */
  private async *processSequence<T extends AbstractSequence>(
    sequence: T,
    options: SubseqOptions
  ): AsyncIterable<T> {
    // Early return for sequences that don't match ID filters
    if (!this.shouldProcessSequence(sequence.id, options)) {
      return;
    }

    // Handle ID-only filtering (return whole sequence)
    if (this.isIdOnlyFiltering(options)) {
      yield sequence;
      return;
    }

    // Process regions and handle results
    yield* this.processSequenceRegions(sequence, options);
  }

  /**
   * Check if sequence should be processed based on ID filters
   * @private
   */
  private shouldProcessSequence(sequenceId: string, options: SubseqOptions): boolean {
    if (options.idPattern !== undefined || options.idList !== undefined) {
      return this.matchesIdFilter(sequenceId, options);
    }
    return true;
  }

  /**
   * Check if this is ID-only filtering (no region extraction)
   * @private
   */
  private isIdOnlyFiltering(options: SubseqOptions): boolean {
    const hasIdFilter = options.idPattern !== undefined || options.idList !== undefined;
    const hasRegions = this.hasRegionSpecifications(options);
    return hasIdFilter && !hasRegions;
  }

  /**
   * Check if options contain any region specifications
   * @private
   */
  private hasRegionSpecifications(options: SubseqOptions): boolean {
    return (
      options.region !== undefined ||
      options.regions !== undefined ||
      options.start !== undefined ||
      options.end !== undefined ||
      options.upstream !== undefined ||
      options.downstream !== undefined ||
      options.bedRegions !== undefined ||
      options.gtfFeatures !== undefined ||
      options.bedFile !== undefined ||
      options.gtfFile !== undefined
    );
  }

  /**
   * Process sequence regions with concatenation support
   * @private
   */
  private async *processSequenceRegions<T extends AbstractSequence>(
    sequence: T,
    options: SubseqOptions
  ): AsyncIterable<T> {
    if (!this.hasRegionSpecifications(options)) {
      throw new Error('No extraction criteria specified');
    }

    const extractedRegions: T[] = [];

    // Process different extraction types
    yield* this.extractBySpecifications(sequence, options, extractedRegions);

    // Handle concatenation if requested
    if (options.concatenate === true && extractedRegions.length > 0) {
      const concatenated = this.concatenateSequences(extractedRegions);
      if (concatenated !== null) {
        yield concatenated;
      }
    }
  }

  /**
   * Extract sequences by various specification types
   * @private
   */
  private async *extractBySpecifications<T extends AbstractSequence>(
    sequence: T,
    options: SubseqOptions,
    extractedRegions: T[]
  ): AsyncIterable<T> {
    // Extract by region strings
    if (this.hasRegionStrings(options)) {
      yield* this.extractByRegionStrings(sequence, options, extractedRegions);
      return;
    }

    // Extract by coordinates with flanking
    if (this.hasCoordinateSpec(options)) {
      const extracted = this.extractWithCoordinates(sequence, options);
      if (extracted !== null) {
        yield extracted;
      }
      return;
    }

    // Extract by BED file or regions
    if (options.bedFile !== undefined || options.bedRegions !== undefined) {
      yield* this.extractByBedData(sequence, options, extractedRegions);
      return;
    }

    // Extract by GTF file or features
    if (options.gtfFile !== undefined || options.gtfFeatures !== undefined) {
      yield* this.extractByGtfData(sequence, options, extractedRegions);
      return;
    }

    throw new Error('No extraction criteria specified');
  }

  /**
   * Check if options have region strings
   * @private
   */
  private hasRegionStrings(options: SubseqOptions): boolean {
    return options.region !== undefined || options.regions !== undefined;
  }

  /**
   * Check if options have coordinate specifications
   * @private
   */
  private hasCoordinateSpec(options: SubseqOptions): boolean {
    return (
      options.start !== undefined ||
      options.end !== undefined ||
      options.upstream !== undefined ||
      options.downstream !== undefined
    );
  }

  /**
   * Parse region string into coordinates
   *
   * Supports various formats:
   * - "100:200" - from position 100 to 200
   * - "100:-1" - from position 100 to end
   * - "-100:-1" - last 100 bases
   * - ":500" - from start to position 500
   *
   * @param region - Region string to parse
   * @param sequenceLength - Length of the sequence for negative indices
   * @param oneBased - Whether to use 1-based coordinates
   * @returns Parsed region with 0-based coordinates
   *
   * @example
   * ```typescript
   * const region = extractor.parseRegion("100:200", 1000, true);
   * // Returns: { start: 99, end: 200, original: "100:200", hasNegativeIndices: false }
   * ```
   *
   * @optimize ZIG_CANDIDATE - STRING PARSING WITH BOUNDS CHECKING
   * - Lots of string operations and integer parsing
   * - Boundary checking and coordinate conversion
   * - Could be optimized with pre-compiled regex or state machine
   * - Expected speedup: 5-10x
   */
  parseRegion(region: string, sequenceLength: number, oneBased: boolean = true): ParsedRegion {
    // Tiger Style: Validate input early
    this.validateRegionString(region);

    const parts = region.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid region format: ${region} (expected "start:end")`);
    }

    const [startStr, endStr] = parts;
    this.validateRegionParts(startStr, endStr, region);

    // After validation, we know these are defined
    const validStartStr = startStr!;
    const validEndStr = endStr!;

    let hasNegativeIndices = false;
    const start = this.parseStartPosition(
      validStartStr,
      sequenceLength,
      oneBased,
      hasNegativeIndices
    );
    const end = this.parseEndPosition(validEndStr, sequenceLength, oneBased, hasNegativeIndices);

    hasNegativeIndices = start.hasNegative || end.hasNegative;

    const finalStart = this.clampCoordinate(start.value, 0, sequenceLength);
    const finalEnd = this.clampCoordinate(end.value, 0, sequenceLength);

    this.validateFinalCoordinates(finalStart, finalEnd, sequenceLength, oneBased);

    return {
      start: finalStart,
      end: finalEnd,
      original: region,
      hasNegativeIndices,
    };
  }

  /**
   * Validate region string format
   * @private
   */
  private validateRegionString(region: string): void {
    if (region.length === 0 || region.trim() === '') {
      throw new Error('Region string cannot be empty');
    }
  }

  /**
   * Validate region parts after splitting
   * @private
   */
  private validateRegionParts(
    startStr: string | undefined,
    endStr: string | undefined,
    region: string
  ): void {
    if (startStr === undefined || endStr === undefined) {
      throw new Error(`Invalid region format: ${region} (missing start or end)`);
    }
  }

  /**
   * Parse start position with negative index handling
   * @private
   */
  private parseStartPosition(
    startStr: string,
    sequenceLength: number,
    oneBased: boolean,
    hasNegativeIndices: boolean
  ): { value: number; hasNegative: boolean } {
    if (startStr.length === 0 || startStr === '') {
      return { value: 0, hasNegative: false };
    }

    const parsed = parseInt(startStr, 10);
    if (isNaN(parsed)) {
      throw new Error(`Invalid start position: ${startStr}`);
    }

    if (parsed < 0) {
      return {
        value: Math.max(0, sequenceLength + parsed),
        hasNegative: true,
      };
    }

    if (oneBased && parsed > 0) {
      return { value: parsed - 1, hasNegative: false }; // Convert to 0-based
    }

    return { value: parsed, hasNegative: false };
  }

  /**
   * Parse end position with negative index handling
   * @private
   */
  private parseEndPosition(
    endStr: string,
    sequenceLength: number,
    oneBased: boolean,
    hasNegativeIndices: boolean
  ): { value: number; hasNegative: boolean } {
    if (endStr.length === 0 || endStr === '' || endStr === '-1') {
      return { value: sequenceLength, hasNegative: false };
    }

    const parsed = parseInt(endStr, 10);
    if (isNaN(parsed)) {
      throw new Error(`Invalid end position: ${endStr}`);
    }

    if (parsed < 0) {
      return {
        value: sequenceLength + parsed + 1,
        hasNegative: true,
      };
    }

    // For 1-based, end is inclusive, keep as-is (becomes exclusive in 0-based)
    // For 0-based, end is already exclusive
    return { value: parsed, hasNegative: false };
  }

  /**
   * Clamp coordinate to valid range
   * @private
   */
  private clampCoordinate(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  /**
   * Validate final coordinates
   * @private
   */
  private validateFinalCoordinates(
    start: number,
    end: number,
    sequenceLength: number,
    oneBased: boolean
  ): void {
    // Check if start position is beyond sequence length
    const displayStart = oneBased ? start + 1 : start;
    if (displayStart > sequenceLength) {
      throw new Error(
        `Start position (${displayStart}) exceeds sequence length (${sequenceLength})`
      );
    }
    // Note: Allow start >= end for circular sequences (handled in extraction)
  }

  // =============================================================================
  // PRIVATE IMPLEMENTATION
  // =============================================================================

  /**
   * Validate extraction options
   * @private
   */
  private validateOptions(options: SubseqOptions): void {
    if (options.upstream !== undefined && options.upstream < 0) {
      throw new Error('Upstream value must be non-negative');
    }

    if (options.downstream !== undefined && options.downstream < 0) {
      throw new Error('Downstream value must be non-negative');
    }

    if (
      options.onlyFlank === true &&
      options.upstream === undefined &&
      options.downstream === undefined
    ) {
      throw new Error('onlyFlank requires upstream or downstream to be specified');
    }

    // Validate mutually exclusive region specifications
    const regionSpecs = [
      options.region !== undefined,
      options.bedRegions !== undefined,
      options.bedFile !== undefined,
      options.gtfFeatures !== undefined,
      options.gtfFile !== undefined,
    ].filter(Boolean).length;

    if (regionSpecs > 1) {
      throw new Error(
        'Cannot specify multiple region sources (region, bedRegions, bedFile, gtfFeatures, gtfFile)'
      );
    }

    if (options.start !== undefined && options.end !== undefined && options.start > options.end) {
      throw new Error('Start position must be less than end position');
    }
  }

  /**
   * Check if sequence ID matches filter criteria
   * @private
   */
  private matchesIdFilter(id: string, options: SubseqOptions): boolean {
    if (options.idPattern !== undefined) {
      return options.idPattern.test(id);
    }
    if (options.idList !== undefined) {
      return options.idList.includes(id);
    }
    return true;
  }

  /**
   * Validate region format without parsing coordinates
   * @private
   */
  private validateRegionFormat(region: string): void {
    if (!region.includes(':')) {
      throw new Error(`Invalid region format: ${region} (missing ':')`);
    }
  }

  /**
   * Extract a specific region from a sequence
   * @private
   *
   * @optimize ZIG_CANDIDATE - SUBSTRING OPERATIONS
   * - Multiple string allocations for substring extraction
   * - Memory copy operations that could be optimized
   * - Boundary checking overhead
   * - Expected speedup: 10-15x
   */
  private extractRegion<T extends AbstractSequence>(
    sequence: T,
    regionStr: string | ParsedRegion,
    options: SubseqOptions
  ): T | null {
    // Parse region if it's a string
    const region =
      typeof regionStr === 'string'
        ? this.parseRegion(regionStr, sequence.length, options.oneBased !== false)
        : regionStr;

    // Apply flanking adjustments
    const coords = this.applyFlankingAdjustments(region, sequence.length, options);

    // Handle special extraction modes
    if (options.onlyFlank === true) {
      return this.extractOnlyFlanks(sequence, region, options);
    }

    // Extract the subsequence
    const subseq = this.extractSubsequence(sequence, coords, options);
    if (subseq.length === 0) {
      return null;
    }

    return this.createExtractedSequence(sequence, subseq, coords, options);
  }

  /**
   * Apply flanking adjustments to region coordinates
   * @private
   */
  private applyFlankingAdjustments(
    region: ParsedRegion,
    sequenceLength: number,
    options: SubseqOptions
  ): ParsedRegion {
    let start = region.start;
    let end = region.end;

    if (options.upstream !== undefined) {
      if (options.circular === true) {
        start = start - options.upstream;
        if (start < 0) {
          start = sequenceLength + start; // Wrap around
        }
      } else {
        start = Math.max(0, start - options.upstream);
      }
    }

    if (options.downstream !== undefined) {
      if (options.circular === true) {
        end = end + options.downstream;
        if (end > sequenceLength) {
          end = end % sequenceLength; // Wrap around
        }
      } else {
        end = Math.min(sequenceLength, end + options.downstream);
      }
    }

    return { ...region, start, end };
  }

  /**
   * Extract only flanking regions (not the core region)
   * @private
   */
  private extractOnlyFlanks<T extends AbstractSequence>(
    sequence: T,
    region: ParsedRegion,
    options: SubseqOptions
  ): T | null {
    const upstreamSeq = sequence.sequence.substring(
      Math.max(0, region.start - (options.upstream ?? 0)),
      region.start
    );
    const downstreamSeq = sequence.sequence.substring(
      region.end,
      Math.min(sequence.length, region.end + (options.downstream ?? 0))
    );

    const subseq = upstreamSeq + downstreamSeq;
    if (subseq.length === 0) {
      return null;
    }

    const coords = this.applyFlankingAdjustments(region, sequence.length, options);
    return this.createExtractedSequence(sequence, subseq, coords, options);
  }

  /**
   * Extract subsequence with circular handling and strand processing
   * @private
   */
  private extractSubsequence<T extends AbstractSequence>(
    sequence: T,
    coords: ParsedRegion,
    options: SubseqOptions
  ): string {
    // Handle circular sequences
    let subseq: string;
    if (options.circular === true && coords.start >= coords.end) {
      // Wrap around for circular sequences
      subseq =
        sequence.sequence.substring(coords.start) + sequence.sequence.substring(0, coords.end);
    } else {
      // Normal extraction
      subseq = sequence.sequence.substring(coords.start, coords.end);
    }

    // Handle strand if specified
    if (options.strand === '-') {
      subseq = reverseComplement(subseq);
    }

    return subseq;
  }

  /**
   * Extract with only flanking options (no specific region)
   * @private
   */
  private extractWithFlanking<T extends AbstractSequence>(
    sequence: T,
    options: SubseqOptions
  ): T | null {
    // Use entire sequence as the "region"
    const region: ParsedRegion = {
      start: 0,
      end: sequence.length,
      original: `1:${sequence.length}`,
      hasNegativeIndices: false,
    };

    return this.extractRegion(sequence, region, options);
  }

  /**
   * Create an extracted sequence with updated metadata
   * @private
   */
  private createExtractedSequence<T extends AbstractSequence>(
    original: T,
    subseq: string,
    region: ParsedRegion,
    options: SubseqOptions
  ): T {
    const newId = this.buildSequenceId(original.id, region, options);
    const quality = this.extractQualityScores(original, region, options);

    return {
      ...original,
      id: newId,
      sequence: subseq,
      length: subseq.length,
      ...(quality !== undefined && { quality }),
    } as T;
  }

  /**
   * Build sequence ID with optional coordinate suffix
   * @private
   */
  private buildSequenceId(
    originalId: string,
    region: ParsedRegion,
    options: SubseqOptions
  ): string {
    if (options.includeCoordinates !== true) {
      return originalId;
    }

    const sep = options.coordinateSeparator ?? ':';
    const coordStr =
      options.oneBased !== false
        ? `${region.start + 1}${sep}${region.end}`
        : `${region.start}${sep}${region.end}`;

    return `${originalId}${sep}${coordStr}`;
  }

  /**
   * Extract quality scores for FASTQ sequences
   * @private
   */
  private extractQualityScores<T extends AbstractSequence>(
    original: T,
    region: ParsedRegion,
    options: SubseqOptions
  ): string | undefined {
    if (!this.isFastqSequence(original)) {
      return undefined;
    }

    const qualStart = region.start - (options.upstream ?? 0);
    const qualEnd = region.end + (options.downstream ?? 0);
    let quality = original.quality.substring(
      Math.max(0, qualStart),
      Math.min(original.quality.length, qualEnd)
    );

    // Reverse quality if sequence was reverse complemented
    if (options.strand === '-' && options.reverseComplementMinus !== false) {
      quality = quality.split('').reverse().join('');
    }

    return quality;
  }

  /**
   * Type guard to check if sequence is FASTQ
   * @private
   */
  private isFastqSequence(sequence: AbstractSequence): sequence is FastqSequence {
    return 'quality' in sequence && typeof (sequence as FastqSequence).quality === 'string';
  }

  /**
   * Extract with start/end coordinates
   * @private
   */
  private extractWithCoordinates<T extends AbstractSequence>(
    sequence: T,
    options: SubseqOptions
  ): T | null {
    let start = options.start ?? 0;
    let end = options.end ?? sequence.length;

    // Convert to 0-based if needed
    if (options.oneBased !== false && start > 0) {
      start = start - 1;
    }

    // Apply upstream/downstream
    if (options.upstream !== undefined) {
      start = Math.max(0, start - options.upstream);
    }
    if (options.downstream !== undefined) {
      end = Math.min(sequence.length, end + options.downstream);
    }

    const region: ParsedRegion = {
      start,
      end,
      original: `${start}:${end}`,
      hasNegativeIndices: false,
    };

    const subseq = this.extractSubsequence(sequence, region, options);

    return this.createExtractedSequence(sequence, subseq, region, options);
  }

  /**
   * Extract BED interval (from parsed BedInterval)
   * @private
   */
  private extractBedInterval<T extends AbstractSequence>(
    sequence: T,
    interval: BedInterval,
    options: SubseqOptions
  ): T | null {
    const region: ParsedRegion = {
      start: interval.start,
      end: interval.end,
      original: `${interval.start}:${interval.end}`,
      hasNegativeIndices: false,
    };

    return this.extractRegion(sequence, region, options);
  }

  /**
   * Extract BED region (from simple region object)
   * @private
   */
  private extractBedRegion<T extends AbstractSequence>(
    sequence: T,
    bed: { chromosome: string; chromStart: number; chromEnd: number },
    options: SubseqOptions
  ): T | null {
    const region: ParsedRegion = {
      start: bed.chromStart,
      end: bed.chromEnd,
      original: `${bed.chromStart}:${bed.chromEnd}`,
      hasNegativeIndices: false,
    };

    return this.extractRegion(sequence, region, options);
  }

  /**
   * Extract GTF feature (from parsed GtfFeature)
   * @private
   */
  private extractGtfFeatureData<T extends AbstractSequence>(
    sequence: T,
    feature: GtfFeature,
    options: SubseqOptions
  ): T | null {
    // GTF format is 1-based, inclusive
    const region: ParsedRegion = {
      start: feature.start - 1, // Convert to 0-based
      end: feature.end,
      original: `${feature.start}:${feature.end}`,
      hasNegativeIndices: false,
    };

    // Handle strand if specified
    const extractedRegion = this.extractRegion(sequence, region, options);

    // Apply strand-specific reverse complement if needed
    if (
      extractedRegion !== null &&
      feature.strand === '-' &&
      options.reverseComplementMinus !== false
    ) {
      const rcSeq = reverseComplement(extractedRegion.sequence);
      return {
        ...extractedRegion,
        sequence: rcSeq,
        length: rcSeq.length,
      };
    }

    return extractedRegion;
  }

  /**
   * Extract GTF feature (from simple feature object)
   * @private
   */
  private extractGtfFeature<T extends AbstractSequence>(
    sequence: T,
    feature: { seqname: string; start: number; end: number; feature: string },
    options: SubseqOptions
  ): T | null {
    // GTF format is 1-based, inclusive
    const region: ParsedRegion = {
      start: feature.start - 1, // Convert to 0-based
      end: feature.end,
      original: `${feature.start}:${feature.end}`,
      hasNegativeIndices: false,
    };

    return this.extractRegion(sequence, region, options);
  }

  /**
   * Extract sequences by region strings
   * @private
   */
  private async *extractByRegionStrings<T extends AbstractSequence>(
    sequence: T,
    options: SubseqOptions,
    extractedRegions: T[]
  ): AsyncIterable<T> {
    const regions: string[] = [];
    if (options.region !== undefined) {
      regions.push(options.region);
    }
    if (options.regions !== undefined) {
      regions.push(...options.regions);
    }

    for (const regionStr of regions) {
      const extracted = this.extractRegion(sequence, regionStr, options);
      if (extracted !== null) {
        if (options.concatenate === true) {
          extractedRegions.push(extracted);
        } else {
          yield extracted;
        }
      }
    }
  }

  /**
   * Extract sequences by BED file or regions
   * @private
   */
  private async *extractByBedData<T extends AbstractSequence>(
    sequence: T,
    options: SubseqOptions,
    extractedRegions: T[]
  ): AsyncIterable<T> {
    // Load regions from file if specified
    if (options.bedFile !== undefined) {
      yield* this.extractByBedFile(sequence, options, extractedRegions);
      return;
    }

    // Use provided regions
    if (options.bedRegions !== undefined) {
      yield* this.extractByBedRegions(sequence, options, extractedRegions);
      return;
    }
  }

  /**
   * Extract sequences by BED file
   * @private
   */
  private async *extractByBedFile<T extends AbstractSequence>(
    sequence: T,
    options: SubseqOptions,
    extractedRegions: T[]
  ): AsyncIterable<T> {
    if (options.bedFile === undefined) return;

    const parser = new BedParser({ skipValidation: false });

    try {
      for await (const interval of parser.parseFile(options.bedFile)) {
        if (interval.chromosome === sequence.id) {
          const extracted = this.extractBedInterval(sequence, interval, options);
          if (extracted !== null) {
            if (options.concatenate === true) {
              extractedRegions.push(extracted);
            } else {
              yield extracted;
            }
          }
        }
      }
    } catch (error) {
      throw new SequenceError(
        `Failed to parse BED file: ${error instanceof Error ? error.message : String(error)}`,
        options.bedFile,
        undefined,
        'Check BED file format and accessibility'
      );
    }
  }

  /**
   * Extract sequences by BED regions
   * @private
   */
  private async *extractByBedRegions<T extends AbstractSequence>(
    sequence: T,
    options: SubseqOptions,
    extractedRegions: T[]
  ): AsyncIterable<T> {
    if (options.bedRegions === undefined) return;

    for (const bed of options.bedRegions) {
      if (bed.chromosome === sequence.id) {
        const extracted = this.extractBedRegion(sequence, bed, options);
        if (extracted !== null) {
          if (options.concatenate === true) {
            extractedRegions.push(extracted);
          } else {
            yield extracted;
          }
        }
      }
    }
  }

  /**
   * Extract sequences by GTF file or features
   * @private
   */
  private async *extractByGtfData<T extends AbstractSequence>(
    sequence: T,
    options: SubseqOptions,
    extractedRegions: T[]
  ): AsyncIterable<T> {
    // Load features from file if specified
    if (options.gtfFile !== undefined) {
      yield* this.extractByGtfFile(sequence, options, extractedRegions);
      return;
    }

    // Use provided features
    if (options.gtfFeatures !== undefined) {
      yield* this.extractByGtfFeatures(sequence, options, extractedRegions);
      return;
    }
  }

  /**
   * Extract sequences by GTF file
   * @private
   */
  private async *extractByGtfFile<T extends AbstractSequence>(
    sequence: T,
    options: SubseqOptions,
    extractedRegions: T[]
  ): AsyncIterable<T> {
    if (options.gtfFile === undefined) return;

    const parserOptions: any = {
      skipValidation: false,
    };
    if (options.featureType !== undefined) {
      parserOptions.includeFeatures = [options.featureType];
    }
    const parser = new GtfParser(parserOptions);

    try {
      for await (const feature of parser.parseFile(options.gtfFile)) {
        if (feature.seqname === sequence.id) {
          const extracted = this.extractGtfFeatureData(sequence, feature, options);
          if (extracted !== null) {
            if (options.concatenate === true) {
              extractedRegions.push(extracted);
            } else {
              yield extracted;
            }
          }
        }
      }
    } catch (error) {
      throw new SequenceError(
        `Failed to parse GTF file: ${error instanceof Error ? error.message : String(error)}`,
        options.gtfFile,
        undefined,
        'Check GTF file format and accessibility'
      );
    }
  }

  /**
   * Extract sequences by GTF features
   * @private
   */
  private async *extractByGtfFeatures<T extends AbstractSequence>(
    sequence: T,
    options: SubseqOptions,
    extractedRegions: T[]
  ): AsyncIterable<T> {
    if (options.gtfFeatures === undefined) return;

    for (const feature of options.gtfFeatures) {
      if (
        feature.seqname === sequence.id &&
        (options.featureType === undefined || feature.feature === options.featureType)
      ) {
        const extracted = this.extractGtfFeature(sequence, feature, options);
        if (extracted !== null) {
          if (options.concatenate === true) {
            extractedRegions.push(extracted);
          } else {
            yield extracted;
          }
        }
      }
    }
  }

  /**
   * Concatenate multiple extracted sequences into one
   * @private
   */
  private concatenateSequences<T extends AbstractSequence>(sequences: T[]): T | null {
    if (sequences.length === 0) {
      return null;
    }

    // Concatenate all sequences
    const concatenatedSeq = sequences.map((s) => s.sequence).join('');

    // For quality scores (FASTQ), concatenate them too
    let concatenatedQuality: string | undefined;
    if (this.isFastqSequence(sequences[0]!)) {
      const qualities = sequences.map((s) => {
        if (this.isFastqSequence(s)) {
          return s.quality;
        }
        return '';
      });
      concatenatedQuality = qualities.join('');
    }

    // Use the first sequence as the template
    const first = sequences[0]!;
    const result = {
      ...first,
      sequence: concatenatedSeq,
      length: concatenatedSeq.length,
      ...(concatenatedQuality !== undefined && { quality: concatenatedQuality }),
    } as T;

    return result;
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Create a subsequence extractor with convenient defaults
 *
 * @param options - Default options for all extractions
 * @returns Configured SubseqExtractor instance
 *
 * @example
 * ```typescript
 * const extractor = createSubseqExtractor({
 *   oneBased: true,
 *   includeCoordinates: true
 * });
 * ```
 */
export function createSubseqExtractor(): SubseqExtractor {
  return new SubseqExtractor();
}

/**
 * Extract subsequences from sequences directly
 *
 * @param sequences - Input sequences
 * @param options - Extraction options
 * @returns Extracted subsequences
 *
 * @example
 * ```typescript
 * const subseqs = extractSubsequences(sequences, {
 *   region: "100:500",
 *   upstream: 50,
 *   downstream: 50
 * });
 *
 * for await (const subseq of subseqs) {
 *   console.log(subseq.id, subseq.length);
 * }
 * ```
 */
export async function* extractSubsequences<T extends AbstractSequence>(
  sequences: AsyncIterable<T>,
  options: SubseqOptions
): AsyncIterable<T> {
  const extractor = new SubseqExtractor();
  yield* extractor.extract(sequences, options);
}

/**
 * Extract a single region from a single sequence
 *
 * @param sequence - Input sequence
 * @param region - Region to extract
 * @param options - Additional options
 * @returns Extracted subsequence or null if invalid
 *
 * @example
 * ```typescript
 * const subseq = await extractSingleRegion(sequence, "100:200", {
 *   includeCoordinates: true
 * });
 * ```
 */
export async function extractSingleRegion<T extends AbstractSequence>(
  sequence: T,
  region: string,
  options: SubseqOptions = {}
): Promise<T | null> {
  const extractor = new SubseqExtractor();

  // Create async iterable from single sequence
  async function* singleSequence(): AsyncIterable<T> {
    yield sequence;
  }

  // Extract and return first result
  const iter = extractor.extract(singleSequence(), { ...options, region });
  const iterator = iter[Symbol.asyncIterator]();
  const result = await iterator.next();

  // Return the extracted value or null
  return result.done === true ? null : result.value;
}
