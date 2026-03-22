/**
 * SeqOps extension methods for tabular operations
 *
 * Augments SeqOps from @genotype/core with tabular write methods.
 * Import this module (or @genotype/tabular) to make these methods
 * available on any SeqOps instance.
 *
 * This follows the same pattern as Rust extension traits: importing
 * the module adds methods to an existing type without modifying it.
 */

import { SeqOps } from "@genotype/core/operations";
import type { AbstractSequence } from "@genotype/core/types";
import type { JSONWriteOptions } from "@genotype/core/formats/json";
import { openForWriting } from "@genotype/core/io/file-writer";
import { type ColumnId, type Fx2TabOptions, fx2tab, TabularOps } from "@genotype/tabular/fx2tab";

declare module "@genotype/core/operations" {
  interface SeqOps<T extends AbstractSequence> {
    toTabular<
      Columns extends readonly (ColumnId | string)[] = readonly ["id", "sequence", "length"],
    >(
      options?: Fx2TabOptions<Columns>
    ): TabularOps<Columns>;

    writeTSV(path: string, options?: Omit<Fx2TabOptions, "delimiter">): Promise<void>;
    writeCSV(path: string, options?: Omit<Fx2TabOptions, "delimiter">): Promise<void>;
    writeDSV(
      path: string,
      delimiter: string,
      options?: Omit<Fx2TabOptions, "delimiter">
    ): Promise<void>;
    writeJSON(path: string, options?: Fx2TabOptions & JSONWriteOptions): Promise<void>;
    writeJSONL(path: string, options?: Fx2TabOptions): Promise<void>;
  }
}

SeqOps.prototype.toTabular = function <
  Columns extends readonly (ColumnId | string)[] = readonly ["id", "sequence", "length"],
>(options?: Fx2TabOptions<Columns>): TabularOps<Columns> {
  return new TabularOps(fx2tab(this, options));
};

SeqOps.prototype.writeTSV = async function (
  path: string,
  options: Omit<Fx2TabOptions, "delimiter"> = {}
): Promise<void> {
  await openForWriting(path, async (handle) => {
    for await (const row of fx2tab(this, { ...options, delimiter: "\t" })) {
      await handle.writeString(`${row.__raw}\n`);
    }
  });
};

SeqOps.prototype.writeCSV = async function (
  path: string,
  options: Omit<Fx2TabOptions, "delimiter"> = {}
): Promise<void> {
  await openForWriting(path, async (handle) => {
    for await (const row of fx2tab(this, { ...options, delimiter: "," })) {
      await handle.writeString(`${row.__raw}\n`);
    }
  });
};

SeqOps.prototype.writeDSV = async function (
  path: string,
  delimiter: string,
  options: Omit<Fx2TabOptions, "delimiter"> = {}
): Promise<void> {
  await openForWriting(path, async (handle) => {
    for await (const row of fx2tab(this, { ...options, delimiter })) {
      await handle.writeString(`${row.__raw}\n`);
    }
  });
};

SeqOps.prototype.writeJSON = async function (
  path: string,
  options?: Fx2TabOptions & JSONWriteOptions
): Promise<void> {
  const { pretty, includeMetadata, nullValue: jsonNullValue, ...fx2tabOptions } = options || {};
  const jsonOptions: JSONWriteOptions = {
    ...(pretty !== undefined && { pretty }),
    ...(includeMetadata !== undefined && { includeMetadata }),
    ...(jsonNullValue !== undefined && { nullValue: jsonNullValue }),
  };
  await this.toTabular({ ...fx2tabOptions, header: false }).writeJSON(path, jsonOptions);
};

SeqOps.prototype.writeJSONL = async function (
  path: string,
  options?: Fx2TabOptions
): Promise<void> {
  await this.toTabular({ ...options, header: false }).writeJSONL(path);
};
