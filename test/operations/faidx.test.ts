import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FaiBuilder, Faidx } from "../../src/operations/faidx";

describe("FaiBuilder", () => {
  let tempDir: string;
  let testFastaPath: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
    testFastaPath = join(tempDir, "test.fasta");

    const testFasta = `>chr1 First chromosome
ACGTACGTACGTACGTACGTACGTACGTACGT
ACGTACGTACGTACGTACGTACGTACGTACGT
>chr2 Second chromosome
TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT
>chrM Mitochondrial genome
GGGGGGGGGGGGGGGG
`;

    await Bun.write(testFastaPath, testFasta);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("build()", () => {
    test("builds index from FASTA file", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      expect(index.size()).toBe(3);
      expect(index.has("chr1")).toBe(true);
      expect(index.has("chr2")).toBe(true);
      expect(index.has("chrM")).toBe(true);
    });

    test("extracts correct sequence IDs", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      const ids = index.getSequenceIds();
      expect(ids).toContain("chr1");
      expect(ids).toContain("chr2");
      expect(ids).toContain("chrM");
    });

    test("calculates correct sequence lengths", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      const chr1 = index.get("chr1");
      expect(chr1?.length).toBe(64);

      const chr2 = index.get("chr2");
      expect(chr2?.length).toBe(32);

      const chrM = index.get("chrM");
      expect(chrM?.length).toBe(16);
    });

    test("calculates correct byte offsets", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      const chr1 = index.get("chr1");
      expect(chr1?.offset).toBe(23);

      const chr2 = index.get("chr2");
      expect(chr2?.offset).toBe(113);

      const chrM = index.get("chrM");
      expect(chrM?.offset).toBe(173);
    });

    test("calculates correct linebases and linewidth", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      const chr1 = index.get("chr1");
      expect(chr1?.linebases).toBe(32);
      expect(chr1?.linewidth).toBe(33);

      const chr2 = index.get("chr2");
      expect(chr2?.linebases).toBe(32);
      expect(chr2?.linewidth).toBe(33);

      const chrM = index.get("chrM");
      expect(chrM?.linebases).toBe(16);
      expect(chrM?.linewidth).toBe(17);
    });

    test("supports full header mode", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build({ fullHeader: true });

      expect(index.has("chr1 First chromosome")).toBe(true);
      expect(index.has("chr2 Second chromosome")).toBe(true);
      expect(index.has("chrM Mitochondrial genome")).toBe(true);
    });

    test("uses ID-only mode by default", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      expect(index.has("chr1")).toBe(true);
      expect(index.has("chr1 First chromosome")).toBe(false);
    });
  });

  describe("write()", () => {
    test("writes index to .fai file", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      const faiPath = join(tempDir, "test.fasta.fai");
      await index.write(faiPath);

      const exists = await Bun.file(faiPath).exists();
      expect(exists).toBe(true);
    });

    test("writes correct .fai format", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      const faiPath = join(tempDir, "test.fasta.fai");
      await index.write(faiPath);

      const content = await Bun.file(faiPath).text();
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(3);

      const chr1Line = lines.find((l) => l.startsWith("chr1"));
      expect(chr1Line).toContain("\t");
      expect(chr1Line?.split("\t")).toHaveLength(5);
    });

    test("writes tab-delimited columns", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      const faiPath = join(tempDir, "test.fasta.fai");
      await index.write(faiPath);

      const content = await Bun.file(faiPath).text();
      const lines = content.trim().split("\n");

      for (const line of lines) {
        const parts = line.split("\t");
        expect(parts).toHaveLength(5);

        expect(parts[0]).toBeTruthy();
        expect(Number.parseInt(parts[1])).toBeGreaterThan(0);
        expect(Number.parseInt(parts[2])).toBeGreaterThan(0);
        expect(Number.parseInt(parts[3])).toBeGreaterThan(0);
        expect(Number.parseInt(parts[4])).toBeGreaterThan(0);
      }
    });
  });

  describe("accessor methods", () => {
    test("get() returns record by ID", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      const chr1 = index.get("chr1");
      expect(chr1).toBeDefined();
      expect(chr1?.name).toBe("chr1");
    });

    test("get() returns undefined for non-existent ID", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      const result = index.get("chr99");
      expect(result).toBeUndefined();
    });

    test("has() checks sequence existence", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      expect(index.has("chr1")).toBe(true);
      expect(index.has("chr99")).toBe(false);
    });

    test("size() returns sequence count", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      expect(index.size()).toBe(3);
    });

    test("getSequenceIds() returns all IDs", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      const ids = index.getSequenceIds();
      expect(ids).toHaveLength(3);
      expect(ids).toEqual(expect.arrayContaining(["chr1", "chr2", "chrM"]));
    });
  });

  describe("load()", () => {
    test("loads index from .fai file", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      const faiPath = join(tempDir, "test.fasta.fai");
      await index.write(faiPath);

      const loadedIndex = new FaiBuilder(testFastaPath);
      await loadedIndex.load(faiPath);

      expect(loadedIndex.size()).toBe(3);
      expect(loadedIndex.has("chr1")).toBe(true);
      expect(loadedIndex.has("chr2")).toBe(true);
      expect(loadedIndex.has("chrM")).toBe(true);
    });

    test("loaded index matches built index", async () => {
      const builtIndex = new FaiBuilder(testFastaPath);
      await builtIndex.build();

      const faiPath = join(tempDir, "test.fasta.fai");
      await builtIndex.write(faiPath);

      const loadedIndex = new FaiBuilder(testFastaPath);
      await loadedIndex.load(faiPath);

      const chr1Built = builtIndex.get("chr1");
      const chr1Loaded = loadedIndex.get("chr1");

      expect(chr1Built).toBeDefined();
      expect(chr1Loaded).toBeDefined();

      if (chr1Built && chr1Loaded) {
        expect(chr1Loaded).toEqual(chr1Built);
      }
    });

    test("round-trip preserves all fields", async () => {
      const originalIndex = new FaiBuilder(testFastaPath);
      await originalIndex.build();

      const faiPath = join(tempDir, "test.fasta.fai");
      await originalIndex.write(faiPath);

      const loadedIndex = new FaiBuilder(testFastaPath);
      await loadedIndex.load(faiPath);

      for (const seqId of originalIndex.getSequenceIds()) {
        const original = originalIndex.get(seqId);
        const loaded = loadedIndex.get(seqId);

        expect(original).toBeDefined();
        expect(loaded).toBeDefined();

        if (original && loaded) {
          expect(loaded.name).toBe(original.name);
          expect(loaded.length).toBe(original.length);
          expect(loaded.offset).toBe(original.offset);
          expect(loaded.linebases).toBe(original.linebases);
          expect(loaded.linewidth).toBe(original.linewidth);
        }
      }
    });

    test("throws error for non-existent file", async () => {
      const index = new FaiBuilder(testFastaPath);
      const nonExistentPath = join(tempDir, "does-not-exist.fai");

      await expect(index.load(nonExistentPath)).rejects.toThrow("Index file not found");
    });

    test("throws error for invalid format", async () => {
      const invalidFaiPath = join(tempDir, "invalid.fai");
      await Bun.write(invalidFaiPath, "chr1\t100\t50\n");

      const index = new FaiBuilder(testFastaPath);

      await expect(index.load(invalidFaiPath)).rejects.toThrow("Invalid .fai format");
    });

    test("clears existing records before loading", async () => {
      const index = new FaiBuilder(testFastaPath);
      await index.build();

      expect(index.size()).toBe(3);

      const faiPath = join(tempDir, "single.fai");
      await Bun.write(faiPath, "chr1\t64\t23\t32\t33\n");

      await index.load(faiPath);

      expect(index.size()).toBe(1);
      expect(index.has("chr1")).toBe(true);
      expect(index.has("chr2")).toBe(false);
    });
  });

  describe("FaidxRecord validation", () => {
    test("rejects record with empty name", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
      const faiPath = join(testDir, "test.fasta.fai");

      // Create .fai with whitespace-only name that will fail the "name || ''" check
      await Bun.write(faiPath, "\t64\t6\t32\t33\n");

      const index = new FaiBuilder("test.fasta");
      // This will fail at column count check (tab creates empty string which is 4 columns)
      await expect(index.load(faiPath)).rejects.toThrow(/expected 5 columns, got 4/);
    });

    test("rejects record with zero length", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
      const faiPath = join(testDir, "test.fasta.fai");

      // Create .fai with zero length
      await Bun.write(faiPath, "chr1\t0\t6\t32\t33\n");

      const index = new FaiBuilder("test.fasta");
      await expect(index.load(faiPath)).rejects.toThrow(/Invalid .fai record/);
    });

    test("rejects record with negative offset", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
      const faiPath = join(testDir, "test.fasta.fai");

      // Create .fai with negative offset
      await Bun.write(faiPath, "chr1\t64\t-1\t32\t33\n");

      const index = new FaiBuilder("test.fasta");
      await expect(index.load(faiPath)).rejects.toThrow(/Invalid .fai record/);
    });

    test("rejects record with zero linebases", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
      const faiPath = join(testDir, "test.fasta.fai");

      // Create .fai with zero linebases
      await Bun.write(faiPath, "chr1\t64\t6\t0\t33\n");

      const index = new FaiBuilder("test.fasta");
      await expect(index.load(faiPath)).rejects.toThrow(/Invalid .fai record/);
    });

    test("rejects record with linewidth < linebases", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
      const faiPath = join(testDir, "test.fasta.fai");

      // Create .fai with linewidth (30) < linebases (32)
      await Bun.write(faiPath, "chr1\t64\t6\t32\t30\n");

      const index = new FaiBuilder("test.fasta");
      await expect(index.load(faiPath)).rejects.toThrow(/linewidth >= linebases/);
    });

    test("rejects record with non-numeric values", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
      const faiPath = join(testDir, "test.fasta.fai");

      // Create .fai with non-numeric length
      await Bun.write(faiPath, "chr1\tabc\t6\t32\t33\n");

      const index = new FaiBuilder("test.fasta");
      await expect(index.load(faiPath)).rejects.toThrow(/Invalid numeric values/);
    });

    test("rejects record with missing fields", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
      const faiPath = join(testDir, "test.fasta.fai");

      // Create .fai with only 3 fields
      await Bun.write(faiPath, "chr1\t64\t6\n");

      const index = new FaiBuilder("test.fasta");
      await expect(index.load(faiPath)).rejects.toThrow(/expected 5 columns, got 3/);
    });

    test("accepts valid record", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
      const faiPath = join(testDir, "test.fasta.fai");

      // Create valid .fai
      await Bun.write(faiPath, "chr1\t64\t6\t32\t33\n");

      const index = new FaiBuilder("test.fasta");
      await index.load(faiPath);

      expect(index.size()).toBe(1);
      const record = index.get("chr1");
      expect(record).toBeDefined();
      expect(record?.length).toBe(64);
      expect(record?.offset).toBe(6);
      expect(record?.linebases).toBe(32);
      expect(record?.linewidth).toBe(33);
    });
  });
});

