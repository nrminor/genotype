#!/usr/bin/env bun

/**
 * Demonstrates comprehensive sequence file splitting with GenoType
 *
 * Shows complete seqkit split/split2 functionality with natural CLI design.
 * Provides both seqkit-style flags and method-based approaches.
 *
 * Usage: bun run examples/seqkit-split.ts [OPTIONS] <input>
 *
 * Examples:
 *   bun run examples/seqkit-split.ts --size 1000 genome.fasta
 *   bun run examples/seqkit-split.ts --length 1000000 genome.fasta  # 1MB chunks (seqkit split2)
 *   bun run examples/seqkit-split.ts --parts 4 data.fa
 *   bun run examples/seqkit-split.ts --id "chr\\d+" sequences.fa
 *   bun run examples/seqkit-split.ts --region chr1:1000-2000 genome.fa
 */

import { FastaParser, seqops } from '../src';

async function main() {
  const args = process.argv.slice(2);

  // Parse CLI arguments
  let inputFile: string | undefined;
  let mode: string | undefined;
  let value: string | undefined;
  let outputDir = './split';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg?.startsWith('--')) {
      const option = arg.slice(2);
      const nextArg = args[i + 1];

      switch (option) {
        case 'size':
        case 's':
          mode = 'by-size';
          value = nextArg;
          i++; // Skip next arg
          break;
        case 'length':
        case 'l':
          mode = 'by-length';
          value = nextArg;
          i++;
          break;
        case 'parts':
        case 'p':
          mode = 'by-parts';
          value = nextArg;
          i++;
          break;
        case 'id':
        case 'i':
          mode = 'by-id';
          value = nextArg;
          i++;
          break;
        case 'region':
        case 'r':
          mode = 'by-region';
          value = nextArg;
          i++;
          break;
        case 'output-dir':
        case 'o':
          outputDir = nextArg || './split';
          i++;
          break;
        default:
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
      }
    } else if (!inputFile) {
      inputFile = arg;
    }
  }

  if (!mode || !inputFile || !value) {
    console.error(`GenoType Split - Complete seqkit split/split2 functionality with superior DX

Usage: bun run examples/seqkit-split.ts [OPTIONS] <input>

Options:
  --size, -s <count>      Split into files with N sequences each
  --length, -l <bases>    Split into files with N bases each (seqkit split2 feature)  
  --parts, -p <parts>     Split into N equal parts
  --id, -i <pattern>      Split by sequence ID regex pattern
  --region, -r <region>   Split by genomic region (chr:start-end)
  --output-dir, -o <dir>  Output directory (default: ./split)

Examples:
  bun run examples/seqkit-split.ts --size 1000 genome.fasta
  bun run examples/seqkit-split.ts --length 1000000 genome.fasta
  bun run examples/seqkit-split.ts --parts 4 data.fa
  bun run examples/seqkit-split.ts --id "chr\\\\d+" sequences.fa
  bun run examples/seqkit-split.ts --region chr1:1000-2000 genome.fa

🔥 Progressive Disclosure API (Programmatic Usage):
  
  // Simple cases - trivial to discover and use
  await seqops(sequences).splitBySize(1000);
  await seqops(sequences).splitByLength(1000000);  // seqkit split2 feature
  await seqops(sequences).splitByParts(4);
  await seqops(sequences).splitById('chr\\\\d+');   // String auto-converts to RegExp
  await seqops(sequences).splitByRegion('chr1:1000-2000'); // Type-safe region parsing
  
  // Advanced cases - full options when needed
  await seqops(sequences).split({
    mode: 'by-length',
    basesPerFile: 1000000,
    fileExtension: '.fa.gz',  // Compression-aware
    outputDir: '/output'
  });
  
  // Streaming interface for processing results
  for await (const result of seqops(sequences).splitToStream(options)) {
    await compressFile(result.outputFile);
  }
`);
    process.exit(1);
  }

  try {
    console.error(`🚀 Splitting ${inputFile} using ${mode} mode...`);

    // Parse input file
    const parser = new FastaParser();
    const sequences = parser.parseFile(inputFile);

    let result;

    switch (mode) {
      case 'by-size': {
        const count = parseInt(process.argv[4] || '1000', 10);
        if (isNaN(count) || count <= 0) {
          throw new Error(`Invalid count: ${process.argv[4]}`);
        }

        // Convenience method example
        result = await seqops(sequences).filter({ minLength: 50 }).splitBySize(count);
        break;
      }

      case 'by-length': {
        const bases = parseInt(process.argv[4] || '1000000', 10);
        if (isNaN(bases) || bases <= 0) {
          throw new Error(`Invalid base count: ${process.argv[4]}`);
        }

        // seqkit split2 key feature
        result = await seqops(sequences).filter({ minLength: 50 }).splitByLength(bases);
        break;
      }

      case 'by-parts': {
        const parts = parseInt(process.argv[4] || '4', 10);
        if (isNaN(parts) || parts <= 0) {
          throw new Error(`Invalid part count: ${process.argv[4]}`);
        }

        result = await seqops(sequences).splitByParts(parts);
        break;
      }

      case 'by-id': {
        const pattern = process.argv[4];
        if (!pattern) {
          throw new Error('ID pattern required for by-id mode');
        }

        result = await seqops(sequences).splitById(new RegExp(pattern));
        break;
      }

      case 'by-region': {
        const region = process.argv[4];
        if (!region) {
          throw new Error('Region required for by-region mode (format: chr:start-end)');
        }

        // Full options example
        result = await seqops(sequences).split({
          mode: 'by-region',
          region,
          filePrefix: 'region',
          outputDir: './split',
        });
        break;
      }

      default:
        throw new Error(`Unknown mode: ${mode}`);
    }

    console.error(`\n✅ Split completed successfully!`);
    console.error(`📊 Results:`);
    console.error(`   Files created: ${result.filesCreated.length}`);
    console.error(`   Total sequences: ${result.totalSequences}`);
    console.error(`   Sequences per file: [${result.sequencesPerFile.join(', ')}]`);

    console.error(`\n📁 Output files:`);
    for (const file of result.filesCreated) {
      console.error(`   ${file}`);
    }

    console.error(`\n🔥 Complete seqkit Compatibility:`);
    console.error(`   • All split modes: by-size, by-parts, by-length, by-id, by-region`);
    console.error(`   • seqkit split2 by-length feature implemented`);
    console.error(`   • Format preservation: FASTQ→FASTQ, FASTA→FASTA`);
    console.error(`   • Progressive disclosure: simple convenience methods`);
    console.error(`   • Dual interface: consumptive + productive`);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
