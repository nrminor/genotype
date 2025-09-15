import { dlopen } from "bun:ffi";
import { existsSync } from "fs";
import os from "os";
import { join } from "path";

/**
 * Determine the Zig target triple for the current platform
 * Maps Node.js platform/arch to Zig-compatible target strings
 *
 * @returns Target string in format "arch-platform" (e.g., "x86_64-macos")
 */
export interface LibGenotype {
  /**
   * Calculate GC content for a nucleotide sequence
   * Optimized Rust implementation for large genomic sequences
   *
   * @param sequence Input nucleotide sequence string (IUPAC codes)
   * @returns GC content as ratio (0.0 to 1.0), ignoring ambiguous bases
   */
  calculateGCContent(sequence: string): number;

  // TODO: Implement these functions in Rust
  /**
   * Decompress a BGZF block using optimized native implementation
   * BGZF is the block-compressed gzip format used in BAM files
   *
   * @param compressedData Input compressed data buffer
   * @param outputBuffer Output buffer for decompressed data (must be pre-allocated)
   * @returns Number of bytes written to output buffer, or -1 on error
   */
  decompressBGZFBlock?(compressedData: Uint8Array, outputBuffer: Uint8Array): number;

  /**
   * Decode 4-bit packed nucleotide sequence to ASCII string
   * Used for BAM sequence field decoding where each base uses 4 bits
   *
   * @param packedData 4-bit packed sequence data from BAM file
   * @param sequenceLength Number of bases to decode
   * @returns Decoded nucleotide sequence string using IUPAC codes
   * @throws Error if packed data is insufficient for sequence length
   */
  decodePackedSequence?(packedData: Uint8Array, sequenceLength: number): string;

  /**
   * Convert quality string to numeric scores array
   * Handles Phred+33 encoding (standard in modern FASTQ files)
   *
   * @param qualityString Input quality string (ASCII encoded)
   * @returns Array of numeric quality scores (0-93 for Phred+33)
   * @throws Error if quality string contains invalid characters
   */
  convertQualityScores?(qualityString: string): number[];
}

/**
 * FFI implementation of the genomic native library
 * Handles pointer management, type conversions, and error checking
 * Following OpenTUI's FFI wrapper pattern with Tiger Style robustness
 */
class FFIGenotypeLib implements LibGenotype {
  private readonly genotype: ReturnType<typeof getGenotypeLib>;
  private readonly encoder: TextEncoder = new TextEncoder();

  constructor(libPath?: string) {
    this.genotype = getGenotypeLib(libPath);
  }

  // TODO: Implement these when Rust functions are ready

  public calculateGCContent(sequence: string): number {
    // Tiger Style: Assert function arguments
    if (typeof sequence !== "string") {
      throw new Error("sequence must be string");
    }
    if (sequence.length > 1000000) {
      throw new Error("sequence too long (max 1M chars for safety)");
    }

    if (sequence.length === 0) return 0.0;

    // Validate sequence contains only valid nucleotide codes
    const validBases = /^[ACGTUacgtuRYSWKMBDHVN\-.*\s]*$/;
    if (!validBases.test(sequence)) {
      throw new Error("sequence contains invalid nucleotide characters");
    }

    const sequenceBytes = this.encoder.encode(sequence);
    const result = this.genotype.symbols.calculate_gc_content(sequenceBytes, sequenceBytes.length);

    // Tiger Style: Validate result is in expected range
    if (result < 0.0 || result > 1.0) {
      throw new Error(`GC content out of range: ${result}`);
    }

    return result;
  }
}

// Singleton pattern for library instance management (following OpenTUI pattern)
let genotypeLibPath: string | undefined;
let genotypeLib: LibGenotype | undefined;

/**
 * Set a custom path for the native library
 * Useful for testing or custom build configurations
 * Following OpenTUI's library path management pattern
 *
 * @param libPath Absolute path to the native library file
 */
export function setGenotypeLibPath(libPath: string): void {
  // Tiger Style: Assert function arguments
  if (typeof libPath !== "string" || libPath.length === 0) {
    throw new Error("libPath must be non-empty string");
  }

  genotypeLibPath = libPath;
  genotypeLib = undefined; // Reset cached instance to force reload
}

/**
 * Get the singleton instance of the native genomic processing library
 * Lazy-loads the Rust library on first access for performance
 * Following OpenTUI's singleton management pattern
 *
 * @returns Singleton LibGenotype instance
 * @throws Error if library cannot be loaded
 */
