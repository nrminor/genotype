/**
 * Integration tests for the improved SequenceMatcher API
 *
 * Tests streaming capabilities, rich match objects, and various algorithms
 */

import { describe, expect, test } from "bun:test";
import {
  findPattern,
  hasPattern,
  SequenceMatcher,
} from "../../../src/operations/core/pattern-matching";
import type { Sequence } from "../../../src/types";

describe("SequenceMatcher", () => {
  // Test data
  const sequences: Sequence[] = [
    { id: "seq1", sequence: "ATCGATCGATCGATCG", type: "dna" },
    { id: "seq2", sequence: "GCGCGCGCATCGATCG", type: "dna" },
    { id: "seq3", sequence: "NNNNNATCGNNNNNNN", type: "dna" }, // With N's
    { id: "seq4", sequence: "atcgatcgatcgatcg", type: "dna" }, // Lowercase
  ];

  async function* createAsyncSequences(): AsyncGenerator<Sequence> {
    for (const seq of sequences) {
      yield seq;
    }
  }

  describe("Basic Pattern Matching", () => {
    test("finds exact matches with Boyer-Moore", () => {
      const matcher = new SequenceMatcher("ATCG");
      const matches = matcher.findInSequence(sequences[0]);

      expect(matches).toHaveLength(4);
      expect(matches[0]).toMatchObject({
        position: 0,
        length: 4,
        matched: "ATCG",
        pattern: "ATCG",
        mismatches: 0,
        sequenceId: "seq1",
        score: 1.0,
      });
    });

    test("includes context in match results", () => {
      const matcher = new SequenceMatcher("ATCG", { contextWindow: 5 });
      const matches = matcher.findInSequence(sequences[0]);

      expect(matches[0].context).toMatchObject({
        before: "",
        after: "ATCGA",
        contextStart: 0,
        contextEnd: 9,
      });

      expect(matches[1].context).toMatchObject({
        before: "ATCG",
        after: "ATCGA",
        contextStart: 0,
        contextEnd: 13,
      });
    });

    test("handles case-insensitive matching", () => {
      const matcher = new SequenceMatcher("ATCG", { caseSensitive: false });
      const matches = matcher.findInSequence(sequences[3]);

      expect(matches).toHaveLength(4);
      expect(matches[0].matched).toBe("atcg");
    });

    test("returns empty array for no matches", () => {
      const matcher = new SequenceMatcher("TTTTTT");
      const matches = matcher.findInSequence(sequences[0]);

      expect(matches).toHaveLength(0);
    });
  });

  describe("Fuzzy Matching", () => {
    test("finds matches with mismatches", () => {
      const matcher = new SequenceMatcher("ATCG", {
        algorithm: "fuzzy",
        maxMismatches: 1,
      });

      const testSeq = {
        id: "test",
        sequence: "ATCGATAGTTCG",
        type: "dna" as const,
      };
      const matches = matcher.findInSequence(testSeq);

      expect(matches.length).toBeGreaterThan(0);

      // Should find ATCG (exact) and ATAG (1 mismatch)
      const exactMatch = matches.find((m) => m.mismatches === 0);
      const fuzzyMatch = matches.find((m) => m.mismatches === 1);

      expect(exactMatch).toBeDefined();
      expect(fuzzyMatch).toBeDefined();
      expect(fuzzyMatch?.score).toBeLessThan(1.0);
    });

    test("respects maxMismatches limit", () => {
      const matcher = new SequenceMatcher("AAAA", {
        algorithm: "fuzzy",
        maxMismatches: 2,
      });

      const testSeq = {
        id: "test",
        sequence: "AAAATTTTGGGG",
        type: "dna" as const,
      };
      const matches = matcher.findInSequence(testSeq);

      // Should find AAAA (0 mismatches), AAAT (1 mismatch), AATT (2 mismatches)
      // Fuzzy matching with overlapping is expected
      expect(matches).toHaveLength(3);
      expect(matches[0].mismatches).toBe(0); // AAAA at position 0
      expect(matches[1].mismatches).toBe(1); // AAAT at position 1
      expect(matches[2].mismatches).toBe(2); // AATT at position 2
    });
  });

  describe("IUPAC Ambiguity Codes", () => {
    test("matches N with any nucleotide", () => {
      const matcher = new SequenceMatcher("ATCN", { iupacAware: true });
      const matches = matcher.findInSequence(sequences[0]);

      // ATCN should match ATCG, ATCA, ATCT, ATCC
      expect(matches.length).toBeGreaterThan(0);
    });

    test("handles N in sequence", () => {
      const matcher = new SequenceMatcher("ATCG", { iupacAware: true });
      const matches = matcher.findInSequence(sequences[2]);

      // Should match ATCG even with N's around it
      expect(matches).toHaveLength(1);
      expect(matches[0].position).toBe(5);
    });

    test("matches degenerate bases correctly", () => {
      const matcher = new SequenceMatcher("ATCR", { iupacAware: true }); // R = A or G
      const testSeq = {
        id: "test",
        sequence: "ATCGATCA",
        type: "dna" as const,
      };
      const matches = matcher.findInSequence(testSeq);

      // ATCR (R = A or G) should match both ATCG at position 0 and ATCA at position 4
      expect(matches).toHaveLength(2);
      expect(matches[0].position).toBe(0); // ATCG matches ATCR
      expect(matches[1].position).toBe(4); // ATCA matches ATCR
    });
  });

  describe("Streaming Support", () => {
    test("processes sequences as a stream", async () => {
      const matcher = new SequenceMatcher("ATCG");
      const matches: Array<{
        sequenceId: string;
        position: number;
        match: string;
      }> = [];

      for await (const match of matcher.findAll(createAsyncSequences())) {
        matches.push(match);
      }

      // Should find matches across all sequences
      expect(matches.length).toBeGreaterThan(0);

      // Check that matches come from different sequences
      const uniqueSeqIds = new Set(matches.map((m) => m.sequenceId));
      expect(uniqueSeqIds.size).toBeGreaterThan(1);
    });

    test("handles large streams efficiently", async () => {
      // Create a large stream
      async function* largeStream(): AsyncGenerator<Sequence> {
        for (let i = 0; i < 1000; i++) {
          yield {
            id: `seq${i}`,
            sequence: "ATCG".repeat(100),
            type: "dna",
          };
        }
      }

      const matcher = new SequenceMatcher("ATCG");
      let matchCount = 0;

      for await (const match of matcher.findAll(largeStream())) {
        matchCount++;
        // Stop after finding some matches to avoid timeout
        if (matchCount > 100) break;
      }

      expect(matchCount).toBeGreaterThan(100);
    });

    test("streams matches from large sequence chunks", async () => {
      async function* chunkStream(): AsyncGenerator<string> {
        yield "ATCGATCG";
        yield "ATCGATCG";
        yield "ATCGATCG";
      }

      const matcher = new SequenceMatcher("ATCG");
      const matches: Array<{
        sequenceId: string;
        position: number;
        match: string;
      }> = [];

      for await (const match of matcher.streamMatches(chunkStream())) {
        matches.push(match);
      }

      expect(matches).toHaveLength(6); // 2 per chunk

      // Check positions are globally adjusted
      expect(matches[0].position).toBe(0);
      expect(matches[2].position).toBe(8); // Start of second chunk
      expect(matches[4].position).toBe(16); // Start of third chunk
    });
  });

  describe("Alternative Algorithms", () => {
    test("KMP algorithm produces same results as Boyer-Moore", () => {
      const bmMatcher = new SequenceMatcher("ATCG", {
        algorithm: "boyer-moore",
      });
      const kmpMatcher = new SequenceMatcher("ATCG", { algorithm: "kmp" });

      const bmMatches = bmMatcher.findInSequence(sequences[0]);
      const kmpMatches = kmpMatcher.findInSequence(sequences[0]);

      expect(kmpMatches).toHaveLength(bmMatches.length);
      expect(kmpMatches.map((m) => m.position)).toEqual(bmMatches.map((m) => m.position));
    });

    test("regex algorithm supports complex patterns", () => {
      const matcher = new SequenceMatcher("ATC[GA]", { algorithm: "regex" });
      const matches = matcher.findInSequence(sequences[0]);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].matched).toBe("ATCG");
    });
  });

  describe("Convenience Methods", () => {
    test("findFirst returns only first match", () => {
      const matcher = new SequenceMatcher("ATCG");
      const first = matcher.findFirst(sequences[0]);

      expect(first).toBeDefined();
      expect(first?.position).toBe(0);
    });

    test("test returns boolean for pattern existence", () => {
      const matcher = new SequenceMatcher("ATCG");

      expect(matcher.test(sequences[0])).toBe(true);
      expect(matcher.test({ id: "no", sequence: "TTTTTTTT", type: "dna" })).toBe(false);
    });

    test("count returns number of matches without objects", () => {
      const matcher = new SequenceMatcher("ATCG");
      const count = matcher.count(sequences[0]);

      expect(count).toBe(4);
    });
  });

  describe("Convenience Functions", () => {
    test("findPattern works as standalone function", () => {
      const matches = findPattern("ATCG", sequences[0]);

      expect(matches).toHaveLength(4);
      expect(matches[0].pattern).toBe("ATCG");
    });

    test("hasPattern works as standalone function", () => {
      expect(hasPattern("ATCG", sequences[0])).toBe(true);
      expect(hasPattern("TTTTTT", sequences[0])).toBe(false);
    });

    test("convenience functions accept options", () => {
      const matches = findPattern("atcg", sequences[3], {
        caseSensitive: false,
      });
      expect(matches).toHaveLength(4);

      const fuzzyMatches = findPattern("ATCA", "ATCGATCG", {
        algorithm: "fuzzy",
        maxMismatches: 1,
      });
      expect(fuzzyMatches).toHaveLength(2); // ATCG with 1 mismatch
    });
  });

  describe("Edge Cases", () => {
    test("handles empty pattern", () => {
      expect(() => new SequenceMatcher("")).toThrow("Pattern cannot be empty");
    });

    test("handles empty sequence", () => {
      const matcher = new SequenceMatcher("ATCG");
      const matches = matcher.findInSequence({
        id: "empty",
        sequence: "",
        type: "dna",
      });

      expect(matches).toHaveLength(0);
    });

    test("handles pattern longer than sequence", () => {
      const matcher = new SequenceMatcher("ATCGATCGATCGATCGATCG");
      const matches = matcher.findInSequence({
        id: "short",
        sequence: "ATCG",
        type: "dna",
      });

      expect(matches).toHaveLength(0);
    });

    test("handles overlapping matches", () => {
      const matcher = new SequenceMatcher("AA");
      const matches = matcher.findInSequence({
        id: "test",
        sequence: "AAAA",
        type: "dna",
      });

      expect(matches).toHaveLength(3); // Positions 0, 1, 2
    });

    test("handles invalid regex gracefully", () => {
      const matcher = new SequenceMatcher("[[[", { algorithm: "regex" });

      expect(() => matcher.findInSequence("ATCG")).toThrow("Invalid regex pattern");
    });
  });

  describe("Performance", () => {
    test("handles long patterns efficiently", () => {
      const longPattern = "ATCG".repeat(10); // 40 characters
      const longSequence = "ATCG".repeat(1000); // 4000 characters

      const matcher = new SequenceMatcher(longPattern);
      const start = Date.now();
      const matches = matcher.findInSequence(longSequence);
      const elapsed = Date.now() - start;

      expect(matches.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(100); // Should complete in < 100ms
    });

    test("pre-builds lookup tables for efficiency", () => {
      const matcher = new SequenceMatcher("ATCGATCG");

      // First search should build table
      const start1 = Date.now();
      matcher.findInSequence("ATCG".repeat(1000));
      const time1 = Date.now() - start1;

      // Subsequent searches should be faster
      const start2 = Date.now();
      matcher.findInSequence("ATCG".repeat(1000));
      const time2 = Date.now() - start2;

      // Second search should be at least as fast
      expect(time2).toBeLessThanOrEqual(time1 + 5); // Allow 5ms variance
    });
  });
});
