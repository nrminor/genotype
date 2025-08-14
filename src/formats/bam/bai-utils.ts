/**
 * BAI (BAM Index) utilities for virtual offsets and UCSC binning scheme
 *
 * Implements core utilities needed for BAI index generation and querying:
 * - Virtual offset packing/unpacking for BGZF compression
 * - UCSC hierarchical binning scheme for genomic coordinate indexing
 * - Bin traversal and overlap detection
 * - Memory-efficient operations with Bun optimizations
 *
 * All functions follow Tiger Style with comprehensive validation and
 * clear error messages for debugging indexing issues.
 */

import type {
  VirtualOffset,
  BAIBinNumber,
  VirtualOffsetUtils as VirtualOffsetUtilsType,
  BinningUtils as BinningUtilsType,
} from '../../types';
import { VirtualOffsetSchema, BAIBinNumberSchema } from '../../types';
import { BamError } from '../../errors';

// Constants for virtual offset calculations
const BLOCK_OFFSET_BITS = 48;
const UNCOMPRESSED_OFFSET_LIMIT = 65536; // 16-bit limit for BGZF block size

/**
 * Virtual offset utilities for BGZF-compressed BAM files
 *
 * Virtual offsets combine BGZF block offset (48 bits) with uncompressed
 * offset within the block (16 bits) to enable random access to compressed data.
 *
 * @example
 * ```typescript
 * const virtualOffset = VirtualOffsetUtils.pack(1024, 512);
 * const { blockOffset, uncompressedOffset } = VirtualOffsetUtils.unpack(virtualOffset);
 * ```
 */
export const VirtualOffsetUtils: VirtualOffsetUtilsType = {
  /**
   * Pack block offset and uncompressed offset into 64-bit virtual offset
   * @param blockOffset BGZF block offset in file (48-bit limit)
   * @param uncompressedOffset Offset within uncompressed block (16-bit limit)
   * @returns Packed virtual offset
   * @throws {BamError} If offsets are out of valid range
   */
  pack(blockOffset: number, uncompressedOffset: number): VirtualOffset {
    // Tiger Style: Assert function arguments
    console.assert(
      Number.isInteger(blockOffset) && blockOffset >= 0,
      'blockOffset must be non-negative integer'
    );
    console.assert(
      Number.isInteger(uncompressedOffset) && uncompressedOffset >= 0,
      'uncompressedOffset must be non-negative integer'
    );

    // Validate 48-bit block offset limit
    if (blockOffset >= 1 << BLOCK_OFFSET_BITS) {
      throw new BamError(
        `Block offset ${blockOffset} exceeds ${BLOCK_OFFSET_BITS}-bit limit (${(1 << BLOCK_OFFSET_BITS) - 1})`,
        undefined,
        'virtual_offset'
      );
    }

    // Validate 16-bit uncompressed offset limit (BGZF block size)
    if (uncompressedOffset >= UNCOMPRESSED_OFFSET_LIMIT) {
      throw new BamError(
        `Uncompressed offset ${uncompressedOffset} exceeds 16-bit limit (${UNCOMPRESSED_OFFSET_LIMIT - 1})`,
        undefined,
        'virtual_offset'
      );
    }

    // Pack into 64-bit value: high 48 bits = block offset, low 16 bits = uncompressed offset
    const virtualOffset = (BigInt(blockOffset) << 16n) | BigInt(uncompressedOffset);

    // Tiger Style: Assert postconditions
    console.assert(virtualOffset >= 0n, 'virtual offset must be non-negative');

    const result = VirtualOffsetSchema(virtualOffset);
    if (typeof result !== 'bigint') {
      throw new BamError(
        `Virtual offset validation failed: ${result.toString()}`,
        undefined,
        'virtual_offset'
      );
    }
    return result;
  },

  /**
   * Unpack virtual offset into component block and uncompressed offsets
   * @param virtualOffset Packed virtual offset
   * @returns Object with blockOffset and uncompressedOffset
   * @throws {BamError} If virtual offset is invalid
   */
  unpack(virtualOffset: VirtualOffset): { blockOffset: number; uncompressedOffset: number } {
    // Tiger Style: Assert function arguments
    console.assert(typeof virtualOffset === 'bigint', 'virtualOffset must be bigint');
    console.assert(virtualOffset >= 0n, 'virtualOffset must be non-negative');

    // Extract components using bitwise operations
    const blockOffset = Number(virtualOffset >> 16n);
    const uncompressedOffset = Number(virtualOffset & 0xffffn);

    // Tiger Style: Assert extracted values are valid
    console.assert(
      Number.isInteger(blockOffset) && blockOffset >= 0,
      'extracted blockOffset must be valid'
    );
    console.assert(
      Number.isInteger(uncompressedOffset) && uncompressedOffset >= 0,
      'extracted uncompressedOffset must be valid'
    );
    console.assert(uncompressedOffset < 65536, 'extracted uncompressedOffset must be < 65536');

    return { blockOffset, uncompressedOffset };
  },

  /**
   * Compare two virtual offsets for sorting and range operations
   * @param a First virtual offset
   * @param b Second virtual offset
   * @returns -1 if a < b, 0 if a == b, 1 if a > b
   */
  compare(a: VirtualOffset, b: VirtualOffset): number {
    // Tiger Style: Assert function arguments
    console.assert(typeof a === 'bigint', 'first offset must be bigint');
    console.assert(typeof b === 'bigint', 'second offset must be bigint');

    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  },
};

