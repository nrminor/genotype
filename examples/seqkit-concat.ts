#!/usr/bin/env bun

/**
 * Demonstrates elegant file concatenation with GenoType
 *
 * Shows how to combine multiple sequence files using the simple,
 * declarative concat factory pattern. Focus is on API elegance.
 *
 * Usage: bun run examples/seqkit-concat.ts file1.fasta file2.fasta [...]
 *
 * Examples:
 *   bun run examples/seqkit-concat.ts ref.fa samples.fa
 *   bun run examples/seqkit-concat.ts chr*.fasta
 */

import { seqops } from "../src";

async function main() {
  const inputFiles = process.argv.slice(2);

  if (inputFiles.length < 2) {
    console.error(`GenoType Concat Example

Usage: bun run examples/seqkit-concat.ts <file1.fasta> <file2.fasta> [...]

Demonstrates the elegant concat factory for combining multiple files.

Examples:
  bun run examples/seqkit-concat.ts ref.fa samples.fa        # Combine two files
  bun run examples/seqkit-concat.ts chr1.fa chr2.fa chr3.fa  # Combine chromosomes

The focus is on showing API elegance:

  const combined = seqops.concat(['file1.fa', 'file2.fa'])
    .filter({ minLength: 100 })    # Process combined sequences
    .clean({ removeGaps: true })   # Apply transformations
    .writeFasta('output.fa');      # Write results

This demonstrates the declarative factory pattern that makes file
combination feel natural and composable with sequence processing.
`);
    process.exit(1);
  }

  try {
    console.error(`🚀 Concatenating ${inputFiles.length} files...`);

    // Demonstrate the elegant factory API
    const result = await seqops
      .concat(inputFiles)
      .filter({ minLength: 50 }) // Optional: filter short sequences
      .clean({ removeGaps: true }) // Optional: clean sequences
      .stats({ detailed: true }); // Terminal: get statistics

    console.error(`\n✅ Concatenation completed successfully!`);
    console.error(`📊 Results:`);
    console.error(`   Input files: ${inputFiles.length}`);
    console.error(`   Total sequences: ${result.numSequences}`);
    console.error(`   Total length: ${result.totalLength.toLocaleString()} bp`);
    console.error(`   Average length: ${Math.round(result.avgLength)} bp`);

    if (result.gcContent !== undefined) {
      console.error(`   GC content: ${result.gcContent.toFixed(1)}%`);
    }

    console.error(`\n📁 Input files:`);
    for (const file of inputFiles) {
      console.error(`   ${file}`);
    }

    console.error(`\n💡 API Elegance Demonstrated:`);
    console.error(`   • Factory pattern: seqops.concat(files)`);
    console.error(`   • Immediate pipeline integration`);
    console.error(`   • No complex configuration objects`);
    console.error(`   • Natural composition with other operations`);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
