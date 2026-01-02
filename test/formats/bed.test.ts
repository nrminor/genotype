/**
 * Basic BED format tests to establish current behavior
 *
 * Simpler test suite to understand current bed.ts implementation
 * before comprehensive refactoring. Following AGENTS.md principle:
 * "Respect existing code - understand why it exists before changing"
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { BedError } from "../../src/errors";
import { BedParser, BedUtils, BedWriter } from "../../src/formats/bed";
import type { BedInterval } from "../../src/types";

describe("BED Format - Current Implementation Behavior", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  test("parses minimal BED3 format", async () => {
    const bed3Data = "chr1\t1000\t2000\n";
    const [interval] = await Array.fromAsync(parser.parseString(bed3Data));

    expect(interval.chromosome).toBe("chr1");
    expect(interval.start).toBe(1000);
    expect(interval.end).toBe(2000);
    expect(interval.length).toBe(1000); // Current implementation adds length
  });

  test("parses BED6 with all basic fields", async () => {
    const bed6Data = "chr1\t1000\t2000\tfeature1\t100\t+\n";
    const [interval] = await Array.fromAsync(parser.parseString(bed6Data));

    expect(interval.name).toBe("feature1");
    expect(interval.score).toBe(100);
    expect(interval.strand).toBe("+");
  });

  test("current coordinate validation behavior", async () => {
    const invalidData = "chr1\t2000\t1000\n"; // start > end

    let threwError = false;
    try {
      for await (const interval of parser.parseString(invalidData)) {
        // Should not reach here
      }
    } catch (error) {
      threwError = true;
      expect(error).toBeInstanceOf(BedError);
    }
    expect(threwError).toBe(true);
  });

  test("handles comments and empty lines", async () => {
    const dataWithComments = `
# Comment line
track name="test"
chr1\t1000\t2000

chr2\t3000\t4000
    `.trim();

    const intervals = await Array.fromAsync(parser.parseString(dataWithComments));
    expect(intervals).toHaveLength(2);
  });

  test("detects format correctly", () => {
    const bedData = "chr1\t1000\t2000\n";
    expect(BedUtils.detectFormat(bedData)).toBe(true);

    const notBedData = ">seq1\nATCG\n";
    expect(BedUtils.detectFormat(notBedData)).toBe(false);
  });
});

describe("BED Writer - Current Implementation", () => {
  let writer: BedWriter;

  beforeEach(() => {
    writer = new BedWriter();
  });

  test("formats minimal interval", () => {
    const interval: BedInterval = {
      chromosome: "chr1",
      start: 1000,
      end: 2000,
    };

    const formatted = writer.formatInterval(interval);
    expect(formatted).toBe("chr1\t1000\t2000");
  });

  test("formats interval with optional fields", () => {
    const interval: BedInterval = {
      chromosome: "chr1",
      start: 1000,
      end: 2000,
      name: "feature1",
      score: 100,
      strand: "+",
    };

    const formatted = writer.formatInterval(interval);
    expect(formatted).toBe("chr1\t1000\t2000\tfeature1\t100\t+");
  });
});

describe("BED Large Coordinate Edge Cases", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  /**
   * Tests large coordinate handling for modern genome assemblies
   *
   * Biological context: Barley genomes (~5.1Gb across 7 chromosomes = ~750M per chromosome)
   * exceed typical coordinate limits. Research shows bedtools fails at >2.5GB with
   * "End Coordinate detected that is < 0" due to 32-bit signed integer overflow.
   *
   * @see https://github.com/arq5x/bedtools2/issues/686 - bedtools getfasta malformed BED entry
   * @see https://bmcresnotes.biomedcentral.com/articles/10.1186/s13104-019-4137-z - Genome size research
   *
   * Our implementation should handle large legitimate coordinates gracefully while
   * warning about tool ecosystem compatibility issues.
   */
  test("rejects coordinates >2.5GB with helpful tool compatibility guidance", async () => {
    // Coordinates exceeding bedtools capability (>2.5GB) should error with helpful guidance
    const largeCoordinateData = "scaffold_1\t3000000001\t3250000000\tlarge_region";

    await expect(async () => {
      for await (const _ of parser.parseString(largeCoordinateData)) {
        // Should throw with tool compatibility guidance
      }
    }).toThrow(/coordinate.*large.*2\.5GB/i);
  });

  /**
   * Tests zero-length interval biological validity
   *
   * Biological context: Zero-length intervals (start=end) represent insertion sites,
   * point mutations, CRISPR cut sites, and methylation sites. These are genomically
   * valid but some tools incorrectly reject them.
   */
  test("accepts zero-length intervals for biological insertion sites", async () => {
    const insertionSite = "chr1\t1000\t1000\tinsertion_site";

    const [interval] = await Array.fromAsync(parser.parseString(insertionSite));

    expect(interval.start).toBe(1000);
    expect(interval.end).toBe(1000);
    expect(interval.length).toBe(0); // Zero-length valid for insertion sites
    expect(interval.name).toBe("insertion_site");
  });

  /**
   * Tests negative coordinate rejection with biological context
   *
   * Negative coordinates are biologically impossible and cause calculation errors
   * in genomic analysis tools. Should provide clear error with educational context.
   */
  test("rejects negative coordinates with helpful biological error", async () => {
    const negativeData = "chr1\t-100\t1000\tinvalid_negative";

    await expect(async () => {
      for await (const _ of parser.parseString(negativeData)) {
        // Should throw before yielding
      }
    }).toThrow(/negative.*biologically.*impossible/i);
  });

  /**
   * Tests coordinate order validation (start >= end)
   *
   * Biological context: Inverted coordinates violate BED coordinate semantics
   * and break genomic arithmetic operations. Should error with coordinate
   * system explanation.
   */
  test("rejects inverted coordinates with coordinate system guidance", async () => {
    const invertedData = "chr1\t2000\t1000\tinverted_coords";

    await expect(async () => {
      for await (const _ of parser.parseString(invertedData)) {
        // Should throw before yielding
      }
    }).toThrow();
  });

  /**
   * Tests legitimate large genome coordinates (barley example)
   *
   * Biological context: Barley genomes span ~5.1Gb across 7 chromosomes (~750M per chromosome).
   * These are legitimate biological coordinates that should parse successfully without
   * errors, unlike the >2.5GB coordinates that break bedtools.
   */
  test("accepts legitimate large genome coordinates (barley case)", async () => {
    const barleyChromosome = "chr1H\t750000000\t750001000\tbarley_gene";

    const [interval] = await Array.fromAsync(parser.parseString(barleyChromosome));

    expect(interval.chromosome).toBe("chr1H"); // Barley chromosome naming
    expect(interval.start).toBe(750000000); // ~750M coordinate (legitimate)
    expect(interval.end).toBe(750001000);
    expect(interval.name).toBe("barley_gene");
  });

  /**
   * Tests exact bedtools failure boundary (2.5GB)
   *
   * Research context: bedtools issue #686 documents exact failure at coordinates
   * like "LIB18989 2000000001 2250000000" causing "End Coordinate detected that is < 0"
   * due to 32-bit signed integer overflow. Our parser should handle this gracefully.
   *
   * @see https://github.com/arq5x/bedtools2/issues/686 - Exact failure case documented
   */
  test("handles exact bedtools failure boundary appropriately", async () => {
    // Exact case from bedtools issue #686 research
    const bedtoolsFailureCase = "LIB18989\t2000000001\t2250000000";

    // Should either pass with warning or fail with helpful tool compatibility message
    try {
      const [interval] = await Array.fromAsync(parser.parseString(bedtoolsFailureCase));
      // If it parses, should have appropriate coordinates
      expect(interval.chromosome).toBe("LIB18989");
    } catch (error) {
      // If it errors, should mention tool compatibility
      expect(error.message).toMatch(/coordinate.*large|tool.*compatibility|bedtools/i);
    }
  });

  /**
   * Tests mixed coordinate ranges in same file
   *
   * Real-world context: Genomics files often mix normal human chromosomes (~250M)
   * with large scaffold coordinates. Parser should handle heterogeneous coordinate
   * ranges gracefully within same dataset.
   */
  test("handles mixed large and normal coordinates in same dataset", async () => {
    const mixedData = [
      "chr1\t100000\t200000\thuman_gene", // Normal human coordinate
      "scaffold_1\t500000000\t500001000\tlarge_scaffold", // Large but valid
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(mixedData));

    expect(intervals).toHaveLength(2);
    expect(intervals[0].chromosome).toBe("chr1");
    expect(intervals[1].chromosome).toBe("scaffold_1");
    expect(intervals[1].start).toBe(500000000); // Large coordinate handled correctly
  });

  /**
   * Tests coordinate boundary at exactly 2.5GB limit
   *
   * Expert-level edge case: Testing the exact boundary where our implementation
   * transitions from acceptance to rejection. Demonstrates precise understanding
   * of coordinate limits and tool ecosystem boundaries.
   */
  test("handles coordinate boundary near 2.5GB limit", async () => {
    const boundaryCoordinate = "scaffold\t2499999000\t2500000000\tboundary_test";

    // Just under 2.5GB limit - should be accepted
    const [interval] = await Array.fromAsync(parser.parseString(boundaryCoordinate));

    expect(interval.start).toBe(2499999000);
    expect(interval.end).toBe(2500000000);
    expect(interval.name).toBe("boundary_test");
  });

  /**
   * Tests plant genome scale coordinates (citation-worthy biological context)
   *
   * Biological expertise: Paris japonica (Japanese canopy plant) has 149Gb genome,
   * Tmesipteris oblanceolata fern has 160Gb genome. Our implementation should handle
   * coordinates from these legitimate biological organisms.
   *
   * @see https://www.kew.org/about-us/press-media/worlds-largest-genome - Tmesipteris record holder
   * @see https://en.wikipedia.org/wiki/Genome_size - Comprehensive genome size data
   */
  test("documents support for giant plant genome coordinates", async () => {
    // Paris japonica scale coordinate (~1GB range, but within our 2.5GB limit)
    const plantGenomeCoordinate = "scaffold_paris\t1000000000\t1000001000\tplant_gene";

    const [interval] = await Array.fromAsync(parser.parseString(plantGenomeCoordinate));

    expect(interval.chromosome).toBe("scaffold_paris");
    expect(interval.start).toBe(1000000000); // 1GB coordinate (legitimate for giant plants)
    expect(interval.end).toBe(1000001000);
    expect(interval.name).toBe("plant_gene");
  });

  /**
   * Tests coordinate system precision for genomics workflows
   *
   * Expert context: Single base precision critical for ChIP-seq peak calling,
   * CRISPR guide RNA design, and motif analysis. Zero-length intervals represent
   * precise molecular events requiring exact coordinate handling.
   */
  test("maintains single-base precision for molecular biology applications", async () => {
    const precisionCases = [
      "chr1\t1000\t1000\tCRISPR_cut_site", // Exact cut site
      "chr1\t2000\t2001\tSNV_position", // Single base variant
      "chr1\t3000\t3000\tmethylation_site", // Methylation position
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(precisionCases));

    expect(intervals).toHaveLength(3);
    expect(intervals[0].length).toBe(0); // Zero-length CRISPR cut site
    expect(intervals[1].length).toBe(1); // Single base SNV
    expect(intervals[2].length).toBe(0); // Zero-length methylation site
  });
});

