/**
 * Global FASTQ sorting by sequence content.
 *
 * Run from the repository root after the native module has been built:
 *
 *   bun run build:native:dev
 *   bun examples/sort-fastq-by-sequence.ts
 *
 * Sorting FASTQ by raw sequence is useful before compression or duplicate-aware
 * review because identical reads become adjacent while qualities and IDs are
 * preserved. In GenoType, `sort({ by: "sequence" })` takes the native FASTQ
 * sorter path when the backend is available; other sort modes use the general
 * streaming/external sorter.
 */

import { FastqParser, seqops } from "@genotype/core";
import type { FastqSequence } from "@genotype/core/types";

const readsPath = "examples/data/reads.fastq";
const parser = new FastqParser({ qualityEncoding: "phred33" });

const sorted = await seqops(parser.parseFile(readsPath))
  .sort({ by: "sequence", order: "asc" })
  .collect();

for (const read of sorted as FastqSequence[]) {
  const sequence = read.sequence.toString();
  const quality = read.quality.toString();

  console.log(`${sequence}\t${read.id}\t${quality}`);
}
