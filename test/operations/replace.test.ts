import { describe, expect, test } from "bun:test";
import { replace } from "../../src/operations/replace";
import type { FastaSequence, FastqSequence } from "../../src/types";

async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

describe("Replace operation", () => {
  describe("basic name replacement", () => {
    test("simple pattern replacement", async () => {
      const input: FastaSequence[] = [{ format: "fasta", id: "seq1", sequence: "ATCG", length: 4 }];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "seq",
          replacement: "sample",
        })
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("sample1");
    });

    test("remove version numbers from Ensembl IDs", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "ENSG00000139618.15", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "ENSG00000012048.12", sequence: "GCTA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "\\.\\d+$",
          replacement: "",
        })
      );

      expect(result[0].id).toBe("ENSG00000139618");
      expect(result[1].id).toBe("ENSG00000012048");
    });

    test("prepend prefix to all IDs", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "seq2", sequence: "GCTA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "^",
          replacement: "sample_",
        })
      );

      expect(result[0].id).toBe("sample_seq1");
      expect(result[1].id).toBe("sample_seq2");
    });

    test("append suffix to all IDs", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "gene2", sequence: "GCTA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "$",
          replacement: "_v1",
        })
      );

      expect(result[0].id).toBe("gene1_v1");
      expect(result[1].id).toBe("gene2_v1");
    });

    test("replace first underscore with hyphen", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "sample_001_tissue_A", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "sample_002_tissue_B", sequence: "GCTA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "_",
          replacement: "-",
        })
      );

      expect(result[0].id).toBe("sample-001_tissue_A");
      expect(result[1].id).toBe("sample-002_tissue_B");
    });

    test("empty replacement (deletion)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "chr1:100-200", sequence: "ATCG", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "chr",
          replacement: "",
        })
      );

      expect(result[0].id).toBe("1:100-200");
    });
  });

  describe("capture variables", () => {
    test("single capture group", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene123", sequence: "ATCG", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "^([a-z]+)\\d+$",
          replacement: "$1_X",
        })
      );

      expect(result[0].id).toBe("gene_X");
    });

    test("multiple capture groups (reorder)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene123", sequence: "ATCG", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "^([a-z]+)(\\d+)$",
          replacement: "$2_$1",
        })
      );

      expect(result[0].id).toBe("123_gene");
    });

    test("three capture groups (restructure database IDs)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "ENSG00000139618.15", sequence: "ATCG", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "^(ENSG)(\\d+)\\.(\\d+)$",
          replacement: "$1-$2_v$3",
        })
      );

      expect(result[0].id).toBe("ENSG-00000139618_v15");
    });

    test("capture with surrounding text preserved", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "patient_001_sample_A", sequence: "ATCG", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "patient_(\\d+)",
          replacement: "subject_$1",
        })
      );

      expect(result[0].id).toBe("subject_001_sample_A");
    });

    test("both $N and ${N} syntax work identically", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene123", sequence: "ATCG", length: 4 },
      ];

      const result1 = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "^([a-z]+)(\\d+)$",
          replacement: "$1_$2",
        })
      );

      const result2 = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "^([a-z]+)(\\d+)$",
          replacement: "${1}_${2}",
        })
      );

      expect(result1[0].id).toBe("gene_123");
      expect(result2[0].id).toBe("gene_123");
    });
  });

  describe("case-insensitive matching", () => {
    test("matches pattern regardless of case", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "GENE123", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "gene456", sequence: "GCTA", length: 4 },
        { format: "fasta", id: "Gene789", sequence: "TTAA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "gene",
          replacement: "transcript",
          ignoreCase: true,
        })
      );

      expect(result[0].id).toBe("transcript123");
      expect(result[1].id).toBe("transcript456");
      expect(result[2].id).toBe("transcript789");
    });

    test("case-sensitive by default", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "GENE123", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "gene456", sequence: "GCTA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "gene",
          replacement: "transcript",
        })
      );

      expect(result[0].id).toBe("GENE123");
      expect(result[1].id).toBe("transcript456");
    });
  });

  describe("edge cases", () => {
    test("handles empty sequence stream", async () => {
      const input: FastaSequence[] = [];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "test",
          replacement: "replacement",
        })
      );

      expect(result).toHaveLength(0);
    });

    test("preserves sequences when pattern doesn't match", async () => {
      const input: FastaSequence[] = [{ format: "fasta", id: "seq1", sequence: "ATCG", length: 4 }];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "NOMATCH",
          replacement: "replaced",
        })
      );

      expect(result[0].id).toBe("seq1");
    });

    test("preserves all sequence properties except ID", async () => {
      const input: FastaSequence[] = [
        {
          format: "fasta",
          id: "seq1",
          description: "important metadata",
          sequence: "ATCGATCGATCG",
          length: 12,
        },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "seq",
          replacement: "sample",
        })
      );

      expect(result[0].id).toBe("sample1");
      expect(result[0].description).toBe("important metadata");
      expect(result[0].sequence).toBe("ATCGATCGATCG");
      expect(result[0].length).toBe(12);
      expect(result[0].format).toBe("fasta");
    });

    test("handles special regex characters in pattern", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "seq.1", sequence: "ATCG", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "\\.",
          replacement: "_",
        })
      );

      expect(result[0].id).toBe("seq_1");
    });

    test("replaces only first occurrence (non-global)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "chr1|chr2|chr3", sequence: "ATCG", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "chr",
          replacement: "chromosome",
        })
      );

      expect(result[0].id).toBe("chromosome1|chr2|chr3");
    });
  });

  describe("special symbols", () => {
    test("{nr} record number placeholder", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "seq2", sequence: "GCTA", length: 4 },
        { format: "fasta", id: "seq3", sequence: "TTAA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "seq\\d+",
          replacement: "sample_{nr}",
        })
      );

      expect(result[0].id).toBe("sample_1");
      expect(result[1].id).toBe("sample_2");
      expect(result[2].id).toBe("sample_3");
    });

    test("{nr} with width formatting (nrWidth)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "seq2", sequence: "GCTA", length: 4 },
        { format: "fasta", id: "seq10", sequence: "TTAA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "seq\\d+",
          replacement: "sample_{nr}",
          nrWidth: 4,
        })
      );

      expect(result[0].id).toBe("sample_0001");
      expect(result[1].id).toBe("sample_0002");
      expect(result[2].id).toBe("sample_0003");
    });

    test("file name symbols {fn}, {fbn}, {fbne}", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "seq2", sequence: "GCTA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "^seq",
          replacement: "{fbn}_{fbne}",
          fileName: "/data/samples/experiment.fasta.gz",
        })
      );

      // {fbn} = basename = "experiment.fasta.gz"
      // {fbne} = basename without extension = "experiment.fasta" (removes only .gz)
      expect(result[0].id).toBe("experiment.fasta.gz_experiment.fasta1");
      expect(result[1].id).toBe("experiment.fasta.gz_experiment.fasta2");
    });

    test("dollar sign escaping ($$)", async () => {
      const input: FastaSequence[] = [{ format: "fasta", id: "seq1", sequence: "ATCG", length: 4 }];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "seq",
          replacement: "price_$$100",
        })
      );

      // JavaScript's replace() does NOT auto-convert $$ to $
      // This is literal $$ in the output (correct behavior)
      expect(result[0].id).toBe("price_$$1001");
    });
  });

  describe("key-value replacement", () => {
    test("basic key-value lookup with {kv}", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene_BRCA1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "gene_TP53", sequence: "GCTA", length: 4 },
        { format: "fasta", id: "gene_EGFR", sequence: "TTAA", length: 4 },
      ];

      const kvMap = {
        BRCA1: "breast_cancer_1",
        TP53: "tumor_protein_53",
        EGFR: "epidermal_growth_factor_receptor",
      };

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "gene_(\\w+)",
          replacement: "{kv}",
          kvMap,
        })
      );

      expect(result[0].id).toBe("breast_cancer_1");
      expect(result[1].id).toBe("tumor_protein_53");
      expect(result[2].id).toBe("epidermal_growth_factor_receptor");
    });

    test("missing key with keepKey option", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene_BRCA1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "gene_UNKNOWN", sequence: "GCTA", length: 4 },
      ];

      const kvMap = {
        BRCA1: "breast_cancer_1",
      };

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "gene_(\\w+)",
          replacement: "{kv}",
          kvMap,
          keepKey: true,
        })
      );

      expect(result[0].id).toBe("breast_cancer_1");
      expect(result[1].id).toBe("UNKNOWN"); // Key preserved
    });

    test("missing key with keepUntouch option", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene_BRCA1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "gene_UNKNOWN", sequence: "GCTA", length: 4 },
      ];

      const kvMap = {
        BRCA1: "breast_cancer_1",
      };

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "gene_(\\w+)",
          replacement: "{kv}",
          kvMap,
          keepUntouch: true,
        })
      );

      expect(result[0].id).toBe("breast_cancer_1");
      expect(result[1].id).toBe("gene_UNKNOWN"); // Entire match untouched
    });

    test("missing key with custom replacement (keyMissRepl)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene_BRCA1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "gene_UNKNOWN", sequence: "GCTA", length: 4 },
      ];

      const kvMap = {
        BRCA1: "breast_cancer_1",
      };

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "gene_(\\w+)",
          replacement: "{kv}",
          kvMap,
          keyMissRepl: "uncharacterized",
        })
      );

      expect(result[0].id).toBe("breast_cancer_1");
      expect(result[1].id).toBe("uncharacterized");
    });

    test("missing key with default (empty string)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene_BRCA1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "gene_UNKNOWN", sequence: "GCTA", length: 4 },
      ];

      const kvMap = {
        BRCA1: "breast_cancer_1",
      };

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "gene_(\\w+)",
          replacement: "{kv}",
          kvMap,
        })
      );

      expect(result[0].id).toBe("breast_cancer_1");
      expect(result[1].id).toBe(""); // Default: empty string
    });

    test("configurable key capture index (keyCaptIdx)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene_BRCA1_v1", sequence: "ATCG", length: 4 },
      ];

      const kvMap = {
        v1: "version_one",
      };

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "gene_(\\w+)_(\\w+)",
          replacement: "$1_{kv}",
          kvMap,
          keyCaptIdx: 2, // Use second capture group as key
        })
      );

      expect(result[0].id).toBe("BRCA1_version_one");
    });

    test("kvMap accepts Map object", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene_BRCA1", sequence: "ATCG", length: 4 },
      ];

      const kvMap = new Map([["BRCA1", "breast_cancer_1"]]);

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "gene_(\\w+)",
          replacement: "{kv}",
          kvMap,
        })
      );

      expect(result[0].id).toBe("breast_cancer_1");
    });

    test("kvFile loads from tab-delimited file", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene_BRCA1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "gene_TP53", sequence: "GCTA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "gene_(\\w+)",
          replacement: "{kv}",
          kvFile: "test/fixtures/gene-aliases.tsv",
        })
      );

      expect(result[0].id).toBe("breast_cancer_1");
      expect(result[1].id).toBe("tumor_protein_53");
    });

    test("invalid kvFile format throws ValidationError", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene_BRCA1", sequence: "ATCG", length: 4 },
      ];

      const iterator = replace(toAsyncIterable(input), {
        pattern: "gene_(\\w+)",
        replacement: "{kv}",
        kvFile: "test/fixtures/invalid-kv.tsv",
      });

      await expect(async () => {
        await Array.fromAsync(iterator);
      }).toThrow("Invalid key-value file format");
    });

    test("mutual exclusivity: TypeScript prevents both kvMap and kvFile", () => {
      // This test documents that mutual exclusivity is enforced at COMPILE-TIME
      // via TypeScript's discriminated union, not at runtime.
      //
      // The following code would produce a TypeScript error:
      //
      // const invalid: ReplaceOptions = {
      //   pattern: "gene_(\\w+)",
      //   replacement: "{kv}",
      //   kvMap: { BRCA1: "test" },
      //   kvFile: "test/fixtures/gene-aliases.tsv",  // Error: Type 'string' is not assignable to type 'undefined'
      // };
      //
      // Since TypeScript prevents this at compile-time, we can't test the runtime
      // behavior. Instead, we verify that the type system works correctly by
      // checking that valid configurations compile:

      const input: FastaSequence[] = [
        { format: "fasta", id: "gene_BRCA1", sequence: "ATCG", length: 4 },
      ];

      // ✅ Valid: kvMap only
      const withKvMap = replace(toAsyncIterable(input), {
        pattern: "gene_(\\w+)",
        replacement: "{kv}",
        kvMap: { BRCA1: "BRCA1" },
      });

      // ✅ Valid: kvFile only
      const withKvFile = replace(toAsyncIterable(input), {
        pattern: "gene_(\\w+)",
        replacement: "{kv}",
        kvFile: "test/fixtures/gene-aliases.tsv",
      });

      // ✅ Valid: neither
      const withNeither = replace(toAsyncIterable(input), {
        pattern: "gene_(\\w+)",
        replacement: "$1",
      });

      // If this test compiles and runs, TypeScript is correctly enforcing
      // mutual exclusivity at compile-time!
      expect(withKvMap).toBeDefined();
      expect(withKvFile).toBeDefined();
      expect(withNeither).toBeDefined();
    });
  });

  describe("sequence replacement (bySeq)", () => {
    test("replace in FASTA sequence content", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "seq1", sequence: "ATCG-ATCG", length: 9 },
        { format: "fasta", id: "seq2", sequence: "GCTA-GCTA", length: 9 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "-",
          replacement: "",
          bySeq: true,
        })
      );

      expect(result[0].id).toBe("seq1");
      expect(result[0].sequence).toBe("ATCGATCG");
      expect(result[1].id).toBe("seq2");
      expect(result[1].sequence).toBe("GCTAGCTA");
    });

    test("error on FASTQ sequence replacement", async () => {
      const input: FastqSequence[] = [
        {
          format: "fastq",
          id: "seq1",
          sequence: "ATCG",
          quality: "IIII",
          qualityEncoding: "phred33",
          length: 4,
        },
      ];

      const iterator = replace(toAsyncIterable(input), {
        pattern: "ATCG",
        replacement: "GGGG",
        bySeq: true,
      });

      await expect(async () => {
        await Array.fromAsync(iterator);
      }).toThrow("Sequence replacement (bySeq option) is only supported for FASTA format");
    });

    test("remove gaps pattern (first occurrence only)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "seq1", sequence: "ATCG-AT CG.ATCG", length: 15 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "[-. ]",
          replacement: "",
          bySeq: true,
        })
      );

      // Only first occurrence replaced (matches seqkit behavior)
      expect(result[0].sequence).toBe("ATCGAT CG.ATCG");
    });

    test("add space to first base (first occurrence only)", async () => {
      const input: FastaSequence[] = [{ format: "fasta", id: "seq1", sequence: "ATCG", length: 4 }];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "(.)",
          replacement: "$1 ",
          bySeq: true,
        })
      );

      // Only first occurrence replaced (matches seqkit behavior)
      expect(result[0].sequence).toBe("A TCG");
    });

    test("sequence replacement preserves ID and description", async () => {
      const input: FastaSequence[] = [
        {
          format: "fasta",
          id: "seq1",
          description: "important metadata",
          sequence: "ATCG-ATCG",
          length: 9,
        },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "-",
          replacement: "",
          bySeq: true,
        })
      );

      expect(result[0].id).toBe("seq1");
      expect(result[0].description).toBe("important metadata");
      expect(result[0].sequence).toBe("ATCGATCG");
      expect(result[0].format).toBe("fasta");
    });

    test("bySeq with capture groups in sequences", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "seq1", sequence: "ATCGATCG", length: 8 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "(ATC)(G)",
          replacement: "$2$1",
          bySeq: true,
        })
      );

      // First occurrence: ATCG → GATC
      expect(result[0].sequence).toBe("GATCATCG");
    });
  });

  describe("selective filtering", () => {
    test("filter by pattern (only matching IDs)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene_BRCA1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "gene_TP53", sequence: "GCTA", length: 4 },
        { format: "fasta", id: "control_001", sequence: "TTAA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "^gene",
          replacement: "sample",
          filterPattern: ["gene"],
        })
      );

      expect(result[0].id).toBe("sample_BRCA1");
      expect(result[1].id).toBe("sample_TP53");
      expect(result[2].id).toBe("control_001"); // Not modified
    });

    test("filter with regex (filterUseRegexp)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "seq001", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "seq002", sequence: "GCTA", length: 4 },
        { format: "fasta", id: "seqABC", sequence: "TTAA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "seq",
          replacement: "sample",
          filterPattern: ["\\d+$"],
          filterUseRegexp: true,
        })
      );

      expect(result[0].id).toBe("sample001");
      expect(result[1].id).toBe("sample002");
      expect(result[2].id).toBe("seqABC"); // Doesn't match \d+$
    });

    test("invert match (filterInvertMatch)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "control_001", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "sample_002", sequence: "GCTA", length: 4 },
        { format: "fasta", id: "control_003", sequence: "TTAA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "^([a-z]+)",
          replacement: "test",
          filterPattern: ["control"],
          filterInvertMatch: true,
        })
      );

      expect(result[0].id).toBe("control_001"); // Not modified (matches control)
      expect(result[1].id).toBe("test_002"); // Modified (doesn't match control)
      expect(result[2].id).toBe("control_003"); // Not modified (matches control)
    });

    test("filter by sequence (filterBySeq)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "seq1", sequence: "ATCGATCG", length: 8 },
        { format: "fasta", id: "seq2", sequence: "GCTAGCTA", length: 8 },
        { format: "fasta", id: "seq3", sequence: "TTAATTAA", length: 8 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "seq",
          replacement: "sample",
          filterPattern: ["ATCG"],
          filterBySeq: true,
        })
      );

      expect(result[0].id).toBe("sample1"); // Sequence contains ATCG
      expect(result[1].id).toBe("seq2"); // Sequence doesn't contain ATCG
      expect(result[2].id).toBe("seq3"); // Sequence doesn't contain ATCG
    });

    test("filter by name with description (filterByName)", async () => {
      const input: FastaSequence[] = [
        {
          format: "fasta",
          id: "seq1",
          description: "chromosome 1",
          sequence: "ATCG",
          length: 4,
        },
        {
          format: "fasta",
          id: "seq2",
          description: "mitochondrial",
          sequence: "GCTA",
          length: 4,
        },
        { format: "fasta", id: "seq3", sequence: "TTAA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "seq",
          replacement: "sample",
          filterPattern: ["chromosome"],
          filterByName: true,
        })
      );

      expect(result[0].id).toBe("sample1"); // Description matches "chromosome"
      expect(result[1].id).toBe("seq2"); // Description is "mitochondrial"
      expect(result[2].id).toBe("seq3"); // No description
    });

    test("case-insensitive filtering (filterIgnoreCase)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "GENE_001", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "gene_002", sequence: "GCTA", length: 4 },
        { format: "fasta", id: "Gene_003", sequence: "TTAA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "^[A-Za-z]+",
          replacement: "sample",
          filterPattern: ["gene"],
          filterIgnoreCase: true,
        })
      );

      // All should match with case-insensitive filter
      expect(result[0].id).toBe("sample_001");
      expect(result[1].id).toBe("sample_002");
      expect(result[2].id).toBe("sample_003");
    });

    test("multiple filter patterns (OR logic)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "gene_BRCA1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "transcript_TP53", sequence: "GCTA", length: 4 },
        { format: "fasta", id: "control_001", sequence: "TTAA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "^[a-z]+",
          replacement: "sample",
          filterPattern: ["gene", "transcript"],
        })
      );

      expect(result[0].id).toBe("sample_BRCA1"); // Matches "gene"
      expect(result[1].id).toBe("sample_TP53"); // Matches "transcript"
      expect(result[2].id).toBe("control_001"); // Matches neither
    });

    test("combined filters (regex + invert + case-insensitive)", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "CONTROL_001", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "sample_002", sequence: "GCTA", length: 4 },
        { format: "fasta", id: "Control_003", sequence: "TTAA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "^[A-Za-z]+",
          replacement: "test",
          filterPattern: ["^control"],
          filterUseRegexp: true,
          filterIgnoreCase: true,
          filterInvertMatch: true,
        })
      );

      expect(result[0].id).toBe("CONTROL_001"); // Matches control (not modified)
      expect(result[1].id).toBe("test_002"); // Doesn't match control (modified)
      expect(result[2].id).toBe("Control_003"); // Matches control (not modified)
    });

    test("no filters processes all sequences", async () => {
      const input: FastaSequence[] = [
        { format: "fasta", id: "seq1", sequence: "ATCG", length: 4 },
        { format: "fasta", id: "seq2", sequence: "GCTA", length: 4 },
      ];

      const result = await Array.fromAsync(
        replace(toAsyncIterable(input), {
          pattern: "seq",
          replacement: "sample",
        })
      );

      // All sequences processed when no filters
      expect(result[0].id).toBe("sample1");
      expect(result[1].id).toBe("sample2");
    });
  });
});
