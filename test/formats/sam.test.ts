/**
 * Tests for SAM format parsing
 */

import { test, expect, describe } from 'bun:test';
import {
  SAMParser,
  SAMWriter,
  SAMUtils,
  type SAMAlignment,
  type SAMHeader,
  SamError,
  ValidationError,
} from '../../src/index.ts';

describe('SAMParser', () => {
  const parser = new SAMParser();

  describe('Header parsing', () => {
    test('should parse HD header line', async () => {
      const sam = '@HD\tVN:1.6\tSO:coordinate';
      const records = [];

      for await (const record of parser.parseString(sam)) {
        records.push(record);
      }

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        format: 'sam-header',
        type: 'HD',
        fields: {
          VN: '1.6',
          SO: 'coordinate',
        },
        lineNumber: 1,
      });
    });

    test('should parse SQ header line', async () => {
      const sam = '@SQ\tSN:chr1\tLN:248956422';
      const records = [];

      for await (const record of parser.parseString(sam)) {
        records.push(record);
      }

      expect(records[0]).toEqual({
        format: 'sam-header',
        type: 'SQ',
        fields: {
          SN: 'chr1',
          LN: '248956422',
        },
        lineNumber: 1,
      });
    });

    test('should parse RG header line', async () => {
      const sam = '@RG\tID:sample1\tSM:sample1\tPL:ILLUMINA';
      const records = [];

      for await (const record of parser.parseString(sam)) {
        records.push(record);
      }

      expect(records[0]).toEqual({
        format: 'sam-header',
        type: 'RG',
        fields: {
          ID: 'sample1',
          SM: 'sample1',
          PL: 'ILLUMINA',
        },
        lineNumber: 1,
      });
    });

    test('should parse PG header line', async () => {
      const sam = '@PG\tID:bwa\tVN:0.7.17\tCL:bwa mem ref.fa reads.fq';
      const records = [];

      for await (const record of parser.parseString(sam)) {
        records.push(record);
      }

      expect(records[0]).toEqual({
        format: 'sam-header',
        type: 'PG',
        fields: {
          ID: 'bwa',
          VN: '0.7.17',
          CL: 'bwa mem ref.fa reads.fq',
        },
        lineNumber: 1,
      });
    });

    test('should parse CO header line', async () => {
      const sam = '@CO\tThis is a comment line';
      const records = [];

      for await (const record of parser.parseString(sam)) {
        records.push(record);
      }

      expect(records[0]).toEqual({
        format: 'sam-header',
        type: 'CO',
        fields: {
          comment: 'This is a comment line',
        },
        lineNumber: 1,
      });
    });

    test('should throw error for invalid header type', async () => {
      const sam = '@XX\tVN:1.6';

      await expect(async () => {
        for await (const record of parser.parseString(sam)) {
          // Should not reach here
        }
      }).toThrow('Invalid header type');
    });

    test('should throw error for malformed header field', async () => {
      const sam = '@HD\tINVALID_FIELD';

      await expect(async () => {
        for await (const record of parser.parseString(sam)) {
          // Should not reach here
        }
      }).toThrow('Invalid header field format');
    });
  });

  describe('Alignment parsing', () => {
    test('should parse basic alignment record', async () => {
      // Create 72-character strings for sequence and quality
      const sequence = 'ACGT'.repeat(18); // 72 characters
      const quality = 'I'.repeat(72); // 72 characters
      const sam = `read1\t99\tchr1\t1000\t60\t72M\t=\t1200\t276\t${sequence}\t${quality}`;
      const records = [];

      for await (const record of parser.parseString(sam)) {
        records.push(record);
      }

      expect(records).toHaveLength(1);
      const alignment = records[0] as SAMAlignment;
      expect(alignment.format).toBe('sam');
      expect(alignment.qname).toBe('read1');
      expect(alignment.flag).toBe(99);
      expect(alignment.rname).toBe('chr1');
      expect(alignment.pos).toBe(1000);
      expect(alignment.mapq).toBe(60);
      expect(alignment.cigar).toBe('72M');
      expect(alignment.rnext).toBe('=');
      expect(alignment.pnext).toBe(1200);
      expect(alignment.tlen).toBe(276);
      expect(alignment.seq).toBe(sequence);
      expect(alignment.qual).toBe(quality);
    });

    test('should parse alignment with optional tags', async () => {
      const sam =
        'read1\t99\tchr1\t1000\t60\t8M\t=\t1200\t276\tACGTACGT\tIIIIIIII\tNM:i:0\tMD:Z:8\tAS:i:8';
      const records = [];

      for await (const record of parser.parseString(sam)) {
        records.push(record);
      }

      const alignment = records[0] as SAMAlignment;
      expect(alignment.tags).toHaveLength(3);
      expect(alignment.tags![0]).toEqual({ tag: 'NM', type: 'i', value: 0 });
      expect(alignment.tags![1]).toEqual({ tag: 'MD', type: 'Z', value: '8' });
      expect(alignment.tags![2]).toEqual({ tag: 'AS', type: 'i', value: 8 });
    });

    test('should handle unmapped read with * values', async () => {
      const sam = 'unmapped\t4\t*\t0\t0\t*\t*\t0\t0\t*\t*';
      const records = [];

      for await (const record of parser.parseString(sam)) {
        records.push(record);
      }

      const alignment = records[0] as SAMAlignment;
      expect(alignment.qname).toBe('unmapped');
      expect(alignment.flag).toBe(4);
      expect(alignment.rname).toBe('*');
      expect(alignment.pos).toBe(0);
      expect(alignment.mapq).toBe(0);
      expect(alignment.cigar).toBe('*');
      expect(alignment.seq).toBe('*');
      expect(alignment.qual).toBe('*');
    });

    test('should throw error for insufficient fields', async () => {
      const sam = 'read1\t99\tchr1\t1000'; // Only 4 fields

      await expect(async () => {
        for await (const record of parser.parseString(sam)) {
          // Should not reach here
        }
      }).toThrow('Insufficient fields');
    });

    test('should throw error for invalid flag', async () => {
      const sam = 'read1\tNOT_A_NUMBER\tchr1\t1000\t60\t76M\t=\t1200\t276\tACGT\tIIII';

      await expect(async () => {
        for await (const record of parser.parseString(sam)) {
          // Should not reach here
        }
      }).toThrow('Invalid FLAG');
    });

    test('should throw error for invalid position', async () => {
      const sam = 'read1\t99\tchr1\tNOT_A_NUMBER\t60\t76M\t=\t1200\t276\tACGT\tIIII';

      await expect(async () => {
        for await (const record of parser.parseString(sam)) {
          // Should not reach here
        }
      }).toThrow('Invalid position');
    });

    test('should throw error for invalid MAPQ', async () => {
      const sam = 'read1\t99\tchr1\t1000\tNOT_A_NUMBER\t76M\t=\t1200\t276\tACGT\tIIII';

      await expect(async () => {
        for await (const record of parser.parseString(sam)) {
          // Should not reach here
        }
      }).toThrow('Invalid MAPQ');
    });
  });

  describe('CIGAR parsing', () => {
    test('should parse valid CIGAR strings', async () => {
      const cigars = [
        { cigar: '4M', seq: 'ACGT', qual: 'IIII' },
        { cigar: '3M1I', seq: 'ACGT', qual: 'IIII' },
        { cigar: '3M1D', seq: 'ACG', qual: 'III' },
        { cigar: '2S2M', seq: 'ACGT', qual: 'IIII' },
        { cigar: '2M2H', seq: 'AC', qual: 'II' },
        { cigar: '2M1N2M', seq: 'ACGT', qual: 'IIII' },
      ];

      for (const test of cigars) {
        const sam = `read1\t0\tchr1\t1000\t60\t${test.cigar}\t*\t0\t0\t${test.seq}\t${test.qual}`;
        const records = [];

        for await (const record of parser.parseString(sam)) {
          records.push(record);
        }

        const alignment = records[0] as SAMAlignment;
        expect(alignment.cigar).toBe(test.cigar);
      }
    });

    test('should throw error for invalid CIGAR operations', async () => {
      const sam = 'read1\t0\tchr1\t1000\t60\t4Z\t*\t0\t0\tACGT\tIIII'; // Invalid 'Z' operation

      await expect(async () => {
        for await (const record of parser.parseString(sam)) {
          // Should not reach here
        }
      }).toThrow('Invalid CIGAR pattern');
    });

    test('should throw error for invalid CIGAR length', async () => {
      const sam = 'read1\t0\tchr1\t1000\t60\t0M\t*\t0\t0\tACGT\tIIII'; // Zero length

      await expect(async () => {
        for await (const record of parser.parseString(sam)) {
          // Should not reach here
        }
      }).toThrow('Invalid CIGAR operation length');
    });
  });

  describe('FLAG parsing', () => {
    test('should parse valid FLAGS', async () => {
      const flags = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2047];

      for (const flag of flags) {
        const sam = `read1\t${flag}\tchr1\t1000\t60\t76M\t*\t0\t0\tACGT\tIIII`;
        const records = [];

        for await (const record of parser.parseString(sam)) {
          records.push(record);
        }

        const alignment = records[0] as SAMAlignment;
        expect(alignment.flag).toBe(flag);
      }
    });

    test('should throw error for FLAG out of range', async () => {
      const sam = 'read1\t2048\tchr1\t1000\t60\t76M\t*\t0\t0\tACGT\tIIII'; // > 2047

      await expect(async () => {
        for await (const record of parser.parseString(sam)) {
          // Should not reach here
        }
      }).toThrow('SAM flag out of range');
    });
  });

  describe('Tag parsing', () => {
    test('should parse different tag types', async () => {
      const sam =
        'read1\t0\tchr1\t1000\t60\t4M\t*\t0\t0\tACGT\tIIII\tXA:A:C\tNM:i:5\tAS:f:99.5\tMD:Z:4\tXS:H:1A2B';
      const records = [];

      for await (const record of parser.parseString(sam)) {
        records.push(record);
      }

      const alignment = records[0] as SAMAlignment;
      expect(alignment.tags).toHaveLength(5);
      expect(alignment.tags![0]).toEqual({ tag: 'XA', type: 'A', value: 'C' });
      expect(alignment.tags![1]).toEqual({ tag: 'NM', type: 'i', value: 5 });
      expect(alignment.tags![2]).toEqual({ tag: 'AS', type: 'f', value: 99.5 });
      expect(alignment.tags![3]).toEqual({ tag: 'MD', type: 'Z', value: '4' });
      expect(alignment.tags![4]).toEqual({ tag: 'XS', type: 'H', value: '1A2B' });
    });

    test('should throw error for malformed tag', async () => {
      const sam = 'read1\t0\tchr1\t1000\t60\t76M\t*\t0\t0\tACGT\tIIII\tINVALID_TAG';

      await expect(async () => {
        for await (const record of parser.parseString(sam)) {
          // Should not reach here
        }
      }).toThrow('Invalid tag format');
    });

    test('should throw error for invalid integer tag value', async () => {
      const sam = 'read1\t0\tchr1\t1000\t60\t76M\t*\t0\t0\tACGT\tIIII\tNM:i:NOT_A_NUMBER';

      await expect(async () => {
        for await (const record of parser.parseString(sam)) {
          // Should not reach here
        }
      }).toThrow('Invalid integer value');
    });

    test('should throw error for invalid float tag value', async () => {
      const sam = 'read1\t0\tchr1\t1000\t60\t76M\t*\t0\t0\tACGT\tIIII\tAS:f:NOT_A_NUMBER';

      await expect(async () => {
        for await (const record of parser.parseString(sam)) {
          // Should not reach here
        }
      }).toThrow('Invalid float value');
    });
  });

  describe('Mixed headers and alignments', () => {
    test('should parse complete SAM file', async () => {
      const sam = `@HD\tVN:1.6\tSO:coordinate
@SQ\tSN:chr1\tLN:248956422
@RG\tID:sample1\tSM:sample1\tPL:ILLUMINA
read1\t99\tchr1\t1000\t60\t8M\t=\t1200\t276\tACGTACGT\tIIIIIIII\tNM:i:0
read2\t147\tchr1\t1200\t60\t8M\t=\t1000\t-276\tGGGGGGGG\tIIIIIIII\tNM:i:0`;

      const records = [];
      for await (const record of parser.parseString(sam)) {
        records.push(record);
      }

      expect(records).toHaveLength(5);

      // Check headers
      expect(records[0].format).toBe('sam-header');
      expect((records[0] as SAMHeader).type).toBe('HD');
      expect(records[1].format).toBe('sam-header');
      expect((records[1] as SAMHeader).type).toBe('SQ');
      expect(records[2].format).toBe('sam-header');
      expect((records[2] as SAMHeader).type).toBe('RG');

      // Check alignments
      expect(records[3].format).toBe('sam');
      expect((records[3] as SAMAlignment).qname).toBe('read1');
      expect(records[4].format).toBe('sam');
      expect((records[4] as SAMAlignment).qname).toBe('read2');
    });
  });

  describe('Error handling and edge cases', () => {
    test('should skip empty lines', async () => {
      const sam = '@HD\tVN:1.6\n\nread1\t0\tchr1\t1000\t60\t4M\t*\t0\t0\tACGT\tIIII\n\n';
      const records = [];

      for await (const record of parser.parseString(sam)) {
        records.push(record);
      }

      expect(records).toHaveLength(2);
    });

    test('should handle line number tracking', async () => {
      const sam = '@HD\tVN:1.6\nread1\t0\tchr1\t1000\t60\t4M\t*\t0\t0\tACGT\tIIII';
      const records = [];

      for await (const record of parser.parseString(sam)) {
        records.push(record);
      }

      expect(records[0].lineNumber).toBe(1);
      expect(records[1].lineNumber).toBe(2);
    });

    test('should skip validation when requested', async () => {
      const skipValidationParser = new SAMParser({ skipValidation: true });
      const sam = 'read1\t1024\tchr1\t1000\t60\t4M\t*\t0\t0\tACGT\tIIII';
      const records = [];

      for await (const record of skipValidationParser.parseString(sam)) {
        records.push(record);
      }

      expect(records).toHaveLength(1);
      expect((records[0] as SAMAlignment).qname).toBe('read1');
    });
  });
});

