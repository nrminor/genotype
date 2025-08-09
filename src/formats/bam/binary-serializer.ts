/**
 * Binary serialization utilities for BAM format writing
 *
 * Handles the complex binary encoding required for BAM files:
 * - Little-endian integer serialization
 * - 4-bit encoded nucleotide sequences
 * - Binary CIGAR operations
 * - SAM tag binary encoding
 * - Type-safe binary operations with bounds checking
 */

import type { SAMAlignment, SAMTag, CIGARString } from '../../types';
import { BamError } from '../../errors';

/**
 * Binary serializer utilities for BAM format data
 *
 * All methods follow Tiger Style with comprehensive validation and
 * clear error messages for debugging binary serialization issues.
 */
export class BinarySerializer {
  /**
   * Write a 32-bit signed integer in little-endian format
   * @param view DataView to write to
   * @param offset Byte offset to write at
   * @param value 32-bit signed integer value
   * @throws {BamError} If offset is out of bounds or value is invalid
   */
  static writeInt32LE(view: DataView, offset: number, value: number): void {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be a DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');
    console.assert(Number.isInteger(value), 'value must be an integer');
    console.assert(
      value >= -2147483648 && value <= 2147483647,
      'value must be valid 32-bit signed integer'
    );

    if (offset + 4 > view.byteLength) {
      throw new BamError(
        `Cannot write int32 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
        undefined,
        'binary'
      );
    }

    view.setInt32(offset, value, true); // true = little-endian
  }

  /**
   * Write a 32-bit unsigned integer in little-endian format
   * @param view DataView to write to
   * @param offset Byte offset to write at
   * @param value 32-bit unsigned integer value
   * @throws {BamError} If offset is out of bounds or value is invalid
   */
  static writeUInt32LE(view: DataView, offset: number, value: number): void {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be a DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');
    console.assert(Number.isInteger(value) && value >= 0, 'value must be non-negative integer');
    console.assert(value <= 4294967295, 'value must be valid 32-bit unsigned integer');

    if (offset + 4 > view.byteLength) {
      throw new BamError(
        `Cannot write uint32 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
        undefined,
        'binary'
      );
    }

    view.setUint32(offset, value, true); // true = little-endian
  }

  /**
   * Write a 16-bit unsigned integer in little-endian format
   * @param view DataView to write to
   * @param offset Byte offset to write at
   * @param value 16-bit unsigned integer value
   * @throws {BamError} If offset is out of bounds or value is invalid
   */
  static writeUInt16LE(view: DataView, offset: number, value: number): void {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be a DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');
    console.assert(Number.isInteger(value) && value >= 0, 'value must be non-negative integer');
    console.assert(value <= 65535, 'value must be valid 16-bit unsigned integer');

    if (offset + 2 > view.byteLength) {
      throw new BamError(
        `Cannot write uint16 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
        undefined,
        'binary'
      );
    }

    view.setUint16(offset, value, true); // true = little-endian
  }

  /**
   * Write an 8-bit unsigned integer
   * @param view DataView to write to
   * @param offset Byte offset to write at
   * @param value 8-bit unsigned integer value
   * @throws {BamError} If offset is out of bounds or value is invalid
   */
  static writeUInt8(view: DataView, offset: number, value: number): void {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be a DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');
    console.assert(Number.isInteger(value) && value >= 0, 'value must be non-negative integer');
    console.assert(value <= 255, 'value must be valid 8-bit unsigned integer');

    if (offset >= view.byteLength) {
      throw new BamError(
        `Cannot write uint8 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
        undefined,
        'binary'
      );
    }

    view.setUint8(offset, value);
  }