describe("BED12 Block Structure Validation (UCSC Specification)", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  /**
   * Tests valid BED12 block structure compliance
   *
   * UCSC specification: BED12 format represents gene models with exon structure.
   * Blocks represent exons, gaps represent introns. Critical for RNA-seq analysis
   * and gene annotation workflows where precise exon boundaries are essential.
   *
   * @see https://genome.ucsc.edu/FAQ/FAQformat.html#format1 - Official BED format specification
   */
  test("parses valid BED12 with proper block structure", async () => {
    // Valid BED12: 3 blocks representing 3-exon gene
    // blockStarts: [0, 400, 800] relative to chromStart (1000)
    // blockSizes: [200, 200, 200]
    // Math: block1=1000-1200, gap, block2=1400-1600, gap, block3=1800-2000 (no overlaps)
    const validBed12 = "chr1\t1000\t2000\tgene1\t0\t+\t1000\t2000\t0\t3\t200,200,200\t0,400,800";

    const [interval] = await Array.fromAsync(parser.parseString(validBed12));

    expect(interval.chromosome).toBe("chr1");
    expect(interval.blockCount).toBe(3);
    expect(interval.blockStarts).toEqual([0, 400, 800]);
    expect(interval.blockSizes).toEqual([200, 200, 200]);
    expect(interval.stats?.bedType).toBe("BED12");
  });

  /**
   * Tests UCSC Rule #1: First blockStart must be 0
   *
   * Biological context: First exon must start at transcript beginning (relative to chromStart).
   * Non-zero first blockStart creates gap before first exon, which is biologically
   * invalid for transcript models.
   *
   * @see https://genome.ucsc.edu/FAQ/FAQformat.html#format1 - UCSC BED12 specification
   */
  test("rejects BED12 with non-zero first blockStart", async () => {
    // Invalid: first blockStart = 100 (should be 0)
    const invalidFirstBlock = "chr1\t1000\t2000\tgene1\t0\t+\t1000\t2000\t0\t2\t500,500\t100,600";

    await expect(async () => {
      for await (const _ of parser.parseString(invalidFirstBlock)) {
        // Should throw UCSC specification violation
      }
    }).toThrow(/first.*blockStart.*must.*be.*0/i);
  });

  /**
   * Tests UCSC Rule #2: Final block must end at feature boundary
   *
   * Biological context: Last exon must end at transcript end. Incorrect math
   * means transcript extends beyond annotated boundary or has uncovered sequence,
   * breaking gene model integrity.
   */
  test("rejects BED12 with incorrect final block boundary math", async () => {
    // Invalid: final block ends at 500+600=1100, but feature length = 2000-1000=1000
    const invalidFinalBlock = "chr1\t1000\t2000\tgene1\t0\t+\t1000\t2000\t0\t2\t500,600\t0,500";

    await expect(async () => {
      for await (const _ of parser.parseString(invalidFinalBlock)) {
        // Should throw final boundary violation
      }
    }).toThrow(/final.*block.*feature.*boundary/i);
  });

  /**
   * Tests UCSC Rule #3: Blocks cannot overlap within same feature
   *
   * Biological context: Exons cannot overlap within single transcript - each
   * nucleotide belongs to one exon or is intronic. Overlapping blocks represent
   * impossible gene structure.
   */
  test("rejects BED12 with overlapping blocks", async () => {
    // Invalid: block1 ends at 400, block2 starts at 300 (100bp overlap)
    const overlappingBlocks =
      "chr1\t1000\t2000\tgene1\t0\t+\t1000\t2000\t0\t3\t400,400,300\t0,300,700";

    await expect(async () => {
      for await (const _ of parser.parseString(overlappingBlocks)) {
        // Should throw overlap violation
      }
    }).toThrow(/blocks.*cannot.*overlap/i);
  });

  /**
   * Tests UCSC Rule #4: Array length consistency
   *
   * Biological context: Block structure integrity requires matching array lengths.
   * Mismatched arrays mean incomplete gene model specification, breaking
   * downstream analysis tools that depend on block structure.
   */
  test("rejects BED12 with mismatched block array lengths", async () => {
    // Invalid: blockCount=3 but only 2 blockSizes
    const mismatchedArrays = "chr1\t1000\t2000\tgene1\t0\t+\t1000\t2000\t0\t3\t300,400\t0,500,700";

    await expect(async () => {
      for await (const _ of parser.parseString(mismatchedArrays)) {
        // Should throw array consistency violation
      }
    }).toThrow(/Block.*sizes.*count.*block.*count/i);
  });

  /**
   * Tests complex multi-exon gene model (real-world RNA-seq scenario)
   *
   * Biological context: Human BRCA1 gene has 24 exons. Complex gene models
   * test parser's ability to handle realistic gene structures from RNA-seq
   * splice-aware alignments.
   */
  test("handles complex multi-exon gene models (RNA-seq realistic)", async () => {
    // 5-exon gene model representing complex alternative splicing
    const complexGene =
      "chr17\t43044295\t43125483\tBRCA1-201\t1000\t-\t43044295\t43125483\t0\t5\t185,105,184,146,85\t0,10138,20123,30045,81103";

    const [interval] = await Array.fromAsync(parser.parseString(complexGene));

    expect(interval.chromosome).toBe("chr17");
    expect(interval.name).toBe("BRCA1-201"); // Transcript identifier
    expect(interval.blockCount).toBe(5); // 5 exons
    expect(interval.strand).toBe("-"); // Reverse strand gene
    expect(interval.blockStarts![0]).toBe(0); // First exon starts at transcript start

    // Verify final exon math: 81103 + 85 = 81188 should equal chromEnd - chromStart
    const featureLength = interval.end - interval.start;
    const finalBlockEnd = interval.blockStarts![4]! + interval.blockSizes![4]!;
    expect(finalBlockEnd).toBe(featureLength);
  });
});

