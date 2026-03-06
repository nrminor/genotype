import { describe, expect } from "bun:test";
import { createFastaRecord } from "../../src/constructors";
import { packSequences } from "../../src/native";
import type { TransformResult } from "../../src/native";
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

function transformBatchFromStrings(
  seqStrings: string[],
  operation: string,
  param: string = ""
): TransformResult {
  const kernel = requireNativeKernel();
  const seqs = makeSequences(...seqStrings);
  const { data, offsets } = packSequences(seqs);
  return kernel.transformBatch(data, offsets, operation, param);
}

function unpackResult(result: TransformResult): string[] {
  const sequences: string[] = [];
  for (let i = 0; i + 1 < result.offsets.length; i++) {
    const start = result.offsets[i]!;
    const end = result.offsets[i + 1]!;
    sequences.push(result.data.subarray(start, end).toString("ascii"));
  }
  return sequences;
}

describeNative("transform native kernel (requires just build-native-dev)", () => {
  describe("raw FFI contract", () => {
    testNative("complement returns correct results", () => {
      const result = transformBatchFromStrings(["ATCG", "aacc"], "complement");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["TAGC", "ttgg"]);
    });

    testNative("complementRNA returns correct results", () => {
      const result = transformBatchFromStrings(["ATCG", "AUCG"], "complementRNA");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["UAGC", "UAGC"]);
    });

    testNative("reverse returns correct results", () => {
      const result = transformBatchFromStrings(["ATCG", "AB"], "reverse");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["GCTA", "BA"]);
    });

    testNative("reverseComplement returns correct results", () => {
      const result = transformBatchFromStrings(["ATCG"], "reverseComplement");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["CGAT"]);
    });

    testNative("reverseComplementRNA returns correct results", () => {
      const result = transformBatchFromStrings(["AUCG"], "reverseComplementRNA");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["CGAU"]);
    });

    testNative("toRNA converts T to U", () => {
      const result = transformBatchFromStrings(["ATCG", "atcg"], "toRNA");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["AUCG", "aucg"]);
    });

    testNative("toDNA converts U to T", () => {
      const result = transformBatchFromStrings(["AUCG", "aucg"], "toDNA");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["ATCG", "atcg"]);
    });

    testNative("upperCase converts to uppercase", () => {
      const result = transformBatchFromStrings(["atcg", "A-t.c"], "upperCase");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["ATCG", "A-T.C"]);
    });

    testNative("lowerCase converts to lowercase", () => {
      const result = transformBatchFromStrings(["ATCG", "A-T.C"], "lowerCase");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["atcg", "a-t.c"]);
    });

    testNative("removeGaps compacts sequences", () => {
      const result = transformBatchFromStrings(["A-T.C*G", "ATCG"], "removeGaps");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["ATCG", "ATCG"]);
    });

    testNative("removeGaps with custom gap chars", () => {
      const result = transformBatchFromStrings(["AT_C.G"], "removeGaps", "_.");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["ATCG"]);
    });

    testNative("removeGaps updates offsets correctly", () => {
      const result = transformBatchFromStrings(["A-T-C", "GG"], "removeGaps");
      expect(result.offsets).toEqual([0, 3, 5]);
    });

    testNative("replaceAmbiguous replaces non-standard bases", () => {
      const result = transformBatchFromStrings(["ATCGNR"], "replaceAmbiguous");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["ATCGNN"]);
    });

    testNative("replaceAmbiguous with custom replacement", () => {
      const result = transformBatchFromStrings(["ATCGNR"], "replaceAmbiguous", "X");
      const seqs = unpackResult(result);
      expect(seqs).toEqual(["ATCGXX"]);
    });

    testNative("empty batch returns empty result", () => {
      const kernel = requireNativeKernel();
      const result = kernel.transformBatch(Buffer.alloc(0), new Uint32Array([0]), "complement", "");
      expect(result.data.length).toBe(0);
      expect(result.offsets).toEqual([0]);
    });

    testNative("throws on unknown operation", () => {
      const kernel = requireNativeKernel();
      expect(() => {
        kernel.transformBatch(Buffer.from("ATCG"), new Uint32Array([0, 4]), "bogus", "");
      }).toThrow(/unknown operation/);
    });

    testNative("throws on malformed offsets", () => {
      const kernel = requireNativeKernel();
      expect(() => {
        kernel.transformBatch(Buffer.from("ATCG"), new Uint32Array([0, 100]), "complement", "");
      }).toThrow(/final offset/);
    });
  });

  describe("parity with TypeScript fallback", () => {
    const sequences = ["ATCGATCG", "AtCgAtCg", "RYKMSWBVDHN", "A-T.C*G"];

    testNative("complement parity", () => {
      const result = transformBatchFromStrings(sequences, "complement");
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < sequences.length; i++) {
        const tsResult = complement(sequences[i]!, false);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("complement RNA parity", () => {
      const result = transformBatchFromStrings(sequences, "complementRNA");
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < sequences.length; i++) {
        const tsResult = complement(sequences[i]!, true);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("reverse parity", () => {
      const result = transformBatchFromStrings(sequences, "reverse");
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < sequences.length; i++) {
        const tsResult = reverse(sequences[i]!);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("reverseComplement parity", () => {
      const result = transformBatchFromStrings(sequences, "reverseComplement");
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < sequences.length; i++) {
        const tsResult = reverseComplement(sequences[i]!, false);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("reverseComplementRNA parity", () => {
      const result = transformBatchFromStrings(sequences, "reverseComplementRNA");
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < sequences.length; i++) {
        const tsResult = reverseComplement(sequences[i]!, true);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("toRNA parity", () => {
      const dnaSequences = ["ATCGATCG", "AtCgAtCg", "TTTT"];
      const result = transformBatchFromStrings(dnaSequences, "toRNA");
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < dnaSequences.length; i++) {
        const tsResult = toRNA(dnaSequences[i]!);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("toDNA parity", () => {
      const rnaSequences = ["AUCGAUCG", "AuCgAuCg", "UUUU"];
      const result = transformBatchFromStrings(rnaSequences, "toDNA");
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < rnaSequences.length; i++) {
        const tsResult = toDNA(rnaSequences[i]!);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("removeGaps parity", () => {
      const gapSequences = ["A-T.C*G", "ATCG", "---", "A.B-C"];
      const result = transformBatchFromStrings(gapSequences, "removeGaps");
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < gapSequences.length; i++) {
        const tsResult = removeGaps(gapSequences[i]!);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("replaceAmbiguous parity", () => {
      const ambigSequences = ["ATCGNR", "AaTtCcGgUu", "A-T.C*1"];
      const result = transformBatchFromStrings(ambigSequences, "replaceAmbiguous");
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < ambigSequences.length; i++) {
        const tsResult = replaceAmbiguousBases(ambigSequences[i]!);
        expect(nativeSeqs[i]).toBe(tsResult);
      }
    });

    testNative("upperCase parity", () => {
      const caseSequences = ["atcg", "ATCG", "AtCg", "a-t.c*g"];
      const result = transformBatchFromStrings(caseSequences, "upperCase");
      const nativeSeqs = unpackResult(result);
      for (let i = 0; i < caseSequences.length; i++) {
        expect(nativeSeqs[i]).toBe(caseSequences[i]!.toUpperCase());
      }
    });

    testNative("lowerCase parity", () => {
      const caseSequences = ["ATCG", "atcg", "AtCg", "A-T.C*G"];
      const result = transformBatchFromStrings(caseSequences, "lowerCase");
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

      const cases: Array<{ op: string; param?: string; expected: (s: string) => string }> = [
        { op: "complement", expected: (s) => complement(s, false) },
        { op: "complementRNA", expected: (s) => complement(s, true) },
        { op: "reverse", expected: (s) => reverse(s) },
        { op: "reverseComplement", expected: (s) => reverseComplement(s, false) },
        { op: "reverseComplementRNA", expected: (s) => reverseComplement(s, true) },
        { op: "toRNA", expected: (s) => toRNA(s) },
        { op: "toDNA", expected: (s) => toDNA(s) },
        { op: "upperCase", expected: (s) => s.toUpperCase() },
        { op: "lowerCase", expected: (s) => s.toLowerCase() },
        { op: "removeGaps", expected: (s) => removeGaps(s) },
        { op: "replaceAmbiguous", expected: (s) => replaceAmbiguousBases(s) },
      ];

      for (const c of cases) {
        const result = transformBatchFromStrings(seqs, c.op, c.param ?? "");
        const nativeSeqs = unpackResult(result);
        expect(nativeSeqs).toEqual(seqs.map(c.expected));
      }
    });
  });

  describe("known parity divergence", () => {
    testNative("TS throws on empty input, native handles it silently", () => {
      expect(() => complement("")).toThrow();
      expect(() => reverse("")).toThrow();
      expect(() => reverseComplement("")).toThrow();
      expect(() => toRNA("")).toThrow();
      expect(() => toDNA("")).toThrow();

      const result = transformBatchFromStrings([""], "complement");
      expect(unpackResult(result)).toEqual([""]);
    });
  });

  describe("replaceAmbiguous semantics", () => {
    testNative("keeps standard bases, replaces gaps/digits/IUPAC", () => {
      expect(replaceAmbiguousBases("AaTtCcGgUu")).toBe("AaTtCcGgUu");
      expect(replaceAmbiguousBases("A-T.C*1RYK")).toBe("ANTNCNNNNN");

      const result = transformBatchFromStrings(["AaTtCcGgUu", "A-T.C*1RYK"], "replaceAmbiguous");
      expect(unpackResult(result)).toEqual(["AaTtCcGgUu", "ANTNCNNNNN"]);
    });
  });
});
