import type { AbstractSequence } from "../types";

/**
 * Options for interleaving two sequence streams
 *
 * This module provides functionality for combining two streams of sequences
 * in alternating left-right order (L, R, L, R, ...). Commonly used for
 * Illumina paired-end reads where forward (R1) and reverse (R2) reads need
 * to be combined into a single interleaved stream.
 *
 * @example
 * // Basic interleaving without validation
 * const forward = seqops("reads_R1.fastq");
 * const reverse = seqops("reads_R2.fastq");
 * forward.interleave(reverse);
 *
 * @example
 * // With ID validation for paired-end reads
 * forward.interleave(reverse, { validateIds: true });
 *
 * @example
 * // Custom ID comparison (ignore Illumina /1 /2 suffixes)
 * forward.interleave(reverse, {
 *   validateIds: true,
 *   idComparator: (a, b) => {
 *     const stripSuffix = (id: string) => id.replace(/\/[12]$/, "");
 *     return stripSuffix(a) === stripSuffix(b);
 *   }
 * });
 */

/**
 * Configuration options for interleaving two sequence streams
 *
 * Discriminated union supporting two modes:
 * - Strict mode (default): Fails on length mismatch, with optional ID validation
 * - Lossless mode: Preserves all sequences, no ID validation allowed
 *
 * Type system ensures invalid combinations are impossible.
 */
export type InterleaveOptions =
  | {
      /**
       * Validate that sequence IDs match between corresponding pairs
       *
       * When enabled, throws an error if the IDs of sequences at the same
       * position in both streams don't match. Useful for ensuring paired-end
       * reads are properly aligned.
       *
       * For Illumina paired-end data, forward reads often have IDs like
       * "READ_001/1" and reverse reads "READ_001/2". Use a custom `idComparator`
       * to handle these suffix differences.
       *
       * @default false (implicit)
       *
       * @example
       * // Strict ID matching
       * forward.interleave(reverse, { validateIds: true });
       * // Throws if forward ID "read_1" doesn't match reverse ID "read_2"
       *
       * @example
       * // With custom comparator for Illumina format
       * forward.interleave(reverse, {
       *   validateIds: true,
       *   idComparator: (a, b) => a.replace(/\/[12]$/, "") === b.replace(/\/[12]$/, "")
       * });
       * // Matches "READ_001/1" with "READ_001/2"
       */
      readonly validateIds?: false;

      /**
       * Custom function to compare sequence IDs for validation
       *
       * Only used when `validateIds` is true. Allows flexible ID comparison
       * logic for different sequencing platforms and naming conventions.
       *
       * The function receives IDs from the left (forward) and right (reverse)
       * streams and should return true if they represent a valid pair.
       *
       * @param idA - ID from the left/forward stream
       * @param idB - ID from the right/reverse stream
       * @returns true if IDs represent a valid pair, false otherwise
       *
       * @default (a, b) => a === b
       *
       * @example
       * // Default: exact string matching
       * (idA, idB) => idA === idB
       *
       * @example
       * // Illumina paired-end: ignore /1 and /2 suffixes
       * (idA, idB) => {
       *   const stripSuffix = (id: string) => id.replace(/\/[12]$/, "");
       *   return stripSuffix(idA) === stripSuffix(idB);
       * }
       *
       * @example
       * // Case-insensitive matching
       * (idA, idB) => idA.toLowerCase() === idB.toLowerCase()
       *
       * @example
       * // Match by prefix (first 10 characters)
       * (idA, idB) => idA.substring(0, 10) === idB.substring(0, 10)
       */
      readonly idComparator?: (idA: string, idB: string) => boolean;

      /**
       * Strict mode (default): Fails on length mismatch
       *
       * - Use for paired-end reads where counts should match exactly
       * - Prevents silent data loss
       * - Helps detect file pairing errors
       * - Optionally validates IDs at each position
       */
      readonly mode?: "strict";
    }
  | {
      /**
       * Strict mode with mandatory ID validation
       *
       * - Validates that IDs match at each paired position
       * - Throws error on ID mismatch
       * - Also throws on length mismatch
       * - Use for paired-end reads where perfect alignment is required
       */
      readonly validateIds: true;

      /**
       * Custom function to compare sequence IDs for validation
       *
       * Only used when `validateIds` is true. Allows flexible ID comparison
       * logic for different sequencing platforms and naming conventions.
       *
       * The function receives IDs from the left (forward) and right (reverse)
       * streams and should return true if they represent a valid pair.
       *
       * @param idA - ID from the left/forward stream
       * @param idB - ID from the right/reverse stream
       * @returns true if IDs represent a valid pair, false otherwise
       *
       * @default (a, b) => a === b
       */
      readonly idComparator?: (idA: string, idB: string) => boolean;

      /**
       * Strict mode (default): Fails on length mismatch
       */
      readonly mode?: "strict";
    }
  | {
      /**
       * Lossless mode: Preserves all sequences from both streams
       *
       * - Interleaves paired sequences
       * - Yields remaining unpaired sequences after one stream exhausts
       * - Calls onUnpaired callback with statistics
       * - Use when unpaired sequences are expected (e.g., post-QC filtering)
       * - ID validation NOT supported in this mode (partial validation would be confusing)
       */
      readonly mode: "lossless";

      /**
       * Callback receiving statistics when one stream is longer than the other
       *
       * Only called when streams have different lengths.
       * Receives count of paired sequences and unpaired sequence details.
       *
       * @param stats - Statistics about paired and unpaired sequences
       *
       * @example
       * onUnpaired: (stats) => {
       *   console.log(`Paired: ${stats.pairedCount}`);
       *   console.log(`Unpaired from ${stats.unpairedSource}: ${stats.unpairedCount}`);
       * }
       */
      readonly onUnpaired?: (stats: UnpairedStats) => void;
    };

