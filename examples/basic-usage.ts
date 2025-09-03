#!/usr/bin/env bun
/**
 * Demonstration of the new semantic SeqOps API
 *
 * This example shows how the redesigned API improves developer experience
 * through focused, composable methods that clearly express intent.
 */

import { seqops } from "../src/operations";
import type { AbstractSequence, FastqSequence } from "../src/types";

// ============================================================================
// Example 1: Basic Filtering and Transformation
// ============================================================================

async function example1_basicOperations() {
  console.log("\n=== Example 1: Basic Filtering and Transformation ===\n");

  // Create test sequences
  const sequences = async function* (): AsyncIterable<AbstractSequence> {
    yield { id: "seq1", sequence: "atcgatcgatcg", length: 12 };
    yield { id: "seq2", sequence: "aaaa", length: 4 };
    yield { id: "seq3", sequence: "GGCCGGCC", length: 8 };
    yield { id: "seq4", sequence: "atcgatcgatcgatcg", length: 16 };
  };

  // Clear, semantic pipeline
  const results = await seqops(sequences())
    .filter({ minLength: 6, maxLength: 14 }) // Keep sequences 6-14bp
    .transform({ upperCase: true }) // Convert to uppercase
    .transform({ reverseComplement: true }) // Reverse complement
    .collect();

  console.log("Filtered and transformed sequences:");
  for (const seq of results) {
    console.log(`  ${seq.id}: ${seq.sequence} (${seq.length}bp)`);
  }
}

// ============================================================================
// Example 2: FASTQ Quality Control Pipeline
// ============================================================================

async function example2_fastqQualityControl() {
  console.log("\n=== Example 2: FASTQ Quality Control Pipeline ===\n");

  // Create test FASTQ sequences
  const fastqSequences = async function* (): AsyncIterable<FastqSequence> {
    yield {
      format: "fastq",
      id: "read1",
      sequence: "ATCGATCGATCGATCG",
      quality: "##########IIIIII", // Low quality at start
      qualityEncoding: "phred33",
      length: 16,
    };
    yield {
      format: "fastq",
      id: "read2",
      sequence: "GGCCAATTGGCCAATT",
      quality: "IIIIIIIIIIIIIIII", // High quality throughout
      qualityEncoding: "phred33",
      length: 16,
    };
    yield {
      format: "fastq",
      id: "read3",
      sequence: "NNNNNNNN",
      quality: "########",
      qualityEncoding: "phred33",
      length: 8,
    };
  };

  // Quality control pipeline
  const qcResults = await seqops(fastqSequences())
    .quality({ minScore: 20 }) // Filter by average quality
    .clean({ replaceAmbiguous: true }) // Replace N with standard bases
    .filter({ minLength: 10 }) // Remove short sequences
    .validate({ mode: "normal", action: "reject" }) // Validate sequences
    .collect();

  console.log("Quality-controlled reads:");
  for (const seq of qcResults) {
    console.log(`  ${seq.id}: ${seq.sequence}`);
  }
}

// ============================================================================
// Example 3: GC Content Filtering and Analysis
// ============================================================================

async function example3_gcContentAnalysis() {
  console.log("\n=== Example 3: GC Content Filtering and Analysis ===\n");

  const sequences = async function* (): AsyncIterable<AbstractSequence> {
    yield { id: "AT_rich", sequence: "ATATATATATAT", length: 12 }; // 0% GC
    yield { id: "balanced", sequence: "ATCGATCGATCG", length: 12 }; // 50% GC
    yield { id: "GC_rich", sequence: "GCGCGCGCGCGC", length: 12 }; // 100% GC
    yield { id: "mixed", sequence: "AAATTTGGGCCC", length: 12 }; // 50% GC
  };

  // Filter by GC content range
  const gcFiltered = await seqops(sequences())
    .filter({ minGC: 40, maxGC: 60 }) // Keep sequences with 40-60% GC
    .collect();

  console.log("Sequences with 40-60% GC content:");
  for (const seq of gcFiltered) {
    const gcContent = (((seq.sequence.match(/[GC]/gi) || []).length / seq.length) * 100).toFixed(1);
    console.log(`  ${seq.id}: ${seq.sequence} (${gcContent}% GC)`);
  }
}

// ============================================================================
// Example 4: Complex Multi-Step Pipeline
// ============================================================================

async function example4_complexPipeline() {
  console.log("\n=== Example 4: Complex Multi-Step Pipeline ===\n");

  // Simulate contaminated sequences with various issues
  const problematicSequences = async function* (): AsyncIterable<AbstractSequence> {
    yield { id: "short_1", sequence: "ATG", length: 3 };
    yield { id: "gaps_1", sequence: "ATG---CGT", length: 9 };
    yield { id: "ambiguous_1", sequence: "ATGNNNRYCG", length: 10 };
    yield { id: "mixed_case", sequence: "atcgATCGatcg", length: 12 };
    yield { id: "good_1", sequence: "ATCGATCGATCG", length: 12 };
    yield { id: "rna_1", sequence: "AUGCUGAUGCUG", length: 12 };
  };

  // Comprehensive cleaning pipeline
  const cleaned = await seqops(problematicSequences())
    // Step 1: Remove very short sequences
    .filter({ minLength: 5 })

    // Step 2: Clean up sequences
    .clean({
      removeGaps: true, // Remove gap characters
      replaceAmbiguous: true, // Replace N and ambiguous codes
      replaceChar: "A", // Replace with A (arbitrary choice)
    })

    // Step 3: Standardize format
    .transform({
      toDNA: true, // Convert RNA to DNA
      upperCase: true, // Standardize case
    })

    // Step 4: Final validation
    .validate({
      mode: "strict",
      action: "reject", // Reject invalid sequences
    })

    // Step 5: Only keep sequences with reasonable length after cleaning
    .filter({ minLength: 8 })

    .collect();

  console.log("Cleaned sequences:");
  console.log(`  Started with: 6 sequences`);
  console.log(`  After cleaning: ${cleaned.length} sequences\n`);
  for (const seq of cleaned) {
    console.log(`  ${seq.id}: ${seq.sequence} (${seq.length}bp)`);
  }
}

