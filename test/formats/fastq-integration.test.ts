/**
 * Integration test for FASTQ module restructuring
 * Verifies that all imports work correctly after module split
 */

import { describe, expect, test } from "bun:test";

// Test individual exports from new module structure
import {
  FastqParser,
  FastqParsingState,
  FastqUtils,
  FastqWriter,
  parseMultiLineFastq,
} from "../../src/formats/fastq";
// Test that all exports are available from the module
import * as FastqMain from "../../src/formats/fastq/";
// Import quality operations from the new core module
import {
  calculateQualityStats as calculateStats,
  scoresToQuality as scoresToString,
  qualityToScores as toNumbers,
} from "../../src/operations/core/quality";
// Import types from the main types module
import type { FastqSequence, QualityEncoding } from "../../src/types";

describe("FASTQ Module Integration", () => {
  test("all exports are available from index.ts", () => {
    // Core classes
    expect(FastqParser).toBeDefined();
    expect(FastqWriter).toBeDefined();
    expect(FastqUtils).toBeDefined();

    // Quality functions
    // QualityScores removed - use direct imports instead
    expect(toNumbers).toBeDefined();
    expect(scoresToString).toBeDefined();
    expect(calculateStats).toBeDefined();

    // Multi-line parser
    expect(parseMultiLineFastq).toBeDefined();

    // Enums
    expect(FastqParsingState).toBeDefined();
  });

  test("main fastq module exports are available", () => {
    expect(FastqMain.FastqParser).toBeDefined();
    expect(FastqMain.FastqWriter).toBeDefined();
    expect(FastqMain.FastqUtils).toBeDefined();
  });

  test("no circular dependencies - can instantiate all classes", () => {
    // This would fail if there were circular dependencies
    const parser = new FastqParser();
    expect(parser).toBeDefined();

    const writer = new FastqWriter();
    expect(writer).toBeDefined();

    // FastqUtils is an object, not a class
    expect(FastqUtils.detectFormat).toBeDefined();
    expect(FastqUtils.countSequences).toBeDefined();
  });

  test("quality conversion works across modules", () => {
    const phred33Scores = "IIIIIIIIII";
    const numericScores = toNumbers(phred33Scores, "phred33");
    expect(numericScores).toEqual([40, 40, 40, 40, 40, 40, 40, 40, 40, 40]);

    const backToString = scoresToString(numericScores, "phred33");
    expect(backToString).toBe(phred33Scores);
  });

  test("QualityScores aggregate object works", () => {
    const phred33Scores = "IIIIIIIIII";
    const numericScores = toNumbers(phred33Scores, "phred33");
    expect(numericScores).toEqual([40, 40, 40, 40, 40, 40, 40, 40, 40, 40]);

    const backToString = scoresToString(numericScores, "phred33");
    expect(backToString).toBe(phred33Scores);

    const stats = calculateStats(numericScores);
    expect(stats.mean).toBe(40);
  });

  test("multi-line parser integration", async () => {
    const multilineContent = `@read1
ATCG
ATCG
+
IIII
IIII`;

    const lines = multilineContent.split("\n");
    const sequences: FastqSequence[] = [];
    const options = {
      maxLineLength: 10000,
      onError: (msg: string) => {
        throw new Error(msg);
      },
    };

    for await (const seq of parseMultiLineFastq(lines, 1, options)) {
      sequences.push(seq);
    }

    expect(sequences).toHaveLength(1);
    expect(sequences[0].sequence).toBe("ATCGATCG");
    expect(sequences[0].quality).toBe("IIIIIIII");
  });

  describe("Paired-End Integration", () => {
    test("PairedFastqParser imports correctly from main module", () => {
      const { PairedFastqParser } = require("../../src/formats/fastq");
      expect(PairedFastqParser).toBeDefined();
      
      const parser = new PairedFastqParser();
      expect(parser).toBeDefined();
    });

    test("PairSyncError imports correctly from main module", () => {
      const { PairSyncError } = require("../../src/formats/fastq");
      expect(PairSyncError).toBeDefined();
      expect(PairSyncError.name).toBe("PairSyncError");
    });

    test("paired parsing works alongside single-file parsing", async () => {
      const { FastqParser, PairedFastqParser } = require("../../src/formats/fastq");
      
      const singleParser = new FastqParser();
      const pairedParser = new PairedFastqParser();
      
      const r1Data = "@read1/1\nATCG\n+\nIIII";
      const r2Data = "@read1/2\nCGAT\n+\nIIII";
      
      const singleReads: FastqSequence[] = [];
      for await (const read of singleParser.parseString(r1Data)) {
        singleReads.push(read);
      }
      
      const pairs = [];
      for await (const pair of pairedParser.parseStrings(r1Data, r2Data)) {
        pairs.push(pair);
      }
      
      expect(singleReads).toHaveLength(1);
      expect(pairs).toHaveLength(1);
      expect(pairs[0].r1.id).toBe(singleReads[0].id);
    });

    test("quality score parsing works in paired mode", async () => {
      const { PairedFastqParser } = require("../../src/formats/fastq");
      
      const parser = new PairedFastqParser({
        qualityEncoding: "phred33",
        parseQualityScores: true,
      });
      
      const r1 = "@read1/1\nATCG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII";
      
      const pairs = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }
      
      expect(pairs).toHaveLength(1);
      expect(pairs[0].r1.quality).toBe("IIII");
      expect(pairs[0].r2.quality).toBe("IIII");
    });

    test("parser metrics collection works for paired parsing", async () => {
      const { PairedFastqParser } = require("../../src/formats/fastq");
      
      const parser = new PairedFastqParser();
      const r1 = "@read1/1\nATCG\n+\nIIII\n@read2/1\nGGGG\n+\nIIII";
      const r2 = "@read1/2\nCGAT\n+\nIIII\n@read2/2\nCCCC\n+\nIIII";
      
      const pairs = [];
      for await (const pair of parser.parseStrings(r1, r2)) {
        pairs.push(pair);
      }
      
      const metrics = parser.getMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics.r1).toBeDefined();
      expect(metrics.r2).toBeDefined();
      expect(metrics.r1.totalSequences).toBe(2);
      expect(metrics.r2.totalSequences).toBe(2);
    });
  });
});
