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
const nativeDir = join(rootDir, "src", "native");

if (!buildLib && !buildNative) {
  console.error("Error: Please specify --lib, --native, or both");
  process.exit(1);
}

// Removed: getZigTarget function (migrated to Rust workspace)

const replaceLinks = (text) => {
  return packageJson.homepage
    ? text.replace(
        /(\[.*?\]\()(\.\/.*?\))/g,
        (_, p1, p2) => `${p1}${packageJson.homepage}/blob/HEAD/${p2.replace("./", "")}`
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
  console.log(`Building native addon via napi-rs (${isDev ? "debug" : "release"})...`);

  const manifestPath = join(nativeDir, "Cargo.toml");
  const napiArgs = [
    "build",
    "--platform",
    "--manifest-path",
    manifestPath,
    "--output-dir",
    nativeDir,
    ...(isDev ? [] : ["--release"]),
  ];
  const napiBuild = spawnSync("npx", ["napi", ...napiArgs], {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (napiBuild.error) {
    console.error("Error: napi build failed to start — is @napi-rs/cli installed?");
    process.exit(1);
  }

  if (napiBuild.status !== 0) {
    console.error("Error: napi build failed");
    process.exit(1);
  }

  const platform = process.platform;
  const arch = process.arch;
  const nodeFile = `index.${platform}-${arch}.node`;

  if (!existsSync(join(nativeDir, nodeFile))) {
    console.error(`Error: Expected ${nodeFile} not found in ${nativeDir}`);
    process.exit(1);
  }

  console.log(`Built native addon: ${nodeFile}`);
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
    }
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
      },
      null,
      2
    )
  );

  writeFileSync(
    join(distDir, "README.md"),
    replaceLinks(readFileSync(join(rootDir, "README.md"), "utf8"))
  );
  if (existsSync(licensePath)) {
    copyFileSync(licensePath, join(distDir, "LICENSE"));
  }

  console.log("Library built at:", distDir);
}
