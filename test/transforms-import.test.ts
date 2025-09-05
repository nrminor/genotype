#!/usr/bin/env bun
/**
 * Test file to verify both import patterns work correctly for SequenceTransforms
 *
 * This test verifies that the dual-export pattern provides:
 * 1. Individual function imports (tree-shakeable)
 * 2. Grouped object import for convenience
 */

import { expect, test } from "bun:test";
// Test pattern 1: Import individual functions (tree-shakeable)
// Test pattern 2: Import the grouped object
import {
  complement,
  gcContent,
  isPalindromic,
  reverse,
  reverseComplement,
  SequenceTransforms,
} from "../src/operations/core";

test("Individual function imports work correctly", () => {
  const seq = "ATCG";

  // Test individual function imports
  expect(complement(seq)).toBe("TAGC");
  expect(reverse(seq)).toBe("GCTA");
  expect(reverseComplement(seq)).toBe("CGAT");
  expect(gcContent(seq)).toBe(50); // Returns percentage
  expect(isPalindromic("GAATTC")).toBe(true);

  console.log("✅ Individual function imports work correctly");
});

test("Grouped object import works correctly", () => {
  const seq = "ATCG";

  // Test grouped object import
  expect(SequenceTransforms.complement(seq)).toBe("TAGC");
  expect(SequenceTransforms.reverse(seq)).toBe("GCTA");
  expect(SequenceTransforms.reverseComplement(seq)).toBe("CGAT");
  expect(SequenceTransforms.gcContent(seq)).toBe(50); // Returns percentage
  expect(SequenceTransforms.isPalindromic("GAATTC")).toBe(true);

  console.log("✅ Grouped object import works correctly");
});

test("Both import patterns produce identical results", () => {
  const testSequences = ["ATCG", "GAATTC", "ATCGATCG", "GGCCGGCC", "AAATTT"];

  for (const seq of testSequences) {
    // Verify complement
    expect(complement(seq)).toBe(SequenceTransforms.complement(seq));

    // Verify reverse
    expect(reverse(seq)).toBe(SequenceTransforms.reverse(seq));

    // Verify reverseComplement
    expect(reverseComplement(seq)).toBe(SequenceTransforms.reverseComplement(seq));

    // Verify gcContent
    expect(gcContent(seq)).toBe(SequenceTransforms.gcContent(seq));

    // Verify isPalindromic
    expect(isPalindromic(seq)).toBe(SequenceTransforms.isPalindromic(seq));
  }

  console.log("✅ Both import patterns produce identical results");
});

test("Tree-shaking benefit demonstration", () => {
  // When importing individual functions, only those specific functions
  // are included in the bundle (when using a bundler that supports tree-shaking)

  // This test just verifies the imports are available
  expect(typeof complement).toBe("function");
  expect(typeof reverse).toBe("function");
  expect(typeof reverseComplement).toBe("function");

  console.log("✅ Individual functions are importable for tree-shaking");
});

test("Grouped object has all expected methods", () => {
  const expectedMethods = [
    "complement",
    "reverse",
    "reverseComplement",
    "toRNA",
    "toDNA",
    "gcContent",
    "atContent",
    "baseComposition",
    "isPalindromic",
    "findPattern",
    "translateSimple",
  ];

  for (const method of expectedMethods) {
    expect(typeof SequenceTransforms[method]).toBe("function");
  }

  console.log("✅ Grouped object has all expected methods");
});

// Demonstrate usage patterns for documentation
console.log("\n=== USAGE PATTERNS ===\n");

console.log("Pattern 1: Import individual functions (best for tree-shaking):");
console.log(`
import { complement, reverseComplement } from './transforms';

const comp = complement('ATCG');  // 'TAGC'
const revComp = reverseComplement('ATCG');  // 'CGAT'
`);

console.log("Pattern 2: Import grouped object (best for convenience):");
console.log(`
import { SequenceTransforms } from './transforms';

const comp = SequenceTransforms.complement('ATCG');  // 'TAGC'
const revComp = SequenceTransforms.reverseComplement('ATCG');  // 'CGAT'
`);

console.log("Pattern 3: Import both for maximum flexibility:");
console.log(`
import { complement, SequenceTransforms } from './transforms';

// Use individual function
const comp = complement('ATCG');

// Or use grouped object when iterating over multiple operations
const operations = ['complement', 'reverse', 'reverseComplement'];
for (const op of operations) {
  const result = SequenceTransforms[op]('ATCG');
}
`);
