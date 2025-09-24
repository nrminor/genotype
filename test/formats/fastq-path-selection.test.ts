import { describe, expect, test } from "bun:test";
import { FastqParser } from "../../src/formats/fastq/parser";
import type { FastqSequence } from "../../src/types";

describe("FASTQ Intelligent Path Selection", () => {
  describe("auto-detection", () => {
    test("selects fast path for simple 4-line FASTQ", async () => {
      const parser = new FastqParser({
        parsingStrategy: "auto",
        debugStrategy: false,
      });

      const simpleFastq = `@seq1
ATCG
+
IIII
@seq2
GCTA
+
JJJJ`;

      const sequences: FastqSequence[] = [];
      for await (const seq of parser.parseString(simpleFastq)) {
        sequences.push(seq);
      }

      const metrics = parser.getMetrics();

      // Should have used fast path for simple format
      expect(metrics.fastPathCount).toBeGreaterThan(0);
      expect(metrics.stateMachineCount).toBe(0);
      expect(metrics.lastStrategy).toBe("fast");
      expect(metrics.lastDetectedFormat).toBe("simple");
      expect(sequences).toHaveLength(2);
    });

    test("selects state machine for wrapped quality FASTQ", async () => {
      const parser = new FastqParser({
        parsingStrategy: "auto",
        debugStrategy: false,
      });

      // Complex format with wrapped quality lines
      const complexFastq = `@seq1
ATCGATCGATCG
+
IIII
JJJJ
KKKK
@seq2
GCTA
+
LLLL`;

      const sequences: FastqSequence[] = [];
      for await (const seq of parser.parseString(complexFastq)) {
        sequences.push(seq);
      }

      const metrics = parser.getMetrics();

      // Should have used state machine for complex format
      expect(metrics.fastPathCount).toBe(0);
      expect(metrics.stateMachineCount).toBeGreaterThan(0);
      expect(metrics.lastStrategy).toBe("state-machine");
      expect(metrics.lastDetectedFormat).toBe("complex");
      expect(sequences).toHaveLength(2);
    });

    test("selects state machine for multi-line sequences", async () => {
      const parser = new FastqParser({
        parsingStrategy: "auto",
        debugStrategy: false,
      });

      // Complex format with wrapped sequence lines
      const multiLineFastq = `@seq1
ATCG
GCTA
TTAA
+
IIII
JJJJ
KKKK`;

      const sequences: FastqSequence[] = [];
      for await (const seq of parser.parseString(multiLineFastq)) {
        sequences.push(seq);
      }

      const metrics = parser.getMetrics();

      // Should detect as complex and use state machine
      expect(metrics.stateMachineCount).toBeGreaterThan(0);
      expect(metrics.lastStrategy).toBe("state-machine");
      expect(metrics.lastDetectedFormat).toBe("complex");
      expect(sequences).toHaveLength(1);
      expect(sequences[0].sequence).toBe("ATCGGCTATTAA");
    });

    test("respects confidence threshold for parser selection", async () => {
      const parser = new FastqParser({
        parsingStrategy: "auto",
        confidenceThreshold: 0.95, // Very high threshold
        debugStrategy: false,
      });

      // Simple format but with limited data (low confidence)
      const minimalFastq = `@seq1
ATCG
+
IIII`;

      const sequences: FastqSequence[] = [];
      for await (const seq of parser.parseString(minimalFastq)) {
        sequences.push(seq);
      }

      const metrics = parser.getMetrics();

      // With only 1 record, confidence should be low (0.8 + 1/50 = 0.82)
      // Below our 0.95 threshold, so should use state machine
      expect(metrics.stateMachineCount).toBeGreaterThan(0);
      expect(metrics.lastStrategy).toBe("state-machine");
      // Format detection should still identify it as simple
      expect(metrics.lastDetectedFormat).toBe("simple");
      expect(sequences).toHaveLength(1);
    });
  });

  describe("forced strategies", () => {
    test("forces fast path when parsingStrategy='fast'", async () => {
      const parser = new FastqParser({
        parsingStrategy: "fast",
        debugStrategy: false,
      });

      // Even with complex format hint, should use fast path
      const fastq = `@seq1 complex_format_hint
ATCG
+
IIII
@seq2
GCTA
+
JJJJ`;

      const sequences: FastqSequence[] = [];
      for await (const seq of parser.parseString(fastq)) {
        sequences.push(seq);
      }

      const metrics = parser.getMetrics();

      // Should force fast path regardless of format
      expect(metrics.fastPathCount).toBeGreaterThan(0);
      expect(metrics.stateMachineCount).toBe(0);
      expect(metrics.lastStrategy).toBe("fast");
      expect(sequences).toHaveLength(2);
    });

    test("forces state machine when parsingStrategy='state-machine'", async () => {
      const parser = new FastqParser({
        parsingStrategy: "state-machine",
        debugStrategy: false,
      });

      // Simple format that would normally use fast path
      const simpleFastq = `@seq1
ATCG
+
IIII`;

      const sequences: FastqSequence[] = [];
      for await (const seq of parser.parseString(simpleFastq)) {
        sequences.push(seq);
      }

      const metrics = parser.getMetrics();

      // Should force state machine regardless of format
      expect(metrics.fastPathCount).toBe(0);
      expect(metrics.stateMachineCount).toBeGreaterThan(0);
      expect(metrics.lastStrategy).toBe("state-machine");
      expect(sequences).toHaveLength(1);
    });

    test("fast path fails gracefully on complex format", async () => {
      const parser = new FastqParser({
        parsingStrategy: "fast",
        debugStrategy: false,
        skipValidation: true, // Skip validation to allow format errors
      });

      // Complex format that fast path can't handle properly
      const complexFastq = `@seq1
ATCG
GCTA
+
IIII
JJJJ`;

      // Fast path will interpret this incorrectly
      // It will see "GCTA" as a new sequence header (not starting with @)
      // This should either throw an error or produce incorrect results

      const sequences: FastqSequence[] = [];
      let errorThrown = false;

      try {
        for await (const seq of parser.parseString(complexFastq)) {
          sequences.push(seq);
        }
      } catch (error) {
        errorThrown = true;
      }

      const metrics = parser.getMetrics();

      // Fast path was forced
      expect(metrics.lastStrategy).toBe("fast");

      // Either an error was thrown OR sequences were parsed incorrectly
      // (Fast path can't handle multi-line sequences properly)
      if (!errorThrown) {
        // If no error, fast path will have misinterpreted the data
        // It would see each line as separate, not concatenated
        expect(sequences[0].sequence).toBe("ATCG"); // Not "ATCGGCTA" as it should be
      }
    });
  });

  describe("telemetry tracking", () => {
    test("tracks parser usage counts correctly", async () => {
      const parser = new FastqParser({
        parsingStrategy: "auto",
        debugStrategy: false,
      });

      // Parse simple format first
      const simpleFastq = `@seq1
ATCG
+
IIII`;

      for await (const _ of parser.parseString(simpleFastq)) {
        // Just iterate
      }

      let metrics = parser.getMetrics();
      expect(metrics.fastPathCount).toBe(1);
      expect(metrics.stateMachineCount).toBe(0);
      expect(metrics.autoDetectCount).toBe(1);
      expect(metrics.totalSequences).toBe(1);

      // Parse complex format
      const complexFastq = `@seq2
ATCG
GCTA
+
IIII
JJJJ`;

      for await (const _ of parser.parseString(complexFastq)) {
        // Just iterate
      }

      metrics = parser.getMetrics();
      expect(metrics.fastPathCount).toBe(1); // Still 1
      expect(metrics.stateMachineCount).toBe(1); // Now 1
      expect(metrics.autoDetectCount).toBe(2); // Total 2
      expect(metrics.totalSequences).toBe(2); // Total 2
    });

    test("reports last strategy used", async () => {
      const parser = new FastqParser({
        parsingStrategy: "auto",
        debugStrategy: false,
      });

      // First parse with simple
      const simpleFastq = `@seq1
ATCG
+
IIII`;

      for await (const _ of parser.parseString(simpleFastq)) {
        // Just iterate
      }

      let metrics = parser.getMetrics();
      expect(metrics.lastStrategy).toBe("fast");
      expect(metrics.lastDetectedFormat).toBe("simple");

      // Then parse with complex
      const complexFastq = `@seq2
ATCG
GCTA
+
IIII
JJJJ`;

      for await (const _ of parser.parseString(complexFastq)) {
        // Just iterate
      }

      metrics = parser.getMetrics();
      expect(metrics.lastStrategy).toBe("state-machine");
      expect(metrics.lastDetectedFormat).toBe("complex");
    });

    test("resets metrics properly", async () => {
      const parser = new FastqParser({
        parsingStrategy: "auto",
        debugStrategy: false,
      });

      // Parse some data
      const fastq = `@seq1
ATCG
+
IIII`;

      for await (const _ of parser.parseString(fastq)) {
        // Just iterate
      }

      let metrics = parser.getMetrics();
      expect(metrics.totalSequences).toBe(1);
      expect(metrics.autoDetectCount).toBe(1);

      // Reset metrics
      parser.resetMetrics();

      metrics = parser.getMetrics();
      expect(metrics.fastPathCount).toBe(0);
      expect(metrics.stateMachineCount).toBe(0);
      expect(metrics.autoDetectCount).toBe(0);
      expect(metrics.totalSequences).toBe(0);
      expect(metrics.lastStrategy).toBeNull();
      expect(metrics.lastDetectedFormat).toBeNull();
      expect(metrics.lastConfidence).toBeNull();
    });
  });
});
