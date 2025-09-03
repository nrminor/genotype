#!/usr/bin/env bun

/**
 * Demonstrates SeqOps 'subseq' command functionality using Genotype library
 *
 * Extract subsequences from sequences using flexible coordinate specifications.
 * Supports region strings, BED files, GTF files, and flanking sequence extraction
 * with proper coordinate system handling.
 *
 * Usage: bun run examples/seqkit-subseq.ts input.fasta [options]
 *
 * Equivalent to: seqkit subseq -r 1:100 --up-stream 50 --down-stream 50 input.fasta
 *
 * Examples:
 *   bun run examples/seqkit-subseq.ts genome.fa --region "1:100"
 *   bun run examples/seqkit-subseq.ts genes.fa --regions "1:100,200:300,500:-1"
 *   bun run examples/seqkit-subseq.ts assembly.fa --bed-file regions.bed
 *   bun run examples/seqkit-subseq.ts transcripts.fa --upstream 100 --downstream 50
 *   bun run examples/seqkit-subseq.ts circular.fa --region "950:50" --circular
 */

import { FastaParser, seqops } from "../src";
import type { SubseqOptions } from "../src/operations";

interface SubseqScriptOptions {
  region?: string;
  regions?: string[];
  start?: number;
  end?: number;
  bedFile?: string;
  gtfFile?: string;
  upstream?: number;
  downstream?: number;
  onlyFlank?: boolean;
  oneBased?: boolean;
  strand?: "+" | "-" | "both";
  circular?: boolean;
}

function parseArguments(): { inputFile: string; options: SubseqScriptOptions } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  const inputFile = args[0];
  const options: SubseqScriptOptions = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--region":
      case "-r":
        if (!nextArg) {
          console.error(`Error: ${arg} requires a region string (e.g., "1:100")`);
          process.exit(1);
        }
        options.region = nextArg;
        i++;
        break;

      case "--regions":
        if (!nextArg) {
          console.error(`Error: ${arg} requires comma-separated regions (e.g., "1:100,200:300")`);
          process.exit(1);
        }
        options.regions = nextArg.split(",");
        i++;
        break;

      case "--start":
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric value`);
          process.exit(1);
        }
        options.start = Number(nextArg);
        i++;
        break;

      case "--end":
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric value`);
          process.exit(1);
        }
        options.end = Number(nextArg);
        i++;
        break;

      case "--bed-file":
      case "--bed":
        if (!nextArg) {
          console.error(`Error: ${arg} requires a BED file path`);
          process.exit(1);
        }
        options.bedFile = nextArg;
        i++;
        break;

      case "--gtf-file":
      case "--gtf":
        if (!nextArg) {
          console.error(`Error: ${arg} requires a GTF file path`);
          process.exit(1);
        }
        options.gtfFile = nextArg;
        i++;
        break;

      case "--upstream":
      case "--up-stream":
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric value`);
          process.exit(1);
        }
        options.upstream = Number(nextArg);
        i++;
        break;

      case "--downstream":
      case "--down-stream":
        if (!nextArg || isNaN(Number(nextArg))) {
          console.error(`Error: ${arg} requires a numeric value`);
          process.exit(1);
        }
        options.downstream = Number(nextArg);
        i++;
        break;

      case "--only-flank":
        options.onlyFlank = true;
        break;

      case "--one-based":
        options.oneBased = true;
        break;

      case "--strand":
        if (!nextArg || !["plus", "+", "minus", "-", "both"].includes(nextArg)) {
          console.error(`Error: ${arg} requires one of: plus, +, minus, -, both`);
          process.exit(1);
        }
        options.strand =
          nextArg === "plus" ? "+" : nextArg === "minus" ? "-" : (nextArg as "+" | "-" | "both");
        i++;
        break;

      case "--circular":
        options.circular = true;
        break;

      default:
        console.error(`Error: Unknown option '${arg}'`);
        process.exit(1);
    }
  }

  return { inputFile, options };
}

function showHelp(): void {
  console.error(`SeqOps Subsequence Extraction Tool

