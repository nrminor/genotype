/**
 * Split utilities - File splitting operations
 *
 * Provides utility functions for splitting sequence files and a processor
 * class for integration with the SeqOps pipeline system.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { FastaWriter, FastqWriter } from '../formats';
import { GenotypeError } from '../errors';
import type { AbstractSequence, FastaSequence, FastqSequence } from '../types';
import type { SplitOptions } from './types';

/**
 * Split operation error with properly typed mode
 */
export class SplitError extends GenotypeError {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly mode?: SplitOptions['mode'],
    public readonly splitContext?: string
  ) {
    super(message, 'SPLIT_ERROR');
    this.name = 'SplitError';
  }
}

/**
 * Result of a split operation for each sequence
 */
export interface SplitResult extends AbstractSequence {
  /** Output file path where sequence was written */
  readonly outputFile: string;
  /** Part number/identifier for this split */
  readonly partId: string | number;
  /** Total number of sequences in this part */
  readonly sequenceCount: number;
}

/**
 * Summary result of split operation
 */
export interface SplitSummary {
  readonly filesCreated: string[];
  readonly totalSequences: number;
  readonly sequencesPerFile: number[];
}

/**
 * Split sequences into files by size
 */
export async function splitBySize(
  sequences: AsyncIterable<AbstractSequence>,
  sequencesPerFile: number,
  outputDir: string = './split',
  prefix: string = 'part'
): Promise<SplitSummary> {
  if (sequencesPerFile <= 0) {
    throw new SplitError(`Invalid sequencesPerFile: ${sequencesPerFile}`, 'splitBySize', 'by-size');
  }

  const filesCreated: string[] = [];
  const sequencesPerFileActual: number[] = [];

  let currentPart = 1;
  let currentCount = 0;
  let currentWriter: Bun.FileSink | null = null;

  try {
    for await (const sequence of sequences) {
      // Create new file when needed
      if (!currentWriter || currentCount >= sequencesPerFile) {
        if (currentWriter) {
          await currentWriter.end();
          sequencesPerFileActual.push(currentCount);
        }

        const filePath = `${outputDir}/${prefix}_${String(currentPart)}.fasta`;
        currentWriter = Bun.file(filePath).writer();
        filesCreated.push(filePath);
        currentCount = 0;
        currentPart++;
      }

      // Write sequence in FASTA format
      const writer = new FastaWriter();
      const formatted = writer.formatSequence({
        format: 'fasta',
        id: sequence.id,
        sequence: sequence.sequence,
        length: sequence.length,
        ...(sequence.description !== null &&
          sequence.description !== undefined &&
          sequence.description !== '' && { description: sequence.description }),
      } as FastaSequence);

      currentWriter.write(formatted);
      currentCount++;
    }

    // Close final writer
    if (currentWriter) {
      await currentWriter.end();
      sequencesPerFileActual.push(currentCount);
    }

    return {
      filesCreated,
      totalSequences: sequencesPerFileActual.reduce((sum, count) => sum + count, 0),
      sequencesPerFile: sequencesPerFileActual,
    };
  } catch (error) {
    if (currentWriter) {
      await currentWriter.end();
    }

    throw new SplitError(
      `Failed to split sequences: ${error instanceof Error ? error.message : String(error)}`,
      'splitBySize',
      'by-size'
    );
  }
}

/**
 * Split sequences into equal parts
 */
export async function splitByParts(
  sequences: AsyncIterable<AbstractSequence>,
  numParts: number,
  outputDir: string = './split',
  prefix: string = 'part'
): Promise<SplitSummary> {
  if (numParts <= 0) {
    throw new SplitError(`Invalid numParts: ${numParts}`, 'splitByParts');
  }

  // Collect sequences to determine total count
  const allSequences: AbstractSequence[] = [];
  for await (const seq of sequences) {
    allSequences.push(seq);
  }

  if (allSequences.length === 0) {
    return { filesCreated: [], totalSequences: 0, sequencesPerFile: [] };
  }

  const sequencesPerPart = Math.ceil(allSequences.length / numParts);

  // Convert array back to async iterable and split
  async function* arrayToIterable() {
    for (const seq of allSequences) {
      yield seq;
    }
  }

  return splitBySize(arrayToIterable(), sequencesPerPart, outputDir, prefix);
}

/**
 * Split sequences by ID pattern
 */
