#!/usr/bin/env bun

/**
 * Developer Experience Demonstration
 *
 * This script reveals the actual DX of the new operations from a developer's perspective.
 * It exposes potential friction points and areas for improvement.
 */

import { FastaParser, seqops } from "../src";
import type { GrepOptions, SampleOptions, SortOptions, RmdupOptions } from "../src";

async function demonstrateActualDeveloperExperience() {
  console.log("🔍 Developer Experience Analysis\n");

  // Create test data
  const sequences = [
    { id: "seq1", sequence: "ATCGATCG", length: 8 },
    { id: "seq2", sequence: "GGCCAATT", length: 8 },
    { id: "seq3", sequence: "TTAACCGG", length: 8 },
  ];

  console.log("=== 1. GREP OPERATION DX ===");

  // ❌ DX ISSUE: Verbose type annotations required
  const grepOptions: GrepOptions = {
    pattern: "ATCG",
    target: "sequence", // Developer must remember exact string literals
  };

  try {
    const grepResults = await seqops(sequences)
      .grep(grepOptions) // ❌ Requires separate options object
      .collect();

    console.log(`✓ Grep found ${grepResults.length} matches`);
  } catch (error) {
    console.log(`❌ Grep error: ${error.message}`);
  }

  // 🤔 QUESTION: Is this the best DX? Compare to alternatives:

  // Alternative A: Inline options (current)
  const altA = await seqops(sequences).grep({ pattern: "ATCG", target: "sequence" }).collect();

  // Alternative B: Positional arguments (more ergonomic?)
  // const altB = await seqops(sequences)
  //   .grep('ATCG', 'sequence')  // Simpler but less discoverable
  //   .collect();

  // Alternative C: Method chaining for common cases
  // const altC = await seqops(sequences)
  //   .grepSequence('ATCG')      // Specific method for sequences
  //   .grepId(/^chr/)            // Specific method for IDs
  //   .collect();

  console.log("=== 2. SAMPLE OPERATION DX ===");

  // ❌ DX ISSUE: Inconsistent naming with existing patterns
  const sampleOptions: SampleOptions = {
    n: 2, // ❌ Why 'n' instead of 'count'? Inconsistent with .head(count)
    strategy: "reservoir", // ❌ Must remember strategy names
  };

  const sampleResults = await seqops(sequences).sample(sampleOptions).collect();

  console.log(`✓ Sample returned ${sampleResults.length} sequences`);

  console.log("=== 3. SORT OPERATION DX ===");

  // ❌ DX ISSUE: Complex options object for simple operations
  const sortOptions: SortOptions = {
    by: "length", // ❌ Must remember string literals
    order: "desc", // ❌ 'desc' vs 'descending' - inconsistent with other libraries
  };

  const sortResults = await seqops(sequences).sort(sortOptions).collect();

  console.log(`✓ Sort completed, longest: ${sortResults[0]?.length}bp`);

  // 🤔 QUESTION: Would these be more ergonomic?
  // .sortByLength('desc')
  // .sortByGC('asc')
  // .sortById()

  console.log("=== 4. RMDUP OPERATION DX ===");

  // ❌ DX ISSUE: Too many options for simple use case
  const rmdupOptions: RmdupOptions = {
    by: "sequence", // ❌ More string literals to remember
    caseSensitive: true, // ❌ Reasonable default but still required thought
    exact: false, // ❌ What does 'exact' mean? Needs better naming
  };

  const rmdupResults = await seqops(sequences).rmdup(rmdupOptions).collect();

  console.log(`✓ Rmdup kept ${rmdupResults.length} unique sequences`);

  console.log("\n=== 5. COMPOSITE PIPELINE DX ===");

  // ✅ GOOD: This actually works well and reads clearly
  const pipelineResults = await seqops(sequences)
    .grep({ pattern: /^seq/, target: "id" })
    .sample({ n: 2, strategy: "reservoir" })
    .sort({ by: "length", order: "desc" })
    .rmdup({ by: "sequence" })
    .collect();

  console.log(`✓ Pipeline completed: ${pipelineResults.length} results`);

  console.log("\n=== DX FRICTION POINTS IDENTIFIED ===");
  console.log("❌ 1. Too many string literals to remember");
  console.log("❌ 2. Inconsistent naming (n vs count)");
  console.log("❌ 3. Complex options objects for simple operations");
  console.log("❌ 4. Unclear option meanings (exact, strategy names)");
  console.log("❌ 5. No method overloads for common cases");

  console.log("\n✅ WHAT WORKS WELL:");
  console.log("✓ 1. Perfect composability");
  console.log("✓ 2. Type safety catches errors early");
  console.log("✓ 3. Clear error messages");
  console.log("✓ 4. Streaming behavior works transparently");
}

