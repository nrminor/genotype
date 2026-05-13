/**
 * Primer-pair amplicon extraction from FASTA records.
 *
 * Run from the repository root:
 *
 *   bun examples/amplicon-extract.ts
 *
 * This example searches synthetic templates for a forward primer and the
 * reverse-complement binding site of a reverse primer. It shows both the simple
 * "give me the inner amplicon" workflow and a more annotated workflow with
 * primer flanks, canonical orientation checks, mismatch reporting, and windowed
 * search for long reads.
 */

import { FastaParser, primer, seqops } from "@genotype/core";

const fastaPath = "examples/data/reference.fasta";

// `primer.literal()` validates literal primer strings at compile time. It also
// accepts IUPAC ambiguity codes, which are common in real primer designs.
// Try changing one of these to a 9 bp primer or a sequence containing `Z` in an
// editor and TypeScript will object before the script runs.
const forwardPrimer = primer.literal("ACGTACGTTN");
const exactReversePrimer = primer.literal("ACGTACGTTT");
const nearMatchReversePrimer = primer.literal("ACGTACGTTA");

const parser = new FastaParser();

// The simple form emits the inner amplified region: primers are used for
// detection, but the returned sequence excludes the primers themselves.
const innerAmplicons = await seqops(parser.parseFile(fastaPath))
  .filter((record) => record.id === "amplicon_template")
  .amplicon({
    forwardPrimer,
    reversePrimer: exactReversePrimer,
    maxMismatches: 0,
  })
  .collect();

// The object form exposes the richer amplicon API. This version keeps primer
// flanks in the output, reports mismatch counts, records canonical primer
// orientation, and limits primer search to the ends of each template.
const annotatedAmplicons = await seqops(parser.parseFile(fastaPath))
  .filter((record) => record.id === "amplicon_template")
  .amplicon({
    forwardPrimer,
    reversePrimer: nearMatchReversePrimer,
    canonical: true,
    flanking: true,
    maxMismatches: 1,
    outputMismatches: true,
    searchWindow: { forward: 40, reverse: 40 },
  })
  .collect();

console.log("Inner amplicons:");
for (const amplicon of innerAmplicons) {
  printFastaRecord(amplicon.id, amplicon.description, amplicon.sequence.toString());
}

console.log("\nAnnotated amplicons:");
for (const amplicon of annotatedAmplicons) {
  printFastaRecord(amplicon.id, amplicon.description, amplicon.sequence.toString());
}

function printFastaRecord(id: string, description: string | undefined, sequence: string): void {
  const header = description === undefined ? id : `${id} ${description}`;

  console.log(`>${header}`);
  console.log(sequence);
}
