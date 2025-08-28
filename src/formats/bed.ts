/**
 * BED format parser and writer
 *
 * Supports all BED format variants:
 * - BED3: chromosome, start, end
 * - BED4: + name
 * - BED5: + score
 * - BED6: + strand
 * - BED9: + thickStart, thickEnd, itemRgb
 * - BED12: + blockCount, blockSizes, blockStarts
 *
 * Handles real-world BED file messiness:
 * - Track lines and browser lines
 * - Comment lines
 * - Mixed BED formats in single file
 * - Malformed coordinates
 * - Invalid strand annotations
 */

import { type } from 'arktype';
import type { BedInterval, Strand, ParserOptions } from '../types';
import { BedIntervalSchema } from '../types';
import { ValidationError, ParseError, BedError } from '../errors';

/**
 * Detect BED format variant from number of fields
 */
export function detectVariant(fieldCount: number): string {
  switch (fieldCount) {
    case 3:
      return 'BED3';
    case 4:
      return 'BED4';
    case 5:
      return 'BED5';
    case 6:
      return 'BED6';
    case 9:
      return 'BED9';
    case 12:
      return 'BED12';
    default:
      if (fieldCount < 3) return 'invalid';
      if (fieldCount > 12) return 'extended';
      return `BED${fieldCount}`;
  }
}

/**
 * Validate strand annotation
 */
export function validateStrand(strand: string): strand is Strand {
  return strand === '+' || strand === '-' || strand === '.';
}

/**
 * Parse RGB color string
 */
export function parseRgb(rgbString: string): { r: number; g: number; b: number } | null {
  // Handle comma-separated RGB values
  if (/^\d+,\d+,\d+$/.test(rgbString)) {
    const parts = rgbString.split(',').map(Number);
    if (parts.length !== 3) {
      return null; // Invalid RGB format
    }
    const r = parts[0]!;
    const g = parts[1]!;
    const b = parts[2]!;
    if (r <= 255 && g <= 255 && b <= 255) {
      return { r, g, b };
    }
  }

  // Handle single integer (should be 0 for itemRgb)
  if (/^\d+$/.test(rgbString)) {
    const value = parseInt(rgbString, 10);
    if (value === 0) {
      return { r: 0, g: 0, b: 0 };
    }
  }

  return null;
}

/**
 * Validate coordinate ranges
 */
export function validateCoordinates(
  start: number,
  end: number,
  thickStart?: number,
  thickEnd?: number
): { valid: boolean; error?: string } {
  if (start < 0) {
    return { valid: false, error: 'Start coordinate cannot be negative' };
  }

  if (end <= start) {
    return { valid: false, error: 'End coordinate must be greater than start' };
  }

  if (thickStart !== undefined) {
    if (thickStart < start) {
      return { valid: false, error: 'ThickStart cannot be less than start' };
    }
  }

  if (thickEnd !== undefined) {
    if (thickEnd > end) {
      return { valid: false, error: 'ThickEnd cannot be greater than end' };
    }

    if (thickStart !== undefined && thickEnd < thickStart) {
      return { valid: false, error: 'ThickEnd cannot be less than thickStart' };
    }
  }

  return { valid: true };
}

/**
 * Streaming BED parser with comprehensive validation
 */
export class BedParser {
  private readonly options: Required<ParserOptions>;

  constructor(options: ParserOptions = {}) {
    this.options = {
      skipValidation: false,
      maxLineLength: 1_000_000,
      trackLineNumbers: true,
      qualityEncoding: 'phred33', // Not used for BED
      parseQualityScores: false, // Not used for BED
      onError: (error: string, lineNumber?: number): void => {
        throw new ParseError(error, 'BED', lineNumber);
      },
      onWarning: (warning: string, lineNumber?: number): void => {
        console.warn(`BED Warning (line ${lineNumber ?? 'unknown'}): ${warning}`);
      },
      ...options,
    };
  }

