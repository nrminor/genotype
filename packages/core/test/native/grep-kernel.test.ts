import { describe, expect } from "bun:test";
import { createFastaRecord } from "@genotype/core/constructors";
import { packSequences } from "@genotype/core/backend/batch";
import { hasPatternWithMismatches } from "@genotype/core/operations/core/pattern-matching";
import type { AbstractSequence } from "@genotype/core/types";
import { describeNative, requireNativeKernel, testNative } from "./harness";

function makeSequences(...seqStrings: string[]): AbstractSequence[] {
  return seqStrings.map((s, i) => createFastaRecord({ id: `seq${i}`, sequence: s }));
}

/**
 * Call grepBatch on an array of sequence strings, returning the raw
 * result buffer. Handles packing internally so tests stay readable.
 */
function grepBatchFromStrings(
  seqStrings: string[],
  pattern: string,
  maxEdits: number,
  caseInsensitive: boolean,
  searchBothStrands: boolean
): Buffer {
  const kernel = requireNativeKernel();
  const seqs = makeSequences(...seqStrings);
  const { data, offsets } = packSequences(seqs);
  return kernel.grepBatch(
    data,
    offsets,
    Buffer.from(pattern),
    maxEdits,
    caseInsensitive,
    searchBothStrands
  );
}

/**
 * Run the TypeScript fallback on a single sequence and return whether
 * it matched. Used for parity comparisons against the native kernel.
 */
function tsFallbackMatch(
  sequence: string,
  pattern: string,
  maxMismatches: number,
  ignoreCase: boolean,
  searchBothStrands: boolean
): boolean {
  const searchTarget = ignoreCase ? sequence.toLowerCase() : sequence;
  const searchPattern = ignoreCase ? pattern.toLowerCase() : pattern;
  return hasPatternWithMismatches(searchTarget, searchPattern, maxMismatches, searchBothStrands);
}

