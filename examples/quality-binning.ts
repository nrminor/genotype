/**
 * Quality score binning for compression-friendly FASTQ workflows.
 *
 * Run from the repository root:
 *
 *   bun examples/quality-binning.ts
 *
 * Quality binning collapses many raw Phred values into a smaller number of
 * representative scores. That is a common lossy preprocessing step for reducing
 * FASTQ entropy before storage. GenoType exposes this through the same typed
 * `quality()` pipeline used for filtering and trimming, with accelerated quality
 * kernels used by the backend when available.
 */

import { FastqParser, SeqOps } from "@genotype/core";
import { calculateCompressionRatio } from "@genotype/core/operations/core/quality";
import type { FastqSequence } from "@genotype/core/types";

const readsPath = "examples/data/reads.fastq";
const parser = new FastqParser({ qualityEncoding: "phred33" });
const original: FastqSequence[] = [];

for await (const read of parser.parseFile(readsPath)) {
  original.push(read);
}

// Binning is expressed as a SeqOps quality operation. Here the Illumina 3-bin
// preset collapses many possible Phred characters into low / medium / high bins.
const binnedReads = await SeqOps.from(original)
  // The type of QualityOptions prevents mixing a platform preset with custom
  // boundaries, and checks custom boundary tuple lengths for 2/3/5-bin schemes.
  .quality({ bins: 3, preset: "illumina" })
  .collect();

for (let readIndex = 0; readIndex < binnedReads.length; readIndex++) {
  const originalRead = original[readIndex];
  const binnedRead = binnedReads[readIndex];

  if (originalRead === undefined || binnedRead === undefined) {
    continue;
  }

  const originalQuality = originalRead.quality.toString();
  const binnedQuality = binnedRead.quality.toString();
  const originalQualityAlphabetSize = countUniqueCharacters(originalQuality);
  const binnedQualityAlphabetSize = countUniqueCharacters(binnedQuality);
  const compressionPotential = calculateCompressionRatio(originalQuality, binnedQuality);

  console.log(binnedRead.id);
  console.log(`  quality before: ${originalQuality}`);
  console.log(`  quality after:  ${binnedQuality}`);
  console.log(
    `  unique quality chars: ${originalQualityAlphabetSize} -> ${binnedQualityAlphabetSize}`
  );
  console.log(`  compression potential: ${compressionPotential.toFixed(2)}x`);
}

function countUniqueCharacters(text: string): number {
  const uniqueCharacters = new Set<string>();

  for (const character of text) {
    uniqueCharacters.add(character);
  }

  return uniqueCharacters.size;
}
