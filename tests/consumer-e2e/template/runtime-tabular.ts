import { seqops, AbstractSequence } from "@genotype/core";
import "@genotype/tabular";

async function* reads() {
  yield { id: "r1", sequence: "ACGT", length: 4 };
}

const ops = seqops(reads() as unknown as AsyncIterable<AbstractSequence>);

if (typeof ops.toTabular !== "function") throw new Error("missing toTabular");
if (typeof ops.writeCSV !== "function") throw new Error("missing writeCSV");
if (typeof ops.writeTSV !== "function") throw new Error("missing writeTSV");

console.log("tabular extension runtime smoke passed");
