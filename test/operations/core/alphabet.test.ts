import { describe, expect, test } from "bun:test";
import {
  asString,
  dna,
  isDNASequence,
  isIUPACSequence,
  isPrimerSequence,
  isRNASequence,
  iupac,
  primer,
  rna,
  validateAndBrand,
} from "../../../src/operations/core/alphabet";
import { AlphabetValidationError } from "../../../src/errors";

/** Creates a synthetic TemplateStringsArray for testing runtime error paths */
function makeTemplateArray(str: string): TemplateStringsArray {
  const arr = [str] as string[] & { raw: readonly string[] };
  arr.raw = [str];
  return arr as TemplateStringsArray;
}

describe("Tagged Template Functions (runtime validation)", () => {
  describe("dna tag", () => {
    test("creates valid DNA sequences with standard nucleotides", () => {
      const seq = dna`ATCGATCG`;
      expect(seq as string).toBe("ATCGATCG");
      expect(typeof seq).toBe("string");
      expect(seq.length).toBe(8);
    });

    test("handles mixed case correctly", () => {
      const seq = dna`ATCGatcg`;
      expect(seq as string).toBe("ATCGatcg");
      expect(seq.length).toBe(8);
    });

    test("works with empty string", () => {
      const seq = dna``;
      expect(seq as string).toBe("");
      expect(seq.length).toBe(0);
    });

    test("supports interpolation for composing sequences", () => {
      const adapter = "AATTCC";
      const composed = dna`${adapter}ATCG${adapter}`;
      expect(composed as string).toBe("AATTCCATCGAATTCC");
    });

    test("throws AlphabetValidationError for invalid characters", () => {
      expect(() => {
        dna(makeTemplateArray("ATCGXYZ"));
      }).toThrow(AlphabetValidationError);
    });

    test("throws AlphabetValidationError for RNA nucleotides in DNA tag", () => {
      expect(() => {
        dna(makeTemplateArray("ATCGU"));
      }).toThrow(AlphabetValidationError);
    });

    test("provides string compatibility", () => {
      const seq = dna`ATCGATCG`;
      expect(seq.toUpperCase()).toBe("ATCGATCG");
      expect(seq.slice(0, 4)).toBe("ATCG");
      expect(seq.indexOf("CG")).toBe(2);
    });
  });

  describe("iupac tag", () => {
    test("creates valid IUPAC sequences with standard nucleotides", () => {
      const seq = iupac`ATCGATCG`;
      expect(seq as string).toBe("ATCGATCG");
      expect(typeof seq).toBe("string");
    });

    test("handles two-base IUPAC codes", () => {
      const seq = iupac`ATCGRYSWKM`;
      expect(seq as string).toBe("ATCGRYSWKM");
      expect(seq.length).toBe(10);
    });

    test("handles three-base IUPAC codes", () => {
      const seq = iupac`ATCGBDHV`;
      expect(seq as string).toBe("ATCGBDHV");
      expect(seq.length).toBe(8);
    });

    test("handles four-base IUPAC code (N)", () => {
      const seq = iupac`ATCGN`;
      expect(seq as string).toBe("ATCGN");
      expect(seq.length).toBe(5);
    });

    test("handles real-world primer with degenerate bases", () => {
      const seq = iupac`GTGCCAGCMGCCGCGGTAA`; // Real 515F primer with M=A|C
      expect(seq as string).toBe("GTGCCAGCMGCCGCGGTAA");
      expect(seq.length).toBe(19);
    });

    test("handles complex degenerate primer", () => {
      const seq = iupac`GGACTACHVGGGTWTCTAAT`; // Real 806R primer with H,V,W
      expect(seq as string).toBe("GGACTACHVGGGTWTCTAAT");
      expect(seq.length).toBe(20);
    });

    test("throws AlphabetValidationError for invalid characters", () => {
      expect(() => {
        iupac(makeTemplateArray("ATCGXYZ"));
      }).toThrow(AlphabetValidationError);
    });

    test("provides string compatibility with IUPAC codes", () => {
      const seq = iupac`ATCGRYSWKMBDHVN`;
      expect(seq.toUpperCase()).toBe("ATCGRYSWKMBDHVN");
      expect(seq.slice(0, 4)).toBe("ATCG");
      expect(seq.includes("R")).toBe(true);
    });
  });

  describe("rna tag", () => {
    test("creates valid RNA sequences with standard nucleotides", () => {
      const seq = rna`AUCGAUCG`;
      expect(seq as string).toBe("AUCGAUCG");
      expect(typeof seq).toBe("string");
    });

    test("handles IUPAC codes in RNA", () => {
      const seq = rna`AUCGRYSWKM`;
      expect(seq as string).toBe("AUCGRYSWKM");
      expect(seq.length).toBe(10);
    });

    test("throws AlphabetValidationError for DNA nucleotides (T) in RNA", () => {
      expect(() => {
        rna(makeTemplateArray("ATCGATCG"));
      }).toThrow(AlphabetValidationError);
    });

    test("throws AlphabetValidationError for invalid characters", () => {
      expect(() => {
        rna(makeTemplateArray("AUCGXYZ"));
      }).toThrow(AlphabetValidationError);
    });
  });

  describe("primer tag", () => {
    test("creates valid primer sequences with correct length", () => {
      const seq = primer`ATCGATCGATCGATCG`; // 16bp
      expect(seq as string).toBe("ATCGATCGATCGATCG");
      expect(seq.length).toBe(16);
    });

    test("handles real COVID-19 primers", () => {
      const covidN = primer`ACCAGGAACTAATCAGACAAG`; // N gene forward (21bp)
      const covidNRev = primer`CAAAGACCAATCCTACCATGAG`; // N gene reverse (22bp)
      expect(covidN as string).toBe("ACCAGGAACTAATCAGACAAG");
      expect(covidNRev as string).toBe("CAAAGACCAATCCTACCATGAG");
      expect(covidN.length).toBe(21);
      expect(covidNRev.length).toBe(22);
    });

    test("handles real 16S rRNA primers with IUPAC codes", () => {
      const primer515F = primer`GTGCCAGCMGCCGCGGTAA`; // M=A|C
      const primer806R = primer`GGACTACHVGGGTWTCTAAT`; // H=A|C|T, V=A|C|G, W=A|T
      expect(primer515F as string).toBe("GTGCCAGCMGCCGCGGTAA");
      expect(primer806R as string).toBe("GGACTACHVGGGTWTCTAAT");
      expect(primer515F.length).toBe(19);
      expect(primer806R.length).toBe(20);
    });

    test("accepts minimum valid length (10bp)", () => {
      const seq = primer`ATCGATCGAT`; // Exactly 10bp
      expect(seq as string).toBe("ATCGATCGAT");
      expect(seq.length).toBe(10);
    });

    test("accepts maximum valid length (50bp)", () => {
      const seq = primer`${"ATCGATCG".repeat(6)}AT`; // Exactly 50bp
      expect(seq.length).toBe(50);
    });

    test("throws AlphabetValidationError for too short primers", () => {
      expect(() => {
        primer(makeTemplateArray("ATCGATCG"));
      }).toThrow(AlphabetValidationError);
    });

    test("throws AlphabetValidationError for too long primers", () => {
      expect(() => {
        primer(makeTemplateArray("A".repeat(60)));
      }).toThrow(AlphabetValidationError);
    });

    test("throws AlphabetValidationError for invalid characters", () => {
      expect(() => {
        primer(makeTemplateArray("ATCGATCGATCGATCGXYZ"));
      }).toThrow(AlphabetValidationError);
    });

    test("provides string compatibility for primer operations", () => {
      const covidPrimer = primer`ACCAGGAACTAATCAGACAAG`;
      expect(covidPrimer.toUpperCase()).toBe("ACCAGGAACTAATCAGACAAG");
      expect(covidPrimer.slice(0, 6)).toBe("ACCAGG");
      expect(covidPrimer.indexOf("CAAG")).toBe(17);
    });
  });
});

