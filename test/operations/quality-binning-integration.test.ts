/**
 * Integration tests for quality score binning operation
 *
 * Tests the complete binQuality pipeline including:
 * - Platform preset binning (Illumina, PacBio, Nanopore)
 * - Custom boundary binning
 * - Encoding detection
 * - Pipeline integration
 * - Error handling
 */

import { describe, expect, test } from "bun:test";
import { binQuality } from "../../src/operations/quality";
import type { AbstractSequence, FastqSequence } from "../../src/types";

// Helper to create test FASTQ sequences
function createFastqSequence(id: string, sequence: string, quality: string): FastqSequence {
  return {
    format: "fastq",
    id,
    sequence,
    quality,
    qualityEncoding: "phred33",
    length: sequence.length,
  };
}

// Helper to convert array to async iterable
async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

// Helper to convert async iterable to array
async function collectSequences(
  source: AsyncIterable<AbstractSequence>,
): Promise<AbstractSequence[]> {
  const results: AbstractSequence[] = [];
  for await (const item of source) {
    results.push(item);
  }
  return results;
}

describe("binQuality - Platform Presets", () => {
  test("bins Illumina data with 3-bin preset", async () => {
    const sequences = [
      createFastqSequence("seq1", "ATCG", "!!!!"), // Q0,0,0,0 → all bin 0
      createFastqSequence("seq2", "ATCG", "7777"), // Q22,22,22,22 → all bin 1
      createFastqSequence("seq3", "ATCG", "IIII"), // Q40,40,40,40 → all bin 2
    ];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 3,
        preset: "illumina",
      }),
    );

    expect(binned).toHaveLength(3);

    // Illumina 3-bin uses [15, 30] boundaries
    // Representatives: [7, 22, 40] → ASCII chars ['(', '7', 'I']
    expect((binned[0] as FastqSequence).quality).toBe("(((("); // Q0 → bin 0 → rep 7
    expect((binned[1] as FastqSequence).quality).toBe("7777"); // Q22 → bin 1 → rep 22
    expect((binned[2] as FastqSequence).quality).toBe("IIII"); // Q40 → bin 2 → rep 40
  });

  test("bins PacBio data with 2-bin preset", async () => {
    const sequences = [
      createFastqSequence("seq1", "ATCG", "!!!!"), // Q0 → bin 0
      createFastqSequence("seq2", "ATCG", "5555"), // Q20 → bin 1
    ];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 2,
        preset: "pacbio",
      }),
    );

    expect(binned).toHaveLength(2);

    // PacBio 2-bin uses [13] boundary
    // Representatives: [6, 23] → ASCII chars ['\'', '8']
    expect((binned[0] as FastqSequence).quality).toBe("''''"); // Q0 → bin 0
    expect((binned[1] as FastqSequence).quality).toBe("8888"); // Q20 → bin 1
  });

  test("bins Nanopore data with 5-bin preset", async () => {
    const sequences = [
      createFastqSequence("seq1", "ATCGATCGATCG", "!!!'''777AAA"), // Mixed quality
    ];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 5,
        preset: "nanopore",
      }),
    );

    expect(binned).toHaveLength(1);

    // Nanopore 5-bin uses [5, 9, 12, 18] boundaries
    // Quality should be binned into 5 distinct levels
    const binnedQuality = (binned[0] as FastqSequence).quality;
    expect(binnedQuality.length).toBe(12); // Same length as original

    // Should have reduced unique characters
    const originalUnique = new Set("!!!'''777AAA").size;
    const binnedUnique = new Set(binnedQuality).size;
    expect(binnedUnique).toBeLessThanOrEqual(5); // At most 5 bins
    expect(binnedUnique).toBeLessThan(originalUnique); // Compression
  });
});

describe("binQuality - Custom Boundaries", () => {
  test("bins with custom 2-bin boundaries", async () => {
    const sequences = [
      createFastqSequence("seq1", "ATCG", "!!!!"), // Q0
      createFastqSequence("seq2", "ATCG", "5555"), // Q20
    ];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 2,
        boundaries: [20], // Custom boundary at Q20
      }),
    );

    expect(binned).toHaveLength(2);
    expect((binned[0] as FastqSequence).quality).toBe("++++"); // Q0 → bin 0 → rep 10 → '+'
    expect((binned[1] as FastqSequence).quality).toBe("????"); // Q20 → bin 1 → rep 30 → '?'
  });

  test("bins with custom 3-bin boundaries", async () => {
    const sequences = [
      createFastqSequence("seq1", "ATG", "!5I"), // Q0, Q20, Q40
    ];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 3,
        boundaries: [18, 28], // Custom boundaries
      }),
    );

    expect(binned).toHaveLength(1);

    // Representatives: [9, 23, 38]
    // Q0 → bin 0 → rep 9 → '*'
    // Q20 → bin 1 → rep 23 → '8'
    // Q40 → bin 2 → rep 38 → 'G'
    expect((binned[0] as FastqSequence).quality).toBe("*8G");
  });
});

