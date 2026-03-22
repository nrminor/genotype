/**
 * String utility functions for sequence operations
 *
 * Provides common string manipulation functions used across
 * multiple sequence operation modules.
 *
 */

/**
 * Escape special regex characters for literal string matching
 *
 * Converts a literal string into a regex-safe pattern by escaping
 * all special regex metacharacters. Essential when constructing
 * regex patterns from user-provided literal strings.
 *
 * @param str - Literal string to escape
 * @returns Regex-safe escaped string
 *
 * @example
 * ```typescript
 * escapeRegex('gene.1')  // Returns: 'gene\\.1'
 * escapeRegex('sample[A-Z]')  // Returns: 'sample\\[A-Z\\]'
 * escapeRegex('seq*')  // Returns: 'seq\\*'
 * ```
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
