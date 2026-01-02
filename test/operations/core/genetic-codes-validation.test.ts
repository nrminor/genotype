/**
 * Comprehensive biological validation tests for genetic code accuracy
 *
 * Validates against NCBI genetic code standards and biological literature
 * These tests ensure scientific correctness of genetic code implementations
 */

import { describe, expect, test } from "bun:test";
import {
  findORFs,
  GeneticCode,
  getGeneticCode,
  isStartCodon,
  isStopCodon,
  translate,
  translateSixFrames,
} from "../../../src/operations/core/genetic-codes";

describe("NCBI Genetic Code Biological Validation", () => {
  describe("Standard Genetic Code (Table 1) - NCBI Compliance", () => {
    test("all 64 codons map correctly to NCBI standard", () => {
      const standardCode = getGeneticCode(GeneticCode.STANDARD);
      expect(standardCode).toBeDefined();

      // Test complete codon set - NCBI verified mappings
      const expectedMappings = {
        // Phenylalanine (F)
        TTT: "F",
        TTC: "F",
        // Leucine (L)
        TTA: "L",
        TTG: "L",
        CTT: "L",
        CTC: "L",
        CTA: "L",
        CTG: "L",
        // Serine (S)
        TCT: "S",
        TCC: "S",
        TCA: "S",
        TCG: "S",
        AGT: "S",
        AGC: "S",
        // Tyrosine (Y)
        TAT: "Y",
        TAC: "Y",
        // Stop codons (*)
        TAA: "*",
        TAG: "*",
        TGA: "*",
        // Cysteine (C)
        TGT: "C",
        TGC: "C",
        // Tryptophan (W)
        TGG: "W",
        // Proline (P)
        CCT: "P",
        CCC: "P",
        CCA: "P",
        CCG: "P",
        // Histidine (H)
        CAT: "H",
        CAC: "H",
        // Glutamine (Q)
        CAA: "Q",
        CAG: "Q",
        // Arginine (R)
        CGT: "R",
        CGC: "R",
        CGA: "R",
        CGG: "R",
        AGA: "R",
        AGG: "R",
        // Isoleucine (I)
        ATT: "I",
        ATC: "I",
        ATA: "I",
        // Methionine (M) - also start codon
        ATG: "M",
        // Threonine (T)
        ACT: "T",
        ACC: "T",
        ACA: "T",
        ACG: "T",
        // Asparagine (N)
        AAT: "N",
        AAC: "N",
        // Lysine (K)
        AAA: "K",
        AAG: "K",
        // Valine (V)
        GTT: "V",
        GTC: "V",
        GTA: "V",
        GTG: "V",
        // Alanine (A)
        GCT: "A",
        GCC: "A",
        GCA: "A",
        GCG: "A",
        // Aspartic acid (D)
        GAT: "D",
        GAC: "D",
        // Glutamic acid (E)
        GAA: "E",
        GAG: "E",
        // Glycine (G)
        GGT: "G",
        GGC: "G",
        GGA: "G",
        GGG: "G",
      };

      for (const [codon, expectedAA] of Object.entries(expectedMappings)) {
        expect(standardCode!.codons[codon]).toBe(expectedAA);
      }

      // Verify total codon count
      expect(Object.keys(standardCode!.codons)).toHaveLength(64);
    });

    test("standard genetic code start codons are biologically correct", () => {
      const standardCode = getGeneticCode(GeneticCode.STANDARD);

      // NCBI standard: ATG is primary, TTG and CTG are alternative starts
      expect(standardCode!.startCodons).toContain("ATG");
      expect(standardCode!.startCodons).toContain("TTG");
      expect(standardCode!.startCodons).toContain("CTG");

      // Verify these are biologically valid start codons
      expect(isStartCodon("ATG", GeneticCode.STANDARD)).toBe(true);
      expect(isStartCodon("TTG", GeneticCode.STANDARD)).toBe(true);
      expect(isStartCodon("CTG", GeneticCode.STANDARD)).toBe(true);

      // Invalid start codons
      expect(isStartCodon("AAA", GeneticCode.STANDARD)).toBe(false);
      expect(isStartCodon("TGA", GeneticCode.STANDARD)).toBe(false);
    });

    test("standard genetic code stop codons are biologically correct", () => {
      // Universal stop codons: UAG (amber), UAA (ochre), UGA (opal)
      expect(isStopCodon("TAG", GeneticCode.STANDARD)).toBe(true); // amber
      expect(isStopCodon("TAA", GeneticCode.STANDARD)).toBe(true); // ochre
      expect(isStopCodon("TGA", GeneticCode.STANDARD)).toBe(true); // opal

      // Non-stop codons
      expect(isStopCodon("ATG", GeneticCode.STANDARD)).toBe(false);
      expect(isStopCodon("AAA", GeneticCode.STANDARD)).toBe(false);
    });
  });

  describe("Vertebrate Mitochondrial (Table 2) - Critical Differences", () => {
    test("AGA and AGG are stop codons in vertebrate mitochondria", () => {
      // NCBI Table 2: AGA/AGG are stop codons, not Arginine
      expect(isStopCodon("AGA", GeneticCode.VERTEBRATE_MITOCHONDRIAL)).toBe(true);
      expect(isStopCodon("AGG", GeneticCode.VERTEBRATE_MITOCHONDRIAL)).toBe(true);

      const vertMitoCode = getGeneticCode(GeneticCode.VERTEBRATE_MITOCHONDRIAL);
      expect(vertMitoCode!.codons["AGA"]).toBe("*");
      expect(vertMitoCode!.codons["AGG"]).toBe("*");
    });

    test("UGA codes for Tryptophan in vertebrate mitochondria", () => {
      // NCBI Table 2: UGA → W (not stop)
      expect(isStopCodon("TGA", GeneticCode.VERTEBRATE_MITOCHONDRIAL)).toBe(false);

      const vertMitoCode = getGeneticCode(GeneticCode.VERTEBRATE_MITOCHONDRIAL);
      expect(vertMitoCode!.codons["TGA"]).toBe("W");

      // Test translation
      const sequence = "TGA"; // Should translate to Tryptophan
      const protein = translate(sequence, GeneticCode.VERTEBRATE_MITOCHONDRIAL);
      expect(protein).toBe("W");
    });

    test("AUA codes for Methionine in vertebrate mitochondria", () => {
      // NCBI Table 2: AUA → M (not I)
      const vertMitoCode = getGeneticCode(GeneticCode.VERTEBRATE_MITOCHONDRIAL);
      expect(vertMitoCode!.codons["ATA"]).toBe("M");

      // Compare with standard code
      const standardCode = getGeneticCode(GeneticCode.STANDARD);
      expect(standardCode!.codons["ATA"]).toBe("I");

      // Test translation difference
      const sequence = "ATA";
      const standardProtein = translate(sequence, GeneticCode.STANDARD);
      const mitoProtein = translate(sequence, GeneticCode.VERTEBRATE_MITOCHONDRIAL);
      expect(standardProtein).toBe("I");
      expect(mitoProtein).toBe("M");
    });

    test("vertebrate mitochondrial start codons are biologically accurate", () => {
      const vertMitoCode = getGeneticCode(GeneticCode.VERTEBRATE_MITOCHONDRIAL);

      // NCBI Table 2 start codons: ATT, ATC, ATA, ATG, GTG
      expect(vertMitoCode!.startCodons).toContain("ATT");
      expect(vertMitoCode!.startCodons).toContain("ATC");
      expect(vertMitoCode!.startCodons).toContain("ATA");
      expect(vertMitoCode!.startCodons).toContain("ATG");
      expect(vertMitoCode!.startCodons).toContain("GTG");
    });
  });

  describe("Yeast Mitochondrial (Table 3) - Unique Characteristics", () => {
    test("CTN codons code for Threonine in yeast mitochondria", () => {
      const yeastMitoCode = getGeneticCode(GeneticCode.YEAST_MITOCHONDRIAL);

      // NCBI Table 3: CTT, CTC, CTA, CTG → T (not L)
      expect(yeastMitoCode!.codons["CTT"]).toBe("T");
      expect(yeastMitoCode!.codons["CTC"]).toBe("T");
      expect(yeastMitoCode!.codons["CTA"]).toBe("T");
      expect(yeastMitoCode!.codons["CTG"]).toBe("T");

      // Test translation difference from standard
      const sequence = "CTTCTCCTACTG";
      const standardProtein = translate(sequence, GeneticCode.STANDARD);
      const yeastProtein = translate(sequence, GeneticCode.YEAST_MITOCHONDRIAL);
      expect(standardProtein).toBe("LLLL");
      expect(yeastProtein).toBe("TTTT");
    });

    test("CGA and CGC are absent codons in yeast mitochondria", () => {
      const yeastMitoCode = getGeneticCode(GeneticCode.YEAST_MITOCHONDRIAL);

      // NCBI Table 3: CGA/CGC are interpreted as stops
      expect(yeastMitoCode!.codons["CGA"]).toBe("*");
      expect(yeastMitoCode!.codons["CGC"]).toBe("*");
    });
  });

  describe("Ciliate Nuclear (Table 6) - Stop Codon Reassignment", () => {
    test("TAA and TAG code for Glutamine in ciliate nuclear code", () => {
      const ciliateCode = getGeneticCode(GeneticCode.CILIATE_NUCLEAR);

      // NCBI Table 6: TAA/TAG → Q (not stop)
      expect(ciliateCode!.codons["TAA"]).toBe("Q");
      expect(ciliateCode!.codons["TAG"]).toBe("Q");

      // Verify they're not stop codons
      expect(isStopCodon("TAA", GeneticCode.CILIATE_NUCLEAR)).toBe(false);
      expect(isStopCodon("TAG", GeneticCode.CILIATE_NUCLEAR)).toBe(false);

      // Only TGA remains as stop codon
      expect(isStopCodon("TGA", GeneticCode.CILIATE_NUCLEAR)).toBe(true);
    });
  });

  describe("Alternative Yeast Nuclear (Table 12) - CTG Reassignment", () => {
    test("CTG codes for Serine in alternative yeast nuclear code", () => {
      const altYeastCode = getGeneticCode(GeneticCode.ALTERNATIVE_YEAST_NUCLEAR);

      // NCBI Table 12: CTG → S (not L)
      expect(altYeastCode!.codons["CTG"]).toBe("S");

      // Test translation difference
      const sequence = "CTG";
      const standardProtein = translate(sequence, GeneticCode.STANDARD);
      const altYeastProtein = translate(sequence, GeneticCode.ALTERNATIVE_YEAST_NUCLEAR);
      expect(standardProtein).toBe("L");
      expect(altYeastProtein).toBe("S");
    });

    test("CTG is both codon and start codon in alternative yeast", () => {
      const altYeastCode = getGeneticCode(GeneticCode.ALTERNATIVE_YEAST_NUCLEAR);

      expect(altYeastCode!.startCodons).toContain("CTG");
      expect(altYeastCode!.startCodons).toContain("ATG");
      expect(isStartCodon("CTG", GeneticCode.ALTERNATIVE_YEAST_NUCLEAR)).toBe(true);
    });
  });
});

