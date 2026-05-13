/**
 * Round-trip sequence records through Apache Parquet.
 *
 * Run from the repository root:
 *
 *   bun examples/roundtrip-parquet.ts
 *
 * This example writes FASTA records to Parquet, reads them back through the
 * SeqOps extension, and continues with normal sequence operations. That is the
 * basic shape of a columnar storage workflow: parse biological sequence records,
 * move them into an analytics-friendly format, and still recover typed sequence
 * objects for downstream pipelines.
 */

import { FastaParser, seqops } from "@genotype/core";
import { fromParquet } from "@genotype/parquet";
import "@genotype/tabular";
import "@genotype/parquet";

const fastaPath = "examples/data/reference.fasta";
const parquetPath = "examples/output/reference.parquet";

const parser = new FastaParser();

// The write side is still an ordinary SeqOps pipeline. We filter sequence records
// and then hand the resulting stream to the Parquet extension.
await seqops(parser.parseFile(fastaPath)).filter({ minLength: 20 }).writeParquet(parquetPath);

// The read side returns a SeqOps pipeline too, so data coming back from Parquet
// can immediately flow into normal sequence operations.
const recovered = await fromParquet(parquetPath).sort({ by: "length", order: "desc" }).collect();

console.log(`Recovered ${recovered.length} records from ${parquetPath}`);
for (const record of recovered) {
  console.log(`${record.id}\t${record.length} bp`);
}