export async function splitById(
  sequences: AsyncIterable<AbstractSequence>,
  idPattern: RegExp,
  outputDir: string = './split',
  prefix: string = 'group'
): Promise<SplitSummary> {
  const writers = new Map<string, Bun.FileSink>();
  const filesCreated: string[] = [];
  const groupCounts = new Map<string, number>();

  try {
    for await (const sequence of sequences) {
      // Extract group ID
      const match = idPattern.exec(sequence.id);
      const groupId = match?.[1] ?? match?.[0] ?? 'ungrouped';

      // Get or create writer
      if (!writers.has(groupId)) {
        const filePath = outputDir + '/' + prefix + '_' + groupId + '.fasta';
        const writer = Bun.file(filePath).writer();
        writers.set(groupId, writer);
        filesCreated.push(filePath);
        groupCounts.set(groupId, 0);
      }

      const writer = writers.get(groupId)!;
      const count = groupCounts.get(groupId)! || 0;

      // Write sequence
      const fastaWriter = new FastaWriter();
      const formatted = fastaWriter.formatSequence({
        format: 'fasta',
        id: sequence.id,
        sequence: sequence.sequence,
        length: sequence.length,
        ...(sequence.description !== null &&
          sequence.description !== undefined &&
          sequence.description !== '' && { description: sequence.description }),
      } as FastaSequence);

      writer.write(formatted);
      groupCounts.set(groupId, count + 1);
    }

    // Close all writers
    for (const writer of writers.values()) {
      await writer.end();
    }

    return {
      filesCreated,
      totalSequences: Array.from(groupCounts.values()).reduce((sum, count) => sum + count, 0),
      sequencesPerFile: Array.from(groupCounts.values()),
    };
  } catch (error) {
    // Clean up on error
    for (const writer of writers.values()) {
      await writer.end();
    }

    throw new SplitError(
      `Failed to split by ID: ${error instanceof Error ? error.message : String(error)}`,
      'splitById'
    );
  }
}

/**
 * Complete SplitProcessor implementation that creates actual files
 *
 * This processor both creates files on disk AND yields SplitResult objects
 * for pipeline integration, following Tiger Style principles.
 */
export class SplitProcessor {
  private readonly activeWriters = new Map<string | number, Bun.FileSink>();

  /**
   * Process sequences with complete splitting logic that creates real files
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: SplitOptions
  ): AsyncIterable<SplitResult> {
    this.validateOptions(options);

    try {
      switch (options.mode) {
        case 'by-size':
          yield* this.processBySize(source, options);
          break;
        case 'by-parts':
          yield* this.processByParts(source, options);
          break;
        case 'by-length':
          yield* this.processByLength(source, options);
          break;
        case 'by-id':
          yield* this.processById(source, options);
          break;
        case 'by-region':
          yield* this.processByRegion(source, options);
          break;
      }
    } finally {
      await this.closeAllWriters();
    }
  }

  /**
   * Consumptive interface - returns summary only
   */
  async split(
    source: AsyncIterable<AbstractSequence>,
    options: SplitOptions
  ): Promise<SplitSummary> {
    const results: SplitResult[] = [];

    for await (const result of this.process(source, options)) {
      results.push(result);
    }

    // Aggregate results into summary
    const filesCreated = Array.from(new Set(results.map((r) => r.outputFile)));
    const sequencesPerFile = this.calculateSequencesPerFile(results, filesCreated);

    return {
      filesCreated,
      totalSequences: results.length,
      sequencesPerFile,
    };
  }

  private async *processBySize(
    source: AsyncIterable<AbstractSequence>,
    options: SplitOptions
  ): AsyncIterable<SplitResult> {
    const sequencesPerFile = options.sequencesPerFile ?? 1000;
    const outputDir = options.outputDir ?? './split';
    const prefix = options.filePrefix ?? 'part';
    const extension = options.fileExtension ?? '.fasta';

    let currentPart = 1;
    let currentCount = 0;
    let currentWriter: Bun.FileSink | null = null;
    let isFirstSequence = true;
    let outputFormat: 'fasta' | 'fastq' = 'fasta';

    for await (const sequence of source) {
      // Detect format from first sequence for writing
      if (isFirstSequence) {
        outputFormat = 'quality' in sequence ? 'fastq' : 'fasta';
        isFirstSequence = false;
      }

      // Create new file when needed
      if (!currentWriter || currentCount >= sequencesPerFile) {
        if (currentWriter) {
          await currentWriter.end();
        }

        const filePath = `${outputDir}/${prefix}_${currentPart}${extension}`;
        currentWriter = Bun.file(filePath).writer();
        this.activeWriters.set(currentPart, currentWriter);

        currentCount = 0;
        currentPart++;
      }

      currentCount++;

      // Write sequence in detected format (content) regardless of extension (user choice)
      if (outputFormat === 'fastq' && 'quality' in sequence) {
        const writer = new FastqWriter();
        currentWriter.write(writer.formatSequence(sequence as FastqSequence));
      } else {
        const writer = new FastaWriter();
        const fastaSeq: FastaSequence = {
          format: 'fasta',
          id: sequence.id,
          sequence: sequence.sequence,
          length: sequence.length,
          ...(sequence.description !== undefined &&
            sequence.description !== null &&
            sequence.description !== '' && {
              description: sequence.description,
            }),
        };
        currentWriter.write(writer.formatSequence(fastaSeq));
      }

      yield {
        ...sequence,
        outputFile: `${outputDir}/${prefix}_${currentPart - 1}${extension}`,
        partId: currentPart - 1,
        sequenceCount: currentCount,
      };
    }
  }

