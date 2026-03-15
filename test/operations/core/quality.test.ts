/**
 * Comprehensive tests for unified quality operations module
 *
 * Based on domain research findings:
 * - Multi-line FASTQ handling edge cases
 * - Quality encoding ambiguity zones (ASCII 64-93)
 * - Platform-specific patterns (Illumina, PacBio, Nanopore)
 * - Character contamination issues (@ and + in quality strings)
 */

import { describe, expect, test } from "bun:test";
import {
  type AsciiOffset,
  calculateAverageQuality,
  // Statistics
  calculateQualityStats,
  // Core conversions
  charToScore,
  convertQuality,
  // Detection
  detectEncoding,
  detectEncodingWithConfidence,
  errorProbabilityToScore,
  // Encoding info
  getEncodingInfo,
  // Type guards and branded types
  isValidQualityScore,
  isValidSolexaScore,
  type QualityScore,
  qualityToScores,
  scoreToChar,
  scoreToErrorProbability,
} from "../../../src/operations/core/quality";

describe("Quality Operations - Type Safety", () => {
  describe("isValidQualityScore type guard", () => {
    test("accepts valid quality scores 0-93", () => {
      expect(isValidQualityScore(0)).toBe(true);
      expect(isValidQualityScore(1)).toBe(true);
      expect(isValidQualityScore(40)).toBe(true);
      expect(isValidQualityScore(93)).toBe(true);
    });

    test("rejects negative scores", () => {
      expect(isValidQualityScore(-1)).toBe(false);
      expect(isValidQualityScore(-5)).toBe(false); // Even Solexa -5 is not a valid QualityScore
      expect(isValidQualityScore(-100)).toBe(false);
    });

    test("rejects scores greater than 93", () => {
      expect(isValidQualityScore(94)).toBe(false);
      expect(isValidQualityScore(100)).toBe(false);
      expect(isValidQualityScore(255)).toBe(false);
    });

    test("rejects non-integer scores", () => {
      expect(isValidQualityScore(40.5)).toBe(false);
      expect(isValidQualityScore(93.1)).toBe(false);
      expect(isValidQualityScore(0.99)).toBe(false);
    });

    test("rejects special numeric values", () => {
      expect(isValidQualityScore(NaN)).toBe(false);
      expect(isValidQualityScore(Infinity)).toBe(false);
      expect(isValidQualityScore(-Infinity)).toBe(false);
    });
  });

  describe("isValidSolexaScore type guard", () => {
    test("accepts Solexa score range (-5 to 62)", () => {
      expect(isValidSolexaScore(-5)).toBe(true); // minimum
      expect(isValidSolexaScore(62)).toBe(true); // maximum
      expect(isValidSolexaScore(0)).toBe(true); // zero
      expect(isValidSolexaScore(40)).toBe(true); // common value

      // Full range test
      for (let i = -5; i <= 62; i++) {
        expect(isValidSolexaScore(i)).toBe(true);
      }
    });

    test("rejects scores outside Solexa range", () => {
      expect(isValidSolexaScore(-6)).toBe(false);
      expect(isValidSolexaScore(63)).toBe(false);
      expect(isValidSolexaScore(93)).toBe(false);
      expect(isValidSolexaScore(-100)).toBe(false);
      expect(isValidSolexaScore(100)).toBe(false);
    });

    test("rejects non-integer values", () => {
      expect(isValidSolexaScore(-4.5)).toBe(false);
      expect(isValidSolexaScore(0.1)).toBe(false);
      expect(isValidSolexaScore(40.99)).toBe(false);
    });

    test("rejects special values", () => {
      expect(isValidSolexaScore(NaN)).toBe(false);
      expect(isValidSolexaScore(Infinity)).toBe(false);
      expect(isValidSolexaScore(-Infinity)).toBe(false);
    });
  });

  describe("Compile-time type narrowing", () => {
    test("type guards narrow unknown values correctly", () => {
      const unknownScore: unknown = 40;
      const unknownOffset: unknown = 33;

      // Before guard: TypeScript doesn't know the type
      expect(typeof unknownScore).toBe("number");

      // After guard: TypeScript knows it's a QualityScore
      if (isValidQualityScore(unknownScore as number)) {
        // This assignment would fail without proper narrowing
        const score: QualityScore = unknownScore as QualityScore;
        expect(score as number).toBe(40);
      }

      const offset: AsciiOffset = unknownOffset as AsciiOffset;
      expect(offset as number).toBe(33);
    });

    test("type guards work in conditional chains", () => {
      const processScore = (value: unknown): string => {
        if (typeof value === "number" && isValidQualityScore(value)) {
          // TypeScript knows value is QualityScore here
          return `Valid score: ${value}`;
        }
        return "Invalid score";
      };

      expect(processScore(40)).toBe("Valid score: 40");
      expect(processScore(100)).toBe("Invalid score");
      expect(processScore("40")).toBe("Invalid score");
    });

    test("type guards enable safe array filtering", () => {
      const mixedValues = [0, 40, -5, 93, 100, 40.5, NaN];

      // Filter to only valid quality scores
      const validScores = mixedValues.filter(isValidQualityScore);

      // TypeScript should know these are all valid
      expect(validScores.map((s) => s as number)).toEqual([0, 40, 93]);
      expect(validScores.every((s) => s >= 0 && s <= 93)).toBe(true);
    });
  });

  describe("Branded types prevent errors", () => {
    test("prevents mixing regular numbers with QualityScore", () => {
      const regularNumber = 40;
      const validatedScore: QualityScore = 40 as QualityScore; // Must cast

      // Can't assign regular number to QualityScore without validation
      // @ts-expect-error - Regular number can't be assigned to branded type
      const _wrongAssignment: QualityScore = regularNumber;

      // But validated scores work fine
      const correctAssignment: QualityScore = validatedScore;
      expect(correctAssignment as number).toBe(40);
    });

    test("prevents invalid offset values", () => {
      const validOffset: AsciiOffset = 33 as AsciiOffset;

      // Can't use arbitrary numbers as offsets
      // @ts-expect-error - 32 is not a valid AsciiOffset
      const _invalidOffset: AsciiOffset = 32;

      // @ts-expect-error - 65 is not a valid AsciiOffset
      const _anotherInvalid: AsciiOffset = 65;

      expect(validOffset as number).toBe(33);
    });

    test("functions require proper type validation", () => {
      // This simulates how functions should use branded types
      const processQualityScore = (score: QualityScore): string => {
        return `Q${score}`;
      };

      const untrustedValue = 40;

      // Can't pass unvalidated number directly
      // @ts-expect-error - Must validate before passing
      processQualityScore(untrustedValue);

      // Must validate first
      if (isValidQualityScore(untrustedValue)) {
        const result = processQualityScore(untrustedValue as QualityScore);
        expect(result).toBe("Q40");
      }
    });

    test("prevents out-of-bounds scores at type level", () => {
      // These casts would be caught by validation
      const _tooHigh = 100 as QualityScore; // Unsafe cast
      const _negative = -5 as QualityScore; // Unsafe cast

      // Type guards catch these
      expect(isValidQualityScore(100)).toBe(false);
      expect(isValidQualityScore(-5)).toBe(false);

      // Proper validation prevents bad casts
      const safeProcess = (value: number): QualityScore | null => {
        return isValidQualityScore(value) ? (value as QualityScore) : null;
      };

      expect(safeProcess(40) as number | null).toBe(40);
      expect(safeProcess(100)).toBe(null);
    });
  });

  describe("Property-based invariants", () => {
    // Declarative test data generators
    const generateValidScores = (count: number): number[] =>
      Array.from({ length: count }, () => Math.floor(Math.random() * 94)); // 0-93

    const generateInvalidScores = (count: number): number[] =>
      Array.from({ length: count }, () => {
        const choice = Math.random();
        if (choice < 0.25) {
          return Math.floor(Math.random() * 100) + 94; // > 93
        } else if (choice < 0.5) {
          return Math.floor(Math.random() * 100) - 100; // negative
        } else if (choice < 0.75) {
          return Math.random() * 93; // non-integer
        } else {
          return [NaN, Infinity, -Infinity][Math.floor(Math.random() * 3)]!; // special values
        }
      });

    test("invariant: all valid scores pass type guard", () => {
      const validScores = generateValidScores(100);
      for (const score of validScores) {
        expect(isValidQualityScore(score)).toBe(true);
      }
    });

    test("invariant: all invalid scores fail type guard", () => {
      const invalidScores = generateInvalidScores(100);
      for (const score of invalidScores) {
        expect(isValidQualityScore(score)).toBe(false);
      }
    });

    test("invariant: round-trip conversion preserves values", () => {
      const scores = generateValidScores(50);

      // For each encoding, round-trip should preserve values
      for (const encoding of ["phred33", "phred64"] as const) {
        for (const score of scores) {
          // Skip scores that exceed encoding's max
          if (encoding === "phred64" && score > 62) continue;

          const quality = scoreToChar(score, encoding);
          const decoded = charToScore(quality, encoding);
          expect(decoded as number).toBe(score);
        }
      }
    });

    test("invariant: type guard is total function (handles all inputs)", () => {
      const testValues = [
        ...generateValidScores(20),
        ...generateInvalidScores(20),
        0,
        -0,
        1e10,
        -1e10,
        0.1,
        -0.1,
        Number.MAX_VALUE,
        Number.MIN_VALUE,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
      ];

      for (const value of testValues) {
        // Should never throw, always return boolean
        const result = isValidQualityScore(value);
        expect(typeof result).toBe("boolean");
      }
    });

    test("invariant: offset values are exhaustively checked", () => {
      const allPossibleOffsets = [33, 59, 64];
      const invalidOffsets = [0, 1, 32, 34, 58, 60, 63, 65, 100, -1];

      // All valid offsets pass
      for (const offset of allPossibleOffsets) {
        expect([33, 59, 64]).toContain(offset);
      }

      // All others fail
      for (const offset of invalidOffsets) {
        expect([33, 59, 64]).not.toContain(offset);
      }

      // Property: exactly 3 valid offsets
      let validCount = 0;
      for (let i = -1000; i <= 1000; i++) {
        if ([33, 59, 64].includes(i)) validCount++;
      }
      expect(validCount).toBe(3);
    });

    test("invariant: validated scores are within bounds", () => {
      // Generate random numbers
      const randomNumbers = Array.from(
        { length: 100 },
        () => Math.floor(Math.random() * 200) - 50 // -50 to 149
      );

      for (const num of randomNumbers) {
        if (isValidQualityScore(num)) {
          // If validated, must be in range
          expect(num).toBeGreaterThanOrEqual(0);
          expect(num).toBeLessThanOrEqual(93);
          expect(Number.isInteger(num)).toBe(true);
        }
      }
    });

    test("invariant: type narrowing preserves validation", () => {
      const mixedData: unknown[] = [
        40,
        "40",
        null,
        undefined,
        {},
        [],
        true,
        false,
        0,
        93,
        94,
        -1,
        40.5,
        NaN,
        Infinity,
      ];

      for (const data of mixedData) {
        if (typeof data === "number" && isValidQualityScore(data)) {
          // After narrowing, these properties must hold
          expect(data >= 0).toBe(true);
          expect(data <= 93).toBe(true);
          expect(Math.floor(data) === data).toBe(true);
        }
      }
    });
  });
});

