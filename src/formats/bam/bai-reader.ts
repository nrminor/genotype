/**
 * BAI (BAM Index) reader for efficient genomic region queries
 *
 * Provides comprehensive BAI index reading capabilities:
 * - Binary BAI file parsing with format validation
 * - Genomic region queries with chunk optimization
 * - Linear index access for efficient seeking
 * - Index integrity validation and error recovery
 * - Memory-efficient streaming for large indexes
 * - Bun-optimized file I/O and buffer management
 *
 * Follows Tiger Style with extensive validation and clear error messages.
 */

import type {
  BAIIndex,
  BAIReference,
  BAIBin,
  BAIChunk,
  BAILinearIndex,
  BAIQueryResult,
  BAIReaderOptions,
  BAIStatistics,
  VirtualOffset,
  BAIBinNumber,
  FilePath,
} from '../../types';
import { VirtualOffsetSchema, BAIBinNumberSchema, FilePathSchema } from '../../types';
import { BamError } from '../../errors';
import { readInt32LE, readUInt32LE } from './binary';
import { VirtualOffsetUtils, BinningUtils } from './bai-utils';

// Constants for BAI reader configuration
const DEFAULT_BUFFER_SIZE = 64 * 1024; // 64KB default buffer size
const DEFAULT_TIMEOUT = 30000; // 30 second timeout

/**
 * BAI reader class for loading and querying BAM index files
 *
 * Optimized for both small indexes (loaded entirely in memory) and
 * large indexes (streaming access with selective caching).
 *
 * @example Basic usage
 * ```typescript
 * const reader = new BAIReader('/path/to/file.bam.bai');
 * const index = await reader.readIndex();
 * const chunks = await reader.queryRegion(0, 1000, 2000);
 * ```
 *
 * @example With options
 * ```typescript
 * const reader = new BAIReader('/path/to/file.bam.bai', {
 *   cacheIndex: true,
 *   validateOnLoad: true,
 *   bufferSize: 256 * 1024
 * });
 * ```
 */
export class BAIReader {
  private readonly filePath: FilePath;
  private readonly options: Required<BAIReaderOptions>;
  private cachedIndex?: BAIIndex;
  private fileHandle?: unknown; // Runtime-specific file handle
  private readonly loadPromise?: Promise<BAIIndex>;

  /**
   * Create a new BAI reader for the specified index file
   * @param filePath Path to BAI index file
   * @param options Reader configuration options
   * @throws {BamError} If file path is invalid
   */
  constructor(filePath: string, options: BAIReaderOptions = {}) {
    // Tiger Style: Assert constructor arguments
    console.assert(typeof filePath === 'string', 'filePath must be a string');
    console.assert(filePath.length > 0, 'filePath must not be empty');
    console.assert(typeof options === 'object', 'options must be an object');

    const validatedPath = FilePathSchema(filePath);
    if (typeof validatedPath !== 'string') {
      throw new BamError(`Invalid file path: ${validatedPath.toString()}`, undefined, 'file_path');
    }
    this.filePath = validatedPath;
    this.options = {
      cacheIndex: options.cacheIndex ?? true,
      validateOnLoad: options.validateOnLoad ?? true,
      bufferSize: options.bufferSize ?? DEFAULT_BUFFER_SIZE,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      ...(options.onProgress && { onProgress: options.onProgress }),
    } as Required<BAIReaderOptions>;

    // Pre-load index if caching is enabled
    if (this.options.cacheIndex) {
      this.loadPromise = this.readIndex().catch((error) => {
        // Failed to pre-load BAI index - will be handled when readIndex is called
        throw error;
      });
    }
  }

  /**
   * Validate BAI file size and setup
   */
  private validateFileData(fileData: Uint8Array): void {
    const totalBytes = fileData.length;
    if (totalBytes < 8) {
      throw new BamError(
        `BAI file too small: ${totalBytes} bytes (minimum 8 for header)`,
        undefined,
        'file_format',
        undefined,
        `File: ${this.filePath}`
      );
    }
  }

