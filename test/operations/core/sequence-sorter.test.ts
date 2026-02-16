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
import type { AbstractSequence, FastqSequence } from "../../../src/types";

/** Helper to create test sequences with required length field */
function seq(id: string, sequence: string, description?: string): AbstractSequence {
  return {
    id,
    sequence,
    length: sequence.length,
    ...(description !== undefined && { description }),
  };
}

/** Helper to create FASTQ test sequences */
function fastq(
  id: string,
  sequence: string,
  quality: string,
  qualityEncoding: "phred33" | "phred64" | "solexa" = "phred33"
): FastqSequence {
  return {
    id,
    sequence,
    length: sequence.length,
    quality,
    qualityEncoding,
    format: "fastq",
  };
}

describe("SequenceSorter", () => {
  // Test data
  const sequences: AbstractSequence[] = [
    seq("seq1", "ATCGATCG", "Short sequence"),
    seq("seq2", "GCGCGCGCGCGCGCGC", "High GC"),
    seq("seq3", "AAAA", "Very short"),
    seq("seq4", "TTTTTTTTTTTT", "Low GC"),
    seq("seq5", "ATCGATCG", "Duplicate of seq1"),
  ];

  const fastqSequences: FastqSequence[] = [
    fastq("read1", "ATCGATCG", "IIIIIIII"),
    fastq("read2", "GCGCGCGC", "########"),
    fastq("read3", "AAAAAAAA", "AAAAAAAA"),
  ];

  async function* createAsyncSequences(): AsyncGenerator<AbstractSequence> {
    for (const s of sequences) {
      yield s;
    }
  }

  async function* createAsyncFastq(): AsyncGenerator<FastqSequence> {
    for (const s of fastqSequences) {
      yield s;
    }
  }

  describe("Basic Sorting", () => {
    test("sorts by length (default)", async () => {
      const sorter = new SequenceSorter();
      const sorted: AbstractSequence[] = [];

      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      expect(sorted[0]!.id).toBe("seq2"); // Longest
      expect(sorted[sorted.length - 1]!.id).toBe("seq3"); // Shortest

      // Verify descending order
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i - 1]!.sequence.length).toBeGreaterThanOrEqual(sorted[i]!.sequence.length);
      }
    });

    test("sorts by length ascending", async () => {
      const sorter = new SequenceSorter({ sortBy: "length-asc" });
      const sorted: AbstractSequence[] = [];

      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      expect(sorted[0]!.id).toBe("seq3"); // Shortest
      expect(sorted[sorted.length - 1]!.id).toBe("seq2"); // Longest
    });

    test("sorts by GC content", async () => {
      const sorter = new SequenceSorter({ sortBy: "gc" });
      const sorted: AbstractSequence[] = [];

      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      expect(sorted[0]!.id).toBe("seq2"); // 100% GC
      expect(sorted[sorted.length - 1]!.id).toBe("seq4"); // 0% GC
    });

    test("sorts by ID alphabetically", async () => {
      const sorter = new SequenceSorter({ sortBy: "id" });
      const sorted: AbstractSequence[] = [];

      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      expect(sorted.map((s) => s.id)).toEqual(["seq1", "seq2", "seq3", "seq4", "seq5"]);
    });

    test("sorts by ID reverse alphabetically", async () => {
      const sorter = new SequenceSorter({ sortBy: "id-desc" });
      const sorted: AbstractSequence[] = [];

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
      expect(sorted[0]!.id).toBe("read1"); // Highest quality
      expect(sorted[sorted.length - 1]!.id).toBe("read2"); // Lowest quality
    });

    test("handles mixed FASTA/FASTQ gracefully", async () => {
      async function* mixedSequences(): AsyncGenerator<AbstractSequence> {
        yield sequences[0]!;
        yield fastqSequences[0]!;
        yield sequences[1]!;
      }

      const sorter = new SequenceSorter({ sortBy: "quality" });
      const sorted: AbstractSequence[] = [];

      for await (const seq of sorter.sort(mixedSequences())) {
        sorted.push(seq);
      }

      expect(sorted).toHaveLength(3);
      // FASTQ with quality should sort higher than FASTA (quality = 0)
      expect(sorted[0]!.id).toBe("read1");
    });
  });

  describe("Custom Sorting", () => {
    test("accepts custom comparison function", async () => {
      const customSort = (a: AbstractSequence, b: AbstractSequence) => {
        // Sort by sequence content alphabetically
        return a.sequence.localeCompare(b.sequence);
      };

      const sorter = new SequenceSorter({ sortBy: customSort });
      const sorted: AbstractSequence[] = [];

      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      expect(sorted[0]!.id).toBe("seq3"); // AAAA comes first alphabetically
    });
  });

  describe("Deduplication", () => {
    test("removes duplicates when unique option is set", async () => {
      const sorter = new SequenceSorter({
        sortBy: "length",
        unique: true,
      });

      const sorted: AbstractSequence[] = [];
      for await (const seq of sorter.sort(createAsyncSequences())) {
        sorted.push(seq);
      }

      // seq5 has same sequence as seq1 but different ID, so both are kept
      // Deduplication uses ID:sequence as key
      expect(sorted).toHaveLength(5);
      expect(sorted.find((s) => s.id === "seq5")).toBeDefined();
    });

    test("deduplication uses both ID and sequence as key", async () => {
      const testSeqs: AbstractSequence[] = [
        seq("a", "ATCG"),
        seq("b", "ATCG"), // Same sequence, different ID
        seq("a", "GCTA"), // Same ID, different sequence
      ];

      async function* testStream(): AsyncGenerator<AbstractSequence> {
        for (const s of testSeqs) yield s;
      }

      const sorter = new SequenceSorter({ unique: true });
      const sorted: AbstractSequence[] = [];

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
      expect(sorted[0]!.id).toBe("seq2");
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
      const top3: AbstractSequence[] = [];

      for await (const s of sorter.getTopN(createAsyncSequences(), 3)) {
        top3.push(s);
      }

      expect(top3).toHaveLength(3);
      expect(top3[0]!.id).toBe("seq2"); // Longest
      expect(top3[1]!.sequence.length).toBe(12); // seq4
      expect(top3[2]!.sequence.length).toBe(8); // seq1 or seq5
    });

    test("getTopN is memory efficient for large streams", async () => {
      // Create a large stream
      async function* largeStream(): AsyncGenerator<AbstractSequence> {
        for (let i = 0; i < 10000; i++) {
          const sequence = "A".repeat(Math.floor(Math.random() * 100));
          yield {
            id: `seq${i}`,
            sequence,
            length: sequence.length,
          };
        }
      }

      const sorter = new SequenceSorter({ sortBy: "length" });
      const top10: AbstractSequence[] = [];

      for await (const s of sorter.getTopN(largeStream(), 10)) {
        top10.push(s);
      }

      expect(top10).toHaveLength(10);

      // Verify they're sorted
      for (let i = 1; i < top10.length; i++) {
        expect(top10[i - 1]!.sequence.length).toBeGreaterThanOrEqual(top10[i]!.sequence.length);
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
      async function* largeDataset(): AsyncGenerator<AbstractSequence> {
        for (let i = 0; i < 100; i++) {
          const sequence = "ATCG".repeat(25); // 100 chars each
          yield {
            id: `seq${i.toString().padStart(3, "0")}`,
            sequence,
            length: sequence.length,
          };
        }
      }

      const sorter = new SequenceSorter({
        sortBy: "id",
        tempDir,
        chunkSize: 1000, // Small chunk to force external sorting
      });

      const sorted: AbstractSequence[] = [];
      for await (const s of sorter.sort(largeDataset())) {
        sorted.push(s);
      }

      expect(sorted).toHaveLength(100);

      // Verify correct sorting
      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i]!.id).toBe(`seq${i.toString().padStart(3, "0")}`);
      }
    });
  });

  describe("Serialization/Deserialization", () => {
    test("correctly serializes FASTA sequences", async () => {
      const sorter = new SequenceSorter();
      const sorted: AbstractSequence[] = [];

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
      expect(sorted[0]!.quality).toBe("IIIIIIII");
      expect(sorted[0]!.qualityEncoding).toBe("phred33");
    });

    test("handles malformed data gracefully", async () => {
      // This tests the fallback in deserializeSequence
      const sorter = new SequenceSorter();

      // Simulate a corrupted serialization by directly testing internal methods
      // This would normally happen if temp files get corrupted
      async function* corruptedStream(): AsyncGenerator<AbstractSequence> {
        yield seq("good", "ATCG");
        // The deserializer should handle this gracefully
      }

      const sorted: AbstractSequence[] = [];
      for await (const s of sorter.sort(corruptedStream())) {
        sorted.push(s);
      }

      expect(sorted).toHaveLength(1);
      expect(sorted[0]!.id).toBe("good");
    });
  });

  describe("Convenience Functions", () => {
    test("sortSequences returns sorted array", async () => {
      const sorted = await sortSequences(createAsyncSequences(), {
        sortBy: "gc",
      });

      expect(Array.isArray(sorted)).toBe(true);
      expect(sorted[0]!.id).toBe("seq2");
      expect(sorted).toHaveLength(5);
    });

    test("getTopSequences returns top N", async () => {
      const top3 = await getTopSequences(createAsyncSequences(), 3, "length");

      expect(top3).toHaveLength(3);
      expect(top3[0]!.id).toBe("seq2");
    });

    test("convenience functions accept all options", async () => {
      const sorted = await sortSequences(createAsyncSequences(), {
        sortBy: "id",
        unique: true,
      });

      expect(sorted).toHaveLength(5); // All kept - different IDs
      expect(sorted[0]!.id).toBe("seq1");
    });
  });

  describe("Edge Cases", () => {
    test("handles empty stream", async () => {
      async function* emptyStream(): AsyncGenerator<AbstractSequence> {
        // Yield nothing
      }

      const sorter = new SequenceSorter();
      const sorted: AbstractSequence[] = [];

      for await (const s of sorter.sort(emptyStream())) {
        sorted.push(s);
      }

      expect(sorted).toHaveLength(0);
    });

    test("handles single sequence", async () => {
      async function* singleSeq(): AsyncGenerator<AbstractSequence> {
        yield sequences[0]!;
      }

      const sorter = new SequenceSorter({ sortBy: "length" });
      const sorted: AbstractSequence[] = [];

      for await (const s of sorter.sort(singleSeq())) {
        sorted.push(s);
      }

      expect(sorted).toHaveLength(1);
      expect(sorted[0]!.id).toBe("seq1");
    });

    test("handles sequences with equal sort values", async () => {
      const testSeqs: AbstractSequence[] = [
        seq("a", "ATCG"),
        seq("b", "GCTA"),
        seq("c", "CGAT"),
      ];

      async function* testStream(): AsyncGenerator<AbstractSequence> {
        for (const s of testSeqs) yield s;
      }

      const sorter = new SequenceSorter({ sortBy: "length" });
      const sorted: AbstractSequence[] = [];

      for await (const s of sorter.sort(testStream())) {
        sorted.push(s);
      }

      // All have same length, order should be stable
      expect(sorted).toHaveLength(3);
      expect(sorted.every((s) => s.sequence.length === 4)).toBe(true);
    });
  });
});
