/**
 * Smoke tests for @genotype/parquet
 *
 * Verifies that parquet-wasm and apache-arrow dependencies load correctly
 * and that the package can be imported.
 */

import { describe, expect, test } from "bun:test";
import { PARQUET_VERSION } from "@genotype/parquet/version";

describe("@genotype/parquet smoke tests", () => {
  test("package loads and exports version", () => {
    expect(PARQUET_VERSION).toBe("0.1.0");
  });

  test("apache-arrow can be imported", async () => {
    const arrow = await import("apache-arrow");
    expect(arrow.Table).toBeDefined();
    expect(arrow.Schema).toBeDefined();
    expect(arrow.Field).toBeDefined();
  });

  test("parquet-wasm can be imported", async () => {
    const parquet = await import("parquet-wasm");
    expect(parquet).toBeDefined();
  });
});
