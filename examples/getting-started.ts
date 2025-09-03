#!/usr/bin/env bun
/**
 * Getting Started with SeqOps
 *
 * A gentle introduction to the SeqOps library for newcomers
 * to both bioinformatics and the library.
 */

import { seqops } from "../src/operations";
import type { AbstractSequence, FastqSequence } from "../src/types";

// ============================================================================
// Tutorial 1: Your First Pipeline
// ============================================================================

async function tutorial1_firstPipeline() {
  console.log("\n📚 Tutorial 1: Your First SeqOps Pipeline\n");
  console.log("Let's process some DNA sequences step by step!\n");

  // Create some example DNA sequences
  // In real use, these would come from a FASTA/FASTQ file
  const dnaSequences = async function* (): AsyncIterable<AbstractSequence> {
    yield { id: "gene1", sequence: "atcgatcgatcg", length: 12 };
    yield { id: "gene2", sequence: "GGCCAATTGGCC", length: 12 };
    yield { id: "gene3", sequence: "aaa", length: 3 }; // Too short!
  };

  // Process the sequences
  const results = await seqops(dnaSequences())
    .filter({ minLength: 5 }) // Remove sequences shorter than 5 bases
    .transform({ upperCase: true }) // Convert all to uppercase
    .collect(); // Collect into an array

  console.log("Processed sequences:");
  for (const seq of results) {
    console.log(`  ${seq.id}: ${seq.sequence} (${seq.length} bases)`);
  }
  console.log("\nNotice: gene3 was filtered out because it was too short!");
}

// ============================================================================
// Tutorial 2: Understanding Sequence Transformations
// ============================================================================

async function tutorial2_transformations() {
  console.log("\n📚 Tutorial 2: Sequence Transformations\n");
  console.log("DNA sequences can be transformed in various ways:\n");

  const testSequence = async function* (): AsyncIterable<AbstractSequence> {
    yield { id: "example", sequence: "ATCG", length: 4 };
  };

  // Original sequence
  console.log("Original:           ATCG");

  // Complement: A↔T, C↔G
  const complement = await seqops(testSequence()).transform({ complement: true }).collect();
  console.log(`Complement:         ${complement[0].sequence}`);

  // Reverse: read backwards
  const reverse = await seqops(testSequence()).transform({ reverse: true }).collect();
  console.log(`Reverse:            ${reverse[0].sequence}`);

  // Reverse complement: both operations
  const revComp = await seqops(testSequence()).transform({ reverseComplement: true }).collect();
  console.log(`Reverse complement: ${revComp[0].sequence}`);

  console.log("\nThese transformations are essential for working with double-stranded DNA!");
}

// ============================================================================
// Tutorial 3: Cleaning Messy Data
// ============================================================================

async function tutorial3_cleaning() {
  console.log("\n📚 Tutorial 3: Cleaning Messy Sequence Data\n");
  console.log("Real-world data is often messy. SeqOps can clean it up:\n");

  // Messy sequences with various issues
  const messySequences = async function* (): AsyncIterable<AbstractSequence> {
    yield { id: "seq1", sequence: "ATCGatcg", length: 8 }; // Mixed case
    yield { id: "seq2", sequence: "ATCG---ATCG", length: 11 }; // Has gaps
    yield { id: "seq3", sequence: "ATCNNNGATC", length: 10 }; // Has ambiguous bases
    yield { id: "seq4", sequence: "  ATCG  ", length: 8 }; // Has whitespace
  };

  console.log("Before cleaning:");
  for await (const seq of messySequences()) {
    console.log(`  ${seq.id}: "${seq.sequence}"`);
  }

  // Clean up the sequences
  const cleaned = await seqops(messySequences())
    .transform({ upperCase: true }) // Standardize case
    .clean({
      removeGaps: true, // Remove gap characters (-, ., *)
      replaceAmbiguous: true, // Replace N with standard base
      replaceChar: "A", // Replace ambiguous with A
      trimWhitespace: true, // Remove leading/trailing spaces
    })
    .collect();

  console.log("\nAfter cleaning:");
  for (const seq of cleaned) {
    console.log(`  ${seq.id}: "${seq.sequence}"`);
  }
}

// ============================================================================
// Tutorial 4: Working with Quality Scores (FASTQ)
// ============================================================================

async function tutorial4_quality() {
  console.log("\n📚 Tutorial 4: Working with FASTQ Quality Scores\n");
  console.log("FASTQ files include quality scores for each base:\n");

  // Create FASTQ sequences with quality scores
  const fastqSequences = async function* (): AsyncIterable<FastqSequence> {
    yield {
      format: "fastq",
      id: "good_read",
      sequence: "ATCGATCG",
      quality: "IIIIIIII", // High quality (I = score 40)
      qualityEncoding: "phred33",
      length: 8,
    };
    yield {
      format: "fastq",
      id: "poor_read",
      sequence: "ATCGATCG",
      quality: "########", // Low quality (# = score 2)
      qualityEncoding: "phred33",
      length: 8,
    };
  };

  // Filter by quality score
  const highQuality = await seqops(fastqSequences())
    .quality({ minScore: 20 }) // Keep only high-quality reads
    .collect();

  console.log("Quality filtering results:");
  console.log(`  Started with: 2 reads`);
  console.log(`  After filtering: ${highQuality.length} read(s)`);
  console.log(`  Kept: ${highQuality[0]?.id || "none"}`);
  console.log("\nLow-quality reads are removed to ensure reliable results!");
}

// ============================================================================
// Tutorial 5: Filtering by GC Content
// ============================================================================