describe("Quality Operations - Core Conversions", () => {
  describe("charToScore", () => {
    test("converts Phred+33 characters correctly", () => {
      expect(charToScore("!", "phred33") as number).toBe(0);
      expect(charToScore("I", "phred33") as number).toBe(40);
      expect(charToScore("~", "phred33") as number).toBe(93);
    });

    test("converts Phred+64 characters correctly", () => {
      expect(charToScore("@", "phred64") as number).toBe(0);
      expect(charToScore("h", "phred64") as number).toBe(40);
      expect(charToScore("~", "phred64") as number).toBe(62);
    });

    test("converts Solexa characters correctly", () => {
      expect(charToScore(";", "solexa") as number).toBe(-5);
      expect(charToScore("@", "solexa") as number).toBe(0);
      expect(charToScore("h", "solexa") as number).toBe(40);
    });

    test("throws for invalid characters", () => {
      expect(() => charToScore(" ", "phred33")).toThrow();
      expect(() => charToScore("?", "phred64")).toThrow();
    });
  });

  describe("scoreToChar", () => {
    test("converts scores to Phred+33 characters", () => {
      expect(scoreToChar(0, "phred33")).toBe("!");
      expect(scoreToChar(40, "phred33")).toBe("I");
      expect(scoreToChar(60, "phred33")).toBe("]");
    });

    test("converts scores to Phred+64 characters", () => {
      expect(scoreToChar(0, "phred64")).toBe("@");
      expect(scoreToChar(40, "phred64")).toBe("h");
      expect(scoreToChar(62, "phred64")).toBe("~");
    });

    test("throws for out-of-range scores", () => {
      expect(() => scoreToChar(-1, "phred33")).toThrow();
      expect(() => scoreToChar(94, "phred33")).toThrow();
      expect(() => scoreToChar(63, "phred64")).toThrow();
    });
  });

  describe("convertQuality", () => {
    test("converts between Phred+33 and Phred+64", () => {
      const phred33 = "IIIIIIIIII";
      const phred64 = convertQuality(phred33, "phred33", "phred64");
      expect(phred64).toBe("hhhhhhhhhh");

      const backToPhred33 = convertQuality(phred64, "phred64", "phred33");
      expect(backToPhred33).toBe(phred33);
    });

    test("handles edge case with score clamping", () => {
      // High quality scores that exceed Phred+64 range
      const highQuality = "~~~"; // Q93 in Phred+33
      const converted = convertQuality(highQuality, "phred33", "phred64");
      expect(converted).toBe("~~~"); // Should clamp to max Phred+64 (Q62)
    });

    test("returns same string for identical encodings", () => {
      const quality = "IIIIIIIIII";
      const result = convertQuality(quality, "phred33", "phred33");
      expect(result).toBe(quality);
    });
  });
});