describe("Checked Constructors (compile-time + runtime validation)", () => {
  describe("dna.checked", () => {
    test("validates standard DNA at compile time and runtime", () => {
      const seq = dna.checked("ATCG");
      expect(seq as string).toBe("ATCG");
      expect(typeof seq).toBe("string");
    });

    test("handles mixed case", () => {
      const seq = dna.checked("ATCGatcg");
      expect(seq as string).toBe("ATCGatcg");
    });

    test("handles empty string", () => {
      const seq = dna.checked("");
      expect(seq as string).toBe("");
    });

    test("rejects invalid characters at compile time", () => {
      // @ts-expect-error Invalid DNA character: "X"
      expect(() => dna.checked("ATXG")).toThrow();
      // @ts-expect-error Invalid DNA character: "U"
      expect(() => dna.checked("ATCGU")).toThrow();
    });

    test("preserves literal type and widens to string", () => {
      const seq = dna.checked("ATCG");
      const asStr: string = seq; // widens to string
      expect(asStr).toBe("ATCG");
    });
  });

  describe("iupac.checked", () => {
    test("validates IUPAC DNA at compile time and runtime", () => {
      const seq = iupac.checked("ATCGRYSWKMBDHVN");
      expect(seq as string).toBe("ATCGRYSWKMBDHVN");
    });

    test("accepts standard DNA bases", () => {
      const seq = iupac.checked("ATCG");
      expect(seq as string).toBe("ATCG");
    });

    test("rejects invalid characters at compile time", () => {
      // @ts-expect-error Invalid IUPAC character: "X"
      expect(() => iupac.checked("ATCGXYZ")).toThrow();
    });
  });

  describe("rna.checked", () => {
    test("validates RNA at compile time and runtime", () => {
      const seq = rna.checked("AUCGAUCG");
      expect(seq as string).toBe("AUCGAUCG");
    });

    test("accepts IUPAC codes in RNA", () => {
      const seq = rna.checked("AUCGRYSWKMN");
      expect(seq as string).toBe("AUCGRYSWKMN");
    });

    test("rejects DNA-specific T at compile time", () => {
      // @ts-expect-error Invalid RNA character: "T"
      expect(() => rna.checked("ATCG")).toThrow();
    });

    test("rejects invalid characters at compile time", () => {
      // @ts-expect-error Invalid RNA character: "X"
      expect(() => rna.checked("AUCGXYZ")).toThrow();
    });
  });

  describe("primer.checked", () => {
    test("validates primer at compile time and runtime", () => {
      const seq = primer.checked("ACCAGGAACTAATCAGACAAG"); // 21bp
      expect(seq as string).toBe("ACCAGGAACTAATCAGACAAG");
      expect(seq.length).toBe(21);
    });

    test("validates real 16S primers with IUPAC codes", () => {
      const p515F = primer.checked("GTGCCAGCMGCCGCGGTAA"); // 19bp, M=A|C
      expect(p515F as string).toBe("GTGCCAGCMGCCGCGGTAA");
    });

    test("accepts minimum length (10bp)", () => {
      const seq = primer.checked("ATCGATCGAT"); // exactly 10bp
      expect(seq.length).toBe(10);
    });

    test("rejects too-short primers at compile time", () => {
      // @ts-expect-error Primer length must be 10-50, got 4
      expect(() => primer.checked("ATCG")).toThrow();
    });

    test("rejects too-long primers at compile time", () => {
      expect(() =>
        // @ts-expect-error Primer length must be 10-50, got 56
        primer.checked("ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG")
      ).toThrow();
    });

    test("rejects invalid characters at compile time", () => {
      // @ts-expect-error Invalid primer character: "X"
      expect(() => primer.checked("ACCAGGAACTXATCAGACAAG")).toThrow();
    });
  });
});

