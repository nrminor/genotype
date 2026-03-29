import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");
const projectRoot = resolve(packageRoot, "../..");
const licensePath = join(projectRoot, "LICENSE");

const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

const normalizeWorkspaceDeps = (deps = {}) => {
  return Object.fromEntries(
    Object.entries(deps).map(([name, version]) => [
      name,
      typeof version === "string" && version.startsWith("workspace:")
        ? packageJson.version
        : version,
    ])
  );
};

const distDir = join(packageRoot, "dist");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const tsconfigBuildPath = join(packageRoot, "tsconfig.build.json");
const tsconfigBuild = {
  compilerOptions: {
    strict: true,
    target: "ES2022",
    module: "ES2022",
    moduleResolution: "bundler",
    moduleDetection: "force",
    verbatimModuleSyntax: false,
    rewriteRelativeImportExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    skipLibCheck: true,
    declaration: true,
    declarationMap: true,
    sourceMap: true,
    outDir: "./dist",
    rootDir: "./src",
    noEmit: false,
    lib: ["ES2022", "DOM"],
    types: ["bun", "node"],
    paths: {
      "@genotype/core": ["../core/dist/index.d.ts"],
      "@genotype/core/seqops": ["../core/dist/operations/index.d.ts"],
      "@genotype/core/*": ["../core/dist/*"],
      "@genotype/tabular": ["./src/index.ts"],
      "@genotype/tabular/*": ["./src/*"],
    },
  },
  include: ["src/**/*"],
  exclude: ["test", "dist", "docs", "node_modules"],
};

writeFileSync(tsconfigBuildPath, JSON.stringify(tsconfigBuild, null, 2));

const tsc = spawnSync("bunx", ["tsc", "-p", tsconfigBuildPath], {
  cwd: packageRoot,
  stdio: "inherit",
});

rmSync(tsconfigBuildPath, { force: true });

if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

const distPackageJson = {
  name: packageJson.name,
  version: packageJson.version,
  description: packageJson.description,
  license: packageJson.license,
  repository: packageJson.repository,
  type: packageJson.type,
  main: "index.js",
  types: "index.d.ts",
  sideEffects: ["./index.js", "./seqops-ext.js"],
  exports: {
    ".": {
      import: "./index.js",
      require: "./index.js",
      types: "./index.d.ts",
    },
    "./dsv": {
      import: "./dsv/index.js",
      require: "./dsv/index.js",
      types: "./dsv/index.d.ts",
    },
    "./dsv/*": {
      import: "./dsv/*.js",
      require: "./dsv/*.js",
      types: "./dsv/*.d.ts",
    },
    "./errors": {
      import: "./errors.js",
      require: "./errors.js",
      types: "./errors.d.ts",
    },
    "./fx2tab": {
      import: "./fx2tab.js",
      require: "./fx2tab.js",
      types: "./fx2tab.d.ts",
    },
    "./seqops-ext": {
      import: "./seqops-ext.js",
      require: "./seqops-ext.js",
      types: "./seqops-ext.d.ts",
    },
    "./package.json": "./package.json",
  },
  dependencies: normalizeWorkspaceDeps(packageJson.dependencies),
  peerDependencies: packageJson.peerDependencies,
};

writeFileSync(join(distDir, "package.json"), JSON.stringify(distPackageJson, null, 2));

if (existsSync(join(projectRoot, "README.md"))) {
  copyFileSync(join(projectRoot, "README.md"), join(distDir, "README.md"));
}

if (existsSync(licensePath)) {
  copyFileSync(licensePath, join(distDir, "LICENSE"));
}
