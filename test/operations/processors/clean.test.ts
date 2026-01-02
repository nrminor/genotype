/**
 * Tests for CleanProcessor
 *
 * Tests the semantic clean() method that sanitizes sequences.
 */

import { describe, expect, test } from "bun:test";
import { CleanProcessor } from "../../../src/operations/clean";
import type { CleanOptions } from "../../../src/operations/types";
import type { AbstractSequence } from "../../../src/types";

describe("CleanProcessor", () => {
  const processor = new CleanProcessor();

  // Helper to create test sequence
  function createSequence(sequence: string, description?: string): AbstractSequence {
    return {
      id: "test",
      sequence,
      length: sequence.length,
      format: "fasta" as const,
      ...(description && { description }),
    };
  }

  // Helper to process single sequence
  async function processOne(sequence: string, options: CleanOptions): Promise<string> {
    const input = createSequence(sequence);
    const source = async function* () {
      yield input;
    };

    for await (const result of processor.process(source(), options)) {
      return result.sequence;
    }

    throw new Error("No result");
  }

  // Helper to collect results
  async function collect(source: AsyncIterable<AbstractSequence>): Promise<AbstractSequence[]> {
    const results: AbstractSequence[] = [];
    for await (const seq of source) {
      results.push(seq);
    }
    return results;
  }

  describe("gap removal", () => {
    test("removes default gap characters", async () => {
      const result = await processOne("AT-C.G*AT", { removeGaps: true });
      expect(result).toBe("ATCGAT");
    });

    test("removes custom gap characters", async () => {
      const result = await processOne("AT_C~GAT", {
        removeGaps: true,
        gapChars: "_~",
      });
      expect(result).toBe("ATCGAT");
    });

    test("preserves gaps when not removing", async () => {
      const result = await processOne("AT-C.G*AT", {});
      expect(result).toBe("AT-C.G*AT");
    });
  });

  describe("ambiguous base replacement", () => {
    test("replaces ambiguous bases with N", async () => {
      const result = await processOne("ATCNRYSWKM", {
        replaceAmbiguous: true,
      });
      expect(result).toBe("ATCNNNNNNN");
    });

    test("replaces ambiguous bases with custom character", async () => {
      const result = await processOne("ATCNRYSWKM", {
        replaceAmbiguous: true,
        replaceChar: "X",
      });
      expect(result).toBe("ATCXXXXXXX");
    });

    test("preserves standard bases", async () => {
      const result = await processOne("ATCGU", {
        replaceAmbiguous: true,
      });
      expect(result).toBe("ATCGU");
    });

    test("handles mixed case", async () => {
      const result = await processOne("atcNRYSwkm", {
        replaceAmbiguous: true,
      });
      expect(result).toBe("atcNNNNNNN");
    });
  });

  describe("whitespace trimming", () => {
    test("trims sequence whitespace", async () => {
      const result = await processOne("  ATCG  \n", {
        trimWhitespace: true,
      });
      expect(result).toBe("ATCG");
    });

    test("trims description whitespace", async () => {
      const input = createSequence("ATCG", "  test description  ");
      const source = async function* () {
        yield input;
      };

      for await (const result of processor.process(source(), {
        trimWhitespace: true,
      })) {
        expect(result.description).toBe("test description");
      }
    });
  });

  describe("empty sequence removal", () => {
    test("removes empty sequences", async () => {
      const sequences = [createSequence("ATCG"), createSequence(""), createSequence("GCTA")];

      const source = async function* () {
        for (const seq of sequences) yield seq;
      };

      const result = await collect(processor.process(source(), { removeEmpty: true }));

      expect(result).toHaveLength(2);
      expect(result[0].sequence).toBe("ATCG");
      expect(result[1].sequence).toBe("GCTA");
    });

    test("removes sequences that become empty after cleaning", async () => {
      const sequences = [createSequence("ATCG"), createSequence("---"), createSequence("GCTA")];

      const source = async function* () {
        for (const seq of sequences) yield seq;
      };

      const result = await collect(
        processor.process(source(), {
          removeGaps: true,
          removeEmpty: true,
        }),
      );

      expect(result).toHaveLength(2);
      expect(result[0].sequence).toBe("ATCG");
      expect(result[1].sequence).toBe("GCTA");
    });
  });

  describe("combined operations", () => {
    test("applies multiple cleaning operations", async () => {
      const result = await processOne("  AT-CN  ", {
        trimWhitespace: true,
        removeGaps: true,
        replaceAmbiguous: true,
      });
      expect(result).toBe("ATCN");
    });

    test("operation order: trim, gaps, then ambiguous", async () => {
      const result = await processOne("  -NRYAT-  ", {
        trimWhitespace: true,
        removeGaps: true,
        replaceAmbiguous: true,
        replaceChar: "X",
      });
      // Should be: "  -NRYAT-  " -> "-NRYAT-" -> "NRYAT" -> "XXXAT"
      expect(result).toBe("XXXAT");
    });
  });

  describe("unchanged sequences", () => {
    test("returns same object if nothing changed", async () => {
      const input = createSequence("ATCG");
      const source = async function* () {
        yield input;
      };

      for await (const result of processor.process(source(), {})) {
        expect(result).toBe(input); // Same reference
      }
    });

    test("returns new object if sequence changed", async () => {
      const input = createSequence("AT-CG");
      const source = async function* () {
        yield input;
      };

      for await (const result of processor.process(source(), {
        removeGaps: true,
      })) {
        expect(result).not.toBe(input); // Different reference
        expect(result.sequence).toBe("ATCG");
      }
    });
  });
});
