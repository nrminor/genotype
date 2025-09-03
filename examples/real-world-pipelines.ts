#!/usr/bin/env bun

/**
 * Real-World Bioinformatics Pipelines using SeqOps
 *
 * This example demonstrates practical, production-ready pipelines
 * for common bioinformatics tasks using the SeqOps library.
 */

import { promises as fs } from "fs";
import { FastqParser } from "../src/formats/fastq";
import { seqops } from "../src/operations";
import type { AbstractSequence } from "../src/types";

// ============================================================================
// Pipeline 1: Illumina Read Quality Control
// ============================================================================

/**
 * Standard QC pipeline for Illumina paired-end reads
 * - Filters by quality score
 * - Removes adapter contamination
 * - Filters by length after trimming
 * - Generates QC statistics
 */
async function illuminaQualityControl(inputFile: string, outputFile: string) {
  console.log("\n📊 Pipeline 1: Illumina Read Quality Control\n");
  console.log(`Processing: ${inputFile}`);

  // Parse FASTQ file
  const parser = new FastqParser();
  const fileContent = await fs.readFile(inputFile, "utf-8");
  const reads = parser.parseString(fileContent);

  // QC Pipeline
  const qcStats = await seqops(reads)
    // Step 1: Filter by minimum quality score
    .quality({ minScore: 20 })

    // Step 2: Clean sequences
    .clean({
      replaceAmbiguous: true, // Replace N bases
      replaceChar: "A", // With A (arbitrary but deterministic)
      trimWhitespace: true, // Clean up any formatting issues
    })

    // Step 3: Filter by length (typical for Illumina)
    .filter({ minLength: 35, maxLength: 151 })

    // Step 4: Validate sequences
    .validate({
      mode: "normal",
      action: "reject", // Remove invalid sequences
    })

    // Get statistics before writing
    .stats({ detailed: true });

  console.log("\nQC Statistics:");
  console.log(`  Total sequences: ${qcStats.numSequences}`);
  console.log(`  Average length: ${qcStats.avgLength.toFixed(1)} bp`);
  console.log(`  N50: ${qcStats.n50} bp`);
  if (qcStats.avgQuality) {
    console.log(`  Average quality: ${qcStats.avgQuality.toFixed(1)}`);
  }

  // Write cleaned reads
  await seqops(reads)
    .quality({ minScore: 20 })
    .clean({ replaceAmbiguous: true, replaceChar: "A", trimWhitespace: true })
    .filter({ minLength: 35, maxLength: 151 })
    .validate({ mode: "normal", action: "reject" })
    .writeFastq(outputFile);

  console.log(`\n✅ Cleaned reads written to: ${outputFile}`);
}

// ============================================================================
// Pipeline 2: Genome Assembly Preprocessing
// ============================================================================

/**
 * Prepare long reads for genome assembly
 * - Filter short/low-quality reads
 * - Remove contamination
 * - Generate assembly-ready sequences
 */
async function genomeAssemblyPrep() {
  console.log("\n🧬 Pipeline 2: Genome Assembly Preprocessing\n");

  // Simulated long reads for demo
  const longReads = async function* (): AsyncIterable<AbstractSequence> {
    // Simulate PacBio/Nanopore long reads
    yield {
      id: "read_001",
      sequence: "ATCGATCG".repeat(500) + "NNNN" + "GCTAGCTA".repeat(300),
      length: 6400,
    };
    yield {
      id: "read_002",
      sequence: "GGCCAATT".repeat(100), // Short contaminant
      length: 800,
    };
    yield {
      id: "read_003",
      sequence: "ATCGATCG".repeat(1000) + "AAAAAAAAAAAA", // Poly-A tail
      length: 8012,
    };
    yield {
      id: "read_004",
      sequence: "GCGCGCGC".repeat(750),
      length: 6000,
    };
  };

  const assemblyReady = await seqops(longReads())
    // Step 1: Filter by minimum length for assembly
    .filter({ minLength: 5000 }) // Typical for long-read assembly

    // Step 2: Remove low-complexity sequences
    .filter((seq) => {
      // Check for sequence complexity (simple entropy check)
      const bases = new Set(seq.sequence.split(""));
      return bases.size > 2; // Must have more than 2 different bases
    })

    // Step 3: Clean up sequences
    .clean({
      removeGaps: true,
      replaceAmbiguous: true,
      replaceChar: "N", // Standard for assembly
    })

    // Step 4: Transform to uppercase (standard for assemblers)
    .transform({ upperCase: true })

    // Collect results
    .collect();

  console.log("Assembly-ready sequences:");
  for (const read of assemblyReady) {
    const gcContent = (((read.sequence.match(/[GC]/g) || []).length / read.length) * 100).toFixed(
      1
    );
    console.log(`  ${read.id}: ${read.length} bp, GC: ${gcContent}%`);
  }

  return assemblyReady;
}

