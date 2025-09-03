/**
 * Core interfaces and types for SeqOps operations in the Genotype library
 *
 * This module provides memory management strategies and common types for
 * streaming genomic data processing. The fluent API is provided by SeqOps class.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

/**
 * Memory management strategies for different dataset sizes and constraints
 *
 * These strategies provide hints to operations about optimal memory usage:
 * - STREAMING: Pure streaming, O(1) memory, no buffering
 * - BUFFERED: Small buffer for performance optimization
 * - EXTERNAL: Disk-based processing for datasets larger than RAM
 * - BLOOM_FILTER: Probabilistic data structures for deduplication
 */
export enum MemoryStrategy {
  STREAMING = "streaming",
  BUFFERED = "buffered",
  EXTERNAL = "external",
  BLOOM_FILTER = "bloom_filter",
}
