#!/usr/bin/env bun

/**
 * Demonstrates SeqOps 'translate' command functionality using Genotype library
 *
 * Usage: bun run examples/seqkit-translate.ts input.fasta [mode] [code]
 *
 * Equivalent to: seqkit translate input.fasta
 *
 * Examples:
 *   bun run examples/seqkit-translate.ts sample.fasta
 *   bun run examples/seqkit-translate.ts sample.fasta mito
 *   bun run examples/seqkit-translate.ts sample.fasta all-frames
 *   bun run examples/seqkit-translate.ts sample.fasta orfs 2
 */

import { FastaParser, seqops } from '../src';

async function main() {
  const inputFile = process.argv[2];
  const mode = process.argv[3] || 'standard';
  const geneticCode = parseInt(process.argv[4] || '1', 10);

  if (!inputFile) {
    console.error('Usage: bun run examples/seqkit-translate.ts <input.fasta> [mode] [code]');
    console.error('');
    console.error('Arguments:');
    console.error('  input.fasta  Input FASTA file with DNA/RNA sequences');
    console.error(
      '  mode         Translation mode: standard|mito|all-frames|orfs (default: standard)'
    );
    console.error('  code         Genetic code 1-33 (default: 1 = Standard, or 2 for mito mode)');
    console.error('');
    console.error('Examples:');
    console.error('  bun run examples/seqkit-translate.ts sample.fasta');
    console.error('  bun run examples/seqkit-translate.ts mito.fasta mito');
    console.error('  bun run examples/seqkit-translate.ts sample.fasta all-frames');
    console.error('  bun run examples/seqkit-translate.ts sample.fasta orfs 11');
    process.exit(1);
  }

  try {
    // Parse input file
    const parser = new FastaParser();
    const sequences = parser.parseFile(inputFile);

    // Apply translation using progressive disclosure API
    let translated;
    switch (mode) {
      case 'mito':
        console.error('Using mitochondrial genetic code (2)');
        translated = seqops(sequences).translateMito();
        break;

      case 'all-frames':
        console.error(`Translating all 6 frames with genetic code ${geneticCode}`);
        translated = seqops(sequences).translateAllFrames(geneticCode);
        break;

      case 'orfs':
        console.error(`Finding ORFs (30+ amino acids) with genetic code ${geneticCode}`);
        translated = seqops(sequences).translateOrf(30, geneticCode);
        break;

      case 'standard':
      default:
        console.error(`Translating frame +1 with genetic code ${geneticCode}`);
        translated = seqops(sequences).translate(geneticCode);
        break;
    }

    // Output results in FASTA format
    let sequenceCount = 0;
    let totalLength = 0;

    for await (const seq of translated) {
      console.log(`>${seq.id}${seq.description ? ' ' + seq.description : ''}`);
      console.log(seq.sequence);
      sequenceCount++;
      totalLength += seq.length;
    }

    console.error(
      `\nTranslated ${sequenceCount} sequences (${totalLength.toLocaleString()} amino acids total)`
    );
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
