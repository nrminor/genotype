/**
 * Comprehensive tests for quality score binning module
 *
 * Tests platform-specific presets, binning algorithms, and utility functions
 * for collapsing quality scores into 2, 3, or 5 bins for improved compression.
 */

import { describe, expect, test } from "bun:test";
import {
  type BinnedResult,
  type BinningStrategy,
  binQualityString,
  calculateBinDistribution,
  calculateCompressionRatio,
  calculateRepresentatives,
  findBinIndex,
  type Platform,
  PRESETS,
  validateBoundaries,
} from "../../../src/operations/core/quality/binning";

describe("Quality Binning - Platform Presets", () => {
  test("PRESETS contains all three platforms", () => {
    expect(PRESETS).toHaveProperty("illumina");
    expect(PRESETS).toHaveProperty("pacbio");
    expect(PRESETS).toHaveProperty("nanopore");
  });

  test("Illumina presets have correct structure", () => {
    expect(PRESETS.illumina[2]).toEqual([20]);
    expect(PRESETS.illumina[3]).toEqual([15, 30]);
    expect(PRESETS.illumina[5]).toEqual([10, 20, 30, 35]);
  });

  test("PacBio presets have correct structure", () => {
    expect(PRESETS.pacbio[2]).toEqual([13]);
    expect(PRESETS.pacbio[3]).toEqual([10, 20]);
    expect(PRESETS.pacbio[5]).toEqual([7, 13, 20, 30]);
  });

  test("Nanopore presets have correct structure", () => {
    expect(PRESETS.nanopore[2]).toEqual([10]);
    expect(PRESETS.nanopore[3]).toEqual([7, 12]);
    expect(PRESETS.nanopore[5]).toEqual([5, 9, 12, 18]);
  });
});

describe("calculateRepresentatives", () => {
  test("2-bin with boundary [20]", () => {
    const reps = calculateRepresentatives([20]);
    expect(reps).toEqual([10, 30]);
    // Bin 0: [0-19] → midpoint 10
    // Bin 1: [20+]  → 20 + 10 = 30
  });

  test("3-bin with boundaries [15, 30]", () => {
    const reps = calculateRepresentatives([15, 30]);
    expect(reps).toEqual([7, 22, 40]);
    // Bin 0: [0-14]  → midpoint 7
    // Bin 1: [15-29] → midpoint 22
    // Bin 2: [30+]   → 30 + 10 = 40
  });

  test("5-bin with boundaries [10, 20, 30, 35]", () => {
    const reps = calculateRepresentatives([10, 20, 30, 35]);
    expect(reps).toEqual([5, 15, 25, 32, 45]);
    // Bin 0: [0-9]   → midpoint 5
    // Bin 1: [10-19] → midpoint 15
    // Bin 2: [20-29] → midpoint 25
    // Bin 3: [30-34] → midpoint 32
    // Bin 4: [35+]   → 35 + 10 = 45
  });

  test("handles small boundary values", () => {
    const reps = calculateRepresentatives([5]);
    expect(reps).toEqual([2, 15]);
    // Bin 0: [0-4] → midpoint 2
    // Bin 1: [5+]  → 5 + 10 = 15
  });

  test("throws error for empty boundaries", () => {
    expect(() => calculateRepresentatives([])).toThrow("Boundaries array cannot be empty");
  });
});

describe("findBinIndex", () => {
  const boundaries3bin = [15, 30];

  test("score below first boundary → bin 0", () => {
    expect(findBinIndex(0, boundaries3bin)).toBe(0);
    expect(findBinIndex(10, boundaries3bin)).toBe(0);
    expect(findBinIndex(14, boundaries3bin)).toBe(0);
  });

  test("score at first boundary → bin 1", () => {
    expect(findBinIndex(15, boundaries3bin)).toBe(1);
  });

  test("score between boundaries → bin 1", () => {
    expect(findBinIndex(20, boundaries3bin)).toBe(1);
    expect(findBinIndex(25, boundaries3bin)).toBe(1);
    expect(findBinIndex(29, boundaries3bin)).toBe(1);
  });

  test("score at second boundary → bin 2", () => {
    expect(findBinIndex(30, boundaries3bin)).toBe(2);
  });

  test("score above last boundary → last bin", () => {
    expect(findBinIndex(40, boundaries3bin)).toBe(2);
    expect(findBinIndex(93, boundaries3bin)).toBe(2);
  });

  test("2-bin boundaries", () => {
    const boundaries2bin = [20];
    expect(findBinIndex(0, boundaries2bin)).toBe(0);
    expect(findBinIndex(19, boundaries2bin)).toBe(0);
    expect(findBinIndex(20, boundaries2bin)).toBe(1);
    expect(findBinIndex(50, boundaries2bin)).toBe(1);
  });

  test("5-bin boundaries", () => {
    const boundaries5bin = [10, 20, 30, 35];
    expect(findBinIndex(5, boundaries5bin)).toBe(0);
    expect(findBinIndex(15, boundaries5bin)).toBe(1);
    expect(findBinIndex(25, boundaries5bin)).toBe(2);
    expect(findBinIndex(32, boundaries5bin)).toBe(3);
    expect(findBinIndex(40, boundaries5bin)).toBe(4);
  });
});

