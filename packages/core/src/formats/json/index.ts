/**
 * JSON Format Module
 *
 * Re-exports for JSON and JSONL format support.
 * Write options and collection metadata have moved to @genotype/tabular.
 */

export {
  deserializeJSON,
  deserializeJSONWrapped,
  jsonlToRows,
  rowsToJSONL,
  serializeJSON,
  serializeJSONPretty,
  serializeJSONWithMetadata,
  serializeJSONWithMetadataPretty,
} from "./morphs";
export { JSONLParser, JSONParser } from "./parser";
export type {
  JSONCollectionMetadata,
  JSONFormat,
  JSONParseOptions,
  JSONWriteOptions,
  SequenceArray,
  SequenceRow,
  WrappedSequence,
} from "./types";
export { SequenceArraySchema, SequenceRowSchema, WrappedSequenceSchema } from "./types";
export { detectJSONFormat, generateCollectionMetadata } from "./utils";
