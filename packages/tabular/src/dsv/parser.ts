/**
 * DSV (Delimiter-Separated Values) parser implementation
 *
 * Provides streaming CSV/TSV parsing backed by d3-dsv for RFC 4180 compliance.
 * Wraps d3-dsv's synchronous parse API with Effect Stream for file I/O,
 * automatic compression detection, and bioinformatics-specific record creation.
 */

import { type } from "arktype";
import { dsvFormat } from "d3-dsv";
import { CompressionDetector } from "@genotype/core/compression/detector";
import { wrapStream as wrapGzipStream } from "@genotype/core/compression/gzip";
import { wrapStream as wrapZstdStream } from "@genotype/core/compression/zstd";
import { Effect, Stream } from "effect";
import { CompressionError, DSVParseError, FileError, ValidationError } from "@genotype/core/errors";
import { TabularParseError } from "@genotype/tabular/errors";
import { createStream, mapPlatformError } from "@genotype/core/io/file-reader";
import type { CompressionFormat } from "@genotype/core/types";
import { AbstractParser } from "@genotype/core/formats/abstract-parser";
import { DEFAULT_DELIMITERS, DEFAULT_ESCAPE, DEFAULT_QUOTE } from "@genotype/tabular/dsv/constants";
import { detectDelimiter, detectHeaders } from "@genotype/tabular/dsv/detection";
import type { DSVParserOptions, DSVRecord } from "@genotype/tabular/dsv/types";
import {
  calculateBaseCount,
  calculateGC,
  calculateGCSkew,
  removeBOM,
} from "@genotype/tabular/dsv/utils";
import { DSVParserOptionsSchema } from "@genotype/tabular/dsv/validation";
import { IOLayer } from "@genotype/core/io/layers";

/**
 * DSV parser backed by d3-dsv
 *
 * Parses CSV, TSV, and custom-delimiter files using d3-dsv for RFC 4180
 * compliant field parsing. Adds bioinformatics-specific features on top:
 * auto-detection, compression, computed statistics, and Excel protection.
 */
export class DSVParser extends AbstractParser<DSVRecord, DSVParserOptions> {
  private delimiter: string;
  private headers: string[] | null = null;

  protected getDefaultOptions(): Partial<DSVParserOptions> {
    return {
      quote: DEFAULT_QUOTE,
      escape: DEFAULT_ESCAPE,
      header: true,
      skipEmptyLines: true,
      skipComments: true,
      commentPrefix: "#",
      raggedRows: "pad" as const,
      maxFieldLines: 100,
    };
  }

  constructor(options: DSVParserOptions = {}) {
    const validation = DSVParserOptionsSchema(options);
    if (validation instanceof type.errors) {
      throw new ValidationError(`Invalid DSV parser options: ${validation.summary}`);
    }

    const processedOptions = { ...options };

    if (options.autoDetect) {
      processedOptions.autoDetect = true;
      processedOptions.autoDetectDelimiter = true;
      processedOptions.autoDetectHeaders = true;
    }

    if (
      (processedOptions.autoDetect || processedOptions.autoDetectHeaders) &&
      options.header === undefined
    ) {
      processedOptions.header = undefined as any;
    }

    if (!options.onError) {
      processedOptions.onError = (error: string, lineNumber?: number): void => {
        throw new DSVParseError(error, lineNumber);
      };
    }

    super(processedOptions);

    this.delimiter = this.options.autoDetectDelimiter
      ? ""
      : this.options.delimiter || DEFAULT_DELIMITERS.tsv;
  }

  getFormatName(): string {
    switch (this.delimiter) {
      case ",":
        return "CSV";
      case "\t":
        return "TSV";
      default:
        return "DSV";
    }
  }

  /**
   * Internal Effect that parses DSV text into a Stream of records.
   * Handles BOM removal, comment stripping, delimiter/header detection,
   * and d3-dsv parsing with typed errors.
   */
  private parseTextEffect(data: string): Effect.Effect<DSVRecord[], TabularParseError> {
    return Effect.gen({ self: this }, function* () {
      let text = removeBOM(data);

      const commentPrefix = this.options.commentPrefix ?? "#";
      if (this.options.skipComments) {
        text = text
          .split(/\r?\n/)
          .filter((line) => !line.startsWith(commentPrefix))
          .join("\n");
      }

      if ((this.options.autoDetect || this.options.autoDetectDelimiter) && !this.delimiter) {
        const sampleLines = text.split(/\r?\n/).slice(0, 10);
        const detected = detectDelimiter(sampleLines);
        if (detected) {
          this.delimiter = detected;
        } else {
          yield* Effect.logWarning("Could not auto-detect delimiter, defaulting to comma (,)");
          this.delimiter = ",";
        }
      }

      if (
        (this.options.autoDetect || this.options.autoDetectHeaders) &&
        this.options.header === undefined
      ) {
        const sampleLines = text.split(/\r?\n/).slice(0, 5);
        const hasHeaders = detectHeaders(sampleLines, this.delimiter);
        this.options.header = hasHeaders;
      }

      const parser = dsvFormat(this.delimiter);
      const records: DSVRecord[] = [];

      if (this.options.header) {
        const parsed = yield* Effect.try({
          try: () => parser.parse(text),
          catch: (cause) =>
            new TabularParseError({
              message: `DSV parse failed: ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            }),
        });
        this.headers = parsed.columns;

        for (let i = 0; i < parsed.length; i++) {
          const row = parsed[i]!;
          const fields = this.headers.map((col: string) => row[col] ?? "");
          const record = this.createRecord(fields, i + 2);
          if (record) records.push(record);
        }
      } else {
        const rows = yield* Effect.try({
          try: () => parser.parseRows(text),
          catch: (cause) =>
            new TabularParseError({
              message: `DSV parse failed: ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            }),
        });

        for (let i = 0; i < rows.length; i++) {
          const fields = rows[i]!;
          if (this.options.skipEmptyLines && fields.length === 1 && !fields[0]) continue;
          const record = this.createRecord(fields, i + 1);
          if (record) records.push(record);
        }
      }

      return records;
    });
  }

