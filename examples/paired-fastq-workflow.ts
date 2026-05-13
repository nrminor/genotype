/**
 * Paired-end FASTQ synchronization, interleaving, and overlap-aware merging.
 *
 * Run from the repository root after the native module has been built:
 *
 *   bun run build:native:dev
 *   bun examples/paired-fastq-workflow.ts
 *
 * This example shows both halves of the paired-end story: a parser that validates
 * R1/R2 synchronization while streaming both files, and SeqOps pair operations
 * that can interleave reads or merge overlapping pairs into consensus reads.
 */

import { SeqOps } from "@genotype/core";
import { PairedFastqParser } from "@genotype/core/formats/fastq";
import type { FastqSequence } from "@genotype/core/types";

const r1Path = "examples/data/reads_R1.fastq";
const r2Path = "examples/data/reads_R2.fastq";

const parser = new PairedFastqParser({ checkPairSync: true, qualityEncoding: "phred33" });
const r1Reads: FastqSequence[] = [];
const r2Reads: FastqSequence[] = [];

// PairedFastqParser streams R1 and R2 together. With checkPairSync enabled, it
// validates that each read pair has matching IDs before yielding the pair.
for await (const pair of parser.parseFiles(r1Path, r2Path)) {
  r1Reads.push(pair.r1);
  r2Reads.push(pair.r2);
  console.log(`verified pair ${pair.pairId}: ${pair.r1.length} + ${pair.r2.length} bp`);
}

// Interleaving is useful for tools that expect R1/R2/R1/R2 ordering in a single
// FASTQ stream while still keeping each read as its own FASTQ record.
const interleavedReads = await SeqOps.from(r1Reads).interleavePairs(SeqOps.from(r2Reads)).collect();
const interleavedIds = interleavedReads.map((read) => read.id);

console.log(`interleaved order: ${interleavedIds.join(" -> ")}`);

const firstForwardRead = r1Reads[0];
const firstReverseRead = r2Reads[0];

if (firstForwardRead === undefined || firstReverseRead === undefined) {
  throw new Error("Expected at least one paired read in the example fixtures");
}

// Merging is different from interleaving: overlapping mates are collapsed into a
// consensus read when their overlap passes the merge criteria.
const merged = await SeqOps.from([firstForwardRead])
  .mergePairs(SeqOps.from([firstReverseRead]), {
    minOverlap: 10,
    onNoOverlap: "keep",
  })
  .collect();

console.log("merge output:");
for (const read of merged) {
  console.log(`  ${read.id}\t${read.length} bp`);
}
