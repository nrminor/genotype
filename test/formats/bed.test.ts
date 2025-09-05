/**
 * Basic BED format tests to establish current behavior
 *
 * Simpler test suite to understand current bed.ts implementation
 * before comprehensive refactoring. Following AGENTS.md principle:
 * "Respect existing code - understand why it exists before changing"
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { BedParser, BedWriter, BedUtils } from "../../src/formats/bed";
import { BedError } from "../../src/errors";
import type { BedInterval } from "../../src/types";

describe("BED Format - Current Implementation Behavior", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  test("parses minimal BED3 format", async () => {
    const bed3Data = "chr1\t1000\t2000\n";
    const [interval] = await Array.fromAsync(parser.parseString(bed3Data));

    expect(interval.chromosome).toBe("chr1");
    expect(interval.start).toBe(1000);
    expect(interval.end).toBe(2000);
    expect(interval.length).toBe(1000); // Current implementation adds length
  });

  test("parses BED6 with all basic fields", async () => {
    const bed6Data = "chr1\t1000\t2000\tfeature1\t100\t+\n";
    const [interval] = await Array.fromAsync(parser.parseString(bed6Data));

    expect(interval.name).toBe("feature1");
    expect(interval.score).toBe(100);
    expect(interval.strand).toBe("+");
  });

  test("current coordinate validation behavior", async () => {
    const invalidData = "chr1\t2000\t1000\n"; // start > end

    let threwError = false;
    try {
      for await (const interval of parser.parseString(invalidData)) {
        // Should not reach here
      }
    } catch (error) {
      threwError = true;
      expect(error).toBeInstanceOf(BedError);
    }
    expect(threwError).toBe(true);
  });

  test("handles comments and empty lines", async () => {
    const dataWithComments = `
# Comment line
track name="test"
chr1\t1000\t2000

chr2\t3000\t4000
    `.trim();

    const intervals = await Array.fromAsync(parser.parseString(dataWithComments));
    expect(intervals).toHaveLength(2);
  });

  test("detects format correctly", () => {
    const bedData = "chr1\t1000\t2000\n";
    expect(BedUtils.detectFormat(bedData)).toBe(true);

    const notBedData = ">seq1\nATCG\n";
    expect(BedUtils.detectFormat(notBedData)).toBe(false);
  });
});

describe("BED Writer - Current Implementation", () => {
  let writer: BedWriter;

  beforeEach(() => {
    writer = new BedWriter();
  });

  test("formats minimal interval", () => {
    const interval: BedInterval = {
      chromosome: "chr1",
      start: 1000,
      end: 2000,
    };

    const formatted = writer.formatInterval(interval);
    expect(formatted).toBe("chr1\t1000\t2000");
  });

  test("formats interval with optional fields", () => {
    const interval: BedInterval = {
      chromosome: "chr1",
      start: 1000,
      end: 2000,
      name: "feature1",
      score: 100,
      strand: "+",
    };

    const formatted = writer.formatInterval(interval);
    expect(formatted).toBe("chr1\t1000\t2000\tfeature1\t100\t+");
  });
});
