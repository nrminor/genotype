/**
 * Batch packing and hash extraction utilities.
 *
 * These functions prepare data for kernel consumption (packing sequences
 * into the contiguous byte layout kernels expect) and extract results
 * from kernel output (reading hashes from the hashBatch buffer). They
 * are backend-neutral: the same packing format is used regardless of
 * whether the kernel runs via napi, wasm, or a pure-TypeScript fallback.
 */

import type { AbstractSequence, QualityScoreBearing } from "../types";

/**
 * The result of packing an array of sequences into the batch layout
 * expected by kernel functions.
 */
export interface PackedBatch {
  /** Concatenated sequence bytes, contiguous in a single Buffer. */
  data: Buffer;
  /** N+1 offset array where offsets[i] is the byte position where sequence i starts. */
  offsets: Uint32Array;
}

/**
 * Pack an array of sequences into the contiguous batch layout that
 * kernel functions expect: a single `Buffer` of concatenated sequence
 * bytes and a `Uint32Array` of N+1 offsets.
 *
 * This is shared infrastructure for all accelerated operations.
 *
 * @param sequences - The sequences to pack
 * @returns The packed batch layout
 */
export function packSequences(sequences: readonly AbstractSequence[]): PackedBatch {
  const count = sequences.length;
  const offsets = new Uint32Array(count + 1);

  const chunks: Uint8Array[] = new Array(count);
  let totalBytes = 0;
  for (let i = 0; i < count; i++) {
    const bytes = sequences[i]!.sequence.toBytes();
    chunks[i] = bytes;
    offsets[i] = totalBytes;
    totalBytes += bytes.length;
  }
  offsets[count] = totalBytes;

  const data = Buffer.allocUnsafe(totalBytes);
  for (let i = 0; i < count; i++) {
    data.set(chunks[i]!, offsets[i]!);
  }

  return { data, offsets };
}

/**
 * Pack the quality strings from an array of sequences with quality
 * scores into the contiguous batch layout that kernel functions expect.
 *
 * Parallel to {@link packSequences} but reads `.quality` instead of
 * `.sequence`. Returns the same `PackedBatch` shape.
 *
 * @param sequences - Sequences with quality scores to pack
 * @returns The packed batch layout
 */
export function packQualityStrings(sequences: readonly QualityScoreBearing[]): PackedBatch {
  const count = sequences.length;
  const offsets = new Uint32Array(count + 1);

  const chunks: Uint8Array[] = new Array(count);
  let totalBytes = 0;
  for (let i = 0; i < count; i++) {
    const bytes = sequences[i]!.quality.toBytes();
    chunks[i] = bytes;
    offsets[i] = totalBytes;
    totalBytes += bytes.length;
  }
  offsets[count] = totalBytes;

  const data = Buffer.allocUnsafe(totalBytes);
  for (let i = 0; i < count; i++) {
    data.set(chunks[i]!, offsets[i]!);
  }

  return { data, offsets };
}

/**
 * Pack an array of raw strings into the contiguous batch layout that
 * kernel functions expect.
 *
 * Unlike {@link packSequences} which reads `.sequence` from
 * `AbstractSequence` objects, this packs arbitrary strings — useful
 * for packing windowed subsequences that have already been sliced
 * in TypeScript.
 *
 * @param strings - The strings to pack (encoded as latin1 bytes)
 * @returns The packed batch layout
 */
export function packStrings(strings: readonly string[]): PackedBatch {
  const count = strings.length;
  const offsets = new Uint32Array(count + 1);

  const chunks: Uint8Array[] = new Array(count);
  let totalBytes = 0;
  for (let i = 0; i < count; i++) {
    const bytes = Buffer.from(strings[i]!, "latin1");
    chunks[i] = bytes;
    offsets[i] = totalBytes;
    totalBytes += bytes.length;
  }
  offsets[count] = totalBytes;

  const data = Buffer.allocUnsafe(totalBytes);
  for (let i = 0; i < count; i++) {
    data.set(chunks[i]!, offsets[i]!);
  }

  return { data, offsets };
}

/** Number of bytes per hash in the `hashBatch` output buffer. */
export const HASH_BYTES = 16;

/**
 * Extract a hex string key from the `hashBatch` output buffer for
 * use as a `Map` or `Set` key.
 *
 * Each 128-bit hash occupies 16 bytes in the buffer. This function
 * reads those bytes and returns a 32-character lowercase hex string.
 * The hex encoding is a modest cost compared to the string
 * materialization it replaces, and it produces a fixed-length key
 * that works well with V8's string interning.
 *
 * @param hashBuffer - The raw buffer returned by `hashBatch`
 * @param index - Which sequence's hash to extract (0-based)
 * @returns 32-character hex string suitable for Map/Set keys
 */
export function extractHashKey(hashBuffer: Buffer, index: number): string {
  const offset = index * HASH_BYTES;
  if (offset + HASH_BYTES > hashBuffer.length) {
    throw new RangeError(
      `extractHashKey: index ${index} out of bounds (buffer has ${Math.floor(hashBuffer.length / HASH_BYTES)} hashes)`
    );
  }
  return hashBuffer.subarray(offset, offset + HASH_BYTES).toString("hex");
}

/**
 * Read the two 64-bit halves of a 128-bit hash from the `hashBatch`
 * output buffer as BigInts.
 *
 * This is the raw form needed for the double-hashing bloom filter
 * probe scheme: `probe_i = (h1 + i * h2) % numBits`. Callers that
 * need bloom filter integration should use this rather than the hex
 * string form.
 *
 * @param hashBuffer - The raw buffer returned by `hashBatch`
 * @param index - Which sequence's hash to extract (0-based)
 * @returns Tuple of [low64, high64] as BigInts
 */
export function extractHashPair(hashBuffer: Buffer, index: number): [bigint, bigint] {
  const offset = index * HASH_BYTES;
  if (offset + HASH_BYTES > hashBuffer.length) {
    throw new RangeError(
      `extractHashPair: index ${index} out of bounds (buffer has ${Math.floor(hashBuffer.length / HASH_BYTES)} hashes)`
    );
  }
  const lo = hashBuffer.readBigUInt64LE(offset);
  const hi = hashBuffer.readBigUInt64LE(offset + 8);
  return [lo, hi];
}