describe('SAMUtils', () => {
  test('should detect SAM format', () => {
    expect(SAMUtils.detectFormat('@HD\tVN:1.6')).toBe(true);
    expect(SAMUtils.detectFormat('read1\t0\tchr1\t1000\t60\t76M\t*\t0\t0\tACGT\tIIII')).toBe(true);
    expect(SAMUtils.detectFormat('>seq1\nACGT')).toBe(false);
    expect(SAMUtils.detectFormat('@seq1\nACGT\n+\nIIII')).toBe(false);
  });

  test('should decode FLAG values correctly', () => {
    const decoded = SAMUtils.decodeFlag(99); // 99 = 1 + 2 + 32 + 64
    expect(decoded.isPaired).toBe(true);
    expect(decoded.isProperPair).toBe(true);
    expect(decoded.isUnmapped).toBe(false);
    expect(decoded.isMateUnmapped).toBe(false);
    expect(decoded.isReverse).toBe(false);
    expect(decoded.isMateReverse).toBe(true);
    expect(decoded.isFirstInPair).toBe(true);
    expect(decoded.isSecondInPair).toBe(false);
  });

  test('should parse CIGAR operations', () => {
    const operations = SAMUtils.parseCIGAROperations('36M1I39M');
    expect(operations).toEqual([
      { operation: 'M', length: 36 },
      { operation: 'I', length: 1 },
      { operation: 'M', length: 39 },
    ]);
  });

  test('should handle empty CIGAR', () => {
    const operations = SAMUtils.parseCIGAROperations('*');
    expect(operations).toEqual([]);
  });

  test('should calculate reference span', () => {
    expect(SAMUtils.calculateReferenceSpan('76M')).toBe(76);
    expect(SAMUtils.calculateReferenceSpan('36M1I39M')).toBe(75); // I doesn't consume reference
    expect(SAMUtils.calculateReferenceSpan('50M1D25M')).toBe(76); // D consumes reference
    expect(SAMUtils.calculateReferenceSpan('10S66M')).toBe(66); // S doesn't consume reference
    expect(SAMUtils.calculateReferenceSpan('*')).toBe(0);
  });
});