// ============================================================================
// Example 5: Pattern-Based Filtering
// ============================================================================

async function example5_patternFiltering() {
  console.log("\n=== Example 5: Pattern-Based Filtering ===\n");

  const sequences = async function* (): AsyncIterable<AbstractSequence> {
    yield { id: "chr1_gene1", sequence: "ATCGATCG", length: 8 };
    yield { id: "chr2_gene2", sequence: "GGCCAATT", length: 8 };
    yield { id: "scaffold_1", sequence: "TTAACCGG", length: 8 };
    yield { id: "chr3_gene3", sequence: "AAAAAAAA", length: 8 };
    yield { id: "plasmid_1", sequence: "GCGCGCGC", length: 8 };
  };

  // Filter by ID pattern and sequence content
  const filtered = await seqops(sequences())
    .filter({ pattern: /^chr/ }) // Keep only chromosome sequences
    .filter({ hasAmbiguous: false }) // No ambiguous bases
    .filter((seq) => !seq.sequence.match(/A{4,}/)) // Custom: no poly-A stretches
    .collect();

  console.log("Filtered sequences (chromosomes, no ambiguous, no poly-A):");
  for (const seq of filtered) {
    console.log(`  ${seq.id}: ${seq.sequence}`);
  }
}

// ============================================================================
// Example 6: Chaining Multiple Transformations
// ============================================================================

async function example6_chainedTransformations() {
  console.log("\n=== Example 6: Chaining Multiple Transformations ===\n");

  const sequences = async function* (): AsyncIterable<AbstractSequence> {
    yield { id: "dna_1", sequence: "ATCGATCG", length: 8 };
    yield { id: "dna_2", sequence: "GGCCAATT", length: 8 };
  };

  console.log("Original sequences:");
  for await (const seq of sequences()) {
    console.log(`  ${seq.id}: ${seq.sequence}`);
  }

  // Apply multiple transformations in sequence
  const transformed = await seqops(sequences())
    .transform({ complement: true }) // Step 1: Complement
    .transform({ reverse: true }) // Step 2: Reverse
    .transform({ toRNA: true }) // Step 3: Convert to RNA
    .transform({ lowerCase: true }) // Step 4: Lowercase
    .collect();

  console.log("\nAfter transformations (complement → reverse → RNA → lowercase):");
  for (const seq of transformed) {
    console.log(`  ${seq.id}: ${seq.sequence}`);
  }
}

// ============================================================================
// Example 7: Using Custom Functions
// ============================================================================

async function example7_customFunctions() {
  console.log("\n=== Example 7: Using Custom Filter and Transform Functions ===\n");

  const sequences = async function* (): AsyncIterable<AbstractSequence> {
    yield { id: "seq_001", sequence: "ATCGATCGATCG", length: 12 };
    yield { id: "seq_002", sequence: "GGCCGGCC", length: 8 };
    yield { id: "seq_003", sequence: "TTAATTAATTAA", length: 12 };
  };

  // Custom filter: keep sequences with even length and containing 'CG'
  const customFilter = (seq: AbstractSequence): boolean => {
    return seq.length % 2 === 0 && seq.sequence.includes("CG");
  };

  // Custom transform: mask middle third of sequence with 'N'
  const maskMiddle = (seq: string): string => {
    const third = Math.floor(seq.length / 3);
    return seq.substring(0, third) + "N".repeat(third) + seq.substring(2 * third);
  };

  const results = await seqops(sequences())
    .filter(customFilter) // Apply custom filter
    .transform({ custom: maskMiddle }) // Apply custom transform
    .collect();

  console.log("Custom filtered and transformed:");
  for (const seq of results) {
    console.log(`  ${seq.id}: ${seq.sequence}`);
  }
}

// ============================================================================
// Main: Run All Examples
// ============================================================================

async function main() {
  console.log("========================================");
  console.log("    SeqOps Semantic API Demonstration   ");
  console.log("========================================");

  try {
    await example1_basicOperations();
    await example2_fastqQualityControl();
    await example3_gcContentAnalysis();
    await example4_complexPipeline();
    await example5_patternFiltering();
    await example6_chainedTransformations();
    await example7_customFunctions();

    console.log("\n========================================");
    console.log("         All Examples Complete!         ");
    console.log("========================================\n");

    console.log("Key Benefits of the New API:");
    console.log("  ✓ Clear, semantic method names");
    console.log("  ✓ Single responsibility per method");
    console.log("  ✓ Intuitive chaining and composition");
    console.log("  ✓ Type-safe with excellent IDE support");
    console.log("  ✓ Easy to understand and maintain\n");
  } catch (error) {
    console.error("Error running examples:", error);
    process.exit(1);
  }
}

// Run the examples
if (import.meta.main) {
  await main();
}

export { main };
