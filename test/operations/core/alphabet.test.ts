import { describe, expect, test } from "bun:test";
import {
  dna,
  isDNASequence,
  isIUPACSequence,
  isPrimerSequence,
  isRNASequence,
  iupac,
  primer,
  rna,
} from "../../../src/operations/core/alphabet";

// Helper to create TemplateStringsArray for testing runtime validation
function makeTemplateArray(str: string): TemplateStringsArray {
  const arr = [str] as string[] & { raw: readonly string[] };
  arr.raw = [str];
  return arr as TemplateStringsArray;
}

describe("Template Literal Tag Functions", () => {
  describe("dna template tag", () => {
    test("creates valid DNA sequences with standard nucleotides", () => {
      const seq = dna`ATCGATCG` as string;

      expect(seq).toBe("ATCGATCG");
      expect(typeof seq).toBe("string");
      expect(seq.length).toBe(8);
    });

    test("handles mixed case correctly", () => {
      const seq = dna`ATCGatcg` as string;

      expect(seq).toBe("ATCGatcg");
      expect(seq.length).toBe(8);
    });

    test("works with empty string", () => {
      const seq = dna`` as string;

      expect(seq).toBe("");
      expect(seq.length).toBe(0);
    });

    test("throws runtime error for invalid characters", () => {
      expect(() => {
        // Test runtime validation by calling function directly
        dna(makeTemplateArray("ATCGXYZ"));
      }).toThrow("Invalid DNA sequence: contains non-standard bases");
    });

    test("throws runtime error for RNA nucleotides in DNA tag", () => {
      expect(() => {
        // Test runtime validation by calling function directly
        dna(makeTemplateArray("ATCGU"));
      }).toThrow("Invalid DNA sequence: contains non-standard bases");
    });

    test("provides string compatibility", () => {
      const seq = dna`ATCGATCG` as string;

      // Should work with all string methods
      expect(seq.toUpperCase()).toBe("ATCGATCG");
      expect(seq.slice(0, 4)).toBe("ATCG");
      expect(seq.indexOf("CG")).toBe(2);
    });
  });

  describe("iupac template tag", () => {
    test("creates valid IUPAC sequences with standard nucleotides", () => {
      const seq = iupac`ATCGATCG` as string;

      expect(seq).toBe("ATCGATCG");
      expect(typeof seq).toBe("string");
    });

    test("handles two-base IUPAC codes", () => {
      const seq = iupac`ATCGRYSWKM` as string;

      expect(seq).toBe("ATCGRYSWKM");
      expect(seq.length).toBe(10);
    });

    test("handles three-base IUPAC codes", () => {
      const seq = iupac`ATCGBDHV` as string;

      expect(seq).toBe("ATCGBDHV");
      expect(seq.length).toBe(8);
    });

    test("handles four-base IUPAC code (N)", () => {
      const seq = iupac`ATCGN` as string;

      expect(seq).toBe("ATCGN");
      expect(seq.length).toBe(5);
    });

    test("handles real-world primer with degenerate bases", () => {
      const seq = iupac`GTGCCAGCMGCCGCGGTAA` as string; // Real 515F primer with M=A|C

      expect(seq).toBe("GTGCCAGCMGCCGCGGTAA");
      expect(seq.length).toBe(19);
    });

    test("handles complex degenerate primer", () => {
      const seq = iupac`GGACTACHVGGGTWTCTAAT` as string; // Real 806R primer with H,V,W

      expect(seq).toBe("GGACTACHVGGGTWTCTAAT");
      expect(seq.length).toBe(20);
    });

    test("throws runtime error for invalid characters", () => {
      expect(() => {
        // Test runtime validation by calling function directly
        iupac(makeTemplateArray("ATCGXYZ"));
      }).toThrow("Invalid IUPAC sequence: contains invalid bases");
    });

    test("provides string compatibility with IUPAC codes", () => {
      const seq = iupac`ATCGRYSWKMBDHVN` as string;

      expect(seq.toUpperCase()).toBe("ATCGRYSWKMBDHVN");
      expect(seq.slice(0, 4)).toBe("ATCG");
      expect(seq.includes("R")).toBe(true);
    });
  });

  describe("rna template tag", () => {
    test("creates valid RNA sequences with standard nucleotides", () => {
      const seq = rna`AUCGAUCG` as string;

      expect(seq).toBe("AUCGAUCG");
      expect(typeof seq).toBe("string");
    });

    test("handles IUPAC codes in RNA", () => {
      const seq = rna`AUCGRYSWKM` as string;

      expect(seq).toBe("AUCGRYSWKM");
      expect(seq.length).toBe(10);
    });

    test("throws runtime error for DNA nucleotides (T) in RNA", () => {
      expect(() => {
        // Test runtime validation by calling function directly
        rna(makeTemplateArray("ATCGATCG"));
      }).toThrow("Invalid RNA sequence: contains invalid bases");
    });

    test("throws runtime error for invalid characters", () => {
      expect(() => {
        // Test runtime validation by calling function directly
        rna(makeTemplateArray("AUCGXYZ"));
      }).toThrow("Invalid RNA sequence: contains invalid bases");
    });
  });

  describe("primer template tag", () => {
    test("creates valid primer sequences with correct length", () => {
      const seq = primer`ATCGATCGATCGATCG` as string; // 16bp

      expect(seq).toBe("ATCGATCGATCGATCG");
      expect(seq.length).toBe(16);
    });

    test("handles real COVID-19 primers", () => {
      const covidN = primer`ACCAGGAACTAATCAGACAAG` as string; // N gene forward (21bp)
      const covidNRev = primer`CAAAGACCAATCCTACCATGAG` as string; // N gene reverse (22bp)

      expect(covidN).toBe("ACCAGGAACTAATCAGACAAG");
      expect(covidNRev).toBe("CAAAGACCAATCCTACCATGAG");
      expect(covidN.length).toBe(21);
      expect(covidNRev.length).toBe(22);
    });

    test("handles real 16S rRNA primers with IUPAC codes", () => {
      const primer515F = primer`GTGCCAGCMGCCGCGGTAA` as string; // M=A|C
      const primer806R = primer`GGACTACHVGGGTWTCTAAT` as string; // H=A|C|T, V=A|C|G, W=A|T

      expect(primer515F).toBe("GTGCCAGCMGCCGCGGTAA");
      expect(primer806R).toBe("GGACTACHVGGGTWTCTAAT");
      expect(primer515F.length).toBe(19);
      expect(primer806R.length).toBe(20);
    });

    test("accepts minimum valid length (10bp)", () => {
      const seq = primer`ATCGATCGAT` as string; // Exactly 10bp

      expect(seq).toBe("ATCGATCGAT");
      expect(seq.length).toBe(10);
    });

    test("accepts maximum valid length (50bp)", () => {
      const seq = primer`${"ATCGATCG".repeat(6)}AT` as string; // Exactly 50bp

      expect(seq.length).toBe(50);
    });

    test("throws runtime error for too short primers", () => {
      expect(() => {
        // Test runtime validation by calling function directly
        primer(makeTemplateArray("ATCGATCG"));
      }).toThrow("Primer too short: 8bp < 10bp minimum");
    });

    test("throws runtime error for too long primers", () => {
      expect(() => {
        // Test runtime validation by calling function directly
        primer(makeTemplateArray("A".repeat(60)));
      }).toThrow("Primer too long: 60bp > 50bp maximum");
    });

    test("throws runtime error for invalid characters", () => {
      expect(() => {
        // Test runtime validation by calling function directly
        primer(makeTemplateArray("ATCGATCGATCGATCGXYZ"));
      }).toThrow("Invalid primer sequence: contains invalid bases");
    });

    test("provides string compatibility for primer operations", () => {
      const covidPrimer = primer`ACCAGGAACTAATCAGACAAG` as string;

      // Should work with string methods
      expect(covidPrimer.toUpperCase()).toBe("ACCAGGAACTAATCAGACAAG");
      expect(covidPrimer.slice(0, 6)).toBe("ACCAGG");
      expect(covidPrimer.indexOf("CAAG")).toBe(17);
    });
  });

  describe("string widening and algorithm compatibility", () => {
    test("tagged sequences work with string functions", () => {
      const dnaSeq = dna`ATCGATCG` as string;
      const iupacSeq = iupac`ATCGRYSWKM` as string;
      const rnaSeq = rna`AUCGAUCG` as string;
      const primerSeq = primer`ATCGATCGATCGATCG` as string;

      // Test common string operations
      function processAsString(s: string): number {
        return s.length;
      }

      expect(processAsString(dnaSeq)).toBe(8);
      expect(processAsString(iupacSeq)).toBe(10);
      expect(processAsString(rnaSeq)).toBe(8);
      expect(processAsString(primerSeq)).toBe(16);
    });

    test("tagged sequences work with our pattern matching functions", () => {
      const sequence = dna`ATCGATCGATCGATCG` as string;
      const pattern = dna`ATCG` as string;

      // Should work with our existing pattern matching
      function mockPatternSearch(seq: string, pat: string): boolean {
        return seq.includes(pat);
      }

      expect(mockPatternSearch(sequence, pattern)).toBe(true);
    });

    test("branded types preserve type information", () => {
      const dnaSeq = dna`ATCGATCG` as string;
      const primerSeq = primer`ATCGATCGATCGATCG` as string;

      // Type information should be preserved conceptually, but brands are compile-time only
      expect(typeof dnaSeq).toBe("string"); // Widens to string at runtime
      expect(typeof primerSeq).toBe("string");
    });
  });

  describe("biological validation integration", () => {
    test("validates complete IUPAC alphabet", () => {
      // Test all IUPAC codes can be used
      const allIUPAC = iupac`ACGTRYSWKMBDHVN` as string;

      expect(allIUPAC).toBe("ACGTRYSWKMBDHVN");
      expect(allIUPAC.length).toBe(15);
    });

    test("validates three-base IUPAC codes specifically", () => {
      const threeBases = iupac`BDHV` as string; // B=C|G|T, D=A|G|T, H=A|C|T, V=A|C|G

      expect(threeBases).toBe("BDHV");
      expect(threeBases.length).toBe(4);
    });

    test("validates primers with biological length constraints", () => {
      // Test boundary conditions
      const minLength = primer`ATCGATCGATCGATC` as string; // 15bp
      const maxLength = primer`${"ATCGATCG".repeat(6)}AT` as string; // 50bp

      expect(minLength.length).toBe(15);
      expect(maxLength.length).toBe(50);
    });
  });
});