async function demonstrateImprovedDX() {
  console.log("\n🎯 IMPROVED DX WITH METHOD OVERLOADS\n");

  const sequences = [
    { id: "chr1_gene1", sequence: "ATCGATCG", length: 8 },
    { id: "chr2_gene2", sequence: "GGCCAATT", length: 8 },
    { id: "scaffold_1", sequence: "TTAACCGG", length: 8 },
  ];

  // ✅ IMPROVED: Method overloads for common cases
  console.log("=== IMPROVED GREP DX ===");

  // Simple string search (most common case)
  const simple = await seqops(sequences)
    .grep("ATCG") // Default to sequence search - much simpler!
    .collect();

  console.log(`Simple grep: ${simple.length} matches`);

  // ID search with overloaded parameter
  const idSearch = await seqops(sequences)
    .grep(/^chr/, "id") // Pattern + target - cleaner than options object
    .collect();

  console.log(`ID grep: ${idSearch.length} matches`);

  // ✅ IMPROVED: Simplified sampling
  console.log("=== IMPROVED SAMPLE DX ===");

  const sampled = await seqops(sequences)
    .sample(2) // Just pass count directly - much simpler!
    .collect();

  console.log(`Sampled: ${sampled.length} sequences`);

  // Advanced sampling with strategy
  const systematicSampled = await seqops(sequences)
    .sample(2, "systematic") // Count + strategy - still simple
    .collect();

  console.log(`Systematic sampled: ${systematicSampled.length} sequences`);

  // ✅ IMPROVED: Intuitive sorting
  console.log("=== IMPROVED SORT DX ===");

  const sorted = await seqops(sequences)
    .sortByLength("desc") // Clear intent, no options needed
    .collect();

  console.log(`Sorted by length: ${sorted[0]?.length}bp first`);

  const gcSorted = await seqops(sequences)
    .sortByGC("asc") // Very clear what this does
    .collect();

  console.log(`Sorted by GC: ${gcSorted.length} sequences`);

  // ✅ IMPROVED: Simple deduplication
  console.log("=== IMPROVED RMDUP DX ===");

  const deduplicated = await seqops(sequences)
    .removeSequenceDuplicates() // Clear name, sensible defaults
    .collect();

  console.log(`Deduplicated: ${deduplicated.length} unique`);

  // Simple ID deduplication
  const idDeduplicated = await seqops(sequences)
    .removeIdDuplicates() // Clear intent
    .collect();

  console.log(`ID deduplicated: ${idDeduplicated.length} unique`);

  console.log("\n🎯 DX IMPROVEMENT SUMMARY:");
  console.log("✅ Method overloads for simple cases");
  console.log("✅ Convenience methods with clear names");
  console.log("✅ Sensible defaults reduce cognitive load");
  console.log("✅ Consistent with existing head(count) pattern");
  console.log("✅ Advanced options still available when needed");
}

async function main() {
  await demonstrateActualDeveloperExperience();
  await demonstrateImprovedDX();
}

if (import.meta.main) {
  await main();
}
