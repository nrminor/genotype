/**
 * FASTQ format writer backed by the Rust engine.
 *
 * Accumulates records into batches, delegates formatting and optional
 * gzip compression to the engine's FastqWriter.
 */

import { Effect } from "effect";
import { ParseError } from "@genotype/core/errors";
import { BackendService, backendRuntime } from "@genotype/core/backend/service";
import type { FastqSequence } from "@genotype/core/types";
import { packFastqBatch } from "./batch";

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