describe("Type Guard Functions", () => {
  describe("isDNASequence", () => {
    test("validates standard DNA sequences", () => {
      expect(isDNASequence("ATCGATCG")).toBe(true);
      expect(isDNASequence("ATCGatcg")).toBe(true);
      expect(isDNASequence("")).toBe(true); // Empty string valid
    });

    test("rejects non-DNA characters", () => {
      expect(isDNASequence("ATCGXYZ")).toBe(false);
      expect(isDNASequence("ATCGU")).toBe(false); // U not in standard DNA
      expect(isDNASequence("ATCGR")).toBe(false); // IUPAC codes not in standard DNA
    });
  });

  describe("isIUPACSequence", () => {
    test("validates IUPAC DNA sequences", () => {
      expect(isIUPACSequence("ATCGATCG")).toBe(true);
      expect(isIUPACSequence("ATCGRYSWKM")).toBe(true);
      expect(isIUPACSequence("ATCGBDHVN")).toBe(true);
    });

    test("rejects invalid characters", () => {
      expect(isIUPACSequence("ATCGXYZ")).toBe(false);
    });
  });

  describe("isRNASequence", () => {
    test("validates RNA sequences", () => {
      expect(isRNASequence("AUCGAUCG")).toBe(true);
      expect(isRNASequence("AUCGRYSWKM")).toBe(true);
    });

    test("rejects DNA nucleotides (T) in RNA", () => {
      expect(isRNASequence("ATCGATCG")).toBe(false); // T not valid in RNA
    });
  });

  describe("isPrimerSequence", () => {
    test("validates primer sequences with correct length and alphabet", () => {
      expect(isPrimerSequence("ATCGATCGAT")).toBe(true); // 10bp
      expect(isPrimerSequence("ACCAGGAACTAATCAGACAAG")).toBe(true); // 21bp COVID primer
      expect(isPrimerSequence("GTGCCAGCMGCCGCGGTAA")).toBe(true); // 19bp with IUPAC
    });

    test("rejects primers that are too short", () => {
      expect(isPrimerSequence("ATCGATCG")).toBe(false); // 8bp < 10bp
    });

    test("rejects primers that are too long", () => {
      expect(isPrimerSequence("A".repeat(60))).toBe(false); // 60bp > 50bp
    });

    test("rejects primers with invalid characters", () => {
      expect(isPrimerSequence("ATCGATCGATCGATCGXYZ")).toBe(false); // Valid length but invalid chars
    });
  });
});

