import { describe, expect, test } from "bun:test";
import { seqops } from "../../src/operations";
import { KmerSet, SequenceSet } from "../../src/operations/types";
import type { AbstractSequence } from "../../src/types";

describe("SeqOps integration with windows and collectSet", () => {
  async function* makeAsync<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item;
    }
  }

  describe(".windows() method", () => {
    test("simple form .windows(size) works and infers K", async () => {
      const sequences: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "A".repeat(50),
          length: 50,
          lineNumber: 1,
          description: "",
        },
      ];

      const windows = [];
      for await (const window of seqops(makeAsync(sequences)).windows(21)) {
        windows.push(window);
      }

      expect(windows.length).toBe(30);
      expect(windows[0].kmerSize).toBe(21);

      const size: 21 = windows[0].kmerSize;
      expect(size).toBe(21);
    });

    test(".windows(size, options) form works with options", async () => {
      const sequences: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCGATCGATCG",
          length: 12,
          lineNumber: 1,
          description: "",
        },
      ];

      const windows = [];
      for await (const window of seqops(makeAsync(sequences)).windows(3, {
        step: 2,
        suffix: "_kmer",
      })) {
        windows.push(window);
      }

      expect(windows.length).toBe(5);
      expect(windows[0].stepSize).toBe(2);
      expect(windows[0].suffix).toBe("_kmer");
    });

    test(".windows({size, ...}) object form works", async () => {
      const sequences: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "A".repeat(50),
          length: 50,
          lineNumber: 1,
          description: "",
        },
      ];

      const windows = [];
      for await (const window of seqops(makeAsync(sequences)).windows({
        size: 15,
        step: 5,
      })) {
        windows.push(window);
      }

      expect(windows.length).toBe(8);
      expect(windows[0].kmerSize).toBe(15);
    });
  });

  describe(".sliding() alias", () => {
    test("works identically to .windows()", async () => {
      const sequences: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCGATCG",
          length: 8,
          lineNumber: 1,
          description: "",
        },
      ];

      const windows = [];
      for await (const window of seqops(makeAsync(sequences)).windows(4)) {
        windows.push(window);
      }

      const sliding = [];
      for await (const window of seqops(makeAsync(sequences)).sliding(4)) {
        sliding.push(window);
      }

      expect(sliding.length).toBe(windows.length);
      expect(sliding[0].sequence).toBe(windows[0].sequence);
    });
  });

  describe(".kmers() alias", () => {
    test("works identically to .windows()", async () => {
      const sequences: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCGATCG",
          length: 8,
          lineNumber: 1,
          description: "",
        },
      ];

      const windows = [];
      for await (const window of seqops(makeAsync(sequences)).windows(3)) {
        windows.push(window);
      }

      const kmers = [];
      for await (const kmer of seqops(makeAsync(sequences)).kmers(3)) {
        kmers.push(kmer);
      }

      expect(kmers.length).toBe(windows.length);
      expect(kmers[0].sequence).toBe(windows[0].sequence);
    });
  });

  describe(".collectSet() type discrimination", () => {
    test("returns KmerSet<K> for k-mer sequences", async () => {
      const sequences: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "A".repeat(50),
          length: 50,
          lineNumber: 1,
          description: "",
        },
      ];

      const kmerSet = await seqops(makeAsync(sequences)).windows(21).collectSet();

      expect(kmerSet).toBeInstanceOf(KmerSet);
      expect(kmerSet.size).toBeGreaterThan(0);

      const arr = kmerSet.toArray();
      const size: 21 = arr[0].kmerSize;
      expect(size).toBe(21);
    });

    test("returns SequenceSet<T> for FASTA sequences", async () => {
      const sequences: AbstractSequence[] = [
        { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1, description: "" },
        { id: "seq2", sequence: "GCTA", length: 4, lineNumber: 2, description: "" },
        { id: "seq3", sequence: "ATCG", length: 4, lineNumber: 3, description: "" },
      ];

      const seqSet = await seqops(makeAsync(sequences)).collectSet();

      expect(seqSet).toBeInstanceOf(SequenceSet);
      expect(seqSet.size).toBe(2);
    });
  });

  describe("Full pipeline integration", () => {
    test(".windows().collectSet().union() preserves K type", async () => {
      const seq1: AbstractSequence[] = [
        {
          id: "seq1",
          sequence: "ATCGATCGATCG",
          length: 12,
          lineNumber: 1,
          description: "",
        },
      ];
      const seq2: AbstractSequence[] = [
        {
          id: "seq2",
          sequence: "GCTAGCTAGCTA",
          length: 12,
          lineNumber: 1,
          description: "",
        },
      ];

      const kmers1 = await seqops(makeAsync(seq1)).windows(5).collectSet();
      const kmers2 = await seqops(makeAsync(seq2)).windows(5).collectSet();

      const union = kmers1.union(kmers2);
      const intersection = kmers1.intersection(kmers2);

      expect(union.size).toBeGreaterThanOrEqual(kmers1.size);
      expect(intersection.size).toBeLessThanOrEqual(kmers1.size);

      const unionArr = union.toArray();
      const size: 5 = unionArr[0].kmerSize;
      expect(size).toBe(5);
    });
  });
});