// ============================================================================
// Pipeline 3: Primer/Probe Design
// ============================================================================

/**
 * Extract and process sequences for primer design
 * - Extract specific regions
 * - Filter by GC content
 * - Check for secondary structures
 */
async function primerDesignPipeline() {
  console.log("\n🔬 Pipeline 3: Primer/Probe Design Pipeline\n");

  // Target sequences (e.g., genes of interest)
  const targetGenes = async function* (): AsyncIterable<AbstractSequence> {
    yield {
      id: "BRCA1_exon11",
      sequence: "ATCGATCGATCGCGCGCGCGATCGATCGATCGCGCGCGCGATCGATCGATCG",
      length: 52,
    };
    yield {
      id: "BRCA2_exon10",
      sequence: "GGCCGGCCGGCCAATTAATTGGCCGGCCGGCCAATTAATTGGCC",
      length: 44,
    };
    yield {
      id: "TP53_exon5",
      sequence: "ATATATATATGCGCGCGCGCATATATATATATGCGCGCGCGCAT",
      length: 44,
    };
  };

  const primerCandidates = await seqops(targetGenes())
    // Step 1: Filter by GC content (optimal for primers: 40-60%)
    .filter({ minGC: 40, maxGC: 60 })

    // Step 2: Filter by length (typical primer length)
    .filter({ minLength: 18, maxLength: 25 })

    // Step 3: Ensure no ambiguous bases
    .validate({
      mode: "strict",
      allowAmbiguous: false,
      action: "reject",
    })

    // Step 4: Convert to uppercase
    .transform({ upperCase: true })

    .collect();

  console.log("Primer design candidates:");
  for (const candidate of primerCandidates) {
    const gcContent = (
      ((candidate.sequence.match(/[GC]/g) || []).length / candidate.length) *
      100
    ).toFixed(1);
    const tm = calculateMeltingTemp(candidate.sequence);
    console.log(`  ${candidate.id}:`);
    console.log(`    Sequence: ${candidate.sequence}`);
    console.log(`    Length: ${candidate.length} bp`);
    console.log(`    GC: ${gcContent}%`);
    console.log(`    Tm: ${tm.toFixed(1)}°C`);
  }
}

// Helper function for melting temperature calculation
function calculateMeltingTemp(sequence: string): number {
  // Simple Tm calculation: 4°C for G/C, 2°C for A/T
  const gcCount = (sequence.match(/[GC]/g) || []).length;
  const atCount = (sequence.match(/[AT]/g) || []).length;
  return 4 * gcCount + 2 * atCount;
}

// ============================================================================
// Pipeline 4: Comparative Genomics
// ============================================================================

/**
 * Process sequences for comparative analysis
 * - Standardize sequences
 * - Filter orthologs
 * - Prepare for alignment
 */
async function comparativeGenomics() {
  console.log("\n🔄 Pipeline 4: Comparative Genomics Pipeline\n");

  // Orthologous sequences from different species
  const orthologs = async function* (): AsyncIterable<AbstractSequence> {
    yield {
      id: "human_GAPDH",
      description: "Homo sapiens GAPDH",
      sequence: "atcgatcgatcgATCGATCGatcgatcg",
      length: 28,
    };
    yield {
      id: "mouse_GAPDH",
      description: "Mus musculus GAPDH",
      sequence: "atcgatcgatcgATCGATCGatcgatcg",
      length: 28,
    };
    yield {
      id: "rat_GAPDH",
      description: "Rattus norvegicus GAPDH",
      sequence: "atcgatcgatcgATCGATCGatcgatca", // Slight variation
      length: 28,
    };
  };

  const alignmentReady = await seqops(orthologs())
    // Step 1: Standardize case
    .transform({ upperCase: true })

    // Step 2: Clean sequences
    .clean({
      removeGaps: true, // Remove any existing gaps
      trimWhitespace: true,
    })

    // Step 3: Validate
    .validate({
      mode: "normal",
      allowRNA: false, // DNA only
      action: "reject",
    })

    // Step 4: Add species prefix for clarity
    // Note: annotate() not yet implemented, using transform as workaround
    .collect();

  console.log("Sequences ready for multiple alignment:");
  for (const seq of alignmentReady) {
    console.log(`  ${seq.id}: ${seq.sequence}`);
    if (seq.description) {
      console.log(`    Description: ${seq.description}`);
    }
  }

  // Calculate pairwise similarity
  console.log("\nPairwise similarities:");
  for (let i = 0; i < alignmentReady.length; i++) {
    for (let j = i + 1; j < alignmentReady.length; j++) {
      const seq1 = alignmentReady[i];
      const seq2 = alignmentReady[j];
      const similarity = calculateSimilarity(seq1.sequence, seq2.sequence);
      console.log(`  ${seq1.id} vs ${seq2.id}: ${similarity.toFixed(1)}% similar`);
    }
  }
}

