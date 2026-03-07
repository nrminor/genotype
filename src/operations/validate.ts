/**
 * ValidateProcessor - Check and fix sequence validity
 *
 * This processor validates sequences against various criteria and
 * can reject, fix, or warn about invalid sequences. All hot paths
 * run through native SIMD kernels (checkValidBatch, replaceInvalidBatch,
 * removeGapsBatch).
 */

import { type } from "arktype";
import { withSequence } from "../constructors";
import { ValidationError } from "../errors";
import {
  type NativeKernel,
  getNativeKernel,
  packSequences,
  ValidationMode,
} from "../native";
import type { AbstractSequence } from "../types";
import type { Processor, ValidateOptions } from "./types";

export {
  expandAmbiguous,
  SequenceType,
  SequenceValidator,
  ValidationMode,
} from "./core/sequence-validation";

/**
 * ArkType schema for ValidateOptions validation
 *
 * Validates:
 * - sequenceType must be "dna" or "rna"
 * - action must be "reject", "fix", or "warn"
 * - fixChar must be a single character
 * - Cross-field constraint: fixChar only valid when action is "fix"
 */
const ValidateOptionsSchema = type({
  sequenceType: '"dna"|"rna"',
  "allowAmbiguous?": "boolean",
  "allowGaps?": "boolean",
  "action?": '"reject"|"fix"|"warn"',
  "fixChar?": "string",
}).narrow((options, ctx) => {
  if (options.fixChar !== undefined && options.fixChar.length !== 1) {
    return ctx.reject({
      expected: "a single character",
      path: ["fixChar"],
    });
  }
  if (options.fixChar !== undefined && options.action !== "fix") {
    return ctx.reject({
      expected: 'action to be "fix" when fixChar is specified',
      path: ["fixChar", "action"],
    });
  }
  return true;
});

/** Byte budget per native batch. Sequences accumulate until this threshold. */
const BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

/**
 * Map ValidateOptions to the kernel's ValidationMode enum.
 *
 * | sequenceType | allowAmbiguous | Kernel mode |
 * |---|---|---|
 * | dna | false | StrictDna |
 * | dna | true (default) | NormalDna |
 * | rna | false | StrictRna |
 * | rna | true (default) | NormalRna |
 */
function resolveKernelMode(options: ValidateOptions): ValidationMode {
  if (options.sequenceType === "rna") {
    return options.allowAmbiguous === false ? ValidationMode.StrictRna : ValidationMode.NormalRna;
  }
  return options.allowAmbiguous === false ? ValidationMode.StrictDna : ValidationMode.NormalDna;
}

/**
 * Processor for validating sequences
 *
 * @example
 * ```typescript
 * const processor = new ValidateProcessor();
 * const validated = processor.process(sequences, {
 *   sequenceType: 'dna',
 *   allowAmbiguous: false,
 *   action: 'reject',
 * });
 * ```
 */
export class ValidateProcessor implements Processor<ValidateOptions> {
  /**
   * Process sequences with validation
   *
   * @param source - Input sequences
   * @param options - Validation options
   * @yields Valid sequences (may be fixed)
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: ValidateOptions
  ): AsyncIterable<AbstractSequence> {
    const validationResult = ValidateOptionsSchema(options);
    if (validationResult instanceof type.errors) {
      throw new ValidationError(`Invalid validate options: ${validationResult.summary}`);
    }

    const kernel = getNativeKernel();
    if (kernel === undefined) {
      throw new ValidationError(
        "Native kernel is required for validation but could not be loaded"
      );
    }

    const action = options.action ?? "reject";
    const mode = resolveKernelMode(options);
    const stripGaps = options.allowGaps !== true;

    let batch: AbstractSequence[] = [];
    let batchBytes = 0;

    for await (const seq of source) {
      batch.push(seq);
      batchBytes += seq.sequence.length;
      if (batchBytes >= BATCH_BYTE_BUDGET) {
        yield* flushValidateBatch(batch, kernel, action, mode, stripGaps, options.fixChar);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* flushValidateBatch(batch, kernel, action, mode, stripGaps, options.fixChar);
    }
  }
}

/**
 * Process a batch of sequences through the native validation kernels.
 *
 * When `stripGaps` is true, `removeGapsBatch` runs first and the
 * gap-stripped bytes become the working data for validation. The
 * gap-stripped sequence is yielded even when the original was valid.
 */
function* flushValidateBatch(
  batch: AbstractSequence[],
  kernel: NativeKernel,
  action: "reject" | "fix" | "warn",
  mode: ValidationMode,
  stripGaps: boolean,
  fixChar: string | undefined,
): Iterable<AbstractSequence> {
  let { data, offsets } = packSequences(batch);

  if (stripGaps) {
    const gapResult = kernel.removeGapsBatch(data, offsets, "");
    data = gapResult.data;
    offsets = new Uint32Array(gapResult.offsets);
  }

  switch (action) {
    case "reject": {
      const flags = kernel.checkValidBatch(data, offsets, mode);
      for (let i = 0; i < batch.length; i++) {
        if (flags[i] !== 1) continue;
        yield sequenceFromBatch(batch[i]!, data, offsets, i, stripGaps);
      }
      break;
    }

    case "fix": {
      const fixResult = kernel.replaceInvalidBatch(data, offsets, mode, fixChar ?? "N");
      for (let i = 0; i < batch.length; i++) {
        const start = fixResult.offsets[i]!;
        const end = fixResult.offsets[i + 1]!;
        const fixedBytes = fixResult.data.subarray(start, end);
        const original = batch[i]!;
        if (!stripGaps && bytesMatchSequence(original, fixedBytes)) {
          yield original;
        } else {
          yield withSequence(original, Buffer.from(fixedBytes).toString());
        }
      }
      break;
    }

    case "warn": {
      const flags = kernel.checkValidBatch(data, offsets, mode);
      for (let i = 0; i < batch.length; i++) {
        if (flags[i] !== 1) {
          console.warn(`Invalid sequence: ${batch[i]!.id}`);
        }
        yield sequenceFromBatch(batch[i]!, data, offsets, i, stripGaps);
      }
      break;
    }
  }
}

/**
 * Yield the original sequence if bytes haven't changed, or a new
 * sequence with the (potentially gap-stripped) bytes from the batch.
 */
function sequenceFromBatch(
  original: AbstractSequence,
  data: Buffer,
  offsets: Uint32Array,
  index: number,
  wasModified: boolean,
): AbstractSequence {
  if (!wasModified && bytesMatchSequence(original, data.subarray(offsets[index]!, offsets[index + 1]!))) {
    return original;
  }
  const start = offsets[index]!;
  const end = offsets[index + 1]!;
  return withSequence(original, Buffer.from(data.subarray(start, end)).toString());
}

/**
 * Check whether a sequence's bytes are identical to a buffer slice,
 * avoiding a string allocation when possible.
 */
function bytesMatchSequence(seq: AbstractSequence, bytes: Uint8Array): boolean {
  const seqBytes = seq.sequence.toBytes();
  if (seqBytes.length !== bytes.length) return false;
  for (let i = 0; i < seqBytes.length; i++) {
    if (seqBytes[i] !== bytes[i]) return false;
  }
  return true;
}
