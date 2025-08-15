/**
 * Shared types and interfaces for SeqOps processors
 *
 * This module defines the common interfaces used by all processor classes
 * in the new semantic API design. Each interface represents options for
 * a single-purpose operation.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import type { AbstractSequence } from '../types';

/**
 * Options for filtering sequences based on various criteria
 *
 * All criteria are applied with AND logic within a single filter call.
 * Chain multiple filter calls for more complex logic.
 */
export interface FilterOptions {
  /** Minimum sequence length */
  minLength?: number;

  /** Maximum sequence length */
  maxLength?: number;

  /** Minimum GC content percentage (0-100) */
  minGC?: number;

  /** Maximum GC content percentage (0-100) */
  maxGC?: number;

  /** Pattern to match against ID or sequence */
  pattern?: RegExp;

  /** Whitelist of sequence IDs to keep */
  ids?: string[];

  /** Blacklist of sequence IDs to exclude */
  excludeIds?: string[];

  /** Filter sequences containing ambiguous bases (N, etc.) */
  hasAmbiguous?: boolean;

  /** Custom filter function for complex logic */
  custom?: (seq: AbstractSequence) => boolean;
}

/**
 * Options for transforming sequence content
 *
 * Transformations modify the sequence string itself.
 */
export interface TransformOptions {
  /** Reverse the sequence */
  reverse?: boolean;

  /** Complement the sequence (A↔T, C↔G) */
  complement?: boolean;

  /** Reverse complement the sequence */
  reverseComplement?: boolean;

  /** Convert DNA to RNA (T → U) */
  toRNA?: boolean;

  /** Convert RNA to DNA (U → T) */
  toDNA?: boolean;

  /** Convert sequence to uppercase */
  upperCase?: boolean;

  /** Convert sequence to lowercase */
  lowerCase?: boolean;

  /** Custom transformation function */
  custom?: (seq: string) => string;
}

/**
 * Options for cleaning and sanitizing sequences
 *
 * Cleaning operations fix common issues in sequence data.
 */
export interface CleanOptions {
  /** Remove gap characters (-, ., *) */
  removeGaps?: boolean;

  /** Custom gap characters to remove */
  gapChars?: string;

  /** Replace ambiguous bases with a standard character */
  replaceAmbiguous?: boolean;

  /** Character to use for replacement (default: 'N') */
  replaceChar?: string;

  /** Remove leading/trailing whitespace */
  trimWhitespace?: boolean;

  /** Filter out empty sequences after cleaning */
  removeEmpty?: boolean;
}

/**
 * Options for FASTQ quality operations
 *
 * These operations only apply to FASTQ sequences with quality scores.
 */
export interface QualityOptions {
  /** Minimum average quality score */
  minScore?: number;

  /** Maximum average quality score */
  maxScore?: number;

  /** Enable quality trimming */
  trim?: boolean;

  /** Score threshold for trimming */
  trimThreshold?: number;

  /** Sliding window size for quality trimming */
  trimWindow?: number;

  /** Trim low quality from 5' end */
  trimFromStart?: boolean;

  /** Trim low quality from 3' end */
  trimFromEnd?: boolean;

  /** Quality score encoding */
  encoding?: 'phred33' | 'phred64';
}

/**
 * Options for sequence validation
 *
 * Validation can reject, fix, or warn about invalid sequences.
 */
export interface ValidateOptions {
  /** Validation strictness level */
  mode?: 'strict' | 'normal' | 'permissive';

  /** Allow RNA bases (U) in sequences */
  allowRNA?: boolean;

  /** Allow IUPAC ambiguity codes */
  allowAmbiguous?: boolean;

  /** Allow gap characters */
  allowGaps?: boolean;

  /** Action to take on invalid sequences */
  action?: 'reject' | 'fix' | 'warn';

  /** Character to use when fixing invalid bases */
  fixChar?: string;
}

/**
 * Options for annotating sequence metadata
 *
 * Annotation operations modify sequence headers and descriptions.
 */
export interface AnnotateOptions {
  /** Add prefix to sequence IDs */
  prefix?: string;

  /** Add suffix to sequence IDs */
  suffix?: string;

  /** Keep only first word of ID */
  simplifyId?: boolean;

  /** Add sequence length to description */
  addLength?: boolean;

  /** Add GC content to description */
  addGC?: boolean;

  /** Custom annotation function */
  custom?: (seq: AbstractSequence) => Partial<AbstractSequence>;
}

/**
 * Options for sorting sequences
 */
export interface SortOptions {
  /** Field to sort by */
  by: 'length' | 'id' | 'gc' | 'quality';

  /** Sort order */
  order?: 'asc' | 'desc';

  /** Custom comparison function */
  custom?: (a: AbstractSequence, b: AbstractSequence) => number;
}

/**
 * Options for random sampling
 */
export interface SampleOptions {
  /** Number of sequences to sample */
  n?: number;

  /** Fraction of sequences to sample (0-1) */
  fraction?: number;

  /** Random seed for reproducibility */
  seed?: number;

  /** Allow sampling with replacement */
  withReplacement?: boolean;
}

/**
 * Options for grouping sequences
 */
export interface GroupOptions {
  /** Grouping criterion */
  by: 'length' | 'gc' | ((seq: AbstractSequence) => string);

  /** Aggregation method for groups */
  aggregate?: 'count' | 'stats' | 'collect';
}

/**
 * Base interface for all processor classes
 *
 * Each processor implements a single operation type and
 * maintains the async iterable pattern for streaming.
 */
export interface Processor<TOptions> {
  /**
   * Process sequences with the given options
   *
   * @param source - Input sequences
   * @param options - Processing options
   * @returns Processed sequences
   */
  process(
    source: AsyncIterable<AbstractSequence>,
    options: TOptions
  ): AsyncIterable<AbstractSequence>;
}
