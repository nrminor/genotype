/**
 * Effect-native error types for the tabular package.
 *
 * These are Schema.TaggedErrorClass types that flow through Effect's
 * error channel. At the AsyncIterable boundary, they're converted back
 * to core's error classes (DSVParseError, etc.) for public API compatibility.
 */

import { Schema } from "effect";

/**
 * DSV parsing error — Effect-native equivalent of core's DSVParseError.
 */
export class TabularParseError extends Schema.TaggedErrorClass<TabularParseError>()(
  "TabularParseError",
  {
    message: Schema.String,
    line: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect),
  }
) {}

/**
 * Custom column computation error — when a user's custom column function throws.
 * Previously silently swallowed with nullValue substitution; now typed and visible.
 */
export class CustomColumnError extends Schema.TaggedErrorClass<CustomColumnError>()(
  "CustomColumnError",
  {
    column: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }
) {}

/**
 * General fx2tab pipeline error — source iteration failures, batching errors.
 */
export class Fx2TabError extends Schema.TaggedErrorClass<Fx2TabError>()("Fx2TabError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}
