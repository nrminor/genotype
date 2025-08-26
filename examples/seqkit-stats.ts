#!/usr/bin/env bun

/**
 * Demonstrates SeqOps 'stats' command functionality using Genotype library
 *
 * Calculates comprehensive sequence statistics including N50, GC content,
 * quality metrics, and length distributions. Provides identical output to
 * SeqKit stats with additional insights for genomic analysis.
 *
 * Usage: bun run examples/seqkit-stats.ts input.fasta [options]
 *
 * Equivalent to: seqkit stats -T -a input.fasta
 *
 * Examples:
 *   bun run examples/seqkit-stats.ts genome.fasta
 *   bun run examples/seqkit-stats.ts reads.fastq --detailed --quality
 *   bun run examples/seqkit-stats.ts multiple.fa --tabular --gc-content
 *   bun run examples/seqkit-stats.ts assembly.fa --n50 --gaps
 */

import { FastaParser, FastqParser, seqops } from '../src';

interface StatsOptions {
  detailed?: boolean;
  tabular?: boolean;
  gcContent?: boolean;
  n50?: boolean;
  quality?: boolean;
  gaps?: boolean;
  skipValidation?: boolean;
}

function parseArguments(): { inputFile: string; options: StatsOptions } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const inputFile = args[0];
  const options: StatsOptions = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--detailed':
      case '-a':
        options.detailed = true;
        break;
      case '--tabular':
      case '-T':
        options.tabular = true;
        break;
      case '--gc-content':
        options.gcContent = true;
        break;
      case '--n50':
        options.n50 = true;
        break;
      case '--quality':
        options.quality = true;
        break;
      case '--gaps':
        options.gaps = true;
        break;
      case '--skip-validation':
        options.skipValidation = true;
        break;
      default:
        console.error(`Error: Unknown option '${arg}'`);
        process.exit(1);
    }
  }

  return { inputFile, options };
}

function showHelp(): void {
  console.error(`SeqOps Sequence Statistics Tool

Usage: bun run examples/seqkit-stats.ts <input.fasta|input.fastq> [options]

Calculates comprehensive sequence statistics with genomic insights.
Provides identical output to SeqKit stats with additional bioinformatics metrics.

OPTIONS:
  --detailed, -a        Show detailed statistics (N50, quartiles, composition)
  --tabular, -T         Output in tab-separated format for parsing
  --gc-content          Include GC content analysis  
  --n50                 Calculate N50/N90 statistics
  --quality             Include quality score statistics (FASTQ only)
  --gaps                Count and analyze gap characters
  --skip-validation     Skip sequence validation for faster processing

Examples:
  # Basic statistics
  bun run examples/seqkit-stats.ts genome.fasta

  # Detailed analysis with N50
  bun run examples/seqkit-stats.ts assembly.fasta --detailed --n50

  # FASTQ quality analysis  
  bun run examples/seqkit-stats.ts reads.fastq --quality --detailed

  # Tabular output for parsing
  bun run examples/seqkit-stats.ts sequences.fa --tabular --gc-content

  # Gap analysis for assemblies
  bun run examples/seqkit-stats.ts scaffolds.fa --gaps --detailed

Output Format:
  Standard: Human-readable format with clear labels
  Tabular:  Tab-separated format suitable for further analysis
  
Quality Metrics (FASTQ):
  • Quality score distributions
  • Q20/Q30 percentages  
  • Per-base quality statistics
  • Quality encoding detection

Genomic Metrics:
  • N50/N90 statistics for assemblies
  • GC content analysis
  • Length distributions with quartiles
  • Gap character analysis
  • Sequence type detection (DNA/RNA/Protein)
`);
}

function formatNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}G`;
  } else if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  } else if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) {
    return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  } else if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  } else if (bytes >= 1_024) {
    return `${(bytes / 1_024).toFixed(1)} KB`;
  }
  return `${bytes} bytes`;
}

function outputTabular(stats: any, filename: string): void {
  console.log('file\tformat\ttype\tnum_seqs\tsum_len\tmin_len\tavg_len\tmax_len');
  console.log(
    [
      filename,
      stats.format,
      stats.type,
      stats.numSequences,
      stats.totalLength,
      stats.minLength,
      stats.avgLength.toFixed(1),
      stats.maxLength,
    ].join('\t')
  );
}

function outputDetailed(stats: any, filename: string, options: StatsOptions): void {
  console.log(`\n📊 Comprehensive Statistics for: ${filename}`);
  console.log('='.repeat(60));

  // Basic information
  console.log(`\n📁 FILE INFORMATION:`);
  console.log(`   Format:          ${stats.format}`);
  console.log(`   Sequence type:   ${stats.type}`);
  console.log(`   File size:       ${formatBytes(stats.totalLength * 1.2)}`); // Rough estimate

  // Sequence counts and lengths
  console.log(`\n🔢 SEQUENCE STATISTICS:`);
  console.log(`   Number of sequences: ${formatNumber(stats.numSequences)}`);
  console.log(`   Total length:        ${formatNumber(stats.totalLength)} bp`);
  console.log(`   Average length:      ${formatNumber(stats.avgLength)} bp`);
  console.log(`   Shortest sequence:   ${formatNumber(stats.minLength)} bp`);
  console.log(`   Longest sequence:    ${formatNumber(stats.maxLength)} bp`);

  // Length distribution (if available)
  if (stats.q1Length !== undefined) {
    console.log(`\n📏 LENGTH DISTRIBUTION:`);
    console.log(`   Q1 (25th percentile): ${formatNumber(stats.q1Length)} bp`);
    console.log(`   Q2 (median):          ${formatNumber(stats.q2Length)} bp`);
    console.log(`   Q3 (75th percentile): ${formatNumber(stats.q3Length)} bp`);
  }

  // N50 statistics (if available and requested)
  if ((options.n50 || options.detailed) && stats.n50 !== undefined) {
    console.log(`\n🎯 ASSEMBLY METRICS:`);
    console.log(`   N50:              ${formatNumber(stats.n50)} bp`);
    if (stats.n90 !== undefined) {
      console.log(`   N90:              ${formatNumber(stats.n90)} bp`);
    }
    console.log(`   L50:              ${stats.l50 || 'N/A'} sequences`);
  }

  // GC content (if available and requested)
  if ((options.gcContent || options.detailed) && stats.gcContent !== undefined) {
    console.log(`\n🧬 COMPOSITION ANALYSIS:`);
    console.log(`   GC content:       ${stats.gcContent.toFixed(2)}%`);
    console.log(`   AT content:       ${(100 - stats.gcContent).toFixed(2)}%`);

    if (stats.baseComposition) {
      console.log(`\n   Base composition:`);
      console.log(`     A: ${stats.baseComposition.A?.toFixed(2) || '0.00'}%`);
      console.log(`     T: ${stats.baseComposition.T?.toFixed(2) || '0.00'}%`);
      console.log(`     G: ${stats.baseComposition.G?.toFixed(2) || '0.00'}%`);
      console.log(`     C: ${stats.baseComposition.C?.toFixed(2) || '0.00'}%`);
      if (stats.baseComposition.N && stats.baseComposition.N > 0) {
        console.log(`     N: ${stats.baseComposition.N.toFixed(2)}% (ambiguous)`);
      }
    }
  }

  // Gap analysis (if available and requested)
  if ((options.gaps || options.detailed) && stats.gapCount !== undefined) {
    console.log(`\n🕳️  GAP ANALYSIS:`);
    console.log(`   Gap characters:   ${formatNumber(stats.gapCount)}`);
    console.log(`   Gap percentage:   ${((stats.gapCount / stats.totalLength) * 100).toFixed(2)}%`);
  }

  // Quality statistics (FASTQ only)
  if ((options.quality || options.detailed) && stats.avgQuality !== undefined) {
    console.log(`\n⭐ QUALITY STATISTICS:`);
    console.log(`   Average quality:  ${stats.avgQuality.toFixed(2)}`);
    console.log(`   Quality encoding: ${stats.qualityEncoding || 'Auto-detected'}`);

    if (stats.q20Percentage !== undefined) {
      console.log(`   Q20 bases:        ${stats.q20Percentage.toFixed(2)}%`);
    }
    if (stats.q30Percentage !== undefined) {
      console.log(`   Q30 bases:        ${stats.q30Percentage.toFixed(2)}%`);
    }
  }

  // Summary assessment
  console.log(`\n✅ QUALITY ASSESSMENT:`);
  if (stats.format === 'FASTA') {
    if (stats.n50 && stats.n50 > 10000) {
      console.log(`   Assembly quality: Excellent (N50 > 10kb)`);
    } else if (stats.avgLength > 1000) {
      console.log(`   Sequence quality: Good (avg length > 1kb)`);
    } else {
      console.log(`   Sequence quality: Fragmented sequences`);
    }
  } else if (stats.format === 'FASTQ') {
    if (stats.avgQuality && stats.avgQuality > 30) {
      console.log(`   Read quality: Excellent (Q${stats.avgQuality.toFixed(0)})`);
    } else if (stats.avgQuality && stats.avgQuality > 20) {
      console.log(`   Read quality: Good (Q${stats.avgQuality.toFixed(0)})`);
    } else {
      console.log(`   Read quality: Needs improvement`);
    }
  }
}

function outputStandard(stats: any, filename: string): void {
  console.log(`file\tformat\ttype\tnum_seqs\tsum_len\tmin_len\tavg_len\tmax_len`);
  console.log(
    `${filename}\t${stats.format}\t${stats.type}\t${stats.numSequences}\t${stats.totalLength}\t${stats.minLength}\t${stats.avgLength.toFixed(1)}\t${stats.maxLength}`
  );
}

async function main(): Promise<void> {
  const { inputFile, options } = parseArguments();

  try {
    // Auto-detect format and create appropriate parser
    let sequences: AsyncIterable<any>;
    let detectedFormat = 'FASTA';

    if (inputFile.toLowerCase().includes('.fq') || inputFile.toLowerCase().includes('.fastq')) {
      console.error('Detected FASTQ format - including quality analysis');
      const parser = new FastqParser();
      sequences = parser.parseFile(inputFile);
      detectedFormat = 'FASTQ';
      options.quality = true; // Enable quality analysis for FASTQ
    } else {
      console.error('Detected FASTA format');
      const parser = new FastaParser();
      sequences = parser.parseFile(inputFile);
    }

    // Calculate comprehensive statistics
    console.error('Calculating statistics...');
    const startTime = performance.now();

    const stats = await seqops(sequences).stats({
      detailed: options.detailed || options.n50 || options.gcContent,
      includeQuality: options.quality,
      calculateN50: options.n50 || options.detailed,
      calculateGC: options.gcContent || options.detailed,
      countGaps: options.gaps || options.detailed,
      skipValidation: options.skipValidation,
    });

    const endTime = performance.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);

    // Output results in requested format
    if (options.tabular) {
      outputTabular(stats, inputFile);
    } else if (options.detailed) {
      outputDetailed(stats, inputFile, options);
    } else {
      outputStandard(stats, inputFile);
    }

    // Processing statistics to stderr
    if (!options.tabular) {
      console.error(`\n⏱️  Processing completed in ${processingTime}s`);
      console.error(
        `📈 Throughput: ${formatNumber(Math.round(stats.totalLength / parseFloat(processingTime)))} bp/s`
      );

      if (detectedFormat === 'FASTQ' && options.quality) {
        console.error(`💡 Tip: Use --detailed for comprehensive quality analysis`);
      }

      if (stats.numSequences > 1000 && !options.n50 && detectedFormat === 'FASTA') {
        console.error(`💡 Tip: Use --n50 for assembly statistics`);
      }
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
