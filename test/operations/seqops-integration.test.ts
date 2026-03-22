import { describe, expect, test } from "bun:test";
import { createFastaRecord } from "@genotype/core/constructors";
import { seqops } from "@genotype/core/operations";
import { KmerSet, SequenceSet } from "@genotype/core/operations/types";
import type { AbstractSequence } from "@genotype/core/types";
import "../matchers";

function createSequence(
  id: string,
  sequence: string,
  lineNumber?: number,
  description?: string
): AbstractSequence {
  return createFastaRecord({
    id,
    sequence,
    ...(lineNumber !== undefined && { lineNumber }),
    ...(description !== undefined && { description }),
  });
}

describe("SeqOps integration with windows and collectSet", () => {
  async function* makeAsync<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item;
    }
  }

  describe(".windows() method", () => {
    test("simple form .windows(size) works and infers K", async () => {
      const sequences: AbstractSequence[] = [createSequence("seq1", "A".repeat(50), 1, "")];

      const windows = await seqops(makeAsync(sequences)).windows(21).collect();

      expect(windows.length).toBe(30);
      expect(windows[0]!.kmerSize).toBe(21);

      const size: 21 = windows[0]!.kmerSize;
      expect(size).toBe(21);
    });

    test(".windows(size, options) form works with options", async () => {
      const sequences: AbstractSequence[] = [createSequence("seq1", "ATCGATCGATCG", 1, "")];

      const windows = await seqops(makeAsync(sequences))
        .windows(3, {
          step: 2,
          suffix: "_kmer",
        })
        .collect();

      expect(windows.length).toBe(5);
      expect(windows[0]!.stepSize).toBe(2);
      expect(windows[0]!.suffix).toBe("_kmer");
    });

    test(".windows({size, ...}) object form works", async () => {
      const sequences: AbstractSequence[] = [createSequence("seq1", "A".repeat(50), 1, "")];

      const windows = await seqops(makeAsync(sequences))
        .windows({
          size: 15,
          step: 5,
        })
        .collect();

      expect(windows.length).toBe(8);
      expect(windows[0]!.kmerSize).toBe(15);
    });
  });

  describe(".sliding() alias", () => {
    test("works identically to .windows()", async () => {
      const sequences: AbstractSequence[] = [createSequence("seq1", "ATCGATCG", 1, "")];

      const windows = await seqops(makeAsync(sequences)).windows(4).collect();
      const sliding = await seqops(makeAsync(sequences)).sliding(4).collect();

      expect(sliding.length).toBe(windows.length);
      expect(sliding[0]!.sequence).toEqualSequence(windows[0]!.sequence);
    });
  });

  describe(".kmers() alias", () => {
    test("works identically to .windows()", async () => {
      const sequences: AbstractSequence[] = [createSequence("seq1", "ATCGATCG", 1, "")];

      const windows = await seqops(makeAsync(sequences)).windows(3).collect();
      const kmers = await seqops(makeAsync(sequences)).kmers(3).collect();

      expect(kmers.length).toBe(windows.length);
      expect(kmers[0]!.sequence).toEqualSequence(windows[0]!.sequence);
    });
  });

  describe(".collectSet() type discrimination", () => {
    test("returns KmerSet<K> for k-mer sequences", async () => {
      const sequences: AbstractSequence[] = [createSequence("seq1", "A".repeat(50), 1, "")];

      const kmerSet = await seqops(makeAsync(sequences)).windows(21).collectSet();

      expect(kmerSet).toBeInstanceOf(KmerSet);
      expect(kmerSet.size).toBeGreaterThan(0);

      const arr = kmerSet.toArray();
      const size: 21 = arr[0]!.kmerSize;
      expect(size).toBe(21);
    });

    test("returns SequenceSet<T> for FASTA sequences", async () => {
      const sequences: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, ""),
        createSequence("seq2", "GCTA", 2, ""),
        createSequence("seq3", "ATCG", 3, ""),
      ];

      const seqSet = await seqops(makeAsync(sequences)).collectSet();

      expect(seqSet).toBeInstanceOf(SequenceSet);
      expect(seqSet.size).toBe(2);
    });
  });

  describe("Full pipeline integration", () => {
    test(".windows().collectSet().union() preserves K type", async () => {
      const seq1: AbstractSequence[] = [createSequence("seq1", "ATCGATCGATCG", 1, "")];
      const seq2: AbstractSequence[] = [createSequence("seq2", "GCTAGCTAGCTA", 1, "")];

      const kmers1 = await seqops(makeAsync(seq1)).windows(5).collectSet();
      const kmers2 = await seqops(makeAsync(seq2)).windows(5).collectSet();

      const union = kmers1.union(kmers2);
      const intersection = kmers1.intersection(kmers2);

      expect(union.size).toBeGreaterThanOrEqual(kmers1.size);
      expect(intersection.size).toBeLessThanOrEqual(kmers1.size);

      const unionArr = union.toArray();
      const size: 5 = unionArr[0]!.kmerSize;
      expect(size).toBe(5);
    });
  });

  describe(".filterBySet() method", () => {
    test("excludes contamination sequences", async () => {
      const contaminants = new SequenceSet([createSequence("bad1", "AAAA", 1, "")]);

      const reads: AbstractSequence[] = [
        createSequence("read1", "ATCG", 1, ""),
        createSequence("read2", "AAAA", 2, ""),
        createSequence("read3", "GCTA", 3, ""),
      ];

      const clean = await seqops(makeAsync(reads))
        .filterBySet(contaminants, { exclude: true })
        .collect();

      expect(clean.length).toBe(2);
      expect(clean.find((s) => s.sequence.equals("AAAA"))).toBeUndefined();
      expect(clean[0]!.sequence).toEqualSequence("ATCG");
      expect(clean[1]!.sequence).toEqualSequence("GCTA");
    });

    test("includes only whitelisted sequences", async () => {
      const whitelist = new SequenceSet([createSequence("seq1", "ATCG", 1, "")]);

      const candidates: AbstractSequence[] = [
        createSequence("seq1", "ATCG", 1, ""),
        createSequence("seq2", "GCTA", 2, ""),
      ];

      const approved = await seqops(makeAsync(candidates))
        .filterBySet(whitelist, { exclude: false })
        .collect();

      expect(approved.length).toBe(1);
      expect(approved[0]!.sequence).toEqualSequence("ATCG");
    });

    test("filters by ID instead of sequence content", async () => {
      // Create a set with a specific ID - sequence content doesn't matter for ID filtering
      const idSet = new SequenceSet([createSequence("target_id", "NNNN", 1, "")]);

      const reads: AbstractSequence[] = [
        createSequence("target_id", "ATCG", 1, ""),
        createSequence("other_id", "GCTA", 2, ""),
      ];

      const filtered = await seqops(makeAsync(reads)).filterBySet(idSet, { by: "id" }).collect();

      expect(filtered.length).toBe(1);
      expect(filtered[0]!.id).toBe("target_id");
      expect(filtered[0]!.sequence).toEqualSequence("ATCG");
    });
  });
});