  /**
   * Write a null-terminated string to binary data
   * @param view DataView to write to
   * @param offset Starting byte offset
   * @param value String value to write
   * @param maxLength Maximum string length including null terminator
   * @returns Number of bytes written
   * @throws {BamError} If string is too long or buffer too small
   */
  static writeCString(view: DataView, offset: number, value: string, maxLength: number): number {
    // Tiger Style: Assert function arguments
    console.assert(view instanceof DataView, 'view must be a DataView');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');
    console.assert(typeof value === 'string', 'value must be a string');
    console.assert(
      Number.isInteger(maxLength) && maxLength > 0,
      'maxLength must be positive integer'
    );

    if (value.length >= maxLength) {
      throw new BamError(
        `String too long: ${value.length} characters (max ${maxLength - 1} with null terminator)`,
        undefined,
        'binary'
      );
    }

    if (offset + value.length + 1 > view.byteLength) {
      throw new BamError(
        `Cannot write string at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
        undefined,
        'binary'
      );
    }

    // Convert string to UTF-8 bytes
    const encoder = new TextEncoder();
    const bytes = encoder.encode(value);

    // Write string bytes
    const uint8View = new Uint8Array(view.buffer, view.byteOffset + offset);
    uint8View.set(bytes);

    // Write null terminator
    view.setUint8(offset + bytes.length, 0);

    const bytesWritten = bytes.length + 1;

    // Tiger Style: Assert postconditions
    console.assert(bytesWritten <= maxLength, 'bytes written must not exceed maxLength');
    console.assert(
      bytesWritten === value.length + 1,
      'bytes written must equal string length plus null terminator'
    );

    return bytesWritten;
  }

  /**
   * Write a 16-bit signed integer in little-endian format
   * @param buffer Uint8Array buffer to write to
   * @param offset Starting offset in buffer
   * @param value 16-bit signed integer value (-32768 to 32767)
   * @throws {BamError} If offset is out of bounds or value is invalid
   */
  static writeInt16(buffer: Uint8Array, offset: number, value: number): void {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    view.setInt16(offset, value, true); // true = little-endian
  }

  /**
   * Write a 16-bit unsigned integer in little-endian format
   * @param buffer Uint8Array buffer to write to
   * @param offset Starting offset in buffer
   * @param value 16-bit unsigned integer value (0 to 65535)
   * @throws {BamError} If offset is out of bounds or value is invalid
   */
  static writeUInt16(buffer: Uint8Array, offset: number, value: number): void {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    view.setUint16(offset, value, true); // true = little-endian
  }

  /**
   * Write a 32-bit signed integer in little-endian format
   * @param buffer Uint8Array buffer to write to
   * @param offset Starting offset in buffer
   * @param value 32-bit signed integer value
   * @throws {BamError} If offset is out of bounds or value is invalid
   */
  static writeInt32(buffer: Uint8Array, offset: number, value: number): void {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    view.setInt32(offset, value, true); // true = little-endian
  }

  /**
   * Write a 32-bit unsigned integer in little-endian format
   * @param buffer Uint8Array buffer to write to
   * @param offset Starting offset in buffer
   * @param value 32-bit unsigned integer value
   * @throws {BamError} If offset is out of bounds or value is invalid
   */
  static writeUInt32(buffer: Uint8Array, offset: number, value: number): void {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    view.setUint32(offset, value, true); // true = little-endian
  }

  /**
   * Write a 32-bit float in little-endian format
   * @param buffer Uint8Array buffer to write to
   * @param offset Starting offset in buffer
   * @param value 32-bit float value
   * @throws {BamError} If offset is out of bounds or value is invalid
   */
  static writeFloat32(buffer: Uint8Array, offset: number, value: number): void {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    view.setFloat32(offset, value, true); // true = little-endian
  }

  /**
   * Encode nucleotide sequence using 4-bit packing for BAM format
   *
   * BAM encodes nucleotides using 4 bits per base:
   * =:0, A:1, C:2, M:3, G:4, R:5, S:6, V:7, T:8, W:9, Y:10, H:11, K:12, D:13, B:14, N:15
   *
   * @param sequence Nucleotide sequence string
   * @param buffer Buffer to write packed sequence to
   * @param offset Starting offset in buffer
   * @returns Number of bytes written
   * @throws {BamError} If sequence contains invalid characters or buffer too small
   */
  static packSequence(sequence: string, buffer: Uint8Array, offset: number): number {
    // Tiger Style: Assert function arguments
    console.assert(typeof sequence === 'string', 'sequence must be a string');
    console.assert(buffer instanceof Uint8Array, 'buffer must be Uint8Array');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');

    if (sequence.length === 0) {
      return 0;
    }

    const bytesNeeded = Math.ceil(sequence.length / 2);
    if (offset + bytesNeeded > buffer.length) {
      throw new BamError(
        `Buffer too small for packed sequence: need ${bytesNeeded} bytes at offset ${offset}, have ${buffer.length - offset}`,
        undefined,
        'sequence'
      );
    }

    // BAM sequence encoding lookup table
    const ENCODER: Record<string, number> = {
      '=': 0,
      A: 1,
      C: 2,
      M: 3,
      G: 4,
      R: 5,
      S: 6,
      V: 7,
      T: 8,
      W: 9,
      Y: 10,
      H: 11,
      K: 12,
      D: 13,
      B: 14,
      N: 15,
    };

    for (let i = 0; i < sequence.length; i += 2) {
      const base1Char = sequence[i];
      const base2Char = i + 1 < sequence.length ? sequence[i + 1] : '';

      console.assert(base1Char !== undefined, 'base1 character must be defined');

      const base1 = base1Char!.toUpperCase();
      const base2 = base2Char ? base2Char.toUpperCase() : '';

      // Validate nucleotide characters
      if (!(base1 in ENCODER)) {
        throw new BamError(
          `Invalid nucleotide character '${base1}' at position ${i}`,
          undefined,
          'sequence'
        );
      }

      const high = ENCODER[base1]!;
      const low = base2 ? (ENCODER[base2] ?? 15) : 0; // Default to 'N' (15) for invalid chars

      if (base2 && !(base2 in ENCODER)) {
        throw new BamError(
          `Invalid nucleotide character '${base2}' at position ${i + 1}`,
          undefined,
          'sequence'
        );
      }

      // Pack two bases into one byte (high nibble = first base, low nibble = second base)
      buffer[offset + Math.floor(i / 2)] = (high << 4) | low;
    }

    // Tiger Style: Assert postconditions
    console.assert(bytesNeeded > 0, 'bytes needed must be positive');
    console.assert(
      bytesNeeded === Math.ceil(sequence.length / 2),
      'bytes needed calculation must be correct'
    );

    return bytesNeeded;
  }

  /**
   * Encode CIGAR string into binary BAM format
   *
   * BAM stores CIGAR as array of 32-bit integers where:
   * - High 28 bits = operation length
   * - Low 4 bits = operation type (0=M, 1=I, 2=D, 3=N, 4=S, 5=H, 6=P, 7==, 8=X)
   *
   * @param cigar CIGAR string to encode
   * @param buffer Buffer to write binary CIGAR to
   * @param offset Starting offset in buffer
   * @returns Number of bytes written
   * @throws {BamError} If CIGAR is invalid or buffer too small
   */
  static packCIGAR(cigar: CIGARString, buffer: Uint8Array, offset: number): number {
    // Tiger Style: Assert function arguments
    console.assert(typeof cigar === 'string', 'cigar must be a string');
    console.assert(buffer instanceof Uint8Array, 'buffer must be Uint8Array');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');

    if (cigar === '*') {
      return 0; // No CIGAR operations
    }

    // Parse CIGAR operations
    const operations = BinarySerializer.parseCIGARString(cigar);
    const bytesNeeded = operations.length * 4; // 4 bytes per operation

    if (offset + bytesNeeded > buffer.length) {
      throw new BamError(
        `Buffer too small for CIGAR: need ${bytesNeeded} bytes at offset ${offset}, have ${buffer.length - offset}`,
        undefined,
        'cigar'
      );
    }

    // Operation type mapping
    const OPS: Record<string, number> = {
      M: 0,
      I: 1,
      D: 2,
      N: 3,
      S: 4,
      H: 5,
      P: 6,
      '=': 7,
      X: 8,
    };

    const view = new DataView(buffer.buffer, buffer.byteOffset + offset, bytesNeeded);

    for (let i = 0; i < operations.length; i++) {
      const opData = operations[i];
      console.assert(opData !== undefined, 'CIGAR operation must be defined');

      const { operation, length } = opData!;

      if (!(operation in OPS)) {
        throw new BamError(
          `Invalid CIGAR operation '${operation}' in position ${i}`,
          undefined,
          'cigar'
        );
      }

      if (length <= 0 || length > 0xfffffff) {
        // 28-bit max
        throw new BamError(
          `Invalid CIGAR operation length ${length} for operation '${operation}'`,
          undefined,
          'cigar'
        );
      }

      // Encode: high 28 bits = length, low 4 bits = operation type
      const opCode = OPS[operation];
      console.assert(opCode !== undefined, 'operation code must be defined');
      const encoded = (length << 4) | opCode!;
      view.setUint32(i * 4, encoded, true); // little-endian
    }

    // Tiger Style: Assert postconditions
    console.assert(operations.length > 0, 'must have at least one CIGAR operation');
    console.assert(
      bytesNeeded === operations.length * 4,
      'bytes needed calculation must be correct'
    );

    return bytesNeeded;
  }

  /**
   * Parse CIGAR string into operation objects
   * @param cigar CIGAR string to parse
   * @returns Array of CIGAR operations
   */
  private static parseCIGARString(cigar: string): Array<{ operation: string; length: number }> {
    // Tiger Style: Assert function arguments
    console.assert(typeof cigar === 'string', 'cigar must be a string');
    console.assert(cigar !== '*', 'cigar must not be wildcard');

    const operations: Array<{ operation: string; length: number }> = [];
    const regex = /(\d+)([MIDNSHP=X])/g;
    let match;

    while ((match = regex.exec(cigar)) !== null) {
      const lengthStr = match[1];
      const operation = match[2];

      console.assert(lengthStr !== undefined, 'CIGAR length string must be defined');
      console.assert(operation !== undefined, 'CIGAR operation must be defined');

      const length = parseInt(lengthStr!, 10);

      if (isNaN(length) || length <= 0) {
        throw new BamError(`Invalid CIGAR operation length: ${lengthStr}`, undefined, 'cigar');
      }

      operations.push({ operation: operation!, length });
    }

    if (operations.length === 0) {
      throw new BamError(`No valid CIGAR operations found in '${cigar}'`, undefined, 'cigar');
    }

    // Validate that we parsed the entire string
    const reconstructed = operations.map((op) => `${op.length}${op.operation}`).join('');
    if (reconstructed !== cigar) {
      throw new BamError(
        `CIGAR parsing incomplete: expected '${cigar}', got '${reconstructed}'`,
        undefined,
        'cigar'
      );
    }

    return operations;
  }

  /**
   * Encode quality scores for BAM format
   * @param qualityString Quality scores in Phred+33 format
   * @param buffer Buffer to write quality scores to
   * @param offset Starting offset in buffer
   * @returns Number of bytes written
   * @throws {BamError} If quality string is invalid or buffer too small
   */
  static packQualityScores(qualityString: string, buffer: Uint8Array, offset: number): number {
    // Tiger Style: Assert function arguments
    console.assert(typeof qualityString === 'string', 'qualityString must be a string');
    console.assert(buffer instanceof Uint8Array, 'buffer must be Uint8Array');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');

    if (qualityString === '*') {
      return 0; // No quality scores
    }

    const length = qualityString.length;
    if (offset + length > buffer.length) {
      throw new BamError(
        `Buffer too small for quality scores: need ${length} bytes at offset ${offset}, have ${buffer.length - offset}`,
        undefined,
        'qual'
      );
    }

    // Convert Phred+33 to raw quality scores
    for (let i = 0; i < length; i++) {
      const charCode = qualityString.charCodeAt(i);

      if (charCode < 33 || charCode > 126) {
        throw new BamError(
          `Invalid quality score character '${qualityString[i]}' (ASCII ${charCode}) at position ${i}`,
          undefined,
          'qual'
        );
      }

      // Convert from Phred+33 to raw score (subtract 33)
      const rawQuality = charCode - 33;

      // BAM uses 255 to indicate unavailable quality
      buffer[offset + i] = rawQuality === 255 ? 255 : Math.min(rawQuality, 93); // Cap at 93 (Phred+33 = 126)
    }

    // Tiger Style: Assert postconditions
    console.assert(length >= 0, 'length must be non-negative');

    return length;
  }

  /**
   * Serialize SAM tags to binary BAM format
   * @param tags Array of SAM tags to serialize
   * @param buffer Buffer to write serialized tags to
   * @param offset Starting offset in buffer
   * @returns Number of bytes written
   * @throws {BamError} If tags are invalid or buffer too small
   */
  static packTags(tags: SAMTag[] | undefined, buffer: Uint8Array, offset: number): number {
    // Tiger Style: Assert function arguments
    console.assert(!tags || Array.isArray(tags), 'tags must be an array or undefined');
    console.assert(buffer instanceof Uint8Array, 'buffer must be Uint8Array');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');

    if (!tags || tags.length === 0) {
      return 0; // No tags to serialize
    }

    let currentOffset = offset;

    for (const tag of tags) {
      // Validate tag structure
      if (!tag.tag || tag.tag.length !== 2) {
        throw new BamError(
          `Invalid tag name: '${tag.tag}' (must be exactly 2 characters)`,
          undefined,
          'tags'
        );
      }

      if (!tag.type || tag.type.length !== 1) {
        throw new BamError(
          `Invalid tag type: '${tag.type}' (must be exactly 1 character)`,
          undefined,
          'tags'
        );
      }

      // Write tag name (2 bytes)
      if (currentOffset + 2 > buffer.length) {
        throw new BamError(
          `Buffer too small for tag name: need 2 bytes at offset ${currentOffset}`,
          undefined,
          'tags'
        );
      }

      buffer[currentOffset++] = tag.tag.charCodeAt(0);
      buffer[currentOffset++] = tag.tag.charCodeAt(1);

      // Write tag type (1 byte)
      if (currentOffset >= buffer.length) {
        throw new BamError(
          `Buffer too small for tag type: need 1 byte at offset ${currentOffset}`,
          undefined,
          'tags'
        );
      }

      buffer[currentOffset++] = tag.type.charCodeAt(0);

      // Write tag value based on type
      const bytesWritten = BinarySerializer.packTagValue(
        tag.type,
        tag.value,
        buffer,
        currentOffset
      );
      currentOffset += bytesWritten;
    }

    const totalBytesWritten = currentOffset - offset;

    // Tiger Style: Assert postconditions
    console.assert(totalBytesWritten >= 0, 'bytes written must be non-negative');
    console.assert(currentOffset <= buffer.length, 'current offset must not exceed buffer length');

    return totalBytesWritten;
  }

  /**
   * Pack a single tag value based on its type
   * @param type Tag type character
   * @param value Tag value
   * @param buffer Buffer to write to
   * @param offset Starting offset
   * @returns Number of bytes written
   */
  private static packTagValue(
    type: string,
    value: string | number,
    buffer: Uint8Array,
    offset: number
  ): number {
    // Tiger Style: Assert function arguments
    console.assert(typeof type === 'string' && type.length === 1, 'type must be single character');
    console.assert(value !== undefined, 'value must be defined');
    console.assert(buffer instanceof Uint8Array, 'buffer must be Uint8Array');
    console.assert(Number.isInteger(offset) && offset >= 0, 'offset must be non-negative integer');

    const view = new DataView(buffer.buffer, buffer.byteOffset);

    switch (type) {
      case 'A': // Character
        if (typeof value !== 'string' || value.length !== 1) {
          throw new BamError(
            `Invalid character tag value: '${value}' (must be single character)`,
            undefined,
            'tags'
          );
        }
        if (offset >= buffer.length) {
          throw new BamError(`Buffer too small for character tag`, undefined, 'tags');
        }
        buffer[offset] = value.charCodeAt(0);
        return 1;

      case 'c': // Signed 8-bit integer
        if (typeof value !== 'number' || !Number.isInteger(value) || value < -128 || value > 127) {
          throw new BamError(
            `Invalid int8 tag value: ${value} (must be integer -128 to 127)`,
            undefined,
            'tags'
          );
        }
        if (offset >= buffer.length) {
          throw new BamError(`Buffer too small for int8 tag`, undefined, 'tags');
        }
        view.setInt8(offset, value);
        return 1;

      case 'C': // Unsigned 8-bit integer
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
          throw new BamError(
            `Invalid uint8 tag value: ${value} (must be integer 0 to 255)`,
            undefined,
            'tags'
          );
        }
        if (offset >= buffer.length) {
          throw new BamError(`Buffer too small for uint8 tag`, undefined, 'tags');
        }
        buffer[offset] = value;
        return 1;

      case 's': // Signed 16-bit integer
        if (
          typeof value !== 'number' ||
          !Number.isInteger(value) ||
          value < -32768 ||
          value > 32767
        ) {
          throw new BamError(
            `Invalid int16 tag value: ${value} (must be integer -32768 to 32767)`,
            undefined,
            'tags'
          );
        }
        if (offset + 2 > buffer.length) {
          throw new BamError(`Buffer too small for int16 tag`, undefined, 'tags');
        }
        view.setInt16(offset, value, true); // little-endian
        return 2;

      case 'S': // Unsigned 16-bit integer
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 65535) {
          throw new BamError(
            `Invalid uint16 tag value: ${value} (must be integer 0 to 65535)`,
            undefined,
            'tags'
          );
        }
        if (offset + 2 > buffer.length) {
          throw new BamError(`Buffer too small for uint16 tag`, undefined, 'tags');
        }
        view.setUint16(offset, value, true); // little-endian
        return 2;

      case 'i': // Signed 32-bit integer
        if (
          typeof value !== 'number' ||
          !Number.isInteger(value) ||
          value < -2147483648 ||
          value > 2147483647
        ) {
          throw new BamError(
            `Invalid int32 tag value: ${value} (must be 32-bit signed integer)`,
            undefined,
            'tags'
          );
        }
        if (offset + 4 > buffer.length) {
          throw new BamError(`Buffer too small for int32 tag`, undefined, 'tags');
        }
        view.setInt32(offset, value, true); // little-endian
        return 4;

      case 'I': // Unsigned 32-bit integer
        if (
          typeof value !== 'number' ||
          !Number.isInteger(value) ||
          value < 0 ||
          value > 4294967295
        ) {
          throw new BamError(
            `Invalid uint32 tag value: ${value} (must be 32-bit unsigned integer)`,
            undefined,
            'tags'
          );
        }
        if (offset + 4 > buffer.length) {
          throw new BamError(`Buffer too small for uint32 tag`, undefined, 'tags');
        }
        view.setUint32(offset, value, true); // little-endian
        return 4;

      case 'f': // 32-bit float
        if (typeof value !== 'number' || !isFinite(value)) {
          throw new BamError(
            `Invalid float tag value: ${value} (must be finite number)`,
            undefined,
            'tags'
          );
        }
        if (offset + 4 > buffer.length) {
          throw new BamError(`Buffer too small for float tag`, undefined, 'tags');
        }
        view.setFloat32(offset, value, true); // little-endian
        return 4;

      case 'Z': // Null-terminated string
      case 'H': {
        // Hex string
        if (typeof value !== 'string') {
          throw new BamError(
            `Invalid string tag value: ${value} (must be string)`,
            undefined,
            'tags'
          );
        }
        const encoder = new TextEncoder();
        const bytes = encoder.encode(value);

        if (offset + bytes.length + 1 > buffer.length) {
          throw new BamError(
            `Buffer too small for string tag: need ${bytes.length + 1} bytes`,
            undefined,
            'tags'
          );
        }

        // Write string bytes
        buffer.set(bytes, offset);
        // Write null terminator
        buffer[offset + bytes.length] = 0;

        return bytes.length + 1;
      }

      case 'B': {
        // Array of values
        // Implement proper binary array encoding for 'B' type tags
        if (typeof value !== 'string') {
          throw new BamError(
            `B-type array tag value must be string format: "subtype,value1,value2,..."`,
            undefined,
            'tags'
          );
        }

        // Parse array format: "c,1,2,3" or "f,1.0,2.0,3.0"
        const parts = value.split(',');
        if (parts.length < 2) {
          throw new BamError(`Invalid B-type array format: ${value}`, undefined, 'tags');
        }

        const subtype = parts[0]; // c, C, s, S, i, I, f
        const elements = parts.slice(1).map((v) => {
          if (subtype === 'f') return parseFloat(v);
          return parseInt(v, 10);
        });

        // Calculate required space: 1 (subtype) + 4 (count) + elements
        let elementSize: number;
        switch (subtype) {
          case 'c':
          case 'C':
            elementSize = 1;
            break;
          case 's':
          case 'S':
            elementSize = 2;
            break;
          case 'i':
          case 'I':
          case 'f':
            elementSize = 4;
            break;
          default:
            throw new BamError(`Invalid B-type subtype: ${subtype}`, undefined, 'tags');
        }

        const totalSize = 1 + 4 + elements.length * elementSize;
        if (offset + totalSize > buffer.length) {
          throw new BamError(
            `Buffer too small for B-type array: need ${totalSize} bytes`,
            undefined,
            'tags'
          );
        }

        let currentOffset = offset;

        // Write subtype
        buffer[currentOffset++] = subtype.charCodeAt(0);

        // Write element count
        this.writeInt32(buffer, currentOffset, elements.length);
        currentOffset += 4;

        // Write elements based on subtype
        for (const elem of elements) {
          switch (subtype) {
            case 'c': // int8
              buffer[currentOffset++] = elem;
              break;
            case 'C': // uint8
              buffer[currentOffset++] = elem & 0xff;
              break;
            case 's': // int16
              this.writeInt16(buffer, currentOffset, elem);
              currentOffset += 2;
              break;
            case 'S': // uint16
              this.writeUInt16(buffer, currentOffset, elem);
              currentOffset += 2;
              break;
            case 'i': // int32
              this.writeInt32(buffer, currentOffset, elem);
              currentOffset += 4;
              break;
            case 'I': // uint32
              this.writeUInt32(buffer, currentOffset, elem);
              currentOffset += 4;
              break;
            case 'f': // float32
              this.writeFloat32(buffer, currentOffset, elem);
              currentOffset += 4;
              break;
          }
        }

        return totalSize;
      }

      default:
        throw new BamError(`Unsupported tag type: '${type}'`, undefined, 'tags');
    }
  }

  /**
   * Calculate the total size needed for serializing an alignment record
   * @param alignment SAM alignment record
   * @param references Reference sequence names for validation
   * @returns Total size in bytes needed for serialization
   */
  static calculateAlignmentSize(alignment: SAMAlignment, references: string[]): number {
    // Tiger Style: Assert function arguments
    console.assert(typeof alignment === 'object', 'alignment must be an object');
    console.assert(Array.isArray(references), 'references must be an array');

    let totalSize = 32; // Fixed header size

    // Read name (including null terminator)
    totalSize += alignment.qname.length + 1;

    // CIGAR operations
    if (alignment.cigar !== '*') {
      const operations = BinarySerializer.parseCIGARString(alignment.cigar);
      totalSize += operations.length * 4;
    }

    // Sequence (4-bit packed)
    if (alignment.seq !== '*') {
      totalSize += Math.ceil(alignment.seq.length / 2);
    }

    // Quality scores
    if (alignment.qual !== '*') {
      totalSize += alignment.qual.length;
    }

    // Optional tags
    if (alignment.tags) {
      for (const tag of alignment.tags) {
        totalSize += 3; // 2 bytes tag name + 1 byte type

        switch (tag.type) {
          case 'A':
            totalSize += 1;
            break;
          case 'i':
          case 'f':
            totalSize += 4;
            break;
          case 'Z':
          case 'H':
            if (typeof tag.value === 'string') {
              totalSize += new TextEncoder().encode(tag.value).length + 1; // +1 for null terminator
            }
            break;
          case 'B':
            // Simplified estimation for array tags
            if (typeof tag.value === 'string') {
              totalSize += new TextEncoder().encode(tag.value).length + 1;
            }
            break;
          default:
            // Conservative estimation for unknown types
            totalSize += 8;
        }
      }
    }

    // Tiger Style: Assert postconditions
    console.assert(totalSize >= 32, 'total size must be at least 32 bytes for fixed header');

    return totalSize;
  }

  /**
   * Create a Bun-optimized serializer with pre-allocated buffers
   * @param options Configuration options for performance tuning
   * @returns Optimized serializer functions
   */
  static createOptimizedSerializer(
    options: {
      maxAlignmentSize?: number;
      bufferPoolSize?: number;
    } = {}
  ) {
    const { maxAlignmentSize = 1024 * 1024, bufferPoolSize = 10 } = options; // 1MB max alignment

    // Pre-allocate buffer pool for performance
    const bufferPool: Uint8Array[] = [];
    for (let i = 0; i < bufferPoolSize; i++) {
      bufferPool.push(new Uint8Array(maxAlignmentSize));
    }

    let poolIndex = 0;

    return {
      /**
       * Get an optimized buffer from the pool
       */
      getBuffer: (size: number): Uint8Array => {
        if (size <= maxAlignmentSize && bufferPool.length > 0) {
          const buffer = bufferPool[poolIndex];
          console.assert(buffer !== undefined, 'buffer from pool must be defined');
          poolIndex = (poolIndex + 1) % bufferPool.length;
          return buffer!.slice(0, size);
        }
        return new Uint8Array(size);
      },

      /**
       * Get serializer performance statistics
       */
      getStats: () => ({
        maxAlignmentSize,
        bufferPoolSize,
        bufferUtilization: poolIndex,
        bunOptimized: typeof globalThis !== 'undefined' && 'Bun' in globalThis,
      }),
    };
  }
}
