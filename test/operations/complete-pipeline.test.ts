/**
 * Integration tests for complete SeqOps pipeline
 *
 * Tests the full Unix philosophy pipeline with all 4 critical operations:
 * grep, sample, sort, and rmdup working together in realistic workflows.
 */

import { describe, expect, test } from "bun:test";
import { seqops } from "../../src/operations";
import type { AbstractSequence } from "../../src/types";

describe("Complete SeqOps Pipeline Integration", () => {
  test("Unix philosophy pipeline: grep → sample → sort → rmdup", async () => {
    // Create test dataset with realistic genomic characteristics
    const genomeSequences: AbstractSequence[] = [
      {
        id: "chr1_gene1",
        sequence: "ATCGATCGATCG",
        length: 12,
        description: "Chromosome 1 gene",
      },
      {
        id: "chr1_gene2",
        sequence: "GGCCAATTGGCC",
        length: 12,
        description: "Chromosome 1 gene",
      },
      {
        id: "chr2_gene1",
        sequence: "TTAACCGGTTAA",
        length: 12,
        description: "Chromosome 2 gene",
      },
      {
        id: "scaffold_1",
        sequence: "GCGCGCGCGCGC",
        length: 12,
        description: "Scaffold sequence",
      },
      {
        id: "chr1_gene1",
        sequence: "ATCGATCGATCG",
        length: 12,
        description: "Duplicate ID",
      }, // Duplicate
      {
        id: "chr1_gene3",
        sequence: "GGCCAATTGGCC",
        length: 12,
        description: "Same sequence, different ID",
      }, // Duplicate sequence
      {
        id: "chr2_gene2",
        sequence: "AAAATTTTCCCC",
        length: 12,
        description: "Chromosome 2 gene",
      },
      {
        id: "chr1_gene4",
        sequence: "ATCGATCGATCGATCG",
        length: 16,
        description: "Longer chromosome 1 gene",
      },
    ];

    // Build comprehensive pipeline using all 4 critical operations
    const results = await seqops(genomeSequences)
      // Step 1: Filter for chromosome sequences only
      .grep({ pattern: /^chr/, target: "id" })

      // Step 2: Sample a subset for analysis
      .sample({ n: 6, strategy: "systematic" })

      // Step 3: Sort by length for compression optimization
      .sort({ by: "length", order: "desc" })

      // Step 4: Remove duplicates
      .rmdup({ by: "sequence", exact: true })

      // Collect results
      .collect();

    // Verify pipeline worked correctly
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(6);

    // All sequences should be from chromosomes (not scaffolds)
    expect(results.every((seq) => seq.id.startsWith("chr"))).toBe(true);

    // Should be sorted by length descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].length).toBeGreaterThanOrEqual(results[i].length);
    }

    // Should have no duplicate sequences
    const sequences = results.map((s) => s.sequence);
    const uniqueSequences = new Set(sequences);
    expect(sequences.length).toBe(uniqueSequences.size);
  });

  test("Quality control pipeline for genomic data", async () => {
    const rawSequences: AbstractSequence[] = [
      { id: "good_seq_1", sequence: "ATCGATCGATCG", length: 12 },
      { id: "short_seq", sequence: "ATCG", length: 4 }, // Too short
      { id: "good_seq_2", sequence: "GGCCAATTGGCC", length: 12 },
      { id: "duplicate", sequence: "ATCGATCGATCG", length: 12 }, // Duplicate of good_seq_1
      { id: "at_rich", sequence: "AAAAAATTTTTT", length: 12 }, // Low GC
      { id: "gc_rich", sequence: "GGGGGGCCCCCC", length: 12 }, // High GC
      { id: "good_seq_3", sequence: "TTAACCGGTTAA", length: 12 },
    ];

    const cleanedSequences = await seqops(rawSequences)
      // Filter by length
      .filter({ minLength: 8 })

      // Filter by GC content (20-80%)
      .filter({ minGC: 20, maxGC: 80 })

      // Remove duplicates
      .rmdup({ by: "sequence" })

      // Sort for optimal compression
      .sort({ sortBy: "gc-asc" })

      .collect();

    expect(cleanedSequences.length).toBeGreaterThan(0);

    // Should be filtered and deduplicated
    expect(cleanedSequences.length).toBeLessThan(rawSequences.length);

    // Should be sorted by GC content
    for (let i = 1; i < cleanedSequences.length; i++) {
      // Calculate GC for verification (simple version)
      const gcPrev =
        ((cleanedSequences[i - 1].sequence.match(/[GC]/gi)?.length ?? 0) /
          cleanedSequences[i - 1].length) *
        100;
      const gcCurrent =
        ((cleanedSequences[i].sequence.match(/[GC]/gi)?.length ?? 0) / cleanedSequences[i].length) *
        100;
      expect(gcPrev).toBeLessThanOrEqual(gcCurrent);
    }
  });

  test("Comprehensive analysis pipeline", async () => {
    const analysisSequences: AbstractSequence[] = Array.from({ length: 50 }, (_, i) => ({
      id: `gene_${i.toString().padStart(3, "0")}`,
      sequence: i % 2 === 0 ? "ATCGATCG".repeat((i % 5) + 1) : "GGCCAATT".repeat((i % 5) + 1),
      length: ((i % 5) + 1) * 8,
      description: i % 3 === 0 ? "Important gene" : "Regular gene",
    }));

    // Complex pipeline combining all operations
    const analysisResults = await seqops(analysisSequences)
      // Find sequences with specific pattern
      .grep({ pattern: "Important", target: "description" })

      // Sample for manageable analysis size
      .sample({ n: 10, strategy: "reservoir", seed: 42 })

      // Sort by ID for consistent ordering
      .sort({ sortBy: "id" })

      // Remove any remaining duplicates
      .rmdup({ by: "both" })

      .collect();

    expect(analysisResults.length).toBeGreaterThan(0);
    expect(analysisResults.length).toBeLessThanOrEqual(10);

    // All sequences should have 'Important' in description
    expect(analysisResults.every((seq) => seq.description?.includes("Important") === true)).toBe(
      true,
    );

    // Should be sorted by ID
    for (let i = 1; i < analysisResults.length; i++) {
      expect(analysisResults[i - 1].id.localeCompare(analysisResults[i].id)).toBeLessThanOrEqual(0);
    }
  });

  test("Performance pipeline: all operations complete efficiently", async () => {
    // Create moderately large dataset
    const performanceDataset: AbstractSequence[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `seq_${i.toString().padStart(4, "0")}`,
      sequence: "ATCG".repeat((i % 50) + 1),
      length: ((i % 50) + 1) * 4,
      description: i % 10 === 0 ? "Special sequence" : undefined,
    }));

    const startTime = Date.now();

    const results = await seqops(performanceDataset)
      .grep({ pattern: /^seq_/, target: "id" }) // All sequences match
      .sample({ n: 100, strategy: "reservoir" }) // Sample down
      .sort({ by: "length", order: "desc" }) // Sort by length
      .rmdup({ by: "sequence" }) // Remove duplicates
      .collect();

    const duration = Date.now() - startTime;

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(100);
    expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

    console.log(`Pipeline processed 1000 sequences → ${results.length} results in ${duration}ms`);
  });
});
