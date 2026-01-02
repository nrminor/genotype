/**
 * Tests for FilterProcessor
 *
 * Tests the semantic filter() method that removes sequences
 * based on various criteria.
 */

import { describe, expect, test } from "bun:test";
import { FilterProcessor } from "../../../src/operations/filter";
import type { AbstractSequence } from "../../../src/types";

describe("FilterProcessor", () => {
  const processor = new FilterProcessor();

  // Helper to create test sequences
  function createSequence(id: string, sequence: string): AbstractSequence {
    return {
      id,
      sequence,
      length: sequence.length,
      format: "fasta" as const,
    };
  }

  // Helper to collect results
  async function collect(source: AsyncIterable<AbstractSequence>): Promise<AbstractSequence[]> {
    const results: AbstractSequence[] = [];
    for await (const seq of source) {
      results.push(seq);
    }
    return results;
  }

  // Helper to create async source
  async function* source(sequences: AbstractSequence[]): AsyncIterable<AbstractSequence> {
    for (const seq of sequences) {
      yield seq;
    }
  }

  describe("length filtering", () => {
    test("filters by minimum length", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "ATCGATCGATCG"),
        createSequence("seq3", "AT"),
      ];

      const result = await collect(processor.process(source(sequences), { minLength: 5 }));

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("seq2");
    });

    test("filters by maximum length", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "ATCGATCGATCG"),
        createSequence("seq3", "AT"),
      ];

      const result = await collect(processor.process(source(sequences), { maxLength: 5 }));

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["seq1", "seq3"]);
    });

    test("filters by length range", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "ATCGATCGATCG"),
        createSequence("seq3", "AT"),
        createSequence("seq4", "ATCGATCG"),
      ];

      const result = await collect(
        processor.process(source(sequences), { minLength: 4, maxLength: 8 }),
      );

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["seq1", "seq4"]);
    });
  });

  describe("GC content filtering", () => {
    test("filters by minimum GC content", async () => {
      const sequences = [
        createSequence("seq1", "AAAA"), // 0% GC
        createSequence("seq2", "GCGC"), // 100% GC
        createSequence("seq3", "ATGC"), // 50% GC
      ];

      const result = await collect(processor.process(source(sequences), { minGC: 50 }));

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["seq2", "seq3"]);
    });

    test("filters by maximum GC content", async () => {
      const sequences = [
        createSequence("seq1", "AAAA"), // 0% GC
        createSequence("seq2", "GCGC"), // 100% GC
        createSequence("seq3", "ATGC"), // 50% GC
      ];

      const result = await collect(processor.process(source(sequences), { maxGC: 50 }));

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["seq1", "seq3"]);
    });
  });

  describe("pattern matching", () => {
    test("filters by ID pattern", async () => {
      const sequences = [
        createSequence("chr1_gene1", "ATCG"),
        createSequence("chr2_gene2", "ATCG"),
        createSequence("scaffold_1", "ATCG"),
      ];

      const result = await collect(processor.process(source(sequences), { pattern: /^chr/ }));

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["chr1_gene1", "chr2_gene2"]);
    });

    test("filters by sequence pattern", async () => {
      const sequences = [
        createSequence("seq1", "ATCGATCG"),
        createSequence("seq2", "AAAAAAAA"),
        createSequence("seq3", "GCGCGCGC"),
      ];

      const result = await collect(processor.process(source(sequences), { pattern: /A{4,}/ }));

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("seq2");
    });
  });

  describe("ID filtering", () => {
    test("filters by ID whitelist", async () => {
      const sequences = [
        createSequence("keep1", "ATCG"),
        createSequence("keep2", "ATCG"),
        createSequence("remove", "ATCG"),
      ];

      const result = await collect(
        processor.process(source(sequences), { ids: ["keep1", "keep2"] }),
      );

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["keep1", "keep2"]);
    });

    test("filters by ID blacklist", async () => {
      const sequences = [
        createSequence("keep1", "ATCG"),
        createSequence("keep2", "ATCG"),
        createSequence("remove", "ATCG"),
      ];

      const result = await collect(
        processor.process(source(sequences), { excludeIds: ["remove"] }),
      );

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["keep1", "keep2"]);
    });
  });

  describe("ambiguous base filtering", () => {
    test("filters sequences with ambiguous bases", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "ATCN"),
        createSequence("seq3", "RYWS"),
      ];

      const result = await collect(processor.process(source(sequences), { hasAmbiguous: false }));

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("seq1");
    });

    test("filters sequences without ambiguous bases", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"),
        createSequence("seq2", "ATCN"),
        createSequence("seq3", "RYWS"),
      ];

      const result = await collect(processor.process(source(sequences), { hasAmbiguous: true }));

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["seq2", "seq3"]);
    });
  });

  describe("custom filtering", () => {
    test("applies custom filter function", async () => {
      const sequences = [
        createSequence("seq1", "ATCG"), // length 4 (even)
        createSequence("seq2", "ATCGATCG"), // length 8 (even)
        createSequence("seq3", "ATC"), // length 3 (odd)
      ];

      const result = await collect(
        processor.process(source(sequences), {
          custom: (seq) => seq.length % 2 === 0,
        }),
      );

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["seq1", "seq2"]);
    });
  });

  describe("combined filters", () => {
    test("applies all filters with AND logic", async () => {
      const sequences = [
        createSequence("chr1", "ATCGATCG"), // 8bp, 50% GC
        createSequence("chr2", "AAAA"), // 4bp, 0% GC
        createSequence("scaffold", "GCGCGCGC"), // 8bp, 100% GC
        createSequence("chr3", "ATATATAT"), // 8bp, 0% GC
      ];

      const result = await collect(
        processor.process(source(sequences), {
          minLength: 5,
          maxGC: 60,
          pattern: /^chr/,
        }),
      );

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(["chr1", "chr3"]);
    });
  });
});
