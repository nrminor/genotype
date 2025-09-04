/**
 * Tests for FASTQ format parsing and writing
 */

import { test, expect, describe } from "bun:test";
import {
  FastqParser,
  FastqWriter,
  FastqUtils,
  QualityScores,
  toNumbers,
  scoresToString as qualityToString,
  getOffset,
  detectEncoding,
  calculateStats,
  type FastqSequence,
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
    // Also test backward compatibility
    expect(QualityScores.detectEncoding(quality)).toBe("phred33");
  });

  test("should detect Phred+64 encoding", () => {
    const quality = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefgh";
    expect(detectEncoding(quality)).toBe("phred64");
    // Also test backward compatibility
    expect(QualityScores.detectEncoding(quality)).toBe("phred64");
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
    }).toThrow("Quality length (2) != sequence length (4)");
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
