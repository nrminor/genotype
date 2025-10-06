/**
 * JSON Serialization/Deserialization Morphs
 *
 * ArkType-based morphs for type-safe JSON transformation.
 * Uses "parse, don't validate" philosophy - transforms with guarantees.
 */

import { type } from "arktype";
import type { SequenceRow } from "./types";
import {
  MetadataSchema,
  SequenceArraySchema,
  SequenceRowSchema,
  WrappedSequenceSchema,
} from "./types";

export const serializeJSON = SequenceArraySchema.pipe((data) => JSON.stringify(data));

export const serializeJSONPretty = SequenceArraySchema.pipe((data) =>
  JSON.stringify(data, null, 2)
);

export const serializeJSONWithMetadata = WrappedSequenceSchema.pipe((data) => JSON.stringify(data));

export const serializeJSONWithMetadataPretty = WrappedSequenceSchema.pipe((data) =>
  JSON.stringify(data, null, 2)
);

export const deserializeJSON = type("string.json.parse").pipe(SequenceArraySchema);

export const deserializeJSONWrapped = type("string.json.parse").pipe(WrappedSequenceSchema);

export function* rowsToJSONL(rows: Iterable<SequenceRow>): Generator<string> {
  for (const row of rows) {
    const result = SequenceRowSchema(row);
    if (result instanceof type.errors) {
      throw new Error(`Invalid row: ${result.summary}`);
    }
    yield JSON.stringify(result);
  }
}

export async function* jsonlToRows(lines: AsyncIterable<string>): AsyncGenerator<SequenceRow> {
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parsed = type("string.json.parse").pipe(SequenceRowSchema)(line);
    if (parsed instanceof type.errors) {
      throw new Error(`Invalid JSONL line: ${parsed.summary}`);
    }
    yield parsed;
  }
}
