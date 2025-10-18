/**
 * Split utilities - File splitting operations
 *
 * Provides utility functions for splitting sequence files and a processor
 * class for integration with the SeqOps pipeline system.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { type } from "arktype";
import { SplitError, ValidationError } from "../errors";
import { FastaWriter, FastqWriter } from "../formats";
import type { AbstractSequence, FastaSequence, FastqSequence } from "../types";
import type { SplitOptions } from "./types";

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
 * ArkType schema for SplitOptions validation with custom logic
 */
const SplitOptionsSchema = type({
  mode: "'by-size' | 'by-parts' | 'by-length' | 'by-id' | 'by-region'",
  "sequencesPerFile?": "number>0",
  "numParts?": "number>0",
  "basesPerFile?": "number>0",
  "idRegex?": "string",
  "region?": "string",
  "outputDir?": "string",
  "filePrefix?": "string",
  "fileExtension?": "string",
  "keepOrder?": "boolean",
  "useStreaming?": "boolean",
  "maxMemoryMB?": "number>0",
  "bufferSize?": "number>0",
}).narrow((options, ctx) => {
  // Complex validations that ArkType can't express natively

  // Validate regex syntax for by-id mode
  if (options.mode === "by-id") {
    if (!options.idRegex) {
      return ctx.reject({
        expected: "idRegex is required for by-id mode",
        path: ["idRegex"],
      });
    }
    try {
      new RegExp(options.idRegex);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Invalid regex";
      return ctx.reject({
        expected: "valid regex pattern",
        actual: `${options.idRegex} (${errorMessage})`,
        path: ["idRegex"],
      });
    }
  }

  // Validate region format for by-region mode
  if (options.mode === "by-region") {
    if (!options.region) {
      return ctx.reject({
        expected: "region is required for by-region mode",
        path: ["region"],
      });
    }
    const regionMatch = options.region.match(/^(.+):(\d+)-(\d+)$/);
    if (!regionMatch) {
      return ctx.reject({
        expected: "region format chr:start-end",
        actual: options.region,
        path: ["region"],
      });
    }
    const [, , startStr, endStr] = regionMatch;
    if (startStr === undefined || endStr === undefined) {
      return ctx.reject({
        expected: "valid region coordinates",
        actual: options.region,
        path: ["region"],
      });
    }
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (start >= end) {
      return ctx.reject({
        expected: "start < end",
        actual: `start=${start}, end=${end}`,
        path: ["region"],
      });
    }
  }

  return true;
});

