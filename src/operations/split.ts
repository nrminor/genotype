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
import { appendString, openForWriting } from "../io/file-writer";
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
  /**
   * Process sequences with complete splitting logic that creates real files
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: SplitOptions,
  ): AsyncIterable<SplitResult> {
    // Direct ArkType validation
    const validationResult = SplitOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid split options: ${validationResult.summary}`);
    }

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
  }

  /**
   * Consumptive interface - returns summary only
   */
  async split(
    source: AsyncIterable<AbstractSequence>,
    options: SplitOptions,
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
    options: SplitOptions,
  ): AsyncIterable<SplitResult> {
    const sequencesPerFile = options.sequencesPerFile ?? 1000;
    const outputDir = options.outputDir ?? "./split";
    const prefix = options.filePrefix ?? "part";
    const extension = options.fileExtension ?? ".fasta";

    let currentPart = 1;
    let currentBatch: AbstractSequence[] = [];
    let isFirstSequence = true;
    let outputFormat: "fasta" | "fastq" = "fasta";

    const writeFile = async (
      filePath: string,
      sequences: AbstractSequence[],
      format: "fasta" | "fastq",
    ) => {
      await openForWriting(filePath, async (handle) => {
        for (const seq of sequences) {
          if (format === "fastq" && "quality" in seq) {
            const writer = new FastqWriter();
            await handle.writeString(writer.formatSequence(seq as FastqSequence));
          } else {
            const writer = new FastaWriter();
            const fastaSeq: FastaSequence = {
              format: "fasta",
              id: seq.id,
              sequence: seq.sequence,
              length: seq.length,
              ...(seq.description && { description: seq.description }),
            };
            await handle.writeString(writer.formatSequence(fastaSeq));
          }
        }
      });
    };

    for await (const sequence of source) {
      // Detect format from first sequence for writing
      if (isFirstSequence) {
        outputFormat = "quality" in sequence ? "fastq" : "fasta";
        isFirstSequence = false;
      }

      currentBatch.push(sequence);

      // Write batch when full
      if (currentBatch.length >= sequencesPerFile) {
        const filePath = `${outputDir}/${prefix}_${currentPart}${extension}`;
        await writeFile(filePath, currentBatch, outputFormat);

        // Yield results for this batch
        for (const [index, seq] of currentBatch.entries()) {
          yield {
            ...seq,
            outputFile: filePath,
            partId: currentPart,
            sequenceCount: index + 1,
          };
        }

        currentBatch = [];
        currentPart++;
      }
    }

    // Write final batch if any remain
    if (currentBatch.length > 0) {
      const filePath = `${outputDir}/${prefix}_${currentPart}${extension}`;
      await writeFile(filePath, currentBatch, outputFormat);

      for (const [index, seq] of currentBatch.entries()) {
        yield {
          ...seq,
          outputFile: filePath,
          partId: currentPart,
          sequenceCount: index + 1,
        };
      }
    }
  }

  private async *processByParts(
    source: AsyncIterable<AbstractSequence>,
    options: SplitOptions,
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

    // Distribute sequences across parts using round-robin
    for (let i = 0; i < sequences.length; i++) {
      const sequence = sequences[i];
      if (!sequence) {
        throw new Error(`Invalid sequence at index ${i}`);
      }

      const partId = Math.floor(i / sequencesPerPart) + 1;
      const countInPart = (i % sequencesPerPart) + 1;
      const filePath = `${outputDir}/${prefix}_${partId}${extension}`;

      // Write in appropriate format
      if (outputFormat === "fastq" && "quality" in sequence) {
        const fastqWriter = new FastqWriter();
        await appendString(filePath, fastqWriter.formatSequence(sequence as FastqSequence));
      } else {
        const fastaWriter = new FastaWriter();
        const fastaSeq: FastaSequence = {
          format: "fasta",
          id: sequence.id,
          sequence: sequence.sequence,
          length: sequence.length,
          ...(sequence.description !== undefined &&
            sequence.description !== null &&
            sequence.description.trim() !== "" && {
              description: sequence.description,
            }),
        };
        await appendString(filePath, fastaWriter.formatSequence(fastaSeq));
      }

      yield {
        ...sequence,
        outputFile: `${outputDir}/${prefix}_${partId}${extension}`,
        partId,
        sequenceCount: countInPart,
      };
    }
  }

  /**
   * Split sequences by cumulative base count (seqkit split2 key feature)
   */
  private async *processByLength(
    source: AsyncIterable<AbstractSequence>,
    options: SplitOptions,
  ): AsyncIterable<SplitResult> {
    const basesPerFile = options.basesPerFile ?? 1000000;
    const outputDir = options.outputDir ?? "./split";
    const prefix = options.filePrefix ?? "part";
    const extension = options.fileExtension ?? ".fasta";

    let currentBases = 0;
    let currentPart = 1;
    let currentCount = 0;
    let currentFilePath = "";
    let isFirstSequence = true;
    let outputFormat: "fasta" | "fastq" = "fasta";

    for await (const sequence of source) {
      // Detect format from first sequence for writing
      if (isFirstSequence) {
        outputFormat = "quality" in sequence ? "fastq" : "fasta";
        isFirstSequence = false;
      }

      // Create new file when base limit would be exceeded
      if (!currentFilePath || currentBases + sequence.length > basesPerFile) {
        currentFilePath = `${outputDir}/${prefix}_${currentPart}${extension}`;
        currentBases = 0;
        currentCount = 0;
        currentPart++;
      }

      // Write sequence in detected format regardless of file extension
      if (outputFormat === "fastq" && "quality" in sequence) {
        const writer = new FastqWriter();
        await appendString(currentFilePath, writer.formatSequence(sequence as FastqSequence));
      } else {
        const writer = new FastaWriter();
        const fastaSeq: FastaSequence = {
          format: "fasta",
          id: sequence.id,
          sequence: sequence.sequence,
          length: sequence.length,
          ...(sequence.description && { description: sequence.description }),
        };
        await appendString(currentFilePath, writer.formatSequence(fastaSeq));
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
    options: SplitOptions,
  ): AsyncIterable<SplitResult> {
    if (options.idRegex === undefined) {
      throw new SplitError("idRegex is required for by-id mode", "processById", "by-id");
    }
    const regex = new RegExp(options.idRegex);
    const outputDir = options.outputDir ?? "./split";
    const prefix = options.filePrefix ?? "group";
    const extension = options.fileExtension ?? ".fasta";

    const counts = new Map<string, number>();
    let isFirstSequence = true;
    let outputFormat: "fasta" | "fastq" = "fasta";

    for await (const sequence of source) {
      // Detect format from first sequence
      if (isFirstSequence) {
        outputFormat = "quality" in sequence ? "fastq" : "fasta";
        isFirstSequence = false;
      }

      const match = sequence.id.match(regex);
      const groupId = match?.[1] ?? match?.[0] ?? "ungrouped";

      if (!counts.has(groupId)) {
        counts.set(groupId, 0);
      }

      const count = (counts.get(groupId) ?? 0) + 1;
      counts.set(groupId, count);

      const filePath = `${outputDir}/${prefix}_${groupId}${extension}`;

      // Write sequence in appropriate format
      if (outputFormat === "fastq" && "quality" in sequence) {
        const fastqWriter = new FastqWriter();
        await appendString(filePath, fastqWriter.formatSequence(sequence as FastqSequence));
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
        await appendString(filePath, fastaWriter.formatSequence(fastaSeq));
      }

      yield {
        ...sequence,
        outputFile: `${outputDir}/${prefix}_${groupId}${extension}`,
        partId: groupId,
        sequenceCount: count,
      };
    }
  }

  private async *processByRegion(
    source: AsyncIterable<AbstractSequence>,
    options: SplitOptions,
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
    let count = 0;

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

      await appendString(filePath, formatted);

      yield {
        ...sequence,
        outputFile: filePath,
        partId: regionId,
        sequenceCount: count,
      };
    }
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
  prefix: string = "part",
): Promise<SplitSummary> {
  if (sequencesPerFile <= 0) {
    throw new SplitError(`Invalid sequencesPerFile: ${sequencesPerFile}`, "splitBySize", "by-size");
  }

  const filesCreated: string[] = [];
  const sequencesPerFileActual: number[] = [];

  let currentPart = 1;
  let currentCount = 0;
  let currentFilePath = "";

  try {
    for await (const sequence of sequences) {
      // Create new file when needed
      if (!currentFilePath || currentCount >= sequencesPerFile) {
        if (currentFilePath) {
          sequencesPerFileActual.push(currentCount);
        }

        currentFilePath = `${outputDir}/${prefix}_${String(currentPart)}.fasta`;
        filesCreated.push(currentFilePath);
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

      await appendString(currentFilePath, formatted);
      currentCount++;
    }

    // Record final file count
    if (currentFilePath) {
      sequencesPerFileActual.push(currentCount);
    }
  } catch (error) {
    throw new SplitError(
      `Failed to split sequences: ${error instanceof Error ? error.message : String(error)}`,
      "splitBySize",
      "by-size",
    );
  }

  return {
    filesCreated,
    totalSequences: sequencesPerFileActual.reduce((sum, count) => sum + count, 0),
    sequencesPerFile: sequencesPerFileActual,
  };
}

/**
 * Split sequences into equal parts
 */
export async function splitByParts(
  sequences: AsyncIterable<AbstractSequence>,
  numParts: number,
  outputDir: string = "./split",
  prefix: string = "part",
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
  prefix: string = "group",
): Promise<SplitSummary> {
  const filesCreated: string[] = [];
  const groupCounts = new Map<string, number>();
  const groupFiles = new Map<string, string>();

  try {
    for await (const sequence of sequences) {
      // Extract group ID
      const match = idPattern.exec(sequence.id);
      const groupId = match?.[1] ?? match?.[0] ?? "ungrouped";

      // Track file for this group
      if (!groupFiles.has(groupId)) {
        const filePath = `${outputDir}/${prefix}_${groupId}.fasta`;
        groupFiles.set(groupId, filePath);
        filesCreated.push(filePath);
        groupCounts.set(groupId, 0);
      }

      const filePath = groupFiles.get(groupId);
      if (!filePath) {
        throw new SplitError(
          `Internal error: file path not found for group ${groupId}`,
          "splitById",
          undefined,
          `groupId="${groupId}", groupFiles.has()=${groupFiles.has(groupId)}`,
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

      await appendString(filePath, formatted);
      groupCounts.set(groupId, count + 1);
    }
  } catch (error) {
    throw new SplitError(
      `Failed to split by ID: ${error instanceof Error ? error.message : String(error)}`,
      "splitById",
    );
  }

  return {
    filesCreated,
    totalSequences: Array.from(groupCounts.values()).reduce((sum, count) => sum + count, 0),
    sequencesPerFile: Array.from(groupCounts.values()),
  };
}

/**
 * Complete SplitProcessor implementation that creates actual files
 *
 * This processor both creates files on disk AND yields SplitResult objects
 * for pipeline integration, following Tiger Style principles.
 */
