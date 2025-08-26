#!/usr/bin/env bun

/**
 * Demonstrate motif location finding functionality
 *
 * This example shows how to use the locate operation to find pattern
 * occurrences within sequences, similar to `seqkit locate`.
 *
 * Features demonstrated:
 * - Basic pattern location
 * - Fuzzy matching with mismatches
 * - Both-strand searching
 * - Different output formats
 * - Transcription factor binding site finding
 * - Restriction enzyme site mapping
 *
 * Usage: bun examples/seqkit-locate.ts
 */

import { seqops } from '../src/operations';
import type { FastaSequence, MotifLocation } from '../src/types';

// Sample genomic sequences for demonstration
const sampleSequences: FastaSequence[] = [
  {
    format: 'fasta',
    id: 'promoter_region_1',
    sequence: 'ATATAAGGCCTTAATAGGTCCCGGGAAATATAAGCTTATCGATCGATCG',
    length: 48,
    description: 'Promoter region with TATA box and restriction sites',
  },
  {
    format: 'fasta',
    id: 'coding_sequence_1',
    sequence: 'ATGAAATTTCCCGGATCCATCGATCGATCGTAGCTGAATTCGATCGATAA',
    length: 49,
    description: 'Coding sequence with start codon and enzyme sites',
  },
  {
    format: 'fasta',
    id: 'regulatory_element',
    sequence: 'GCGCGCTATAAAGGCCAAATTGGCCGCGCATATTTGCGCGCGCGCGCGC',
    length: 47,
    description: 'Regulatory element with palindromic sequences',
  },
  {
    format: 'fasta',
    id: 'repetitive_sequence',
    sequence: 'ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG',
    length: 46,
    description: 'Repetitive sequence for testing overlapping matches',
  },
];

/**
 * Helper function to convert async iterable to array
 */
async function collectResults<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iterable) {
    results.push(item);
  }
  return results;
}

/**
 * Display motif locations in a readable format
 */
function displayLocations(locations: MotifLocation[], title: string): void {
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));

  if (locations.length === 0) {
    console.log('No matches found.');
    return;
  }

  for (const location of locations) {
    console.log(
      `${location.sequenceId}: ${location.start + 1}-${location.end} (${location.strand})`
    );
    console.log(`  Pattern: ${location.pattern}`);
    console.log(`  Matched: ${location.matchedSequence}`);
    console.log(`  Score: ${location.score.toFixed(3)} (${location.mismatches} mismatches)`);

    if (location.context) {
      const upstream = location.context.upstream || '';
      const downstream = location.context.downstream || '';
      console.log(`  Context: ${upstream}[${location.matchedSequence}]${downstream}`);
    }
    console.log('');
  }
}

/**
 * Example 1: Basic exact pattern matching
 */
async function basicPatternMatching(): Promise<void> {
  console.log('\n🔍 EXAMPLE 1: Basic Pattern Matching');

  // Find ATCG motifs in all sequences
  const locations = await collectResults(seqops.from(sampleSequences).locate('ATCG'));

  displayLocations(locations, 'ATCG Pattern Matches');
}

/**
 * Example 2: Finding transcription factor binding sites
 */
async function findTFBindingSites(): Promise<void> {
  console.log('\n🧬 EXAMPLE 2: Transcription Factor Binding Sites');

  // Find TATA box motifs with up to 1 mismatch
  const tataBoxes = await collectResults(
    seqops.from(sampleSequences).locate({
      pattern: 'TATAAA',
      allowMismatches: 1,
      ignoreCase: true,
    })
  );

  displayLocations(tataBoxes, 'TATA Box Binding Sites (≤1 mismatch)');

  // Find GC-rich regulatory elements
  const gcBoxes = await collectResults(
    seqops.from(sampleSequences).locate({
      pattern: /GC[CG][CG]GC/,
      outputFormat: 'default',
    })
  );

  displayLocations(gcBoxes, 'GC-rich Regulatory Elements (regex)');
}

/**
 * Example 3: Restriction enzyme site mapping
 */
async function mapRestrictionSites(): Promise<void> {
  console.log('\n✂️  EXAMPLE 3: Restriction Enzyme Site Mapping');

  // Common restriction enzyme recognition sequences
  const enzymes = [
    { name: 'EcoRI', pattern: 'GAATTC' },
    { name: 'BamHI', pattern: 'GGATCC' },
    { name: 'HindIII', pattern: 'AAGCTT' },
    { name: 'SacI', pattern: 'GAGCTC' },
  ];

  for (const enzyme of enzymes) {
    const sites = await collectResults(
      seqops.from(sampleSequences).locate({
        pattern: enzyme.pattern,
        searchBothStrands: true,
      })
    );

    if (sites.length > 0) {
      displayLocations(sites, `${enzyme.name} Sites (${enzyme.pattern})`);
    }
  }
}

/**
 * Example 4: Fuzzy matching for variant detection
 */
