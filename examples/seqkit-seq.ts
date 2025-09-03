#!/usr/bin/env bun

/**
 * Demonstrates GenoType's declarative sequence processing
 *
 * Shows common bioinformatics workflows using the library's
 * composable operations instead of imperative control flow.
 *
 * Usage: bun run examples/seqkit-seq.ts <input.fasta|input.fastq>
 */

import { FastaParser, FastqParser, seqops } from "../src";

async function main() {
  const inputFile = process.argv[2];

  if (!inputFile) {
    console.log(`Usage: bun run examples/seqkit-seq.ts <input.fasta|input.fastq>

This example demonstrates declarative sequence processing workflows:

// Quality control for NGS reads
const cleaned = await seqops(reads)
  .quality({ minScore: 20, trim: true })
  .filter({ minLength: 50 })
  .clean({ removeGaps: true })
  .writeFastq('clean.fastq');

// Genome preprocessing
const processed = await seqops(genome)
  .filter({ minLength: 1000 })
  .transform({ upperCase: true })
  .validate({ mode: 'strict' })
  .stats({ detailed: true });
`);
    process.exit(1);
  }

  try {
    // Auto-detect format
    const isNGS =
      inputFile.toLowerCase().includes(".fq") || inputFile.toLowerCase().includes(".fastq");

    if (isNGS) {
      // NGS quality control workflow
      const parser = new FastqParser();
      const reads = parser.parseFile(inputFile);

      const stats = await seqops(reads)
        .quality({ minScore: 20, trim: true })
        .filter({ minLength: 50 })
        .clean({ removeGaps: true })
        .stats({ includeQuality: true });

      console.error(`Processed ${stats.numSequences} reads`);
      console.error(`Average quality: Q${stats.avgQuality?.toFixed(0) || "N/A"}`);
      console.error(`Average length: ${Math.round(stats.avgLength)}bp`);
    } else {
      // Genome analysis workflow
      const parser = new FastaParser();
      const sequences = parser.parseFile(inputFile);

      const stats = await seqops(sequences)
        .filter({ minLength: 1000 })
        .transform({ upperCase: true })
        .clean({ replaceAmbiguous: true })
        .stats({ detailed: true });

      console.error(`Analyzed ${stats.numSequences} sequences`);
      console.error(`Total length: ${stats.totalLength.toLocaleString()}bp`);
      if (stats.n50) {
        console.error(`N50: ${stats.n50.toLocaleString()}bp`);
      }
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
