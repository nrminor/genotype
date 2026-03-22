/**
 * DSV (Delimiter-Separated Values) writer implementation
 *
 * Provides CSV/TSV writing backed by d3-dsv for RFC 4180 compliance.
 * Adds Excel gene-name protection and bioinformatics-specific
 * computed columns on top.
 */

import { type } from "arktype";
import { dsvFormat } from "d3-dsv";
import { ValidationError } from "@genotype/core/errors";
import { writeString } from "@genotype/core/io/file-writer";
import { protectFromExcel } from "@genotype/tabular/dsv/excel-protection";
import type { DSVRecord, DSVWriterOptions } from "@genotype/tabular/dsv/types";
import { calculateBaseCount, calculateGC } from "@genotype/tabular/dsv/utils";
import { DSVWriterOptionsSchema } from "@genotype/tabular/dsv/validation";

/**
 * DSVWriter — CSV/TSV writer backed by d3-dsv
 *
 * Uses d3-dsv for RFC 4180 compliant field formatting (quoting, escaping).
 * Adds Excel protection for genomic data and optional statistics computation.
 */
export class DSVWriter {
  private readonly delimiter: string;
  private readonly header: boolean;
  private readonly columns: string[];
  private readonly lineEnding: string;
  private readonly excelCompatible: boolean;
  private readonly compression: "gzip" | "zstd" | null;
  private readonly compressionLevel: number;
  private readonly formatter: ReturnType<typeof dsvFormat>;

  constructor(options: DSVWriterOptions = {}) {
    const validation = DSVWriterOptionsSchema(options);
    if (validation instanceof type.errors) {
      throw new ValidationError(`Invalid DSV writer options: ${validation.summary}`);
    }

    this.delimiter = options.delimiter || "\t";
    this.header = options.header !== false;
    this.columns = options.columns || ["id", "sequence", "quality", "description"];
    this.lineEnding = options.lineEnding || "\n";
    this.excelCompatible = options.excelCompatible || false;
    this.compression = options.compression || null;
    this.compressionLevel = options.compressionLevel || (options.compression === "zstd" ? 3 : 6);
    this.formatter = dsvFormat(this.delimiter);
  }

  /**
   * Format a row of fields into a delimited string.
   * Uses d3-dsv for RFC 4180 quoting, then applies Excel protection if enabled.
   */
  formatRow(fields: (string | number | boolean | null | undefined)[]): string {
    const stringFields = fields.map((f) => (f == null ? "" : String(f)));

    if (this.excelCompatible) {
      // Excel mode: apply protection first, then format. protectFromExcel
      // adds quotes around values that Excel would corrupt (gene names,
      // leading zeros, formulas). We insert those pre-quoted values directly
      // and let d3-dsv handle the rest.
      const formatted = stringFields.map((f) => {
        const protected_ = protectFromExcel(f);
        if (protected_ !== f) return protected_;
        // For non-protected fields, use d3-dsv's single-row formatting
        return this.formatter.formatRows([[f]]);
      });
      return formatted.join(this.delimiter);
    }

    return this.formatter.formatRows([stringFields]);
  }

  /**
   * Format a DSVRecord into a row string.
   */
  formatRecord(record: DSVRecord, options: DSVWriterOptions = {}): string {
    const columns = options.columns || this.columns;
    const fields: (string | number | boolean | null | undefined)[] = [];

    for (const col of columns) {
      let value = record[col];

      if (value === undefined) {
        if (col === "length" && record.sequence) {
          value = record.sequence.length;
        } else if (col === "gc" && options.includeGC && record.sequence) {
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
   * Format multiple records with optional header.
   */
  formatRecords(records: DSVRecord[], options: DSVWriterOptions = {}): string {
    const lines: string[] = [];

    if (this.header) {
      lines.push(this.formatRow(this.columns));
    }

    for (const record of records) {
      lines.push(this.formatRecord(record, options));
    }

    return lines.join(this.lineEnding);
  }

  /**
   * Write records to a file with optional compression.
   */
  async writeFile(path: string, records: DSVRecord[]): Promise<void> {
    const content = this.formatRecords(records);

    await writeString(path, content, {
      ...(this.compression && { compressionFormat: this.compression }),
      compressionLevel: this.compressionLevel,
    });
  }
}

/**
 * CSVWriter — convenience class with comma delimiter.
 */
export class CSVWriter extends DSVWriter {
  constructor(options: Omit<DSVWriterOptions, "delimiter"> = {}) {
    super({ ...options, delimiter: "," });
  }
}

/**
 * TSVWriter — convenience class with tab delimiter.
 */
export class TSVWriter extends DSVWriter {
  constructor(options: Omit<DSVWriterOptions, "delimiter"> = {}) {
    super({ ...options, delimiter: "\t" });
  }
}
