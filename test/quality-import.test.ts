#!/usr/bin/env bun
/**
 * Test file to verify both import patterns work correctly for QualityEncodingDetector
 *
 * This test verifies that the dual-export pattern provides:
 * 1. Individual function imports (tree-shakeable)
 * 2. Grouped object import for convenience
 */

import { expect, test } from "bun:test";
// Test pattern 1: Import individual functions (tree-shakeable)
// Test pattern 2: Import the grouped object
import {
  averageQuality,
  charToScore,
  convertScore,
  detectEncoding,
  errorProbabilityToScore,
  getEncodingRange,
  QualityEncoding,
  QualityEncodingDetector,
  scoreToChar,
  scoreToErrorProbability,
  validateQualityString,
} from "../src/operations/core/encoding";
import type { FastqSequence } from "../src/types";

// Helper function to create test sequences
async function* createTestSequences(): AsyncIterable<FastqSequence> {
  const sequences: FastqSequence[] = [
    {
      id: "seq1",
      sequence: "ATCG",
      quality: "IIII", // Phred+33 (ASCII 73)
      format: "fastq",
      qualityEncoding: "phred33" as const,
      length: 4,
    },
    {
      id: "seq2",
      sequence: "GCTA",
      quality: "!!!!", // Phred+33 (ASCII 33 - lowest quality)
      format: "fastq",
      qualityEncoding: "phred33" as const,
      length: 4,
    },
  ];

  for (const seq of sequences) {
    yield seq;
  }
}

test("Individual function imports work correctly", async () => {
  // Test detectEncoding
  const encoding = await detectEncoding(createTestSequences());
  expect(encoding).toBe("phred33");

  // Test convertScore
  const quality = "IIII";
  const converted = convertScore(quality, "phred33", "phred33");
  expect(converted).toBe(quality);

  // Test averageQuality
  const avg = averageQuality("IIII", "phred33");
  expect(avg).toBe(40); // ASCII 73 - 33 = 40

  // Test scoreToChar
  const char = scoreToChar(40, "phred33");
  expect(char).toBe("I"); // 40 + 33 = 73 = 'I'

  // Test charToScore
  const score = charToScore("I", "phred33");
  expect(score).toBe(40);

  // Test validateQualityString
  const isValid = validateQualityString("IIII", "phred33");
  expect(isValid).toBe(true);

  // Test getEncodingRange
  const range = getEncodingRange("phred33");
  expect(range.min).toBe(33);
  expect(range.max).toBe(126);
  expect(range.offset).toBe(33);

  // Test scoreToErrorProbability
  const errorProb = scoreToErrorProbability(40);
  expect(errorProb).toBeCloseTo(0.0001, 6);

  // Test errorProbabilityToScore
  const qualScore = errorProbabilityToScore(0.0001);
  expect(qualScore).toBeCloseTo(40, 1);

  console.log("✅ Individual function imports work correctly");
});

test("Grouped object import works correctly", async () => {
  // Test detect/detectEncoding
  const encoding = await QualityEncodingDetector.detect(createTestSequences());
  expect(encoding).toBe("phred33");

  // Test convertScore
  const quality = "IIII";
  const converted = QualityEncodingDetector.convertScore(quality, "phred33", "phred33");
  expect(converted).toBe(quality);

  // Test averageQuality
  const avg = QualityEncodingDetector.averageQuality("IIII", "phred33");
  expect(avg).toBe(40);

  // Test scoreToChar
  const char = QualityEncodingDetector.scoreToChar(40, "phred33");
  expect(char).toBe("I");

  // Test charToScore
  const score = QualityEncodingDetector.charToScore("I", "phred33");
  expect(score).toBe(40);

  // Test validateQualityString
  const isValid = QualityEncodingDetector.validateQualityString("IIII", "phred33");
  expect(isValid).toBe(true);

  // Test getEncodingRange
  const range = QualityEncodingDetector.getEncodingRange("phred33");
  expect(range.min).toBe(33);
  expect(range.max).toBe(126);

  // Test scoreToErrorProbability
  const errorProb = QualityEncodingDetector.scoreToErrorProbability(40);
  expect(errorProb).toBeCloseTo(0.0001, 6);

  // Test errorProbabilityToScore
  const qualScore = QualityEncodingDetector.errorProbabilityToScore(0.0001);
  expect(qualScore).toBeCloseTo(40, 1);

  console.log("✅ Grouped object import works correctly");
});

