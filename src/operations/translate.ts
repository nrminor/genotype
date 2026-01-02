/**
 * TranslateProcessor - DNA/RNA to protein translation
 *
 * This processor implements comprehensive protein translation functionality
 * supporting all 31 NCBI genetic codes, multiple reading frames, and
 * sophisticated handling of start codons, stop codons, and ambiguous bases.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { type } from "arktype";
import { createContextualError, SequenceError, ValidationError } from "../errors";
import type { AbstractSequence } from "../types";
import {
  GeneticCode,
  getGeneticCode,
  isAlternativeStart,
  isStartCodon,
  translateCodon,
} from "./core/genetic-codes";
import { reverseComplement } from "./core/sequence-manipulation";
import type { TranslateOptions } from "./types";

/**
 * Declarative ArkType schema for TranslateOptions with comprehensive constraints
 *
 * Uses type system to make invalid states unrepresentable
 */
const TranslateOptionsSchema = type({
  // Genetic code constraint: only valid NCBI codes
  "geneticCode?":
    "1 | 2 | 3 | 4 | 5 | 6 | 9 | 10 | 11 | 12 | 13 | 14 | 16 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33",

  // Reading frames: only valid frame numbers
  "frames?": "(1 | 2 | 3 | -1 | -2 | -3)[]",

  // Boolean options
  "allFrames?": "boolean",
  "convertStartCodons?": "boolean",
  "removeStopCodons?": "boolean",
  "orfsOnly?": "boolean",
  "includeFrameInId?": "boolean",
  "trimAtFirstStop?": "boolean",
  "allowAlternativeStarts?": "boolean",

  // Character constraints: must be single characters
  "stopCodonChar?": "string",
  "unknownCodonChar?": "string",

  // ORF length: positive integers only
  "minOrfLength?": "number>=1",
}).narrow((options, ctx) => {
  // Single character constraints for replacement chars
  if (options.stopCodonChar && options.stopCodonChar.length !== 1) {
    return ctx.reject({
      expected: "single character for stop codon replacement",
      actual: `${options.stopCodonChar.length} characters`,
      path: ["stopCodonChar"],
      description: 'Use single amino acid like "*" or "X"',
    });
  }

  if (options.unknownCodonChar && options.unknownCodonChar.length !== 1) {
    return ctx.reject({
      expected: "single character for unknown codon replacement",
      actual: `${options.unknownCodonChar.length} characters`,
      path: ["unknownCodonChar"],
      description: 'Use single amino acid like "X" or "N"',
    });
  }

  // Frames array validation
  if (options.frames && options.frames.length === 0) {
    return ctx.reject({
      expected: "at least one reading frame",
      path: ["frames"],
      description: "Provide frames like [1, 2, 3] or use allFrames: true",
    });
  }

  return true;
});

/**
 * Options for DNA/RNA to protein translation
 *
 * Comprehensive translation options supporting all NCBI genetic codes,
 * multiple reading frames, and various output formats.
 */

/**
 * Processor for DNA/RNA to protein translation
 *
 * Implements comprehensive translation with all NCBI genetic codes,
 * multiple reading frames, and sophisticated biological features.
 * Maintains streaming behavior for efficient processing.
 *
 * @example
 * ```typescript
 * const processor = new TranslateProcessor();
 * const proteins = processor.process(sequences, {
 *   geneticCode: 1,
 *   frames: [1, 2, 3],
 *   convertStartCodons: true,
 *   trimAtFirstStop: true
 * });
 * ```
 */
export class TranslateProcessor {
  /**
   * Process sequences with translation
   *
   * @param source - Input sequences
   * @param options - Translation options
   * @yields Translated protein sequences
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: TranslateOptions,
  ): AsyncIterable<AbstractSequence> {
    // Direct ArkType validation with comprehensive constraints
    const validationResult = TranslateOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid translation options: ${validationResult.summary}`);
    }

    for await (const seq of source) {
      yield* this.translateSequence(seq, options);
    }
  }

  /**
   * Translate a single sequence in specified frames
   *
   * @param seq - Input sequence
   * @param options - Translation options
   * @yields Translated sequences for each frame
   */
  private async *translateSequence(
    seq: AbstractSequence,
    options: TranslateOptions,
  ): AsyncIterable<AbstractSequence> {
    const frames = this.determineFrames(options);
    const geneticCode = options.geneticCode ?? GeneticCode.STANDARD;

    for (const frame of frames) {
      const translation = this.performTranslation(seq, frame, geneticCode, options);

      // Always yield result, even if empty (unless ORF filtering removes it)
      if (
        translation !== null &&
        (options.minOrfLength === undefined ||
          options.minOrfLength === null ||
          translation.length >= options.minOrfLength)
      ) {
        yield this.createTranslatedSequence(seq, translation, frame, options);
      }
    }
  }

  /**
   * Determine which frames to translate based on options
   */
  private determineFrames(options: TranslateOptions): Array<1 | 2 | 3 | -1 | -2 | -3> {
    if (options.allFrames === true) {
      return [1, 2, 3, -1, -2, -3];
    }
    return options.frames ?? [1];
  }

