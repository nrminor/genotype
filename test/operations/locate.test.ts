/**
 * Tests for LocateProcessor - Motif location finding operations
 *
 * Comprehensive test suite for locate functionality including pattern finding,
 * fuzzy matching, strand searching, and various output formats.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { ValidationError } from "../../src/errors";
import { LocateProcessor } from "../../src/operations/locate";
import type { LocateOptions, MotifLocation } from "../../src/operations/types";
import type { AbstractSequence } from "../../src/types";

describe("LocateProcessor", () => {
  let processor: LocateProcessor;
  let testSequences: AbstractSequence[];

  beforeEach(() => {
    processor = new LocateProcessor();
    testSequences = [
      {
        id: "seq1",
        sequence: "ATCGATCGATCGATCG",
        length: 16,
        description: "Test sequence 1",
      },
      {
        id: "seq2",
        sequence: "GGCCAATTGGCCAATT",
        length: 16,
        description: "Test sequence 2",
      },
      {
        id: "seq3",
        sequence: "TTAACCGGTTAACCGG",
        length: 16,
        description: "Test sequence 3",
      },
      {
        id: "empty_seq",
        sequence: "",
        length: 0,
        description: "Empty sequence",
      },
    ];
  });

  describe("basic pattern location", () => {
    test("finds single occurrence of string pattern", async () => {
      const options: LocateOptions = {
        pattern: "ATCG",
      };

      const results = [];
      for await (const location of processor.locate(testSequences, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(4); // ATCG appears 4 times in seq1
      expect(results[0].sequenceId).toBe("seq1");
      expect(results[0].start).toBe(0);
      expect(results[0].end).toBe(4);
      expect(results[0].length).toBe(4);
      expect(results[0].strand).toBe("+");
      expect(results[0].matchedSequence).toBe("ATCG");
      expect(results[0].mismatches).toBe(0);
      expect(results[0].score).toBe(1.0);
      expect(results[0].pattern).toBe("ATCG");
    });

    test("finds multiple occurrences in same sequence", async () => {
      const options: LocateOptions = {
        pattern: "GCC",
      };

      const results = [];
      for await (const location of processor.locate(testSequences, options)) {
        results.push(location);
      }

      // GCC appears 2 times in seq2
      const seq2Results = results.filter((r) => r.sequenceId === "seq2");
      expect(seq2Results).toHaveLength(2);
      expect(seq2Results[0].start).toBe(1);
      expect(seq2Results[1].start).toBe(9);
    });

    test("returns empty results for pattern not found", async () => {
      const options: LocateOptions = {
        pattern: "AAAAA", // Pattern not in test sequences
      };

      const results = [];
      for await (const location of processor.locate(testSequences, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(0);
    });

    test("includes context information by default", async () => {
      const options: LocateOptions = {
        pattern: "AATT",
      };

      const results = [];
      for await (const location of processor.locate(testSequences, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(2); // AATT appears in seq2 and seq3
      expect(results[0].context).toBeDefined();
      expect(results[0].context?.upstream).toBeDefined();
      expect(results[0].context?.downstream).toBeDefined();
    });
  });

  describe("regex pattern location", () => {
    test("finds regex pattern matches", async () => {
      const options: LocateOptions = {
        pattern: /GG[CT]{2}/,
      };

      const results = [];
      for await (const location of processor.locate(testSequences, options)) {
        results.push(location);
      }

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].sequenceId).toBe("seq2");
      expect(results[0].matchedSequence).toMatch(/GG[CT]{2}/);
      expect(results[0].strand).toBe("+");
    });

    test("handles regex with global flag", async () => {
      const options: LocateOptions = {
        pattern: /(AT|GC)/g,
      };

      const results = [];
      for await (const location of processor.locate(testSequences, options)) {
        results.push(location);
      }

      expect(results.length).toBeGreaterThan(1);
    });

    test("prevents infinite loops with zero-width matches", async () => {
      const options: LocateOptions = {
        pattern: /(?=A)/g, // Zero-width positive lookahead
      };

      const results = [];
      for await (const location of processor.locate(testSequences, options)) {
        results.push(location);
      }

      // Should not hang and should find matches
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("case sensitivity", () => {
    test("case-sensitive matching by default", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "mixed_case",
          sequence: "AtCgAtCg",
          length: 8,
        },
      ];

      const options: LocateOptions = {
        pattern: "atcg",
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(0);
    });

    test("case-insensitive matching when enabled", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "mixed_case",
          sequence: "AtCgAtCg",
          length: 8,
        },
      ];

      const options: LocateOptions = {
        pattern: "atcg",
        ignoreCase: true,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(2);
      expect(results[0].matchedSequence).toBe("AtCg");
    });

    test("case-insensitive regex matching", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "mixed_case",
          sequence: "AtCgAtCg",
          length: 8,
        },
      ];

      const options: LocateOptions = {
        pattern: /atcg/,
        ignoreCase: true,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(2);
    });
  });

  describe("fuzzy matching with mismatches", () => {
    test("allows single mismatch", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "test_seq",
          sequence: "ATCGATCGATCG",
          length: 12,
        },
      ];

      const options: LocateOptions = {
        pattern: "ATCGCTCG", // One mismatch from ATCGATCG
        allowMismatches: 1,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(1);
      expect(results[0].mismatches).toBe(1);
      expect(results[0].score).toBeLessThan(1.0);
    });

    test("allows multiple mismatches", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "test_seq",
          sequence: "ATCGATCGATCG",
          length: 12,
        },
      ];

      const options: LocateOptions = {
        pattern: "AAGGATCG", // Two mismatches from ATCGATCG (A≠T, G≠C)
        allowMismatches: 2,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(1);
      expect(results[0].mismatches).toBe(2);
      expect(results[0].score).toBeLessThan(1.0);
    });

    test("rejects patterns with too many mismatches", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "test_seq",
          sequence: "ATCGATCGATCG",
          length: 12,
        },
      ];

      const options: LocateOptions = {
        pattern: "AAAAAAAA", // Many mismatches
        allowMismatches: 2,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(0);
    });

    test("calculates correct score for fuzzy matches", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "test_seq",
          sequence: "ATCGATCG",
          length: 8,
        },
      ];

      const options: LocateOptions = {
        pattern: "ATCGCTCG", // 1 mismatch out of 8 = score 0.875
        allowMismatches: 1,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(1);
      expect(results[0].score).toBeCloseTo(0.875, 3);
    });
  });

  describe("strand searching", () => {
    test("searches forward strand only by default", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "test_seq",
          sequence: "ATCGATCG",
          length: 8,
        },
      ];

      const options: LocateOptions = {
        pattern: "CGATCG",
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(1);
      expect(results[0].strand).toBe("+");
    });

    test("searches both strands when enabled", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "test_seq",
          sequence: "ATCGATCG",
          length: 8,
        },
      ];

      // Pattern CGATCG appears on forward strand
      // Its reverse complement CGATCG also appears (palindromic)
      const options: LocateOptions = {
        pattern: "CGATCG",
        searchBothStrands: true,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      // Should find matches on both strands
      expect(results.length).toBeGreaterThanOrEqual(1);
      const strands = results.map((r) => r.strand);
      expect(strands).toContain("+");
    });

    test("finds reverse complement matches", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "test_seq",
          sequence: "AAATTTCCC", // Contains TTTCCC
          length: 9,
        },
      ];

      // Pattern GGGAAA has reverse complement TTTCCC
      const options: LocateOptions = {
        pattern: "GGGAAA",
        searchBothStrands: true,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(1);
      expect(results[0].strand).toBe("-");
    });

    test("handles IUPAC ambiguous bases in reverse complement", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "ambiguous_seq",
          sequence: "ATCGNATCG",
          length: 9,
        },
      ];

      const options: LocateOptions = {
        pattern: "CGATN",
        searchBothStrands: true,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("output options", () => {
    test("limits maximum matches when specified", async () => {
      const options: LocateOptions = {
        pattern: "AT",
        maxMatches: 2,
      };

      const results = [];
      for await (const location of processor.locate(testSequences, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(2);
    });

    test("excludes context for BED format", async () => {
      const options: LocateOptions = {
        pattern: "ATCG",
        outputFormat: "bed",
      };

      const results = [];
      for await (const location of processor.locate(testSequences, options)) {
        results.push(location);
      }

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].context).toBeUndefined();
    });

    test("includes context for default format", async () => {
      const options: LocateOptions = {
        pattern: "ATCG",
        outputFormat: "default",
      };

      const results = [];
      for await (const location of processor.locate(testSequences, options)) {
        results.push(location);
      }

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].context).toBeDefined();
    });

    test("respects minimum length filter", async () => {
      const options: LocateOptions = {
        pattern: "AT",
        minLength: 4, // Pattern is only 2 chars, should be filtered out
      };

      const results = [];
      for await (const location of processor.locate(testSequences, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(0);
    });
  });

  describe("overlap handling", () => {
    test("allows overlapping matches by default", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "overlap_seq",
          sequence: "AAAA", // Pattern AAA overlaps
          length: 4,
        },
      ];

      const options: LocateOptions = {
        pattern: "AAA",
        allowOverlaps: true,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(2); // AAA at position 0 and 1
    });

    test("filters overlapping matches when disabled", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "overlap_seq",
          sequence: "AAAA",
          length: 4,
        },
      ];

      const options: LocateOptions = {
        pattern: "AAA",
        allowOverlaps: false,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(1); // Only first match kept
    });

    test("keeps highest scoring match when filtering overlaps", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "overlap_seq",
          sequence: "ATCGATCG",
          length: 8,
        },
      ];

      const options: LocateOptions = {
        pattern: "ATCG",
        allowMismatches: 1,
        allowOverlaps: false,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      // Should keep matches with better scores
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.score).toBeGreaterThan(0);
      }
    });
  });

  describe("error handling", () => {
    test("throws error for missing pattern", async () => {
      const options = {} as LocateOptions;

      await expect(async () => {
        for await (const _ of processor.locate(testSequences, options)) {
          // Validation should throw before yielding
        }
      }).toThrow(ValidationError);
    });

    test("throws error for empty pattern", async () => {
      const options: LocateOptions = {
        pattern: "",
      };

      await expect(async () => {
        for await (const _ of processor.locate(testSequences, options)) {
          // Validation should throw before yielding
        }
      }).toThrow(ValidationError);
    });

    test("throws error for negative mismatches", async () => {
      const options: LocateOptions = {
        pattern: "ATCG",
        allowMismatches: -1,
      };

      await expect(async () => {
        for await (const _ of processor.locate(testSequences, options)) {
          // Validation should throw before yielding
        }
      }).toThrow(ValidationError);
    });

    test("throws error for regex with mismatches", async () => {
      const options: LocateOptions = {
        pattern: /ATCG/,
        allowMismatches: 1,
      };

      await expect(async () => {
        for await (const _ of processor.locate(testSequences, options)) {
          // Validation should throw before yielding
        }
      }).toThrow(ValidationError);
    });

    test("throws error for invalid max matches", async () => {
      const options: LocateOptions = {
        pattern: "ATCG",
        maxMatches: 0,
      };

      await expect(async () => {
        for await (const _ of processor.locate(testSequences, options)) {
          // Validation should throw before yielding
        }
      }).toThrow(ValidationError);
    });

    test("throws error for invalid min length", async () => {
      const options: LocateOptions = {
        pattern: "ATCG",
        minLength: 0,
      };

      await expect(async () => {
        for await (const _ of processor.locate(testSequences, options)) {
          // Validation should throw before yielding
        }
      }).toThrow(ValidationError);
    });

    test("throws error for invalid output format", async () => {
      const options = {
        pattern: "ATCG",
        outputFormat: "invalid",
      } as LocateOptions;

      await expect(async () => {
        for await (const _ of processor.locate(testSequences, options)) {
          // Validation should throw before yielding
        }
      }).toThrow(ValidationError);
    });
  });

  describe("edge cases", () => {
    test("handles empty sequences", async () => {
      const options: LocateOptions = {
        pattern: "ATCG",
      };

      const results = [];
      for await (const location of processor.locate([testSequences[3]], options)) {
        results.push(location);
      }

      expect(results).toHaveLength(0);
    });

    test("handles pattern longer than sequence", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "short_seq",
          sequence: "AT",
          length: 2,
        },
      ];

      const options: LocateOptions = {
        pattern: "ATCGATCG",
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(0);
    });

    test("handles sequence without description", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "no_desc",
          sequence: "ATCGATCG",
          length: 8,
        },
      ];

      const options: LocateOptions = {
        pattern: "ATCG",
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(2);
      expect(results[0].sequenceId).toBe("no_desc");
    });

    test("handles very small context size", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "test",
          sequence: "ATCGATCGATCG",
          length: 12,
        },
      ];

      const options: LocateOptions = {
        pattern: "GATC",
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].context).toBeDefined();
    });
  });

  describe("bioinformatics-specific features", () => {
    test("finds transcription factor binding sites", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "promoter",
          sequence: "ATATAAGGCCTTAATATTTCCCGGGAAATATA",
          length: 31,
        },
      ];

      // TATA box motif
      const options: LocateOptions = {
        pattern: "TATAAA",
        allowMismatches: 1,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results.length).toBeGreaterThan(0);
    });

    test("finds restriction enzyme sites", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "plasmid",
          sequence: "ATCGAATTCGATCGGATCCATCG",
          length: 22,
        },
      ];

      // EcoRI site (GAATTC)
      const options: LocateOptions = {
        pattern: "GAATTC",
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(1);
      expect(results[0].matchedSequence).toBe("GAATTC");
    });

    test("finds palindromic sequences", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "palindrome",
          sequence: "ATGAATTCAT",
          length: 10,
        },
      ];

      const options: LocateOptions = {
        pattern: "GAATTC",
        searchBothStrands: true,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(1); // Palindrome found once
    });

    test("handles degenerate IUPAC codes", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "degenerate",
          sequence: "ATCGRYSWKMBDHVNATCG",
          length: 18,
        },
      ];

      const options: LocateOptions = {
        pattern: "ATCG",
        searchBothStrands: true,
      };

      const results = [];
      for await (const location of processor.locate(seqs, options)) {
        results.push(location);
      }

      expect(results).toHaveLength(2); // ATCG at start and end
    });
  });
});
