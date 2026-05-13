import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactsDir = mkdtempSync(join(tmpdir(), "genotype-consumer-artifacts-"));
const templateDir = join(projectRoot, "tests", "consumer-e2e", "template");
const publishRoot = join(projectRoot, "dist", "npm");

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
run("bun", ["run", "build:publish-artifacts"]);

const packageDirs = Object.fromEntries(
  readdirSync(publishRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(publishRoot, entry.name);
      const packageJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      return [packageJson.name, dir];
    })
);

const packageTarballs = new Map();
const tarballName = (packageName) => packageName.replace(/^@/, "").replaceAll("/", "-");

console.log("Packing tarballs...");
for (const [packageName, packageDir] of Object.entries(packageDirs)) {
  const tarball = join(artifactsDir, `${tarballName(packageName)}.tgz`);
  run("bun", ["pm", "pack", "--filename", tarball], packageDir);
  packageTarballs.set(packageName, tarball);
}

const requireTarball = (packageName) => {
  const tarball = packageTarballs.get(packageName);
  if (!tarball) throw new Error(`Missing packed tarball for ${packageName}`);
  return tarball;
};

const currentNativePackageName = () => {
  if (process.platform === "darwin") return `@genotype/engine-darwin-${process.arch}`;
  if (process.platform === "win32") return `@genotype/engine-win32-${process.arch}-msvc`;
  if (process.platform === "linux") {
    const libc = process.report?.getReport?.().header?.glibcVersionRuntime ? "gnu" : "musl";
    return `@genotype/engine-linux-${process.arch}-${libc}`;
  }
  return undefined;
};

const writeConsumerPackageJson = (consumerDir, extraDependencies = {}) => {
  const packageJson = JSON.parse(readFileSync(join(consumerDir, "package.json"), "utf8"));
  packageJson.devDependencies.typescript = "^6.0.3";
  packageJson.dependencies = {
    ...packageJson.dependencies,
    "@genotype/core": `file:${requireTarball("@genotype/core")}`,
    "@genotype/tabular": `file:${requireTarball("@genotype/tabular")}`,
    "@genotype/parquet": `file:${requireTarball("@genotype/parquet")}`,
    "@genotype/engine-wasm": `file:${requireTarball("@genotype/engine-wasm")}`,
    ...extraDependencies,
  };
  packageJson.overrides = {
    "@genotype/core": packageJson.dependencies["@genotype/core"],
    "@genotype/tabular": packageJson.dependencies["@genotype/tabular"],
    "@genotype/parquet": packageJson.dependencies["@genotype/parquet"],
    "@genotype/engine-wasm": packageJson.dependencies["@genotype/engine-wasm"],
    ...extraDependencies,
  };
  writeFileSync(join(consumerDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
};

const runConsumer = (label, extraDependencies, scripts) => {
  const consumerDir = mkdtempSync(join(tmpdir(), `genotype-consumer-${label}-`));
  cpSync(templateDir, consumerDir, { recursive: true });
  writeConsumerPackageJson(consumerDir, extraDependencies);
  console.log(`Running ${label} consumer check in ${consumerDir}`);
  run("bun", ["install", "--force"], consumerDir);
  for (const script of scripts) {
    run("bun", ["run", script], consumerDir);
  }
};

runConsumer("wasm", {}, ["check", "runtime:engine-wasm"]);

const nativePackageName = currentNativePackageName();
if (nativePackageName && packageTarballs.has(nativePackageName)) {
  runConsumer("native", { [nativePackageName]: `file:${requireTarball(nativePackageName)}` }, [
    "runtime:engine-native",
  ]);
} else {
  console.warn(
    `Skipping native consumer check: no tarball for ${nativePackageName ?? process.platform}`
  );
}

console.log("✅ External consumer checks passed");