  /**
   * Perform translation for a single frame
   *
   * @param seq - Input sequence
   * @param frame - Reading frame (1, 2, 3, -1, -2, -3)
   * @param geneticCode - Genetic code to use
   * @param options - Translation options
   * @returns Translated protein sequence or null if invalid
   */
  private performTranslation(
    seq: AbstractSequence,
    frame: 1 | 2 | 3 | -1 | -2 | -3,
    geneticCode: GeneticCode,
    options: TranslateOptions,
  ): string | null {
    // NATIVE_CRITICAL: String manipulation hot path - toUpperCase and character replacement
    let sequence = seq.sequence.toUpperCase().replace(/U/g, "T");

    // Handle empty sequences
    if (sequence.length === 0) {
      return "";
    }

    // Handle reverse frames
    if (frame < 0) {
      // NATIVE_CRITICAL: Reverse complement is a hot path for large sequences
      sequence = reverseComplement(sequence);
    }

    const frameOffset = Math.abs(frame) - 1;

    if (options.orfsOnly === true) {
      return this.translateOrfs(sequence, frameOffset, geneticCode, options);
    }

    return this.translateDirect(sequence, frameOffset, geneticCode, options);
  }

  /**
   * Direct translation without ORF detection
   */
  private translateDirect(
    sequence: string,
    frameOffset: number,
    geneticCode: GeneticCode,
    options: TranslateOptions,
  ): string {
    const codeTable = getGeneticCode(geneticCode);
    if (!codeTable) {
      throw createContextualError(SequenceError, `Invalid genetic code: ${geneticCode}`, {
        context: "Use genetic codes 1-33",
        data: { providedCode: geneticCode },
      });
    }

    let protein = "";
    let isFirstCodon = true;

    // NATIVE_CRITICAL: Hot loop - string slicing and codon translation for every 3 bases
    // Perfect candidate for SIMD string processing and lookup table optimization
    for (let i = frameOffset; i + 2 < sequence.length; i += 3) {
      const codon = sequence.substring(i, i + 3);
      let aminoAcid = translateCodon(codon, codeTable.codons);

      // Handle start codon conversion
      if (isFirstCodon && options.convertStartCodons === true) {
        if (
          isStartCodon(codon, geneticCode) ||
          (options.allowAlternativeStarts === true && isAlternativeStart(codon))
        ) {
          aminoAcid = "M";
        }
        isFirstCodon = false;
      }

      // Handle stop codons
      if (aminoAcid === "*") {
        if (options.trimAtFirstStop === true) {
          break;
        }
        if (options.removeStopCodons === true) {
          continue;
        }
        if (options.stopCodonChar) {
          aminoAcid = options.stopCodonChar;
        }
      }

      // Handle unknown codons
      if (aminoAcid === "X" && options.unknownCodonChar) {
        aminoAcid = options.unknownCodonChar;
      }

      protein += aminoAcid;
    }

    return protein;
  }

  /**
   * Translate only ORFs (start to stop codon)
   */
  private translateOrfs(
    sequence: string,
    frameOffset: number,
    geneticCode: GeneticCode,
    options: TranslateOptions,
  ): string | null {
    const codeTable = getGeneticCode(geneticCode);
    if (!codeTable) return null;

    for (let i = frameOffset; i + 2 < sequence.length; i += 3) {
      const codon = sequence.substring(i, i + 3);

      if (
        isStartCodon(codon, geneticCode) ||
        (options.allowAlternativeStarts === true && isAlternativeStart(codon))
      ) {
        // Found start codon, translate to next stop
        let protein =
          options.convertStartCodons === true ? "M" : translateCodon(codon, codeTable.codons);

        for (let j = i + 3; j + 2 < sequence.length; j += 3) {
          const nextCodon = sequence.substring(j, j + 3);
          const aminoAcid = translateCodon(nextCodon, codeTable.codons);

          if (aminoAcid === "*") {
            // Found stop codon, complete ORF
            if (options.removeStopCodons !== true) {
              protein += options.stopCodonChar ?? "*";
            }
            return protein.length >= (options.minOrfLength ?? 1) ? protein : null;
          }

          protein += aminoAcid;
        }

        // ORF extends to end of sequence
        return protein.length >= (options.minOrfLength ?? 1) ? protein : null;
      }
    }

    return null; // No ORF found
  }

  /**
   * Create translated sequence object
   */
  private createTranslatedSequence(
    originalSeq: AbstractSequence,
    translation: string,
    frame: number,
    options: TranslateOptions,
  ): AbstractSequence {
    const frameStr = frame > 0 ? `+${frame}` : `${frame}`;
    const id =
      options.includeFrameInId === true ? `${originalSeq.id}_frame_${frameStr}` : originalSeq.id;

    let description = originalSeq.description;
    if (options.includeFrameInId === true) {
      const frameInfo = `frame=${frameStr}`;
      description = description ? `${description} ${frameInfo}` : frameInfo;
    }

    return {
      id,
      sequence: translation,
      length: translation.length,
      ...(description && { description }),
    };
  }
}
