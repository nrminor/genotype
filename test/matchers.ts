import { expect } from "bun:test";
import { GenotypeString } from "../src/genotype-string";

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") {
    const name = Object.getPrototypeOf(value)?.constructor?.name ?? "object";
    return `${name} (${JSON.stringify(value)})`;
  }
  return `${typeof value} (${JSON.stringify(value)})`;
}

expect.extend({
  toEqualSequence(received: unknown, expected: GenotypeString | string) {
    const expectedStr = expected instanceof GenotypeString ? expected.toString() : expected;

    if (received instanceof GenotypeString) {
      const pass = received.equals(expectedStr);
      return {
        pass,
        message: () =>
          pass
            ? `expected sequence not to equal ${JSON.stringify(expectedStr)}, but it does`
            : `expected sequence to equal ${JSON.stringify(expectedStr)}, got ${JSON.stringify(received.toString())}`,
      };
    }

    if (typeof received === "string") {
      const pass = received === expectedStr;
      return {
        pass,
        message: () =>
          pass
            ? `expected sequence not to equal ${JSON.stringify(expectedStr)}, but it does`
            : `expected sequence to equal ${JSON.stringify(expectedStr)}, got ${JSON.stringify(received)}`,
      };
    }

    return {
      pass: false,
      message: () => `expected a GenotypeString or string, got ${describeValue(received)}`,
    };
  },
});

declare module "bun:test" {
  // eslint-disable-next-line no-unused-vars -- T must match bun:test's Matchers<T> declaration
  interface Matchers<T> {
    toEqualSequence(expected: GenotypeString | string): void;
  }
}
