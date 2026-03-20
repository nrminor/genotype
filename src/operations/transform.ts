/**
 * TransformProcessor - Modify sequence content
 *
 * Delegates to the native SIMD-accelerated transform kernel for batch
 * processing. Sequences are accumulated into batches by byte budget,
 * packed into the contiguous layout the Rust kernel expects, and
 * transformed in one or more chained kernel calls. The custom callback
 * escape hatch applies per-sequence after all kernel ops complete.
 */

import { withSequence } from "../constructors";
import { getBackend } from "../backend";
import { GenotypeError } from "../errors";
import { GenotypeString } from "../genotype-string";
import { packSequences } from "../backend/batch";
import { TransformOp } from "../backend/kernel-types";
import type { AbstractSequence, AlignmentRecord } from "../types";
import type { AlignmentTransformOptions, Processor, TransformOptions } from "./types";

/** Byte budget per native batch. Sequences accumulate until this threshold. */
const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

/**
 * Processor for transforming sequence content
 *
 * @example
 * ```typescript
 * const processor = new TransformProcessor();
 * const transformed = processor.process(sequences, {
 *   reverseComplement: true,
 *   upperCase: true
 * });
 * ```
 */
export class TransformProcessor implements Processor<TransformOptions> {
  /**
   * Process sequences with transformations
   *
   * @param source - Input sequences
   * @param options - Transform options
   * @yields Transformed sequences
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: TransformOptions & Partial<AlignmentTransformOptions>
  ): AsyncIterable<AbstractSequence> {
    const ops = buildOpList(options);
    const needsTrimSoftClips = options.trimSoftClips === true;

    // No kernel ops, no custom callback, no soft-clip trimming — pass through unchanged.
    if (ops.length === 0 && options.custom === undefined && !needsTrimSoftClips) {
      yield* source;
      return;
    }

    // No kernel ops — apply custom callback and/or soft-clip trimming per-sequence.
    if (ops.length === 0) {
      for await (const seq of source) {
        let result = seq;
        if (options.custom !== undefined) {
          result = withSequence(result, options.custom(result.sequence.toString()));
        }
        if (needsTrimSoftClips) {
          result = applySoftClipTrim(result);
        }
        yield result;
      }
      return;
    }

    const backend = await getBackend();
    if (backend.transformBatch === undefined) {
      throw new GenotypeError(
        "Transform backend not available. Ensure a compatible backend is configured and built.",
        "NATIVE_KERNEL_UNAVAILABLE"
      );
    }

    let batch: AbstractSequence[] = [];
    let batchBytes = 0;

    for await (const seq of source) {
      batch.push(seq);
      batchBytes += seq.sequence.length;

      if (batchBytes >= BATCH_BYTE_BUDGET) {
        yield* await flushBatch(batch, backend, ops, options.custom, needsTrimSoftClips);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* await flushBatch(batch, backend, ops, options.custom, needsTrimSoftClips);
    }
  }
}

/**
 * Build the ordered list of kernel operations from TransformOptions.
 *
 * The order matches the documented transform precedence: complement/reverse
 * first, then RNA/DNA conversion, then case. This ensures identical results
 * when migrating from the per-sequence TS path to the batched native path.
 */
function buildOpList(options: TransformOptions): TransformOp[] {
  const ops: TransformOp[] = [];

  if (options.reverseComplement === true) {
    ops.push(TransformOp.ReverseComplement);
  } else {
    if (options.complement === true) {
      ops.push(TransformOp.Complement);
    }
    if (options.reverse === true) {
      ops.push(TransformOp.Reverse);
    }
  }

  if (options.toRNA === true) {
    ops.push(TransformOp.ToRna);
  } else if (options.toDNA === true) {
    ops.push(TransformOp.ToDna);
  }

  if (options.upperCase === true) {
    ops.push(TransformOp.UpperCase);
  } else if (options.lowerCase === true) {
    ops.push(TransformOp.LowerCase);
  }

  return ops;
}

/**
 * Pack a batch of sequences, chain kernel calls for each op, unpack
 * the final result, and yield transformed sequences. If a custom
 * callback is present, it runs per-sequence after all kernel ops.
 */
async function* flushBatch(
  sequences: readonly AbstractSequence[],
  backend: Awaited<ReturnType<typeof getBackend>>,
  ops: readonly TransformOp[],
  custom: ((seq: string) => string) | undefined,
  trimSoftClips: boolean
): AsyncIterable<AbstractSequence> {
  const packed = packSequences(sequences);

  // Chain kernel calls. Each op's output feeds the next op's input.
  // Every TransformOp is length-preserving by definition (remove_gaps
  // is a separate function, not a TransformOp variant), so offsets
  // are stable across the entire chain. Reuse the original Uint32Array.
  const { offsets } = packed;
  let data = packed.data;

  for (const op of ops) {
    const result = await backend.transformBatch!(data, offsets, op);
    data = result.data;
  }

  // Unpack: slice the final buffer into individual sequences.
  for (let i = 0; i < sequences.length; i++) {
    const start = offsets[i]!;
    const end = offsets[i + 1]!;
    const sequence = GenotypeString.fromBytes(data.subarray(start, end));

    let result: AbstractSequence;
    if (custom !== undefined) {
      result = withSequence(sequences[i]!, custom(sequence.toString()));
    } else {
      result = withSequence(sequences[i]!, sequence);
    }

    if (trimSoftClips) {
      result = applySoftClipTrim(result);
    }

    yield result;
  }
}

/**
 * Parse leading and trailing soft clips from a CIGAR string and trim
 * the sequence and quality accordingly. Returns the record unchanged
 * if it doesn't have a CIGAR string or has no soft clips.
 */
function applySoftClipTrim(seq: AbstractSequence): AbstractSequence {
  if (!("cigar" in seq)) return seq;

  const record = seq as AlignmentRecord;
  const cigar = record.cigar;
  if (cigar === "*" || cigar === "") return seq;

  // Parse leading soft clips
  const leadingMatch = cigar.match(/^(\d+)S/);
  const leadingClip = leadingMatch !== null ? parseInt(leadingMatch[1]!, 10) : 0;

  // Parse trailing soft clips
  const trailingMatch = cigar.match(/(\d+)S$/);
  // Avoid double-counting if the entire CIGAR is a single S operation
  const trailingClip =
    trailingMatch !== null && trailingMatch.index !== leadingMatch?.index
      ? parseInt(trailingMatch[1]!, 10)
      : 0;

  if (leadingClip === 0 && trailingClip === 0) return seq;

  const trimEnd = seq.length - trailingClip;
  if (leadingClip >= trimEnd) return seq; // Would trim to nothing — leave unchanged

  let result: AbstractSequence = withSequence(seq, seq.sequence.slice(leadingClip, trimEnd));

  // Trim quality too if present
  if ("quality" in record && record.quality !== undefined) {
    result = { ...result, quality: record.quality.slice(leadingClip, trimEnd) } as typeof result;
  }

  // Update the CIGAR string to remove the S operations
  let newCigar = cigar;
  if (leadingClip > 0) {
    newCigar = newCigar.replace(/^\d+S/, "");
  }
  if (trailingClip > 0) {
    newCigar = newCigar.replace(/\d+S$/, "");
  }
  if (newCigar === "") newCigar = "*";

  return { ...result, cigar: newCigar } as AbstractSequence;
}
