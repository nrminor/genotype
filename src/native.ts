import { join } from "node:path";

/**
 * The native addon interface. Each function here corresponds to a
 * `#[napi]` export from the Rust crate in `src/native/`.
 */
export interface NativeAddon {
  /** Search a batch of sequences for a pattern within a given edit distance. */
  grepBatch(
    sequences: Buffer,
    offsets: Uint32Array,
    pattern: Buffer,
    maxEdits: number,
    caseInsensitive: boolean,
    searchBothStrands: boolean,
  ): Buffer;
}

let addon: NativeAddon | undefined;
let loadAttempted = false;

function loadAddon(): NativeAddon | undefined {
  if (loadAttempted) return addon;
  loadAttempted = true;

  const platform = process.platform;
  const arch = process.arch;
  const filename = `index.${platform}-${arch}.node`;
  const addonPath = join(__dirname, "native", filename);

  try {
    addon = require(addonPath) as NativeAddon;
  } catch {
    // Native addon not available — this is expected when the Rust
    // crate hasn't been built. All native-accelerated code paths
    // have TypeScript fallbacks.
  }

  return addon;
}

/**
 * Whether the native addon is available on this platform.
 *
 * Returns `true` if the napi-rs addon was built and can be loaded,
 * `false` otherwise. Used by processors to decide whether to delegate
 * to native-accelerated code paths.
 */
export function isNativeAvailable(): boolean {
  return loadAddon() !== undefined;
}

/**
 * Get the native addon, or `undefined` if it's not available.
 *
 * Callers should check `isNativeAvailable()` first or handle the
 * `undefined` case. The addon is loaded lazily on first access.
 */
export function getNativeAddon(): NativeAddon | undefined {
  return loadAddon();
}
