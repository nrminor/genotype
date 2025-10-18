/**
 * Fx2TabProcessor - Convert sequences to tabular format
 *
 * Transforms FASTA/FASTQ sequences into delimiter-separated values (TSV/CSV),
 * enabling integration with spreadsheet tools, R/Python dataframes, and
 * bioinformatics pipelines. Provides Excel corruption protection and flexible
 * column selection with computed statistics.
 *
 * @version 2.0.0
 * @since v0.1.0
 */

// =============================================================================
// IMPORTS
// =============================================================================

import { type } from "arktype";
import { FileError, ParseError } from "../errors";
import {
  CSVParser,
  CSVWriter,
  DSVParser,
  DSVWriter,
  detectDelimiter,
  TSVParser,
  TSVWriter,
} from "../formats/dsv";
import type { JSONWriteOptions } from "../formats/json";
import {
  generateCollectionMetadata,
  serializeJSON,
  serializeJSONPretty,
  serializeJSONWithMetadata,
  serializeJSONWithMetadataPretty,
} from "../formats/json";
import { createStream, exists, getSize } from "../io/file-reader";
import { openForWriting } from "../io/file-writer";
import { readLines } from "../io/stream-utils";
import type { AbstractSequence, FastaSequence, FastqSequence } from "../types";
import {
  atContent,
  baseComposition,
  baseContent,
  baseCount,
  gcContent,
  sequenceAlphabet,
} from "./core/calculations";
import { hashMD5 } from "./core/hashing";
import { calculateAverageQuality } from "./core/quality";
import { charToScore } from "./core/quality/conversion";

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default columns if none specified */
const DEFAULT_COLUMNS = ["id", "sequence", "length"] as const;

/** Default decimal precision for floating point values */
const DEFAULT_PRECISION = 2;

/** Number of lines to sample for delimiter detection */
const DELIMITER_DETECTION_SAMPLE_LINES = 5;

/** Standard DSV field names for round-trip compatibility */
const DSV_FIELDS = ["id", "sequence", "quality", "description"] as const;

/** Columns that should always be formatted as integers */
const INTEGER_COLUMNS = ["length", "index", "line_number", "min_qual", "max_qual"] as const;

/** Columns that should always use decimal precision */
const PRECISION_COLUMNS = [
  "gc",
  "at",
  "gc_skew",
  "at_skew",
  "complexity",
  "entropy",
  "avg_qual",
] as const;

/** Column headers for display */
const COLUMN_HEADERS: Record<string, string> = {
  id: "ID",
  sequence: "Sequence",
  quality: "Quality",
  description: "Description",
  length: "Length",
  gc: "GC%",
  at: "AT%",
  gc_skew: "GC_Skew",
  at_skew: "AT_Skew",
  complexity: "Complexity",
  entropy: "Entropy",
  avg_qual: "Avg_Qual",
  min_qual: "Min_Qual",
  max_qual: "Max_Qual",
  index: "Index",
  line_number: "Line",
  alphabet: "Alphabet",
  seq_hash: "MD5_Hash",
};

// =============================================================================
// SCHEMAS
// =============================================================================

/**
 * ArkType validation schema for tab2fx options
 * Ensures runtime validation of delimiter-separated to sequence conversion options
 */
export const Tab2FxOptionsSchema = type({
  "delimiter?": "string",
  "hasHeader?": "boolean",
  "columns?": "string[]",
  "format?": '"fasta"|"fastq"',
  "qualityEncoding?": '"phred33"|"phred64"|"solexa"',
});

// =============================================================================
// TYPES
// =============================================================================

/**
 * Built-in column identifiers for fx2tab output
 */
export type BuiltInColumnId =
  // Basic columns (always available) - using DSVRecord field names
  | "id"
  | "sequence"
  | "quality"
  | "description"
  // Computed columns (on-demand)
  | "length"
  | "gc"
  | "at"
  | "gc_skew"
  | "at_skew"
  | "complexity"
  | "entropy"
  | "avg_qual"
  | "min_qual"
  | "max_qual"
  // Metadata columns
  | "index"
  | "line_number"
  // SeqKit parity columns (computed metadata)
  | "alphabet" // Unique characters in sequence
  | "seq_hash";

/**
 * Column identifier - can be built-in, dynamic patterns, or custom
 */
export type ColumnId =
  | BuiltInColumnId
  | `base_content_${string}` // Dynamic computed column for base content
  | `base_count_${string}` // Dynamic computed column for base count
  | string;

/**
 * Type mapping for built-in columns
 */
