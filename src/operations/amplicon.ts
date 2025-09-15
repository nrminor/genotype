/**
 * Amplicon extraction operation for PCR primer-based sequence analysis
 *
 * This module provides comprehensive amplicon detection and extraction capabilities
 * with advanced type safety, IUPAC degenerate base support, and biological validation.
 * Supports both validated PrimerSequence types and runtime string validation.
 *
 * @module amplicon
 * @since v0.1.0
 */

import { type } from "arktype";
import { ValidationError } from "../errors";
import type { AbstractSequence, PrimerSequence } from "../types";
import { isPrimerSequence } from "./core/alphabet";
import { parseEndPosition, parseStartPosition, validateRegionString } from "./core/coordinates";
import { findPatternWithMismatches, type PatternMatch } from "./core/pattern-matching";
import { reverseComplement } from "./core/sequence-manipulation";
import { IUPAC_DNA } from "./core/sequence-validation";
import type { AmpliconOptions, Processor } from "./types";

// =============================================================================
// ARKTYPE SCHEMA WITH TYPE SAFETY INTEGRATION
// =============================================================================

/**
 * ArkType schema for amplicon options with primer validation and branding
 * Ensures runtime validation matches template literal constraints
 */
const AmpliconOptionsSchema = type({
  forwardPrimer: "string>=10",
  "reversePrimer?": "string>=10",
  "maxMismatches?": "number>=0",
  "region?": "string>0",
  "flanking?": "boolean",
  "canonical?": "boolean",
  "searchWindow?": {
    "forward?": "number>0",
    "reverse?": "number>0",
  },
  "onlyPositiveStrand?": "boolean",
  "outputBed?": "boolean",
  "outputMismatches?": "boolean",
}).pipe((options) => {
  // Validate and brand primers with consistent biological constraints
  const forwardPrimer = validateAndBrandPrimer(options.forwardPrimer);
  const reversePrimer = options.reversePrimer
    ? validateAndBrandPrimer(options.reversePrimer)
    : undefined;

  // Validate region format using existing coordinate infrastructure
  if (options.region !== undefined) {
    try {
      validateRegionString(options.region);
    } catch {
      throw new Error(
        `Invalid region format: "${options.region}". Examples: "1:100", "-50:50", "1:-1"`
      );
    }
  }

  // Biological constraint validation
  if (options.maxMismatches && options.maxMismatches > Math.floor(forwardPrimer.length / 2)) {
    throw new Error(
      `Too many mismatches (${options.maxMismatches}) for primer length (${forwardPrimer.length}bp) - would compromise specificity`
    );
  }

  // Windowed search validation constraints
  if (options.searchWindow) {
    if (options.searchWindow.forward && options.searchWindow.forward < forwardPrimer.length) {
      throw new Error(
        `Forward search window (${options.searchWindow.forward}bp) smaller than primer (${forwardPrimer.length}bp)`
      );
    }

    if (
      options.searchWindow.reverse &&
      reversePrimer &&
      options.searchWindow.reverse < reversePrimer.length
    ) {
      throw new Error(
        `Reverse search window (${options.searchWindow.reverse}bp) smaller than primer (${reversePrimer.length}bp)`
      );
    }
  }

  return {
    ...options,
    forwardPrimer,
    reversePrimer,
  } as AmpliconOptions & {
    forwardPrimer: PrimerSequence;
    reversePrimer?: PrimerSequence;
  };
});

// =============================================================================
// AMPLICON MATCH TYPES
// =============================================================================

/**
 * Result of matching a primer pair within a sequence
 */
interface AmpliconMatch<TForward extends string = string, TReverse extends string = string> {
  forwardMatch: PatternMatch<TForward>;
  reverseMatch: PatternMatch<TReverse>;
  ampliconStart: number;
  ampliconEnd: number;
  ampliconLength: number;
  totalMismatches: number;
}

/**
 * Enhanced pattern match with orientation information for canonical matching
 * Used when primers may be in unknown orientation (BED-extracted scenarios)
 */
interface CanonicalPatternMatch<T extends string = string> extends PatternMatch<T> {
  strand: "+" | "-"; // Strand where match was found
  isCanonical: boolean; // True if matched reverse complement
  matchedOrientation: "forward" | "canonical";
  actualMatchedSequence?: string; // What actually matched (for RC matches)
}

// =============================================================================
// AMPLICON PROCESSOR IMPLEMENTATION
// =============================================================================

/**
 * Processor for extracting amplicons via primer sequences
 *
 * Follows established processor pattern with enhanced type safety through
 * branded primer types and generic pattern matching integration.
 */
