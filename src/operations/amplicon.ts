/**
 * Amplicon extraction for PCR-based molecular diagnostics and targeted sequencing
 *
 * This module implements sophisticated amplicon detection algorithms essential for modern
 * molecular diagnostics, including COVID-19 testing, microbiome analysis, and targeted
 * sequencing. Amplicon extraction is fundamental to PCR-based assays, enabling precise
 * extraction of target sequences from complex genomic backgrounds using primer pairs.
 * Supports IUPAC degenerate bases, mismatch tolerance, and optimized search algorithms.
 *
 * **PCR Amplicon Biology:**
 * PCR amplification creates millions of copies of specific DNA regions (amplicons) defined
 * by forward and reverse primer binding sites. The region between primers becomes the
 * amplified product, enabling sensitive detection of target sequences even from minimal
 * starting material.
 *
 * **Clinical Applications:**
 * - **COVID-19 diagnostics**: RT-qPCR targeting SARS-CoV-2 N gene, ORF1ab regions
 * - **Microbiome analysis**: 16S rRNA gene amplification for bacterial identification
 * - **Genetic testing**: Amplify specific genes for mutation analysis
 * - **Pathogen detection**: Species-specific primer pairs for infectious disease diagnosis
 * - **Forensic genetics**: STR amplification for human identification
 * - **Environmental monitoring**: Detection of specific organisms in environmental samples
 *
 * **Algorithm Innovations:**
 * - **IUPAC degeneracy support**: Handle primer design with ambiguous bases
 * - **Mismatch tolerance**: Account for natural sequence variation and SNPs
 * - **Windowed search**: Performance optimization for long-read sequencing
 * - **Canonical matching**: BED-extracted primer validation and normalization
 * - **Biological validation**: Primer length and composition constraints
 *
 */

import { type } from "arktype";
import { findPatternBatch } from "@genotype/core/backend/service";
import { ValidationError } from "@genotype/core/errors";
import type { AbstractSequence, PrimerSequence } from "@genotype/core/types";
import { GenotypeString } from "@genotype/core/genotype-string";
import type { PackedBatch } from "@genotype/core/backend/batch";
import type { PatternSearchResult } from "@genotype/core/backend/kernel-types";
import { isPrimerSequence } from "./core/alphabet";
import { parseEndPosition, parseStartPosition, validateRegionString } from "./core/coordinates";
import type { PatternMatch } from "./core/pattern-matching";
import { reverseComplement } from "./core/sequence-manipulation";
import { IUPAC_DNA } from "./core/sequence-validation";
import type { AmpliconOptions, Processor } from "./types";

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

/** Byte budget per native batch. Sequences accumulate until this threshold. */
const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

/** A search job describes one kernel call: one pattern against one packed buffer. */
interface SearchJob {
  /** The primer bytes to search for. */
  pattern: Buffer;
  /** Which packed buffer to search against. */
  target: "forward" | "reverse";
  /** Whether this job searches the original or reverse-complement orientation. */
  orientation: "as-provided" | "canonical";
  /** The original primer string (for building PatternMatch objects). */
  primerString: string;
}

/** Per-sequence metadata accumulated during a batch. */
interface BatchEntry {
  sequence: AbstractSequence;
  forwardWindowStart: number;
  reverseWindowStart: number;
}

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

/**
 * Processor for extracting amplicons via primer sequences
 *
 * Primer search is batched across sequences using the native SIMD kernel.
 * Sequences accumulate until the byte budget is reached, then the batch
 * is flushed: windowed regions are packed into buffers, 2-4 kernel calls
 * search all sequences at once, and results are distributed back to
 * per-sequence pairing and extraction.
 */
export class AmpliconProcessor implements Processor<AmpliconOptions> {
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: AmpliconOptions
  ): AsyncIterable<AbstractSequence> {
    const validOptions = AmpliconOptionsSchema(options);
    if (validOptions instanceof type.errors) {
      throw new ValidationError(`Invalid amplicon options: ${validOptions.summary}`);
    }

    const useCanonical = shouldUseCanonicalSearch(validOptions);
    const searchJobs = buildSearchJobs(validOptions, useCanonical);
    const maxMismatches = validOptions.maxMismatches ?? 0;

    let batch: BatchEntry[] = [];
    let batchBytes = 0;

    for await (const seq of source) {
      batch.push({
        sequence: seq,
        forwardWindowStart: computeWindowStart(seq, "forward", validOptions),
        reverseWindowStart: computeWindowStart(seq, "reverse", validOptions),
      });
      batchBytes += seq.sequence.length;

      if (batchBytes >= BATCH_BYTE_BUDGET) {
        yield* flushAmpliconBatch(batch, validOptions, searchJobs, useCanonical, maxMismatches);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* flushAmpliconBatch(batch, validOptions, searchJobs, useCanonical, maxMismatches);
    }
  }
}