/**
 * UCSC binning scheme utilities for hierarchical genomic coordinate indexing
 *
 * Implements the UCSC Genome Browser binning scheme with 6 hierarchical levels:
 * - Level 0: bin 0 (covers entire chromosome, 512Mb)
 * - Level 1: bins 1-8 (64Mb each)
 * - Level 2: bins 9-72 (8Mb each)
 * - Level 3: bins 73-584 (1Mb each)
 * - Level 4: bins 585-4680 (128Kb each)
 * - Level 5: bins 4681-37448 (16Kb each)
 *
 * @example
 * ```typescript
 * const bin = BinningUtils.calculateBin(1000, 2000);
 * const overlappingBins = BinningUtils.getOverlappingBins(1000, 5000);
 * ```
 */
export const BinningUtils: BinningUtilsType = {
  /**
   * Calculate bin number for genomic coordinate range using UCSC scheme
   * @param start Start coordinate (0-based, inclusive)
   * @param end End coordinate (0-based, exclusive)
   * @returns BAI bin number
   * @throws {BamError} If coordinates are invalid
   */
  calculateBin(start: number, end: number): BAIBinNumber {
    // Tiger Style: Assert function arguments
    console.assert(Number.isInteger(start) && start >= 0, 'start must be non-negative integer');
    console.assert(Number.isInteger(end) && end >= 0, 'end must be non-negative integer');

    if (end <= start) {
      throw new BamError(
        `Invalid coordinate range: end (${end}) must be > start (${start})`,
        undefined,
        'coordinates'
      );
    }

    // Validate coordinates are within reasonable genomic range
    if (start > 536_870_912 || end > 536_870_912) {
      // 2^29 (512Mb max for UCSC scheme)
      throw new BamError(
        `Coordinates exceed UCSC binning limit: start=${start}, end=${end} (max 536870912)`,
        undefined,
        'coordinates'
      );
    }

    // UCSC binning algorithm: find the smallest bin that contains the entire range
    // Convert to 0-based end-exclusive for calculation
    const endExclusive = end - 1;

    let binNumber: number;

    // Level 5: 16Kb bins (finest resolution)
    if (start >> 14 === endExclusive >> 14) {
      binNumber = ((1 << 15) - 1) / 7 + (start >> 14);
    }
    // Level 4: 128Kb bins
    else if (start >> 17 === endExclusive >> 17) {
      binNumber = ((1 << 12) - 1) / 7 + (start >> 17);
    }
    // Level 3: 1Mb bins
    else if (start >> 20 === endExclusive >> 20) {
      binNumber = ((1 << 9) - 1) / 7 + (start >> 20);
    }
    // Level 2: 8Mb bins
    else if (start >> 23 === endExclusive >> 23) {
      binNumber = ((1 << 6) - 1) / 7 + (start >> 23);
    }
    // Level 1: 64Mb bins
    else if (start >> 26 === endExclusive >> 26) {
      binNumber = ((1 << 3) - 1) / 7 + (start >> 26);
    }
    // Level 0: 512Mb bin (chromosome-wide)
    else {
      binNumber = 0;
    }

    // Round to integer (division by 7 in formulas can produce non-integers)
    binNumber = Math.floor(binNumber);

    // Tiger Style: Assert calculated bin is valid
    console.assert(
      Number.isInteger(binNumber) && binNumber >= 0,
      'calculated bin must be non-negative integer'
    );
    console.assert(binNumber <= 37448, 'calculated bin must be within UCSC scheme limit');

    const result = BAIBinNumberSchema(binNumber);
    if (typeof result !== 'number') {
      throw new BamError(
        `Bin number validation failed: ${result.toString()}`,
        undefined,
        'bin_number'
      );
    }
    return result;
  },

  /**
   * Get all bin numbers that overlap with the given genomic range
   * Used for efficient BAI queries across hierarchical bin levels
   * @param start Start coordinate (0-based, inclusive)
   * @param end End coordinate (0-based, exclusive)
   * @returns Array of overlapping bin numbers sorted by bin ID
   * @throws {BamError} If coordinates are invalid
   */
  getOverlappingBins(start: number, end: number): readonly BAIBinNumber[] {
    // Tiger Style: Assert function arguments
    console.assert(Number.isInteger(start) && start >= 0, 'start must be non-negative integer');
    console.assert(Number.isInteger(end) && end >= 0, 'end must be non-negative integer');

    if (end <= start) {
      throw new BamError(
        `Invalid coordinate range: end (${end}) must be > start (${start})`,
        undefined,
        'coordinates'
      );
    }

    const bins: number[] = [];
    const endExclusive = end - 1;

    // Level 0: Always include bin 0 (covers entire chromosome)
    bins.push(0);

    // Level 1: 64Mb bins (bins 1-8)
    const level1Start = Math.floor(start / (64 * 1024 * 1024));
    const level1End = Math.floor(endExclusive / (64 * 1024 * 1024));
    for (let i = level1Start; i <= level1End && i < 8; i++) {
      bins.push(1 + i);
    }

    // Level 2: 8Mb bins (bins 9-72)
    const level2Start = Math.floor(start / (8 * 1024 * 1024));
    const level2End = Math.floor(endExclusive / (8 * 1024 * 1024));
    for (let i = level2Start; i <= level2End && i < 64; i++) {
      bins.push(9 + i);
    }

    // Level 3: 1Mb bins (bins 73-584)
    const level3Start = Math.floor(start / (1024 * 1024));
    const level3End = Math.floor(endExclusive / (1024 * 1024));
    for (let i = level3Start; i <= level3End && i < 512; i++) {
      bins.push(73 + i);
    }

    // Level 4: 128Kb bins (bins 585-4680)
    const level4Start = Math.floor(start / (128 * 1024));
    const level4End = Math.floor(endExclusive / (128 * 1024));
    for (let i = level4Start; i <= level4End && i < 4096; i++) {
      bins.push(585 + i);
    }

    // Level 5: 16Kb bins (bins 4681-37448)
    const level5Start = Math.floor(start / (16 * 1024));
    const level5End = Math.floor(endExclusive / (16 * 1024));
    for (let i = level5Start; i <= level5End && i < 32768; i++) {
      bins.push(4681 + i);
    }

    // Remove duplicates and sort
    const uniqueBins = Array.from(new Set(bins)).sort((a, b) => a - b);

    // Validate all bins and convert to branded type
    const validatedBins = uniqueBins.map((bin) => {
      const result = BAIBinNumberSchema(bin);
      if (typeof result !== 'number') {
        throw new BamError(
          `Bin number validation failed for bin ${bin}: ${result.toString()}`,
          undefined,
          'bin_number'
        );
      }
      return result;
    });

    // Tiger Style: Assert result is reasonable
    console.assert(validatedBins.length > 0, 'must have at least one overlapping bin');
    console.assert(validatedBins.length <= 50, 'should not have excessive overlapping bins');
    console.assert(validatedBins[0] === 0, 'bin 0 should always be included');

    return validatedBins;
  },

  /**
   * Get parent bin number for hierarchical bin traversal
   * @param binNumber Child bin number
   * @returns Parent bin number or null if already at root (bin 0)
   */
  getParentBin(binNumber: BAIBinNumber): BAIBinNumber | null {
    // Tiger Style: Assert function arguments
    console.assert(typeof binNumber === 'number', 'binNumber must be number');
    console.assert(
      Number.isInteger(binNumber) && binNumber >= 0,
      'binNumber must be non-negative integer'
    );

    // Bin 0 is the root - no parent
    if (binNumber === 0) {
      return null;
    }

    // Determine which level the bin is in and calculate parent
    let parentBin: number;

    if (binNumber >= 4681 && binNumber <= 37448) {
      // Level 5 -> Level 4
      const level5Index = binNumber - 4681;
      const level4Index = Math.floor(level5Index / 8); // 8 level-5 bins per level-4 bin
      parentBin = 585 + level4Index;
    } else if (binNumber >= 585 && binNumber <= 4680) {
      // Level 4 -> Level 3
      const level4Index = binNumber - 585;
      const level3Index = Math.floor(level4Index / 8); // 8 level-4 bins per level-3 bin
      parentBin = 73 + level3Index;
    } else if (binNumber >= 73 && binNumber <= 584) {
      // Level 3 -> Level 2
      const level3Index = binNumber - 73;
      const level2Index = Math.floor(level3Index / 8); // 8 level-3 bins per level-2 bin
      parentBin = 9 + level2Index;
    } else if (binNumber >= 9 && binNumber <= 72) {
      // Level 2 -> Level 1
      const level2Index = binNumber - 9;
      const level1Index = Math.floor(level2Index / 8); // 8 level-2 bins per level-1 bin
      parentBin = 1 + level1Index;
    } else if (binNumber >= 1 && binNumber <= 8) {
      // Level 1 -> Level 0
      parentBin = 0;
    } else {
      throw new BamError(
        `Invalid bin number for parent calculation: ${binNumber}`,
        undefined,
        'bin_traversal'
      );
    }

    const result = BAIBinNumberSchema(parentBin);
    if (typeof result !== 'number') {
      throw new BamError(
        `Parent bin validation failed for bin ${parentBin}: ${result.toString()}`,
        undefined,
        'bin_number'
      );
    }
    return result;
  },

  /**
   * Get child bin numbers for hierarchical bin traversal
   * @param binNumber Parent bin number
   * @returns Array of child bin numbers (empty if at finest level)
   */
  getChildBins(binNumber: BAIBinNumber): readonly BAIBinNumber[] {
    // Tiger Style: Assert function arguments
    console.assert(typeof binNumber === 'number', 'binNumber must be number');
    console.assert(
      Number.isInteger(binNumber) && binNumber >= 0,
      'binNumber must be non-negative integer'
    );

    const children: number[] = [];

    if (binNumber === 0) {
      // Level 0 -> Level 1 (bins 1-8)
      for (let i = 1; i <= 8; i++) {
        children.push(i);
      }
    } else if (binNumber >= 1 && binNumber <= 8) {
      // Level 1 -> Level 2
      const level1Index = binNumber - 1;
      const startBin = 9 + level1Index * 8;
      for (let i = 0; i < 8 && startBin + i <= 72; i++) {
        children.push(startBin + i);
      }
    } else if (binNumber >= 9 && binNumber <= 72) {
      // Level 2 -> Level 3
      const level2Index = binNumber - 9;
      const startBin = 73 + level2Index * 8;
      for (let i = 0; i < 8 && startBin + i <= 584; i++) {
        children.push(startBin + i);
      }
    } else if (binNumber >= 73 && binNumber <= 584) {
      // Level 3 -> Level 4
      const level3Index = binNumber - 73;
      const startBin = 585 + level3Index * 8;
      for (let i = 0; i < 8 && startBin + i <= 4680; i++) {
        children.push(startBin + i);
      }
    } else if (binNumber >= 585 && binNumber <= 4680) {
      // Level 4 -> Level 5
      const level4Index = binNumber - 585;
      const startBin = 4681 + level4Index * 8;
      for (let i = 0; i < 8 && startBin + i <= 37448; i++) {
        children.push(startBin + i);
      }
    }
    // Level 5 bins (4681-37448) have no children

    // Validate and convert to branded types
    const validatedChildren = children.map((bin) => {
      const result = BAIBinNumberSchema(bin);
      if (typeof result !== 'number') {
        throw new BamError(
          `Child bin validation failed for bin ${bin}: ${result.toString()}`,
          undefined,
          'bin_number'
        );
      }
      return result;
    });

    // Tiger Style: Assert result is reasonable
    console.assert(validatedChildren.length <= 8, 'should not have more than 8 children per bin');

    return validatedChildren;
  },

  /**
   * Validate that a bin number is within the valid UCSC binning scheme range
   * @param binNumber Bin number to validate
   * @returns True if bin number is valid
   */
  isValidBin(binNumber: number): boolean {
    // Tiger Style: Assert function arguments
    console.assert(typeof binNumber === 'number', 'binNumber must be number');

    if (!Number.isInteger(binNumber) || binNumber < 0) {
      return false;
    }

    // Check if bin is within any valid level range
    return (
      binNumber === 0 || // Level 0
      (binNumber >= 1 && binNumber <= 8) || // Level 1
      (binNumber >= 9 && binNumber <= 72) || // Level 2
      (binNumber >= 73 && binNumber <= 584) || // Level 3
      (binNumber >= 585 && binNumber <= 4680) || // Level 4
      (binNumber >= 4681 && binNumber <= 37448)
    ); // Level 5
  },
};

