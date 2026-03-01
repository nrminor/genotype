import { describe, expect, test } from "bun:test";
import { createFastaRecord } from "../../src/constructors";
import { packSequences } from "../../src/native";

describe("packSequences", () => {
  test("packs sequences into contiguous buffer with correct offsets", () => {
    const seqs = [
      createFastaRecord({ id: "a", sequence: "ATCG" }),
      createFastaRecord({ id: "b", sequence: "GG" }),
      createFastaRecord({ id: "c", sequence: "TTTAAA" }),
    ];
    const { data, offsets } = packSequences(seqs);

    expect(offsets).toEqual(new Uint32Array([0, 4, 6, 12]));
    expect(Buffer.from(data).toString()).toBe("ATCGGGTTTAAA");
  });

  test("empty array produces empty buffer and single zero offset", () => {
    const { data, offsets } = packSequences([]);

    expect(data.length).toBe(0);
    expect(offsets).toEqual(new Uint32Array([0]));
  });

  test("handles empty sequences among non-empty", () => {
    const seqs = [
      createFastaRecord({ id: "a", sequence: "ATCG" }),
      createFastaRecord({ id: "b", sequence: "" }),
      createFastaRecord({ id: "c", sequence: "GG" }),
    ];
    const { data, offsets } = packSequences(seqs);

    expect(offsets).toEqual(new Uint32Array([0, 4, 4, 6]));
    expect(Buffer.from(data).toString()).toBe("ATCGGG");
  });

  test("single sequence", () => {
    const seqs = [createFastaRecord({ id: "a", sequence: "ATCGATCG" })];
    const { data, offsets } = packSequences(seqs);

    expect(offsets).toEqual(new Uint32Array([0, 8]));
    expect(Buffer.from(data).toString()).toBe("ATCGATCG");
  });

  test("offsets are monotonically non-decreasing", () => {
    const seqs = [
      createFastaRecord({ id: "a", sequence: "AAA" }),
      createFastaRecord({ id: "b", sequence: "" }),
      createFastaRecord({ id: "c", sequence: "" }),
      createFastaRecord({ id: "d", sequence: "TT" }),
    ];
    const { offsets } = packSequences(seqs);

    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]!).toBeGreaterThanOrEqual(offsets[i - 1]!);
    }
  });

  test("final offset equals total byte length", () => {
    const seqs = [
      createFastaRecord({ id: "a", sequence: "ATCG" }),
      createFastaRecord({ id: "b", sequence: "GGG" }),
    ];
    const { data, offsets } = packSequences(seqs);

    expect(offsets[offsets.length - 1]).toBe(data.length);
  });

  test("individual sequences can be recovered from packed layout", () => {
    const originals = ["ATCGATCG", "GG", "TTTAAACCC", "A"];
    const seqs = originals.map((s, i) => createFastaRecord({ id: `seq${i}`, sequence: s }));
    const { data, offsets } = packSequences(seqs);

    for (let i = 0; i < originals.length; i++) {
      const start = offsets[i]!;
      const end = offsets[i + 1]!;
      const recovered = Buffer.from(data.buffer, data.byteOffset + start, end - start).toString();
      expect(recovered).toBe(originals[i]!);
    }
  });
});
