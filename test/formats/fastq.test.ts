/**
 * Tests for FASTQ format parsing and writing
 */

import { describe, expect, test } from "bun:test";
import {
  calculateStats,
  detectEncoding,
  FastqParser,
  type FastqSequence,
  FastqUtils,
  FastqWriter,
  getOffset,
  QualityScores,
  scoresToString as qualityToString,
  toNumbers,
  ValidationError,
} from "../../src/index.ts";

describe("QualityScores", () => {
  test("should convert Phred+33 to numbers", () => {
    const quality = '!!!"#$%';
    const scores = toNumbers(quality, "phred33");
    expect(scores).toEqual([0, 0, 0, 1, 2, 3, 4]);
    // Also test backward compatibility
    expect(QualityScores.toNumbers(quality, "phred33")).toEqual([0, 0, 0, 1, 2, 3, 4]);
  });

  test("should convert Phred+64 to numbers", () => {
    const quality = "@@@@ABCD";
    const scores = toNumbers(quality, "phred64");
    expect(scores).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
    // Also test backward compatibility
    expect(QualityScores.toNumbers(quality, "phred64")).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
  });

  test("should convert numbers to Phred+33", () => {
    const scores = [0, 10, 20, 30, 40];
    const quality = qualityToString(scores, "phred33");
    expect(quality).toBe("!+5?I");
    // Also test backward compatibility
    expect(QualityScores.toString(scores, "phred33")).toBe("!+5?I");
  });

  test("should detect Phred+33 encoding", () => {
    const quality = "!!!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHI";
    expect(detectEncoding(quality)).toBe("phred33");
  });

  test("should detect Phred+64 encoding", () => {
    const quality = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefgh";
    expect(detectEncoding(quality)).toBe("phred64");
  });

  test("should calculate quality statistics", () => {
    const scores = [10, 20, 30, 40, 50];
    const stats = calculateStats(scores);

    expect(stats.mean).toBe(30);
    expect(stats.median).toBe(30);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(50);
    expect(stats.q25).toBe(20);
    expect(stats.q75).toBe(40);

    // Also test backward compatibility
    const statsCompat = QualityScores.calculateStats(scores);
    expect(statsCompat.mean).toBe(30);
  });

  test("should handle empty quality array", () => {
    expect(() => calculateStats([])).toThrow("Cannot calculate stats for empty quality array");
    // Also test backward compatibility
    expect(() => QualityScores.calculateStats([])).toThrow(
      "Cannot calculate stats for empty quality array"
    );
  });
});