/**
 * Statistics about unpaired sequences after interleaving
 *
 * Provided to the onUnpaired callback when mode="lossless"
 * and stream lengths differ.
 */
export interface UnpairedStats {
  /** Number of successfully paired sequences */
  readonly pairedCount: number;

  /** Which stream had unpaired sequences */
  readonly unpairedSource: "left" | "right";

  /** Count of unpaired sequences */
  readonly unpairedCount: number;
}

/**
 * Processor for interleaving two sequence streams in alternating order
 *
 * Combines two streams by alternating elements: left, right, left, right, etc.
 * This is the core implementation used by the `.interleave()` method on SeqOps.
 *
 * **Key Behaviors**:
 * - **Alternating order**: Always yields left element, then right element, then left, etc.
 * - **Strict by default**: Throws error if stream lengths differ (prevents data loss)
 * - **Lossless mode**: Optional mode to preserve unpaired sequences
 * - **Same-type constraint**: Both streams must contain the same sequence type for type safety
 * - **Optional validation**: Can verify that sequence IDs match at each position
 *
 * **Common Use Cases**:
 * - Illumina paired-end reads: Combine R1/R2 files into single interleaved stream
 * - Merging technical replicates: Interleave before processing
 * - Creating balanced datasets: Alternate between two sources for fairness
 * - A/B stream combination: Mix two streams with guaranteed alternation
 *
 * @template T - The sequence type (must extend AbstractSequence)
 *
 * @example
 * // Basic usage (typically called via SeqOps.interleave())
 * const processor = new InterleaveProcessor<FastqSequence>();
 * const interleaved = processor.process(forwardStream, reverseStream);
 *
 * @example
 * // With ID validation for paired-end reads
 * const processor = new InterleaveProcessor<FastqSequence>();
 * const interleaved = processor.process(
 *   forwardStream,
 *   reverseStream,
 *   { validateIds: true }
 * );
 */
