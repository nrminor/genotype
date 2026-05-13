/**
 * Summarize SAM/BAM alignment records.
 *
 * Run from the repository root after the native module has been built:
 *
 *   bun run build:native:dev
 *   bun examples/summarize-alignments.ts
 *
 * The fixture is SAM so that the example data stays readable in version control,
 * but the same AlignmentParser is intended for BAM inputs as well. Alignment
 * records also flow through SeqOps, so you can combine mapping-specific filters
 * with normal sequence operations.
 */

import { AlignmentParser, SeqOps, seqops } from "@genotype/core";
import type { AlignmentRecord } from "@genotype/core/types";

const samPath = "examples/data/alignments.sam";

const parser = new AlignmentParser();

// Start with the simplest terminal operation: parse every alignment record and
// collect it into an array so we can report the total input size.
const allRecords = await seqops(parser.parseFile(samPath)).collect();

// Alignment filters understand SAM flags. Here we exclude flag 0x4, the standard
// SAM bit for an unmapped read.
const mappedRecords = await seqops(parser.parseFile(samPath))
  // SAM flag 0x4 means "this read is unmapped". Excluding it leaves mapped reads.
  .filter({ excludeFlags: 0x4 })
  .collect();

// Combine a flag filter with a mapping-quality threshold to keep reads that are
// both mapped and confidently placed.
const highConfidenceMappings = await seqops(parser.parseFile(samPath))
  .filter({ excludeFlags: 0x4, minMapQ: 30 })
  .collect();

// Filter by reference sequence when you only care about one chromosome/contig.
const chr1Mappings = await seqops(parser.parseFile(samPath))
  .filter({ referenceSequence: "chr1" })
  .collect();

// Region filters use familiar "reference:start-end" coordinates for simple
// interval-style queries over alignment starts and read spans.
const readsInRegion = await seqops(parser.parseFile(samPath))
  .filter({ region: "chr1:25-40" })
  .collect();

// Alignment records are still sequence records, so predicate filters work too.
// Here we pick out reads whose CIGAR string contains a soft-clip operation.
const softClippedReads = await seqops(parser.parseFile(samPath))
  .filter((record) => record.cigar.includes("S"))
  .collect();

// Alignment-aware transforms can normalize those records. This trims soft-clipped
// bases from the sequence/quality strings and updates the CIGAR string.
const trimmedSoftClips = await SeqOps.from(softClippedReads)
  .transform({ trimSoftClips: true })
  .collect();

const byReference = countMappedReadsByReference(mappedRecords);

console.log(`Total records: ${allRecords.length}`);
console.log(`Mapped records: ${mappedRecords.length}`);
console.log(`High-confidence mappings (MAPQ >= 30): ${highConfidenceMappings.length}`);
console.log(`chr1 mappings: ${chr1Mappings.length}`);
console.log(`Reads overlapping chr1:25-40: ${readsInRegion.length}`);

console.log("Records by reference:");
for (const [reference, count] of byReference) {
  console.log(`  ${reference}: ${count}`);
}

console.log("Soft-clip trimming:");
for (let index = 0; index < softClippedReads.length; index++) {
  const originalRead = softClippedReads[index];
  const trimmedRead = trimmedSoftClips[index] as AlignmentRecord | undefined;

  if (originalRead === undefined || trimmedRead === undefined) {
    continue;
  }

  console.log(`  ${originalRead.id}: ${originalRead.cigar} -> ${trimmedRead.cigar}`);
}

function countMappedReadsByReference(records: AlignmentRecord[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const record of records) {
    const currentCount = counts.get(record.referenceSequence) ?? 0;
    counts.set(record.referenceSequence, currentCount + 1);
  }

  return counts;
}
