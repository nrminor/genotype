/**
 * FASTQ quality control with a small Illumina-like fixture.
 *
 * Run from the repository root:
 *
 *   bun examples/qc-fastq.ts
 *
 * This example parses FASTQ records, trims low-quality tails, rejects reads
 * with ambiguous bases, and reports a compact QC summary. Quality filtering and
 * trimming go through GenoType's backend quality path, which can use accelerated
 * kernels when a native or WASM backend is available.
 */

import { FastqParser, seqops } from "@genotype/core";
import type { AbstractSequence, FastqSequence } from "@genotype/core/types";

const readsPath = "examples/data/reads.fastq";

function phred33QualityScores(qualityString: string): number[] {
  const scores: number[] = [];

  for (const character of qualityString) {
    const asciiCode = character.charCodeAt(0);
    const phredScore = asciiCode - 33;
    scores.push(phredScore);
  }

  return scores;
}

function meanQualityScore(read: FastqSequence): number {
  const qualityString = read.quality.toString();
  const qualityScores = phred33QualityScores(qualityString);
  const totalQuality = qualityScores.reduce((sum, score) => sum + score, 0);

  return totalQuality / qualityScores.length;
}

function hasAmbiguousBases(read: AbstractSequence): boolean {
  const sequence = read.sequence.toString();
  return sequence.includes("N");
}

const parser = new FastqParser({ qualityEncoding: "phred33" });
const reads = parser.parseFile(readsPath);

// This is the core QC pipeline: trim low-quality tails first, then discard reads
// that are too short or contain ambiguous bases after trimming.
const passingReads = await seqops(reads)
  // Trim low-quality sequence from read ends before length filtering.
  .quality({ trim: true, trimThreshold: 20, trimWindow: 4 })
  // Keep reads long enough for downstream mapping and reject ambiguous bases.
  .filter({ minLength: 10, custom: (read) => !hasAmbiguousBases(read) })
  .collect();

console.log(`Passing reads: ${passingReads.length}`);
for (const read of passingReads as FastqSequence[]) {
  const averageQuality = meanQualityScore(read);
  const averageQualityLabel = averageQuality.toFixed(1);

  console.log(`${read.id}\t${read.length} bp\tmean Q${averageQualityLabel}`);
}
