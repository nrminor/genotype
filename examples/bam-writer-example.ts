/**
 * Example usage of BAM Writer
 * 
 * Demonstrates how to use the BAM Writer to create BAM files from SAM alignment data
 */

import { BAMWriter, type SAMAlignment, type SAMHeader } from '../src';

/**
 * Example: Create a BAM file from SAM alignment data
 */
async function createSampleBAM() {
  console.log('Creating sample BAM file...');
  
  // Create sample header
  const header: SAMHeader[] = [
    {
      format: 'sam-header' as const,
      type: 'HD',
      fields: {
        VN: '1.6',
        SO: 'coordinate'
      }
    },
    {
      format: 'sam-header' as const,
      type: 'SQ',
      fields: {
        SN: 'chr1',
        LN: '248956422'
      }
    },
    {
      format: 'sam-header' as const,
      type: 'SQ',
      fields: {
        SN: 'chr2',
        LN: '242193529'
      }
    }
  ];
  
  // Create sample alignments
  const alignments: SAMAlignment[] = [
    {
      format: 'sam' as const,
      qname: 'read_001',
      flag: 99,
      rname: 'chr1',
      pos: 1000001,
      mapq: 60,
      cigar: '100M',
      rnext: '=',
      pnext: 1000101,
      tlen: 200,
      seq: 'ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT',
      qual: 'IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII',
      tags: [
        { tag: 'AS', type: 'i', value: 100 },
        { tag: 'XS', type: 'i', value: 95 },
        { tag: 'NM', type: 'i', value: 0 }
      ]
    },
    {
      format: 'sam' as const,
      qname: 'read_002',
      flag: 147,
      rname: 'chr1',
      pos: 1000101,
      mapq: 60,
      cigar: '100M',
      rnext: '=',
      pnext: 1000001,
      tlen: -200,
      seq: 'TGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCA',
      qual: 'IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII',
      tags: [
        { tag: 'AS', type: 'i', value: 100 },
        { tag: 'XS', type: 'i', value: 95 },
        { tag: 'NM', type: 'i', value: 0 }
      ]
    },
    {
      format: 'sam' as const,
      qname: 'read_003',
      flag: 4,
      rname: '*',
      pos: 0,
      mapq: 0,
      cigar: '*',
      rnext: '*',
      pnext: 0,
      tlen: 0,
      seq: 'NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN',
      qual: '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      tags: []
    }
  ];
  
  // Create BAM writer with optimized settings
  const writer = BAMWriter.createOptimized({
    compressionLevel: 6,
    enableWarnings: true
  });
  
  try {
    // Method 1: Write to memory
    console.log('Writing BAM to memory...');
    const bamData = await writer.writeString(header, alignments);
    console.log(`Created BAM file in memory: ${bamData.length} bytes`);
    
    // Method 2: Write to file (Bun only)
    if (typeof Bun !== 'undefined') {
      console.log('Writing BAM to file...');
      await writer.writeFile('sample.bam', header, alignments);
      console.log('Created sample.bam file');
    } else {
      console.log('File writing requires Bun runtime (skipped)');
    }
    
    // Display writer info
    const info = writer.getWriterInfo();
    console.log('Writer configuration:', {
      compressionLevel: info.compressionInfo.compressionLevel,
      blockSize: info.compressionInfo.blockSize,
      bunOptimized: info.bunOptimized,
      maxAlignmentSize: info.options.maxAlignmentSize
    });
    
    return bamData;
    
  } catch (error) {
    console.error('BAM creation failed:', error);
    throw error;
  }
}

/**
 * Example: Streaming BAM creation for large datasets
 */
async function createLargeBAMStream() {
  console.log('Creating large BAM using streaming...');
  
  const header: SAMHeader[] = [
    {
      format: 'sam-header' as const,
      type: 'HD',
      fields: { VN: '1.6', SO: 'coordinate' }
    },
    {
      format: 'sam-header' as const,
      type: 'SQ',
      fields: { SN: 'chr1', LN: '248956422' }
    }
  ];
  
  // Create a generator for large alignment dataset
  async function* generateAlignments(count: number): AsyncGenerator<SAMAlignment> {
    for (let i = 0; i < count; i++) {
      yield {
        format: 'sam' as const,
        qname: `read_${i.toString().padStart(6, '0')}`,
        flag: i % 2 === 0 ? 99 : 147,
        rname: 'chr1',
        pos: 1000000 + (i * 100),
        mapq: 60,
        cigar: '100M',
        rnext: '=',
        pnext: 1000000 + (i * 100) + (i % 2 === 0 ? 100 : -100),
        tlen: i % 2 === 0 ? 200 : -200,
        seq: 'A'.repeat(100),
        qual: 'I'.repeat(100),
        tags: [
          { tag: 'AS', type: 'i', value: 100 },
          { tag: 'NM', type: 'i', value: 0 }
        ]
      };
    }
  }
  
  const writer = new BAMWriter({
    compressionLevel: 1, // Fast compression for streaming
    bufferSize: 512 * 1024 // 512KB buffer
  });
  
  try {
    // Stream 1000 alignments
    const bamData = await writer.writeString(header, generateAlignments(1000));
    console.log(`Created streaming BAM: ${bamData.length} bytes`);
    
    return bamData;
    
  } catch (error) {
    console.error('Streaming BAM creation failed:', error);
    throw error;
  }
}

/**
 * Example: Demonstrate different compression levels
 */
async function compareCompressionLevels() {
  console.log('Comparing compression levels...');
  
  const header: SAMHeader[] = [
    {
      format: 'sam-header' as const,
      type: 'HD',
      fields: { VN: '1.6', SO: 'coordinate' }
    }
  ];
  
  // Create test alignment with repetitive data (compresses well)
  const testAlignment: SAMAlignment = {
    format: 'sam' as const,
    qname: 'test_read',
    flag: 0,
    rname: '*',
    pos: 0,
    mapq: 0,
    cigar: '*',
    rnext: '*',
    pnext: 0,
    tlen: 0,
    seq: 'AAAAAAAAAA'.repeat(50), // 500 A's
    qual: 'I'.repeat(500),
    tags: []
  };
  
  const results: Array<{ level: number; size: number; time: number }> = [];
  
  for (const level of [1, 6, 9]) {
    const writer = new BAMWriter({ compressionLevel: level });
    
    const startTime = performance.now();
    const bamData = await writer.writeString(header, [testAlignment]);
    const endTime = performance.now();
    
    results.push({
      level,
      size: bamData.length,
      time: endTime - startTime
    });
    
    console.log(`Level ${level}: ${bamData.length} bytes in ${(endTime - startTime).toFixed(2)}ms`);
  }
  
  // Show compression ratios
  const baseSize = results[0].size;
  for (const result of results) {
    const ratio = ((baseSize - result.size) / baseSize * 100).toFixed(1);
    console.log(`Level ${result.level}: ${ratio}% smaller than level 1`);
  }
  
  return results;
}

// Run examples if this file is executed directly
if (import.meta.main) {
  try {
    await createSampleBAM();
    console.log('---');
    await createLargeBAMStream();
    console.log('---');
    await compareCompressionLevels();
    
  } catch (error) {
    console.error('Example failed:', error);
    process.exit(1);
  }
}

export {
  createSampleBAM,
  createLargeBAMStream,
  compareCompressionLevels
};