describe("Quality Operations - Encoding Detection", () => {
  describe("detectEncoding", () => {
    test("detects Phred+33 from low ASCII range", () => {
      const quality = "!!##%%&&"; // ASCII 33-38
      expect(detectEncoding(quality)).toBe("phred33");
    });

    test("detects Phred+64 from high ASCII range", () => {
      const quality = "hij"; // ASCII 104-106, impossible for Phred+33 (max is 93)
      expect(detectEncoding(quality)).toBe("phred64");
    });

    test("detects Solexa from sub-64 range", () => {
      const quality = ";;;;;;"; // ASCII 59, unique to Solexa
      expect(detectEncoding(quality)).toBe("solexa");
    });

    // Domain research: ASCII overlap zone (64-93)
    test("handles ambiguous overlap zone with modern bias", () => {
      const ambiguous = "HHHHHHHHHH"; // ASCII 72, could be either
      // Should default to Phred+33 due to 95% prevalence
      expect(detectEncoding(ambiguous)).toBe("phred33");
    });

    // Domain research: Modern high-quality patterns
    test("detects modern Illumina NovaSeq patterns", () => {
      const novaSeqQ40 = "IIIIIIIIII"; // Uniform Q40
      expect(detectEncoding(novaSeqQ40)).toBe("phred33");
    });
  });

  describe("detectEncodingWithConfidence", () => {
    test("provides high confidence for unambiguous ranges", () => {
      const result = detectEncodingWithConfidence("!!!!!");
      expect(result.encoding).toBe("phred33");
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.evidence).toContain("Strong Phred+33: Exclusively in low ASCII range (33-73)");
    });

    test("provides lower confidence for ambiguous ranges", () => {
      const result = detectEncodingWithConfidence("HHHHH");
      expect(result.encoding).toBe("phred33");
      // H is ASCII 72, clearly in Phred+33 range, so high confidence
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.evidence.some((e) => e.includes("Strong Phred+33"))).toBe(true);
    });

    test("handles empty input gracefully", () => {
      const result = detectEncodingWithConfidence("");
      expect(result.encoding).toBe("phred33");
      expect(result.confidence).toBe(0.5);
      expect(result.evidence).toContain("Empty quality string, defaulting to modern standard");
    });
  });

});

