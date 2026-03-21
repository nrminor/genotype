/**
 * Backend module for genotype compute kernels.
 *
 * Re-exports the BackendService and its convenience functions for
 * operations to consume. Also re-exports types needed by consumers.
 */

export type {
  AlignmentBatch,
  AlignmentReaderHandle,
  FindPatternBatchOptions,
  GenotypeBackend,
  GrepBatchOptions,
  NullBackend,
  ReferenceSequenceInfo,
} from "./types";

export {
  BackendService,
  BackendUnavailableError,
  backendRuntime,
  classifyBatch,
  transformBatch,
  grepBatch,
  findPatternBatch,
  removeGapsBatch,
  replaceAmbiguousBatch,
  replaceInvalidBatch,
  checkValidBatch,
  qualityAvgBatch,
  qualityTrimBatch,
  qualityBinBatch,
  sequenceMetricsBatch,
  translateBatch,
  hashBatch,
  createAlignmentReaderFromPath,
  createAlignmentReaderFromBytes,
} from "./service";
