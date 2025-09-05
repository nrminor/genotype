/**
 * Tests for TransformProcessor
 *
 * Tests the semantic transform() method that modifies sequence content.
 */

import { describe, expect, test } from "bun:test";
import { TransformProcessor } from "../../../src/operations/transform";
import type { TransformOptions } from "../../../src/operations/types";
import type { AbstractSequence } from "../../../src/types";

describe("TransformProcessor", () => {
  const processor = new TransformProcessor();

  // Helper to create test sequence
  function createSequence(sequence: string): AbstractSequence {
    return {
      id: "test",
      sequence,
      length: sequence.length,
      format: "fasta" as const,
    };
  }

  // Helper to process single sequence
  async function processOne(sequence: string, options: TransformOptions): Promise<string> {
    const input = createSequence(sequence);
    const source = async function* () {
      yield input;
    };

    for await (const result of processor.process(source(), options)) {
      return result.sequence;
    }

    throw new Error("No result");
  }

  describe("reverse operations", () => {
    test("reverses sequence", async () => {
      const result = await processOne("ATCG", { reverse: true });
      expect(result).toBe("GCTA");
    });
  });

  describe("complement operations", () => {
    test("complements DNA sequence", async () => {
      const result = await processOne("ATCG", { complement: true });
      expect(result).toBe("TAGC");
    });

    test("complements RNA sequence", async () => {
      const result = await processOne("AUCG", { complement: true });
      // RNA complement uses DNA complement rules (U→A becomes T, not U)
      expect(result).toBe("TAGC");
    });

    test("handles mixed case", async () => {
      const result = await processOne("AtCg", { complement: true });
      expect(result).toBe("TaGc");
    });
  });

  describe("reverse complement", () => {
    test("reverse complements sequence", async () => {
      const result = await processOne("ATCG", { reverseComplement: true });
      expect(result).toBe("CGAT");
    });

    test("reverse complement takes precedence over individual ops", async () => {
      const result = await processOne("ATCG", {
        reverseComplement: true,
        reverse: true,
        complement: true,
      });
      expect(result).toBe("CGAT"); // Should only do reverse complement
    });
  });

  describe("RNA/DNA conversion", () => {
    test("converts DNA to RNA", async () => {
      const result = await processOne("ATCG", { toRNA: true });
      expect(result).toBe("AUCG");
    });

    test("converts RNA to DNA", async () => {
      const result = await processOne("AUCG", { toDNA: true });
      expect(result).toBe("ATCG");
    });

    test("toRNA takes precedence over toDNA", async () => {
      const result = await processOne("ATCG", {
        toRNA: true,
        toDNA: true,
      });
      expect(result).toBe("AUCG");
    });
  });

  describe("case transformations", () => {
    test("converts to uppercase", async () => {
      const result = await processOne("atcg", { upperCase: true });
      expect(result).toBe("ATCG");
    });

    test("converts to lowercase", async () => {
      const result = await processOne("ATCG", { lowerCase: true });
      expect(result).toBe("atcg");
    });

    test("uppercase takes precedence over lowercase", async () => {
      const result = await processOne("AtCg", {
        upperCase: true,
        lowerCase: true,
      });
      expect(result).toBe("ATCG");
    });
  });

  describe("custom transformations", () => {
    test("applies custom transformation", async () => {
      const result = await processOne("ATCG", {
        custom: (seq: string) => seq.split("").reverse().join(""),
      });
      expect(result).toBe("GCTA");
    });

    test("custom transformation runs after other operations", async () => {
      const result = await processOne("ATCG", {
        upperCase: true,
        custom: (seq: string) => seq.replace(/[AT]/g, "N"),
      });
      expect(result).toBe("NNCG");
    });
  });

  describe("operation order", () => {
    test("applies operations in correct order", async () => {
      // Order should be: reverseComplement -> toRNA -> upperCase
      const result = await processOne("atcg", {
        reverseComplement: true,
        toRNA: true,
        upperCase: true,
      });

      // atcg -> cgat (reverse complement) -> cgau (to RNA) -> CGAU (uppercase)
      expect(result).toBe("CGAU");
    });
  });

  describe("unchanged sequences", () => {
    test("returns same object if sequence unchanged", async () => {
      const input = createSequence("ATCG");
      const source = async function* () {
        yield input;
      };

      for await (const result of processor.process(source(), {})) {
        expect(result).toBe(input); // Same reference
      }
    });

    test("returns new object if sequence changed", async () => {
      const input = createSequence("atcg"); // lowercase input
      const source = async function* () {
        yield input;
      };

      for await (const result of processor.process(source(), {
        upperCase: true,
      })) {
        expect(result).not.toBe(input); // Different reference
        expect(result.sequence).toBe("ATCG"); // Changed to uppercase
      }
    });
  });
});