type ColumnValueType<T extends ColumnId> = T extends "id" | "sequence" | "quality" | "description"
  ? string
  : T extends "alphabet" | "seq_hash"
    ? string
    : T extends
          | "length"
          | "gc"
          | "at"
          | "gc_skew"
          | "at_skew"
          | "complexity"
          | "entropy"
          | "avg_qual"
          | "min_qual"
          | "max_qual"
          | "index"
          | "line_number"
      ? number
      : T extends `base_content_${string}`
        ? number
        : T extends `base_count_${string}`
          ? number
          : string | number | null; // For custom columns

/**
 * Type-safe tabular row with known columns
 * Provides both object-style and array-style access
 */
export type Fx2TabRow<Columns extends readonly ColumnId[] = readonly ColumnId[]> = {
  [K in Columns[number]]: ColumnValueType<K>;
} & {
  /** The raw delimited string representation */
  readonly __raw: string;
  /** Array of string values in column order */
  readonly __values: readonly string[];
  /** Column names in order */
  readonly __columns: Columns;
  /** Delimiter used */
  readonly __delimiter: string;
};

// =============================================================================
// INTERFACES
// =============================================================================

/**
 * Custom column definition
 */
export interface CustomColumn {
  /** Display name for header */
  name?: string;
  /** Computation function */
  compute: (seq: AbstractSequence) => string | number | null;
}

/**
 * Options for fx2tab conversion
 */
export interface Fx2TabOptions<Columns extends readonly ColumnId[] = readonly ColumnId[]> {
  /** Columns to include in output (default: ['id', 'seq', 'length']) */
  columns?: Columns;

  /** Output delimiter (default: '\t' for TSV) */
  delimiter?: string;

  /** Include header row (default: true) */
  header?: boolean;

  /** Enable Excel protection for gene names (default: false) */
  excelSafe?: boolean;

  /** Float decimal precision (default: 2) */
  precision?: number;

  /** Value for null/undefined (default: '') */
  nullValue?: string;

  /** Include source line numbers as a column */
  includeLineNumbers?: boolean;

  /** Custom computed columns */
  customColumns?: Record<
    string,
    CustomColumn | ((seq: AbstractSequence) => string | number | null)
  >;

  /**
   * Base sets to calculate content percentage for (e.g., ["AT", "GC", "N"])
   * These create computed columns that are NOT used in round-trip conversion
   */
  baseContent?: string[];

  /**
   * Base sets to calculate raw counts for (e.g., ["AT", "GC", "N"])
   * These create computed columns that are NOT used in round-trip conversion
   */
  baseCount?: string[];

  /**
   * Use case-sensitive base counting (default: false)
   * Affects computed columns only, not the stored sequence data
   */
  caseSensitive?: boolean;
}

/**
 * Options for tab2fx conversion
 * Derived from ArkType schema for runtime validation
 */
export type Tab2FxOptions = typeof Tab2FxOptionsSchema.infer;

// =============================================================================
// CLASSES
// =============================================================================

/**
 * TabularOps - Chainable operations on tabular sequence data
 *
 * Provides streaming operations on fx2tab row data while maintaining
 * compatibility with SeqOps pipelines. Supports bidirectional conversion
 * between sequences and tabular formats.
 *
 * @example
 * ```typescript
 * // Chain tabular operations
 * await new TabularOps(fx2tab(sequences))
 *   .filter(row => row.gc > 40)
 *   .writeTSV('high_gc.tsv');
 *
 * // Convert back to sequences
 * const seqOps = new TabularOps(rows)
 *   .toSequences({ format: 'fasta' });
 * ```
 */
export class TabularOps<Columns extends readonly ColumnId[]> {
  constructor(private source: AsyncIterable<Fx2TabRow<Columns>>) {}

  /**
   * Generic write method for all DSV formats
   * @internal
   */
  private async writeToFile(
    path: string,
    writer: DSVWriter | CSVWriter | TSVWriter,
    formatName: "TSV" | "CSV" | "DSV"
  ): Promise<void> {
    try {
      await openForWriting(path, async (handle) => {
        for await (const row of this.source) {
          // Convert readonly array to mutable for formatRow
          const formattedRow = writer.formatRow([...row.__values]);
          await handle.writeString(`${formattedRow}\n`);
        }
      });
    } catch (error) {
      throw new FileError(
        `Failed to write ${formatName} to ${path}: ${error instanceof Error ? error.message : String(error)}`,
        path,
        "write",
        error
      );
    }
  }

