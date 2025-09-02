#!/usr/bin/env bun

/**
 * Demonstrates SeqOps 'sample' command functionality using Genotype library
 *
 * Usage: bun run examples/seqkit-sample.ts input.fasta [count] [strategy]
 *
 * Equivalent to: seqkit sample -n count input.fasta
 *
 * Examples:
 *   bun run examples/seqkit-sample.ts sample.fasta 100
 *   bun run examples/seqkit-sample.ts sample.fasta 50 systematic
 *   bun run examples/seqkit-sample.ts sample.fasta 200 reservoir
 */

import { FastaParser, seqops } from '../src';

async function main() {
  const inputFile = process.argv[2];
  const count = parseInt(process.argv[3] || '100');
  const strategy = (process.argv[4] as 'random' | 'systematic' | 'reservoir') || 'reservoir';

  if (!inputFile) {
    console.error('Usage: bun run examples/seqkit-sample.ts <input.fasta> [count] [strategy]');
    console.error('');
    console.error('Arguments:');
    console.error('  input.fasta  Input FASTA file');
    console.error('  count        Number of sequences to sample (default: 100)');
    console.error(
      '  strategy     Sampling strategy: random|systematic|reservoir (default: reservoir)'
    );
    console.error('');
    console.error('Examples:');
    console.error('  bun run examples/seqkit-sample.ts sample.fasta 100');
    console.error('  bun run examples/seqkit-sample.ts sample.fasta 50 systematic');
    process.exit(1);
  }

  if (Number.isNaN(count) || count <= 0) {
    console.error(`Error: Count must be a positive number, got: ${process.argv[3]}`);
    process.exit(1);
  }

  try {
    // Parse input file
    const parser = new FastaParser();
    const sequences = parser.parseFile(inputFile);

    // Apply sampling with specified strategy
    const sampled = seqops(sequences).sample({
      n: count,
      strategy,
      seed: 42, // For reproducible results
    });

    // Output sampled sequences
    let outputCount = 0;
    for await (const seq of sampled) {
      console.log(`>${seq.id}${seq.description ? ` ${seq.description}` : ''}`);
      console.log(seq.sequence);
      outputCount++;
    }

    console.error(`\nSampled ${outputCount} sequences using ${strategy} strategy`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