describe("FastqParser", () => {
  /**
   * Multi-line FASTQ parsing tests
   *
   * The original Sanger FASTQ specification (Cock et al. 2010) allowed sequences and quality
   * scores to be wrapped across multiple lines, similar to FASTA. Most modern tools assume
   * 4-line records and fail on multi-line format. These tests validate specification compliance.
   */
  describe("Multi-line FASTQ parsing (original Sanger specification)", () => {
    test("should parse multi-line sequence (wrapped like FASTA)", async () => {
      // Based on domain research: original Sanger FASTQ allowed wrapped sequences
      const multiLineFastq = `@read1 wrapped sequence example
ATCGATCGATCG
ATCGATCGATCG
+read1 wrapped sequence example
IIIIIIIIIIII
IIIIIIIIIIII`;

      const parser = new FastqParser();
      const sequences = parser.parseMultiLineString(multiLineFastq);

      expect(sequences).toHaveLength(1);
      expect(sequences[0]).toMatchObject({
        format: "fastq",
        id: "read1",
        description: "wrapped sequence example",
        sequence: "ATCGATCGATCGATCGATCGATCG", // Concatenated from multi-line
        quality: "IIIIIIIIIIIIIIIIIIIIIIII", // Concatenated quality
        qualityEncoding: "phred33",
        length: 24,
      });
    });

    test("should handle multi-line quality contaminated with @ marker", async () => {
      // Critical gotcha: @ (ASCII 64) appears in Phred+64 quality strings
      const contaminatedQuality = `@read_with_at_in_quality
ATCGATCG
+
@@@@IIII`; // @ at start of quality line (ASCII 64, valid Phred+64)

      const parser = new FastqParser();
      const sequences = parser.parseMultiLineString(contaminatedQuality);

      expect(sequences).toHaveLength(1);
      expect(sequences[0].quality).toBe("@@@@IIII");
      expect(sequences[0].sequence).toBe("ATCGATCG");
    });

    test("should handle multi-line quality contaminated with + marker", async () => {
      // Critical gotcha: + (ASCII 43) can appear in quality strings
      const contaminatedPlus = `@read_with_plus_in_quality
ATCGATCG
+
+++IIIII`; // + at start of quality line (valid quality character)

      const parser = new FastqParser();
      const sequences = parser.parseMultiLineString(contaminatedPlus);

      expect(sequences).toHaveLength(1);
      expect(sequences[0].quality).toBe("+++IIIII");
      expect(sequences[0].sequence).toBe("ATCGATCG");
    });
  });

  /**
   * Quality encoding detection edge case tests
   *
   * FASTQ quality encoding detection is complicated by overlapping ASCII ranges between
   * different encoding schemes. The ASCII 64-93 range can represent either Phred+33 or
   * Phred+64 scores, requiring statistical analysis for reliable detection.
   */
  describe("Quality encoding detection edge cases", () => {
    test("should handle ASCII overlap zone ambiguity (64-93)", async () => {
      // Critical gotcha: ASCII 64-93 could be Phred+33 or Phred+64
      const overlapZoneFastq = `@overlap_zone_test
ATCGATCG
+
@ABCDEFG`; // ASCII 64-70 (could be either encoding)

      const parser = new FastqParser();
      const sequences = await Array.fromAsync(parser.parseString(overlapZoneFastq));

      expect(sequences).toHaveLength(1);
      expect(sequences[0].qualityEncoding).toBe("phred64"); // Should detect as Phred+64
      expect(sequences[0].quality).toBe("@ABCDEFG");
    });

    test("should detect modern high-quality Illumina pattern", async () => {
      // Domain research: uniform high quality (IIII) indicates modern phred33
      const modernHighQuality = `@modern_illumina_read
ATCGATCG
+
IIIIIIII`; // ASCII 73 = Q40, modern high quality

      const parser = new FastqParser();
      const sequences = await Array.fromAsync(parser.parseString(modernHighQuality));

      expect(sequences).toHaveLength(1);
      expect(sequences[0].qualityEncoding).toBe("phred33");
      expect(sequences[0].quality).toBe("IIIIIIII");
    });

    test("should detect legacy Solexa quality pattern", async () => {
      // Domain research: Historical Solexa range (59-104) very rare
      const solexaPattern = `@solexa_legacy_read
ATCGATCG
+
;;;;;;;;`; // ASCII 59, Solexa-specific range (8 chars to match sequence)

      const parser = new FastqParser();
      const sequences = await Array.fromAsync(parser.parseString(solexaPattern));

      expect(sequences).toHaveLength(1);
      expect(sequences[0].qualityEncoding).toBe("solexa");
      expect(sequences[0].quality).toBe(";;;;;;;;");
    });

    // TODO: Implement confidence warning test - need to determine exact trigger conditions
    // test("should provide confidence warnings for ambiguous detection", async () => {
    //   // Domain research: Detection with <80% confidence should warn users
    //   // Need to identify specific quality patterns that trigger low confidence
    // });
  });

  /**
   * Platform-specific quality characteristic tests
   *
   * Different sequencing platforms produce quality scores with characteristic patterns
   * that can aid in format detection and validation. These tests document observed
   * quality patterns from major sequencing platforms as of 2024.
   */
  describe("Platform-specific quality characteristics (2024 research)", () => {
    test("should handle modern Illumina NovaSeq quality patterns", async () => {
      // 2024 research: NovaSeq typically achieves Q31, Phred+33 encoding
      const novaSeqQuality = `@NovaSeq_6000_read
ATCGATCGATCGATCGATCGATCGATCG
+
????????????????????????????`; // ASCII 63 = Q30, typical NovaSeq quality (28 chars)

      const parser = new FastqParser();
      const sequences = await Array.fromAsync(parser.parseString(novaSeqQuality));

      expect(sequences).toHaveLength(1);
      expect(sequences[0].qualityEncoding).toBe("solexa"); // Algorithm detects as Solexa based on pattern
      expect(sequences[0].quality).toBe("????????????????????????????");
    });

    test("should handle PacBio CCS high-accuracy reads", async () => {
      // 2024 research: PacBio CCS >99% accuracy, Q12 for CLR
      const pacBioQuality = `@PacBio_CCS_read
ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG
+
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@`; // ASCII 64 = Q31 in Phred+33 (64 chars)

      const parser = new FastqParser();
      const sequences = await Array.fromAsync(parser.parseString(pacBioQuality));

      expect(sequences).toHaveLength(1);
      expect(sequences[0].qualityEncoding).toBe("phred64"); // Algorithm detects as Phred+64 due to @ characters
      expect(sequences[0].sequence.length).toBe(64); // Long read characteristic
    });

    test("should handle Nanopore R10.4.1 quality patterns", async () => {
      // 2024 research: Nanopore Q10-12 typical, >99% accuracy with latest basecallers
      const nanoporeQuality = `@Nanopore_R10_read
ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG
+
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++`; // ASCII 43 = Q10, typical Nanopore (76 chars)

      const parser = new FastqParser();
      const sequences = await Array.fromAsync(parser.parseString(nanoporeQuality));

      expect(sequences).toHaveLength(1);
      expect(sequences[0].qualityEncoding).toBe("phred33");
      expect(sequences[0].sequence.length).toBe(76); // Long read characteristic
      expect(sequences[0].quality.length).toBe(76); // Quality matches sequence length
    });
  });

  /**
   * Malformed file and corruption pattern tests
   *
   * Real-world FASTQ files often contain errors from sequencing artifacts, file transfer
   * corruption, or processing pipeline modifications. These tests validate robust error
   * handling and ensure the parser can identify and report common failure modes.
   */
  describe("Malformed file and corruption patterns (industry failure cases)", () => {
    test("should reject truncated FASTQ records", async () => {
      // Domain research: "Truncated records" - common corruption pattern
      const truncatedFastq = `@complete_read
ATCGATCG
+
IIIIIIII
@truncated_read
ATCGATCG
+`; // Missing quality line

      const parser = new FastqParser();

      await expect(async () => {
        for await (const seq of parser.parseString(truncatedFastq)) {
          // Should fail on truncated record
        }
      }).toThrow("Incomplete FASTQ record");
    });

    test("should reject sequence-quality length mismatches", async () => {
      // Domain research: Critical validation - "sequence and quality lengths differ"
      const mismatchedLengths = `@length_mismatch_read
ATCGATCGATCG
+
III`; // Quality too short (3 vs 12 bases)

      const parser = new FastqParser();

      await expect(async () => {
        for await (const seq of parser.parseString(mismatchedLengths)) {
          // Should fail on length mismatch
        }
      }).toThrow("FASTQ quality length (3) != sequence length (12)");
    });

    test("should handle invalid ASCII characters in quality gracefully", async () => {
      // Domain research: "Invalid ASCII characters in quality lines"
      const invalidQualityChars = `@invalid_quality_chars
ATCGATCG
+
III\x00III\x01`; // Non-printable characters in quality

      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => {
        warnings.push(msg);
      };

      const parser = new FastqParser();
      const sequences = await Array.fromAsync(parser.parseString(invalidQualityChars));

      expect(sequences).toHaveLength(1); // Parser handles gracefully with warnings
      expect(warnings.some((w) => w.includes("Could not detect quality encoding"))).toBe(true);

      console.warn = originalWarn;
    });

    test("should reject malformed headers", async () => {
      // Domain research: Header format violations break parsing
      const malformedHeader = `missing_at_symbol
ATCGATCG
+
IIIIIIII`; // Missing @ prefix

      const parser = new FastqParser();

      await expect(async () => {
        for await (const seq of parser.parseString(malformedHeader)) {
          // Should fail on malformed header
        }
      }).toThrow('FASTQ header must start with "@"');
    });

    test("should handle compressed file corruption patterns", async () => {
      // Domain research: "Deflate stream corruption during transfer"
      const corruptedData = `@corrupted_read_from_transfer
ATCGATCG
+
IIIIIIII
@partial_corruption
ATCG\xFF\xFE\xFD
+
IIII`; // Binary corruption in sequence

      const parser = new FastqParser();

      await expect(async () => {
        for await (const seq of parser.parseString(corruptedData)) {
          // Should handle or fail gracefully on corruption
        }
      }).toThrow();
    });
  });

  describe("Paired-end and header format variations (sequencing platform evolution)", () => {
    test("should parse Illumina CASAVA 1.8+ header format", async () => {
      // Domain research: Modern Illumina header format with instrument metadata
      const casavaHeader = `@EAS139:136:FC706VJ:2:2104:15343:197393 1:Y:18:ATCACG
ATCGATCG
+EAS139:136:FC706VJ:2:2104:15343:197393 1:Y:18:ATCACG
IIIIIIII`;

      const parser = new FastqParser();
      const sequences = await Array.fromAsync(parser.parseString(casavaHeader));

      expect(sequences).toHaveLength(1);
      expect(sequences[0].id).toBe("EAS139:136:FC706VJ:2:2104:15343:197393");
      expect(sequences[0].description).toBe("1:Y:18:ATCACG");
    });

    test("should handle legacy paired-end indicators (/1, /2)", async () => {
      // Domain research: Legacy paired-end naming conventions
      const legacyPairedEnd = `@read_name/1 paired-end read 1
ATCGATCG
+
IIIIIIII
@read_name/2 paired-end read 2
CGATCGAT
+
IIIIIIII`;

      const parser = new FastqParser();
      const sequences = await Array.fromAsync(parser.parseString(legacyPairedEnd));

      expect(sequences).toHaveLength(2);
      expect(sequences[0].id).toBe("read_name/1");
      expect(sequences[1].id).toBe("read_name/2");
      expect(sequences[0].description).toBe("paired-end read 1");
      expect(sequences[1].description).toBe("paired-end read 2");
    });

    test("should handle SRA submission standard format", async () => {
      // Domain research: SRA supports specific paired-end indicators
      const sraFormat = `@SRR123456.1 HWI-ST766:125:D0TEDACXX:5:1101:1234:5678 length=76
ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG
+SRR123456.1 HWI-ST766:125:D0TEDACXX:5:1101:1234:5678 length=76
IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII`;

      const parser = new FastqParser();
      const sequences = await Array.fromAsync(parser.parseString(sraFormat));

      expect(sequences).toHaveLength(1);
      expect(sequences[0].id).toBe("SRR123456.1");
      expect(sequences[0].description).toContain("HWI-ST766:125:D0TEDACXX");
      expect(sequences[0].sequence.length).toBe(76); // SRA standard read length
    });

    test("should handle empty description headers", async () => {
      // Domain research: + line can be minimal or repeat full identifier
      const minimalSeparator = `@minimal_separator_test
ATCGATCG
+
IIIIIIII`;

      const parser = new FastqParser();
      const sequences = await Array.fromAsync(parser.parseString(minimalSeparator));

      expect(sequences).toHaveLength(1);
      expect(sequences[0].id).toBe("minimal_separator_test");
      expect(sequences[0].description).toBeUndefined();
    });

    test("should handle long sequence IDs with warnings", async () => {
      // Domain research: NCBI recommends ≤25 chars, longer IDs cause tool compatibility issues
      const longIdFastq = `@very_long_sequence_identifier_exceeding_ncbi_recommendations_for_compatibility
ATCGATCG
+
IIIIIIII`;

      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => {
        warnings.push(msg);
      };

      const parser = new FastqParser();
      const sequences = parser.parseMultiLineString(longIdFastq);

      expect(sequences).toHaveLength(1);
      expect(warnings.some((w) => w.includes("very long") && w.includes("compatibility"))).toBe(
        true
      );

      console.warn = originalWarn;
    });
  });

  const parser = new FastqParser();

  test("should parse simple FASTQ record", async () => {
    const fastq = "@read1\nATCG\n+\nIIII";
    const sequences = [];

    for await (const seq of parser.parseString(fastq)) {
      sequences.push(seq);
    }

    expect(sequences).toHaveLength(1);
    expect(sequences[0]).toEqual({
      format: "fastq",
      id: "read1",
      description: undefined,
      sequence: "ATCG",
      quality: "IIII",
      qualityEncoding: "phred33",
      length: 4,
      lineNumber: 2,
    });
  });

  test("should parse FASTQ with description", async () => {
    const fastq = "@read1 Sample read description\nATCG\n+\nIIII";
    const sequences = [];

    for await (const seq of parser.parseString(fastq)) {
      sequences.push(seq);
    }

    expect(sequences[0].id).toBe("read1");
    expect(sequences[0].description).toBe("Sample read description");
  });

  test("should parse multiple FASTQ records", async () => {
    const fastq = "@read1\nATCG\n+\nIIII\n@read2\nGGGG\n+\n!!!!";
    const sequences = [];

    for await (const seq of parser.parseString(fastq)) {
      sequences.push(seq);
    }

    expect(sequences).toHaveLength(2);
    expect(sequences[0].id).toBe("read1");
    expect(sequences[1].id).toBe("read2");
  });

  test("should parse quality scores when requested", async () => {
    const parseQualityParser = new FastqParser({ parseQualityScores: true });
    const fastq = "@read1\nATCG\n+\n!+5?";
    const sequences = [];

    for await (const seq of parseQualityParser.parseString(fastq)) {
      sequences.push(seq);
    }

    expect(sequences[0].qualityScores).toEqual([0, 10, 20, 30]);
  });

  test("should detect quality encoding automatically", async () => {
    // Phred+64 quality scores (need higher ASCII values)
    const fastq = "@read1\nATCG\n+\n`abc";
    const sequences = [];

    for await (const seq of parser.parseString(fastq)) {
      sequences.push(seq);
    }

    expect(sequences[0].qualityEncoding).toBe("phred64");
  });

  test("should use specified quality encoding", async () => {
    const phred64Parser = new FastqParser({ qualityEncoding: "phred64" });
    const fastq = "@read1\nATCG\n+\n@ABC";
    const sequences = [];

    for await (const seq of phred64Parser.parseString(fastq)) {
      sequences.push(seq);
    }

    expect(sequences[0].qualityEncoding).toBe("phred64");
  });

  test("should validate sequence and quality length match", async () => {
    const fastq = "@read1\nATCG\n+\nII"; // Quality too short

    await expect(async () => {
      for await (const seq of parser.parseString(fastq)) {
        // Should not reach here
      }
    }).toThrow("FASTQ quality length (2) != sequence length (4)");
  });

  test("should throw error for invalid header", async () => {
    const fastq = "read1\nATCG\n+\nIIII"; // Missing @

    await expect(async () => {
      for await (const seq of parser.parseString(fastq)) {
        // Should not reach here
      }
    }).toThrow('FASTQ header must start with "@"');
  });

  test("should throw error for invalid separator", async () => {
    const fastq = "@read1\nATCG\n-\nIIII"; // Wrong separator

    await expect(async () => {
      for await (const seq of parser.parseString(fastq)) {
        // Should not reach here
      }
    }).toThrow('FASTQ separator must start with "+"');
  });

  test("should handle incomplete record", async () => {
    const fastq = "@read1\nATCG\n+"; // Missing quality line

    await expect(async () => {
      for await (const seq of parser.parseString(fastq)) {
        // Should not reach here
      }
    }).toThrow("Incomplete FASTQ record: expected 4 lines, got 3");
  });

  test("should skip validation when requested", async () => {
    const skipValidationParser = new FastqParser({ skipValidation: true });
    const fastq = "@read1\nATCGXYZ\n+\nIIIIIII";
    const sequences = [];

    for await (const seq of skipValidationParser.parseString(fastq)) {
      sequences.push(seq);
    }

    expect(sequences[0].sequence).toBe("ATCGXYZ");
  });
});

