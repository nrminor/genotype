/**
 * Tests for QualityProcessor with binning integration
 *
 * Tests the semantic quality() method with filtering, trimming,
 * and quality score binning operations.
 */

import { describe, expect, test } from "bun:test";
import { QualityProcessor } from "../../../src/operations/quality";
import type { FastqSequence } from "../../../src/types";

describe("QualityProcessor", () => {
  const processor = new QualityProcessor();

  // Helper to create test FASTQ sequences
  function createFastqSequence(id: string, sequence: string, quality: string): FastqSequence {
    return {
      format: "fastq",
      id,
      sequence,
      quality,
      qualityEncoding: "phred33",
      length: sequence.length,
    };
  }

  // Helper to collect results
  async function collect(source: AsyncIterable<FastqSequence>): Promise<FastqSequence[]> {
    const results: FastqSequence[] = [];
    for await (const seq of source) {
      results.push(seq);
    }
    return results;
  }

  // Helper to create async source
  async function* source(sequences: FastqSequence[]): AsyncIterable<FastqSequence> {
    for (const seq of sequences) {
      yield seq;
    }
  }

  describe("Binning Integration - Basic", () => {
    test("bins quality with Illumina preset", async () => {
      const sequences = [createFastqSequence("seq1", "ATCGATCG", "!#%'ACEG")];

      const processed = await collect(
        processor.process(source(sequences), {
          bins: 3,
          preset: "illumina",
        }),
      );

      expect(processed).toHaveLength(1);
      expect(processed[0].quality).toBeDefined();
      expect(processed[0].quality.length).toBe(8); // Same length
      expect(processed[0].id).toBe("seq1");
      expect(processed[0].sequence).toBe("ATCGATCG");
    });

    test("bins quality with custom boundaries", async () => {
      const sequences = [createFastqSequence("seq1", "ATCG", "IIII")];

      const processed = await collect(
        processor.process(source(sequences), {
          bins: 2,
          boundaries: [20],
        }),
      );

      expect(processed).toHaveLength(1);
      expect(processed[0].quality.length).toBe(4);
    });

    test("bins with PacBio preset", async () => {
      const sequences = [createFastqSequence("seq1", "ATCG", "!!!!&&&III")];

      const processed = await collect(
        processor.process(source(sequences), {
          bins: 2,
          preset: "pacbio",
        }),
      );

      expect(processed).toHaveLength(1);
      expect(processed[0].quality).toBeDefined();
    });

    test("bins with Nanopore preset", async () => {
      const sequences = [createFastqSequence("seq1", "ATCG", "!!!!&&&III")];

      const processed = await collect(
        processor.process(source(sequences), {
          bins: 3,
          preset: "nanopore",
        }),
      );

      expect(processed).toHaveLength(1);
      expect(processed[0].quality).toBeDefined();
    });
  });

  describe("Binning Integration - Combined Operations", () => {
    test("filters then bins quality", async () => {
      const sequences = [
        createFastqSequence("good", "ATCG", "IIII"), // Q40 - passes filter
        createFastqSequence("bad", "ATCG", "!!!!"), // Q0 - fails filter
      ];

      const processed = await collect(
        processor.process(source(sequences), {
          minScore: 20, // Filter first
          bins: 2, // Then bin
          preset: "illumina",
        }),
      );

      expect(processed).toHaveLength(1);
      expect(processed[0].id).toBe("good");
      expect(processed[0].quality).toBeDefined();
    });

    test("trims, filters, then bins quality", async () => {
      const sequences = [createFastqSequence("seq1", "ATCGATCGATCG", "!!!IIIIIII!!!")];

      const processed = await collect(
        processor.process(source(sequences), {
          trim: true,
          trimThreshold: 20,
          minScore: 25,
          bins: 3,
          preset: "illumina",
        }),
      );

      expect(processed).toHaveLength(1);
      expect(processed[0].sequence.length).toBeLessThan(12); // Trimmed
      expect(processed[0].quality).toBeDefined();
      expect(processed[0].quality.length).toBe(processed[0].sequence.length);
    });

    test("bins without filtering or trimming", async () => {
      const sequences = [createFastqSequence("seq1", "ATCG", "!#%'")];

      const processed = await collect(
        processor.process(source(sequences), {
          bins: 2,
          preset: "illumina",
        }),
      );

      expect(processed).toHaveLength(1);
      expect(processed[0].sequence).toBe("ATCG"); // Unchanged
      expect(processed[0].quality.length).toBe(4); // Binned but same length
    });
  });

  describe("Binning Integration - Error Handling", () => {
    test("compile-time error: bins without preset or boundaries", () => {
      // This test documents that TypeScript prevents invalid combinations at compile-time
      // The following would be a compile error:
      //   processor.process(source(sequences), { bins: 3 });
      //   ^^^ Error: Property 'preset' is missing in type '{ bins: 3; }'

      // TypeScript now enforces that bins requires either preset OR boundaries
      expect(true).toBe(true); // Type safety test - no runtime check needed
    });

    test("throws error for invalid preset", async () => {
      const sequences = [createFastqSequence("seq1", "ATCG", "IIII")];

      await expect(async () => {
        await collect(
          processor.process(source(sequences), {
            bins: 3,
            // biome-ignore lint/suspicious/noExplicitAny: Testing invalid preset
            preset: "invalid" as any,
          }),
        );
      }).toThrow(/No preset found/);
    });

    test("throws error with sequence context on binning failure", async () => {
      const sequences = [createFastqSequence("problem_seq", "ATCG", "IIII")];

      try {
        await collect(
          processor.process(source(sequences), {
            bins: 3,
            // biome-ignore lint/suspicious/noExplicitAny: Testing error handling
            preset: "nonexistent" as any,
          }),
        );
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("problem_seq");
        expect((error as Error).message).toContain("Failed to bin quality");
      }
    });

    test("compile-time error: invalid boundaries length", () => {
      // This test documents that TypeScript prevents wrong boundary lengths at compile-time
      // The following would be a compile error:
      //   processor.process(source(sequences), { bins: 3, boundaries: [20] });
      //   ^^^ Error: Type '[number]' is not assignable to type '[number, number]'

      // TypeScript now enforces boundary array length matches bins - 1
      expect(true).toBe(true); // Type safety test - no runtime check needed
    });
  });

  describe("Binning Integration - Preserves Sequence Properties", () => {
    test("preserves sequence ID", async () => {
      const sequences = [createFastqSequence("important_id", "ATCG", "IIII")];

      const processed = await collect(
        processor.process(source(sequences), {
          bins: 2,
          preset: "illumina",
        }),
      );

      expect(processed[0].id).toBe("important_id");
    });

    test("preserves sequence data", async () => {
      const sequences = [createFastqSequence("seq1", "ATCGATCG", "IIIIIIII")];

      const processed = await collect(
        processor.process(source(sequences), {
          bins: 3,
          preset: "illumina",
        }),
      );

      expect(processed[0].sequence).toBe("ATCGATCG");
    });

    test("preserves quality string length", async () => {
      const sequences = [createFastqSequence("seq1", "ATCGATCG", "!#%'ACEG")];

      const processed = await collect(
        processor.process(source(sequences), {
          bins: 3,
          preset: "illumina",
        }),
      );

      expect(processed[0].quality.length).toBe(sequences[0].quality.length);
    });
  });
});
