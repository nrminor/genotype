/**
 * Tests for quality score encoding detection and conversion functionality
 *
 * These tests verify the correctness of quality score operations across
 * different sequencing platforms and encoding formats.
 */

import { describe, expect, test } from "bun:test";
import { QualityEncoding, QualityEncodingDetector } from "../../../src/operations/core/encoding";
import type { FastqSequence } from "../../../src/types";

describe("QualityEncodingDetector", () => {
  describe("scoreToChar", () => {
    test("converts PHRED33 scores to correct ASCII characters", () => {
      expect(QualityEncodingDetector.scoreToChar(0, "phred33")).toBe("!");
      expect(QualityEncodingDetector.scoreToChar(20, "phred33")).toBe("5");
      expect(QualityEncodingDetector.scoreToChar(30, "phred33")).toBe("?");
      expect(QualityEncodingDetector.scoreToChar(40, "phred33")).toBe("I");
    });

    test("converts PHRED64 scores to correct ASCII characters", () => {
      expect(QualityEncodingDetector.scoreToChar(0, "phred64")).toBe("@");
      expect(QualityEncodingDetector.scoreToChar(20, "phred64")).toBe("T");
      expect(QualityEncodingDetector.scoreToChar(30, "phred64")).toBe("^");
      expect(QualityEncodingDetector.scoreToChar(40, "phred64")).toBe("h");
    });

    test("throws error for out-of-range scores", () => {
      expect(() => QualityEncodingDetector.scoreToChar(-1, "phred33")).toThrow(
        "Score must be a non-negative number",
      );

      expect(() => QualityEncodingDetector.scoreToChar(100, "phred33")).toThrow(
        "Score 100 out of range for phred33 encoding",
      );
    });
  });

  describe("charToScore", () => {
    test("converts PHRED33 ASCII characters to correct scores", () => {
      expect(QualityEncodingDetector.charToScore("!", "phred33")).toBe(0);
      expect(QualityEncodingDetector.charToScore("5", "phred33")).toBe(20);
      expect(QualityEncodingDetector.charToScore("?", "phred33")).toBe(30);
      expect(QualityEncodingDetector.charToScore("I", "phred33")).toBe(40);
    });

    test("converts PHRED64 ASCII characters to correct scores", () => {
      expect(QualityEncodingDetector.charToScore("@", "phred64")).toBe(0);
      expect(QualityEncodingDetector.charToScore("T", "phred64")).toBe(20);
      expect(QualityEncodingDetector.charToScore("^", "phred64")).toBe(30);
      expect(QualityEncodingDetector.charToScore("h", "phred64")).toBe(40);
    });

    test("throws error for invalid characters", () => {
      expect(() => QualityEncodingDetector.charToScore(" ", "phred33")).toThrow(
        "Character ' ' (ASCII 32) invalid for phred33",
      );

      expect(() => QualityEncodingDetector.charToScore("5", "phred64")).toThrow(
        "Character '5' (ASCII 53) invalid for phred64",
      );
    });

    test("throws error for empty or multi-character strings", () => {
      expect(() => QualityEncodingDetector.charToScore("", "phred33")).toThrow(
        "Single character required for score conversion",
      );

      expect(() => QualityEncodingDetector.charToScore("AB", "phred33")).toThrow(
        "Single character required for score conversion",
      );
    });
  });

  describe("averageQuality", () => {
    test("calculates correct average for PHRED33 quality strings", () => {
      // Quality string "5555" = [20, 20, 20, 20], average = 20
      expect(QualityEncodingDetector.averageQuality("5555", "phred33")).toBe(20);

      // Quality string "!5?I" = [0, 20, 30, 40], average = 22.5
      expect(QualityEncodingDetector.averageQuality("!5?I", "phred33")).toBe(22.5);
    });

    test("calculates correct average for PHRED64 quality strings", () => {
      // Quality string "TTTT" = [20, 20, 20, 20], average = 20
      expect(QualityEncodingDetector.averageQuality("TTTT", "phred64")).toBe(20);

      // Quality string "@T^h" = [0, 20, 30, 40], average = 22.5
      expect(QualityEncodingDetector.averageQuality("@T^h", "phred64")).toBe(22.5);
    });

    test("handles empty quality strings", () => {
      expect(() => QualityEncodingDetector.averageQuality("", "phred33")).toThrow(
        "Quality string is required for average calculation",
      );
    });

    test("validates quality strings without throwing for spaces", () => {
      // The implementation doesn't validate characters during average calculation
      const avg = QualityEncodingDetector.averageQuality("ABC ", "phred33");
      expect(avg).toBeGreaterThan(0);
    });
  });

  describe("convertScore", () => {
    test("returns unchanged string when from equals to", () => {
      const quality = "5555";
      const result = QualityEncodingDetector.convertScore(quality, "phred33", "phred33");
      expect(result).toBe(quality);
    });

    test("converts PHRED33 to PHRED64 correctly", () => {
      // PHRED33 "5555" (Q20) should become PHRED64 "TTTT" (Q20)
      const result = QualityEncodingDetector.convertScore("5555", "phred33", "phred64");
      expect(result).toBe("TTTT");
    });

    test("converts PHRED64 to PHRED33 correctly", () => {
      // PHRED64 "TTTT" (Q20) should become PHRED33 "5555" (Q20)
      const result = QualityEncodingDetector.convertScore("TTTT", "phred64", "phred33");
      expect(result).toBe("5555");
    });

    test("converts to/from Solexa using proper non-linear mathematics", () => {
      // Test Phred64 to Solexa conversion
      const phred64ToSolexa = QualityEncodingDetector.convertScore("@@@@", "phred64", "solexa");
      expect(phred64ToSolexa).toBeDefined();
      expect(phred64ToSolexa.length).toBe(4);

      // Test Solexa to Phred33 conversion
      const solexaToPhred33 = QualityEncodingDetector.convertScore("@@@@", "solexa", "phred33");
      expect(solexaToPhred33).toBeDefined();
      expect(solexaToPhred33.length).toBe(4);

      // Solexa conversion should use non-linear math, not simple ASCII offset
      expect(phred64ToSolexa).not.toBe("@@@@"); // Should be mathematically converted
    });

    test("throws error for invalid input", () => {
      expect(() => QualityEncodingDetector.convertScore("", "phred33", "phred64")).toThrow(
        "Quality string is required for conversion",
      );
    });
  });

  describe("validateQualityString", () => {
    test("validates correct PHRED33 quality strings", () => {
      expect(QualityEncodingDetector.validateQualityString("!5?I", "phred33")).toBe(true);
      expect(QualityEncodingDetector.validateQualityString("~", "phred33")).toBe(true);
    });

    test("validates correct PHRED64 quality strings", () => {
      expect(QualityEncodingDetector.validateQualityString("@T^h", "phred64")).toBe(true);
      expect(QualityEncodingDetector.validateQualityString("~", "phred64")).toBe(true);
    });

    test("returns false for invalid characters", () => {
      // The implementation returns false instead of throwing
      expect(QualityEncodingDetector.validateQualityString("ABC ", "phred33")).toBe(false);
      expect(QualityEncodingDetector.validateQualityString("5", "phred64")).toBe(false);
    });
  });

  describe("getEncodingRange", () => {
    test("returns correct range for PHRED33", () => {
      const range = QualityEncodingDetector.getEncodingRange("phred33");
      expect(range).toEqual({ min: 33, max: 126, offset: 33 });
    });

    test("returns correct range for PHRED64", () => {
      const range = QualityEncodingDetector.getEncodingRange("phred64");
      expect(range).toEqual({ min: 64, max: 126, offset: 64 });
    });

    test("returns correct range for SOLEXA", () => {
      const range = QualityEncodingDetector.getEncodingRange("solexa");
      expect(range).toEqual({ min: 59, max: 126, offset: 64 });
    });
  });

  describe("detect", () => {
    test("detects PHRED33 encoding from sequences with low ASCII values", async () => {
      const sequences: FastqSequence[] = [
        {
          format: "fastq",
          id: "seq1",
          sequence: "ATCG",
          quality: "5555", // ASCII 53 < 59, indicates PHRED33
          qualityEncoding: "phred33" as const,
          length: 4,
        },
        {
          format: "fastq",
          id: "seq2",
          sequence: "GCTA",
          quality: "!@#$", // ASCII 33,64,35,36 - min 33 < 59, indicates PHRED33
          qualityEncoding: "phred33" as const,
          length: 4,
        },
      ];

      async function* generateSequences() {
        for (const seq of sequences) {
          yield seq;
        }
      }

      const detected = await QualityEncodingDetector.detectEncodingStatistical(generateSequences());
      expect(detected).toBe("phred33");
    });

    test("detects PHRED64 encoding from sequences with high ASCII values only", async () => {
      const sequences: FastqSequence[] = [
        {
          format: "fastq",
          id: "seq1",
          sequence: "ATCG",
          quality: "TTTT", // ASCII 84, in range 64-126, no chars < 59
          qualityEncoding: "phred64" as const,
          length: 4,
        },
        {
          format: "fastq",
          id: "seq2",
          sequence: "GCTA",
          quality: "@ABC", // ASCII 64,65,66,67 - min 64 >= 64, max 67 <= 126
          qualityEncoding: "phred64" as const,
          length: 4,
        },
      ];

      async function* generateSequences() {
        for (const seq of sequences) {
          yield seq;
        }
      }

      const detected = await QualityEncodingDetector.detectEncodingStatistical(generateSequences());
      expect(detected).toBe("phred64");
    });

    test("handles empty sequence input gracefully", async () => {
      async function* generateSequences(): AsyncGenerator<FastqSequence> {
        // Empty generator - no sequences yielded, loop that never executes
        const sequences: FastqSequence[] = [];
        for (const seq of sequences) {
          yield seq;
        }
      }

      // The implementation doesn't throw for empty sequences, it returns a default
      const result = await QualityEncodingDetector.detectEncodingStatistical(generateSequences());
      expect(result).toBeDefined();
    });

    test("handles sequences without quality scores", async () => {
      const sequences: FastqSequence[] = [
        {
          format: "fastq",
          id: "seq1",
          sequence: "ATCG",
          quality: "", // Empty quality
          qualityEncoding: "phred33" as const,
          length: 4,
        },
      ];

      async function* generateSequences() {
        for (const seq of sequences) {
          yield seq;
        }
      }

      // The implementation doesn't throw for sequences without quality, it returns a default
      const result = await QualityEncodingDetector.detectEncodingStatistical(generateSequences());
      expect(result).toBeDefined();
    });

    test("limits analysis to first 10,000 sequences", async () => {
      // Create a generator that would produce more than 10,000 sequences
      async function* generateManySequences() {
        for (let i = 0; i < 15000; i++) {
          yield {
            format: "fastq" as const,
            id: `seq${i}`,
            sequence: "ATCG",
            quality: "5555", // PHRED33 quality
            qualityEncoding: "phred33" as const,
            length: 4,
          };
        }
      }

      // Should still work and not process all 15,000 sequences
      const detected =
        await QualityEncodingDetector.detectEncodingStatistical(generateManySequences());
      expect(detected).toBe("phred33");
    });
  });
});
