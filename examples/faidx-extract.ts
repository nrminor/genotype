/**
 * FASTA random access with a samtools-style .fai index.
 *
 * Run from the repository root:
 *
 *   bun examples/faidx-extract.ts
 *
 * This example builds or loads a FASTA index and extracts named regions using
 * 1-based inclusive coordinates, the convention used by FASTA index tools. The
 * reversed coordinate example (`chr1:20-12`) asks GenoType for the reverse
 * complement of that interval rather than a forward-strand slice.
 */

import { Faidx } from "@genotype/core/operations/faidx";

const fastaPath = "examples/data/reference.fasta";

const faidx = new Faidx(fastaPath, { updateIndex: true });
await faidx.init();

const regions = ["chr1:1-16", "chr1:20-12", "chr2:-8", "amplicon_template:5-36"];

for (const region of regions) {
  const record = await faidx.extract(region);
  console.log(`>${record.id}`);
  console.log(record.sequence.toString());
}
