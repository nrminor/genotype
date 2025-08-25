#!/usr/bin/env bun

/**
 * Demonstrates SeqOps 'grep' command functionality using Genotype library
 *
 * Usage: bun run examples/seqkit-grep.ts input.fasta [pattern] [target]
 *
 * Equivalent to: seqkit grep -p pattern -n|-s input.fasta
 *
 * Examples:
 *   bun run examples/seqkit-grep.ts sample.fasta "ATCG" sequence
 *   bun run examples/seqkit-grep.ts sample.fasta "^chr" id
 *   bun run examples/seqkit-grep.ts sample.fasta "gene" description
 */

import { FastaParser, seqops } from '../src';

async function main() {
  const inputFile = process.argv[2];
  const pattern = process.argv[3] || 'ATCG';
  const target = (process.argv[4] as 'sequence' | 'id' | 'description') || 'sequence';

  if (!inputFile) {
    console.error('Usage: bun run examples/seqkit-grep.ts <input.fasta> [pattern] [target]');
    console.error('');
    console.error('Arguments:');
    console.error('  input.fasta  Input FASTA file');
    console.error('  pattern      Pattern to search for (default: ATCG)');
    console.error('  target       Search target: sequence|id|description (default: sequence)');
    console.error('');
    console.error('Examples:');
    console.error('  bun run examples/seqkit-grep.ts sample.fasta "ATCG" sequence');
    console.error('  bun run examples/seqkit-grep.ts sample.fasta "^chr" id');
    process.exit(1);
  }

  try {
    // Parse input file
    const parser = new FastaParser();
    const sequences = parser.parseFile(inputFile);

    // Apply grep operation with Unix philosophy
    const matches = seqops(sequences).grep({
      pattern: pattern.startsWith('/') ? new RegExp(pattern.slice(1, -1)) : pattern,
      target,
      ignoreCase: target === 'id', // Case-insensitive for IDs by default
    });

    // Output results in FASTA format
    let matchCount = 0;
    for await (const seq of matches) {
      console.log(`>${seq.id}${seq.description ? ' ' + seq.description : ''}`);
      console.log(seq.sequence);
      matchCount++;
    }

    console.error(`\nFound ${matchCount} sequences matching pattern '${pattern}' in ${target}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