/**
 * Process a batch of sequences through the native pattern search kernel.
 *
 * Packs windowed regions into two buffers (forward and reverse), runs
 * 2-4 kernel calls (one per search job), distributes CSR results back
 * to per-sequence match arrays, then runs per-sequence pairing and
 * extraction.
 */
async function* flushAmpliconBatch(
  batch: BatchEntry[],
  options: AmpliconOptions & { forwardPrimer: PrimerSequence; reversePrimer?: PrimerSequence },
  searchJobs: SearchJob[],
  useCanonical: boolean,
  maxMismatches: number
): AsyncIterable<AbstractSequence> {
  const forwardPacked = packWindowedRegions(batch, "forward", options);
  const reversePacked = packWindowedRegions(batch, "reverse", options);

  const jobResults = new Map<SearchJob, PatternSearchResult>();
  for (const job of searchJobs) {
    const packed = job.target === "forward" ? forwardPacked : reversePacked;
    const result = await findPatternBatch(packed.data, packed.offsets, job.pattern, {
      maxEdits: maxMismatches,
      caseInsensitive: false,
    });
    jobResults.set(job, result);
  }

  const forwardJobs = searchJobs.filter((j) => j.target === "forward");
  const reverseJobs = searchJobs.filter((j) => j.target === "reverse");

  for (let i = 0; i < batch.length; i++) {
    const entry = batch[i]!;

    const forwardMatches = gatherMatches(
      forwardJobs,
      jobResults,
      i,
      entry.forwardWindowStart,
      entry.sequence,
      useCanonical
    );

    const reverseMatches = gatherMatches(
      reverseJobs,
      jobResults,
      i,
      entry.reverseWindowStart,
      entry.sequence,
      useCanonical
    );

    let amplicons: AmpliconMatch[];
    if (useCanonical) {
      amplicons = pairCanonicalMatches(
        forwardMatches as CanonicalPatternMatch[],
        reverseMatches as CanonicalPatternMatch[]
      );
    } else {
      amplicons = pairPrimers(forwardMatches as PatternMatch[], reverseMatches as PatternMatch[]);
    }

    yield* extractAmplicons(entry.sequence, amplicons, options);
  }
}

/**
 * Build the list of search jobs for a run. Each job is one kernel call
 * per batch: one pattern against one packed buffer.
 *
 * Standard mode: 2 jobs (forward primer on forward buffer, RC of reverse
 * primer on reverse buffer). Canonical mode: 4 jobs (each primer searched
 * as-is and as RC).
 */
function buildSearchJobs(
  options: AmpliconOptions & { forwardPrimer: PrimerSequence; reversePrimer?: PrimerSequence },
  useCanonical: boolean
): SearchJob[] {
  const reversePrimer = (options.reversePrimer ?? options.forwardPrimer) as string;
  const forwardPrimer = options.forwardPrimer as string;
  const jobs: SearchJob[] = [];

  if (useCanonical) {
    jobs.push({
      pattern: Buffer.from(forwardPrimer, "latin1"),
      target: "forward",
      orientation: "as-provided",
      primerString: forwardPrimer,
    });
    jobs.push({
      pattern: Buffer.from(reverseComplement(forwardPrimer), "latin1"),
      target: "forward",
      orientation: "canonical",
      primerString: forwardPrimer,
    });
    jobs.push({
      pattern: Buffer.from(reversePrimer, "latin1"),
      target: "reverse",
      orientation: "as-provided",
      primerString: reversePrimer,
    });
    jobs.push({
      pattern: Buffer.from(reverseComplement(reversePrimer), "latin1"),
      target: "reverse",
      orientation: "canonical",
      primerString: reversePrimer,
    });
  } else {
    jobs.push({
      pattern: Buffer.from(forwardPrimer, "latin1"),
      target: "forward",
      orientation: "as-provided",
      primerString: forwardPrimer,
    });
    jobs.push({
      pattern: Buffer.from(reverseComplement(reversePrimer), "latin1"),
      target: "reverse",
      orientation: "as-provided",
      primerString: reversePrimer,
    });
  }

  return jobs;
}

/**
 * Compute the coordinate offset for a windowed search region.
 *
 * For the forward window (start of sequence), the offset is always 0.
 * For the reverse window (end of sequence), the offset is the number
 * of bases before the window starts. When no window is configured,
 * the offset is 0 (full sequence search).
 */
function computeWindowStart(
  seq: AbstractSequence,
  side: "forward" | "reverse",
  options: AmpliconOptions
): number {
  if (side === "reverse" && options.searchWindow?.reverse) {
    return Math.max(0, seq.sequence.length - options.searchWindow.reverse);
  }
  return 0;
}