describe("Known Protein Sequence Validation", () => {
  describe("E. coli proteins (Standard genetic code)", () => {
    test("β-galactosidase N-terminal sequence translation", () => {
      // E. coli lacZ gene N-terminal: Met-Thr-Met-Ile-Thr-Asp-Ser-Tyr-Gln-Val
      const sequence = "ATGACCATGATTACGGATAGTTACCAAGTGCCT";
      const protein = translate(sequence, GeneticCode.STANDARD);
      expect(protein.substring(0, 10)).toBe("MTMITDSYQV");

      // Verify individual codons
      expect(translate("ATG", GeneticCode.STANDARD)).toBe("M"); // Met
      expect(translate("ACC", GeneticCode.STANDARD)).toBe("T"); // Thr
      expect(translate("TAC", GeneticCode.STANDARD)).toBe("Y"); // Tyr
      expect(translate("CAA", GeneticCode.STANDARD)).toBe("Q"); // Gln
    });

    test("tryptophan synthase alpha subunit start", () => {
      // E. coli trpA gene start: ATG-CAA-CAG-AAT
      const sequence = "ATGCAACAGAAT";
      const protein = translate(sequence, GeneticCode.STANDARD);
      expect(protein).toBe("MQQN");
    });
  });

  describe("Human mitochondrial proteins (Table 2)", () => {
    test("cytochrome c oxidase subunit I N-terminal", () => {
      // Human mitochondrial COX1: starts with ATG and uses UGA for Trp
      const sequence = "ATGTTCCGTTGA"; // ATG-TTC-CGT-TGA
      const protein = translate(sequence, GeneticCode.VERTEBRATE_MITOCHONDRIAL);
      expect(protein).toBe("MFRW"); // TGA codes for Tryptophan in mito code

      // Compare with standard code (would end at TGA)
      const standardProtein = translate(sequence, GeneticCode.STANDARD);
      expect(standardProtein).toBe("MFR*"); // TGA is stop in standard code
    });

    test("NADH dehydrogenase with AGA stops", () => {
      // Sequence ending in AGA (stop in mito code)
      const sequence = "ATGTTCAGA"; // ATG-TTC-AGA
      const protein = translate(sequence, GeneticCode.VERTEBRATE_MITOCHONDRIAL);
      expect(protein).toBe("MF*"); // AGA is stop in mitochondrial

      // In standard code, AGA codes for Arginine
      const standardProtein = translate(sequence, GeneticCode.STANDARD);
      expect(standardProtein).toBe("MFR");
    });
  });
});