  /**
   * Write rows as TSV file with proper formatting
   *
   * @param path - Output file path
   * @throws {FileError} If file cannot be written or stream writing fails
   * @example
   * ```typescript
   * await tabularOps.writeTSV('output.tsv');
   * ```
   * @performance O(n) time, O(1) memory per row - streams without buffering
   * @since v0.1.0
   */
  async writeTSV(path: string): Promise<void> {
    const writer = new TSVWriter({
      header: false, // We handle header ourselves
    });
    return this.writeToFile(path, writer, "TSV");
  }

  /**
   * Write rows as CSV file with RFC 4180 compliant formatting
   *
   * Automatically handles special characters (commas, quotes, newlines) and
   * provides Excel protection for gene names like SEPT1, MARCH1 that Excel
   * corrupts into dates.
   *
   * @param path - Output file path
   * @throws {FileError} If file cannot be written or stream writing fails
   * @example
   * ```typescript
   * await tabularOps.writeCSV('output.csv');
   * ```
   * @performance O(n) time, O(1) memory per row - streams without buffering
   * @since v0.1.0
   */
  async writeCSV(path: string): Promise<void> {
    const writer = new CSVWriter({
      excelCompatible: true,
      header: false, // We handle header ourselves
    });
    return this.writeToFile(path, writer, "CSV");
  }

  /**
   * Write rows as DSV with custom delimiter
   *
   * Supports any delimiter (pipe, semicolon, etc.) with proper escaping
   * of special characters. Handles fields containing the delimiter by
   * quoting them according to RFC 4180 principles.
   *
   * @param path - Output file path
   * @param delimiter - Custom delimiter (e.g., '|', ';', ':')
   * @throws {FileError} If file cannot be written or stream writing fails
   * @example
   * ```typescript
   * await tabularOps.writeDSV('output.psv', '|');
   * ```
   * @performance O(n) time, O(1) memory per row - streams without buffering
   * @since v0.1.0
   */
  async writeDSV(path: string, delimiter: string): Promise<void> {
    const writer = new DSVWriter({
      delimiter,
      header: false, // We handle header ourselves
    });
    return this.writeToFile(path, writer, "DSV");
  }

  /**
   * Write rows as JSON array file
   *
   * Creates a JSON file with array of sequence objects. For large datasets,
   * consider writeJSONL() which streams one object per line instead.
   *
   * @param path - Output file path
   * @param options - JSON formatting options
   * @throws {FileError} If file cannot be written
   * @example
   * ```typescript
   * await tabularOps.writeJSON('output.json');
   * await tabularOps.writeJSON('output.json', { pretty: true });
   * await tabularOps.writeJSON('data.json', { includeMetadata: true });
   * ```
   * @performance O(n) time, O(n) memory - buffers entire dataset
   * @since v0.1.0
   */
  async writeJSON(path: string, options?: JSONWriteOptions): Promise<void> {
    try {
      const rows = await this.toArray();

      let output: string;

      if (options?.includeMetadata) {
        const metadata = generateCollectionMetadata({
          count: rows.length,
          columns: rows[0]?.__columns ? [...rows[0].__columns] : [],
          includeTimestamp: true,
        });

        const data = {
          sequences: rows,
          metadata,
        };

        const morph = options?.pretty ? serializeJSONWithMetadataPretty : serializeJSONWithMetadata;

        const result = morph(data);

        if (result instanceof type.errors) {
          throw new FileError(`JSON validation failed: ${result.summary}`, path, "write", result);
        }

        output = result;
      } else {
        const morph = options?.pretty ? serializeJSONPretty : serializeJSON;

        const result = morph(rows);

        if (result instanceof type.errors) {
          throw new FileError(`JSON validation failed: ${result.summary}`, path, "write", result);
        }

        output = result;
      }

      await openForWriting(path, async (handle) => {
        await handle.writeString(output);
      });
    } catch (error) {
      if (error instanceof FileError) {
        throw error;
      }
      throw new FileError(
        `Failed to write JSON to ${path}: ${error instanceof Error ? error.message : String(error)}`,
        path,
        "write",
        error
      );
    }
  }

  /**
   * Write rows as JSONL (JSON Lines) file
   *
   * Creates a JSONL file with one JSON object per line. This format enables
   * streaming with O(1) memory usage, making it suitable for very large datasets.
   * Each line is a complete, compact JSON object.
   *
   * @param path - Output file path
   * @param options - JSON formatting options (pretty and includeMetadata not applicable)
   * @throws {FileError} If file cannot be written
   * @example
   * ```typescript
   * // Basic usage
   * await tabularOps.writeJSONL('output.jsonl');
   *
   * // With custom null handling
   * await tabularOps.writeJSONL('data.jsonl', { nullValue: 'NA' });
   * ```
   * @performance O(n) time, O(1) memory - streams one row at a time
   * @since v0.1.0
   */
  async writeJSONL(path: string): Promise<void> {
    try {
      await openForWriting(path, async (handle) => {
        for await (const row of this.source) {
          const line = JSON.stringify(row);
          await handle.writeString(line);
          await handle.writeString("\n");
        }
      });
    } catch (error) {
      if (error instanceof FileError) {
        throw error;
      }
      throw new FileError(
        `Failed to write JSONL to ${path}: ${error instanceof Error ? error.message : String(error)}`,
        path,
        "write",
        error
      );
    }
  }