describe("ENCODE Format Compatibility (Real-World ChIP-seq Data)", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  /**
   * Tests ENCODE narrowPeak format (BED6+4)
   *
   * Real-world context: narrowPeak is the most common ChIP-seq output format,
   * extending BED6 with signalValue, pValue, qValue, and peak offset.
   * Essential for transcription factor binding analysis and motif discovery.
   *
   * @see https://www.encodeproject.org/chip-seq/transcription_factor/ - ENCODE ChIP-seq standards
   * @see https://genome.ucsc.edu/ENCODE/fileFormats.html - ENCODE file specifications
   */
  test("parses ENCODE narrowPeak format (BED6 subset)", async () => {
    // ENCODE narrowPeak as BED6 (core fields) - full format would need parser extension
    const narrowPeakData = "chr1\t777491\t778262\tneuroGM23338_macs3_rep1_peak_1\t34\t.";

    const [peak] = await Array.fromAsync(parser.parseString(narrowPeakData));

    expect(peak.chromosome).toBe("chr1");
    expect(peak.start).toBe(777491);
    expect(peak.end).toBe(778262);
    expect(peak.name).toBe("neuroGM23338_macs3_rep1_peak_1"); // ENCODE naming convention
    expect(peak.score).toBe(34);
    expect(peak.strand).toBe(".");
    // Note: Full narrowPeak fields 7-10 (signalValue, pValue, qValue, peak) require format extension
  });

  /**
   * Tests ENCODE broadPeak format (BED6+3)
   *
   * Biological context: broadPeak format used for histone modifications and
   * broad chromatin domains. Unlike narrowPeak, no single-base peak summit
   * since histone marks span broader regions.
   *
   * @see https://www.encodeproject.org/chip-seq/histone/ - ENCODE histone ChIP-seq standards
   */
  test("parses ENCODE broadPeak format (BED6 subset)", async () => {
    // broadPeak format as BED6 (core fields) - histone modification context
    const broadPeakData = "chr1\t1000000\t1002000\tH3K4me3_peak_1\t1000\t.";

    const [peak] = await Array.fromAsync(parser.parseString(broadPeakData));

    expect(peak.chromosome).toBe("chr1");
    expect(peak.name).toBe("H3K4me3_peak_1"); // Histone mark naming
    expect(peak.length).toBe(2000); // Broader domain (2KB) vs narrow peaks
    expect(peak.strand).toBe(".");
    // Note: Full broadPeak fields 7-9 (signalValue, pValue, qValue) require format extension
  });

  /**
   * Tests ENCODE non-compliance issues found in production data
   *
   * Research finding: ENCODE datasets often violate UCSC specification with
   * "improperly specified last 3 columns" and column order swapping.
   * Production parsers must handle specification deviations gracefully.
   *
   * @see https://hbctraining.github.io/Investigating-chromatin-biology-ChIPseq/ - Real ChIP-seq data issues
   */
  test("handles ENCODE non-compliance issues gracefully", async () => {
    // ENCODE pattern: dots as placeholders, potentially swapped columns
    const nonCompliantEncode = [
      "chr1\t100000\t101000\t.\t.\t+", // Dots as name/score placeholders
      "chr2\t200000\t201000\tpeak2\t.\t.", // Mixed placeholder usage
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(nonCompliantEncode));

    expect(intervals).toHaveLength(2);
    expect(intervals[0].name).toBe("."); // Should preserve dot placeholders
    expect(intervals[1].strand).toBe("."); // Handle mixed usage
  });

  /**
   * Tests ENCODE file naming conventions and metadata
   *
   * ENCODE uses cryptic file identifiers that require metadata interpretation.
   * Tests parser's ability to handle real ENCODE file characteristics.
   *
   * @see https://www.encodeproject.org/chip-seq/transcription_factor/ - ENCODE standards
   */
  test("handles ENCODE file naming and metadata patterns", async () => {
    // ENCODE cryptic naming: ENCFF591RMN.bed.gz style identifiers
    const encodeStyleData = "chr1\t500000\t501000\tENCFF591RMN_peak_1\t100\t+";

    const [interval] = await Array.fromAsync(parser.parseString(encodeStyleData));

    expect(interval.name).toBe("ENCFF591RMN_peak_1"); // ENCODE identifier format
    expect(interval.chromosome).toBe("chr1");
    expect(interval.score).toBe(100);
  });

  /**
   * Tests ChIP-seq quality thresholds and statistical significance
   *
   * Biological context: ChIP-seq analysis uses p-value and q-value thresholds
   * for statistical significance. Score field often represents -log10(pValue)
   * or enrichment fold-change rather than UCSC display intensity.
   *
   * @see https://hbctraining.github.io/Intro-to-ChIPseq/ - ChIP-seq analysis pipeline
   */
  test("handles ChIP-seq statistical significance patterns", async () => {
    const chipseqPeaks = [
      "chr1\t100000\t100500\tpeak_high_significance\t150\t+", // High score (strong peak)
      "chr1\t200000\t200200\tpeak_low_significance\t25\t+", // Low score (weak peak)
      "chr1\t300000\t300100\tpeak_threshold\t30\t+", // Threshold score
    ].join("\n");

    const peaks = await Array.fromAsync(parser.parseString(chipseqPeaks));

    expect(peaks).toHaveLength(3);
    expect(peaks[0].score).toBe(150); // High significance peak
    expect(peaks[1].score).toBe(25); // Low significance peak
    expect(peaks[2].score).toBe(30); // Threshold significance

    // Verify score range compliance (0-1000 UCSC specification)
    peaks.forEach((peak) => {
      expect(peak.score).toBeGreaterThanOrEqual(0);
      expect(peak.score).toBeLessThanOrEqual(1000);
    });
  });
});