Usage: bun run examples/seqkit-subseq.ts <input.fasta> [options]

Extract subsequences using flexible coordinate specifications, BED/GTF files,
and flanking sequence options with proper coordinate system handling.

REGION SPECIFICATION:
  --region, -r <region>        Single region: "start:end", "100:200", "50:-1"
  --regions <regions>          Multiple regions: "1:100,200:300,400:500"
  --start <n>                  Start position (use with --end)
  --end <n>                    End position (use with --start)

COORDINATE FILES:
  --bed-file <file>           Extract regions from BED file
  --gtf-file <file>           Extract features from GTF file

FLANKING SEQUENCES:
  --upstream <n>              Include N bp upstream of regions
  --downstream <n>            Include N bp downstream of regions  
  --only-flank                Extract only flanking regions (not target)

COORDINATE SYSTEMS:
  --one-based                 Use 1-based coordinates (default: 0-based)
  
STRAND OPTIONS:
  --strand <strand>           Strand to extract: plus/+, minus/-, both

SPECIAL FEATURES:
  --circular                  Handle circular sequences (wrap coordinates)

Region Format Examples:
  "1:100"      - Extract positions 1 to 100 (0-based: bases 1-99)
  "50:-1"      - Extract from position 50 to end of sequence
  "-100:-1"    - Extract last 100 bases
  "100:200"    - Extract specific region
  
BED File Format:
  chromosome  chromStart  chromEnd  [name]  [score]  [strand]
  chr1        100         200       region1  900      +
  chr2        500         1000      region2  800      -

Examples:
  # Basic region extraction
  bun run examples/seqkit-subseq.ts genome.fasta --region "1000:2000"
  
  # Multiple regions
  bun run examples/seqkit-subseq.ts genes.fasta --regions "1:100,200:300,500:600"
  
  # Extract with flanking sequences
  bun run examples/seqkit-subseq.ts genes.fasta --region "100:200" --upstream 50 --downstream 50
  
  # BED file extraction
  bun run examples/seqkit-subseq.ts assembly.fasta --bed-file features.bed
  
  # Strand-specific extraction
  bun run examples/seqkit-subseq.ts genome.fasta --region "1000:2000" --strand minus
  
  # Last 100 bases of each sequence
  bun run examples/seqkit-subseq.ts sequences.fasta --region "-100:-1"
  
  # Circular genome handling
  bun run examples/seqkit-subseq.ts plasmid.fasta --region "950:50" --circular

Coordinate Systems:
  Default (0-based):  First base is position 0
  1-based:           First base is position 1 (use --one-based)

Negative Indices:
  -1 = last base, -2 = second to last, etc.
  
Output:
  • Extracted subsequences in FASTA format
  • Modified headers indicate extraction coordinates
  • Original sequence context preserved in descriptions
