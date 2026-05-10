/**
 * Typed paired-read streams.
 *
 * This module converts scalar sequence streams into checked streams of read
 * pairs. It intentionally yields complete pairs only; unpaired reads are
 * handled at the pairing boundary according to PairOptions.
 */

import { MemoryError, PairSyncError } from "@genotype/core/errors";
import { defaultExtractPairId } from "@genotype/core/formats/fastq/paired";
import type { AbstractSequence } from "@genotype/core/types";
import type { PairOptions } from "./pair";

export interface ReadPair<T extends AbstractSequence> {
  readonly id: string;
  readonly r1: T;
  readonly r2: T;
}

export type PairStreamMode<T extends AbstractSequence> =
  | {
      readonly mode: "dual";
      readonly source1: AsyncIterable<T>;
      readonly source2: AsyncIterable<T>;
    }
  | { readonly mode: "single"; readonly source: AsyncIterable<T> };

interface NormalizedPairOptions {
  readonly extractPairId: (id: string) => string;
  readonly maxBufferSize: number;
  readonly onUnpaired: "warn" | "skip" | "error";
}

export class PairStreamProcessor {
  async *process<T extends AbstractSequence>(
    config: PairStreamMode<T>,
    options: PairOptions = {}
  ): AsyncIterable<ReadPair<T>> {
    const settings = normalizePairOptions(options);

    switch (config.mode) {
      case "dual":
        yield* pairDualStream(config.source1, config.source2, settings);
        break;
      case "single":
        yield* pairSingleStream(config.source, settings);
        break;
    }
  }
}

function normalizePairOptions(options: PairOptions): NormalizedPairOptions {
  const maxBufferSize = options.maxBufferSize ?? 100000;
  if (maxBufferSize <= 0) {
    throw new MemoryError(`Invalid maxBufferSize: ${maxBufferSize}. Must be greater than 0.`);
  }

  return {
    extractPairId: options.extractPairId ?? defaultExtractPairId,
    maxBufferSize,
    onUnpaired: options.onUnpaired ?? "warn",
  };
}

async function* pairDualStream<T extends AbstractSequence>(
  source1: AsyncIterable<T>,
  source2: AsyncIterable<T>,
  options: NormalizedPairOptions
): AsyncIterable<ReadPair<T>> {
  const buffer1 = new Map<string, T>();
  const buffer2 = new Map<string, T>();
  let warned = false;
  const iter1 = source1[Symbol.asyncIterator]();
  const iter2 = source2[Symbol.asyncIterator]();

  while (true) {
    const [next1, next2] = await Promise.all([iter1.next(), iter2.next()]);
    if (next1.done === true && next2.done === true) break;

    if (next1.done !== true) {
      const r1 = next1.value;
      const id = options.extractPairId(r1.id);
      const r2 = buffer2.get(id);
      if (r2 !== undefined) {
        buffer2.delete(id);
        yield makePair(id, r1, r2, options.extractPairId);
      } else {
        buffer1.set(id, r1);
        warned = checkBufferSize(buffer1, buffer2, options.maxBufferSize, warned);
      }
    }

    if (next2.done !== true) {
      const r2 = next2.value;
      const id = options.extractPairId(r2.id);
      const r1 = buffer1.get(id);
      if (r1 !== undefined) {
        buffer1.delete(id);
        yield makePair(id, r1, r2, options.extractPairId);
      } else {
        buffer2.set(id, r2);
        warned = checkBufferSize(buffer1, buffer2, options.maxBufferSize, warned);
      }
    }
  }

  for (const [id, r1] of buffer1) {
    const r2 = buffer2.get(id);
    if (r2 !== undefined) {
      buffer2.delete(id);
      yield makePair(id, r1, r2, options.extractPairId);
    } else {
      handleUnpaired(r1, options.onUnpaired);
    }
  }

  for (const [, r2] of buffer2) {
    handleUnpaired(r2, options.onUnpaired);
  }
}

async function* pairSingleStream<T extends AbstractSequence>(
  source: AsyncIterable<T>,
  options: NormalizedPairOptions
): AsyncIterable<ReadPair<T>> {
  const buffer1 = new Map<string, T>();
  const buffer2 = new Map<string, T>();
  let warned = false;

  for await (const read of source) {
    const id = options.extractPairId(read.id);
    const readType = readTypeFor(read.id, id, buffer1, buffer2);

    if (readType === "r1") {
      const r2 = buffer2.get(id);
      if (r2 !== undefined) {
        buffer2.delete(id);
        yield makePair(id, read, r2, options.extractPairId);
      } else {
        buffer1.set(id, read);
        warned = checkBufferSize(buffer1, buffer2, options.maxBufferSize, warned);
      }
    } else {
      const r1 = buffer1.get(id);
      if (r1 !== undefined) {
        buffer1.delete(id);
        yield makePair(id, r1, read, options.extractPairId);
      } else {
        buffer2.set(id, read);
        warned = checkBufferSize(buffer1, buffer2, options.maxBufferSize, warned);
      }
    }
  }

  for (const [id, r1] of buffer1) {
    const r2 = buffer2.get(id);
    if (r2 !== undefined) {
      buffer2.delete(id);
      yield makePair(id, r1, r2, options.extractPairId);
    } else {
      handleUnpaired(r1, options.onUnpaired);
    }
  }

  for (const [, r2] of buffer2) {
    handleUnpaired(r2, options.onUnpaired);
  }
}

function makePair<T extends AbstractSequence>(
  id: string,
  r1: T,
  r2: T,
  extractPairId: (id: string) => string
): ReadPair<T> {
  const r2Id = extractPairId(r2.id);
  if (id !== r2Id) {
    throw new PairSyncError(
      `Read pair IDs do not match after normalization: ${id} vs ${r2Id}`,
      -1,
      "both"
    );
  }
  return { id, r1, r2 };
}

function readTypeFor<T extends AbstractSequence>(
  rawId: string,
  normalizedId: string,
  r1Buffer: Map<string, T>,
  r2Buffer: Map<string, T>
): "r1" | "r2" {
  if (/[/._](?:[Rr]?1)$/.test(rawId)) return "r1";
  if (/[/._](?:[Rr]?2)$/.test(rawId)) return "r2";
  if (r1Buffer.has(normalizedId)) return "r2";
  if (r2Buffer.has(normalizedId)) return "r1";
  return "r1";
}

function checkBufferSize<T extends AbstractSequence>(
  buffer1: Map<string, T>,
  buffer2: Map<string, T>,
  maxBufferSize: number,
  warned: boolean
): boolean {
  const total = buffer1.size + buffer2.size;
  if (total > maxBufferSize) {
    throw new MemoryError(
      `Pair buffer exceeded maximum size of ${maxBufferSize} reads`,
      "Increase maxBufferSize or pre-sort reads by normalized pair ID."
    );
  }
  if (total > maxBufferSize * 0.8 && !warned) {
    console.warn(
      `⚠️  Pair buffer at ${total}/${maxBufferSize} reads (${Math.round((total / maxBufferSize) * 100)}%)`
    );
    return true;
  }
  return warned;
}

function handleUnpaired<T extends AbstractSequence>(
  read: T,
  policy: "warn" | "skip" | "error"
): void {
  switch (policy) {
    case "warn":
      console.warn(`⚠️  Unpaired read: ${read.id}`);
      break;
    case "skip":
      break;
    case "error":
      throw PairSyncError.forUnpairedRead(read.id);
  }
}
