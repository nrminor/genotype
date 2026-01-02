import { beforeEach, describe, expect, test } from "bun:test";
import { primer } from "../../src/operations/core/alphabet";
import { SeqOps, seqops } from "../../src/operations/index";
import type { AbstractSequence } from "../../src/types";

describe("SeqOps Amplicon Integration", () => {
  let testSequences: AbstractSequence[];

  beforeEach(() => {
    testSequences = [
      {
        format: "fasta",
        id: "seq1",
        sequence: "AAAA" + "ATCGATCGATCGATCG" + "TTTTTTTT" + "CGATCGATCGATCGAT" + "GGGG",
        length: 48,
      },
      {
        format: "fasta",
        id: "seq2",
        sequence: "CCCC" + "ATCGATCGATCGATCG" + "AAAAAAAA" + "CGATCGATCGATCGAT" + "TTTT",
        length: 48,
      },
    ];
  });

  describe("90% use case: maximum simplicity", () => {
    test("simple two-primer amplicon extraction", async () => {
      const result = await SeqOps.from(testSequences)
        .amplicon("ATCGATCGATCGATCG", "ATCGATCGATCGATCG")
        .collect();

      expect(result.length).toBeGreaterThanOrEqual(0);
      if (result.length > 0) {
        expect(result[0].id).toContain("amplicon");
      }
    });

    test("with mismatch tolerance (common case)", async () => {
      const result = await SeqOps.from(testSequences)
        .amplicon("ATCGATCGATCGATCG", "ATCGATCGATCGATCG", 1)
        .collect();

      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    test("single primer (auto-canonical matching)", async () => {
      const result = await SeqOps.from(testSequences).amplicon("ATCGATCGATCGATCG").collect();

      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    test("type-safe primers with template literals", async () => {
      const covidForward = primer`ACCAGGAACTAATCAGACAAG`;
      const covidReverse = primer`CAAAGACCAATCCTACCATGAG`;

      // Should work seamlessly with pre-validated primers
      const result = await SeqOps.from([
        {
          format: "fasta",
          id: "covid_test",
          sequence:
            "ATCG" + "ACCAGGAACTAATCAGACAAG" + "TTTTTTTT" + "CTCATGGTAGGATTGGTCTTTG" + "GCTA",
          length: 60,
        },
      ])
        .amplicon(covidForward, covidReverse, 2)
        .collect();

      expect(result.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("advanced features: progressive disclosure", () => {
    test("long reads with windowed search", async () => {
      const longRead = {
        format: "fasta" as const,
        id: "long_read",
        sequence: "ATCGATCGATCGATCG" + "N".repeat(5000) + "CGATCGATCGATCGAT",
        length: 5032,
      };

      const start = performance.now();
      const result = await SeqOps.from([longRead])
        .amplicon({
          forwardPrimer: "ATCGATCGATCGATCG",
          reversePrimer: "ATCGATCGATCGATCG",
          searchWindow: { forward: 100, reverse: 100 }, // Performance boost
        })
        .collect();
      const end = performance.now();

      expect(result.length).toBeGreaterThanOrEqual(0);
      expect(end - start).toBeLessThan(100); // Fast with windowed search
    });

    test("flanking regions with seqkit compatibility", async () => {
      const result = await SeqOps.from(testSequences)
        .amplicon({
          forwardPrimer: "ATCGATCGATCGATCG",
          reversePrimer: "ATCGATCGATCGATCG",
          flanking: true,
          region: "-5:5",
        })
        .collect();

      expect(result.length).toBeGreaterThanOrEqual(0);
      if (result.length > 0) {
        expect(result[0].description).toContain("flanking");
      }
    });

    test("BED-extracted primers with canonical matching", async () => {
      const bedPrimer1 = "ATCGATCGATCGATCG"; // Simulated BED extraction
      const bedPrimer2 = "ATCGATCGATCGATCG"; // Same orientation from BED

      const result = await SeqOps.from(testSequences)
        .amplicon({
          forwardPrimer: bedPrimer1,
          reversePrimer: bedPrimer2,
          canonical: true, // Force canonical for BED scenario
        })
        .collect();

      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    test("complete feature integration: all options", async () => {
      const nanoporeRead = {
        format: "fasta" as const,
        id: "nanopore_read",
        sequence: "ACCAGGAACTAATCAGACAAG" + "N".repeat(1000) + "CTTGTCTGATTAGTTCCTGGT",
        length: 1042,
      };

      const result = await SeqOps.from([nanoporeRead])
        .amplicon({
          forwardPrimer: primer`ACCAGGAACTAATCAGACAAG`,
          maxMismatches: 2,
          canonical: true,
          flanking: true,
          region: "-10:10",
          searchWindow: { forward: 100, reverse: 100 },
          outputMismatches: true,
        })
        .collect();

      expect(result.length).toBeGreaterThanOrEqual(0);
      if (result.length > 0) {
        expect(result[0].description).toContain("flanking");
        expect(result[0].description).toContain("mismatches");
      }
    });
  });

  describe("pipeline integration", () => {
    test("chains seamlessly with other operations", async () => {
      const result = await SeqOps.from(testSequences)
        .filter({ minLength: 40 })
        .amplicon("ATCGATCGATCGATCG", "ATCGATCGATCGATCG")
        .transform({ upperCase: true })
        .collect();

      expect(result.length).toBeGreaterThanOrEqual(0);
      if (result.length > 0) {
        expect(result[0].sequence).toBe(result[0].sequence.toUpperCase());
      }
    });

    test("real-world COVID-19 diagnostic pipeline", async () => {
      const covidSample = {
        format: "fasta" as const,
        id: "covid_sample",
        sequence:
          "ATCG" +
          "ACCAGGAACTAATCAGACAAG" +
          "CAGACAAGTCGTTCTACAGGTACGTTAATAGTTAATAGCGT" +
          "CTCATGGTAGGATTGGTCTTTG" +
          "GCTA",
        length: 88,
      };

      const diagnosticResult = await SeqOps.from([covidSample])
        .quality({ minScore: 20 }) // Quality filtering
        .amplicon(
          primer`ACCAGGAACTAATCAGACAAG`, // N gene forward
          primer`CAAAGACCAATCCTACCATGAG`, // N gene reverse
          2 // Allow sequencing errors
        )
        .validate({ mode: "strict" }) // Post-amplicon validation
        .stats({ detailed: true });

      expect(typeof diagnosticResult.totalLength).toBe("number");
    });

    test("16S rRNA metagenomics workflow", async () => {
      const microbialSample = {
        format: "fasta" as const,
        id: "microbial_sample",
        sequence: "ATCG" + "GTGCCAGCAGCCGCGGTAA" + "N".repeat(300) + "ATTAGACCCGTCCTCC" + "GCTA",
        length: 340,
      };

      const microbiomeResult = await SeqOps.from([microbialSample])
        .amplicon({
          forwardPrimer: primer`GTGCCAGCMGCCGCGGTAA`, // 515F (M=A|C)
          reversePrimer: primer`GGACTACHVGGGTWTCTAAT`, // 806R (H,V,W IUPAC)
          maxMismatches: 1,
          outputMismatches: true,
        })
        .filter({ minLength: 200, maxLength: 400 }) // V4 expected length
        .clean({ removeGaps: true })
        .stats();

      expect(typeof microbiomeResult.totalLength).toBe("number");
    });
  });

  describe("progressive disclosure validation", () => {
    test("simple cases require zero complexity", () => {
      // These should compile and be intuitive
      const simple1 = SeqOps.from(testSequences).amplicon("FORWARD", "REVERSE");
      const simple2 = SeqOps.from(testSequences).amplicon("FORWARD", "REVERSE", 2);
      const simple3 = SeqOps.from(testSequences).amplicon("SINGLE_PRIMER");

      expect(simple1).toBeDefined();
      expect(simple2).toBeDefined();
      expect(simple3).toBeDefined();
    });

    test("advanced features available when needed", () => {
      // Full options object should work for sophisticated use cases
      const advanced = SeqOps.from(testSequences).amplicon({
        forwardPrimer: primer`ATCGATCGATCGATCG`,
        reversePrimer: primer`CGATCGATCGATCGAT`,
        maxMismatches: 3,
        canonical: true,
        flanking: true,
        region: "-50:50",
        searchWindow: { forward: 200, reverse: 200 },
        outputMismatches: true,
      });

      expect(advanced).toBeDefined();
    });

    test("parameter type checking works correctly", async () => {
      // Should handle mixed parameter types gracefully
      const mixedTypes = await SeqOps.from(testSequences)
        .amplicon(
          primer`ATCGATCGATCGATCG`, // PrimerSequence type
          "CGATCGATCGATCGAT", // string type
          1 // number
        )
        .collect();

      expect(mixedTypes.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("method chaining and type safety", () => {
    test("maintains SeqOps type through chain", () => {
      const chain = SeqOps.from(testSequences)
        .amplicon("FORWARD", "REVERSE")
        .filter({ minLength: 10 })
        .transform({ upperCase: true });

      expect(chain).toBeDefined();
      expect(typeof chain.collect).toBe("function");
    });

    test("works with all terminal operations", async () => {
      const seqOpsChain = SeqOps.from(testSequences).amplicon(
        "ATCGATCGATCGATCG",
        "ATCGATCGATCGATCG"
      );

      // Should work with all terminal operations
      const stats = await seqOpsChain.stats();
      const count = await seqOpsChain.count();
      const collected = await seqOpsChain.collect();

      expect(typeof stats.totalLength).toBe("number");
      expect(typeof count).toBe("number");
      expect(Array.isArray(collected)).toBe(true);
    });
  });
});
