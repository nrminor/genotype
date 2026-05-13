# GenoType examples

These examples are small, standalone Bun scripts that exercise GenoType against
synthetic genomic fixtures. Run them from the repository root so the workspace
TypeScript path aliases resolve to the local packages.

Most examples use plain text fixtures in `examples/data/`. The alignment example
uses SAM rather than BAM so the fixture stays readable in review, but it goes
through the same `AlignmentParser` interface intended for BAM inputs.

```bash
bun examples/qc-fastq.ts
bun examples/faidx-extract.ts
bun examples/amplicon-extract.ts
bun examples/summarize-alignments.ts
bun examples/query-gtf.ts
bun examples/fasta-to-tabular.ts
bun examples/roundtrip-parquet.ts
bun examples/seqops-pipeline.ts
bun examples/sort-fastq-by-sequence.ts
bun examples/paired-fastq-workflow.ts
bun examples/kmers-and-windows.ts
bun examples/quality-binning.ts
```

## Contents

`qc-fastq.ts` parses FASTQ reads, trims low-quality tails, rejects ambiguous
reads, and prints a compact quality-control summary.

`faidx-extract.ts` builds a FASTA index and extracts named regions using
samtools-style 1-based inclusive coordinates, including reverse-complement
extraction via reversed coordinates.

`amplicon-extract.ts` searches FASTA records for a biologically plausible primer
pair and emits the amplified region.

`summarize-alignments.ts` parses SAM records and summarizes mapped reads,

`query-gtf.ts` parses GTF annotations and uses the query builder to filter by
feature type, chromosome, region, and normalized gene biotype.

`fasta-to-tabular.ts` converts FASTA records to a TSV-like stream with sequence
length, GC content, and alphabet columns.

`roundtrip-parquet.ts` writes sequence records to Apache Parquet, reads them
back through the SeqOps extension, and continues with normal sequence
operations.

`seqops-pipeline.ts` demonstrates the core fluent pipeline style over FASTA:
clean, grep, filter, transform, sort, and collect. Start here if you want to
understand what `seqops()` is and why most examples use it.

`sort-fastq-by-sequence.ts` globally sorts FASTQ records by sequence content,
preserving IDs and qualities while taking the native FASTQ sorter path when the
backend is available.

`paired-fastq-workflow.ts` validates R1/R2 synchronization, interleaves paired
reads, and merges overlapping paired-end reads into consensus output.

`kmers-and-windows.ts` generates typed k-mer windows and demonstrates k-mer set
operations such as intersection and Jaccard similarity.

`quality-binning.ts` collapses raw Phred quality strings into platform-specific
quality bins for compression-friendly FASTQ preprocessing.