  /**
   * Filter rows based on predicate
   *
   * Creates a new TabularOps pipeline with only rows that match the predicate.
   * Maintains streaming behavior - rows are filtered on-the-fly without
   * loading all data into memory.
   *
   * @param predicate - Function to test each row (return true to include)
   * @returns New TabularOps with filtered rows
   * @example
   * ```typescript
   * const highGC = tabularOps.filter(row => row.gc > 50);
   * ```
   * @performance O(n) time, O(1) memory - streams without buffering
   * @since v0.1.0
   */
  filter(predicate: (row: Fx2TabRow<Columns>) => boolean): TabularOps<Columns> {
    async function* filterRows(source: AsyncIterable<Fx2TabRow<Columns>>) {
      for await (const row of source) {
        if (predicate(row)) {
          yield row;
        }
      }
    }
    return new TabularOps(filterRows(this.source));
  }

  /**
   * Transform rows with custom function
   *
   * Applies a transformation to each row, potentially changing column structure.
   * Useful for renaming columns, computing derived values, or restructuring data.
   * Maintains full type safety for the new column structure.
   *
   * @param fn - Transform function to apply to each row
   * @returns New TabularOps with transformed rows
   * @example
   * ```typescript
   * const renamed = tabularOps.map(row => ({ ...row, gene_id: row.id }));
   * ```
   * @performance O(n) time, O(1) memory - streams without buffering
   * @since v0.1.0
   */
  map<NewColumns extends readonly ColumnId[]>(
    fn: (row: Fx2TabRow<Columns>) => Fx2TabRow<NewColumns>
  ): TabularOps<NewColumns> {
    async function* transform(source: AsyncIterable<Fx2TabRow<Columns>>) {
      for await (const row of source) {
        yield fn(row);
      }
    }
    return new TabularOps(transform(this.source));
  }

  /**
   * Convert tabular rows back to sequences
   *
   * Reconstructs sequence objects from tabular data. Supports both FASTA and
   * FASTQ formats. Validates required fields and handles missing data gracefully.
   * Useful for round-trip conversion: sequences → tabular → sequences.
   *
   * @param options - Conversion options (format, quality encoding)
   * @returns AsyncIterable of sequences
   * @throws {ParseError} If required fields (id, sequence) are missing
   * @example
   * ```typescript
   * const sequences = tabularOps.toSequences({ format: 'fastq' });
   * ```
   * @performance O(n) time, O(1) memory - streams without buffering
   * @since v0.1.0
   */
  async *toSequences(options: Tab2FxOptions = {}): AsyncIterable<AbstractSequence> {
    const { format = "fasta", qualityEncoding = "phred33" } = options;

    for await (const row of this.source) {
      // Extract values from row using standard column names
      const id = String(getRowValue(row, "id") ?? "");
      const sequenceValue = getRowValue(row, "sequence") ?? "";
      const sequence = String(sequenceValue);
      const descValue = getRowValue(row, "description");
      const description = descValue ? String(descValue) : undefined;
      const qualValue = getRowValue(row, "quality");
      const quality = qualValue ? String(qualValue) : undefined;
      const lengthValue = getRowValue(row, "length");
      const length = typeof lengthValue === "number" ? lengthValue : sequence.length;

      if (!id || !sequence) {
        throw new ParseError(`Missing required fields (id, sequence) in row`, "fx2tab");
      }

      // Build sequence object based on format
      const seq: AbstractSequence = {
        id,
        sequence,
        length,
        ...(description && { description }),
        ...(format === "fastq" &&
          quality && {
            quality,
            qualityEncoding,
            format: "fastq" as const,
          }),
      };

      yield seq;
    }
  }

  /**
   * Collect all rows into array (terminal operation)
   *
   * WARNING: This loads all data into memory. Only use for small datasets
   * or after filtering. For large files, prefer streaming operations.
   *
   * @returns Promise resolving to array of all rows
   * @example
   * ```typescript
   * const allRows = await tabularOps.toArray();
   * console.log(`Processed ${allRows.length} sequences`);
   * ```
   * @performance O(n) time, O(n) memory - loads entire dataset
   * @since v0.1.0
   */
  async toArray(): Promise<Fx2TabRow<Columns>[]> {
    const rows: Fx2TabRow<Columns>[] = [];
    for await (const row of this.source) {
      rows.push(row);
    }
    return rows;
  }