  private async *processByParts(
    source: AsyncIterable<AbstractSequence>,
    options: SplitOptions
  ): AsyncIterable<SplitResult> {
    const numParts = options.numParts ?? 2;
    const outputDir = options.outputDir ?? './split';
    const prefix = options.filePrefix ?? 'part';

    // Collection is legitimate here - need total count for round-robin distribution
    const sequences: AbstractSequence[] = [];
    for await (const seq of source) {
      sequences.push(seq);
    }

    if (sequences.length === 0) return;

    const sequencesPerPart = Math.ceil(sequences.length / numParts);
    const outputFormat = sequences.length > 0 && 'quality' in sequences[0]! ? 'fastq' : 'fasta';
    const extension = options.fileExtension ?? '.fasta';
    const writers = new Map<number, Bun.FileSink>();

    try {
      // Create files for each part
      for (let partId = 1; partId <= numParts; partId++) {
        const filePath = `${outputDir}/${prefix}_${partId}${extension}`;
        const writer = Bun.file(filePath).writer();
        writers.set(partId, writer);
        this.activeWriters.set(partId, writer);
      }

      // Distribute sequences across parts using round-robin
      for (let i = 0; i < sequences.length; i++) {
        const sequence = sequences[i]!;
        const partId = Math.floor(i / sequencesPerPart) + 1;
        const countInPart = (i % sequencesPerPart) + 1;

        const writer = writers.get(partId);
        if (writer) {
          // Write in appropriate format
          if (outputFormat === 'fastq' && 'quality' in sequence) {
            const fastqWriter = new FastqWriter();
            writer.write(fastqWriter.formatSequence(sequence as FastqSequence));
          } else {
            const fastaWriter = new FastaWriter();
            const fastaSeq: FastaSequence = {
              format: 'fasta',
              id: sequence.id,
              sequence: sequence.sequence,
              length: sequence.length,
              ...(sequence.description !== undefined &&
                sequence.description !== null &&
                sequence.description !== '' && {
                  description: sequence.description,
                }),
            };
            writer.write(fastaWriter.formatSequence(fastaSeq));
          }
        }

        yield {
          ...sequence,
          outputFile: `${outputDir}/${prefix}_${partId}${extension}`,
          partId,
          sequenceCount: countInPart,
        };
      }
    } finally {
      for (const writer of writers.values()) {
        await writer.end();
      }
    }
  }

  /**
   * Split sequences by cumulative base count (seqkit split2 key feature)
   */
  private async *processByLength(
    source: AsyncIterable<AbstractSequence>,
    options: SplitOptions
  ): AsyncIterable<SplitResult> {
    const basesPerFile = options.basesPerFile ?? 1000000;
    const outputDir = options.outputDir ?? './split';
    const prefix = options.filePrefix ?? 'part';
    const extension = options.fileExtension ?? '.fasta';

    let currentBases = 0;
    let currentPart = 1;
    let currentCount = 0;
    let currentWriter: Bun.FileSink | null = null;
    let isFirstSequence = true;
    let outputFormat: 'fasta' | 'fastq' = 'fasta';

    for await (const sequence of source) {
      // Detect format from first sequence for writing
      if (isFirstSequence) {
        outputFormat = 'quality' in sequence ? 'fastq' : 'fasta';
        isFirstSequence = false;
      }

      // Create new file when base limit would be exceeded
      if (!currentWriter || currentBases + sequence.length > basesPerFile) {
        if (currentWriter) {
          await currentWriter.end();
        }

        const filePath = `${outputDir}/${prefix}_${currentPart}${extension}`;
        currentWriter = Bun.file(filePath).writer();
        this.activeWriters.set(currentPart, currentWriter);

        currentBases = 0;
        currentCount = 0;
        currentPart++;
      }

      // Write sequence in detected format regardless of file extension
      if (outputFormat === 'fastq' && 'quality' in sequence) {
        const writer = new FastqWriter();
        currentWriter.write(writer.formatSequence(sequence as FastqSequence));
      } else {
        const writer = new FastaWriter();
        const fastaSeq: FastaSequence = {
          format: 'fasta',
          id: sequence.id,
          sequence: sequence.sequence,
          length: sequence.length,
          ...(sequence.description !== undefined &&
            sequence.description !== null &&
            sequence.description !== '' && {
              description: sequence.description,
            }),
        };
        currentWriter.write(writer.formatSequence(fastaSeq));
      }

      currentBases += sequence.length;
      currentCount++;

      yield {
        ...sequence,
        outputFile: `${outputDir}/${prefix}_${currentPart - 1}${extension}`,
        partId: currentPart - 1,
        sequenceCount: currentCount,
      };
    }
  }

