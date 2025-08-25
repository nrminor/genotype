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

import type { AbstractSequence, FASTXSequence, FastqSequence } from '../types';
import { SequenceError } from '../errors';
import { reverseComplement } from './core/sequence-manipulation';

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
  /** BED regions to extract */
  bedRegions?: Array<{ chromosome: string; chromStart: number; chromEnd: number }>;
  /** GTF features to extract */
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
    // Tiger Style: Validate options
    this.validateOptions(options);

    try {
      for await (const sequence of sequences) {
        // Check ID-based filtering first
        if (options.idPattern || options.idList) {
          if (!this.matchesIdFilter(sequence.id, options)) {
            continue;
          }
        }

        // Collect all regions to extract
        const extractedRegions: T[] = [];

        // Determine regions to extract
        const regions: string[] = [];
        if (options.region) {
          regions.push(options.region);
        }
        if (options.regions) {
          regions.push(...options.regions);
        }

        // Extract regions or entire sequence with flanking
        if (regions.length > 0) {
          for (const regionStr of regions) {
            const extracted = this.extractRegion(sequence, regionStr, options);
            if (extracted) {
              if (options.concatenate) {
                extractedRegions.push(extracted);
              } else {
                yield extracted;
              }
            }
          }
        } else if (options.upstream || options.downstream || options.start || options.end) {
          // Extract with start/end or flanking
          const extracted = this.extractWithCoordinates(sequence, options);
          if (extracted) {
            yield extracted;
          }
        } else if (options.bedRegions) {
          // Extract BED regions
          for (const bed of options.bedRegions) {
            if (bed.chromosome === sequence.id) {
              const extracted = this.extractBedRegion(sequence, bed, options);
              if (extracted) {
                if (options.concatenate) {
                  extractedRegions.push(extracted);
                } else {
                  yield extracted;
                }
              }
            }
          }
        } else if (options.gtfFeatures) {
          // Extract GTF features
          for (const feature of options.gtfFeatures) {
            if (
              feature.seqname === sequence.id &&
              (!options.featureType || feature.feature === options.featureType)
            ) {
              const extracted = this.extractGtfFeature(sequence, feature, options);
              if (extracted) {
                if (options.concatenate) {
                  extractedRegions.push(extracted);
                } else {
                  yield extracted;
                }
              }
            }
          }
        } else if (options.idPattern || options.idList) {
          // Just filtering by ID, return whole sequence
          yield sequence;
        } else {
          throw new Error('No extraction criteria specified');
        }

        // If concatenating, combine all extracted regions
        if (options.concatenate && extractedRegions.length > 0) {
          const concatenated = this.concatenateSequences(extractedRegions, options);
          if (concatenated) {
            yield concatenated;
          }
        }
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
    // Tiger Style: Validate input
    if (!region || region.trim() === '') {
      throw new Error('Region string cannot be empty');
    }

    const parts = region.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid region format: ${region} (expected "start:end")`);
    }

    const [startStr, endStr] = parts;
    let hasNegativeIndices = false;

    // Parse start position
    let start: number;
    if (!startStr || startStr === '') {
      start = 0;
    } else {
      start = parseInt(startStr, 10);
      if (isNaN(start)) {
        throw new Error(`Invalid start position: ${startStr}`);
      }
      if (start < 0) {
        hasNegativeIndices = true;
        start = Math.max(0, sequenceLength + start);
      } else if (oneBased && start > 0) {
        start = start - 1; // Convert to 0-based
      }
    }

    // Parse end position
    let end: number;
    if (!endStr || endStr === '' || endStr === '-1') {
      end = sequenceLength;
    } else {
      end = parseInt(endStr, 10);
      if (isNaN(end)) {
        throw new Error(`Invalid end position: ${endStr}`);
      }
      if (end < 0) {
        hasNegativeIndices = true;
        end = sequenceLength + end + 1;
      } else if (!oneBased) {
        // Already 0-based, end is exclusive (no adjustment needed)
      } else {
        // For 1-based, end is inclusive, keep as-is (becomes exclusive in 0-based)
      }
    }

    // Validate coordinates
    if (start < 0) start = 0;
    if (end > sequenceLength) end = sequenceLength;

    // Check for invalid ranges
    if (start > sequenceLength) {
      throw new Error(
        `Start position (${start + (oneBased ? 1 : 0)}) exceeds sequence length (${sequenceLength})`
      );
    }

    // Allow start > end for circular sequences (will be handled in extraction)
    // Only throw error if not potentially circular
    if (start >= end && end !== 0) {
      // Don't throw error - let the extraction method handle circular logic
      // throw new Error(`Invalid region: start (${start + (oneBased ? 1 : 0)}) >= end (${end})`);
    }

    return {
      start,
      end,
      original: region,
      hasNegativeIndices,
    };
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

    if (options.onlyFlank && !options.upstream && !options.downstream) {
      throw new Error('onlyFlank requires upstream or downstream to be specified');
    }

    if (options.region && options.bedRegions) {
      throw new Error('Cannot specify both region and bedRegions');
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
    if (options.idPattern) {
      return options.idPattern.test(id);
    }
    if (options.idList) {
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

    // Apply flanking if specified
    let start = region.start;
    let end = region.end;

    if (options.upstream) {
      if (options.circular) {
        start = start - options.upstream;
        if (start < 0) {
          start = sequence.length + start; // Wrap around
        }
      } else {
        start = Math.max(0, start - options.upstream);
      }
    }

    if (options.downstream) {
      if (options.circular) {
        end = end + options.downstream;
        if (end > sequence.length) {
          end = end % sequence.length; // Wrap around
        }
      } else {
        end = Math.min(sequence.length, end + options.downstream);
      }
    }

    if (options.onlyFlank) {
      // Extract only the flanking regions, not the core region
      const upstreamSeq = sequence.sequence.substring(
        Math.max(0, region.start - (options.upstream || 0)),
        region.start
      );
      const downstreamSeq = sequence.sequence.substring(
        region.end,
        Math.min(sequence.length, region.end + (options.downstream || 0))
      );

      const subseq = upstreamSeq + downstreamSeq;
      if (subseq.length === 0) {
        return null;
      }

      return this.createExtractedSequence(sequence, subseq, { ...region, start, end }, options);
    }

    // Handle circular sequences
    let subseq: string;
    if (options.circular && start >= end) {
      // Wrap around for circular sequences
      subseq = sequence.sequence.substring(start) + sequence.sequence.substring(0, end);
    } else {
      // Normal extraction
      subseq = sequence.sequence.substring(start, end);
    }

    if (subseq.length === 0) {
      return null;
    }

    // Handle strand if specified
    if (options.strand === '-') {
      subseq = reverseComplement(subseq);
    }

    return this.createExtractedSequence(sequence, subseq, { ...region, start, end }, options);
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
    // Update ID with coordinates if requested
    let newId = original.id;
    if (options.includeCoordinates) {
      const sep = options.coordinateSeparator || ':';
      const coordStr =
        options.oneBased !== false
          ? `${region.start + 1}${sep}${region.end}`
          : `${region.start}${sep}${region.end}`;
      newId = `${original.id}${sep}${coordStr}`;
    }

    // Handle quality scores for FASTQ
    let quality: string | undefined;
    if (this.isFastqSequence(original)) {
      // Extract corresponding quality substring
      const qualStart = region.start - (options.upstream || 0);
      const qualEnd = region.end + (options.downstream || 0);
      quality = original.quality.substring(
        Math.max(0, qualStart),
        Math.min(original.quality.length, qualEnd)
      );

      // Reverse quality if sequence was reverse complemented
      if (options.strand === '-' && options.reverseComplementMinus !== false) {
        quality = quality.split('').reverse().join('');
      }
    }

    // Create new sequence object preserving type
    const result = {
      ...original,
      id: newId,
      sequence: subseq,
      length: subseq.length,
      ...(quality !== undefined && { quality }),
    } as T;

    return result;
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
    if (options.upstream) {
      start = Math.max(0, start - options.upstream);
    }
    if (options.downstream) {
      end = Math.min(sequence.length, end + options.downstream);
    }

    // Handle circular sequences
    if (options.circular && start > end) {
      const subseq = sequence.sequence.substring(start) + sequence.sequence.substring(0, end);
      return this.createExtractedSequence(
        sequence,
        subseq,
        { start, end, original: `${start}:${end}`, hasNegativeIndices: false },
        options
      );
    }

    const subseq = sequence.sequence.substring(start, end);

    // Apply strand operations
    let finalSeq = subseq;
    if (options.strand === '-') {
      finalSeq = reverseComplement(subseq);
    }

    return this.createExtractedSequence(
      sequence,
      finalSeq,
      { start, end, original: `${start}:${end}`, hasNegativeIndices: false },
      options
    );
  }

  /**
   * Extract BED region
   * @private
   */
  private extractBedRegion<T extends AbstractSequence>(
    sequence: T,
    bed: { chromosome: string; chromStart: number; chromEnd: number },
    options: SubseqOptions
  ): T | null {
    // BED format is 0-based, half-open
    const start = bed.chromStart;
    const end = bed.chromEnd;

    const subseq = sequence.sequence.substring(start, end);

    return this.createExtractedSequence(
      sequence,
      subseq,
      { start, end, original: `${bed.chromStart}:${bed.chromEnd}`, hasNegativeIndices: false },
      options
    );
  }

  /**
   * Extract GTF feature
   * @private
   */
  private extractGtfFeature<T extends AbstractSequence>(
    sequence: T,
    feature: { seqname: string; start: number; end: number; feature: string },
    options: SubseqOptions
  ): T | null {
    // GTF format is 1-based, inclusive
    const start = feature.start - 1;
    const end = feature.end;

    const subseq = sequence.sequence.substring(start, end);

    return this.createExtractedSequence(
      sequence,
      subseq,
      { start, end, original: `${feature.start}:${feature.end}`, hasNegativeIndices: false },
      options
    );
  }

  /**
   * Concatenate multiple extracted sequences into one
   * @private
   */
  private concatenateSequences<T extends AbstractSequence>(
    sequences: T[],
    options: SubseqOptions
  ): T | null {
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
  const parsed = extractor.parseRegion(region, sequence.length, options.oneBased !== false);

  // Create async iterable from single sequence
  async function* singleSequence(): AsyncIterable<T> {
    yield sequence;
  }

  // Extract and return first result
  const iter = extractor.extract(singleSequence(), { ...options, region });
  const iterator = iter[Symbol.asyncIterator]();
  const result = await iterator.next();

  // Return the extracted value or null
  return result.done ? null : result.value;
}
