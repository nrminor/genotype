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
 *
 * The alignment reader is managed as an Effect scoped resource via
 * acquireRelease. When consumed through the AsyncIterable interface,
 * the reader's close() finalizer runs automatically when the consumer
 * stops iterating — whether by exhaustion, early break, or error.
 */

import { Effect, Option, Stream } from "effect";
import { GenotypeString } from "../genotype-string";
import type { AlignmentBatch, AlignmentReaderHandle } from "../backend";
import { BackendService, backendRuntime } from "../backend/service";
import { BamError } from "../errors";
import type { AlignmentRecord, ParserOptions } from "../types";
import { AbstractParser } from "./abstract-parser";

const DEFAULT_BATCH_SIZE = 4096;
const utf8_decoder = new TextDecoder();

/**
 * Build an Effect-managed stream of AlignmentRecords from a scoped reader.
 *
 * The reader is acquired via acquireRelease so its close() finalizer is
 * guaranteed to run when the stream finishes, whether by exhaustion,
 * early termination, or error. The stream pulls batches from the native
 * reader and flattens them into individual records.
 */
function alignmentRecords(
  acquire: Effect.Effect<AlignmentReaderHandle, BamError, BackendService>
): Stream.Stream<AlignmentRecord, BamError, BackendService> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const reader = yield* Effect.acquireRelease(acquire, (r) => Effect.sync(() => r.close()));

      return Stream.paginate(0 as number, (recordIndex) =>
        Effect.tryPromise({
          try: async () => {
            const batch = await reader.readBatch(DEFAULT_BATCH_SIZE);
            if (batch === null) {
              return [[], Option.none<number>()] as const;
            }
            const records = [...unpackBatch(batch, recordIndex)];
            return [records, Option.some(recordIndex + records.length)] as const;
          },
          catch: (e) =>
            new BamError(
              `Failed to read alignment batch: ${e instanceof Error ? e.message : String(e)}`
            ),
        })
      );
    })
  );
}

/**
 * Translate a BackendService reader acquisition into a BamError on failure.
 */
function acquireReaderFromPath(
  filePath: string
): Effect.Effect<AlignmentReaderHandle, BamError, BackendService> {
  return BackendService.use((b) => b.createAlignmentReaderFromPath(filePath)).pipe(
    Effect.catchTag("BackendUnavailableError", (e) =>
      Effect.fail(new BamError(`BAM/SAM parsing requires a native or wasm backend: ${e.message}`))
    )
  );
}

/**
 * Translate a BackendService reader acquisition from bytes into a BamError on failure.
 */
function acquireReaderFromBytes(
  bytes: Uint8Array
): Effect.Effect<AlignmentReaderHandle, BamError, BackendService> {
  return BackendService.use((b) => b.createAlignmentReaderFromBytes(bytes)).pipe(
    Effect.catchTag("BackendUnavailableError", (e) =>
      Effect.fail(new BamError(`BAM/SAM parsing requires a native or wasm backend: ${e.message}`))
    )
  );
}

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
    yield* await backendRuntime.runPromise(
      Stream.toAsyncIterableEffect(alignmentRecords(acquireReaderFromPath(filePath)))
    );
  }

  async *parseString(data: string): AsyncIterable<AlignmentRecord> {
    const bytes = new Uint8Array(Buffer.from(data, "utf8"));
    yield* await backendRuntime.runPromise(
      Stream.toAsyncIterableEffect(alignmentRecords(acquireReaderFromBytes(bytes)))
    );
  }

  async *parse(stream: ReadableStream<Uint8Array>): AsyncIterable<AlignmentRecord> {
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
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    yield* await backendRuntime.runPromise(
      Stream.toAsyncIterableEffect(alignmentRecords(acquireReaderFromBytes(combined)))
    );
  }
}

function* unpackBatch(batch: AlignmentBatch, startIndex: number): Iterable<AlignmentRecord> {
  const format = batch.format as "sam" | "bam";
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
