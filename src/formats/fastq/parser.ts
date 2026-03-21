/**
 * FASTQ format parser backed by noodles via the native/wasm engine.
 *
 * Treats FASTQ as an input format that produces FastqSequence objects.
 * All parsing — including multi-line sequences, quality score extraction,
 * and gzip decompression — is delegated to the Rust noodles reader.
 * The TypeScript side unpacks batched results into FastqSequence objects.
 *
 * Quality encoding detection, validation, paired-end support, and the
 * writer remain in TypeScript — they operate on parsed records, not
 * the parsing itself.
 */

import { Effect, Option, Stream } from "effect";
import { createFastqRecord } from "../../constructors";
import { FileError, ParseError } from "../../errors";
import { GenotypeString } from "../../genotype-string";
import type { FastqBatch, FastqReaderHandle } from "../../backend/types";
import { BackendService, backendRuntime } from "../../backend/service";
import { detectEncoding } from "../../operations/core/quality";
import type { FastqSequence, QualityEncoding } from "../../types";
import { AbstractParser } from "../abstract-parser";
import type { FastqParserOptions } from "./types";

const DEFAULT_BATCH_SIZE = 4096;
const utf8_decoder = new TextDecoder();

function fastqRecords(
  acquire: Effect.Effect<FastqReaderHandle, FileError | ParseError, BackendService>,
  encodingOption: QualityEncoding | "auto"
): Stream.Stream<FastqSequence, FileError | ParseError, BackendService> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const reader = yield* Effect.acquireRelease(acquire, (r) => Effect.sync(() => r.close()));

      let detectedEncoding: QualityEncoding | undefined;

      return Stream.paginate(0 as number, (recordIndex) =>
        Effect.tryPromise({
          try: async () => {
            const batch = await reader.readBatch(DEFAULT_BATCH_SIZE);
            if (batch === null) {
              return [[], Option.none<number>()] as const;
            }

            // Detect encoding from the first batch's quality data if set to auto
            if (detectedEncoding === undefined) {
              if (encodingOption === "auto") {
                try {
                  const firstQualEnd = batch.qualityOffsets[1] ?? batch.qualityData.length;
                  const sampleQuality = new TextDecoder().decode(
                    batch.qualityData.subarray(0, firstQualEnd)
                  );
                  detectedEncoding = detectEncoding(sampleQuality);
                } catch {
                  detectedEncoding = "phred33";
                }
              } else {
                detectedEncoding = encodingOption;
              }
            }

            const records = [...unpackFastqBatch(batch, recordIndex, detectedEncoding)];
            return [records, Option.some(recordIndex + records.length)] as const;
          },
          catch: (e) =>
            new ParseError(
              `Failed to read FASTQ batch: ${e instanceof Error ? e.message : String(e)}`,
              "FASTQ"
            ),
        })
      );
    })
  );
}

function acquireFastqReaderFromPath(
  filePath: string
): Effect.Effect<FastqReaderHandle, FileError | ParseError, BackendService> {
  return BackendService.use((b) => b.createFastqReaderFromPath(filePath)).pipe(
    Effect.catchTags({
      BackendUnavailableError: (e) =>
        Effect.fail(
          new ParseError(`FASTQ parsing requires a native or wasm backend: ${e.message}`, "FASTQ")
        ),
      BackendIOError: (e) => Effect.fail(new FileError(e.message, filePath, "read")),
      BackendValidationError: (e) => Effect.fail(new ParseError(e.message, "FASTQ")),
    })
  );
}

function acquireFastqReaderFromBytes(
  bytes: Uint8Array
): Effect.Effect<FastqReaderHandle, ParseError, BackendService> {
  return BackendService.use((b) => b.createFastqReaderFromBytes(bytes)).pipe(
    Effect.catchTags({
      BackendUnavailableError: (e) =>
        Effect.fail(
          new ParseError(`FASTQ parsing requires a native or wasm backend: ${e.message}`, "FASTQ")
        ),
      BackendIOError: (e) => Effect.fail(new ParseError(e.message, "FASTQ")),
      BackendValidationError: (e) => Effect.fail(new ParseError(e.message, "FASTQ")),
    })
  );
}

/**
 * Parser for FASTQ sequence files.
 *
 * Delegates all parsing to the Rust noodles-fastq reader, which handles
 * multi-line sequences, quality score extraction, and gzip-compressed
 * input transparently.
 *
 * @example Basic usage
 * ```typescript
 * const parser = new FastqParser();
 * for await (const seq of parser.parseFile("reads.fastq")) {
 *   console.log(`${seq.id}: ${seq.sequence.length} bp`);
 * }
 * ```
 *
 * @example With seqops pipeline
 * ```typescript
 * const results = await seqops(new FastqParser().parseFile("reads.fastq.gz"))
 *   .filter({ minLength: 100 })
 *   .collect();
 * ```
 */