describe("Reading Frame Biology Validation", () => {
  describe("six-frame translation accuracy", () => {
    test("forward frames (+1, +2, +3) are biologically correct", () => {
      const sequence = "ATGGGATCCTAG"; // 12 bases = 4 codons in frame +1
      const frames = translateSixFrames(sequence, GeneticCode.STANDARD);

      // Frame +1: ATG GGA TCC TAG
      expect(frames["+1"]).toBe("MGS*");
      // Frame +2: TGG GAT CCT AG
      expect(frames["+2"]).toBe("WDP"); // Last AG is incomplete
      // Frame +3: GGG ATC CTA G
      expect(frames["+3"]).toBe("GIL"); // Last G is incomplete
    });

    test("reverse frames (-1, -2, -3) use correct reverse complement", () => {
      const sequence = "ATGGGATCCTAG";
      const frames = translateSixFrames(sequence, GeneticCode.STANDARD);

      // Reverse complement of ATGGGATCCTAG is CTAGGATCCCAT
      // Frame -1: CTA GGA TCC CAT
      expect(frames["-1"]).toBe("LGSH"); // CAT → H (complete codon)
      // Frame -2: TAG GAT CCC AT
      expect(frames["-2"]).toBe("*DP"); // AT is incomplete
      // Frame -3: AGG ATC CCA T
      expect(frames["-3"]).toBe("RIP"); // T is incomplete

      // Verify lengths are correct
      expect(frames["+1"].length).toBe(4);
      expect(frames["+2"].length).toBe(3);
      expect(frames["+3"].length).toBe(3);
      expect(frames["-1"].length).toBe(4); // Complete codons including CAT
      expect(frames["-2"].length).toBe(3);
      expect(frames["-3"].length).toBe(3);
    });
  });
});