  /**
   * Parse BED intervals from a string
   */
  async *parseString(data: string): AsyncIterable<BedInterval> {
    const lines = data.split(/\r?\n/);
    yield* this.parseLines(lines);
  }

  /**
   * Parse BED intervals from a file using streaming I/O
   * @param filePath Path to BED file to parse
   * @param options File reading options for performance tuning
   * @yields BedInterval objects as they are parsed from the file
   * @throws {FileError} When file cannot be read
   * @throws {BedError} When BED format is invalid
   * @throws {ValidationError} When interval data is malformed
   * @example
   * ```typescript
   * const parser = new BedParser();
   * for await (const interval of parser.parseFile('/path/to/regions.bed')) {
   *   console.log(`${interval.chromosome}:${interval.start}-${interval.end}`);
   * }
   * ```
   */
  async *parseFile(
    filePath: string,
    options?: import('../types').FileReaderOptions
  ): AsyncIterable<BedInterval> {
    // Tiger Style: Assert function arguments
    if (typeof filePath !== 'string') {
      throw new ValidationError('filePath must be a string');
    }
    if (filePath.length === 0) {
      throw new ValidationError('filePath must not be empty');
    }
    if (options && typeof options !== 'object') {
      throw new ValidationError('options must be an object if provided');
    }

    // Import I/O modules dynamically to avoid circular dependencies
    const { createStream } = await import('../io/file-reader');
    const { StreamUtils } = await import('../io/stream-utils');

    try {
      // Validate file path and create stream
      const validatedPath = await this.validateFilePath(filePath);
      const stream = await createStream(validatedPath, options);

      // Convert binary stream to lines and parse
      const lines = StreamUtils.readLines(stream, options?.encoding || 'utf8');
      yield* this.parseLinesFromAsyncIterable(lines);
    } catch (error) {
      // Re-throw with enhanced context
      if (error instanceof Error) {
        throw new BedError(
          `Failed to parse BED file '${filePath}': ${error.message}`,
          undefined,
          undefined,
          undefined,
          undefined,
          error.stack
        );
      }
      throw error;
    }
  }

