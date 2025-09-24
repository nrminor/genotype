/**
 * Tests for FASTQ Writer enhancements
 */

import { describe, expect, test } from "bun:test";
import { FastqParser } from "../../src/formats/fastq/parser";
import { FastqWriter } from "../../src/formats/fastq/writer";
import type { FastqSequence } from "../../src/types";

describe("FASTQ Writer Enhancements", () => {
  describe("Edge Cases", () => {
    test("handles empty sequences array", () => {
      const writer = new FastqWriter();
      const output = writer.formatSequences([]);

      expect(output).toBe("");
    });

    test("formats sequence with empty description", () => {
      const seq: FastqSequence = {
        format: "fastq",
        id: "test",
        sequence: "ATCG",
        quality: "IIII",
        qualityEncoding: "phred33",
        length: 4,
        // No description field
      };

      const writer = new FastqWriter();
      const output = writer.formatSequence(seq);

      expect(output).toBe("@test\nATCG\n+\nIIII");
    });

    test("validates empty sequence when validation enabled", () => {
      const emptySeq: FastqSequence = {
        format: "fastq",
        id: "empty",
        sequence: "",
        quality: "",
        qualityEncoding: "phred33",
        length: 0,
      };

      const writer = new FastqWriter({
        validateOutput: true,
        validationLevel: "quick",
      });

      // Should format it (trusting types) but validation will catch it
      expect(() => writer.formatSequence(emptySeq)).toThrow(/must have equal length|empty/i);
    });

    test("handles very long sequences efficiently", () => {
      const longSeq: FastqSequence = {
        format: "fastq",
        id: "long",
        sequence: "A".repeat(10000),
        quality: "I".repeat(10000),
        qualityEncoding: "phred33",
        length: 10000,
      };

      const writer = new FastqWriter();
      const output = writer.formatSequence(longSeq);

      expect(output.length).toBeGreaterThan(20000); // At least header + seq + sep + qual
      expect(output).toContain("@long");
    });

    test("preserves exact quality scores without conversion", () => {
      const seq: FastqSequence = {
        format: "fastq",
        id: "test",
        sequence: "ATCG",
        quality: "!#5?", // Various ASCII values
        qualityEncoding: "phred33",
        length: 4,
      };

      const writer = new FastqWriter({ qualityEncoding: "phred33" });
      const output = writer.formatSequence(seq);

      expect(output).toContain("!#5?"); // Exact preservation when no conversion needed
    });

    test("handles sequences with special characters in ID", () => {
      const seq: FastqSequence = {
        format: "fastq",
        id: "seq|with:special/chars",
        sequence: "ATCG",
        quality: "IIII",
        qualityEncoding: "phred33",
        length: 4,
      };

      const writer = new FastqWriter();
      const output = writer.formatSequence(seq);

      expect(output).toContain("@seq|with:special/chars");
    });

    test("formats multiple sequences correctly", () => {
      const sequences: FastqSequence[] = [
        {
          format: "fastq",
          id: "seq1",
          sequence: "ATCG",
          quality: "IIII",
          qualityEncoding: "phred33",
          length: 4,
        },
        {
          format: "fastq",
          id: "seq2",
          sequence: "GCTA",
          quality: "JJJJ",
          qualityEncoding: "phred33",
          length: 4,
        },
      ];

      const writer = new FastqWriter();
      const output = writer.formatSequences(sequences);

      const lines = output.split("\n");
      expect(lines).toHaveLength(8); // 4 lines per sequence (no extra separator between)
      expect(lines[0]).toBe("@seq1");
      expect(lines[4]).toBe("@seq2");
    });

    test("handles whitespace in sequences gracefully", () => {
      const seq: FastqSequence = {
        format: "fastq",
        id: "test",
        sequence: "A T C G", // Has spaces
        quality: "I I I I", // Has spaces
        qualityEncoding: "phred33",
        length: 7, // Including spaces
      };

      const writer = new FastqWriter();
      const output = writer.formatSequence(seq);

      // Writer formats as-is, trusting the input
      expect(output).toContain("A T C G");
      expect(output).toContain("I I I I");
    });
  });

  const sampleSequence: FastqSequence = {
    format: "fastq",
    id: "test_seq",
    description: "test description",
    sequence: "ATCGATCGATCGATCGATCG",
    quality: "IIIIIIIIIIJJJJJJJJJJ",
    qualityEncoding: "phred33",
    length: 20,
  };

  describe("Line Wrapping", () => {
    test("wraps sequences when lineLength is set and sequence exceeds it", () => {
      const longSeq: FastqSequence = {
        ...sampleSequence,
        sequence: "ATCG".repeat(30), // 120bp
        quality: "IIII".repeat(30),
        length: 120,
      };

      const writer = new FastqWriter({ lineLength: 50 });
      const output = writer.formatSequence(longSeq);
      const lines = output.split("\n");

      // Should have header + 3 seq lines + separator + 3 qual lines = 8 lines
      expect(lines.length).toBe(8);
      expect(lines[1].length).toBeLessThanOrEqual(50);
      expect(lines[2].length).toBeLessThanOrEqual(50);
    });

    test("doesn't wrap when sequence is shorter than lineLength", () => {
      const writer = new FastqWriter({ lineLength: 50 });
      const output = writer.formatSequence(sampleSequence);
      const lines = output.split("\n");

      // Should remain as simple 4-line format
      expect(lines.length).toBe(4);
    });

    test("doesn't wrap when lineLength is 0", () => {
      const longSeq: FastqSequence = {
        ...sampleSequence,
        sequence: "ATCG".repeat(30),
        quality: "IIII".repeat(30),
        length: 120,
      };

      const writer = new FastqWriter({ lineLength: 0 });
      const output = writer.formatSequence(longSeq);
      const lines = output.split("\n");

      expect(lines.length).toBe(4);
    });
  });

  describe("Output Validation", () => {
    test("validates output when validateOutput is true", () => {
      const writer = new FastqWriter({
        validateOutput: true,
        validationLevel: "quick",
      });

      // Valid sequence should pass
      expect(() => writer.formatSequence(sampleSequence)).not.toThrow();
    });

    test("catches length mismatch in validation", () => {
      const invalidSeq: FastqSequence = {
        ...sampleSequence,
        quality: "IIII", // Too short!
      };

      const writer = new FastqWriter({
        validateOutput: true,
        validationLevel: "quick",
      });

      expect(() => writer.formatSequence(invalidSeq)).toThrow(
        /FASTQ sequence and quality must have equal length/
      );
    });

    test("full validation checks quality encoding range", () => {
      const invalidSeq: FastqSequence = {
        ...sampleSequence,
        sequence: "ATCGATCG",
        quality: "IIII\x1F\x1F\x1F\x1F", // Invalid ASCII characters (below 33)
        qualityEncoding: "phred33",
        length: 8,
      };

      const writer = new FastqWriter({
        validateOutput: true,
        validationLevel: "full",
      });

      expect(() => writer.formatSequence(invalidSeq)).toThrow(/Invalid Phred\+33 quality values/);
    });

    test("quick validation doesn't check nucleotide validity", () => {
      const invalidSeq: FastqSequence = {
        ...sampleSequence,
        sequence: "ATCGXYZ", // Invalid nucleotides
        quality: "IIIIIII",
        length: 7,
      };

      const writer = new FastqWriter({
        validateOutput: true,
        validationLevel: "quick",
      });

      // Should not throw with quick validation
      expect(() => writer.formatSequence(invalidSeq)).not.toThrow();
    });
  });

  describe("Platform-Aware Formatting", () => {
    test("preserves Illumina platform format", () => {
      const illuminaSeq: FastqSequence = {
        format: "fastq",
        id: "M01234:567:000000000-ABCDE:1:1101:15589:1338",
        description: "1:N:0:1",
        sequence: "ATCGATCGATCG",
        quality: "IIIIJJJJKKKK",
        qualityEncoding: "phred33",
        length: 12,
      };

      const writer = new FastqWriter({
        preservePlatformFormat: true,
      });

      const output = writer.formatSequence(illuminaSeq);
      expect(output).toContain("@M01234:567:000000000-ABCDE:1:1101:15589:1338 1:N:0:1");
    });

    test("preserves separator ID when configured", () => {
      const writer = new FastqWriter({
        preserveSeparatorId: true,
      });

      const output = writer.formatSequence(sampleSequence);
      const lines = output.split("\n");

      // Separator should include the ID
      expect(lines[2]).toBe("+test_seq");
    });

    test("uses simple separator by default", () => {
      const writer = new FastqWriter({
        preserveSeparatorId: false,
      });

      const output = writer.formatSequence(sampleSequence);
      const lines = output.split("\n");

      // Separator should be just '+'
      expect(lines[2]).toBe("+");
    });
  });

  describe("Option Validation", () => {
    test("rejects validation level without validateOutput", () => {
      expect(
        () =>
          new FastqWriter({
            validationLevel: "full",
            validateOutput: false,
          })
      ).toThrow(/Setting a validation level has no effect/);
    });

    test("warns about very short line lengths", () => {
      const originalWarn = console.warn;
      let warnMessage = "";
      console.warn = (msg: string) => {
        warnMessage = msg;
      };

      new FastqWriter({
        lineLength: 20,
        outputStrategy: "wrapped",
      });

      expect(warnMessage).toContain("lineLength=20 is very short");

      console.warn = originalWarn;
    });

    test("accepts valid option combinations", () => {
      expect(
        () =>
          new FastqWriter({
            qualityEncoding: "phred64",
            validateOutput: true,
            validationLevel: "full",
            lineLength: 80,
            outputStrategy: "wrapped",
            preservePlatformFormat: true,
          })
      ).not.toThrow();
    });

    test("provides helpful error messages from ArkType", () => {
      try {
        new FastqWriter({
          outputStrategy: "wrapped",
          lineLength: 0,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain("Invalid FASTQ writer options");
        expect(error.message).toContain("Wrapped output format requires");
      }
    });
  });

  describe("Output Strategy", () => {
    test("auto strategy wraps long sequences", () => {
      const longSeq: FastqSequence = {
        ...sampleSequence,
        sequence: "ATCG".repeat(30), // 120bp
        quality: "IIII".repeat(30),
        length: 120,
      };

      const writer = new FastqWriter({
        outputStrategy: "auto",
        lineLength: 50,
      });

      const output = writer.formatSequence(longSeq);
      const lines = output.split("\n");

      // Should wrap because 120bp > 100bp threshold
      expect(lines.length).toBeGreaterThan(4);
    });

    test("auto strategy doesn't wrap short sequences", () => {
      const writer = new FastqWriter({
        outputStrategy: "auto",
        lineLength: 50,
      });

      const output = writer.formatSequence(sampleSequence);
      const lines = output.split("\n");

      // Should not wrap because 20bp < 100bp threshold
      expect(lines.length).toBe(4);
    });

    test("simple strategy never wraps", () => {
      const longSeq: FastqSequence = {
        ...sampleSequence,
        sequence: "ATCG".repeat(30),
        quality: "IIII".repeat(30),
        length: 120,
      };

      const writer = new FastqWriter({
        outputStrategy: "simple",
        lineLength: 50,
      });

      const output = writer.formatSequence(longSeq);
      const lines = output.split("\n");

      expect(lines.length).toBe(4);
    });

    test("wrapped strategy wraps when possible", () => {
      const longSeq: FastqSequence = {
        ...sampleSequence,
        sequence: "ATCG".repeat(30),
        quality: "IIII".repeat(30),
        length: 120,
      };

      const writer = new FastqWriter({
        outputStrategy: "wrapped",
        lineLength: 50,
      });

      const output = writer.formatSequence(longSeq);
      const lines = output.split("\n");

      expect(lines.length).toBeGreaterThan(4);
    });

    test("wrapped strategy throws error without lineLength", () => {
      // Invalid state: wrapped strategy requires positive lineLength
      expect(
        () =>
          new FastqWriter({
            outputStrategy: "wrapped",
            lineLength: 0,
          })
      ).toThrow(/Wrapped output format requires a positive line length/);
    });
  });

  describe("Streaming Support", () => {
    test("formatStream yields formatted sequences", async () => {
      async function* generateSequences() {
        yield {
          format: "fastq" as const,
          id: "seq1",
          sequence: "ATCG",
          quality: "IIII",
          qualityEncoding: "phred33" as const,
          length: 4,
        };
        yield {
          format: "fastq" as const,
          id: "seq2",
          sequence: "GCTA",
          quality: "JJJJ",
          qualityEncoding: "phred33" as const,
          length: 4,
        };
      }

      const writer = new FastqWriter();
      const chunks: string[] = [];

      for await (const chunk of writer.formatStream(generateSequences())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toContain("@seq1");
      expect(chunks[1]).toContain("@seq2");
    });

    test("writeToStream writes to WritableStream", async () => {
      async function* sequences() {
        yield {
          format: "fastq" as const,
          id: "test",
          sequence: "ATCG",
          quality: "IIII",
          qualityEncoding: "phred33" as const,
          length: 4,
        };
      }

      const chunks: Uint8Array[] = [];
      const stream = new WritableStream({
        write(chunk) {
          chunks.push(chunk);
        },
      });

      const writer = new FastqWriter();
      await writer.writeToStream(sequences(), stream);

      expect(chunks.length).toBeGreaterThan(0);
      const decoded = new TextDecoder().decode(chunks[0]);
      expect(decoded).toContain("@test");
    });
  });

  describe("Round-trip Compatibility", () => {
    test("wrapped output can be parsed correctly", async () => {
      const longSeq: FastqSequence = {
        ...sampleSequence,
        sequence: "ATCG".repeat(30),
        quality: "IIII".repeat(30),
        length: 120,
      };

      const writer = new FastqWriter({ lineLength: 50 });
      const parser = new FastqParser();

      const output = writer.formatSequence(longSeq);
      const parsed: FastqSequence[] = [];

      for await (const seq of parser.parseString(output)) {
        parsed.push(seq);
      }

      expect(parsed).toHaveLength(1);
      expect(parsed[0].sequence).toBe(longSeq.sequence);
      expect(parsed[0].quality).toBe(longSeq.quality);
      expect(parsed[0].id).toBe(longSeq.id);
    });

    test("platform-preserved output maintains format with description", async () => {
      const illuminaSeq: FastqSequence = {
        format: "fastq",
        id: "M01234:567:000000000-ABCDE:1:1101:15589:1338",
        description: "1:N:0:1",
        sequence: "ATCGATCGATCG",
        quality: "IIIIJJJJKKKK",
        qualityEncoding: "phred33",
        length: 12,
      };

      const writer = new FastqWriter({
        preservePlatformFormat: true,
        preserveSeparatorId: true,
      });
      const parser = new FastqParser();

      const output = writer.formatSequence(illuminaSeq);
      const parsed: FastqSequence[] = [];

      for await (const seq of parser.parseString(output)) {
        parsed.push(seq);
      }

      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe(illuminaSeq.id);
      // Platform format preservation MUST maintain the description field for Illumina format
      expect(parsed[0].description).toBeDefined();
      expect(parsed[0].description).toBe("1:N:0:1");
    });

    test("handles sequences without description field", async () => {
      const seqWithoutDescription: FastqSequence = {
        format: "fastq",
        id: "test_seq_no_desc",
        sequence: "ATCGATCGATCG",
        quality: "IIIIJJJJKKKK",
        qualityEncoding: "phred33",
        length: 12,
        // Explicitly no description field
      };

      const writer = new FastqWriter({
        preservePlatformFormat: true,
      });
      const parser = new FastqParser();

      const output = writer.formatSequence(seqWithoutDescription);
      const parsed: FastqSequence[] = [];

      for await (const seq of parser.parseString(output)) {
        parsed.push(seq);
      }

      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe(seqWithoutDescription.id);
      // When no description in input, output should also have no description
      expect(parsed[0].description).toBeUndefined();
    });
  });

  describe("Combined Features", () => {
    test("validation works with wrapping", () => {
      const longSeq: FastqSequence = {
        ...sampleSequence,
        sequence: "ATCG".repeat(30),
        quality: "IIII".repeat(30),
        length: 120,
      };

      const writer = new FastqWriter({
        lineLength: 50,
        validateOutput: true,
        validationLevel: "full",
      });

      // Should not throw
      expect(() => writer.formatSequence(longSeq)).not.toThrow();
    });

    test("platform preservation works with auto strategy", () => {
      const pacbioSeq: FastqSequence = {
        format: "fastq",
        id: "m54006_160504_011306/4391910/0_1500",
        sequence: "ATCG".repeat(40), // 160bp - long
        quality: "IIII".repeat(40),
        qualityEncoding: "phred33",
        length: 160,
      };

      const writer = new FastqWriter({
        outputStrategy: "auto",
        lineLength: 50,
        preservePlatformFormat: true,
      });

      const output = writer.formatSequence(pacbioSeq);
      const lines = output.split("\n");

      // Should wrap due to length
      expect(lines.length).toBeGreaterThan(4);
      // Should preserve PacBio header format
      expect(lines[0]).toContain("m54006_160504_011306/4391910/0_1500");
    });

    test("all features combined", () => {
      const illuminaSeq: FastqSequence = {
        format: "fastq",
        id: "M01234:567:000000000-ABCDE:1:1101:15589:1338",
        description: "1:N:0:1",
        sequence: "ATCG".repeat(30),
        quality: "IIII".repeat(30),
        qualityEncoding: "phred33",
        length: 120,
      };

      const writer = new FastqWriter({
        outputStrategy: "auto",
        lineLength: 50,
        validateOutput: true,
        validationLevel: "full",
        preservePlatformFormat: true,
        preserveSeparatorId: true,
      });

      const output = writer.formatSequence(illuminaSeq);
      const lines = output.split("\n");

      // Should wrap (auto strategy, long sequence)
      expect(lines.length).toBeGreaterThan(4);
      // Should preserve platform format
      expect(lines[0]).toContain("M01234:567:000000000-ABCDE");
      // Should have separator with ID
      const separatorIndex = lines.findIndex((line) => line.startsWith("+"));
      expect(lines[separatorIndex]).toContain("M01234:567:000000000-ABCDE");
    });
  });
});
