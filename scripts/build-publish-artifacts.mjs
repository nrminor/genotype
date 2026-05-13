import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const publishRoot = join(projectRoot, "dist", "npm");
const licensePath = join(projectRoot, "LICENSE");

const packageRoots = {
  core: join(projectRoot, "packages", "core"),
  tabular: join(projectRoot, "packages", "tabular"),
  parquet: join(projectRoot, "packages", "parquet"),
};

const engineBaseName = "@genotype/engine";
const wasmEngineName = "@genotype/engine-wasm";

const nativeTargets = new Map([
  ["darwin-arm64", { os: ["darwin"], cpu: ["arm64"] }],
  ["darwin-x64", { os: ["darwin"], cpu: ["x64"] }],
  ["linux-x64-gnu", { os: ["linux"], cpu: ["x64"], libc: ["glibc"] }],
  ["linux-x64-musl", { os: ["linux"], cpu: ["x64"], libc: ["musl"] }],
  ["linux-arm64-gnu", { os: ["linux"], cpu: ["arm64"], libc: ["glibc"] }],
  ["linux-arm64-musl", { os: ["linux"], cpu: ["arm64"], libc: ["musl"] }],
  ["win32-x64-msvc", { os: ["win32"], cpu: ["x64"] }],
  ["win32-arm64-msvc", { os: ["win32"], cpu: ["arm64"] }],
]);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const copyIfExists = (from, to) => {
  if (existsSync(from)) cpSync(from, to, { recursive: true });
};

const copyPackageDist = (packageKey, mutatePackageJson = (pkg) => pkg) => {
  const packageRoot = packageRoots[packageKey];
  const distDir = join(packageRoot, "dist");
  const destination = join(publishRoot, packageKey);

  if (!existsSync(join(distDir, "package.json"))) {
    throw new Error(
      `Missing built package at ${distDir}. Run the package build before staging publish artifacts.`
    );
  }

  mkdirSync(destination, { recursive: true });
  cpSync(distDir, destination, { recursive: true });
  writeJson(
    join(destination, "package.json"),
    mutatePackageJson(readJson(join(destination, "package.json")))
  );
  return destination;
};

const stageNativeEngines = () => {
  const nativeDir = join(packageRoots.core, "src", "native");
  if (!existsSync(nativeDir)) return [];

  const nativeFiles = readdirSync(nativeDir).filter((file) => file.endsWith(".node"));
  return nativeFiles.map((file) => {
    const match = /^index\.(.+)\.node$/.exec(file);
    if (!match) throw new Error(`Unexpected native engine filename: ${file}`);

    const platformArchAbi = match[1];
    const target = nativeTargets.get(platformArchAbi);
    if (!target) {
      throw new Error(`No package metadata mapping for native target: ${platformArchAbi}`);
    }

    const packageName = `${engineBaseName}-${platformArchAbi}`;
    const packageDir = join(publishRoot, `engine-${platformArchAbi}`);
    const corePackage = readJson(join(packageRoots.core, "package.json"));
    mkdirSync(packageDir, { recursive: true });
    cpSync(join(nativeDir, file), join(packageDir, file));
    copyIfExists(licensePath, join(packageDir, "LICENSE"));

    writeJson(join(packageDir, "package.json"), {
      name: packageName,
      version: corePackage.version,
      description: `Native genotype engine for ${platformArchAbi}`,
      license: corePackage.license,
      repository: corePackage.repository,
      type: "commonjs",
      main: file,
      files: [file, "LICENSE"],
      os: target.os,
      cpu: target.cpu,
      ...(target.libc ? { libc: target.libc } : {}),
      publishConfig: { access: "public" },
    });

    return { name: packageName, dir: packageDir };
  });
};

const stageWasmEngine = () => {
  const wasmPkgDir = join(projectRoot, "crates", "wasm-adapter", "pkg");
  const packageDir = join(publishRoot, "engine-wasm");
  const corePackage = readJson(join(packageRoots.core, "package.json"));
  const requiredFiles = [
    "genotype_wasm.js",
    "genotype_wasm.d.ts",
    "genotype_wasm_bg.wasm",
    "genotype_wasm_bg.wasm.d.ts",
  ];

  for (const file of requiredFiles) {
    if (!existsSync(join(wasmPkgDir, file))) {
      throw new Error(
        `Missing wasm artifact ${file}. Run the wasm build before staging publish artifacts.`
      );
    }
  }

  mkdirSync(packageDir, { recursive: true });
  for (const file of requiredFiles) {
    cpSync(join(wasmPkgDir, file), join(packageDir, file));
  }
  copyIfExists(licensePath, join(packageDir, "LICENSE"));

  writeJson(join(packageDir, "package.json"), {
    name: wasmEngineName,
    version: corePackage.version,
    description: "WebAssembly genotype engine",
    license: corePackage.license,
    repository: corePackage.repository,
    type: "module",
    main: "genotype_wasm.js",
    module: "genotype_wasm.js",
    types: "genotype_wasm.d.ts",
    files: [...requiredFiles, "LICENSE"],
    exports: {
      ".": {
        types: "./genotype_wasm.d.ts",
        import: "./genotype_wasm.js",
      },
      "./genotype_wasm.js": {
        types: "./genotype_wasm.d.ts",
        import: "./genotype_wasm.js",
      },
      "./genotype_wasm_bg.wasm": "./genotype_wasm_bg.wasm",
      "./package.json": "./package.json",
    },
    sideEffects: false,
    publishConfig: { access: "public" },
  });

  return { name: wasmEngineName, dir: packageDir };
};

const assertNoForbiddenPackageNames = () => {
  const stack = [publishRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.isFile() || !/\.(json|js|cjs|mjs|d\.ts)$/.test(entry.name)) continue;
      const text = readFileSync(path, "utf8");
      if (text.includes("genotype-monorepo")) {
        throw new Error(`Forbidden generated package name found in ${path}`);
      }
      if (text.includes("@genotype/wasm-pkg")) {
        throw new Error(`Stale wasm package alias found in ${path}`);
      }
    }
  }
};

rmSync(publishRoot, { recursive: true, force: true });
mkdirSync(publishRoot, { recursive: true });

const wasmEngine = stageWasmEngine();
const nativeEngines = stageNativeEngines();
const optionalDependencies = Object.fromEntries(
  [wasmEngine, ...nativeEngines].map((pkg) => [
    pkg.name,
    readJson(join(pkg.dir, "package.json")).version,
  ])
);

const coreDir = copyPackageDist("core", (pkg) => ({
  ...pkg,
  optionalDependencies,
}));
const nativeLoader = join(packageRoots.core, "src", "native", "index.cjs");
if (!existsSync(nativeLoader)) {
  throw new Error(
    "Missing generated native loader. Run the native build before staging publish artifacts."
  );
}
mkdirSync(join(coreDir, "native"), { recursive: true });
cpSync(nativeLoader, join(coreDir, "native", "index.cjs"));
copyIfExists(
  join(packageRoots.core, "src", "native", "index.d.ts"),
  join(coreDir, "native", "index.d.ts")
);

copyPackageDist("tabular");
copyPackageDist("parquet");
assertNoForbiddenPackageNames();

const stagedPackages = [
  "core",
  "tabular",
  "parquet",
  basename(wasmEngine.dir),
  ...nativeEngines.map((pkg) => basename(pkg.dir)),
];
console.log(`Staged publish packages in ${publishRoot}:`);
for (const packageDirName of stagedPackages) {
  console.log(`- ${packageDirName}`);
}