  /**
   * Get async iterator for manual iteration
   */
  [Symbol.asyncIterator](): AsyncIterator<Fx2TabRow<Columns>> {
    return this.source[Symbol.asyncIterator]();
  }
}

// =============================================================================
// EXPORTED FUNCTIONS
// =============================================================================

/**
 * Convert sequences to type-safe tabular rows
 *
 * Transforms biological sequences into tabular format with computed columns.
 * Supports standard fields (id, sequence, quality) and scientific metrics
 * (GC%, AT%, complexity, entropy). Handles FASTA and FASTQ formats with
 * full Excel protection for gene names.
 *
 * @param source - Async iterable of sequences (FASTA/FASTQ)
 * @param options - Column selection and formatting options
 * @returns Async iterable of type-safe tabular rows
 *
 * @example
 * ```typescript
 * // Basic usage with type-safe access
 * const rows = fx2tab(sequences, { columns: ['id', 'length', 'gc'] as const });
 * for await (const row of rows) {
 *   console.log(row.id);     // TypeScript knows this is string
 *   console.log(row.length);  // TypeScript knows this is number
 *   console.log(row.gc);      // TypeScript knows this is number
 * }
 *
 * // Access raw string or values array
 * for await (const row of rows) {
 *   console.log(row.__raw);     // "seq1\t150\t45.5"
 *   console.log(row.__values);  // ["seq1", "150", "45.5"]
 * }
 * ```
 *
 * @performance O(n*m) where n=sequences, m=columns. Streams without buffering.
 * @since v0.1.0
 */
export async function* fx2tab<Columns extends readonly ColumnId[]>(
  source: AsyncIterable<AbstractSequence>,
  options: Fx2TabOptions<Columns> = {}
): AsyncIterable<Fx2TabRow<Columns>> {
  const {
    columns = DEFAULT_COLUMNS as unknown as Columns,
    delimiter = "\t",
    header = true,
    excelSafe = false,
    precision = DEFAULT_PRECISION,
    nullValue = "",
    includeLineNumbers = false,
    customColumns = {},
    baseContent,
    baseCount,
    caseSensitive = false,
  } = options;

  // Build dynamic columns from baseContent and baseCount options
  // These are computed columns that don't affect round-trip conversion
  const dynamicColumns: ColumnId[] = [];
  if (baseContent) {
    for (const bases of baseContent) {
      dynamicColumns.push(`base_content_${bases}` as ColumnId);
    }
  }
  if (baseCount) {
    for (const bases of baseCount) {
      dynamicColumns.push(`base_count_${bases}` as ColumnId);
    }
  }

  // Merge dynamic columns with specified columns
  const effectiveColumns = [...columns, ...dynamicColumns] as unknown as Columns;

  // Create writer instance with proper configuration
  const writer = new DSVWriter({
    delimiter,
    excelCompatible: excelSafe,
    quote: '"',
    escapeChar: '"',
    header: false, // We handle headers manually
  });

  let sequenceIndex = 0;
  let lineNumber = 1;

  // Yield header row if requested
  if (header) {
    const headerRow = effectiveColumns.map((col) => {
      const customCol = customColumns[col];
      if (customCol) {
        if (typeof customCol === "object" && customCol.name) {
          return customCol.name;
        }
        return col;
      }
      // For DSV compatibility, write lowercase field names for standard columns
      // This ensures DSVParser can read them back correctly
      if (DSV_FIELDS.includes(col as (typeof DSV_FIELDS)[number])) {
        return col; // Use lowercase for DSV compatibility
      }

      // For computed columns, use display headers
      return COLUMN_HEADERS[col] || col;
    });

    const headerString = writer.formatRow(headerRow);
    yield createRow(effectiveColumns, headerRow, headerRow, headerString, delimiter);
  }

  // Process each sequence
  for await (const seq of source) {
    const values: Array<string | number | null> = [];
    const stringValues: string[] = [];

    for (const col of effectiveColumns) {
      // Get column value
      const value = getColumnValue(seq, col, {
        customColumns,
        index: sequenceIndex,
        lineNumber: includeLineNumbers ? lineNumber : 0,
        nullValue,
        caseSensitive,
      });

      // Store raw value for object access
      values.push(value);

      // Format for string representation
      const stringValue = formatColumnValue(value, col, {
        excelSafe,
        precision,
        nullValue,
      });
      stringValues.push(stringValue);
    }

    const rawString = writer.formatRow(stringValues);
    yield createRow(effectiveColumns, values, stringValues, rawString, delimiter);

    sequenceIndex++;
    // Check if sequence has format property (FASTQ vs FASTA)
    const isFastq =
      "format" in seq && (seq as AbstractSequence & { format?: string }).format === "fastq";
    lineNumber += isFastq ? 4 : 2;
  }
}

