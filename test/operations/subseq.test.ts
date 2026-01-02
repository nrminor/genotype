/**
 * Tests for SubseqExtractor - subsequence extraction operations
 *
 * Tests cover:
 * - Basic subsequence extraction
 * - Region parsing and coordinate systems
 * - BED/GTF format support
 * - Strand handling and reverse complement
 * - Flanking sequence extraction
 * - Circular sequence handling
 * - Multiple region extraction and concatenation
 * - Error handling and validation
 * - Integration with utility functions
 */

import { describe, expect, test } from "bun:test";
import { SubseqExtractor } from "../../src/operations/subseq";
import type { AbstractSequence, FastqSequence } from "../../src/types";

describe("SubseqExtractor", () => {
  // Helper functions
  function createSequence(id: string, sequence: string): AbstractSequence {
    return { id, sequence, length: sequence.length };
  }

  async function* arrayToAsync<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item;
    }
  }

  async function collectResults<T>(iter: AsyncIterable<T>): Promise<T[]> {
    const results: T[] = [];
    for await (const item of iter) {
      results.push(item);
    }
    return results;
  }

  describe("basic extraction", () => {
    test("extracts subsequence with region string", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "3:6",
        })
      );

      expect(results).toHaveLength(1);
      // Region 3:6 in 1-based coords = positions 3,4,5,6 = 'CGAT'
      expect(results[0]?.sequence).toBe("CGAT");
      expect(results[0]?.length).toBe(4);
    });

    test("extracts subsequence with start and end", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          start: 3,
          end: 6,
        })
      );

      expect(results).toHaveLength(1);
      // Start:3, End:6 in 1-based = positions 3,4,5,6 = 'CGAT'
      expect(results[0]?.sequence).toBe("CGAT");
    });

    test("extracts from start to end of sequence", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "7:-1",
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("CGATCG");
    });

    test("extracts from beginning to position", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "1:5",
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("ATCGA");
    });
  });

  describe("upstream and downstream extraction", () => {
    test("extracts with upstream context", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "5:7",
          upstream: 2,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("CGATC"); // 2 upstream + region
    });

    test("extracts with downstream context", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "5:7",
          downstream: 2,
        })
      );

      expect(results).toHaveLength(1);
      // Region 5:7 = "ATC" + 2 downstream = "ATCGA"
      expect(results[0]?.sequence).toBe("ATCGA"); // region + 2 downstream
    });

    test("extracts with both upstream and downstream", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "5:7",
          upstream: 2,
          downstream: 2,
        })
      );

      expect(results).toHaveLength(1);
      // 2 upstream (CG) + region 5:7 (ATC) + 2 downstream (GA) = CGATCGA
      expect(results[0]?.sequence).toBe("CGATCGA"); // 2 up + region + 2 down
    });

    test("handles upstream beyond sequence start", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "2:4",
          upstream: 10,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("ATCG"); // From beginning
    });

    test("handles downstream beyond sequence end", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "10:11",
          downstream: 10,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("TCG"); // To end
    });
  });

  describe("bed file regions", () => {
    test("extracts using bed regions", async () => {
      const sequences = [
        createSequence("chr1", "ATCGATCGATCG"),
        createSequence("chr2", "GGGGCCCCAAAA"),
      ];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          bedRegions: [
            { chromosome: "chr1", chromStart: 2, chromEnd: 5 },
            { chromosome: "chr2", chromStart: 4, chromEnd: 8 },
          ],
        })
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.sequence).toBe("CGA");
      expect(results[1]?.sequence).toBe("CCCC");
    });

    test("filters sequences not in bed regions", async () => {
      const sequences = [
        createSequence("chr1", "ATCGATCGATCG"),
        createSequence("chr2", "GGGGCCCCAAAA"),
        createSequence("chr3", "TTTTAAAACCCC"),
      ];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          bedRegions: [{ chromosome: "chr1", chromStart: 2, chromEnd: 5 }],
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("chr1");
    });

    test("handles multiple regions for same chromosome", async () => {
      const sequences = [createSequence("chr1", "ATCGATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          bedRegions: [
            { chromosome: "chr1", chromStart: 0, chromEnd: 4 },
            { chromosome: "chr1", chromStart: 8, chromEnd: 12 },
          ],
          concatenate: false,
        })
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.sequence).toBe("ATCG");
      expect(results[1]?.sequence).toBe("ATCG");
    });
  });

  describe("pattern-based extraction", () => {
    test("extracts sequences by ID pattern", async () => {
      const sequences = [
        createSequence("gene1", "ATCGATCG"),
        createSequence("control1", "GGGGCCCC"),
        createSequence("gene2", "AAAATTTT"),
        createSequence("control2", "CCCCGGGG"),
      ];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          idPattern: /^gene/,
        })
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("gene1");
      expect(results[1]?.id).toBe("gene2");
    });

    test("extracts sequences by ID list", async () => {
      const sequences = [
        createSequence("seq1", "ATCGATCG"),
        createSequence("seq2", "GGGGCCCC"),
        createSequence("seq3", "AAAATTTT"),
        createSequence("seq4", "CCCCGGGG"),
      ];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          idList: ["seq2", "seq4"],
        })
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("seq2");
      expect(results[1]?.id).toBe("seq4");
    });

    test("combines ID filtering with region extraction", async () => {
      const sequences = [
        createSequence("gene1", "ATCGATCGATCG"),
        createSequence("control1", "GGGGCCCCAAAA"),
        createSequence("gene2", "TTTTCCCCGGGG"),
      ];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          idPattern: /^gene/,
          region: "3:6",
        })
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("gene1");
      expect(results[0]?.sequence).toBe("CGAT"); // Region 3:6 from gene1
      expect(results[1]?.id).toBe("gene2");
      expect(results[1]?.sequence).toBe("TTCC"); // Region 3:6 from gene2
    });
  });

  describe("circular sequence handling", () => {
    test("extracts across circular boundary", async () => {
      const sequences = [createSequence("plasmid", "ATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "7:3",
          circular: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("CGATC"); // Wraps around
    });

    test("handles upstream across circular boundary", async () => {
      const sequences = [createSequence("plasmid", "ATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "2:4",
          upstream: 3,
          circular: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("CGATCG"); // Wraps for upstream
    });

    test("handles downstream across circular boundary", async () => {
      const sequences = [createSequence("plasmid", "ATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "6:8",
          downstream: 3,
          circular: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("TCGATC"); // Wraps for downstream
    });
  });

  describe("strand handling", () => {
    test("extracts from negative strand", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "3:6",
          strand: "-",
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("ATCG"); // Reverse complement of CGAT
    });

    test("handles upstream/downstream on negative strand", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "5:7",
          upstream: 2,
          downstream: 2,
          strand: "-",
        })
      );

      expect(results).toHaveLength(1);
      // Negative strand: extract, then reverse complement
      expect(results[0]?.sequence).toBe("TCGATCG"); // Rev comp of CGATCGA
    });
  });

  describe("concatenation", () => {
    test("concatenates multiple regions", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          bedRegions: [
            { chromosome: "seq1", chromStart: 0, chromEnd: 4 },
            { chromosome: "seq1", chromStart: 8, chromEnd: 12 },
          ],
          concatenate: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("ATCGATCG"); // Concatenated
    });

    test("does not concatenate when false", async () => {
      const sequences = [createSequence("seq1", "ATCGATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          bedRegions: [
            { chromosome: "seq1", chromStart: 0, chromEnd: 4 },
            { chromosome: "seq1", chromStart: 8, chromEnd: 12 },
          ],
          concatenate: false,
        })
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.sequence).toBe("ATCG");
      expect(results[1]?.sequence).toBe("ATCG");
    });
  });

  describe("GTF/GFF features", () => {
    test("extracts based on GTF features", async () => {
      const sequences = [createSequence("chr1", "ATCGATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          gtfFeatures: [
            { seqname: "chr1", start: 3, end: 8, feature: "exon" },
            { seqname: "chr1", start: 10, end: 12, feature: "exon" },
          ],
          featureType: "exon",
          concatenate: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("CGATCGTCG"); // Concatenated exons
    });

    test("filters by feature type", async () => {
      const sequences = [createSequence("chr1", "ATCGATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          gtfFeatures: [
            { seqname: "chr1", start: 3, end: 8, feature: "exon" },
            { seqname: "chr1", start: 10, end: 12, feature: "intron" },
          ],
          featureType: "exon",
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("CGATCG"); // Only exon
    });

    test("handles GTF coordinate conversion (1-based to 0-based)", async () => {
      const sequences = [createSequence("chr1", "ATCGATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          gtfFeatures: [
            { seqname: "chr1", start: 1, end: 4, feature: "exon" }, // GTF 1-based
          ],
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("ATCG"); // First 4 bases
    });
  });

  describe("enhanced strand handling", () => {
    test("reverse complements minus strand features", async () => {
      const sequences = [createSequence("chr1", "ATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "1:4",
          strand: "-",
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("CGAT"); // Reverse complement of ATCG
    });

    test("handles strand with flanking regions", async () => {
      const sequences = [createSequence("chr1", "ATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "3:6",
          upstream: 1,
          downstream: 1,
          strand: "-",
        })
      );

      expect(results).toHaveLength(1);
      // Region 3:6 (CGAT) + upstream 1 (T) + downstream 1 (C) = TCGATC
      // Reverse complement = GATCGA
      expect(results[0]?.sequence).toBe("GATCGA");
    });
  });

  describe("coordinate systems", () => {
    test("handles 0-based coordinates", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "2:5",
          oneBased: false,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("CGA"); // 0-based indices 2,3,4
    });

    test("includes coordinates in sequence ID", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "2:5",
          includeCoordinates: true,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("seq1:2:5"); // Includes region coordinates
      expect(results[0]?.sequence).toBe("TCGA"); // 1-based positions 2,3,4,5
    });

    test("uses custom coordinate separator", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "2:5",
          includeCoordinates: true,
          coordinateSeparator: "-",
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("seq1-2-5");
    });
  });

  describe("multiple region specifications", () => {
    test("extracts multiple regions from same sequence", async () => {
      const sequences = [createSequence("chr1", "ATCGATCGATCGATCG")];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          regions: ["1:4", "8:12"],
        })
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.sequence).toBe("ATCG"); // First 4 bases (1:4)
      expect(results[1]?.sequence).toBe("GATCG"); // Positions 8-12
    });

    test("validates mutually exclusive region specifications", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const extractor = new SubseqExtractor();

      await expect(async () => {
        await collectResults(
          extractor.extract(arrayToAsync(sequences), {
            region: "1:5",
            gtfFeatures: [{ seqname: "seq1", start: 1, end: 5, feature: "exon" }],
          })
        );
      }).toThrow("only one region specification method");
    });
  });

  describe("error handling", () => {
    test("throws on invalid region format", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const extractor = new SubseqExtractor();

      await expect(async () => {
        await collectResults(
          extractor.extract(arrayToAsync(sequences), {
            region: "invalid",
          })
        );
      }).toThrow("Invalid region format");
    });

    test("throws on out of bounds region", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const extractor = new SubseqExtractor();

      await expect(async () => {
        await collectResults(
          extractor.extract(arrayToAsync(sequences), {
            region: "10:20",
          })
        );
      }).toThrow("Invalid coordinates");
    });

    test("throws on invalid start/end positions", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const extractor = new SubseqExtractor();

      await expect(async () => {
        await collectResults(
          extractor.extract(arrayToAsync(sequences), {
            start: 5,
            end: 3,
          })
        );
      }).toThrow("start < end");
    });

    test("handles empty input gracefully", async () => {
      const sequences: AbstractSequence[] = [];
      const extractor = new SubseqExtractor();
      const results = await collectResults(
        extractor.extract(arrayToAsync(sequences), {
          region: "1:5",
        })
      );

      expect(results).toHaveLength(0);
    });
  });

  describe("option validation", () => {
    test("requires at least one extraction method", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const extractor = new SubseqExtractor();

      await expect(async () => {
        await collectResults(extractor.extract(arrayToAsync(sequences), {}));
      }).toThrow("at least one region specification method");
    });

    test("validates mutually exclusive options", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const extractor = new SubseqExtractor();

      await expect(async () => {
        await collectResults(
          extractor.extract(arrayToAsync(sequences), {
            region: "1:5",
            bedRegions: [{ chromosome: "seq1", chromStart: 1, chromEnd: 5 }],
          })
        );
      }).toThrow("only one region specification method");
    });

    test("validates upstream/downstream requirements", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const extractor = new SubseqExtractor();

      await expect(async () => {
        await collectResults(
          extractor.extract(arrayToAsync(sequences), {
            region: "1:5",
            upstream: -1,
          })
        );
      }).toThrow("upstream must be non-negative");
    });

    test("validates onlyFlank option requirements", async () => {
      const sequences = [createSequence("seq1", "ATCGATCG")];
      const extractor = new SubseqExtractor();

      await expect(async () => {
        await collectResults(
          extractor.extract(arrayToAsync(sequences), {
            region: "1:5",
            onlyFlank: true,
          })
        );
      }).toThrow("upstream or downstream required with onlyFlank");
    });
  });

  describe("integration with utility functions", () => {
    test("extractSingleRegion convenience function", async () => {
      const { extractSingleRegion } = await import("../../src/operations/subseq");
      const sequence = createSequence("seq1", "ATCGATCGATCG");

      const result = await extractSingleRegion(sequence, "3:6", {
        includeCoordinates: true,
      });

      expect(result).not.toBeNull();
      expect(result?.sequence).toBe("CGAT");
      expect(result?.id).toBe("seq1:3:6");
    });

    test("extractSubsequences generator function", async () => {
      const { extractSubsequences } = await import("../../src/operations/subseq");
      const sequences = [createSequence("seq1", "ATCGATCGATCG")];

      const results = await collectResults(
        extractSubsequences(arrayToAsync(sequences), {
          region: "5:8",
          upstream: 2,
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.sequence).toBe("CGATCG"); // 2 upstream + region 5:8
    });

    test("createSubseqExtractor factory function", async () => {
      const { createSubseqExtractor } = await import("../../src/operations/subseq");
      const extractor = createSubseqExtractor();

      expect(extractor).toBeDefined();
      expect(typeof extractor.extract).toBe("function");
      expect(typeof extractor.parseRegion).toBe("function");
    });
  });
});
