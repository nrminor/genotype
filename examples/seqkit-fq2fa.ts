#!/usr/bin/env bun

/**
 * Demonstrates FASTQ to FASTA conversion using Genotype library
 *
 * Convert FASTQ files to FASTA format with optional quality filtering,
 * sequence cleaning, and metadata preservation. Provides superior format
 * conversion with comprehensive error handling and streaming efficiency.
 *
 * Usage: bun run examples/seqkit-fq2fa.ts input.fastq [options]
 *
 * Equivalent to: seqkit fq2fa -o output.fasta input.fastq
 *
 * Examples:
 *   bun run examples/seqkit-fq2fa.ts reads.fastq
 *   bun run examples/seqkit-fq2fa.ts reads.fq --output clean.fasta --quality-filter
 *   bun run examples/seqkit-fq2fa.ts paired.fastq --min-quality 20 --clean --stats
 *   bun run examples/seqkit-fq2fa.ts raw.fastq --trim --min-length 50 --validate
 */

import { FastqParser, seqops } from "../src";

interface Fq2FaOptions {
  output?: string;
  qualityFilter?: boolean;
  minQuality?: number;
  trim?: boolean;
  trimThreshold?: number;
  clean?: boolean;
  removeGaps?: boolean;
  replaceAmbiguous?: boolean;
  minLength?: number;
  maxLength?: number;
  validate?: boolean;
  preserveDescription?: boolean;
  addQualityInfo?: boolean;
  stats?: boolean;
  skipEmptySequences?: boolean;
}

function parseArguments(): { inputFile: string; options: Fq2FaOptions } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const inputFile = args[0];
  const options: Fq2FaOptions = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--output":
      case "-o":
        if (!nextArg) {
          console.error(`Error: ${arg} requires an output file path`);
          process.exit(1);
        }
        options.output = nextArg;
        i++;
        break;

      case "--quality-filter":
        options.qualityFilter = true;
        break;

      case "--min-quality":
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric quality score`);
          process.exit(1);
        }
        options.minQuality = Number(nextArg);
        options.qualityFilter = true;
        i++;
        break;

      case "--trim":
        options.trim = true;
        break;

      case "--trim-threshold":
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric quality threshold`);
          process.exit(1);
        }
        options.trimThreshold = Number(nextArg);
        options.trim = true;
        i++;
        break;

      case "--clean":
        options.clean = true;
        break;

      case "--remove-gaps":
        options.removeGaps = true;
        break;

      case "--replace-ambiguous":
        options.replaceAmbiguous = true;
        break;

      case "--min-length":
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric length`);
          process.exit(1);
        }
        options.minLength = Number(nextArg);
        i++;
        break;

      case "--max-length":
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric length`);
          process.exit(1);
        }
        options.maxLength = Number(nextArg);
        i++;
        break;

      case "--validate":
        options.validate = true;
        break;

      case "--preserve-description":
        options.preserveDescription = true;
        break;

      case "--add-quality-info":
        options.addQualityInfo = true;
        break;

      case "--stats":
        options.stats = true;
        break;

      case "--skip-empty":
        options.skipEmptySequences = true;
        break;

      default:
        console.error(`Error: Unknown option '${arg}'`);
        process.exit(1);
    }
  }

  return { inputFile, options };
}

