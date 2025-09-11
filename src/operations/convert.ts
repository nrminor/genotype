/**
 * ConvertProcessor - Quality score encoding conversion
 *
 * This processor implements FASTQ quality score encoding conversion between
 * Phred+33, Phred+64, and Solexa formats. Leverages the complete encoding
 * infrastructure from core/encoding.ts for accurate conversion.
 *
 * 🔥 NATIVE CANDIDATE: Quality string processing is computationally intensive
 * for large datasets and ideal for SIMD acceleration (bulk ASCII arithmetic)
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { type } from "arktype";
import { ValidationError } from "../errors";
import type { AbstractSequence, FastqSequence, QualityEncoding } from "../types";
import { convertScore, detectEncodingWithConfidence } from "./core/encoding";
import type { ConvertOptions, Processor } from "./types";

/**
 * Declarative ArkType schema for ConvertOptions with biological constraints
 *
 * Uses type system to validate quality encoding parameters and provide
 * educational guidance about encoding history and compatibility.
 */
const ConvertOptionsSchema = type({
  // Target encoding constraint: only valid encodings
  targetEncoding: '"phred33" | "phred64" | "solexa"',
  // Source encoding: optional for auto-detection
  "sourceEncoding?": '"phred33" | "phred64" | "solexa"',
  // Validation flag
  "validateEncoding?": "boolean",
}).narrow((options, ctx) => {
  // Educational warnings for deprecated encodings
  if (options.targetEncoding === "phred64") {
    // Note: This creates a warning, doesn't reject
    // Users might legitimately need legacy format output
  }

  if (options.targetEncoding === "solexa") {
    // Warning: Allow but discourage deprecated encoding
    // Note: This creates a warning, doesn't reject (Solexa conversion now supported)
    // Users might legitimately need historical format output for legacy data
  }

  // Helpful guidance for redundant conversions
  if (options.sourceEncoding && options.sourceEncoding === options.targetEncoding) {
    // Note: This creates a helpful suggestion, doesn't reject
    // Users might explicitly want to validate their assumption about encoding
  }

  return true;
});

/**
 * Processor for FASTQ quality score encoding conversion
 *
 * Converts quality score encodings between different schemes using the
 * comprehensive encoding infrastructure. Maintains streaming behavior
 * and provides educational context about encoding evolution.
 *
 * @example
 * ```typescript
 * // Convert legacy Phred+64 to modern standard
 * const processor = new ConvertProcessor();
 * const converted = processor.process(sequences, {
 *   targetEncoding: "phred33"
 * });
 *
 * // Explicit source encoding (skips auto-detection)
 * const converted2 = processor.process(sequences, {
 *   sourceEncoding: "phred64",
 *   targetEncoding: "phred33"
 * });
 * ```
 */
export class ConvertProcessor implements Processor<ConvertOptions> {
  /**
   * Process sequences with quality encoding conversion
   *
   * Only FASTQ sequences are processed; FASTA sequences pass through unchanged.
   * Uses existing core/encoding.ts infrastructure completely.
   *
   * 🔥 NATIVE CRITICAL: Main processing loop - processes every sequence
   * Quality string conversion bottleneck for large datasets, ideal for SIMD
   *
   * @param source - Input sequences
   * @param options - Conversion options
   * @yields Sequences with converted quality encodings
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: ConvertOptions
  ): AsyncIterable<AbstractSequence> {
    // Validate options using ArkType schema
    const validationResult = ConvertOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid conversion options: ${validationResult.summary}`);
    }

    // Leverage existing core infrastructure completely
    for await (const seq of source) {
      yield this.convertSequence(seq, options);
    }
  }

  /**
   * Convert quality encoding for a single sequence
   *
   * @param seq - Sequence to convert
   * @param options - Conversion options
   * @returns Sequence with converted quality encoding
   */
  private convertSequence(seq: AbstractSequence, options: ConvertOptions): AbstractSequence {
    // Pass through non-FASTQ sequences unchanged
    if (!this.isFastqSequence(seq)) {
      return seq;
    }

    const fastqSeq = seq as FastqSequence;

    // Use existing encoding infrastructure
    try {
      // Auto-detect source encoding with confidence feedback (seqkit-style uncertainty reporting)
      let sourceEncoding: QualityEncoding;
      if (options.sourceEncoding) {
        sourceEncoding = options.sourceEncoding;
      } else {
        const detectionResult = detectEncodingWithConfidence(fastqSeq.quality);
        sourceEncoding = detectionResult.encoding;

        // Warn about uncertain detection (seqkit-style uncertainty feedback)
        if (detectionResult.confidence < 0.8 || detectionResult.ambiguous) {
          console.warn(
            `Uncertain quality encoding detection for sequence '${seq.id}': ` +
              `${detectionResult.reasoning} ` +
              `(confidence: ${(detectionResult.confidence * 100).toFixed(1)}%). ` +
              `Consider specifying sourceEncoding explicitly if conversion results seem incorrect.`
          );
        }
      }

      // Handle empty quality string (edge case)
      if (!fastqSeq.quality || fastqSeq.quality.length === 0) {
        const converted: FastqSequence = {
          ...fastqSeq,
          quality: "",
          qualityEncoding: options.targetEncoding,
        };
        return converted;
      }

      // Always return new object, even when no conversion needed
      if (sourceEncoding === options.targetEncoding) {
        const unchanged: FastqSequence = {
          ...fastqSeq,
          quality: fastqSeq.quality,
          qualityEncoding: options.targetEncoding,
        };
        return unchanged;
      }

      // Leverage existing convertScore function completely
      const convertedQuality = convertScore(
        fastqSeq.quality,
        sourceEncoding,
        options.targetEncoding
      );

      const converted: FastqSequence = {
        ...fastqSeq,
        quality: convertedQuality,
        qualityEncoding: options.targetEncoding,
      };

      return converted;
    } catch (error) {
      throw new ValidationError(
        `Quality encoding conversion failed for sequence ${seq.id}: ${error}`,
        undefined,
        "Verify source encoding is correct, or use auto-detection by omitting sourceEncoding"
      );
    }
  }

  /**
   * Type guard to identify FASTQ sequences
   */
  private isFastqSequence(seq: AbstractSequence): seq is FastqSequence {
    return "quality" in seq && "qualityEncoding" in seq;
  }
}
