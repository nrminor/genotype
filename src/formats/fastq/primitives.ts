/**
 * FASTQ Parsing Primitives - Minimal, composable operations
 *
 * Design principles:
 * - Each function does ONE thing well
 * - Pure functions when possible
 * - Under 20 lines per function
 * - Zero dependencies on other modules
 * - Optimized for performance
 *
 * These primitives are the atomic operations used by both the fast path
 * and state machine parsers, as well as the FASTQ writer.
 */

// ============================================================================
// RECORD DETECTION PRIMITIVES
// ============================================================================

/**
 * Detect if input appears to be simple 4-line FASTQ format
 *
 * @param lines - Sample of lines to analyze
 * @param sampleSize - Number of lines to check (default: 100)
 * @returns true if all sampled records follow strict 4-line format
 *
 * @performance O(n) where n = min(sampleSize, lines.length)
 */
export function isSimpleFourLineFastq(lines: string[], sampleSize = 100): boolean {
  const limit = Math.min(sampleSize, lines.length);

  // Need at least 4 lines for one complete record
  if (limit < 4) return false;

  // Check if we have complete 4-line records
  if (limit % 4 !== 0) return false;

  // Verify each record follows the pattern
  for (let i = 0; i < limit; i += 4) {
    // Line 0 (mod 4): Must start with '@'
    if (!lines[i]?.startsWith("@")) return false;

    // Line 1 (mod 4): Sequence - should not start with '@' or '+'
    const seq = lines[i + 1];
    if (!seq || seq.startsWith("@") || seq.startsWith("+")) return false;

    // Line 2 (mod 4): Must start with '+'
    if (!lines[i + 2]?.startsWith("+")) return false;

    // Line 3 (mod 4): Quality - length should match sequence
    const qual = lines[i + 3];
    if (!qual || qual.length !== seq.length) return false;
  }

  return true;
}

/**
 * Find the boundary of the next FASTQ record in multi-line format
 *
 * @param lines - Array of lines to search
 * @param startIdx - Starting index for search
 * @returns Index of next record start, or -1 if not found
 *
 * @performance O(m) where m = lines per record (typically 4-8)
 */
export function findRecordBoundary(lines: string[], startIdx: number): number {
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    // Look for '@' at line start followed by valid header pattern
    if (line?.startsWith("@") && nextLine && !nextLine.startsWith("@")) {
      // Additional check: looks like a sequence ID
      const possibleId = line.substring(1).split(/\s/)[0];
      if (possibleId && possibleId.length > 0) {
        return i;
      }
    }
  }

  return -1;
}

// ============================================================================
// VALIDATION PRIMITIVES
// ============================================================================

/**
 * Check if a line is a valid FASTQ header
 *
 * @param line - Line to validate
 * @returns true if line is a valid header
 *
 * @performance O(1) - Single regex test
 */
export function isValidHeader(line: string): boolean {
  // Must start with @ and have at least one non-whitespace character for ID
  return /^@\S+/.test(line);
}

/**
 * Check if a line is a valid FASTQ separator
 *
 * @param line - Line to validate
 * @param expectedId - Optional expected ID to match
 * @returns true if line is a valid separator
 *
 * @performance O(1) - Simple string operations
 */
export function isValidSeparator(line: string, expectedId?: string): boolean {
  if (!line.startsWith("+")) return false;

  // If no expected ID, just check for '+'
  if (!expectedId) return true;

  // If separator has ID, it should match the sequence ID
  const separatorId = line.substring(1).trim();
  return separatorId === "" || separatorId === expectedId;
}

/**
 * Check if sequence and quality strings have matching lengths
 *
 * @param sequence - Sequence string
 * @param quality - Quality string
 * @returns true if lengths match
 *
 * @performance O(1) - Length comparison only
 */
export function lengthsMatch(sequence: string, quality: string): boolean {
  return sequence.length === quality.length;
}

// ============================================================================
// EXTRACTION PRIMITIVES
// ============================================================================

/**
 * Extract record ID from FASTQ header line
 *
 * @param headerLine - Header line starting with '@'
 * @returns Sequence ID (without '@' prefix)
 *
 * @performance O(1) - Single split operation
 */
export function extractId(headerLine: string): string {
  // Remove '@' and split on whitespace, take first part
  return headerLine.substring(1).split(/\s/)[0] || "";
}

/**
 * Extract description from FASTQ header line
 *
 * @param headerLine - Header line starting with '@'
 * @returns Description text after ID, or undefined if none
 *
 * @performance O(1) - Single split operation
 */
export function extractDescription(headerLine: string): string | undefined {
  const spaceIndex = headerLine.indexOf(" ");
  return spaceIndex > 0 ? headerLine.substring(spaceIndex + 1) : undefined;
}

/**
 * Extract platform information from header if present
 *
 * @param headerLine - Header line with potential platform info
 * @returns Platform information or undefined
 *
 * @performance O(1) - Pattern matching
 */