export class InterleaveProcessor<T extends AbstractSequence> {
  /**
   * Interleave two sequence streams in alternating order
   *
   * Yields sequences by alternating between source1 (left/forward) and
   * source2 (right/reverse). Stops when either stream is exhausted.
   *
   * @param source1 - First stream (left/forward sequences)
   * @param source2 - Second stream (right/reverse sequences)
   * @param options - Interleaving options (validation, custom comparator)
   * @returns Async iterable yielding interleaved sequences
   *
   * @throws Error when validateIds is true and IDs don't match
   */
  async *process(
    source1: AsyncIterable<T>,
    source2: AsyncIterable<T>,
    options: InterleaveOptions = {}
  ): AsyncIterable<T> {
    // Extract options with defaults for discriminated union
    const validateIds = "validateIds" in options ? options.validateIds : false;
    const idComparator =
      "idComparator" in options && options.idComparator
        ? options.idComparator
        : (a: string, b: string) => a === b;
    const mode = "mode" in options ? options.mode : "strict";
    const onUnpaired = "onUnpaired" in options ? options.onUnpaired : undefined;

    // Create async iterators for both streams
    const iter1 = source1[Symbol.asyncIterator]();
    const iter2 = source2[Symbol.asyncIterator]();

    // Track paired count for error messages and statistics
    let pairedCount = 0;

    // Main interleaving loop
    while (true) {
      // Fetch from both streams in parallel for efficiency
      const [result1, result2] = await Promise.all([iter1.next(), iter2.next()]);

      // Both exhausted - perfect match, exit cleanly
      if (result1.done && result2.done) {
        return;
      }

      // Length mismatch detected - handle based on mode
      if (result1.done || result2.done) {
        const exhaustedStream = result1.done ? "left" : "right";
        const remainingStream = result1.done ? "right" : "left";

        // STRICT MODE (default): Fail fast on mismatch
        if (mode === "strict") {
          throw new Error(
            `Interleave failed: ${exhaustedStream} stream exhausted after ${pairedCount} sequences, ` +
              `but ${remainingStream} stream continues.\n\n` +
              `This usually indicates:\n` +
              `  1. Mismatched input files (wrong R1/R2 pairing)\n` +
              `  2. Quality filtering applied to only one file\n` +
              `  3. Incomplete data transfer or corruption\n\n` +
              `If unpaired sequences are expected, use mode="lossless" to preserve them.`
          );
        }

        // LOSSLESS MODE: Preserve unpaired sequences
        const unpairedIterator = result1.done ? iter2 : iter1;
        const firstUnpaired = result1.done ? result2.value : result1.value;
        const unpairedSource = result1.done ? "right" : "left";

        // Yield first unpaired sequence
        yield firstUnpaired;
        let unpairedCount = 1;

        // Drain remaining sequences
        for await (const seq of this.drainIterator(unpairedIterator)) {
          yield seq;
          unpairedCount++;
        }

        // Report statistics via callback
        if (onUnpaired) {
          onUnpaired({
            pairedCount,
            unpairedSource,
            unpairedCount,
          });
        }

        return;
      }

      const seq1 = result1.value;
      const seq2 = result2.value;

      // Validate IDs match if requested (critical for paired-end reads)
      if (validateIds && !idComparator(seq1.id, seq2.id)) {
        throw new Error(
          `ID mismatch at position ${pairedCount}: ` + `left="${seq1.id}", right="${seq2.id}"`
        );
      }

      // Yield in left-right order (forward, then reverse for paired-end reads)
      yield seq1;
      yield seq2;

      // Track paired count for error reporting
      pairedCount++;
    }
  }

  /**
   * Drain remaining sequences from an iterator
   *
   * Used in lossless mode to consume unpaired sequences after
   * one stream is exhausted.
   *
   * @param iter - AsyncIterator to drain
   * @returns AsyncIterable of remaining values
   */
  private async *drainIterator<T>(iter: AsyncIterator<T>): AsyncIterable<T> {
    let result = await iter.next();
    while (!result.done) {
      yield result.value;
      result = await iter.next();
    }
  }
}
