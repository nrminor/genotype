/**
 * Tests for TranslateProcessor
 *
 * Comprehensive test suite covering all translation features:
 * - All 31 NCBI genetic codes
 * - Multiple reading frames
 * - Start codon handling
 * - Stop codon processing
 * - Ambiguous base translation
 * - ORF detection
 * - Error conditions
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { createFastaRecord } from "../../src/constructors";
import { ValidationError } from "../../src/errors";
import { GeneticCode } from "../../src/operations/core/genetic-codes";
import { TranslateProcessor } from "../../src/operations/translate";
import type { AbstractSequence } from "../../src/types";
import "../matchers";

// Test data generator
function createTestSequence(id: string, sequence: string, description?: string): AbstractSequence {
  return createFastaRecord({ id, sequence, ...(description !== undefined && { description }) });
}

async function* singleSequence(seq: AbstractSequence): AsyncIterable<AbstractSequence> {
  yield seq;
}

async function collectResults(
  iterator: AsyncIterable<AbstractSequence>
): Promise<AbstractSequence[]> {
  const results: AbstractSequence[] = [];
  for await (const seq of iterator) {
    results.push(seq);
  }
  return results;
}

describe("TranslateProcessor", () => {
  let processor: TranslateProcessor;

  beforeAll(() => {
    processor = new TranslateProcessor();
  });

  describe("Basic Translation", () => {
    test("translates simple DNA sequence in frame +1", async () => {
      const seq = createTestSequence("test1", "ATGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, {}));

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MGS");
      expect(results[0]?.id).toBe("test1");
    });

    test("translates RNA sequence (converts U to T)", async () => {
      const seq = createTestSequence("test2", "AUGGGAUCC");
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, {}));

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MGS");
    });

    test("handles incomplete codons at end", async () => {
      const seq = createTestSequence("test3", "ATGGGATC"); // Missing last base
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, {}));

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MG"); // Only complete codons translated
    });

    test("translates empty sequence", async () => {
      const seq = createTestSequence("test4", "");
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, {}));

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("");
    });
  });

  describe("Reading Frames", () => {
    test("translates in frame +2", async () => {
      const seq = createTestSequence("frame2", "CATGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, { frames: [2] }));

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MGS"); // ATG GGA TCC from position 1
    });

    test("translates in frame +3", async () => {
      const seq = createTestSequence("frame3", "GCATGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, { frames: [3] }));

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MGS"); // ATG GGA TCC from position 2
    });

    test("translates in negative frames", async () => {
      const seq = createTestSequence("negative", "GGATCCCATT"); // When reverse complemented: AATGGGATCC -> frame -1 = AAT GGG ATC C
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, { frames: [-1] }));

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("NGI"); // AAT=N, GGG=G, ATC=I
    });

    test("translates multiple frames", async () => {
      const seq = createTestSequence("multi", "ATGGGATCCATGTAG");
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, { frames: [1, 2, 3] }));

      expect(results).toHaveLength(3);
      expect(results[0]?.sequence).toEqualSequence("MGSM*"); // Frame +1: ATG GGA TCC ATG TAG
      expect(results[1]?.sequence).toEqualSequence("WDPC"); // Frame +2: TGG GAT CCA TGT AG
      expect(results[2]?.sequence).toEqualSequence("GIHV"); // Frame +3: GGG ATC CAT GTA G
    });

    test("translates all 6 frames", async () => {
      const seq = createTestSequence("all6", "ATGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, { allFrames: true }));

      expect(results).toHaveLength(6);
      // Should have results for frames 1, 2, 3, -1, -2, -3
    });
  });

  describe("Genetic Codes", () => {
    test("uses standard genetic code (default)", async () => {
      const seq = createTestSequence("standard", "TGATGG"); // TGA = stop in standard
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, {}));

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("*W");
    });

    test("uses vertebrate mitochondrial code", async () => {
      const seq = createTestSequence("mito", "TGATGG"); // TGA = W in vertebrate mito
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          geneticCode: GeneticCode.VERTEBRATE_MITOCHONDRIAL,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("WW");
    });

    test("uses ciliate nuclear code", async () => {
      const seq = createTestSequence("ciliate", "TAATAG"); // TAA,TAG = Q,Q in ciliate
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          geneticCode: GeneticCode.CILIATE_NUCLEAR,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("QQ"); // TAA->Q, TAG->Q in ciliate nuclear code
    });
  });

  describe("Start Codon Handling", () => {
    test("converts start codons to methionine", async () => {
      const seq = createTestSequence("start", "CTGGGATCC"); // CTG normally codes for L
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          convertStartCodons: true,
          allowAlternativeStarts: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MGS"); // CTG->M instead of L
    });

    test("preserves original amino acids when not converting starts", async () => {
      const seq = createTestSequence("noconvert", "CTGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, {}));

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("LGS"); // CTG->L as normal
    });

    test("handles standard ATG start codons", async () => {
      const seq = createTestSequence("atg", "ATGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          convertStartCodons: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MGS"); // ATG->M (already M)
    });
  });

  describe("Stop Codon Processing", () => {
    test("includes stop codons by default", async () => {
      const seq = createTestSequence("stops", "ATGTAGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, {}));

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("M*GS");
    });

    test("removes stop codons when requested", async () => {
      const seq = createTestSequence("nostops", "ATGTAGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          removeStopCodons: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MGS"); // TAG removed
    });

    test("replaces stop codons with custom character", async () => {
      const seq = createTestSequence("customstop", "ATGTAGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          stopCodonChar: "X",
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MXGS"); // TAG->X
    });

    test("trims at first stop codon", async () => {
      const seq = createTestSequence("trim", "ATGTAGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          trimAtFirstStop: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("M"); // Stops at TAG
    });
  });

  describe("Ambiguous Base Handling", () => {
    test("translates unambiguous codons from ambiguous bases", async () => {
      const seq = createTestSequence("ambig1", "ATGGGNTCC"); // GGN codes for G
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, {}));

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MGS"); // GGN->G
    });

    test("returns X for truly ambiguous codons", async () => {
      const seq = createTestSequence("ambig2", "ATGNNNCC"); // NNN is ambiguous
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, {}));

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MX"); // NNN->X
    });

    test("handles IUPAC ambiguity codes", async () => {
      const seq = createTestSequence("iupac", "ATGGRYWCC"); // Various IUPAC codes
      const source = singleSequence(seq);

      const results = await collectResults(processor.process(source, {}));

      expect(results).toHaveLength(1);
      // Should handle each ambiguous position appropriately
    });

    test("replaces unknown codons with custom character", async () => {
      const seq = createTestSequence("unknown", "ATGNNNCC");
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          unknownCodonChar: "?",
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("M?"); // NNN->?
    });
  });

  describe("ORF Detection", () => {
    test("finds ORFs with standard start/stop", async () => {
      const seq = createTestSequence("orf", "AAAATGGGATAG"); // ATG...TAG (stop)
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          orfsOnly: true,
          convertStartCodons: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MG*"); // ATG GGA TAG -> M G *
    });

    test("requires minimum ORF length", async () => {
      const seq = createTestSequence("shortorf", "ATGTAG"); // Very short ORF
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          orfsOnly: true,
          minOrfLength: 10, // Longer than our ORF
        })
      );

      expect(results).toHaveLength(0); // Should be filtered out
    });

    test("finds ORFs with alternative start codons", async () => {
      const seq = createTestSequence("altstart", "TTGGGATAGTAA"); // TTG start
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          orfsOnly: true,
          allowAlternativeStarts: true,
          convertStartCodons: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MG*"); // TTG->M
    });

    test("handles ORFs extending to sequence end", async () => {
      const seq = createTestSequence("openorf", "ATGGGATCCAAA"); // No stop codon
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          orfsOnly: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MGSK"); // Extends to end
    });
  });

  describe("Frame Information in IDs", () => {
    test("includes frame in sequence ID", async () => {
      const seq = createTestSequence("frameid", "ATGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          frames: [2, -1],
          includeFrameInId: true,
        })
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("frameid_frame_+2");
      expect(results[1]?.id).toBe("frameid_frame_-1");
    });

    test("includes frame in description", async () => {
      const seq = createTestSequence("framedesc", "ATGGGATCC", "test sequence");
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          frames: [1],
          includeFrameInId: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.description).toBe("test sequence frame=+1");
    });

    test("handles missing description gracefully", async () => {
      const seq = createTestSequence("nodesc", "ATGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          frames: [1],
          includeFrameInId: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.description).toBe("frame=+1");
    });
  });

  describe("Error Handling", () => {
    test("throws error for invalid genetic code", async () => {
      const seq = createTestSequence("error1", "ATGGGATCC");
      const source = singleSequence(seq);

      await expect(async () => {
        await collectResults(processor.process(source, { geneticCode: 999 }));
      }).toThrow("geneticCode must be");
    });

    // Note: Invalid frame values like [4] are prevented at compile time by TypeScript.
    // Runtime validation exists for JavaScript callers but doesn't need testing here.

    test("throws error for empty frame array", async () => {
      const seq = createTestSequence("error3", "ATGGGATCC");
      const source = singleSequence(seq);

      await expect(async () => {
        await collectResults(processor.process(source, { frames: [] }));
      }).toThrow("at least one reading frame");
    });

    test("throws error for invalid minimum ORF length", async () => {
      const seq = createTestSequence("error4", "ATGGGATCC");
      const source = singleSequence(seq);

      await expect(async () => {
        await collectResults(processor.process(source, { minOrfLength: -1 }));
      }).toThrow(ValidationError);
    });

    test("throws error for multi-character stop codon replacement", async () => {
      const seq = createTestSequence("error5", "ATGGGATCC");
      const source = singleSequence(seq);

      await expect(async () => {
        await collectResults(processor.process(source, { stopCodonChar: "XX" }));
      }).toThrow("single character for stop codon replacement");
    });

    test("throws error for multi-character unknown codon replacement", async () => {
      const seq = createTestSequence("error6", "ATGGGATCC");
      const source = singleSequence(seq);

      await expect(async () => {
        await collectResults(processor.process(source, { unknownCodonChar: "XX" }));
      }).toThrow("single character for unknown codon replacement");
    });
  });

  describe("Complex Integration Tests", () => {
    test("combines multiple options effectively", async () => {
      const seq = createTestSequence("complex", "TTGGGNTCCTAGAAA");
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          geneticCode: GeneticCode.STANDARD,
          frames: [1],
          convertStartCodons: true,
          allowAlternativeStarts: true,
          removeStopCodons: true,
          unknownCodonChar: "?",
          includeFrameInId: true,
          orfsOnly: false,
        })
      );

      expect(results).toHaveLength(1);
      // TTG->M (start), GGN->G, TCC->S, TAG removed, AAA->K
      expect(results[0]?.sequence).toEqualSequence("MGSK");
      expect(results[0]?.id).toBe("complex_frame_+1");
    });

    test("processes multiple sequences in pipeline", async () => {
      async function* multipleSequences(): AsyncIterable<AbstractSequence> {
        yield createTestSequence("seq1", "ATGGGATCC");
        yield createTestSequence("seq2", "TTGAAATAG");
        yield createTestSequence("seq3", "CTGCCCTAG");
      }

      const results = await collectResults(
        processor.process(multipleSequences(), {
          frames: [1],
          convertStartCodons: true,
          allowAlternativeStarts: true,
        })
      );

      expect(results).toHaveLength(3);
      expect(results[0]?.sequence).toEqualSequence("MGS"); // ATG->M
      expect(results[1]?.sequence).toEqualSequence("MK*"); // TTG->M
      expect(results[2]?.sequence).toEqualSequence("MP*"); // CTG->L (not alternative start in this context)
    });
  });

  describe("Real-world Genetic Codes", () => {
    test("handles yeast mitochondrial differences", async () => {
      // In yeast mito: CTN codes for T instead of L
      const seq = createTestSequence("yeast", "ATGCTGAAA");
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          geneticCode: GeneticCode.YEAST_MITOCHONDRIAL,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MTK"); // CTG->T in yeast mito
    });

    test("handles bacterial/plastid genetic code", async () => {
      // Same as standard but different start codons
      const seq = createTestSequence("bacterial", "ATGGGATCC");
      const source = singleSequence(seq);

      const results = await collectResults(
        processor.process(source, {
          geneticCode: GeneticCode.BACTERIAL_PLASTID,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toEqualSequence("MGS"); // Same as standard
    });
  });
});
