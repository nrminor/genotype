import { AbstractSequence } from "@genotype/core";
import { SeqOps, seqops } from "@genotype/core/seqops";
import "@genotype/parquet";

const ops = seqops(
  (async function* () {
    yield { id: "s1", sequence: "ACGT", length: 4 };
  })() as unknown as AsyncIterable<AbstractSequence>
);

if (typeof ops.writeParquet !== "function") {
  throw new Error("missing writeParquet");
}

const SeqOpsWithParquet = SeqOps as typeof SeqOps & { fromParquet?: unknown };
if (typeof SeqOpsWithParquet.fromParquet !== "function") {
  throw new Error("missing SeqOps.fromParquet");
}

console.log("parquet extension runtime smoke passed");