describe("Literal/Lit Aliases (same behavior as .checked)", () => {
  describe("dna.literal and dna.lit", () => {
    test(".literal() validates and returns branded DNA", () => {
      const seq = dna.literal("ATCG");
      expect(seq as string).toBe("ATCG");
    });

    test(".lit() validates and returns branded DNA", () => {
      const seq = dna.lit("ATCG");
      expect(seq as string).toBe("ATCG");
    });

    test(".literal() rejects invalid characters at compile time", () => {
      // @ts-expect-error Invalid DNA character: "X"
      expect(() => dna.literal("ATXG")).toThrow();
    });

    test(".lit() rejects invalid characters at compile time", () => {
      // @ts-expect-error Invalid DNA character: "U"
      expect(() => dna.lit("ATCGU")).toThrow();
    });
  });

  describe("iupac.literal and iupac.lit", () => {
    test(".literal() validates IUPAC DNA", () => {
      const seq = iupac.literal("ATCGRYSWKMBDHVN");
      expect(seq as string).toBe("ATCGRYSWKMBDHVN");
    });

    test(".lit() validates IUPAC DNA", () => {
      const seq = iupac.lit("ATCGRYSWKMBDHVN");
      expect(seq as string).toBe("ATCGRYSWKMBDHVN");
    });

    test(".literal() rejects invalid characters at compile time", () => {
      // @ts-expect-error Invalid IUPAC character: "X"
      expect(() => iupac.literal("ATCGXYZ")).toThrow();
    });
  });

  describe("rna.literal and rna.lit", () => {
    test(".literal() validates RNA", () => {
      const seq = rna.literal("AUCGAUCG");
      expect(seq as string).toBe("AUCGAUCG");
    });

    test(".lit() validates RNA", () => {
      const seq = rna.lit("AUCGAUCG");
      expect(seq as string).toBe("AUCGAUCG");
    });

    test(".literal() rejects DNA T at compile time", () => {
      // @ts-expect-error Invalid RNA character: "T"
      expect(() => rna.literal("ATCG")).toThrow();
    });
  });

  describe("primer.literal and primer.lit", () => {
    test(".literal() validates primer with length check", () => {
      const seq = primer.literal("ACCAGGAACTAATCAGACAAG");
      expect(seq as string).toBe("ACCAGGAACTAATCAGACAAG");
      expect(seq.length).toBe(21);
    });

    test(".lit() validates primer with length check", () => {
      const seq = primer.lit("ACCAGGAACTAATCAGACAAG");
      expect(seq as string).toBe("ACCAGGAACTAATCAGACAAG");
    });

    test(".literal() rejects too-short primers at compile time", () => {
      // @ts-expect-error Primer length must be 10-50, got 4
      expect(() => primer.literal("ATCG")).toThrow();
    });

    test(".lit() rejects invalid characters at compile time", () => {
      // @ts-expect-error Invalid primer character: "X"
      expect(() => primer.lit("ACCAGGAACTXATCAGACAAG")).toThrow();
    });
  });

  test("all three aliases reference the same function", () => {
    expect(dna.literal).toBe(dna.lit);
    expect(dna.literal).toBe(dna.checked);
    expect(iupac.literal).toBe(iupac.lit);
    expect(iupac.literal).toBe(iupac.checked);
    expect(rna.literal).toBe(rna.lit);
    expect(rna.literal).toBe(rna.checked);
    expect(primer.literal).toBe(primer.lit);
    expect(primer.literal).toBe(primer.checked);
  });
});

