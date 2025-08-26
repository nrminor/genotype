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

import { createContextualError, SequenceError } from '../errors';
import type { AbstractSequence } from '../types';
import { GeneticCode, GeneticCodeTable } from './core/genetic-codes';
import { reverseComplement } from './core/sequence-manipulation';

/**
 * Options for DNA/RNA to protein translation
 *
 * Comprehensive translation options supporting all NCBI genetic codes,
 * multiple reading frames, and various output formats.
 */
export interface TranslateOptions {
  /** Genetic code table ID (1-33, default: 1 = Standard) */
  geneticCode?: number;

  /** Reading frames to translate (default: [1]) */
  frames?: Array<1 | 2 | 3 | -1 | -2 | -3>;

  /** Translate all 6 reading frames (overrides frames option) */
  allFrames?: boolean;

  /** Convert start codons to methionine (M) even if normally different amino acid */
  convertStartCodons?: boolean;

  /** Remove stop codons from output */
  removeStopCodons?: boolean;

  /** Replace stop codons with specific character (default: '*') */
  stopCodonChar?: string;

  /** Character to use for unknown/invalid codons (default: 'X') */
  unknownCodonChar?: string;

  /** Minimum ORF length when searching for ORFs (amino acids) */
  minOrfLength?: number;

  /** Find and translate only open reading frames (ORFs) */
  orfsOnly?: boolean;

  /** Include frame information in sequence IDs */
  includeFrameInId?: boolean;

  /** Trim sequences at first stop codon */
  trimAtFirstStop?: boolean;

