/**
 * FASTQ Format Module
 *
 * Parsing and writing of FASTQ sequence data, including per-base quality
 * strings, quality encoding metadata, and paired-end read support.
 */

export { PairSyncError } from "@genotype/core/errors";
export type { FastqSequence } from "@genotype/core/types";

export { PairedFastqParser } from "./paired";
export { FastqParser } from "./parser";
export { FastqWriter } from "./writer";

export type { FastqParserOptions, PairedFastqParserOptions, PairedFastqRead } from "./types";
