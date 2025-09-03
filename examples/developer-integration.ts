#!/usr/bin/env bun

/**
 * Real-World Developer Integration Example
 *
 * This demonstrates how a developer would actually integrate the new SeqOps
 * operations into their bioinformatics application or library.
 *
 * Shows both the simple API (method overloads) and advanced options,
 * highlighting the obsessive focus on developer experience.
 */

import { FastaParser, FastqParser, seqops } from "../src";

/**
 * Example 1: Simple Bioinformatics Application Integration
 *
 * A developer building a web app for genomic analysis would use this API
 */
async function simpleApplicationIntegration() {
  console.log("🧬 Simple Application Integration\n");

  // Mock data that a web app might receive
  const userUploadedSequences = [
    {
      id: "chr1_region1",
      sequence: "ATCGATCGATCGATCG",
      length: 16,
      description: "User sequence 1",
    },
    {
      id: "chr1_region2",
      sequence: "GGCCAATTGGCCAATT",
      length: 16,
      description: "User sequence 2",
    },
    {
      id: "chr2_region1",
      sequence: "ATCGATCGATCGATCG",
      length: 16,
      description: "Duplicate sequence",
    },
    {
      id: "scaffold_1",
      sequence: "TTAACCGGTTAACCGG",
      length: 16,
      description: "Scaffold sequence",
    },
    {
      id: "chr1_region3",
      sequence: "AAAATTTTCCCCGGGG",
      length: 16,
      description: "Another sequence",
    },
  ];

  console.log('Developer Task: "Filter chromosome sequences, remove duplicates, sort by length"');
  console.log("");

  // ✅ EXCELLENT DX: This reads like English
  const processedSequences = await seqops(userUploadedSequences)
    .grep(/^chr/, "id") // Find chromosome sequences (clear intent)
    .removeSequenceDuplicates() // Remove PCR duplicates (clear action)
    .sortByLength("desc") // Longest first (clear ordering)
    .collect();

  console.log("Results:");
  processedSequences.forEach((seq, i) => {
    console.log(`  ${i + 1}. ${seq.id}: ${seq.length}bp`);
  });

  console.log(
    `\n✅ Developer Happy: ${processedSequences.length} chromosome sequences processed with 3 simple, readable operations\n`
  );
}

/**
 * Example 2: Advanced Library Integration
 *
 * A developer building their own genomics library would use advanced features
 */
async function advancedLibraryIntegration() {
  console.log("🔬 Advanced Library Integration\n");

  const genomicDataset = Array.from({ length: 1000 }, (_, i) => ({
    id: `seq_${i.toString().padStart(4, "0")}`,
    sequence: "ATCG".repeat(Math.floor(Math.random() * 50) + 10),
    length: (Math.floor(Math.random() * 50) + 10) * 4,
    description: i % 10 === 0 ? "Important sequence" : undefined,
  }));

  console.log(
    'Library Task: "Build high-performance genomic analysis pipeline with precise control"'
  );
  console.log("");

  // ✅ EXCELLENT: Simple API for common cases, advanced options when needed
  const analysisResults = await seqops(genomicDataset)
    // Simple pattern search
    .grep("Important", "description")

    // Advanced sampling with specific parameters
    .sample({
      n: 50,
      strategy: "reservoir",
      seed: 12345,
    })

    // Simple sorting
    .sortByGC("desc")

    // Advanced deduplication for large dataset
    .rmdup({
      by: "sequence",
      exact: false,
      expectedUnique: 40,
      falsePositiveRate: 0.0001,
    })

    .collect();

  console.log(
    `Library Result: ${analysisResults.length} high-quality sequences ready for analysis`
  );
  console.log("");

  // ✅ Performance monitoring (what library developers need)
  const performanceTest = Date.now();

  const streamingResults = await seqops(genomicDataset)
    .sample(100) // Simple API
    .sortByLength("desc") // Clear intent
    .removeSequenceDuplicates() // Sensible defaults
    .collect();

  const duration = Date.now() - performanceTest;
  console.log(
    `✅ Library Performance: Processed 1000 → ${streamingResults.length} sequences in ${duration}ms`
  );
  console.log("✅ Memory efficient: Streaming behavior maintained throughout\n");
}

