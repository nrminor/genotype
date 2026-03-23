/**
 * Fx2TabProcessor - Convert sequences to tabular format
 *
 * Transforms FASTA/FASTQ sequences into delimiter-separated values (TSV/CSV),
 * enabling integration with spreadsheet tools, R/Python dataframes, and
 * bioinformatics pipelines. Provides Excel corruption protection and flexible
 * column selection with computed statistics.
 *
 */

import { type } from "arktype";
import { Effect } from "effect";
import { BackendService, backendLayer } from "@genotype/core/backend/service";
import { CustomColumnError } from "@genotype/tabular/errors";
import {
  convertRecordToSequence,
  createFastaRecord,
  createFastqRecord,
} from "@genotype/core/constructors";
import { FileError, ParseError } from "@genotype/core/errors";
import {
  CSVParser,
  CSVWriter,
  DSVParser,
  DSVWriter,
  detectDelimiter,
  TSVParser,
  TSVWriter,
} from "@genotype/tabular/dsv";
import type { JSONWriteOptions } from "@genotype/core/formats/json";
import {
  generateCollectionMetadata,
  serializeJSON,
  serializeJSONPretty,
  serializeJSONWithMetadata,
  serializeJSONWithMetadataPretty,
} from "@genotype/core/formats/json";
import { createStreamPromise, existsPromise, getSizePromise } from "@genotype/core/io/file-reader";
import { openForWriting } from "@genotype/core/io/file-writer";
import { readLines } from "@genotype/core/io/stream-utils";
import { packSequences, type PackedBatch } from "@genotype/core/backend/batch";
import {
  SequenceMetricFlag,
  type SequenceMetricsResult,
} from "@genotype/core/backend/kernel-types";
import type { AbstractSequence, FastqSequence } from "@genotype/core/types";
import {
  baseContent,
  baseCount,
  sequenceAlphabet,
} from "@genotype/core/operations/core/calculations";
import { hashMD5 } from "@genotype/core/operations/core/hashing";

/** Default columns if none specified */
const DEFAULT_COLUMNS = ["id", "sequence", "length"] as const;

/** Default decimal precision for floating point values */
const DEFAULT_PRECISION = 2;

/** Internal batch budget for native metric precomputation */
const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

const ALPHABET_MASK_ORDER = [
  "*",
  "-",
  ".",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
] as const;

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

/** Basic sequence fields — always available from the sequence object itself */
export type BasicColumnId = "id" | "sequence" | "quality" | "description";

/** Positional metadata — derived from iteration order, not sequence content */
export type MetadataColumnId = "index" | "line_number";

/** Metrics computed by the native kernel */
export type KernelMetricColumnId =
  | "length"
  | "gc"
  | "at"
  | "gc_skew"
  | "at_skew"
  | "entropy"
  | "alphabet"
  | "avg_qual"
  | "min_qual"
  | "max_qual";

/** Metrics computed in TypeScript, not delegated to the kernel */
export type TsComputedColumnId = "complexity" | "seq_hash";

/**
 * Built-in column identifiers for fx2tab output
 */
export type BuiltInColumnId =
  | BasicColumnId
  | MetadataColumnId
  | KernelMetricColumnId
  | TsComputedColumnId;

/** Dynamic base-content percentage column */
type BaseContentColumnId = `base_content_${string}`;

/** Dynamic base-count column */
type BaseCountColumnId = `base_count_${string}`;

/**
 * Column identifier — built-in or dynamic base-content/base-count patterns.
 * Custom column names (from `customColumns` option) remain plain `string` and
 * are looked up in the record directly; they never enter the typed dispatch path.
 */
export type ColumnId = BuiltInColumnId | BaseContentColumnId | BaseCountColumnId;

/**
 * Maps column identifiers to their value types:
 *
 *   BasicColumnId (id, sequence, ...)      → string
 *   MetadataColumnId (index, line_number)  → number | null
 *   KernelMetricColumnId                   → number | null (except alphabet → string)
 *   TsComputedColumnId                     → number (except seq_hash → string)
 *   BaseContentColumnId, BaseCountColumnId → number
 *   Custom / unknown                       → string | number | null
 */