/**
 * Split sequences into files by size
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
    // Direct ArkType validation
    const validationResult = SplitOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid split options: ${validationResult.summary}`);
    }

    try {
      switch (options.mode) {
        case "by-size":
          yield* this.processBySize(source, options);
          break;
        case "by-parts":
          yield* this.processByParts(source, options);
          break;
        case "by-length":
          yield* this.processByLength(source, options);
          break;
        case "by-id":
          yield* this.processById(source, options);
          break;
        case "by-region":
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
    const outputDir = options.outputDir ?? "./split";
    const prefix = options.filePrefix ?? "part";
    const extension = options.fileExtension ?? ".fasta";

    let currentPart = 1;
    let currentCount = 0;
    let currentWriter: Bun.FileSink | null = null;
    let isFirstSequence = true;
    let outputFormat: "fasta" | "fastq" = "fasta";

    for await (const sequence of source) {
      // Detect format from first sequence for writing
      if (isFirstSequence) {
        outputFormat = "quality" in sequence ? "fastq" : "fasta";
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
      if (outputFormat === "fastq" && "quality" in sequence) {
        const writer = new FastqWriter();
        currentWriter.write(writer.formatSequence(sequence as FastqSequence));
      } else {
        const writer = new FastaWriter();
        const fastaSeq: FastaSequence = {
          format: "fasta",
          id: sequence.id,
          sequence: sequence.sequence,
          length: sequence.length,
          ...(sequence.description && { description: sequence.description }),
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
    const outputDir = options.outputDir ?? "./split";
    const prefix = options.filePrefix ?? "part";

    // Collection is legitimate here - need total count for round-robin distribution
    const sequences: AbstractSequence[] = [];
    for await (const seq of source) {
      sequences.push(seq);
    }

    if (sequences.length === 0) return;

    const sequencesPerPart = Math.ceil(sequences.length / numParts);
    const [first] = sequences;
    const outputFormat = first && "quality" in first ? "fastq" : "fasta";
    const extension = options.fileExtension ?? ".fasta";
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
        const sequence = sequences[i];
        if (!sequence) {
          throw new Error(`Invalid sequence at index ${i}`);
        }

        const partId = Math.floor(i / sequencesPerPart) + 1;
        const countInPart = (i % sequencesPerPart) + 1;

        const writer = writers.get(partId);
        if (writer) {
          // Write in appropriate format
          if (outputFormat === "fastq" && "quality" in sequence) {
            const fastqWriter = new FastqWriter();
            writer.write(fastqWriter.formatSequence(sequence as FastqSequence));
          } else {
            const fastaWriter = new FastaWriter();
            const fastaSeq: FastaSequence = {
              format: "fasta",
              id: sequence.id,
              sequence: sequence.sequence,
              length: sequence.length,
              ...(sequence.description !== undefined &&
                sequence.description !== null &&
                sequence.description !== "" && {
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
    const outputDir = options.outputDir ?? "./split";
    const prefix = options.filePrefix ?? "part";
    const extension = options.fileExtension ?? ".fasta";

    let currentBases = 0;
    let currentPart = 1;
    let currentCount = 0;
    let currentWriter: Bun.FileSink | null = null;
    let isFirstSequence = true;
    let outputFormat: "fasta" | "fastq" = "fasta";

    for await (const sequence of source) {
      // Detect format from first sequence for writing
      if (isFirstSequence) {
        outputFormat = "quality" in sequence ? "fastq" : "fasta";
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
      if (outputFormat === "fastq" && "quality" in sequence) {
        const writer = new FastqWriter();
        currentWriter.write(writer.formatSequence(sequence as FastqSequence));
      } else {
        const writer = new FastaWriter();
        const fastaSeq: FastaSequence = {
          format: "fasta",
          id: sequence.id,
          sequence: sequence.sequence,
          length: sequence.length,
          ...(sequence.description && { description: sequence.description }),
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
    if (options.idRegex === undefined) {
      throw new SplitError("idRegex is required for by-id mode", "processById", "by-id");
    }
    const regex = new RegExp(options.idRegex);
    const outputDir = options.outputDir ?? "./split";
    const prefix = options.filePrefix ?? "group";

    const writers = new Map<string, Bun.FileSink>();
    const counts = new Map<string, number>();
    let isFirstSequence = true;
    let outputFormat: "fasta" | "fastq" = "fasta";

    try {
      for await (const sequence of source) {
        // Detect format from first sequence
        if (isFirstSequence) {
          outputFormat = "quality" in sequence ? "fastq" : "fasta";
          isFirstSequence = false;
        }

        const match = sequence.id.match(regex);
        const groupId = match?.[1] ?? match?.[0] ?? "ungrouped";

        // Get or create writer for this group
        if (!writers.has(groupId)) {
          const extension = options.fileExtension ?? ".fasta";
          const filePath = `${outputDir}/${prefix}_${groupId}${extension}`;
          const writer = Bun.file(filePath).writer();
          writers.set(groupId, writer);
          this.activeWriters.set(groupId, writer);
          counts.set(groupId, 0);
        }

        const count = (counts.get(groupId) ?? 0) + 1;
        counts.set(groupId, count);

        // Write sequence in appropriate format
        const writer = writers.get(groupId);
        if (writer === undefined) {
          throw new SplitError(
            `Internal error: writer not found for group ${groupId}`,
            "by-id",
            "by-id",
            `groupId="${groupId}", writers.has()=${writers.has(groupId)}`
          );
        }
        if (outputFormat === "fastq" && "quality" in sequence) {
          const fastqWriter = new FastqWriter();
          writer.write(fastqWriter.formatSequence(sequence as FastqSequence));
        } else {
          const fastaWriter = new FastaWriter();
          const fastaSeq: FastaSequence = {
            format: "fasta",
            id: sequence.id,
            sequence: sequence.sequence,
            length: sequence.length,
            ...(sequence.description !== undefined &&
              sequence.description !== null &&
              sequence.description !== "" && {
                description: sequence.description,
              }),
          };
          writer.write(fastaWriter.formatSequence(fastaSeq));
        }

        const extension = options.fileExtension ?? ".fasta";
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
    if (options.region === undefined) {
      throw new SplitError("region is required for by-region mode", "processByRegion", "by-region");
    }
    const regionId = options.region; // Keep original format for partId
    const outputDir = options.outputDir ?? "./split";
    const prefix = options.filePrefix ?? "region";

    const extension = options.fileExtension ?? ".fasta";
    const fileNameSafe = regionId.replace(/[^a-zA-Z0-9]/g, "_");
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
          format: "fasta",
          id: sequence.id,
          sequence: sequence.sequence,
          length: sequence.length,
          ...(sequence.description !== null &&
            sequence.description !== undefined &&
            sequence.description !== "" && {
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
}
export async function splitBySize(
  sequences: AsyncIterable<AbstractSequence>,
  sequencesPerFile: number,
  outputDir: string = "./split",
  prefix: string = "part"
): Promise<SplitSummary> {
  if (sequencesPerFile <= 0) {
    throw new SplitError(`Invalid sequencesPerFile: ${sequencesPerFile}`, "splitBySize", "by-size");
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
        format: "fasta",
        id: sequence.id,
        sequence: sequence.sequence,
        length: sequence.length,
        ...(sequence.description && { description: sequence.description }),
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
      "splitBySize",
      "by-size"
    );
  }
}

/**
 * Split sequences into equal parts
 */
