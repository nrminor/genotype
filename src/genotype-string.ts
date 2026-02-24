/**
 * GenotypeString — a lazy dual-representation string type for genomic data.
 *
 * Holds either a JavaScript string or a Uint8Array internally, converting
 * between them on demand. Common string operations (includes, indexOf, slice,
 * toUpperCase, toLowerCase, startsWith, endsWith) are implemented directly on
 * bytes when the data is in byte form, avoiding unnecessary conversion.
 *
 * The public API is immutable: toBytes() returns a copy. Library-internal code
 * (specifically the Rust FFI layer) accesses the mutable backing buffer through
 * static friend methods keyed by unexported symbols — the TypeScript analog of
 * Rust's pub(crate). These symbols are not exported from the package root, so
 * only library-internal code can reach them.
 *
 * This type assumes ASCII content (as is standard for nucleotide sequences,
 * quality scores, and other genomic string data). Byte-native operations like
 * case conversion use ASCII bit manipulation rather than full Unicode casing.
 * Behavior is undefined for non-ASCII content.
 *
 * @module
 */

const textEnc = new TextEncoder();
const textDec = new TextDecoder("utf-8");

/** Unexported symbols for library-internal mutable access. */
const kMutableBytes: unique symbol = Symbol("GenotypeString.mutableBytes");
const kSetBytes: unique symbol = Symbol("GenotypeString.setBytes");

type InternalRepr = { kind: "string"; value: string } | { kind: "bytes"; value: Uint8Array };

/**
 * A lazy dual-representation string type for genomic sequence and quality data.
 *
 * GenotypeString holds either a JavaScript string or a Uint8Array internally,
 * converting between them on demand. It presents a string-like interface so
 * that call sites don't need to know or care which representation is active.
 *
 * When the data is in byte form, common operations like substring search,
 * case conversion, and slicing are performed directly on bytes without
 * converting to a JS string first. This avoids redundant encoding/decoding
 * when chaining multiple operations that cross the Rust FFI boundary.
 *
 * Instances are created through the static factory methods {@link fromString}
 * and {@link fromBytes}. The constructor is private.
 *
 * This type assumes ASCII content. Byte-native operations use ASCII semantics
 * (e.g., case conversion via bit manipulation). For genomic data — nucleotide
 * sequences, quality scores, IUPAC codes — this is always correct.
 *
 * Most string contexts work transparently: template literals, string
 * concatenation with `+`, `RegExp.test()`, `RegExp.exec()`, `String()`,
 * `JSON.stringify()`, and default array sorting all coerce automatically.
 *
 * A few JavaScript mechanisms do not work with wrapper types and cannot be
 * overridden. These are inherent limitations of wrapping a non-primitive:
 *
 * - **Strict equality (`===`) and `switch`** compare by reference, not
 *   value. Use the {@link equals} method for content comparison.
 * - **`Set` and `Map`** use identity semantics for object keys. To use
 *   sequence content as a key, call `.toString()` first.
 * - **Numeric indexing (`gs[0]`)** does not return a character. Use
 *   {@link charAt} instead.
 *
 * @example
 * ```typescript
 * const gs = GenotypeString.fromString("ATCGATCG");
 * gs.includes("CGA");     // true (byte scan when in byte form)
 * gs.toUpperCase();       // new GenotypeString, no string allocation if bytes
 * gs.slice(2, 6);         // GenotypeString("CGAT")
 * `>${gs}`;               // ">ATCGATCG" (transparent coercion)
 * gs.equals("ATCGATCG");  // true (use instead of ===)
 * gs.charAt(0);           // "A" (use instead of gs[0])
 * ```
 */
export class GenotypeString {
  #repr: InternalRepr;

  private constructor(repr: InternalRepr) {
    this.#repr = repr;
  }

  /**
   * Creates a GenotypeString backed by a JavaScript string.
   *
   * The string is stored as-is with no copying or validation. Conversion to
   * bytes happens lazily if and when a byte-native operation is called.
   */
  static fromString(s: string): GenotypeString {
    return new GenotypeString({ kind: "string", value: s });
  }