/**
 * Convert tabular rows back to delimited strings
 * Utility function for writing to files
 */
export async function* rowsToStrings<Columns extends readonly ColumnId[]>(
  source: AsyncIterable<Fx2TabRow<Columns>>
): AsyncIterable<string> {
  for await (const row of source) {
    yield row.__raw;
  }
}

/**
 * Read tabular file back into sequences
 *
 * Reads delimiter-separated files and reconstructs sequence objects.
 * Auto-detects delimiter when not specified. Supports compressed files
 * (.gz, .zst) transparently through DSVParser. Validates required fields
 * and handles both FASTA and FASTQ output formats.
 *
 * @param path - Path to tabular file (TSV/CSV/PSV etc.)
 * @param options - Parsing options (delimiter, format, headers)
 * @returns AsyncIterable of sequences
 * @throws {ParseError} If required fields (id, sequence) are missing
 * @throws {FileError} If file cannot be read
 *
 * @example
 * ```typescript
 * // Read TSV file as sequences
 * for await (const seq of tab2fx('data.tsv')) {
 *   console.log(seq.id);
 * }
 *
 * // Read CSV with custom options
 * for await (const seq of tab2fx('data.csv', { delimiter: ',', format: 'fastq' })) {
 *   console.log(seq.sequence);
 * }
 *
 * // Auto-detect delimiter
 * for await (const seq of tab2fx('unknown.txt')) {
 *   // Delimiter detected automatically
 * }
 * ```
 *
 * @performance O(n) time, O(1) memory - streams without loading entire file
 * @since v0.1.0
 */
