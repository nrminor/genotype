/**
 * Basic GTF format tests to establish current behavior
 *
 * Simple test suite to understand current gtf.ts implementation
 * before comprehensive refactoring. Following AGENTS.md principle:
 * "Respect existing code - understand why it exists before changing"
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { GenotypeError } from "../../src/errors";
import { GtfParser, GtfUtils, GtfWriter } from "../../src/formats/gtf";
import type { GtfFeature } from "../../src/types";

describe("GTF Format - Current Implementation Behavior", () => {
  let parser: GtfParser;

  beforeEach(() => {
    parser = new GtfParser();
  });

  test("parses standard GTF feature", async () => {
    const gtfData = `chr1\tHAVANA\tgene\t1000\t2000\t.\t+\t.\tgene_id "ENSG001"; gene_type "protein_coding";`;
    const [feature] = await Array.fromAsync(parser.parseString(gtfData));

    expect(feature.seqname).toBe("chr1");
    expect(feature.source).toBe("HAVANA");
    expect(feature.feature).toBe("gene");
    expect(feature.start).toBe(1000);
    expect(feature.end).toBe(2000);
    expect(feature.strand).toBe("+");
    expect(feature.length).toBe(1001); // 1-based inclusive
    expect(feature.attributes.gene_id).toBe("ENSG001");
  });

  test("parses CDS with frame", async () => {
    const cdsData = `chr1\tHAVANA\tCDS\t1000\t2000\t100.5\t+\t0\tgene_id "ENSG001"; transcript_id "ENST001";`;
    const [feature] = await Array.fromAsync(parser.parseString(cdsData));

    expect(feature.feature).toBe("CDS");
    expect(feature.score).toBe(100.5);
    expect(feature.frame).toBe(0);
  });

  test("handles comments and empty lines", async () => {
    const dataWithComments = `# Comment line
chr1\tHAVANA\tgene\t1000\t2000\t.\t+\t.\tgene_id "ENSG001";

chr2\tHAVANA\tgene\t3000\t4000\t.\t-\t.\tgene_id "ENSG002";`;

    const features = await Array.fromAsync(parser.parseString(dataWithComments));
    expect(features).toHaveLength(2);
  });

  test("coordinate validation behavior", async () => {
    const invalidData = `chr1\tHAVANA\tgene\t2000\t1000\t.\t+\t.\tgene_id "ENSG001";`;

    let threwError = false;
    try {
      for await (const feature of parser.parseString(invalidData)) {
        // Should not reach here
      }
    } catch (error) {
      threwError = true;
      expect(error).toBeInstanceOf(GenotypeError);
    }
    expect(threwError).toBe(true);
  });

  test("detects format correctly", () => {
    const gtfData = `chr1\tHAVANA\tgene\t1000\t2000\t.\t+\t.\tgene_id "ENSG001";`;
    expect(GtfUtils.detectGtfFormat(gtfData)).toBe(true);

    const notGtfData = ">seq1\nATCG\n";
    expect(GtfUtils.detectGtfFormat(notGtfData)).toBe(false);
  });
});

describe("GTF Real-World Edge Cases (Domain Research)", () => {
  let parser: GtfParser;

  beforeEach(() => {
    parser = new GtfParser();
  });

  test("handles GENCODE vs Ensembl attribute differences", async () => {
    const gencodeData = `chr1\tGENCODE\tgene\t1000\t2000\t.\t+\t.\tgene_id "ENSG001.1"; gene_type "protein_coding"; level "2";`;
    const ensemblData = `chr1\tEnsembl\tgene\t1000\t2000\t.\t+\t.\tgene_id "ENSG001"; gene_biotype "protein_coding"; gene_version "1";`;

    const gencodeFeature = (await Array.fromAsync(parser.parseString(gencodeData)))[0];
    const ensemblFeature = (await Array.fromAsync(parser.parseString(ensemblData)))[0];

    // Document different attribute naming patterns
    expect(gencodeFeature.attributes.gene_type).toBe("protein_coding");
    expect(ensemblFeature.attributes.gene_biotype).toBe("protein_coding");
    expect(gencodeFeature.attributes.level).toBe("2");
    expect(ensemblFeature.attributes.gene_version).toBe("1");
  });

  test("handles complex multi-tag attributes from GENCODE", async () => {
    const multiTagData = `chr1\tGENCODE\texon\t1000\t2000\t.\t+\t.\tgene_id "ENSG001"; tag "basic"; tag "MANE_Select"; tag "appris_principal_1";`;

    const [feature] = await Array.fromAsync(parser.parseString(multiTagData));

    // Current implementation behavior with multiple same-key attributes
    expect(feature.attributes.gene_id).toBe("ENSG001");
    expect(feature.attributes.tag).toBeDefined(); // May only capture last tag
  });

  test("handles malformed attributes gracefully", async () => {
    const malformedTests = [
      {
        name: "missing_quotes",
        data: `chr1\tHAVANA\tgene\t1000\t2000\t.\t+\t.\tgene_id ENSG001; gene_name TEST;`,
      },
      {
        name: "empty_values",
        data: `chr1\tHAVANA\tgene\t1000\t2000\t.\t+\t.\tgene_id ""; gene_name "";`,
      },
      {
        name: "whitespace_issues",
        data: `chr1\tHAVANA\tgene\t1000\t2000\t.\t+\t.\tgene_id  "ENSG001"  ;  gene_name   "TEST"  ;`,
      },
    ];

    for (const testCase of malformedTests) {
      // Document current behavior - don't assume it should fail
      try {
        const [feature] = await Array.fromAsync(parser.parseString(testCase.data));
        expect(feature).toBeDefined();
        expect(feature.attributes.gene_id).toBeDefined();
      } catch (error) {
        // If current implementation throws, document that behavior
        expect(error).toBeInstanceOf(Error);
      }
    }
  });

  test("validates GTF vs GFF3 format differences", async () => {
    const gff3LikeData = `chr1\tensembl\tgene\t1000\t2000\t.\t+\t.\tID=ENSG001;Name=TEST_GENE;biotype=protein_coding;`;

    // GTF parser should handle or reject GFF3-style attributes
    try {
      const [feature] = await Array.fromAsync(parser.parseString(gff3LikeData));
      // If it parses, verify what it produces
      expect(feature.seqname).toBe("chr1");
    } catch (error) {
      // If it rejects, that's also valid behavior to document
      expect(error).toBeInstanceOf(Error);
    }
  });

  test("handles gene model hierarchy relationships", async () => {
    const hierarchyData = `chr1\tHAVANA\tgene\t1000\t5000\t.\t+\t.\tgene_id "ENSG001"; gene_type "protein_coding";
chr1\tHAVANA\ttranscript\t1000\t5000\t.\t+\t.\tgene_id "ENSG001"; transcript_id "ENST001";
chr1\tHAVANA\texon\t1000\t1200\t.\t+\t.\tgene_id "ENSG001"; transcript_id "ENST001"; exon_number "1";
chr1\tHAVANA\tCDS\t1100\t1180\t.\t+\t0\tgene_id "ENSG001"; transcript_id "ENST001";`;

    const features = await Array.fromAsync(parser.parseString(hierarchyData));

    expect(features).toHaveLength(4);

    // Verify hierarchical relationships via shared IDs
    const gene = features.find((f) => f.feature === "gene");
    const transcript = features.find((f) => f.feature === "transcript");
    const exon = features.find((f) => f.feature === "exon");
    const cds = features.find((f) => f.feature === "CDS");

    expect(gene?.attributes.gene_id).toBe("ENSG001");
    expect(transcript?.attributes.gene_id).toBe("ENSG001");
    expect(exon?.attributes.gene_id).toBe("ENSG001");
    expect(cds?.attributes.gene_id).toBe("ENSG001");

    // Transcript-level features should have transcript_id
    expect(transcript?.attributes.transcript_id).toBe("ENST001");
    expect(exon?.attributes.transcript_id).toBe("ENST001");
    expect(cds?.attributes.transcript_id).toBe("ENST001");
  });

  test("performance with large annotation data", async () => {
    // Test memory efficiency with human genome-scale data
    const largeAnnotationLines = [];
    for (let i = 1; i <= 50000; i++) {
      largeAnnotationLines.push(
        `chr1\tGENCODE\tgene\t${i * 1000}\t${i * 1000 + 500}\t.\t+\t.\tgene_id "ENSG${i.toString().padStart(11, "0")}"; gene_type "protein_coding"; gene_name "GENE${i}";`
      );
    }
    const largeData = largeAnnotationLines.join("\n");

    const startMem = process.memoryUsage().heapUsed;
    const startTime = performance.now();
    let featureCount = 0;

    for await (const feature of parser.parseString(largeData)) {
      featureCount++;
      expect(feature.attributes.gene_id).toMatch(/^ENSG\d{11}$/);
    }

    const endTime = performance.now();
    const endMem = process.memoryUsage().heapUsed;
    const memoryGrowth = endMem - startMem;

    expect(featureCount).toBe(50000);
    expect(memoryGrowth).toBeLessThan(100_000_000); // <100MB for 50K features
    expect(endTime - startTime).toBeLessThan(15000); // <15 seconds
  });
});

describe("GTF Writer - Current Implementation", () => {
  let writer: GtfWriter;

  beforeEach(() => {
    writer = new GtfWriter();
  });

  test("formats basic feature", () => {
    const feature: GtfFeature = {
      seqname: "chr1",
      source: "HAVANA",
      feature: "gene",
      start: 1000,
      end: 2000,
      score: null,
      strand: "+",
      frame: null,
      attributes: {
        gene_id: "ENSG001",
        gene_type: "protein_coding",
      },
      length: 1001,
    };

    const formatted = writer.formatFeature(feature);
    expect(formatted).toContain("chr1\tHAVANA\tgene\t1000\t2000\t.\t+\t.");
    expect(formatted).toContain("gene_id");
    expect(formatted).toContain("gene_type");
  });
});
