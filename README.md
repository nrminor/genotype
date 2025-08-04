# GenoType

TypeScript library for parsing genomic file formats with streaming support and
comprehensive validation.

## Installation

```bash
bun add genotype
```

## Usage

### FASTA Parsing

```typescript
import { FastaParser } from 'genotype';

const parser = new FastaParser();
for await (const sequence of parser.parseFile('genome.fasta')) {
  console.log(`${sequence.id}: ${sequence.length} bp`);
}
```

### FASTQ Parsing

```typescript
import { FastqParser } from 'genotype';

const parser = new FastqParser({ qualityEncoding: 'phred33' });
for await (const read of parser.parseString(fastqData)) {
  console.log(`${read.id}: ${read.sequence}`);
}
```

### BED Parsing

```typescript
import { BedParser } from 'genotype';

const parser = new BedParser();
for await (const interval of parser.parseString(bedData)) {
  console.log(`${interval.chromosome}:${interval.start}-${interval.end}`);
}
```

## Supported Formats

- FASTA (.fasta, .fa)
- FASTQ (.fastq, .fq)
- BED (.bed)
- SAM (.sam)
- BAM (.bam)

## License

MIT