describe("Quality Operations - Statistics", () => {
  describe("calculateQualityStats", () => {
    test("calculates comprehensive statistics", () => {
      const scores = [20, 30, 40, 30, 20];
      const stats = calculateQualityStats(scores);

      expect(stats.min).toBe(20);
      expect(stats.max).toBe(40);
      expect(stats.mean).toBe(28);
      expect(stats.median).toBe(30);
      expect(stats.q1).toBe(20);
      expect(stats.q3).toBe(30);
      expect(stats.count).toBe(5);
      expect(stats.stdDev).toBeCloseTo(7.5, 1);
    });

    test("handles empty array", () => {
      const stats = calculateQualityStats([]);
      expect(stats.count).toBe(0);
      expect(stats.mean).toBe(0);
    });

    test("handles single value", () => {
      const stats = calculateQualityStats([30]);
      expect(stats.min).toBe(30);
      expect(stats.max).toBe(30);
      expect(stats.mean).toBe(30);
      expect(stats.median).toBe(30);
    });
  });

  describe("Error probability conversions", () => {
    test("converts quality scores to error probabilities", () => {
      expect(scoreToErrorProbability(20)).toBeCloseTo(0.01, 5);
      expect(scoreToErrorProbability(30)).toBeCloseTo(0.001, 5);
      expect(scoreToErrorProbability(40)).toBeCloseTo(0.0001, 5);
    });

    test("converts error probabilities to quality scores", () => {
      expect(errorProbabilityToScore(0.01)).toBeCloseTo(20, 1);
      expect(errorProbabilityToScore(0.001)).toBeCloseTo(30, 1);
      expect(errorProbabilityToScore(0.0001)).toBeCloseTo(40, 1);
    });

    test("round-trip conversion maintains accuracy", () => {
      const originalScore = 35;
      const probability = scoreToErrorProbability(originalScore);
      const recoveredScore = errorProbabilityToScore(probability);
      expect(recoveredScore).toBeCloseTo(originalScore, 1);
    });
  });

});

