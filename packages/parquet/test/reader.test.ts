/**
 * Parquet reader tests
 *
 * Verifies streaming reads of Parquet files via parquet-wasm,
 * including column projection, batch sizing, and cancellation.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { createFastaRecord } from "@genotype/core/constructors";
import { fx2tab } from "@genotype/tabular/fx2tab";
import { writeParquet } from "@genotype/parquet/writer";
import { readParquet } from "@genotype/parquet/reader";

const tempDir = "/tmp/genotype-parquet-reader-test";

beforeEach(() => {
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function testSequences(count = 10) {
  return Array.from({ length: count }, (_, i) =>
    createFastaRecord({
      id: `seq${i + 1}`,
      sequence: "ATCG".repeat(i + 1),
    })
  );
}

async function* toAsync<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

async function writeTestParquet(
  path: string,
  count = 10,
  columns: readonly string[] = ["id", "sequence", "length", "gc"]
) {
  const rows = fx2tab(toAsync(testSequences(count)), {
    columns: columns as readonly string[],
    header: false,
  });
  await writeParquet(rows, path);
}

describe("readParquet", () => {
  test("reads all rows from a parquet file", async () => {
    const path = `${tempDir}/basic.parquet`;
    await writeTestParquet(path);

    const rows = [];
    for await (const row of readParquet(path)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(10);
    expect(rows[0]!.id).toBe("seq1");
    expect(rows[9]!.id).toBe("seq10");
  });

  test("preserves column types", async () => {
    const path = `${tempDir}/types.parquet`;
    await writeTestParquet(path, 3);

    const rows = [];
    for await (const row of readParquet(path)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(3);
    expect(typeof rows[0]!.id).toBe("string");
    expect(typeof rows[0]!.sequence).toBe("string");
    expect(typeof rows[0]!.length).toBe("number");
    expect(typeof rows[0]!.gc).toBe("number");
  });

  test("supports column projection", async () => {
    const path = `${tempDir}/projection.parquet`;
    await writeTestParquet(path, 5);

    const rows = [];
    for await (const row of readParquet(path, { columns: ["id", "length"] })) {
      rows.push(row);
    }

    expect(rows).toHaveLength(5);
    expect(rows[0]!.id).toBe("seq1");
    expect(rows[0]!.length).toBe(4);
    expect(rows[0]!.sequence).toBeUndefined();
    expect(rows[0]!.gc).toBeUndefined();
  });

  test("supports batch size option", async () => {
    const path = `${tempDir}/batch.parquet`;
    await writeTestParquet(path, 10);

    const rows = [];
    for await (const row of readParquet(path, { batchSize: 3 })) {
      rows.push(row);
    }

    expect(rows).toHaveLength(10);
  });

  test("supports limit option", async () => {
    const path = `${tempDir}/limit.parquet`;
    await writeTestParquet(path, 10);

    const rows = [];
    for await (const row of readParquet(path, { limit: 5 })) {
      rows.push(row);
    }

    expect(rows).toHaveLength(5);
  });

  test("supports early break without leaking resources", async () => {
    const path = `${tempDir}/early-break.parquet`;
    await writeTestParquet(path, 100);

    const rows = [];
    for await (const row of readParquet(path)) {
      rows.push(row);
      if (rows.length >= 3) break;
    }

    expect(rows).toHaveLength(3);
    expect(rows[0]!.id).toBe("seq1");
  });

  test("round-trips data through write and read", async () => {
    const path = `${tempDir}/roundtrip.parquet`;
    const sequences = testSequences(5);
    const rows = fx2tab(toAsync(sequences), {
      columns: ["id", "sequence", "length"] as const,
      header: false,
    });

    await writeParquet(rows, path);

    const readRows = [];
    for await (const row of readParquet(path)) {
      readRows.push(row);
    }

    expect(readRows).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(readRows[i]!.id).toBe(`seq${i + 1}`);
      expect(readRows[i]!.sequence).toBe("ATCG".repeat(i + 1));
      expect(readRows[i]!.length).toBe((i + 1) * 4);
    }
  });

  test("accepts signal option without error when not aborted", async () => {
    const path = `${tempDir}/signal.parquet`;
    await writeTestParquet(path, 3);

    const controller = new AbortController();
    const rows = [];

    for await (const row of readParquet(path, { signal: controller.signal })) {
      rows.push(row);
    }

    expect(rows).toHaveLength(3);
  });
});
