/**
 * TranslateProcessor - DNA/RNA to protein translation
 *
 * This processor implements comprehensive protein translation functionality
 * supporting all 31 NCBI genetic codes, multiple reading frames, and
 * sophisticated handling of start codons, stop codons, and ambiguous bases.
 *
 */

import { type } from "arktype";
import { getBackend } from "../backend";
import { createFastaRecord } from "../constructors";
import { SequenceError, ValidationError } from "../errors";
import { packSequences } from "../backend/batch";
import type { TransformResult } from "../backend/kernel-types";
import type { AbstractSequence } from "../types";
import {
  GeneticCode,
  getGeneticCode,
  isAlternativeStart,
  isStartCodon,
  translateCodon,
} from "./core/genetic-codes";
import { reverseComplement } from "./core/sequence-manipulation";
import { expandAmbiguous } from "./core/sequence-validation";
import type { TranslateOptions } from "./types";

interface TranslationKernelTables {
  readonly translationLut: Buffer;
  readonly startMask: Buffer;
  readonly alternativeStartMask: Buffer;
}

const translationKernelTableCache = new Map<number, TranslationKernelTables>();

const IUPAC_BASE_MASK: Record<string, number> = {
  A: 0b0001,
  C: 0b0010,
  G: 0b0100,
  T: 0b1000,
  U: 0b1000,
  R: 0b0101,
  Y: 0b1010,
  S: 0b0110,
  W: 0b1001,
  K: 0b1100,
  M: 0b0011,
  B: 0b1110,
  D: 0b1101,
  H: 0b1011,
  V: 0b0111,
  N: 0b1111,
};

const EXACT_BASE_BITS: Record<string, number> = {
  A: 0,
  C: 1,
  G: 2,
  T: 3,
  U: 3,
};

function encodeExactCodon(codon: string): number {
  const a = EXACT_BASE_BITS[codon[0]!] ?? 0;
  const b = EXACT_BASE_BITS[codon[1]!] ?? 0;
  const c = EXACT_BASE_BITS[codon[2]!] ?? 0;
  return (a << 4) | (b << 2) | c;
}

