#!/usr/bin/env bun

/**
 * Demonstrates SeqOps 'sort' command functionality using Genotype library
 *
 * Usage: bun run examples/seqkit-sort.ts input.fasta [sortBy] [order]
 *
 * Equivalent to: seqkit sort -l|-n|-s|-2 [-r] input.fasta
 *
 * Examples:
 *   bun run examples/seqkit-sort.ts sample.fasta length desc
 *   bun run examples/seqkit-sort.ts sample.fasta id asc
 *   bun run examples/seqkit-sort.ts sample.fasta gc desc
 */

import { FastaParser, seqops } from '../src';

async function main() {
  const inputFile = process.argv[2];
  const sortBy = (process.argv[3] as 'length' | 'id' | 'gc' | 'quality') || 'length';
  const order = (process.argv[4] as 'asc' | 'desc') || 'asc';

  if (!inputFile) {
    console.error('Usage: bun run examples/seqkit-sort.ts <input.fasta> [sortBy] [order]');
    console.error('');
    console.error('Arguments:');
    console.error('  input.fasta  Input FASTA file');
    console.error('  sortBy       Sort criterion: length|id|gc|quality (default: length)');
    console.error('  order        Sort order: asc|desc (default: asc)');
    console.error('');
    console.error('Examples:');
    console.error('  bun run examples/seqkit-sort.ts sample.fasta length desc  # Longest first');
    console.error('  bun run examples/seqkit-sort.ts sample.fasta id asc       # Alphabetical');
    console.error('  bun run examples/seqkit-sort.ts sample.fasta gc desc      # High GC first');
    console.error('');
    console.error(
      'Note: Sorting by length/GC optimizes compression ratios for genomic data storage.'
    );
    process.exit(1);
  }

  const validSortFields = ['length', 'id', 'gc', 'quality'];
  if (!validSortFields.includes(sortBy)) {
    console.error(
      `Error: Invalid sort field '${sortBy}'. Valid options: ${validSortFields.join(', ')}`
    );
    process.exit(1);
  }

  const validOrders = ['asc', 'desc'];
  if (!validOrders.includes(order)) {
    console.error(`Error: Invalid sort order '${order}'. Valid options: ${validOrders.join(', ')}`);
    process.exit(1);
  }

  try {
    // Parse input file
    const parser = new FastaParser();
    const sequences = parser.parseFile(inputFile);

    // Apply high-performance sorting optimized for genomic data
    const sorted = seqops(sequences).sort({ by: sortBy, order });

    // Output sorted sequences with compression optimization
    let outputCount = 0;
    for await (const seq of sorted) {
      console.log(`>${seq.id}${seq.description ? ' ' + seq.description : ''}`);
      console.log(seq.sequence);
      outputCount++;
    }

    console.error(`\nSorted ${outputCount} sequences by ${sortBy} (${order}ending order)`);
    console.error(`Genomic benefit: Improved compression ratio through sequence clustering`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