  /**
   * Parse BED intervals from a ReadableStream
   */
  async *parse(stream: ReadableStream<Uint8Array>): AsyncIterable<BedInterval> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lineNumber = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (buffer.trim()) {
            const lines = buffer.split(/\r?\n/);
            yield* this.parseLines(lines, lineNumber);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split(/\r?\n/);
        const poppedLine = lines.pop();
        buffer = poppedLine !== undefined ? poppedLine : '';

        if (lines.length > 0) {
          yield* this.parseLines(lines, lineNumber);
          lineNumber += lines.length;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse BED intervals from an iterator of lines
   */
  private async *parseLines(lines: string[], startLineNumber = 1): AsyncIterable<BedInterval> {
    let lineNumber = startLineNumber;

    for (const line of lines) {
      lineNumber++;

      if (line.length > this.options.maxLineLength) {
        this.options.onError(
          `Line too long (${line.length} > ${this.options.maxLineLength})`,
          lineNumber
        );
        continue;
      }

      const trimmedLine = line.trim();

      // Skip empty lines, comments, track lines, and browser lines
      if (
        !trimmedLine ||
        trimmedLine.startsWith('#') ||
        trimmedLine.startsWith('track') ||
        trimmedLine.startsWith('browser')
      ) {
        continue;
      }

      try {
        const interval = this.parseLine(trimmedLine, lineNumber);
        if (interval) {
          yield interval;
        }
      } catch (error) {
        if (!this.options.skipValidation) {
          throw error;
        }
        this.options.onError(error instanceof Error ? error.message : String(error), lineNumber);
      }
    }
  }

  /**
   * Parse a single BED line into an interval
   */
  private parseLine(line: string, lineNumber: number): BedInterval | null {
    const fields = this.splitAndValidateFields(line, lineNumber);
    const { chromosome, start, end, optionalFields } = this.parseRequiredFields(
      fields,
      lineNumber,
      line
    );
    const mutableInterval = this.buildBaseInterval(chromosome, start, end, lineNumber);
    this.parseOptionalFieldsIfPresent(mutableInterval, optionalFields, lineNumber, line);
    this.calculateIntervalStats(mutableInterval, optionalFields.length);
    this.validateFinalInterval(mutableInterval, chromosome, start, end, lineNumber, line);
    return mutableInterval as BedInterval;
  }

  private splitAndValidateFields(line: string, lineNumber: number): string[] {
    const fields = line.split(/\s+/);
    if (fields.length < 3) {
      throw new BedError(
        `BED format requires at least 3 fields, got ${fields.length}`,
        undefined,
        undefined,
        undefined,
        lineNumber,
        line
      );
    }
    return fields;
  }

  private parseRequiredFields(
    fields: string[],
    lineNumber: number,
    line: string
  ): {
    chromosome: string;
    start: number;
    end: number;
    optionalFields: string[];
  } {
    const [chromosome, startStr, endStr, ...optionalFields] = fields;

    this.validateRequiredFields(chromosome, startStr, endStr, lineNumber, line);

    const start = this.parseInteger(startStr!, 'start', lineNumber, line);
    const end = this.parseInteger(endStr!, 'end', lineNumber, line);

    const coordValidation = validateCoordinates(start, end);
    if (!coordValidation.valid) {
      throw new BedError(coordValidation.error!, chromosome, start, end, lineNumber, line);
    }

    return { chromosome: chromosome!, start, end, optionalFields };
  }

  private validateRequiredFields(
    chromosome: string | undefined,
    startStr: string | undefined,
    endStr: string | undefined,
    lineNumber: number,
    line: string
  ): void {
    if (chromosome === undefined) {
      throw new BedError(
        'chromosome field is required',
        undefined,
        undefined,
        undefined,
        lineNumber,
        line
      );
    }
    if (startStr === undefined) {
      throw new BedError(
        'start field is required',
        undefined,
        undefined,
        undefined,
        lineNumber,
        line
      );
    }
    if (endStr === undefined) {
      throw new BedError(
        'end field is required',
        undefined,
        undefined,
        undefined,
        lineNumber,
        line
      );
    }
  }

  private buildBaseInterval(
    chromosome: string,
    start: number,
    end: number,
    lineNumber: number
  ): any {
    type MutableBedInterval = {
      -readonly [K in keyof BedInterval]: BedInterval[K];
    };

    const intervalData: Partial<MutableBedInterval> = {
      chromosome,
      start,
      end,
      length: end - start,
      midpoint: Math.floor((start + end) / 2),
    };

    if (this.options.trackLineNumbers) {
      intervalData.lineNumber = lineNumber;
    }

    return intervalData as MutableBedInterval;
  }

  private parseOptionalFieldsIfPresent(
    mutableInterval: any,
    optionalFields: string[],
    lineNumber: number,
    line: string
  ): void {
    if (optionalFields.length > 0) {
      this.parseOptionalFields(mutableInterval as BedInterval, optionalFields, lineNumber, line);
    }
  }

  private calculateIntervalStats(mutableInterval: any, optionalFieldCount: number): void {
    mutableInterval.stats = {
      length: mutableInterval.length!,
      hasThickRegion: Boolean(
        mutableInterval.thickStart !== undefined && mutableInterval.thickEnd !== undefined
      ),
      hasBlocks: Boolean(
        mutableInterval.blockCount !== undefined &&
          mutableInterval.blockCount !== null &&
          mutableInterval.blockCount > 1
      ),
      bedType: this.determineBedType(optionalFieldCount),
    };
  }

  private validateFinalInterval(
    mutableInterval: any,
    chromosome: string,
    start: number,
    end: number,
    lineNumber: number,
    line: string
  ): void {
    if (this.options.skipValidation) {
      return;
    }

    const validation = BedIntervalSchema(mutableInterval as BedInterval);
    if (validation instanceof type.errors) {
      throw new BedError(
        `Invalid BED interval: ${validation.summary}`,
        chromosome,
        start,
        end,
        lineNumber,
        line
      );
    }
  }

  /**
   * Parse optional BED fields
   */
  private parseOptionalFields(
    interval: BedInterval,
    fields: string[],
    lineNumber: number,
    line: string
  ): void {
    const mutableInterval = interval as any;

    // BED4: name
    if (fields.length >= 1 && fields[0] !== '.') {
      mutableInterval.name = fields[0];
    }

    // BED5: score
    if (fields.length >= 2 && fields[1] !== '.' && fields[1] !== undefined) {
      this.parseBedScore(mutableInterval, fields[1]!, lineNumber);
    }

    // BED6: strand
    if (fields.length >= 3 && fields[2] !== '.' && fields[2] !== undefined) {
      this.parseBedStrand(mutableInterval, fields[2]!, interval, lineNumber, line);
    }

    // BED9: thickStart, thickEnd, itemRgb
    if (fields.length >= 6) {
      this.parseBed9Fields(mutableInterval, fields, interval, lineNumber, line);
    }

    // BED12: blockCount, blockSizes, blockStarts
    if (fields.length >= 9) {
      this.parseBed12Fields(mutableInterval, fields, interval, lineNumber, line);
    }
  }

  /**
   * Parse BED score field with validation
   */
  private parseBedScore(mutableInterval: any, scoreStr: string, lineNumber: number): void {
    const score = this.parseInteger(scoreStr, 'score', lineNumber, '');
    if (score < 0 || score > 1000) {
      this.options.onWarning(`Score ${score} outside typical range [0-1000]`, lineNumber);
    }
    mutableInterval.score = score;
  }

  /**
   * Parse BED strand field with validation
   */
  private parseBedStrand(
    mutableInterval: any,
    strandStr: string,
    interval: BedInterval,
    lineNumber: number,
    line: string
  ): void {
    if (!validateStrand(strandStr)) {
      throw new BedError(
        `Invalid strand '${strandStr}', must be '+', '-', or '.'`,
        interval.chromosome,
        interval.start,
        interval.end,
        lineNumber,
        line
      );
    }
    mutableInterval.strand = strandStr as Strand;
  }

  /**
   * Parse BED9 format fields (thickStart, thickEnd, itemRgb)
   */
  private parseBed9Fields(
    mutableInterval: any,
    fields: string[],
    interval: BedInterval,
    lineNumber: number,
    line: string
  ): void {
    // thickStart
    if (fields[3] !== '.' && fields[3] !== undefined) {
      const thickStart = this.parseInteger(fields[3]!, 'thickStart', lineNumber, line);
      mutableInterval.thickStart = thickStart;
    }

    // thickEnd
    if (fields[4] !== '.' && fields[4] !== undefined) {
      const thickEnd = this.parseInteger(fields[4]!, 'thickEnd', lineNumber, line);
      mutableInterval.thickEnd = thickEnd;
    }

    // Validate thick coordinates
    this.validateThickCoordinates(mutableInterval, interval, lineNumber, line);

    // itemRgb
    if (fields[5] !== '.' && fields[5] !== '0' && fields[5] !== undefined) {
      this.parseItemRgb(mutableInterval, fields[5]!, lineNumber);
    }
  }

  /**
   * Validate thick coordinate consistency
   */
  private validateThickCoordinates(
    mutableInterval: any,
    interval: BedInterval,
    lineNumber: number,
    line: string
  ): void {
    if (mutableInterval.thickStart === undefined && mutableInterval.thickEnd === undefined) {
      return;
    }

    const coordValidation = validateCoordinates(
      interval.start,
      interval.end,
      mutableInterval.thickStart,
      mutableInterval.thickEnd
    );

    if (!coordValidation.valid) {
      throw new BedError(
        coordValidation.error!,
        interval.chromosome,
        interval.start,
        interval.end,
        lineNumber,
        line
      );
    }
  }

  /**
   * Parse itemRgb field with validation
   */
  private parseItemRgb(mutableInterval: any, rgbStr: string, lineNumber: number): void {
    if (!parseRgb(rgbStr)) {
      this.options.onWarning(`Invalid RGB color '${rgbStr}'`, lineNumber);
    }
    mutableInterval.itemRgb = rgbStr;
  }

  /**
   * Parse BED12 format fields (blockCount, blockSizes, blockStarts)
   */
  private parseBed12Fields(
    mutableInterval: any,
    fields: string[],
    interval: BedInterval,
    lineNumber: number,
    line: string
  ): void {
    // Early return if no blockCount specified
    if (fields[6] === '.' || fields[6] === undefined) {
      return;
    }

    const blockCount = this.parseBlockCount(fields[6]!, interval, lineNumber, line);
    mutableInterval.blockCount = blockCount;

    // Parse blockSizes if present
    if (fields[7] !== '.' && fields[7] !== undefined) {
      const blockSizes = this.parseBlockSizes(fields[7]!, blockCount, interval, lineNumber, line);
      mutableInterval.blockSizes = blockSizes;
    }

    // Parse blockStarts if present
    if (fields[8] !== '.' && fields[8] !== undefined) {
      const blockStarts = this.parseBlockStarts(fields[8]!, blockCount, interval, lineNumber, line);
      this.validateBlockCoordinates(
        blockCount,
        blockStarts,
        mutableInterval.blockSizes,
        interval,
        lineNumber,
        line
      );
      mutableInterval.blockStarts = blockStarts;
    }
  }

  /**
   * Parse and validate blockCount field
   */
  private parseBlockCount(
    blockCountStr: string,
    interval: BedInterval,
    lineNumber: number,
    line: string
  ): number {
    const blockCount = this.parseInteger(blockCountStr, 'blockCount', lineNumber, line);

    if (blockCount < 1) {
      throw new BedError(
        `Block count must be >= 1, got ${blockCount}`,
        interval.chromosome,
        interval.start,
        interval.end,
        lineNumber,
        line
      );
    }

    return blockCount;
  }

  /**
   * Parse and validate blockSizes field
   */
  private parseBlockSizes(
    blockSizesStr: string,
    blockCount: number,
    interval: BedInterval,
    lineNumber: number,
    line: string
  ): number[] {
    const blockSizes = this.parseIntegerList(blockSizesStr, 'blockSizes', lineNumber, line);

    if (blockSizes.length !== blockCount) {
      throw new BedError(
        `Block sizes count (${blockSizes.length}) != block count (${blockCount})`,
        interval.chromosome,
        interval.start,
        interval.end,
        lineNumber,
        line
      );
    }

    return blockSizes;
  }

  /**
   * Parse and validate blockStarts field
   */
  private parseBlockStarts(
    blockStartsStr: string,
    blockCount: number,
    interval: BedInterval,
    lineNumber: number,
    line: string
  ): number[] {
    const blockStarts = this.parseIntegerList(blockStartsStr, 'blockStarts', lineNumber, line);

    if (blockStarts.length !== blockCount) {
      throw new BedError(
        `Block starts count (${blockStarts.length}) != block count (${blockCount})`,
        interval.chromosome,
        interval.start,
        interval.end,
        lineNumber,
        line
      );
    }

    return blockStarts;
  }

  /**
   * Validate block coordinate consistency
   */
  private validateBlockCoordinates(
    blockCount: number,
    blockStarts: number[],
    blockSizes: number[] | undefined,
    interval: BedInterval,
    lineNumber: number,
    line: string
  ): void {
    if (!blockSizes) {
      return;
    }

    for (let i = 0; i < blockCount; i++) {
      if (blockStarts[i] === undefined) {
        throw new BedError(
          `blockStarts[${i}] is required`,
          interval.chromosome,
          interval.start,
          interval.end,
          lineNumber,
          line
        );
      }
      if (blockSizes[i] === undefined) {
        throw new BedError(
          `blockSizes[${i}] is required`,
          interval.chromosome,
          interval.start,
          interval.end,
          lineNumber,
          line
        );
      }

      const blockStart = interval.start + blockStarts[i]!;
      const blockEnd = blockStart + blockSizes[i]!;

      if (blockEnd > interval.end) {
        throw new BedError(
          `Block ${i} extends beyond interval end`,
          interval.chromosome,
          interval.start,
          interval.end,
          lineNumber,
          line
        );
      }
    }
  }

  /**
   * Parse integer field with error handling
   */
  private parseInteger(value: string, fieldName: string, lineNumber: number, line: string): number {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      throw new BedError(
        `Invalid ${fieldName}: '${value}' is not a valid integer`,
        undefined,
        undefined,
        undefined,
        lineNumber,
        line
      );
    }
    return parsed;
  }

  /**
   * Parse comma-separated list of integers
   */
  private parseIntegerList(
    value: string,
    fieldName: string,
    lineNumber: number,
    line: string
  ): number[] {
    // Handle trailing comma (common in BED files)
    const cleanValue = value.replace(/,$/, '');

    return cleanValue.split(',').map((item, index) => {
      const parsed = parseInt(item.trim(), 10);
      if (isNaN(parsed)) {
        throw new BedError(
          `Invalid ${fieldName}[${index}]: '${item}' is not a valid integer`,
          undefined,
          undefined,
          undefined,
          lineNumber,
          line
        );
      }
      return parsed;
    });
  }

  /**
   * Validate file path and ensure it's accessible for reading
   * @param filePath Raw file path from user input
   * @returns Promise resolving to validated file path
   * @throws {BedError} If file path is invalid or file is not accessible
   */
  private async validateFilePath(filePath: string): Promise<string> {
    // Tiger Style: Assert function arguments
    if (typeof filePath !== 'string') {
      throw new ValidationError('filePath must be a string');
    }
    if (filePath.length === 0) {
      throw new ValidationError('filePath must not be empty');
    }

    // Import FileReader functions dynamically to avoid circular dependencies
    const { exists, getMetadata } = await import('../io/file-reader');

    // Check if file exists and is readable
    if (!(await exists(filePath))) {
      throw new BedError(
        `BED file not found or not accessible: ${filePath}`,
        undefined,
        undefined,
        undefined,
        undefined,
        'Please check that the file exists and you have read permissions'
      );
    }

    // Get file metadata for additional validation
    try {
      const metadata = await getMetadata(filePath);

      if (!metadata.readable) {
        throw new BedError(
          `BED file is not readable: ${filePath}`,
          undefined,
          undefined,
          undefined,
          undefined,
          'Check file permissions'
        );
      }

      // Warn about very large files
      if (metadata.size > 1_073_741_824) {
        // 1GB
        this.options.onWarning(
          `Large BED file detected: ${Math.round(metadata.size / 1_048_576)}MB. Processing may take significant time.`,
          1
        );
      }
    } catch (error) {
      if (error instanceof BedError) throw error;
      throw new BedError(
        `Failed to validate BED file: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        undefined,
        undefined,
        undefined,
        filePath
      );
    }

    return filePath;
  }

  /**
   * Parse BED intervals from async iterable of lines
   * @param lines Async iterable of text lines
   * @yields BedInterval objects as they are parsed
   */
  private async *parseLinesFromAsyncIterable(
    lines: AsyncIterable<string>
  ): AsyncIterable<BedInterval> {
    // Tiger Style: Assert function arguments
    if (typeof lines !== 'object' || !(Symbol.asyncIterator in lines)) {
      throw new ValidationError('lines must be async iterable');
    }

    let lineNumber = 0;

    try {
      for await (const rawLine of lines) {
        lineNumber++;
        const line = rawLine.trim();

        // Skip empty lines and comments
        if (!line || line.startsWith('#')) {
          continue;
        }

        // Skip track lines and browser lines (UCSC Genome Browser specific)
        if (line.startsWith('track ') || line.startsWith('browser ')) {
          continue;
        }

        // Check line length bounds
        if (line.length > this.options.maxLineLength) {
          this.options.onError(
            `Line too long (${line.length} > ${this.options.maxLineLength})`,
            lineNumber
          );
          continue;
        }

        try {
          const interval = this.parseLine(line, lineNumber);
          if (interval) {
            yield interval;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.options.onError(errorMsg, lineNumber);
        }
      }
    } catch (error) {
      // Enhance error with line number context
      if (error instanceof BedError) {
        throw error;
      }

      throw new BedError(
        `BED parsing failed at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        undefined,
        undefined,
        lineNumber,
        'Check file format and content'
      );
    }

    // Tiger Style: Assert postconditions
    if (lineNumber < 0) {
      throw new BedError(
        'line number must be non-negative',
        undefined,
        undefined,
        undefined,
        lineNumber
      );
    }
  }

  /**
   * Determine BED format type based on number of fields
   */
  private determineBedType(
    optionalFieldCount: number
  ): 'BED3' | 'BED4' | 'BED5' | 'BED6' | 'BED9' | 'BED12' {
    // Base 3 fields (chromosome, start, end) + optional fields
    const totalFields = 3 + optionalFieldCount;

    if (totalFields <= 3) return 'BED3';
    if (totalFields <= 4) return 'BED4';
    if (totalFields <= 5) return 'BED5';
    if (totalFields <= 6) return 'BED6';
    if (totalFields <= 9) return 'BED9';
    return 'BED12';
  }
}

/**
 * BED writer for outputting intervals
 */
export class BedWriter {
  private readonly variant: string;
  private readonly precision: number;

