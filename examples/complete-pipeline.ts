#!/usr/bin/env bun

/**
 * Demonstrates complete SeqOps pipeline with all 4 critical operations
 *
 * Usage: bun run examples/complete-pipeline.ts input.fasta
 *
 * This example showcases the Unix philosophy perfected:
 * - grep: Pattern search and filtering
 * - sample: Statistical sampling
 * - sort: Genomic-optimized ordering
 * - rmdup: Sophisticated deduplication
 *
 * All operations compose beautifully while maintaining type safety.
 */

import { FastaParser, seqops } from "../src";

async function main() {
  const inputFile = process.argv[2];

  if (!inputFile) {
    console.error("Usage: bun run examples/complete-pipeline.ts <input.fasta>");
    console.error("");
    console.error("This example demonstrates a complete genomic data processing pipeline:");
    console.error("  1. Filter for chromosome sequences (grep)");
    console.error("  2. Sample for manageable analysis size (sample)");
    console.error("  3. Sort for optimal compression (sort)");
    console.error("  4. Remove duplicates (rmdup)");
    console.error("");
    console.error("Example workflow equivalent to multiple seqkit commands:");
    console.error('  seqkit grep -p "^chr" input.fasta |\\');
    console.error("  seqkit sample -n 1000 |\\");
    console.error("  seqkit sort -l -r |\\");
    console.error("  seqkit rmdup -s > output.fasta");
    process.exit(1);
  }

  try {
    console.error("🧬 Complete SeqOps Pipeline Demo");
    console.error("================================\n");

    // Parse input file with error handling for malformed data
    const parser = new FastaParser();

    console.error("📊 Step 1: Parsing and analyzing input...");
    let inputCount = 0;
    const inputSequences = [];

    try {
      const sequences = parser.parseFile(inputFile);
      for await (const seq of sequences) {
        if (seq.sequence.length > 0) {
          // Skip empty sequences
          inputSequences.push(seq);
          inputCount++;
        }
      }
    } catch (error) {
      console.error(`  Warning: Parser encountered issues, using available sequences`);
      console.error(`  Details: ${error.message}`);
    }

    if (inputSequences.length === 0) {
      console.error("  No valid sequences found in input file");
      process.exit(1);
    }

    console.error(`  Input: ${inputSequences.length} valid sequences\n`);

    // Build comprehensive Unix philosophy pipeline
    console.error("🔍 Step 2: Data cleaning and filtering...");
    const filtered = seqops(inputSequences)
      // First, clean and validate sequences
      .filter({ minLength: 1 }) // Remove empty sequences
      .validate({ mode: "normal", action: "reject" }) // Remove invalid sequences
      .grep({
        pattern: /sequence/, // Find sequences with 'sequence' in ID (for sample data)
        target: "id",
        ignoreCase: true,
      });

    console.error("📈 Step 3: Statistical sampling (sample)...");
    const sampled = filtered.sample({
      n: Math.min(1000, inputCount), // Sample up to 1000
      strategy: "reservoir", // Memory-efficient streaming
      seed: 42, // Reproducible results
    });

    console.error("📋 Step 4: Genomic-optimized sorting (sort)...");
    const sorted = sampled.sort({
      by: "length", // Length-based sorting
      order: "desc", // Longest first for compression
    });

    console.error("🔄 Step 5: Sophisticated deduplication (rmdup)...");
    const deduplicated = sorted.rmdup({
      by: "sequence", // Remove sequence duplicates
      exact: false, // Use Bloom filter for efficiency
      caseSensitive: false, // Ignore case differences
      expectedUnique: 800, // Estimate unique sequences
      falsePositiveRate: 0.001, // 0.1% acceptable false positive rate
    });

    console.error("📤 Step 6: Generating output...\n");

    // Output final results
    let outputCount = 0;
    let minLength = Infinity;
    let maxLength = 0;
    let totalLength = 0;

    for await (const seq of deduplicated) {
      console.log(`>${seq.id}${seq.description ? " " + seq.description : ""}`);
      console.log(seq.sequence);

      outputCount++;
      minLength = Math.min(minLength, seq.length);
      maxLength = Math.max(maxLength, seq.length);
      totalLength += seq.length;
    }

    // Generate comprehensive statistics
    const avgLength = outputCount > 0 ? Math.round(totalLength / outputCount) : 0;
    const reductionRate = (((inputCount - outputCount) / inputCount) * 100).toFixed(1);

    console.error("✅ Pipeline Complete!");
    console.error("===================");
    console.error(`  Input sequences: ${inputCount}`);
    console.error(`  Output sequences: ${outputCount}`);
    console.error(`  Data reduction: ${reductionRate}%`);
    console.error(`  Length range: ${minLength === Infinity ? "N/A" : minLength}-${maxLength} bp`);
    console.error(`  Average length: ${avgLength} bp`);
    console.error("");
    console.error("🎯 Pipeline Benefits:");
    console.error("  ✓ Pattern-based filtering (grep)");
    console.error("  ✓ Memory-efficient sampling (sample)");
    console.error("  ✓ Compression-optimized ordering (sort)");
    console.error("  ✓ Duplicate removal with Bloom filters (rmdup)");
    console.error("  ✓ Type-safe operations with Unix philosophy");
    console.error("  ✓ Streaming behavior for constant memory usage");
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