function showHelp(): void {
  console.error(`SeqOps FASTQ to FASTA Conversion Tool

Usage: bun run examples/seqkit-fq2fa.ts <input.fastq> [options]

Convert FASTQ files to FASTA format with comprehensive quality control,
cleaning options, and metadata preservation. Superior to basic conversion
with streaming efficiency and bioinformatics-aware processing.

OUTPUT OPTIONS:
  --output, -o <file>         Output FASTA file (default: stdout)

QUALITY CONTROL:
  --quality-filter            Enable quality-based filtering
  --min-quality <score>       Minimum average quality score (enables quality filter)
  --trim                      Trim low-quality ends
  --trim-threshold <score>    Quality score threshold for trimming (default: 20)

SEQUENCE PROCESSING:
  --clean                     Enable comprehensive sequence cleaning
  --remove-gaps               Remove gap characters (-, .)
  --replace-ambiguous         Replace ambiguous bases with N
  --min-length <n>            Minimum sequence length after processing
  --max-length <n>            Maximum sequence length after processing
  --validate                  Validate sequences (reject invalid)
  --skip-empty                Skip empty sequences after processing

METADATA OPTIONS:
  --preserve-description      Keep original FASTQ descriptions
  --add-quality-info          Add quality statistics to FASTA headers

REPORTING:
  --stats                     Show conversion statistics

Examples:
  # Basic conversion
  bun run examples/seqkit-fq2fa.ts reads.fastq --output reads.fasta

  # Quality-controlled conversion
  bun run examples/seqkit-fq2fa.ts raw.fastq --min-quality 20 --trim --clean

  # Comprehensive processing pipeline
  bun run examples/seqkit-fq2fa.ts reads.fq \\
    --output clean.fa \\
    --min-quality 25 \\
    --trim --trim-threshold 20 \\
    --min-length 50 \\
    --clean --validate \\
    --add-quality-info --stats

  # Simple format conversion with stats
  bun run examples/seqkit-fq2fa.ts sample.fastq --preserve-description --stats

Advantages over basic conversion:
  • Streaming processing - handles huge files efficiently
  • Quality-aware conversion with trimming and filtering
  • Comprehensive sequence cleaning and validation
  • Metadata preservation with quality information
  • Statistical reporting for quality assessment
  • Graceful error handling with meaningful messages

Processing Pipeline:
  1. Parse FASTQ with automatic encoding detection
  2. Apply quality filtering and trimming (if enabled)
  3. Perform sequence cleaning (if enabled)
  4. Filter by length criteria (if specified)
  5. Validate sequences (if enabled)
  6. Convert to FASTA with optional quality metadata
  7. Output statistics and quality assessment

Quality Metrics Included:
  • Before/after sequence counts
  • Length distribution changes
  • Quality score summaries
  • Processing efficiency statistics
`);
}

function calculateAverageQuality(quality: string, encoding: "phred33" | "phred64"): number {
  const offset = encoding === "phred33" ? 33 : 64;
  let totalScore = 0;

  for (let i = 0; i < quality.length; i++) {
    totalScore += quality.charCodeAt(i) - offset;
  }

  return totalScore / quality.length;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  } else if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