describeNative("grep native kernel (requires just build-native-dev)", () => {
  describe("raw FFI contract", () => {
    testNative("exact match returns correct results", () => {
      const results = grepBatchFromStrings(
        ["ATCGATCG", "GGGGGGGG", "XXGATCXX"],
        "GATC",
        0,
        false,
        false
      );
      expect([...results]).toEqual([1, 0, 1]);
    });

    testNative("approximate match with edit distance", () => {
      const results = grepBatchFromStrings(["ATCGTTCG", "TTTTTTTT"], "GATC", 1, false, false);
      expect([...results]).toEqual([1, 0]);
    });

    testNative("case-insensitive match", () => {
      const results = grepBatchFromStrings(["atcgatcg", "ATCGATCG"], "GATC", 0, true, false);
      expect([...results]).toEqual([1, 1]);
    });

    testNative("reverse complement match", () => {
      const results = grepBatchFromStrings(["CGATAAAA", "TTTTTTTT"], "ATCG", 0, false, true);
      expect([...results]).toEqual([1, 0]);
    });

    testNative("empty batch returns empty buffer", () => {
      const kernel = requireNativeKernel();
      const results = kernel.grepBatch(
        Buffer.alloc(0),
        new Uint32Array([0]),
        Buffer.from("GATC"),
        0,
        false,
        false
      );
      expect(results.length).toBe(0);
    });

    testNative("output length equals number of sequences", () => {
      const results = grepBatchFromStrings(["AA", "CC", "GG", "TT", "NN"], "X", 0, false, false);
      expect(results.length).toBe(5);
    });

    testNative("every output byte is 0 or 1", () => {
      const results = grepBatchFromStrings(
        ["ATCGATCG", "GGGGGGGG", "ATCG", ""],
        "ATCG",
        0,
        false,
        false
      );
      for (const byte of results) {
        expect(byte === 0 || byte === 1).toBe(true);
      }
    });

    testNative("throws on malformed offsets: out of bounds", () => {
      const kernel = requireNativeKernel();
      expect(() => {
        kernel.grepBatch(
          Buffer.from("ATCG"),
          new Uint32Array([0, 100]),
          Buffer.from("A"),
          0,
          false,
          false
        );
      }).toThrow(/final offset/);
    });

    testNative("throws on malformed offsets: non-monotonic", () => {
      const kernel = requireNativeKernel();
      expect(() => {
        kernel.grepBatch(
          Buffer.from("ATCGATCG"),
          new Uint32Array([0, 4, 2, 8]),
          Buffer.from("A"),
          0,
          false,
          false
        );
      }).toThrow(/non-monotonic/);
    });
  });

  describe("parity with TypeScript fallback", () => {
    // Parity tests use uppercase-only sequences to avoid the known
    // divergence where the Iupac profile (used for bothStrands) is
    // inherently case-insensitive while the TS fallback is case-sensitive
    // when ignoreCase=false. See the divergence suite below.
    const sequences = ["AAATCGATCGAAA", "GGGGGGGGGGGG", "AAACGATAAAA", ""];

    const parityMatrix: {
      label: string;
      ignoreCase: boolean;
      allowMismatches: number;
      searchBothStrands: boolean;
    }[] = [];

    for (const ignoreCase of [false, true]) {
      for (const allowMismatches of [0]) {
        for (const searchBothStrands of [false, true]) {
          parityMatrix.push({
            label: `ignoreCase=${ignoreCase} mismatches=${allowMismatches} bothStrands=${searchBothStrands}`,
            ignoreCase,
            allowMismatches,
            searchBothStrands,
          });
        }
      }
    }

    for (const { label, ignoreCase, allowMismatches, searchBothStrands } of parityMatrix) {
      testNative(`parity (exact): ${label}`, () => {
        const pattern = "ATCG";
        const nativeResults = grepBatchFromStrings(
          sequences,
          pattern,
          allowMismatches,
          ignoreCase,
          searchBothStrands
        );

        for (let i = 0; i < sequences.length; i++) {
          const tsResult = tsFallbackMatch(
            sequences[i]!,
            pattern,
            allowMismatches,
            ignoreCase,
            searchBothStrands
          );
          const nativeResult = nativeResults[i] === 1;
          expect(nativeResult).toBe(tsResult);
        }
      });
    }
  });

  describe("known parity divergence", () => {
    // These tests document cases where the native kernel and the
    // TypeScript fallback produce different results. Each test asserts
    // the current (divergent) behavior of both implementations. When
    // the implementations are brought into alignment in the future,
    // these tests will fail, signaling that they can be moved to the
    // parity suite above.

    testNative(
      "Iupac profile is case-insensitive even when ignoreCase=false with bothStrands",
      () => {
        // The native kernel uses the Iupac profile for bothStrands mode,
        // which strips the case bit (& 0x1F) during encoding. This means
        // it matches lowercase sequences even when ignoreCase=false.
        // The TS fallback is case-sensitive in this configuration.
        const nativeResults = grepBatchFromStrings(["aaatcgatcgaaa"], "ATCG", 0, false, true);
        const tsResult = tsFallbackMatch("aaatcgatcgaaa", "ATCG", 0, false, true);

        expect(nativeResults[0]).toBe(1); // native matches (Iupac is case-insensitive)
        expect(tsResult).toBe(false); // TS does not match (case-sensitive)
      }
    );

    testNative("edit distance finds deletion that Hamming distance cannot", () => {
      // Pattern "GATC" vs sequence containing "GTC" — one deletion.
      // Edit distance = 1, but Hamming distance compares fixed-length
      // windows so it sees "XGTC" vs "GATC" = 3 mismatches.
      // Use a sequence where no Hamming window matches within 1 mismatch.
      const nativeResults = grepBatchFromStrings(["TTGTCTT"], "GATC", 1, false, false);
      const tsResult = tsFallbackMatch("TTGTCTT", "GATC", 1, false, false);

      expect(nativeResults[0]).toBe(1); // native finds deletion match
      expect(tsResult).toBe(false); // TS sliding window doesn't
    });
  });
});
