import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactsDir = mkdtempSync(join(tmpdir(), "genotype-consumer-artifacts-"));
const consumerDir = mkdtempSync(join(tmpdir(), "genotype-consumer-e2e-"));
const templateDir = join(projectRoot, "tests", "consumer-e2e", "template");

const run = (command, args, cwd = projectRoot) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

console.log("Building publish artifacts (core/tabular/parquet)...");
run("bun", ["run", "--cwd", "packages/core", "build"]);
run("bun", ["run", "--cwd", "packages/tabular", "build"]);
run("bun", ["run", "--cwd", "packages/parquet", "build"]);

const coreTgz = join(artifactsDir, "genotype-core.tgz");
const tabularTgz = join(artifactsDir, "genotype-tabular.tgz");
const parquetTgz = join(artifactsDir, "genotype-parquet.tgz");

console.log("Packing tarballs...");
run("bun", ["pm", "pack", "--filename", coreTgz], join(projectRoot, "packages/core"));
run("bun", ["pm", "pack", "--filename", tabularTgz], join(projectRoot, "packages/tabular"));
run("bun", ["pm", "pack", "--filename", parquetTgz], join(projectRoot, "packages/parquet"));

cpSync(templateDir, consumerDir, { recursive: true });

const packageJsonTemplate = readFileSync(join(consumerDir, "package.json"), "utf8");
const packageJsonResolved = packageJsonTemplate
  .replaceAll("__CORE_TGZ__", `file:${coreTgz}`)
  .replaceAll("__TABULAR_TGZ__", `file:${tabularTgz}`)
  .replaceAll("__PARQUET_TGZ__", `file:${parquetTgz}`);
writeFileSync(join(consumerDir, "package.json"), packageJsonResolved);

console.log(`Running external consumer check in ${consumerDir}`);
run("bun", ["install", "--force"], consumerDir);
run("bun", ["run", "check"], consumerDir);

console.log("✅ External consumer check passed");