/**
 * Pack the windowed search regions for one side (forward or reverse)
 * from all sequences in a batch.
 *
 * When a search window is configured, packs only the windowed slice.
 * Otherwise packs the full sequence. Packs directly from
 * GenotypeString bytes to avoid string materialization.
 */
function packWindowedRegions(
  batch: BatchEntry[],
  side: "forward" | "reverse",
  options: AmpliconOptions
): PackedBatch {
  const count = batch.length;
  const offsets = new Uint32Array(count + 1);
  const chunks: Uint8Array[] = new Array(count);
  let totalBytes = 0;

  for (let i = 0; i < count; i++) {
    const seq = batch[i]!.sequence.sequence;
    let region: GenotypeString;
    if (side === "forward" && options.searchWindow?.forward) {
      region = seq.slice(0, options.searchWindow.forward);
    } else if (side === "reverse" && options.searchWindow?.reverse) {
      region = seq.slice(-options.searchWindow.reverse);
    } else {
      region = seq;
    }
    const bytes = region.toBytes();
    chunks[i] = bytes;
    offsets[i] = totalBytes;
    totalBytes += bytes.length;
  }
  offsets[count] = totalBytes;

  const data = Buffer.allocUnsafe(totalBytes);
  for (let i = 0; i < count; i++) {
    data.set(chunks[i]!, offsets[i]!);
  }

  return { data, offsets };
}

/**
 * Extract per-sequence matches from CSR results across multiple search
 * jobs, adjusting coordinates by the window offset and converting to
 * the `PatternMatch` / `CanonicalPatternMatch` interfaces.
 */
function gatherMatches(
  jobs: SearchJob[],
  results: Map<SearchJob, PatternSearchResult>,
  seqIndex: number,
  windowStart: number,
  sequence: AbstractSequence,
  useCanonical: boolean
): PatternMatch[] | CanonicalPatternMatch[] {
  const matches: (PatternMatch | CanonicalPatternMatch)[] = [];

  for (const job of jobs) {
    const csr = results.get(job)!;
    const rangeStart = csr.matchOffsets[seqIndex]!;
    const rangeEnd = csr.matchOffsets[seqIndex + 1]!;

    for (let m = rangeStart; m < rangeEnd; m++) {
      const start = csr.starts[m]! + windowStart;
      const end = csr.ends[m]! + windowStart;
      const cost = csr.costs[m]!;
      const length = end - start;
      const matched = sequence.sequence.slice(start, end).toString();

      const base: PatternMatch = {
        position: start,
        length,
        mismatches: cost,
        matched,
        pattern: job.primerString,
      };

      if (useCanonical) {
        matches.push({
          ...base,
          strand: job.orientation === "canonical" ? ("-" as const) : ("+" as const),
          isCanonical: job.orientation === "canonical",
          matchedOrientation:
            job.orientation === "canonical" ? ("canonical" as const) : ("forward" as const),
        });
      } else {
        matches.push(base);
      }
    }
  }

  return matches.sort((a, b) => a.position - b.position) as
    | PatternMatch[]
    | CanonicalPatternMatch[];
}

/**
 * Determine search strategy based on primer usage patterns.
 *
 * Single primer or identical primers → canonical matching (unknown
 * target orientation). Different primers → standard PCR (known design).
 */
function shouldUseCanonicalSearch(options: AmpliconOptions): boolean {
  if (options.canonical !== undefined) {
    return options.canonical;
  }
  if (!options.reversePrimer) {
    return true;
  }
  if (options.forwardPrimer === options.reversePrimer) {
    return true;
  }
  return false;
}