export class AmpliconProcessor implements Processor<AmpliconOptions> {
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: AmpliconOptions
  ): AsyncIterable<AbstractSequence> {
    // Validate options and brand primers using ArkType schema
    const validOptions = AmpliconOptionsSchema(options);
    if (validOptions instanceof type.errors) {
      throw new ValidationError(`Invalid amplicon options: ${validOptions.summary}`);
    }

    // Process each sequence with type-safe primers
    for await (const sequence of source) {
      const amplicons = this.findAmplicons(sequence, validOptions);
      yield* this.extractAmplicons(sequence, amplicons, validOptions);
    }
  }

  /**
   * Find primer pair matches within a sequence
   * Supports canonical matching, windowed search, and standard PCR workflows
   */
  private findAmplicons(
    sequence: AbstractSequence,
    options: AmpliconOptions & { forwardPrimer: PrimerSequence; reversePrimer?: PrimerSequence }
  ): AmpliconMatch[] {
    // Determine search strategy using smart auto-detection
    const useCanonical = this.shouldUseCanonicalSearch(options);

    // Use enhanced windowed/canonical search for performance and accuracy
    const { forwardMatches, reverseMatches } = this.findPrimersInWindows(
      sequence,
      options,
      useCanonical
    );

    // Pair primers with appropriate validation logic
    if (useCanonical) {
      return this.pairCanonicalMatches(
        forwardMatches as CanonicalPatternMatch[],
        reverseMatches as CanonicalPatternMatch[]
      );
    } else {
      return this.pairPrimers(forwardMatches as PatternMatch[], reverseMatches as PatternMatch[]);
    }
  }

  /**
   * Pair forward and reverse primer matches with biological validation
   */
  private pairPrimers<TForward extends string, TReverse extends string>(
    forwardMatches: PatternMatch<TForward>[],
    reverseMatches: PatternMatch<TReverse>[]
  ): AmpliconMatch<TForward, TReverse>[] {
    const pairs: AmpliconMatch<TForward, TReverse>[] = [];

    for (const forward of forwardMatches) {
      for (const reverse of reverseMatches) {
        if (this.isValidPrimerPair(forward, reverse)) {
          pairs.push({
            forwardMatch: forward,
            reverseMatch: reverse,
            ampliconStart: forward.position + forward.length,
            ampliconEnd: reverse.position,
            ampliconLength: reverse.position - (forward.position + forward.length),
            totalMismatches: forward.mismatches + reverse.mismatches,
          });
        }
      }
    }

    // Sort by fewest mismatches, then by longest amplicon (addressing seqkit limitation)
    return pairs.sort((a, b) => {
      if (a.totalMismatches !== b.totalMismatches) {
        return a.totalMismatches - b.totalMismatches;
      }
      return b.ampliconLength - a.ampliconLength;
    });
  }

  /**
   * Validate primer pair geometry and biological constraints
   */
  private isValidPrimerPair(forward: PatternMatch, reverse: PatternMatch): boolean {
    // Forward must be upstream of reverse
    if (forward.position >= reverse.position) return false;

    // Minimum amplicon length (biological constraint)
    const ampliconLength = reverse.position - (forward.position + forward.length);
    if (ampliconLength < 1) return false; // Must have some sequence between primers

    // Maximum amplicon length (typical PCR constraints)
    if (ampliconLength > 10000) return false; // 10kb is practical PCR limit

    return true;
  }

  /**
   * Extract amplicon sequences with coordinate system integration
   */
  private extractAmplicons(
    sequence: AbstractSequence,
    matches: AmpliconMatch[],
    options: AmpliconOptions
  ): AbstractSequence[] {
    return matches.map((match, index) => {
      let start: number, end: number;

      if (options.region) {
        // Use existing coordinate parsing infrastructure
        const hasNegativeIndices = false;
        const regionStart = parseStartPosition(
          options.region,
          sequence.length,
          true,
          hasNegativeIndices
        );
        const regionEnd = parseEndPosition(
          options.region,
          sequence.length,
          true,
          hasNegativeIndices
        );

        if (options.flanking) {
          // Flanking regions: relative to primer boundaries (include primers)
          start = Math.max(0, match.forwardMatch.position + regionStart.value);
          end = Math.min(
            sequence.length,
            match.reverseMatch.position + match.reverseMatch.length + regionEnd.value
          );
        } else {
          // Inner regions: relative to amplicon boundaries (between primers)
          start = Math.max(0, match.ampliconStart + regionStart.value);
          end = Math.min(sequence.length, match.ampliconEnd + regionEnd.value);
        }
      } else {
        // Default behavior
        if (options.flanking) {
          // Include primers in output (seqkit --flanking-region behavior)
          start = match.forwardMatch.position;
          end = match.reverseMatch.position + match.reverseMatch.length;
        } else {
          // Inner amplicon only (current default behavior)
          start = match.ampliconStart;
          end = match.ampliconEnd;
        }
      }

      // Extract amplicon sequence with metadata
      const ampliconSequence = sequence.sequence.slice(start, end);
      const description = this.createAmpliconDescription(match, options);

      return {
        ...sequence,
        id: `${sequence.id}_amplicon_${index + 1}`,
        sequence: ampliconSequence,
        length: ampliconSequence.length,
        description: description,
      };
    });
  }

  /**
   * Pair canonical matches with orientation-aware validation
   *
   * More permissive than standard PCR since primer orientation is flexible
   * in BED-extracted scenarios. Validates biological constraints while
   * allowing various orientation combinations.
   *
   * @param forwardMatches - Forward primer matches with orientation info
   * @param reverseMatches - Reverse primer matches with orientation info
   * @returns Valid amplicon matches with canonical metadata
   */
  private pairCanonicalMatches(
    forwardMatches: CanonicalPatternMatch[],
    reverseMatches: CanonicalPatternMatch[]
  ): AmpliconMatch[] {
    const pairs: AmpliconMatch[] = [];

    for (const forward of forwardMatches) {
      for (const reverse of reverseMatches) {
        if (this.isValidCanonicalPair(forward, reverse)) {
          pairs.push(this.createCanonicalAmpliconMatch(forward, reverse));
        }
      }
    }

    return this.sortAmpliconsByQuality(pairs);
  }

  /**
   * Validate canonical primer pair geometry and orientation
   * More flexible than standard PCR constraints for BED-extracted primers
   */
  private isValidCanonicalPair(
    forward: CanonicalPatternMatch,
    reverse: CanonicalPatternMatch
  ): boolean {
    // Basic geometric constraints
    if (forward.position >= reverse.position) return false;

    const ampliconLength = reverse.position - (forward.position + forward.length);
    if (ampliconLength < 1 || ampliconLength > 10000) return false;

    // Canonical matching is more permissive about orientation
    // since primers from BED coordinates may be in any orientation
    return true;
  }

  /**
   * Create amplicon match with canonical orientation metadata
   */
  private createCanonicalAmpliconMatch(
    forward: CanonicalPatternMatch,
    reverse: CanonicalPatternMatch
  ): AmpliconMatch {
    return {
      forwardMatch: forward,
      reverseMatch: reverse,
      ampliconStart: forward.position + forward.length,
      ampliconEnd: reverse.position,
      ampliconLength: reverse.position - (forward.position + forward.length),
      totalMismatches: forward.mismatches + reverse.mismatches,
    };
  }

  /**
   * Sort amplicons by biological relevance and quality
   *
   * Prioritizes matches with fewer mismatches, then prefers non-canonical
   * orientations (exact matches), then longer amplicons.
   *
   * @param amplicons - Array of amplicon matches to sort
   * @returns Sorted amplicons with best matches first
   */
  private sortAmpliconsByQuality(amplicons: AmpliconMatch[]): AmpliconMatch[] {
    return amplicons.sort((a, b) => {
      // Fewest total mismatches first (biological accuracy)
      if (a.totalMismatches !== b.totalMismatches) {
        return a.totalMismatches - b.totalMismatches;
      }

      // For canonical matches, prefer exact orientation over reverse complement
      const aCanonicalCount = this.countCanonicalOrientations(a);
      const bCanonicalCount = this.countCanonicalOrientations(b);

      if (aCanonicalCount !== bCanonicalCount) {
        return aCanonicalCount - bCanonicalCount; // Fewer RC matches first
      }

      // Longest amplicons first (more informative)
      return b.ampliconLength - a.ampliconLength;
    });
  }

  /**
   * Count how many primers matched in canonical (reverse complement) orientation
   */
  private countCanonicalOrientations(match: AmpliconMatch): number {
    let canonicalCount = 0;

    // Check if forward match is canonical (if it has orientation info)
    if ("isCanonical" in match.forwardMatch && match.forwardMatch.isCanonical) {
      canonicalCount++;
    }

    // Check if reverse match is canonical (if it has orientation info)
    if ("isCanonical" in match.reverseMatch && match.reverseMatch.isCanonical) {
      canonicalCount++;
    }

    return canonicalCount;
  }

  /**
   * Find pattern matches in both orientations (canonical matching)
   *
   * Essential for BED-extracted primers where orientation is unknown.
   * Searches for both the pattern as-provided and its reverse complement.
   *
   * @param sequence - Text to search in
   * @param pattern - Pattern to search (will search both orientations)
   * @param maxMismatches - Maximum allowed mismatches
   * @returns Matches with orientation metadata preserving original pattern type
   */
  private findCanonicalMatches<T extends string>(
    sequence: string,
    pattern: T,
    maxMismatches: number
  ): CanonicalPatternMatch<T>[] {
    const allMatches: CanonicalPatternMatch<T>[] = [];

    // Search pattern as-provided (forward orientation)
    const forwardMatches = findPatternWithMismatches(sequence, pattern, maxMismatches, false);
    allMatches.push(
      ...forwardMatches.map((match) => ({
        ...match,
        strand: "+" as const,
        isCanonical: false,
        matchedOrientation: "forward" as const,
      }))
    );

    // Search reverse complement (canonical orientation)
    const rcPattern = reverseComplement(pattern);
    const reverseMatches = findPatternWithMismatches(sequence, rcPattern, maxMismatches, false);

    // Preserve original pattern type while noting canonical matching
    const canonicalMatches = reverseMatches.map((match) => ({
      ...match,
      pattern: pattern, // ✅ Keep original pattern type
      strand: "-" as const,
      isCanonical: true,
      matchedOrientation: "canonical" as const,
      actualMatchedSequence: match.matched, // What actually matched (RC)
    }));

    allMatches.push(...canonicalMatches);
    return allMatches.sort((a, b) => a.position - b.position);
  }

  /**
   * Determine search strategy based on primer usage patterns
   *
   * Provides invisible intelligence that "just works" for common scenarios:
   * - Single primer → canonical matching (unknown target orientation)
   * - Identical primers → canonical matching (likely BED-extracted)
   * - Different primers → standard PCR (known design)
   *
   * @param options - Amplicon options to analyze
   * @returns True if canonical matching should be used
   */
  private shouldUseCanonicalSearch(options: AmpliconOptions): boolean {
    // Explicit override takes precedence (progressive disclosure)
    if (options.canonical !== undefined) {
      return options.canonical;
    }

    // Auto-detection logic for common scenarios

    // Single primer: canonical matching makes biological sense
    if (!options.reversePrimer) {
      return true;
    }

    // Identical primers: likely BED-extracted or symmetric amplification
    if (options.forwardPrimer === options.reversePrimer) {
      return true;
    }

    // Different primers: standard PCR workflow (current behavior)
    return false;
  }

  /**
   * High-performance windowed primer search for long reads
   *
   * Reduces search space from entire read to terminal regions, providing
   * massive performance improvements for PacBio/Nanopore workflows.
   *
   * @param sequence - Sequence to search in
   * @param options - Amplicon options with window specifications
   * @returns Forward and reverse matches with global coordinates
   */
  private findPrimersInWindows(
    sequence: AbstractSequence,
    options: AmpliconOptions & { forwardPrimer: PrimerSequence; reversePrimer?: PrimerSequence },
    useCanonical: boolean = false
  ): {
    forwardMatches: PatternMatch[] | CanonicalPatternMatch[];
    reverseMatches: PatternMatch[] | CanonicalPatternMatch[];
  } {
    let forwardMatches: PatternMatch[] | CanonicalPatternMatch[] = [];
    let reverseMatches: PatternMatch[] | CanonicalPatternMatch[] = [];

    const reversePrimer = options.reversePrimer || options.forwardPrimer;

    if (options.searchWindow) {
      // Forward primer: search beginning of sequence
      if (options.searchWindow.forward) {
        const forwardWindow = sequence.sequence.slice(0, options.searchWindow.forward);
        forwardMatches = useCanonical
          ? this.findCanonicalMatches(
              forwardWindow,
              options.forwardPrimer,
              options.maxMismatches || 0
            )
          : findPatternWithMismatches(
              forwardWindow,
              options.forwardPrimer,
              options.maxMismatches || 0,
              false
            );
      }

      // Reverse primer: search end of sequence
      if (options.searchWindow.reverse) {
        const reverseWindow = sequence.sequence.slice(-options.searchWindow.reverse);
        const windowStart = sequence.sequence.length - options.searchWindow.reverse;

        let windowMatches: PatternMatch[] | CanonicalPatternMatch[];

        if (useCanonical) {
          // Canonical: search reverse primer in both orientations
          windowMatches = this.findCanonicalMatches(
            reverseWindow,
            reversePrimer,
            options.maxMismatches || 0
          );
        } else {
          // Standard PCR: search reverse complement of reverse primer
          const searchPattern = reverseComplement(reversePrimer) as PrimerSequence;
          windowMatches = findPatternWithMismatches(
            reverseWindow,
            searchPattern,
            options.maxMismatches || 0,
            false
          );
        }

        // Adjust positions to global coordinates
        reverseMatches = windowMatches.map((match) => ({
          ...match,
          position: match.position + windowStart,
        }));
      }
    } else {
      // Full sequence search
      if (useCanonical) {
        forwardMatches = this.findCanonicalMatches(
          sequence.sequence,
          options.forwardPrimer,
          options.maxMismatches || 0
        );
        reverseMatches = this.findCanonicalMatches(
          sequence.sequence,
          reversePrimer,
          options.maxMismatches || 0
        );
      } else {
        // Standard PCR search (current behavior)
        forwardMatches = findPatternWithMismatches(
          sequence.sequence,
          options.forwardPrimer,
          options.maxMismatches || 0,
          false
        );
        const searchPattern = reverseComplement(reversePrimer) as PrimerSequence;
        reverseMatches = findPatternWithMismatches(
          sequence.sequence,
          searchPattern,
          options.maxMismatches || 0,
          false
        );
      }
    }

    return { forwardMatches, reverseMatches };
  }

  /**
   * Create descriptive metadata for amplicon sequences
   */
  private createAmpliconDescription(match: AmpliconMatch, options: AmpliconOptions): string {
    const regionType = options.flanking ? "flanking" : "inner";
    let description = `Amplicon ${regionType} ${match.ampliconStart}-${match.ampliconEnd} (${match.ampliconLength}bp)`;

    // Primer position information for flanking regions
    if (options.flanking) {
      description += ` [includes primers: ${match.forwardMatch.position}-${match.forwardMatch.position + match.forwardMatch.length}, ${match.reverseMatch.position}-${match.reverseMatch.position + match.reverseMatch.length}]`;
    }

    // Mismatch information for debugging
    if (options.outputMismatches) {
      description += ` [${match.totalMismatches} mismatches: forward=${match.forwardMatch.mismatches}, reverse=${match.reverseMatch.mismatches}]`;
    }

    // Canonical matching information (for BED-extracted primers)
    if (this.hasCanonicalMatches(match)) {
      const forwardOrientation = this.getMatchOrientation(match.forwardMatch);
      const reverseOrientation = this.getMatchOrientation(match.reverseMatch);
      description += ` [orientations: forward=${forwardOrientation}, reverse=${reverseOrientation}]`;
    }

    // Performance optimization information
    if (options.searchWindow) {
      const windowInfo = [];
      if (options.searchWindow.forward)
        windowInfo.push(`forward=${options.searchWindow.forward}bp`);
      if (options.searchWindow.reverse)
        windowInfo.push(`reverse=${options.searchWindow.reverse}bp`);
      description += ` [windowed search: ${windowInfo.join(", ")}]`;
    }

    return description;
  }

  /**
   * Check if amplicon match contains canonical orientation information
   */
  private hasCanonicalMatches(match: AmpliconMatch): boolean {
    return "isCanonical" in match.forwardMatch || "isCanonical" in match.reverseMatch;
  }

  /**
   * Get orientation description for match metadata
   */
  private getMatchOrientation(match: PatternMatch | CanonicalPatternMatch): string {
    if ("isCanonical" in match) {
      return match.isCanonical ? "canonical" : "as-provided";
    }
    return "standard";
  }
}

/**
 * Validate and brand primer sequences with biological constraints
 * Ensures consistency between template literal and runtime validation
 */
function validateAndBrandPrimer(primer: string | PrimerSequence): PrimerSequence {
  // If already a validated PrimerSequence, return as-is
  if (typeof primer === "string" && isPrimerSequence(primer)) {
    return primer as PrimerSequence;
  }

  // Validate runtime string with same constraints as template literals
  if (!IUPAC_DNA.test(primer)) {
    throw new Error(`Invalid primer: "${primer}". Valid characters: ACGTRYSWKMBDHVN`);
  }
  if (primer.length < 10) {
    // Same as template literal minimum
    throw new Error(
      `Primer too short: ${primer.length}bp < 10bp minimum for biological specificity`
    );
  }
  if (primer.length > 50) {
    // Same as template literal maximum
    throw new Error(
      `Primer too long: ${primer.length}bp > 50bp maximum for efficient PCR amplification`
    );
  }

  return primer as PrimerSequence;
}
