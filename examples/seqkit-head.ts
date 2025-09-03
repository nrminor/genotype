#!/usr/bin/env bun

/**
 * Demonstrates SeqOps 'head' command functionality using Genotype library
 *
 * Extract the first N sequences from a file, similar to Unix 'head' but for
 * biological sequences. Useful for previewing large datasets, testing pipelines,
 * or extracting representative samples.
 *
 * Usage: bun run examples/seqkit-head.ts input.fasta [count]
 *
 * Equivalent to: seqkit head -n 10 input.fasta
 *
 * Examples:
 *   bun run examples/seqkit-head.ts genome.fasta 10
 *   bun run examples/seqkit-head.ts reads.fastq 1000
 *   bun run examples/seqkit-head.ts assembly.fa 5 --stats
 *   bun run examples/seqkit-head.ts large_dataset.fa 100 --preview
 */

import { FastaParser, FastqParser, seqops } from "../src";

interface HeadOptions {
  count: number;
  stats?: boolean;
  preview?: boolean;
  lengths?: boolean;
}

function parseArguments(): { inputFile: string; options: HeadOptions } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const inputFile = args[0];
  let count = 10; // Default to 10 sequences
  const options: HeadOptions = { count };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--stats":
      case "-s":
        options.stats = true;
        break;
      case "--preview":
      case "-p":
        options.preview = true;
        break;
      case "--lengths":
      case "-l":
        options.lengths = true;
        break;
      default: {
        // Try to parse as count
        const maybeCount = parseInt(arg, 10);
        if (!isNaN(maybeCount) && maybeCount > 0) {
          count = maybeCount;
          options.count = count;
        } else {
          console.error(`Error: Unknown option '${arg}' or invalid count`);
          process.exit(1);
        }
      }
    }
  }

  return { inputFile, options };
}

function showHelp(): void {
  console.error(`SeqOps Head Operation Tool

Usage: bun run examples/seqkit-head.ts <input.fasta|input.fastq> [count] [options]

Extract the first N sequences from a file, similar to Unix 'head' command.
Perfect for previewing large datasets or extracting samples for testing.

ARGUMENTS:
  input.fasta|input.fastq   Input sequence file (FASTA or FASTQ)
  count                     Number of sequences to extract (default: 10)

OPTIONS:
  --stats, -s              Show statistics for extracted sequences
  --preview, -p            Show preview information (truncated sequences)  
  --lengths, -l            Show length information for each sequence

Examples:
  # Extract first 10 sequences (default)
  bun run examples/seqkit-head.ts genome.fasta

  # Extract first 100 sequences
  bun run examples/seqkit-head.ts reads.fastq 100

  # Preview mode - show first 5 with stats
  bun run examples/seqkit-head.ts assembly.fasta 5 --stats --preview
  
  # Show length information
  bun run examples/seqkit-head.ts sequences.fa 20 --lengths

  # Quick dataset peek with comprehensive info
  bun run examples/seqkit-head.ts large_file.fasta 3 --preview --stats --lengths

Use Cases:
  • Preview large datasets before processing
  • Extract samples for pipeline testing  
  • Quick quality checks on new files
  • Generate small test datasets from large files
  • Examine file structure and format

Performance:
  • Streaming implementation - stops after N sequences
  • Memory efficient - doesn't load entire file
  • Fast execution even on huge datasets

Output Format:
  Standard: Complete sequences in FASTA/FASTQ format
  Preview:  Truncated sequences (first 50 bp) with "..." indicator
  Stats:    Summary statistics for extracted sequences
  Lengths:  Length information alongside sequence headers
`);
}

function truncateSequence(sequence: string, maxLength: number = 50): string {
  if (sequence.length <= maxLength) {
    return sequence;
  }
  return sequence.substring(0, maxLength) + "...";
}

function formatLength(length: number): string {
  if (length >= 1_000_000) {
    return `${(length / 1_000_000).toFixed(1)}Mb`;
  } else if (length >= 1_000) {
    return `${(length / 1_000).toFixed(1)}kb`;
  }
  return `${length}bp`;
}