describe("Type Guard Functions", () => {
  describe("isDNASequence", () => {
    test("validates standard DNA sequences", () => {
      expect(isDNASequence("ATCGATCG")).toBe(true);
      expect(isDNASequence("ATCGatcg")).toBe(true);
      expect(isDNASequence("")).toBe(true);
    });

    test("rejects non-DNA characters", () => {
      expect(isDNASequence("ATCGXYZ")).toBe(false);
      expect(isDNASequence("ATCGU")).toBe(false);
      expect(isDNASequence("ATCGR")).toBe(false);
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
      expect(isRNASequence("ATCGATCG")).toBe(false);
    });
  });

  describe("isPrimerSequence", () => {
    test("validates primer sequences with correct length and alphabet", () => {
      expect(isPrimerSequence("ATCGATCGAT")).toBe(true);
      expect(isPrimerSequence("ACCAGGAACTAATCAGACAAG")).toBe(true);
      expect(isPrimerSequence("GTGCCAGCMGCCGCGGTAA")).toBe(true);
    });

    test("rejects primers that are too short", () => {
      expect(isPrimerSequence("ATCGATCG")).toBe(false);
    });

    test("rejects primers that are too long", () => {
      expect(isPrimerSequence("A".repeat(60))).toBe(false);
    });

    test("rejects primers with invalid characters", () => {
      expect(isPrimerSequence("ATCGATCGATCGATCGXYZ")).toBe(false);
    });
  });
});

