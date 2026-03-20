/**
 * BAM/SAM alignment parser backed by noodles via the native addon.
 *
 * Treats BAM and SAM as input formats that produce AlignmentRecord
 * objects — the same way FASTAParser and FASTQParser produce
 * FastaSequence and FastqSequence objects. Format detection is
 * automatic (BGZF magic bytes for BAM, text otherwise for SAM).
 *
 * The parser delegates all binary parsing, BGZF decompression, and
 * format handling to the Rust noodles reader. The TypeScript side
 * unpacks batched results into AlignmentRecord objects that conform
 * to AbstractSequence and flow through the operations pipeline.
 */

import { GenotypeString } from "../genotype-string";
import { getBackend, type AlignmentBatch, type AlignmentReaderHandle } from "../backend";
import type { AlignmentRecord, ParserOptions } from "../types";
import { AbstractParser } from "./abstract-parser";

const DEFAULT_BATCH_SIZE = 4096;
const utf8_decoder = new TextDecoder();

/**
 * Parser for BAM and SAM alignment files.
 *
 * Requires the native addon — BAM/SAM parsing is not available in
 * pure TypeScript mode. Format detection is automatic.
 *
 * @example Basic usage
 * ```typescript
 * const parser = new AlignmentParser();
 * for await (const record of parser.parseFile("alignments.bam")) {
 *   console.log(`${record.id} -> ${record.referenceSequence}:${record.position}`);
 * }
 * ```
 *
 * @example With seqops pipeline
 * ```typescript
 * const results = await seqops(new AlignmentParser().parseFile("reads.bam"))
 *   .filter({ minLength: 100 })
 *   .unique({ by: "sequence" })
 *   .collect();
 * ```
 */
export class AlignmentParser extends AbstractParser<AlignmentRecord> {
  protected getDefaultOptions(): Partial<ParserOptions> {
    return {};
  }

  protected getFormatName(): string {
    return "BAM/SAM";
  }

  async *parseFile(filePath: string): AsyncIterable<AlignmentRecord> {
    const backend = await getBackend();
    if (backend.createAlignmentReaderFromPath === undefined) {
      throw new Error(
        "BAM/SAM parsing backend unavailable. " +
          "Ensure a compatible backend is configured and built."
      );
    }

    const reader = await backend.createAlignmentReaderFromPath(filePath);
    yield* this.readAll(reader);
  }

  async *parseString(data: string): AsyncIterable<AlignmentRecord> {
    const backend = await getBackend();
    if (backend.createAlignmentReaderFromBytes === undefined) {
      throw new Error(
        "BAM/SAM parsing backend unavailable. " +
          "Ensure a compatible backend is configured and built."
      );
    }

    const reader = await backend.createAlignmentReaderFromBytes(
      new Uint8Array(Buffer.from(data, "utf8"))
    );
    yield* this.readAll(reader);
  }

  async *parse(stream: ReadableStream<Uint8Array>): AsyncIterable<AlignmentRecord> {
    const backend = await getBackend();
    if (backend.createAlignmentReaderFromBytes === undefined) {
      throw new Error(
        "BAM/SAM parsing backend unavailable. " +
          "Ensure a compatible backend is configured and built."
      );
    }

    const chunks: Uint8Array[] = [];
    const streamReader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await streamReader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      streamReader.releaseLock();
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = Buffer.allocUnsafe(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const reader = await backend.createAlignmentReaderFromBytes(combined);
    yield* this.readAll(reader);
  }

  private async *readAll(reader: AlignmentReaderHandle): AsyncIterable<AlignmentRecord> {
    try {
      let recordIndex = 0;
      let batch = await reader.readBatch(DEFAULT_BATCH_SIZE);
      while (batch !== null) {
        this.checkAborted();
        for (const record of unpackBatch(batch, recordIndex)) {
          yield record;
          recordIndex++;
        }
        batch = await reader.readBatch(DEFAULT_BATCH_SIZE);
      }
    } finally {
      reader.close();
    }
  }
}

function* unpackBatch(batch: AlignmentBatch, startIndex: number): Iterable<AlignmentRecord> {
  const format = batch.format as "sam" | "bam";
  // napi Buffers are already Node Buffers — use directly without copying.
  const { qnameData, sequenceData, qualityData, cigarData, rnameData } = batch;

  for (let i = 0; i < batch.count; i++) {
    const seqStart = batch.sequenceOffsets[i]!;
    const seqEnd = batch.sequenceOffsets[i + 1]!;
    const qualStart = batch.qualityOffsets[i]!;
    const qualEnd = batch.qualityOffsets[i + 1]!;
    const qnameStart = batch.qnameOffsets[i]!;
    const qnameEnd = batch.qnameOffsets[i + 1]!;
    const cigarStart = batch.cigarOffsets[i]!;
    const cigarEnd = batch.cigarOffsets[i + 1]!;
    const rnameStart = batch.rnameOffsets[i]!;
    const rnameEnd = batch.rnameOffsets[i + 1]!;

    const sequence = GenotypeString.fromBytes(sequenceData.subarray(seqStart, seqEnd));

    yield {
      id: utf8_decoder.decode(qnameData.subarray(qnameStart, qnameEnd)),
      sequence,
      length: seqEnd - seqStart,
      lineNumber: startIndex + i,
      format,
      quality: GenotypeString.fromBytes(qualityData.subarray(qualStart, qualEnd)),
      qualityEncoding: "phred33" as const,
      flag: batch.flags[i]!,
      referenceSequence: utf8_decoder.decode(rnameData.subarray(rnameStart, rnameEnd)),
      position: batch.positions[i]!,
      mappingQuality: batch.mappingQualities[i]!,
      cigar: utf8_decoder.decode(cigarData.subarray(cigarStart, cigarEnd)),
    };
  }
}