describe("Edge Cases and Boundary Conditions", () => {
  describe("ambiguous nucleotide handling", () => {
    test("N (any nucleotide) codons translate to X", () => {
      const sequence = "NNNAAANNNGGGNNN";
      const protein = translate(sequence, GeneticCode.STANDARD);
      expect(protein).toBe("XKXGX");
    });

    test("partial ambiguous codons are handled correctly", () => {
      const sequence = "ATGAAANNNTTT"; // ATG-AAA-NNN-TTT
      const protein = translate(sequence, GeneticCode.STANDARD);
      expect(protein).toBe("MKXF");
    });
  });

  describe("incomplete sequences", () => {
    test("sequences not divisible by 3 are handled correctly", () => {
      // 11 bases - last codon incomplete
      const sequence = "ATGGGATCCTA";
      const protein = translate(sequence, GeneticCode.STANDARD);
      expect(protein).toBe("MGS"); // Last incomplete codon ignored
    });

    test("very short sequences are handled", () => {
      expect(translate("AT", GeneticCode.STANDARD)).toBe("");
      expect(translate("ATG", GeneticCode.STANDARD)).toBe("M");
    });
  });

  describe("case sensitivity and RNA/DNA handling", () => {
    test("lowercase sequences are correctly processed", () => {
      const sequence = "atgggatcctag";
      const protein = translate(sequence, GeneticCode.STANDARD);
      expect(protein).toBe("MGS*");
    });

    test("RNA sequences (with U) are correctly converted", () => {
      const rnaSequence = "AUGGGAUCCUAG";
      const dnaSequence = "ATGGGATCCTAG";

      const rnaProtein = translate(rnaSequence, GeneticCode.STANDARD);
      const dnaProtein = translate(dnaSequence, GeneticCode.STANDARD);

      expect(rnaProtein).toBe(dnaProtein);
      expect(rnaProtein).toBe("MGS*");
    });
  });
});

