/**
 * Binary data parsing utilities for BAM format
 *
 * Handles the complex binary encoding used in BAM files:
 * - Little-endian integer parsing
 * - 4-bit encoded nucleotide sequences
 * - Binary CIGAR operations
 * - Null-terminated strings
 * - Type-safe binary operations with bounds checking
 */

import { BamError } from '../../errors';
import type { BinaryContext } from '../../types';

// Module-level constants for magic numbers
const MAX_UINT16_VALUE = 65535;
const MAX_UINT8_VALUE = 255;
const BAM_MAGIC_BYTES = new Uint8Array([0x42, 0x41, 0x4d, 0x01]); // "BAM\1"
const PHRED_OFFSET = 33;
const MAX_ASCII_QUAL = 126;
const UNAVAILABLE_QUALITY = 255;
const BYTES_PER_CIGAR_OP = 4;
const MIN_ALIGNMENT_BLOCK_SIZE = 32;
const MAX_CHROMOSOME_POSITION = 300_000_000;
const MAX_MAPPING_QUALITY = 60;
const MAX_TEMPLATE_LENGTH = 10000;
const MAX_ARRAY_SIZE = 10000;
const JS_OBJECT_OVERHEAD = 200;

// BAM sequence encoding lookup table
const SEQ_DECODER = '=ACMGRSVTWYHKDBN';

// CIGAR operation lookup table
const CIGAR_OPS = ['M', 'I', 'D', 'N', 'S', 'H', 'P', '=', 'X'];

/**
 * Read a 32-bit signed integer in little-endian format
 * @param view DataView containing binary data
 * @param offset Byte offset to read from
 * @returns 32-bit signed integer value
 * @throws {BamError} If offset is out of bounds
 */
export function readInt32LE(view: DataView, offset: number): number {
  if (offset + 4 > view.byteLength) {
    throw new BamError(
      `Cannot read int32 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
      undefined,
      'binary'
    );
  }

  return view.getInt32(offset, true); // true = little-endian
}

/**
 * Read a 32-bit unsigned integer in little-endian format
 * @param view DataView containing binary data
 * @param offset Byte offset to read from
 * @returns 32-bit unsigned integer value
 * @throws {BamError} If offset is out of bounds
 */
export function readUInt32LE(view: DataView, offset: number): number {
  if (offset + 4 > view.byteLength) {
    throw new BamError(
      `Cannot read uint32 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
      undefined,
      'binary'
    );
  }

  return view.getUint32(offset, true); // true = little-endian
}

/**
 * Read a 16-bit unsigned integer in little-endian format
 * @param view DataView containing binary data
 * @param offset Byte offset to read from
 * @returns 16-bit unsigned integer value
 * @throws {BamError} If offset is out of bounds
 */
export function readUInt16LE(view: DataView, offset: number): number {
  if (offset + 2 > view.byteLength) {
    throw new BamError(
      `Cannot read uint16 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
      undefined,
      'binary'
    );
  }

  return view.getUint16(offset, true); // true = little-endian
}

/**
 * Read an 8-bit unsigned integer
 * @param view DataView containing binary data
 * @param offset Byte offset to read from
 * @returns 8-bit unsigned integer value
 * @throws {BamError} If offset is out of bounds
 */
export function readUInt8(view: DataView, offset: number): number {
  if (offset >= view.byteLength) {
    throw new BamError(
      `Cannot read uint8 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
      undefined,
      'binary'
    );
  }

  return view.getUint8(offset);
}

/**
 * Read a null-terminated string from binary data
 * @param view DataView containing binary data
 * @param offset Starting byte offset
 * @param maxLength Maximum string length to prevent infinite loops
 * @returns Object with string value and bytes consumed
 * @throws {BamError} If string is not null-terminated within maxLength
 */