export async function splitByParts(
  sequences: AsyncIterable<AbstractSequence>,
  numParts: number,
  outputDir: string = "./split",
  prefix: string = "part"
): Promise<SplitSummary> {
  if (numParts <= 0) {
    throw new SplitError(`Invalid numParts: ${numParts}`, "splitByParts");
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
  outputDir: string = "./split",
  prefix: string = "group"
): Promise<SplitSummary> {
  const writers = new Map<string, Bun.FileSink>();
  const filesCreated: string[] = [];
  const groupCounts = new Map<string, number>();

  try {
    for await (const sequence of sequences) {
      // Extract group ID
      const match = idPattern.exec(sequence.id);
      const groupId = match?.[1] ?? match?.[0] ?? "ungrouped";

      // Get or create writer
      if (!writers.has(groupId)) {
        const filePath = `${outputDir}/${prefix}_${groupId}.fasta`;
        const writer = Bun.file(filePath).writer();
        writers.set(groupId, writer);
        filesCreated.push(filePath);
        groupCounts.set(groupId, 0);
      }

      const writer = writers.get(groupId);
      if (writer === undefined) {
        throw new SplitError(
          `Internal error: writer not found for group ${groupId}`,
          "splitById",
          undefined,
          `groupId="${groupId}", writers.has()=${writers.has(groupId)}`
        );
      }
      const count = groupCounts.get(groupId) ?? 0;

      // Write sequence
      const fastaWriter = new FastaWriter();
      const formatted = fastaWriter.formatSequence({
        format: "fasta",
        id: sequence.id,
        sequence: sequence.sequence,
        length: sequence.length,
        ...(sequence.description && { description: sequence.description }),
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
      "splitById"
    );
  }
}

/**
 * Complete SplitProcessor implementation that creates actual files
 *
 * This processor both creates files on disk AND yields SplitResult objects
 * for pipeline integration, following Tiger Style principles.
 */
