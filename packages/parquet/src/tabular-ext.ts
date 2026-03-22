/**
 * TabularOps extension for Parquet output
 *
 * Augments TabularOps from @genotype/tabular with a writeParquet method.
 * Import this module (or @genotype/parquet) to make writeParquet()
 * available on any TabularOps instance.
 */

import { TabularOps } from "@genotype/tabular/fx2tab";
import { writeParquet, type ParquetWriteOptions } from "@genotype/parquet/writer";

declare module "@genotype/tabular/fx2tab" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TabularOps<Columns> {
    writeParquet(path: string, options?: ParquetWriteOptions): Promise<void>;
  }
}

TabularOps.prototype.writeParquet = async function (
  path: string,
  options?: ParquetWriteOptions
): Promise<void> {
  await writeParquet(this, path, options);
};

export type { ParquetWriteOptions };