`);
}

function parseRegionString(region: string): { start: number; end: number } {
  if (!region.includes(":")) {
    throw new Error(`Invalid region format '${region}'. Use 'start:end' format.`);
  }

  const [startStr, endStr] = region.split(":");
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);

  if (isNaN(start) || isNaN(end)) {
    throw new Error(`Invalid numeric values in region '${region}'`);
  }

  return { start, end };
}

function buildSubseqOptions(options: SubseqScriptOptions): SubseqOptions {
  const subseqOptions: SubseqOptions = {};

  // Handle region specifications
  if (options.region) {
    subseqOptions.region = options.region;
  }

  if (options.regions) {
    subseqOptions.regions = options.regions;
  }

  if (options.start !== undefined && options.end !== undefined) {
    subseqOptions.start = options.start;
    subseqOptions.end = options.end;
  }

  // Handle file-based regions
  if (options.bedFile) {
    subseqOptions.bedFile = options.bedFile;
  }

  if (options.gtfFile) {
    subseqOptions.gtfFile = options.gtfFile;
  }

  // Handle flanking options
  if (options.upstream !== undefined) {
    subseqOptions.upstream = options.upstream;
  }

  if (options.downstream !== undefined) {
    subseqOptions.downstream = options.downstream;
  }

  if (options.onlyFlank) {
    subseqOptions.onlyFlank = true;
  }

  // Handle coordinate system
  if (options.oneBased) {
    subseqOptions.oneBased = true;
  }

  // Handle strand
  if (options.strand) {
    subseqOptions.strand = options.strand;
  }

  // Handle circular sequences
  if (options.circular) {
    subseqOptions.circular = true;
  }

  return subseqOptions;
}

async function main(): Promise<void> {
  const { inputFile, options } = parseArguments();

  // Validate that at least one extraction method is specified
  if (
    !options.region &&
    !options.regions &&
    !options.bedFile &&
    !options.gtfFile &&
    !(options.start !== undefined && options.end !== undefined)
  ) {
    console.error(
      "Error: Must specify extraction method (--region, --regions, --bed-file, --gtf-file, or --start/--end)"
    );
    process.exit(1);
  }

  try {
    console.error(`Processing file: ${inputFile}`);

    // Parse input file
    const parser = new FastaParser();
    const sequences = parser.parseFile(inputFile);

    // Build subsequence options
    const subseqOptions = buildSubseqOptions(options);

    // Log extraction parameters
    if (options.region) {
      console.error(`Extracting region: ${options.region}`);
    }
    if (options.regions) {
      console.error(`Extracting regions: ${options.regions.join(", ")}`);
    }
    if (options.bedFile) {
      console.error(`Using BED file: ${options.bedFile}`);
    }
    if (options.gtfFile) {
      console.error(`Using GTF file: ${options.gtfFile}`);
    }
    if (options.upstream || options.downstream) {
      console.error(
        `Flanking sequences: ${options.upstream || 0} bp upstream, ${options.downstream || 0} bp downstream`
      );
    }
    if (options.strand && options.strand !== "both") {
      console.error(`Strand: ${options.strand}`);
    }
    if (options.circular) {
      console.error("Circular sequence handling enabled");
    }

    console.error(`Coordinate system: ${options.oneBased ? "1-based" : "0-based"}`);

    // Extract subsequences
    console.error("Extracting subsequences...");
    const startTime = performance.now();

    const extracted = seqops(sequences).subseq(subseqOptions);

    // Output extracted sequences
    let extractedCount = 0;
    let totalExtractedLength = 0;

    for await (const seq of extracted) {
      console.log(`>${seq.id}${seq.description ? " " + seq.description : ""}`);
      console.log(seq.sequence);

      extractedCount++;
      totalExtractedLength += seq.length;
    }

    const endTime = performance.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);

    // Report statistics
    console.error(`\n✅ Extraction completed successfully`);
    console.error(`📊 Results:`);
    console.error(`   Extracted sequences: ${extractedCount}`);
    console.error(`   Total extracted length: ${totalExtractedLength.toLocaleString()} bp`);

    if (extractedCount > 0) {
      const avgLength = Math.round(totalExtractedLength / extractedCount);
      console.error(`   Average extracted length: ${avgLength} bp`);
    }

    console.error(`⏱️  Processing time: ${processingTime}s`);

    // Provide useful tips based on extraction method
    if (options.bedFile) {
      console.error(`💡 Tip: BED coordinates are 0-based by genomics convention`);
    }

    if (options.circular) {
      console.error(`💡 Note: Circular handling enabled for wraparound coordinates`);
    }

    if (extractedCount === 0) {
      console.error(`⚠️  No subsequences extracted. Check your coordinate specifications.`);
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Invalid region format")) {
        console.error(`Error: ${error.message}`);
        console.error(`Expected format: "start:end" (e.g., "1:100", "50:-1", "-100:-1")`);
      } else if (error.message.includes("file not found")) {
        console.error(`Error: Could not read file '${inputFile}'`);
        console.error(`Check that the file exists and is accessible.`);
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