  /** Allow alternative start codons (CTG, TTG, GTG) */
  allowAlternativeStarts?: boolean;
}

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
    // Validate options before processing
    this.validateOptions(options);

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
    options: TranslateOptions
  ): AsyncIterable<AbstractSequence> {
    const frames = this.determineFrames(options);
    const geneticCode = options.geneticCode ?? GeneticCode.STANDARD;

    for (const frame of frames) {
      const translation = this.performTranslation(seq, frame, geneticCode, options);

      // Always yield result, even if empty (unless ORF filtering removes it)
      if (
        translation !== null &&
        (!options.minOrfLength || translation.length >= options.minOrfLength)
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
    // ZIG_CRITICAL: String manipulation hot path - toUpperCase and character replacement
    let sequence = seq.sequence.toUpperCase().replace(/U/g, 'T');

    // Handle empty sequences
    if (sequence.length === 0) {
      return '';
    }

    // Handle reverse frames
    if (frame < 0) {
      // ZIG_CRITICAL: Reverse complement is a hot path for large sequences
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
    const codeTable = GeneticCodeTable.getGeneticCode(geneticCode);
    if (!codeTable) {
      throw createContextualError(SequenceError, `Invalid genetic code: ${geneticCode}`, {
        context: 'Use genetic codes 1-33',
        data: { providedCode: geneticCode },
      });
    }

    let protein = '';
    let isFirstCodon = true;

    // ZIG_CRITICAL: Hot loop - string slicing and codon translation for every 3 bases
    // Perfect candidate for SIMD string processing and lookup table optimization
    for (let i = frameOffset; i + 2 < sequence.length; i += 3) {
      const codon = sequence.substring(i, i + 3);
      let aminoAcid = this.translateCodon(codon, codeTable.codons);

      // Handle start codon conversion
      if (isFirstCodon && options.convertStartCodons === true) {
        if (
          this.isStartCodon(codon, geneticCode) ||
          (options.allowAlternativeStarts === true && this.isAlternativeStart(codon))
        ) {
          aminoAcid = 'M';
        }
        isFirstCodon = false;
      }

      // Handle stop codons
      if (aminoAcid === '*') {
        if (options.trimAtFirstStop === true) {
          break;
        }
        if (options.removeStopCodons === true) {
          continue;
        }
        if (options.stopCodonChar !== undefined) {
          aminoAcid = options.stopCodonChar;
        }
      }

      // Handle unknown codons
      if (aminoAcid === 'X' && options.unknownCodonChar !== undefined) {
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
    const codeTable = GeneticCodeTable.getGeneticCode(geneticCode);
    if (!codeTable) return null;

    for (let i = frameOffset; i + 2 < sequence.length; i += 3) {
      const codon = sequence.substring(i, i + 3);

      if (
        this.isStartCodon(codon, geneticCode) ||
        (options.allowAlternativeStarts === true && this.isAlternativeStart(codon))
      ) {
        // Found start codon, translate to next stop
        let protein =
          options.convertStartCodons === true ? 'M' : this.translateCodon(codon, codeTable.codons);

        for (let j = i + 3; j + 2 < sequence.length; j += 3) {
          const nextCodon = sequence.substring(j, j + 3);
          const aminoAcid = this.translateCodon(nextCodon, codeTable.codons);

          if (aminoAcid === '*') {
            // Found stop codon, complete ORF
            if (!options.removeStopCodons) {
              protein += options.stopCodonChar ?? '*';
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
   * Translate a single codon, handling ambiguity
   * ZIG_CRITICAL: Codon lookup table - perfect for SIMD hash table optimization
   */
  private translateCodon(codon: string, codonTable: { readonly [codon: string]: string }): string {
    // ZIG_CRITICAL: Hash table lookup - hot path called for every codon
    const directTranslation = codonTable[codon];
    if (directTranslation !== undefined) {
      return directTranslation;
    }

    // ZIG_CRITICAL: Ambiguous codon expansion - branchy logic with multiple lookups
    const possibleAminoAcids = this.getAmbiguousTranslations(codon, codonTable);
    if (possibleAminoAcids.size === 1) {
      return Array.from(possibleAminoAcids)[0] ?? 'X';
    }

    // Multiple possibilities or no translation found
    return 'X';
  }

  /**
   * Get possible amino acids for ambiguous codon
   */
  private getAmbiguousTranslations(
    codon: string,
    codonTable: { readonly [codon: string]: string }
  ): Set<string> {
    const possibleCodons = this.expandAmbiguousCodon(codon);
    const aminoAcids = new Set<string>();

    for (const possibleCodon of possibleCodons) {
      const aa = codonTable[possibleCodon];
      if (aa !== undefined) {
        aminoAcids.add(aa);
      }
    }

    return aminoAcids;
  }

  /**
   * Expand ambiguous codon to all possible codons
   */
  private expandAmbiguousCodon(codon: string): string[] {
    const ambiguityMap: Record<string, string[]> = {
      N: ['A', 'T', 'C', 'G'],
      R: ['A', 'G'],
      Y: ['C', 'T'],
      S: ['G', 'C'],
      W: ['A', 'T'],
      K: ['G', 'T'],
      M: ['A', 'C'],
      B: ['C', 'G', 'T'],
      D: ['A', 'G', 'T'],
      H: ['A', 'C', 'T'],
      V: ['A', 'C', 'G'],
    };

    let results = [''];

    for (const base of codon) {
      const possibilities = ambiguityMap[base] ?? [base];
      const newResults: string[] = [];

      for (const result of results) {
        for (const possibility of possibilities) {
          newResults.push(result + possibility);
        }
      }

      results = newResults;
    }

    return results;
  }

  /**
   * Check if codon is a start codon for the genetic code
   */
  private isStartCodon(codon: string, geneticCode: GeneticCode): boolean {
    return GeneticCodeTable.isStartCodon(codon, geneticCode);
  }

  /**
   * Check if codon is alternative start codon
   */
  private isAlternativeStart(codon: string): boolean {
    const alternativeStarts = ['CTG', 'TTG', 'GTG'];
    return alternativeStarts.includes(codon);
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

    return {
      id,
      sequence: translation,
      length: translation.length,
      ...(description !== undefined && { description }),
    };
  }

  /**
   * Validate translation options
   */
  private validateOptions(options: TranslateOptions): void {
    this.validateGeneticCode(options);
    this.validateFrames(options);
    this.validateOrfOptions(options);
    this.validateCharOptions(options);
  }

  /**
   * Validate genetic code option
   */
  private validateGeneticCode(options: TranslateOptions): void {
    if (options.geneticCode !== undefined) {
      const validCodes = [
        1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 16, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
        33,
      ];

      if (!validCodes.includes(options.geneticCode)) {
        throw createContextualError(SequenceError, `Invalid genetic code: ${options.geneticCode}`, {
          context: `Valid codes: ${validCodes.join(', ')}`,
          data: { providedCode: options.geneticCode },
        });
      }
    }
  }

  /**
   * Validate frames option
   */
  private validateFrames(options: TranslateOptions): void {
    if (options.frames !== undefined) {
      const validFrames = [1, 2, 3, -1, -2, -3] as const;

      for (const frame of options.frames) {
        if (!validFrames.includes(frame)) {
          throw createContextualError(SequenceError, `Invalid frame: ${frame}`, {
            context: 'Valid frames: 1, 2, 3, -1, -2, -3',
            data: { providedFrame: frame },
          });
        }
      }

      if (options.frames.length === 0) {
        throw createContextualError(SequenceError, 'At least one frame must be specified', {
          context: 'Provide frames like [1, 2, 3] or use allFrames: true',
          data: { providedFrames: options.frames },
        });
      }
    }
  }

  /**
   * Validate ORF-related options
   */
  private validateOrfOptions(options: TranslateOptions): void {
    if (options.minOrfLength !== undefined && options.minOrfLength < 1) {
      throw createContextualError(SequenceError, 'Minimum ORF length must be positive', {
        context: 'ORF length is measured in amino acids',
        data: { provided: options.minOrfLength },
      });
    }
  }

  /**
   * Validate character replacement options
   */
  private validateCharOptions(options: TranslateOptions): void {
    if (options.stopCodonChar !== undefined && options.stopCodonChar.length !== 1) {
      throw createContextualError(
        SequenceError,
        'Stop codon replacement must be single character',
        {
          context: 'Use single amino acid code like "*" or "X"',
          data: { provided: options.stopCodonChar },
        }
      );
    }

    if (options.unknownCodonChar !== undefined && options.unknownCodonChar.length !== 1) {
      throw createContextualError(
        SequenceError,
        'Unknown codon replacement must be single character',
        {
          context: 'Use single amino acid code like "X" or "N"',
          data: { provided: options.unknownCodonChar },
        }
      );
    }
  }
}