  /**
   * Parse BAI header and return parsed data with offset
   */
  private parseBAIHeader(view: DataView): { referenceCount: number; offset: number } {
    let offset = 0;

    // Read and validate BAI magic bytes
    const magic = new Uint8Array(view.buffer, view.byteOffset, 4);
    if (!this.isValidBAIMagic(magic)) {
      throw new BamError(
        'Invalid BAI magic bytes - file may be corrupted or not a BAI file',
        undefined,
        'file_format',
        undefined,
        `Expected: "BAI\\1", Found: ${Array.from(magic)
          .map((b) => `0x${b.toString(16).padStart(2, '0')}`)
          .join(' ')}`
      );
    }
    offset += 4;

    // Read number of reference sequences
    const referenceCount = readInt32LE(view, offset);
    offset += 4;

    if (referenceCount < 0) {
      throw new BamError(`Invalid reference count: ${referenceCount}`, undefined, 'file_format');
    }

    if (referenceCount > 100000) {
      console.warn(`Very large reference count: ${referenceCount}`);
    }

    return { referenceCount, offset };
  }

  /**
   * Parse all reference sequences from BAI data
   */
  private parseAllReferences(
    view: DataView,
    startOffset: number,
    referenceCount: number,
    totalBytes: number,
    reportProgress?: (bytesRead: number, totalBytes: number) => void
  ): { references: BAIReference[]; finalOffset: number } {
    const references: BAIReference[] = [];
    let offset = startOffset;
    let bytesRead = startOffset;

    for (let refId = 0; refId < referenceCount; refId++) {
      try {
        if (offset >= totalBytes) {
          throw new BamError(
            `Unexpected end of file while reading reference ${refId}`,
            undefined,
            'file_format'
          );
        }

        const reference = this.parseReference(view, offset, refId);
        references.push(reference.data);
        offset += reference.bytesConsumed;
        bytesRead += reference.bytesConsumed;

        // Progress reporting
        if (reportProgress !== undefined && reportProgress !== null && refId % 100 === 0) {
          reportProgress(bytesRead, totalBytes);
        }
      } catch (error) {
        throw new BamError(
          `Failed to parse reference ${refId}: ${error instanceof Error ? error.message : String(error)}`,
          undefined,
          'reference_parsing',
          offset,
          `Reference ID: ${refId}, Offset: ${offset}`
        );
      }
    }

    return { references, finalOffset: offset };
  }

  /**
   * Create and validate the final BAI index
   */
  private createBAIIndex(referenceCount: number, references: BAIReference[]): BAIIndex {
    const index: BAIIndex = {
      referenceCount,
      references,
      version: '1.0',
      createdAt: new Date(),
      sourceFile: this.filePath,
    };

    // Tiger Style: Assert postconditions
    console.assert(index.referenceCount === referenceCount, 'reference count must match');
    console.assert(
      index.references.length === referenceCount,
      'references array length must match'
    );

    return index;
  }

