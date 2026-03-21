/**
 * Abstract base parser for genomic format parsers.
 *
 * Provides shared option merging and error/warning handler defaults
 * across all format parsers (FASTA, FASTQ, BED, SAM, BAM, GTF).
 * Each format maintains its own parsing logic.
 *
 * Interruption is handled by Effect's fiber model — parsers that use
 * Effect Stream internally get automatic interruption at every yield
 * point without manual polling.
 */

import { ParseError } from "../errors";
import type { ParserOptions } from "../types";

/**
 * Abstract parser base class with shared option defaults.
 *
 * @template T - The genomic data type this parser produces (BedInterval, FastaSequence, etc.)
 */
export abstract class AbstractParser<T, TOptions extends ParserOptions = ParserOptions> {
  protected readonly options: Required<TOptions>;

  constructor(options: TOptions = {} as TOptions) {
    const formatDefaults = this.getDefaultOptions();

    this.options = {
      skipValidation: options.skipValidation ?? formatDefaults.skipValidation ?? false,
      maxLineLength: options.maxLineLength ?? formatDefaults.maxLineLength ?? 1_000_000,
      trackLineNumbers: options.trackLineNumbers ?? formatDefaults.trackLineNumbers ?? true,
      onError:
        options.onError ??
        formatDefaults.onError ??
        ((error: string, lineNumber?: number): void => {
          throw new ParseError(error, this.getFormatName(), lineNumber);
        }),
      onWarning:
        options.onWarning ??
        formatDefaults.onWarning ??
        ((warning: string, lineNumber?: number): void => {
          console.warn(`${this.getFormatName()} Warning (line ${lineNumber}): ${warning}`);
        }),
      ...formatDefaults,
      ...options,
    } as Required<TOptions>;
  }

  protected abstract getDefaultOptions(): Partial<TOptions>;

  abstract parseString(data: string): AsyncIterable<T>;
  abstract parseFile(filePath: string, options?: any): AsyncIterable<T>;
  abstract parse(stream: ReadableStream<Uint8Array>): AsyncIterable<T>;

  protected abstract getFormatName(): string;
}
