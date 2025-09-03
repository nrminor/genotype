#!/usr/bin/env bun

/**
 * Demonstrates SeqOps 'rmdup' command functionality using Genotype library
 *
 * Usage: bun run examples/seqkit-rmdup.ts input.fasta [strategy] [exact]
 *
 * Equivalent to: seqkit rmdup -s|-n|-i input.fasta
 *
 * Examples:
 *   bun run examples/seqkit-rmdup.ts sample.fasta sequence
 *   bun run examples/seqkit-rmdup.ts sample.fasta id exact
 *   bun run examples/seqkit-rmdup.ts sample.fasta both
 */

import { FastaParser, seqops } from "../src";

async function main() {
  const inputFile = process.argv[2];
  const strategy = (process.argv[3] as "sequence" | "id" | "both") || "sequence";
  const useExact = process.argv[4] === "exact";

  if (!inputFile) {
    console.error("Usage: bun run examples/seqkit-rmdup.ts <input.fasta> [strategy] [exact]");
    console.error("");
    console.error("Arguments:");
    console.error("  input.fasta  Input FASTA file");
    console.error("  strategy     Deduplication strategy: sequence|id|both (default: sequence)");
    console.error('  exact        Use "exact" for 100% accuracy (default: probabilistic)');
    console.error("");
    console.error("Examples:");
    console.error(
      "  bun run examples/seqkit-rmdup.ts sample.fasta sequence      # Remove sequence duplicates"
    );
    console.error(
      "  bun run examples/seqkit-rmdup.ts sample.fasta id exact      # Remove ID duplicates (exact)"
    );
    console.error(
      "  bun run examples/seqkit-rmdup.ts sample.fasta both          # Remove both ID+sequence duplicates"
    );
    console.error("");
    console.error(
      "Note: Probabilistic mode uses Bloom filters for memory efficiency with large datasets."
    );
    console.error("      Exact mode provides 100% accuracy but uses more memory.");
    process.exit(1);
  }

  const validStrategies = ["sequence", "id", "both"];
  if (!validStrategies.includes(strategy)) {
    console.error(
      `Error: Invalid strategy '${strategy}'. Valid options: ${validStrategies.join(", ")}`
    );
    process.exit(1);
  }

  try {
    // Parse input file
    const parser = new FastaParser();
    const sequences = parser.parseFile(inputFile);

    // Count input sequences for statistics
    let inputCount = 0;
    const inputSequences = [];
    for await (const seq of sequences) {
      inputSequences.push(seq);
      inputCount++;
    }

    // Apply deduplication optimized for genomic workflows
    const deduplicated = seqops(inputSequences).rmdup({
      by: strategy,
      exact: useExact,
      caseSensitive: true,
      expectedUnique: Math.floor(inputCount * 0.8), // Estimate 80% unique
      falsePositiveRate: 0.001, // 0.1% false positive rate
    });

    // Output deduplicated sequences
    let outputCount = 0;
    for await (const seq of deduplicated) {
      console.log(`>${seq.id}${seq.description ? " " + seq.description : ""}`);
      console.log(seq.sequence);
      outputCount++;
    }

    const duplicatesRemoved = inputCount - outputCount;
    const deduplicationRate = ((duplicatesRemoved / inputCount) * 100).toFixed(1);

    console.error(`\nDeduplication Results:`);
    console.error(`  Input sequences: ${inputCount}`);
    console.error(`  Output sequences: ${outputCount}`);
    console.error(`  Duplicates removed: ${duplicatesRemoved} (${deduplicationRate}%)`);
    console.error(`  Strategy: ${strategy} (${useExact ? "exact" : "probabilistic"})`);

    if (!useExact) {
      console.error(`  False positive rate: ≤0.1%`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
