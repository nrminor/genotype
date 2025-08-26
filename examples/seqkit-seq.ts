#!/usr/bin/env bun

/**
 * Demonstrates SeqOps 'seq' command functionality using Genotype library
 *
 * This script replaces SeqKit's monolithic 'seq' command with the superior
 * Unix philosophy approach: focused, single-responsibility operations that
 * compose beautifully for complex sequence processing workflows.
 *
 * Usage: bun run examples/seqkit-seq.ts input.fasta [options]
 *
 * Equivalent to: seqkit seq -r -p -u -m 100 -M 1000 --validate-seq input.fasta
 *
 * Examples:
 *   bun run examples/seqkit-seq.ts sample.fasta --reverse-complement --upper
 *   bun run examples/seqkit-seq.ts sample.fasta --min-length 100 --max-length 1000
 *   bun run examples/seqkit-seq.ts reads.fastq --quality-filter --trim --clean
 *   bun run examples/seqkit-seq.ts mixed.fa --rna-to-dna --validate-strict
 */

import { FastaParser, FastqParser, seqops } from '../src';

interface SeqOptions {
  // Transformation options
  reverse?: boolean;
  complement?: boolean;
  reverseComplement?: boolean;
  upper?: boolean;
  lower?: boolean;
  rnaToDna?: boolean;
  dnaToRna?: boolean;

  // Filtering options
  minLength?: number;
  maxLength?: number;
  minGC?: number;
  maxGC?: number;

  // Quality options (FASTQ only)
  qualityFilter?: boolean;
  minQuality?: number;
  trim?: boolean;
  trimThreshold?: number;

  // Cleaning options
  clean?: boolean;
  removeGaps?: boolean;
  replaceAmbiguous?: boolean;
  replaceChar?: string;

  // Validation options
  validate?: boolean;
  validateStrict?: boolean;
}

function parseArguments(): { inputFile: string; options: SeqOptions } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const inputFile = args[0];
  const options: SeqOptions = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      // Transformation flags
      case '--reverse':
      case '-r':
        options.reverse = true;
        break;
      case '--complement':
      case '-p':
        options.complement = true;
        break;
      case '--reverse-complement':
      case '-rp':
        options.reverseComplement = true;
        break;
      case '--upper':
      case '-u':
        options.upper = true;
        break;
      case '--lower':
      case '-l':
        options.lower = true;
        break;
      case '--rna-to-dna':
        options.rnaToDna = true;
        break;
      case '--dna-to-rna':
        options.dnaToRna = true;
        break;

      // Filtering options with values
      case '--min-length':
      case '-m':
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric value`);
          process.exit(1);
        }
        options.minLength = Number(nextArg);
        i++;
        break;
      case '--max-length':
      case '-M':
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric value`);
          process.exit(1);
        }
        options.maxLength = Number(nextArg);
        i++;
        break;
      case '--min-gc':
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric value (0-100)`);
          process.exit(1);
        }
        options.minGC = Number(nextArg);
        i++;
        break;
      case '--max-gc':
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric value (0-100)`);
          process.exit(1);
        }
        options.maxGC = Number(nextArg);
        i++;
        break;

      // Quality options
      case '--quality-filter':
        options.qualityFilter = true;
        break;
      case '--min-quality':
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric value`);
          process.exit(1);
        }
        options.minQuality = Number(nextArg);
        i++;
        break;
      case '--trim':
        options.trim = true;
        break;
      case '--trim-threshold':
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric value`);
          process.exit(1);
        }
        options.trimThreshold = Number(nextArg);
        i++;
        break;

      // Cleaning options
      case '--clean':
        options.clean = true;
        break;
      case '--remove-gaps':
        options.removeGaps = true;
        break;
      case '--replace-ambiguous':
        options.replaceAmbiguous = true;
        break;
      case '--replace-char':
        if (!nextArg) {
          console.error(`Error: ${arg} requires a character value`);
          process.exit(1);
        }
        options.replaceChar = nextArg;
        i++;
        break;

      // Validation options
      case '--validate':
        options.validate = true;
        break;
      case '--validate-strict':
        options.validateStrict = true;
        break;

      default:
        console.error(`Error: Unknown option '${arg}'`);
        process.exit(1);
    }
  }

  return { inputFile, options };
}

function showHelp(): void {
  console.error(`SeqOps Sequence Processing Tool

Usage: bun run examples/seqkit-seq.ts <input.fasta|input.fastq> [options]

Replaces SeqKit's monolithic 'seq' command with composable operations following
Unix philosophy: each operation does exactly one thing well.

TRANSFORMATION OPTIONS:
  --reverse, -r              Reverse sequences
  --complement, -p           Complement sequences  
  --reverse-complement, -rp  Reverse complement sequences
  --upper, -u               Convert to uppercase
  --lower, -l               Convert to lowercase
  --rna-to-dna              Convert RNA (U) to DNA (T)
  --dna-to-rna              Convert DNA (T) to RNA (U)

FILTERING OPTIONS:
  --min-length, -m <n>      Minimum sequence length
  --max-length, -M <n>      Maximum sequence length  
  --min-gc <n>              Minimum GC content (0-100)
  --max-gc <n>              Maximum GC content (0-100)

QUALITY OPTIONS (FASTQ only):
  --quality-filter          Filter by average quality score
  --min-quality <n>         Minimum quality score threshold
  --trim                    Trim low-quality ends
  --trim-threshold <n>      Quality score threshold for trimming

CLEANING OPTIONS:
  --clean                   Enable comprehensive cleaning
  --remove-gaps             Remove gap characters (-, .)
  --replace-ambiguous       Replace ambiguous bases with standard bases
  --replace-char <c>        Character to use for replacement (default: N)

VALIDATION OPTIONS:
  --validate                Validate sequences (permissive mode)
  --validate-strict         Strict validation (standard bases only)

Examples:
  # Basic reverse complement
  bun run examples/seqkit-seq.ts genome.fasta --reverse-complement --upper

  # Length filtering with case conversion
  bun run examples/seqkit-seq.ts sequences.fa --min-length 100 --max-length 1000 --upper
  
  # FASTQ quality control pipeline  
  bun run examples/seqkit-seq.ts reads.fq --quality-filter --min-quality 20 --trim --clean
  
  # Complex cleaning and validation
  bun run examples/seqkit-seq.ts mixed.fa --remove-gaps --replace-ambiguous --validate-strict
  
  # RNA processing
  bun run examples/seqkit-seq.ts rna.fa --rna-to-dna --reverse-complement --validate

Advantages over SeqKit:
  • Clear separation of concerns (filter, transform, clean, validate)
  • Type-safe operations with IntelliSense support  
  • Streaming architecture for memory efficiency
  • Composable operations that read like English
  • Better error messages with suggestions
`);
}