async function tutorial5_gcContent() {
  console.log("\n📚 Tutorial 5: Filtering by GC Content\n");
  console.log("GC content (percentage of G and C bases) affects DNA properties:\n");

  const sequences = async function* (): AsyncIterable<AbstractSequence> {
    yield { id: "AT_rich", sequence: "ATATATAT", length: 8 }; // 0% GC
    yield { id: "balanced", sequence: "ATCGATCG", length: 8 }; // 50% GC
    yield { id: "GC_rich", sequence: "GCGCGCGC", length: 8 }; // 100% GC
  };

  // Show GC content
  console.log("Original sequences:");
  for await (const seq of sequences()) {
    const gcCount = (seq.sequence.match(/[GC]/g) || []).length;
    const gcPercent = ((gcCount / seq.length) * 100).toFixed(0);
    console.log(`  ${seq.id}: ${seq.sequence} (${gcPercent}% GC)`);
  }

  // Filter for moderate GC content (typical for many organisms)
  const filtered = await seqops(sequences())
    .filter({ minGC: 40, maxGC: 60 }) // Keep 40-60% GC content
    .collect();

  console.log("\nAfter filtering for 40-60% GC:");
  for (const seq of filtered) {
    console.log(`  ${seq.id}: ${seq.sequence}`);
  }
}

// ============================================================================
// Tutorial 6: Building Complex Pipelines
// ============================================================================

async function tutorial6_complexPipeline() {
  console.log("\n📚 Tutorial 6: Building Complex Pipelines\n");
  console.log("SeqOps shines when combining multiple operations:\n");

  // Simulate a mix of sequences
  const mixedSequences = async function* (): AsyncIterable<AbstractSequence> {
    yield { id: "short1", sequence: "atc", length: 3 };
    yield { id: "good1", sequence: "atcgatcgatcgatcg", length: 16 };
    yield { id: "ambiguous1", sequence: "ATCNNNATCG", length: 10 };
    yield { id: "good2", sequence: "ggccaattggccaatt", length: 16 };
    yield { id: "gappy1", sequence: "ATCG----ATCG", length: 12 };
  };

  // Complex pipeline combining multiple operations
  const processed = await seqops(mixedSequences())
    // Step 1: Basic filtering
    .filter({ minLength: 10 })

    // Step 2: Clean up
    .clean({
      removeGaps: true,
      replaceAmbiguous: true,
      replaceChar: "A",
    })

    // Step 3: Standardize
    .transform({ upperCase: true })

    // Step 4: Final filtering
    .filter({ minLength: 8 }) // After cleaning, some might be shorter

    // Step 5: Transform
    .transform({ reverseComplement: true })

    .collect();

  console.log("Pipeline results:");
  console.log(`  Started with: 5 sequences`);
  console.log(`  After processing: ${processed.length} sequences\n`);

  for (const seq of processed) {
    console.log(`  ${seq.id}:`);
    console.log(`    Final: ${seq.sequence}`);
    console.log(`    Length: ${seq.length} bases`);
  }
}

// ============================================================================
// Tutorial 7: Getting Statistics
// ============================================================================

async function tutorial7_statistics() {
  console.log("\n📚 Tutorial 7: Sequence Statistics\n");
  console.log("SeqOps can calculate useful statistics:\n");

  const genomeContigs = async function* (): AsyncIterable<AbstractSequence> {
    yield { id: "contig1", sequence: "A".repeat(1000), length: 1000 };
    yield { id: "contig2", sequence: "T".repeat(500), length: 500 };
    yield { id: "contig3", sequence: "G".repeat(1500), length: 1500 };
    yield { id: "contig4", sequence: "C".repeat(250), length: 250 };
    yield { id: "contig5", sequence: "ATCG".repeat(200), length: 800 };
  };

  const stats = await seqops(genomeContigs()).stats({ detailed: true });

  console.log("Sequence statistics:");
  console.log(`  Number of sequences: ${stats.numSequences}`);
  console.log(`  Total length: ${stats.totalLength} bases`);
  console.log(`  Average length: ${stats.avgLength.toFixed(1)} bases`);
  console.log(`  Shortest: ${stats.minLength} bases`);
  console.log(`  Longest: ${stats.maxLength} bases`);
  console.log(`  N50: ${stats.n50} bases`);

  console.log("\nN50 is the length where half the total bases are in sequences");
  console.log("of this length or longer - a key metric for genome assemblies!");
}

// ============================================================================
// Main: Run All Tutorials
// ============================================================================

async function main() {
  console.log("================================================");
  console.log("       Getting Started with SeqOps              ");
  console.log("    A Step-by-Step Tutorial for Beginners      ");
  console.log("================================================");

  try {
    await tutorial1_firstPipeline();
    await tutorial2_transformations();
    await tutorial3_cleaning();
    await tutorial4_quality();
    await tutorial5_gcContent();
    await tutorial6_complexPipeline();
    await tutorial7_statistics();

    console.log("\n================================================");
    console.log("         Congratulations! 🎉                    ");
    console.log("   You've completed the SeqOps tutorial!       ");
    console.log("================================================\n");

    console.log("What you've learned:");
    console.log("  ✓ Creating sequence pipelines");
    console.log("  ✓ Filtering sequences");
    console.log("  ✓ Transforming sequences");
    console.log("  ✓ Cleaning messy data");
    console.log("  ✓ Working with quality scores");
    console.log("  ✓ Analyzing GC content");
    console.log("  ✓ Building complex pipelines");
    console.log("  ✓ Calculating statistics\n");

    console.log("Next steps:");
    console.log("  1. Try modifying these examples");
    console.log("  2. Load real FASTA/FASTQ files");
    console.log("  3. Check out real-world-pipelines.ts");
    console.log("  4. Read the API documentation\n");
  } catch (error) {
    console.error("Error in tutorial:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}

export { main };