/**
 * Calculate linear index interval for a genomic position
 * @param position Genomic coordinate (0-based)
 * @param intervalSize Size of each linear index interval (default: 16384)
 * @returns Linear index interval number
 */
export function calculateLinearInterval(position: number, intervalSize = 16384): number {
  // Tiger Style: Assert function arguments
  console.assert(
    Number.isInteger(position) && position >= 0,
    'position must be non-negative integer'
  );
  console.assert(
    Number.isInteger(intervalSize) && intervalSize > 0,
    'intervalSize must be positive integer'
  );

  const interval = Math.floor(position / intervalSize);

  // Tiger Style: Assert result is valid
  console.assert(
    Number.isInteger(interval) && interval >= 0,
    'calculated interval must be non-negative integer'
  );

  return interval;
}

/**
 * Update linear index with minimum virtual offset for an interval
 * @param linearIndex Array of virtual offsets (modified in place)
 * @param position Genomic position
 * @param virtualOffset Virtual offset to potentially record
 * @param intervalSize Size of each interval (default: 16384)
 */
export function updateLinearIndex(
  linearIndex: VirtualOffset[],
  position: number,
  virtualOffset: VirtualOffset,
  intervalSize = 16384
): void {
  // Tiger Style: Assert function arguments
  console.assert(Array.isArray(linearIndex), 'linearIndex must be an array');
  console.assert(
    Number.isInteger(position) && position >= 0,
    'position must be non-negative integer'
  );
  console.assert(typeof virtualOffset === 'bigint', 'virtualOffset must be bigint');
  console.assert(
    Number.isInteger(intervalSize) && intervalSize > 0,
    'intervalSize must be positive integer'
  );

  const interval = calculateLinearInterval(position, intervalSize);

  // Extend array if necessary
  while (linearIndex.length <= interval) {
    linearIndex.push(0n as VirtualOffset);
  }

  // Record minimum virtual offset for this interval
  if (linearIndex[interval]! === 0n || virtualOffset < linearIndex[interval]!) {
    linearIndex[interval] = virtualOffset;
  }

  // Tiger Style: Assert postconditions
  console.assert(linearIndex.length > interval, 'array must be extended to include interval');
  console.assert(linearIndex[interval] !== 0n, 'interval must have non-zero virtual offset');
}

