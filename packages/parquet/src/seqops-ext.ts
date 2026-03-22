/**
 * SeqOps extension methods for Parquet operations
 *
 * Augments SeqOps from @genotype/core with parquet read/write methods.
 * Import this module (or @genotype/parquet) to make these methods
 * available on SeqOps.
 */

import { SeqOps } from "@genotype/core/operations";
import { convertRecordToSequence } from "@genotype/core/constructors";
import type { AbstractSequence } from "@genotype/core/types";
import { readParquet, type ParquetReadOptions, type ParquetRow } from "@genotype/parquet/reader";
import { type ParquetWriteOptions } from "@genotype/parquet/writer";

/**
 * Options for reading parquet files as sequences.
 */
export interface ParquetSequenceReadOptions extends ParquetReadOptions {
  /** Force output format (default: auto-detect from presence of quality column) */
  format?: "fasta" | "fastq";
  /** Quality encoding for FASTQ sequences (default: 'phred33') */
  qualityEncoding?: "phred33" | "phred64" | "solexa";
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Convert a ParquetRow to an AbstractSequence.
 *
 * Requires at minimum 'id' and 'sequence' columns. If 'quality' is present,
 * produces a FastqSequence; otherwise a FastaSequence.
 */
function rowToSequence(row: ParquetRow, options?: ParquetSequenceReadOptions): AbstractSequence {
  const id = row.id;
  const sequence = row.sequence;

  if (typeof id !== "string" || typeof sequence !== "string") {
    throw new Error(
      `Parquet row missing required 'id' or 'sequence' columns (got id=${typeof id}, sequence=${typeof sequence})`
    );
  }

  const quality = typeof row.quality === "string" ? row.quality : undefined;
  const description = typeof row.description === "string" ? row.description : undefined;
  const format = options?.format ?? (quality ? "fastq" : "fasta");

  if (format === "fastq" && quality) {
    return convertRecordToSequence(
      { id, sequence, quality, ...(description !== undefined && { description }) },
      "fastq",
      options?.qualityEncoding ?? "phred33"
    );
  }

  return convertRecordToSequence(
    { id, sequence, ...(description !== undefined && { description }) },
    "fasta"
  );
}

declare module "@genotype/core/operations" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace SeqOps {
    function fromParquet(
      path: string,
      options?: ParquetSequenceReadOptions
    ): SeqOps<AbstractSequence>;
  }

  interface SeqOps<T extends AbstractSequence> {
    writeParquet(
      path: string,
      options?: ParquetWriteOptions & { signal?: AbortSignal }
    ): Promise<void>;
  }
}

/**
 * Static method: read a Parquet file as a SeqOps pipeline.
 *
 * Expects the parquet file to have at minimum 'id' and 'sequence' columns.
 * If 'quality' is present, sequences are treated as FASTQ.
 */
(SeqOps as unknown as Record<string, unknown>).fromParquet = function (
  path: string,
  options?: ParquetSequenceReadOptions
): SeqOps<AbstractSequence> {
  async function* parquetSequences(): AsyncIterable<AbstractSequence> {
    const { signal, format, qualityEncoding, ...readOptions } = options ?? {};
    for await (const row of readParquet(path, { ...readOptions, ...(signal && { signal }) })) {
      yield rowToSequence(row, {
        ...(format && { format }),
        ...(qualityEncoding && { qualityEncoding }),
      });
    }
  }

  return new SeqOps(parquetSequences());
};

/**
 * Instance method: write sequences to a Parquet file via toTabular().
 */
SeqOps.prototype.writeParquet = async function (
  path: string,
  options?: ParquetWriteOptions & { signal?: AbortSignal }
): Promise<void> {
  await this.toTabular({ header: false }).writeParquet(path, options);
};