describe("Real-World Biological Sequences", () => {
  describe("COVID-19 diagnostic primers", () => {
    test("validates N gene primers", () => {
      const nGeneForward = primer`ACCAGGAACTAATCAGACAAG` as string;
      const nGeneReverse = primer`CAAAGACCAATCCTACCATGAG` as string;

      expect(nGeneForward.length).toBe(21);
      expect(nGeneReverse.length).toBe(22);
      expect(typeof nGeneForward).toBe("string");
      expect(typeof nGeneReverse).toBe("string");
    });

    test("validates E gene primers", () => {
      const eGeneForward = primer`ACAGGTACGTTAATAGTTAATAGCGT` as string;
      const eGeneReverse = primer`ATATTGCAGCAGTACGCACACA` as string;

      expect(eGeneForward.length).toBe(26);
      expect(eGeneReverse.length).toBe(22);
    });
  });

  describe("16S rRNA universal primers", () => {
    test("validates V4 region primers with IUPAC codes", () => {
      const primer515F = primer`GTGCCAGCMGCCGCGGTAA` as string; // M = A or C
      const primer806R = primer`GGACTACHVGGGTWTCTAAT` as string; // H=A|C|T, V=A|C|G, W=A|T

      expect(primer515F.length).toBe(19);
      expect(primer806R.length).toBe(20);

      // Verify they contain the expected IUPAC codes
      expect(primer515F.includes("M")).toBe(true);
      expect(primer806R.includes("H")).toBe(true);
      expect(primer806R.includes("V")).toBe(true);
      expect(primer806R.includes("W")).toBe(true);
    });

    test("validates full-length 16S primers", () => {
      const primer27F = primer`AGAGTTTGATCMTGGCTCAG` as string; // 27F universal (M=A|C)
      const primer1492R = primer`TACGGYTACCTTGTTACGACTT` as string; // 1492R universal (Y=C|T)

      expect(primer27F.length).toBe(20);
      expect(primer1492R.length).toBe(22);
    });
  });

  describe("DNA and RNA sequence validation", () => {
    test("validates genomic DNA sequences", () => {
      const genomicSeq = dna`ATCGATCGATCGATCGATCGATCGATCGATCG` as string;

      expect(genomicSeq.length).toBe(32);
      expect(genomicSeq.includes("U")).toBe(false); // No RNA bases
    });

    test("validates mRNA sequences", () => {
      const mrnaSeq = rna`AUGCAUGCAUGCAUGC` as string; // Start codon (AUG) repeated

      expect(mrnaSeq.length).toBe(16);
      expect(mrnaSeq.includes("U")).toBe(true); // Contains RNA bases
      expect(mrnaSeq.includes("T")).toBe(false); // No DNA bases
    });

    test("validates complex IUPAC sequences", () => {
      // Test all IUPAC codes including 3-base codes
      const complexSeq = iupac`ACGTRYSWKMBDHVN` as string;

      expect(complexSeq.length).toBe(15);

      // Verify all code types are present
      expect(complexSeq.includes("R")).toBe(true); // 2-base: A|G
      expect(complexSeq.includes("B")).toBe(true); // 3-base: C|G|T
      expect(complexSeq.includes("N")).toBe(true); // 4-base: A|C|G|T
    });
  });
});

