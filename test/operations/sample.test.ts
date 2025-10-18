/**
 * Tests for SampleProcessor - Statistical sampling operations
 *
 * Comprehensive test suite for sampling functionality including
 * different sampling strategies, reproducibility, and error handling.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { seqops } from "../../src/operations/index";
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
    test("samples approximately correct proportion", async () => {
      const largeTestSet = Array.from({ length: 10000 }, (_, i) => ({
        id: `seq_${i.toString().padStart(5, "0")}`,
        sequence: "ATCG".repeat(i + 1),
        length: (i + 1) * 4,
      }));

      const options: SampleOptions = {
        fraction: 0.1,
      };

      const results = [];
      for await (const seq of processor.process(largeTestSet, options)) {
        results.push(seq);
      }

      // Expect ~1000 sequences (10% of 10000)
      // Allow ±10% variance for probabilistic sampling (900-1100)
      expect(results.length).toBeGreaterThanOrEqual(900);
      expect(results.length).toBeLessThanOrEqual(1100);
    });

    test("fraction 1.0 returns all sequences", async () => {
      const options: SampleOptions = {
        fraction: 1.0,
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      expect(results).toHaveLength(100);
    });

    test("fraction with seed produces reproducible results", async () => {
      const options: SampleOptions = {
        fraction: 0.2,
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

      // Same seed should produce same sample
      expect(results1).toEqual(results2);
    });

    test("different seeds produce different samples", async () => {
      const results1 = [];
      for await (const seq of processor.process(testSequences, { fraction: 0.2, seed: 42 })) {
        results1.push(seq.id);
      }

      const results2 = [];
      for await (const seq of processor.process(testSequences, { fraction: 0.2, seed: 123 })) {
        results2.push(seq.id);
      }

      // Different seeds should produce different results
      expect(results1).not.toEqual(results2);
    });

    test("small fractions work correctly", async () => {
      const largeTestSet = Array.from({ length: 10000 }, (_, i) => ({
        id: `seq_${i.toString().padStart(5, "0")}`,
        sequence: "ATCG".repeat(i + 1),
        length: (i + 1) * 4,
      }));

      const options: SampleOptions = {
        fraction: 0.01,
      };

      const results = [];
      for await (const seq of processor.process(largeTestSet, options)) {
        results.push(seq);
      }

      // Expect ~100 sequences (1% of 10000)
      // Allow ±50% variance for small fractions (50-150)
      expect(results.length).toBeGreaterThanOrEqual(50);
      expect(results.length).toBeLessThanOrEqual(150);
    });

    test("fraction sampling preserves sequence data", async () => {
      const options: SampleOptions = {
        fraction: 0.5,
        seed: 42,
      };

      const results = [];
      for await (const seq of processor.process(testSequences, options)) {
        results.push(seq);
      }

      // Check that sequences are not modified
      for (const seq of results) {
        expect(seq.id).toBeTruthy();
        expect(seq.sequence).toBeTruthy();
        expect(seq.length).toBeGreaterThan(0);
      }
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

  describe("getSeededRandom (internal)", () => {
    test("unseeded uses Math.random", () => {
      const rng = (processor as any).getSeededRandom(undefined);

      for (let i = 0; i < 10; i++) {
        const val = rng();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });

    test("seeded produces reproducible sequence", () => {
      const rng1 = (processor as any).getSeededRandom(42);
      const rng2 = (processor as any).getSeededRandom(42);

      for (let i = 0; i < 10; i++) {
        expect(rng1()).toBe(rng2());
      }
    });

    test("different seeds produce different sequences", () => {
      const rng1 = (processor as any).getSeededRandom(42);
      const rng2 = (processor as any).getSeededRandom(123);

      const val1 = rng1();
      const val2 = rng2();
      expect(val1).not.toBe(val2);
    });

    test("seeded values are in [0, 1) range", () => {
      const rng = (processor as any).getSeededRandom(12345);

      for (let i = 0; i < 100; i++) {
        const val = rng();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });
  });

  describe("SeqOps integration", () => {
    async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
      for (const item of items) {
        yield item;
      }
    }

    test("simple count-based sampling", async () => {
      const sequences = toAsyncIterable(testSequences);

      const sampled = [];
      for await (const seq of seqops(sequences).sample(10)) {
        sampled.push(seq);
      }

      expect(sampled).toHaveLength(10);
    });

    test("fraction-based sampling via SeqOps", async () => {
      const largeTestSet = Array.from({ length: 10000 }, (_, i) => ({
        id: `seq_${i.toString().padStart(5, "0")}`,
        sequence: "ATCG".repeat(i + 1),
        length: (i + 1) * 4,
      }));

      const sequences = toAsyncIterable(largeTestSet);

      const sampled = [];
      for await (const seq of seqops(sequences).sample({ fraction: 0.1 })) {
        sampled.push(seq);
      }

      expect(sampled.length).toBeGreaterThanOrEqual(900);
      expect(sampled.length).toBeLessThanOrEqual(1100);
    });

    test("strategy selection via SeqOps", async () => {
      const sequences1 = toAsyncIterable(testSequences);
      const sequences2 = toAsyncIterable(testSequences);
      const sequences3 = toAsyncIterable(testSequences);

      const reservoir = [];
      for await (const seq of seqops(sequences1).sample(10, "reservoir")) {
        reservoir.push(seq);
      }

      const systematic = [];
      for await (const seq of seqops(sequences2).sample(10, "systematic")) {
        systematic.push(seq);
      }

      const random = [];
      for await (const seq of seqops(sequences3).sample(10, "random")) {
        random.push(seq);
      }

      expect(reservoir).toHaveLength(10);
      expect(systematic).toHaveLength(10);
      expect(random).toHaveLength(10);
    });

    test("reproducible sampling with seed", async () => {
      const sequences1 = toAsyncIterable(testSequences);
      const sequences2 = toAsyncIterable(testSequences);

      const sample1 = [];
      for await (const seq of seqops(sequences1).sample({ n: 10, seed: 42 })) {
        sample1.push(seq);
      }

      const sample2 = [];
      for await (const seq of seqops(sequences2).sample({ n: 10, seed: 42 })) {
        sample2.push(seq);
      }

      expect(sample1.map((s) => s.id)).toEqual(sample2.map((s) => s.id));
    });

    test("chaining after sample", async () => {
      const sequences = toAsyncIterable(testSequences);

      const result = [];
      for await (const seq of seqops(sequences)
        .sample(20)
        .filter((seq) => seq.length >= 20)) {
        result.push(seq);
      }

      expect(result.length).toBeLessThanOrEqual(20);
      for (const seq of result) {
        expect(seq.length).toBeGreaterThanOrEqual(20);
      }
    });
  });

  describe("edge cases", () => {
    test("fraction sampling with empty input", async () => {
      const emptySequences: AbstractSequence[] = [];

      const results = [];
      for await (const seq of processor.process(emptySequences, { fraction: 0.5 })) {
        results.push(seq);
      }

      expect(results).toHaveLength(0);
    });

    test("fraction sampling with single sequence", async () => {
      const singleSequence = [testSequences[0]];

      const results = [];
      for await (const seq of processor.process(singleSequence, { fraction: 0.9, seed: 42 })) {
        results.push(seq);
      }

      expect(results.length).toBeLessThanOrEqual(1);
    });

    test("fraction 1.0 with large dataset", async () => {
      const largeTestSet = Array.from({ length: 10000 }, (_, i) => ({
        id: `seq_${i.toString().padStart(5, "0")}`,
        sequence: "ATCG".repeat(i + 1),
        length: (i + 1) * 4,
      }));

      const results = [];
      for await (const seq of processor.process(largeTestSet, { fraction: 1.0 })) {
        results.push(seq);
      }

      expect(results).toHaveLength(10000);
    });

    test("very small fraction", async () => {
      const largeTestSet = Array.from({ length: 100000 }, (_, i) => ({
        id: `seq_${i.toString().padStart(6, "0")}`,
        sequence: "ATCG".repeat(i + 1),
        length: (i + 1) * 4,
      }));

      const results = [];
      for await (const seq of processor.process(largeTestSet, { fraction: 0.0001 })) {
        results.push(seq);
      }

      expect(results.length).toBeGreaterThanOrEqual(0);
      expect(results.length).toBeLessThanOrEqual(50);
    });

    test("seed 0 should work", async () => {
      const results = [];
      for await (const seq of processor.process(testSequences, { fraction: 0.1, seed: 0 })) {
        results.push(seq);
      }

      expect(results.length).toBeGreaterThan(0);
    });

    test("negative seed should work", async () => {
      const results = [];
      for await (const seq of processor.process(testSequences, { fraction: 0.1, seed: -42 })) {
        results.push(seq);
      }

      expect(results.length).toBeGreaterThan(0);
    });
  });
});