/** Pair forward and reverse primer matches with biological validation. */
function pairPrimers(
  forwardMatches: PatternMatch[],
  reverseMatches: PatternMatch[]
): AmpliconMatch[] {
  const pairs: AmpliconMatch[] = [];

  for (const forward of forwardMatches) {
    for (const reverse of reverseMatches) {
      if (isValidPrimerPair(forward, reverse)) {
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

  return pairs.sort((a, b) => {
    if (a.totalMismatches !== b.totalMismatches) {
      return a.totalMismatches - b.totalMismatches;
    }
    return b.ampliconLength - a.ampliconLength;
  });
}

/** Validate primer pair geometry and biological constraints. */
function isValidPrimerPair(forward: PatternMatch, reverse: PatternMatch): boolean {
  if (forward.position >= reverse.position) return false;
  const ampliconLength = reverse.position - (forward.position + forward.length);
  if (ampliconLength < 1) return false;
  if (ampliconLength > 10000) return false;
  return true;
}

/** Pair canonical matches with orientation-aware validation. */
function pairCanonicalMatches(
  forwardMatches: CanonicalPatternMatch[],
  reverseMatches: CanonicalPatternMatch[]
): AmpliconMatch[] {
  const pairs: AmpliconMatch[] = [];

  for (const forward of forwardMatches) {
    for (const reverse of reverseMatches) {
      if (isValidCanonicalPair(forward, reverse)) {
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

  return sortAmpliconsByQuality(pairs);
}

function isValidCanonicalPair(
  forward: CanonicalPatternMatch,
  reverse: CanonicalPatternMatch
): boolean {
  if (forward.position >= reverse.position) return false;
  const ampliconLength = reverse.position - (forward.position + forward.length);
  if (ampliconLength < 1 || ampliconLength > 10000) return false;
  return true;
}

function sortAmpliconsByQuality(amplicons: AmpliconMatch[]): AmpliconMatch[] {
  return amplicons.sort((a, b) => {
    if (a.totalMismatches !== b.totalMismatches) {
      return a.totalMismatches - b.totalMismatches;
    }
    const aCanonical = countCanonicalOrientations(a);
    const bCanonical = countCanonicalOrientations(b);
    if (aCanonical !== bCanonical) {
      return aCanonical - bCanonical;
    }
    return b.ampliconLength - a.ampliconLength;
  });
}

function countCanonicalOrientations(match: AmpliconMatch): number {
  let count = 0;
  if ("isCanonical" in match.forwardMatch && match.forwardMatch.isCanonical) count++;
  if ("isCanonical" in match.reverseMatch && match.reverseMatch.isCanonical) count++;
  return count;
}

/** Extract amplicon sequences with coordinate system integration. */
function extractAmplicons(
  sequence: AbstractSequence,
  matches: AmpliconMatch[],
  options: AmpliconOptions
): AbstractSequence[] {
  return matches.map((match, index) => {
    let start: number, end: number;

    if (options.region) {
      const hasNegativeIndices = false;
      const regionStart = parseStartPosition(
        options.region,
        sequence.length,
        true,
        hasNegativeIndices
      );
      const regionEnd = parseEndPosition(options.region, sequence.length, true, hasNegativeIndices);

      if (options.flanking) {
        start = Math.max(0, match.forwardMatch.position + regionStart.value);
        end = Math.min(
          sequence.length,
          match.reverseMatch.position + match.reverseMatch.length + regionEnd.value
        );
      } else {
        start = Math.max(0, match.ampliconStart + regionStart.value);
        end = Math.min(sequence.length, match.ampliconEnd + regionEnd.value);
      }
    } else {
      if (options.flanking) {
        start = match.forwardMatch.position;
        end = match.reverseMatch.position + match.reverseMatch.length;
      } else {
        start = match.ampliconStart;
        end = match.ampliconEnd;
      }
    }

    const ampliconSequence = sequence.sequence.slice(start, end);
    const description = createAmpliconDescription(match, options);

    return {
      ...sequence,
      id: `${sequence.id}_amplicon_${index + 1}`,
      sequence: ampliconSequence,
      length: ampliconSequence.length,
      description: description,
    };
  });
}

/** Create descriptive metadata for amplicon sequences. */
function createAmpliconDescription(match: AmpliconMatch, options: AmpliconOptions): string {
  const regionType = options.flanking ? "flanking" : "inner";
  let description = `Amplicon ${regionType} ${match.ampliconStart}-${match.ampliconEnd} (${match.ampliconLength}bp)`;

  if (options.flanking) {
    description += ` [includes primers: ${match.forwardMatch.position}-${match.forwardMatch.position + match.forwardMatch.length}, ${match.reverseMatch.position}-${match.reverseMatch.position + match.reverseMatch.length}]`;
  }

  if (options.outputMismatches) {
    description += ` [${match.totalMismatches} mismatches: forward=${match.forwardMatch.mismatches}, reverse=${match.reverseMatch.mismatches}]`;
  }

  if (hasCanonicalMatches(match)) {
    const forwardOrientation = getMatchOrientation(match.forwardMatch);
    const reverseOrientation = getMatchOrientation(match.reverseMatch);
    description += ` [orientations: forward=${forwardOrientation}, reverse=${reverseOrientation}]`;
  }

  if (options.searchWindow) {
    const windowInfo = [];
    if (options.searchWindow.forward) windowInfo.push(`forward=${options.searchWindow.forward}bp`);
    if (options.searchWindow.reverse) windowInfo.push(`reverse=${options.searchWindow.reverse}bp`);
    description += ` [windowed search: ${windowInfo.join(", ")}]`;
  }

  return description;
}

function hasCanonicalMatches(match: AmpliconMatch): boolean {
  return "isCanonical" in match.forwardMatch || "isCanonical" in match.reverseMatch;
}

function getMatchOrientation(match: PatternMatch | CanonicalPatternMatch): string {
  if ("isCanonical" in match) {
    return match.isCanonical ? "canonical" : "as-provided";
  }
  return "standard";
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
