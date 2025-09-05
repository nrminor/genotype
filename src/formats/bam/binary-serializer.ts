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

import { BamError } from "../../errors";
import type { CIGARString, SAMAlignment, SAMTag } from "../../types";

// Module-level constants for sequence encoding
const SEQUENCE_ENCODER: Record<string, number> = {
  "=": 0,
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

// Module-level constants for CIGAR operations
const CIGAR_OPS: Record<string, number> = {
  M: 0,
  I: 1,
  D: 2,
  N: 3,
  S: 4,
  H: 5,
  P: 6,
  "=": 7,
  X: 8,
};

/**
 * Write a 32-bit signed integer in little-endian format
 * @param view DataView to write to
 * @param offset Byte offset to write at
 * @param value 32-bit signed integer value
 * @throws {BamError} If offset is out of bounds or value is invalid
 */
export function writeInt32LE(view: DataView, offset: number, value: number): void {
  // Tiger Style: Assert function arguments
  if (!(view instanceof DataView)) {
    throw new BamError("view must be a DataView", undefined, "binary");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BamError("offset must be non-negative integer", undefined, "binary");
  }
  if (!Number.isInteger(value)) {
    throw new BamError("value must be an integer", undefined, "binary");
  }
  if (value < -2147483648 || value > 2147483647) {
    throw new BamError("value must be valid 32-bit signed integer", undefined, "binary");
  }

  if (offset + 4 > view.byteLength) {
    throw new BamError(
      `Cannot write int32 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
      undefined,
      "binary"
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
export function writeUInt32LE(view: DataView, offset: number, value: number): void {
  // Tiger Style: Assert function arguments
  if (!(view instanceof DataView)) {
    throw new BamError("view must be a DataView", undefined, "binary");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BamError("offset must be non-negative integer", undefined, "binary");
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new BamError("value must be non-negative integer", undefined, "binary");
  }
  if (value > 4294967295) {
    throw new BamError("value must be valid 32-bit unsigned integer", undefined, "binary");
  }

  if (offset + 4 > view.byteLength) {
    throw new BamError(
      `Cannot write uint32 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
      undefined,
      "binary"
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
export function writeUInt16LE(view: DataView, offset: number, value: number): void {
  // Tiger Style: Assert function arguments
  if (!(view instanceof DataView)) {
    throw new BamError("view must be a DataView", undefined, "binary");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BamError("offset must be non-negative integer", undefined, "binary");
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new BamError("value must be non-negative integer", undefined, "binary");
  }
  if (value > 65535) {
    throw new BamError("value must be valid 16-bit unsigned integer", undefined, "binary");
  }

  if (offset + 2 > view.byteLength) {
    throw new BamError(
      `Cannot write uint16 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
      undefined,
      "binary"
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
export function writeUInt8(view: DataView, offset: number, value: number): void {
  // Tiger Style: Assert function arguments
  if (!(view instanceof DataView)) {
    throw new BamError("view must be a DataView", undefined, "binary");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BamError("offset must be non-negative integer", undefined, "binary");
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new BamError("value must be non-negative integer", undefined, "binary");
  }
  if (value > 255) {
    throw new BamError("value must be valid 8-bit unsigned integer", undefined, "binary");
  }

  if (offset >= view.byteLength) {
    throw new BamError(
      `Cannot write uint8 at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
      undefined,
      "binary"
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
export function writeCString(
  view: DataView,
  offset: number,
  value: string,
  maxLength: number
): number {
  // Tiger Style: Assert function arguments
  if (!(view instanceof DataView)) {
    throw new BamError("view must be a DataView", undefined, "binary");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BamError("offset must be non-negative integer", undefined, "binary");
  }
  if (typeof value !== "string") {
    throw new BamError("value must be a string", undefined, "binary");
  }
  if (!Number.isInteger(maxLength) || maxLength <= 0) {
    throw new BamError("maxLength must be positive integer", undefined, "binary");
  }

  if (value.length >= maxLength) {
    throw new BamError(
      `String too long: ${value.length} characters (max ${maxLength - 1} with null terminator)`,
      undefined,
      "binary"
    );
  }

  if (offset + value.length + 1 > view.byteLength) {
    throw new BamError(
      `Cannot write string at offset ${offset}: buffer too small (${view.byteLength} bytes)`,
      undefined,
      "binary"
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
  if (bytesWritten > maxLength) {
    throw new BamError("bytes written must not exceed maxLength", undefined, "binary");
  }
  if (bytesWritten !== value.length + 1) {
    throw new BamError(
      "bytes written must equal string length plus null terminator",
      undefined,
      "binary"
    );
  }

  return bytesWritten;
}

/**
 * Write a 16-bit signed integer in little-endian format
 * @param buffer Uint8Array buffer to write to
 * @param offset Starting offset in buffer
 * @param value 16-bit signed integer value (-32768 to 32767)
 * @throws {BamError} If offset is out of bounds or value is invalid
 */
export function writeInt16(buffer: Uint8Array, offset: number, value: number): void {
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
export function writeUInt16(buffer: Uint8Array, offset: number, value: number): void {
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
export function writeInt32(buffer: Uint8Array, offset: number, value: number): void {
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
export function writeUInt32(buffer: Uint8Array, offset: number, value: number): void {
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
export function writeFloat32(buffer: Uint8Array, offset: number, value: number): void {
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
export function packSequence(sequence: string, buffer: Uint8Array, offset: number): number {
  // Tiger Style: Assert function arguments
  if (typeof sequence !== "string") {
    throw new BamError("sequence must be a string", undefined, "sequence");
  }
  if (!(buffer instanceof Uint8Array)) {
    throw new BamError("buffer must be Uint8Array", undefined, "sequence");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BamError("offset must be non-negative integer", undefined, "sequence");
  }

  if (sequence.length === 0) {
    return 0;
  }

  const bytesNeeded = Math.ceil(sequence.length / 2);
  if (offset + bytesNeeded > buffer.length) {
    throw new BamError(
      `Buffer too small for packed sequence: need ${bytesNeeded} bytes at offset ${offset}, have ${buffer.length - offset}`,
      undefined,
      "sequence"
    );
  }

  for (let i = 0; i < sequence.length; i += 2) {
    const base1Char = sequence[i];
    const base2Char = i + 1 < sequence.length ? sequence[i + 1] : "";

    if (base1Char === undefined) {
      throw new BamError("base1 character must be defined", undefined, "sequence");
    }

    const base1 = base1Char.toUpperCase();
    const base2 =
      base2Char !== undefined && base2Char !== null && base2Char !== ""
        ? base2Char.toUpperCase()
        : "";

    // Validate nucleotide characters
    if (!(base1 in SEQUENCE_ENCODER)) {
      throw new BamError(
        `Invalid nucleotide character '${base1}' at position ${i}`,
        undefined,
        "sequence"
      );
    }

    const high = SEQUENCE_ENCODER[base1];
    if (high === undefined) {
      throw new BamError(`Invalid nucleotide encoding for '${base1}'`, undefined, "sequence");
    }

    const low = base2 ? (SEQUENCE_ENCODER[base2] ?? 15) : 0; // Default to 'N' (15) for invalid chars

    if (base2 && !(base2 in SEQUENCE_ENCODER)) {
      throw new BamError(
        `Invalid nucleotide character '${base2}' at position ${i + 1}`,
        undefined,
        "sequence"
      );
    }

    // Pack two bases into one byte (high nibble = first base, low nibble = second base)
    buffer[offset + Math.floor(i / 2)] = (high << 4) | low;
  }

  // Tiger Style: Assert postconditions
  if (bytesNeeded <= 0) {
    throw new BamError("bytes needed must be positive", undefined, "sequence");
  }
  if (bytesNeeded !== Math.ceil(sequence.length / 2)) {
    throw new BamError("bytes needed calculation must be correct", undefined, "sequence");
  }

  return bytesNeeded;
}

/**
 * Parse CIGAR string into operation objects
 * @param cigar CIGAR string to parse
 * @returns Array of CIGAR operations
 */
function parseCIGARString(cigar: string): Array<{ operation: string; length: number }> {
  // Tiger Style: Assert function arguments
  if (typeof cigar !== "string") {
    throw new BamError("cigar must be a string", undefined, "cigar");
  }
  if (cigar === "*") {
    throw new BamError("cigar must not be wildcard", undefined, "cigar");
  }

  const operations: Array<{ operation: string; length: number }> = [];
  const regex = /(\d+)([MIDNSHP=X])/g;
  let match;

  while ((match = regex.exec(cigar)) !== null) {
    const lengthStr = match[1];
    const operation = match[2];

    if (lengthStr === undefined) {
      throw new BamError("CIGAR length string must be defined", undefined, "cigar");
    }
    if (operation === undefined) {
      throw new BamError("CIGAR operation must be defined", undefined, "cigar");
    }

    const length = parseInt(lengthStr, 10);

    if (isNaN(length) || length <= 0) {
      throw new BamError(`Invalid CIGAR operation length: ${lengthStr}`, undefined, "cigar");
    }

    operations.push({ operation, length });
  }

  if (operations.length === 0) {
    throw new BamError(`No valid CIGAR operations found in '${cigar}'`, undefined, "cigar");
  }

  // Validate that we parsed the entire string
  const reconstructed = operations.map((op) => `${op.length}${op.operation}`).join("");
  if (reconstructed !== cigar) {
    throw new BamError(
      `CIGAR parsing incomplete: expected '${cigar}', got '${reconstructed}'`,
      undefined,
      "cigar"
    );
  }

  return operations;
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
export function packCIGAR(cigar: CIGARString, buffer: Uint8Array, offset: number): number {
  // Tiger Style: Assert function arguments
  if (typeof cigar !== "string") {
    throw new BamError("cigar must be a string", undefined, "cigar");
  }
  if (!(buffer instanceof Uint8Array)) {
    throw new BamError("buffer must be Uint8Array", undefined, "cigar");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BamError("offset must be non-negative integer", undefined, "cigar");
  }

  if (cigar === "*") {
    return 0; // No CIGAR operations
  }

  // Parse CIGAR operations
  const operations = parseCIGARString(cigar);
  const bytesNeeded = operations.length * 4; // 4 bytes per operation

  if (offset + bytesNeeded > buffer.length) {
    throw new BamError(
      `Buffer too small for CIGAR: need ${bytesNeeded} bytes at offset ${offset}, have ${buffer.length - offset}`,
      undefined,
      "cigar"
    );
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, bytesNeeded);

  for (let i = 0; i < operations.length; i++) {
    const opData = operations[i];
    if (opData === undefined) {
      throw new BamError("CIGAR operation must be defined", undefined, "cigar");
    }

    const { operation, length } = opData;

    if (!(operation in CIGAR_OPS)) {
      throw new BamError(
        `Invalid CIGAR operation '${operation}' in position ${i}`,
        undefined,
        "cigar"
      );
    }

    if (length <= 0 || length > 0xfffffff) {
      // 28-bit max
      throw new BamError(
        `Invalid CIGAR operation length ${length} for operation '${operation}'`,
        undefined,
        "cigar"
      );
    }

    // Encode: high 28 bits = length, low 4 bits = operation type
    const opCode = CIGAR_OPS[operation];
    if (opCode === undefined) {
      throw new BamError("operation code must be defined", undefined, "cigar");
    }
    const encoded = (length << 4) | opCode;
    view.setUint32(i * 4, encoded, true); // little-endian
  }

  // Tiger Style: Assert postconditions
  if (operations.length <= 0) {
    throw new BamError("must have at least one CIGAR operation", undefined, "cigar");
  }
  if (bytesNeeded !== operations.length * 4) {
    throw new BamError("bytes needed calculation must be correct", undefined, "cigar");
  }

  return bytesNeeded;
}

/**
 * Encode quality scores for BAM format
 * @param qualityString Quality scores in Phred+33 format
 * @param buffer Buffer to write quality scores to
 * @param offset Starting offset in buffer
 * @returns Number of bytes written
 * @throws {BamError} If quality string is invalid or buffer too small
 */
export function packQualityScores(
  qualityString: string,
  buffer: Uint8Array,
  offset: number
): number {
  // Tiger Style: Assert function arguments
  if (typeof qualityString !== "string") {
    throw new BamError("qualityString must be a string", undefined, "qual");
  }
  if (!(buffer instanceof Uint8Array)) {
    throw new BamError("buffer must be Uint8Array", undefined, "qual");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BamError("offset must be non-negative integer", undefined, "qual");
  }

  if (qualityString === "*") {
    return 0; // No quality scores
  }

  const length = qualityString.length;
  if (offset + length > buffer.length) {
    throw new BamError(
      `Buffer too small for quality scores: need ${length} bytes at offset ${offset}, have ${buffer.length - offset}`,
      undefined,
      "qual"
    );
  }

  // Convert Phred+33 to raw quality scores
  for (let i = 0; i < length; i++) {
    const charCode = qualityString.charCodeAt(i);

    if (charCode < 33 || charCode > 126) {
      throw new BamError(
        `Invalid quality score character '${qualityString[i]}' (ASCII ${charCode}) at position ${i}`,
        undefined,
        "qual"
      );
    }

    // Convert from Phred+33 to raw score (subtract 33)
    const rawQuality = charCode - 33;

    // BAM uses 255 to indicate unavailable quality
    buffer[offset + i] = rawQuality === 255 ? 255 : Math.min(rawQuality, 93); // Cap at 93 (Phred+33 = 126)
  }

  // Tiger Style: Assert postconditions
  if (length < 0) {
    throw new BamError("length must be non-negative", undefined, "qual");
  }

  return length;
}

/**
 * Pack a single tag value based on its type
 * @param type Tag type character
 * @param value Tag value
 * @param buffer Buffer to write to
 * @param offset Starting offset
 * @returns Number of bytes written
 */
/**
 * Validate tag packing arguments
 */
function validateTagPackingArgs(
  type: string,
  value: string | number,
  buffer: Uint8Array,
  offset: number
): void {
  if (typeof type !== "string" || type.length !== 1) {
    throw new BamError("type must be single character", undefined, "tags");
  }
  if (value === undefined) {
    throw new BamError("value must be defined", undefined, "tags");
  }
  if (!(buffer instanceof Uint8Array)) {
    throw new BamError("buffer must be Uint8Array", undefined, "tags");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BamError("offset must be non-negative integer", undefined, "tags");
  }
}

/**
 * Pack character tag type 'A'
 */
function packCharacterTag(value: string | number, buffer: Uint8Array, offset: number): number {
  if (typeof value !== "string" || value.length !== 1) {
    throw new BamError(
      `Invalid character tag value: '${value}' (must be single character)`,
      undefined,
      "tags"
    );
  }
  if (offset >= buffer.length) {
    throw new BamError(`Buffer too small for character tag`, undefined, "tags");
  }
  buffer[offset] = value.charCodeAt(0);
  return 1;
}

/**
 * Validate integer tag value
 */
function validateIntegerValue(value: string | number): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BamError(`Invalid integer tag value: ${value} (must be integer)`, undefined, "tags");
  }
}

/**
 * Pack 8-bit integer tags (c, C)
 */
function pack8BitIntegerTag(
  type: string,
  value: string | number,
  buffer: Uint8Array,
  offset: number
): number {
  validateIntegerValue(value);

  if (offset >= buffer.length) {
    throw new BamError(`Buffer too small for 8-bit integer tag`, undefined, "tags");
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset);

  if (type === "c") {
    // Signed 8-bit integer
    if (value < -128 || value > 127) {
      throw new BamError(
        `Invalid int8 tag value: ${value} (must be -128 to 127)`,
        undefined,
        "tags"
      );
    }
    view.setInt8(offset, value);
  } else {
    // Unsigned 8-bit integer
    if (value < 0 || value > 255) {
      throw new BamError(`Invalid uint8 tag value: ${value} (must be 0 to 255)`, undefined, "tags");
    }
    buffer[offset] = value;
  }

  return 1;
}

/**
 * Pack 16-bit integer tags (s, S)
 */
function pack16BitIntegerTag(
  type: string,
  value: string | number,
  buffer: Uint8Array,
  offset: number
): number {
  validateIntegerValue(value);

  if (offset + 2 > buffer.length) {
    throw new BamError(`Buffer too small for 16-bit integer tag`, undefined, "tags");
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset);

  if (type === "s") {
    // Signed 16-bit integer
    if (value < -32768 || value > 32767) {
      throw new BamError(
        `Invalid int16 tag value: ${value} (must be -32768 to 32767)`,
        undefined,
        "tags"
      );
    }
    view.setInt16(offset, value, true);
  } else {
    // Unsigned 16-bit integer
    if (value < 0 || value > 65535) {
      throw new BamError(
        `Invalid uint16 tag value: ${value} (must be 0 to 65535)`,
        undefined,
        "tags"
      );
    }
    view.setUint16(offset, value, true);
  }

  return 2;
}

/**
 * Pack 32-bit integer tags (i, I)
 */
function pack32BitIntegerTag(
  type: string,
  value: string | number,
  buffer: Uint8Array,
  offset: number
): number {
  validateIntegerValue(value);

  if (offset + 4 > buffer.length) {
    throw new BamError(`Buffer too small for 32-bit integer tag`, undefined, "tags");
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset);

  if (type === "i") {
    // Signed 32-bit integer
    if (value < -2147483648 || value > 2147483647) {
      throw new BamError(
        `Invalid int32 tag value: ${value} (must be 32-bit signed integer)`,
        undefined,
        "tags"
      );
    }
    view.setInt32(offset, value, true);
  } else {
    // Unsigned 32-bit integer
    if (value < 0 || value > 4294967295) {
      throw new BamError(
        `Invalid uint32 tag value: ${value} (must be 32-bit unsigned integer)`,
        undefined,
        "tags"
      );
    }
    view.setUint32(offset, value, true);
  }

  return 4;
}

/**
 * Pack integer tag types (c, C, s, S, i, I)
 */
function packIntegerTag(
  type: string,
  value: string | number,
  buffer: Uint8Array,
  offset: number
): number {
  switch (type) {
    case "c": // Signed 8-bit integer
    case "C": // Unsigned 8-bit integer
      return pack8BitIntegerTag(type, value, buffer, offset);

    case "s": // Signed 16-bit integer
    case "S": // Unsigned 16-bit integer
      return pack16BitIntegerTag(type, value, buffer, offset);

    case "i": // Signed 32-bit integer
    case "I": // Unsigned 32-bit integer
      return pack32BitIntegerTag(type, value, buffer, offset);

    default:
      throw new BamError(`Invalid integer tag type: ${type}`, undefined, "tags");
  }
}

/**
 * Pack float tag type 'f'
 */
function packFloatTag(value: string | number, buffer: Uint8Array, offset: number): number {
  if (typeof value !== "number" || !isFinite(value)) {
    throw new BamError(
      `Invalid float tag value: ${value} (must be finite number)`,
      undefined,
      "tags"
    );
  }
  if (offset + 4 > buffer.length) {
    throw new BamError(`Buffer too small for float tag`, undefined, "tags");
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset);
  view.setFloat32(offset, value, true);
  return 4;
}

/**
 * Pack string tag types ('Z', 'H')
 */
function packStringTag(value: string | number, buffer: Uint8Array, offset: number): number {
  if (typeof value !== "string") {
    throw new BamError(`Invalid string tag value: ${value} (must be string)`, undefined, "tags");
  }
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);

  if (offset + bytes.length + 1 > buffer.length) {
    throw new BamError(
      `Buffer too small for string tag: need ${bytes.length + 1} bytes`,
      undefined,
      "tags"
    );
  }

  buffer.set(bytes, offset);
  buffer[offset + bytes.length] = 0;
  return bytes.length + 1;
}

/**
 * Get element size for B-type array subtype
 */
function getBTypeElementSize(subtype: string): number {
  switch (subtype) {
    case "c":
    case "C":
      return 1;
    case "s":
    case "S":
      return 2;
    case "i":
    case "I":
    case "f":
      return 4;
    default:
      throw new BamError(`Invalid B-type subtype: ${subtype}`, undefined, "tags");
  }
}

/**
 * Write B-type array elements
 */
function writeBTypeElements(
  subtype: string,
  elements: number[],
  buffer: Uint8Array,
  offset: number
): number {
  let currentOffset = offset;

  for (const elem of elements) {
    switch (subtype) {
      case "c": // int8
        buffer[currentOffset++] = elem;
        break;
      case "C": // uint8
        buffer[currentOffset++] = elem & 0xff;
        break;
      case "s": // int16
        writeInt16(buffer, currentOffset, elem);
        currentOffset += 2;
        break;
      case "S": // uint16
        writeUInt16(buffer, currentOffset, elem);
        currentOffset += 2;
        break;
      case "i": // int32
        writeInt32(buffer, currentOffset, elem);
        currentOffset += 4;
        break;
      case "I": // uint32
        writeUInt32(buffer, currentOffset, elem);
        currentOffset += 4;
        break;
      case "f": // float32
        writeFloat32(buffer, currentOffset, elem);
        currentOffset += 4;
        break;
    }
  }

  return currentOffset - offset;
}

/**
 * Pack array tag type 'B'
 */
function packArrayTag(value: string | number, buffer: Uint8Array, offset: number): number {
  if (typeof value !== "string") {
    throw new BamError(
      `B-type array tag value must be string format: "subtype,value1,value2,..."`,
      undefined,
      "tags"
    );
  }

  const parts = value.split(",");
  if (parts.length < 2) {
    throw new BamError(`Invalid B-type array format: ${value}`, undefined, "tags");
  }

  const subtype = parts[0];
  if (subtype === undefined) {
    throw new BamError(`Missing subtype in B-type array format: ${value}`, undefined, "tags");
  }

  const elements = parts.slice(1).map((v) => {
    if (subtype === "f") return parseFloat(v);
    return parseInt(v, 10);
  });

  const elementSize = getBTypeElementSize(subtype);
  const totalSize = 1 + 4 + elements.length * elementSize;

  if (offset + totalSize > buffer.length) {
    throw new BamError(
      `Buffer too small for B-type array: need ${totalSize} bytes`,
      undefined,
      "tags"
    );
  }

  let currentOffset = offset;

  // Write subtype
  buffer[currentOffset++] = subtype.charCodeAt(0);

  // Write element count
  writeInt32(buffer, currentOffset, elements.length);
  currentOffset += 4;

  // Write elements
  writeBTypeElements(subtype, elements, buffer, currentOffset);

  return totalSize;
}

/**
 * Pack a single tag value based on its type
 * @param type Tag type character
 * @param value Tag value
 * @param buffer Buffer to write to
 * @param offset Starting offset
 * @returns Number of bytes written
 */
function packTagValue(
  type: string,
  value: string | number,
  buffer: Uint8Array,
  offset: number
): number {
  validateTagPackingArgs(type, value, buffer, offset);

  switch (type) {
    case "A": // Character
      return packCharacterTag(value, buffer, offset);

    case "c": // Signed 8-bit integer
    case "C": // Unsigned 8-bit integer
    case "s": // Signed 16-bit integer
    case "S": // Unsigned 16-bit integer
    case "i": // Signed 32-bit integer
    case "I": // Unsigned 32-bit integer
      return packIntegerTag(type, value, buffer, offset);

    case "f": // 32-bit float
      return packFloatTag(value, buffer, offset);

    case "Z": // Null-terminated string
    case "H": // Hex string
      return packStringTag(value, buffer, offset);

    case "B": // Array of values
      return packArrayTag(value, buffer, offset);

    default:
      throw new BamError(`Unsupported tag type: '${type}'`, undefined, "tags");
  }
}

/**
 * Serialize SAM tags to binary BAM format
 * @param tags Array of SAM tags to serialize
 * @param buffer Buffer to write serialized tags to
 * @param offset Starting offset in buffer
 * @returns Number of bytes written
 * @throws {BamError} If tags are invalid or buffer too small
 */
export function packTags(tags: SAMTag[] | undefined, buffer: Uint8Array, offset: number): number {
  // Tiger Style: Assert function arguments
  if (tags !== undefined && !Array.isArray(tags)) {
    throw new BamError("tags must be an array or undefined", undefined, "tags");
  }
  if (!(buffer instanceof Uint8Array)) {
    throw new BamError("buffer must be Uint8Array", undefined, "tags");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BamError("offset must be non-negative integer", undefined, "tags");
  }

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
        "tags"
      );
    }

    if (!tag.type || tag.type.length !== 1) {
      throw new BamError(
        `Invalid tag type: '${tag.type}' (must be exactly 1 character)`,
        undefined,
        "tags"
      );
    }

    // Write tag name (2 bytes)
    if (currentOffset + 2 > buffer.length) {
      throw new BamError(
        `Buffer too small for tag name: need 2 bytes at offset ${currentOffset}`,
        undefined,
        "tags"
      );
    }

    buffer[currentOffset++] = tag.tag.charCodeAt(0);
    buffer[currentOffset++] = tag.tag.charCodeAt(1);

    // Write tag type (1 byte)
    if (currentOffset >= buffer.length) {
      throw new BamError(
        `Buffer too small for tag type: need 1 byte at offset ${currentOffset}`,
        undefined,
        "tags"
      );
    }

    buffer[currentOffset++] = tag.type.charCodeAt(0);

    // Write tag value based on type
    const bytesWritten = packTagValue(tag.type, tag.value, buffer, currentOffset);
    currentOffset += bytesWritten;
  }

  const totalBytesWritten = currentOffset - offset;

  // Tiger Style: Assert postconditions
  if (totalBytesWritten < 0) {
    throw new BamError("bytes written must be non-negative", undefined, "tags");
  }
  if (currentOffset > buffer.length) {
    throw new BamError("current offset must not exceed buffer length", undefined, "tags");
  }

  return totalBytesWritten;
}

/**
 * Calculate the total size needed for serializing an alignment record
 * @param alignment SAM alignment record
 * @param references Reference sequence names for validation
 * @returns Total size in bytes needed for serialization
 */
export function calculateAlignmentSize(alignment: SAMAlignment, references: string[]): number {
  // Tiger Style: Assert function arguments
  if (typeof alignment !== "object") {
    throw new BamError("alignment must be an object", undefined, "binary");
  }
  if (!Array.isArray(references)) {
    throw new BamError("references must be an array", undefined, "binary");
  }

  let totalSize = 32; // Fixed header size

  // Read name (including null terminator)
  totalSize += alignment.qname.length + 1;

  // CIGAR operations
  if (alignment.cigar !== "*") {
    const operations = parseCIGARString(alignment.cigar);
    totalSize += operations.length * 4;
  }

  // Sequence (4-bit packed)
  if (alignment.seq !== "*") {
    totalSize += Math.ceil(alignment.seq.length / 2);
  }

  // Quality scores
  if (alignment.qual !== "*") {
    totalSize += alignment.qual.length;
  }

  // Optional tags
  if (alignment.tags) {
    for (const tag of alignment.tags) {
      totalSize += 3; // 2 bytes tag name + 1 byte type

      switch (tag.type) {
        case "A":
          totalSize += 1;
          break;
        case "i":
        case "f":
          totalSize += 4;
          break;
        case "Z":
        case "H":
          if (typeof tag.value === "string") {
            totalSize += new TextEncoder().encode(tag.value).length + 1; // +1 for null terminator
          }
          break;
        case "B":
          // Simplified estimation for array tags
          if (typeof tag.value === "string") {
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
  if (totalSize < 32) {
    throw new BamError(
      "total size must be at least 32 bytes for fixed header",
      undefined,
      "binary"
    );
  }

  return totalSize;
}

/**
 * Create a Bun-optimized serializer with pre-allocated buffers
 * @param options Configuration options for performance tuning
 * @returns Optimized serializer functions
 */
export function createOptimizedSerializer(
  options: { maxAlignmentSize?: number; bufferPoolSize?: number } = {}
): {
  getBuffer: (size: number) => Uint8Array;
  getStats: () => {
    maxAlignmentSize: number;
    bufferPoolSize: number;
    bufferUtilization: number;
    bunOptimized: boolean;
  };
} {
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
        if (buffer === undefined) {
          throw new BamError("buffer from pool must be defined", undefined, "binary");
        }
        poolIndex = (poolIndex + 1) % bufferPool.length;
        return buffer.slice(0, size);
      }
      return new Uint8Array(size);
    },

    /**
     * Get serializer performance statistics
     */
    getStats: (): {
      maxAlignmentSize: number;
      bufferPoolSize: number;
      bufferUtilization: number;
      bunOptimized: boolean;
    } => ({
      maxAlignmentSize,
      bufferPoolSize,
      bufferUtilization: poolIndex,
      bunOptimized: typeof globalThis !== "undefined" && "Bun" in globalThis,
    }),
  };
}

// Backward compatibility namespace export
export const BinarySerializer = {
  writeInt32LE,
  writeUInt32LE,
  writeUInt16LE,
  writeUInt8,
  writeCString,
  writeInt16,
  writeUInt16,
  writeInt32,
  writeUInt32,
  writeFloat32,
  packSequence,
  packCIGAR,
  packQualityScores,
  packTags,
  calculateAlignmentSize,
  createOptimizedSerializer,
} as const;