describe("binQuality - Encoding Detection", () => {
  test("auto-detects phred33 encoding", async () => {
    const sequences = [
      createFastqSequence("seq1", "ATCG", "IIII"), // Clearly phred33
    ];

    // No encoding specified - should auto-detect
    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 2,
        preset: "illumina",
      }),
    );

    expect(binned).toHaveLength(1);
    expect((binned[0] as FastqSequence).quality).toBeDefined();
  });

  test("uses explicit encoding when provided", async () => {
    const sequences = [createFastqSequence("seq1", "ATCG", "!!!!")];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 2,
        preset: "illumina",
        encoding: "phred33", // Explicit encoding
      }),
    );

    expect(binned).toHaveLength(1);
    expect((binned[0] as FastqSequence).quality).toBe("++++");
  });
});

describe("binQuality - Non-FASTQ Sequences", () => {
  test("passes through FASTA sequences unchanged", async () => {
    const sequences = [
      {
        id: "fasta_seq",
        sequence: "ATCGATCG",
        length: 8,
      },
    ];

    const binned = await collectSequences(
      // biome-ignore lint/suspicious/noExplicitAny: Testing non-FASTQ input
      binQuality(sequences as any, {
        bins: 3,
        preset: "illumina",
      }),
    );

    expect(binned).toHaveLength(1);
    expect(binned[0]).toEqual(sequences[0]);
  });

  test("handles mixed FASTA/FASTQ sequences", async () => {
    const sequences = [
      {
        id: "fasta_seq",
        sequence: "ATCG",
        length: 4,
      },
      createFastqSequence("fastq_seq", "ATCG", "!!!!"),
    ];

    const binned = await collectSequences(
      // biome-ignore lint/suspicious/noExplicitAny: Testing mixed FASTA/FASTQ input
      binQuality(sequences as any, {
        bins: 2,
        preset: "illumina",
      }),
    );

    expect(binned).toHaveLength(2);
    expect(binned[0]).toEqual(sequences[0]); // FASTA unchanged
    expect((binned[1] as FastqSequence).quality).toBe("++++"); // FASTQ binned
  });
});

describe("binQuality - Compression Effectiveness", () => {
  test("reduces unique characters in quality string", async () => {
    // Create sequence with high entropy quality scores
    const sequences = [
      createFastqSequence(
        "seq1",
        "ATCGATCGATCGATCGATCGATCG",
        "!\"#$%&'()*+,-./0123456", // 24 unique chars
      ),
    ];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 3,
        preset: "illumina",
      }),
    );

    expect(binned).toHaveLength(1);

    const originalUnique = new Set((sequences[0] as FastqSequence).quality).size;
    const binnedUnique = new Set((binned[0] as FastqSequence).quality).size;

    expect(binnedUnique).toBeLessThanOrEqual(3); // At most 3 bins
    expect(binnedUnique).toBeLessThan(originalUnique); // Compression achieved
  });

  test("creates runs of identical characters", async () => {
    const sequences = [
      createFastqSequence("seq1", "ATCGATCG", "!!!!!!!!"), // All Q0 - 8 identical scores
    ];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 2,
        boundaries: [20],
      }),
    );

    expect(binned).toHaveLength(1);

    // All scores below 20 should map to same character
    const binnedQuality = (binned[0] as FastqSequence).quality;
    expect(binnedQuality).toMatch(/^\++$/); // All should be '+' (rep for bin 0)
  });
});

describe("binQuality - Error Handling", () => {
  test("throws error for invalid preset", async () => {
    const sequences = [createFastqSequence("seq1", "ATCG", "!!!!")];

    await expect(async () => {
      await collectSequences(
        binQuality(toAsyncIterable(sequences), {
          bins: 3,
          // biome-ignore lint/suspicious/noExplicitAny: Testing invalid preset error
          preset: "invalid" as any,
        }),
      );
    }).toThrow();
  });

  test("throws error for invalid bins count", async () => {
    const sequences = [createFastqSequence("seq1", "ATCG", "!!!!")];

    await expect(async () => {
      await collectSequences(
        binQuality(toAsyncIterable(sequences), {
          // biome-ignore lint/suspicious/noExplicitAny: Testing invalid bins count error
          bins: 4 as any, // Invalid - not 2, 3, or 5
          preset: "illumina",
        }),
      );
    }).toThrow();
  });

  test("provides helpful error message with sequence context", async () => {
    const sequences = [createFastqSequence("problem_seq", "ATCG", "!!!!")];

    try {
      await collectSequences(
        binQuality(toAsyncIterable(sequences), {
          bins: 3,
          // biome-ignore lint/suspicious/noExplicitAny: Testing error message with invalid preset
          preset: "nonexistent" as any,
        }),
      );
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("problem_seq");
    }
  });
});

