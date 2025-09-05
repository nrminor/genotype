/**
 * Tests for SampleProcessor - Statistical sampling operations
 *
 * Comprehensive test suite for sampling functionality including
 * different sampling strategies, reproducibility, and error handling.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { SampleProcessor } from "../../src/operations/sample";
import type { AbstractSequence, SampleOptions } from "../../src/types";

describe("SampleProcessor", () => {
  let processor: SampleProcessor;
  let testSequences: AbstractSequence[];

  beforeEach(() => {
    processor = new SampleProcessor();
    testSequences = Array.from({ length: 100 }, (_, i) => ({
      id: `seq_${i.toString().padStart(3, "0")}`,
      sequence: "ATCG".repeat(i + 1),
      length: (i + 1) * 4,
    }));
  });

  describe("reservoir sampling", () => {
    test("samples exact count with reservoir strategy", async () => {
      const options: SampleOptions = {
        n: 10,
        strategy: "reservoir",
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(10);
    });

    test("reservoir sampling is reproducible with seed", async () => {
      const options: SampleOptions = {
        n: 5,
        strategy: "reservoir",
        seed: 42,
      };

      const results1 = [];
      for await (const seq of processor.process(testSequences, options)) {
        results1.push(seq.id);
      }

      const results2 = [];
      for await (const seq of processor.process(testSequences, options)) {
        results2.push(seq.id);
      }

      expect(results1).toEqual(results2);
    });

    test("handles sample size larger than dataset", async () => {
      const smallDataset = testSequences.slice(0, 5);
      const options: SampleOptions = {
        n: 10,
        strategy: "reservoir",
      };

      const results = [];
      for await (const seq of processor.process(smallDataset, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(5); // Should return all available
    });
  });

  describe("systematic sampling", () => {
    test("samples at regular intervals", async () => {
      const options: SampleOptions = {
        n: 10,
        strategy: "systematic",
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(10);

      // Should be evenly spaced
      const expectedInterval = Math.floor(100 / 10);
      expect(results[0].id).toBe("seq_000");
      expect(results[1].id).toBe(`seq_${expectedInterval.toString().padStart(3, "0")}`);
    });

    test("handles edge cases in systematic sampling", async () => {
      const smallDataset = testSequences.slice(0, 3);
      const options: SampleOptions = {
        n: 2,
        strategy: "systematic",
      };

      const results = [];
      for await (const seq of processor.process(smallDataset, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(2);
    });
  });

  describe("random sampling", () => {
    test("samples exact count with random strategy", async () => {
      const options: SampleOptions = {
        n: 15,
        strategy: "random",
        seed: 123,
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(15);
    });

    test("random sampling is reproducible with seed", async () => {
      const options: SampleOptions = {
        n: 8,
        strategy: "random",
        seed: 999,
      };

      const results1 = [];
      for await (const seq of processor.process(testSequences, options)) {
        results1.push(seq.id);
      }

      const results2 = [];
      for await (const seq of processor.process(testSequences, options)) {
        results2.push(seq.id);
      }

      expect(results1).toEqual(results2);
    });
  });

  describe("fraction-based sampling", () => {
    test("throws error for fraction sampling (not yet implemented)", async () => {
      const options: SampleOptions = {
        fraction: 0.1, // 10%
        strategy: "reservoir",
      };

      // For fraction sampling, we need to handle it differently
      // This should be implemented in a future version
      await expect(async () => {
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw
        }
      }).toThrow("Fraction-based sampling requires known dataset size");
    });
  });

  describe("default behavior", () => {
    test("defaults to reservoir sampling when no strategy specified", async () => {
      const options: SampleOptions = {
        n: 5,
        // No strategy specified
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(5);
    });
  });

  describe("error handling", () => {
    test("throws error when neither n nor fraction specified", async () => {
      const options = {} as SampleOptions;

      await expect(async () => {
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw
        }
      }).toThrow("either n or fraction must be specified");
    });

    test("throws error when both n and fraction specified", async () => {
      const options: SampleOptions = {
        n: 10,
        fraction: 0.5,
      };

      await expect(async () => {
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw
        }
      }).toThrow("cannot specify both n and fraction");
    });

    test("throws error for negative sample count", async () => {
      const options: SampleOptions = {
        n: -5,
      };

      await expect(async () => {
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw
        }
      }).toThrow("n must be positive");
    });

    test("throws error for zero sample count", async () => {
      const options: SampleOptions = {
        n: 0,
      };

      await expect(async () => {
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw
        }
      }).toThrow("n must be positive");
    });

    test("throws error for invalid fraction", async () => {
      const options: SampleOptions = {
        fraction: 1.5, // > 1.0
      };

      await expect(async () => {
        for await (const _ of processor.process(testSequences, options)) {
          // Validation should throw
        }
      }).toThrow("fraction must be at most 1");
    });
  });

  describe("edge cases", () => {
    test("handles empty input", async () => {
      const options: SampleOptions = {
        n: 5,
        strategy: "reservoir",
      };

      const results = [];
      for await (const seq of processor.process([], options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(0);
    });

    test("handles single sequence input", async () => {
      const singleSeq = [testSequences[0]];
      const options: SampleOptions = {
        n: 1,
        strategy: "random",
        seed: 42,
      };

      const results = [];
      for await (const seq of processor.process(singleSeq, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("seq_000");
    });
  });

  describe("sampling quality", () => {
    test("produces diverse samples with reservoir sampling", async () => {
      const options: SampleOptions = {
        n: 20,
        strategy: "reservoir",
        seed: 777,
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      // Check that we get sequences from different parts of the dataset
      const ids = results.map((seq) => parseInt(seq.id.split("_")[1]));
      const minId = Math.min(...ids);
      const maxId = Math.max(...ids);

      // Should span a reasonable range (not just first 20)
      expect(maxId - minId).toBeGreaterThan(10);
    });

    test("systematic sampling provides even coverage", async () => {
      const options: SampleOptions = {
        n: 10,
        strategy: "systematic",
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      // Extract sequence indices
      const indices = results.map((seq) => parseInt(seq.id.split("_")[1]));

      // Should be evenly spaced
      const expectedInterval = Math.floor(100 / 10);
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i] - indices[i - 1]).toBe(expectedInterval);
      }
    });
  });
});
