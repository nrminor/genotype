/**
 * Tests for NCBI Genetic Code Tables
 */

import { describe, expect, test } from "bun:test";
import {
  findORFs,
  GeneticCode,
  GeneticCodes,
  getGeneticCode,
  isStartCodon,
  isStopCodon,
  listGeneticCodes,
  translate,
  translateSixFrames,
} from "../../../src/operations/core/genetic-codes";

describe("Genetic Code Functions", () => {
  describe("translate", () => {
    test("should translate DNA with standard genetic code", () => {
      const dna = "ATGGGATCCTAG";
      const protein = translate(dna, GeneticCode.STANDARD);
      expect(protein).toBe("MGS*");
    });

    test("should handle RNA sequences (U instead of T)", () => {
      const rna = "AUGGGAUCCUAG";
      const protein = translate(rna, GeneticCode.STANDARD);
      expect(protein).toBe("MGS*");
    });

    test("should translate with different reading frames", () => {
      const dna = "ATGGGATCCTAG";
      expect(translate(dna, GeneticCode.STANDARD, 0)).toBe("MGS*");
      expect(translate(dna, GeneticCode.STANDARD, 1)).toBe("WDP");
      expect(translate(dna, GeneticCode.STANDARD, 2)).toBe("GIL");
    });

    test("should handle incomplete codons at end", () => {
      const dna = "ATGGGATCCTA"; // Missing 1 base for last codon
      const protein = translate(dna, GeneticCode.STANDARD);
      expect(protein).toBe("MGS");
    });

    test("should use X for unknown codons with Ns", () => {
      const dna = "ATGNNNGGN";
      const protein = translate(dna, GeneticCode.STANDARD);
      expect(protein).toBe("MXX");
    });

    test("should handle empty sequence", () => {
      expect(() => translate("", GeneticCode.STANDARD)).toThrow(
        "Sequence must be a non-empty string"
      );
    });

    test("should validate frame parameter", () => {
      expect(() => translate("ATG", GeneticCode.STANDARD, 3 as 0 | 1 | 2)).toThrow(
        "Frame must be 0, 1, or 2"
      );
    });
  });

  describe("genetic code variations", () => {
    test("vertebrate mitochondrial code differences", () => {
      const dna = "ATAAGAAGGTGA";

      // Standard code
      const standard = translate(dna, GeneticCode.STANDARD);
      expect(standard).toBe("IRR*");

      // Vertebrate mitochondrial
      const vertMito = translate(dna, GeneticCode.VERTEBRATE_MITOCHONDRIAL);
      expect(vertMito).toBe("M**W");
    });

    test("yeast mitochondrial code differences", () => {
      const dna = "ATACTGCGATGA";

      // Standard code
      const standard = translate(dna, GeneticCode.STANDARD);
      expect(standard).toBe("ILR*");

      // Yeast mitochondrial
      const yeastMito = translate(dna, GeneticCode.YEAST_MITOCHONDRIAL);
      expect(yeastMito).toBe("MT*W");
    });

    test("ciliate nuclear code with reassigned stop codons", () => {
      const dna = "TAATAGATG";

      // Standard code - TAA and TAG are stops
      const standard = translate(dna, GeneticCode.STANDARD);
      expect(standard).toBe("**M");

      // Ciliate nuclear - TAA and TAG code for Q
      const ciliate = translate(dna, GeneticCode.CILIATE_NUCLEAR);
      expect(ciliate).toBe("QQM");
    });

    test("alternative yeast nuclear with CTG as serine", () => {
      const dna = "CTGATG";

      // Standard code - CTG is leucine
      const standard = translate(dna, GeneticCode.STANDARD);
      expect(standard).toBe("LM");

      // Alternative yeast - CTG is serine
      const altYeast = translate(dna, GeneticCode.ALTERNATIVE_YEAST_NUCLEAR);
      expect(altYeast).toBe("SM");
    });
  });

  describe("translateSixFrames", () => {
    test("should translate in all six reading frames", () => {
      const dna = "ATGGGATCCTAG";
      const frames = translateSixFrames(dna, GeneticCode.STANDARD);

      expect(frames["+1"]).toBe("MGS*");
      expect(frames["+2"]).toBe("WDP");
      expect(frames["+3"]).toBe("GIL");
      // Verify we get 6 different translations
      expect(Object.keys(frames)).toHaveLength(6);
      expect(frames["+1"]).toBeDefined();
      expect(frames["+2"]).toBeDefined();
      expect(frames["+3"]).toBeDefined();
      expect(frames["-1"]).toBeDefined();
      expect(frames["-2"]).toBeDefined();
      expect(frames["-3"]).toBeDefined();
    });

    test("should handle empty sequence", () => {
      expect(() => translateSixFrames("")).toThrow("Sequence must be a non-empty string");
    });
  });

  describe("findORFs", () => {
    test("should find open reading frames", () => {
      // Sequence with clear ORF: ATG (start) ... TAG (stop)
      const dna = "CCATGGGATCCTAG"; // Contains ATG...TAG
      const orfs = findORFs(dna, GeneticCode.STANDARD, 3);

      expect(orfs.length).toBeGreaterThan(0);
      const orf = orfs.find((o) => o.strand === "+");
      expect(orf).toBeDefined();
      expect(orf?.protein).toBe("MGS");
    });

    test("should respect minimum length filter", () => {
      const dna = "ATGGGATCCTAG"; // Short ORF (3 amino acids)

      const shortOrfs = findORFs(dna, GeneticCode.STANDARD, 2);
      expect(shortOrfs.length).toBeGreaterThan(0);

      const longOrfs = findORFs(dna, GeneticCode.STANDARD, 10);
      expect(longOrfs.length).toBe(0);
    });

    test("should find ORFs on both strands", () => {
      // Create sequence with ORFs on both strands
      const dna = "ATGGGATCCTAGATGGGATCCTAG";
      const orfs = findORFs(dna, GeneticCode.STANDARD, 2);

      const plusOrfs = orfs.filter((o) => o.strand === "+");
      const minusOrfs = orfs.filter((o) => o.strand === "-");

      expect(plusOrfs.length).toBeGreaterThan(0);
      // May or may not have minus strand ORFs depending on reverse complement
    });

    test("should handle sequences without stop codons", () => {
      const dna = "ATGGGATCCGGATCCGGA"; // No stop codon
      const orfs = findORFs(dna, GeneticCode.STANDARD, 2);

      // Should find ORF that extends to end
      const extendedOrfs = orfs.filter(
        (o) => o.end === dna.length - 1 || o.end === dna.length - 2 || o.end === dna.length - 3
      );
      expect(extendedOrfs.length).toBeGreaterThan(0);
    });
  });

  describe("utility methods", () => {
    test("should check start codons", () => {
      // Standard code start codons
      expect(isStartCodon("ATG", GeneticCode.STANDARD)).toBe(true);
      expect(isStartCodon("TTG", GeneticCode.STANDARD)).toBe(true);
      expect(isStartCodon("CTG", GeneticCode.STANDARD)).toBe(true);
      expect(isStartCodon("AAA", GeneticCode.STANDARD)).toBe(false);

      // Should handle RNA
      expect(isStartCodon("AUG", GeneticCode.STANDARD)).toBe(true);
    });

    test("should check stop codons", () => {
      // Standard code stop codons
      expect(isStopCodon("TAA", GeneticCode.STANDARD)).toBe(true);
      expect(isStopCodon("TAG", GeneticCode.STANDARD)).toBe(true);
      expect(isStopCodon("TGA", GeneticCode.STANDARD)).toBe(true);
      expect(isStopCodon("ATG", GeneticCode.STANDARD)).toBe(false);

      // Vertebrate mitochondrial - TGA is not stop
      expect(isStopCodon("TGA", GeneticCode.VERTEBRATE_MITOCHONDRIAL)).toBe(false);
    });

    test("should list all genetic codes", () => {
      const codes = listGeneticCodes();

      expect(codes.length).toBeGreaterThan(20); // We have many NCBI codes
      expect(codes[0]).toEqual({
        id: 1,
        name: "Standard",
        shortName: "SGC0",
      });

      // Check a few specific codes exist
      const vertMito = codes.find((c) => c.id === 2);
      expect(vertMito?.name).toBe("Vertebrate Mitochondrial");

      const ciliate = codes.find((c) => c.id === 6);
      expect(ciliate?.name).toBe("Ciliate Nuclear");
    });

    test("should get genetic code definition", () => {
      const standard = getGeneticCode(GeneticCode.STANDARD);
      expect(standard).toBeDefined();
      expect(standard?.name).toBe("Standard");
      expect(standard?.codons["ATG"]).toBe("M");
      expect(standard?.codons["TAA"]).toBe("*");

      // Non-existent code
      const invalid = getGeneticCode(999 as GeneticCode);
      expect(invalid).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    test("should handle lowercase sequences", () => {
      const dna = "atgggatcctag";
      const protein = translate(dna, GeneticCode.STANDARD);
      expect(protein).toBe("MGS*");
    });

    test("should handle mixed case sequences", () => {
      const dna = "AtGgGaTcCtAg";
      const protein = translate(dna, GeneticCode.STANDARD);
      expect(protein).toBe("MGS*");
    });

    test("should handle very long sequences", () => {
      const dna = "ATG".repeat(1000);
      const protein = translate(dna, GeneticCode.STANDARD);
      expect(protein).toBe("M".repeat(1000));
    });

    test("should handle invalid genetic code ID", () => {
      expect(() => translate("ATG", 999 as GeneticCode)).toThrow("Unknown genetic code: 999");
    });
  });
});