  constructor(
    options: {
      variant?: string;
      precision?: number;
    } = {}
  ) {
    this.variant =
      options.variant !== undefined && options.variant !== null && options.variant !== ''
        ? options.variant
        : 'auto';
    this.precision =
      options.precision !== undefined && options.precision !== null && options.precision !== 0
        ? options.precision
        : 0;
  }

  /**
   * Format a single BED interval as string
   */
  formatInterval(interval: BedInterval): string {
    const fields: string[] = [
      interval.chromosome,
      interval.start.toString(),
      interval.end.toString(),
    ];

    // Add optional fields based on what's present
    if (interval.name !== undefined) {
      fields.push(interval.name);

      if (interval.score !== undefined) {
        fields.push(interval.score.toString());

        if (interval.strand !== undefined) {
          fields.push(interval.strand);

          if (interval.thickStart !== undefined && interval.thickEnd !== undefined) {
            fields.push(interval.thickStart.toString());
            fields.push(interval.thickEnd.toString());
            fields.push(
              interval.itemRgb !== undefined && interval.itemRgb !== null && interval.itemRgb !== ''
                ? interval.itemRgb
                : '0'
            );

            if (interval.blockCount !== undefined) {
              fields.push(interval.blockCount.toString());
              fields.push(
                interval.blockSizes !== undefined &&
                  interval.blockSizes !== null &&
                  interval.blockSizes.length > 0
                  ? interval.blockSizes.join(',') + ','
                  : '.'
              );
              fields.push(interval.blockStarts ? interval.blockStarts.join(',') + ',' : '.');
            }
          }
        }
      }
    }

    return fields.join('\t');
  }