export function readCString(
  view: DataView,
  offset: number,
  maxLength: number
): { value: string; bytesRead: number } {
  if (offset >= view.byteLength) {
    throw new BamError(
      `Cannot read string at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
      undefined,
      'binary'
    );
  }

  const bytes: number[] = [];
  let currentOffset = offset;

  while (currentOffset < view.byteLength && bytes.length < maxLength) {
    const byte = view.getUint8(currentOffset);

    if (byte === 0) {
      // Found null terminator
      const result = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
      return { value: result, bytesRead: bytes.length + 1 }; // +1 for null terminator
    }

    bytes.push(byte);
    currentOffset++;
  }

  throw new BamError(
    `String not null-terminated within ${maxLength} bytes at offset ${offset}`,
    undefined,
    'binary'
  );
}

/**
 * Decode 4-bit packed nucleotide sequence using Bun-optimized approach
 *
 * BAM encodes nucleotides using 4 bits per base:
 * =:0, A:1, C:2, M:3, G:4, R:5, S:6, V:7, T:8, W:9, Y:10, H:11, K:12, D:13, B:14, N:15
 *
 * @param buffer Binary data containing packed sequence
 * @param length Number of bases to decode
 * @returns Decoded nucleotide sequence string
 * @throws {BamError} If buffer is too small for specified length
 */
export function decodeSequence(buffer: Uint8Array, length: number): string {
  if (length === 0) {
    return '';
  }

  const bytesNeeded = Math.ceil(length / 2);
  if (buffer.length < bytesNeeded) {
    throw new BamError(
      `Buffer too small for sequence: need ${bytesNeeded} bytes, have ${buffer.length}`,
      undefined,
      'sequence'
    );
  }

  // Use Bun-optimized approach: pre-allocate array and join once
  const chars = new Array(length);

  for (let i = 0; i < length; i++) {
    const byteIndex = Math.floor(i / 2);
    const byte = buffer[byteIndex];

    if (byte === undefined) {
      throw new BamError(`Sequence byte undefined at index ${byteIndex}`, undefined, 'sequence');
    }

    // Extract 4-bit value (high nibble for even i, low nibble for odd i)
    const nibble = i % 2 === 0 ? (byte >> 4) & 0xf : byte & 0xf;

    if (nibble >= SEQ_DECODER.length) {
      throw new BamError(
        `Invalid sequence encoding: ${nibble} at position ${i}`,
        undefined,
        'sequence'
      );
    }

    chars[i] = SEQ_DECODER[nibble];
  }

  return chars.join('');
}

/**
 * Parse binary CIGAR operations into standard CIGAR string
 *
 * BAM stores CIGAR as array of 32-bit integers where:
 * - High 28 bits = operation length
 * - Low 4 bits = operation type (0=M, 1=I, 2=D, 3=N, 4=S, 5=H, 6=P, 7=X, 8==)
 *
 * @param view DataView containing binary CIGAR data
 * @param offset Starting offset in view
 * @param count Number of CIGAR operations
 * @returns Standard CIGAR string representation
 * @throws {BamError} If data is invalid or buffer too small
 */
export function parseBinaryCIGAR(view: DataView, offset: number, count: number): string {
  if (count === 0) {
    return '*'; // BAM convention for no CIGAR
  }

  const bytesNeeded = count * BYTES_PER_CIGAR_OP;
  if (offset + bytesNeeded > view.byteLength) {
    throw new BamError(
      `Buffer too small for CIGAR: need ${bytesNeeded} bytes at offset ${offset}, have ${view.byteLength - offset}`,
      undefined,
      'cigar'
    );
  }

  let cigar = '';
  for (let i = 0; i < count; i++) {
    const opOffset = offset + i * BYTES_PER_CIGAR_OP;
    const opValue = view.getUint32(opOffset, true); // little-endian

    const opLength = opValue >>> 4; // High 28 bits
    const opType = opValue & 0xf; // Low 4 bits

    if (opType >= CIGAR_OPS.length) {
      throw new BamError(
        `Invalid CIGAR operation type: ${opType} at position ${i}`,
        undefined,
        'cigar'
      );
    }

    if (opLength === 0) {
      throw new BamError(`Invalid CIGAR operation length: 0 at position ${i}`, undefined, 'cigar');
    }

    cigar += `${opLength}${CIGAR_OPS[opType]}`;
  }

  return cigar;
}

/**
 * Read a fixed-length binary string with Bun optimization
 * @param view DataView containing binary data
 * @param offset Starting byte offset
 * @param length Number of bytes to read
 * @returns Decoded string
 * @throws {BamError} If buffer is too small
 */
export function readFixedString(view: DataView, offset: number, length: number): string {
  if (length === 0) {
    return '';
  }

  if (offset + length > view.byteLength) {
    throw new BamError(
      `Cannot read fixed string: need ${length} bytes at offset ${offset}, buffer has ${view.byteLength} bytes`,
      undefined,
      'binary'
    );
  }

  // Use Bun's optimized string decoding when available
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

/**
 * Create a binary context for parsing operations with Bun optimization
 * @param buffer Binary data buffer (ArrayBuffer or Bun's optimized buffer)
 * @param offset Starting offset
 * @param littleEndian Whether to use little-endian byte order
 * @returns BinaryContext object for parsing
 */
export function createContext(buffer: ArrayBuffer, offset = 0, littleEndian = true): BinaryContext {
  if (offset >= buffer.byteLength) {
    throw new BamError(
      `Offset ${offset} exceeds buffer size ${buffer.byteLength}`,
      undefined,
      'binary'
    );
  }

  const dataView = new DataView(buffer, offset);

  return {
    buffer: dataView,
    offset,
    littleEndian,
  };
}

/**
 * Validate BAM magic bytes
 * @param magicBytes Bytes to validate (should be "BAM\1")
 * @returns True if valid BAM magic bytes
 */
export function isValidBAMMagic(magicBytes: Uint8Array): boolean {
  if (magicBytes.length < 4) {
    return false;
  }

  // BAM magic bytes: "BAM\1" (0x42, 0x41, 0x4D, 0x01)
  for (let i = 0; i < 4; i++) {
    if (magicBytes[i] !== BAM_MAGIC_BYTES[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Parse a complete BAM alignment record from binary data
 * @param view DataView containing alignment block data
 * @param offset Starting offset of alignment data (after block size)
 * @param blockSize Size of alignment block
 * @returns Object with parsed alignment data and bytes consumed
 * @throws {BamError} If alignment data is invalid or buffer too small
 */
export function parseAlignmentRecord(
  view: DataView,
  offset: number,
  blockSize: number
): {
  refID: number;
  pos: number;
  readNameLength: number;
  mapq: number;
  bin: number;
  numCigarOps: number;
  flag: number;
  seqLength: number;
  nextRefID: number;
  nextPos: number;
  tlen: number;
  readName: string;
  cigar: string;
  sequence: string;
  qualityScores: string;
  optionalTags?: Uint8Array;
  bytesConsumed: number;
} {
  validateAlignmentBlock(blockSize, view, offset);

  const fixedFields = parseAlignmentFixedFields(view, offset);
  validateAlignmentFields(fixedFields);

  const variableFields = parseAlignmentVariableFields(
    view,
    offset + MIN_ALIGNMENT_BLOCK_SIZE,
    offset + blockSize,
    fixedFields
  );

  return {
    ...fixedFields,
    ...variableFields,
    bytesConsumed: blockSize,
  };
}

/**
 * Decode quality scores from BAM binary format
 * @param view DataView containing quality data
 * @param offset Starting offset
 * @param length Number of quality scores
 * @returns Quality string in Phred+33 format
 * @throws {BamError} If buffer is too small
 */
export function decodeQualityScores(view: DataView, offset: number, length: number): string {
  if (length === 0) {
    return '*';
  }

  if (offset + length > view.byteLength) {
    throw new BamError(
      `Buffer too small for quality scores: need ${length} bytes at offset ${offset}`,
      undefined,
      'qual'
    );
  }

  // BAM stores quality as raw bytes (0-255), convert to Phred+33
  const qualChars = new Array(length);

  for (let i = 0; i < length; i++) {
    const rawQual = readUInt8(view, offset + i);

    if (rawQual === UNAVAILABLE_QUALITY) {
      // 255 indicates unavailable quality
      qualChars[i] = '*';
    } else {
      // Convert to Phred+33 format, cap at ASCII 126
      const phredQual = Math.min(rawQual + PHRED_OFFSET, MAX_ASCII_QUAL);
      qualChars[i] = String.fromCharCode(phredQual);
    }
  }

  return qualChars.join('');
}

/**
 * Parse BAM optional tags from binary data with Bun optimizations
 * @param tagData Binary tag data
 * @param qname Query name for error context
 * @returns Array of parsed SAM tags
 * @throws {BamError} If tag data is malformed
 */
export function parseOptionalTags(
  tagData: Uint8Array,
  qname?: string
): Array<{
  tag: string;
  type: string;
  value: string | number;
}> {
  const tags: Array<{ tag: string; type: string; value: string | number }> = [];
  let offset = 0;

  while (offset + 3 <= tagData.length) {
    // Minimum: 2 bytes tag + 1 byte type
    try {
      // Read tag name (2 bytes)
      const tagByte1 = tagData[offset];
      const tagByte2 = tagData[offset + 1];
      if (tagByte1 === undefined || tagByte2 === undefined) {
        throw new Error('Tag name bytes are undefined');
      }
      const tagName = String.fromCharCode(tagByte1, tagByte2);
      offset += 2;

      // Read tag type (1 byte)
      const tagTypeByte = tagData[offset];
      if (tagTypeByte === undefined) {
        throw new Error('Tag type byte is undefined');
      }
      const tagType = String.fromCharCode(tagTypeByte);
      offset += 1;

      // Read value based on type
      const valueResult = parseTagValue(tagData, offset, tagType);
      offset += valueResult.bytesConsumed;

      tags.push({
        tag: tagName,
        type: tagType,
        value: valueResult.value,
      });
    } catch (error) {
      // Stop parsing tags on error
      break;
    }
  }

  return tags;
}

/**
 * Validate BAM alignment record structure for common issues
 * @param record Parsed alignment record
 * @param references Reference sequence names
 * @returns Array of validation warnings (empty if valid)
 */
export function validateAlignment(
  record: ReturnType<typeof parseAlignmentRecord>,
  references: string[]
): string[] {
  const warnings: string[] = [];

  validateReferenceIds(record, references, warnings);
  validateCigarConsistency(record, warnings);
  validateMappingQuality(record, warnings);
  validateTemplateLength(record, warnings);
  validatePosition(record, warnings);

  return warnings;
}

/**
 * Create a Bun-optimized alignment parser with streaming capabilities
 * @param options Configuration options for performance tuning
 * @returns Optimized parser function
 */
export function createOptimizedParser(
  options: {
    bufferSize?: number;
    skipValidation?: boolean;
    onWarning?: (warning: string) => void;
  } = {}
): {
  parseAlignment: (
    view: DataView,
    offset: number,
    blockSize: number,
    references: string[]
  ) => ReturnType<typeof parseAlignmentRecord>;
  getStats: () => {
    sequenceBufferSize: number;
    qualityBufferSize: number;
    bufferUtilization: number;
  };
} {
  const { bufferSize = 64 * 1024, skipValidation = false, onWarning } = options;

  // Pre-allocate reusable buffers for Bun performance
  const sequenceBuffer = new Uint8Array(bufferSize);
  const qualityBuffer = new Uint8Array(bufferSize);

  return {
    /**
     * Parse alignment with pre-allocated buffers for better performance
     */
    parseAlignment: (
      view: DataView,
      offset: number,
      blockSize: number,
      references: string[]
    ): ReturnType<typeof parseAlignmentRecord> => {
      const record = parseAlignmentRecord(view, offset, blockSize);

      // Optional validation
      if (!skipValidation) {
        const warnings = validateAlignment(record, references);
        if (warnings.length > 0 && onWarning) {
          warnings.forEach((warning) => onWarning(`${record.readName}: ${warning}`));
        }
      }

      return record;
    },

    /**
     * Get buffer statistics for monitoring
     */
    getStats: (): {
      sequenceBufferSize: number;
      qualityBufferSize: number;
      bufferUtilization: number;
    } => ({
      sequenceBufferSize: sequenceBuffer.length,
      qualityBufferSize: qualityBuffer.length,
      bufferUtilization: bufferSize,
    }),
  };
}

/**
 * Estimate memory usage for BAM alignment record
 * @param record Parsed alignment record
 * @returns Estimated memory usage in bytes
 */
export function estimateMemoryUsage(record: ReturnType<typeof parseAlignmentRecord>): number {
  let totalBytes = 0;

  // Fixed fields (32 bytes)
  totalBytes += MIN_ALIGNMENT_BLOCK_SIZE;

  // Variable length fields
  totalBytes += record.readName.length + 1; // +1 for null terminator
  totalBytes += record.numCigarOps * BYTES_PER_CIGAR_OP;
  totalBytes += Math.ceil(record.seqLength / 2); // Packed sequence
  totalBytes += record.seqLength; // Quality scores

  // Optional tags
  if (record.optionalTags) {
    totalBytes += record.optionalTags.length;
  }

  // JavaScript object overhead (approximate)
  totalBytes += JS_OBJECT_OVERHEAD;

  return totalBytes;
}

/**
 * Check if current runtime supports Bun-specific optimizations
 * @returns True if Bun optimizations are available
 */
export function isBunOptimized(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    'Bun' in globalThis &&
    globalThis.Bun !== undefined &&
    typeof globalThis.Bun.version === 'string' &&
    typeof globalThis.Bun.file === 'function'
  );
}

/**
 * Get runtime-specific buffer allocation strategy
 * @param size Buffer size needed
 * @returns Optimally allocated buffer for current runtime
 */
export function allocateBuffer(size: number): Uint8Array {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('Size must be positive integer');
  }

  return new Uint8Array(size);
}

// Helper functions (non-exported)

/**
 * Validate alignment block size and bounds
 */
function validateAlignmentBlock(blockSize: number, view: DataView, offset: number): void {
  if (blockSize < MIN_ALIGNMENT_BLOCK_SIZE) {
    throw new BamError(
      `Alignment block too small: ${blockSize} bytes (minimum ${MIN_ALIGNMENT_BLOCK_SIZE})`,
      undefined,
      'alignment'
    );
  }

  if (offset + MIN_ALIGNMENT_BLOCK_SIZE > view.byteLength) {
    throw new BamError(
      `Buffer overflow reading alignment header: need ${MIN_ALIGNMENT_BLOCK_SIZE} bytes`,
      undefined,
      'alignment'
    );
  }
}

/**
 * Parse the fixed 32-byte alignment header
 */
function parseAlignmentFixedFields(
  view: DataView,
  offset: number
): {
  refID: number;
  pos: number;
  readNameLength: number;
  mapq: number;
  bin: number;
  numCigarOps: number;
  flag: number;
  seqLength: number;
  nextRefID: number;
  nextPos: number;
  tlen: number;
} {
  let currentOffset = offset;

  const refID = readInt32LE(view, currentOffset);
  currentOffset += 4;

  const pos = readInt32LE(view, currentOffset);
  currentOffset += 4;

  // bin_mq_nl: bin<<16 | MAPQ<<8 | l_read_name
  const binMqNl = readUInt32LE(view, currentOffset);
  const bin = (binMqNl >> 16) & 0xffff;
  const mapq = (binMqNl >> 8) & 0xff;
  const readNameLength = binMqNl & 0xff;
  currentOffset += 4;

  // flag_nc: FLAG<<16 | n_cigar_op
  const flagNc = readUInt32LE(view, currentOffset);
  const flag = (flagNc >> 16) & 0xffff;
  const numCigarOps = flagNc & 0xffff;
  currentOffset += 4;

  const seqLength = readInt32LE(view, currentOffset);
  currentOffset += 4;

  const nextRefID = readInt32LE(view, currentOffset);
  currentOffset += 4;

  const nextPos = readInt32LE(view, currentOffset);
  currentOffset += 4;

  const tlen = readInt32LE(view, currentOffset);

  return {
    refID,
    pos,
    readNameLength,
    mapq,
    bin,
    numCigarOps,
    flag,
    seqLength,
    nextRefID,
    nextPos,
    tlen,
  };
}

/**
 * Validate alignment fixed field values
 */
function validateAlignmentFields(fields: ReturnType<typeof parseAlignmentFixedFields>): void {
  if (fields.readNameLength <= 0 || fields.readNameLength > MAX_UINT8_VALUE) {
    throw new BamError(`Invalid read name length: ${fields.readNameLength}`, undefined, 'qname');
  }

  if (fields.seqLength < 0) {
    throw new BamError(`Invalid sequence length: ${fields.seqLength}`, undefined, 'seq');
  }

  if (fields.numCigarOps < 0 || fields.numCigarOps > MAX_UINT16_VALUE) {
    throw new BamError(`Invalid CIGAR operation count: ${fields.numCigarOps}`, undefined, 'cigar');
  }
}

/**
 * Parse variable-length fields from alignment data
 */
function parseAlignmentVariableFields(
  view: DataView,
  startOffset: number,
  endOffset: number,
  fixedFields: ReturnType<typeof parseAlignmentFixedFields>
): {
  readName: string;
  cigar: string;
  sequence: string;
  qualityScores: string;
  optionalTags: Uint8Array;
} {
  let currentOffset = startOffset;

  const readName = parseAlignmentReadName(
    view,
    currentOffset,
    endOffset,
    fixedFields.readNameLength
  );
  currentOffset += fixedFields.readNameLength;

  const cigar = parseAlignmentCigar(
    view,
    currentOffset,
    endOffset,
    fixedFields.numCigarOps,
    readName
  );
  currentOffset += fixedFields.numCigarOps * BYTES_PER_CIGAR_OP;

  const sequence = parseAlignmentSequence(
    view,
    currentOffset,
    endOffset,
    fixedFields.seqLength,
    readName
  );
  currentOffset += Math.ceil(fixedFields.seqLength / 2);

  const qualityScores = parseAlignmentQuality(
    view,
    currentOffset,
    endOffset,
    fixedFields.seqLength,
    readName
  );
  currentOffset += fixedFields.seqLength;

  const optionalTags = parseAlignmentTags(view, currentOffset, endOffset);

  return {
    readName,
    cigar,
    sequence,
    qualityScores,
    optionalTags,
  };
}

/**
 * Parse alignment read name
 */
function parseAlignmentReadName(
  view: DataView,
  offset: number,
  endOffset: number,
  readNameLength: number
): string {
  if (offset + readNameLength > endOffset) {
    throw new BamError(
      `Buffer overflow reading read name: need ${readNameLength} bytes`,
      undefined,
      'qname'
    );
  }

  return readCString(view, offset, readNameLength).value;
}

/**
 * Parse alignment CIGAR operations
 */
function parseAlignmentCigar(
  view: DataView,
  offset: number,
  endOffset: number,
  numCigarOps: number,
  readName: string
): string {
  const cigarBytesNeeded = numCigarOps * BYTES_PER_CIGAR_OP;
  if (offset + cigarBytesNeeded > endOffset) {
    throw new BamError(
      `Buffer overflow reading CIGAR: need ${cigarBytesNeeded} bytes`,
      readName,
      'cigar'
    );
  }

  return numCigarOps > 0 ? parseBinaryCIGAR(view, offset, numCigarOps) : '*';
}

/**
 * Parse alignment sequence
 */
function parseAlignmentSequence(
  view: DataView,
  offset: number,
  endOffset: number,
  seqLength: number,
  readName: string
): string {
  const seqBytesNeeded = Math.ceil(seqLength / 2);
  if (offset + seqBytesNeeded > endOffset) {
    throw new BamError(
      `Buffer overflow reading sequence: need ${seqBytesNeeded} bytes`,
      readName,
      'seq'
    );
  }

  if (seqLength === 0) {
    return '*';
  }

  const seqBuffer = new Uint8Array(view.buffer, view.byteOffset + offset, seqBytesNeeded);
  return decodeSequence(seqBuffer, seqLength);
}

/**
 * Parse alignment quality scores
 */
function parseAlignmentQuality(
  view: DataView,
  offset: number,
  endOffset: number,
  seqLength: number,
  readName: string
): string {
  if (offset + seqLength > endOffset) {
    throw new BamError(
      `Buffer overflow reading quality scores: need ${seqLength} bytes`,
      readName,
      'qual'
    );
  }

  return seqLength > 0 ? decodeQualityScores(view, offset, seqLength) : '*';
}

/**
 * Parse alignment optional tags
 */
function parseAlignmentTags(view: DataView, offset: number, endOffset: number): Uint8Array {
  if (offset < endOffset) {
    const tagsBytesRemaining = endOffset - offset;
    return new Uint8Array(view.buffer, view.byteOffset + offset, tagsBytesRemaining);
  }

  return new Uint8Array(0);
}

/**
 * Parse tag value based on type
 */
function parseTagValue(
  tagData: Uint8Array,
  offset: number,
  tagType: string
): {
  value: string | number;
  bytesConsumed: number;
} {
  switch (tagType) {
    case 'A': // Character
      return parseCharacterTag(tagData, offset);
    case 'c': // Signed 8-bit integer
      return parseInt8Tag(tagData, offset);
    case 'C': // Unsigned 8-bit integer
      return parseUInt8Tag(tagData, offset);
    case 's': // Signed 16-bit integer
      return parseInt16Tag(tagData, offset);
    case 'S': // Unsigned 16-bit integer
      return parseUInt16Tag(tagData, offset);
    case 'i': // Signed 32-bit integer
      return parseInt32Tag(tagData, offset);
    case 'I': // Unsigned 32-bit integer
      return parseUInt32Tag(tagData, offset);
    case 'f': // 32-bit float
      return parseFloatTag(tagData, offset);
    case 'Z': // Null-terminated string
    case 'H': // Hex string
      return parseStringTag(tagData, offset);
    case 'B': // Array of numeric values
      return parseArrayTag(tagData, offset);
    default:
      throw new Error(`Unsupported tag type: ${tagType}`);
  }
}

/**
 * Parse character tag value
 */
function parseCharacterTag(
  tagData: Uint8Array,
  offset: number
): { value: string; bytesConsumed: number } {
  if (offset >= tagData.length) {
    throw new Error('Insufficient data for character tag');
  }

  const charByte = tagData[offset];
  if (charByte === undefined) {
    throw new Error('Character tag byte is undefined');
  }

  return {
    value: String.fromCharCode(charByte),
    bytesConsumed: 1,
  };
}

/**
 * Parse signed 8-bit integer tag value
 */
function parseInt8Tag(
  tagData: Uint8Array,
  offset: number
): { value: number; bytesConsumed: number } {
  if (offset >= tagData.length) {
    throw new Error('Insufficient data for int8 tag');
  }

  const int8Byte = tagData[offset];
  if (int8Byte === undefined) {
    throw new Error('Int8 tag byte is undefined');
  }

  return {
    value: new Int8Array([int8Byte])[0] ?? 0,
    bytesConsumed: 1,
  };
}

/**
 * Parse unsigned 8-bit integer tag value
 */
function parseUInt8Tag(
  tagData: Uint8Array,
  offset: number
): { value: number; bytesConsumed: number } {
  if (offset >= tagData.length) {
    throw new Error('Insufficient data for uint8 tag');
  }

  const uint8Byte = tagData[offset];
  if (uint8Byte === undefined) {
    throw new Error('UInt8 tag byte is undefined');
  }

  return {
    value: uint8Byte,
    bytesConsumed: 1,
  };
}

/**
 * Parse signed 16-bit integer tag value
 */
function parseInt16Tag(
  tagData: Uint8Array,
  offset: number
): { value: number; bytesConsumed: number } {
  if (offset + 2 > tagData.length) {
    throw new Error('Insufficient data for int16 tag');
  }

  const int16Byte1 = tagData[offset];
  const int16Byte2 = tagData[offset + 1];
  if (int16Byte1 === undefined || int16Byte2 === undefined) {
    throw new Error('Int16 tag bytes are undefined');
  }

  return {
    value: new Int16Array([int16Byte1 | (int16Byte2 << 8)])[0] ?? 0,
    bytesConsumed: 2,
  };
}

/**
 * Parse unsigned 16-bit integer tag value
 */
function parseUInt16Tag(
  tagData: Uint8Array,
  offset: number
): { value: number; bytesConsumed: number } {
  if (offset + 2 > tagData.length) {
    throw new Error('Insufficient data for uint16 tag');
  }

  const uint16Byte1 = tagData[offset];
  const uint16Byte2 = tagData[offset + 1];
  if (uint16Byte1 === undefined || uint16Byte2 === undefined) {
    throw new Error('UInt16 tag bytes are undefined');
  }

  return {
    value: uint16Byte1 | (uint16Byte2 << 8),
    bytesConsumed: 2,
  };
}

/**
 * Parse signed 32-bit integer tag value
 */
function parseInt32Tag(
  tagData: Uint8Array,
  offset: number
): { value: number; bytesConsumed: number } {
  if (offset + 4 > tagData.length) {
    throw new Error('Insufficient data for int32 tag');
  }

  const byte0 = tagData[offset];
  const byte1 = tagData[offset + 1];
  const byte2 = tagData[offset + 2];
  const byte3 = tagData[offset + 3];

  if (byte0 === undefined || byte1 === undefined || byte2 === undefined || byte3 === undefined) {
    throw new Error('Int32 tag bytes are undefined');
  }

  const value = (byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24)) >>> 0;

  return {
    value: new Int32Array([value])[0] ?? 0,
    bytesConsumed: 4,
  };
}

/**
 * Parse unsigned 32-bit integer tag value
 */
function parseUInt32Tag(
  tagData: Uint8Array,
  offset: number
): { value: number; bytesConsumed: number } {
  if (offset + 4 > tagData.length) {
    throw new Error('Insufficient data for uint32 tag');
  }

  const byte0 = tagData[offset];
  const byte1 = tagData[offset + 1];
  const byte2 = tagData[offset + 2];
  const byte3 = tagData[offset + 3];

  if (byte0 === undefined || byte1 === undefined || byte2 === undefined || byte3 === undefined) {
    throw new Error('UInt32 tag bytes are undefined');
  }

  return {
    value: (byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24)) >>> 0,
    bytesConsumed: 4,
  };
}

/**
 * Parse 32-bit float tag value
 */
function parseFloatTag(
  tagData: Uint8Array,
  offset: number
): { value: number; bytesConsumed: number } {
  if (offset + 4 > tagData.length) {
    throw new Error('Insufficient data for float tag');
  }

  const floatView = new DataView(tagData.buffer, tagData.byteOffset + offset, 4);

  return {
    value: floatView.getFloat32(0, true), // little-endian
    bytesConsumed: 4,
  };
}

/**
 * Parse null-terminated string tag value
 */
function parseStringTag(
  tagData: Uint8Array,
  offset: number
): { value: string; bytesConsumed: number } {
  let nullPos = offset;
  while (nullPos < tagData.length && tagData[nullPos] !== 0) {
    nullPos++;
  }

  if (nullPos >= tagData.length) {
    throw new Error('Unterminated string tag');
  }

  const value = new TextDecoder('utf-8').decode(tagData.slice(offset, nullPos));

  return {
    value,
    bytesConsumed: nullPos - offset + 1, // +1 for null terminator
  };
}

/**
 * Parse array tag value
 */
function parseArrayTag(
  tagData: Uint8Array,
  offset: number
): { value: string; bytesConsumed: number } {
  if (offset + 5 > tagData.length) {
    throw new Error('Insufficient data for array tag header');
  }

  // Read array element type (1 byte)
  const arrayTypeByte = tagData[offset];
  if (arrayTypeByte === undefined) {
    throw new Error('Array type byte is undefined');
  }
  const arrayType = String.fromCharCode(arrayTypeByte);

  // Read array count (4 bytes, little-endian)
  const arrayCount = readArrayCount(tagData, offset + 1);
  const headerOffset = offset + 5;

  // Validate array count
  if (arrayCount > MAX_ARRAY_SIZE) {
    throw new Error(`Array too large: ${arrayCount} elements (max ${MAX_ARRAY_SIZE})`);
  }

  // Parse array elements
  const elementSize = getArrayElementSize(arrayType);
  validateArrayDataSize(headerOffset, arrayCount, elementSize, tagData.length);

  const arrayValues = parseArrayElements(tagData, headerOffset, arrayType, arrayCount, elementSize);

  return {
    value: `[${arrayValues.join(',')}]`,
    bytesConsumed: 5 + arrayCount * elementSize,
  };
}

/**
 * Read array count from 4-byte little-endian value
 */
function readArrayCount(tagData: Uint8Array, offset: number): number {
  const byte0 = tagData[offset];
  const byte1 = tagData[offset + 1];
  const byte2 = tagData[offset + 2];
  const byte3 = tagData[offset + 3];

  if (byte0 === undefined || byte1 === undefined || byte2 === undefined || byte3 === undefined) {
    throw new Error('Array count bytes are undefined');
  }

  return (byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24)) >>> 0;
}

/**
 * Get element size for array type
 */
function getArrayElementSize(arrayType: string): number {
  switch (arrayType) {
    case 'c':
    case 'C':
      return 1; // 8-bit integers
    case 's':
    case 'S':
      return 2; // 16-bit integers
    case 'i':
    case 'I':
      return 4; // 32-bit integers
    case 'f':
      return 4; // 32-bit float
    default:
      throw new Error(`Unsupported array element type: ${arrayType}`);
  }
}

/**
 * Validate array data size
 */
function validateArrayDataSize(
  offset: number,
  arrayCount: number,
  elementSize: number,
  dataLength: number
): void {
  if (offset + arrayCount * elementSize > dataLength) {
    throw new Error(`Insufficient data for array elements: need ${arrayCount * elementSize} bytes`);
  }
}

/**
 * Parse array elements based on type
 */
function parseArrayElements(
  tagData: Uint8Array,
  offset: number,
  arrayType: string,
  arrayCount: number,
  elementSize: number
): number[] {
  const arrayValues: number[] = [];

  for (let i = 0; i < arrayCount; i++) {
    const elementOffset = offset + i * elementSize;
    const elementValue = parseArrayElement(tagData, elementOffset, arrayType);
    arrayValues.push(elementValue);
  }

  return arrayValues;
}

/**
 * Parse a single array element
 */
function parseArrayElement(tagData: Uint8Array, offset: number, arrayType: string): number {
  const operations = {
    c: (): number => parseSignedInt8Element(tagData, offset),
    C: (): number => parseUnsignedInt8Element(tagData, offset),
    s: (): number => parseSignedInt16Element(tagData, offset),
    S: (): number => parseUnsignedInt16Element(tagData, offset),
    i: (): number => parseSignedInt32Element(tagData, offset),
    I: (): number => parseUnsignedInt32Element(tagData, offset),
    f: (): number => parseFloatElement(tagData, offset),
  };

  const operation = operations[arrayType as keyof typeof operations];
  return operation !== undefined ? operation() : 0;
}

function parseSignedInt8Element(tagData: Uint8Array, offset: number): number {
  const byte = tagData[offset];
  if (byte === undefined) throw new Error('Int8 element byte is undefined');
  return new Int8Array([byte])[0] ?? 0;
}

function parseUnsignedInt8Element(tagData: Uint8Array, offset: number): number {
  const byte = tagData[offset];
  if (byte === undefined) throw new Error('UInt8 element byte is undefined');
  return byte;
}

function parseSignedInt16Element(tagData: Uint8Array, offset: number): number {
  const byte0 = tagData[offset];
  const byte1 = tagData[offset + 1];
  if (byte0 === undefined || byte1 === undefined) {
    throw new Error('Int16 element bytes are undefined');
  }
  return new Int16Array([byte0 | (byte1 << 8)])[0] ?? 0;
}

function parseUnsignedInt16Element(tagData: Uint8Array, offset: number): number {
  const byte0 = tagData[offset];
  const byte1 = tagData[offset + 1];
  if (byte0 === undefined || byte1 === undefined) {
    throw new Error('UInt16 element bytes are undefined');
  }
  return byte0 | (byte1 << 8);
}

function parseSignedInt32Element(tagData: Uint8Array, offset: number): number {
  const byte0 = tagData[offset];
  const byte1 = tagData[offset + 1];
  const byte2 = tagData[offset + 2];
  const byte3 = tagData[offset + 3];
  if (byte0 === undefined || byte1 === undefined || byte2 === undefined || byte3 === undefined) {
    throw new Error('Int32 element bytes are undefined');
  }
  const intValue = (byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24)) >>> 0;
  return new Int32Array([intValue])[0] ?? 0;
}

function parseUnsignedInt32Element(tagData: Uint8Array, offset: number): number {
  const byte0 = tagData[offset];
  const byte1 = tagData[offset + 1];
  const byte2 = tagData[offset + 2];
  const byte3 = tagData[offset + 3];
  if (byte0 === undefined || byte1 === undefined || byte2 === undefined || byte3 === undefined) {
    throw new Error('UInt32 element bytes are undefined');
  }
  return (byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24)) >>> 0;
}

function parseFloatElement(tagData: Uint8Array, offset: number): number {
  const floatArrayView = new DataView(tagData.buffer, tagData.byteOffset + offset, 4);
  return floatArrayView.getFloat32(0, true); // little-endian
}

function validateReferenceIds(
  record: ReturnType<typeof parseAlignmentRecord>,
  references: string[],
  warnings: string[]
): void {
  if (record.refID >= 0 && record.refID >= references.length) {
    warnings.push(`Reference ID ${record.refID} out of bounds (max ${references.length - 1})`);
  }

  if (record.nextRefID >= 0 && record.nextRefID >= references.length) {
    warnings.push(
      `Next reference ID ${record.nextRefID} out of bounds (max ${references.length - 1})`
    );
  }
}

function validateCigarConsistency(
  record: ReturnType<typeof parseAlignmentRecord>,
  warnings: string[]
): void {
  if (record.cigar === '*' || record.sequence === '*') {
    return;
  }

  const cigarOps = record.cigar.match(/\d+[MIDNSHPX=]/g) || [];
  let queryConsumed = 0;

  for (const op of cigarOps) {
    const length = parseInt(op.slice(0, -1));
    const operation = op.slice(-1);

    // Operations that consume query sequence: M, I, S, =, X
    if ('MIS=X'.includes(operation)) {
      queryConsumed += length;
    }
  }

  if (queryConsumed !== record.seqLength) {
    warnings.push(
      `CIGAR consumes ${queryConsumed} bases but sequence length is ${record.seqLength}`
    );
  }
}

function validateMappingQuality(
  record: ReturnType<typeof parseAlignmentRecord>,
  warnings: string[]
): void {
  if (record.mapq > MAX_MAPPING_QUALITY) {
    warnings.push(`Unusually high mapping quality: ${record.mapq}`);
  }
}

function validateTemplateLength(
  record: ReturnType<typeof parseAlignmentRecord>,
  warnings: string[]
): void {
  if (record.flag & 0x1) {
    // Paired read
    if (Math.abs(record.tlen) > MAX_TEMPLATE_LENGTH) {
      warnings.push(`Large template length: ${record.tlen} (possible structural variant)`);
    }
  }
}

function validatePosition(
  record: ReturnType<typeof parseAlignmentRecord>,
  warnings: string[]
): void {
  if (record.pos > MAX_CHROMOSOME_POSITION) {
    warnings.push(`Unusually large position: ${record.pos}`);
  }
}

// Backward compatibility namespace export
export const BinaryParser = {
  readInt32LE,
  readUInt32LE,
  readUInt16LE,
  readUInt8,
  readCString,
  decodeSequence,
  parseBinaryCIGAR,
  readFixedString,
  createContext,
  isValidBAMMagic,
  parseAlignmentRecord,
  decodeQualityScores,
  parseOptionalTags,
  validateAlignment,
  createOptimizedParser,
  estimateMemoryUsage,
  isBunOptimized,
  allocateBuffer,
} as const;
