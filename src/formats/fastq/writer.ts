/**
 * FASTQ format writer backed by the Rust engine.
 *
 * Accumulates records into batches, delegates formatting and optional
 * gzip compression to the engine's FastqWriter.
 */

import { Effect } from "effect";
import { ParseError } from "../../errors";
import { BackendService, backendRuntime } from "../../backend/service";
import type { FastqBatch } from "../../backend/types";
import type { FastqSequence } from "../../types";

export class FastqWriter {
  private readonly compress: boolean;

  constructor(options?: { compress?: boolean }) {
    this.compress = options?.compress ?? false;
  }

  async writeFile(path: string, sequences: AsyncIterable<FastqSequence>): Promise<void> {
    const writer = await backendRuntime.runPromise(
      BackendService.use((b) => b.createFastqWriter(path, this.compress)).pipe(
        Effect.catchTag("BackendUnavailableError", (e) =>
          Effect.fail(new ParseError(`FASTQ writing requires a backend: ${e.message}`, "FASTQ"))
        )
      )
    );

    for await (const seq of sequences) {
      await writer.writeBatch(packFastqBatch([seq]));
    }
    await writer.finish();
  }

  async toBytes(sequences: AsyncIterable<FastqSequence>): Promise<Uint8Array> {
    const writer = await backendRuntime.runPromise(
      BackendService.use((b) => b.createFastqWriter(null, this.compress)).pipe(
        Effect.catchTag("BackendUnavailableError", (e) =>
          Effect.fail(new ParseError(`FASTQ writing requires a backend: ${e.message}`, "FASTQ"))
        )
      )
    );

    for await (const seq of sequences) {
      await writer.writeBatch(packFastqBatch([seq]));
    }
    const result = await writer.finish();
    return result ?? new Uint8Array(0);
  }

  formatSequence(seq: FastqSequence): string {
    const header = seq.description ? `@${seq.id} ${seq.description}` : `@${seq.id}`;
    return `${header}\n${seq.sequence}\n+\n${seq.quality}\n`;
  }
}

function packFastqBatch(sequences: FastqSequence[]): FastqBatch {
  const encoder = new TextEncoder();
  const nameChunks: Uint8Array[] = [];
  const descChunks: Uint8Array[] = [];
  const seqChunks: Uint8Array[] = [];
  const qualChunks: Uint8Array[] = [];
  const nameOffsets = [0];
  const descOffsets = [0];
  const seqOffsets = [0];
  const qualOffsets = [0];

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

    const qualBytes = seq.quality ? seq.quality.toBytes() : new Uint8Array(0);
    qualChunks.push(qualBytes);
    qualOffsets.push(qualOffsets[qualOffsets.length - 1]! + qualBytes.length);
  }

  return {
    count: sequences.length,
    nameData: concatUint8Arrays(nameChunks),
    nameOffsets: new Uint32Array(nameOffsets),
    descriptionData: concatUint8Arrays(descChunks),
    descriptionOffsets: new Uint32Array(descOffsets),
    sequenceData: concatUint8Arrays(seqChunks),
    sequenceOffsets: new Uint32Array(seqOffsets),
    qualityData: concatUint8Arrays(qualChunks),
    qualityOffsets: new Uint32Array(qualOffsets),
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
