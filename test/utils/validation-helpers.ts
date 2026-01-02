/**
 * Validation helpers for SAM/BAM testing
 *
 * Provides utilities for validating test results and checking round-trip fidelity.
 */

import { expect } from "bun:test";
import type { BAMAlignment, SAMAlignment, SAMHeader } from "../../src/types";

/**
 * Assert that two SAM alignments are equivalent
 */
export function assertSAMEquality(
  actual: SAMAlignment,
  expected: SAMAlignment,
  message?: string,
): void {
  expect(actual.format).toBe(expected.format);
  expect(actual.qname).toBe(expected.qname);
  expect(actual.flag).toBe(expected.flag);
  expect(actual.rname).toBe(expected.rname);
  expect(actual.pos).toBe(expected.pos);
  expect(actual.mapq).toBe(expected.mapq);
  expect(actual.cigar).toBe(expected.cigar);
  expect(actual.rnext).toBe(expected.rnext);
  expect(actual.pnext).toBe(expected.pnext);
  expect(actual.tlen).toBe(expected.tlen);
  expect(actual.seq).toBe(expected.seq);
  expect(actual.qual).toBe(expected.qual);

  if (expected.tags) {
    expect(actual.tags).toBeDefined();
    expect(actual.tags).toHaveLength(expected.tags.length);

    for (let i = 0; i < expected.tags.length; i++) {
      expect(actual.tags![i]).toEqual(expected.tags[i]);
    }
  } else {
    expect(actual.tags).toBeUndefined();
  }
}

/**
 * Assert that two SAM headers are equivalent
 */
export function assertSAMHeaderEquality(
  actual: SAMHeader,
  expected: SAMHeader,
  message?: string,
): void {
  expect(actual.format).toBe(expected.format);
  expect(actual.type).toBe(expected.type);
  expect(actual.fields).toEqual(expected.fields);
}

/**
 * Validate BAM binary data integrity
 */
export function validateBAMBinary(data: Uint8Array): {
  hasValidMagic: boolean;
  headerLength: number;
  refCount: number;
  isComplete: boolean;
} {
  if (data.length < 12) {
    return {
      hasValidMagic: false,
      headerLength: 0,
      refCount: 0,
      isComplete: false,
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Check magic bytes
  const magic = data.slice(0, 4);
  const hasValidMagic =
    magic[0] === 0x42 && magic[1] === 0x41 && magic[2] === 0x4d && magic[3] === 0x01;

  const headerLength = view.getInt32(4, true);
  const refCount = view.getInt32(8 + headerLength, true);

  // Basic completeness check
  const expectedMinSize = 12 + headerLength + refCount * 8; // Minimum size estimate
  const isComplete = data.length >= expectedMinSize;

  return {
    hasValidMagic,
    headerLength,
    refCount,
    isComplete,
  };
}

/**
 * Check round-trip fidelity between SAM and BAM
 */
export function checkRoundTripFidelity(original: SAMAlignment, converted: BAMAlignment): void {
  // Core fields should be identical
  expect(converted.qname).toBe(original.qname);
  expect(converted.flag).toBe(original.flag);
  expect(converted.rname).toBe(original.rname);
  expect(converted.pos).toBe(original.pos);
  expect(converted.mapq).toBe(original.mapq);
  expect(converted.cigar).toBe(original.cigar);
  expect(converted.rnext).toBe(original.rnext);
  expect(converted.pnext).toBe(original.pnext);
  expect(converted.tlen).toBe(original.tlen);
  expect(converted.seq).toBe(original.seq);
  expect(converted.qual).toBe(original.qual);

  // Tags should be preserved (allowing for type mapping)
  if (original.tags && converted.tags) {
    expect(converted.tags).toHaveLength(original.tags.length);

    for (let i = 0; i < original.tags.length; i++) {
      const origTag = original.tags[i];
      const convTag = converted.tags[i];

      expect(convTag.tag).toBe(origTag.tag);
      expect(convTag.value).toBe(origTag.value);
      // Note: type mapping may differ between SAM and BAM
    }
  }
}

/**
 * Validate CIGAR string consistency with sequence
 */
export function validateCIGARConsistency(
  cigar: string,
  sequence: string,
): {
  isValid: boolean;
  expectedLength: number;
  actualLength: number;
  errors: string[];
} {
  const errors: string[] = [];

  if (cigar === "*") {
    if (sequence !== "*") {
      errors.push("CIGAR is * but sequence is not *");
    }
    return {
      isValid: errors.length === 0,
      expectedLength: 0,
      actualLength: sequence.length,
      errors,
    };
  }

  if (sequence === "*") {
    errors.push("Sequence is * but CIGAR is not *");
    return { isValid: false, expectedLength: 0, actualLength: 0, errors };
  }

  // Parse CIGAR operations
  const operations = cigar.match(/\d+[MIDNSHPX=]/g) || [];
  let expectedLength = 0;

  for (const op of operations) {
    const length = parseInt(op.slice(0, -1));
    const operation = op.slice(-1);

    // Operations that consume query sequence
    if (["M", "I", "S", "=", "X"].includes(operation)) {
      expectedLength += length;
    }
  }

  return {
    isValid: expectedLength === sequence.length,
    expectedLength,
    actualLength: sequence.length,
    errors:
      expectedLength === sequence.length
        ? []
        : [`Expected sequence length ${expectedLength}, got ${sequence.length}`],
  };
}

/**
 * Validate genomic coordinate consistency
 */
export function validateGenomicCoordinates(
  rname: string,
  pos: number,
  cigar: string,
  rnext: string,
  pnext: number,
  tlen: number,
): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Basic position validation
  if (pos < 0) {
    errors.push("Position cannot be negative");
  }

  if (pnext < 0 && rnext !== "*") {
    errors.push("Next position cannot be negative when next reference is specified");
  }

  // Template length consistency
  if (rname === rnext && pos > 0 && pnext > 0) {
    const expectedTlen = Math.abs(pnext - pos);
    if (Math.abs(Math.abs(tlen) - expectedTlen) > 1000) {
      warnings.push(
        `Template length ${tlen} seems inconsistent with positions (${pos} -> ${pnext})`,
      );
    }
  }

  // CIGAR and position consistency
  if (cigar !== "*" && pos === 0) {
    warnings.push(
      "Position is 0 but CIGAR is specified - unmapped reads should have pos=0 and cigar=*",
    );
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Batch validation utility for large datasets
 */
export async function validateLargeDataset<T>(
  items: T[],
  validator: (item: T) => { isValid: boolean; errors: string[] },
  options: {
    batchSize?: number;
    maxErrors?: number;
    onProgress?: (processed: number, total: number) => void;
  } = {},
): Promise<{
  totalProcessed: number;
  validItems: number;
  invalidItems: number;
  errors: Array<{ index: number; errors: string[] }>;
}> {
  const { batchSize = 1000, maxErrors = 100, onProgress } = options;

  let processed = 0;
  let validItems = 0;
  let invalidItems = 0;
  const errors: Array<{ index: number; errors: string[] }> = [];

  for (let i = 0; i < items.length && errors.length < maxErrors; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length));

    for (let j = 0; j < batch.length && errors.length < maxErrors; j++) {
      const item = batch[j];
      const result = validator(item);

      if (result.isValid) {
        validItems++;
      } else {
        invalidItems++;
        errors.push({
          index: i + j,
          errors: result.errors,
        });
      }

      processed++;
    }

    if (onProgress) {
      onProgress(processed, items.length);
    }

    // Allow other operations to proceed
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    totalProcessed: processed,
    validItems,
    invalidItems,
    errors,
  };
}