async function main(): Promise<void> {
  const { inputFile, options } = parseArguments();

  try {
    // Auto-detect format and create appropriate parser
    let sequences: AsyncIterable<any>;
    let detectedFormat = "FASTA";

    if (inputFile.toLowerCase().includes(".fq") || inputFile.toLowerCase().includes(".fastq")) {
      console.error(`📄 Detected FASTQ format`);
      const parser = new FastqParser();
      sequences = parser.parseFile(inputFile);
      detectedFormat = "FASTQ";
    } else {
      console.error(`📄 Detected FASTA format`);
      const parser = new FastaParser();
      sequences = parser.parseFile(inputFile);
    }

    console.error(`🔝 Extracting first ${options.count} sequences...`);

    // Extract first N sequences using SeqOps
    const startTime = performance.now();
    const headSequences = seqops(sequences).head(options.count);

    // Process and output sequences
    let extractedCount = 0;
    let totalLength = 0;
    let minLength = Number.MAX_SAFE_INTEGER;
    let maxLength = 0;
    const lengths: number[] = [];

    for await (const seq of headSequences) {
      extractedCount++;
      totalLength += seq.length;
      minLength = Math.min(minLength, seq.length);
      maxLength = Math.max(maxLength, seq.length);
      lengths.push(seq.length);

      // Output sequence header
      if (options.lengths) {
        const lengthInfo = `[${formatLength(seq.length)}]`;
        console.log(`>${seq.id} ${lengthInfo}${seq.description ? " " + seq.description : ""}`);
      } else {
        console.log(`>${seq.id}${seq.description ? " " + seq.description : ""}`);
      }

      // Output sequence (truncated if preview mode)
      if (options.preview) {
        console.log(truncateSequence(seq.sequence));
      } else {
        console.log(seq.sequence);
      }

      // Output quality if FASTQ
      if (detectedFormat === "FASTQ" && "quality" in seq) {
        console.log("+");
        if (options.preview) {
          console.log(truncateSequence(seq.quality as string));
        } else {
          console.log(seq.quality);
        }
      }
    }

    const endTime = performance.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);

    // Show statistics if requested
    if (options.stats && extractedCount > 0) {
      const avgLength = Math.round(totalLength / extractedCount);

      console.error(`\n📊 Statistics for extracted sequences:`);
      console.error(`   Count:          ${extractedCount}`);
      console.error(`   Total length:   ${formatLength(totalLength)}`);
      console.error(`   Average length: ${formatLength(avgLength)}`);
      console.error(`   Shortest:       ${formatLength(minLength)}`);
      console.error(`   Longest:        ${formatLength(maxLength)}`);

      if (extractedCount >= 3) {
        lengths.sort((a, b) => a - b);
        const median =
          extractedCount % 2 === 0
            ? (lengths[Math.floor(extractedCount / 2) - 1] +
                lengths[Math.floor(extractedCount / 2)]) /
              2
            : lengths[Math.floor(extractedCount / 2)];
        console.error(`   Median length:  ${formatLength(Math.round(median))}`);
      }

      if (detectedFormat === "FASTQ") {
        console.error(`   Format:         FASTQ with quality scores`);
      }
    }

    // Processing summary
    console.error(`\n✅ Extraction completed`);
    console.error(`   Processed: ${extractedCount} sequences in ${processingTime}s`);

    if (extractedCount < options.count) {
      console.error(
        `   ⚠️  File contained only ${extractedCount} sequences (requested ${options.count})`
      );
    }

    // Helpful tips based on usage
    if (extractedCount > 0) {
      if (!options.preview && !options.stats && extractedCount >= 5) {
        console.error(`   💡 Tip: Use --preview --stats for quick overview of large files`);
      }

      if (detectedFormat === "FASTQ" && !options.stats) {
        console.error(`   💡 Tip: Use --stats to see quality information`);
      }

      if (extractedCount === options.count) {
        console.error(`   💡 Results suitable for pipeline testing or format validation`);
      }
    }

    // Performance note for large extractions
    if (options.count >= 1000) {
      const throughput = Math.round(extractedCount / parseFloat(processingTime));
      console.error(`   📈 Throughput: ${throughput.toLocaleString()} sequences/second`);
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("ENOENT")) {
        console.error(`Error: File '${inputFile}' not found`);
        console.error(`Check that the file exists and the path is correct.`);
      } else if (error.message.includes("permission")) {
        console.error(`Error: Permission denied reading '${inputFile}'`);
        console.error(`Check file permissions.`);
      } else {
        console.error(`Error: ${error.message}`);
      }
    } else {
      console.error(`Error: ${String(error)}`);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
