/**
 * Parquet writer tests
 *
 * Verifies that Fx2TabRow data can be written to Parquet files
 * and read back correctly via parquet-wasm.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { createFastaRecord } from "@genotype/core/constructors";
import { fx2tab, TabularOps } from "@genotype/tabular/fx2tab";
import "@genotype/tabular";
import "@genotype/parquet";
import { writeParquet } from "@genotype/parquet/writer";
import { tableFromIPC } from "apache-arrow";

const tempDir = "/tmp/genotype-parquet-test";

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

describe("writeParquet", () => {
  test("writes a valid parquet file from fx2tab rows", async () => {
    const path = `${tempDir}/output.parquet`;
    const rows = fx2tab(toAsync(testSequences()), {
      columns: ["id", "sequence", "length"] as const,
      header: false,
    });

    await writeParquet(rows, path);

    expect(existsSync(path)).toBe(true);
    const bytes = readFileSync(path);
    expect(bytes.length).toBeGreaterThan(0);

    // Parquet magic bytes: "PAR1"
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x41); // A
    expect(bytes[2]).toBe(0x52); // R
    expect(bytes[3]).toBe(0x31); // 1
  });

  test("round-trips data through parquet correctly", async () => {
    const path = `${tempDir}/roundtrip.parquet`;
    const rows = fx2tab(toAsync(testSequences()), {
      columns: ["id", "sequence", "length"] as const,
      header: false,
    });

    await writeParquet(rows, path);

    // Read back with parquet-wasm
    // Node/Bun build self-initializes; no init() call needed
    const parquetWasm = await import("parquet-wasm");

    const bytes = new Uint8Array(readFileSync(path));
    const wasmTable = parquetWasm.readParquet(bytes);
    const ipcBytes = wasmTable.intoIPCStream();
    const arrowTable = tableFromIPC(ipcBytes);

    expect(arrowTable.numRows).toBe(3);
    expect(arrowTable.numCols).toBe(3);

    const idCol = arrowTable.getChild("id");
    expect(idCol).toBeDefined();
    expect(idCol!.get(0)).toBe("seq1");
    expect(idCol!.get(1)).toBe("seq2");
    expect(idCol!.get(2)).toBe("seq3");

    const seqCol = arrowTable.getChild("sequence");
    expect(seqCol).toBeDefined();
    expect(seqCol!.get(0)).toBe("ATCGATCG");

    const lenCol = arrowTable.getChild("length");
    expect(lenCol).toBeDefined();
    expect(lenCol!.get(0)).toBe(8);
  });

  test("writes numeric columns as Float64", async () => {
    const path = `${tempDir}/numeric.parquet`;
    const rows = fx2tab(toAsync(testSequences()), {
      columns: ["id", "length", "gc"] as const,
      header: false,
    });

    await writeParquet(rows, path);

    // Node/Bun build self-initializes; no init() call needed
    const parquetWasm = await import("parquet-wasm");

    const bytes = new Uint8Array(readFileSync(path));
    const wasmTable = parquetWasm.readParquet(bytes);
    const arrowTable = tableFromIPC(wasmTable.intoIPCStream());

    const gcCol = arrowTable.getChild("gc");
    expect(gcCol).toBeDefined();
    expect(typeof gcCol!.get(0)).toBe("number");
  });

  test("TabularOps.writeParquet() works via augmentation", async () => {
    const path = `${tempDir}/augmented.parquet`;
    const tabular = new TabularOps(
      fx2tab(toAsync(testSequences()), {
        columns: ["id", "sequence"] as const,
        header: false,
      })
    );

    await tabular.writeParquet(path);

    expect(existsSync(path)).toBe(true);
    const bytes = readFileSync(path);
    expect(bytes[0]).toBe(0x50); // PAR1 magic
  });

  test("supports compression option", async () => {
    const path = `${tempDir}/compressed.parquet`;
    const rows = fx2tab(toAsync(testSequences()), {
      columns: ["id", "sequence"] as const,
      header: false,
    });

    await writeParquet(rows, path, { compression: "snappy" });

    expect(existsSync(path)).toBe(true);
  });
});