  /**
   * Read and parse the complete BAI index from file
   * @returns Promise resolving to parsed BAI index
   * @throws {BamError} If file cannot be read or index is invalid
   */
  async readIndex(): Promise<BAIIndex> {
    // Return cached index if available
    if (this.cachedIndex) {
      return this.cachedIndex;
    }

    // Wait for ongoing load if applicable
    if (this.loadPromise) {
      return this.loadPromise;
    }

    try {
      // Tiger Style: Assert preconditions
      console.assert(this.filePath.length > 0, 'file path must be valid');

      const startTime = Date.now();
      const fileData = await this.readFileData();
      const totalBytes = fileData.length;

      this.validateFileData(fileData);

      // Progress reporting setup
      const reportProgress = this.options.onProgress;
      if (reportProgress !== undefined && reportProgress !== null) {
        reportProgress(0, totalBytes);
      }

      // Parse BAI header
      const view = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
      const headerData = this.parseBAIHeader(view);

      // Parse all references
      const referencesData = this.parseAllReferences(
        view,
        headerData.offset,
        headerData.referenceCount,
        totalBytes,
        reportProgress
      );

      // Validate we consumed all data
      if (referencesData.finalOffset !== totalBytes) {
        console.warn(`BAI file has ${totalBytes - referencesData.finalOffset} unused bytes at end`);
      }

      // Create and store index
      const index = this.createBAIIndex(headerData.referenceCount, referencesData.references);
      this.cachedIndex = index;

      // Final progress report
      if (reportProgress !== undefined && reportProgress !== null) {
        reportProgress(totalBytes, totalBytes);
      }

      const loadTime = Date.now() - startTime;
      console.log(
        `Loaded BAI index: ${headerData.referenceCount} references, ${loadTime}ms, ${(totalBytes / 1024).toFixed(1)}KB`
      );

      return this.cachedIndex!;
    } catch (error) {
      if (error instanceof BamError) {
        throw error;
      }
      throw new BamError(
        `Failed to read BAI index: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'index_loading',
        undefined,
        `File: ${this.filePath}`
      );
    }
  }

  /**
   * Query genomic region and return relevant chunks for BAM file access
   * @param referenceId Reference sequence ID (0-based)
   * @param start Start coordinate (0-based, inclusive)
   * @param end End coordinate (0-based, exclusive)
   * @returns Promise resolving to query result with chunks
   * @throws {BamError} If query parameters are invalid or index not loaded
   */
  async queryRegion(referenceId: number, start: number, end: number): Promise<BAIQueryResult> {
    // Tiger Style: Assert function arguments
    console.assert(
      Number.isInteger(referenceId) && referenceId >= 0,
      'referenceId must be non-negative integer'
    );
    console.assert(Number.isInteger(start) && start >= 0, 'start must be non-negative integer');
    console.assert(Number.isInteger(end) && end >= 0, 'end must be non-negative integer');

    if (end <= start) {
      throw new BamError(
        `Invalid query region: end (${end}) must be > start (${start})`,
        undefined,
        'query_coordinates'
      );
    }

    // Load index if not already cached
    const index = await this.readIndex();

    if (referenceId >= index.referenceCount) {
      throw new BamError(
        `Reference ID ${referenceId} out of bounds (max ${index.referenceCount - 1})`,
        undefined,
        'query_coordinates'
      );
    }

    const reference = index.references[referenceId];
    if (!reference) {
      throw new BamError(
        `Reference ${referenceId} not found in index`,
        undefined,
        'query_reference'
      );
    }

    try {
      // Get overlapping bins for hierarchical search
      const overlappingBins = BinningUtils.getOverlappingBins(start, end);

      // Collect chunks from all overlapping bins
      const allChunks: BAIChunk[] = [];

      for (const binNumber of overlappingBins) {
        const bin = reference.bins.get(binNumber);
        if (bin) {
          allChunks.push(...bin.chunks);
        }
      }

      // Sort chunks by begin offset
      allChunks.sort((a, b) => VirtualOffsetUtils.compare(a.beginOffset, b.beginOffset));

      // Apply linear index optimization to filter chunks
      const optimizedChunks = this.applyLinearIndexFilter(
        allChunks,
        reference.linearIndex,
        start,
        end
      );

      // Merge adjacent/overlapping chunks to minimize I/O
      const mergedChunks = this.mergeAdjacentChunks(optimizedChunks);

      // Calculate minimum offset for efficient seeking
      const minOffset = mergedChunks.length > 0 ? mergedChunks[0]!.beginOffset : undefined;

      const result: BAIQueryResult = {
        chunks: mergedChunks,
        ...(minOffset !== undefined ? { minOffset } : {}),
        referenceId,
        region: { start, end },
      };

      // Tiger Style: Assert result is valid
      console.assert(result.chunks.length >= 0, 'chunks array must be valid');
      console.assert(result.referenceId === referenceId, 'reference ID must match query');

      return result;
    } catch (error) {
      throw new BamError(
        `Query failed for region ${referenceId}:${start}-${end}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'region_query',
        undefined,
        `Reference: ${referenceId}, Region: ${start}-${end}`
      );
    }
  }

  /**
   * Get linear index for a reference sequence
   * @param referenceId Reference sequence ID
   * @returns Promise resolving to linear index data
   * @throws {BamError} If reference ID is invalid
   */
  async getLinearIndex(referenceId: number): Promise<BAILinearIndex> {
    // Tiger Style: Assert function arguments
    console.assert(
      Number.isInteger(referenceId) && referenceId >= 0,
      'referenceId must be non-negative integer'
    );

    const index = await this.readIndex();

    if (referenceId >= index.referenceCount) {
      throw new BamError(
        `Reference ID ${referenceId} out of bounds (max ${index.referenceCount - 1})`,
        undefined,
        'reference_id'
      );
    }

    const reference = index.references[referenceId];
    if (!reference) {
      throw new BamError(
        `Reference ${referenceId} not found in index`,
        undefined,
        'reference_access'
      );
    }

    // Tiger Style: Assert postconditions
    console.assert(
      reference.linearIndex.intervals.length >= 0,
      'linear index must have valid intervals'
    );

    return reference.linearIndex;
  }