describe("Real-World Biological Sequences", () => {
  describe("COVID-19 diagnostic primers", () => {
    test("validates N gene primers", () => {
      const nGeneForward = primer`ACCAGGAACTAATCAGACAAG`;
      const nGeneReverse = primer`CAAAGACCAATCCTACCATGAG`;
      expect(nGeneForward.length).toBe(21);
      expect(nGeneReverse.length).toBe(22);
      expect(typeof nGeneForward).toBe("string");
      expect(typeof nGeneReverse).toBe("string");
    });

    test("validates E gene primers", () => {
      const eGeneForward = primer`ACAGGTACGTTAATAGTTAATAGCGT`;
      const eGeneReverse = primer`ATATTGCAGCAGTACGCACACA`;
      expect(eGeneForward.length).toBe(26);
      expect(eGeneReverse.length).toBe(22);
    });
  });

  describe("16S rRNA universal primers", () => {
    test("validates V4 region primers with IUPAC codes", () => {
      const primer515F = primer`GTGCCAGCMGCCGCGGTAA`; // M = A or C
      const primer806R = primer`GGACTACHVGGGTWTCTAAT`; // H=A|C|T, V=A|C|G, W=A|T
      expect(primer515F.length).toBe(19);
      expect(primer806R.length).toBe(20);
      expect(primer515F.includes("M")).toBe(true);
      expect(primer806R.includes("H")).toBe(true);
      expect(primer806R.includes("V")).toBe(true);
      expect(primer806R.includes("W")).toBe(true);
    });

    test("validates full-length 16S primers", () => {
      const primer27F = primer`AGAGTTTGATCMTGGCTCAG`; // 27F universal (M=A|C)
      const primer1492R = primer`TACGGYTACCTTGTTACGACTT`; // 1492R universal (Y=C|T)
      expect(primer27F.length).toBe(20);
      expect(primer1492R.length).toBe(22);
    });
  });

  describe("DNA and RNA sequence validation", () => {
    test("validates genomic DNA sequences", () => {
      const genomicSeq = dna`ATCGATCGATCGATCGATCGATCGATCGATCG`;
      expect(genomicSeq.length).toBe(32);
      expect(genomicSeq.includes("U")).toBe(false);
    });

    test("validates mRNA sequences", () => {
      const mrnaSeq = rna`AUGCAUGCAUGCAUGC`; // Start codon (AUG) repeated
      expect(mrnaSeq.length).toBe(16);
      expect(mrnaSeq.includes("U")).toBe(true);
      expect(mrnaSeq.includes("T")).toBe(false);
    });

    test("validates complex IUPAC sequences", () => {
      const complexSeq = iupac`ACGTRYSWKMBDHVN`;
      expect(complexSeq.length).toBe(15);
      expect(complexSeq.includes("R")).toBe(true);
      expect(complexSeq.includes("B")).toBe(true);
      expect(complexSeq.includes("N")).toBe(true);
    });
  });
});

describe("Integration with Existing Infrastructure", () => {
  test("tagged sequences pass type guard functions", () => {
    const iupacSeq = iupac`ATCGRYSWKMBDHVN`;
    expect(isIUPACSequence(iupacSeq)).toBe(true);
  });

  test("checked sequences pass type guard functions", () => {
    const seq = dna.checked("ATCGATCG");
    expect(isDNASequence(seq)).toBe(true);
  });

  test("primers work with length validation", () => {
    const validPrimer = primer`ATCGATCGATCGATCG`;
    expect(isPrimerSequence(validPrimer)).toBe(true);
  });

  test("can be used in algorithm functions expecting strings", () => {
    const seq1 = dna`ATCGATCG`;
    const seq2 = iupac`ATCGRYSWKM`;
    const primerSeq = primer`ATCGATCGATCGATCG`;

    function reverseString(s: string): string {
      return s.split("").reverse().join("");
    }

    expect(reverseString(seq1)).toBe("GCTAGCTA");
    expect(reverseString(seq2)).toBe("MKWSYRGCTA");
    expect(reverseString(primerSeq)).toBe("GCTAGCTAGCTAGCTA");
  });
});