async function main(): Promise<void> {
  const { inputFile, options } = parseArguments();

  try {
    // Auto-detect format and create appropriate parser
    let sequences: AsyncIterable<any>;
    if (inputFile.toLowerCase().includes('.fq') || inputFile.toLowerCase().includes('.fastq')) {
      console.error('Detected FASTQ format');
      const parser = new FastqParser();
      sequences = parser.parseFile(inputFile);
    } else {
      console.error('Detected FASTA format');
      const parser = new FastaParser();
      sequences = parser.parseFile(inputFile);
    }

    // Build pipeline using Unix philosophy: single responsibility operations
    let pipeline = seqops(sequences);

    // Step 1: Filtering operations (remove unwanted sequences)
    if (
      options.minLength !== undefined ||
      options.maxLength !== undefined ||
      options.minGC !== undefined ||
      options.maxGC !== undefined
    ) {
      pipeline = pipeline.filter({
        ...(options.minLength !== undefined && { minLength: options.minLength }),
        ...(options.maxLength !== undefined && { maxLength: options.maxLength }),
        ...(options.minGC !== undefined && { minGC: options.minGC }),
        ...(options.maxGC !== undefined && { maxGC: options.maxGC }),
      });
    }

    // Step 2: Quality operations (FASTQ-specific)
    if (options.qualityFilter || options.minQuality !== undefined || options.trim) {
      pipeline = pipeline.quality({
        ...(options.minQuality !== undefined && { minScore: options.minQuality }),
        ...(options.trim && {
          trim: true,
          trimThreshold: options.trimThreshold || 20,
          trimWindow: 4,
        }),
      });
    }

    // Step 3: Cleaning operations (fix sequence issues)
    if (options.clean || options.removeGaps || options.replaceAmbiguous) {
      pipeline = pipeline.clean({
        ...(options.removeGaps && { removeGaps: true }),
        ...(options.replaceAmbiguous && {
          replaceAmbiguous: true,
          replaceChar: options.replaceChar || 'N',
        }),
      });
    }

    // Step 4: Transformation operations (modify sequences)
    if (
      options.reverse ||
      options.complement ||
      options.reverseComplement ||
      options.upper ||
      options.lower ||
      options.rnaToDna ||
      options.dnaToRna
    ) {
      pipeline = pipeline.transform({
        ...(options.reverse && { reverse: true }),
        ...(options.complement && { complement: true }),
        ...(options.reverseComplement && { reverseComplement: true }),
        ...(options.upper && { upperCase: true }),
        ...(options.lower && { lowerCase: true }),
        ...(options.rnaToDna && { toDNA: true }),
        ...(options.dnaToRna && { toRNA: true }),
      });
    }

    // Step 5: Validation operations (ensure quality)
    if (options.validate || options.validateStrict) {
      pipeline = pipeline.validate({
        mode: options.validateStrict ? 'strict' : 'normal',
        action: 'reject',
      });
    }

    // Execute pipeline and output results
    let processedCount = 0;
    let outputCount = 0;
    let totalInputLength = 0;
    let totalOutputLength = 0;

    for await (const seq of pipeline) {
      // Output sequence in FASTA format
      console.log(`>${seq.id}${seq.description ? ' ' + seq.description : ''}`);
      console.log(seq.sequence);

      outputCount++;
      totalOutputLength += seq.length;
    }

    // Report statistics to stderr
    console.error(`\nProcessing completed successfully`);
    console.error(`Output sequences: ${outputCount}`);
    console.error(`Total output length: ${totalOutputLength.toLocaleString()} bp`);

    if (outputCount > 0) {
      console.error(`Average length: ${Math.round(totalOutputLength / outputCount)} bp`);
    }

    // Show applied operations for clarity
    const appliedOps: string[] = [];
    if (options.minLength || options.maxLength || options.minGC || options.maxGC) {
      appliedOps.push('filtering');
    }
    if (options.qualityFilter || options.trim) {
      appliedOps.push('quality control');
    }
    if (options.clean || options.removeGaps || options.replaceAmbiguous) {
      appliedOps.push('cleaning');
    }
    if (
      options.reverse ||
      options.complement ||
      options.reverseComplement ||
      options.upper ||
      options.lower ||
      options.rnaToDna ||
      options.dnaToRna
    ) {
      appliedOps.push('transformation');
    }
    if (options.validate || options.validateStrict) {
      appliedOps.push('validation');
    }

    if (appliedOps.length > 0) {
      console.error(`Applied operations: ${appliedOps.join(' → ')}`);
    }

    console.error(`\n✨ Unix philosophy in action: clear, composable operations`);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