/**
 * Merge overlapping or adjacent chunks to optimize index size
 * @param chunks Array of chunks sorted by beginOffset
 * @param maxGap Maximum gap between chunks to merge (default: 65536)
 * @returns Array of merged chunks
 */
export function mergeChunks(
  chunks: readonly { beginOffset: VirtualOffset; endOffset: VirtualOffset }[],
  maxGap = 65536
): { beginOffset: VirtualOffset; endOffset: VirtualOffset }[] {
  // Tiger Style: Assert function arguments
  console.assert(Array.isArray(chunks), 'chunks must be an array');
  console.assert(Number.isInteger(maxGap) && maxGap >= 0, 'maxGap must be non-negative integer');

  if (chunks.length === 0) {
    return [];
  }

  // Validate chunks are sorted
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i]!.beginOffset <= chunks[i - 1]!.beginOffset) {
      throw new BamError(`Chunks must be sorted by beginOffset`, undefined, 'chunk_merge');
    }
  }

  const merged: { beginOffset: VirtualOffset; endOffset: VirtualOffset }[] = [];
  let current = { ...chunks[0]! };

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i]!;
    const gap = Number(next.beginOffset - current.endOffset);

    // Merge if gap is small enough
    if (gap <= maxGap) {
      current.endOffset = next.endOffset > current.endOffset ? next.endOffset : current.endOffset;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);

  // Tiger Style: Assert result is valid
  console.assert(merged.length <= chunks.length, 'merged chunks should not exceed original count');
  console.assert(merged.length > 0, 'should have at least one merged chunk');

  return merged;
}

