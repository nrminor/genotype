import { describe, expect } from "bun:test";
import { createFastaRecord } from "../../src/constructors";
import {
  packSequences,
  ValidationMode,
  NUM_CLASSES,
  CLASS_A,
  CLASS_T,
  CLASS_U,
  CLASS_G,
  CLASS_C,
  CLASS_N,
  CLASS_STRONG,
  CLASS_WEAK,
  CLASS_TWO_BASE,
  CLASS_BDHV,
  CLASS_GAP,
  CLASS_OTHER,
} from "../../src/native";
import type { ClassifyResult } from "../../src/native";
import { gcContent, atContent } from "../../src/operations/core/calculations";
import { SequenceValidator } from "../../src/operations/core/sequence-validation";
import type { AbstractSequence } from "../../src/types";
import { describeNative, requireNativeKernel, testNative } from "./harness";

function makeSequences(...seqStrings: string[]): AbstractSequence[] {
  return seqStrings.map((s, i) => createFastaRecord({ id: `seq${i}`, sequence: s }));
}

function classifyBatchFromStrings(seqStrings: string[]): ClassifyResult {
  const kernel = requireNativeKernel();
  const seqs = makeSequences(...seqStrings);
  const { data, offsets } = packSequences(seqs);
  return kernel.classifyBatch(data, offsets);
}

function checkValidBatchFromStrings(seqStrings: string[], mode: ValidationMode): Buffer {
  const kernel = requireNativeKernel();
  const seqs = makeSequences(...seqStrings);
  const { data, offsets } = packSequences(seqs);
  return kernel.checkValidBatch(data, offsets, mode);
}

/** Extract the 12-element counts slice for a single sequence from a ClassifyResult. */
function countsForSeq(result: ClassifyResult, seqIndex: number): number[] {
  return result.counts.slice(seqIndex * NUM_CLASSES, seqIndex * NUM_CLASSES + NUM_CLASSES);
}

/**
 * Compute gcContent from native 12-class counts using the same fractional
 * weighting as the TS gcContent function.
 *
 * GC = G + C + Strong + 0.5 * TwoBase + 0.5 * (N + BDHV)
 * AT = A + T + U + Weak + 0.5 * TwoBase + 0.5 * (N + BDHV)
 * total = GC + AT
 * result = (GC / total) * 100
 */
function gcContentFromCounts(counts: number[]): number {
  const gc = counts[CLASS_G]! + counts[CLASS_C]! + counts[CLASS_STRONG]!;
  const at = counts[CLASS_A]! + counts[CLASS_T]! + counts[CLASS_U]! + counts[CLASS_WEAK]!;
  const twoBase = counts[CLASS_TWO_BASE]!;
  const multi = counts[CLASS_N]! + counts[CLASS_BDHV]!;

  const gcWeighted = gc + 0.5 * twoBase + 0.5 * multi;
  const atWeighted = at + 0.5 * twoBase + 0.5 * multi;
  const total = gcWeighted + atWeighted;

  return total === 0 ? 0 : (gcWeighted / total) * 100;
}

function atContentFromCounts(counts: number[]): number {
  const gc = counts[CLASS_G]! + counts[CLASS_C]! + counts[CLASS_STRONG]!;
  const at = counts[CLASS_A]! + counts[CLASS_T]! + counts[CLASS_U]! + counts[CLASS_WEAK]!;
  const twoBase = counts[CLASS_TWO_BASE]!;
  const multi = counts[CLASS_N]! + counts[CLASS_BDHV]!;

  const gcWeighted = gc + 0.5 * twoBase + 0.5 * multi;
  const atWeighted = at + 0.5 * twoBase + 0.5 * multi;
  const total = gcWeighted + atWeighted;

  return total === 0 ? 0 : (atWeighted / total) * 100;
}

