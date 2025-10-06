/**
 * Rename duplicated sequence IDs to make them unique
 *
 * Appends numeric suffixes to duplicate IDs while preserving sequence data.
 * Implements seqkit rename functionality for genomic data processing workflows.
 *
 * Genomic Context: Duplicate sequence IDs commonly arise when merging datasets
 * from multiple sources or processing PCR replicates. Unique identifiers are
 * essential for downstream analysis tools and database integrity.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { type } from "arktype";
import { ValidationError } from "../errors";
import type { AbstractSequence } from "../types";

/**
 * Options for renaming duplicate sequence IDs
 *
 * Matches seqkit rename functionality with type-safe TypeScript interface.
 * All options are optional with sensible defaults following seqkit conventions.
 */
export interface RenameOptions {
  /**
   * Check duplication by full name instead of just ID
   *
   * When true, considers both ID and description for duplicate detection.
   * When false (default), only the sequence ID is used.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // byName: false (default) - Same ID, different descriptions = first is duplicate
   * // >seq1 comment1
   * // >seq1 comment2  → renamed to "seq1_2"
   *
   * // byName: true - Full name must match
   * // >seq1 comment1
   * // >seq1 comment2  → NOT renamed (different full names)
   * ```
   */
  readonly byName?: boolean;

  /**
   * Separator between original ID and counter
   *
   * Must be a non-empty string. Common choices: "_", ".", "-", "|"
   *
   * @default "_"
   *
   * @example
   * ```typescript
   * separator: "_"  → "seq1_2", "seq1_3"
   * separator: "."  → "seq1.2", "seq1.3"
   * separator: "-"  → "seq1-2", "seq1-3"
   * ```
   */
  readonly separator?: string;

  /**
   * Starting count number for duplicates
   *
   * Must be a non-negative number (>= 0). The first duplicate gets this number,
   * subsequent duplicates increment from here.
   *
   * @default 2
   *
   * @example
   * ```typescript
   * startNum: 2  → "seq1", "seq1_2", "seq1_3"  (first unchanged)
   * startNum: 1  → "seq1", "seq1_1", "seq1_2"  (first unchanged unless renameFirst)
   * startNum: 0  → "seq1", "seq1_0", "seq1_1"  (zero-based indexing)
   * ```
   */
  readonly startNum?: number;

  /**
   * Also rename the first occurrence
   *
   * When true, ALL occurrences get suffixes including the first.
   * When false (default), first occurrence keeps original ID.
   *
   * @default false
   *
   * @example
   * ```typescript
   * renameFirst: false  → "seq1", "seq1_2", "seq1_3"
   * renameFirst: true   → "seq1_2", "seq1_3", "seq1_4"
   *
   * // Common pattern: renameFirst with startNum: 1
   * renameFirst: true, startNum: 1  → "seq1_1", "seq1_2", "seq1_3"
   * ```
   */
  readonly renameFirst?: boolean;
}

/**
 * ArkType schema for RenameOptions validation
 *
 * Enforces narrow types with runtime validation:
 * - separator: non-empty string (string.length > 0)
 * - startNum: non-negative number (number >= 0) - Note: allows decimals, docs recommend integers
 * - byName, renameFirst: boolean flags
 *
 * Parse, don't validate: Returns typed result or error object.
 *
 * Verified behavior:
 * - ✅ Rejects empty separator
 * - ✅ Rejects negative startNum
 * - ✅ Accepts zero startNum (seqkit compatible)
 * - ⚠️ Accepts decimal startNum (ArkType limitation - no integer-only constraint)
 */
const RenameOptionsSchema = type({
  "byName?": "boolean",
  "separator?": "string>0", // Non-empty string
  "startNum?": "number>=0", // Non-negative number (seqkit allows 0)
  "renameFirst?": "boolean",
});

/**
 * Rename duplicated sequence IDs by appending counter suffixes
 *
 * Processes sequences in streaming fashion, tracking ID occurrences and
 * appending numeric suffixes to ensure uniqueness. Memory usage is O(U)
 * where U is the number of unique IDs encountered.
 *
 * Algorithm:
 * 1. Extract key (ID or full name) from each sequence
 * 2. Track occurrence count in Map
 * 3. For first occurrence: output unchanged (unless renameFirst=true)
 * 4. For subsequent occurrences: append separator + count
 *
 * @param source - Input sequence iterable
 * @param options - Rename configuration options
 * @yields Sequences with unique IDs
 *
 * @example
 * ```typescript
 * // Basic usage - duplicate IDs get "_2", "_3" suffixes
 * const unique = rename(sequences);
 *
 * // Rename all occurrences including first
 * const numbered = rename(sequences, {
 *   renameFirst: true,
 *   startNum: 1
 * });
 * // Result: "id_1", "id_2", "id_3"
 *
 * // Custom separator
 * const dotted = rename(sequences, { separator: "." });
 * // Result: "id", "id.2", "id.3"
 * ```
 *
 * @throws {ValidationError} When options are invalid (empty separator, negative startNum)
 * @performance O(N) time, O(U) memory where U = unique IDs
 * @since v0.1.0
 */
export async function* rename<T extends AbstractSequence>(
  source: AsyncIterable<T>,
  options: RenameOptions = {}
): AsyncIterable<T> {
  // Validate options with ArkType schema
  const validationResult = RenameOptionsSchema(options);
  if (validationResult instanceof type.errors) {
    throw new ValidationError(`Invalid rename options: ${validationResult.summary}`);
  }

  // Extract and apply defaults
  const byName = options.byName ?? false;
  const separator = options.separator ?? "_";
  const startNum = options.startNum ?? 2;
  const renameFirst = options.renameFirst ?? false;

  // Track occurrence count for each ID (or full name)
  const counts = new Map<string, number>();

  for await (const seq of source) {
    // Determine the key for duplicate detection
    const key = byName ? getFullName(seq) : seq.id;

    // Check if this ID has been seen before
    const previousCount = counts.get(key);

    if (previousCount === undefined) {
      // First occurrence
      counts.set(key, 1);
      if (renameFirst) {
        // Rename first occurrence with startNum
        const renamedSeq = { ...seq, id: `${seq.id}${separator}${startNum}` };
        yield renamedSeq;
      } else {
        // Keep first occurrence unchanged
        yield seq;
      }
    } else {
      // Subsequent occurrence - increment count
      const newCount = previousCount + 1;
      counts.set(key, newCount);

      // Calculate suffix: startNum + offset
      // If renameFirst=true: 1st gets startNum, 2nd gets startNum+1, 3rd gets startNum+2
      // If renameFirst=false: 1st unchanged, 2nd gets startNum, 3rd gets startNum+1
      const offset = renameFirst ? newCount - 1 : newCount - 2;
      const suffixNum = startNum + offset;

      const renamedSeq = { ...seq, id: `${seq.id}${separator}${suffixNum}` };
      yield renamedSeq;
    }
  }
}

/**
 * Extract full name from sequence (ID + description if present)
 *
 * Used when byName=true to detect duplicates based on complete header line
 * rather than just the sequence ID.
 *
 * @param seq - Sequence to extract full name from
 * @returns Full name string (ID + description if present)
 */
function getFullName(seq: AbstractSequence): string {
  return seq.description ? `${seq.id} ${seq.description}` : seq.id;
}