test("Both import patterns produce identical results", async () => {
  const testQualities = ["IIII", "!!!!", "~~~~", "ABCD", "@@@@@"];

  for (const quality of testQualities) {
    // Verify averageQuality
    expect(averageQuality(quality, "phred33")).toBe(
      QualityEncodingDetector.averageQuality(quality, "phred33"),
    );

    // Verify validateQualityString
    expect(validateQualityString(quality, "phred33")).toBe(
      QualityEncodingDetector.validateQualityString(quality, "phred33"),
    );
  }

  // Test score conversions
  for (let score = 0; score <= 40; score += 10) {
    // Verify scoreToChar
    expect(scoreToChar(score, "phred33")).toBe(
      QualityEncodingDetector.scoreToChar(score, "phred33"),
    );

    // Verify scoreToErrorProbability
    expect(scoreToErrorProbability(score)).toBe(
      QualityEncodingDetector.scoreToErrorProbability(score),
    );
  }

  console.log("✅ Both import patterns produce identical results");
});

test("Tree-shaking benefit demonstration", () => {
  // When importing individual functions, only those specific functions
  // are included in the bundle (when using a bundler that supports tree-shaking)

  // This test just verifies the imports are available
  expect(typeof detectEncoding).toBe("function");
  expect(typeof convertScore).toBe("function");
  expect(typeof averageQuality).toBe("function");
  expect(typeof scoreToChar).toBe("function");
  expect(typeof charToScore).toBe("function");

  console.log("✅ Individual functions are importable for tree-shaking");
});

test("Grouped object has all expected methods", () => {
  const expectedMethods = [
    "detect",
    "detectEncoding",
    "convertScore",
    "averageQuality",
    "scoreToChar",
    "charToScore",
    "validateQualityString",
    "getEncodingRange",
    "scoreToErrorProbability",
    "errorProbabilityToScore",
  ];

  for (const method of expectedMethods) {
    expect(typeof QualityEncodingDetector[method]).toBe("function");
  }

  console.log("✅ Grouped object has all expected methods");
});

test("Conversion between encodings works correctly", () => {
  // Test Phred33 to Phred64 conversion
  const phred33Quality = "IIII"; // ASCII 73
  const phred64Quality = convertScore(phred33Quality, "phred33", "phred64");
  expect(phred64Quality).toBe("hhhh"); // ASCII 104 (73 + 31)

  // Test round-trip conversion
  const backToPhred33 = convertScore(phred64Quality, "phred64", "phred33");
  expect(backToPhred33).toBe(phred33Quality);

  console.log("✅ Quality score conversion works correctly");
});

// Demonstrate usage patterns for documentation
console.log("\n=== USAGE PATTERNS ===\n");

console.log("Pattern 1: Import individual functions (best for tree-shaking):");
console.log(`
import { detectEncoding, averageQuality } from './quality';

const encoding = await detectEncoding(sequences);
const avg = averageQuality(quality, encoding);
`);

console.log("Pattern 2: Import grouped object (best for convenience):");
console.log(`
import { QualityEncodingDetector } from './quality';

const encoding = await QualityEncodingDetector.detect(sequences);
const avg = QualityEncodingDetector.averageQuality(quality, encoding);
`);

console.log("Pattern 3: Import both for maximum flexibility:");
console.log(`
import { detectEncoding, QualityEncodingDetector } from './quality';

// Use individual function for single operation
const encoding = await detectEncoding(sequences);

// Use grouped object when performing multiple operations
const avg = QualityEncodingDetector.averageQuality(quality, encoding);
const char = QualityEncodingDetector.scoreToChar(40, encoding);
`);