describeNative("classify native kernel (requires just build-native-dev)", () => {
  describe("classifyBatch raw FFI contract", () => {
    testNative("pure ACGT counts per-base correctly", () => {
      const result = classifyBatchFromStrings(["AACCGGTT"]);
      const counts = countsForSeq(result, 0);
      expect(counts[CLASS_A]).toBe(2);
      expect(counts[CLASS_T]).toBe(2);
      expect(counts[CLASS_U]).toBe(0);
      expect(counts[CLASS_G]).toBe(2);
      expect(counts[CLASS_C]).toBe(2);
      expect(counts[CLASS_N]).toBe(0);
      expect(counts[CLASS_STRONG]).toBe(0);
      expect(counts[CLASS_WEAK]).toBe(0);
      expect(counts[CLASS_TWO_BASE]).toBe(0);
      expect(counts[CLASS_BDHV]).toBe(0);
      expect(counts[CLASS_GAP]).toBe(0);
      expect(counts[CLASS_OTHER]).toBe(0);
    });

    testNative("RNA U gets its own class", () => {
      const result = classifyBatchFromStrings(["AAUUGG"]);
      const counts = countsForSeq(result, 0);
      expect(counts[CLASS_A]).toBe(2);
      expect(counts[CLASS_T]).toBe(0);
      expect(counts[CLASS_U]).toBe(2);
      expect(counts[CLASS_G]).toBe(2);
    });

    testNative("case insensitive for alphabetic bytes", () => {
      const result = classifyBatchFromStrings(["AaCcGgTt"]);
      const counts = countsForSeq(result, 0);
      expect(counts[CLASS_A]).toBe(2);
      expect(counts[CLASS_T]).toBe(2);
      expect(counts[CLASS_G]).toBe(2);
      expect(counts[CLASS_C]).toBe(2);
    });

    testNative("IUPAC strong and weak", () => {
      const result = classifyBatchFromStrings(["SSWWssw"]);
      const counts = countsForSeq(result, 0);
      expect(counts[CLASS_STRONG]).toBe(4);
      expect(counts[CLASS_WEAK]).toBe(3);
    });

    testNative("IUPAC two-base ambiguity codes", () => {
      const result = classifyBatchFromStrings(["RYKMrykm"]);
      const counts = countsForSeq(result, 0);
      expect(counts[CLASS_TWO_BASE]).toBe(8);
    });

    testNative("IUPAC multi-base ambiguity codes", () => {
      const result = classifyBatchFromStrings(["NBDHVnbdhv"]);
      const counts = countsForSeq(result, 0);
      expect(counts[CLASS_N]).toBe(2);
      expect(counts[CLASS_BDHV]).toBe(8);
    });

    testNative("gap characters", () => {
      const result = classifyBatchFromStrings(["A-C.G*T"]);
      const counts = countsForSeq(result, 0);
      expect(counts[CLASS_A]).toBe(1);
      expect(counts[CLASS_T]).toBe(1);
      expect(counts[CLASS_G]).toBe(1);
      expect(counts[CLASS_C]).toBe(1);
      expect(counts[CLASS_GAP]).toBe(3);
    });

    testNative("other characters", () => {
      const result = classifyBatchFromStrings(["ACGT123XZ!"]);
      const counts = countsForSeq(result, 0);
      expect(counts[CLASS_A]).toBe(1);
      expect(counts[CLASS_T]).toBe(1);
      expect(counts[CLASS_G]).toBe(1);
      expect(counts[CLASS_C]).toBe(1);
      expect(counts[CLASS_OTHER]).toBe(6);
    });

    testNative("counts sum to sequence length", () => {
      const seq = "ATCGNrykmswbdhv.-*1XZ";
      const result = classifyBatchFromStrings([seq]);
      const counts = countsForSeq(result, 0);
      const total = counts.reduce((a, b) => a + b, 0);
      expect(total).toBe(seq.length);
    });

    testNative("multiple sequences produce correct flat array", () => {
      const result = classifyBatchFromStrings(["AAAA", "GGGG", "----"]);
      expect(result.counts.length).toBe(3 * NUM_CLASSES);

      const seq0 = countsForSeq(result, 0);
      expect(seq0[CLASS_A]).toBe(4);

      const seq1 = countsForSeq(result, 1);
      expect(seq1[CLASS_G]).toBe(4);

      const seq2 = countsForSeq(result, 2);
      expect(seq2[CLASS_GAP]).toBe(4);
    });

    testNative("empty batch returns empty counts", () => {
      const kernel = requireNativeKernel();
      const result = kernel.classifyBatch(Buffer.alloc(0), new Uint32Array([0]));
      expect(result.counts.length).toBe(0);
    });

    testNative("empty sequence produces all-zero counts", () => {
      const kernel = requireNativeKernel();
      // Two empty sequences: offsets [0, 0, 0]
      const result = kernel.classifyBatch(Buffer.alloc(0), new Uint32Array([0, 0, 0]));
      expect(result.counts.length).toBe(2 * NUM_CLASSES);
      expect(result.counts.every((c) => c === 0)).toBe(true);
    });

    testNative("throws on malformed offsets", () => {
      const kernel = requireNativeKernel();
      expect(() => {
        kernel.classifyBatch(Buffer.from("ATCG"), new Uint32Array([0, 100]));
      }).toThrow(/final offset/);
    });
  });

  describe("checkValidBatch raw FFI contract", () => {
    testNative("StrictDna accepts ACGT and gaps", () => {
      const results = checkValidBatchFromStrings(
        ["ACGTACGT", "acgtacgt", "A-C.G*T"],
        ValidationMode.StrictDna
      );
      expect([...results]).toEqual([1, 1, 1]);
    });

    testNative("StrictDna rejects U", () => {
      const results = checkValidBatchFromStrings(["ACGU"], ValidationMode.StrictDna);
      expect([...results]).toEqual([0]);
    });

    testNative("StrictDna rejects IUPAC ambiguity codes", () => {
      const results = checkValidBatchFromStrings(["ACGTN", "ACGTR"], ValidationMode.StrictDna);
      expect([...results]).toEqual([0, 0]);
    });

    testNative("StrictRna accepts ACGU and gaps", () => {
      const results = checkValidBatchFromStrings(
        ["ACGUACGU", "acguacgu", "A-C.G*U"],
        ValidationMode.StrictRna
      );
      expect([...results]).toEqual([1, 1, 1]);
    });

    testNative("StrictRna rejects T", () => {
      const results = checkValidBatchFromStrings(["ACGT"], ValidationMode.StrictRna);
      expect([...results]).toEqual([0]);
    });

    testNative("NormalDna accepts full IUPAC + gaps", () => {
      const results = checkValidBatchFromStrings(
        ["ACGTURYSWKMBDHVNacgturyswkmbdhvn", "ACGT-.*"],
        ValidationMode.NormalDna
      );
      expect([...results]).toEqual([1, 1]);
    });

    testNative("NormalDna rejects digits", () => {
      const results = checkValidBatchFromStrings(["ACGT123"], ValidationMode.NormalDna);
      expect([...results]).toEqual([0]);
    });

    testNative("NormalRna accepts IUPAC without T", () => {
      const results = checkValidBatchFromStrings(
        ["ACGURYSWKMBDHVNacguryswkmbdhvn"],
        ValidationMode.NormalRna
      );
      expect([...results]).toEqual([1]);
    });

    testNative("NormalRna rejects T", () => {
      const results = checkValidBatchFromStrings(["ACGUT"], ValidationMode.NormalRna);
      expect([...results]).toEqual([0]);
    });

    testNative("Protein accepts standard amino acids + gaps", () => {
      const results = checkValidBatchFromStrings(
        ["ACDEFGHIKLMNPQRSTVWYacdefghiklmnpqrstvwy", "ACDE-.*"],
        ValidationMode.Protein
      );
      expect([...results]).toEqual([1, 1]);
    });

    testNative("Protein rejects non-amino-acid letters", () => {
      const results = checkValidBatchFromStrings(["ACDEX", "ACDE1"], ValidationMode.Protein);
      expect([...results]).toEqual([0, 0]);
    });

    testNative("empty sequence is valid", () => {
      const kernel = requireNativeKernel();
      const results = kernel.checkValidBatch(
        Buffer.alloc(0),
        new Uint32Array([0, 0]),
        ValidationMode.StrictDna
      );
      expect([...results]).toEqual([1]);
    });

    testNative("empty batch returns empty buffer", () => {
      const kernel = requireNativeKernel();
      const results = kernel.checkValidBatch(
        Buffer.alloc(0),
        new Uint32Array([0]),
        ValidationMode.StrictDna
      );
      expect(results.length).toBe(0);
    });

    testNative("throws on malformed offsets", () => {
      const kernel = requireNativeKernel();
      expect(() => {
        kernel.checkValidBatch(
          Buffer.from("ATCG"),
          new Uint32Array([0, 100]),
          ValidationMode.StrictDna
        );
      }).toThrow(/final offset/);
    });
  });

  describe("classifyBatch parity with TS gcContent/atContent", () => {
    const sequences = [
      "ATCGATCG",
      "GGGGGGGG",
      "AAAAAAAA",
      "ATCG",
      "AUCG",
      "SSSSSSSS",
      "WWWWWWWW",
      "RYKMRYKM",
      "NBDHVNBDHV",
      "ATCGNRYKMSWBDHV",
      "A-T.C*G",
    ];

    testNative("gcContent parity", () => {
      const result = classifyBatchFromStrings(sequences);
      for (let i = 0; i < sequences.length; i++) {
        const seq = sequences[i]!;
        const nativeGc = gcContentFromCounts(countsForSeq(result, i));
        const tsGc = gcContent(seq);
        expect(nativeGc).toBeCloseTo(tsGc, 10);
      }
    });

    testNative("atContent parity", () => {
      const result = classifyBatchFromStrings(sequences);
      for (let i = 0; i < sequences.length; i++) {
        const seq = sequences[i]!;
        const nativeAt = atContentFromCounts(countsForSeq(result, i));
        const tsAt = atContent(seq);
        expect(nativeAt).toBeCloseTo(tsAt, 10);
      }
    });

    testNative("gcContent + atContent sum to 100", () => {
      const result = classifyBatchFromStrings(sequences);
      for (let i = 0; i < sequences.length; i++) {
        const counts = countsForSeq(result, i);
        const gc = gcContentFromCounts(counts);
        const at = atContentFromCounts(counts);
        // Only check sequences that have non-gap, non-other bases
        const totalBases =
          counts[CLASS_A]! +
          counts[CLASS_T]! +
          counts[CLASS_U]! +
          counts[CLASS_G]! +
          counts[CLASS_C]! +
          counts[CLASS_N]! +
          counts[CLASS_STRONG]! +
          counts[CLASS_WEAK]! +
          counts[CLASS_TWO_BASE]! +
          counts[CLASS_BDHV]!;
        if (totalBases > 0) {
          expect(gc + at).toBeCloseTo(100, 10);
        }
      }
    });
  });

  describe("checkValidBatch parity with TS SequenceValidator", () => {
    // Sequences that all modes agree on (no dot-gap, which diverges for protein)
    const testSequences = [
      "ACGTACGT",
      "acgtacgt",
      "ACGU",
      "ACGTN",
      "ACGTRYKM",
      "ACGTURYSWKMBDHVNacgturyswkmbdhvn",
      "ACGT123",
      "ACGT XYZ",
      "A-CG*T",
      "ACDEFGHIKLMNPQRSTVWYacdefghiklmnpqrstvwy",
    ];

    testNative("StrictDna parity", () => {
      const validator = new SequenceValidator("strict", "dna");
      const results = checkValidBatchFromStrings(testSequences, ValidationMode.StrictDna);
      for (let i = 0; i < testSequences.length; i++) {
        const tsValid = validator.validate(testSequences[i]!);
        const nativeValid = results[i] === 1;
        expect(nativeValid).toBe(tsValid);
      }
    });

    testNative("NormalDna parity", () => {
      const validator = new SequenceValidator("normal", "dna");
      const results = checkValidBatchFromStrings(testSequences, ValidationMode.NormalDna);
      for (let i = 0; i < testSequences.length; i++) {
        const tsValid = validator.validate(testSequences[i]!);
        const nativeValid = results[i] === 1;
        expect(nativeValid).toBe(tsValid);
      }
    });

    testNative("StrictRna parity", () => {
      const validator = new SequenceValidator("strict", "rna");
      const results = checkValidBatchFromStrings(testSequences, ValidationMode.StrictRna);
      for (let i = 0; i < testSequences.length; i++) {
        const tsValid = validator.validate(testSequences[i]!);
        const nativeValid = results[i] === 1;
        expect(nativeValid).toBe(tsValid);
      }
    });

    testNative("NormalRna parity", () => {
      const validator = new SequenceValidator("normal", "rna");
      const results = checkValidBatchFromStrings(testSequences, ValidationMode.NormalRna);
      for (let i = 0; i < testSequences.length; i++) {
        const tsValid = validator.validate(testSequences[i]!);
        const nativeValid = results[i] === 1;
        expect(nativeValid).toBe(tsValid);
      }
    });

    testNative("Protein parity", () => {
      const validator = new SequenceValidator("normal", "protein");
      const results = checkValidBatchFromStrings(testSequences, ValidationMode.Protein);
      for (let i = 0; i < testSequences.length; i++) {
        const tsValid = validator.validate(testSequences[i]!);
        const nativeValid = results[i] === 1;
        expect(nativeValid).toBe(tsValid);
      }
    });
  });

  describe("classifyBatch at SIMD boundary lengths", () => {
    const pattern = "ATCGNrykmswbdhv";
    const mk = (len: number): string =>
      pattern.repeat(Math.ceil(len / pattern.length)).slice(0, len);
    const lengths = [15, 16, 17, 31, 32, 33, 63, 64, 65];

    testNative("counts sum to length at all boundaries", () => {
      const seqs = lengths.map((n) => mk(n));
      const result = classifyBatchFromStrings(seqs);
      for (let i = 0; i < lengths.length; i++) {
        const counts = countsForSeq(result, i);
        const total = counts.reduce((a, b) => a + b, 0);
        expect(total).toBe(lengths[i]!);
      }
    });

    testNative("classify produces exact expected counts at each length", () => {
      // Compute expected counts with a scalar oracle so we're not just
      // checking non-negative (which is vacuously true for u32).
      const classifyScalar = (s: string): number[] => {
        const counts = new Array<number>(NUM_CLASSES).fill(0);
        for (let j = 0; j < s.length; j++) {
          const upper = s[j]!.toUpperCase();
          if (upper === "A") counts[CLASS_A]!++;
          else if (upper === "T") counts[CLASS_T]!++;
          else if (upper === "U") counts[CLASS_U]!++;
          else if (upper === "G") counts[CLASS_G]!++;
          else if (upper === "C") counts[CLASS_C]!++;
          else if (upper === "N") counts[CLASS_N]!++;
          else if (upper === "S") counts[CLASS_STRONG]!++;
          else if (upper === "W") counts[CLASS_WEAK]!++;
          else if ("RYKM".includes(upper)) counts[CLASS_TWO_BASE]!++;
          else if ("BDHV".includes(upper)) counts[CLASS_BDHV]!++;
          else if ("-.*".includes(s[j]!)) counts[CLASS_GAP]!++;
          else counts[CLASS_OTHER]!++;
        }
        return counts;
      };

      const seqs = lengths.map((n) => mk(n));
      const result = classifyBatchFromStrings(seqs);
      for (let i = 0; i < lengths.length; i++) {
        const actual = countsForSeq(result, i);
        const expected = classifyScalar(seqs[i]!);
        expect(actual).toEqual(expected);
      }
    });
  });

  describe("checkValidBatch at SIMD boundary lengths", () => {
    const lengths = [15, 16, 17, 31, 32, 33, 63, 64, 65];

    testNative("all-valid sequences pass at all boundaries", () => {
      const seqs = lengths.map((n) => "ACGT".repeat(Math.ceil(n / 4)).slice(0, n));
      const results = checkValidBatchFromStrings(seqs, ValidationMode.StrictDna);
      expect([...results]).toEqual(lengths.map(() => 1));
    });

    testNative("single invalid byte at end detected at all boundaries", () => {
      const seqs = lengths.map((n) => {
        const clean = "ACGT".repeat(Math.ceil(n / 4)).slice(0, n);
        return clean.slice(0, -1) + "X";
      });
      const results = checkValidBatchFromStrings(seqs, ValidationMode.StrictDna);
      expect([...results]).toEqual(lengths.map(() => 0));
    });

    testNative("single invalid byte at start detected at all boundaries", () => {
      const seqs = lengths.map((n) => {
        const clean = "ACGT".repeat(Math.ceil(n / 4)).slice(0, n);
        return "X" + clean.slice(1);
      });
      const results = checkValidBatchFromStrings(seqs, ValidationMode.StrictDna);
      expect([...results]).toEqual(lengths.map(() => 0));
    });
  });

  describe("classifyBatch accumulator flush (long sequences)", () => {
    // The Rust SIMD classifier uses u8 accumulators that flush every 255
    // chunks to avoid overflow. With N=16 lanes (aarch64 NEON / x86 SSE),
    // flush triggers at 255 * 16 = 4080 bytes. These tests exercise that
    // boundary through the full FFI path.

    const classifyScalar = (s: string): number[] => {
      const counts = new Array<number>(NUM_CLASSES).fill(0);
      for (let j = 0; j < s.length; j++) {
        const upper = s[j]!.toUpperCase();
        if (upper === "A") counts[CLASS_A]!++;
        else if (upper === "T") counts[CLASS_T]!++;
        else if (upper === "U") counts[CLASS_U]!++;
        else if (upper === "G") counts[CLASS_G]!++;
        else if (upper === "C") counts[CLASS_C]!++;
        else if (upper === "N") counts[CLASS_N]!++;
        else if (upper === "S") counts[CLASS_STRONG]!++;
        else if (upper === "W") counts[CLASS_WEAK]!++;
        else if ("RYKM".includes(upper)) counts[CLASS_TWO_BASE]!++;
        else if ("BDHV".includes(upper)) counts[CLASS_BDHV]!++;
        else if ("-.*".includes(s[j]!)) counts[CLASS_GAP]!++;
        else counts[CLASS_OTHER]!++;
      }
      return counts;
    };

    const pattern = "ATCGNrykmswbdhv";
    const mk = (len: number): string =>
      pattern.repeat(Math.ceil(len / pattern.length)).slice(0, len);

    testNative("exact counts at flush boundary (4079/4080/4081)", () => {
      const flushLengths = [4079, 4080, 4081];
      const seqs = flushLengths.map((n) => mk(n));
      const result = classifyBatchFromStrings(seqs);
      for (let i = 0; i < flushLengths.length; i++) {
        const actual = countsForSeq(result, i);
        const expected = classifyScalar(seqs[i]!);
        expect(actual).toEqual(expected);
      }
    });

    testNative("multiple flushes with remainder", () => {
      // 2 full flush cycles + remainder: 2 * 255 * 16 + 7 = 8167
      const len = 2 * 255 * 16 + 7;
      const seq = mk(len);
      const result = classifyBatchFromStrings([seq]);
      const actual = countsForSeq(result, 0);
      const expected = classifyScalar(seq);
      expect(actual).toEqual(expected);
    });

    testNative("all-one-class long sequence (maximal per-lane pressure)", () => {
      const len = 255 * 16 + 1;
      const seq = "A".repeat(len);
      const result = classifyBatchFromStrings([seq]);
      const counts = countsForSeq(result, 0);
      expect(counts[CLASS_A]).toBe(len);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(len);
    });
  });

  describe("hasAmbiguous parity via classify counts", () => {
    testNative("sequences with only ACGTU have no ambiguity", () => {
      const seqs = ["ACGT", "AUCG", "acgt", "AaCcGgTtUu"];
      const result = classifyBatchFromStrings(seqs);
      for (let i = 0; i < seqs.length; i++) {
        const counts = countsForSeq(result, i);
        const hasAmbig =
          counts[CLASS_N]! +
            counts[CLASS_STRONG]! +
            counts[CLASS_WEAK]! +
            counts[CLASS_TWO_BASE]! +
            counts[CLASS_BDHV]! >
          0;
        expect(hasAmbig).toBe(false);
      }
    });

    testNative("sequences with IUPAC codes have ambiguity", () => {
      const seqs = ["ACGTN", "ACGTR", "ACGTS", "ACGTW", "NBDHV"];
      const result = classifyBatchFromStrings(seqs);
      for (let i = 0; i < seqs.length; i++) {
        const counts = countsForSeq(result, i);
        const hasAmbig =
          counts[CLASS_N]! +
            counts[CLASS_STRONG]! +
            counts[CLASS_WEAK]! +
            counts[CLASS_TWO_BASE]! +
            counts[CLASS_BDHV]! >
          0;
        expect(hasAmbig).toBe(true);
      }
    });
  });

  describe("replaceInvalidBatch", () => {
    testNative("replaces invalid bytes in StrictDna mode", () => {
      const kernel = requireNativeKernel();
      const seqs = makeSequences("ACGT", "ACGX", "acgt");
      const { data, offsets } = packSequences(seqs);
      const result = kernel.replaceInvalidBatch(data, offsets, ValidationMode.StrictDna, "N");
      expect(result.data.toString()).toBe("ACGTACGNacgt");
    });

    testNative("StrictRna replaces T with replacement", () => {
      const kernel = requireNativeKernel();
      const seqs = makeSequences("ACGUT");
      const { data, offsets } = packSequences(seqs);
      const result = kernel.replaceInvalidBatch(data, offsets, ValidationMode.StrictRna, "N");
      expect(result.data.toString()).toBe("ACGUN");
    });

    testNative("NormalDna preserves IUPAC codes", () => {
      const kernel = requireNativeKernel();
      const seqs = makeSequences("ACGTURYSWKMBDHVN");
      const { data, offsets } = packSequences(seqs);
      const result = kernel.replaceInvalidBatch(data, offsets, ValidationMode.NormalDna, "X");
      expect(result.data.toString()).toBe("ACGTURYSWKMBDHVN");
    });

    testNative("NormalRna rejects T", () => {
      const kernel = requireNativeKernel();
      const seqs = makeSequences("ACGUT");
      const { data, offsets } = packSequences(seqs);
      const result = kernel.replaceInvalidBatch(data, offsets, ValidationMode.NormalRna, "N");
      expect(result.data.toString()).toBe("ACGUN");
    });

    testNative("preserves offsets for length-preserving transform", () => {
      const kernel = requireNativeKernel();
      const seqs = makeSequences("ACGT", "XX");
      const { data, offsets } = packSequences(seqs);
      const result = kernel.replaceInvalidBatch(data, offsets, ValidationMode.StrictDna, "N");
      expect(Array.from(result.offsets)).toEqual([0, 4, 6]);
    });

    testNative("parity with SequenceValidator.clean for StrictDna", () => {
      const kernel = requireNativeKernel();
      const validator = new SequenceValidator("strict", "dna");
      const inputs = ["ACGT", "ACGN123", "atcg", "A-T.C*G", ""];
      const seqs = makeSequences(...inputs);
      const { data, offsets } = packSequences(seqs);
      const result = kernel.replaceInvalidBatch(data, offsets, ValidationMode.StrictDna, "N");

      for (let i = 0; i < inputs.length; i++) {
        const start = result.offsets[i]!;
        const end = result.offsets[i + 1]!;
        const kernelOutput = result.data.subarray(start, end).toString();
        const tsOutput = validator.clean(inputs[i]!, "N");
        expect(kernelOutput).toBe(tsOutput);
      }
    });
  });

  describe("known parity divergences", () => {
    testNative("TS gcContent throws on empty, native returns zero counts", () => {
      expect(() => gcContent("")).toThrow();

      const kernel = requireNativeKernel();
      const result = kernel.classifyBatch(Buffer.alloc(0), new Uint32Array([0, 0]));
      const counts = countsForSeq(result, 0);
      expect(counts.every((c) => c === 0)).toBe(true);
    });

    testNative("TS validator treats empty as valid, native also treats empty as valid", () => {
      const validator = new SequenceValidator("strict", "dna");
      expect(validator.validate("")).toBe(true);

      const kernel = requireNativeKernel();
      const results = kernel.checkValidBatch(
        Buffer.alloc(0),
        new Uint32Array([0, 0]),
        ValidationMode.StrictDna
      );
      expect(results[0]).toBe(1);
    });

    testNative("Protein dot-gap: native accepts '.', TS IUPAC_PROTEIN rejects it", () => {
      // The Rust kernel treats all three gap characters (-, ., *) uniformly
      // across all modes. The TS IUPAC_PROTEIN regex only includes - and *
      // but not dot. This is a known divergence.
      const validator = new SequenceValidator("normal", "protein");
      expect(validator.validate("A.C")).toBe(false);

      const results = checkValidBatchFromStrings(["A.C"], ValidationMode.Protein);
      expect(results[0]).toBe(1);
    });
  });
});
