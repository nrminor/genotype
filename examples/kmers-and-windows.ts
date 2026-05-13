/**
 * Typed k-mer windows and set operations.
 *
 * Run from the repository root:
 *
 *   bun examples/kmers-and-windows.ts
 *
 * GenoType tracks the k-mer size in the TypeScript type (`KmerSequence<5>`,
 * `KmerSet<5>`, and so on). That means set operations can be constrained to
 * like-with-like comparisons while the runtime pipeline still behaves like a
 * normal streaming sequence workflow.
 */

import { FastaParser, seqops } from "@genotype/core";

const fastaPath = "examples/data/reference.fasta";
const parser = new FastaParser();

// Generate typed 5-mer windows for chr1. `collectSet()` materializes those
// windows as a KmerSet<5>, preserving k at the type level for set operations.
const chr1Kmers = await seqops(parser.parseFile(fastaPath))
  .filter((record) => record.id === "chr1")
  .kmers(5)
  .collectSet();

// Build the comparable 5-mer set for the amplicon template. Because both sets
// are KmerSet<5>, TypeScript allows intersection and similarity calculations.
const ampliconKmers = await seqops(parser.parseFile(fastaPath))
  .filter((record) => record.id === "amplicon_template")
  .kmers(5)
  .collectSet();
const shared = chr1Kmers.intersection(ampliconKmers);
const jaccardSimilarity = chr1Kmers.jaccardSimilarity(ampliconKmers);
const jaccardSimilarityLabel = jaccardSimilarity.toFixed(3);

// Uncommenting the following shape in an editor would demonstrate the type
// guardrail: KmerSet<5> operations should not be mixed with KmerSet<6>.
// const sixMers = await seqops(parser.parseFile(fastaPath)).kmers(6).collectSet();
// chr1Kmers.intersection(sixMers);

console.log(`chr1 unique 5-mers: ${chr1Kmers.size}`);
console.log(`amplicon_template unique 5-mers: ${ampliconKmers.size}`);
console.log(`shared unique 5-mers: ${shared.size}`);
console.log(`Jaccard similarity: ${jaccardSimilarityLabel}`);

console.log("Example shared 5-mers:");
for (const kmer of shared.toArray().slice(0, 5)) {
  console.log(`  ${kmer.sequence.toString()} from ${kmer.id}`);
}
