/**
 * Tests for GrepProcessor - Pattern search operations
 *
 * Comprehensive test suite for grep functionality including pattern matching,
 * regex support, fuzzy matching, and error handling.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { ValidationError } from "../../src/errors";
import { GrepProcessor } from "../../src/operations/grep";
import type { AbstractSequence, GrepOptions } from "../../src/types";

describe("GrepProcessor", () => {
  let processor: GrepProcessor;
  let testSequences: AbstractSequence[];

  beforeEach(() => {
    processor = new GrepProcessor();
    testSequences = [
      {
        id: "chr1_gene1",
        sequence: "ATCGATCGATCG",
        length: 12,
        description: "Chromosome 1 gene 1",
      },
      {
        id: "chr2_gene2",
        sequence: "GGCCAATTGGCC",
        length: 12,
        description: "Chromosome 2 gene 2",
      },
      {
        id: "scaffold_1",
        sequence: "TTAACCGGTTAA",
        length: 12,
        description: "Scaffold sequence",
      },
      {
        id: "plasmid_vector",
        sequence: "GCGCGCGCGCGC",
        length: 12,
        description: "Plasmid vector sequence",
      },
    ];
  });

  describe("basic pattern matching", () => {
    test("matches pattern in sequence content", async () => {
      const options: GrepOptions = {
        pattern: "ATCG",
        target: "sequence",
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("chr1_gene1");
    });

    test("matches pattern in sequence ID", async () => {
      const options: GrepOptions = {
        pattern: "chr",
        target: "id",
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("chr1_gene1");
      expect(results[1].id).toBe("chr2_gene2");
    });

    test("matches pattern in description", async () => {
      const options: GrepOptions = {
        pattern: "Chromosome",
        target: "description",
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(2);
    });
  });

  describe("regex pattern matching", () => {
    test("matches regex pattern in ID", async () => {
      const options: GrepOptions = {
        pattern: /^chr\d+/,
        target: "id",
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("chr1_gene1");
      expect(results[1].id).toBe("chr2_gene2");
    });

    test("matches regex pattern in sequence", async () => {
      const options: GrepOptions = {
        pattern: /(GC){4}/, // Fixed: match GC repeated 4 times
        target: "sequence",
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("plasmid_vector");
    });
  });

  describe("case sensitivity", () => {
    test("case-sensitive matching by default", async () => {
      const options: GrepOptions = {
        pattern: "atcg",
        target: "sequence",
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(0);
    });

    test("case-insensitive matching when enabled", async () => {
      const options: GrepOptions = {
        pattern: "atcg",
        target: "sequence",
        ignoreCase: true,
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("chr1_gene1");
    });
  });

  describe("invert matching", () => {
    test("inverts match results", async () => {
      const options: GrepOptions = {
        pattern: "chr",
        target: "id",
        invert: true,
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("scaffold_1");
      expect(results[1].id).toBe("plasmid_vector");
    });
  });

  describe("fuzzy matching with mismatches", () => {
    test("allows single mismatch in sequence search", async () => {
      const options: GrepOptions = {
        pattern: "ATCGCTCG", // One mismatch from ATCGATCG
        target: "sequence",
        allowMismatches: 1,
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("chr1_gene1");
    });

    test("rejects patterns with too many mismatches", async () => {
      const options: GrepOptions = {
        pattern: "AAAAAAAA", // Many mismatches
        target: "sequence",
        allowMismatches: 2,
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    test("throws error for missing pattern", async () => {
      const options = {
        target: "sequence",
      } as GrepOptions;

      await expect(async () => {
        // Need to consume the generator to trigger validation
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw before yielding
        }
      }).toThrow(ValidationError);
    });

    test("throws error for invalid target", async () => {
      const options = {
        pattern: "test",
        target: "invalid",
      } as GrepOptions;

      await expect(async () => {
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw before yielding
        }
      }).toThrow(ValidationError);
    });

    test("throws error for negative mismatches", async () => {
      const options: GrepOptions = {
        pattern: "ATCG",
        target: "sequence",
        allowMismatches: -1,
      };

      await expect(async () => {
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw before yielding
        }
      }).toThrow(ValidationError);
    });

    test("throws error for mismatches on non-sequence target", async () => {
      const options: GrepOptions = {
        pattern: "chr",
        target: "id",
        allowMismatches: 1,
      };

      await expect(async () => {
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw before yielding
        }
      }).toThrow(ValidationError);
    });
  });

  describe("edge cases", () => {
    test("handles empty sequences", async () => {
      const emptySeq: AbstractSequence = {
        id: "empty",
        sequence: "",
        length: 0,
      };

      const options: GrepOptions = {
        pattern: "ATCG",
        target: "sequence",
      };

      const results = [];
      for await (const seq of processor.process([emptySeq], options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(0);
    });

    test("handles sequences without description", async () => {
      const seqNoDesc: AbstractSequence = {
        id: "no_desc",
        sequence: "ATCGATCG",
        length: 8,
        // No description field
      };

      const options: GrepOptions = {
        pattern: "test",
        target: "description",
      };

      const results = [];
      for await (const seq of processor.process([seqNoDesc], options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(0);
    });

    test("handles regex with case insensitive flag combination", async () => {
      const options: GrepOptions = {
        pattern: /CHR/i,
        target: "id",
        ignoreCase: true, // Should work with regex that already has 'i' flag
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(2);
    });
  });

  describe("bioinformatics-specific features", () => {
    test("searches both strands with reverse complement", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "test_seq",
          sequence: "AAATTTCCC", // Test sequence
          length: 9,
        },
      ];

      // Search for a pattern whose reverse complement exists in the sequence
      // Pattern: 'GGGAAA' -> RC: 'TTTCCC'
      // Sequence: 'AAATTTCCC' contains 'TTTCCC'
      const options: GrepOptions = {
        pattern: "GGGAAA", // RC of this pattern should match in sequence
        target: "sequence",
        allowMismatches: 0,
        searchBothStrands: true,
      };

      const results = [];
      for await (const seq of processor.process(seqs, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(1);
    });

    test("handles IUPAC ambiguous bases in reverse complement", async () => {
      const seqs: AbstractSequence[] = [
        {
          id: "ambiguous_seq",
          sequence: "ATCGNNATCG",
          length: 10,
        },
      ];

      const options: GrepOptions = {
        pattern: "CGATNN",
        target: "sequence",
        allowMismatches: 0,
        searchBothStrands: true,
      };

      const results = [];
      for await (const seq of processor.process(seqs, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(1);
    });
  });
});