export async function* tab2fx(
  path: string,
  options: Tab2FxOptions = {}
): AsyncIterable<AbstractSequence> {
  // Validate options at runtime
  const validatedOptions = Tab2FxOptionsSchema.assert(options);

  let {
    delimiter, // undefined means auto-detect
    hasHeader = true,
    format = "fasta",
    qualityEncoding = "phred33",
  } = validatedOptions;

  try {
    // Check if file exists and is empty
    const fileExists = await exists(path);
    if (!fileExists) {
      throw new ParseError(`File not found: ${path}`, "tab2fx");
    }

    const fileSize = await getSize(path);
    if (fileSize === 0) {
      // Empty file - return early with no sequences
      return;
    }

    // Auto-detect delimiter if not specified (Step 5.3)
    if (!delimiter) {
      // Read first few lines for detection
      const sampleLines: string[] = [];
      let lineCount = 0;
      const stream = await createStream(path);
      for await (const line of readLines(stream)) {
        sampleLines.push(line);
        if (++lineCount >= DELIMITER_DETECTION_SAMPLE_LINES) break;
      }

      const detected = detectDelimiter(sampleLines);
      delimiter = detected || "\t"; // Default to tab if detection fails
    }

    // Build parser options
    // Don't pass columns to DSVParser - let it auto-detect from header
    const baseOptions = { header: hasHeader };

    // Use the appropriate parser based on delimiter
    let parser: DSVParser;

    if (delimiter === ",") {
      parser = new CSVParser(baseOptions);
    } else if (delimiter === "\t") {
      parser = new TSVParser(baseOptions);
    } else {
      parser = new DSVParser({ ...baseOptions, delimiter });
    }

    // Use DSVParser's parseFile method - it handles streaming, compression, everything!
    for await (const record of parser.parseFile(path)) {
      // Extract fields from the typed DSVRecord
      const id = record.id || "";
      const sequence = record.sequence || "";
      const quality = record.quality;
      const description = record.description;
      const length = record.length || sequence.length;

      // Validate required fields
      if (!id || !sequence) {
        throw new ParseError(`Missing required fields (id, sequence) in record`, "tab2fx");
      }

      // Convert record to sequence using shared conversion logic
      const seq = convertRecordToSequence(
        {
          id,
          sequence,
          ...(quality && { quality }),
          ...(description && { description }),
          length,
        },
        format,
        qualityEncoding
      );

      yield seq;
    }
  } catch (error) {
    throw new ParseError(
      `Failed to parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
      "tab2fx"
    );
  }
}

/**
 * Convert a record with sequence fields to an AbstractSequence
 *
 * Shared conversion logic used by both tab2fx() and JSON parsers.
 * Handles both FASTA and FASTQ formats based on presence of quality field.
 *
 * Type-safe overloads ensure return type matches the format parameter:
 * - format="fasta" → returns FastaSequence
 * - format="fastq" → returns FastqSequence
 * - format=union → returns AbstractSequence (FastaSequence | FastqSequence)
 *
 * @param record - Object with id, sequence, and optional quality/description fields
 * @param format - Target format ("fasta" or "fastq")
 * @param qualityEncoding - Quality encoding for FASTQ sequences
 * @returns Typed sequence object (FastaSequence, FastqSequence, or AbstractSequence)
 *
 * @internal
 */
export function convertRecordToSequence(
  record: {
    id: string;
    sequence: string;
    description?: string;
    length?: number;
  },
  format: "fasta",
  qualityEncoding?: never
): FastaSequence;
export function convertRecordToSequence(
  record: {
    id: string;
    sequence: string;
    quality: string;
    description?: string;
    length?: number;
  },
  format: "fastq",
  qualityEncoding: "phred33" | "phred64" | "solexa"
): FastqSequence;
export function convertRecordToSequence(
  record: {
    id: string;
    sequence: string;
    quality?: string;
    description?: string;
    length?: number;
  },
  format: "fasta" | "fastq",
  qualityEncoding?: "phred33" | "phred64" | "solexa"
): AbstractSequence;
export function convertRecordToSequence(
  record: {
    id: string;
    sequence: string;
    quality?: string;
    description?: string;
    length?: number;
  },
  format: "fasta" | "fastq" = "fasta",
  qualityEncoding: "phred33" | "phred64" | "solexa" = "phred33"
): AbstractSequence {
  const { id, sequence, quality, description, length } = record;

  // Build sequence object with conditional fields
  const seq: AbstractSequence = {
    id,
    sequence,
    length: length || sequence.length,
    ...(description && { description }),
    ...(format === "fastq" &&
      quality && {
        quality,
        qualityEncoding,
        format: "fastq" as const,
      }),
    ...(format === "fasta" && {
      format: "fasta" as const,
    }),
  };

  return seq;
}

// =============================================================================
// HELPER FUNCTIONS (INTERNAL)
// =============================================================================

/**
 * Type-safe row value extractor
 *
 * @param row - The row to extract from
 * @param key - The column key to extract
 * @returns The value or undefined if not present
 */
function getRowValue<T extends ColumnId>(
  row: Fx2TabRow<readonly ColumnId[]>,
  key: T
): ColumnValueType<T> | undefined {
  // Type-safe access without 'any'
  if (key in row) {
    return (row as Record<string, unknown>)[key] as ColumnValueType<T>;
  }
  return undefined;
}

/**
 * Create a type-safe row object
 */
function createRow<Columns extends readonly ColumnId[]>(
  columns: Columns,
  values: Array<string | number | null>,
  stringValues: string[],
  rawString: string,
  delimiter: string
): Fx2TabRow<Columns> {
  const row: Record<string, unknown> = {
    __raw: rawString,
    __values: stringValues,
    __columns: columns,
    __delimiter: delimiter,
  };

  // Add named properties for each column
  columns.forEach((col, i) => {
    row[col] = values[i];
  });

  return row as Fx2TabRow<Columns>;
}

/**
 * Get column value from custom or built-in columns
 */
function getColumnValue(
  seq: AbstractSequence,
  column: ColumnId,
  options: {
    customColumns: Record<
      string,
      CustomColumn | ((seq: AbstractSequence) => string | number | null)
    >;
    index: number;
    lineNumber: number;
    nullValue: string;
    caseSensitive?: boolean;
  }
): string | number | null {
  const customCol = options.customColumns[column];
  if (!customCol) {
    return computeColumn(seq, column, options);
  }

  try {
    const computeFn = typeof customCol === "function" ? customCol : customCol.compute;
    return computeFn(seq);
  } catch (_error) {
    return options.nullValue;
  }
}

/**
 * Format a value as a string for output
 */
function formatColumnValue(
  value: string | number | null,
  column: ColumnId,
  options: {
    excelSafe: boolean;
    precision: number;
    nullValue: string;
  }
): string {
  if (typeof value === "number") {
    // base_count columns should be integers
    if (column.startsWith("base_count_")) {
      return String(Math.round(value));
    }

    if (INTEGER_COLUMNS.includes(column as (typeof INTEGER_COLUMNS)[number])) {
      return String(Math.round(value));
    }

    // base_content columns are percentages
    if (column.startsWith("base_content_")) {
      return value.toFixed(options.precision);
    }

    if (PRECISION_COLUMNS.includes(column as (typeof PRECISION_COLUMNS)[number])) {
      return value.toFixed(options.precision);
    }

    // For custom columns, use precision if it's not an integer
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value.toFixed(options.precision);
  }

  if (value === null || value === undefined) {
    return options.nullValue;
  }

  return String(value);
}

/**
 * Compute value for a specific built-in column
 */
function computeColumn(
  seq: AbstractSequence,
  column: BuiltInColumnId | string,
  options: { index: number; lineNumber: number; nullValue: string; caseSensitive?: boolean }
): string | number | null {
  // Use column directly (no more aliases)
  const mappedColumn = column;

  switch (mappedColumn) {
    // Basic columns
    case "id":
      return seq.id;
    case "sequence":
      return seq.sequence;
    case "quality":
      return (seq as FastqSequence).quality || options.nullValue;
    case "description":
      return seq.description || options.nullValue;

    // Computed columns
    case "length":
      return seq.length || seq.sequence.length;
    case "gc":
      return gcContent(seq.sequence);
    case "at":
      return atContent(seq.sequence);
    case "gc_skew": {
      // GC skew = (G - C)/(G + C)
      const comp = baseComposition(seq.sequence);
      const g = comp.G || 0;
      const c = comp.C || 0;
      return g + c === 0 ? 0 : ((g - c) / (g + c)) * 100;
    }
    case "at_skew": {
      // AT skew = (A - T)/(A + T)
      const comp = baseComposition(seq.sequence);
      const a = comp.A || 0;
      const t = comp.T || comp.U || 0; // Support both DNA and RNA
      return a + t === 0 ? 0 : ((a - t) / (a + t)) * 100;
    }
    case "complexity": {
      // Linguistic complexity = (number of unique kmers) / (total kmers)
      // Using k=2 (dinucleotides) for simplicity
      const seq_upper = seq.sequence.toUpperCase();
      if (seq_upper.length < 2) return 0;

      const dinucs = new Set<string>();
      for (let i = 0; i < seq_upper.length - 1; i++) {
        dinucs.add(seq_upper.substring(i, i + 2));
      }
      return (dinucs.size / (seq_upper.length - 1)) * 100;
    }
    case "entropy": {
      // Shannon entropy of nucleotide distribution
      const comp = baseComposition(seq.sequence);
      const total = seq.sequence.length;
      if (total === 0) return 0;

      let entropy = 0;
      for (const count of Object.values(comp)) {
        if (count > 0) {
          const p = count / total;
          entropy -= p * Math.log2(p);
        }
      }
      return entropy;
    }
    case "avg_qual": {
      const fastq = seq as FastqSequence;
      if (!fastq.quality) return null;
      return calculateAverageQuality(fastq.quality, fastq.qualityEncoding || "phred33");
    }
    case "min_qual": {
      const fastq = seq as FastqSequence;
      if (!fastq.quality) return null;

      const encoding = fastq.qualityEncoding || "phred33";
      let minQual = Number.MAX_SAFE_INTEGER;

      for (let i = 0; i < fastq.quality.length; i++) {
        const char = fastq.quality.charAt(i);
        const qual = charToScore(char, encoding);
        minQual = Math.min(minQual, qual);
      }
      return minQual;
    }
    case "max_qual": {
      const fastq = seq as FastqSequence;
      if (!fastq.quality) return null;

      const encoding = fastq.qualityEncoding || "phred33";
      let maxQual = Number.MIN_SAFE_INTEGER;

      for (let i = 0; i < fastq.quality.length; i++) {
        const char = fastq.quality.charAt(i);
        const qual = charToScore(char, encoding);
        maxQual = Math.max(maxQual, qual);
      }
      return maxQual;
    }

    // Metadata columns
    case "index":
      return options.index;
    case "line_number":
      return options.lineNumber > 0 ? options.lineNumber : null;

    // SeqKit parity columns
    case "alphabet":
      return sequenceAlphabet(seq.sequence, options.caseSensitive || false);
    case "seq_hash":
      return hashMD5(seq.sequence, options.caseSensitive || false);

    default:
      // Check for dynamic column patterns
      if (column.startsWith("base_content_")) {
        const bases = column.slice(13); // Remove "base_content_" prefix
        return baseContent(seq.sequence, bases, options.caseSensitive || false);
      }

      if (column.startsWith("base_count_")) {
        const bases = column.slice(11); // Remove "base_count_" prefix
        return baseCount(seq.sequence, bases, options.caseSensitive || false);
      }

      return options.nullValue;
  }
}
