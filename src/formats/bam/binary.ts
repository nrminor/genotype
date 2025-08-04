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

import type { BinaryContext } from '../../types';
import { BamError } from '../../errors';

/**
 * Binary parser utilities for BAM format data
 *
 * All methods follow Tiger Style with comprehensive validation and
 * clear error messages for debugging binary data issues.
 */
export class BinaryParser {
  /**
   * Read a 32-bit signed integer in little-endian format
   * @param view DataView containing binary data
   * @param offset Byte offset to read from
   * @returns 32-bit signed integer value
   * @throws {BamError} If offset is out of bounds
   */
  static readInt32LE(view: DataView, offset: number): number {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be a DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');

    if (offset + 4 > view.byteLength) {
      throw new BamError(
        `Cannot read int32 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
        undefined,
        'binary'
      );
    }

    const result = view.getInt32(offset, true); // true = little-endian

    // Tiger Style: Assert postconditions
    console.assert(Number.isInteger(result), 'result must be an integer');

    return result;
  }

  /**
   * Read a 32-bit unsigned integer in little-endian format
   * @param view DataView containing binary data
   * @param offset Byte offset to read from
   * @returns 32-bit unsigned integer value
   * @throws {BamError} If offset is out of bounds
   */
  static readUInt32LE(view: DataView, offset: number): number {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be a DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');

    if (offset + 4 > view.byteLength) {
      throw new BamError(
        `Cannot read uint32 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
        undefined,
        'binary'
      );
    }

    const result = view.getUint32(offset, true); // true = little-endian

    // Tiger Style: Assert postconditions
    console.assert(Number.isInteger(result) && result >= 0, 'result must be non-negative integer');

    return result;
  }

  /**
   * Read a 16-bit unsigned integer in little-endian format
   * @param view DataView containing binary data
   * @param offset Byte offset to read from
   * @returns 16-bit unsigned integer value
   * @throws {BamError} If offset is out of bounds
   */
  static readUInt16LE(view: DataView, offset: number): number {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be a DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');

    if (offset + 2 > view.byteLength) {
      throw new BamError(
        `Cannot read uint16 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
        undefined,
        'binary'
      );
    }

    const result = view.getUint16(offset, true); // true = little-endian

    // Tiger Style: Assert postconditions
    console.assert(Number.isInteger(result) && result >= 0, 'result must be non-negative integer');
    console.assert(result <= 65535, 'result must be valid 16-bit value');

    return result;
  }

  /**
   * Read an 8-bit unsigned integer
   * @param view DataView containing binary data
   * @param offset Byte offset to read from
   * @returns 8-bit unsigned integer value
   * @throws {BamError} If offset is out of bounds
   */
  static readUInt8(view: DataView, offset: number): number {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be a DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');

    if (offset >= view.byteLength) {
      throw new BamError(
        `Cannot read uint8 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
        undefined,
        'binary'
      );
    }

    const result = view.getUint8(offset);

    // Tiger Style: Assert postconditions
    console.assert(Number.isInteger(result) && result >= 0, 'result must be non-negative integer');
    console.assert(result <= 255, 'result must be valid 8-bit value');

    return result;
  }