describe("binQualityString", () => {
  test("bins quality string with 3-bin Illumina strategy", () => {
    const strategy: BinningStrategy = {
      bins: 3,
      boundaries: [15, 30],
      representatives: [7, 22, 40],
      encoding: "phred33",
    };

    // '!' = Q0, 'I' = Q40, '(' = Q7
    const original = "!!!IIIII";
    const binned = binQualityString(original, strategy);

    // All '!' (Q0) → bin 0 → rep 7 → '('
    // All 'I' (Q40) → bin 2 → rep 40 → 'I'
    expect(binned).toBe("(((IIIII");
  });

  test("bins quality string with 2-bin strategy", () => {
    const strategy: BinningStrategy = {
      bins: 2,
      boundaries: [20],
      representatives: [10, 30],
      encoding: "phred33",
    };

    // '!' = Q0, 'I' = Q40
    const original = "!!!!IIII";
    const binned = binQualityString(original, strategy);

    // '!' (Q0) → bin 0 → rep 10 → '+'
    // 'I' (Q40) → bin 1 → rep 30 → '?'
    expect(binned).toBe("++++????");
  });

  test("preserves string length", () => {
    const strategy: BinningStrategy = {
      bins: 3,
      boundaries: [15, 30],
      representatives: [7, 22, 40],
      encoding: "phred33",
    };

    const original = "IIIIIIIIII";
    const binned = binQualityString(original, strategy);

    expect(binned.length).toBe(original.length);
  });

  test("handles empty string", () => {
    const strategy: BinningStrategy = {
      bins: 2,
      boundaries: [20],
      representatives: [10, 30],
      encoding: "phred33",
    };

    const binned = binQualityString("", strategy);
    expect(binned).toBe("");
  });

  test("creates runs of identical characters for compression", () => {
    const strategy: BinningStrategy = {
      bins: 2,
      boundaries: [20],
      representatives: [10, 30],
      encoding: "phred33",
    };

    // Mixed quality scores collapse to two characters
    const original = "!#%'ACEGI";
    const binned = binQualityString(original, strategy);

    // All low scores → '+'
    // All high scores (≥20) → '?'
    const uniqueOriginal = new Set(original).size;
    const uniqueBinned = new Set(binned).size;

    expect(uniqueBinned).toBeLessThan(uniqueOriginal);
    expect(uniqueBinned).toBe(2); // Only 2 unique chars in binned
  });
});

describe("calculateBinDistribution", () => {
  test("counts scores in each bin for 3-bin strategy", () => {
    const strategy: BinningStrategy = {
      bins: 3,
      boundaries: [15, 30],
      representatives: [7, 22, 40],
      encoding: "phred33",
    };

    // '!' = Q0 (bin 0), '7' = Q22 (bin 1), 'I' = Q40 (bin 2)
    const quality = "!!!777777IIIII";
    const distribution = calculateBinDistribution(quality, strategy);

    expect(distribution).toEqual([3, 6, 5]);
    // 3 in bin 0 (<15)
    // 6 in bin 1 (15-29)
    // 5 in bin 2 (≥30)
  });

  test("counts scores for 2-bin strategy", () => {
    const strategy: BinningStrategy = {
      bins: 2,
      boundaries: [20],
      representatives: [10, 30],
      encoding: "phred33",
    };

    const quality = "!!!!IIII";
    const distribution = calculateBinDistribution(quality, strategy);

    expect(distribution).toEqual([4, 4]);
  });

  test("handles all scores in one bin", () => {
    const strategy: BinningStrategy = {
      bins: 3,
      boundaries: [15, 30],
      representatives: [7, 22, 40],
      encoding: "phred33",
    };

    const quality = "IIIIIIIIII"; // All Q40 (bin 2)
    const distribution = calculateBinDistribution(quality, strategy);

    expect(distribution).toEqual([0, 0, 10]);
  });

  test("handles empty string", () => {
    const strategy: BinningStrategy = {
      bins: 2,
      boundaries: [20],
      representatives: [10, 30],
      encoding: "phred33",
    };

    const distribution = calculateBinDistribution("", strategy);
    expect(distribution).toEqual([0, 0]);
  });
});