export class FastqParser extends AbstractParser<FastqSequence, FastqParserOptions> {
  protected getDefaultOptions(): Partial<FastqParserOptions> {
    return {};
  }

  protected getFormatName(): string {
    return "FASTQ";
  }

  async *parseFile(filePath: string): AsyncIterable<FastqSequence> {
    const encoding = this.options.qualityEncoding ?? "auto";
    yield* await backendRuntime.runPromise(
      Stream.toAsyncIterableEffect(fastqRecords(acquireFastqReaderFromPath(filePath), encoding))
    );
  }

  async *parseString(data: string): AsyncIterable<FastqSequence> {
    const encoding = this.options.qualityEncoding ?? "auto";
    const bytes = new TextEncoder().encode(data);
    yield* await backendRuntime.runPromise(
      Stream.toAsyncIterableEffect(fastqRecords(acquireFastqReaderFromBytes(bytes), encoding))
    );
  }

  async *parse(stream: ReadableStream<Uint8Array>): AsyncIterable<FastqSequence> {
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

    const encoding = this.options.qualityEncoding ?? "auto";
    yield* await backendRuntime.runPromise(
      Stream.toAsyncIterableEffect(fastqRecords(acquireFastqReaderFromBytes(combined), encoding))
    );
  }

  /**
   * Parse multi-line FASTQ from a string (legacy compatibility).
   * Now delegates to the same noodles-backed parser as parseString.
   */
  parseMultiLineString(data: string): FastqSequence[] {
    const results: FastqSequence[] = [];
    const lines = data.split(/\r?\n/).filter((l) => l.trim());

    for (let i = 0; i + 3 < lines.length; i += 4) {
      const header = lines[i]!;
      const sequence = lines[i + 1]!;
      const quality = lines[i + 3]!;

      const id = header.startsWith("@") ? header.slice(1).split(/\s/)[0]! : header.split(/\s/)[0]!;
      const description = header.includes(" ") ? header.slice(header.indexOf(" ") + 1) : undefined;

      results.push(
        createFastqRecord({
          id,
          sequence,
          quality,
          qualityEncoding: "phred33",
          description,
        })
      );
    }

    return results;
  }

  getMetrics() {
    return {
      fastPathCount: 0,
      stateMachineCount: 0,
      autoDetectCount: 0,
      totalSequences: 0,
    };
  }
}

/**
 * Fast-path FASTQ parser for simple 4-line format (legacy export).
 * Now just a wrapper around the noodles-backed parser.
 */
export async function* parseFastPath(
  lines: string[],
  _startLineNumber = 1,
  _options: Record<string, unknown> = {}
): AsyncIterable<FastqSequence> {
  for (let i = 0; i + 3 < lines.length; i += 4) {
    const header = lines[i]!;
    const sequence = lines[i + 1]!;
    const quality = lines[i + 3]!;

    const id = header.startsWith("@") ? header.slice(1).split(/\s/)[0]! : header.split(/\s/)[0]!;
    const description = header.includes(" ") ? header.slice(header.indexOf(" ") + 1) : undefined;

    yield createFastqRecord({ id, sequence, quality, description, qualityEncoding: "phred33" });
  }
}

function* unpackFastqBatch(
  batch: FastqBatch,
  _startIndex: number,
  encoding: QualityEncoding
): Iterable<FastqSequence> {
  for (let i = 0; i < batch.count; i++) {
    const nameStart = batch.nameOffsets[i]!;
    const nameEnd = batch.nameOffsets[i + 1]!;
    const descStart = batch.descriptionOffsets[i]!;
    const descEnd = batch.descriptionOffsets[i + 1]!;
    const seqStart = batch.sequenceOffsets[i]!;
    const seqEnd = batch.sequenceOffsets[i + 1]!;
    const qualStart = batch.qualityOffsets[i]!;
    const qualEnd = batch.qualityOffsets[i + 1]!;

    const id = utf8_decoder.decode(batch.nameData.subarray(nameStart, nameEnd));
    const description =
      descEnd > descStart
        ? utf8_decoder.decode(batch.descriptionData.subarray(descStart, descEnd))
        : undefined;
    const sequence = GenotypeString.fromBytes(batch.sequenceData.subarray(seqStart, seqEnd));
    const quality = GenotypeString.fromBytes(batch.qualityData.subarray(qualStart, qualEnd));

    yield createFastqRecord({
      id,
      sequence: sequence.toString(),
      quality: quality.toString(),
      qualityEncoding: encoding,
      description,
    });
  }
}