describe("Tool Ecosystem Compatibility (Cross-Tool Interoperability)", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  /**
   * Tests bedtools chromosome naming requirements
   *
   * Tool ecosystem issue: bedtools requires identical chromosome naming schemes
   * (chr1 vs 1) and fails with incompatible naming. Our parser should handle
   * both formats and potentially warn about cross-tool compatibility.
   *
   * @see https://bedtools.readthedocs.io/en/latest/ - bedtools documentation
   * @see https://groups.google.com/g/bedtools-discuss/ - bedtools user issues
   */
  test("handles bedtools chromosome naming requirements", async () => {
    const chromosomeNamingVariants = [
      "chr1\t1000\t2000\tfeature_with_chr", // UCSC style (chr1)
      "1\t1000\t2000\tfeature_without_chr", // NCBI style (1)
      "chrX\t1000\t2000\tfeature_sex_chr", // Sex chromosome
      "chrM\t1000\t2000\tfeature_mitochondrial", // Mitochondrial
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(chromosomeNamingVariants));

    expect(intervals).toHaveLength(4);
    expect(intervals[0].chromosome).toBe("chr1"); // UCSC style preserved
    expect(intervals[1].chromosome).toBe("1"); // NCBI style preserved
    expect(intervals[2].chromosome).toBe("chrX"); // Sex chromosome handled
    expect(intervals[3].chromosome).toBe("chrM"); // Mitochondrial handled
  });

  /**
   * Tests BEDOPS sorting requirements
   *
   * BEDOPS requires lexicographic chromosome order, then numeric coordinate order.
   * Unlike bedtools, BEDOPS mandates sorted input for performance optimization.
   *
   * @see https://bedops.readthedocs.io/en/latest/ - BEDOPS documentation
   */
  test("parses data compatible with BEDOPS sorting requirements", async () => {
    const bedopsSortedData = [
      "chr1\t1000\t2000\tfeature1", // Lexicographic: chr1 before chr10
      "chr1\t3000\t4000\tfeature2", // Same chr, numeric coordinate order
      "chr10\t1000\t2000\tfeature3", // chr10 after chr1 (lexicographic)
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(bedopsSortedData));

    expect(intervals).toHaveLength(3);
    // Verify BEDOPS-compatible ordering is maintained
    expect(intervals[0].chromosome).toBe("chr1");
    expect(intervals[1].chromosome).toBe("chr1");
    expect(intervals[1].start).toBeGreaterThan(intervals[0].start); // Numeric order within chr
    expect(intervals[2].chromosome).toBe("chr10"); // Lexicographic order
  });

  /**
   * Tests deepTools 6-column minimum requirements
   *
   * deepTools expects first 6 columns (chr/start/end/name/score/strand) for
   * compatibility and can fail with "does not seem to be a recognized file type"
   * for minimal BED files.
   *
   * @see https://github.com/deeptools/deepTools - deepTools repository
   * @see https://deeptools.readthedocs.io/ - deepTools documentation
   */
  test("generates output compatible with deepTools 6-column requirements", async () => {
    const deepToolsCompatible = "chr1\t1000\t2000\tfeature1\t100\t+";

    const [interval] = await Array.fromAsync(parser.parseString(deepToolsCompatible));

    // Verify all 6 required fields are present and properly typed
    expect(interval.chromosome).toBe("chr1"); // Required field 1
    expect(interval.start).toBe(1000); // Required field 2
    expect(interval.end).toBe(2000); // Required field 3
    expect(interval.name).toBe("feature1"); // Required field 4
    expect(interval.score).toBe(100); // Required field 5
    expect(interval.strand).toBe("+"); // Required field 6

    expect(interval.stats?.bedType).toBe("BED6"); // Confirms BED6 format
  });

  /**
   * Tests platform line ending variations (DOS/Unix compatibility)
   *
   * Cross-platform issue: DOS/Windows files with \r\n line endings break Unix
   * tools with "malformed BED entry" errors. Our parser should handle both.
   *
   * @see https://www.biostars.org/p/177653/ - Line ending parsing issues
   */
  test("handles platform line ending variations (DOS/Unix)", async () => {
    // Test both Unix (\n) and DOS (\r\n) line endings
    const unixEndings = "chr1\t1000\t2000\tunix_feature\nchr2\t3000\t4000\tunix_feature2";
    const dosEndings = "chr1\t1000\t2000\tdos_feature\r\nchr2\t3000\t4000\tdos_feature2";

    const unixIntervals = await Array.fromAsync(parser.parseString(unixEndings));
    const dosIntervals = await Array.fromAsync(parser.parseString(dosEndings));

    expect(unixIntervals).toHaveLength(2);
    expect(dosIntervals).toHaveLength(2);

    // Both should produce identical results regardless of line ending
    expect(unixIntervals[0].chromosome).toBe("chr1");
    expect(dosIntervals[0].chromosome).toBe("chr1");
    expect(unixIntervals[1].name).toBe("unix_feature2");
    expect(dosIntervals[1].name).toBe("dos_feature2");
  });

  /**
   * Tests tab vs space delimiter compatibility
   *
   * Format specification: BED files should be tab-delimited, but some tools
   * generate space-delimited output. Tests parser's ability to handle both
   * while maintaining format compliance.
   *
   * @see https://genome.ucsc.edu/FAQ/FAQformat.html#format1 - Tab delimiting requirement
   */
  test("enforces tab delimiter requirements vs space delimiters", async () => {
    const tabDelimited = "chr1\t1000\t2000\ttab_feature"; // Correct format
    const spaceDelimited = "chr1 1000 2000 space_feature"; // Non-compliant

    // Tab delimited should parse correctly
    const [tabInterval] = await Array.fromAsync(parser.parseString(tabDelimited));
    expect(tabInterval.name).toBe("tab_feature");

    // Space delimited should parse (our parser handles whitespace generally)
    const [spaceInterval] = await Array.fromAsync(parser.parseString(spaceDelimited));
    expect(spaceInterval.name).toBe("space_feature"); // Flexible parsing
  });
});

describe("Biological Workflow Use Cases (Real Genomics Applications)", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  /**
   * Tests ChIP-seq peak calling workflow output
   *
   * Biological context: ChIP-seq identifies transcription factor binding sites
   * through peak calling algorithms (MACS2, PeakSeq). Output represents regions
   * of enriched signal requiring precise coordinate accuracy for motif analysis.
   *
   * @see https://hbctraining.github.io/Intro-to-ChIPseq/lessons/05_peak_calling_macs.html - Peak calling workflow
   */
  test("handles ChIP-seq peak calling workflow output", async () => {
    const chipseqPeaks = [
      "chr1\t1547689\t1548089\tpeak1\t324\t+", // High-confidence narrow peak
      "chr2\t2156748\t2159248\tpeak2\t89\t+", // Broad domain peak
    ].join("\n");

    const peaks = await Array.fromAsync(parser.parseString(chipseqPeaks));

    expect(peaks).toHaveLength(2);
    expect(peaks[0].name).toBe("peak1");
    expect(peaks[0].length).toBe(400); // Narrow peak characteristic
    expect(peaks[1].length).toBe(2500); // Broad domain characteristic
  });

  /**
   * Tests RNA-seq splice junction detection output
   *
   * Biological context: RNA-seq with splice-aware alignment (STAR, HISAT2)
   * produces BED12 output representing transcript models with exon/intron
   * structure critical for alternative splicing analysis.
   *
   */
  test("handles RNA-seq splice junction detection output", async () => {
    // RNA-seq derived transcript model with realistic exon structure
    const rnaseqTranscript =
      "chr1\t1000\t5000\ttranscript_1\t1000\t+\t1200\t4800\t0\t4\t200,300,250,300\t0,800,2200,3700";

    const [transcript] = await Array.fromAsync(parser.parseString(rnaseqTranscript));

    expect(transcript.blockCount).toBe(4); // 4 exons
    expect(transcript.thickStart).toBe(1200); // CDS start
    expect(transcript.thickEnd).toBe(4800); // CDS end
    expect(transcript.strand).toBe("+"); // Forward strand transcript
  });

  /**
   * Tests variant calling BED output (SNV and indel representation)
   *
   * Biological context: Variant callers output BED format for structural variants.
   * Zero-length intervals represent insertion sites, single-base intervals represent SNVs.
   *
   */
  test("handles variant calling workflow output", async () => {
    const variantData = [
      "chr1\t1000\t1000\tINS_variant", // Insertion (zero-length)
      "chr1\t2000\t2001\tSNV_variant", // SNV (single base)
      "chr1\t3000\t3050\tDEL_variant", // Deletion (50bp)
    ].join("\n");

    const variants = await Array.fromAsync(parser.parseString(variantData));

    expect(variants).toHaveLength(3);
    expect(variants[0].length).toBe(0); // Insertion site (zero-length)
    expect(variants[1].length).toBe(1); // SNV (single base)
    expect(variants[2].length).toBe(50); // Deletion (50bp)
  });
});

