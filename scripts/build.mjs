import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import process from "process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");
const licensePath = join(rootDir, "LICENSE");
const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));

const args = process.argv.slice(2);
const buildLib = args.find((arg) => arg === "--lib");
const buildNative = args.find((arg) => arg === "--native");
const isDev = args.includes("--dev");

const variants = [
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
  { platform: "win32", arch: "x64" },
  { platform: "win32", arch: "arm64" },
];

if (!buildLib && !buildNative) {
  console.error("Error: Please specify --lib, --native, or both");
  process.exit(1);
}

// Removed: getZigTarget function (migrated to Rust workspace)

const replaceLinks = (text) => {
  return packageJson.homepage
    ? text.replace(
        /(\[.*?\]\()(\.\/.*?\))/g,
        (_, p1, p2) => `${p1}${packageJson.homepage}/blob/HEAD/${p2.replace("./", "")}`,
      )
    : text;
};

const requiredFields = ["name", "version", "license", "repository", "description"];
const missingRequired = requiredFields.filter((field) => !packageJson[field]);
if (missingRequired.length > 0) {
  console.error(`Error: Missing required fields in package.json: ${missingRequired.join(", ")}`);
  process.exit(1);
}

if (buildNative) {
  console.log(`Building native ${isDev ? "debug" : "release"} binaries...`);

  const rustBuild = spawnSync("cargo", ["build", isDev ? "" : "--release"].filter(Boolean), {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (rustBuild.error) {
    console.error("Error: Cargo is not installed or not in PATH");
    process.exit(1);
  }

  if (rustBuild.status !== 0) {
    console.error("Error: Rust build failed");
    process.exit(1);
  }

  // For now: single platform build (current host only)
  // TODO: Add cross-compilation when deployment planning begins
  const libDir = join(rootDir, "target", "release");
  const platform = process.platform;
  const arch = process.arch;

  const nativeName = `${packageJson.name}-${platform}-${arch}`;
  const nativeDir = join(rootDir, "node_modules", nativeName);

  rmSync(nativeDir, { recursive: true, force: true });
  mkdirSync(nativeDir, { recursive: true });

  let copiedFiles = 0;
  let libraryFileName = null;

  // Look for the built Rust library
  const expectedLib =
    platform === "win32"
      ? "genotype.dll"
      : platform === "darwin"
        ? "libgenotype.dylib"
        : "libgenotype.so";
  const src = join(libDir, expectedLib);

  if (existsSync(src)) {
    copyFileSync(src, join(nativeDir, expectedLib));
    copiedFiles++;
    libraryFileName = expectedLib;
  }

  if (copiedFiles === 0) {
    console.error(`Error: No dynamic library found for ${platform}-${arch} in ${libDir}`);
    console.error(`Expected: ${expectedLib}`);
    console.error(`Run: cargo build --release`);
    process.exit(1);
  }

  const indexTsContent = `const module = await import("./${libraryFileName}", { with: { type: "file" } })
const path = module.default
export default path;
`;
  writeFileSync(join(nativeDir, "index.ts"), indexTsContent);

  writeFileSync(
    join(nativeDir, "package.json"),
    JSON.stringify(
      {
        name: nativeName,
        version: packageJson.version,
        description: `Prebuilt ${platform}-${arch} binaries for ${packageJson.name}`,
        main: "index.ts",
        types: "index.ts",
        license: packageJson.license,
        author: packageJson.author,
        homepage: packageJson.homepage,
        repository: packageJson.repository,
        bugs: packageJson.bugs,
        keywords: [...(packageJson.keywords ?? []), "prebuild", "prebuilt"],
        os: [platform],
        cpu: [arch],
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(nativeDir, "README.md"),
    replaceLinks(
      `## ${nativeName}\n\n> Prebuilt ${platform}-${arch} binaries for \`${packageJson.name}\`.`,
    ),
  );

  if (existsSync(licensePath)) {
    copyFileSync(licensePath, join(nativeDir, "LICENSE"));
  }
  console.log("Built:", nativeName);
}

if (buildLib) {
  console.log("Building library...");

  const distDir = join(rootDir, "dist");
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  const externalDeps = [
    ...Object.keys(packageJson.optionalDependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
  ];

  // Build main entry point
  spawnSync(
    "bun",
    [
      "build",
      "--target=bun",
      "--outdir=dist",
      ...externalDeps.flatMap((dep) => ["--external", dep]),
      packageJson.module,
    ],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );

  console.log("Generating TypeScript declarations...");

  const tsconfigBuildPath = join(rootDir, "tsconfig.build.json");
  const tsconfigBuild = {
    extends: "./tsconfig.json",
    compilerOptions: {
      declaration: true,
      emitDeclarationOnly: true,
      outDir: "./dist",
      noEmit: false,
      rootDir: "./src",
      types: ["bun", "node"],
      skipLibCheck: true,
    },
    include: ["src/**/*"],
    exclude: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "src/examples/**/*",
      "src/benchmark/**/*",
      // Removed: src/zig/**/* (migrated to Rust)
      "src/native/**/*",
    ],
  };

  writeFileSync(tsconfigBuildPath, JSON.stringify(tsconfigBuild, null, 2));

  const tscResult = spawnSync("npx", ["tsc", "-p", tsconfigBuildPath], {
    cwd: rootDir,
    stdio: "inherit",
  });

  rmSync(tsconfigBuildPath, { force: true });

  if (tscResult.status !== 0) {
    console.warn("Warning: TypeScript declaration generation failed");
  } else {
    console.log("TypeScript declarations generated");
  }

  // Configure exports for multiple entry points
  const exports = {
    ".": {
      import: "./index.js",
      require: "./index.js",
      types: "./index.d.ts",
    },
  };

  const optionalDeps = Object.fromEntries(
    variants.map(({ platform, arch }) => [
      `${packageJson.name}-${platform}-${arch}`,
      `^${packageJson.version}`,
    ]),
  );

  writeFileSync(
    join(distDir, "package.json"),
    JSON.stringify(
      {
        name: packageJson.name,
        module: "index.js",
        main: "index.js",
        types: "index.d.ts",
        type: packageJson.type,
        version: packageJson.version,
        description: packageJson.description,
        keywords: packageJson.keywords,
        license: packageJson.license,
        author: packageJson.author,
        homepage: packageJson.homepage,
        repository: packageJson.repository,
        bugs: packageJson.bugs,
        exports,
        dependencies: packageJson.dependencies,
        optionalDependencies: {
          ...packageJson.optionalDependencies,
          ...optionalDeps,
        },
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(distDir, "README.md"),
    replaceLinks(readFileSync(join(rootDir, "README.md"), "utf8")),
  );
  if (existsSync(licensePath)) {
    copyFileSync(licensePath, join(distDir, "LICENSE"));
  }

  console.log("Library built at:", distDir);
}