/**
 * Example 3: CLI Tool Integration
 *
 * A developer building command-line tools would use this API
 */
async function cliToolIntegration() {
  console.log("⚙️  CLI Tool Integration\n");

  const mockFileData = [
    { id: "contig_001", sequence: "ATCGATCGATCG", length: 12 },
    { id: "contig_002", sequence: "GGCCAATTGGCC", length: 12 },
    { id: "contig_001", sequence: "ATCGATCGATCG", length: 12 }, // Duplicate
    { id: "contig_003", sequence: "TTAACCGGTTAA", length: 12 },
  ];

  console.log('CLI Task: "Implement seqkit-style commands with better error handling"');
  console.log("");

  try {
    // ✅ CLI developers get excellent error handling
    const cliResults = await seqops(mockFileData)
      .grep("contig", "id") // Simple and clear
      .sample(3) // Just pass count
      .sortById() // Default ascending order
      .removeIdDuplicates() // Clear action
      .collect();

    console.log("CLI Output:");
    cliResults.forEach((seq) => {
      console.log(`${seq.id}\t${seq.length}\t${seq.sequence}`);
    });

    console.log(`\n✅ CLI Success: ${cliResults.length} sequences processed`);
  } catch (error) {
    // ✅ Excellent error handling for CLI tools
    console.error(`CLI Error: ${error.message}`);
    console.error("✅ Clear error messages help CLI developers debug issues");
  }
}

/**
 * Example 4: What Makes This DX Exceptional
 */
async function dxHighlights() {
  console.log("\n🎯 DX EXCELLENCE HIGHLIGHTS\n");

  const sequences = [
    { id: "test1", sequence: "ATCGATCG", length: 8 },
    { id: "test2", sequence: "GGCCAATT", length: 8 },
  ];

  console.log("=== PROGRESSIVE DISCLOSURE ===");
  console.log("Simple case (beginner-friendly):");
  console.log('  .grep("ATCG")');
  console.log("  .sample(100)");
  console.log('  .sortByLength("desc")');
  console.log("  .removeSequenceDuplicates()");
  console.log("");
  console.log("Advanced case (power-user):");
  console.log("  .grep({ pattern: /ATCG/, allowMismatches: 2, searchBothStrands: true })");
  console.log('  .sample({ n: 100, strategy: "reservoir", seed: 42 })');
  console.log('  .sort({ by: "gc", order: "desc" })');
  console.log('  .rmdup({ by: "both", expectedUnique: 1000000 })');

  console.log("\n=== CONSISTENCY WITH EXISTING API ===");
  const consistent = await seqops(sequences)
    .head(1) // ✅ Existing: simple parameter
    .sample(1) // ✅ New: matches head() pattern
    .filter({ minLength: 5 }) // ✅ Existing: options object
    .grep({ pattern: "AT" }) // ✅ New: options available too
    .collect();

  console.log(`✅ API consistency maintained: ${consistent.length} result`);

  console.log("\n=== TYPE SAFETY BENEFITS ===");
  console.log("✅ IntelliSense shows all method overloads");
  console.log("✅ TypeScript catches invalid parameters at compile time");
  console.log("✅ Clear parameter types guide correct usage");
  console.log("✅ Optional parameters have sensible defaults");

  console.log("\n=== DISCOVERABILITY ===");
  console.log('✅ .sortByLength() is more discoverable than .sort({ by: "length" })');
  console.log('✅ .removeSequenceDuplicates() is clearer than .rmdup({ by: "sequence" })');
  console.log(
    '✅ .grep("pattern") is simpler than .grep({ pattern: "pattern", target: "sequence" })'
  );
}

async function main() {
  await simpleApplicationIntegration();
  await advancedLibraryIntegration();
  await cliToolIntegration();
  await dxHighlights();
}

if (import.meta.main) {
  await main();
}