  /**
   * Format multiple intervals as string
   */
  formatIntervals(intervals: BedInterval[]): string {
    return intervals.map((interval) => this.formatInterval(interval)).join('\n');
  }

  /**
   * Write intervals to a WritableStream
   */
  async writeToStream(
    intervals: AsyncIterable<BedInterval>,
    stream: WritableStream<Uint8Array>
  ): Promise<void> {
    const writer = stream.getWriter();
    const encoder = new TextEncoder();

    try {
      for await (const interval of intervals) {
        const formatted = this.formatInterval(interval) + '\n';
        await writer.write(encoder.encode(formatted));
      }
    } finally {
      writer.releaseLock();
    }
  }
}

/**
 * Detect if string contains BED format data
 */
export function detectFormat(data: string): boolean {
  const trimmed = data.trim();
  const lines = trimmed.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed !== undefined &&
      trimmed !== null &&
      trimmed !== '' &&
      !line.startsWith('#') &&
      !line.startsWith('track')
    );
  });

  if (lines.length === 0) return false;

  // Check first few data lines
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    if (lines[i] === undefined) {
      return false; // Invalid format
    }
    const fields = lines[i]!.split(/\s+/);
    if (fields.length < 3) return false;

    // Check if start and end are integers
    if (fields[1] === undefined || fields[2] === undefined) {
      return false; // Invalid format
    }
    if (isNaN(parseInt(fields[1]!, 10)) || isNaN(parseInt(fields[2]!, 10))) {
      return false;
    }

    // Check coordinate relationship
    const start = parseInt(fields[1]!, 10);
    const end = parseInt(fields[2]!, 10);
    if (start < 0 || end <= start) return false;
  }

  return true;
}

