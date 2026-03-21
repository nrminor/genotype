/**
 * FASTA format parser backed by noodles via the native/wasm engine.
 *
 * Treats FASTA as an input format that produces FastaSequence objects.
 * All parsing — including multi-line sequence handling and gzip
 * decompression — is delegated to the Rust noodles reader. The
 * TypeScript side unpacks batched results into FastaSequence objects.
 *
 * The reader is managed as an Effect scoped resource via acquireRelease.
 * Stream.paginate drives the batch-to-record loop, and
 * toAsyncIterableEffect bridges back to AsyncIterable at the public API.
 */

import { Effect, Option, Stream } from "effect";
import { GenotypeString } from "../genotype-string";
import type { FastaBatch, FastaReaderHandle } from "../backend/types";
import { BackendService, backendRuntime } from "../backend/service";
import { FileError, ParseError, SequenceError } from "../errors";
import { createFastaRecord } from "../constructors";
import type { FastaSequence, ParserOptions } from "../types";
import { AbstractParser } from "./abstract-parser";

const DEFAULT_BATCH_SIZE = 4096;
const utf8_decoder = new TextDecoder();

function fastaRecords(
  acquire: Effect.Effect<FastaReaderHandle, FileError | ParseError, BackendService>
): Stream.Stream<FastaSequence, FileError | ParseError, BackendService> {
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
            const records = [...unpackFastaBatch(batch, recordIndex)];
            return [records, Option.some(recordIndex + records.length)] as const;
          },
          catch: (e) =>
            new ParseError(
              `Failed to read FASTA batch: ${e instanceof Error ? e.message : String(e)}`,
              "FASTA"
            ),
        })
      );
    })
  );
}

function acquireFastaReaderFromPath(
  filePath: string
): Effect.Effect<FastaReaderHandle, FileError | ParseError, BackendService> {
  return BackendService.use((b) => b.createFastaReaderFromPath(filePath)).pipe(
    Effect.catchTags({
      BackendUnavailableError: (e) =>
        Effect.fail(
          new ParseError(`FASTA parsing requires a native or wasm backend: ${e.message}`, "FASTA")
        ),
      BackendIOError: (e) => Effect.fail(new FileError(e.message, filePath, "read")),
      BackendValidationError: (e) => Effect.fail(new ParseError(e.message, "FASTA")),
    })
  );
}

function acquireFastaReaderFromBytes(
  bytes: Uint8Array
): Effect.Effect<FastaReaderHandle, ParseError, BackendService> {
  return BackendService.use((b) => b.createFastaReaderFromBytes(bytes)).pipe(
    Effect.catchTags({
      BackendUnavailableError: (e) =>
        Effect.fail(
          new ParseError(`FASTA parsing requires a native or wasm backend: ${e.message}`, "FASTA")
        ),
      BackendIOError: (e) => Effect.fail(new ParseError(e.message, "FASTA")),
      BackendValidationError: (e) => Effect.fail(new ParseError(e.message, "FASTA")),
    })
  );
}

/**
 * Parser for FASTA sequence files.
 *
 * Delegates all parsing to the Rust noodles-fasta reader, which handles
 * multi-line sequences and gzip-compressed input transparently.
 *
 * @example Basic usage
 * ```typescript
 * const parser = new FastaParser();
 * for await (const seq of parser.parseFile("genome.fasta")) {
 *   console.log(`${seq.id}: ${seq.length} bp`);
 * }
 * ```
 *
 * @example With seqops pipeline
 * ```typescript
 * const results = await seqops(new FastaParser().parseFile("genome.fasta"))
 *   .filter({ minLength: 100 })
 *   .collect();
 * ```
 */
export class FastaParser extends AbstractParser<FastaSequence> {
  protected getDefaultOptions(): Partial<ParserOptions> {
    return {};
  }

  protected getFormatName(): string {
    return "FASTA";
  }

  async *parseFile(filePath: string): AsyncIterable<FastaSequence> {
    yield* await backendRuntime.runPromise(
      Stream.toAsyncIterableEffect(fastaRecords(acquireFastaReaderFromPath(filePath)))
    );
  }

  async *parseString(data: string): AsyncIterable<FastaSequence> {
    const bytes = new TextEncoder().encode(data);
    yield* await backendRuntime.runPromise(
      Stream.toAsyncIterableEffect(fastaRecords(acquireFastaReaderFromBytes(bytes)))
    );
  }

  async *parse(stream: ReadableStream<Uint8Array>): AsyncIterable<FastaSequence> {
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
      Stream.toAsyncIterableEffect(fastaRecords(acquireFastaReaderFromBytes(combined)))
    );
  }
}

