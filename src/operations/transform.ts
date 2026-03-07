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
import { GenotypeError } from "../errors";
import { GenotypeString } from "../genotype-string";
import { type NativeKernel, TransformOp, getNativeKernel, packSequences } from "../native";
import type { AbstractSequence } from "../types";
import type { Processor, TransformOptions } from "./types";

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
    options: TransformOptions
  ): AsyncIterable<AbstractSequence> {
    const ops = buildOpList(options);

    // No kernel ops and no custom callback — pass through unchanged.
    if (ops.length === 0 && options.custom === undefined) {
      yield* source;
      return;
    }

    // Custom-only path: no kernel work, just apply the callback per-sequence.
    if (ops.length === 0) {
      for await (const seq of source) {
        const transformed = options.custom!(seq.sequence.toString());
        yield withSequence(seq, transformed);
      }
      return;
    }

    const nativeKernel = getNativeKernel();
    if (nativeKernel === undefined) {
      throw new GenotypeError(
        "Native kernel not available. The genotype-native crate must be built " +
          "before using TransformProcessor. Run `just build-native-dev` to build it.",
        "NATIVE_KERNEL_UNAVAILABLE"
      );
    }

    let batch: AbstractSequence[] = [];
    let batchBytes = 0;

    for await (const seq of source) {
      batch.push(seq);
      batchBytes += seq.sequence.length;

      if (batchBytes >= BATCH_BYTE_BUDGET) {
        yield* flushBatch(batch, nativeKernel, ops, options.custom);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* flushBatch(batch, nativeKernel, ops, options.custom);
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
function* flushBatch(
  sequences: readonly AbstractSequence[],
  nativeKernel: NativeKernel,
  ops: readonly TransformOp[],
  custom: ((seq: string) => string) | undefined
): Iterable<AbstractSequence> {
  const packed = packSequences(sequences);

  // Chain kernel calls. Each op's output feeds the next op's input.
  // Every TransformOp is length-preserving by definition (remove_gaps
  // is a separate function, not a TransformOp variant), so offsets
  // are stable across the entire chain. Reuse the original Uint32Array.
  const { offsets } = packed;
  let data = packed.data;

  for (const op of ops) {
    const result = nativeKernel.transformBatch(data, offsets, op);
    data = result.data;
  }

  // Unpack: slice the final buffer into individual sequences.
  for (let i = 0; i < sequences.length; i++) {
    const start = offsets[i]!;
    const end = offsets[i + 1]!;
    const sequence = GenotypeString.fromBytes(data.subarray(start, end));

    if (custom !== undefined) {
      yield withSequence(sequences[i]!, custom(sequence.toString()));
    } else {
      yield withSequence(sequences[i]!, sequence);
    }
  }
}
