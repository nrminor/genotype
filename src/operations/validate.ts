/**
 * ValidateProcessor - Check and fix sequence validity
 *
 * This processor validates sequences against various criteria and
 * can reject, fix, or warn about invalid sequences. All hot paths
 * run through native SIMD kernels (checkValidBatch, replaceInvalidBatch,
 * classifyBatch, removeGapsBatch).
 */

import { type } from "arktype";
import { getBackend } from "../backend";
import { withSequence } from "../constructors";
import { ValidationError } from "../errors";
import { packSequences } from "../backend/batch";
import {
  CLASS_BDHV,
  CLASS_N,
  CLASS_OTHER,
  CLASS_STRONG,
  CLASS_T,
  CLASS_TWO_BASE,
  CLASS_U,
  CLASS_WEAK,
  NUM_CLASSES,
  ValidationMode,
} from "../backend/kernel-types";
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

    const backend = await getBackend();
    if (
      backend.removeGapsBatch === undefined ||
      backend.checkValidBatch === undefined ||
      backend.replaceInvalidBatch === undefined ||
      backend.classifyBatch === undefined
    ) {
      throw new ValidationError("Native kernel is required for validation but could not be loaded");
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
        yield* await flushValidateBatch(batch, backend, action, mode, stripGaps, options.fixChar);
        batch = [];
        batchBytes = 0;
      }
    }

    if (batch.length > 0) {
      yield* await flushValidateBatch(batch, backend, action, mode, stripGaps, options.fixChar);
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
async function* flushValidateBatch(
  batch: AbstractSequence[],
  backend: Awaited<ReturnType<typeof getBackend>>,
  action: "reject" | "fix" | "warn",
  mode: ValidationMode,
  stripGaps: boolean,
  fixChar: string | undefined
): AsyncIterable<AbstractSequence> {
  let { data, offsets } = packSequences(batch);

  if (stripGaps) {
    const gapResult = await backend.removeGapsBatch!(data, offsets, "");
    data = gapResult.data;
    offsets = new Uint32Array(gapResult.offsets);
  }

  switch (action) {
    case "reject": {
      const flags = await backend.checkValidBatch!(data, offsets, mode);
      for (let i = 0; i < batch.length; i++) {
        if (flags[i] !== 1) continue;
        yield sequenceFromBatch(batch[i]!, data, offsets, i, stripGaps);
      }
      break;
    }

    case "fix": {
      const fixResult = await backend.replaceInvalidBatch!(data, offsets, mode, fixChar ?? "N");
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
      const result = await backend.classifyBatch!(data, offsets);
      for (let i = 0; i < batch.length; i++) {
        const base = i * NUM_CLASSES;
        if (!isValidForMode(result.counts, base, mode)) {
          const seqLen = offsets[i + 1]! - offsets[i]!;
          console.warn(formatValidationDiagnostic(batch[i]!.id, result.counts, base, mode, seqLen));
        }
        yield sequenceFromBatch(batch[i]!, data, offsets, i, stripGaps);
      }
      break;
    }
  }
}

/**
 * Determine whether a sequence is valid for the given mode using
 * classify counts. This mirrors the logic of `checkValidBatch` but
 * works from the 12-class histogram that `classifyBatch` already
 * computed, avoiding a second kernel call in the warn path.
 */
function isValidForMode(counts: number[], base: number, mode: ValidationMode): boolean {
  if (counts[base + CLASS_OTHER]! > 0) return false;

  if (mode === ValidationMode.NormalDna) return true;

  if (
    counts[base + CLASS_T]! > 0 &&
    (mode === ValidationMode.NormalRna || mode === ValidationMode.StrictRna)
  ) {
    return false;
  }

  if (mode === ValidationMode.NormalRna) return true;

  const ambig =
    counts[base + CLASS_N]! +
    counts[base + CLASS_STRONG]! +
    counts[base + CLASS_WEAK]! +
    counts[base + CLASS_TWO_BASE]! +
    counts[base + CLASS_BDHV]!;
  if (ambig > 0) return false;

  if (mode === ValidationMode.StrictDna && counts[base + CLASS_U]! > 0) return false;

  return true;
}

/**
 * Build a diagnostic message for an invalid sequence from its classify
 * counts. Reports each category of invalidity with counts and
 * actionable suggestions where applicable.
 */
function formatValidationDiagnostic(
  seqId: string,
  counts: number[],
  base: number,
  mode: ValidationMode,
  seqLength: number
): string {
  const t = counts[base + CLASS_T]!;
  const u = counts[base + CLASS_U]!;
  const n = counts[base + CLASS_N]!;
  const s = counts[base + CLASS_STRONG]!;
  const w = counts[base + CLASS_WEAK]!;
  const tb = counts[base + CLASS_TWO_BASE]!;
  const bdhv = counts[base + CLASS_BDHV]!;
  const other = counts[base + CLASS_OTHER]!;

  const problems: string[] = [];
  let invalidCount = 0;

  if (mode === ValidationMode.StrictDna && u > 0) {
    invalidCount += u;
    problems.push(`${u} uracil (U) base${u > 1 ? "s" : ""} (did you mean sequenceType: "rna"?)`);
  }

  if ((mode === ValidationMode.StrictRna || mode === ValidationMode.NormalRna) && t > 0) {
    invalidCount += t;
    problems.push(`${t} thymine (T) base${t > 1 ? "s" : ""} (did you mean sequenceType: "dna"?)`);
  }

  if (mode === ValidationMode.StrictDna || mode === ValidationMode.StrictRna) {
    const ambig = n + s + w + tb + bdhv;
    if (ambig > 0) {
      invalidCount += ambig;
      problems.push(
        `${ambig} IUPAC ambiguity code${ambig > 1 ? "s" : ""} (did you mean allowAmbiguous: true?)`
      );
    }
  }

  if (other > 0) {
    invalidCount += other;
    if (other > seqLength * 0.5) {
      problems.push(
        `${other} unrecognized character${other > 1 ? "s" : ""} (sequence may not be nucleotide data)`
      );
    } else {
      problems.push(`${other} unrecognized character${other > 1 ? "s" : ""}`);
    }
  }

  const modeLabel =
    mode === ValidationMode.StrictDna
      ? "strict DNA"
      : mode === ValidationMode.StrictRna
        ? "strict RNA"
        : mode === ValidationMode.NormalDna
          ? "DNA"
          : "RNA";

  const pct = ((invalidCount / seqLength) * 100).toFixed(1);
  return `Sequence "${seqId}" (${seqLength} bp): ${problems.join(", ")} — ${invalidCount} of ${seqLength} bases (${pct}%) invalid for ${modeLabel} validation`;
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
  wasModified: boolean
): AbstractSequence {
  if (
    !wasModified &&
    bytesMatchSequence(original, data.subarray(offsets[index]!, offsets[index + 1]!))
  ) {
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
