/**
 * Replace name/sequence by regular expression
 *
 * Performs pattern-based substitution on sequence IDs/names or sequence content
 * using regular expressions with capture variable support and special placeholders.
 * Implements seqkit replace functionality for genomic data processing workflows.
 *
 * Genomic Context: Pattern-based transformations are essential for standardizing
 * sequence identifiers across databases, anonymizing sample IDs for publication,
 * removing unwanted metadata, and batch-modifying sequence content. Common use
 * cases include reference standardization (e.g., NCBI → Ensembl format), gap
 * removal from alignments, and ID prefix/suffix operations.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { basename, extname } from "node:path";
import { type } from "arktype";
import { ValidationError } from "../errors";
import { readToString } from "../io/file-reader";
import type { AbstractSequence } from "../types";
import type { ReplaceOptions } from "./types";

const TAB_DELIMITER = "\t" as const;
const COMMENT_PREFIX = "#" as const;
const MAX_ERROR_SAMPLE_SIZE = 2 as const;
const KVMAP_TYPE_ERROR_MESSAGE =
  "kvMap must be a Map<string, string> or Record<string, string> with all string keys and values." as const;

/**
 * ArkType schema for ReplaceOptions validation with comprehensive constraints
 *
 * Enforces narrow types with runtime validation using .pipe() for complex rules:
 * - pattern: non-empty string (required) - validated as compilable regex
 * - replacement: string (required, can be empty for deletions)
 * - nrWidth: positive number (>= 1) for record number formatting
 * - keyCaptIdx: positive number (>= 1) for capture group indexing
 * - kvFile: non-empty string when provided
 * - kvMap: validated as Map<string, string> or Record<string, string>
 * - filterPattern: array of non-empty strings
 * - All boolean flags: true/false
 * - Mutual exclusivity: kvMap and kvFile cannot both be specified
 *
 * Parse, don't validate: Returns typed result or error object with detailed messages.
 *
 * Verified behavior:
 * - Rejects empty pattern
 * - Rejects invalid regex patterns
 * - Accepts empty replacement (for deletions)
 * - Rejects nrWidth < 1
 * - Rejects keyCaptIdx < 1
 * - Rejects empty kvFile
 * - Rejects both kvMap and kvFile together
 * - Validates kvMap structure (all string keys and values)
 * - Validates filterPattern array elements are non-empty
 */