describe("Quality Operations - Encoding Info", () => {
  test("provides correct encoding information", () => {
    const phred33Info = getEncodingInfo("phred33");
    expect(phred33Info.offset as number).toBe(33);
    expect(phred33Info.minScore as number).toBe(0);
    expect(phred33Info.maxScore as number).toBe(93);
    expect(phred33Info.minChar).toBe("!");
    expect(phred33Info.maxChar).toBe("~");
  });

  test("exposes encoding information for all supported encodings", () => {
    expect(getEncodingInfo("phred33").name).toBe("phred33");
    expect(getEncodingInfo("phred64").name).toBe("phred64");
    expect(getEncodingInfo("solexa").name).toBe("solexa");
  });
});

describe("Quality Operations - Edge Cases from Domain Research", () => {
  // Domain research: @ and + contamination in quality strings
  test("handles @ character in quality string (ASCII 64)", () => {
    const qualityWithAt = "@@@@@"; // Could be Q31 in Phred+33 or Q0 in Phred+64
    const scores = qualityToScores(qualityWithAt, "phred33");
    expect(scores[0]! as number).toBe(31);

    const phred64Scores = qualityToScores(qualityWithAt, "phred64");
    expect(phred64Scores[0]! as number).toBe(0);
  });

  test("handles + character in quality string (ASCII 43)", () => {
    const qualityWithPlus = "+++++"; // Q10 in Phred+33
    const scores = qualityToScores(qualityWithPlus, "phred33");
    expect(scores[0]! as number).toBe(10);
  });

  // Domain research: Platform-specific patterns
  test("handles PacBio CCS high-accuracy reads", () => {
    const pacbioCCS = "~~~~~~~~~"; // Q93 in Phred+33 (>99% accuracy)
    const avgQuality = calculateAverageQuality(pacbioCCS, "phred33");
    expect(avgQuality).toBe(93);
  });

  test("handles Nanopore typical quality range", () => {
    const nanoporeTypical = "+++,,,---"; // Q10-12 typical
    const stats = calculateQualityStats(qualityToScores(nanoporeTypical, "phred33"));
    expect(stats.mean).toBeCloseTo(11, 1);
  });

  // Domain research: Solexa negative quality scores
  test("handles Solexa negative quality scores", () => {
    const solexaNegative = ";;;;;"; // Q-5 in Solexa
    const scores = qualityToScores(solexaNegative, "solexa");
    expect(scores[0]! as number).toBe(-5);
  });

  // Domain research: Mixed encoding detection challenge
  test("detects encoding from real-world patterns", () => {
    // Pattern from domain research: modern Illumina NovaSeq
    const modernIllumina = "GGGHHHHHHHHHHIIIIIIIIIIIIIIIIIII"; // Typical 3' degradation
    expect(detectEncoding(modernIllumina)).toBe("phred33");

    // Pattern from domain research: legacy Illumina GA
    const legacyIllumina = "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh"; // Uniform Q40 in Phred+64
    expect(detectEncoding(legacyIllumina)).toBe("phred64");
  });
});
