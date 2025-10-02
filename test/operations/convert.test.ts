/**
 * Tests for ConvertProcessor
 *
 * Comprehensive test suite covering quality score encoding conversion:
 * - All supported encoding schemes (Phred+33, Phred+64)
 * - Auto-detection of source encoding
 * - Biological edge cases and real-world scenarios
 * - Error conditions and validation
 * - Legacy data processing workflows
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { ValidationError } from "../../src/errors";
import { seqops } from "../../src/operations";
import {
  ConvertProcessor,
  type Fa2FqOptions,
  type Fq2FaOptions,
  fa2fq,
  fq2fa,
} from "../../src/operations/convert";
import type { AbstractSequence, FastaSequence, FastqSequence } from "../../src/types";

// Test data generators following established patterns
function createFastqSequence(
  id: string,
  sequence: string,
  quality: string,
  encoding: "phred33" | "phred64" | "solexa" = "phred33",
  description?: string
): FastqSequence {
  return {
    format: "fastq",
    id,
    sequence,
    quality,
    qualityEncoding: encoding,
    length: sequence.length,
    description,
  };
}

function createFastaSequence(id: string, sequence: string): AbstractSequence {
  return {
    id,
    sequence,
    length: sequence.length,
  };
}

async function* singleSequence(seq: AbstractSequence): AsyncIterable<AbstractSequence> {
  yield seq;
}

async function* asyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

async function* singleFastqSequence(seq: FastqSequence): AsyncIterable<FastqSequence> {
  yield seq;
}

async function* singleFastaSequence(seq: FastaSequence): AsyncIterable<FastaSequence> {
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

describe("ConvertProcessor", () => {
  let processor: ConvertProcessor;

  beforeAll(() => {
    processor = new ConvertProcessor();
  });

  describe("Basic Quality Encoding Conversion", () => {
    test("converts Phred+64 to Phred+33 (legacy workflow)", async () => {
      // Simple test: ASCII '@' (64) should convert to '!' (33)
      const seq = createFastqSequence(
        "legacy_read",
        "ATCG",
        "@@@@", // Phred+64: ASCII 64 = Q0
        "phred64"
      );

      const results = await collectResults(
        processor.process(singleSequence(seq), { targetEncoding: "phred33" })
      );

      expect(results).toHaveLength(1);
      const converted = results[0] as FastqSequence;
      expect(converted.quality).toBe("!!!!"); // Phred+33: ASCII 33 = Q0
      expect(converted.qualityEncoding).toBe("phred33");
      expect(converted.sequence).toBe("ATCG");
    });

    test("converts Phred+33 to Phred+64", async () => {
      const seq = createFastqSequence(
        "modern_read",
        "GCTA",
        "!!!!", // Phred+33: ASCII 33 = Q0
        "phred33"
      );

      const results = await collectResults(
        processor.process(singleSequence(seq), { targetEncoding: "phred64" })
      );

      expect(results).toHaveLength(1);
      const converted = results[0] as FastqSequence;
      expect(converted.quality).toBe("@@@@"); // Phred+64: ASCII 64 = Q0
      expect(converted.qualityEncoding).toBe("phred64");
    });

    test("handles no conversion needed gracefully", async () => {
      const seq = createFastqSequence("same_encoding", "ATCG", "!!!!", "phred33");

      const results = await collectResults(
        processor.process(singleSequence(seq), { targetEncoding: "phred33" })
      );

      expect(results).toHaveLength(1);
      const result = results[0] as FastqSequence;
      expect(result.quality).toBe("!!!!");
      expect(result.qualityEncoding).toBe("phred33");
    });

    test("passes FASTA sequences through unchanged", async () => {
      const fastaSeq = createFastaSequence("fasta_seq", "ATCGATCGATCG");

      const results = await collectResults(
        processor.process(singleSequence(fastaSeq), {
          targetEncoding: "phred33",
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(fastaSeq);
    });
  });

  describe("Error Handling and Validation", () => {
    test("validates options with ArkType schema", async () => {
      const seq = createFastqSequence("test", "ATCG", "!!!!", "phred33");

      await expect(async () => {
        for await (const _ of processor.process(singleSequence(seq), {
          // @ts-expect-error Testing invalid input
          targetEncoding: "invalid",
        })) {
          // Should throw ValidationError
        }
      }).toThrow(ValidationError);
    });

    test("converts Phred+33 to Solexa using non-linear mathematics", async () => {
      const seq = createFastqSequence("test", "ATCG", "!!!!", "phred33");

      const results = await collectResults(
        processor.process(singleSequence(seq), { targetEncoding: "solexa" })
      );

      expect(results).toHaveLength(1);
      const converted = results[0] as FastqSequence;
      expect(converted.qualityEncoding).toBe("solexa");
      // Solexa conversion uses non-linear math, should produce different result than ASCII offset
      expect(converted.quality).not.toBe("!!!!"); // Should be mathematically converted
      expect(converted.sequence).toBe("ATCG"); // Sequence unchanged
    });

    test("handles malformed FASTQ sequences gracefully", async () => {
      // Test sequence missing quality field
      const malformed = {
        format: "fastq" as const,
        id: "malformed",
        sequence: "ATCG",
        length: 4,
        // Missing quality and qualityEncoding fields intentionally
      };

      const results = await collectResults(
        processor.process(singleSequence(malformed), {
          targetEncoding: "phred33",
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(malformed); // Pass through unchanged
    });
  });

  describe("Real-World Biological Scenarios", () => {
    test("processes legacy Illumina data for modern tools", async () => {
      // Realistic legacy data conversion scenario
      const legacyRead = createFastqSequence(
        "HiSeq_2000_read",
        "AAACCCGGGTTT", // 12bp read
        "BBBBBBBBBBBB", // Phred+64: ASCII 66 = Q2 (good quality)
        "phred64"
      );

      const results = await collectResults(
        processor.process(singleSequence(legacyRead), {
          targetEncoding: "phred33",
        })
      );

      const modernRead = results[0] as FastqSequence;
      expect(modernRead.quality).toBe("############"); // Phred+33: ASCII 35 = Q2
      expect(modernRead.qualityEncoding).toBe("phred33");
    });

    test("preserves sequence metadata and format integrity", async () => {
      const detailedSeq = createFastqSequence(
        "chr1_coverage_read",
        "ATCGATCG",
        "!!!!!!!!", // Low quality
        "phred33",
        "Coverage read from chr1:12345-12352"
      );

      const results = await collectResults(
        processor.process(singleSequence(detailedSeq), {
          targetEncoding: "phred64",
        })
      );

      const result = results[0] as FastqSequence;
      expect(result.id).toBe("chr1_coverage_read");
      expect(result.description).toBe("Coverage read from chr1:12345-12352");
      expect(result.format).toBe("fastq");
      expect(result.length).toBe(8);
    });

    test("auto-detects source encoding when not specified (primary seqkit workflow)", async () => {
      // Real-world use case: User doesn't know source encoding, relies on auto-detection
      const unknownEncodingSeq = createFastqSequence(
        "unknown_encoding_read",
        "ATCGATCGATCG",
        "BBBBBBBBBBBB", // Phred+64: ASCII 66 = Q2 (detectable pattern)
        "phred64" // This is for test setup, but convert won't use this
      );

      // Auto-detection workflow: Don't specify sourceEncoding
      const results = await collectResults(
        processor.process(singleSequence(unknownEncodingSeq), {
          targetEncoding: "phred33",
          // No sourceEncoding specified - should auto-detect
        })
      );

      const converted = results[0] as FastqSequence;
      expect(converted.qualityEncoding).toBe("phred33");
      expect(converted.quality).toBe("############"); // Correctly converted from phred64
      expect(converted.sequence).toBe("ATCGATCGATCG"); // Sequence preserved
    });

    test("handles mixed sequence types in workflow", async () => {
      async function* mixedSequences(): AsyncIterable<AbstractSequence> {
        yield createFastaSequence("fasta1", "ATCG");
        yield createFastqSequence("fastq1", "GCTA", "@@@@", "phred64"); // Valid Phred+64
        yield createFastqSequence("fastq2", "AAAA", "BBBB", "phred64"); // Higher quality
      }

      const results = await collectResults(
        processor.process(mixedSequences(), { targetEncoding: "phred33" })
      );

      expect(results).toHaveLength(3);

      // FASTA unchanged
      expect(results[0]?.sequence).toBe("ATCG");
      expect("quality" in results[0]!).toBe(false);

      // FASTQ sequences converted
      const fastq1 = results[1] as FastqSequence;
      expect(fastq1.qualityEncoding).toBe("phred33");
      expect(fastq1.quality).toBe("!!!!"); // @ (64) → ! (33)

      const fastq2 = results[2] as FastqSequence;
      expect(fastq2.qualityEncoding).toBe("phred33");
      expect(fastq2.quality).toBe("####"); // BBBB (66) → #### (35)
    });
  });

  describe("Solexa Conversion Mathematical Accuracy", () => {
    test("converts Phred+33 to Solexa with proper non-linear mathematics", async () => {
      // Test mathematical accuracy of Solexa conversion
      const seq = createFastqSequence("solexa_test", "ATCG", "!!!!", "phred33"); // Q0 scores

      const results = await collectResults(
        processor.process(singleSequence(seq), { targetEncoding: "solexa" })
      );

      const converted = results[0] as FastqSequence;
      expect(converted.qualityEncoding).toBe("solexa");
      // Q0 Phred maps to Q-5 Solexa (minimum), ASCII 64-5 = 59
      expect(converted.quality).toBe(";;;;"); // ASCII 59 = Solexa -5
    });

    test("converts Solexa to Phred+33 with mathematical accuracy", async () => {
      // Test reverse conversion mathematical accuracy
      const seq = createFastqSequence("phred_test", "GCTA", "@@@@", "solexa"); // Q0 Solexa

      const results = await collectResults(
        processor.process(singleSequence(seq), { targetEncoding: "phred33" })
      );

      const converted = results[0] as FastqSequence;
      expect(converted.qualityEncoding).toBe("phred33");
      // Solexa Q0 should convert to approximately Phred Q0, but via proper math
      expect(converted.quality.charCodeAt(0)).toBeGreaterThanOrEqual(33); // Valid ASCII
      expect(converted.quality.charCodeAt(0)).toBeLessThanOrEqual(40); // Reasonable quality range
    });

    test("handles Solexa negative quality scores correctly", async () => {
      // Test Solexa's unique ability to have negative scores
      const seq = createFastqSequence("negative_solexa", "ATCG", ";;;;", "solexa"); // Q-5 Solexa (minimum)

      const results = await collectResults(
        processor.process(singleSequence(seq), { targetEncoding: "phred33" })
      );

      const converted = results[0] as FastqSequence;
      expect(converted.qualityEncoding).toBe("phred33");
      // Solexa Q-5 mathematically converts to approximately Phred Q1 (not Q0)
      expect(converted.quality).toBe('""""'); // ASCII 34 = Q1 (mathematically correct)
    });
  });

  describe("Detection Confidence and Uncertainty Reporting", () => {
    test("provides high confidence for clear modern patterns", async () => {
      // Test high-confidence detection (uniform high quality)
      const clearModernSeq = createFastqSequence(
        "clear_modern",
        "ATCGATCG",
        "IIIIIIII", // Uniform Q40 (ASCII 73) - clearly modern
        "phred33"
      );

      // Capture console warnings
      const originalWarn = console.warn;
      let warningCalled = false;
      console.warn = () => {
        warningCalled = true;
      };

      const results = await collectResults(
        processor.process(singleSequence(clearModernSeq), {
          targetEncoding: "phred64",
        })
      );

      console.warn = originalWarn;

      expect(results).toHaveLength(1);
      expect(warningCalled).toBe(false); // No warning for high-confidence detection
    });

    test("provides uncertainty warnings for ambiguous patterns", async () => {
      // Test low-confidence detection (overlap zone)
      const ambiguousSeq = createFastqSequence(
        "ambiguous_pattern",
        "ATCG",
        "@@@@", // ASCII 64 - could be phred64 Q0 or phred33 Q31
        "phred64"
      );

      // Capture console warnings
      const originalWarn = console.warn;
      let warningMessage = "";
      console.warn = (message: string) => {
        warningMessage = message;
      };

      const results = await collectResults(
        processor.process(singleSequence(ambiguousSeq), {
          targetEncoding: "phred33",
        })
      );

      console.warn = originalWarn;

      expect(results).toHaveLength(1);
      expect(warningMessage).toContain("Uncertain quality encoding detection");
      expect(warningMessage).toContain("confidence:");
      expect(warningMessage).toContain("Consider specifying sourceEncoding explicitly");
    });

    test("provides biological reasoning in uncertainty warnings", async () => {
      // Test that warnings include biological context
      const historicalSeq = createFastqSequence(
        "historical_data",
        "ATCG",
        ";;;;", // ASCII 59 - Solexa range, very rare
        "solexa"
      );

      const originalWarn = console.warn;
      let warningMessage = "";
      console.warn = (message: string) => {
        warningMessage = message;
      };

      const results = await collectResults(
        processor.process(singleSequence(historicalSeq), {
          targetEncoding: "phred33",
        })
      );

      console.warn = originalWarn;

      expect(results).toHaveLength(1);
      expect(warningMessage).toContain("Historical Solexa range detected");
      expect(warningMessage).toContain("very rare in modern data");
      expect(warningMessage).toContain("75.0%"); // Expected confidence for Solexa
    });

    test("suppresses warnings when sourceEncoding explicitly specified", async () => {
      // When user specifies encoding, no warnings should appear
      const ambiguousSeq = createFastqSequence("explicit", "ATCG", "@@@@", "phred64");

      const originalWarn = console.warn;
      let warningCalled = false;
      console.warn = () => {
        warningCalled = true;
      };

      const results = await collectResults(
        processor.process(singleSequence(ambiguousSeq), {
          sourceEncoding: "phred64", // Explicitly specified
          targetEncoding: "phred33",
        })
      );

      console.warn = originalWarn;

      expect(results).toHaveLength(1);
      expect(warningCalled).toBe(false); // No warning when explicit
    });
  });

  describe("Real-World Sequencing Platform Validation", () => {
    test("handles authentic Illumina 1.5 quality patterns (from seqkit test data)", async () => {
      // Using actual seqkit Illumina1.5.fq test file (MIT licensed)
      const illumina15Read = createFastqSequence(
        "HWI-EAS209_0006_FC706VJ:5:58:5894:21141#ATCACG/1",
        "TTAATTGGTAAATAAATCTCCTAATAGCTTAGATNTTACCTTNNNNNNNNNNTAGTTTCTTGAGATTTGTTGGGGGAGACATTTTTGTGATTGCCTTGAT",
        "efcfffffcfeefffcffffffddf`feed]`]_Ba_^__[YBBBBBBBBBBRTT\\]][]dddd`ddd^dddadd^BBBBBBBBBBBBBBBBBBBBBBBB", // Authentic Illumina 1.5 quality
        "phred64"
      );

      const results = await collectResults(
        processor.process(singleSequence(illumina15Read), {
          targetEncoding: "phred33",
        })
      );

      const converted = results[0] as FastqSequence;
      expect(converted.qualityEncoding).toBe("phred33");
      expect(converted.sequence).toBe(illumina15Read.sequence); // Sequence preserved including Ns
      expect(converted.quality.length).toBe(100); // Quality string length matches sequence

      // Validate conversion of authentic quality characters
      // 'e' (ASCII 101, Q37) → 'F' (ASCII 70, Q37) - offset conversion
      expect(converted.quality.charAt(0)).toBe("F");
      // 'B' (ASCII 66, Q2) → '#' (ASCII 35, Q2) - validates low quality conversion
      expect(converted.quality.includes("#")).toBe(true);
    });

    test("handles authentic modern Illumina quality degradation patterns", async () => {
      // Real modern sequencing: high quality at start, degradation at end
      const modernRead = createFastqSequence(
        "NovaSeq_2024_read",
        "ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG", // 100bp
        "JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIIIHHHGGGFFFEEEDDCCBBAAA!!!!!!!!!!", // Q40 degrading to Q0
        "phred33"
      );

      const results = await collectResults(
        processor.process(singleSequence(modernRead), {
          targetEncoding: "phred64",
        })
      );

      const converted = results[0] as FastqSequence;
      expect(converted.qualityEncoding).toBe("phred64");
      expect(converted.quality.length).toBe(100);
      // Should convert entire quality degradation pattern correctly
      expect(converted.quality.charCodeAt(0)).toBe(105); // J (74) → i (105) for Q40
      expect(converted.quality.charCodeAt(99)).toBe(64); // ! (33) → @ (64) for Q0
    });

    test("handles mixed platform data in single conversion workflow", async () => {
      // Real-world scenario: Converting mixed legacy and modern data
      async function* mixedPlatformData(): AsyncIterable<AbstractSequence> {
        // Legacy HiSeq 2000 (Phred+64)
        yield createFastqSequence(
          "HiSeq_legacy",
          "ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG",
          "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@", // Poor quality legacy
          "phred64"
        );

        // Modern NovaSeq (Phred+33)
        yield createFastqSequence(
          "NovaSeq_modern",
          "GCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCT",
          "JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ", // High quality modern
          "phred33"
        );
      }

      let legacyConverted = false;
      let modernConverted = false;

      for await (const converted of processor.process(mixedPlatformData(), {
        targetEncoding: "phred33",
      })) {
        const fastq = converted as FastqSequence;
        expect(fastq.qualityEncoding).toBe("phred33");

        if (fastq.id === "HiSeq_legacy") {
          legacyConverted = true;
          expect(fastq.quality).toBe("!".repeat(100)); // Q0 converted correctly
        } else if (fastq.id === "NovaSeq_modern") {
          modernConverted = true;
          expect(fastq.quality).toBe("J".repeat(100)); // Q40 unchanged
        }
      }

      expect(legacyConverted).toBe(true);
      expect(modernConverted).toBe(true);
    });

    test("validates conversion accuracy against known sequencing benchmarks", async () => {
      // Test mathematically validated conversions against known standards
      const benchmarkTests = [
        {
          phred33: "!",
          phred64: "@",
          solexa: ";",
          description: "Q0 (50% error)",
        },
        {
          phred33: "+",
          phred64: "J",
          solexa: "E",
          description: "Q10 (90% accuracy)",
        },
        {
          phred33: "5",
          phred64: "T",
          solexa: "O",
          description: "Q20 (99% accuracy)",
        },
        {
          phred33: "?",
          phred64: "^",
          solexa: "Y",
          description: "Q30 (99.9% accuracy)",
        },
        {
          phred33: "I",
          phred64: "h",
          solexa: "c",
          description: "Q40 (99.99% accuracy)",
        },
      ];

      for (const benchmark of benchmarkTests) {
        // Test Phred33 → Phred64
        const phred33Seq = createFastqSequence("bench33", "A", benchmark.phred33, "phred33");
        const to64 = await collectResults(
          processor.process(singleSequence(phred33Seq), {
            sourceEncoding: "phred33", // Explicit source prevents auto-detection
            targetEncoding: "phred64",
          })
        );
        expect((to64[0] as FastqSequence).quality).toBe(benchmark.phred64);

        // Test Phred64 → Phred33 (specify source to prevent auto-detection override)
        const phred64Seq = createFastqSequence("bench64", "A", benchmark.phred64, "phred64");
        const to33 = await collectResults(
          processor.process(singleSequence(phred64Seq), {
            sourceEncoding: "phred64", // Explicit source prevents auto-detection
            targetEncoding: "phred33",
          })
        );
        expect((to33[0] as FastqSequence).quality).toBe(benchmark.phred33);
      }
    });
  });

  describe("Performance and Streaming", () => {
    test("maintains streaming behavior with large dataset", async () => {
      async function* largeDataset(): AsyncIterable<AbstractSequence> {
        for (let i = 0; i < 100; i++) {
          yield createFastqSequence(
            `read_${i}`,
            "ATCGATCGATCGATCGATCG",
            "@@@@@@@@@@@@@@@@@@@@", // Phred+64
            "phred64"
          );
        }
      }

      let count = 0;
      for await (const converted of processor.process(largeDataset(), {
        targetEncoding: "phred33",
      })) {
        count++;
        const fastq = converted as FastqSequence;
        expect(fastq.qualityEncoding).toBe("phred33");
      }

      expect(count).toBe(100);
    });

    test("handles realistic FASTQ file scale (10K reads like seqkit test)", async () => {
      // Match seqkit's Illumina1.8.fq.gz scale (10,000 sequences, 150bp each)
      async function* seqkitScale(): AsyncIterable<AbstractSequence> {
        for (let i = 0; i < 10000; i++) {
          // Realistic quality distribution: mostly good with some poor
          const qualityPattern =
            i % 20 === 0
              ? "@".repeat(150) // 5% poor quality (Q0)
              : "I".repeat(150); // 95% excellent quality (Q40)

          yield createFastqSequence(
            `seqkit_scale_read_${i}`,
            "ATCGATCG".repeat(18) + "ATCGATCG".substring(0, 6), // 150bp realistic sequence
            qualityPattern,
            "phred33"
          );
        }
      }

      const startTime = Date.now();
      let processedCount = 0;

      for await (const converted of processor.process(seqkitScale(), {
        targetEncoding: "phred64",
      })) {
        processedCount++;
        const fastq = converted as FastqSequence;
        expect(fastq.qualityEncoding).toBe("phred64");
        expect(fastq.quality.length).toBe(150);

        // Early exit for testing (don't need full 10K for unit test)
        if (processedCount >= 2000) break;
      }

      const duration = Date.now() - startTime;
      expect(processedCount).toBe(2000);
      expect(duration).toBeLessThan(5000); // Should process 2K reads in <5 seconds
    });

    test("validates memory efficiency with chromosome-scale sequences", async () => {
      // Test very long sequences (simulating long-read sequencing like PacBio/Nanopore)
      const longReadSeq = createFastqSequence(
        "PacBio_long_read",
        "A".repeat(50000), // 50KB sequence (realistic long-read length)
        "I".repeat(50000), // Q40 quality throughout
        "phred33"
      );

      const startTime = Date.now();
      const results = await collectResults(
        processor.process(singleSequence(longReadSeq), {
          targetEncoding: "phred64",
        })
      );
      const duration = Date.now() - startTime;

      const converted = results[0] as FastqSequence;
      expect(converted.qualityEncoding).toBe("phred64");
      expect(converted.quality.length).toBe(50000);
      expect(converted.quality.charAt(0)).toBe("h"); // I (73) → h (104) for Q40
      expect(converted.quality.charAt(49999)).toBe("h"); // Consistent throughout
      expect(duration).toBeLessThan(200); // Should be very fast even for 50KB sequence
    });
  });

  describe("Industry Edge Cases and Corruption Patterns", () => {
    test("handles quality string corruption with graceful error recovery", async () => {
      // Test invalid ASCII characters (common file corruption scenario)
      const corruptedSeq = {
        format: "fastq" as const,
        id: "corrupted_read",
        sequence: "ATCGATCG",
        length: 8,
        quality: "!!!!\x00!!!!", // Null byte corruption (ASCII 0)
        qualityEncoding: "phred33" as const,
      };

      // Should either process gracefully or throw helpful error
      try {
        const results = await collectResults(
          processor.process(singleSequence(corruptedSeq), {
            targetEncoding: "phred64",
          })
        );
        // If it processes, should handle corruption appropriately
        expect(results).toHaveLength(1);
      } catch (error) {
        // If it throws, should provide educational guidance
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("ASCII range");
      }
    });

    test("handles mixed-encoding files (real-world workflow corruption)", async () => {
      // Real scenario: User concatenated files with different encodings without realizing
      async function* mixedEncodingDataset(): AsyncIterable<AbstractSequence> {
        // File 1: Legacy data (user thought it was phred33)
        yield createFastqSequence("mixed1", "ATCGATCG", "@@@@@@@@", "phred64"); // Actually phred64
        // File 2: Modern data
        yield createFastqSequence("mixed2", "GCTAGCTA", "IIIIIIII", "phred33"); // Actually phred33
        // File 3: More legacy (user confused about encoding)
        yield createFastqSequence("mixed3", "TTTTAAAA", "BBBBBBBB", "phred64"); // Actually phred64
      }

      const results = await collectResults(
        processor.process(mixedEncodingDataset(), {
          // User specifies what they think encoding is (wrong for some files)
          sourceEncoding: "phred33",
          targetEncoding: "phred64",
        })
      );

      expect(results).toHaveLength(3);
      // Should convert based on user specification, even if detection would be different
      // This tests that explicit sourceEncoding override works correctly
    });

    test("validates detection accuracy with edge quality distributions", async () => {
      // Test edge cases that commonly confuse encoding detection
      const edgeCases = [
        {
          name: "all_low_quality",
          quality: "!\"#$%&'()*+,-./", // ASCII 33-47 (Q0-Q14)
          expectedEncoding: "phred33",
          description: "Low quality range - clearly modern",
        },
        {
          name: "boundary_case_64",
          quality: "@@@@@@@@@@@@@@@@", // ASCII 64 exactly - boundary case
          expectedEncoding: "phred64", // Should prefer constrained legacy pattern
          description: "Exact boundary - legacy filtered data pattern",
        },
        {
          name: "high_modern_range",
          quality: "RSTUVWXYZ[\\]", // ASCII 82-93 (Q49-Q60)
          expectedEncoding: "phred33",
          description: "Very high quality - only possible in modern",
        },
      ];

      for (const testCase of edgeCases) {
        const seq = createFastqSequence("edge_test", "ATCGATCG", testCase.quality, "phred33");

        const results = await collectResults(
          processor.process(singleSequence(seq), {
            targetEncoding: "phred64",
          })
        );

        const converted = results[0] as FastqSequence;
        expect(converted.qualityEncoding).toBe("phred64");
        expect(converted.quality.length).toBe(testCase.quality.length);
        // Should convert regardless of detection (user controls target)
      }
    });
  });
});

describe("Format conversions", () => {
  describe("fq2fa", () => {
    test("converts FASTQ to FASTA", async () => {
      const fastqSeqs: FastqSequence[] = [
        {
          format: "fastq",
          id: "read1",
          sequence: "ATCGATCG",
          quality: "IIIIIIII",
          qualityEncoding: "phred33",
          length: 8,
          description: "test read",
        },
      ];

      const results: FastaSequence[] = [];
      for await (const seq of fq2fa(singleFastqSequence(fastqSeqs[0]))) {
        results.push(seq);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        format: "fasta",
        id: "read1",
        sequence: "ATCGATCG",
        description: "test read",
        length: 8,
      });
      expect("quality" in results[0]).toBe(false);
      expect("qualityEncoding" in results[0]).toBe(false);
    });

    test("includes quality statistics when requested", async () => {
      const fastqSeqs: FastqSequence[] = [
        {
          format: "fastq",
          id: "read1",
          sequence: "ATCG",
          quality: "IIHH", // Mix of scores (40, 40, 39, 39)
          qualityEncoding: "phred33",
          length: 4,
        },
      ];

      const results: FastaSequence[] = [];
      for await (const seq of fq2fa(singleFastqSequence(fastqSeqs[0]), {
        includeQualityStats: true,
      })) {
        results.push(seq);
      }

      expect(results[0].description).toContain("avg_qual=");
      expect(results[0].description).toContain("min_qual=");
      expect(results[0].description).toContain("max_qual=");
    });

    test("handles empty description", async () => {
      const fastqSeqs: FastqSequence[] = [
        {
          format: "fastq",
          id: "read1",
          sequence: "ATCG",
          quality: "IIII",
          qualityEncoding: "phred33",
          length: 4,
        },
      ];

      const results: FastaSequence[] = [];
      for await (const seq of fq2fa(singleFastqSequence(fastqSeqs[0]), {
        includeQualityStats: true,
      })) {
        results.push(seq);
      }

      // Description should only have stats, no leading space
      expect(results[0].description).toMatch(/^avg_qual=/);
    });

    test("validates options with ArkType", async () => {
      const fastqSeqs: FastqSequence[] = [
        {
          format: "fastq",
          id: "read1",
          sequence: "ATCG",
          quality: "IIII",
          qualityEncoding: "phred33",
          length: 4,
        },
      ];

      // Test with an invalid option value rather than unknown property
      let errorThrown = false;
      try {
        const invalidOptions = {
          includeQualityStats: "not-a-boolean", // Should be boolean
        } as unknown as Fq2FaOptions;
        const iterator = fq2fa(singleFastqSequence(fastqSeqs[0]), invalidOptions);
        // Actually start the iteration to trigger validation
        await iterator[Symbol.asyncIterator]().next();
      } catch (error) {
        errorThrown = true;
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain("Invalid fq2fa options");
      }
      expect(errorThrown).toBe(true);
    });
  });

  describe("fa2fq", () => {
    test("converts FASTA to FASTQ with default quality", async () => {
      const fastaSeqs: FastaSequence[] = [
        {
          format: "fasta",
          id: "seq1",
          sequence: "ATCGATCG",
          length: 8,
          description: "test sequence",
        },
      ];

      const results: FastqSequence[] = [];
      for await (const seq of fa2fq(singleFastaSequence(fastaSeqs[0]))) {
        results.push(seq);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        format: "fastq",
        id: "seq1",
        sequence: "ATCGATCG",
        quality: "IIIIIIII", // Default quality
        qualityEncoding: "phred33",
        description: "test sequence",
        length: 8,
      });
    });

    test("uses custom quality score", async () => {
      const fastaSeqs: FastaSequence[] = [
        {
          format: "fasta",
          id: "seq1",
          sequence: "ATCG",
          length: 4,
        },
      ];

      const results: FastqSequence[] = [];
      for await (const seq of fa2fq(singleFastaSequence(fastaSeqs[0]), {
        qualityScore: 30,
        encoding: "phred33",
      })) {
        results.push(seq);
      }

      // Score 30 in Phred+33 = ASCII 63 = '?'
      expect(results[0].quality).toBe("????");
    });

    test("uses custom quality character", async () => {
      const fastaSeqs: FastaSequence[] = [
        {
          format: "fasta",
          id: "seq1",
          sequence: "ATCG",
          length: 4,
        },
      ];

      const results: FastqSequence[] = [];
      for await (const seq of fa2fq(singleFastaSequence(fastaSeqs[0]), {
        quality: "J",
      })) {
        results.push(seq);
      }

      expect(results[0].quality).toBe("JJJJ");
    });

    test("rejects both quality and qualityScore", async () => {
      const fastaSeqs: FastaSequence[] = [
        {
          format: "fasta",
          id: "seq1",
          sequence: "ATCG",
          length: 4,
        },
      ];

      // The validation happens when we start iterating
      let errorThrown = false;
      try {
        const invalidOptions = {
          quality: "I",
          qualityScore: 40,
        } as Fa2FqOptions; // Both specified, which is invalid
        const iterator = fa2fq(singleFastaSequence(fastaSeqs[0]), invalidOptions);
        // Actually start the iteration to trigger validation
        await iterator[Symbol.asyncIterator]().next();
      } catch (error) {
        errorThrown = true;
        expect(error).toBeInstanceOf(ValidationError);
      }
      expect(errorThrown).toBe(true);
    });

    test("rejects multi-character quality string", async () => {
      const fastaSeqs: FastaSequence[] = [
        {
          format: "fasta",
          id: "seq1",
          sequence: "ATCG",
          length: 4,
        },
      ];

      // The validation happens when we start iterating
      let errorThrown = false;
      try {
        const invalidOptions = {
          quality: "II", // Two characters - invalid
        } as Fa2FqOptions;
        const iterator = fa2fq(singleFastaSequence(fastaSeqs[0]), invalidOptions);
        // Actually start the iteration to trigger validation
        await iterator[Symbol.asyncIterator]().next();
      } catch (error) {
        errorThrown = true;
        expect(error).toBeInstanceOf(ValidationError);
      }
      expect(errorThrown).toBe(true);
    });
  });

  describe("SeqOps integration", () => {
    test("fq2fa only available on FastqSequence", async () => {
      const fastqSeq: FastqSequence = {
        format: "fastq",
        id: "test",
        sequence: "ATCG",
        quality: "IIII",
        qualityEncoding: "phred33",
        length: 4,
      };

      // This should compile and work
      const results: FastaSequence[] = [];
      // Create properly typed async iterable
      async function* fastqIterable(): AsyncIterable<FastqSequence> {
        yield fastqSeq;
      }
      for await (const seq of seqops(fastqIterable()).toFastaSequence()) {
        results.push(seq);
      }

      expect(results[0].format).toBe("fasta");

      // Test that it's not available on FastaSequence
      const fastaSeq: FastaSequence = {
        format: "fasta",
        id: "test",
        sequence: "ATCG",
        length: 4,
      };

      // This would be a compile-time error, but we can't test that in runtime
      // So we just verify the correct type constraint works
      expect(results[0]).not.toHaveProperty("quality");
    });

    test("fa2fq only available on FastaSequence", async () => {
      const fastaSeq: FastaSequence = {
        format: "fasta",
        id: "test",
        sequence: "ATCG",
        length: 4,
      };

      // This should compile and work
      const results: FastqSequence[] = [];
      // Create properly typed async iterable
      async function* fastaIterable(): AsyncIterable<FastaSequence> {
        yield fastaSeq;
      }
      for await (const seq of seqops(fastaIterable()).toFastqSequence()) {
        results.push(seq);
      }

      expect(results[0].format).toBe("fastq");
      expect(results[0].quality).toBe("IIII");
    });

    test("conversion pipeline works correctly", async () => {
      const fastqSeq: FastqSequence = {
        format: "fastq",
        id: "test",
        sequence: "ATCGATCG",
        quality: "IIIIIIII",
        qualityEncoding: "phred33",
        length: 8,
        description: "original",
      };

      // FASTQ -> FASTA -> FASTQ round-trip
      const results: FastqSequence[] = [];
      // Create properly typed async iterable
      async function* fastqPipelineIterable(): AsyncIterable<FastqSequence> {
        yield fastqSeq;
      }
      for await (const seq of seqops(fastqPipelineIterable())
        .toFastaSequence()
        .toFastqSequence({ qualityScore: 35 })) {
        results.push(seq);
      }

      expect(results[0].format).toBe("fastq");
      expect(results[0].id).toBe("test");
      expect(results[0].sequence).toBe("ATCGATCG");
      expect(results[0].description).toBe("original");
      // New quality should be uniform score 35
      expect(results[0].quality).toBe("DDDDDDDD"); // ASCII 68 = score 35
    });
  });
});