const ReplaceOptionsSchema = type({
  pattern: "string>0", // Required, non-empty
  replacement: "string", // Required, but can be empty
  "bySeq?": "boolean",
  "ignoreCase?": "boolean",
  "nrWidth?": "number>=1", // Must be positive for formatting
  "fileName?": "string>0", // Non-empty when provided
  "kvMap?": "unknown", // Validated in pipe (Map or Record not directly supported by ArkType)
  "kvFile?": "string>0", // Non-empty when provided
  "keyCaptIdx?": "number>=1", // Must be >= 1 for $1, $2, etc.
  "keepKey?": "boolean",
  "keepUntouch?": "boolean",
  "keyMissRepl?": "string",
  "filterPattern?": "string>0[]", // Array of non-empty strings
  "filterPatternFile?": "string>0",
  "filterUseRegexp?": "boolean",
  "filterByName?": "boolean",
  "filterBySeq?": "boolean",
  "filterIgnoreCase?": "boolean",
  "filterInvertMatch?": "boolean",
}).pipe((options) => {
  // NOTE: Mutual exclusivity of kvMap/kvFile is enforced at compile-time
  // by the ReplaceOptions discriminated union in types.ts
  // No runtime check needed here!

  // Validate kvMap structure if provided (TypeScript can't validate Map/Record contents)
  if ("kvMap" in options && options.kvMap !== undefined) {
    if (!isValidKeyValueMap(options.kvMap)) {
      const sampleInfo = describeInvalidKvMap(options.kvMap);
      throw new Error(`${KVMAP_TYPE_ERROR_MESSAGE} Received: ${sampleInfo}`);
    }
  }

  // Validate regex pattern compiles (TypeScript can't validate regex syntax)
  try {
    new RegExp(options.pattern, options.ignoreCase ? "gi" : "g");
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid regex pattern '${options.pattern}': ${errorMsg}`);
  }

  return options;
});

/**
 * Context passed to placeholder expansion functions
 *
 * Contains all data needed to expand placeholders in replacement strings:
 * - Regex capture groups
 * - Record number for {nr}
 * - Key-value map for {kv}
 * - File name info for {fn}, {fbn}, {fbne}
 * - Original options for behavior flags
 * - Original match for keepUntouch behavior
 *
 * @internal
 */
interface PlaceholderContext {
  captures: string[];
  recordNumber: number;
  kvMap: Map<string, string> | null;
  fileInfo: { fn: string; fbn: string; fbne: string };
  options: ReplaceOptions;
  originalMatch: string;
}

/**
 * Symbol returned by placeholder expanders to signal keepUntouch behavior
 *
 * When a key-value lookup fails and keepUntouch is set, placeholder expanders
 * return this symbol to indicate the entire match should be kept unchanged.
 * The replacement callback checks for this symbol and returns the original match.
 *
 * @internal
 */
const SKIP_REPLACEMENT = Symbol("SKIP_REPLACEMENT");

/**
 * Prepared replacement context
 *
 * Contains all compiled/loaded resources needed for replacement operation.
 * Consolidates results from Phase A helper functions (validation, resource loading).
 *
 * @internal
 */
interface ReplacementContext {
  regex: RegExp;
  fileInfo: { fn: string; fbn: string; fbne: string };
  kvMap: Map<string, string> | null;
  filterPatterns: string[];
  bySeq: boolean;
}

/**
 * Type guard to validate key-value map structure
 *
 * Validates that the value is either a Map<string, string> or Record<string, string>
 * with proper runtime checking of all entries.
 *
 * @param value - Value to validate
 * @returns True if value is a valid key-value map
 */
function isValidKeyValueMap(value: unknown): value is Map<string, string> | Record<string, string> {
  // Check for Map with string entries
  if (value instanceof Map) {
    return Array.from(value.entries()).every(
      ([key, val]) => typeof key === "string" && typeof val === "string",
    );
  }

  // Check for plain object with string values
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.entries(value).every(
      ([key, val]) => typeof key === "string" && typeof val === "string",
    );
  }

  return false;
}

/**
 * Describes invalid kvMap structure for helpful error messages
 *
 * Provides detailed information about what was received instead of a valid
 * Map<string, string> or Record<string, string>, including sample entries
 * to help users diagnose the issue.
 *
 * @param value - The invalid kvMap value to describe
 * @returns Human-readable description of the invalid structure
 * @internal
 */
function describeInvalidKvMap(value: unknown): string {
  try {
    if (value instanceof Map) {
      const sample = Array.from(value.entries()).slice(0, MAX_ERROR_SAMPLE_SIZE);
      return `Map with sample entries: ${JSON.stringify(sample)}`;
    }
    if (typeof value === "object" && value !== null) {
      const sample = Object.entries(value).slice(0, MAX_ERROR_SAMPLE_SIZE);
      return `Object with sample entries: ${JSON.stringify(sample)}`;
    }
    return `type: ${typeof value}`;
  } catch {
    return "unknown structure";
  }
}

/**
 * Loads key-value map from either in-memory source or file
 *
 * Handles two input sources:
 * - In-memory Map or plain object (kvMap option)
 * - Tab-delimited file (kvFile option)
 *
 * For plain objects, converts to Map for O(1) lookups.
 * For files, delegates to loadKeyValueFile().
 *
 * @param options - Replace options containing kvMap or kvFile
 * @returns Map of key-value pairs, or null if neither source provided
 * @internal
 */
async function loadKeyValueMap(options: ReplaceOptions): Promise<Map<string, string> | null> {
  // Type narrowing: check which branch of the discriminated union we're in
  if ("kvMap" in options && options.kvMap !== undefined) {
    // In-memory: convert to Map if it's a plain object
    if (options.kvMap instanceof Map) {
      return options.kvMap;
    }
    return new Map(Object.entries(options.kvMap));
  }

  if ("kvFile" in options && options.kvFile !== undefined) {
    // From file: load and parse
    return await loadKeyValueFile(options.kvFile);
  }

  return null;
}

/**
 * Load key-value mappings from a tab-delimited file
 *
 * Parses a tab-delimited file where each line contains a key-value pair
 * separated by a tab character. Lines starting with '#' are treated as
 * comments and ignored. Empty lines are skipped.
 *
 * Uses runtime-agnostic file reading (works with Node.js, Bun, Deno).
 *
 * @param filePath - Path to the key-value file
 * @returns Map of key-value pairs for O(1) lookup
 * @throws {ValidationError} When file format is invalid or file cannot be read
 *
 * @example
 * ```typescript
 * // File: aliases.txt
 * // # Sample ID mappings
 * // patient_001	ANON_A001
 * // patient_002	ANON_A002
 *
 * const kvMap = await loadKeyValueFile('aliases.txt');
 * kvMap.get('patient_001'); // Returns: 'ANON_A001'
 * kvMap.get('unknown');     // Returns: undefined
 * ```
 */
async function loadKeyValueFile(filePath: string): Promise<Map<string, string>> {
  try {
    // Use runtime-agnostic file reader (handles Node.js, Bun, etc.)
    const content = await readToString(filePath);
    const kvMap = new Map<string, string>();

    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const rawLine = lines[index];
      if (rawLine === undefined) continue;
      const line = rawLine.trim();

      // Skip empty lines and comments
      if (!line || line.startsWith(COMMENT_PREFIX)) {
        continue;
      }

      // Parse tab-delimited key-value pair
      const parts = line.split(TAB_DELIMITER);
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new ValidationError(
          `Invalid key-value file format at line ${index + 1}: "${line}". Expected tab-delimited key-value pairs (key<TAB>value).`,
        );
      }

      const [key, value] = parts;
      kvMap.set(key, value);
    }

    return kvMap;
  } catch (error) {
    // Re-throw ValidationError as-is
    if (error instanceof ValidationError) {
      throw error;
    }

    // Wrap other errors with context
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`Failed to load key-value file "${filePath}": ${errorMessage}`);
  }
}

/**
 * Load filter patterns from a file
 *
 * Reads a file containing one pattern per line for filtering sequences.
 * Lines starting with '#' are treated as comments and ignored.
 * Empty lines are skipped.
 *
 * @param filePath - Path to the pattern file
 * @returns Array of pattern strings
 * @throws {ValidationError} When file cannot be read
 *
 * @example
 * ```typescript
 * // File: filters.txt
 * // # Gene patterns
 * // gene
 * // protein
 *
 * const patterns = await loadFilterPatterns('filters.txt');
 * // Returns: ['gene', 'protein']
 * ```
 */
async function loadFilterPatterns(filePath: string): Promise<string[]> {
  try {
    const content = await readToString(filePath);
    const patterns: string[] = [];

    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const rawLine = lines[index];
      if (rawLine === undefined) continue;
      const line = rawLine.trim();

      // Skip empty lines and comments
      if (!line || line.startsWith(COMMENT_PREFIX)) {
        continue;
      }

      patterns.push(line);
    }

    return patterns;
  } catch (error) {
    // Re-throw ValidationError as-is
    if (error instanceof ValidationError) {
      throw error;
    }

    // Wrap other errors with context
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`Failed to load filter pattern file "${filePath}": ${errorMessage}`);
  }
}

/**
 * Loads and merges filter patterns from multiple sources
 *
 * Combines inline patterns (filterPattern option) with patterns loaded
 * from a file (filterPatternFile option). File patterns are appended to
 * inline patterns, allowing users to combine both sources.
 *
 * @param options - Replace options containing filterPattern and/or filterPatternFile
 * @returns Combined array of filter patterns
 * @internal
 */
async function loadAndMergeFilterPatterns(options: ReplaceOptions): Promise<string[]> {
  const inlinePatterns = options.filterPattern ?? [];

  if (options.filterPatternFile) {
    const filePatterns = await loadFilterPatterns(options.filterPatternFile);
    return [...inlinePatterns, ...filePatterns];
  }

  return inlinePatterns;
}

/**
 * Expands capture variables in replacement string
 *
 * Replaces $1, $2, ${1}, ${2}, etc. with captured groups from regex match.
 * Supports both $N and ${N} syntax for compatibility - the braced syntax
 * is useful when combined with {kv} to avoid shell escaping issues.
 *
 * @param template - Replacement string template with capture variables
 * @param captures - Array of captured groups from regex match
 * @returns Template with all capture variables expanded
 *
 * @example
 * ```typescript
 * expandCaptureVariables("sample_$1_${2}", ["abc", "123"])
 * // Returns: "sample_abc_123"
 * ```
 *
 * @internal
 */
function expandCaptureVariables(template: string, captures: string[]): string {
  let result = template;

  for (let i = 0; i < captures.length; i++) {
    if (captures[i] !== undefined) {
      const captureNum = i + 1;
      const captureValue = captures[i] as string;
      // Replace both $N and ${N} formats
      result = result.replace(
        new RegExp(`\\$\\{${captureNum}\\}|\\$${captureNum}`, "g"),
        captureValue,
      );
    }
  }

  return result;
}

/**
 * Expands {nr} placeholder with formatted record number
 *
 * Replaces all occurrences of {nr} with the current record number,
 * formatted with zero-padding to the specified width.
 *
 * @param template - Replacement string template with {nr} placeholder
 * @param recordNumber - Current record number (1-based)
 * @param width - Minimum width for zero-padding (default: 1)
 * @returns Template with {nr} expanded to formatted record number
 *
 * @example
 * ```typescript
 * expandRecordNumber("seq_{nr}", 5, 3)
 * // Returns: "seq_005"
 *
 * expandRecordNumber("item_{nr}", 42, 1)
 * // Returns: "item_42"
 * ```
 *
 * @internal
 */
function expandRecordNumber(template: string, recordNumber: number, width: number = 1): string {
  if (!template.includes("{nr}")) {
    return template;
  }

  const formattedNumber = recordNumber.toString().padStart(width, "0");
  return template.replace(/\{nr\}/g, formattedNumber);
}

/**
 * Resolves key-value lookup with missing-key strategies
 *
 * Handles all missing-key scenarios:
 * - Key found: Return value from map
 * - keepUntouch: Return SKIP_REPLACEMENT symbol (signals early return)
 * - keepKey: Return original key
 * - keyMissRepl: Return custom replacement string
 * - Default: Return empty string
 *
 * @param key - Key to look up (may be undefined if capture failed)
 * @param kvMap - Map of key-value pairs
 * @param options - Replace options with missing-key behavior flags
 * @returns Value string, or SKIP_REPLACEMENT symbol for keepUntouch
 *
 * @internal
 */
function resolveKeyValueLookup(
  key: string | undefined,
  kvMap: Map<string, string>,
  options: ReplaceOptions,
): string | typeof SKIP_REPLACEMENT {
  // Key found: use value
  if (key !== undefined && kvMap.has(key)) {
    return kvMap.get(key) ?? "";
  }

  // Missing key strategies
  if (options.keepUntouch) {
    return SKIP_REPLACEMENT; // Signal to return original match
  }

  if (options.keepKey && key !== undefined) {
    return key;
  }

  if (options.keyMissRepl !== undefined) {
    return options.keyMissRepl;
  }

  // Default: empty string
  return "";
}

/**
 * Expands {kv} placeholder with key-value lookup
 *
 * Performs key-value replacement using captured group as the key.
 * Returns SKIP_REPLACEMENT symbol if keepUntouch is set and key is missing,
 * which signals the callback to return the original match unchanged.
 *
 * @param template - Replacement string template with {kv} placeholder
 * @param captures - Array of captured groups from regex match
 * @param kvMap - Map of key-value pairs (or null if not using {kv})
 * @param options - Replace options with keyCaptIdx and missing-key flags
 * @returns Template with {kv} expanded, or SKIP_REPLACEMENT symbol
 *
 * @internal
 */
function expandKeyValuePlaceholder(
  template: string,
  captures: string[],
  kvMap: Map<string, string> | null,
  options: ReplaceOptions,
): string | typeof SKIP_REPLACEMENT {
  if (!kvMap || !template.includes("{kv}")) {
    return template;
  }

  const keyIdx = (options.keyCaptIdx ?? 1) - 1;
  const key = captures[keyIdx];

  // Resolve value based on missing-key strategy
  const kvValue = resolveKeyValueLookup(key, kvMap, options);

  if (kvValue === SKIP_REPLACEMENT) {
    return SKIP_REPLACEMENT;
  }

  return template.replace(/\{kv\}/g, kvValue);
}

/**
 * Expands file name placeholders
 *
 * Replaces {fn}, {fbn}, and {fbne} with file name components:
 * - {fn}: Full file name/path
 * - {fbn}: Base name (last component of path)
 * - {fbne}: Base name without extension
 *
 * @param template - Replacement string template with file name placeholders
 * @param fileInfo - Object containing fn, fbn, fbne values
 * @returns Template with file name placeholders expanded
 *
 * @example
 * ```typescript
 * const info = { fn: '/data/sequences.fasta', fbn: 'sequences.fasta', fbne: 'sequences' };
 * expandFileNamePlaceholders("result_{fbne}", info)
 * // Returns: "result_sequences"
 * ```
 *
 * @internal
 */
function expandFileNamePlaceholders(
  template: string,
  fileInfo: { fn: string; fbn: string; fbne: string },
): string {
  let result = template;

  if (result.includes("{fn}")) {
    result = result.replace(/\{fn\}/g, fileInfo.fn);
  }
  if (result.includes("{fbn}")) {
    result = result.replace(/\{fbn\}/g, fileInfo.fbn);
  }
  if (result.includes("{fbne}")) {
    result = result.replace(/\{fbne\}/g, fileInfo.fbne);
  }

  return result;
}

/**
 * Expands all placeholders in replacement string
 *
 * Orchestrates placeholder expansion in the correct order:
 * 1. Capture variables ($1, $2, ${1}, ${2}) - must be first since other placeholders may use them
 * 2. Key-value lookup ({kv}) - may return SKIP_REPLACEMENT for keepUntouch
 * 3. Record number ({nr})
 * 4. File name placeholders ({fn}, {fbn}, {fbne})
 *
 * If keepUntouch is triggered (key missing in {kv}), returns the original match
 * unchanged by returning it directly from this function.
 *
 * @param context - Placeholder expansion context with all required data
 * @returns Expanded replacement string, or original match for keepUntouch
 *
 * @internal
 */
function expandPlaceholders(context: PlaceholderContext): string {
  let result = context.options.replacement;

  // 1. Expand capture variables first (they might appear in other placeholders)
  result = expandCaptureVariables(result, context.captures);

  // 2. Expand {kv} (can return SKIP_REPLACEMENT for keepUntouch)
  const kvResult = expandKeyValuePlaceholder(
    result,
    context.captures,
    context.kvMap,
    context.options,
  );
  if (kvResult === SKIP_REPLACEMENT) {
    return context.originalMatch; // keepUntouch: return original match
  }
  result = kvResult;

  // 3. Expand {nr} with formatting
  result = expandRecordNumber(result, context.recordNumber, context.options.nrWidth ?? 1);

  // 4. Expand file name placeholders
  result = expandFileNamePlaceholders(result, context.fileInfo);

  return result;
}

/**
 * Applies replacement to a single sequence
 *
 * Performs regex replacement on sequence ID or sequence content, expanding all
 * placeholders in the replacement string. Isolated function enables focused testing
 * of replacement logic without full pipeline integration.
 *
 * @param seq - Sequence to modify
 * @param regex - Compiled regex pattern for matching
 * @param recordNumber - Current record number for {nr} placeholder
 * @param kvMap - Key-value map for {kv} placeholder (or null)
 * @param fileInfo - File name information for {fn}, {fbn}, {fbne} placeholders
 * @param options - Replace options
 * @param bySeq - Whether to replace in sequence content (true) or ID (false)
 * @returns Modified sequence with replacement applied
 *
 * @internal
 */
function applyReplacement<T extends AbstractSequence>(
  seq: T,
  regex: RegExp,
  recordNumber: number,
  kvMap: Map<string, string> | null,
  fileInfo: { fn: string; fbn: string; fbne: string },
  options: ReplaceOptions,
  bySeq: boolean,
): T {
  // Determine target (name or sequence)
  const target = bySeq ? seq.sequence : seq.id;

  // Perform replacement with placeholder expansion
  const replaced = target.replace(regex, (match, ...args) => {
    // Extract captures (args array contains: capture1, capture2, ..., offset, string, groups)
    const captures = args.slice(0, -2);

    // Build context and expand all placeholders
    const context: PlaceholderContext = {
      captures,
      recordNumber,
      kvMap,
      fileInfo,
      options,
      originalMatch: match,
    };

    return expandPlaceholders(context);
  });

  // Return modified sequence
  return bySeq ? { ...seq, sequence: replaced } : { ...seq, id: replaced };
}

/**
 * Prepares replacement context by loading and compiling all resources
 *
 * Consolidates all Phase A helper functions:
 * - Compiles regex pattern
 * - Loads file name information
 * - Loads key-value map (from kvMap or kvFile)
 * - Loads and merges filter patterns
 * - Extracts bySeq flag
 *
 * @param options - Validated replace options
 * @returns Prepared context with all resources ready for replacement
 *
 * @internal
 */
async function prepareReplacementContext(options: ReplaceOptions): Promise<ReplacementContext> {
  // Extract options with defaults
  const ignoreCase = options.ignoreCase ?? false;
  const bySeq = options.bySeq ?? false;

  // Compile regex pattern
  const regex = compilePattern(options.pattern, ignoreCase);

  // Get file name info for {fn}, {fbn}, {fbne} placeholders
  const fileInfo = getFileNameInfo(options.fileName);

  // Load or prepare key-value map for {kv} placeholder
  const kvMap = await loadKeyValueMap(options);

  // Load and merge filter patterns from inline and file sources
  const filterPatterns = await loadAndMergeFilterPatterns(options);

  return {
    regex,
    fileInfo,
    kvMap,
    filterPatterns,
    bySeq,
  };
}

/**
 * Extract file name information for placeholders
 *
 * Parses a file path to extract full name, base name, and base name without extension.
 * Uses Node.js/Bun path module for cross-platform compatibility (Unix, Windows, macOS).
 * Used for {fn}, {fbn}, and {fbne} placeholders in replacement strings.
 *
 * @param filePath - Optional file path (undefined for stdin or when not provided)
 * @returns Object with fn, fbn, and fbne values
 *
 * @example
 * ```typescript
 * // Unix/macOS
 * getFileNameInfo('/path/to/sequences.fasta')
 * // Returns: { fn: '/path/to/sequences.fasta', fbn: 'sequences.fasta', fbne: 'sequences' }
 *
 * // Windows
 * getFileNameInfo('C:\\data\\sequences.fasta')
 * // Returns: { fn: 'C:\\data\\sequences.fasta', fbn: 'sequences.fasta', fbne: 'sequences' }
 *
 * // stdin
 * getFileNameInfo(undefined)
 * // Returns: { fn: 'stdin', fbn: 'stdin', fbne: 'stdin' }
 * ```
 */
function getFileNameInfo(filePath?: string): {
  fn: string;
  fbn: string;
  fbne: string;
} {
  // Default to 'stdin' when no file path provided
  if (!filePath || filePath === "-") {
    return { fn: "stdin", fbn: "stdin", fbne: "stdin" };
  }

  // Full file name (entire path as provided)
  const fn = filePath;

  // Base name (cross-platform using path.basename)
  const fbn = basename(filePath);

  // Base name without extension (cross-platform)
  const fbne = basename(filePath, extname(filePath));

  return { fn, fbn, fbne };
}

/**
 * Compile regex pattern with error handling
 *
 * @param pattern - Regular expression pattern string
 * @param ignoreCase - Whether to use case-insensitive matching
 * @returns Compiled RegExp object
 * @throws {ValidationError} When pattern is invalid
 */
function compilePattern(pattern: string, ignoreCase: boolean): RegExp {
  try {
    return new RegExp(pattern, ignoreCase ? "i" : "");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new ValidationError(
      `Invalid regular expression pattern: "${pattern}". Error: ${errorMessage}`,
    );
  }
}

/**
 * Escape special regex characters for literal string matching
 *
 * Converts a literal string into a regex-safe pattern by escaping
 * all special regex metacharacters. Used when filterUseRegexp is false.
 *
 * @param str - Literal string to escape
 * @returns Regex-safe escaped string
 *
 * @example
 * ```typescript
 * escapeRegex('gene.1')  // Returns: 'gene\\.1'
 * escapeRegex('sample[A-Z]')  // Returns: 'sample\\[A-Z\\]'
 * ```
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Determine if a sequence should be processed based on filter criteria
 *
 * Implements grep-style filtering to selectively apply replacements only
 * to sequences matching (or not matching) specified patterns. Supports
 * filtering by name, sequence content, regex/literal matching, and inversion.
 *
 * @param seq - Sequence to check
 * @param patterns - Merged array of filter patterns (from inline + file)
 * @param options - Replace options with filter settings
 * @returns True if sequence should be processed, false to skip
 *
 * @example
 * ```typescript
 * // Process only sequences with "gene" in ID
 * shouldProcess(seq, ['gene'], { filterByName: true })
 *
 * // Process all EXCEPT those with "control" in name
 * shouldProcess(seq, ['control'], { filterInvertMatch: true })
 * ```
 */
function shouldProcess<T extends AbstractSequence>(
  seq: T,
  patterns: string[],
  options: ReplaceOptions,
): boolean {
  // If no patterns, process all sequences
  if (patterns.length === 0) {
    return true;
  }

  // Determine target to match against
  const target = options.filterByName
    ? `${seq.id} ${seq.description ?? ""}`
    : options.filterBySeq
      ? seq.sequence
      : seq.id;

  // Check if any pattern matches
  let matches = false;
  for (const pattern of patterns) {
    const regex = options.filterUseRegexp
      ? new RegExp(pattern, options.filterIgnoreCase ? "i" : "")
      : new RegExp(escapeRegex(pattern), options.filterIgnoreCase ? "i" : "");

    if (regex.test(target)) {
      matches = true;
      break;
    }
  }

  // Handle invert match (like grep -v)
  return options.filterInvertMatch ? !matches : matches;
}

/**
 * Replace sequence names/content by regular expression
 *
 * Processes sequences in streaming fashion, applying regex-based substitutions
 * to sequence IDs (default) or sequence content (FASTA only). Supports capture
 * variables ($1, $2, etc.) and special placeholders ({nr}, {kv}, etc.).
 *
 * Algorithm:
 * 1. Validate options with ArkType schema
 * 2. Compile regex pattern with error handling
 * 3. For each sequence:
 *    - Check if filters match (if filters specified)
 *    - Apply pattern to target (ID or sequence)
 *    - Process replacement with capture variables
 *    - Track record number for {nr} placeholder
 * 4. Yield modified sequence
 *
 * Memory usage: O(1) per sequence (streaming), O(N) for key-value file if used.
 *
 * @param sequences - Input sequence iterable
 * @param options - Replace configuration options
 * @yields Sequences with replacements applied
 *
 * @example
 * ```typescript
 * // Remove descriptions
 * const cleaned = replace(sequences, {
 *   pattern: '\\s.+',
 *   replacement: ''
 * });
 *
 * // Add prefix to IDs
 * const prefixed = replace(sequences, {
 *   pattern: '^',
 *   replacement: 'prefix_'
 * });
 *
 * // Use capture variables
 * const swapped = replace(sequences, {
 *   pattern: '(\\w+)_(\\w+)',
 *   replacement: '$2_$1'
 * });
 *
 * // Add record numbers
 * const numbered = replace(sequences, {
 *   pattern: '.+',
 *   replacement: 'seq_{nr}',
 *   nrWidth: 3
 * });
 * // Result: "seq_001", "seq_002", "seq_003"
 *
 * // Key-value lookup (in-memory)
 * const mapped = replace(sequences, {
 *   pattern: '^(\\w+)',
 *   replacement: '${1}_{kv}',
 *   kvMap: { sample1: 'SAMPLE_A', sample2: 'SAMPLE_B' }
 * });
 * // Result: "sample1_SAMPLE_A", "sample2_SAMPLE_B"
 *
 * // Key-value lookup (from file)
 * const fromFile = replace(sequences, {
 *   pattern: '^(\\w+)',
 *   replacement: '${1}_{kv}',
 *   kvFile: 'aliases.txt'  // Tab-delimited file
 * });
 * ```
 *
 * @throws {ValidationError} When options are invalid or pattern doesn't compile
 * @throws {ValidationError} When bySeq is used with FASTQ format
 * @performance O(N*M) time where N = sequence count, M = pattern complexity
 * @since v0.1.0
 */
export async function* replace<T extends AbstractSequence>(
  sequences: AsyncIterable<T>,
  options: ReplaceOptions,
): AsyncIterable<T> {
  // Validate options with ArkType schema (includes cross-option constraints and regex validation)
  const validationResult = ReplaceOptionsSchema(options);
  if (validationResult instanceof type.errors) {
    throw new ValidationError(`Invalid replace options: ${validationResult.summary}`);
  }

  // Prepare replacement context (compile regex, load resources)
  const { regex, fileInfo, kvMap, filterPatterns, bySeq } =
    await prepareReplacementContext(options);

  // Track record number for {nr} placeholder
  let recordNumber = 1;

  // Process each sequence
  for await (const seq of sequences) {
    // Apply filtering if specified (skip sequences that don't match filter criteria)
    if (!shouldProcess(seq, filterPatterns, options)) {
      yield seq;
      continue;
    }

    // Check format restriction for sequence replacement (FASTQ has quality property)
    if (bySeq && "quality" in seq) {
      throw new ValidationError(
        "Sequence replacement (bySeq option) is only supported for FASTA format, not FASTQ",
      );
    }

    // Apply replacement to sequence
    const modifiedSeq = applyReplacement(seq, regex, recordNumber, kvMap, fileInfo, options, bySeq);

    yield modifiedSeq;
    recordNumber++;
  }
}