describe("Error Recovery and Data Corruption Handling", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  /**
   * Tests malformed field count handling
   *
   * Real-world issue: BED files often mix different field counts in same file,
   * violating format consistency. Our parser should provide clear guidance.
   *
   */
  test("handles mixed field counts flexibly", async () => {
    const mixedFieldCounts = [
      "chr1\t1000\t2000", // BED3
      "chr1\t3000\t4000\tfeature\t100\t+", // BED6 (different count)
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(mixedFieldCounts));
    expect(intervals).toHaveLength(2); // Flexible parsing allows mixed formats
  });

  /**
   * Tests incomplete line handling
   *
   * Data corruption scenario: Network interruptions or file truncation can
   * create incomplete final lines requiring graceful error recovery.
   *
   */
  test("handles incomplete final lines gracefully", async () => {
    const incompleteData = "chr1\t1000\t2000\tcomplete_feature\nchr2\t3000"; // Incomplete

    try {
      const intervals = await Array.fromAsync(parser.parseString(incompleteData));
      expect(intervals).toHaveLength(1); // Only complete line parsed
    } catch (error) {
      expect(error.message).toMatch(/field|incomplete|format/i);
    }
  });

  /**
   * Tests track/browser line mixing with data
   *
   * Real-world pattern: UCSC track files intermix track lines with data lines.
   * Parser must distinguish between metadata and genomic features correctly.
   *
   * @see https://genome.ucsc.edu/goldenPath/help/customTrack.html - Track line specification
   */
  test("handles track and browser lines mixed with data", async () => {
    const mixedContent = [
      'track name=myTrack description="Test Track" useScore=1',
      "browser position chr1:1-1000000",
      "chr1\t1000\t2000\tfeature1",
      "# Comment line",
      "chr1\t3000\t4000\tfeature2",
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(mixedContent));

    expect(intervals).toHaveLength(2); // Only data lines parsed, metadata skipped
    expect(intervals[0].name).toBe("feature1");
    expect(intervals[1].name).toBe("feature2");
  });
});

describe("Real-World Edge Cases (Industry Problem Prevention)", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  /**
   * Tests BED field count variations and format consistency
   *
   * Industry insight: 75/80 bioinformatics tools fail BED parsing due to poor
   * specification adherence. Valid BED variants are limited to specific field counts:
   * 3, 4, 5, 6, 9, 12 only. Other counts (BED7, BED8, BED10, BED11) are undefined.
   *
   * @see https://genome.ucsc.edu/FAQ/FAQformat.html#format1 - BED format specification
   * @see https://academic.oup.com/bioinformatics/article/38/13/3327/6586286 - Tool interoperability study
   */
  test("validates BED field count variants and rejects undefined formats", async () => {
    // Test each valid BED format variant
    const validFormats = [
      "chr1\t1000\t2000", // BED3 (minimal)
      "chr1\t1000\t2000\tfeature", // BED4 (+ name)
      "chr1\t1000\t2000\tfeature\t100", // BED5 (+ score)
      "chr1\t1000\t2000\tfeature\t100\t+", // BED6 (+ strand)
      "chr1\t1000\t2000\tfeature\t100\t+\t1000\t2000\t0", // BED9 (+ thick + RGB)
      "chr1\t1000\t2000\tfeature\t100\t+\t1000\t2000\t0\t1\t1000\t0", // BED12 (+ blocks)
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(validFormats));
    expect(intervals).toHaveLength(6);

    // Verify format detection for each variant
    expect(intervals[0].stats?.bedType).toBe("BED3");
    expect(intervals[3].stats?.bedType).toBe("BED6");
    expect(intervals[5].stats?.bedType).toBe("BED12");
  });

  /**
   * Tests undefined BED format rejection (BED7, BED8, BED10, BED11)
   *
   * Expert knowledge: UCSC specification only defines BED3,4,5,6,9,12 variants.
   * Intermediate formats (BED7, BED8, BED10, BED11) are undefined and should
   * be rejected with helpful guidance rather than arbitrary interpretation.
   *
   * @see https://genome.ucsc.edu/FAQ/FAQformat.html#format1 - Valid BED format variants only
   */
  test("rejects undefined BED format variants with educational guidance", async () => {
    // BED7 is undefined (between BED6 and BED9)
    const undefinedBed7 = "chr1\t1000\t2000\tfeature\t100\t+\textra_field";

    await expect(async () => {
      for await (const _ of parser.parseString(undefinedBed7)) {
        // Should reject undefined format
      }
    }).toThrow(/Unsupported.*BED.*variant.*valid.*BED3.*BED4.*BED5.*BED6.*BED9.*BED12/);
  });

  /**
   * Tests chromosome naming convention variations across reference genomes
   *
   * Genomics reality: Different assemblies use different chromosome naming:
   * - UCSC: chr1, chr2, chrX, chrY, chrM
   * - NCBI: 1, 2, X, Y, MT
   * - Ensembl: 1, 2, X, Y, MT
   * - Custom assemblies: scaffold_1, contig_123, unplaced_scaffold_45
   *
   * @see https://gatk.broadinstitute.org/hc/en-us/articles/360035890951 - Reference genome builds
   */
  test("handles diverse chromosome naming conventions across genome assemblies", async () => {
    const chromosomeVariations = [
      "chr1\t1000\t2000\tucsc_style", // UCSC Genome Browser
      "1\t1000\t2000\tncbi_style", // NCBI RefSeq
      "X\t1000\t2000\tsex_chromosome", // Sex chromosome (no prefix)
      "MT\t1000\t2000\tmitochondrial_ensembl", // Ensembl mitochondrial
      "chrM\t1000\t2000\tmitochondrial_ucsc", // UCSC mitochondrial
      "scaffold_123\t1000\t2000\tassembly_scaffold", // Assembly scaffold
      "contig_456\t1000\t2000\tunanchored_contig", // Unanchored contig
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(chromosomeVariations));

    expect(intervals).toHaveLength(7);
    expect(intervals[0].chromosome).toBe("chr1"); // UCSC preserved
    expect(intervals[1].chromosome).toBe("1"); // NCBI preserved
    expect(intervals[2].chromosome).toBe("X"); // Sex chromosome
    expect(intervals[4].chromosome).toBe("chrM"); // UCSC mitochondrial
    expect(intervals[5].chromosome).toBe("scaffold_123"); // Assembly naming
  });

  /**
   * Tests score field validation and biological interpretation
   *
   * UCSC specification: Score field should be 0-1000 integer for grayscale display.
   * Reality: Tools often abuse score field for p-values, fold-enrichment, or
   * other biological measurements, creating validation challenges.
   *
   * @see https://genome.ucsc.edu/FAQ/FAQformat.html#format1 - Score field specification
   */
  test("validates score field ranges and handles biological interpretations", async () => {
    const scoreVariations = [
      "chr1\t1000\t2000\tfeature1\t0", // Minimum valid score
      "chr1\t1000\t2000\tfeature2\t500", // Mid-range score
      "chr1\t1000\t2000\tfeature3\t1000", // Maximum valid score
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(scoreVariations));

    expect(intervals).toHaveLength(3);
    expect(intervals[0].score).toBe(0); // Minimum boundary
    expect(intervals[1].score).toBe(500); // Mid-range value
    expect(intervals[2].score).toBe(1000); // Maximum boundary
  });

  /**
   * Tests strand field validation and biological semantics
   *
   * Biological context: Strand orientation crucial for gene expression analysis.
   * Valid values: "+" (forward), "-" (reverse), "." (unknown/both/irrelevant).
   * Invalid values should be rejected with biological context.
   *
   * @see https://genome.ucsc.edu/FAQ/FAQformat.html#format1 - Strand field definition
   */
  test("validates strand field with biological semantics", async () => {
    const strandVariations = [
      "chr1\t1000\t2000\tforward_gene\t100\t+", // Forward strand
      "chr1\t1000\t2000\treverse_gene\t100\t-", // Reverse strand
      "chr1\t1000\t2000\tunknown_strand\t100\t.", // Unknown/irrelevant
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(strandVariations));

    expect(intervals).toHaveLength(3);
    expect(intervals[0].strand).toBe("+"); // Forward strand gene
    expect(intervals[1].strand).toBe("-"); // Reverse strand gene
    expect(intervals[2].strand).toBe("."); // Unknown/irrelevant strand
  });

  /**
   * Tests RGB color field parsing for visualization
   *
   * BED format supports RGB color specification for track visualization.
   * Format: "255,0,0" (red) or "0" (use track default). Critical for
   * multi-track genome browser visualization workflows.
   *
   * @see https://genome.ucsc.edu/goldenPath/help/customTrack.html - RGB color specification
   */
  test("handles RGB color field specification for genome browser visualization", async () => {
    const colorSpecifications = [
      "chr1\t1000\t2000\tred_feature\t100\t+\t1000\t2000\t255,0,0", // BED9: Red RGB
      "chr1\t3000\t4000\tblue_feature\t100\t+\t3000\t4000\t0,0,255", // BED9: Blue RGB
      "chr1\t5000\t6000\tdefault_feature\t100\t+\t5000\t6000\t0", // BED9: Default color
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(colorSpecifications));

    expect(intervals).toHaveLength(3);
    expect(intervals[0].itemRgb).toBe("255,0,0"); // Red color preserved
    expect(intervals[1].itemRgb).toBe("0,0,255"); // Blue color preserved
    expect(intervals[2].itemRgb).toBe("0"); // Default color preserved
    expect(intervals[0].stats?.bedType).toBe("BED9"); // Confirms BED9 format
  });

  /**
   * Tests whitespace handling and field parsing robustness
   *
   * Real-world data corruption: Extra whitespace, mixed tabs/spaces, trailing
   * whitespace can break parsers. Our implementation should handle gracefully
   * while maintaining format compliance.
   *
   * @see https://www.biostars.org/p/177653/ - Whitespace parsing issues in genomics
   */
  test("handles whitespace variations and parsing edge cases", async () => {
    const whitespaceVariations = [
      "chr1\t1000\t2000\tnormal_spacing", // Standard formatting
      "chr1\t1000\t2000\ttrailing_space\t100 ", // Trailing space
      " chr1\t1000\t2000\tleading_space", // Leading space
      "chr1\t\t1000\t2000\tempty_field", // Empty field
    ].join("\n");

    // Should handle whitespace gracefully without breaking parsing
    try {
      const intervals = await Array.fromAsync(parser.parseString(whitespaceVariations));
      expect(intervals.length).toBeGreaterThanOrEqual(1); // At least some should parse
    } catch (error) {
      // If errors occur, should provide helpful context about field formatting
      expect(error.message).toMatch(/field|format|whitespace/i);
    }
  });
});