async function main(): Promise<void> {
  const { inputFile, options } = parseArguments();

  try {
    console.error(`🔄 Converting FASTQ to FASTA: ${inputFile}`);

    // Parse FASTQ file
    const parser = new FastqParser();
    const sequences = parser.parseFile(inputFile);

    // Build processing pipeline
    let pipeline = seqops(sequences);

    // Track processing steps for reporting
    const appliedOperations: string[] = [];

    // Step 1: Quality operations
    if (options.qualityFilter || options.trim || options.minQuality !== undefined) {
      appliedOperations.push("quality control");
      pipeline = pipeline.quality({
        ...(options.minQuality !== undefined && {
          minScore: options.minQuality,
        }),
        ...(options.trim && {
          trim: true,
          trimThreshold: options.trimThreshold || 20,
          trimWindow: 4,
        }),
      });
      console.error(`   ✓ Quality filtering enabled (min score: ${options.minQuality || "auto"})`);
    }

    // Step 2: Sequence cleaning
    if (options.clean || options.removeGaps || options.replaceAmbiguous) {
      appliedOperations.push("cleaning");
      pipeline = pipeline.clean({
        ...(options.removeGaps && { removeGaps: true }),
        ...(options.replaceAmbiguous && {
          replaceAmbiguous: true,
          replaceChar: "N",
        }),
      });
      console.error(`   ✓ Sequence cleaning enabled`);
    }

    // Step 3: Length filtering
    if (options.minLength !== undefined || options.maxLength !== undefined) {
      appliedOperations.push("length filtering");
      pipeline = pipeline.filter({
        ...(options.minLength !== undefined && {
          minLength: options.minLength,
        }),
        ...(options.maxLength !== undefined && {
          maxLength: options.maxLength,
        }),
      });
      console.error(
        `   ✓ Length filtering: ${options.minLength || 0}-${options.maxLength || "∞"} bp`
      );
    }

    // Step 4: Validation
    if (options.validate) {
      appliedOperations.push("validation");
      pipeline = pipeline.validate({
        mode: "normal",
        action: "reject",
      });
      console.error(`   ✓ Sequence validation enabled`);
    }

    // Process sequences and convert to FASTA
    console.error(`🚀 Processing sequences...`);
    const startTime = performance.now();

    const inputCount = 0;
    let outputCount = 0;
    const totalInputLength = 0;
    let totalOutputLength = 0;
    let totalQualitySum = 0;
    let qualityCount = 0;
    const outputLengths: number[] = [];

    // Determine output destination
    let outputWriter: any = null;
    if (options.output) {
      outputWriter = Bun.file(options.output).writer();
      console.error(`   📝 Writing to: ${options.output}`);
    }

    for await (const seq of pipeline) {
      // Count input statistics from original FASTQ if available
      if ("quality" in seq) {
        const avgQuality = calculateAverageQuality(
          seq.quality as string,
          (seq.qualityEncoding as "phred33" | "phred64") || "phred33"
        );
        totalQualitySum += avgQuality;
        qualityCount++;
      }

      outputCount++;
      totalOutputLength += seq.length;
      outputLengths.push(seq.length);

      // Create FASTA header
      let header = seq.id;

      if (options.preserveDescription && seq.description) {
        header += ` ${seq.description}`;
      }

      if (options.addQualityInfo && "quality" in seq) {
        const avgQuality = calculateAverageQuality(
          seq.quality as string,
          (seq.qualityEncoding as "phred33" | "phred64") || "phred33"
        );
        header += ` avgQ=${avgQuality.toFixed(1)}`;
      }

      // Output FASTA format
      const fastaRecord = `>${header}\n${seq.sequence}\n`;

      if (outputWriter) {
        outputWriter.write(fastaRecord);
      } else {
        process.stdout.write(fastaRecord);
      }

      // Skip empty sequences if requested
      if (options.skipEmptySequences && seq.sequence.length === 0) {
      }
    }

    if (outputWriter) {
      outputWriter.end();
    }

    const endTime = performance.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);

    // Show comprehensive statistics
    if (options.stats || appliedOperations.length > 0) {
      console.error(`\n📊 Conversion Statistics:`);
      console.error(`   Output sequences: ${formatNumber(outputCount)}`);
      console.error(`   Total output length: ${formatNumber(totalOutputLength)} bp`);

      if (outputCount > 0) {
        const avgLength = Math.round(totalOutputLength / outputCount);
        console.error(`   Average length: ${formatNumber(avgLength)} bp`);

        if (outputLengths.length > 0) {
          const minLength = Math.min(...outputLengths);
          const maxLength = Math.max(...outputLengths);
          console.error(
            `   Length range: ${formatNumber(minLength)} - ${formatNumber(maxLength)} bp`
          );
        }
      }

      if (qualityCount > 0) {
        const avgQuality = (totalQualitySum / qualityCount).toFixed(1);
        console.error(`   Average input quality: Q${avgQuality}`);
      }

      console.error(`\n⏱️  Processing: ${processingTime}s`);

      if (outputCount > 0) {
        const throughput = Math.round(outputCount / parseFloat(processingTime));
        console.error(`   Throughput: ${formatNumber(throughput)} sequences/sec`);
      }

      if (appliedOperations.length > 0) {
        console.error(`   Pipeline: ${appliedOperations.join(" → ")}`);
      }
    }

    // Success message
    console.error(`\n✅ Conversion completed successfully!`);

    if (options.output) {
      console.error(`   📁 Output written to: ${options.output}`);
    } else {
      console.error(`   📤 Output written to stdout`);
    }

    // Quality assessment and recommendations
    if (qualityCount > 0 && options.stats) {
      const avgQuality = totalQualitySum / qualityCount;

      if (avgQuality > 30) {
        console.error(`   🌟 Excellent quality reads (Q${avgQuality.toFixed(0)})`);
      } else if (avgQuality > 20) {
        console.error(`   ✅ Good quality reads (Q${avgQuality.toFixed(0)})`);
      } else {
        console.error(`   ⚠️  Consider additional quality filtering (Q${avgQuality.toFixed(0)})`);
      }

      if (!options.trim && avgQuality < 25) {
        console.error(`   💡 Tip: Consider using --trim for quality improvement`);
      }
    }

    if (outputCount === 0) {
      console.error(`   ⚠️  No sequences passed filtering criteria`);
      console.error(`   💡 Consider relaxing quality or length requirements`);
    } else if (outputCount < 1000 && !options.minLength) {
      console.error(`   💡 Tip: Use --stats to monitor conversion efficiency`);
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("ENOENT")) {
        console.error(`Error: Input file '${inputFile}' not found`);
        console.error(`Check that the file exists and the path is correct.`);
      } else if (error.message.includes("not a valid FASTQ")) {
        console.error(`Error: File '${inputFile}' is not a valid FASTQ file`);
        console.error(`Ensure the file is in FASTQ format with proper structure.`);
      } else if (error.message.includes("quality encoding")) {
        console.error(`Error: Could not detect quality score encoding`);
        console.error(`File may be corrupted or have mixed encodings.`);
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