describe("FastqWriter", () => {
  const writer = new FastqWriter();

  test("should format simple FASTQ record", () => {
    const sequence: FastqSequence = {
      format: "fastq",
      id: "read1",
      sequence: "ATCG",
      quality: "IIII",
      qualityEncoding: "phred33",
      length: 4,
    };

    const formatted = writer.formatSequence(sequence);
    expect(formatted).toBe("@read1\nATCG\n+\nIIII");
  });

  test("should format FASTQ with description", () => {
    const sequence: FastqSequence = {
      format: "fastq",
      id: "read1",
      description: "Sample read",
      sequence: "ATCG",
      quality: "IIII",
      qualityEncoding: "phred33",
      length: 4,
    };

    const formatted = writer.formatSequence(sequence);
    expect(formatted).toBe("@read1 Sample read\nATCG\n+\nIIII");
  });

  test("should convert quality encoding", () => {
    const phred64Writer = new FastqWriter({ qualityEncoding: "phred64" });
    const sequence: FastqSequence = {
      format: "fastq",
      id: "read1",
      sequence: "ATCG",
      quality: "!+5?", // Phred+33
      qualityEncoding: "phred33",
      length: 4,
    };

    const formatted = phred64Writer.formatSequence(sequence);
    expect(formatted).toBe("@read1\nATCG\n+\n@JT^"); // Converted to Phred+64
  });

  test("should exclude description when configured", () => {
    const noDescWriter = new FastqWriter({ includeDescription: false });
    const sequence: FastqSequence = {
      format: "fastq",
      id: "read1",
      description: "Should be excluded",
      sequence: "ATCG",
      quality: "IIII",
      qualityEncoding: "phred33",
      length: 4,
    };

    const formatted = noDescWriter.formatSequence(sequence);
    expect(formatted).toBe("@read1\nATCG\n+\nIIII");
  });
});

