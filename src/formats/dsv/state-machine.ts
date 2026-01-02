/**
 * CSV State Machine Module
 *
 * Implements RFC 4180 compliant CSV parsing using a state machine approach.
 * Handles quoted fields, escaped quotes, and multi-line fields.
 */

import { ParseError } from "../../errors";
import { CSVParseState } from "./types";

// DSV-specific parse error
class DSVParseError extends ParseError {
  constructor(
    message: string,
    public override readonly lineNumber?: number,
    public readonly column?: number,
    public readonly field?: string
  ) {
    super(message, "dsv", lineNumber);
    this.name = "DSVParseError";
  }
}

/**
 * Count unescaped quotes in a line
 *
 * @param line - The line to analyze
 * @param quote - Quote character (usually ")
 * @param escapeChar - Escape character (usually same as quote for RFC 4180)
 * @returns Number of unescaped quotes
 */
export function countUnescapedQuotes(line: string, quote: string, escapeChar: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === quote) {
      // Check if it's escaped
      if (escapeChar === quote && line[i + 1] === quote) {
        i++; // Skip the escaped quote
      } else {
        count++;
      }
    }
  }
  return count;
}

/**
 * Check if quotes are balanced in a line
 * Uses countUnescapedQuotes to determine if all quotes are properly closed
 *
 * @param line - The line to check
 * @param quote - Quote character (usually ")
 * @param escapeChar - Escape character (usually same as quote)
 * @returns true if quotes are balanced (even count), false otherwise
 */
export function hasBalancedQuotes(line: string, quote: string, escapeChar: string): boolean {
  const quoteCount = countUnescapedQuotes(line, quote, escapeChar);
  return quoteCount % 2 === 0;
}

/**
 * Parse CSV row with proper RFC 4180 state machine
 * Handles quoted fields, escaped quotes, and multi-line fields
 *
 * @param line - CSV line to parse
 * @param delimiter - Field delimiter
 * @param quote - Quote character
 * @param escapeChar - Escape character (usually same as quote)
 * @returns Array of parsed fields
 */
export function parseCSVRow(
  line: string,
  delimiter: string = ",",
  quote: string = '"',
  escapeChar: string = '"'
): string[] {
  const fields: string[] = [];
  let currentField = "";
  let state = CSVParseState.FIELD_START;
  let i = 0;

  while (i < line.length) {
    const char = line[i];
    if (char === undefined) {
      // This should never happen due to loop condition, but TypeScript requires the check
      throw new DSVParseError(
        `Unexpected undefined character at index ${i} in line of length ${line.length}`,
        undefined,
        i,
        line
      );
    }
    const nextChar = line[i + 1];

    switch (state) {
      case CSVParseState.FIELD_START:
        if (char === quote) {
          // Start of quoted field
          state = CSVParseState.QUOTED_FIELD;
          i++;
        } else if (char === delimiter) {
          // Empty field
          fields.push("");
          i++;
          // Stay in FIELD_START
        } else {
          // Start of unquoted field
          currentField = char;
          state = CSVParseState.UNQUOTED_FIELD;
          i++;
        }
        break;

      case CSVParseState.UNQUOTED_FIELD:
        if (char === delimiter) {
          // End of field
          fields.push(currentField);
          currentField = "";
          state = CSVParseState.FIELD_START;
          i++;
        } else {
          // Continue building field
          currentField += char;
          i++;
        }
        break;

      case CSVParseState.QUOTED_FIELD:
        if (char === quote) {
          if (escapeChar === quote && nextChar === quote) {
            // Escaped quote (doubled)
            currentField += quote;
            i += 2; // Skip both quotes
          } else {
            // End quote
            state = CSVParseState.QUOTE_IN_QUOTED;
            i++;
          }
        } else {
          // Regular character in quoted field
          currentField += char;
          i++;
        }
        break;

      case CSVParseState.QUOTE_IN_QUOTED:
        if (char === delimiter) {
          // Field ended properly
          fields.push(currentField);
          currentField = "";
          state = CSVParseState.FIELD_START;
          i++;
        } else if (char === quote && escapeChar === quote) {
          // This was actually an escaped quote, go back to quoted field
          currentField += quote;
          state = CSVParseState.QUOTED_FIELD;
          i++;
        } else {
          // Malformed CSV - characters after closing quote
          // Be lenient and treat as part of field
          currentField += char;
          state = CSVParseState.UNQUOTED_FIELD;
          i++;
        }
        break;
    }
  }

  // Handle final field
  if (state === CSVParseState.QUOTED_FIELD) {
    // Unclosed quote - throw error
    throw new DSVParseError("Unclosed quote in CSV field", undefined, undefined, line);
  } else if (state === CSVParseState.UNQUOTED_FIELD || state === CSVParseState.QUOTE_IN_QUOTED) {
    fields.push(currentField);
  } else if (state === CSVParseState.FIELD_START && line.endsWith(delimiter)) {
    // Trailing delimiter means empty final field
    fields.push("");
  }

  return fields;
}

/**
 * CSV Field Parser class for encapsulated field parsing
 */
export class CSVFieldParser {
  constructor(
    private delimiter: string,
    private quote: string,
    private escapeChar: string
  ) {}

  /**
   * Parse a row into fields
   */
  parseRow(line: string): string[] {
    return parseCSVRow(line, this.delimiter, this.quote, this.escapeChar);
  }

  /**
   * Check if a line has balanced quotes
   */
  hasBalancedQuotes(line: string): boolean {
    return hasBalancedQuotes(line, this.quote, this.escapeChar);
  }
}
