/**
 * Abstract base parser with shared interrupt handling only
 *
 * Provides consistent AbortSignal support across all format parsers (FASTA, FASTQ,
 * BED, SAM, BAM, GTF) without imposing parsing implementation details.
 * Each format maintains its own parsing logic while gaining interrupt capabilities.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { ParseError } from "../errors";
import type { ParserOptions } from "../types";

/**
 * Interrupt handler utility for AbortSignal integration
 * Tiger Style: Function under 70 lines, focused responsibility
 */
class InterruptHandler {
  constructor(private readonly signal?: AbortSignal) {}

  /**
   * Check if operation should be aborted
   * Throws AbortError if signal is aborted
   */
  checkAborted(): void {
    if (this.signal?.aborted) {
      throw new DOMException("Operation was aborted", "AbortError");
    }
  }

  /**
   * Check abortion with biological/format context
   * Provides genomics-specific error context for cancellation
   */
  throwIfAborted(context: string): void {
    if (this.signal?.aborted) {
      throw new DOMException(`${context} was cancelled`, "AbortError");
    }
  }
}

/**
 * Abstract parser base class with shared interrupt handling only
 *
 * Provides consistent AbortSignal support across all genomic format parsers
 * without imposing parsing implementation details. Each format keeps its own
 * parsing logic while gaining interrupt capabilities.
 *
 * @template T - The genomic data type this parser produces (BedInterval, FastaSequence, etc.)
 */
export abstract class AbstractParser<T, TOptions extends ParserOptions = ParserOptions> {
  protected readonly options: Required<TOptions>;
  private readonly interruptHandler: InterruptHandler;

  constructor(options: TOptions) {
    // Provide defaults for base ParserOptions, format provides format-specific defaults
    const defaultOptions = {
      skipValidation: false,
      maxLineLength: 1_000_000,
      trackLineNumbers: true,
      signal: undefined,
      onError: (error: string, lineNumber?: number): void => {
        throw new ParseError(error, this.getFormatName(), lineNumber);
      },
      onWarning: (warning: string, lineNumber?: number): void => {
        console.warn(`${this.getFormatName()} Warning (line ${lineNumber}): ${warning}`);
      },
    } as Partial<TOptions>;

    this.options = { ...defaultOptions, ...options } as Required<TOptions>;
    this.interruptHandler = new InterruptHandler(this.options.signal);
  }

  // ============================================================================
  // SHARED INTERRUPT HANDLING ONLY (Concrete Implementation)
  // ============================================================================

  /**
   * Check if parsing operation should be aborted
   * Call this in parsing loops to enable Ctrl+C interruption
   */
  protected checkAborted(): void {
    this.interruptHandler.checkAborted();
  }

  /**
   * Check abortion with biological/genomics context
   * Provides format-specific cancellation messages
   */
  protected throwIfAborted(context: string): void {
    this.interruptHandler.throwIfAborted(`${this.getFormatName()} ${context}`);
  }

  // ============================================================================
  // ABSTRACT METHODS (Each format implements its own way)
  // ============================================================================

  /**
   * Parse genomic data from string with interrupt support
   * @param data - Raw format data string
   * @returns Async iterable of parsed genomic features
   */
  abstract parseString(data: string): AsyncIterable<T>;

  /**
   * Parse genomic data from file with interrupt support
   * @param filePath - Path to genomic data file
   * @param options - File reading options (format-specific)
   * @returns Async iterable of parsed genomic features
   */
  abstract parseFile(filePath: string, options?: any): AsyncIterable<T>;

  /**
   * Parse genomic data from stream with interrupt support
   * @param stream - Binary data stream
   * @returns Async iterable of parsed genomic features
   */
  abstract parse(stream: ReadableStream<Uint8Array>): AsyncIterable<T>;

  /**
   * Get format name for error messages and logging
   * @returns Format identifier (e.g., "BED", "FASTA", "FASTQ")
   */
  protected abstract getFormatName(): string;

  // Each format implements its own parsing logic - no shared implementation imposed
}
