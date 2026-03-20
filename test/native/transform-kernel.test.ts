import { describe, expect } from "bun:test";
import { createFastaRecord } from "../../src/constructors";
import { packSequences } from "../../src/backend/batch";
import { TransformOp, type TransformResult } from "../../src/backend/kernel-types";
import {
  complement,
  reverse,
  reverseComplement,
  toRNA,
  toDNA,
  removeGaps,
  replaceAmbiguousBases,
} from "../../src/operations/core/sequence-manipulation";
import type { AbstractSequence } from "../../src/types";
import { describeNative, requireNativeKernel, testNative } from "./harness";

function makeSequences(...seqStrings: string[]): AbstractSequence[] {
  return seqStrings.map((s, i) => createFastaRecord({ id: `seq${i}`, sequence: s }));
}

function packStrings(seqStrings: string[]) {
  const seqs = makeSequences(...seqStrings);
  return packSequences(seqs);
}

function transformBatchFromStrings(seqStrings: string[], op: TransformOp): TransformResult {
  const kernel = requireNativeKernel();
  const { data, offsets } = packStrings(seqStrings);
  return kernel.transformBatch(data, offsets, op);
}

function removeGapsBatchFromStrings(seqStrings: string[], gapChars: string = ""): TransformResult {
  const kernel = requireNativeKernel();
  const { data, offsets } = packStrings(seqStrings);
  return kernel.removeGapsBatch(data, offsets, gapChars);
}

function replaceAmbiguousBatchFromStrings(
  seqStrings: string[],
  replacement: string = ""
): TransformResult {
  const kernel = requireNativeKernel();
  const { data, offsets } = packStrings(seqStrings);
  return kernel.replaceAmbiguousBatch(data, offsets, replacement);
}

function unpackResult(result: TransformResult): string[] {
  const sequences: string[] = [];
  for (let i = 0; i + 1 < result.offsets.length; i++) {
    const start = result.offsets[i]!;
    const end = result.offsets[i + 1]!;
    sequences.push(new TextDecoder("ascii").decode(result.data.subarray(start, end)));
  }
  return sequences;
}

