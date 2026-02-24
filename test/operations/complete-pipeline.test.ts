/**
 * Integration tests for complete SeqOps pipeline
 *
 * Tests the full Unix philosophy pipeline with all 4 critical operations:
 * grep, sample, sort, and rmdup working together in realistic workflows.
 */

import { describe, expect, test } from "bun:test";
import { createFastaRecord } from "../../src/constructors";
import { seqops } from "../../src/operations";
import type { AbstractSequence } from "../../src/types";

/** Convert an array to an async iterable for seqops */
async function* toAsync<T>(arr: T[]): AsyncGenerator<T> {
  for (const item of arr) {
    yield item;
  }
}

describe("Complete SeqOps Pipeline Integration", () => {
  function createSequence(id: string, sequence: string, description?: string): AbstractSequence {
    return createFastaRecord({ id, sequence, description });
  }

  test("Unix philosophy pipeline: grep → sample → sort → rmdup", async () => {
    // Create test dataset with realistic genomic characteristics
    const genomeSequences: AbstractSequence[] = [
      createSequence("chr1_gene1", "ATCGATCGATCG", "Chromosome 1 gene"),
      createSequence("chr1_gene2", "GGCCAATTGGCC", "Chromosome 1 gene"),
      createSequence("chr2_gene1", "TTAACCGGTTAA", "Chromosome 2 gene"),
      createSequence("scaffold_1", "GCGCGCGCGCGC", "Scaffold sequence"),
      createSequence("chr1_gene1", "ATCGATCGATCG", "Duplicate ID"), // Duplicate
      createSequence("chr1_gene3", "GGCCAATTGGCC", "Same sequence, different ID"), // Duplicate sequence
      createSequence("chr2_gene2", "AAAATTTTCCCC", "Chromosome 2 gene"),
      createSequence("chr1_gene4", "ATCGATCGATCGATCG", "Longer chromosome 1 gene"),
    ];

    // Build comprehensive pipeline using all 4 critical operations
    const results = await seqops(toAsync(genomeSequences))
      // Step 1: Filter for chromosome sequences only
      .grep({ pattern: /^chr/, target: "id" })

      // Step 2: Sample a subset for analysis
      .sample({ n: 6, strategy: "systematic" })

      // Step 3: Sort by length for compression optimization
      .sort({ sortBy: "length" })

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
      expect(results[i - 1]!.length).toBeGreaterThanOrEqual(results[i]!.length);
    }

    // Should have no duplicate sequences
    const sequences = results.map((s) => s.sequence);
    const uniqueSequences = new Set(sequences);
    expect(sequences.length).toBe(uniqueSequences.size);
  });

  test("Quality control pipeline for genomic data", async () => {
    const rawSequences: AbstractSequence[] = [
      createSequence("good_seq_1", "ATCGATCGATCG"),
      createSequence("short_seq", "ATCG"), // Too short
      createSequence("good_seq_2", "GGCCAATTGGCC"),
      createSequence("duplicate", "ATCGATCGATCG"), // Duplicate of good_seq_1
      createSequence("at_rich", "AAAAAATTTTTT"), // Low GC
      createSequence("gc_rich", "GGGGGGCCCCCC"), // High GC
      createSequence("good_seq_3", "TTAACCGGTTAA"),
    ];

    const cleanedSequences = await seqops(toAsync(rawSequences))
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
        ((cleanedSequences[i - 1]!.sequence.match(/[GC]/gi)?.length ?? 0) /
          cleanedSequences[i - 1]!.length) *
        100;
      const gcCurrent =
        ((cleanedSequences[i]!.sequence.match(/[GC]/gi)?.length ?? 0) /
          cleanedSequences[i]!.length) *
        100;
      expect(gcPrev).toBeLessThanOrEqual(gcCurrent);
    }
  });

  test("Comprehensive analysis pipeline", async () => {
    const analysisSequences: AbstractSequence[] = Array.from({ length: 50 }, (_, i) =>
      createSequence(
        `gene_${i.toString().padStart(3, "0")}`,
        i % 2 === 0 ? "ATCGATCG".repeat((i % 5) + 1) : "GGCCAATT".repeat((i % 5) + 1),
        i % 3 === 0 ? "Important gene" : "Regular gene"
      )
    );

    // Complex pipeline combining all operations
    const analysisResults = await seqops(toAsync(analysisSequences))
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
      true
    );

    // Should be sorted by ID
    for (let i = 1; i < analysisResults.length; i++) {
      expect(analysisResults[i - 1]!.id.localeCompare(analysisResults[i]!.id)).toBeLessThanOrEqual(
        0
      );
    }
  });

  test("Performance pipeline: all operations complete efficiently", async () => {
    // Create moderately large dataset
    const performanceDataset: AbstractSequence[] = Array.from({ length: 1000 }, (_, i) => {
      const sequence = "ATCG".repeat((i % 50) + 1);
      return createSequence(
        `seq_${i.toString().padStart(4, "0")}`,
        sequence,
        i % 10 === 0 ? "Special sequence" : undefined
      );
    });

    const startTime = Date.now();

    const results = await seqops(toAsync(performanceDataset))
      .grep({ pattern: /^seq_/, target: "id" }) // All sequences match
      .sample({ n: 100, strategy: "reservoir" }) // Sample down
      .sort({ sortBy: "length" }) // Sort by length
      .rmdup({ by: "sequence" }) // Remove duplicates
      .collect();

    const duration = Date.now() - startTime;

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(100);
    expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
  });
});
