import { describe, expect, test } from "bun:test";
import { ValidationError } from "../../src/errors";
import { WindowsProcessor } from "../../src/operations/windows";
import type { KmerSequence } from "../../src/types";

describe("WindowsProcessor", () => {
  // Helper function to convert array to AsyncIterable
  async function* makeAsync<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item;
    }
  }

  test("generates correct number of windows with step=1", async () => {
    const processor = new WindowsProcessor<4>();
    const seq = { id: "seq1", sequence: "ATCGATCG", length: 8, lineNumber: 1 };
    const windows: KmerSequence<4>[] = [];

    for await (const window of processor.process(makeAsync([seq]), { size: 4 })) {
      windows.push(window);
    }

    expect(windows.length).toBe(5); // Length 8, size 4, step 1 → 5 windows
  });

  test("sets correct metadata fields on k-mer sequences", async () => {
    const processor = new WindowsProcessor<3>();
    const seq = { id: "test", sequence: "ATCG", length: 4, lineNumber: 1 };
    const windows: KmerSequence<3>[] = [];

    for await (const window of processor.process(makeAsync([seq]), { size: 3, step: 1 })) {
      windows.push(window);
    }

    expect(windows[0].kmerSize).toBe(3);
    expect(windows[0].stepSize).toBe(1);
    expect(windows[0].windowIndex).toBe(0);
    expect(windows[1].windowIndex).toBe(1);
  });

  test("extracts correct sequence substrings", async () => {
    const processor = new WindowsProcessor<4>();
    const seq = { id: "test", sequence: "ATCGATCG", length: 8, lineNumber: 1 };
    const windows: KmerSequence<4>[] = [];

    for await (const window of processor.process(makeAsync([seq]), { size: 4 })) {
      windows.push(window);
    }

    expect(windows[0].sequence).toBe("ATCG");
    expect(windows[1].sequence).toBe("TCGA");
    expect(windows[2].sequence).toBe("CGAT");
    expect(windows[3].sequence).toBe("GATC");
    expect(windows[4].sequence).toBe("ATCG");
  });

  test("handles different step sizes correctly", async () => {
    const processor = new WindowsProcessor<3>();
    const seq = { id: "test", sequence: "ATCGATCGATCG", length: 12, lineNumber: 1 };

    // Step = 1 (overlapping)
    const step1: string[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 3, step: 1 })) {
      step1.push(w.sequence);
    }
    expect(step1.length).toBe(10);

    // Step = 3 (tiling)
    const step3: string[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 3, step: 3 })) {
      step3.push(w.sequence);
    }
    expect(step3.length).toBe(4);
    expect(step3).toEqual(["ATC", "GAT", "CGA", "TCG"]);

    // Step = 4 (gaps)
    const step4: string[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 3, step: 4 })) {
      step4.push(w.sequence);
    }
    expect(step4.length).toBe(3);
    expect(step4[1]).toBe("ATC"); // Skips bases
  });

  test("preserves K type parameter at compile time", async () => {
    const processor = new WindowsProcessor<21>();
    const seq = { id: "test", sequence: "A".repeat(50), length: 50, lineNumber: 1 };

    for await (const window of processor.process(makeAsync([seq]), { size: 21 })) {
      // Type assertion - will fail compilation if K not preserved
      const size: 21 = window.kmerSize;
      expect(size).toBe(21);
      break; // Just need one window for type check
    }
  });

  test("greedy mode includes short final window", async () => {
    const processor = new WindowsProcessor<5>();
    const seq = { id: "test", sequence: "ATCGATCG", length: 8, lineNumber: 1 };

    const windows: KmerSequence<5>[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 5, greedy: true })) {
      windows.push(w);
    }

    // Size 5, length 8, step 1 → positions 0-3 fit fully, 4-7 are greedy short windows
    expect(windows.length).toBe(8);

    // First 4 windows should be full size
    expect(windows[0].sequence.length).toBe(5);
    expect(windows[3].sequence.length).toBe(5);

    // Remaining windows are progressively shorter (greedy mode)
    expect(windows[4].sequence.length).toBe(4);
    expect(windows[7].sequence.length).toBe(1);
    expect(windows[7].sequence).toBe("G");
  });

  test("non-greedy mode (default) skips short final window", async () => {
    const processor = new WindowsProcessor<5>();
    const seq = { id: "test", sequence: "ATCGATCG", length: 8, lineNumber: 1 };

    const windows: KmerSequence<5>[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 5, greedy: false })) {
      windows.push(w);
    }

    // Only windows that fit completely
    expect(windows.length).toBe(4);
    // All windows should be full size
    for (const w of windows) {
      expect(w.sequence.length).toBe(5);
    }
  });

  test("greedy mode works with various step sizes", async () => {
    const processor = new WindowsProcessor<4>();
    const seq = { id: "test", sequence: "ATCGATCG", length: 8, lineNumber: 1 };

    // Step = 3, greedy = true
    const windows: KmerSequence<4>[] = [];
    for await (const w of processor.process(makeAsync([seq]), {
      size: 4,
      step: 3,
      greedy: true,
    })) {
      windows.push(w);
    }

    // Positions: 0 (full), 3 (full), 6 (greedy, length 2)
    expect(windows.length).toBe(3);
    expect(windows[0].sequence).toBe("ATCG");
    expect(windows[1].sequence).toBe("GATC");
    expect(windows[2].sequence).toBe("CG"); // Short greedy window
  });

  test("circular mode wraps around sequence end", async () => {
    const processor = new WindowsProcessor<5>();
    const seq = { id: "test", sequence: "ATCG", length: 4, lineNumber: 1 };

    const windows: KmerSequence<5>[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 5, circular: true })) {
      windows.push(w);
    }

    // Size 5, length 4 → all windows wrap
    expect(windows.length).toBe(4);
    expect(windows[0].isWrapped).toBe(true);
    expect(windows[1].isWrapped).toBe(true);
  });

  test("circular mode reconstructs sequences correctly", async () => {
    const processor = new WindowsProcessor<6>();
    const seq = { id: "test", sequence: "ATCG", length: 4, lineNumber: 1 };

    const windows: KmerSequence<6>[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 6, circular: true })) {
      windows.push(w);
    }

    // Position 0: "ATCG" (end) + "AT" (beginning) = "ATCGAT"
    expect(windows[0].sequence).toBe("ATCGAT");
    // Position 1: "TCG" (end) + "ATC" (beginning) = "TCGATC"
    expect(windows[1].sequence).toBe("TCGATC");
  });

  test("non-circular mode (default) does not wrap", async () => {
    const processor = new WindowsProcessor<5>();
    const seq = { id: "test", sequence: "ATCG", length: 4, lineNumber: 1 };

    const windows: KmerSequence<5>[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 5, circular: false })) {
      windows.push(w);
    }

    // Size 5, length 4 → no windows fit, none wrap
    expect(windows.length).toBe(0);
  });

  test("mode priority: normal > circular > greedy", async () => {
    const processor = new WindowsProcessor<3>();
    const seq = { id: "test", sequence: "ATCGATCG", length: 8, lineNumber: 1 };

    // All modes enabled, step=3 so all windows fit exactly
    const windows: KmerSequence<3>[] = [];
    for await (const w of processor.process(makeAsync([seq]), {
      size: 3,
      step: 3,
      circular: true,
      greedy: true,
    })) {
      windows.push(w);
    }

    // Positions: 0, 3, 6 (step=3)
    // 0: end=3 (normal), 3: end=6 (normal), 6: end=9 > 8 (would be circular but let's check)
    // First two should be normal, last one might be circular
    expect(windows.length).toBe(3);
    expect(windows[0].isWrapped).toBe(false);
    expect(windows[1].isWrapped).toBe(false);
    // Position 6 would wrap (end=9 > length=8), so circular takes priority over greedy
    expect(windows[2].isWrapped).toBe(true);
  });

  test("uses 1-based coordinates by default", async () => {
    const processor = new WindowsProcessor<3>();
    const seq = { id: "test", sequence: "ATCG", length: 4, lineNumber: 1 };

    const windows: KmerSequence<3>[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 3 })) {
      windows.push(w);
    }

    expect(windows[0].coordinateSystem).toBe("1-based");
    expect(windows[0].startPosition).toBe(1); // Not 0
    expect(windows[0].endPosition).toBe(3);

    expect(windows[1].startPosition).toBe(2);
    expect(windows[1].endPosition).toBe(4);
  });

  test("uses 0-based coordinates when zeroBased=true", async () => {
    const processor = new WindowsProcessor<3>();
    const seq = { id: "test", sequence: "ATCG", length: 4, lineNumber: 1 };

    const windows: KmerSequence<3>[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 3, zeroBased: true })) {
      windows.push(w);
    }

    expect(windows[0].coordinateSystem).toBe("0-based");
    expect(windows[0].startPosition).toBe(0);
    expect(windows[0].endPosition).toBe(3);

    expect(windows[1].startPosition).toBe(1);
    expect(windows[1].endPosition).toBe(4);
  });

  test("position values match actual sequence slices", async () => {
    const processor = new WindowsProcessor<4>();
    const seq = { id: "test", sequence: "ATCGATCG", length: 8, lineNumber: 1 };

    const windows: KmerSequence<4>[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 4, zeroBased: true })) {
      windows.push(w);
    }

    for (const window of windows) {
      const extracted = seq.sequence.slice(window.startPosition, window.endPosition);
      expect(window.sequence).toBe(extracted);
    }
  });

  test("coordinateSystem field matches zeroBased option", async () => {
    const processor = new WindowsProcessor<3>();
    const seq = { id: "test", sequence: "ATCG", length: 4, lineNumber: 1 };

    // Test 1-based
    const oneBased: KmerSequence<3>[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 3, zeroBased: false })) {
      oneBased.push(w);
    }
    expect(oneBased.every((w) => w.coordinateSystem === "1-based")).toBe(true);

    // Test 0-based
    const zeroBased: KmerSequence<3>[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 3, zeroBased: true })) {
      zeroBased.push(w);
    }
    expect(zeroBased.every((w) => w.coordinateSystem === "0-based")).toBe(true);
  });

  test("uses custom suffix in window IDs", async () => {
    const processor = new WindowsProcessor<3>();
    const seq = { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1 };

    const windows: KmerSequence<3>[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 3, suffix: "_kmer" })) {
      windows.push(w);
    }

    expect(windows[0].id).toMatch(/seq1_kmer:\d+-\d+/);
    expect(windows[0].suffix).toBe("_kmer");
  });

  test("preserves originalId from source sequence", async () => {
    const processor = new WindowsProcessor<3>();
    const seq = { id: "original_seq_123", sequence: "ATCGATCG", length: 8, lineNumber: 1 };

    const windows: KmerSequence<3>[] = [];
    for await (const w of processor.process(makeAsync([seq]), { size: 3 })) {
      windows.push(w);
    }

    expect(windows.every((w) => w.originalId === "original_seq_123")).toBe(true);
  });

  describe("Edge cases", () => {
    test("handles empty sequence array", async () => {
      const processor = new WindowsProcessor<3>();
      const windows: KmerSequence<3>[] = [];

      for await (const w of processor.process(makeAsync([]), { size: 3 })) {
        windows.push(w);
      }

      expect(windows.length).toBe(0);
    });

    test("handles single sequence", async () => {
      const processor = new WindowsProcessor<3>();
      const seq = { id: "seq1", sequence: "ATCGATCG", length: 8, lineNumber: 1 };
      const windows: KmerSequence<3>[] = [];

      for await (const w of processor.process(makeAsync([seq]), { size: 3 })) {
        windows.push(w);
      }

      expect(windows.length).toBe(6);
    });

    test("handles sequence shorter than window size", async () => {
      const processor = new WindowsProcessor<5>();
      const seq = { id: "seq1", sequence: "ATC", length: 3, lineNumber: 1 };
      const windows: KmerSequence<5>[] = [];

      for await (const w of processor.process(makeAsync([seq]), { size: 5 })) {
        windows.push(w);
      }

      expect(windows.length).toBe(0);
    });

    test("handles sequence exactly equal to window size", async () => {
      const processor = new WindowsProcessor<4>();
      const seq = { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1 };
      const windows: KmerSequence<4>[] = [];

      for await (const w of processor.process(makeAsync([seq]), { size: 4 })) {
        windows.push(w);
      }

      expect(windows.length).toBe(1);
      expect(windows[0].sequence).toBe("ATCG");
    });

    test("handles very large step size", async () => {
      const processor = new WindowsProcessor<3>();
      const seq = { id: "seq1", sequence: "ATCGATCG", length: 8, lineNumber: 1 };
      const windows: KmerSequence<3>[] = [];

      for await (const w of processor.process(makeAsync([seq]), { size: 3, step: 100 })) {
        windows.push(w);
      }

      expect(windows.length).toBe(1);
      expect(windows[0].sequence).toBe("ATC");
    });

    test("ArkType validation rejects size=0", async () => {
      const processor = new WindowsProcessor();
      const seq = { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1 };

      const promise = (async () => {
        for await (const _ of processor.process(makeAsync([seq]), { size: 0 })) {
          // Should throw before yielding
        }
      })();

      await expect(promise).rejects.toThrow(ValidationError);
    });

    test("ArkType validation rejects size >= 1000000", async () => {
      const processor = new WindowsProcessor();
      const seq = { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1 };

      const promise = (async () => {
        for await (const _ of processor.process(makeAsync([seq]), { size: 1000000 })) {
          // Should throw
        }
      })();

      await expect(promise).rejects.toThrow(ValidationError);
    });

    test("ArkType validation rejects circular + step > size", async () => {
      const processor = new WindowsProcessor();
      const seq = { id: "seq1", sequence: "ATCGATCG", length: 8, lineNumber: 1 };

      const promise = (async () => {
        for await (const _ of processor.process(makeAsync([seq]), {
          size: 3,
          step: 5,
          circular: true,
        })) {
          // Should throw
        }
      })();

      await expect(promise).rejects.toThrow(ValidationError);
    });

    test("ArkType validation rejects suffix length >= 100", async () => {
      const processor = new WindowsProcessor();
      const seq = { id: "seq1", sequence: "ATCG", length: 4, lineNumber: 1 };

      const promise = (async () => {
        for await (const _ of processor.process(makeAsync([seq]), {
          size: 3,
          suffix: "x".repeat(100),
        })) {
          // Should throw
        }
      })();

      await expect(promise).rejects.toThrow(ValidationError);
    });
  });
});