describe("ORF Finding Biological Validation", () => {
  describe("realistic ORF scenarios", () => {
    test("multiple ORFs in bacterial-like sequence", () => {
      // Simulate bacterial polycistronic mRNA with multiple ORFs
      const sequence = "TTGAAATTTTAGATGGGCTCCTAA"; // TTG start, ATG start
      const orfs = findORFs(sequence, GeneticCode.STANDARD, 2);

      expect(orfs.length).toBeGreaterThan(0);

      // Check for ORFs starting with valid start codons
      const validStartOrfs = orfs.filter((orf) =>
        isStartCodon(sequence.substring(orf.start, orf.start + 3), GeneticCode.STANDARD),
      );
      expect(validStartOrfs.length).toBeGreaterThan(0);
    });

    test("nested ORFs are detected correctly", () => {
      // ORF within ORF scenario
      const sequence = "ATGAAATGGGGTCCTAG"; // ATG...ATG...TAG
      const orfs = findORFs(sequence, GeneticCode.STANDARD, 2);

      // Should find both the outer and inner ORFs
      expect(orfs.length).toBeGreaterThan(1);
    });

    test("ORFs with alternative start codons", () => {
      // Using TTG as start - note: in ORF finding, start codons still translate to their amino acid
      const sequence = "TTGGGATCCTAG"; // TTG-GGA-TCC-TAG
      const orfs = findORFs(sequence, GeneticCode.STANDARD, 2);

      const ttgOrf = orfs.find((orf) => orf.start === 0);
      expect(ttgOrf).toBeDefined();
      expect(ttgOrf?.protein).toBe("LGS"); // TTG → L, GGA → G, TCC → S, TAG → stop

      // Verify TTG is recognized as a valid start codon
      expect(isStartCodon("TTG", GeneticCode.STANDARD)).toBe(true);
    });
  });

  describe("mitochondrial ORF patterns", () => {
    test("vertebrate mitochondrial ORFs with UGA codons", () => {
      // Mitochondrial-like sequence with TGA coding for Trp
      const sequence = "ATGTGAGGGTAG"; // ATG-TGA-GGG-TAG

      const standardOrfs = findORFs(sequence, GeneticCode.STANDARD, 1);
      const mitoOrfs = findORFs(sequence, GeneticCode.VERTEBRATE_MITOCHONDRIAL, 1);

      // Standard code: TGA is stop, so short ORF
      const standardOrf = standardOrfs.find((orf) => orf.start === 0);
      expect(standardOrf?.protein).toBe("M"); // Stops at TGA

      // Mitochondrial code: TGA codes for W, so longer ORF
      const mitoOrf = mitoOrfs.find((orf) => orf.start === 0);
      expect(mitoOrf?.protein).toBe("MWG"); // TGA → W
    });
  });
});