/**
 * Estimate memory usage for BAI index components
 * @param referenceCount Number of reference sequences
 * @param avgBinsPerRef Average bins per reference
 * @param avgChunksPerBin Average chunks per bin
 * @param avgLinearIntervals Average linear index intervals per reference
 * @returns Estimated memory usage in bytes
 */
export function estimateBAIMemoryUsage(
  referenceCount: number,
  avgBinsPerRef: number,
  avgChunksPerBin: number,
  avgLinearIntervals: number
): number {
  // Tiger Style: Assert function arguments
  console.assert(
    Number.isInteger(referenceCount) && referenceCount >= 0,
    'referenceCount must be non-negative integer'
  );
  console.assert(
    Number.isFinite(avgBinsPerRef) && avgBinsPerRef >= 0,
    'avgBinsPerRef must be non-negative number'
  );
  console.assert(
    Number.isFinite(avgChunksPerBin) && avgChunksPerBin >= 0,
    'avgChunksPerBin must be non-negative number'
  );
  console.assert(
    Number.isFinite(avgLinearIntervals) && avgLinearIntervals >= 0,
    'avgLinearIntervals must be non-negative number'
  );

  // Estimate per-reference costs
  const binsPerRef = Math.ceil(avgBinsPerRef);
  const chunksPerRef = Math.ceil(binsPerRef * avgChunksPerBin);
  const intervalsPerRef = Math.ceil(avgLinearIntervals);

  // Memory usage estimates
  const chunkSize = 16; // 2 * 8 bytes for virtual offsets
  const binOverhead = 32; // Map entry + bin metadata
  const linearIndexSize = intervalsPerRef * 8; // 8 bytes per virtual offset
  const referenceOverhead = 64; // Reference object overhead

  const memoryPerRef =
    chunksPerRef * chunkSize + binsPerRef * binOverhead + linearIndexSize + referenceOverhead;

  const totalMemory = referenceCount * memoryPerRef + 1024; // Base index object overhead

  // Tiger Style: Assert result is reasonable
  console.assert(totalMemory >= 0, 'estimated memory must be non-negative');

  return Math.ceil(totalMemory);
}
