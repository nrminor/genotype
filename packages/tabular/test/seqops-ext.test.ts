/**
 * Tests for SeqOps tabular extension methods.
 *
 * Verifies that importing @genotype/tabular augments SeqOps with
 * tabular write methods (toTabular, writeTSV, writeCSV, etc.)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import "../../core/test/matchers";
import { createFastaRecord } from "@genotype/core/constructors";
import { seqops } from "@genotype/core/operations";
import "@genotype/tabular";

const tempDir = "/tmp/genotype-seqops-ext-test";

beforeEach(() => {
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function testSequences() {
  return [
    createFastaRecord({ id: "seq1", sequence: "ATCGATCG" }),
    createFastaRecord({ id: "seq2", sequence: "GCTAGCTA" }),
    createFastaRecord({ id: "seq3", sequence: "TTTTAAAA" }),
  ];
}

async function* toAsync<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

describe("SeqOps tabular extension methods", () => {
  test("toTabular() is available after importing @genotype/tabular", async () => {
    const ops = seqops(toAsync(testSequences()));
    const tabular = ops.toTabular({ columns: ["id", "sequence", "length"] as const, header: false });
    expect(tabular).toBeDefined();
    const rows = await tabular.toArray();
    expect(rows).toHaveLength(3);
    expect(rows[0]!.id).toBe("seq1");
  });

  test("writeTSV() writes tab-separated output", async () => {
    const path = `${tempDir}/output.tsv`;
    await seqops(toAsync(testSequences())).writeTSV(path, {
      columns: ["id", "sequence", "length"] as const,
    });

    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(4); // header + 3 rows
    expect(lines[0]).toContain("id\t");
    expect(lines[1]).toContain("seq1\t");
  });

  test("writeCSV() writes comma-separated output", async () => {
    const path = `${tempDir}/output.csv`;
    await seqops(toAsync(testSequences())).writeCSV(path, {
      columns: ["id", "sequence"] as const,
    });

    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toContain(",");
    expect(content).toContain("seq1");
  });

  test("methods chain after filter()", async () => {
    const path = `${tempDir}/filtered.tsv`;
    await seqops(toAsync(testSequences()))
      .filter({ minLength: 1 })
      .writeTSV(path, { columns: ["id", "length"] as const });

    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("seq1");
  });
});