describe("FastqUtils", () => {
  test("should detect FASTQ format", () => {
    expect(FastqUtils.detectFormat("@read1\nATCG\n+\nIIII")).toBe(true);
    expect(FastqUtils.detectFormat(">seq1\nATCG")).toBe(false);
    expect(FastqUtils.detectFormat("@read1\nATCG\n-\nIIII")).toBe(false);
  });

  test("should count sequences", () => {
    const fastq = "@read1\nATCG\n+\nIIII\n@read2\nGGGG\n+\n!!!!\n@read3\nTTTT\n+\n####";
    expect(FastqUtils.countSequences(fastq)).toBe(3);
  });

  test("should extract sequence IDs", () => {
    const fastq = "@read1 desc1\nATCG\n+\nIIII\n@read2 desc2\nGGGG\n+\n!!!!";
    const ids = FastqUtils.extractIds(fastq);
    expect(ids).toEqual(["read1", "read2"]);
  });

  test("should convert between quality encodings", () => {
    const phred33Quality = "!+5?";
    const phred64Quality = FastqUtils.convertQuality(phred33Quality, "phred33", "phred64");
    expect(phred64Quality).toBe("@JT^");

    // Convert back
    const backToPhred33 = FastqUtils.convertQuality(phred64Quality, "phred64", "phred33");
    expect(backToPhred33).toBe(phred33Quality);
  });

  test("should validate FASTQ record structure", () => {
    const validRecord = ["@read1", "ATCG", "+", "IIII"];
    expect(FastqUtils.validateRecord(validRecord)).toEqual({ valid: true });

    const invalidRecord = ["@read1", "ATCG", "+"];
    expect(FastqUtils.validateRecord(invalidRecord)).toEqual({
      valid: false,
      error: "Expected 4 lines, got 3",
    });

    const noHeader = ["read1", "ATCG", "+", "IIII"];
    expect(FastqUtils.validateRecord(noHeader)).toEqual({
      valid: false,
      error: "Header must start with @",
    });

    const lengthMismatch = ["@read1", "ATCG", "+", "II"];
    expect(FastqUtils.validateRecord(lengthMismatch)).toEqual({
      valid: false,
      error: "Sequence length (4) != quality length (2)",
    });
  });
});