describe("binQuality - Preserves Sequence Properties", () => {
  test("preserves sequence ID", async () => {
    const sequences = [createFastqSequence("my_sequence_id", "ATCG", "!!!!")];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 2,
        preset: "illumina",
      }),
    );

    expect(binned[0].id).toBe("my_sequence_id");
  });

  test("preserves sequence data", async () => {
    const sequences = [createFastqSequence("seq1", "ATCGATCGATCG", "!!!!!!!!!!!!")];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 2,
        preset: "illumina",
      }),
    );

    expect(binned[0].sequence).toBe("ATCGATCGATCG");
    expect(binned[0].length).toBe(12);
  });

  test("preserves quality string length", async () => {
    const sequences = [createFastqSequence("seq1", "ATCGATCG", "!#%'ACEG")];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 3,
        preset: "illumina",
      }),
    );

    expect((binned[0] as FastqSequence).quality.length).toBe(
      (sequences[0] as FastqSequence).quality.length,
    );
  });
});

describe("binQuality - Edge Cases", () => {
  test("handles Solexa encoding with negative scores", async () => {
    const sequences = [
      {
        format: "fastq" as const,
        id: "solexa_seq",
        sequence: "ATCG",
        quality: ";;;;",
        qualityEncoding: "solexa" as const,
        length: 4,
      },
    ];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 2,
        preset: "illumina",
        encoding: "solexa",
      }),
    );

    expect(binned).toHaveLength(1);
    expect((binned[0] as FastqSequence).quality).toBeDefined();
    expect((binned[0] as FastqSequence).quality.length).toBe(4);
  });

  test("handles Phred64 encoding", async () => {
    const sequences = [
      {
        format: "fastq" as const,
        id: "phred64_seq",
        sequence: "ATCGATCG",
        quality: "hhhhhhhh",
        qualityEncoding: "phred64" as const,
        length: 8,
      },
    ];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 3,
        preset: "illumina",
        encoding: "phred64",
      }),
    );

    expect(binned).toHaveLength(1);
    expect((binned[0] as FastqSequence).quality).toBeDefined();
    expect((binned[0] as FastqSequence).quality.length).toBe(8);
  });

  test("explicit encoding overrides auto-detection", async () => {
    const sequences = [createFastqSequence("seq1", "ATCG", "@@@@")];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 2,
        preset: "illumina",
        encoding: "phred64",
      }),
    );

    expect(binned).toHaveLength(1);
    const binnedQuality = (binned[0] as FastqSequence).quality;
    expect(binnedQuality).toBeDefined();
    expect(binnedQuality.length).toBe(4);
  });

  test("handles quality scores at exact boundary values", async () => {
    const sequences = [createFastqSequence("seq1", "ATCGATCG", "!!000???")];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 3,
        boundaries: [15, 30],
      }),
    );

    expect(binned).toHaveLength(1);
    const binnedQuality = (binned[0] as FastqSequence).quality;
    expect(binnedQuality).toBeDefined();
    expect(binnedQuality.length).toBe(8);
  });

  test("handles extreme quality scores (Q0 and Q93)", async () => {
    const sequences = [createFastqSequence("seq1", "ATCGATCG", "!!!!~~~~")];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 2,
        preset: "illumina",
      }),
    );

    expect(binned).toHaveLength(1);
    const binnedQuality = (binned[0] as FastqSequence).quality;
    expect(binnedQuality).toBeDefined();
    expect(binnedQuality.length).toBe(8);
  });

  test("handles empty sequence stream", async () => {
    const sequences: FastqSequence[] = [];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 2,
        preset: "illumina",
      }),
    );

    expect(binned).toHaveLength(0);
  });

  test("handles single base sequences", async () => {
    const sequences = [createFastqSequence("seq1", "A", "I")];

    const binned = await collectSequences(
      binQuality(toAsyncIterable(sequences), {
        bins: 3,
        preset: "illumina",
      }),
    );

    expect(binned).toHaveLength(1);
    expect((binned[0] as FastqSequence).quality.length).toBe(1);
  });
});