describe("Integration with Existing Infrastructure", () => {
  test("works with existing IUPAC validation functions", () => {
    const iupacSeq = iupac`ATCGRYSWKMBDHVN` as string;

    // Should work with existing validation infrastructure
    expect(isIUPACSequence(iupacSeq)).toBe(true);
  });

  test("primers work with length validation", () => {
    const validPrimer = primer`ATCGATCGATCGATCG` as string;

    expect(isPrimerSequence(validPrimer)).toBe(true);
  });

  test("can be used in algorithm functions expecting strings", () => {
    const seq1 = dna`ATCGATCG` as string;
    const seq2 = iupac`ATCGRYSWKM` as string;
    const primerSeq = primer`ATCGATCGATCGATCG` as string;

    // Mock algorithm function expecting string
    function reverseString(s: string): string {
      return s.split("").reverse().join("");
    }

    expect(reverseString(seq1)).toBe("GCTAGCTA");
    expect(reverseString(seq2)).toBe("MKWSYRGCTA");
    expect(reverseString(primerSeq)).toBe("GCTAGCTAGCTAGCTA");
  });
});

describe("Error Handling and Edge Cases", () => {
  test("provides clear error messages for biological violations", () => {
    expect(() => {
      // Test runtime validation by calling function directly
      primer(makeTemplateArray("ATCG"));
    }).toThrow("10bp minimum for biological specificity");

    expect(() => {
      // Test runtime validation by calling function directly
      primer(makeTemplateArray("A".repeat(60)));
    }).toThrow("50bp maximum for efficient PCR amplification");
  });

  test("handles empty sequences appropriately", () => {
    const emptyDNA = dna`` as string;
    const emptyIUPAC = iupac`` as string;
    const emptyRNA = rna`` as string;

    expect(emptyDNA).toBe("");
    expect(emptyIUPAC).toBe("");
    expect(emptyRNA).toBe("");
  });

  test("maintains type safety through string operations", () => {
    const seq = dna`ATCGATCG` as string;
    const upper = seq.toUpperCase();
    const slice = seq.slice(0, 4);

    // Results should still be valid strings
    expect(typeof upper).toBe("string");
    expect(typeof slice).toBe("string");
    expect(upper).toBe("ATCGATCG");
    expect(slice).toBe("ATCG");
  });
});