/**
 * Count intervals in BED data without parsing
 */
export function countIntervals(data: string): number {
  return data.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed !== undefined &&
      trimmed !== null &&
      trimmed !== '' &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('track') &&
      !trimmed.startsWith('browser')
    );
  }).length;
}

/**
 * Calculate interval statistics
 */
export function calculateStats(intervals: BedInterval[]): {
  count: number;
  totalLength: number;
  averageLength: number;
  chromosomes: Set<string>;
  minLength: number;
  maxLength: number;
} {
  if (intervals.length === 0) {
    return {
      count: 0,
      totalLength: 0,
      averageLength: 0,
      chromosomes: new Set(),
      minLength: 0,
      maxLength: 0,
    };
  }

  const lengths = intervals.map((interval) => interval.end - interval.start);
  const totalLength = lengths.reduce((sum, len) => sum + len, 0);
  const chromosomes = new Set(intervals.map((interval) => interval.chromosome));

  return {
    count: intervals.length,
    totalLength,
    averageLength: totalLength / intervals.length,
    chromosomes,
    minLength: Math.min(...lengths),
    maxLength: Math.max(...lengths),
  };
}

/**
 * Sort intervals by genomic coordinates
 */
export function sortIntervals(intervals: BedInterval[]): BedInterval[] {
  return [...intervals].sort((a, b) => {
    // Sort by chromosome first (lexicographic)
    if (a.chromosome !== b.chromosome) {
      return a.chromosome.localeCompare(b.chromosome);
    }

    // Then by start position
    if (a.start !== b.start) {
      return a.start - b.start;
    }

    // Finally by end position
    return a.end - b.end;
  });
}

