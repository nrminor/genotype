/**
 * Type-safe GTF parsing and biological feature queries.
 *
 * Run from the repository root:
 *
 *   bun examples/query-gtf.ts
 *
 * This example parses a small GENCODE-like annotation and queries it by feature
 * type, chromosome, genomic region, and normalized gene biotype. The query
 * builder constrains feature names, human chromosome names, and region strings
 * with TypeScript types, so common annotation-query typos are caught early.
 */

import { readFile } from "node:fs/promises";
import { GtfParser, queryGtf } from "@genotype/core/formats/gtf";

const gtfPath = "examples/data/annotations.gtf";
const gtfText = await readFile(gtfPath, "utf8");

const parser = new GtfParser({ normalizeAttributes: true, detectDatabaseVariant: true });

const proteinCodingGenes = await queryGtf(parser)
  .from(gtfText)
  .filterByFeature("gene")
  .filterByGeneType("protein_coding")
  .collect();

const chr1ExonsInRegion = await queryGtf(parser)
  .from(gtfText)
  .filterByChromosome("chr1")
  .filterByRegion("chr1:1-64")
  .filterByFeature("exon")
  .collect();

console.log(`Protein-coding genes: ${proteinCodingGenes.length}`);
for (const gene of proteinCodingGenes) {
  const geneLabel = gene.attributes.gene_name ?? gene.attributes.gene_id;
  const geneLocation = `${gene.seqname}:${gene.start}-${gene.end}`;

  console.log(`  ${geneLabel}: ${geneLocation}`);
}

console.log(`chr1 exons in chr1:1-64: ${chr1ExonsInRegion.length}`);
for (const exon of chr1ExonsInRegion) {
  const transcriptId = exon.attributes.transcript_id;
  const exonNumber = exon.attributes.exon_number;
  const exonLocation = `${exon.start}-${exon.end}`;

  console.log(`  ${transcriptId} exon ${exonNumber}: ${exonLocation}`);
}