type ColumnValueType<T extends string> = T extends BasicColumnId
  ? string
  : T extends MetadataColumnId
    ? number | null
    : T extends KernelMetricColumnId
      ? T extends "alphabet"
        ? string
        : number | null
      : T extends TsComputedColumnId
        ? T extends "seq_hash"
          ? string
          : number
        : T extends BaseContentColumnId | BaseCountColumnId
          ? number
          : string | number | null;

/**
 * Type-safe tabular row with known columns.
 * Columns may include built-in ColumnId values or custom string column names.
 * Provides both object-style and array-style access.
 */
export type Fx2TabRow<Columns extends readonly (ColumnId | string)[] = readonly ColumnId[]> = {
  [K in Columns[number] & string]: ColumnValueType<K>;
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
export interface Fx2TabOptions<
  Columns extends readonly (ColumnId | string)[] = readonly ColumnId[],
> {
  /**
   * Columns to include in output (default: ['id', 'sequence', 'length']).
   * Built-in and dynamic columns are typed as ColumnId; custom column names
   * (keys from `customColumns`) may also appear here as plain strings.
   */
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
export class TabularOps<Columns extends readonly (ColumnId | string)[]> {
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
   */
  map<NewColumns extends readonly (ColumnId | string)[]>(
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
      if (!id || !sequence) {
        throw new ParseError(`Missing required fields (id, sequence) in row`, "fx2tab");
      }

      if (format === "fastq" && quality) {
        yield createFastqRecord({ id, sequence, quality, qualityEncoding, description });
      } else {
        yield createFastaRecord({ id, sequence, description });
      }
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

// ---------------------------------------------------------------------------
// Fx2Tab config, state, and extracted helpers
// ---------------------------------------------------------------------------

/** Mutable state threaded across batch flushes. */
interface BatchState {
  sequenceIndex: number;
  lineNumber: number;
}

/** Immutable config bundle derived from Fx2TabOptions. */
interface Fx2TabConfig<Columns extends readonly (ColumnId | string)[]> {
  effectiveColumns: Columns;
  customColumns: Fx2TabOptions<Columns>["customColumns"] & {};
  caseSensitive: boolean;
  excelSafe: boolean;
  precision: number;
  nullValue: string;
  includeLineNumbers: boolean;
  delimiter: string;
  writer: DSVWriter;
}

/** Build dynamic base_content_X / base_count_X column IDs from options. */
function buildDynamicColumns(content?: readonly string[], count?: readonly string[]): ColumnId[] {
  return [
    ...(content ?? []).map((b) => `base_content_${b}` as ColumnId),
    ...(count ?? []).map((b) => `base_count_${b}` as ColumnId),
  ];
}

/** Derive the display label for a column in the header row. */
function headerLabel<Columns extends readonly (ColumnId | string)[]>(
  col: string,
  customColumns: Fx2TabConfig<Columns>["customColumns"]
): string {
  const custom = customColumns[col];
  if (custom && typeof custom === "object" && custom.name) return custom.name;
  if (custom) return col;
  if (DSV_FIELDS.includes(col as (typeof DSV_FIELDS)[number])) return col;
  return COLUMN_HEADERS[col] || col;
}

/**
 * Compute a single column's value for one sequence.
 *
 * Handles all built-in column categories (basic, metadata, kernel metric,
 * TS-computed, dynamic base content/count). Custom columns are NOT handled
 * here — they require Effect.try and live in flushBatch.
 *
 * Returns undefined for custom columns so the caller knows to dispatch
 * through Effect.try instead.
 */
function computeBuiltInColumnValue(
  col: string,
  seq: AbstractSequence,
  metrics: NativeMetricBatch | null,
  rowIndex: number,
  state: BatchState,
  config: Fx2TabConfig<readonly (ColumnId | string)[]>
): { value: string | number | null } | undefined {
  if (isKernelMetricColumn(col)) {
    if (col === "alphabet" && config.caseSensitive) {
      return { value: sequenceAlphabet(seq.sequence, true) };
    }
    return { value: readKernelMetric(col, metrics!, rowIndex) };
  }
  if (isBasicColumn(col)) return { value: computeBasicColumn(col, seq, config.nullValue) };
  if (isMetadataColumn(col)) {
    return {
      value: computeMetadataColumn(
        col,
        state.sequenceIndex,
        config.includeLineNumbers ? state.lineNumber : 0
      ),
    };
  }
  if (isTsComputedColumn(col)) return { value: computeTsColumn(col, seq, config.caseSensitive) };
  if (col.startsWith("base_content_") || col.startsWith("base_count_")) {
    return {
      value: computeDynamicColumn(
        col as BaseContentColumnId | BaseCountColumnId,
        seq,
        config.caseSensitive
      ),
    };
  }
  return undefined; // Not a built-in column — caller handles custom or null
}

/**
 * Flush a batch of sequences into Fx2TabRows.
 *
 * Uses BackendService (via computeKernelMetrics) for kernel metrics.
 * Custom column errors are typed as CustomColumnError.
 */
const flushBatch = <Columns extends readonly (ColumnId | string)[]>(
  sequences: readonly AbstractSequence[],
  state: BatchState,
  config: Fx2TabConfig<Columns>
) =>
  Effect.gen(function* () {
    const builtInColumns = config.effectiveColumns.filter(
      (col): col is ColumnId => !config.customColumns[col]
    );
    const { kernel } = partitionColumns(builtInColumns);
    const hasKernelMetrics = kernel.length > 0;

    const metrics = hasKernelMetrics
      ? yield* computeKernelMetrics(kernel, sequences, config.caseSensitive)
      : null;

    const rows: Fx2TabRow<Columns>[] = [];
    let { sequenceIndex: seqIdx, lineNumber: ln } = state;

    for (let rowIndex = 0; rowIndex < sequences.length; rowIndex++) {
      const seq = sequences[rowIndex]!;
      const values: Array<string | number | null> = [];
      const stringValues: string[] = [];

      for (const col of config.effectiveColumns) {
        const builtIn = computeBuiltInColumnValue(
          col,
          seq,
          metrics,
          rowIndex,
          { sequenceIndex: seqIdx, lineNumber: ln },
          config as Fx2TabConfig<readonly (ColumnId | string)[]>
        );

        let value: string | number | null;
        if (builtIn !== undefined) {
          value = builtIn.value;
        } else if (config.customColumns[col]) {
          const customCol = config.customColumns[col];
          const computeFn = typeof customCol === "function" ? customCol : customCol!.compute;
          value = yield* Effect.try({
            try: () => computeFn(seq),
            catch: (cause) =>
              new CustomColumnError({
                column: String(col),
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
          });
        } else {
          value = null;
        }

        values.push(value);
        stringValues.push(
          formatColumnValue(value, col, {
            excelSafe: config.excelSafe,
            precision: config.precision,
            nullValue: config.nullValue,
          })
        );
      }

      const rawString = config.writer.formatRow(stringValues);
      rows.push(
        createRow(config.effectiveColumns, values, stringValues, rawString, config.delimiter)
      );

      seqIdx++;
      const isFastq =
        "format" in seq && (seq as AbstractSequence & { format?: string }).format === "fastq";
      ln += isFastq ? 4 : 2;
    }

    return { rows, state: { sequenceIndex: seqIdx, lineNumber: ln } };
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
 */
export async function* fx2tab<Columns extends readonly (ColumnId | string)[]>(
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
    baseContent: baseContentBases,
    baseCount: baseCountBases,
    caseSensitive = false,
  } = options;

  const dynamicColumns = buildDynamicColumns(baseContentBases, baseCountBases);
  const effectiveColumns = [...columns, ...dynamicColumns] as unknown as Columns;

  const config: Fx2TabConfig<Columns> = {
    effectiveColumns,
    customColumns: customColumns as Fx2TabConfig<Columns>["customColumns"],
    caseSensitive,
    excelSafe,
    precision,
    nullValue,
    includeLineNumbers,
    delimiter,
    writer: new DSVWriter({
      delimiter,
      excelCompatible: excelSafe,
      quote: '"',
      escapeChar: '"',
      header: false,
    }),
  };

  // Header row
  if (header) {
    const labels = effectiveColumns.map((col) => headerLabel(col, config.customColumns));
    const headerString = config.writer.formatRow(labels);
    yield createRow(effectiveColumns, labels, labels, headerString, delimiter);
  }

  // Batch sequences and flush through the Effect-native flushBatch.
  // BackendService flows through flushBatch's R type and is resolved
  // once per batch via backendRuntime.runPromise.
  let batch: AbstractSequence[] = [];
  let batchBytes = 0;
  let state: BatchState = { sequenceIndex: 0, lineNumber: 1 };

  try {
    for await (const seq of source) {
      batch.push(seq);
      batchBytes += seq.sequence?.length ?? 0;

      if (batchBytes >= BATCH_BYTE_BUDGET) {
        const result = await Effect.runPromise(
          flushBatch(batch, state, config).pipe(Effect.provide(backendLayer))
        );
        state = result.state;
        yield* result.rows;
        batch = [];
        batchBytes = 0;
      }
    }
  } catch (error) {
    if (batch.length > 0) {
      const result = await Effect.runPromise(
        flushBatch(batch, state, config).pipe(Effect.provide(backendLayer))
      );
      yield* result.rows;
    }
    throw error;
  }

  if (batch.length > 0) {
    const result = await Effect.runPromise(
      flushBatch(batch, state, config).pipe(Effect.provide(backendLayer))
    );
    yield* result.rows;
  }
}

/**
 * Convert tabular rows back to delimited strings
 * Utility function for writing to files
 */
export async function* rowsToStrings<Columns extends readonly (ColumnId | string)[]>(
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
    const fileExists = await existsPromise(path);
    if (!fileExists) {
      throw new ParseError(`File not found: ${path}`, "tab2fx");
    }

    const fileSize = await getSizePromise(path);
    if (fileSize === 0) {
      // Empty file - return early with no sequences
      return;
    }

    // Auto-detect delimiter if not specified (Step 5.3)
    if (!delimiter) {
      // Read first few lines for detection
      const sampleLines: string[] = [];
      let lineCount = 0;
      const stream = await createStreamPromise(path);
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
 * Type-safe row value extractor
 *
 * @param row - The row to extract from
 * @param key - The column key to extract
 * @returns The value or undefined if not present
 */
function getRowValue<T extends ColumnId, C extends readonly (ColumnId | string)[]>(
  row: Fx2TabRow<C>,
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
function createRow<Columns extends readonly (ColumnId | string)[]>(
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

interface NativeMetricBatch {
  readonly result: SequenceMetricsResult;
  readonly qualityPresent: readonly boolean[];
}

/** Exhaustive mapping from KernelMetricColumnId to its SequenceMetricFlag bit */
const METRIC_FLAG = {
  length: SequenceMetricFlag.Length,
  gc: SequenceMetricFlag.Gc,
  at: SequenceMetricFlag.At,
  gc_skew: SequenceMetricFlag.GcSkew,
  at_skew: SequenceMetricFlag.AtSkew,
  entropy: SequenceMetricFlag.Entropy,
  alphabet: SequenceMetricFlag.Alphabet,
  avg_qual: SequenceMetricFlag.AvgQual,
  min_qual: SequenceMetricFlag.MinQual,
  max_qual: SequenceMetricFlag.MaxQual,
} satisfies Record<KernelMetricColumnId, number>;

// ---------------------------------------------------------------------------
// Per-category type guards
// ---------------------------------------------------------------------------

function isKernelMetricColumn(col: string): col is KernelMetricColumnId {
  return col in METRIC_FLAG;
}

const BASIC_COLUMNS = new Set<string>(["id", "sequence", "quality", "description"]);
function isBasicColumn(col: string): col is BasicColumnId {
  return BASIC_COLUMNS.has(col);
}

const METADATA_COLUMNS = new Set<string>(["index", "line_number"]);
function isMetadataColumn(col: string): col is MetadataColumnId {
  return METADATA_COLUMNS.has(col);
}

const TS_COMPUTED_COLUMNS = new Set<string>(["complexity", "seq_hash"]);
function isTsComputedColumn(col: string): col is TsComputedColumnId {
  return TS_COMPUTED_COLUMNS.has(col);
}

// ---------------------------------------------------------------------------
// Column partitioner
// ---------------------------------------------------------------------------

function partitionColumns(columns: readonly ColumnId[]) {
  const kernel: KernelMetricColumnId[] = [];
  const basic: BasicColumnId[] = [];
  const tsComputed: TsComputedColumnId[] = [];
  const metadata: MetadataColumnId[] = [];
  const dynamic: (BaseContentColumnId | BaseCountColumnId)[] = [];

  for (const col of columns) {
    if (isKernelMetricColumn(col)) kernel.push(col);
    else if (isBasicColumn(col)) basic.push(col);
    else if (isTsComputedColumn(col)) tsComputed.push(col);
    else if (isMetadataColumn(col)) metadata.push(col);
    else dynamic.push(col);
  }

  return { kernel, basic, tsComputed, metadata, dynamic } as const;
}

function packOptionalQualityStrings(sequences: readonly AbstractSequence[]): {
  readonly batch: PackedBatch;
  readonly qualityPresent: readonly boolean[];
  readonly uniformAsciiOffset: number | null;
} {
  const count = sequences.length;
  const offsets = new Uint32Array(count + 1);
  const chunks: Uint8Array[] = new Array(count);
  const qualityPresent = new Array<boolean>(count);
  let totalBytes = 0;
  let uniformAsciiOffset: number | null = null;

  for (let i = 0; i < count; i++) {
    const seq = sequences[i] as Partial<FastqSequence>;
    const quality = seq.quality;
    const qualityEncoding = seq.qualityEncoding;
    offsets[i] = totalBytes;

    if (quality !== undefined) {
      const bytes = quality.toBytes();
      chunks[i] = bytes;
      qualityPresent[i] = true;
      totalBytes += bytes.length;

      const asciiOffset = qualityEncoding === "phred64" || qualityEncoding === "solexa" ? 64 : 33;
      if (uniformAsciiOffset === null) {
        uniformAsciiOffset = asciiOffset;
      } else if (uniformAsciiOffset !== asciiOffset) {
        uniformAsciiOffset = -1;
      }
    } else {
      chunks[i] = new Uint8Array(0);
      qualityPresent[i] = false;
    }
  }

  offsets[count] = totalBytes;
  const data = Buffer.allocUnsafe(totalBytes);
  for (let i = 0; i < count; i++) {
    data.set(chunks[i]!, offsets[i]);
  }

  return {
    batch: { data, offsets },
    qualityPresent,
    uniformAsciiOffset: uniformAsciiOffset === -1 ? null : uniformAsciiOffset,
  };
}

function alphabetFromMask(mask: number): string {
  let out = "";
  for (let i = 0; i < ALPHABET_MASK_ORDER.length; i++) {
    if ((mask & (1 << i)) !== 0) {
      out += ALPHABET_MASK_ORDER[i]!;
    }
  }
  return out;
}

const computeKernelMetrics = Effect.fn("fx2tab.computeKernelMetrics")(function* (
  columns: readonly KernelMetricColumnId[],
  sequences: readonly AbstractSequence[],
  caseSensitive: boolean
) {
  const metricFlags = columns.reduce((f, col) => {
    if (col === "alphabet" && caseSensitive) return f;
    return f | METRIC_FLAG[col];
  }, 0);

  const sequenceBatch = packSequences(sequences);
  const qualityBatch = packOptionalQualityStrings(sequences);
  const needsQualityMetrics =
    (metricFlags &
      (SequenceMetricFlag.AvgQual | SequenceMetricFlag.MinQual | SequenceMetricFlag.MaxQual)) !==
    0;

  const effectiveFlags =
    needsQualityMetrics && qualityBatch.uniformAsciiOffset === null
      ? metricFlags &
        ~(SequenceMetricFlag.AvgQual | SequenceMetricFlag.MinQual | SequenceMetricFlag.MaxQual)
      : metricFlags;

  if (effectiveFlags === 0) {
    return { result: {}, qualityPresent: qualityBatch.qualityPresent } satisfies NativeMetricBatch;
  }

  const backend = yield* BackendService;
  const result = yield* backend.sequenceMetricsBatch(
    sequenceBatch.data,
    sequenceBatch.offsets,
    qualityBatch.batch.data,
    qualityBatch.batch.offsets,
    effectiveFlags,
    qualityBatch.uniformAsciiOffset ?? 33
  );

  return { result, qualityPresent: qualityBatch.qualityPresent } satisfies NativeMetricBatch;
});

// ---------------------------------------------------------------------------
// Per-category column compute functions (no default branches)
// ---------------------------------------------------------------------------

function computeBasicColumn(col: BasicColumnId, seq: AbstractSequence, nullValue: string): string {
  switch (col) {
    case "id":
      return seq.id;
    case "sequence":
      return seq.sequence?.toString() ?? nullValue;
    case "quality":
      return (seq as FastqSequence).quality?.toString() || nullValue;
    case "description":
      return seq.description || nullValue;
  }
}

function computeMetadataColumn(
  col: MetadataColumnId,
  index: number,
  lineNumber: number
): number | null {
  switch (col) {
    case "index":
      return index;
    case "line_number":
      return lineNumber > 0 ? lineNumber : null;
  }
}

function readKernelMetric(
  col: KernelMetricColumnId,
  metrics: NativeMetricBatch,
  rowIndex: number
): number | string | null {
  switch (col) {
    case "length":
      return metrics.result.lengths?.[rowIndex] ?? null;
    case "gc":
      return metrics.result.gc?.[rowIndex] ?? null;
    case "at":
      return metrics.result.at?.[rowIndex] ?? null;
    case "gc_skew":
      return metrics.result.gcSkew?.[rowIndex] ?? null;
    case "at_skew":
      return metrics.result.atSkew?.[rowIndex] ?? null;
    case "entropy":
      return metrics.result.entropy?.[rowIndex] ?? null;
    case "alphabet": {
      const mask = metrics.result.alphabetMask?.[rowIndex];
      return mask !== undefined ? alphabetFromMask(mask) : null;
    }
    case "avg_qual":
      return metrics.qualityPresent[rowIndex] ? (metrics.result.avgQual?.[rowIndex] ?? null) : null;
    case "min_qual":
      return metrics.qualityPresent[rowIndex] ? (metrics.result.minQual?.[rowIndex] ?? null) : null;
    case "max_qual":
      return metrics.qualityPresent[rowIndex] ? (metrics.result.maxQual?.[rowIndex] ?? null) : null;
  }
}

function computeTsColumn(
  col: TsComputedColumnId,
  seq: AbstractSequence,
  caseSensitive: boolean
): number | string {
  switch (col) {
    case "complexity": {
      const seq_upper = seq.sequence.toString().toUpperCase();
      if (seq_upper.length < 2) return 0;
      const dinucs = new Set<string>();
      for (let i = 0; i < seq_upper.length - 1; i++) {
        dinucs.add(seq_upper.slice(i, i + 2));
      }
      return (dinucs.size / (seq_upper.length - 1)) * 100;
    }
    case "seq_hash":
      return hashMD5(seq.sequence.toString(), caseSensitive);
  }
}

function computeDynamicColumn(
  col: BaseContentColumnId | BaseCountColumnId,
  seq: AbstractSequence,
  caseSensitive: boolean
): number {
  if (col.startsWith("base_content_")) {
    const bases = col.slice(13);
    return baseContent(seq.sequence, bases, caseSensitive);
  }
  // Must be base_count_
  const bases = col.slice(11);
  return baseCount(seq.sequence, bases, caseSensitive);
}

/**
 * Format a value as a string for output
 */
function formatColumnValue(
  value: string | number | null,
  column: ColumnId | string,
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