async function fuzzyMatching(): Promise<void> {
  console.log('\n🎯 EXAMPLE 4: Fuzzy Matching for Sequence Variants');

  // Find sequences similar to a reference motif
  const fuzzyMatches = await collectResults(
    seqops.from(sampleSequences).locate({
      pattern: 'ATATAAGG',
      allowMismatches: 2,
      maxMatches: 5,
    })
  );

  displayLocations(fuzzyMatches, 'Fuzzy Matches for ATATAAGG (≤2 mismatches)');
}

/**
 * Example 5: Both-strand searching for palindromes
 */
async function palindromeSearch(): Promise<void> {
  console.log('\n🔄 EXAMPLE 5: Palindromic Sequence Detection');

  // Search for palindromic restriction sites
  const palindromes = await collectResults(
    seqops.from(sampleSequences).locate({
      pattern: 'GGCC',
      searchBothStrands: true,
      allowOverlaps: false,
    })
  );

  displayLocations(palindromes, 'Palindromic GGCC Sites (both strands)');
}

/**
 * Example 6: Complex regulatory motif analysis
 */
async function complexMotifAnalysis(): Promise<void> {
  console.log('\n📊 EXAMPLE 6: Complex Motif Analysis');

  // Create a custom sequence with known motifs
  const analysisSeqs: FastaSequence[] = [
    {
      format: 'fasta',
      id: 'test_promoter',
      sequence: 'ATATAAGGCTATAAGGGCCCAATTGCTGCAGAATTCGGATCCATCGATCGTAGCTTCGA',
      length: 57,
      description: 'Test promoter with multiple regulatory elements',
    },
  ];

  // Find all significant motifs
  const motifs = [
    { name: 'TATA Box', pattern: 'TATAAG', mismatches: 1 },
    { name: 'CCAAT Box', pattern: 'CCAAT', mismatches: 0 },
    { name: 'GC Box', pattern: 'GGCCC', mismatches: 1 },
    { name: 'Start Codon', pattern: 'ATG', mismatches: 0 },
  ];

  for (const motif of motifs) {
    const matches = await collectResults(
      seqops.from(analysisSeqs).locate({
        pattern: motif.pattern,
        allowMismatches: motif.mismatches,
        searchBothStrands: true,
      })
    );

    if (matches.length > 0) {
      displayLocations(matches, `${motif.name} (${motif.pattern})`);
    }
  }
}

/**
 * Example 7: BED format output simulation
 */
async function bedFormatOutput(): Promise<void> {
  console.log('\n📋 EXAMPLE 7: BED-style Output Format');

  const bedStyle = await collectResults(
    seqops.from(sampleSequences).locate({
      pattern: 'ATCG',
      outputFormat: 'bed',
      maxMatches: 10,
    })
  );

  console.log('\nBED-style Output (no context):');
  console.log('sequence_id\tstart\tend\tstrand\tmatch\tscore');
  console.log('-'.repeat(60));

  for (const location of bedStyle) {
    console.log(
      `${location.sequenceId}\t${location.start}\t${location.end}\t${location.strand}\t${location.matchedSequence}\t${location.score.toFixed(3)}`
    );
  }
}

/**
 * Example 8: Performance demonstration with overlapping matches
 */
async function performanceDemo(): Promise<void> {
  console.log('\n⚡ EXAMPLE 8: Overlapping Matches Performance');

  // Test with and without overlapping matches
  const startTime = performance.now();

  const overlapAllowed = await collectResults(
    seqops.from(sampleSequences).locate({
      pattern: 'ATCG',
      allowOverlaps: true,
    })
  );

  const overlapFiltered = await collectResults(
    seqops.from(sampleSequences).locate({
      pattern: 'ATCG',
      allowOverlaps: false,
    })
  );

  const endTime = performance.now();

  console.log(`\nProcessing completed in ${(endTime - startTime).toFixed(2)}ms`);
  console.log(`Overlaps allowed: ${overlapAllowed.length} matches`);
  console.log(`Overlaps filtered: ${overlapFiltered.length} matches`);

  displayLocations(overlapFiltered.slice(0, 5), 'First 5 Non-overlapping ATCG Matches');
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  console.log('🧬 GenoType Locate Operation Examples');
  console.log('=====================================');
  console.log('This script demonstrates various motif location finding capabilities.');

  try {
    await basicPatternMatching();
    await findTFBindingSites();
    await mapRestrictionSites();
    await fuzzyMatching();
    await palindromeSearch();
    await complexMotifAnalysis();
    await bedFormatOutput();
    await performanceDemo();

    console.log('\n✅ All examples completed successfully!');
    console.log('\n💡 Key Features Demonstrated:');
    console.log('  • Exact and fuzzy pattern matching');
    console.log('  • Both-strand searching with reverse complement');
    console.log('  • Multiple output formats (default, BED)');
    console.log('  • Overlap filtering and scoring');
    console.log('  • Bioinformatics-specific motif finding');
    console.log('  • Performance optimizations');
  } catch (error) {
    console.error('❌ Error running examples:', error);
    process.exit(1);
  }
}

// Run the examples
if (import.meta.main) {
  await main();
}