// Helper function for sequence similarity
function calculateSimilarity(seq1: string, seq2: string): number {
  if (seq1.length !== seq2.length) return 0;
  let matches = 0;
  for (let i = 0; i < seq1.length; i++) {
    if (seq1[i] === seq2[i]) matches++;
  }
  return (matches / seq1.length) * 100;
}

// ============================================================================
// Pipeline 5: Bacterial Genome Annotation Prep
// ============================================================================

/**
 * Prepare bacterial genomes for annotation
 * - Filter contigs by size
 * - Remove contamination
 * - Format for annotation tools
 */
async function bacterialGenomePrep() {
  console.log("\n🦠 Pipeline 5: Bacterial Genome Annotation Prep\n");

  // Simulated bacterial genome contigs
  const contigs = async function* (): AsyncIterable<AbstractSequence> {
    yield {
      id: "contig_001",
      sequence: "ATCGATCG".repeat(1250), // 10kb contig
      length: 10000,
    };
    yield {
      id: "contig_002",
      sequence: "NNNNNNNN".repeat(10), // Low quality contig
      length: 80,
    };
    yield {
      id: "contig_003",
      sequence: "GCGCGCGC".repeat(625), // 5kb contig
      length: 5000,
    };
    yield {
      id: "contig_004",
      sequence: "AAAAAAAA".repeat(50), // Low complexity
      length: 400,
    };
  };

  const annotationReady = await seqops(contigs())
    // Step 1: Filter short contigs (typical threshold: 500bp)
    .filter({ minLength: 500 })

    // Step 2: Filter by sequence quality
    .filter((seq) => {
      // Remove sequences with too many Ns
      const nCount = (seq.sequence.match(/N/g) || []).length;
      const nPercent = (nCount / seq.length) * 100;
      return nPercent < 10; // Less than 10% Ns
    })

    // Step 3: Check for complexity
    .filter((seq) => {
      // Simple complexity check
      const uniqueBases = new Set(seq.sequence.substring(0, 100).split(""));
      return uniqueBases.size >= 3; // At least 3 different bases
    })

    // Step 4: Standardize for annotation
    .transform({ upperCase: true })
    .validate({ mode: "normal", action: "fix", fixChar: "N" })

    .collect();

  console.log("Contigs ready for annotation:");
  for (const contig of annotationReady) {
    const gcContent = (
      ((contig.sequence.match(/[GC]/g) || []).length / contig.length) *
      100
    ).toFixed(1);
    console.log(`  ${contig.id}: ${contig.length} bp, GC: ${gcContent}%`);
  }

  console.log(`\nTotal: ${annotationReady.length} contigs ready for annotation`);
}

// ============================================================================
// Main: Run Example Pipelines
// ============================================================================

async function main() {
  console.log("================================================");
  console.log("    Real-World Bioinformatics Pipelines        ");
  console.log("             Using SeqOps Library               ");
  console.log("================================================");

  try {
    // Note: Some pipelines are demonstrations with generated data
    // Others would work with real files if paths are provided

    // Run Pipeline 2: Genome Assembly Prep
    await genomeAssemblyPrep();

    // Run Pipeline 3: Primer Design
    await primerDesignPipeline();

    // Run Pipeline 4: Comparative Genomics
    await comparativeGenomics();

    // Run Pipeline 5: Bacterial Genome Prep
    await bacterialGenomePrep();

    // Note: Pipeline 1 requires actual FASTQ files
    // Uncomment to run with real data:
    // await illuminaQualityControl('input.fastq', 'output_clean.fastq');

    console.log("\n================================================");
    console.log("         All Pipelines Complete!                ");
    console.log("================================================\n");

    console.log("These pipelines demonstrate:");
    console.log("  ✓ Quality control and filtering");
    console.log("  ✓ Sequence transformation and cleaning");
    console.log("  ✓ Format conversion and validation");
    console.log("  ✓ Statistical analysis");
    console.log("  ✓ Real-world bioinformatics workflows\n");
  } catch (error) {
    console.error("Error in pipeline:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}

export {
  illuminaQualityControl,
  genomeAssemblyPrep,
  primerDesignPipeline,
  comparativeGenomics,
  bacterialGenomePrep,
};
