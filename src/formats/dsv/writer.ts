/**
 * @module formats/dsv/writer
 * @description DSV (Delimiter-Separated Values) writer implementation
 *
 * Provides CSV/TSV writing with:
 * - RFC 4180 compliance for CSV format
 * - Configurable delimiters and quote characters
 * - Excel compatibility mode
 * - Automatic field quoting when needed
 * - Header row support
 * - Statistics computation
 */

// =============================================================================
// IMPORTS
// =============================================================================

import { type } from "arktype";
import { ValidationError } from "../../errors";
import { writeString } from "../../io/file-writer";

// Import from local DSV modules
import { DEFAULT_ESCAPE, DEFAULT_QUOTE } from "./constants";
import { protectFromExcel } from "./excel-protection";
import type { DSVRecord, DSVWriterOptions } from "./types";
import { calculateBaseCount, calculateGC } from "./utils";
import { DSVWriterOptionsSchema } from "./validation";

// =============================================================================
// CLASSES - MAIN WRITER
// =============================================================================

/**
 * DSVWriter - Core CSV/TSV writer implementation
 *
 * Features:
 * - RFC 4180 compliant CSV formatting
 * - Automatic field quoting when needed
 * - Excel protection for genomic data
 * - Configurable delimiters and quote characters
 * - Header row support
 * - Statistics computation (optional)
 */
export class DSVWriter {
  private readonly delimiter: string;
  private readonly quote: string;
  private readonly escapeChar: string;
  private readonly header: boolean;
  private readonly columns: string[];
  private readonly lineEnding: string;
  private readonly quoteAll: boolean;
  private readonly excelCompatible: boolean;
  private readonly compression: "gzip" | "zstd" | null;
  private readonly compressionLevel: number;

  constructor(options: DSVWriterOptions = {}) {
    // Validate options
    const validation = DSVWriterOptionsSchema(options);
    if (validation instanceof type.errors) {
      throw new ValidationError(`Invalid DSV writer options: ${validation.summary}`);
    }

    this.delimiter = options.delimiter || "\t";
    this.quote = options.quote ?? DEFAULT_QUOTE;
    this.escapeChar = options.escapeChar ?? DEFAULT_ESCAPE;
    this.header = options.header !== false;
    this.columns = options.columns || ["id", "sequence", "quality", "description"];
    this.lineEnding = options.lineEnding || "\n";
    this.quoteAll = options.quoteAll || false;
    this.excelCompatible = options.excelCompatible || false;
    this.compression = options.compression || null;
    this.compressionLevel = options.compressionLevel || (options.compression === "zstd" ? 3 : 6);
  }

  /**
   * Format a single field with proper escaping
   */
  private formatField(value: string | number | boolean | null | undefined): string {
    if (value == null) return "";

    let field = String(value);
    let alreadyQuoted = false;

    // Excel protection for gene names
    if (this.excelCompatible) {
      const protectedField = protectFromExcel(field);
      alreadyQuoted =
        protectedField !== field && protectedField.startsWith('"') && protectedField.endsWith('"');
      field = protectedField;
    }

    // If already quoted by Excel protection, return as-is
    if (alreadyQuoted) {
      return field;
    }

    // Check if field needs quoting
    const needsQuoting =
      this.quoteAll ||
      field.includes(this.delimiter) ||
      field.includes(this.quote) ||
      field.includes("\n") ||
      field.includes("\r");

    if (needsQuoting) {
      // Escape quotes by doubling them (RFC 4180)
      if (this.escapeChar === this.quote) {
        field = field.replace(new RegExp(this.quote, "g"), this.quote + this.quote);
      } else {
        field = field.replace(new RegExp(this.quote, "g"), this.escapeChar + this.quote);
      }
      return this.quote + field + this.quote;
    }

    return field;
  }

  /**
   * Format a row of fields
   */
  formatRow(fields: (string | number | boolean | null | undefined)[]): string {
    return fields.map((field) => this.formatField(field)).join(this.delimiter);
  }

  /**
   * Format a DSVRecord into a row
   */
  formatRecord(record: DSVRecord, options: DSVWriterOptions = {}): string {
    const fields: (string | number | boolean | null | undefined)[] = [];

    // Use specified columns or extract from record
    const columns = options.columns || this.columns;

    for (const col of columns) {
      let value = record[col];

      // Compute statistics if requested
      if (value === undefined) {
        if (col === "length" && record.sequence) {
          value = record.sequence.length;
        } else if (col === "gc" && options.includeGC && record.sequence) {
          // We need to import gcContent function
          value = calculateGC(record.sequence);
        } else if (col === "baseCount" && options.includeBaseCount && record.sequence) {
          value = JSON.stringify(calculateBaseCount(record.sequence));
        }
      }

      fields.push(value);
    }

    return this.formatRow(fields);
  }

  /**
   * Format multiple records with optional header
   */
  formatRecords(records: DSVRecord[], options: DSVWriterOptions = {}): string {
    const lines: string[] = [];

    // Add header if requested
    if (this.header) {
      lines.push(this.formatRow(this.columns));
    }

    // Add data rows
    for (const record of records) {
      lines.push(this.formatRecord(record, options));
    }

    return lines.join(this.lineEnding);
  }

  /**
   * Write records to stream
   */
  async writeToStream(
    records: AsyncIterable<DSVRecord>,
    stream: WritableStream<Uint8Array>,
    options: DSVWriterOptions = {}
  ): Promise<void> {
    const writer = stream.getWriter();
    const encoder = new TextEncoder();
    let headerWritten = false;

    try {
      for await (const record of records) {
        // Write header on first record
        if (!headerWritten && this.header) {
          const headerRow = this.formatRow(this.columns);
          await writer.write(encoder.encode(headerRow + this.lineEnding));
          headerWritten = true;
        }

        const row = this.formatRecord(record, options);
        await writer.write(encoder.encode(row + this.lineEnding));
      }
    } finally {
      writer.releaseLock();
    }
  }

  /**
   * Write records to a file with optional compression
   *
   * Compression is auto-detected from file extension (.gz, .zst) * or can be specified via constructor options.
   *
   * @param path - File path to write to
   * @param records - Records to write
   */
  async writeFile(path: string, records: DSVRecord[]): Promise<void> {
    const content = this.formatRecords(records);

    // Delegate to file-writer which handles:
    // - Platform-agnostic I/O via Effect Platform
    // - Compression via CompressionService DI
    // - Auto-detection from file extension
    await writeString(path, content, {
      ...(this.compression && { compressionFormat: this.compression }),
      compressionLevel: this.compressionLevel,
    });
  }
}

// =============================================================================
// CONVENIENCE CLASSES
// =============================================================================

/**
 * CSV Parser - convenience wrapper with comma delimiter
 */

// =============================================================================
// CLASSES - CONVENIENCE WRITERS
// =============================================================================

/**
 * CSVWriter - Convenience class for CSV files
 * Sets delimiter to comma by default
 */
export class CSVWriter extends DSVWriter {
  constructor(options: Omit<DSVWriterOptions, "delimiter"> = {}) {
    super({ ...options, delimiter: "," });
  }
}

/**
 * TSVWriter - Convenience class for TSV files
 * Sets delimiter to tab by default
 */
export class TSVWriter extends DSVWriter {
  constructor(options: Omit<DSVWriterOptions, "delimiter"> = {}) {
    super({ ...options, delimiter: "\t" });
  }
}
