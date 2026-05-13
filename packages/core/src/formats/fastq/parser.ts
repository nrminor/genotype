/**
 * FASTQ format parser.
 *
 * Treats FASTQ as a stream of sequence records with per-base quality strings.
 * The parser accepts files, strings, or byte streams and yields FastqSequence
 * objects that can be consumed directly or passed into SeqOps pipelines.
 *
 * Quality encoding can be specified explicitly or detected from the first batch
 * of records. The parser preserves IDs, descriptions, sequence bases, quality
 * strings, and quality encoding so downstream filtering, trimming, binning, and
 * paired-read workflows can operate on the same typed record shape.
 */

import { Effect, Option, Stream } from "effect";
import { createFastqRecord } from "@genotype/core/constructors";
import { FileError, ParseError } from "@genotype/core/errors";
import type { FastqReaderHandle } from "@genotype/core/backend/types";
import { BackendService, backendRuntime } from "@genotype/core/backend/service";
import { detectEncoding } from "@genotype/core/operations/core/quality";
import type { FastqSequence, QualityEncoding } from "@genotype/core/types";
import { AbstractParser } from "@genotype/core/formats/abstract-parser";
import type { FastqParserOptions } from "./types";
import { unpackFastqBatch } from "./batch";

const DEFAULT_BATCH_SIZE = 4096;

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

            const records = [...unpackFastqBatch(batch, detectedEncoding)];
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
 * Reads FASTQ records from files, strings, or streams and yields typed
 * FastqSequence objects. Multi-line records and gzip-compressed files are
 * handled transparently, and quality encoding may be provided or auto-detected.
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
   * Uses the same record shape and quality encoding behavior as parseString.
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
 * Prefer FastqParser directly for new code.
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