/**
 * Merge overlapping intervals
 */
export function mergeOverlapping(intervals: BedInterval[]): BedInterval[] {
  if (intervals.length <= 1) return intervals;

  const sorted = sortIntervals(intervals);
  if (sorted[0] === undefined) {
    throw new ValidationError('sorted intervals must have at least one element');
  }
  const merged: BedInterval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === undefined) {
      throw new ValidationError(`sorted[${i}] must exist`);
    }
    const current = sorted[i]!;
    if (merged[merged.length - 1] === undefined) {
      throw new ValidationError('last merged interval must exist');
    }
    const last = merged[merged.length - 1]!;

    // Check if intervals overlap (on same chromosome)
    if (current.chromosome === last.chromosome && current.start <= last.end) {
      // Merge intervals
      (merged[merged.length - 1] as any).end = Math.max(last.end, current.end);

      // Optionally preserve names
      if (
        last.name !== undefined &&
        last.name !== null &&
        last.name !== '' &&
        current.name !== undefined &&
        current.name !== null &&
        current.name !== '' &&
        last.name !== current.name
      ) {
        (merged[merged.length - 1] as any).name = `${last.name};${current.name}`;
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
}

// Backward compatibility namespace exports
export const BedFormat = {
  detectVariant,
  validateStrand,
  parseRgb,
  validateCoordinates,
} as const;

export const BedUtils = {
  detectFormat,
  countIntervals,
  calculateStats,
  sortIntervals,
  mergeOverlapping,
} as const;
