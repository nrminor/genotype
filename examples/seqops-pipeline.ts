/**
 * Introducing SeqOps, GenoType's fluent sequence pipeline.
 *
 * Run from the repository root:
 *
 *   bun examples/seqops-pipeline.ts
 *
 * SeqOps is the class behind GenoType's core DSL. It wraps any sequence stream
 * and lets you describe a pipeline as a chain of biological operations: clean,
 * grep, filter, transform, sort, write, collect, and more.
 *
 * The important idea is that each chain step returns another SeqOps pipeline.
 * Nothing has to become an array until you call a terminal operation such as
 * `collect()`, `count()`, `writeFasta()`, or `writeFastq()`.
 */

import { FastaParser, seqops } from "@genotype/core";

const fastaPath = "examples/data/reference.fasta";
const parser = new FastaParser();

const selected = await seqops(parser.parseFile(fastaPath))
  // `seqops()` turns any sequence stream into a fluent, typed pipeline.
  .clean({ trimWhitespace: true, removeGaps: true })
  // Keep chromosome-like records while dropping the amplicon control template.
  .grep({ pattern: /^chr/, target: "id" })
  .filter({ minLength: 30 })
  .transform({ upperCase: true })
  .sort({ by: "length", order: "desc" })
  // `collect()` is where the lazy pipeline is finally materialized into an array.
  .collect();

for (const record of selected) {
  const sequencePreview = record.sequence.toString().slice(0, 12);

  console.log(`${record.id}\t${record.length} bp\t${sequencePreview}...`);
}