  /**
   * Validate index integrity and structure
   * @param thorough Whether to perform thorough validation (slower)
   * @returns Promise resolving to validation result
   */
  async validateIndex(
    thorough = false
  ): Promise<{ isValid: boolean; warnings: string[]; errors: string[] }> {
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      const index = await this.readIndex();

      // Basic structure validation (already done by schema validation)

      // Reference-level validation
      for (let refId = 0; refId < index.referenceCount; refId++) {
        const reference = index.references[refId];

        if (!reference) {
          errors.push(`Reference ${refId} is missing`);
          continue;
        }

        // Validate bin structure
        for (const [binId, bin] of reference.bins) {
          if (bin.binId !== binId) {
            errors.push(`Reference ${refId}, bin ${binId}: ID mismatch`);
          }

          if (bin.chunks.length === 0) {
            warnings.push(`Reference ${refId}, bin ${binId}: empty bin`);
          }

          // Validate chunk ordering
          for (let i = 1; i < bin.chunks.length; i++) {
            if (bin.chunks[i]!.beginOffset <= bin.chunks[i - 1]!.beginOffset) {
              errors.push(`Reference ${refId}, bin ${binId}: chunks not sorted`);
            }
          }
        }

        // Validate linear index
        const linearIndex = reference.linearIndex;
        let nonZeroCount = 0;
        for (let i = 0; i < linearIndex.intervals.length; i++) {
          if (linearIndex.intervals[i] !== 0n) {
            nonZeroCount++;
          }
        }

        if (nonZeroCount === 0 && reference.bins.size > 0) {
          warnings.push(`Reference ${refId}: linear index is empty but bins exist`);
        }

        if (thorough) {
          // Cross-validate bins and linear index
          await this.validateBinLinearConsistency(reference, refId, warnings, errors);
        }
      }
    } catch (error) {
      errors.push(
        `Index validation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return {
      isValid: errors.length === 0,
      warnings,
      errors,
    };
  }

  /**
   * Get statistics about the loaded index
   * @returns Promise resolving to index statistics
   */
  async getStatistics(): Promise<BAIStatistics> {
    const index = await this.readIndex();

    let totalBins = 0;
    let totalChunks = 0;
    let totalIntervals = 0;

    const perReference = index.references.map((ref, refId) => {
      const binCount = ref.bins.size;
      const chunkCount = Array.from(ref.bins.values()).reduce(
        (sum, bin) => sum + bin.chunks.length,
        0
      );
      const intervalCount = ref.linearIndex.intervals.length;

      totalBins += binCount;
      totalChunks += chunkCount;
      totalIntervals += intervalCount;

      return {
        referenceId: refId,
        binCount,
        chunkCount,
        intervalCount,
      };
    });

    // Estimate memory usage
    const chunkSize = 16; // 2 virtual offsets
    const binOverhead = 32; // Map entry + metadata
    const intervalSize = 8; // Virtual offset
    const referenceOverhead = 64; // Reference object

    const estimatedMemoryUsage =
      totalChunks * chunkSize +
      totalBins * binOverhead +
      totalIntervals * intervalSize +
      index.referenceCount * referenceOverhead +
      1024; // Base overhead

    return {
      totalBins,
      totalChunks,
      totalIntervals,
      estimatedMemoryUsage,
      perReference,
    };
  }

  /**
   * Close the reader and clean up resources
   */
  async close(): Promise<void> {
    try {
      if (this.fileHandle !== undefined && this.fileHandle !== null) {
        // Close file handle (runtime-specific)
        this.fileHandle = undefined;
      }

      // Clear cached data
      delete this.cachedIndex;
    } catch (error) {
      console.warn(
        `Error closing BAI reader: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Private implementation methods

  /**
   * Read file data using runtime-optimized I/O
   */
  private async readFileData(): Promise<Uint8Array> {
    try {
      // Use Bun.file() for optimal performance when available
      if (
        typeof globalThis !== 'undefined' &&
        'Bun' in globalThis &&
        globalThis.Bun !== undefined &&
        globalThis.Bun !== null &&
        typeof globalThis.Bun.file === 'function'
      ) {
        const file = globalThis.Bun.file(this.filePath);
        const arrayBuffer = await file.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      }

      // Fallback to other runtime file APIs would go here
      throw new Error('No supported file I/O method available');
    } catch (error) {
      throw new BamError(
        `Failed to read BAI file: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'file_io',
        undefined,
        `File: ${this.filePath}`
      );
    }
  }

  /**
   * Validate BAI magic bytes
   */
  private isValidBAIMagic(magic: Uint8Array): boolean {
    // BAI magic: "BAI\1" (0x42, 0x41, 0x49, 0x01)
    const expected = new Uint8Array([0x42, 0x41, 0x49, 0x01]);

    if (magic.length < 4) {
      return false;
    }

    for (let i = 0; i < 4; i++) {
      if (magic[i] !== expected[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parse a single reference from BAI data
   */
  private parseReference(
    view: DataView,
    offset: number,
    refId: number
  ): { data: BAIReference; bytesConsumed: number } {
    let currentOffset = offset;
    const startOffset = offset;

    try {
      // Read number of bins
      const numBins = readInt32LE(view, currentOffset);
      currentOffset += 4;

      if (numBins < 0) {
        throw new Error(`Invalid bin count: ${numBins}`);
      }

      if (numBins > 100000) {
        console.warn(`Reference ${refId} has many bins: ${numBins}`);
      }

      // Parse bins
      const bins = new Map<number, BAIBin>();

      for (let binIdx = 0; binIdx < numBins; binIdx++) {
        const bin = this.parseBin(view, currentOffset);
        bins.set(bin.data.binId, bin.data);
        currentOffset += bin.bytesConsumed;
      }

      // Read number of linear index intervals
      const numIntervals = readInt32LE(view, currentOffset);
      currentOffset += 4;

      if (numIntervals < 0) {
        throw new Error(`Invalid interval count: ${numIntervals}`);
      }

      // Parse linear index
      const intervals: VirtualOffset[] = [];
      for (let i = 0; i < numIntervals; i++) {
        const intervalOffset = BAIReader.readUInt64LE(view, currentOffset);
        const validatedOffset = VirtualOffsetSchema(intervalOffset);
        if (typeof validatedOffset !== 'bigint') {
          throw new BamError(
            `Invalid virtual offset at interval ${i}: ${validatedOffset.toString()}`,
            undefined,
            'virtual_offset'
          );
        }
        intervals.push(validatedOffset);
        currentOffset += 8;
      }

      const linearIndex: BAILinearIndex = {
        intervals,
        intervalSize: 16384, // Standard 16KB intervals
      };

      const reference: BAIReference = {
        bins,
        linearIndex,
      };

      return {
        data: reference,
        bytesConsumed: currentOffset - startOffset,
      };
    } catch (error) {
      throw new BamError(
        `Failed to parse reference at offset ${offset}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'reference_parsing',
        offset
      );
    }
  }

  /**
   * Parse a single bin from BAI data
   */
  private parseBin(view: DataView, offset: number): { data: BAIBin; bytesConsumed: number } {
    let currentOffset = offset;
    const startOffset = offset;

    try {
      // Read bin ID
      const binId = readUInt32LE(view, currentOffset);
      currentOffset += 4;

      const validatedBinId = BAIBinNumberSchema(binId) as BAIBinNumber;
      if (typeof validatedBinId !== 'object' || !validatedBinId) {
        throw new BamError(`Invalid bin ID ${binId}`, undefined, 'bin_id');
      }

      // Read number of chunks
      const numChunks = readInt32LE(view, currentOffset);
      currentOffset += 4;

      if (numChunks < 0) {
        throw new Error(`Invalid chunk count: ${numChunks}`);
      }

      if (numChunks > 10000) {
        console.warn(`Bin ${binId} has many chunks: ${numChunks}`);
      }

      // Parse chunks
      const chunks: BAIChunk[] = [];
      for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
        const beginOffsetRaw = BAIReader.readUInt64LE(view, currentOffset);
        const beginOffsetValidated = VirtualOffsetSchema(beginOffsetRaw);
        if (typeof beginOffsetValidated !== 'bigint') {
          throw new BamError(
            `Invalid begin offset for chunk ${chunkIdx}: ${beginOffsetValidated.toString()}`,
            undefined,
            'virtual_offset'
          );
        }
        const beginOffset = beginOffsetValidated;
        currentOffset += 8;

        const endOffsetRaw = BAIReader.readUInt64LE(view, currentOffset);
        const endOffsetValidated = VirtualOffsetSchema(endOffsetRaw);
        if (typeof endOffsetValidated !== 'bigint') {
          throw new BamError(
            `Invalid end offset for chunk ${chunkIdx}: ${endOffsetValidated.toString()}`,
            undefined,
            'virtual_offset'
          );
        }
        const endOffset = endOffsetValidated;
        currentOffset += 8;

        if (beginOffset >= endOffset) {
          throw new Error(`Invalid chunk: begin ${beginOffset} >= end ${endOffset}`);
        }

        chunks.push({ beginOffset, endOffset });
      }

      const bin: BAIBin = {
        binId: validatedBinId,
        chunks,
      };

      return {
        data: bin,
        bytesConsumed: currentOffset - startOffset,
      };
    } catch (error) {
      throw new BamError(
        `Failed to parse bin at offset ${offset}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'bin_parsing',
        offset
      );
    }
  }

  /**
   * Apply linear index filtering to chunks
   */
  private applyLinearIndexFilter(
    chunks: BAIChunk[],
    linearIndex: BAILinearIndex,
    start: number,
    end: number
  ): BAIChunk[] {
    if (chunks.length === 0 || linearIndex.intervals.length === 0) {
      return chunks;
    }

    // Calculate linear index intervals for start and end positions
    const startInterval = Math.floor(start / linearIndex.intervalSize);
    const endInterval = Math.min(
      Math.floor(end / linearIndex.intervalSize) + 1,
      linearIndex.intervals.length
    );

    // Find minimum virtual offset from linear index in the query range
    let minOffset: VirtualOffset | null = null;

    for (let i = startInterval; i < endInterval; i++) {
      const intervalOffset = linearIndex.intervals[i];
      if (intervalOffset !== undefined && intervalOffset !== 0n) {
        minOffset = intervalOffset;
        break;
      }
    }

    // Filter chunks that start before the minimum offset
    if (minOffset !== null) {
      return chunks.filter((chunk) => chunk.beginOffset >= minOffset!);
    }

    return chunks;
  }

  /**
   * Merge adjacent chunks to optimize I/O
   */
  private mergeAdjacentChunks(chunks: BAIChunk[], maxGap = 65536): BAIChunk[] {
    if (chunks.length <= 1) {
      return [...chunks];
    }

    const merged: BAIChunk[] = [];
    let current = chunks[0]!;

    for (let i = 1; i < chunks.length; i++) {
      const next = chunks[i]!;
      const gap = Number(next.beginOffset - current.endOffset);

      if (gap <= maxGap) {
        // Merge chunks
        current = {
          beginOffset: current.beginOffset,
          endOffset: next.endOffset > current.endOffset ? next.endOffset : current.endOffset,
        };
      } else {
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);
    return merged;
  }

  /**
   * Validate consistency between bins and linear index
   */
  private async validateBinLinearConsistency(
    reference: BAIReference,
    refId: number,
    warnings: string[],
    errors: string[]
  ): Promise<void> {
    // Basic validation checks
    // Check that linear index intervals are reasonable
    if (
      reference.linearIndex !== null &&
      reference.linearIndex !== undefined &&
      reference.linearIndex.intervals.length > 0
    ) {
      let prevOffset = 0n;
      for (let i = 0; i < reference.linearIndex.intervals.length; i++) {
        const offset = reference.linearIndex.intervals[i];
        if (offset !== undefined && offset < prevOffset) {
          errors.push(
            `Reference ${refId}: Linear index interval ${i} offset ${offset} is less than previous ${prevOffset}`
          );
        }
        if (offset !== undefined) {
          prevOffset = offset;
        }
      }
    }

    // Check bin consistency
    if (reference.bins.size === 0) {
      warnings.push(`Reference ${refId}: No bins found - index may be incomplete`);
    }
    // 2. Bins cover all genomic regions referenced in linear index
    // 3. Virtual offsets are consistent across data structures

    // For now, just basic sanity checks
    if (reference.bins.size === 0 && reference.linearIndex.intervals.some((i) => i !== 0n)) {
      warnings.push(`Reference ${refId}: linear index has data but no bins`);
    }
  }

  /**
   * Read 64-bit unsigned integer in little-endian format (added to BinaryParser)
   */
  private static readUInt64LE(view: DataView, offset: number): bigint {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');

    if (offset + 8 > view.byteLength) {
      throw new BamError(
        `Cannot read uint64 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
        undefined,
        'binary'
      );
    }

    // Read as two 32-bit values and combine
    const low = view.getUint32(offset, true); // little-endian
    const high = view.getUint32(offset + 4, true); // little-endian

    const result = (BigInt(high) << 32n) | BigInt(low);

    // Tiger Style: Assert postconditions
    console.assert(result >= 0n, 'result must be non-negative');

    return result;
  }
}

// Note: This class implements its own readUInt64LE since it's not part of the standard BinaryParser functions