  /**
   * Parse a DSV file from a path.
   * Automatically handles compression based on file extension.
   */
  async *parseFile(path: string): AsyncIterable<DSVRecord> {
    const stream = Stream.unwrap(
      Effect.gen({ self: this }, function* () {
        const detectionStream = yield* createStream(path, {});
        const detection = yield* Effect.promise(() =>
          CompressionDetector.fromStream(detectionStream)
        );

        const fileStream = yield* createStream(path, {});
        const processedStream =
          detection.format !== "none" ? decompressStream(fileStream, detection.format) : fileStream;

        const text = yield* Effect.tryPromise({
          try: () => streamToString(processedStream),
          catch: (cause) =>
            new FileError(
              `Failed to read file: ${cause instanceof Error ? cause.message : String(cause)}`,
              path,
              "read",
              cause
            ),
        });

        const records = yield* this.parseTextEffect(text).pipe(
          Effect.catchTag("TabularParseError", (e) =>
            Effect.fail(new FileError(e.message, path, "read", e.cause))
          )
        );

        return Stream.fromIterable(records);
      }).pipe(
        mapPlatformError(path, "read"),
        Effect.mapError((e) => new FileError(e.message, path, "read", e.cause))
      )
    );
    yield* await Effect.runPromise(
      Stream.toAsyncIterableEffect(stream).pipe(Effect.provide(IOLayer))
    );
  }

  /**
   * Parse DSV data from a ReadableStream.
   */
  async *parse(stream: ReadableStream<Uint8Array>): AsyncIterable<DSVRecord> {
    const text = await streamToString(stream);
    yield* this.parseString(text);
  }

  /**
   * Parse DSV data from a string.
   */
  async *parseString(data: string): AsyncIterable<DSVRecord> {
    const records = await Effect.runPromise(this.parseTextEffect(data));
    yield* records;
  }

  /**
   * Create a DSVRecord from parsed fields.
   */
  private createRecord(fields: string[], lineNumber: number): DSVRecord | null {
    if (!this.headers) {
      this.headers = ["id", "sequence", "quality", "description"];
    }

    const record: DSVRecord = {
      format: "dsv",
      id: fields[0] || "",
      lineNumber,
    };

    this.headers.forEach((col, i) => {
      record[col] = fields[i] !== undefined ? fields[i] : "";
    });

    if (this.options.computeStats && record.sequence) {
      record.length = record.sequence.length;

      if (this.options.includeGC) {
        record.gc = calculateGC(record.sequence);
      }

      if (this.options.includeGCSkew) {
        record.gcSkew = calculateGCSkew(record.sequence);
      }

      if (this.options.includeBaseCount) {
        record.baseCount = calculateBaseCount(record.sequence);
      }
    }

    return record;
  }
}

/**
 * CSVParser — convenience class for CSV files.
 * Sets delimiter to comma by default.
 */
export class CSVParser extends DSVParser {
  constructor(options: DSVParserOptions = {}) {
    super({ ...options, delimiter: "," });
  }
}

/**
 * TSVParser — convenience class for TSV files.
 * Sets delimiter to tab by default.
 */
export class TSVParser extends DSVParser {
  constructor(options: DSVParserOptions = {}) {
    super({ ...options, delimiter: "\t" });
  }
}

/**
 * Decompress a stream based on detected compression format.
 */
function decompressStream(
  stream: ReadableStream<Uint8Array>,
  format: CompressionFormat
): ReadableStream<Uint8Array> {
  switch (format) {
    case "gzip":
      return wrapGzipStream(stream);
    case "zstd":
      return wrapZstdStream(stream);
    case "none":
      return stream;
    default:
      throw new CompressionError(`Unsupported compression format: ${format}`, format, "decompress");
  }
}

/**
 * Read a ReadableStream to a string.
 */
async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return chunks.join("");
}
