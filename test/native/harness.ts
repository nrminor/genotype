import { describe, test } from "bun:test";
import { type NativeKernel, getNativeKernel, isNativeAvailable } from "../../src/native";

export const nativeAvailable = isNativeAvailable();

/**
 * Like `describe`, but the entire block is skipped when the native
 * kernel has not been built. Use for tests that call across the FFI
 * boundary and therefore require `just build-native-dev` first.
 */
export const describeNative = nativeAvailable ? describe : describe.skip;

/**
 * Like `test`, but skipped when the native kernel is unavailable.
 */
export const testNative = nativeAvailable ? test : test.skip;

/**
 * Returns the native kernel or throws with a helpful message.
 * Only call this inside a `describeNative` / `testNative` block
 * where the skip guard has already confirmed availability.
 */
export function requireNativeKernel(): NativeKernel {
  const kernel = getNativeKernel();
  if (!kernel) throw new Error("Native kernel unavailable — run: just build-native-dev");
  return kernel;
}
