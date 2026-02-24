/**
 * Tests for GenotypeString acceptance across widened utility functions.
 *
 * These tests verify that functions widened to accept GenotypeString | string
 * produce correct results with GenotypeString inputs (both string-backed and
 * bytes-backed), and that overloaded functions return the correct type.
 */

import { describe, expect, test } from "bun:test";
import { GenotypeString } from "../../../src/genotype-string";
import { ValidationError } from "../../../src/errors";
import {
  complement,
  reverseComplement,
  toRNA,
} from "../../../src/operations/core/sequence-manipulation";
import {
  gcContent,
  baseContent,
} from "../../../src/operations/core/calculations";
import {
  boyerMoore,
  fuzzyMatch,
  isPalindromic,
  SequenceMatcher,
} from "../../../src/operations/core/pattern-matching";

function fromString(s: string): GenotypeString {
  return GenotypeString.fromString(s);
}

function fromBytes(s: string): GenotypeString {
  return GenotypeString.fromBytes(new TextEncoder().encode(s));
}

describe("GenotypeString widening", () => {
  describe("sequence-manipulation overload return types", () => {
    test("complement returns GenotypeString when given GenotypeString", () => {
      const gs = fromString("ATCG");
      const result = complement(gs);
      expect(result).toBeInstanceOf(GenotypeString);
      expect(result.toString()).toBe("TAGC");
    });

    test("complement returns string when given string", () => {
      const result = complement("ATCG");
      expect(typeof result).toBe("string");
      expect(result).toBe("TAGC");
    });

    test("reverseComplement returns GenotypeString when given GenotypeString", () => {
      const gs = fromString("ATCG");
      const result = reverseComplement(gs);
      expect(result).toBeInstanceOf(GenotypeString);
      expect(result.toString()).toBe("CGAT");
    });

    test("toRNA returns GenotypeString when given GenotypeString", () => {
      const gs = fromString("ATCG");
      const result = toRNA(gs);
      expect(result).toBeInstanceOf(GenotypeString);
      expect(result.toString()).toBe("AUCG");
    });

    test("overloads work with bytes-backed GenotypeString", () => {
      const gs = fromBytes("ATCG");
      const result = complement(gs);
      expect(result).toBeInstanceOf(GenotypeString);
      expect(result.toString()).toBe("TAGC");
    });
  });

  describe("calculations parity", () => {
    const dna = "ATCGATCGGC";

    test("gcContent matches between string and string-backed GenotypeString", () => {
      const fromStr = gcContent(dna);
      const fromGs = gcContent(fromString(dna));
      expect(fromGs).toBe(fromStr);
    });

    test("gcContent matches with bytes-backed GenotypeString", () => {
      const fromStr = gcContent(dna);
      const fromGs = gcContent(fromBytes(dna));
      expect(fromGs).toBe(fromStr);
    });

    test("baseContent matches between string and GenotypeString", () => {
      const fromStr = baseContent(dna, "GC");
      const fromGs = baseContent(fromString(dna), "GC");
      expect(fromGs).toBe(fromStr);
    });
  });

  describe("pattern-matching parity", () => {
    const dna = "ATCGATCGATCG";

    test("boyerMoore matches between string and GenotypeString", () => {
      const fromStr = boyerMoore(dna, "ATCG");
      const fromGs = boyerMoore(fromString(dna), "ATCG");
      expect(fromGs).toEqual(fromStr);
    });

    test("boyerMoore works with bytes-backed GenotypeString", () => {
      const fromStr = boyerMoore(dna, "ATCG");
      const fromGs = boyerMoore(fromBytes(dna), "ATCG");
      expect(fromGs).toEqual(fromStr);
    });

    test("fuzzyMatch matches between string and GenotypeString", () => {
      const fromStr = fuzzyMatch(dna, "ATCX", 1);
      const fromGs = fuzzyMatch(fromString(dna), "ATCX", 1);
      expect(fromGs).toEqual(fromStr);
    });
  });

  describe("SequenceMatcher with GenotypeString", () => {
    test("findInSequence accepts GenotypeString", () => {
      const matcher = new SequenceMatcher("ATCG");
      const gs = fromString("AATCGATCG");
      const matches = matcher.findInSequence(gs);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]!.position).toBe(1);
    });

    test("count accepts GenotypeString", () => {
      const matcher = new SequenceMatcher("ATCG");
      const gs = fromString("ATCGATCGATCG");
      expect(matcher.count(gs)).toBe(3);
    });
  });

  describe("ValidationError on invalid input", () => {
    test("isPalindromic throws ValidationError for empty string", () => {
      expect(() => isPalindromic("")).toThrow(ValidationError);
    });

    test("fuzzyMatch throws ValidationError for negative mismatches", () => {
      expect(() => fuzzyMatch("ATCG", "AT", -1)).toThrow(ValidationError);
    });
  });
});
