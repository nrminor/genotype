# GenoType

[![CI](https://github.com/nrminor/genotype/actions/workflows/ci.yml/badge.svg)](https://github.com/nrminor/genotype/actions/workflows/ci.yml)
[![Build Native](https://github.com/nrminor/genotype/actions/workflows/build.yml/badge.svg)](https://github.com/nrminor/genotype/actions/workflows/build.yml)
[![Genomics Validation](https://github.com/nrminor/genotype/actions/workflows/genomics-validation.yml/badge.svg)](https://github.com/nrminor/genotype/actions/workflows/genomics-validation.yml)
[![Docs Build Status](https://github.com/nrminor/genotype/actions/workflows/docs.yml/badge.svg)](https://github.com/nrminor/genotype/actions/workflows/docs.yml)
[![Docs Site](https://img.shields.io/badge/docs-TypeDoc-blue.svg)](https://nrminor.github.io/genotype/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue.svg)](https://www.typescriptlang.org/)
[![Bun v1.2.21](https://img.shields.io/badge/Bun-000?logo=bun&logoColor=fff)](#)
[![Rust v1.89.0](https://img.shields.io/badge/Rust-%23000000.svg?e&logo=rust&logoColor=white)](#)
[![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)
[![Formatted with Biome](https://img.shields.io/badge/Formatted_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

> [!CAUTION]
> GenoType is coming together but is not ready for the bigtime yet. In
> particular, its BAM parser and compression handling are under-tested and may
> come with correctness issues. However, FASTQ and FASTA parsing along with the
> sequence operations `SeqOps` API is comparatively more stable and working in
> internal tests. That said, _breaking changes should be expected_--this is
> pre-alpha software.

## GenoType's Goal?

GenoType's goal is to fill a gap in the TypeScript ecosystem by providing a
fully type-safe, performant, idiomatic library for parsing and processing
genomic data in any of the major bioinformatic data formats. It's built with an
obsession with developer experience and is meant to enable users to compose
their own pipelines of sequence transformations. For example, the following
"pipeline", mirroring a Unix pipeline of operations from the excellent
[Seqkit command line interface](https://bioinf.shenwei.me/seqkit/), can be
composed in TypeScript like so:

```typescript
import { seqops } from "genotype";

const results = await seqops(genomeSequences)
  .grep({ pattern: /^chr\d+/, target: "id" }) // Find chromosome sequences
  .filter({ minLength: 100, maxGC: 60 }) // Quality filtering
  .sample({ n: 1000, strategy: "reservoir" }) // Statistical sampling
  .sort({ by: "length", order: "desc" }) // Compression-optimized sorting
  .rmdup({ by: "sequence", caseSensitive: false }) // Remove duplicates
  .writeFasta("analyzed_genome.fasta");
```

Eventually, GenoType will ship with complete feature parity with Seqkit.
Together with Bun or Deno, this will mean users can write sequence
transformation pipelines with the DX and type safety of TypeScript instead of
writing Bash. Bun/Deno scripts performing these pipelines can then be
[compiled
into portable standalone executables](https://bun.com/docs/bundler/executables)--unlike
Bash scripts using `seqkit` or whatever else, where users can still only use the
scripts if `seqkit` and other dependencies installed,
[`Bun`](https://bun.com/docs/bundler/executables) or
[`Deno`](https://docs.deno.com/runtime/reference/cli/compile/) executables using
GenoType are fully self-contained and portable.

This combination of a composable, type-safe API for building dependency-free
bioinformatic processing programs is what GenoType is all about.

## Installation

> [!WARNING]
> GenoType is not available on NPM yet, so the following will not work. Instead,
> if you're using bun, you can add it from source (again, at your own risk) into
> your own project with `bun add github:nrminor/genotype`.

```bash
bun add @nrminor/genotype
```

## Real-World Examples

### Quality Control Pipeline

**Problem**: You've received Illumina sequencing data from a collaborator. As
always, it needs quality control before analysis.

```typescript
import { seqops } from "genotype";
import { FastqParser } from "genotype/formats";

// Parse FASTQ with quality encoding specification (or automatic detection)
const parser = new FastqParser({
  qualityEncoding: "phred33", // Specify encoding, or omit for automatic detection
  parseQualityScores: true, // Enable quality score parsing for QC
});
const reads = parser.parseFile("SRR12345678.fastq.gz");

// Build a comprehensive QC pipeline
const qcStats = await seqops(reads)
  // Step 1: Quality filtering
  .quality({
    minScore: 20, // Phred score threshold
    trim: true, // Enable quality trimming
    trimThreshold: 20, // Sliding window quality
    trimWindow: 4, // Window size
  })
  // Step 2: Length filtering (post-trimming)
  .filter({
    minLength: 35, // Minimum read length
    maxLength: 151, // Remove anomalously long reads
  })
  // Step 3: Contamination screening
  .filter({
    pattern: /^[ACGTN]+$/, // Valid bases only
    hasAmbiguous: false, // No ambiguous bases
  })
  // Step 4: Calculate statistics
  .stats({ detailed: true });

console.log(`
QC Report:
- Input reads: ${qcStats.totalSequences}
- Passed QC: ${qcStats.passedSequences} (${qcStats.passRate}%)
- Mean quality: ${qcStats.meanQuality}
- N50: ${qcStats.n50}
- GC content: ${qcStats.gcContent}%
`);
```

### Amplicon Extraction for Targeted Sequencing

**Problem**: You need to extract specific amplicon regions from sequencing data
using PCR primers, with support for long reads and biological validation.

```typescript
import { primer, seqops } from "genotype";

// Define primers with validation and IUPAC support
const forwardPrimer = primer`TCGTCGGCAGCGTCAGATGTGTATAAGAGACAG`; // Nextera adapter
const reversePrimer = primer`GTCTCGTGGGCTCGGAGATGTGTATAAGAGACAG`; // Nextera adapter

// Simple amplicon extraction (90% use case)
const basicAmplicons = await seqops(reads)
  .amplicon(forwardPrimer, reversePrimer) // Extract between primers
  .filter({ minLength: 100, maxLength: 500 }) // Quality filtering
  .writeFasta("extracted_amplicons.fasta");

// Advanced workflow with performance optimization for long reads
const optimizedAmplicons = await seqops(nanoporeReads)
  .quality({ minScore: 10 }) // Nanopore quality threshold
  .amplicon(forwardPrimer, reversePrimer, {
    maxMismatches: 2, // Allow sequencing errors
    searchWindow: { forward: 200, reverse: 200 }, // 🔥 100x+ speedup for long reads
    flanking: false, // Inner region only (exclude primers)
    outputMismatches: true, // Include debugging info
  })
  .filter({ minLength: 200, maxLength: 800 }) // Target region length
  .rmdup({ by: "sequence" }) // Remove PCR duplicates
  .validate({ mode: "strict" }) // Biological validation
  .writeFasta("validated_amplicons.fasta");

// Real-world COVID-19 diagnostic example
import { FastqParser } from "genotype/formats";

const covidResults = await seqops(
  new FastqParser().parseFile("covid_samples.fastq.gz"),
)
  .quality({ minScore: 20, trim: true })
  .amplicon(
    primer`ACCAGGAACTAATCAGACAAG`, // N gene forward
    primer`CAAAGACCAATCCTACCATGAG`, // N gene reverse
    3, // Allow for sequencing errors
  )
  .validate({ mode: "strict" })
  .stats({ detailed: true });

console.log(`Found ${covidResults.count} COVID amplicons`);
```

### CRISPR Guide RNA Design

**Problem**: You need to design guide RNAs for CRISPR, filtering for optimal GC
content and checking for off-target sites.

```typescript
const potentialGuides = await seqops(sequences)
  // Extract all possible 20bp guide sequences
  .transform({
    custom: seq => extractKmers(seq, 20)
  })

  // Filter for optimal guide characteristics
  .filter({
    minGC: 40,        // Minimum 40% GC
    maxGC: 60,        // Maximum 60% GC
    pattern: /GG$/    // Must end with PAM-adjacent GG
  })

  // Remove guides with problematic sequences
  .filter({
    custom: guide => {
      // No poly-T (terminates RNA pol III)
      if (/TTTT/.test(guide.sequence)) return false;

      // No extreme secondary structure
      const mfe = calculateMFE(guide.sequence);
      if (mfe < -10) return false;

      return true;
    }
  })

  // Check for off-targets in genome
  .filter({
    custom: async guide => {
      const offTargets = await searchGenome(guide.sequence, maxMismatches: 3);
      return offTargets.length === 1; // Only one perfect match
    }
  })

  .collect();

console.log(`Found ${potentialGuides.length} suitable guide RNAs`);
```

### Differential Expression Sample Prep

**Problem**: RNA-seq data needs preprocessing before differential expression
analysis.

```typescript
const processedReads = await seqops(rnaseqReads)
  // Remove adapter sequences
  .clean({
    removeAdapters: true,
    adapters: ["AGATCGGAAGAGC", "AATGATACGGCGAC"],
  })
  // Filter rRNA contamination (using bloom filter for speed)
  .filter({
    custom: (seq) => !rRNABloomFilter.contains(seq.sequence),
  })
  // Remove low-complexity sequences
  .filter({
    custom: (seq) => calculateComplexity(seq.sequence) > 0.5,
  })
  // Deduplicate while preserving read counts
  .deduplicate({
    by: "sequence",
    keepCounts: true,
  })
  // Convert to format for aligner
  .transform({ upperCase: true })
  .writeFastq("processed_rnaseq.fastq");
```

### Viral Genome Assembly QC

**Problem**: Validate assembled viral genomes before submission to GenBank.

```typescript
const validationReport = await seqops(assemblies)
  // Check genome completeness
  .filter({
    minLength: 29000, // SARS-CoV-2 minimum
    maxLength: 30000, // SARS-CoV-2 maximum
  })
  // Validate sequence content
  .validate({
    mode: "strict",
    allowAmbiguous: true, // Some Ns acceptable
    maxAmbiguous: 100, // But not too many
    action: "reject", // Reject invalid sequences
  })
  // Check for frameshifts in coding regions
  .validate({
    custom: async (seq) => {
      const orfs = await findORFs(seq.sequence);
      return orfs.every((orf) => orf.length % 3 === 0);
    },
  })
  // Add metadata for submission
  .annotate({
    organism: "Severe acute respiratory syndrome coronavirus 2",
    molType: "genomic RNA",
    isolate: metadata.isolate,
    country: metadata.country,
    collectionDate: metadata.date,
  })
  .stats({ detailed: true });

if (validationReport.passedSequences === validationReport.totalSequences) {
  console.log("✅ All genomes passed validation");
} else {
  console.log(
    `⚠️ ${validationReport.failedSequences} genomes failed validation`,
  );
}
```