  private async *processById(
    source: AsyncIterable<AbstractSequence>,
    options: SplitOptions
  ): AsyncIterable<SplitResult> {
    const regex = new RegExp(options.idRegex!);
    const outputDir = options.outputDir ?? './split';
    const prefix = options.filePrefix ?? 'group';

    const writers = new Map<string, Bun.FileSink>();
    const counts = new Map<string, number>();
    let isFirstSequence = true;
    let outputFormat: 'fasta' | 'fastq' = 'fasta';

    try {
      for await (const sequence of source) {
        // Detect format from first sequence
        if (isFirstSequence) {
          outputFormat = 'quality' in sequence ? 'fastq' : 'fasta';
          isFirstSequence = false;
        }

        const match = sequence.id.match(regex);
        const groupId = match?.[1] ?? match?.[0] ?? 'ungrouped';

        // Get or create writer for this group
        if (!writers.has(groupId)) {
          const extension = options.fileExtension ?? '.fasta';
          const filePath = `${outputDir}/${prefix}_${groupId}${extension}`;
          const writer = Bun.file(filePath).writer();
          writers.set(groupId, writer);
          this.activeWriters.set(groupId, writer);
          counts.set(groupId, 0);
        }

        const count = (counts.get(groupId) ?? 0) + 1;
        counts.set(groupId, count);

        // Write sequence in appropriate format
        const writer = writers.get(groupId)!;
        if (outputFormat === 'fastq' && 'quality' in sequence) {
          const fastqWriter = new FastqWriter();
          writer.write(fastqWriter.formatSequence(sequence as FastqSequence));
        } else {
          const fastaWriter = new FastaWriter();
          const fastaSeq: FastaSequence = {
            format: 'fasta',
            id: sequence.id,
            sequence: sequence.sequence,
            length: sequence.length,
            ...(sequence.description !== undefined &&
              sequence.description !== null &&
              sequence.description !== '' && {
                description: sequence.description,
              }),
          };
          writer.write(fastaWriter.formatSequence(fastaSeq));
        }

        const extension = options.fileExtension ?? '.fasta';
        yield {
          ...sequence,
          outputFile: `${outputDir}/${prefix}_${groupId}${extension}`,
          partId: groupId,
          sequenceCount: count,
        };
      }
    } finally {
      for (const writer of writers.values()) {
        await writer.end();
      }
    }
  }

  private async *processByRegion(
    source: AsyncIterable<AbstractSequence>,
    options: SplitOptions
  ): AsyncIterable<SplitResult> {
    const regionId = options.region!; // Keep original format for partId
    const outputDir = options.outputDir ?? './split';
    const prefix = options.filePrefix ?? 'region';

    const extension = options.fileExtension ?? '.fasta';
    const fileNameSafe = regionId.replace(/[^a-zA-Z0-9]/g, '_');
    const filePath = `${outputDir}/${prefix}_${fileNameSafe}${extension}`;

    const writer = Bun.file(filePath).writer();
    this.activeWriters.set(regionId, writer);
    let count = 0;

    try {
      for await (const sequence of source) {
        count++;

        // Write to file
        const fastaWriter = new FastaWriter();
        const formatted = fastaWriter.formatSequence({
          format: 'fasta',
          id: sequence.id,
          sequence: sequence.sequence,
          length: sequence.length,
          ...(sequence.description !== null &&
            sequence.description !== undefined &&
            sequence.description !== '' && {
              description: sequence.description,
            }),
        } as FastaSequence);

        writer.write(formatted);

        yield {
          ...sequence,
          outputFile: filePath,
          partId: regionId,
          sequenceCount: count,
        };
      }
    } finally {
      await writer.end();
    }
  }

