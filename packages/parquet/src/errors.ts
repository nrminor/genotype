/**
 * Parquet error types
 */

import { Schema } from "effect";

export class ParquetWriteError extends Schema.TaggedErrorClass<ParquetWriteError>()(
  "ParquetWriteError",
  {
    message: Schema.String,
    path: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }
) {}

export class ParquetReadError extends Schema.TaggedErrorClass<ParquetReadError>()(
  "ParquetReadError",
  {
    message: Schema.String,
    path: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }
) {}
