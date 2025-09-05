# GenoType

[![Documentation](https://img.shields.io/badge/docs-TypeDoc-blue.svg)](https://nrminor.github.io/genotype/)

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

// Parse FASTQ with automatic quality encoding detection
const parser = new FastqParser({ autoDetectEncoding: true });
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

### 🔬 Primer Trimming for Amplicon Sequencing

**Problem**: Your amplicon sequencing data has primer sequences that need to be
removed before variant calling.

```typescript
const FORWARD_PRIMER = "TCGTCGGCAGCGTCAGATGTGTATAAGAGACAG";
const REVERSE_PRIMER = "GTCTCGTGGGCTCGGAGATGTGTATAAGAGACAG";

const trimmedAmplicons = await seqops(amplicons)
  // Remove primers from both ends
  .transform({
    custom: (seq) => {
      // Trim forward primer if present
      if (seq.startsWith(FORWARD_PRIMER)) {
        seq = seq.slice(FORWARD_PRIMER.length);
      }
      // Check for reverse primer (as reverse complement)
      const rcPrimer = reverseComplement(REVERSE_PRIMER);
      if (seq.endsWith(rcPrimer)) {
        seq = seq.slice(0, -rcPrimer.length);
      }
      return seq;
    },
  })
  // Filter out sequences that are too short after trimming
  .filter({ minLength: 100 })
  // Extract only the target region (e.g., 16S V4)
  .subseq({ region: "1:250" })
  .writeFasta("trimmed_amplicons.fasta");
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

## Core Features

### Streaming Operations

Process files larger than memory with async iterators:

```typescript
// Process a 100GB FASTQ file without loading it into memory
const parser = new FastqParser();
const reads = parser.parseFile("huge_dataset.fastq.gz");

await seqops(reads)
  .filter({ minLength: 100 })
  .head(1_000_000) // Process first million only
  .writeFastq("subset.fastq");
```

### Type-Safe Pipeline Operations

Full TypeScript support with intelligent type inference:

```typescript
// TypeScript knows these are FASTQ sequences
const fastqReads = await seqops(reads)
  .quality({ minScore: 30 }) // ← Only available for FASTQ
  .collect();

// Type error: quality() not available for FASTA
const fastaSeqs = await seqops(genes)
  .quality({ minScore: 30 }) // ← TypeScript error!
  .collect();
```

### Composable Operations

Build complex pipelines from simple, focused operations:

```typescript
// Each operation has a single, clear purpose
await seqops(sequences)
  .filter({ minLength: 100 }) // Remove short sequences
  .transform({ reverseComplement }) // Reverse complement all
  .clean({ removeGaps: true }) // Remove alignment gaps
  .validate({ mode: "strict" }) // Ensure valid sequences
  .deduplicate({ by: "sequence" }) // Remove duplicates
  .sort({ by: "length" }) // Sort by length
  .head(1000) // Take top 1000
  .writeFasta("output.fasta"); // Write results
```

### Complete SeqKit Functionality

** SeqKit Feature Parity**

```typescript
// Pattern search and filtering (like seqkit grep)
await seqops(sequences)
  .grep({ pattern: /^chr\d+/, target: "id" }) // Regex patterns
  .grep({
    pattern: "ATCG",
    target: "sequence", // Fuzzy sequence matching
    allowMismatches: 2,
    searchBothStrands: true,
  })
  .writeFasta("chromosome_sequences.fasta");

// Statistical sampling (like seqkit sample)
await seqops(millionSequences)
  .sample({ n: 10000, strategy: "reservoir", seed: 42 }) // Reproducible sampling
  .sample({ n: 1000, strategy: "systematic" }) // Even distribution
  .writeFasta("sampled_data.fasta");

// Compression-optimized sorting (like seqkit sort)
await seqops(sequences)
  .sort({ by: "length", order: "desc" }) // Length-based clustering
  .sort({ by: "gc", order: "asc" }) // GC content clustering
  .writeFasta("sorted_for_compression.fasta");

// Sophisticated deduplication (like seqkit rmdup)
await seqops(sequencingReads)
  .rmdup({
    by: "sequence",
    exact: false, // Bloom filter efficiency
    falsePositiveRate: 0.001,
  }) // Configurable accuracy
  .rmdup({ by: "id", exact: true }) // Perfect ID deduplication
  .writeFasta("deduplicated_reads.fasta");
```

### Native Performance

**Coming soon**: Native Rust optimizations for critical genomic bottlenecks!

```typescript
// Operations marked for native acceleration:
const results = await seqops(millionSequences)
  .grep({ pattern: "ATCG" }) // NATIVE_BENEFICIAL: SIMD pattern matching
  .sort({ by: "gc" }) // NATIVE_CRITICAL: Vectorized GC calculation
  .rmdup({ by: "sequence" }) // NATIVE_CRITICAL: Optimized hash operations
  .collect();
```

## Philosophy

GenoType follows these core principles:

- **Real-world ready**: Handles malformed files, edge cases, and the chaos of
  actual genomic data
- **Zero dependencies**: Built entirely on Bun's native capabilities for
  security and performance
- **Developer experience**: Intuitive APIs that make common tasks trivial and
  complex tasks possible
- **Fail-fast validation**: Clear error messages that help you fix problems
  quickly
- **Tiger Style compliance**: Correctness over performance, simplicity over
  cleverness

## Documentation

- [API Reference](./docs/api.md)
- [File Format Support](./docs/formats.md)
- [Performance Guide](./docs/performance.md)
- [Examples](./examples/)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for
guidelines.

## License

MIT

---

_Built with [Bun](https://bun.sh/) • Acceleration powered by
[Rust](https://www.rust-lang.org/) • Validation powered by
[ArkType](https://arktype.io/)_
