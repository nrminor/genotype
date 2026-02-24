import { describe, expect, test } from "bun:test";
import "./matchers";
import { GenotypeString } from "../src/genotype-string";

describe("toEqualSequence matcher", () => {
  test("matches a string-backed GenotypeString", () => {
    const gs = GenotypeString.fromString("ATCG");
    expect(gs).toEqualSequence("ATCG");
  });

  test("matches a bytes-backed GenotypeString", () => {
    const bytes = new TextEncoder().encode("GATTACA");
    const gs = GenotypeString.fromBytes(bytes);
    expect(gs).toEqualSequence("GATTACA");
  });

  test("matches a plain string", () => {
    expect("ATCG").toEqualSequence("ATCG");
  });

  test("does not match when content differs (string-backed)", () => {
    const gs = GenotypeString.fromString("ATCG");
    expect(gs).not.toEqualSequence("GCTA");
  });

  test("does not match when content differs (bytes-backed)", () => {
    const bytes = new TextEncoder().encode("ATCG");
    const gs = GenotypeString.fromBytes(bytes);
    expect(gs).not.toEqualSequence("GCTA");
  });

  test("does not match when plain string differs", () => {
    expect("ATCG").not.toEqualSequence("GCTA");
  });

  test("handles empty GenotypeString", () => {
    const gs = GenotypeString.fromString("");
    expect(gs).toEqualSequence("");
  });

  test("handles empty plain string", () => {
    expect("").toEqualSequence("");
  });

  test("empty does not match non-empty", () => {
    const gs = GenotypeString.fromString("");
    expect(gs).not.toEqualSequence("A");
  });

  test("case-sensitive comparison", () => {
    const gs = GenotypeString.fromString("atcg");
    expect(gs).not.toEqualSequence("ATCG");
  });

  test("does not match unsupported receiver type", () => {
    expect(123 as unknown).not.toEqualSequence("123");
  });
});