describe("Utility Functions", () => {
  describe("asString", () => {
    test("converts branded DNA sequence back to plain string", () => {
      const seq = dna`ATCGATCG`;
      const plain = asString(seq);
      expect(plain).toBe("ATCGATCG");
    });

    test("converts branded IUPAC sequence back to plain string", () => {
      const seq = iupac`ATCGRYSWKM`;
      expect(asString(seq)).toBe("ATCGRYSWKM");
    });

    test("converts branded RNA sequence back to plain string", () => {
      const seq = rna`AUCGAUCG`;
      expect(asString(seq)).toBe("AUCGAUCG");
    });

    test("converts branded primer sequence back to plain string", () => {
      const seq = primer`ACCAGGAACTAATCAGACAAG`;
      expect(asString(seq)).toBe("ACCAGGAACTAATCAGACAAG");
    });
  });

  describe("validateAndBrand", () => {
    test("returns branded DNA for valid DNA input", () => {
      const result = validateAndBrand("ATCGATCG", "dna");
      expect(result).not.toBeNull();
      expect(result as string).toBe("ATCGATCG");
    });

    test("returns null for invalid DNA input", () => {
      expect(validateAndBrand("ATCGXYZ", "dna")).toBeNull();
    });

    test("returns branded IUPAC for valid IUPAC input", () => {
      const result = validateAndBrand("ATCGRYSWKM", "iupac");
      expect(result).not.toBeNull();
      expect(result as string).toBe("ATCGRYSWKM");
    });

    test("returns null for invalid IUPAC input", () => {
      expect(validateAndBrand("ATCGXYZ", "iupac")).toBeNull();
    });

    test("returns branded RNA for valid RNA input", () => {
      const result = validateAndBrand("AUCGAUCG", "rna");
      expect(result).not.toBeNull();
      expect(result as string).toBe("AUCGAUCG");
    });

    test("returns null for invalid RNA input (T is not valid)", () => {
      expect(validateAndBrand("ATCGATCG", "rna")).toBeNull();
    });

    test("returns branded primer for valid primer input", () => {
      const result = validateAndBrand("ACCAGGAACTAATCAGACAAG", "primer");
      expect(result).not.toBeNull();
      expect(result as string).toBe("ACCAGGAACTAATCAGACAAG");
    });

    test("returns null for too-short primer", () => {
      expect(validateAndBrand("ATCG", "primer")).toBeNull();
    });

    test("returns null for too-long primer", () => {
      expect(validateAndBrand("A".repeat(60), "primer")).toBeNull();
    });

    test("returns null for primer with invalid characters", () => {
      expect(validateAndBrand("ATCGATCGATCGATCGXYZ", "primer")).toBeNull();
    });

    test("result passes corresponding type guard", () => {
      const dnaResult = validateAndBrand("ATCG", "dna");
      if (dnaResult !== null) {
        expect(isDNASequence(dnaResult)).toBe(true);
      }

      const rnaResult = validateAndBrand("AUCG", "rna");
      if (rnaResult !== null) {
        expect(isRNASequence(rnaResult)).toBe(true);
      }
    });
  });
});

describe("Runtime-string paths through .literal()", () => {
  test("dna.literal rejects invalid runtime strings", () => {
    const input = "ATCGXYZ" as string;
    expect(() => {
      (dna.literal as (s: string) => unknown)(input);
    }).toThrow(AlphabetValidationError);
  });

  test("iupac.literal rejects invalid runtime strings", () => {
    const input = "ATCG123" as string;
    expect(() => {
      (iupac.literal as (s: string) => unknown)(input);
    }).toThrow(AlphabetValidationError);
  });

  test("rna.literal rejects DNA T at runtime", () => {
    const input = "ATCGATCG" as string;
    expect(() => {
      (rna.literal as (s: string) => unknown)(input);
    }).toThrow(AlphabetValidationError);
  });

  test("primer.literal rejects too-short strings at runtime", () => {
    const input = "ATCG" as string;
    expect(() => {
      (primer.literal as (s: string) => unknown)(input);
    }).toThrow(AlphabetValidationError);
  });

  test("dna.literal accepts valid runtime strings", () => {
    const input = "ATCGATCG" as string;
    const result = (dna.literal as (s: string) => unknown)(input);
    expect(result as string).toBe("ATCGATCG");
  });
});