function* unpackFastaBatch(batch: FastaBatch, _startIndex: number): Iterable<FastaSequence> {
  for (let i = 0; i < batch.count; i++) {
    const nameStart = batch.nameOffsets[i]!;
    const nameEnd = batch.nameOffsets[i + 1]!;
    const descStart = batch.descriptionOffsets[i]!;
    const descEnd = batch.descriptionOffsets[i + 1]!;
    const seqStart = batch.sequenceOffsets[i]!;
    const seqEnd = batch.sequenceOffsets[i + 1]!;

    const id = utf8_decoder.decode(batch.nameData.subarray(nameStart, nameEnd));
    const description =
      descEnd > descStart
        ? utf8_decoder.decode(batch.descriptionData.subarray(descStart, descEnd))
        : undefined;
    const sequence = GenotypeString.fromBytes(batch.sequenceData.subarray(seqStart, seqEnd));

    yield createFastaRecord({
      id,
      sequence: sequence.toString(),
      description,
    });
  }
}

/**
 * FASTA format writer backed by the Rust engine.
 *
 * Accumulates records into batches, delegates formatting and optional
 * gzip compression to the engine's FastaWriter. The writer handle is
 * managed as an Effect scoped resource via acquireRelease.
 */
export class FastaWriter {
  private readonly lineWidth: number;
  private readonly compress: boolean;

  constructor(options?: { lineWidth?: number; compress?: boolean }) {
    this.lineWidth = options?.lineWidth ?? 80;
    this.compress = options?.compress ?? false;
  }

  async writeFile(path: string, sequences: AsyncIterable<FastaSequence>): Promise<void> {
    const writer = await backendRuntime.runPromise(
      BackendService.use((b) => b.createFastaWriter(path, this.compress, this.lineWidth)).pipe(
        Effect.catchTag("BackendUnavailableError", (e) =>
          Effect.fail(new ParseError(`FASTA writing requires a backend: ${e.message}`, "FASTA"))
        )
      )
    );

    for await (const seq of sequences) {
      await writer.writeBatch(packFastaBatch([seq]));
    }
    await writer.finish();
  }

  async toBytes(sequences: AsyncIterable<FastaSequence>): Promise<Uint8Array> {
    const writer = await backendRuntime.runPromise(
      BackendService.use((b) => b.createFastaWriter(null, this.compress, this.lineWidth)).pipe(
        Effect.catchTag("BackendUnavailableError", (e) =>
          Effect.fail(new ParseError(`FASTA writing requires a backend: ${e.message}`, "FASTA"))
        )
      )
    );

    for await (const seq of sequences) {
      await writer.writeBatch(packFastaBatch([seq]));
    }
    const result = await writer.finish();
    return result ?? new Uint8Array(0);
  }

  formatSequence(seq: FastaSequence): string {
    const header = seq.description ? `>${seq.id} ${seq.description}` : `>${seq.id}`;
    const seqStr = seq.sequence.toString();
    if (this.lineWidth <= 0 || seqStr.length <= this.lineWidth) {
      return `${header}\n${seqStr}\n`;
    }
    const lines = [header];
    for (let i = 0; i < seqStr.length; i += this.lineWidth) {
      lines.push(seqStr.slice(i, i + this.lineWidth));
    }
    return lines.join("\n") + "\n";
  }
}

function packFastaBatch(sequences: FastaSequence[]): FastaBatch {
  const encoder = new TextEncoder();
  const nameChunks: Uint8Array[] = [];
  const descChunks: Uint8Array[] = [];
  const seqChunks: Uint8Array[] = [];
  const nameOffsets = [0];
  const descOffsets = [0];
  const seqOffsets = [0];

  for (const seq of sequences) {
    const name = encoder.encode(seq.id);
    nameChunks.push(name);
    nameOffsets.push(nameOffsets[nameOffsets.length - 1]! + name.length);

    const desc = seq.description ? encoder.encode(seq.description) : new Uint8Array(0);
    descChunks.push(desc);
    descOffsets.push(descOffsets[descOffsets.length - 1]! + desc.length);

    const seqBytes = seq.sequence.toBytes();
    seqChunks.push(seqBytes);
    seqOffsets.push(seqOffsets[seqOffsets.length - 1]! + seqBytes.length);
  }

  return {
    count: sequences.length,
    nameData: concatUint8Arrays(nameChunks),
    nameOffsets: new Uint32Array(nameOffsets),
    descriptionData: concatUint8Arrays(descChunks),
    descriptionOffsets: new Uint32Array(descOffsets),
    sequenceData: concatUint8Arrays(seqChunks),
    sequenceOffsets: new Uint32Array(seqOffsets),
  };
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Validate and clean a FASTA/FASTQ sequence string.
 */
export function validateFastaSequence(
  sequence: string,
  _lineNumber?: number,
  _options?: { skipValidation?: boolean; maxLineLength?: number }
): string {
  const cleaned = sequence.replace(/\s/g, "");
  if (cleaned.length > 0 && !/^[A-Za-z\-.*]+$/.test(cleaned)) {
    throw new SequenceError(`Invalid sequence characters in: ${cleaned.slice(0, 20)}...`);
  }
  return cleaned;
}

export const FastaUtils = {
  validateSequence: validateFastaSequence,
  formatSequence: (seq: FastaSequence, lineWidth = 80): string =>
    new FastaWriter({ lineWidth }).formatSequence(seq),
} as const;