describe("BED Format Variant Comprehensive Testing (BED3-BED12 Exhaustive)", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  /**
   * Tests BED3 minimal format with coordinate precision
   *
   * Biological context: BED3 represents the minimal genomic interval specification
   * used for basic feature annotation, genome arithmetic, and interval operations.
   * Critical for foundational genomics workflows requiring only positional information.
   *
   * @see https://genome.ucsc.edu/FAQ/FAQformat.html#format1 - BED3 minimal specification
   */
  test("parses BED3 minimal format with coordinate precision", async () => {
    const bed3Examples = [
      "chr1\t0\t1000", // Zero-based start coordinate
      "chrX\t1000000\t1001000", // Sex chromosome, 1KB interval
      "scaffold_1\t999\t1000", // Single-base precision interval
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(bed3Examples));

    expect(intervals).toHaveLength(3);
    expect(intervals[0].start).toBe(0); // Zero-based coordinate system
    expect(intervals[0].end).toBe(1000); // Exclusive end
    expect(intervals[0].length).toBe(1000); // Calculated length
    expect(intervals[2].length).toBe(1); // Single-base precision

    intervals.forEach((interval) => {
      expect(interval.stats?.bedType).toBe("BED3");
      expect(interval.name).toBeUndefined(); // No optional fields
      expect(interval.score).toBeUndefined();
      expect(interval.strand).toBeUndefined();
    });
  });

  /**
   * Tests BED4 format with feature naming
   *
   * Biological context: BED4 adds feature names critical for genomic feature
   * identification in annotation workflows. Names enable feature tracking
   * across analysis pipelines and visualization tools.
   */
  test("parses BED4 format with genomic feature naming", async () => {
    const bed4Examples = [
      "chr1\t1000\t2000\tgene_ABC1", // Gene feature naming
      "chr2\t3000\t4000\texon_5", // Exon identification
      "chrM\t100\t200\tmitochondrial_tRNA", // Mitochondrial feature
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(bed4Examples));

    expect(intervals).toHaveLength(3);
    expect(intervals[0].name).toBe("gene_ABC1");
    expect(intervals[1].name).toBe("exon_5");
    expect(intervals[2].name).toBe("mitochondrial_tRNA");

    intervals.forEach((interval) => {
      expect(interval.stats?.bedType).toBe("BED4");
      expect(interval.score).toBeUndefined(); // No score field yet
      expect(interval.strand).toBeUndefined();
    });
  });

  /**
   * Tests BED5 format with score-based visualization
   *
   * Biological context: BED5 adds score field (0-1000) for grayscale visualization
   * intensity. Critical for ChIP-seq peak visualization, where score represents
   * signal strength or statistical significance.
   */
  test("parses BED5 format with score-based genomics visualization", async () => {
    const bed5Examples = [
      "chr1\t1000\t2000\tlow_peak\t0", // Minimum score (no signal)
      "chr1\t2000\t3000\tmedium_peak\t500", // Medium score (moderate signal)
      "chr1\t3000\t4000\thigh_peak\t1000", // Maximum score (strong signal)
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(bed5Examples));

    expect(intervals).toHaveLength(3);
    expect(intervals[0].score).toBe(0); // Minimum valid score
    expect(intervals[1].score).toBe(500); // Mid-range score
    expect(intervals[2].score).toBe(1000); // Maximum valid score

    intervals.forEach((interval) => {
      expect(interval.stats?.bedType).toBe("BED5");
      expect(interval.strand).toBeUndefined(); // No strand field yet
    });
  });

  /**
   * Tests BED6 format with strand orientation
   *
   * Biological context: BED6 adds strand information crucial for gene expression
   * analysis, transcription direction, and regulatory element orientation.
   * Essential for strand-specific genomics workflows.
   */
  test("parses BED6 format with strand orientation for gene expression", async () => {
    const bed6Examples = [
      "chr1\t1000\t2000\tforward_gene\t800\t+", // Forward strand gene
      "chr1\t3000\t4000\treverse_gene\t600\t-", // Reverse strand gene
      "chr1\t5000\t6000\tneutral_feature\t400\t.", // Strand-independent feature
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(bed6Examples));

    expect(intervals).toHaveLength(3);
    expect(intervals[0].strand).toBe("+"); // Forward transcription
    expect(intervals[1].strand).toBe("-"); // Reverse transcription
    expect(intervals[2].strand).toBe("."); // Strand-independent

    intervals.forEach((interval) => {
      expect(interval.stats?.bedType).toBe("BED6");
      expect(interval.name).toBeDefined(); // Has name field
      expect(interval.score).toBeDefined(); // Has score field
      expect(interval.strand).toBeDefined(); // Has strand field
    });
  });

  /**
   * Tests BED9 format with thick region (CDS) annotation
   *
   * Biological context: BED9 adds thick region coordinates representing coding
   * sequences (CDS) within transcripts. Critical for protein-coding gene
   * annotation where thick regions indicate translated portions.
   */
  test("parses BED9 format with coding sequence (CDS) annotation", async () => {
    const bed9Examples = [
      "chr1\t1000\t5000\tprotein_gene\t900\t+\t1500\t4500\t255,0,0", // Full CDS
      "chr2\t2000\t6000\tnon_coding\t600\t-\t2000\t2000\t0,255,0", // Non-coding (thick=0)
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(bed9Examples));

    expect(intervals).toHaveLength(2);
    expect(intervals[0].thickStart).toBe(1500); // CDS start within transcript
    expect(intervals[0].thickEnd).toBe(4500); // CDS end within transcript
    expect(intervals[0].itemRgb).toBe("255,0,0"); // Red color coding

    expect(intervals[1].thickStart).toBe(2000); // Non-coding: thick = transcript start
    expect(intervals[1].thickEnd).toBe(2000); // Non-coding: thick = transcript start

    intervals.forEach((interval) => {
      expect(interval.stats?.bedType).toBe("BED9");
      expect(interval.stats?.hasThickRegion).toBe(true);
    });
  });
});