describeNative("transform native kernel (requires just build-native-dev)", () => {
  describe("raw FFI contract", () => {
    testNative("complement returns correct results", () => {
      const result = transformBatchFromStrings(["ATCG", "aacc"], TransformOp.Complement);
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["TAGC", "ttgg"]);
    });

    testNative("complementRNA returns correct results", () => {
      const result = transformBatchFromStrings(["ATCG", "AUCG"], TransformOp.ComplementRna);
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["UAGC", "UAGC"]);
    });

    testNative("reverse returns correct results", () => {
      const result = transformBatchFromStrings(["ATCG", "AB"], TransformOp.Reverse);
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["GCTA", "BA"]);
    });

    testNative("reverseComplement returns correct results", () => {
      const result = transformBatchFromStrings(["ATCG"], TransformOp.ReverseComplement);
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["CGAT"]);
    });

    testNative("reverseComplementRNA returns correct results", () => {
      const result = transformBatchFromStrings(["AUCG"], TransformOp.ReverseComplementRna);
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["CGAU"]);
    });

    testNative("toRNA converts T to U", () => {
      const result = transformBatchFromStrings(["ATCG", "atcg"], TransformOp.ToRna);
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["AUCG", "aucg"]);
    });

    testNative("toDNA converts U to T", () => {
      const result = transformBatchFromStrings(["AUCG", "aucg"], TransformOp.ToDna);
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["ATCG", "atcg"]);
    });

    testNative("upperCase converts to uppercase", () => {
      const result = transformBatchFromStrings(["atcg", "A-t.c"], TransformOp.UpperCase);
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["ATCG", "A-T.C"]);
    });

    testNative("lowerCase converts to lowercase", () => {
      const result = transformBatchFromStrings(["ATCG", "A-T.C"], TransformOp.LowerCase);
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["atcg", "a-t.c"]);
    });

    testNative("removeGaps compacts sequences", () => {
      const result = removeGapsBatchFromStrings(["A-T.C*G", "ATCG"]);
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["ATCG", "ATCG"]);
    });

    testNative("removeGaps with custom gap chars", () => {
      const result = removeGapsBatchFromStrings(["AT_C.G"], "_.");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["ATCG"]);
    });

    testNative("removeGaps updates offsets correctly", () => {
      const result = removeGapsBatchFromStrings(["A-T-C", "GG"]);
      expect(result.offsets).toEqual([0, 3, 5]);
    });

    testNative("replaceAmbiguous replaces non-standard bases", () => {
      const result = replaceAmbiguousBatchFromStrings(["ATCGNR"]);
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["ATCGNN"]);
    });

    testNative("replaceAmbiguous with custom replacement", () => {
      const result = replaceAmbiguousBatchFromStrings(["ATCGNR"], "X");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["ATCGXX"]);
    });

    testNative("empty batch returns empty result", () => {
      const kernel = requireNativeKernel();
      const result = kernel.transformBatch(
        Buffer.alloc(0),
        new Uint32Array([0]),
        TransformOp.Complement
      );
      expect(result.data.length).toBe(0);
      expect(result.offsets).toEqual([0]);
    });

    testNative("throws on malformed offsets", () => {
      const kernel = requireNativeKernel();
      expect(() => {
        kernel.transformBatch(
          Buffer.from("ATCG"),
          new Uint32Array([0, 100]),
          TransformOp.Complement
        );
      }).toThrow(/final offset/);
    });
  });

  describe("parity with TypeScript fallback", () => {
    const sequences = ["ATCGATCG", "AtCgAtCg", "RYKMSWBVDHN", "A-T.C*G"];

    testNative("complement parity", () => {
      const result = transformBatchFromStrings(sequences, TransformOp.Complement);
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < sequences.length; i++) {
        const tsResult = complement(sequences[i]!, false);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("complement RNA parity", () => {
      const result = transformBatchFromStrings(sequences, TransformOp.ComplementRna);
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < sequences.length; i++) {
        const tsResult = complement(sequences[i]!, true);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("reverse parity", () => {
      const result = transformBatchFromStrings(sequences, TransformOp.Reverse);
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < sequences.length; i++) {
        const tsResult = reverse(sequences[i]!);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("reverseComplement parity", () => {
      const result = transformBatchFromStrings(sequences, TransformOp.ReverseComplement);
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < sequences.length; i++) {
        const tsResult = reverseComplement(sequences[i]!, false);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("reverseComplementRNA parity", () => {
      const result = transformBatchFromStrings(sequences, TransformOp.ReverseComplementRna);
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < sequences.length; i++) {
        const tsResult = reverseComplement(sequences[i]!, true);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("toRNA parity", () => {
      const dnaSequences = ["ATCGATCG", "AtCgAtCg", "TTTT"];
      const result = transformBatchFromStrings(dnaSequences, TransformOp.ToRna);
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < dnaSequences.length; i++) {
        const tsResult = toRNA(dnaSequences[i]!);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("toDNA parity", () => {
      const rnaSequences = ["AUCGAUCG", "AuCgAuCg", "UUUU"];
      const result = transformBatchFromStrings(rnaSequences, TransformOp.ToDna);
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < rnaSequences.length; i++) {
        const tsResult = toDNA(rnaSequences[i]!);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("removeGaps parity", () => {
      const gapSequences = ["A-T.C*G", "ATCG", "---", "A.B-C"];
      const result = removeGapsBatchFromStrings(gapSequences);
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < gapSequences.length; i++) {
        const tsResult = removeGaps(gapSequences[i]!);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("replaceAmbiguous parity", () => {
      const ambigSequences = ["ATCGNR", "AaTtCcGgUu", "A-T.C*1"];
      const result = replaceAmbiguousBatchFromStrings(ambigSequences);
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < ambigSequences.length; i++) {
        const tsResult = replaceAmbiguousBases(ambigSequences[i]!);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("upperCase parity", () => {
      const caseSequences = ["atcg", "ATCG", "AtCg", "a-t.c*g"];
      const result = transformBatchFromStrings(caseSequences, TransformOp.UpperCase);
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < caseSequences.length; i++) {
        expect(nativeSeqs[i]).toBe(caseSequences[i]!.toUpperCase());
      }
    });

    testNative("lowerCase parity", () => {
      const caseSequences = ["ATCG", "atcg", "AtCg", "A-T.C*G"];
      const result = transformBatchFromStrings(caseSequences, TransformOp.LowerCase);
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < caseSequences.length; i++) {
        expect(nativeSeqs[i]).toBe(caseSequences[i]!.toLowerCase());
      }
    });

    testNative("all operations parity at SIMD boundary lengths", () => {
      const pattern = "ATCGNrykmswbdhv";
      const mk = (len: number): string =>
        pattern.repeat(Math.ceil(len / pattern.length)).slice(0, len);
      const lengths = [15, 16, 17, 31, 32, 33, 63, 64, 65];
      const seqs = lengths.map((n) => mk(n));

      const transformCases: Array<{ op: TransformOp; expected: (s: string) => string }> = [
        { op: TransformOp.Complement, expected: (s) => complement(s, false) },
        { op: TransformOp.ComplementRna, expected: (s) => complement(s, true) },
        { op: TransformOp.Reverse, expected: (s) => reverse(s) },
        { op: TransformOp.ReverseComplement, expected: (s) => reverseComplement(s, false) },
        { op: TransformOp.ReverseComplementRna, expected: (s) => reverseComplement(s, true) },
        { op: TransformOp.ToRna, expected: (s) => toRNA(s) },
        { op: TransformOp.ToDna, expected: (s) => toDNA(s) },
        { op: TransformOp.UpperCase, expected: (s) => s.toUpperCase() },
        { op: TransformOp.LowerCase, expected: (s) => s.toLowerCase() },
      ];

      for (const c of transformCases) {
        const result = transformBatchFromStrings(seqs, c.op);
        const nativeSeqs = unpackResult(result);
        expect(nativeSeqs).toEqual(seqs.map(c.expected));
      }

      const removeGapsResult = removeGapsBatchFromStrings(seqs);
      expect(unpackResult(removeGapsResult)).toEqual(seqs.map((s) => removeGaps(s)));

      const replaceResult = replaceAmbiguousBatchFromStrings(seqs);
      expect(unpackResult(replaceResult)).toEqual(seqs.map((s) => replaceAmbiguousBases(s)));
    });
  });

  describe("known parity divergence", () => {
    testNative("TS throws on empty input, native handles it silently", () => {
      expect(() => complement("")).toThrow();
      expect(() => reverse("")).toThrow();
      expect(() => reverseComplement("")).toThrow();
      expect(() => toRNA("")).toThrow();
      expect(() => toDNA("")).toThrow();

      const result = transformBatchFromStrings([""], TransformOp.Complement);
      expect(unpackResult(result)).toEqual([""]);
    });
  });

  describe("replaceAmbiguous semantics", () => {
    testNative("keeps standard bases, replaces gaps/digits/IUPAC", () => {
      expect(replaceAmbiguousBases("AaTtCcGgUu")).toBe("AaTtCcGgUu");
      expect(replaceAmbiguousBases("A-T.C*1RYK")).toBe("ANTNCNNNNN");

      const result = replaceAmbiguousBatchFromStrings(["AaTtCcGgUu", "A-T.C*1RYK"]);
      expect(unpackResult(result)).toEqual(["AaTtCcGgUu", "ANTNCNNNNN"]);
    });
  });
});