describe("calculateCompressionRatio", () => {
  test("calculates ratio for high entropy reduction", () => {
    const original = "ABCDEFG"; // 7 unique chars
    const binned = "AAAIIII"; // 2 unique chars

    const ratio = calculateCompressionRatio(original, binned);
    expect(ratio).toBe(3.5); // 7 / 2 = 3.5
  });

  test("calculates ratio for moderate compression", () => {
    const original = "ABCDEFGHIJ"; // 10 unique
    const binned = "AAAAIIIIII"; // 2 unique

    const ratio = calculateCompressionRatio(original, binned);
    expect(ratio).toBe(5.0); // 10 / 2 = 5.0
  });

  test("returns 1.0 for no improvement", () => {
    const original = "IIIIIIIIII"; // 1 unique
    const binned = "IIIIIIIIII"; // 1 unique

    const ratio = calculateCompressionRatio(original, binned);
    expect(ratio).toBe(1.0); // No improvement
  });

  test("handles edge case of empty binned string", () => {
    const ratio = calculateCompressionRatio("ABC", "");
    expect(ratio).toBe(1.0); // Returns 1.0 for degenerate case
  });

  test("realistic FASTQ quality compression", () => {
    // Original has many unique quality chars
    const original = "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHI";
    // Binned to 3 bins reduces unique chars significantly
    const binned = "((((((((((((((((7777777777IIIIIIIIIIIIII";

    const ratio = calculateCompressionRatio(original, binned);
    expect(ratio).toBeGreaterThan(1.0);

    // Original has 41 unique chars, binned has 3 unique chars
    // 41 / 3 = 13.67
    expect(ratio).toBeCloseTo(13.67, 1);
  });
});

describe("Quality Binning - Boundary Validation", () => {
  test("accepts valid ascending boundaries for phred33", () => {
    expect(() => validateBoundaries([15, 30], "phred33")).not.toThrow();
    expect(() => validateBoundaries([10, 20, 30, 35], "phred33")).not.toThrow();
  });

  test("rejects non-ascending boundaries", () => {
    expect(() => validateBoundaries([30, 15], "phred33")).toThrow(
      /value at index 1 \(15\) <= previous value \(30\)/
    );
  });

  test("rejects duplicate boundaries", () => {
    expect(() => validateBoundaries([15, 15, 30], "phred33")).toThrow(
      /value at index 1 \(15\) <= previous value \(15\)/
    );
  });

  test("rejects out-of-range boundaries for phred33", () => {
    expect(() => validateBoundaries([15, 100], "phred33")).toThrow(
      /value at index 1 \(100\) outside valid range \[0, 93\]/
    );
  });

  test("rejects negative boundaries for phred33", () => {
    expect(() => validateBoundaries([-5, 10], "phred33")).toThrow(
      /value at index 0 \(-5\) outside valid range \[0, 93\]/
    );
  });

  test("accepts negative boundaries for solexa", () => {
    expect(() => validateBoundaries([-5, 10], "solexa")).not.toThrow();
  });

  test("rejects boundaries below solexa minimum", () => {
    expect(() => validateBoundaries([-10, 10], "solexa")).toThrow(
      /value at index 0 \(-10\) outside valid range \[-5, 62\]/
    );
  });

  test("rejects boundaries above phred64 maximum", () => {
    expect(() => validateBoundaries([10, 70], "phred64")).toThrow(
      /value at index 1 \(70\) outside valid range \[0, 62\]/
    );
  });

  test("shows actual boundary values in error message", () => {
    try {
      validateBoundaries([30, 15, 10], "phred33");
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("[30,15,10]");
    }
  });

  test("rejects empty boundaries array", () => {
    expect(() => validateBoundaries([], "phred33")).toThrow(/Boundaries array cannot be empty/);
  });
});