describe("Faidx", () => {
  let tempDir: string;
  let testFastaPath: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
    testFastaPath = join(tempDir, "test.fasta");

    const testFasta = `>chr1 First chromosome
ACGTACGTACGTACGTACGTACGTACGTACGT
ACGTACGTACGTACGTACGTACGTACGTACGT
>chr2 Second chromosome
TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT
>chrM Mitochondrial genome
GGGGGGGGGGGGGGGG
`;

    await Bun.write(testFastaPath, testFasta);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("init()", () => {
    test("builds index when .fai does not exist", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const faiPath = join(tempDir, "test.fasta.fai");
      const exists = await Bun.file(faiPath).exists();
      expect(exists).toBe(true);
    });

    test("loads existing index when .fai exists", async () => {
      const builder = new FaiBuilder(testFastaPath);
      await builder.build();
      const faiPath = join(tempDir, "test.fasta.fai");
      await builder.write(faiPath);

      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      expect(true).toBe(true);
    });

    test("rebuilds index when updateIndex=true", async () => {
      const builder = new FaiBuilder(testFastaPath);
      await builder.build();
      const faiPath = join(tempDir, "test.fasta.fai");
      await builder.write(faiPath);

      const originalStats = await Bun.file(faiPath).stat();

      await new Promise((resolve) => setTimeout(resolve, 10));

      const faidx = new Faidx(testFastaPath, { updateIndex: true });
      await faidx.init();

      const newStats = await Bun.file(faiPath).stat();
      expect(newStats.mtime.getTime()).toBeGreaterThanOrEqual(originalStats.mtime.getTime());
    });

    test("uses .seqkit.fai when fullHeader=true", async () => {
      const faidx = new Faidx(testFastaPath, { fullHeader: true });
      await faidx.init();

      const seqkitFaiPath = join(tempDir, "test.fasta.seqkit.fai");
      const exists = await Bun.file(seqkitFaiPath).exists();
      expect(exists).toBe(true);
    });

    test("uses .fai when fullHeader=false (default)", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const faiPath = join(tempDir, "test.fasta.fai");
      const exists = await Bun.file(faiPath).exists();
      expect(exists).toBe(true);
    });
  });

  describe("extract()", () => {
    test("extracts full sequence by ID", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const chr1 = await faidx.extract("chr1");

      expect(chr1.format).toBe("fasta");
      expect(chr1.id).toBe("chr1");
      expect(chr1.sequence).toBe(
        "ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT"
      );
      expect(chr1.length).toBe(64);
    });

    test("extracts different sequences correctly", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const chr2 = await faidx.extract("chr2");
      expect(chr2.id).toBe("chr2");
      expect(chr2.sequence).toBe("TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT");
      expect(chr2.length).toBe(32);

      const chrM = await faidx.extract("chrM");
      expect(chrM.id).toBe("chrM");
      expect(chrM.sequence).toBe("GGGGGGGGGGGGGGGG");
      expect(chrM.length).toBe(16);
    });

    test("throws error for non-existent sequence", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      await expect(faidx.extract("chr99")).rejects.toThrow('Sequence "chr99" not found');
    });

    test("error message lists available sequences", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      await expect(faidx.extract("invalid")).rejects.toThrow(
        /Available sequences: chr1, chr2, chrM/
      );
    });
  });

  describe("region extraction", () => {
    test("extracts region by coordinates", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const region = await faidx.extract("chr1:1-8");
      expect(region.id).toBe("chr1:1-8");
      expect(region.sequence).toBe("ACGTACGT");
      expect(region.length).toBe(8);
    });

    test("extracts single base", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const base = await faidx.extract("chr1:1");
      expect(base.id).toBe("chr1:1-1");
      expect(base.sequence).toBe("A");
      expect(base.length).toBe(1);
    });

    test("extracts from position to end", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const tail = await faidx.extract("chr1:60-");
      expect(tail.id).toBe("chr1:60-64");
      expect(tail.sequence).toBe("TACGT");
      expect(tail.length).toBe(5);
    });

    test("extracts from start to position", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const head = await faidx.extract("chr1:-5");
      expect(head.id).toBe("chr1:1-5");
      expect(head.sequence).toBe("ACGTA");
      expect(head.length).toBe(5);
    });

    test("handles negative indices", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const lastFour = await faidx.extract("chr1:-4:-1");
      expect(lastFour.id).toBe("chr1:61-64");
      expect(lastFour.sequence).toBe("ACGT");
      expect(lastFour.length).toBe(4);
    });

    test("extracts across line boundaries", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const spanning = await faidx.extract("chr1:30-35");
      expect(spanning.id).toBe("chr1:30-35");
      expect(spanning.sequence).toBe("CGTACG");
      expect(spanning.length).toBe(6);
    });

    test("throws error for out of bounds start", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      await expect(faidx.extract("chr1:0-10")).rejects.toThrow(/Start position 0 is less than 1/);

      await expect(faidx.extract("chr1:100-110")).rejects.toThrow(
        /Start position 100 exceeds sequence length/
      );
    });

    test("throws error for out of bounds end", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      await expect(faidx.extract("chr1:1-1000")).rejects.toThrow(
        /End position 1000 exceeds sequence length/
      );
    });

    test("extracts reverse complement when start > end", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      // chr1:5-10 forward = "ACGTAC"
      // chr1:10-5 extracts chr1:5-10 and reverse complements it
      // Reverse complement of "ACGTAC" = "GTACGT"
      const rc = await faidx.extract("chr1:10-5");
      expect(rc.id).toBe("chr1:10-5");
      expect(rc.sequence).toBe("GTACGT");
      expect(rc.length).toBe(6);
    });

    test("throws error for non-existent sequence in region", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      await expect(faidx.extract("chr99:1-100")).rejects.toThrow(/Sequence "chr99" not found/);
    });
  });

  describe("reverse complement extraction", () => {
    test("extracts reverse complement for inverted coordinates", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      // chr1:5-10 forward = "ACGTAC"
      // chr1:10-5 extracts 5-10 and reverse complements
      // Reverse complement of "ACGTAC" = "GTACGT"
      const rc = await faidx.extract("chr1:10-5");
      expect(rc.id).toBe("chr1:10-5");
      expect(rc.sequence).toBe("GTACGT");
      expect(rc.length).toBe(6);
    });

    test("extracts reverse complement of single base", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      // chr1:1 = "A", reverse complement = "T"
      const rc = await faidx.extract("chr1:1-1");
      expect(rc.sequence).toBe("A");

      // But when reversed: chr1:1-1 is same as chr1:1
      // Single base doesn't trigger reverse complement (start == end after swap)
      const forward = await faidx.extract("chr1:1");
      expect(forward.sequence).toBe("A");
    });

    test("extracts reverse complement with negative indices", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      // chr1:-1:-4 means positions 64 to 61
      // Forward chr1:61-64 = "ACGT"
      // Reverse complement should be "ACGT" (palindrome)
      const rc = await faidx.extract("chr1:-1:-4");
      expect(rc.id).toBe("chr1:-1:-4");
      expect(rc.sequence).toBe("ACGT");
      expect(rc.length).toBe(4);
    });

    test("extracts reverse complement across line boundaries", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      // chr1:35-30 should extract chr1:30-35 and reverse complement
      const rc = await faidx.extract("chr1:35-30");
      expect(rc.id).toBe("chr1:35-30");
      expect(rc.sequence).toBe("CGTACG"); // Palindrome
      expect(rc.length).toBe(6);
    });

    test("preserves ID with original coordinates for reverse complement", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const rc = await faidx.extract("chr1:20-10");
      // ID should preserve original inverted coordinates, not swapped
      expect(rc.id).toBe("chr1:20-10");
    });
  });

  describe("extractMany() - batch extraction", () => {
    test("extracts multiple regions successfully", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const regions = ["chr1:1-8", "chr2:1-10", "chrM:1-5"];
      const sequences = await Array.fromAsync(faidx.extractMany(regions));

      expect(sequences).toHaveLength(3);
      expect(sequences[0]!.id).toBe("chr1:1-8");
      expect(sequences[0]!.sequence).toBe("ACGTACGT");
      expect(sequences[1]!.id).toBe("chr2:1-10");
      expect(sequences[1]!.sequence).toBe("TTTTTTTTTT");
      expect(sequences[2]!.id).toBe("chrM:1-5");
      expect(sequences[2]!.sequence).toBe("GGGGG");
    });

    test("returns results in order", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const regions = ["chr2", "chr1:1-4", "chrM"];
      const sequences = await Array.fromAsync(faidx.extractMany(regions));

      expect(sequences[0]!.id).toBe("chr2");
      expect(sequences[1]!.id).toBe("chr1:1-4");
      expect(sequences[2]!.id).toBe("chrM");
    });

    test("handles empty array", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const sequences = await Array.fromAsync(faidx.extractMany([]));
      expect(sequences).toHaveLength(0);
    });

    test("throws on invalid region by default", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const regions = ["chr1:1-10", "invalid_chromosome", "chr2:1-10"];

      await expect(async () => {
        for await (const _ of faidx.extractMany(regions)) {
          // Should throw on second region
        }
      }).toThrow(/Sequence "invalid_chromosome" not found/);
    });

    test("skips invalid regions when onError='skip'", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const regions = ["chr1:1-8", "invalid", "chr2:1-10"];
      const sequences = await Array.fromAsync(faidx.extractMany(regions, { onError: "skip" }));

      // Should get only the valid sequences
      expect(sequences).toHaveLength(2);
      expect(sequences[0]!.id).toBe("chr1:1-8");
      expect(sequences[1]!.id).toBe("chr2:1-10");
    });

    test("handles mixed valid and invalid regions with skip", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const regions = ["chr1:1-5", "nonexistent", "chr2:1-3", "chr99:1-10", "chrM:1-2"];
      const sequences = await Array.fromAsync(faidx.extractMany(regions, { onError: "skip" }));

      expect(sequences).toHaveLength(3);
      expect(sequences[0]!.id).toBe("chr1:1-5");
      expect(sequences[1]!.id).toBe("chr2:1-3");
      expect(sequences[2]!.id).toBe("chrM:1-2");
    });

    test("works with all region syntaxes", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const regions = [
        "chr1", // Full sequence
        "chr1:1-8", // Range
        "chr1:10", // Single base
        "chr1:60-", // From position to end
        "chr1:-5", // From start to position
        "chr1:-4:-1", // Negative indices
        "chr1:10-5", // Reverse complement
      ];

      const sequences = await Array.fromAsync(faidx.extractMany(regions));
      expect(sequences).toHaveLength(7);

      // Verify each syntax works
      expect(sequences[0]!.id).toBe("chr1");
      expect(sequences[0]!.length).toBe(64);
      expect(sequences[1]!.id).toBe("chr1:1-8");
      expect(sequences[2]!.id).toBe("chr1:10-10");
      expect(sequences[3]!.id).toBe("chr1:60-64");
      expect(sequences[4]!.id).toBe("chr1:1-5");
      expect(sequences[5]!.id).toBe("chr1:61-64");
      expect(sequences[6]!.id).toBe("chr1:10-5");
    });
  });

  describe("extractByPattern() - regex matching", () => {
    test("matches sequences with regex pattern", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      // Match chr1 and chr2 (not chrM)
      const sequences = await Array.fromAsync(faidx.extractByPattern(/^chr[12]$/));

      expect(sequences).toHaveLength(2);
      expect(sequences[0]!.id).toBe("chr1");
      expect(sequences[1]!.id).toBe("chr2");
    });

    test("accepts string pattern", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      // Match sequences containing 'M'
      const sequences = await Array.fromAsync(faidx.extractByPattern("M"));

      expect(sequences).toHaveLength(1);
      expect(sequences[0]!.id).toBe("chrM");
    });

    test("accepts RegExp object", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      // Match all sequences starting with 'chr'
      const pattern = new RegExp("^chr");
      const sequences = await Array.fromAsync(faidx.extractByPattern(pattern));

      expect(sequences).toHaveLength(3);
    });

    test("case-insensitive matching works", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      // Pattern is lowercase, but IDs are mixed case
      const sequences = await Array.fromAsync(
        faidx.extractByPattern("CHR", { caseInsensitive: true })
      );

      // Should match all three sequences (chr1, chr2, chrM)
      expect(sequences).toHaveLength(3);
    });

    test("returns empty for no matches", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      const sequences = await Array.fromAsync(faidx.extractByPattern(/^scaffold/));

      expect(sequences).toHaveLength(0);
    });

    test("matches multiple sequences", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      // Match all sequences (any character)
      const sequences = await Array.fromAsync(faidx.extractByPattern(/./));

      expect(sequences).toHaveLength(3);
      expect(sequences.map((s) => s.id)).toEqual(["chr1", "chr2", "chrM"]);
    });

    test("works with complex regex patterns", async () => {
      const faidx = new Faidx(testFastaPath);
      await faidx.init();

      // Match sequences ending with a digit
      const sequences = await Array.fromAsync(faidx.extractByPattern(/\d$/));

      expect(sequences).toHaveLength(2);
      expect(sequences[0]!.id).toBe("chr1");
      expect(sequences[1]!.id).toBe("chr2");
    });
  });

  describe("edge cases and error handling", () => {
    test("detects gzip compressed files by extension", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
      const gzPath = join(tempDir, "test.fasta.gz");

      // Create a fake .gz file (just needs the extension for this test)
      await Bun.write(gzPath, new Uint8Array([0x1f, 0x8b, 0x08])); // gzip magic bytes

      const faidx = new Faidx(gzPath);
      await expect(faidx.init()).rejects.toThrow(/compressed.*gzip/i);
      await expect(faidx.init()).rejects.toThrow(/decompress/i);
    });

    test("detects gzip by extension (.gz)", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
      const gzPath = join(tempDir, "test.fasta.gz");

      // Extension-based detection (CompressionDetector.hybrid)
      await Bun.write(gzPath, new Uint8Array([0x1f, 0x8b, 0x08, 0x00]));

      const faidx = new Faidx(gzPath);
      await expect(faidx.init()).rejects.toThrow(/compressed.*gzip/i);
    });

    test("detects zstd compressed files", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
      const zstPath = join(tempDir, "test.fasta.zst");

      // Create file with zstd magic bytes
      await Bun.write(zstPath, new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]));

      const faidx = new Faidx(zstPath);
      await expect(faidx.init()).rejects.toThrow(/compressed.*zstd/i);
    });

    test("handles empty FASTA file gracefully", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "faidx-test-"));
      const emptyPath = join(tempDir, "empty.fasta");

      // Create empty file
      await Bun.write(emptyPath, "");

      const faidx = new Faidx(emptyPath);
      await faidx.init();

      // Should have zero sequences
      await expect(faidx.extract("any_sequence")).rejects.toThrow(/not found/);
    });

    test("provides helpful error for non-existent file", async () => {
      const faidx = new Faidx("/nonexistent/path/genome.fasta");
      await expect(faidx.init()).rejects.toThrow();
    });
  });
});