  /**
   * Creates a GenotypeString backed by a copy of the provided byte array.
   *
   * A defensive copy is made so that subsequent mutations to the original
   * array do not affect the GenotypeString instance.
   */
  static fromBytes(b: Uint8Array): GenotypeString {
    return new GenotypeString({ kind: "bytes", value: b.slice() });
  }

  /**
   * The number of characters (or bytes) in the content.
   *
   * For ASCII content this is the same regardless of internal representation.
   */
  get length(): number {
    return this.#repr.value.length;
  }

  /**
   * Returns whether the content contains the given substring.
   *
   * When the data is in byte form, this performs a byte scan without
   * converting to a JS string.
   */
  includes(pattern: string): boolean {
    if (this.#repr.kind === "string") {
      return this.#repr.value.includes(pattern);
    }
    return byteIncludes(this.#repr.value, textEnc.encode(pattern));
  }

  /**
   * Returns the index of the first occurrence of the pattern, or -1 if not
   * found. Follows the same semantics as {@link String.prototype.indexOf},
   * including fromIndex clamping.
   *
   * When the data is in byte form, this performs a byte scan without
   * converting to a JS string.
   */
  indexOf(pattern: string, fromIndex: number = 0): number {
    if (this.#repr.kind === "string") {
      return this.#repr.value.indexOf(pattern, fromIndex);
    }
    return byteIndexOf(this.#repr.value, textEnc.encode(pattern), fromIndex);
  }

  /**
   * Returns a new GenotypeString containing a portion of the content.
   *
   * Follows the same semantics as {@link String.prototype.slice}. The
   * returned instance is independent — mutating one does not affect the other.
   */
  slice(start: number, end?: number): GenotypeString {
    if (this.#repr.kind === "string") {
      return GenotypeString.fromString(this.#repr.value.slice(start, end));
    }
    return new GenotypeString({
      kind: "bytes",
      value: this.#repr.value.slice(start, end),
    });
  }

  /**
   * Returns a new GenotypeString containing a portion of the content.
   *
   * Follows the same semantics as {@link String.prototype.substring}: negative
   * or NaN arguments are clamped to 0, values beyond length are clamped to
   * length, and if start is greater than end the two are swapped. For new
   * code, prefer {@link slice} which has more predictable behavior with
   * negative indices.
   */
  substring(start: number, end?: number): GenotypeString {
    if (this.#repr.kind === "string") {
      return GenotypeString.fromString(this.#repr.value.substring(start, end));
    }
    const len = this.#repr.value.length;
    let s = Math.max(0, Math.min(isNaN(start) ? 0 : start, len));
    let e = end === undefined ? len : Math.max(0, Math.min(isNaN(end) ? 0 : end, len));
    if (s > e) {
      const tmp = s;
      s = e;
      e = tmp;
    }
    return new GenotypeString({
      kind: "bytes",
      value: this.#repr.value.slice(s, e),
    });
  }

  /**
   * Returns a new GenotypeString with all ASCII lowercase letters converted
   * to uppercase.
   *
   * When the data is in byte form, this uses bit manipulation (`byte & 0xDF`)
   * rather than JS string casing. Only ASCII letters a-z are affected; all
   * other byte values are preserved unchanged.
   */
  toUpperCase(): GenotypeString {
    if (this.#repr.kind === "string") {
      return GenotypeString.fromString(this.#repr.value.toUpperCase());
    }
    return new GenotypeString({
      kind: "bytes",
      value: asciiUppercase(this.#repr.value),
    });
  }

  /**
   * Returns a new GenotypeString with all ASCII uppercase letters converted
   * to lowercase.
   *
   * When the data is in byte form, this uses bit manipulation (`byte | 0x20`)
   * rather than JS string casing. Only ASCII letters A-Z are affected; all
   * other byte values are preserved unchanged.
   */
  toLowerCase(): GenotypeString {
    if (this.#repr.kind === "string") {
      return GenotypeString.fromString(this.#repr.value.toLowerCase());
    }
    return new GenotypeString({
      kind: "bytes",
      value: asciiLowercase(this.#repr.value),
    });
  }

  /**
   * Returns a new GenotypeString with leading and trailing ASCII whitespace
   * removed.
   *
   * When the data is in byte form, bytes 0x09 (tab), 0x0A (LF), 0x0B (VT),
   * 0x0C (FF), 0x0D (CR), and 0x20 (space) are trimmed. This matches the
   * characters that {@link String.prototype.trim} removes in the ASCII range.
   */
  trim(): GenotypeString {
    if (this.#repr.kind === "string") {
      const trimmed = this.#repr.value.trim();
      if (trimmed.length === this.#repr.value.length) return this;
      return GenotypeString.fromString(trimmed);
    }
    const bytes = this.#repr.value;
    let start = 0;
    let end = bytes.length;
    while (start < end && isAsciiWhitespace(bytes[start]!)) start++;
    while (end > start && isAsciiWhitespace(bytes[end - 1]!)) end--;
    if (start === 0 && end === bytes.length) return this;
    return new GenotypeString({
      kind: "bytes",
      value: bytes.slice(start, end),
    });
  }

  /**
   * Returns the character at the given index, or an empty string if the
   * index is out of range.
   */
  charAt(index: number): string {
    if (this.#repr.kind === "string") {
      return this.#repr.value.charAt(index);
    }
    if (index < 0 || index >= this.#repr.value.length) return "";
    return String.fromCharCode(this.#repr.value[index]!);
  }

  /**
   * Returns the ASCII/Unicode code point of the character at the given index,
   * or NaN if the index is out of range.
   */
  charCodeAt(index: number): number {
    if (this.#repr.kind === "string") {
      return this.#repr.value.charCodeAt(index);
    }
    if (index < 0 || index >= this.#repr.value.length) return NaN;
    return this.#repr.value[index]!;
  }

  /**
   * Returns whether the content starts with the given prefix.
   *
   * When the data is in byte form, this compares bytes directly without
   * converting to a JS string.
   */
  startsWith(pattern: string): boolean {
    if (this.#repr.kind === "string") {
      return this.#repr.value.startsWith(pattern);
    }
    return byteStartsWith(this.#repr.value, textEnc.encode(pattern));
  }

  /**
   * Returns whether the content ends with the given suffix.
   *
   * When the data is in byte form, this compares bytes directly without
   * converting to a JS string.
   */
  endsWith(pattern: string): boolean {
    if (this.#repr.kind === "string") {
      return this.#repr.value.endsWith(pattern);
    }
    return byteEndsWith(this.#repr.value, textEnc.encode(pattern));
  }

  /**
   * Compares this instance for equality against another GenotypeString, a
   * plain string, or a Uint8Array.
   *
   * When both sides are in byte form, comparison is done directly on bytes.
   * Otherwise, both sides are converted to strings for comparison.
   */
  equals(other: GenotypeString | string | Uint8Array): boolean {
    if (other === (this as unknown)) return true;

    if (other instanceof GenotypeString) {
      if (this.#repr.kind === "bytes" && other.#repr.kind === "bytes") {
        return byteEquals(this.#repr.value, other.#repr.value);
      }
      return this.toString() === other.toString();
    }

    if (typeof other === "string") {
      return this.toString() === other;
    }

    if (this.#repr.kind === "bytes") {
      return byteEquals(this.#repr.value, other);
    }
    return this.toString() === textDec.decode(other);
  }

  /**
   * Compares this instance with another for sort ordering, following the
   * same contract as {@link String.prototype.localeCompare}.
   *
   * Returns a negative number if this instance sorts before the other, a
   * positive number if it sorts after, or 0 if they are equal. Accepts a
   * GenotypeString or a plain string as the comparison target.
   */
  localeCompare(
    other: GenotypeString | string,
    locales?: string | string[],
    options?: Intl.CollatorOptions,
  ): number {
    return this.toString().localeCompare(other.toString(), locales, options);
  }

  /**
   * Returns the content as a JavaScript string.
   *
   * If the data is currently in byte form, this triggers a UTF-8 decode and
   * the byte representation is dropped. Subsequent calls return the cached
   * string without re-decoding.
   */
  toString(): string {
    return this.#ensureString();
  }

  /**
   * Returns the string representation for JSON serialization.
   *
   * Without this method, `JSON.stringify()` would serialize the object's
   * (empty) public shape rather than its string content. With it,
   * `JSON.stringify({ sequence: gs })` produces `{"sequence":"ATCG"}`
   * as expected.
   */
  toJSON(): string {
    return this.#ensureString();
  }

  /**
   * Enables transparent coercion in template literals, string concatenation,
   * and other JS primitive contexts.
   *
   * Returns the string representation for "string" and "default" hints, and
   * NaN for the "number" hint.
   */
  [Symbol.toPrimitive](hint: "string" | "number" | "default"): string | number {
    if (hint === "number") return NaN;
    return this.toString();
  }

  /**
   * Yields single-character strings, enabling `for...of` iteration, spread
   * syntax (`[...gs]`), `Array.from(gs)`, and constructors like `new Set(gs)`.
   *
   * When the data is in byte form, characters are produced directly from
   * bytes without converting the entire content to a JS string first.
   */
  *[Symbol.iterator](): IterableIterator<string> {
    if (this.#repr.kind === "string") {
      yield* this.#repr.value;
      return;
    }
    const bytes = this.#repr.value;
    for (let i = 0; i < bytes.length; i++) {
      yield String.fromCharCode(bytes[i]!);
    }
  }

  /**
   * Custom inspect output for console.log and util.inspect. Shows the type
   * name, length, and a preview of the content (truncated at 60 characters).
   */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    const preview = this.length > 60 ? this.toString().slice(0, 57) + "..." : this.toString();
    return `GenotypeString(${this.length}) ${JSON.stringify(preview)}`;
  }

  /**
   * Returns the content as a new Uint8Array.
   *
   * The returned array is a copy — mutating it does not affect this instance.
   * If the data is currently in string form, this triggers a UTF-8 encode and
   * the string representation is dropped.
   */
  toBytes(): Uint8Array {
    return this.#ensureBytes().slice();
  }

  /**
   * Matches the content against a regular expression.
   *
   * Converts to a JS string if not already in string form, since the JS
   * regex engine operates on strings.
   */
  match(pattern: RegExp): RegExpMatchArray | null {
    return this.toString().match(pattern);
  }

  /**
   * Returns a new GenotypeString with occurrences of the pattern replaced.
   *
   * Converts to a JS string for the replacement operation, then wraps the
   * result in a new GenotypeString.
   */
  replace(pattern: string | RegExp, replacement: string): GenotypeString {
    return GenotypeString.fromString(this.toString().replace(pattern, replacement));
  }

  /**
   * Returns the index of the first match of the regular expression, or -1
   * if no match is found.
   *
   * Converts to a JS string if not already in string form.
   */
  search(pattern: RegExp): number {
    return this.toString().search(pattern);
  }

  /**
   * Splits the content on the given separator and returns an array of plain
   * strings.
   *
   * Returns plain strings rather than GenotypeString instances because split
   * results are typically short fragments used for parsing rather than
   * sequences that would benefit from byte representation.
   */
  split(separator: string | RegExp, limit?: number): string[] {
    return this.toString().split(separator, limit);
  }

  #ensureString(): string {
    if (this.#repr.kind === "string") return this.#repr.value;
    const s = textDec.decode(this.#repr.value);
    this.#repr = { kind: "string", value: s };
    return s;
  }

  #ensureBytes(): Uint8Array {
    if (this.#repr.kind === "bytes") return this.#repr.value;
    const b = textEnc.encode(this.#repr.value);
    this.#repr = { kind: "bytes", value: b };
    return b;
  }

  /** @internal */
  static [kMutableBytes](gs: GenotypeString): Uint8Array {
    return gs.#ensureBytes();
  }

  /** @internal */
  static [kSetBytes](gs: GenotypeString, bytes: Uint8Array): void {
    gs.#repr = { kind: "bytes", value: bytes };
  }
}

/**
 * Converts a GenotypeString or plain string to a plain string.
 *
 * This is the standard normalization helper for functions that accept
 * `GenotypeString | string` but operate on string internals. When the input
 * is already a string it is returned as-is with no overhead.
 *
 * @param value - A GenotypeString or plain string
 * @returns The string content
 */
export function asString(value: GenotypeString | string): string {
  return typeof value === "string" ? value : value.toString();
}

/**
 * Library-internal accessor for GenotypeString's mutable backing buffer.
 *
 * This object provides type-safe access to GenotypeString internals for the
 * Rust FFI layer and other library-internal code. It calls the symbol-keyed
 * static friend methods on the class, so no `as any` casts are needed.
 *
 * Exported from this module but NOT from the package root. Only library code
 * that imports directly from this module can use it.
 *
 * The caller contract for mutation is: call `mutableBytes()`, perform all
 * mutations on the returned buffer, then pass the buffer back to
 * `invalidate()` when done. This is the manual equivalent of Rust's RAII
 * borrow guard — the caller explicitly returns the buffer to restore the
 * GenotypeString's invariants.
 *
 * @internal
 */
export const genotypeStringInternal = Object.freeze({
  /**
   * Returns the actual backing Uint8Array for in-place mutation.
   *
   * Unlike `toBytes()`, this is NOT a copy. Mutations to the returned array
   * directly affect the GenotypeString's internal state. The caller MUST call
   * `invalidate()` with this buffer after mutation is complete.
   */
  mutableBytes(gs: GenotypeString): Uint8Array {
    return GenotypeString[kMutableBytes](gs);
  },

  /**
   * Restores the GenotypeString's internal state after in-place byte mutation.
   *
   * Forces the internal representation to the provided byte buffer and drops
   * any cached string. The buffer passed here should be the same one returned
   * by `mutableBytes()`. This is safe even if other GenotypeString methods
   * were called between `mutableBytes()` and `invalidate()` — the buffer
   * the caller holds is authoritative.
   */
  invalidate(gs: GenotypeString, bytes: Uint8Array): void {
    GenotypeString[kSetBytes](gs, bytes);
  },
});

function byteIncludes(haystack: Uint8Array, needle: Uint8Array): boolean {
  return byteIndexOf(haystack, needle, 0) !== -1;
}

function byteIndexOf(haystack: Uint8Array, needle: Uint8Array, fromIndex: number): number {
  const len = haystack.length;

  // Clamp fromIndex to [0, len] to match String.prototype.indexOf semantics.
  const clamped = Math.max(0, Math.min(fromIndex, len));

  if (needle.length === 0) return clamped;
  if (needle.length > len) return -1;

  const limit = len - needle.length;
  outer: for (let i = clamped; i <= limit; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function byteStartsWith(haystack: Uint8Array, prefix: Uint8Array): boolean {
  if (prefix.length > haystack.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (haystack[i] !== prefix[i]) return false;
  }
  return true;
}

function byteEndsWith(haystack: Uint8Array, suffix: Uint8Array): boolean {
  if (suffix.length > haystack.length) return false;
  const offset = haystack.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) {
    if (haystack[offset + i] !== suffix[i]) return false;
  }
  return true;
}

function byteEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function asciiUppercase(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    out[i] = c >= 0x61 && c <= 0x7a ? c & 0xdf : c;
  }
  return out;
}

function asciiLowercase(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    out[i] = c >= 0x41 && c <= 0x5a ? c | 0x20 : c;
  }
  return out;
}

function isAsciiWhitespace(byte: number): boolean {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}