export function extractPlatformInfo(
  headerLine: string
): { platform?: string; flowcell?: string; lane?: number } | undefined {
  // Common Illumina pattern: @<instrument>:<run>:<flowcell>:<lane>:<tile>:<x>:<y>
  const illuminaMatch = headerLine.match(/@(\w+):(\d+):([\w-]+):(\d+):/);
  if (illuminaMatch && illuminaMatch[3] && illuminaMatch[4]) {
    return {
      platform: "illumina",
      flowcell: illuminaMatch[3],
      lane: parseInt(illuminaMatch[4], 10),
    };
  }

  // PacBio pattern: @<movie>/<zmw>/<start>_<end>
  const pacbioMatch = headerLine.match(/@(\w+)\/(\d+)\/(\d+)_(\d+)/);
  if (pacbioMatch && pacbioMatch[1]) {
    return {
      platform: "pacbio",
      flowcell: pacbioMatch[1],
    };
  }

  return undefined;
}

// ============================================================================
// ACCUMULATION PRIMITIVES
// ============================================================================

/**
 * Efficiently accumulate multi-line sequence
 *
 * @param lines - Array of sequence lines
 * @returns Concatenated sequence string
 *
 * @performance O(n) where n = total characters
 */
export function accumulateSequence(lines: string[]): string {
  // Use join for efficient concatenation
  return lines.map((line) => line.trim()).join("");
}

/**
 * Accumulate quality string up to target length
 *
 * @param lines - Array of quality lines
 * @param targetLength - Expected length to match sequence
 * @returns Quality string or null if insufficient data
 *
 * @performance O(n) where n = total characters
 */
export function accumulateQuality(lines: string[], targetLength: number): string | null {
  let accumulated = "";

  for (const line of lines) {
    accumulated += line.trim();

    // Stop when we reach target length
    if (accumulated.length >= targetLength) {
      return accumulated.substring(0, targetLength);
    }
  }

  // Not enough quality data
  return accumulated.length === targetLength ? accumulated : null;
}

// ============================================================================
// CHUNKING PRIMITIVES (for writer)
// ============================================================================

/**
 * Split sequence into fixed-width chunks
 *
 * @param sequence - Sequence to chunk
 * @param width - Line width (default: 80)
 * @returns Array of sequence chunks
 *
 * @performance O(n) where n = sequence length
 */
export function chunkSequence(sequence: string, width = 80): string[] {
  if (width <= 0 || sequence.length <= width) {
    return [sequence];
  }

  const chunks: string[] = [];
  for (let i = 0; i < sequence.length; i += width) {
    chunks.push(sequence.substring(i, i + width));
  }

  return chunks;
}

/**
 * Split quality string into fixed-width chunks
 *
 * @param quality - Quality string to chunk
 * @param width - Line width (default: 80)
 * @returns Array of quality chunks
 *
 * @performance O(n) where n = quality length
 */
export function chunkQuality(quality: string, width = 80): string[] {
  // Reuse sequence chunking logic - they're identical
  return chunkSequence(quality, width);
}

// ============================================================================
// FORMATTING PRIMITIVES (for writer)
// ============================================================================

/**
 * Format a FASTQ header line from ID and optional description
 *
 * @param id - Sequence identifier (without '@' prefix)
 * @param description - Optional description text
 * @returns Formatted header line with '@' prefix
 *
 * @performance O(1) - Simple string concatenation
 * @example
 * formatHeader("seq1") // "@seq1"
 * formatHeader("seq1", "example read") // "@seq1 example read"
 */
export function formatHeader(id: string, description?: string): string {
  const header = `@${id}`;
  return description ? `${header} ${description}` : header;
}

/**
 * Format a FASTQ separator line with optional ID
 *
 * @param id - Optional sequence identifier (without '+' prefix)
 * @returns Formatted separator line with '+' prefix
 *
 * @performance O(1) - Simple string concatenation
 * @example
 * formatSeparator() // "+"
 * formatSeparator("seq1") // "+seq1"
 */
export function formatSeparator(id?: string): string {
  return id ? `+${id}` : "+";
}

/**
 * Assemble a complete FASTQ record from its components
 *
 * @param header - Header line (with '@' prefix)
 * @param sequence - Sequence string
 * @param separator - Separator line (with '+' prefix)
 * @param quality - Quality string
 * @returns Complete FASTQ record as multi-line string
 *
 * @performance O(1) - Simple string join
 * @example
 * assembleFastqRecord("@seq1", "ATCG", "+", "IIII")
 * // Returns: "@seq1\nATCG\n+\nIIII"
 */
export function assembleFastqRecord(
  header: string,
  sequence: string,
  separator: string,
  quality: string
): string {
  return `${header}\n${sequence}\n${separator}\n${quality}`;
}
