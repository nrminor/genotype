/**
 * Cryptographic and non-cryptographic hash functions for genomic data
 *
 * This module provides various hashing utilities used throughout the library
 * for checksums, deduplication, and data integrity verification.
 */

import { createHash } from "node:crypto";

/**
 * Compute MD5 hash of a string
 *
 * Used for SeqKit compatibility and sequence deduplication.
 * MD5 is chosen for compatibility with existing bioinformatics tools
 * despite being cryptographically broken - we're not using it for security.
 *
 * @param input - String to hash
 * @param caseSensitive - Whether to preserve case (default: false, converts to uppercase)
 * @returns MD5 hash as lowercase hex string
 *
 * @example
 * ```typescript
 * hashMD5("ATCG") // "f1f8f4bf413b16ad135722aa4591043e"
 * hashMD5("atcg") // "f1f8f4bf413b16ad135722aa4591043e" (case insensitive by default)
 * hashMD5("atcg", true) // "0afe12b5a63d38c006a525ed5aee1ab1" (case sensitive)
 * ```
 */
export function hashMD5(input: string, caseSensitive = false): string {
  const data = caseSensitive ? input : input.toUpperCase();
  const hasher = createHash("md5");
  hasher.update(data);
  return hasher.digest("hex");
}

/**
 * Compute SHA256 hash of a string
 *
 * More secure than MD5, used when cryptographic strength matters.
 * Produces a longer hash (64 hex characters vs MD5's 32).
 *
 * @param input - String to hash
 * @param caseSensitive - Whether to preserve case (default: false)
 * @returns SHA256 hash as lowercase hex string
 *
 * @example
 * ```typescript
 * hashSHA256("ATCG") // "2f2ba8209e09b6e2c45d105f0ecef49a..."
 * ```
 */
export function hashSHA256(input: string, caseSensitive = false): string {
  const data = caseSensitive ? input : input.toUpperCase();
  const hasher = createHash("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

/**
 * Compute SHA1 hash of a string
 *
 * Used for compatibility with Git and some legacy bioinformatics tools.
 * Like MD5, SHA1 is cryptographically broken but still useful for checksums.
 *
 * @param input - String to hash
 * @param caseSensitive - Whether to preserve case (default: false)
 * @returns SHA1 hash as lowercase hex string
 *
 * @example
 * ```typescript
 * hashSHA1("ATCG") // "6c5c304b24296e0f024ce87c04d8b894f7c803ab"
 * ```
 */
export function hashSHA1(input: string, caseSensitive = false): string {
  const data = caseSensitive ? input : input.toUpperCase();
  const hasher = createHash("sha1");
  hasher.update(data);
  return hasher.digest("hex");
}

/**
 * Simple non-cryptographic string hash for fast lookups
 *
 * Based on djb2 algorithm - fast and good distribution for hash tables.
 * NOT suitable for security or deduplication, only for hash tables.
 *
 * @param str - String to hash
 * @returns 32-bit integer hash
 *
 * @example
 * ```typescript
 * hashString("ATCG") // 2088096894
 * ```
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // (hash * 33) + char
  }
  return Math.abs(hash);
}

/**
 * MurmurHash3 implementation for fast, high-quality non-cryptographic hashing
 *
 * Excellent for hash tables, bloom filters, and other data structures.
 * Much faster than cryptographic hashes with good distribution properties.
 *
 * @param str - String to hash
 * @param seed - Seed value for hash function
 * @returns 32-bit integer hash
 *
 * @example
 * ```typescript
 * murmurHash3("ATCG", 0) // Consistent hash value
 * murmurHash3("ATCG", 42) // Different hash with different seed
 * ```
 */
export function murmurHash3(str: string, seed = 0): number {
  let h1 = seed;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const r1 = 15;
  const r2 = 13;
  const m = 5;
  const n = 0xe6546b64;

  for (let i = 0; i < str.length; i++) {
    let k1 = str.charCodeAt(i);
    k1 = Math.imul(k1, c1);
    k1 = (k1 << r1) | (k1 >>> (32 - r1));
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = (h1 << r2) | (h1 >>> (32 - r2));
    h1 = Math.imul(h1, m) + n;
  }

  h1 ^= str.length;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

/**
 * Available hash algorithms
 */
export type HashAlgorithm = "md5" | "sha1" | "sha256" | "djb2" | "murmur3";

/**
 * Generic hash function that supports multiple algorithms
 *
 * @param input - String to hash
 * @param algorithm - Hash algorithm to use
 * @param options - Additional options
 * @returns Hash value as string (hex for crypto hashes) or number (for non-crypto)
 *
 * @example
 * ```typescript
 * hash("ATCG", "md5") // MD5 hex string
 * hash("ATCG", "murmur3", { seed: 42 }) // Number hash with seed
 * ```
 */
export function hash(
  input: string,
  algorithm: HashAlgorithm = "md5",
  options?: { caseSensitive?: boolean; seed?: number },
): string | number {
  const { caseSensitive = false, seed = 0 } = options || {};

  switch (algorithm) {
    case "md5":
      return hashMD5(input, caseSensitive);
    case "sha1":
      return hashSHA1(input, caseSensitive);
    case "sha256":
      return hashSHA256(input, caseSensitive);
    case "djb2":
      return hashString(caseSensitive ? input : input.toUpperCase());
    case "murmur3":
      return murmurHash3(caseSensitive ? input : input.toUpperCase(), seed);
    default:
      throw new Error(`Unknown hash algorithm: ${algorithm}`);
  }
}