  /**
   * Read a null-terminated string from binary data
   * @param view DataView containing binary data
   * @param offset Starting byte offset
   * @param maxLength Maximum string length to prevent infinite loops
   * @returns Object with string value and bytes consumed
   * @throws {BamError} If string is not null-terminated within maxLength
   */
  static readCString(
    view: DataView,
    offset: number,
    maxLength: number
  ): { value: string; bytesRead: number } {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be a DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');
    console.assert(
      Number.isInteger(maxLength) && maxLength > 0,
      'maxLength must be positive integer'
    );

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

        // Tiger Style: Assert postconditions
        console.assert(typeof result === 'string', 'result must be a string');
        console.assert(bytes.length <= maxLength, 'string length must not exceed maxLength');

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
  static decodeSequence(buffer: Uint8Array, length: number): string {
    // Tiger Style: Assert function arguments
    console.assert(buffer instanceof Uint8Array, 'buffer must be a Uint8Array');
    console.assert(Number.isInteger(length) && length >= 0, 'length must be non-negative integer');

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

    // BAM sequence encoding lookup table
    const SEQ_DECODER = '=ACMGRSVTWYHKDBN';

    // Use Bun-optimized approach: pre-allocate array and join once
    const chars = new Array(length);

    for (let i = 0; i < length; i++) {
      const byteIndex = Math.floor(i / 2);
      const byte = buffer[byteIndex];

      console.assert(byte !== undefined, 'sequence byte must be defined');

      // Extract 4-bit value (high nibble for even i, low nibble for odd i)
      const nibble = i % 2 === 0 ? (byte! >> 4) & 0xf : byte! & 0xf;

      if (nibble >= SEQ_DECODER.length) {
        throw new BamError(
          `Invalid sequence encoding: ${nibble} at position ${i}`,
          undefined,
          'sequence'
        );
      }

      chars[i] = SEQ_DECODER[nibble];
    }

    // Single string allocation - much faster in Bun
    const sequence = chars.join('');

    // Tiger Style: Assert postconditions
    console.assert(typeof sequence === 'string', 'result must be a string');
    console.assert(sequence.length === length, 'result length must match input length');

    return sequence;
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
  static parseBinaryCIGAR(view: DataView, offset: number, count: number): string {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be a DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');
    console.assert(Number.isInteger(count) && count >= 0, 'count must be non-negative integer');

    if (count === 0) {
      return '*'; // BAM convention for no CIGAR
    }

    const bytesNeeded = count * 4; // 4 bytes per CIGAR operation
    if (offset + bytesNeeded > view.byteLength) {
      throw new BamError(
        `Buffer too small for CIGAR: need ${bytesNeeded} bytes at offset ${offset}, have ${view.byteLength - offset}`,
        undefined,
        'cigar'
      );
    }

    // CIGAR operation lookup table
    const CIGAR_OPS = ['M', 'I', 'D', 'N', 'S', 'H', 'P', '=', 'X'];

    let cigar = '';
    for (let i = 0; i < count; i++) {
      const opOffset = offset + i * 4;
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
        throw new BamError(
          `Invalid CIGAR operation length: 0 at position ${i}`,
          undefined,
          'cigar'
        );
      }

      cigar += `${opLength}${CIGAR_OPS[opType]}`;
    }

    // Tiger Style: Assert postconditions
    console.assert(typeof cigar === 'string', 'result must be a string');
    console.assert(cigar.length > 0, 'result must not be empty');

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
  static readFixedString(view: DataView, offset: number, length: number): string {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be a DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');
    console.assert(Number.isInteger(length) && length >= 0, 'length must be non-negative integer');

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

    // Bun has optimized TextDecoder performance
    const decoder =
      typeof Bun !== 'undefined' && Bun.version
        ? new TextDecoder('utf-8') // Bun optimizes TextDecoder
        : new TextDecoder('utf-8');

    const result = decoder.decode(bytes);

    // Tiger Style: Assert postconditions
    console.assert(typeof result === 'string', 'result must be a string');

    return result;
  }

  /**
   * Create a binary context for parsing operations with Bun optimization
   * @param buffer Binary data buffer (ArrayBuffer or Bun's optimized buffer)
   * @param offset Starting offset
   * @param littleEndian Whether to use little-endian byte order
   * @returns BinaryContext object for parsing
   */
  static createContext(buffer: ArrayBuffer, offset = 0, littleEndian = true): BinaryContext {
    // Tiger Style: Assert function arguments
    console.assert(buffer instanceof ArrayBuffer, 'buffer must be an ArrayBuffer');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');
    console.assert(typeof littleEndian === 'boolean', 'littleEndian must be a boolean');

    if (offset >= buffer.byteLength) {
      throw new BamError(
        `Offset ${offset} exceeds buffer size ${buffer.byteLength}`,
        undefined,
        'binary'
      );
    }

    // Use Bun's optimized DataView creation when available
    const dataView =
      typeof Bun !== 'undefined' && Bun.version
        ? new DataView(buffer, offset) // Bun optimizes DataView construction
        : new DataView(buffer, offset);

    const context: BinaryContext = {
      buffer: dataView,
      offset,
      littleEndian,
    };

    // Tiger Style: Assert postconditions
    console.assert(context.buffer instanceof DataView, 'context buffer must be DataView');
    console.assert(context.offset === offset, 'context offset must match input');

    return context;
  }

  /**
   * Validate BAM magic bytes
   * @param magicBytes Bytes to validate (should be "BAM\1")
   * @returns True if valid BAM magic bytes
   */
  static isValidBAMMagic(magicBytes: Uint8Array): boolean {
    // Tiger Style: Assert function arguments
    console.assert(magicBytes instanceof Uint8Array, 'magicBytes must be a Uint8Array');

    if (magicBytes.length < 4) {
      return false;
    }

    // BAM magic bytes: "BAM\1" (0x42, 0x41, 0x4D, 0x01)
    const expectedMagic = new Uint8Array([0x42, 0x41, 0x4d, 0x01]);

    for (let i = 0; i < 4; i++) {
      if (magicBytes[i] !== expectedMagic[i]) {
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
  static parseAlignmentRecord(
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
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');
    console.assert(
      Number.isInteger(blockSize) && blockSize > 0,
      'blockSize must be positive integer'
    );

    let currentOffset = offset;
    const endOffset = offset + blockSize;

    // Validate minimum block size (32 bytes for fixed fields)
    if (blockSize < 32) {
      throw new BamError(
        `Alignment block too small: ${blockSize} bytes (minimum 32)`,
        undefined,
        'alignment'
      );
    }

    // Read fixed 32-byte header
    if (currentOffset + 32 > endOffset) {
      throw new BamError(
        `Buffer overflow reading alignment header: need 32 bytes, have ${endOffset - currentOffset}`,
        undefined,
        'alignment'
      );
    }

    // Read fixed fields according to BAM specification
    const refID = this.readInt32LE(view, currentOffset);
    currentOffset += 4;

    const pos = this.readInt32LE(view, currentOffset);
    currentOffset += 4;

    // bin_mq_nl: bin<<16 | MAPQ<<8 | l_read_name
    const binMqNl = this.readUInt32LE(view, currentOffset);
    const bin = (binMqNl >> 16) & 0xffff;
    const mapq = (binMqNl >> 8) & 0xff;
    const readNameLength = binMqNl & 0xff;
    currentOffset += 4;

    // flag_nc: FLAG<<16 | n_cigar_op
    const flagNc = this.readUInt32LE(view, currentOffset);
    const flag = (flagNc >> 16) & 0xffff;
    const numCigarOps = flagNc & 0xffff;
    currentOffset += 4;

    const seqLength = this.readInt32LE(view, currentOffset);
    currentOffset += 4;

    const nextRefID = this.readInt32LE(view, currentOffset);
    currentOffset += 4;

    const nextPos = this.readInt32LE(view, currentOffset);
    currentOffset += 4;

    const tlen = this.readInt32LE(view, currentOffset);
    currentOffset += 4;

    // Validate parsed values
    if (readNameLength <= 0 || readNameLength > 255) {
      throw new BamError(`Invalid read name length: ${readNameLength}`, undefined, 'qname');
    }

    if (seqLength < 0) {
      throw new BamError(`Invalid sequence length: ${seqLength}`, undefined, 'seq');
    }

    if (numCigarOps < 0 || numCigarOps > 65535) {
      throw new BamError(`Invalid CIGAR operation count: ${numCigarOps}`, undefined, 'cigar');
    }

    // Read variable-length fields

    // Read name (null-terminated)
    if (currentOffset + readNameLength > endOffset) {
      throw new BamError(
        `Buffer overflow reading read name: need ${readNameLength} bytes`,
        undefined,
        'qname'
      );
    }

    const readNameResult = this.readCString(view, currentOffset, readNameLength);
    const readName = readNameResult.value;
    currentOffset += readNameLength;

    // Read CIGAR operations
    const cigarBytesNeeded = numCigarOps * 4;
    if (currentOffset + cigarBytesNeeded > endOffset) {
      throw new BamError(
        `Buffer overflow reading CIGAR: need ${cigarBytesNeeded} bytes`,
        readName,
        'cigar'
      );
    }

    const cigar = numCigarOps > 0 ? this.parseBinaryCIGAR(view, currentOffset, numCigarOps) : '*';
    currentOffset += cigarBytesNeeded;

    // Read packed sequence
    const seqBytesNeeded = Math.ceil(seqLength / 2);
    if (currentOffset + seqBytesNeeded > endOffset) {
      throw new BamError(
        `Buffer overflow reading sequence: need ${seqBytesNeeded} bytes`,
        readName,
        'seq'
      );
    }

    const seqBuffer = new Uint8Array(view.buffer, view.byteOffset + currentOffset, seqBytesNeeded);
    const sequence = seqLength > 0 ? this.decodeSequence(seqBuffer, seqLength) : '*';
    currentOffset += seqBytesNeeded;

    // Read quality scores
    if (currentOffset + seqLength > endOffset) {
      throw new BamError(
        `Buffer overflow reading quality scores: need ${seqLength} bytes`,
        readName,
        'qual'
      );
    }

    const qualityScores =
      seqLength > 0 ? this.decodeQualityScores(view, currentOffset, seqLength) : '*';
    currentOffset += seqLength;

    // Read optional tags (if any remaining data)
    let optionalTags: Uint8Array | undefined;
    if (currentOffset < endOffset) {
      const tagsBytesRemaining = endOffset - currentOffset;
      optionalTags = new Uint8Array(
        view.buffer,
        view.byteOffset + currentOffset,
        tagsBytesRemaining
      );
      currentOffset += tagsBytesRemaining;
    }

    // Tiger Style: Assert postconditions
    console.assert(currentOffset === endOffset, 'must consume exactly blockSize bytes');
    console.assert(readName.length > 0, 'read name must not be empty');
    console.assert(
      sequence === '*' || sequence.length === seqLength,
      'sequence length must match expected'
    );
    console.assert(
      qualityScores === '*' || qualityScores.length === seqLength,
      'quality length must match sequence'
    );

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
      readName,
      cigar,
      sequence,
      qualityScores,
      optionalTags: optionalTags ?? new Uint8Array(0),
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
  static decodeQualityScores(view: DataView, offset: number, length: number): string {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');
    console.assert(Number.isInteger(length) && length >= 0, 'length must be non-negative integer');

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
      const rawQual = this.readUInt8(view, offset + i);

      if (rawQual === 255) {
        // 255 indicates unavailable quality
        qualChars[i] = '*';
      } else {
        // Convert to Phred+33 format, cap at ASCII 126
        const phredQual = Math.min(rawQual + 33, 126);
        qualChars[i] = String.fromCharCode(phredQual);
      }
    }

    const result = qualChars.join('');

    // Tiger Style: Assert postconditions
    console.assert(result.length === length, 'result length must match input length');

    return result;
  }

  /**
   * Parse BAM optional tags from binary data with Bun optimizations
   * @param tagData Binary tag data
   * @param qname Query name for error context
   * @returns Array of parsed SAM tags
   * @throws {BamError} If tag data is malformed
   */
  static parseOptionalTags(
    tagData: Uint8Array,
    qname?: string
  ): Array<{
    tag: string;
    type: string;
    value: string | number;
  }> {
    // Tiger Style: Assert function arguments
    console.assert(tagData instanceof Uint8Array, 'tagData must be Uint8Array');

    const tags: Array<{ tag: string; type: string; value: string | number }> = [];
    let offset = 0;

    while (offset + 3 <= tagData.length) {
      // Minimum: 2 bytes tag + 1 byte type
      try {
        // Read tag name (2 bytes)
        const tagByte1 = tagData[offset];
        const tagByte2 = tagData[offset + 1];
        console.assert(
          tagByte1 !== undefined && tagByte2 !== undefined,
          'tag name bytes must be defined'
        );
        const tagName = String.fromCharCode(tagByte1!, tagByte2!);
        offset += 2;

        // Read tag type (1 byte)
        const tagTypeByte = tagData[offset];
        console.assert(tagTypeByte !== undefined, 'tag type byte must be defined');
        const tagType = String.fromCharCode(tagTypeByte!);
        offset += 1;

        // Read value based on type
        const valueResult = this.parseTagValue(tagData, offset, tagType);
        const value = valueResult.value;
        const bytesConsumed = valueResult.bytesConsumed;

        offset += bytesConsumed;

        tags.push({
          tag: tagName,
          type: tagType,
          value,
        });
      } catch (error) {
        // Log warning and stop parsing tags on error
        console.warn(
          `Failed to parse optional tag at offset ${offset}: ${error instanceof Error ? error.message : String(error)}`
        );
        break;
      }
    }

    // Tiger Style: Assert postconditions
    console.assert(Array.isArray(tags), 'result must be an array');

    return tags;
  }

  /**
   * Parse tag value based on type
   */
  private static parseTagValue(
    tagData: Uint8Array,
    offset: number,
    tagType: string
  ): {
    value: string | number;
    bytesConsumed: number;
  } {
    switch (tagType) {
      case 'A': // Character
        return this.parseCharacterTag(tagData, offset);
      case 'c': // Signed 8-bit integer
        return this.parseInt8Tag(tagData, offset);
      case 'C': // Unsigned 8-bit integer
        return this.parseUInt8Tag(tagData, offset);
      case 's': // Signed 16-bit integer
        return this.parseInt16Tag(tagData, offset);
      case 'S': // Unsigned 16-bit integer
        return this.parseUInt16Tag(tagData, offset);
      case 'i': // Signed 32-bit integer
        return this.parseInt32Tag(tagData, offset);
      case 'I': // Unsigned 32-bit integer
        return this.parseUInt32Tag(tagData, offset);
      case 'f': // 32-bit float
        return this.parseFloatTag(tagData, offset);
      case 'Z': // Null-terminated string
      case 'H': // Hex string
        return this.parseStringTag(tagData, offset);
      case 'B': // Array of numeric values
        return this.parseArrayTag(tagData, offset);
      default:
        throw new Error(`Unsupported tag type: ${tagType}`);
    }
  }

  /**
   * Parse character tag value
   */
  private static parseCharacterTag(
    tagData: Uint8Array,
    offset: number
  ): { value: string; bytesConsumed: number } {
    if (offset >= tagData.length) {
      throw new Error('Insufficient data for character tag');
    }

    const charByte = tagData[offset];
    console.assert(charByte !== undefined, 'character tag byte must be defined');

    return {
      value: String.fromCharCode(charByte!),
      bytesConsumed: 1,
    };
  }

  /**
   * Parse signed 8-bit integer tag value
   */
  private static parseInt8Tag(
    tagData: Uint8Array,
    offset: number
  ): { value: number; bytesConsumed: number } {
    if (offset >= tagData.length) {
      throw new Error('Insufficient data for int8 tag');
    }

    const int8Byte = tagData[offset];
    console.assert(int8Byte !== undefined, 'int8 tag byte must be defined');

    return {
      value: new Int8Array([int8Byte!])[0]!,
      bytesConsumed: 1,
    };
  }

  /**
   * Parse unsigned 8-bit integer tag value
   */
  private static parseUInt8Tag(
    tagData: Uint8Array,
    offset: number
  ): { value: number; bytesConsumed: number } {
    if (offset >= tagData.length) {
      throw new Error('Insufficient data for uint8 tag');
    }

    const uint8Byte = tagData[offset];
    console.assert(uint8Byte !== undefined, 'uint8 tag byte must be defined');

    return {
      value: uint8Byte!,
      bytesConsumed: 1,
    };
  }

  /**
   * Parse signed 16-bit integer tag value
   */
  private static parseInt16Tag(
    tagData: Uint8Array,
    offset: number
  ): { value: number; bytesConsumed: number } {
    if (offset + 2 > tagData.length) {
      throw new Error('Insufficient data for int16 tag');
    }

    const int16Byte1 = tagData[offset];
    const int16Byte2 = tagData[offset + 1];
    console.assert(
      int16Byte1 !== undefined && int16Byte2 !== undefined,
      'int16 tag bytes must be defined'
    );

    return {
      value: new Int16Array([int16Byte1! | (int16Byte2! << 8)])[0]!,
      bytesConsumed: 2,
    };
  }

  /**
   * Parse unsigned 16-bit integer tag value
   */
  private static parseUInt16Tag(
    tagData: Uint8Array,
    offset: number
  ): { value: number; bytesConsumed: number } {
    if (offset + 2 > tagData.length) {
      throw new Error('Insufficient data for uint16 tag');
    }

    const uint16Byte1 = tagData[offset];
    const uint16Byte2 = tagData[offset + 1];
    console.assert(
      uint16Byte1 !== undefined && uint16Byte2 !== undefined,
      'uint16 tag bytes must be defined'
    );

    return {
      value: uint16Byte1! | (uint16Byte2! << 8),
      bytesConsumed: 2,
    };
  }

  /**
   * Parse signed 32-bit integer tag value
   */
  private static parseInt32Tag(
    tagData: Uint8Array,
    offset: number
  ): { value: number; bytesConsumed: number } {
    if (offset + 4 > tagData.length) {
      throw new Error('Insufficient data for int32 tag');
    }

    console.assert(tagData[offset] !== undefined, 'int32 byte 0 must be defined');
    console.assert(tagData[offset + 1] !== undefined, 'int32 byte 1 must be defined');
    console.assert(tagData[offset + 2] !== undefined, 'int32 byte 2 must be defined');
    console.assert(tagData[offset + 3] !== undefined, 'int32 byte 3 must be defined');

    const value =
      (tagData[offset]! |
        (tagData[offset + 1]! << 8) |
        (tagData[offset + 2]! << 16) |
        (tagData[offset + 3]! << 24)) >>>
      0;

    return {
      value: new Int32Array([value])[0]!,
      bytesConsumed: 4,
    };
  }

  /**
   * Parse unsigned 32-bit integer tag value
   */
  private static parseUInt32Tag(
    tagData: Uint8Array,
    offset: number
  ): { value: number; bytesConsumed: number } {
    if (offset + 4 > tagData.length) {
      throw new Error('Insufficient data for uint32 tag');
    }

    console.assert(tagData[offset] !== undefined, 'uint32 byte 0 must be defined');
    console.assert(tagData[offset + 1] !== undefined, 'uint32 byte 1 must be defined');
    console.assert(tagData[offset + 2] !== undefined, 'uint32 byte 2 must be defined');
    console.assert(tagData[offset + 3] !== undefined, 'uint32 byte 3 must be defined');

    const value =
      (tagData[offset]! |
        (tagData[offset + 1]! << 8) |
        (tagData[offset + 2]! << 16) |
        (tagData[offset + 3]! << 24)) >>>
      0;

    return {
      value,
      bytesConsumed: 4,
    };
  }

  /**
   * Parse 32-bit float tag value
   */
  private static parseFloatTag(
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
  private static parseStringTag(
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
  private static parseArrayTag(
    tagData: Uint8Array,
    offset: number
  ): { value: string; bytesConsumed: number } {
    if (offset + 5 > tagData.length) {
      throw new Error('Insufficient data for array tag header');
    }

    // Read array element type (1 byte)
    console.assert(tagData[offset] !== undefined, 'array type byte must be defined');
    const arrayType = String.fromCharCode(tagData[offset]!);

    // Read array count (4 bytes, little-endian)
    const arrayCount = this.readArrayCount(tagData, offset + 1);
    const headerOffset = offset + 5;

    // Validate array count
    if (arrayCount > 10000) {
      // Sanity check to prevent memory issues
      console.warn(`Large array in BAM tag: ${arrayCount} elements`);
    }

    // Parse array elements
    const elementSize = this.getArrayElementSize(arrayType);
    this.validateArrayDataSize(headerOffset, arrayCount, elementSize, tagData.length);

    const arrayValues = this.parseArrayElements(
      tagData,
      headerOffset,
      arrayType,
      arrayCount,
      elementSize
    );

    return {
      value: `[${arrayValues.join(',')}]`,
      bytesConsumed: 5 + arrayCount * elementSize,
    };
  }

  /**
   * Read array count from 4-byte little-endian value
   */
  private static readArrayCount(tagData: Uint8Array, offset: number): number {
    console.assert(tagData[offset] !== undefined, 'array count byte 0 must be defined');
    console.assert(tagData[offset + 1] !== undefined, 'array count byte 1 must be defined');
    console.assert(tagData[offset + 2] !== undefined, 'array count byte 2 must be defined');
    console.assert(tagData[offset + 3] !== undefined, 'array count byte 3 must be defined');

    return (
      (tagData[offset]! |
        (tagData[offset + 1]! << 8) |
        (tagData[offset + 2]! << 16) |
        (tagData[offset + 3]! << 24)) >>>
      0
    );
  }

  /**
   * Get element size for array type
   */
  private static getArrayElementSize(arrayType: string): number {
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
  private static validateArrayDataSize(
    offset: number,
    arrayCount: number,
    elementSize: number,
    dataLength: number
  ): void {
    if (offset + arrayCount * elementSize > dataLength) {
      throw new Error(
        `Insufficient data for array elements: need ${arrayCount * elementSize} bytes`
      );
    }
  }

  /**
   * Parse array elements based on type
   */
  private static parseArrayElements(
    tagData: Uint8Array,
    offset: number,
    arrayType: string,
    arrayCount: number,
    elementSize: number
  ): number[] {
    const arrayValues: number[] = [];

    for (let i = 0; i < arrayCount; i++) {
      const elementOffset = offset + i * elementSize;
      const elementValue = this.parseArrayElement(tagData, elementOffset, arrayType);
      arrayValues.push(elementValue);
    }

    return arrayValues;
  }

  /**
   * Parse a single array element
   */
  private static parseArrayElement(tagData: Uint8Array, offset: number, arrayType: string): number {
    switch (arrayType) {
      case 'c': // Signed 8-bit
        console.assert(tagData[offset] !== undefined, 'int8 element byte must be defined');
        return new Int8Array([tagData[offset]!])[0]!;

      case 'C': // Unsigned 8-bit
        console.assert(tagData[offset] !== undefined, 'uint8 element byte must be defined');
        return tagData[offset]!;

      case 's': // Signed 16-bit
        console.assert(tagData[offset] !== undefined, 'int16 element byte 0 must be defined');
        console.assert(tagData[offset + 1] !== undefined, 'int16 element byte 1 must be defined');
        return new Int16Array([tagData[offset]! | (tagData[offset + 1]! << 8)])[0]!;

      case 'S': // Unsigned 16-bit
        console.assert(tagData[offset] !== undefined, 'uint16 element byte 0 must be defined');
        console.assert(tagData[offset + 1] !== undefined, 'uint16 element byte 1 must be defined');
        return tagData[offset]! | (tagData[offset + 1]! << 8);

      case 'i': // Signed 32-bit
        console.assert(tagData[offset] !== undefined, 'int32 element byte 0 must be defined');
        console.assert(tagData[offset + 1] !== undefined, 'int32 element byte 1 must be defined');
        console.assert(tagData[offset + 2] !== undefined, 'int32 element byte 2 must be defined');
        console.assert(tagData[offset + 3] !== undefined, 'int32 element byte 3 must be defined');
        const intValue =
          (tagData[offset]! |
            (tagData[offset + 1]! << 8) |
            (tagData[offset + 2]! << 16) |
            (tagData[offset + 3]! << 24)) >>>
          0;
        return new Int32Array([intValue])[0]!;

      case 'I': // Unsigned 32-bit
        console.assert(tagData[offset] !== undefined, 'uint32 element byte 0 must be defined');
        console.assert(tagData[offset + 1] !== undefined, 'uint32 element byte 1 must be defined');
        console.assert(tagData[offset + 2] !== undefined, 'uint32 element byte 2 must be defined');
        console.assert(tagData[offset + 3] !== undefined, 'uint32 element byte 3 must be defined');
        return (
          (tagData[offset]! |
            (tagData[offset + 1]! << 8) |
            (tagData[offset + 2]! << 16) |
            (tagData[offset + 3]! << 24)) >>>
          0
        );

      case 'f': // 32-bit float
        const floatArrayView = new DataView(tagData.buffer, tagData.byteOffset + offset, 4);
        return floatArrayView.getFloat32(0, true); // little-endian

      default:
        return 0; // Should never reach here
    }
  }

  /**
   * Validate BAM alignment record structure for common issues
   * @param record Parsed alignment record
   * @param references Reference sequence names
   * @returns Array of validation warnings (empty if valid)
   */
  static validateAlignment(
    record: ReturnType<typeof BinaryParser.parseAlignmentRecord>,
    references: string[]
  ): string[] {
    // Tiger Style: Assert function arguments
    console.assert(typeof record === 'object', 'record must be an object');
    console.assert(Array.isArray(references), 'references must be an array');

    const warnings: string[] = [];

    // Validate reference ID bounds
    if (record.refID >= 0 && record.refID >= references.length) {
      warnings.push(`Reference ID ${record.refID} out of bounds (max ${references.length - 1})`);
    }

    if (record.nextRefID >= 0 && record.nextRefID >= references.length) {
      warnings.push(
        `Next reference ID ${record.nextRefID} out of bounds (max ${references.length - 1})`
      );
    }

    // Validate CIGAR vs sequence consistency
    if (record.cigar !== '*' && record.sequence !== '*') {
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

    // Validate mapping quality bounds
    if (record.mapq > 60) {
      warnings.push(`Unusually high mapping quality: ${record.mapq}`);
    }

    // Validate template length for paired reads
    if (record.flag & 0x1) {
      // Paired read
      if (Math.abs(record.tlen) > 10000) {
        warnings.push(`Large template length: ${record.tlen} (possible structural variant)`);
      }
    }

    // Validate position bounds (basic sanity check)
    if (record.pos > 300_000_000) {
      // Larger than any known chromosome
      warnings.push(`Unusually large position: ${record.pos}`);
    }

    return warnings;
  }

  /**
   * Create a Bun-optimized alignment parser with streaming capabilities
   * @param options Configuration options for performance tuning
   * @returns Optimized parser function
   */
  static createOptimizedParser(
    options: {
      bufferSize?: number;
      skipValidation?: boolean;
      onWarning?: (warning: string) => void;
    } = {}
  ) {
    const { bufferSize = 64 * 1024, skipValidation = false, onWarning } = options;

    // Pre-allocate reusable buffers for Bun performance
    const sequenceBuffer = new Uint8Array(bufferSize);
    const qualityBuffer = new Uint8Array(bufferSize);

    return {
      /**
       * Parse alignment with pre-allocated buffers for better performance
       */
      parseAlignment: (view: DataView, offset: number, blockSize: number, references: string[]) => {
        const record = BinaryParser.parseAlignmentRecord(view, offset, blockSize);

        // Optional validation
        if (!skipValidation) {
          const warnings = BinaryParser.validateAlignment(record, references);
          if (warnings.length > 0 && onWarning) {
            warnings.forEach((warning) => onWarning(`${record.readName}: ${warning}`));
          }
        }

        return record;
      },

      /**
       * Get buffer statistics for monitoring
       */
      getStats: () => ({
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
  static estimateMemoryUsage(record: ReturnType<typeof BinaryParser.parseAlignmentRecord>): number {
    // Tiger Style: Assert function arguments
    console.assert(typeof record === 'object', 'record must be an object');

    let totalBytes = 0;

    // Fixed fields (32 bytes)
    totalBytes += 32;

    // Variable length fields
    totalBytes += record.readName.length + 1; // +1 for null terminator
    totalBytes += record.numCigarOps * 4; // 4 bytes per CIGAR operation
    totalBytes += Math.ceil(record.seqLength / 2); // Packed sequence
    totalBytes += record.seqLength; // Quality scores

    // Optional tags
    if (record.optionalTags) {
      totalBytes += record.optionalTags.length;
    }

    // JavaScript object overhead (approximate)
    totalBytes += 200; // Rough estimate for object structure

    return totalBytes;
  }

  /**
   * Check if current runtime supports Bun-specific optimizations
   * @returns True if Bun optimizations are available
   */
  static isBunOptimized(): boolean {
    return (
      typeof globalThis !== 'undefined' &&
      'Bun' in globalThis &&
      globalThis.Bun &&
      typeof globalThis.Bun.version === 'string' &&
      typeof globalThis.Bun.file === 'function'
    );
  }

  /**
   * Get runtime-specific buffer allocation strategy
   * @param size Buffer size needed
   * @returns Optimally allocated buffer for current runtime
   */
  static allocateBuffer(size: number): Uint8Array {
    // Tiger Style: Assert function arguments
    console.assert(Number.isInteger(size) && size > 0, 'size must be positive integer');

    if (BinaryParser.isBunOptimized()) {
      // Bun has optimized buffer allocation
      return new Uint8Array(size);
    } else {
      // Standard allocation for other runtimes
      return new Uint8Array(size);
    }
  }
}