export function resolveGenotypeLib(): LibGenotype {
  if (!genotypeLib) {
    genotypeLib = new FFIGenotypeLib(genotypeLibPath);
  }
  return genotypeLib;
}

/**
 * Check if the native library is available on this platform
 * Useful for graceful fallback to JavaScript implementations
 *
 * @returns true if library can be loaded, false otherwise
 */
export function isNativeLibAvailable(): boolean {
  try {
    findLibrary();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current platform target string for debugging
 * Useful for troubleshooting library loading issues
 *
 * @returns Platform target string (e.g., "x86_64-macos")
 */
export function getCurrentPlatformTarget(): string {
  return getPlatformTarget();
}

// =============================================================================
// PRIVATE HELPER FUNCTIONS
// =============================================================================

function getPlatformTarget(): string {
  const platform = os.platform();
  const arch = os.arch();

  // Tiger Style: Assert function preconditions
  if (typeof platform !== "string" || platform.length === 0) {
    throw new Error("platform must be non-empty string");
  }
  if (typeof arch !== "string" || arch.length === 0) {
    throw new Error("arch must be non-empty string");
  }

  const platformMap: Record<string, string> = {
    darwin: "macos",
    win32: "windows",
    linux: "linux",
  };

  const archMap: Record<string, string> = {
    x64: "x86_64",
    arm64: "aarch64",
  };

  const zigPlatform =
    platformMap[platform] !== undefined &&
    platformMap[platform] !== null &&
    platformMap[platform] !== ""
      ? platformMap[platform]
      : platform;
  const zigArch =
    archMap[arch] !== undefined && archMap[arch] !== null && archMap[arch] !== ""
      ? archMap[arch]
      : arch;

  return `${zigArch}-${zigPlatform}`;
}

/**
 * Locate the native genomic processing library for the current platform
 * Searches in Cargo target directory for platform-specific libraries
 * Following OpenTUI's library discovery pattern
 *
 * @returns Absolute path to the native library
 * @throws Error if library cannot be found for current platform
 */
function findLibrary(): string {
  const target = getPlatformTarget();

  // Tiger Style: Assert function preconditions
  if (typeof target !== "string" || !target.includes("-")) {
    throw new Error("target must be valid platform-arch string");
  }

  // Use Rust's conventional target directory structure
  const cargoTargetDir = join(__dirname, "..", "target", "release");

  // Complete library name logic following Rust conventions
  const [_arch, os] = target.split("-");
  const getLibraryName = (platform: string): string => {
    const prefix = platform === "windows" ? "" : "lib";
    const extension = platform === "windows" ? ".dll" : platform === "macos" ? ".dylib" : ".so";
    return `${prefix}genotype${extension}`; // Matches Cargo.toml [lib] name
  };

  const libraryName = getLibraryName(os !== undefined && os !== null && os !== "" ? os : "linux");
  const targetLibPath = join(cargoTargetDir, libraryName);

  if (existsSync(targetLibPath)) {
    return targetLibPath;
  }

  // Tiger Style: Provide actionable error message
  throw new Error(
    `Could not find genotype native library for platform: ${target}. ` +
      `Expected at: ${targetLibPath}. Run 'cargo build --release' to build the native library.`
  );
}

/**
 * Load the native Rust library with FFI bindings
 * Defines all exported function signatures for genomic data processing
 * Following OpenTUI's dlopen pattern
 *
 * @param libPath Optional custom path to library (for testing)
 * @returns FFI binding object with native function symbols
 */
function getGenotypeLib(libPath?: string): {
  symbols: {
    calculate_gc_content: (sequenceData: Uint8Array, sequenceLength: number) => number;
    // TODO: Add other functions as they're implemented in Rust:
    // decompress_bgzf_block, decode_packed_sequence, convert_quality_scores
  };
} {
  const resolvedLibPath =
    libPath !== undefined && libPath !== null && libPath !== "" ? libPath : findLibrary();

  // Only expose what we actually implement - honest interface
  return dlopen(resolvedLibPath, {
    calculate_gc_content: {
      args: ["ptr", "usize"],
      returns: "f64",
    },
  });
}

/**
 * Interface defining the native genomic processing library API
 * Provides type-safe wrappers around raw FFI calls to Zig implementation
 * All methods are performance-critical operations optimized in native code
 */
