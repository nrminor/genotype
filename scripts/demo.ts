#!/usr/bin/env bun
/**
 * Demo script showcasing the Genotype library
 */

import { 
  FastaParser, 
  FastqParser, 
  BedParser,
  detectFormat,
  FastaUtils
} from '../src/index';

// Demo FASTA data
const fastaData = `>sequence1 Sample DNA sequence
ATCGATCGATCGATCGATCGATCGATCGATCG
ATCGATCGATCGATCGATCGATCGATCGATCG
>sequence2 Another sequence with ambiguous bases
ATCGATCGNNATCGATCGATCGATCGATCGATCG
>sequence3
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT`;

// Demo FASTQ data
const fastqData = `@read1 first read
ATCGATCGATCGATCGATCGATC
+
IIIIIIIIIIIIIIIIIIIIIII
@read2 second read with lower quality
GGGGGGGGGGGGGGGGGGGGGG
+
######################`;

// Demo BED data
const bedData = `chr1	1000	2000	item1	100	+
chr1	3000	4000	item2	200	-
chr2	5000	6000	item3	300	.`;

async function main() {
  console.log('🧬 Genotype Library Demo\n');
  
  // Format detection
  console.log('📊 Format Detection:');
  console.log('FASTA:', detectFormat(fastaData));
  console.log('FASTQ:', detectFormat(fastqData));
  console.log('BED:', detectFormat(bedData));
  console.log();
  
  // FASTA parsing
  console.log('🧬 FASTA Parsing:');
  const fastaParser = new FastaParser();
  for await (const sequence of fastaParser.parseString(fastaData)) {
    const stats = FastaUtils.calculateStats(sequence.sequence);
    console.log(`- ${sequence.id}: ${sequence.length} bp, GC=${(stats.gcContent * 100).toFixed(1)}%`);
  }
  console.log();
  
  // FASTQ parsing with quality analysis
  console.log('🔬 FASTQ Parsing:');
  const fastqParser = new FastqParser({ parseQualityScores: true });
  for await (const read of fastqParser.parseString(fastqData)) {
    console.log(`- ${read.id}: ${read.length} bp, encoding=${read.qualityEncoding}`);
    if (read.qualityScores) {
      const avgQuality = read.qualityScores.reduce((a, b) => a + b, 0) / read.qualityScores.length;
      console.log(`  Average quality: ${avgQuality.toFixed(1)}`);
    }
  }
  console.log();
  
  // BED parsing
  console.log('🗺️  BED Parsing:');
  const bedParser = new BedParser();
  for await (const interval of bedParser.parseString(bedData)) {
    const length = interval.end - interval.start;
    console.log(`- ${interval.chromosome}:${interval.start}-${interval.end} (${length} bp)`);
    if (interval.name) console.log(`  Name: ${interval.name}`);
    if (interval.strand) console.log(`  Strand: ${interval.strand}`);
  }
  console.log();
  
  console.log('✅ Demo completed successfully!');
}

if (import.meta.main) {
  main().catch(console.error);
}