  /**
   * Close all active file writers
   */
  private async closeAllWriters(): Promise<void> {
    const closePromises = Array.from(this.activeWriters.values()).map((writer) => writer.end());
    await Promise.all(closePromises);
    this.activeWriters.clear();
  }

  /**
   * Calculate sequences per file for summary
   */
  private calculateSequencesPerFile(results: SplitResult[], filesCreated: string[]): number[] {
    const fileCounts = new Map<string, number>();

    for (const result of results) {
      const current = fileCounts.get(result.outputFile) ?? 0;
      fileCounts.set(result.outputFile, current + 1);
    }

    return filesCreated.map((file) => fileCounts.get(file) ?? 0);
  }

  /**
   * Validate split options
   */
  private validateOptions(options: SplitOptions): void {
    if (!options.mode) {
      throw new SplitError('Split mode is required', '');
    }

    this.validateMemoryOptions(options);
    this.validateModeSpecificOptions(options);
  }

  /**
   * Validate memory-related options
   */
  private validateMemoryOptions(options: SplitOptions): void {
    if (options.maxMemoryMB !== undefined && options.maxMemoryMB <= 0) {
      throw new SplitError(
        `Invalid maxMemoryMB: ${options.maxMemoryMB}`,
        'validateOptions',
        options.mode
      );
    }
    if (options.bufferSize !== undefined && options.bufferSize <= 0) {
      throw new SplitError(
        `Invalid bufferSize: ${options.bufferSize}`,
        'validateOptions',
        options.mode
      );
    }
  }

  /**
   * Validate mode-specific options
   */
  private validateModeSpecificOptions(options: SplitOptions): void {
    switch (options.mode) {
      case 'by-size':
        this.validateBySizeOptions(options);
        break;
      case 'by-parts':
        this.validateByPartsOptions(options);
        break;
      case 'by-length':
        this.validateByLengthOptions(options);
        break;
      case 'by-id':
        this.validateByIdOptions(options);
        break;
      case 'by-region':
        this.validateByRegionOptions(options);
        break;
      default:
        throw new SplitError(`Unsupported split mode: ${options.mode}`, options.mode);
    }
  }

  private validateBySizeOptions(options: SplitOptions): void {
    if (options.sequencesPerFile !== undefined && options.sequencesPerFile <= 0) {
      throw new SplitError(
        `Invalid sequencesPerFile: ${options.sequencesPerFile}`,
        'processBySize',
        options.mode
      );
    }
  }

  private validateByPartsOptions(options: SplitOptions): void {
    if (options.numParts !== undefined && options.numParts <= 0) {
      throw new SplitError(`Invalid numParts: ${options.numParts}`, 'processByParts', options.mode);
    }
  }

  private validateByLengthOptions(options: SplitOptions): void {
    if (options.basesPerFile !== undefined && options.basesPerFile <= 0) {
      throw new SplitError(
        `Invalid basesPerFile: ${options.basesPerFile}`,
        'processByLength',
        options.mode
      );
    }
  }

  private validateByIdOptions(options: SplitOptions): void {
    if (options.idRegex === undefined || options.idRegex === null || options.idRegex === '') {
      throw new SplitError('idRegex is required for by-id mode', options.mode);
    }

    try {
      new RegExp(options.idRegex);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new SplitError(
        `Invalid regex pattern '${options.idRegex}': ${errorMessage}`,
        'splitByRegex',
        options.mode,
        `Pattern: ${options.idRegex}`
      );
    }
  }

  private validateByRegionOptions(options: SplitOptions): void {
    if (options.region === undefined || options.region === null || options.region === '') {
      throw new SplitError('region is required for by-region mode', options.mode);
    }

    const regionMatch = options.region.match(/^(.+):(\d+)-(\d+)$/);
    if (!regionMatch) {
      throw new SplitError(
        `Invalid region format: ${options.region} (expected chr:start-end)`,
        options.mode
      );
    }

    const [, , startStr, endStr] = regionMatch;
    const start = parseInt(startStr!, 10);
    const end = parseInt(endStr!, 10);
    if (start >= end) {
      throw new SplitError(
        `Invalid region coordinates: start (${start}) must be < end (${end})`,
        options.mode
      );
    }
  }
}
