import { AbstractSequence, primer, seqops } from "@genotype/core";
import "@genotype/tabular";

void primer.literal("TCGTCGGCAGCG");

async function* reads() {
  yield { id: "r1", sequence: "ACGT", length: 4 };
}

const ops = seqops(reads() as unknown as AsyncIterable<AbstractSequence>);
ops.toTabular();
ops.writeCSV("/tmp/out.csv");
ops.writeTSV("/tmp/out.tsv");
