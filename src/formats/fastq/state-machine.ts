/**
 * State machine implementation for multi-line FASTQ parsing
 *
 * Handles the original Sanger FASTQ specification which allows:
 * - Multi-line sequences (wrapped like FASTA format)
 * - Multi-line quality strings
 * - '@' and '+' characters appearing in quality data
 *
 * This robust parser uses length-based record boundary detection instead
 * of naive line markers, as '@' (ASCII 64) and '+' (ASCII 43) can appear
 * in Phred+64 and other quality encodings.
 */

import { detectEncodingWithConfidence } from "../../operations/core/quality";
import type { FastqSequence, QualityEncoding } from "../../types";
// Import primitives for validation and extraction
import {
  accumulateQuality,
  accumulateSequence,
  extractDescription,
  extractId,
  isValidHeader,
  isValidSeparator,
  lengthsMatch,
} from "./primitives";
import type { FastqParserContext } from "./types";
import { FastqParsingState } from "./types";

/**
 * Parse multi-line FASTQ format using state machine
 *
 * This implementation handles the complete FASTQ specification including:
 * - Records spanning multiple lines
 * - Quality strings with '@' and '+' contamination
 * - Robust record boundary detection using sequence/quality length matching
 *
 * @param lines - Array of lines to parse
 * @param startLineNumber - Starting line number for error reporting
 * @param options - Parser options including error callback
 * @returns Array of parsed FASTQ sequences
 *
 * @remarks
 * The state machine transitions:
 * WAITING_HEADER → READING_SEQUENCE → READING_QUALITY → WAITING_HEADER
 *
 * Record boundaries are detected by matching sequence and quality lengths,
 * not by line markers, making this parser robust against quality contamination.
 */
export function parseMultiLineFastq(
  lines: string[],
  startLineNumber: number = 1,
  options: {
    maxLineLength: number;
    onError: (msg: string, line?: number) => void;
    qualityEncoding?: QualityEncoding; // Optional: use specified encoding instead of auto-detect
    trackLineNumbers?: boolean; // Optional: include line numbers in output
  },
): FastqSequence[] {
  const results: FastqSequence[] = [];
  let lineNumber = startLineNumber - 1; // Start at 0 so first increment gives 1

  const context: FastqParserContext = {
    state: FastqParsingState.WAITING_HEADER,
    sequenceLines: [],
    qualityLines: [],
    sequenceLength: 0,
    currentQualityLength: 0,
  };

  let recordStartLine = 0; // Track where current record started

  for (const line of lines) {
    lineNumber++;

    // Skip empty lines in any state
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Check line length bounds
    if (line.length > options.maxLineLength) {
      options.onError(`Line too long (${line.length} > ${options.maxLineLength})`, lineNumber);
      continue;
    }

    // State machine processing
    switch (context.state) {
      case FastqParsingState.WAITING_HEADER:
        if (isValidHeader(trimmedLine)) {
          context.header = trimmedLine;
          context.state = FastqParsingState.READING_SEQUENCE;
          context.sequenceLines = [];
          recordStartLine = lineNumber; // Track where this record starts
        } else {
          options.onError(`Expected FASTQ header starting with @, got: ${trimmedLine}`, lineNumber);
        }
        break;

      case FastqParsingState.READING_SEQUENCE:
        if (isValidSeparator(trimmedLine)) {
          // Found separator, calculate sequence length for quality tracking
          context.separator = trimmedLine;
          // Use primitive to accumulate sequence
          context.sequenceLength = accumulateSequence(context.sequenceLines).length;
          context.state = FastqParsingState.READING_QUALITY;
          context.qualityLines = [];
          context.currentQualityLength = 0;
        } else {
          // Accumulate sequence lines
          context.sequenceLines.push(trimmedLine);
        }
        break;

      case FastqParsingState.READING_QUALITY:
        // Accumulate quality characters
        context.qualityLines.push(trimmedLine);
        context.currentQualityLength += trimmedLine.length;

        // Check if quality length matches sequence length (record complete)
        if (context.currentQualityLength >= context.sequenceLength) {
          // Use primitives to accumulate sequence and quality
          const sequence = accumulateSequence(context.sequenceLines);
          const quality = accumulateQuality(context.qualityLines, context.sequenceLength);

          // Check if quality accumulation succeeded
          if (!quality) {
            options.onError(
              `Failed to accumulate quality data for sequence of length ${context.sequenceLength}`,
              lineNumber,
            );
          } else if (!lengthsMatch(sequence, quality)) {
            // Validate exact length match using primitive
            options.onError(
              `FASTQ quality length (${quality.length}) != sequence length (${sequence.length})`,
              lineNumber,
            );
          } else {
            // Use primitives to extract header information
            const id = extractId(context.header || "");
            const description = extractDescription(context.header || "");

            // Validate ID length for tool compatibility (NCBI recommendation)
            if (id.length > 50) {
              console.warn(
                `FASTQ sequence ID '${id}' is very long (${id.length} chars). ` +
                  `Long IDs may cause compatibility issues with some bioinformatics tools.`,
              );
            }

            // Use specified encoding or auto-detect
            let qualityEncoding: QualityEncoding;
            if (options.qualityEncoding) {
              qualityEncoding = options.qualityEncoding;
            } else {
              // Enhanced encoding detection with confidence reporting
              const encodingResult = detectEncodingWithConfidence(quality);
              if (encodingResult.confidence < 0.8) {
                console.warn(
                  `Uncertain quality encoding detection for sequence '${id}': ${encodingResult.evidence.join("; ")} (confidence: ${(encodingResult.confidence * 100).toFixed(1)}%). Consider specifying sourceEncoding explicitly if conversion results seem incorrect.`,
                );
              }
              qualityEncoding = encodingResult.encoding;
            }

            const fastqRecord: FastqSequence = {
              format: "fastq",
              id,
              ...(description && { description }),
              sequence,
              quality,
              qualityEncoding,
              length: sequence.length,
              // Include line number if tracking is enabled (sequence line is typically line 2)
              ...(options.trackLineNumbers && { lineNumber: recordStartLine + 1 }),
            };

            results.push(fastqRecord);
          }

          // Reset for next record
          context.state = FastqParsingState.WAITING_HEADER;
        }
        break;
    }
  }

  // Check for incomplete record at end of file
  if (context.state !== FastqParsingState.WAITING_HEADER) {
    // We ended in the middle of a record
    if (context.header) {
      options.onError(`Incomplete FASTQ record: started at line ${recordStartLine}`, lineNumber);
    } else {
      options.onError(`Incomplete FASTQ record`, lineNumber);
    }
  }

  return results;
}