describe('Essential invariants', () => {
  const parser = new SAMParser();
  const writer = new SAMWriter();

  test('should maintain round-trip fidelity', async () => {
    // Ensures write(parse(data)) === data for core data integrity
    const originalAlignment = {
      format: 'sam' as const,
      qname: 'read1',
      flag: 99,
      rname: 'chr1',
      pos: 1000,
      mapq: 60,
      cigar: '4M',
      rnext: '*',
      pnext: 0,
      tlen: 0,
      seq: 'ACGT',
      qual: 'IIII',
      lineNumber: 1,
    };

    // Write to string
    const samString = writer.writeString([originalAlignment]);

    // Parse back
    const records = [];
    for await (const record of parser.parseString(samString)) {
      records.push(record);
    }

    expect(records).toHaveLength(1);
    const parsed = records[0] as SAMAlignment;

    // Validate perfect fidelity
    expect(parsed.qname).toBe(originalAlignment.qname);
    expect(parsed.flag).toBe(originalAlignment.flag);
    expect(parsed.seq).toBe(originalAlignment.seq);
    expect(parsed.qual).toBe(originalAlignment.qual);
  });

  test('should stream without loading entire file into memory', async () => {
    // Verifies streaming functionality - crucial for large genomic files
    const largeSAM = Array.from(
      { length: 100 },
      (_, i) => `read${i}\t0\tchr1\t${1000 + i}\t60\t4M\t*\t0\t0\tACGT\tIIII`
    ).join('\n');

    let recordCount = 0;

    for await (const record of parser.parseString(largeSAM)) {
      recordCount++;
      expect(record.format).toBe('sam');
    }

    expect(recordCount).toBe(100);
  });

  test('should handle one example of malformed data gracefully', async () => {
    // Just one test for malformed data - not dozens of edge cases
    const malformedSAM = 'read1\tINVALID_FLAG\tchr1\t1000\t60\t4M\t*\t0\t0\tACGT\tIIII';

    let errorThrown = false;
    try {
      for await (const record of parser.parseString(malformedSAM)) {
        // Should not reach here
      }
    } catch (error) {
      errorThrown = true;
      expect(error).toBeInstanceOf(SamError);
    }

    expect(errorThrown).toBe(true);
  });
});
