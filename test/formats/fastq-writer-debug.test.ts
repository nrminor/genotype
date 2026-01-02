/**
 * Test suite for FASTQ Writer debug logging and constant usage
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PARSING_DEFAULTS } from "../../src/formats/fastq/constants";
import { FastqWriter } from "../../src/formats/fastq/writer";
import type { FastqSequence } from "../../src/types";

describe("FASTQ Writer Debug and Constants", () => {
  let originalConsoleLog: typeof console.log;
  let consoleOutput: string[] = [];

  beforeEach(() => {
    // Mock console.log to capture debug output
    originalConsoleLog = console.log;
    consoleOutput = [];
    // Mock console.log with proper typing - matches console.log signature
    console.log = (...args: Parameters<typeof console.log>) => {
      // Convert objects to JSON strings for easier testing
      const message = args
        .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
        .join(" ");
      consoleOutput.push(message);
    };
  });

  afterEach(() => {
    // Restore original console.log
    console.log = originalConsoleLog;
  });

  describe("Debug Logging", () => {
    test("logs initialization when debug is enabled", () => {
      new FastqWriter({ debug: true });

      expect(
        consoleOutput.some((log) => log.includes("[FastqWriter] Initialized with options:"))
      ).toBe(true);
      // The object is logged as a JSON string
      expect(consoleOutput.some((log) => log.includes('"qualityEncoding":"phred33"'))).toBe(true);
    });

    test("doesn't log when debug is disabled", () => {
      new FastqWriter({ debug: false });

      expect(consoleOutput.length).toBe(0);
    });

    test("logs strategy selection", () => {
      const writer = new FastqWriter({ debug: true, outputStrategy: "auto", lineLength: 80 });

      const shortSequence: FastqSequence = {
        format: "fastq",
        id: "seq1",
        sequence: "ATCG",
        quality: "IIII",
        qualityEncoding: "phred33",
        length: 4,
      };

      writer.formatSequence(shortSequence);

      expect(consoleOutput.some((log) => log.includes("[FastqWriter] Strategy: 'simple'"))).toBe(
        true
      );
      expect(consoleOutput.some((log) => log.includes("auto - default for short sequence"))).toBe(
        true
      );
    });

    test("logs platform detection", () => {
      const writer = new FastqWriter({ debug: true, preservePlatformFormat: true });

      const illuminaSequence: FastqSequence = {
        format: "fastq",
        id: "M00100:21:000000000-A1234:1:1101:15589:1758",
        description: "1:N:0:1",
        sequence: "ATCGATCG",
        quality: "IIIIIIII",
        qualityEncoding: "phred33",
        length: 8,
      };

      writer.formatSequence(illuminaSequence);

      expect(
        consoleOutput.some((log) => log.includes("[FastqWriter] Platform detected: illumina"))
      ).toBe(true);
    });

    test("logs quality encoding conversion", () => {
      const writer = new FastqWriter({ debug: true, qualityEncoding: "phred64" });

      const sequence: FastqSequence = {
        format: "fastq",
        id: "seq1",
        sequence: "ATCG",
        quality: "IIII",
        qualityEncoding: "phred33",
        length: 4,
      };

      writer.formatSequence(sequence);

      expect(
        consoleOutput.some((log) =>
          log.includes("[FastqWriter] Converting quality: phred33 -> phred64")
        )
      ).toBe(true);
    });

    test("logs when no quality conversion needed", () => {
      const writer = new FastqWriter({ debug: true, qualityEncoding: "phred33" });

      const sequence: FastqSequence = {
        format: "fastq",
        id: "seq1",
        sequence: "ATCG",
        quality: "IIII",
        qualityEncoding: "phred33",
        length: 4,
      };

      writer.formatSequence(sequence);

      expect(
        consoleOutput.some((log) =>
          log.includes("[FastqWriter] Quality encoding: no conversion needed (phred33)")
        )
      ).toBe(true);
    });

    test("logs wrapped strategy selection for long sequences", () => {
      const writer = new FastqWriter({ debug: true, outputStrategy: "auto", lineLength: 10 });

      const longSequence: FastqSequence = {
        format: "fastq",
        id: "seq1",
        sequence: "A".repeat(150), // Long sequence
        quality: "I".repeat(150),
        qualityEncoding: "phred33",
        length: 150,
      };

      writer.formatSequence(longSequence);

      expect(consoleOutput.some((log) => log.includes("[FastqWriter] Strategy: 'wrapped'"))).toBe(
        true
      );
      expect(consoleOutput.some((log) => log.includes("auto - long sequence"))).toBe(true);
    });

    test("logs when platform is unknown", () => {
      const writer = new FastqWriter({
        debug: true,
        preservePlatformFormat: true,
        outputStrategy: "auto",
        lineLength: 80,
      });

      const unknownPlatformSequence: FastqSequence = {
        format: "fastq",
        id: "custom_seq_001",
        sequence: "ATCG",
        quality: "IIII",
        qualityEncoding: "phred33",
        length: 4,
      };

      writer.formatSequence(unknownPlatformSequence);

      expect(consoleOutput.some((log) => log.includes("[FastqWriter] Platform: unknown"))).toBe(
        true
      );
    });
  });

  describe("Constant Usage", () => {
    test("uses PARSING_DEFAULTS.DEFAULT_ENCODING constant", () => {
      // Create writer without specifying encoding
      const writer = new FastqWriter({});

      // The writer should use the constant from PARSING_DEFAULTS
      const sequence: FastqSequence = {
        format: "fastq",
        id: "seq1",
        sequence: "ATCG",
        quality: "IIII",
        qualityEncoding: PARSING_DEFAULTS.DEFAULT_ENCODING,
        length: 4,
      };

      const result = writer.formatSequence(sequence);

      // Should format correctly without conversion since default is from constant
      expect(result).toBe("@seq1\nATCG\n+\nIIII");
    });

    test("uses PARSING_DEFAULTS.DEFAULT_VALIDATION constant", () => {
      const writer = new FastqWriter({ validateOutput: true, debug: true });

      // The writer should use the default validation level from constants
      const sequence: FastqSequence = {
        format: "fastq",
        id: "seq1",
        sequence: "ATCG",
        quality: "IIII",
        qualityEncoding: "phred33",
        length: 4,
      };

      // This should succeed with quick validation
      expect(() => writer.formatSequence(sequence)).not.toThrow();

      // Check that initialization logged the default validation level (as JSON)
      expect(
        consoleOutput.some((log) =>
          log.includes(`"validationLevel":"${PARSING_DEFAULTS.DEFAULT_VALIDATION}"`)
        )
      ).toBe(true);
    });
  });

  describe("Complex Debug Scenarios", () => {
    test("logs complete flow for complex sequence", () => {
      const writer = new FastqWriter({
        debug: true,
        qualityEncoding: "phred64",
        preservePlatformFormat: true,
        outputStrategy: "auto",
        lineLength: 50,
      });

      const pacbioSequence: FastqSequence = {
        format: "fastq",
        id: "m54006_160210_020549/4194369/0_2273",
        sequence: "A".repeat(1500), // Long PacBio read
        quality: "I".repeat(1500),
        qualityEncoding: "phred33",
        length: 1500,
      };

      writer.formatSequence(pacbioSequence);

      // Should log platform detection
      expect(
        consoleOutput.some((log) => log.includes("[FastqWriter] Platform detected: pacbio"))
      ).toBe(true);

      // Should log wrapped strategy selection
      expect(consoleOutput.some((log) => log.includes("[FastqWriter] Strategy: 'wrapped'"))).toBe(
        true
      );
      expect(consoleOutput.some((log) => log.includes("pacbio"))).toBe(true);

      // Should log quality conversion
      expect(
        consoleOutput.some((log) =>
          log.includes("[FastqWriter] Converting quality: phred33 -> phred64")
        )
      ).toBe(true);
    });
  });
});
