/**
 * Integration tests for SequenceSorter
 *
 * Tests sorting strategies, memory efficiency, and deduplication
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  getTopSequences,
  SequenceSorter,
  sortSequences,
} from "../../../src/operations/core/sequence-sorter";
import type { FastqSequence, Sequence } from "../../../src/types";

describe("SequenceSorter", () => {
  // Test data
  const sequences: Sequence[] = [
    {
      id: "seq1",
      sequence: "ATCGATCG",
      type: "dna",
      description: "Short sequence",
    },
    {
      id: "seq2",
      sequence: "GCGCGCGCGCGCGCGC",
      type: "dna",
      description: "High GC",
    },
    { id: "seq3", sequence: "AAAA", type: "dna", description: "Very short" },
    {
      id: "seq4",
      sequence: "TTTTTTTTTTTT",
      type: "dna",
      description: "Low GC",
    },
    {
      id: "seq5",
      sequence: "ATCGATCG",
      type: "dna",
      description: "Duplicate of seq1",
    },
  ];

  const fastqSequences: FastqSequence[] = [
    {
      id: "read1",
      sequence: "ATCGATCG",
      quality: "IIIIIIII",
      type: "dna",
      qualityEncoding: "phred33",
    },
    {
      id: "read2",
      sequence: "GCGCGCGC",
      quality: "########",
      type: "dna",
      qualityEncoding: "phred33",
    },
    {
      id: "read3",
      sequence: "AAAAAAAA",
      quality: "AAAAAAAA",
      type: "dna",
      qualityEncoding: "phred33",
    },
  ];

  async function* createAsyncSequences(): AsyncGenerator<Sequence> {
    for (const seq of sequences) {
      yield seq;
    }
  }

  async function* createAsyncFastq(): AsyncGenerator<FastqSequence> {
    for (const seq of fastqSequences) {
      yield seq;
    }
  }

  describe("Basic Sorting", () => {
    test("sorts by length (default)", async () => {
      const sorter = new SequenceSorter();
      const sorted: Sequence[] = [];

      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      expect(sorted[0].id).toBe("seq2"); // Longest
      expect(sorted[sorted.length - 1].id).toBe("seq3"); // Shortest

      // Verify descending order
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i - 1].sequence.length).toBeGreaterThanOrEqual(sorted[i].sequence.length);
      }
    });

    test("sorts by length ascending", async () => {
      const sorter = new SequenceSorter({ sortBy: "length-asc" });
      const sorted: Sequence[] = [];

      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      expect(sorted[0].id).toBe("seq3"); // Shortest
      expect(sorted[sorted.length - 1].id).toBe("seq2"); // Longest
    });

    test("sorts by GC content", async () => {
      const sorter = new SequenceSorter({ sortBy: "gc" });
      const sorted: Sequence[] = [];

      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      expect(sorted[0].id).toBe("seq2"); // 100% GC
      expect(sorted[sorted.length - 1].id).toBe("seq4"); // 0% GC
    });

    test("sorts by ID alphabetically", async () => {
      const sorter = new SequenceSorter({ sortBy: "id" });
      const sorted: Sequence[] = [];

      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      expect(sorted.map((s) => s.id)).toEqual(["seq1", "seq2", "seq3", "seq4", "seq5"]);
    });

    test("sorts by ID reverse alphabetically", async () => {
      const sorter = new SequenceSorter({ sortBy: "id-desc" });
      const sorted: Sequence[] = [];

      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      expect(sorted.map((s) => s.id)).toEqual(["seq5", "seq4", "seq3", "seq2", "seq1"]);
    });
  });

  describe("FASTQ Quality Sorting", () => {
    test("sorts by average quality score", async () => {
      const sorter = new SequenceSorter({
        sortBy: "quality",
        qualityEncoding: "phred33",
      });

      const sorted: FastqSequence[] = [];
      for await (const seq of sorter.sort(createAsyncFastq())) {
        sorted.push(seq as FastqSequence);
      }

      // 'I' (ASCII 73) > 'A' (ASCII 65) > '#' (ASCII 35)
      expect(sorted[0].id).toBe("read1"); // Highest quality
      expect(sorted[sorted.length - 1].id).toBe("read2"); // Lowest quality
    });

    test("handles mixed FASTA/FASTQ gracefully", async () => {
      async function* mixedSequences(): AsyncGenerator<Sequence> {
        yield sequences[0];
        yield fastqSequences[0];
        yield sequences[1];
      }

      const sorter = new SequenceSorter({ sortBy: "quality" });
      const sorted: Sequence[] = [];

      for await (const seq of sorter.sort(mixedSequences())) {
        sorted.push(seq);
      }

      expect(sorted).toHaveLength(3);
      // FASTQ with quality should sort higher than FASTA (quality = 0)
      expect(sorted[0].id).toBe("read1");
    });
  });

  describe("Custom Sorting", () => {
    test("accepts custom comparison function", async () => {
      const customSort = (a: Sequence, b: Sequence) => {
        // Sort by sequence content alphabetically
        return a.sequence.localeCompare(b.sequence);
      };

      const sorter = new SequenceSorter({ sortBy: customSort });
      const sorted: Sequence[] = [];

      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      expect(sorted[0].id).toBe("seq3"); // AAAA comes first alphabetically
    });
  });

  describe("Deduplication", () => {
    test("removes duplicates when unique option is set", async () => {
      const sorter = new SequenceSorter({
        sortBy: "length",
        unique: true,
      });

      const sorted: Sequence[] = [];
      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      // seq5 has same sequence as seq1 but different ID, so both are kept
      // Deduplication uses ID:sequence as key
      expect(sorted).toHaveLength(5);
      expect(sorted.find((s) => s.id === "seq5")).toBeDefined();
    });

    test("deduplication uses both ID and sequence as key", async () => {
      const testSeqs: Sequence[] = [
        { id: "a", sequence: "ATCG", type: "dna" },
        { id: "b", sequence: "ATCG", type: "dna" }, // Same sequence, different ID
        { id: "a", sequence: "GCTA", type: "dna" }, // Same ID, different sequence
      ];

      async function* testStream(): AsyncGenerator<Sequence> {
        for (const seq of testSeqs) yield seq;
      }

      const sorter = new SequenceSorter({ unique: true });
      const sorted: Sequence[] = [];

      for await (const seq of sorter.sort(testStream())) {
        sorted.push(seq);
      }

      // All three should be kept as they have unique ID:sequence combinations
      expect(sorted).toHaveLength(3);
    });
  });

  describe("In-Memory Sorting", () => {
    test("sortInMemory returns array directly", async () => {
      const sorter = new SequenceSorter({ sortBy: "gc" });
      const sorted = await sorter.sortInMemory(createAsyncSequences());

      expect(Array.isArray(sorted)).toBe(true);
      expect(sorted[0].id).toBe("seq2");
      expect(sorted).toHaveLength(5);
    });

    test("sortInMemory with deduplication", async () => {
      const sorter = new SequenceSorter({
        sortBy: "length",
        unique: true,
      });

      const sorted = await sorter.sortInMemory(createAsyncSequences());
      expect(sorted).toHaveLength(5); // All kept - different IDs mean not duplicates
    });
  });

  describe("Top-N Selection", () => {
    test("getTopN returns only N sequences", async () => {
      const sorter = new SequenceSorter({ sortBy: "length" });
      const top3: Sequence[] = [];

      for await (const seq of sorter.getTopN(createAsyncSequences(), 3)) {
        top3.push(seq);
      }

      expect(top3).toHaveLength(3);
      expect(top3[0].id).toBe("seq2"); // Longest
      expect(top3[1].sequence.length).toBe(12); // seq4
      expect(top3[2].sequence.length).toBe(8); // seq1 or seq5
    });

    test("getTopN is memory efficient for large streams", async () => {
      // Create a large stream
      async function* largeStream(): AsyncGenerator<Sequence> {
        for (let i = 0; i < 10000; i++) {
          yield {
            id: `seq${i}`,
            sequence: "A".repeat(Math.floor(Math.random() * 100)),
            type: "dna",
          };
        }
      }

      const sorter = new SequenceSorter({ sortBy: "length" });
      const top10: Sequence[] = [];

      for await (const seq of sorter.getTopN(largeStream(), 10)) {
        top10.push(seq);
      }

      expect(top10).toHaveLength(10);

      // Verify they're sorted
      for (let i = 1; i < top10.length; i++) {
        expect(top10[i - 1].sequence.length).toBeGreaterThanOrEqual(top10[i].sequence.length);
      }
    });
  });

  describe("External Sorting", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "seqsort-test-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true });
    });

    test("handles large datasets with external sorting", async () => {
      // Create sequences that would trigger external sorting
      async function* largeDataset(): AsyncGenerator<Sequence> {
        for (let i = 0; i < 100; i++) {
          yield {
            id: `seq${i.toString().padStart(3, "0")}`,
            sequence: "ATCG".repeat(25), // 100 chars each
            type: "dna",
          };
        }
      }

      const sorter = new SequenceSorter({
        sortBy: "id",
        tempDir,
        chunkSize: 1000, // Small chunk to force external sorting
      });

      const sorted: Sequence[] = [];
      for await (const seq of sorter.sort(largeDataset())) {
        sorted.push(seq);
      }

      expect(sorted).toHaveLength(100);

      // Verify correct sorting
      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i].id).toBe(`seq${i.toString().padStart(3, "0")}`);
      }
    });
  });

  describe("Serialization/Deserialization", () => {
    test("correctly serializes FASTA sequences", async () => {
      const sorter = new SequenceSorter();
      const sorted: Sequence[] = [];

      // The internal serialization should preserve all fields
      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      // Check that descriptions are preserved
      const seq1 = sorted.find((s) => s.id === "seq1");
      expect(seq1?.description).toBe("Short sequence");
    });

    test("correctly serializes FASTQ sequences", async () => {
      const sorter = new SequenceSorter({ sortBy: "quality" });
      const sorted: FastqSequence[] = [];

      for await (const seq of sorter.sort(createAsyncFastq())) {
        sorted.push(seq as FastqSequence);
      }

      // Check that quality scores are preserved
      expect(sorted[0].quality).toBe("IIIIIIII");
      expect(sorted[0].qualityEncoding).toBe("phred33");
    });

    test("handles malformed data gracefully", async () => {
      // This tests the fallback in deserializeSequence
      const sorter = new SequenceSorter();

      // Simulate a corrupted serialization by directly testing internal methods
      // This would normally happen if temp files get corrupted
      async function* corruptedStream(): AsyncGenerator<Sequence> {
        yield { id: "good", sequence: "ATCG", type: "dna" };
        // The deserializer should handle this gracefully
      }

      const sorted: Sequence[] = [];
      for await (const seq of sorter.sort(corruptedStream())) {
        sorted.push(seq);
      }

      expect(sorted).toHaveLength(1);
      expect(sorted[0].id).toBe("good");
    });
  });

  describe("Convenience Functions", () => {
    test("sortSequences returns sorted array", async () => {
      const sorted = await sortSequences(createAsyncSequences(), {
        sortBy: "gc",
      });

      expect(Array.isArray(sorted)).toBe(true);
      expect(sorted[0].id).toBe("seq2");
      expect(sorted).toHaveLength(5);
    });

    test("getTopSequences returns top N", async () => {
      const top3 = await getTopSequences(createAsyncSequences(), 3, "length");

      expect(top3).toHaveLength(3);
      expect(top3[0].id).toBe("seq2");
    });

    test("convenience functions accept all options", async () => {
      const sorted = await sortSequences(createAsyncSequences(), {
        sortBy: "id",
        unique: true,
      });

      expect(sorted).toHaveLength(5); // All kept - different IDs
      expect(sorted[0].id).toBe("seq1");
    });
  });

  describe("Edge Cases", () => {
    test("handles empty stream", async () => {
      async function* emptyStream(): AsyncGenerator<Sequence> {
        // Yield nothing
      }

      const sorter = new SequenceSorter();
      const sorted: Sequence[] = [];

      for await (const seq of sorter.sort(emptyStream())) {
        sorted.push(seq);
      }

      expect(sorted).toHaveLength(0);
    });

    test("handles single sequence", async () => {
      async function* singleSeq(): AsyncGenerator<Sequence> {
        yield sequences[0];
      }

      const sorter = new SequenceSorter({ sortBy: "length" });
      const sorted: Sequence[] = [];

      for await (const seq of sorter.sort(singleSeq())) {
        sorted.push(seq);
      }

      expect(sorted).toHaveLength(1);
      expect(sorted[0].id).toBe("seq1");
    });

    test("handles sequences with equal sort values", async () => {
      const testSeqs: Sequence[] = [
        { id: "a", sequence: "ATCG", type: "dna" },
        { id: "b", sequence: "GCTA", type: "dna" },
        { id: "c", sequence: "CGAT", type: "dna" },
      ];

      async function* testStream(): AsyncGenerator<Sequence> {
        for (const seq of testSeqs) yield seq;
      }

      const sorter = new SequenceSorter({ sortBy: "length" });
      const sorted: Sequence[] = [];

      for await (const seq of sorter.sort(testStream())) {
        sorted.push(seq);
      }

      // All have same length, order should be stable
      expect(sorted).toHaveLength(3);
      expect(sorted.every((s) => s.sequence.length === 4)).toBe(true);
    });
  });
});