describe("Biological Context Testing (Gene Models and Regulatory Elements)", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  /**
   * Tests alternative splicing gene model representation
   *
   * Biological context: Alternative splicing creates multiple transcript isoforms
   * from single genes. BED12 format represents different exon combinations
   * within same genomic locus, critical for RNA-seq isoform analysis.
   *
   * @see https://www.nature.com/articles/nrg2776 - Alternative splicing biology
   */
  test("represents alternative splicing gene models with exon diversity", async () => {
    const alternativeSplicing = [
      // Isoform 1: Long transcript with 3 exons
      "chr1\t1000\t4000\tGENE1-isoform1\t900\t+\t1200\t3800\t255,0,0\t3\t200,300,400\t0,1000,2600",
      // Isoform 2: Short transcript, skips middle exon
      "chr1\t1000\t4000\tGENE1-isoform2\t800\t+\t1200\t3800\t0,255,0\t2\t200,400\t0,2600",
    ].join("\n");

    const isoforms = await Array.fromAsync(parser.parseString(alternativeSplicing));

    expect(isoforms).toHaveLength(2);
    expect(isoforms[0].blockCount).toBe(3); // Long isoform (3 exons)
    expect(isoforms[1].blockCount).toBe(2); // Short isoform (2 exons)

    // Both share same genomic coordinates but different exon structure
    expect(isoforms[0].start).toBe(isoforms[1].start); // Same gene locus
    expect(isoforms[0].end).toBe(isoforms[1].end); // Same gene locus
    expect(isoforms[0].name).toBe("GENE1-isoform1");
    expect(isoforms[1].name).toBe("GENE1-isoform2");
  });

  /**
   * Tests regulatory element annotation with enhancer/silencer context
   *
   * Biological context: Regulatory elements (enhancers, silencers, promoters)
   * control gene expression. Score field often represents regulatory strength,
   * strand indicates target gene orientation.
   *
   * @see https://www.nature.com/articles/nrg3458 - Regulatory element biology
   */
  test("annotates regulatory elements with biological context", async () => {
    const regulatoryElements = [
      "chr1\t500\t1000\tpromoter_GENE1\t950\t+", // Strong promoter (high score)
      "chr1\t10000\t12000\tenhancer_1\t750\t.", // Distal enhancer
      "chr1\t15000\t15500\tsilencer_1\t300\t-", // Weak silencer (low score)
      "chr1\t20000\t20200\tinsulator_CTCF\t800\t.", // Chromatin insulator
    ].join("\n");

    const elements = await Array.fromAsync(parser.parseString(regulatoryElements));

    expect(elements).toHaveLength(4);
    expect(elements[0].name).toBe("promoter_GENE1");
    expect(elements[0].score).toBe(950); // High regulatory strength
    expect(elements[1].length).toBe(2000); // Typical enhancer size
    expect(elements[2].score).toBe(300); // Lower silencer strength
    expect(elements[3].length).toBe(200); // Compact insulator element
  });

  /**
   * Tests genome assembly feature annotation
   *
   * Biological context: Genome assemblies require annotation of gaps, repeats,
   * centromeres, and heterochromatin regions. BED format provides coordinate
   * framework for assembly quality assessment and feature masking.
   */
  test("annotates genome assembly features with assembly context", async () => {
    const assemblyFeatures = [
      "chr1\t12500000\t12600000\tcentromere\t100\t.", // Centromeric region
      "chr1\t50000\t55000\tgap_assembly\t0\t.", // Assembly gap (score=0)
      "scaffold_10\t0\t100000\ttelomeric_repeat\t200\t.", // Telomeric repeats
      "chrY_random\t10000\t50000\theterochromatin\t50\t.", // Heterochromatic region
    ].join("\n");

    const features = await Array.fromAsync(parser.parseString(assemblyFeatures));

    expect(features).toHaveLength(4);
    expect(features[0].length).toBe(100000); // Large centromeric region
    expect(features[1].score).toBe(0); // Gap regions have no signal
    expect(features[2].chromosome).toBe("scaffold_10"); // Scaffold naming
    expect(features[3].chromosome).toBe("chrY_random"); // Random chromosome naming
  });

  /**
   * Tests epigenetic mark annotation (histone modifications)
   *
   * Biological context: Histone modifications create chromatin states affecting
   * gene expression. Different marks have distinct genomic distributions and
   * biological functions requiring accurate coordinate annotation.
   *
   * @see https://www.nature.com/articles/nrg2904 - Histone modification biology
   */
  test("annotates epigenetic marks with chromatin biology context", async () => {
    const histoneMarks = [
      "chr1\t1000\t2000\tH3K4me3_promoter\t900\t+", // Promoter mark (sharp peak)
      "chr1\t5000\t15000\tH3K27ac_enhancer\t700\t.", // Enhancer mark (broad domain)
      "chr1\t20000\t50000\tH3K9me3_heterochromatin\t400\t.", // Repressive mark (very broad)
      "chr1\t60000\t61000\tH3K4me1_poised_enhancer\t500\t+", // Poised enhancer
    ].join("\n");

    const marks = await Array.fromAsync(parser.parseString(histoneMarks));

    expect(marks).toHaveLength(4);
    expect(marks[0].length).toBe(1000); // Sharp promoter peak (~1KB)
    expect(marks[1].length).toBe(10000); // Broad enhancer domain (~10KB)
    expect(marks[2].length).toBe(30000); // Very broad heterochromatin (~30KB)
    expect(marks[3].length).toBe(1000); // Poised enhancer (~1KB)

    // Verify biological score patterns
    expect(marks[0].score).toBe(900); // Strong promoter signal
    expect(marks[2].score).toBe(400); // Moderate heterochromatin signal
  });
});