describe("AlphabetValidationError structured fields", () => {
  test("dna errors carry alphabet and input fields", () => {
    try {
      dna(makeTemplateArray("ATCGXYZ"));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AlphabetValidationError);
      const err = e as AlphabetValidationError;
      expect(err.alphabet).toBe("dna");
      expect(err.input).toBe("ATCGXYZ");
      expect(err.context).toBe("Valid characters: A, C, G, T");
      expect(err.message).toContain("non-standard bases");
    }
  });

  test("iupac errors carry alphabet and input fields", () => {
    try {
      iupac(makeTemplateArray("ATCGXYZ"));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AlphabetValidationError);
      const err = e as AlphabetValidationError;
      expect(err.alphabet).toBe("iupac");
      expect(err.input).toBe("ATCGXYZ");
      expect(err.context).toContain("Valid characters:");
    }
  });

  test("rna errors carry alphabet and input fields", () => {
    try {
      rna(makeTemplateArray("ATCGATCG"));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AlphabetValidationError);
      const err = e as AlphabetValidationError;
      expect(err.alphabet).toBe("rna");
      expect(err.input).toBe("ATCGATCG");
      expect(err.context).toContain("Valid characters:");
    }
  });

  test("primer character errors carry alphabet and input fields", () => {
    try {
      primer(makeTemplateArray("ATCGATCGATCGATCGXYZ"));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AlphabetValidationError);
      const err = e as AlphabetValidationError;
      expect(err.alphabet).toBe("primer");
      expect(err.input).toBe("ATCGATCGATCGATCGXYZ");
      expect(err.context).toContain("Valid characters:");
    }
  });

  test("primer length errors carry context about length constraints", () => {
    try {
      primer(makeTemplateArray("ATCG"));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AlphabetValidationError);
      const err = e as AlphabetValidationError;
      expect(err.alphabet).toBe("primer");
      expect(err.input).toBe("ATCG");
      expect(err.message).toContain("too short");
      expect(err.context).toContain("10-50bp");
    }
  });

  test("primer too-long errors carry context about length constraints", () => {
    const longSeq = "A".repeat(60);
    try {
      primer(makeTemplateArray(longSeq));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AlphabetValidationError);
      const err = e as AlphabetValidationError;
      expect(err.alphabet).toBe("primer");
      expect(err.input).toBe(longSeq);
      expect(err.message).toContain("too long");
      expect(err.context).toContain("10-50bp");
    }
  });

  test("errors are instanceof ValidationError and GenotypeError", () => {
    try {
      dna(makeTemplateArray("XYZ"));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AlphabetValidationError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  test(".literal() throws AlphabetValidationError for runtime-invalid strings", () => {
    const badInput = "ATCGXYZ" as string;
    try {
      (dna.literal as (s: string) => unknown)(badInput);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AlphabetValidationError);
      const err = e as AlphabetValidationError;
      expect(err.alphabet).toBe("dna");
      expect(err.input).toBe("ATCGXYZ");
    }
  });
});

describe("Error Handling and Edge Cases", () => {
  test("provides clear error messages for biological violations", () => {
    expect(() => {
      primer(makeTemplateArray("ATCG"));
    }).toThrow(AlphabetValidationError);

    expect(() => {
      primer(makeTemplateArray("A".repeat(60)));
    }).toThrow(AlphabetValidationError);
  });

  test("handles empty sequences appropriately", () => {
    const emptyDNA = dna``;
    const emptyIUPAC = iupac``;
    const emptyRNA = rna``;
    expect(emptyDNA as string).toBe("");
    expect(emptyIUPAC as string).toBe("");
    expect(emptyRNA as string).toBe("");
  });

  test("maintains string behavior through operations", () => {
    const seq = dna`ATCGATCG`;
    const upper = seq.toUpperCase();
    const slice = seq.slice(0, 4);
    expect(typeof upper).toBe("string");
    expect(typeof slice).toBe("string");
    expect(upper).toBe("ATCGATCG");
    expect(slice).toBe("ATCG");
  });
});
