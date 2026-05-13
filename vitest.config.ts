import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    // Prefer source files over generated JavaScript artifacts that may exist in src/.
    extensions: [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json"],
    alias: [
      { find: /^effect$/, replacement: `${root}packages/core/node_modules/effect/dist/index.js` },
      { find: /^@genotype\/core$/, replacement: `${root}packages/core/src/index.ts` },
      {
        find: /^@genotype\/core\/seqops$/,
        replacement: `${root}packages/core/src/operations/index.ts`,
      },
      { find: /^@genotype\/core\/(.+)$/, replacement: `${root}packages/core/src/$1` },
      { find: /^@genotype\/tabular$/, replacement: `${root}packages/tabular/src/index.ts` },
      { find: /^@genotype\/tabular\/(.+)$/, replacement: `${root}packages/tabular/src/$1` },
      { find: /^@genotype\/parquet$/, replacement: `${root}packages/parquet/src/index.ts` },
      { find: /^@genotype\/parquet\/(.+)$/, replacement: `${root}packages/parquet/src/$1` },
    ],
  },
  ssr: {
    noExternal: ["effect"],
  },
  test: {
    environment: "node",
    // The existing suite was written against Bun's sequential file execution.
    // Several tests share process-level state or relative fixture paths.
    fileParallelism: false,
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
  },
});
