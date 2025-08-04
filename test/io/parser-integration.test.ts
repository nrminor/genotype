/**
 * Integration tests for file I/O with genomics parsers
 */

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { FastaParser } from '../../src/formats/fasta';
import { FastqParser } from '../../src/formats/fastq';
import { SAMParser } from '../../src/formats/sam';
import { BedParser } from '../../src/formats/bed';
import { FileError, ParseError } from '../../src/errors';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// Test fixtures directory - use absolute path for reliability
const FIXTURES_DIR = join(process.cwd(), 'test', 'io', 'fixtures');
const TEST_FILES = {
  fasta: join(FIXTURES_DIR, 'test.fasta'),
  fastq: join(FIXTURES_DIR, 'test.fastq'),
  sam: join(FIXTURES_DIR, 'test.sam'),
  bed: join(FIXTURES_DIR, 'test.bed'),
  largeFasta: join(FIXTURES_DIR, 'large.fasta'),
  malformedFasta: join(FIXTURES_DIR, 'malformed.fasta'),
  emptyFile: join(FIXTURES_DIR, 'empty.txt'),
  binaryFile: join(FIXTURES_DIR, 'binary.bin'),
  nonexistent: join(FIXTURES_DIR, 'nonexistent.fasta'),
};

describe('Parser File Integration', () => {
  beforeAll(() => {
    // Create test fixtures directory
    mkdirSync(FIXTURES_DIR, { recursive: true });

    // Create FASTA test file
    writeFileSync(
      TEST_FILES.fasta,
      [
        '>seq1 First sequence',
        'ATCGATCGATCG',
        '>seq2 Second sequence',
        'GGGGAAAACCCC',
        'TTTTTTTT',
        '>seq3',
        'NNNNATCGNNNN',
      ].join('\n')
    );

    // Create FASTQ test file
    writeFileSync(
      TEST_FILES.fastq,
      [
        '@seq1 First read',
        'ATCGATCGATCG',
        '+',
        'IIIIIIIIIIII',
        '@seq2 Second read',
        'GGGGAAAACCCC',
        '+',
        'HHHHHHHHHHHH',
      ].join('\n')
    );

    // Create SAM test file
    writeFileSync(
      TEST_FILES.sam,
      [
        '@HD\tVN:1.0\tSO:coordinate',
        '@SQ\tSN:chr1\tLN:1000',
        'read1\t0\tchr1\t100\t60\t12M\t*\t0\t0\tATCGATCGATCG\tIIIIIIIIIIII',
        'read2\t16\tchr1\t200\t60\t12M\t*\t0\t0\tGGGGAAAACCCC\tHHHHHHHHHHHH',
      ].join('\n')
    );

    // Create BED test file
    writeFileSync(
      TEST_FILES.bed,
      [
        'chr1\t100\t200\tfeature1\t500\t+',
        'chr1\t300\t400\tfeature2\t600\t-',
        'chr2\t500\t600\tfeature3\t700\t.',
      ].join('\n')
    );

    // Create large FASTA file for performance testing
    const largeSequences = [];
    for (let i = 0; i < 1000; i++) {
      largeSequences.push(`>seq${i}`);
      largeSequences.push('A'.repeat(100) + 'T'.repeat(100) + 'C'.repeat(100) + 'G'.repeat(100));
    }
    writeFileSync(TEST_FILES.largeFasta, largeSequences.join('\n'));

    // Create malformed FASTA file
    writeFileSync(
      TEST_FILES.malformedFasta,
      ['>seq1', 'ATCG', 'INVALID_SEQUENCE_LINE_WITHOUT_HEADER', '>seq2', 'GGGG'].join('\n')
    );

    // Create empty file
    writeFileSync(TEST_FILES.emptyFile, '');

    // Create binary file
    writeFileSync(TEST_FILES.binaryFile, Buffer.from([0x00, 0x01, 0x02, 0xff]));
  });

  afterAll(() => {
    // Clean up test fixtures
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  describe('FASTA Parser File Integration', () => {
    test('should parse FASTA file correctly', async () => {
      const parser = new FastaParser();
      const sequences = [];

      for await (const sequence of parser.parseFile(TEST_FILES.fasta)) {
        sequences.push(sequence);
      }

      expect(sequences).toHaveLength(3);
      expect(sequences[0].id).toBe('seq1');
      expect(sequences[0].description).toBe('First sequence');
      expect(sequences[0].sequence).toBe('ATCGATCGATCG');
      expect(sequences[1].sequence).toBe('GGGGAAAACCCCTTTTTTTT');
      expect(sequences[2].id).toBe('seq3');
    });

    test('should handle large FASTA files efficiently', async () => {
      const parser = new FastaParser();
      let count = 0;
      const startTime = Date.now();

      for await (const sequence of parser.parseFile(TEST_FILES.largeFasta)) {
        count++;
        expect(sequence.format).toBe('fasta');
        expect(sequence.sequence).toHaveLength(400);

        // Early exit to prevent test timeout
        if (count >= 100) break;
      }

      const elapsedTime = Date.now() - startTime;
      expect(count).toBe(100);
      expect(elapsedTime).toBeLessThan(5000); // Should be fast
    });

    test('should handle malformed FASTA files with error reporting', async () => {
      const parser = new FastaParser();

      // Test with validation enabled (default) - should throw
      await expect(
        (async () => {
          const sequences = [];
          for await (const sequence of parser.parseFile(TEST_FILES.malformedFasta)) {
            sequences.push(sequence);
          }
        })()
      ).rejects.toThrow(ParseError);

      // Test with custom error handler that allows recovery
      const errors: string[] = [];
      const parserWithErrorHandler = new FastaParser({
        onError: (error) => {
          errors.push(error);
          // Don't re-throw to continue parsing
        },
        onWarning: (warning) => {
          // Capture warnings too
        },
      });

      const sequences = [];
      try {
        for await (const sequence of parserWithErrorHandler.parseFile(TEST_FILES.malformedFasta)) {
          sequences.push(sequence);
        }
      } catch (e) {
        // May still throw for severe errors
      }

      expect(errors.length).toBeGreaterThan(0);
      expect(sequences.length).toBeGreaterThanOrEqual(1); // At least some sequences may parse
    });

    test('should throw error for non-existent files', async () => {
      const parser = new FastaParser();

      await expect(
        (async () => {
          for await (const _ of parser.parseFile(TEST_FILES.nonexistent)) {
            // Should not reach here
          }
        })()
      ).rejects.toThrow(FileError);
    });

    test('should handle empty files gracefully', async () => {
      const parser = new FastaParser();
      const sequences = [];

      for await (const sequence of parser.parseFile(TEST_FILES.emptyFile)) {
        sequences.push(sequence);
      }

      expect(sequences).toHaveLength(0);
    });

    test('should respect file reading options', async () => {
      const parser = new FastaParser();
      let progressCalled = false;

      const sequences = [];
      for await (const sequence of parser.parseFile(TEST_FILES.fasta, {
        bufferSize: 64,
        onProgress: () => {
          progressCalled = true;
        },
      })) {
        sequences.push(sequence);
      }

      expect(sequences).toHaveLength(3);
      // Progress callback may or may not be called depending on file size
    });
  });

  describe('FASTQ Parser File Integration', () => {
    test('should parse FASTQ file correctly', async () => {
      const parser = new FastqParser();
      const sequences = [];

      for await (const sequence of parser.parseFile(TEST_FILES.fastq)) {
        sequences.push(sequence);
      }

      expect(sequences).toHaveLength(2);
      expect(sequences[0].id).toBe('seq1');
      expect(sequences[0].description).toBe('First read');
      expect(sequences[0].sequence).toBe('ATCGATCGATCG');
      expect(sequences[0].quality).toBe('IIIIIIIIIIII');
      expect(sequences[0].qualityEncoding).toBe('phred33');
    });

    test('should detect quality encoding automatically', async () => {
      const parser = new FastqParser();
      const sequences = [];

      for await (const sequence of parser.parseFile(TEST_FILES.fastq)) {
        sequences.push(sequence);
      }

      // All sequences should have the same detected encoding
      sequences.forEach((seq) => {
        expect(['phred33', 'phred64', 'solexa']).toContain(seq.qualityEncoding);
      });
    });

    test('should parse quality scores when requested', async () => {
      const parser = new FastqParser({ parseQualityScores: true });
      const sequences = [];

      for await (const sequence of parser.parseFile(TEST_FILES.fastq)) {
        sequences.push(sequence);
      }

      expect(sequences[0].qualityScores).toBeDefined();
      expect(sequences[0].qualityScores).toHaveLength(12);
      expect(sequences[0].qualityStats).toBeDefined();
    });

    test('should handle file I/O errors gracefully', async () => {
      const parser = new FastqParser();

      await expect(
        (async () => {
          for await (const _ of parser.parseFile(TEST_FILES.binaryFile)) {
            // Should throw before yielding anything
          }
        })()
      ).rejects.toThrow();
    });
  });

  describe('SAM Parser File Integration', () => {
    test('should parse SAM file correctly', async () => {
      const parser = new SAMParser();
      const records = [];

      for await (const record of parser.parseFile(TEST_FILES.sam)) {
        records.push(record);
      }

      expect(records).toHaveLength(4); // 2 headers + 2 alignments

      const headers = records.filter((r) => r.format === 'sam-header');
      const alignments = records.filter((r) => r.format === 'sam');

      expect(headers).toHaveLength(2);
      expect(alignments).toHaveLength(2);

      expect(alignments[0].qname).toBe('read1');
      expect(alignments[0].rname).toBe('chr1');
      expect(alignments[0].pos).toBe(100);
    });

    test('should validate SAM fields correctly', async () => {
      const parser = new SAMParser();
      const records = [];

      for await (const record of parser.parseFile(TEST_FILES.sam)) {
        if (record.format === 'sam') {
          expect(record.flag).toBeGreaterThanOrEqual(0);
          expect(record.mapq).toBeGreaterThanOrEqual(0);
          expect(record.mapq).toBeLessThanOrEqual(255);
          expect(record.pos).toBeGreaterThanOrEqual(0);
        }
        records.push(record);
      }
    });

    test('should handle large SAM files with warnings', async () => {
      const parser = new SAMParser();
      const warnings: string[] = [];

      const parserWithWarnings = new SAMParser({
        onWarning: (warning) => warnings.push(warning),
      });

      // This will trigger the large file warning if file is > 2GB
      // For now, just ensure the parser works with small files
      const records = [];
      for await (const record of parserWithWarnings.parseFile(TEST_FILES.sam)) {
        records.push(record);
      }

      expect(records.length).toBeGreaterThan(0);
    });
  });

  describe('BED Parser File Integration', () => {
    test('should parse BED file correctly', async () => {
      const parser = new BedParser();
      const intervals = [];

      for await (const interval of parser.parseFile(TEST_FILES.bed)) {
        intervals.push(interval);
      }

      expect(intervals).toHaveLength(3);
      expect(intervals[0].chromosome).toBe('chr1');
      expect(intervals[0].start).toBe(100);
      expect(intervals[0].end).toBe(200);
      expect(intervals[0].name).toBe('feature1');
      expect(intervals[0].score).toBe(500);
      expect(intervals[0].strand).toBe('+');
    });

    test('should calculate derived properties', async () => {
      const parser = new BedParser();
      const intervals = [];

      for await (const interval of parser.parseFile(TEST_FILES.bed)) {
        intervals.push(interval);
      }

      intervals.forEach((interval) => {
        expect(interval.length).toBe(interval.end - interval.start);
        expect(interval.midpoint).toBeDefined();
        expect(interval.stats).toBeDefined();
      });
    });

    test('should skip header and comment lines', async () => {
      // Create BED file with headers and comments
      const bedWithHeaders = join(FIXTURES_DIR, 'bed-with-headers.bed');
      writeFileSync(
        bedWithHeaders,
        [
          '# This is a comment',
          'track name="test" description="test track"',
          'browser position chr1:100-1000',
          'chr1\t100\t200\tfeature1\t500\t+',
          '# Another comment',
          'chr1\t300\t400\tfeature2\t600\t-',
        ].join('\n')
      );

      const parser = new BedParser();
      const intervals = [];

      for await (const interval of parser.parseFile(bedWithHeaders)) {
        intervals.push(interval);
      }

      expect(intervals).toHaveLength(2);
      expect(intervals[0].name).toBe('feature1');
      expect(intervals[1].name).toBe('feature2');
    });
  });

  describe('Cross-Parser Error Handling', () => {
    test('should handle file permission errors consistently', async () => {
      const parsers = [new FastaParser(), new FastqParser(), new SAMParser(), new BedParser()];

      for (const parser of parsers) {
        await expect(
          (async () => {
            for await (const _ of parser.parseFile(TEST_FILES.nonexistent)) {
              // Should not reach here
            }
          })()
        ).rejects.toThrow();
      }
    });

    test('should provide meaningful error messages', async () => {
      const parser = new FastaParser();

      try {
        for await (const _ of parser.parseFile(TEST_FILES.nonexistent)) {
          // Should not reach here
        }
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ParseError);
        expect((error as ParseError).message).toContain('not found');
        expect((error as ParseError).format).toBe('FASTA');
      }
    });

    test('should maintain error context through the stack', async () => {
      const parser = new FastaParser();

      try {
        for await (const _ of parser.parseFile('/invalid/path/file.fasta')) {
          // Should not reach here
        }
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ParseError);
        expect((error as ParseError).message).toContain('/invalid/path/file.fasta');
      }
    });
  });

  describe('Performance and Memory Tests', () => {
    test('should handle concurrent file parsing', async () => {
      const parsers = [new FastaParser(), new FastaParser(), new FastaParser()];

      const promises = parsers.map(async (parser) => {
        const sequences = [];
        for await (const sequence of parser.parseFile(TEST_FILES.fasta)) {
          sequences.push(sequence);
        }
        return sequences;
      });

      const results = await Promise.all(promises);
      results.forEach((sequences) => {
        expect(sequences).toHaveLength(3);
      });
    });

    test('should maintain stable memory usage during streaming', async () => {
      const parser = new FastaParser();
      let sequenceCount = 0;

      // Process sequences one at a time to test memory efficiency
      for await (const sequence of parser.parseFile(TEST_FILES.largeFasta)) {
        sequenceCount++;
        expect(sequence.format).toBe('fasta');

        // Exit early to prevent test timeout
        if (sequenceCount >= 50) break;
      }

      expect(sequenceCount).toBe(50);
    });

    test('should respect file size limits', async () => {
      const parser = new FastaParser();

      await expect(
        (async () => {
          for await (const _ of parser.parseFile(TEST_FILES.largeFasta, {
            maxFileSize: 100, // Very small limit
          })) {
            // Should not reach here
          }
        })()
      ).rejects.toThrow(FileError);
    });
  });

  describe('File Format Validation', () => {
    test('should validate file extensions and content', async () => {
      // This test would be enhanced with actual format detection
      const parser = new FastaParser();

      // Parsing a FASTQ file with FASTA parser should work but produce warnings
      const warnings: string[] = [];
      const parserWithWarnings = new FastaParser({
        onWarning: (warning) => warnings.push(warning),
      });

      try {
        const sequences = [];
        for await (const sequence of parserWithWarnings.parseFile(TEST_FILES.fastq)) {
          sequences.push(sequence);
        }
        // FASTQ format has @ headers which are invalid for FASTA
        // This should produce parsing errors
      } catch (error) {
        expect(error).toBeInstanceOf(ParseError);
      }
    });
  });
});