function getTranslationKernelTables(geneticCode: GeneticCode): TranslationKernelTables {
  const cached = translationKernelTableCache.get(geneticCode);
  if (cached !== undefined) {
    return cached;
  }

  const codeTable = getGeneticCode(geneticCode);
  if (!codeTable) {
    throw new SequenceError(
      `Invalid genetic code: ${geneticCode}. Use genetic codes 1-33`,
      "CONTEXTUAL_ERROR",
      undefined,
      `providedCode: ${geneticCode}`
    );
  }

  const translationLut = Buffer.alloc(16 * 16 * 16, "X".charCodeAt(0));
  const startMask = Buffer.alloc(64, 0);
  const alternativeStartMask = Buffer.alloc(64, 0);

  for (let mask0 = 0; mask0 < 16; mask0++) {
    for (let mask1 = 0; mask1 < 16; mask1++) {
      for (let mask2 = 0; mask2 < 16; mask2++) {
        const index = (mask0 << 8) | (mask1 << 4) | mask2;
        const codon = [mask0, mask1, mask2]
          .map((mask) => {
            const entry = Object.entries(IUPAC_BASE_MASK).find(([, value]) => value === mask);
            return entry?.[0] ?? "";
          })
          .join("");

        if (codon.length !== 3) {
          continue;
        }

        const results = ["" as string];
        const bases = codon.split("").map((base) => expandAmbiguous(base));
        let expansions = results;
        for (const possibilities of bases) {
          const next: string[] = [];
          for (const prefix of expansions) {
            for (const possibility of possibilities) {
              next.push(prefix + possibility.replace(/U/g, "T"));
            }
          }
          expansions = next;
        }

        const aminoAcids = new Set<string>();
        for (const expanded of expansions) {
          const aa = codeTable.codons[expanded];
          if (aa !== undefined) {
            aminoAcids.add(aa);
          }
        }

        if (aminoAcids.size === 1) {
          translationLut[index] = (Array.from(aminoAcids)[0] ?? "X").charCodeAt(0);
        }
      }
    }
  }

  for (const startCodon of codeTable.startCodons) {
    startMask[encodeExactCodon(startCodon)] = 1;
  }

  for (const codon of ["CTG", "TTG", "GTG"]) {
    alternativeStartMask[encodeExactCodon(codon)] = 1;
  }

  const tables = { translationLut, startMask, alternativeStartMask };
  translationKernelTableCache.set(geneticCode, tables);
  return tables;
}

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
    options: TranslateOptions
  ): AsyncIterable<AbstractSequence> {
    // Direct ArkType validation with comprehensive constraints
    const validationResult = TranslateOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid translation options: ${validationResult.summary}`);
    }

    if (options.orfsOnly !== true) {
      const backend = await getBackend();
      if (backend.translateBatch !== undefined) {
        yield* this.translateNative(source, backend, options);
        return;
      }
    }

    for await (const seq of source) {
      yield* this.translateSequence(seq, options);
    }
  }

  private async *translateNative(
    source: AsyncIterable<AbstractSequence>,
    backend: Awaited<ReturnType<typeof getBackend>>,
    options: TranslateOptions
  ): AsyncIterable<AbstractSequence> {
    const frames = this.determineFrames(options);
    const geneticCode = options.geneticCode ?? GeneticCode.STANDARD;
    const tables = getTranslationKernelTables(geneticCode);
    const stopCodonChar = options.stopCodonChar ?? "*";
    const unknownCodonChar = options.unknownCodonChar ?? "X";

    let batch: AbstractSequence[] = [];
    let batchBytes = 0;
    const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

    const flush = async function* (
      processor: TranslateProcessor,
      sequences: readonly AbstractSequence[]
    ): AsyncGenerator<AbstractSequence> {
      const packed = packSequences(sequences);
      const perFrame = new Map<number, TransformResult>();

      for (const frame of frames) {
        const frameOffset = Math.abs(frame) - 1;
        const reverse = frame < 0;
        perFrame.set(
          frame,
          await backend.translateBatch!(
            packed.data,
            packed.offsets,
            tables.translationLut,
            tables.startMask,
            tables.alternativeStartMask,
            {
              frameOffset,
              reverse,
              convertStartCodons: options.convertStartCodons === true,
              allowAlternativeStarts: options.allowAlternativeStarts === true,
              trimAtFirstStop: options.trimAtFirstStop === true,
              removeStopCodons: options.removeStopCodons === true,
              stopCodonChar,
              unknownCodonChar,
            }
          )
        );
      }

      for (let seqIndex = 0; seqIndex < sequences.length; seqIndex++) {
        const seq = sequences[seqIndex]!;
        for (const frame of frames) {
          const translated = perFrame.get(frame)!;
          const start = translated.offsets[seqIndex]!;
          const end = translated.offsets[seqIndex + 1]!;
          const protein = new TextDecoder("latin1").decode(translated.data.subarray(start, end));

          if (
            options.minOrfLength === undefined ||
            options.minOrfLength === null ||
            protein.length >= options.minOrfLength
          ) {
            yield processor.createTranslatedSequence(seq, protein, frame, options);
          }
        }
      }
    };

    for await (const seq of source) {
      batch.push(seq);
      batchBytes += seq.sequence.length;

      if (batchBytes >= BATCH_BYTE_BUDGET) {
        yield* flush(this, batch);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* flush(this, batch);
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
    options: TranslateOptions
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
    options: TranslateOptions
  ): string | null {
    let sequence = seq.sequence.toString().toUpperCase().replace(/U/g, "T");

    // Handle empty sequences
    if (sequence.length === 0) {
      return "";
    }

    // Handle reverse frames
    if (frame < 0) {
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
    options: TranslateOptions
  ): string {
    const codeTable = getGeneticCode(geneticCode);
    if (!codeTable) {
      throw new SequenceError(
        `Invalid genetic code: ${geneticCode}. Use genetic codes 1-33`,
        "CONTEXTUAL_ERROR",
        undefined,
        `providedCode: ${geneticCode}`
      );
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
    options: TranslateOptions
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
    options: TranslateOptions
  ): AbstractSequence {
    const frameStr = frame > 0 ? `+${frame}` : `${frame}`;
    const id =
      options.includeFrameInId === true ? `${originalSeq.id}_frame_${frameStr}` : originalSeq.id;

    let description = originalSeq.description;
    if (options.includeFrameInId === true) {
      const frameInfo = `frame=${frameStr}`;
      description = description ? `${description} ${frameInfo}` : frameInfo;
    }

    return createFastaRecord({ id, sequence: translation, description });
  }
}
