/**
 * Convert FASTA records to a tabular summary.
 *
 * Run from the repository root:
 *
 *   bun examples/fasta-to-tabular.ts
 *
 * This example mirrors the common `seqkit fx2tab` workflow: parse FASTA,
 * calculate sequence-level fields, and emit TSV rows suitable for downstream R,
 * Python, DuckDB, or spreadsheet inspection.
 */

import { FastaParser } from "@genotype/core";
import { fx2tab } from "@genotype/tabular/fx2tab";

const fastaPath = "examples/data/reference.fasta";
const parser = new FastaParser();

for await (const row of fx2tab(parser.parseFile(fastaPath), {
  columns: ["id", "length", "gc", "alphabet"] as const,
  precision: 1,
})) {
  console.log(row.__raw);
}