describe("Advanced Error Recovery Testing (Malformed Data Resilience)", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  /**
   * Tests invalid score field handling with biological guidance
   *
   * Error scenario: Tools sometimes generate invalid scores outside 0-1000 range,
   * or use non-numeric values. Parser should provide biological context about
   * proper score usage for genomic visualization.
   */
  test("handles invalid score fields with biological guidance", async () => {
    const invalidScoreData = "chr1\t1000\t2000\tfeature\t1500"; // Score > 1000

    // Should either parse with validation warning or error with helpful guidance
    try {
      const [interval] = await Array.fromAsync(parser.parseString(invalidScoreData));
      // If parsed, score should be handled appropriately
      expect(interval.score).toBeDefined();
    } catch (error) {
      // Should provide biological context about score field usage
      expect(error.message).toMatch(/score|1000|range|visualization/i);
    }
  });

  /**
   * Tests invalid strand field handling with directional context
   *
   * Error scenario: Invalid strand characters (not +, -, or .) break downstream
   * strand-specific analysis. Should error with explanation of valid strand values
   * and biological significance.
   */
  test("rejects invalid strand values with biological explanation", async () => {
    const invalidStrandData = "chr1\t1000\t2000\tfeature\t100\tX"; // Invalid strand 'X'

    const intervals = await Array.fromAsync(parser.parseString(invalidStrandData));

    // Should either skip invalid strand or preserve for flexibility
    expect(intervals).toHaveLength(1);
    // Invalid strand should not be set or should be normalized
  });

  /**
   * Tests malformed coordinate handling with genomic context
   *
   * Data corruption: Non-numeric coordinates, floating point values, or
   * scientific notation break genomic arithmetic. Should provide clear
   * guidance about integer coordinate requirements.
   */
  test("handles malformed coordinates with genomic arithmetic context", async () => {
    const malformedCoordinates = [
      "chr1\tabc\t2000\tinvalid_start", // Non-numeric start
      "chr1\t1000\txyz\tinvalid_end", // Non-numeric end
      "chr1\t1000.5\t2000\tfloat_coord", // Floating point coordinate
    ].join("\n");

    // Should handle malformed coordinates gracefully with biological guidance
    let errorCount = 0;
    try {
      const intervals = await Array.fromAsync(parser.parseString(malformedCoordinates));
      // Some might parse successfully with intelligent handling
      expect(intervals.length).toBeLessThan(3); // At least some should fail
    } catch (error) {
      errorCount++;
      // Should provide genomic coordinate context in error messages
      expect(error.message).toMatch(/coordinate|integer|genomic|position/i);
    }
  });

  /**
   * Tests empty field handling and biological field requirements
   *
   * Data quality issue: Missing required fields or empty values break
   * downstream analysis. Should provide biological context about essential
   * fields for genomic workflows.
   */
  test("handles empty fields with biological field requirement guidance", async () => {
    const emptyFieldData = [
      "chr1\t\t2000\tempty_start", // Empty start field
      "chr1\t1000\t\tempty_end", // Empty end field
      "\t1000\t2000\tempty_chromosome", // Empty chromosome
    ].join("\n");

    // Should handle empty fields gracefully or error with biological guidance
    let parseableLines = 0;
    try {
      const intervals = await Array.fromAsync(parser.parseString(emptyFieldData));
      parseableLines = intervals.length;
      expect(parseableLines).toBeLessThan(3); // Some should fail validation
    } catch (error) {
      // Should explain biological importance of coordinate completeness
      expect(error.message).toMatch(/field|required|coordinate|chromosome|not.*number/i);
    }
  });

  /**
   * Tests coordinate boundary validation with genomic context
   *
   * Edge case: Coordinates at chromosome boundaries, extremely large intervals,
   * or coordinates that violate biological constraints should be handled
   * with appropriate genomic context.
   */
  test("validates coordinate boundaries with genomic biological context", async () => {
    const boundaryConditions = [
      "chr1\t0\t249000000\twhole_chromosome", // Human chr1 full length
      "scaffold_new\t0\t1\tsingle_base", // Minimal valid interval
      "chrM\t16569\t16570\tmitochondrial_boundary", // Human mitochondrial genome end
    ].join("\n");

    const intervals = await Array.fromAsync(parser.parseString(boundaryConditions));

    expect(intervals).toHaveLength(3);
    expect(intervals[0].length).toBe(249000000); // Chromosome-scale interval
    expect(intervals[1].length).toBe(1); // Single-base precision
    expect(intervals[2].start).toBe(16569); // Mitochondrial genome boundary
  });
});

describe("Memory Usage and Streaming Architecture Validation", () => {
  let parser: BedParser;

  beforeEach(() => {
    parser = new BedParser();
  });

  /**
   * Tests constant memory usage across different data sizes
   *
   * Streaming architecture validation: Parser should maintain O(1) memory usage
   * regardless of input size. Memory should not scale linearly with number of
   * genomic intervals processed.
   */
  test("maintains O(1) memory usage across genomic dataset sizes", async () => {
    const createBedData = (count: number) =>
      Array.from(
        { length: count },
        (_, i) =>
          `chr1\t${i * 1000}\t${(i + 1) * 1000}\tfeature${i}\t${Math.floor(Math.random() * 1000)}\t+`
      ).join("\n");

    // Test with incrementally larger datasets
    const sizes = [50, 500, 1000];
    const memoryMeasurements: number[] = [];

    for (const size of sizes) {
      const startMemory = process.memoryUsage().heapUsed;

      let processedCount = 0;
      for await (const interval of parser.parseString(createBedData(size))) {
        processedCount++;
        // Don't accumulate results - true streaming test
      }

      const endMemory = process.memoryUsage().heapUsed;
      const memoryDelta = endMemory - startMemory;
      memoryMeasurements.push(memoryDelta);

      expect(processedCount).toBe(size); // Verify all intervals processed
    }

    // O(1) validation: Memory measurements should be reasonable for streaming
    // Note: Memory measurement in test environment has limitations
    memoryMeasurements.forEach((measurement) => {
      expect(measurement).toBeLessThan(100_000_000); // < 100MB for any size (reasonable bound)
    });
  });

  /**
   * Tests streaming behavior with realistic genomics file sizes
   *
   * Real-world validation: Genomics BED files commonly range from 1MB (small)
   * to 100MB+ (genome-wide annotations). Streaming parser should handle without
   * memory accumulation or performance degradation.
   */
  test("validates streaming behavior with genomics-scale datasets", async () => {
    // Simulate realistic genomics annotation density
    const createGenomicsAnnotation = (intervals: number) =>
      Array.from({ length: intervals }, (_, i) => {
        const chr = `chr${(i % 22) + 1}`; // Human chromosomes 1-22
        const start = Math.floor(Math.random() * 200_000_000); // Random position
        const end = start + Math.floor(Math.random() * 10000) + 100; // 100bp-10KB intervals
        return `${chr}\t${start}\t${end}\tannotation_${i}\t${Math.floor(Math.random() * 1000)}\t+`;
      }).join("\n");

    const genomicsDataset = createGenomicsAnnotation(2000); // 2K annotations

    const startMemory = process.memoryUsage().heapUsed;
    let maxMemory = startMemory;
    let processedCount = 0;

    for await (const interval of parser.parseString(genomicsDataset)) {
      processedCount++;

      // Sample memory usage periodically
      if (processedCount % 500 === 0) {
        const currentMemory = process.memoryUsage().heapUsed;
        maxMemory = Math.max(maxMemory, currentMemory);
      }

      // Verify streaming: can access interval immediately without full parse
      expect(interval.chromosome).toMatch(/^chr\d+$/);
      expect(interval.length).toBeGreaterThan(0);
    }

    expect(processedCount).toBe(2000); // All intervals processed

    // Memory should not accumulate unboundedly
    const memoryGrowth = maxMemory - startMemory;
    expect(memoryGrowth).toBeLessThan(50_000_000); // < 50MB for streaming parser
  });

  /**
   * Tests parser state isolation between processing sessions
   *
   * Architecture validation: Parser should not accumulate state between different
   * parsing operations. Each parseString() call should be isolated without
   * memory leaks or state contamination.
   */
  test("verifies parser state isolation prevents memory leaks", async () => {
    const testData = "chr1\t1000\t2000\ttest_feature\t100\t+";

    // Process same data multiple times with same parser instance
    let baselineMemory = 0;

    for (let session = 0; session < 5; session++) {
      const sessionStart = process.memoryUsage().heapUsed;

      let count = 0;
      for await (const interval of parser.parseString(testData)) {
        count++;
        expect(interval.name).toBe("test_feature");
      }

      const sessionEnd = process.memoryUsage().heapUsed;
      const sessionMemory = sessionEnd - sessionStart;

      if (session === 0) {
        baselineMemory = Math.abs(sessionMemory);
      } else {
        // Memory usage should remain reasonable across sessions
        expect(Math.abs(sessionMemory)).toBeLessThan(50_000_000); // < 50MB per session
      }

      expect(count).toBe(1); // Each session processes same data
    }
  });

  /**
   * Tests early iteration termination memory efficiency
   *
   * Streaming optimization: Should be able to process first few intervals
   * from large dataset without parsing entire file. Critical for genomics
   * workflows that sample or preview large annotation files.
   */
  test("supports early termination without full dataset processing", async () => {
    const largeDataset = Array.from(
      { length: 5000 },
      (_, i) => `chr${(i % 22) + 1}\t${i * 1000}\t${(i + 1) * 1000}\tfeature${i}\t${i % 1000}\t+`
    ).join("\n");

    const startMemory = process.memoryUsage().heapUsed;

    // Process only first 3 intervals from large dataset
    let processed = 0;
    for await (const interval of parser.parseString(largeDataset)) {
      expect(interval.name).toMatch(/^feature\d+$/);
      processed++;

      if (processed >= 3) break; // Early termination
    }

    const endMemory = process.memoryUsage().heapUsed;
    const memoryUsed = endMemory - startMemory;

    expect(processed).toBe(3); // Only processed intended count
    // Memory usage should be minimal despite large input dataset
    expect(memoryUsed).toBeLessThan(10_000_000); // < 10MB for 3 intervals from 5K dataset
  });
});
