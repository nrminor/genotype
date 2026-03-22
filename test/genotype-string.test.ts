import { describe, expect, test } from "bun:test";
import {
  GenotypeString,
  genotypeStringInternal,
  CharSet,
  Bases,
} from "@genotype/core/genotype-string";

describe("GenotypeString", () => {
  describe("factory methods", () => {
    test("fromString creates a string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.length).toBe(4);
      expect(gs.toString()).toBe("ATCG");
    });

    test("fromString handles empty string", () => {
      const gs = GenotypeString.fromString("");
      expect(gs.length).toBe(0);
      expect(gs.toString()).toBe("");
    });

    test("fromBytes creates a bytes-backed instance", () => {
      const bytes = new TextEncoder().encode("ATCG");
      const gs = GenotypeString.fromBytes(bytes);
      expect(gs.length).toBe(4);
      expect(gs.toString()).toBe("ATCG");
    });

    test("fromBytes makes a defensive copy", () => {
      const bytes = new TextEncoder().encode("ATCG");
      const gs = GenotypeString.fromBytes(bytes);
      bytes[0] = 0x58; // 'X'
      expect(gs.toString()).toBe("ATCG");
    });

    test("fromBytes handles empty array", () => {
      const gs = GenotypeString.fromBytes(new Uint8Array(0));
      expect(gs.length).toBe(0);
      expect(gs.toString()).toBe("");
    });

    test("fromString is idempotent — returns existing GenotypeString as-is", () => {
      const gs = GenotypeString.fromString("ATCG");
      const same = GenotypeString.fromString(gs);
      expect(same).toBe(gs); // same reference, not a copy
    });

    test("fromString idempotent with bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      const same = GenotypeString.fromString(gs);
      expect(same).toBe(gs);
      expect(same.toString()).toBe("ATCG");
    });
  });

  describe("length", () => {
    test("returns correct length for string-backed instance", () => {
      expect(GenotypeString.fromString("ATCGATCG").length).toBe(8);
    });

    test("returns correct length for bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      expect(gs.length).toBe(8);
    });
  });

  describe("includes", () => {
    test("finds substring in string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      expect(gs.includes("CGA")).toBe(true);
      expect(gs.includes("XYZ")).toBe(false);
    });

    test("finds substring in bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      expect(gs.includes("CGA")).toBe(true);
      expect(gs.includes("XYZ")).toBe(false);
    });

    test("empty pattern is always found", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.includes("")).toBe(true);
    });

    test("pattern longer than content is not found", () => {
      const gs = GenotypeString.fromString("AT");
      expect(gs.includes("ATCG")).toBe(false);
    });
  });

  describe("indexOf", () => {
    test("finds index in string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      expect(gs.indexOf("CG")).toBe(2);
      expect(gs.indexOf("CG", 3)).toBe(6);
      expect(gs.indexOf("XY")).toBe(-1);
    });

    test("finds index in bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      expect(gs.indexOf("CG")).toBe(2);
      expect(gs.indexOf("CG", 3)).toBe(6);
      expect(gs.indexOf("XY")).toBe(-1);
    });

    test("empty pattern returns fromIndex", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.indexOf("", 0)).toBe(0);
      expect(gs.indexOf("", 2)).toBe(2);
    });

    test("empty pattern with fromIndex past end clamps to length", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.indexOf("", 100)).toBe(4);
      expect(gs.indexOf("", 4)).toBe(4);
    });

    test("negative fromIndex clamps to zero", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.indexOf("AT", -5)).toBe(0);
      expect(gs.indexOf("", -5)).toBe(0);
    });

    test("indexOf edge cases match String.prototype.indexOf", () => {
      const content = "ATCGATCG";
      const gs = GenotypeString.fromBytes(new TextEncoder().encode(content));
      expect(gs.indexOf("", 100)).toBe(content.indexOf("", 100));
      expect(gs.indexOf("AT", -5)).toBe(content.indexOf("AT", -5));
      expect(gs.indexOf("CG", 100)).toBe(content.indexOf("CG", 100));
    });
  });

  describe("slice", () => {
    test("slices string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      const sliced = gs.slice(2, 6);
      expect(sliced.toString()).toBe("CGAT");
      expect(sliced.length).toBe(4);
    });

    test("slices bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      const sliced = gs.slice(2, 6);
      expect(sliced.toString()).toBe("CGAT");
      expect(sliced.length).toBe(4);
    });

    test("slice without end goes to the end", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      expect(gs.slice(4).toString()).toBe("ATCG");
    });

    test("slice returns independent instance", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      const sliced = gs.slice(0, 4);
      expect(sliced.toString()).toBe("ATCG");
      expect(gs.toString()).toBe("ATCGATCG");
    });

    test("negative start slices from end", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      expect(gs.slice(-4).toString()).toBe("ATCG");
    });
  });

  describe("toUpperCase", () => {
    test("uppercases string-backed instance", () => {
      const gs = GenotypeString.fromString("atcgatcg");
      expect(gs.toUpperCase().toString()).toBe("ATCGATCG");
    });

    test("uppercases bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("atcgatcg"));
      expect(gs.toUpperCase().toString()).toBe("ATCGATCG");
    });

    test("preserves non-alphabetic characters", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("atcg-123"));
      expect(gs.toUpperCase().toString()).toBe("ATCG-123");
    });

    test("already uppercase is unchanged", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.toUpperCase().toString()).toBe("ATCG");
    });
  });

  describe("toLowerCase", () => {
    test("lowercases string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      expect(gs.toLowerCase().toString()).toBe("atcgatcg");
    });

    test("lowercases bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      expect(gs.toLowerCase().toString()).toBe("atcgatcg");
    });

    test("preserves non-alphabetic characters", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG-123"));
      expect(gs.toLowerCase().toString()).toBe("atcg-123");
    });
  });

  describe("charAt", () => {
    test("returns character at index for string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.charAt(0)).toBe("A");
      expect(gs.charAt(3)).toBe("G");
    });

    test("returns character at index for bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.charAt(0)).toBe("A");
      expect(gs.charAt(3)).toBe("G");
    });

    test("returns empty string for out-of-range index", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.charAt(-1)).toBe("");
      expect(gs.charAt(4)).toBe("");
    });
  });

  describe("charCodeAt", () => {
    test("returns char code for string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.charCodeAt(0)).toBe(65); // 'A'
      expect(gs.charCodeAt(1)).toBe(84); // 'T'
    });

    test("returns char code for bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.charCodeAt(0)).toBe(65);
      expect(gs.charCodeAt(1)).toBe(84);
    });

    test("returns NaN for out-of-range index", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.charCodeAt(-1)).toBeNaN();
      expect(gs.charCodeAt(4)).toBeNaN();
    });
  });

  describe("startsWith", () => {
    test("checks prefix in string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      expect(gs.startsWith("ATC")).toBe(true);
      expect(gs.startsWith("TCG")).toBe(false);
    });

    test("checks prefix in bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      expect(gs.startsWith("ATC")).toBe(true);
      expect(gs.startsWith("TCG")).toBe(false);
    });

    test("empty prefix always matches", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.startsWith("")).toBe(true);
    });

    test("prefix longer than content does not match", () => {
      const gs = GenotypeString.fromString("AT");
      expect(gs.startsWith("ATCG")).toBe(false);
    });
  });

  describe("endsWith", () => {
    test("checks suffix in string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      expect(gs.endsWith("TCG")).toBe(true);
      expect(gs.endsWith("ATC")).toBe(false);
    });

    test("checks suffix in bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      expect(gs.endsWith("TCG")).toBe(true);
      expect(gs.endsWith("ATC")).toBe(false);
    });

    test("empty suffix always matches", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.endsWith("")).toBe(true);
    });

    test("suffix longer than content does not match", () => {
      const gs = GenotypeString.fromString("CG");
      expect(gs.endsWith("ATCG")).toBe(false);
    });
  });

  describe("equals", () => {
    test("equal GenotypeString instances (both string-backed)", () => {
      const a = GenotypeString.fromString("ATCG");
      const b = GenotypeString.fromString("ATCG");
      expect(a.equals(b)).toBe(true);
    });

    test("equal GenotypeString instances (both bytes-backed)", () => {
      const enc = new TextEncoder();
      const a = GenotypeString.fromBytes(enc.encode("ATCG"));
      const b = GenotypeString.fromBytes(enc.encode("ATCG"));
      expect(a.equals(b)).toBe(true);
    });

    test("equal GenotypeString instances (cross-representation)", () => {
      const a = GenotypeString.fromString("ATCG");
      const b = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(a.equals(b)).toBe(true);
      expect(b.equals(a)).toBe(true);
    });

    test("unequal GenotypeString instances", () => {
      const a = GenotypeString.fromString("ATCG");
      const b = GenotypeString.fromString("GCTA");
      expect(a.equals(b)).toBe(false);
    });

    test("equals plain string", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.equals("ATCG")).toBe(true);
      expect(gs.equals("GCTA")).toBe(false);
    });

    test("equals plain string from bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.equals("ATCG")).toBe(true);
      expect(gs.equals("GCTA")).toBe(false);
    });

    test("equals Uint8Array", () => {
      const enc = new TextEncoder();
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.equals(enc.encode("ATCG"))).toBe(true);
      expect(gs.equals(enc.encode("GCTA"))).toBe(false);
    });

    test("equals Uint8Array from bytes-backed instance", () => {
      const enc = new TextEncoder();
      const gs = GenotypeString.fromBytes(enc.encode("ATCG"));
      expect(gs.equals(enc.encode("ATCG"))).toBe(true);
      expect(gs.equals(enc.encode("GCTA"))).toBe(false);
    });

    test("same instance returns true", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.equals(gs)).toBe(true);
    });

    test("different lengths are not equal", () => {
      const a = GenotypeString.fromString("ATCG");
      const b = GenotypeString.fromString("ATC");
      expect(a.equals(b)).toBe(false);
    });
  });

  describe("toString", () => {
    test("returns string from string-backed instance", () => {
      expect(GenotypeString.fromString("ATCG").toString()).toBe("ATCG");
    });

    test("returns string from bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.toString()).toBe("ATCG");
    });
  });

  describe("toJSON", () => {
    test("returns string value for JSON serialization", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.toJSON()).toBe("ATCG");
    });

    test("serializes correctly inside an object", () => {
      const gs = GenotypeString.fromString("ATCG");
      const json = JSON.stringify({ sequence: gs });
      expect(json).toBe('{"sequence":"ATCG"}');
    });

    test("serializes correctly from bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("GCTA"));
      const json = JSON.stringify({ sequence: gs });
      expect(json).toBe('{"sequence":"GCTA"}');
    });

    test("round-trips through JSON", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      const parsed = JSON.parse(JSON.stringify({ seq: gs }));
      expect(parsed.seq).toBe("ATCGATCG");
    });
  });

  describe("Symbol.toPrimitive", () => {
    test("coerces to string in template literals", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(`>${gs}`).toBe(">ATCG");
    });

    test("coerces to string in string concatenation", () => {
      const gs = GenotypeString.fromString("ATCG");
      // Using + directly exercises Symbol.toPrimitive with "default" hint,
      // unlike String(gs) which calls toString() directly.
      expect((">" + gs) as string).toBe(">ATCG");
    });

    test("returns NaN for number hint", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(Number(gs)).toBeNaN();
    });

    test("works with bytes-backed instance in template literal", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(`>${gs}`).toBe(">ATCG");
    });
  });

  describe("custom inspect", () => {
    test("shows type name and length for short sequences", () => {
      const gs = GenotypeString.fromString("ATCG");
      const result = Bun.inspect(gs);
      expect(result).toBe('GenotypeString(4) "ATCG"');
    });

    test("truncates long sequences with ellipsis", () => {
      const long = "A".repeat(100);
      const gs = GenotypeString.fromString(long);
      const result = Bun.inspect(gs);
      expect(result).toContain("GenotypeString(100)");
      expect(result).toContain("...");
      expect(result.length).toBeLessThan(100);
    });
  });

  describe("toBytes", () => {
    test("returns bytes from string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCG");
      const bytes = gs.toBytes();
      expect(bytes).toEqual(new TextEncoder().encode("ATCG"));
    });

    test("returns bytes from bytes-backed instance", () => {
      const original = new TextEncoder().encode("ATCG");
      const gs = GenotypeString.fromBytes(original);
      const bytes = gs.toBytes();
      expect(bytes).toEqual(original);
    });

    test("returns a copy that cannot mutate internals", () => {
      const gs = GenotypeString.fromString("ATCG");
      const bytes = gs.toBytes();
      bytes[0] = 0x58; // 'X'
      expect(gs.toString()).toBe("ATCG");
    });

    test("successive calls return independent copies", () => {
      const gs = GenotypeString.fromString("ATCG");
      const a = gs.toBytes();
      const b = gs.toBytes();
      a[0] = 0x58;
      expect(b[0]).toBe(65); // 'A' unchanged
    });
  });

  describe("regex support", () => {
    test("match finds regex matches", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      const result = gs.match(/[AT]+/g);
      expect(result).toEqual(["AT", "AT"]);
    });

    test("match returns null for no match", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.match(/XYZ/)).toBeNull();
    });

    test("match works from bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      const result = gs.match(/CG/g);
      expect(result).toEqual(["CG", "CG"]);
    });

    test("replace replaces pattern", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      const replaced = gs.replace(/AT/g, "XX");
      expect(replaced.toString()).toBe("XXCGXXCG");
    });

    test("replace with string pattern", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      const replaced = gs.replace("AT", "XX");
      expect(replaced.toString()).toBe("XXCGATCG");
    });

    test("replace returns a GenotypeString", () => {
      const gs = GenotypeString.fromString("ATCG");
      const replaced = gs.replace("A", "X");
      expect(replaced).toBeInstanceOf(GenotypeString);
    });

    test("search finds regex position", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      expect(gs.search(/CG/)).toBe(2);
      expect(gs.search(/XY/)).toBe(-1);
    });

    test("split splits on pattern", () => {
      const gs = GenotypeString.fromString("AT-CG-AT");
      expect(gs.split("-")).toEqual(["AT", "CG", "AT"]);
    });

    test("split with limit", () => {
      const gs = GenotypeString.fromString("AT-CG-AT");
      expect(gs.split("-", 2)).toEqual(["AT", "CG"]);
    });

    test("split with regex", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      expect(gs.split(/CG/)).toEqual(["AT", "AT", ""]);
    });

    test("replace works from bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      const replaced = gs.replace(/AT/g, "XX");
      expect(replaced.toString()).toBe("XXCGXXCG");
    });

    test("search works from bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      expect(gs.search(/CG/)).toBe(2);
      expect(gs.search(/XY/)).toBe(-1);
    });

    test("split works from bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("AT-CG-AT"));
      expect(gs.split("-")).toEqual(["AT", "CG", "AT"]);
    });
  });

  describe("conversion behavior", () => {
    test("string-backed converts to bytes on toBytes() call", () => {
      const gs = GenotypeString.fromString("ATCG");
      const bytes = gs.toBytes();
      expect(bytes).toEqual(new TextEncoder().encode("ATCG"));
      // After conversion, byte-native operations should still work
      expect(gs.includes("TC")).toBe(true);
    });

    test("bytes-backed converts to string on toString() call", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      const str = gs.toString();
      expect(str).toBe("ATCG");
      // After conversion, string operations should still work
      expect(gs.includes("TC")).toBe(true);
    });

    test("chaining operations preserves correctness across conversions", () => {
      const gs = GenotypeString.fromString("atcgatcg");
      const upper = gs.toUpperCase();
      expect(upper.toString()).toBe("ATCGATCG");
      expect(upper.includes("CGA")).toBe(true);
      expect(upper.toBytes()).toEqual(new TextEncoder().encode("ATCGATCG"));
      expect(upper.slice(2, 6).toString()).toBe("CGAT");
    });

    test("bytes-backed operations stay in bytes when possible", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("atcg"));
      const upper = gs.toUpperCase();
      // toUpperCase on bytes returns a bytes-backed instance
      // We can verify this indirectly: toBytes() should not need conversion
      expect(upper.toBytes()).toEqual(new TextEncoder().encode("ATCG"));
    });
  });

  describe("edge cases", () => {
    test("handles single character", () => {
      const gs = GenotypeString.fromString("A");
      expect(gs.length).toBe(1);
      expect(gs.charAt(0)).toBe("A");
      expect(gs.includes("A")).toBe(true);
      expect(gs.includes("T")).toBe(false);
    });

    test("handles quality score characters", () => {
      const quality = "IIIIIIIII";
      const gs = GenotypeString.fromString(quality);
      expect(gs.toString()).toBe(quality);
      expect(gs.length).toBe(9);
    });

    test("handles quality score bytes", () => {
      const quality = new TextEncoder().encode("IIIIIIIII");
      const gs = GenotypeString.fromBytes(quality);
      expect(gs.toString()).toBe("IIIIIIIII");
      expect(gs.charCodeAt(0)).toBe(73); // 'I'
    });

    test("handles long sequences", () => {
      const long = "ATCG".repeat(10000);
      const gs = GenotypeString.fromString(long);
      expect(gs.length).toBe(40000);
      expect(gs.includes("ATCG")).toBe(true);
      expect(gs.startsWith("ATCG")).toBe(true);
      expect(gs.endsWith("ATCG")).toBe(true);
    });

    test("handles IUPAC ambiguity codes", () => {
      const gs = GenotypeString.fromString("ATCGRYSWKMBDHVN");
      expect(gs.length).toBe(15);
      expect(gs.includes("RYSW")).toBe(true);
      expect(gs.toUpperCase().toString()).toBe("ATCGRYSWKMBDHVN");
    });

    test("handles gap characters", () => {
      const gs = GenotypeString.fromString("ATC-GAT.CG");
      expect(gs.includes("-")).toBe(true);
      expect(gs.includes(".")).toBe(true);
      expect(gs.indexOf("-")).toBe(3);
    });
  });

  describe("substring", () => {
    test("extracts substring with non-negative indices", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      expect(gs.substring(2, 6).toString()).toBe("CGAT");
    });

    test("clamps negative start to 0", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.substring(-2, 3).toString()).toBe("ATC");
    });

    test("swaps start and end when start > end", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.substring(3, 1).toString()).toBe("TC");
    });

    test("clamps values beyond length", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.substring(2, 100).toString()).toBe("CG");
    });

    test("treats NaN as 0", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.substring(NaN, 2).toString()).toBe("AT");
    });

    test("omitted end defaults to length", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.substring(2).toString()).toBe("CG");
    });

    test("returns empty for equal start and end", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.substring(2, 2).toString()).toBe("");
    });

    test("returns GenotypeString instance", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.substring(1, 3)).toBeInstanceOf(GenotypeString);
    });

    test("works from bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      expect(gs.substring(2, 6).toString()).toBe("CGAT");
    });

    test("bytes-backed: clamps and swaps like String.prototype.substring", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.substring(-1, 3).toString()).toBe("ATC");
      expect(gs.substring(3, 1).toString()).toBe("TC");
      expect(gs.substring(NaN, 2).toString()).toBe("AT");
    });

    test("matches String.prototype.substring parity", () => {
      const str = "ATCGATCG";
      const gs = GenotypeString.fromString(str);
      const gsBytes = GenotypeString.fromBytes(new TextEncoder().encode(str));

      const cases: [number, number | undefined][] = [
        [0, 4],
        [2, 6],
        [4, undefined],
        [0, 0],
        [0, 100],
        [-5, 3],
        [6, 2],
        [NaN, 3],
        [1.9, 5.1],
        [-1.9, 3],
        [Infinity, 3],
        [0, Infinity],
      ];

      for (const [start, end] of cases) {
        const expected = end === undefined ? str.substring(start) : str.substring(start, end);
        expect(gs.substring(start, end).toString()).toBe(expected);
        expect(gsBytes.substring(start, end).toString()).toBe(expected);
      }
    });
  });

  describe("trim", () => {
    test("removes leading and trailing whitespace", () => {
      const gs = GenotypeString.fromString("  ATCG  ");
      expect(gs.trim().toString()).toBe("ATCG");
    });

    test("removes tabs and newlines", () => {
      const gs = GenotypeString.fromString("\t\nATCG\r\n");
      expect(gs.trim().toString()).toBe("ATCG");
    });

    test("returns same instance when no whitespace to trim", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.trim()).toBe(gs);
    });

    test("handles all-whitespace content", () => {
      const gs = GenotypeString.fromString("   \t\n  ");
      expect(gs.trim().toString()).toBe("");
    });

    test("handles empty string", () => {
      const gs = GenotypeString.fromString("");
      expect(gs.trim().toString()).toBe("");
    });

    test("returns GenotypeString instance", () => {
      const gs = GenotypeString.fromString("  ATCG  ");
      expect(gs.trim()).toBeInstanceOf(GenotypeString);
    });

    test("works from bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("  ATCG  "));
      expect(gs.trim().toString()).toBe("ATCG");
    });

    test("bytes-backed: returns same instance when no whitespace", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.trim()).toBe(gs);
    });

    test("preserves internal whitespace", () => {
      const gs = GenotypeString.fromString("  A T C G  ");
      expect(gs.trim().toString()).toBe("A T C G");
    });

    test("matches String.prototype.trim parity", () => {
      const cases = ["  ATCG  ", "\t\nATCG\r\n", "ATCG", "   ", "", " \t\v\f\r\n ATCG \t\v\f\r\n "];
      for (const str of cases) {
        const gs = GenotypeString.fromString(str);
        const gsBytes = GenotypeString.fromBytes(new TextEncoder().encode(str));
        expect(gs.trim().toString()).toBe(str.trim());
        expect(gsBytes.trim().toString()).toBe(str.trim());
      }
    });
  });

  describe("Symbol.iterator", () => {
    test("yields individual characters from string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect([...gs]).toEqual(["A", "T", "C", "G"]);
    });

    test("yields individual characters from bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect([...gs]).toEqual(["A", "T", "C", "G"]);
    });

    test("works with for-of loop", () => {
      const gs = GenotypeString.fromString("ATG");
      const chars: string[] = [];
      for (const ch of gs) {
        chars.push(ch);
      }
      expect(chars).toEqual(["A", "T", "G"]);
    });

    test("works with Array.from", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(Array.from(gs)).toEqual(["A", "T", "C", "G"]);
    });

    test("works with new Set to get unique characters", () => {
      const gs = GenotypeString.fromString("AATTCCGG");
      expect(new Set(gs)).toEqual(new Set(["A", "T", "C", "G"]));
    });

    test("works with new Set from bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("AAIIBB"));
      expect(new Set(gs)).toEqual(new Set(["A", "I", "B"]));
    });

    test("handles empty content", () => {
      const gs = GenotypeString.fromString("");
      expect([...gs]).toEqual([]);
    });

    test("handles single character", () => {
      const gs = GenotypeString.fromString("A");
      expect([...gs]).toEqual(["A"]);
    });

    test("destructuring works", () => {
      const gs = GenotypeString.fromString("ATCG");
      const [first, second] = gs;
      expect(first).toBe("A");
      expect(second).toBe("T");
    });
  });

  describe("localeCompare", () => {
    test("returns negative when this sorts before other", () => {
      const gs = GenotypeString.fromString("AAAA");
      expect(gs.localeCompare("TTTT")).toBeLessThan(0);
    });

    test("returns positive when this sorts after other", () => {
      const gs = GenotypeString.fromString("TTTT");
      expect(gs.localeCompare("AAAA")).toBeGreaterThan(0);
    });

    test("returns 0 for equal content", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.localeCompare("ATCG")).toBe(0);
    });

    test("accepts GenotypeString as argument", () => {
      const a = GenotypeString.fromString("AAAA");
      const b = GenotypeString.fromString("TTTT");
      expect(a.localeCompare(b)).toBeLessThan(0);
    });

    test("works from bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("AAAA"));
      expect(gs.localeCompare("TTTT")).toBeLessThan(0);
    });

    test("matches String.prototype.localeCompare parity", () => {
      const pairs: [string, string][] = [
        ["ATCG", "ATCG"],
        ["AAAA", "TTTT"],
        ["TTTT", "AAAA"],
        ["", "A"],
        ["A", ""],
        ["", ""],
      ];
      for (const [a, b] of pairs) {
        const gs = GenotypeString.fromString(a);
        const gsBytes = GenotypeString.fromBytes(new TextEncoder().encode(a));
        expect(Math.sign(gs.localeCompare(b))).toBe(Math.sign(a.localeCompare(b)));
        expect(Math.sign(gsBytes.localeCompare(b))).toBe(Math.sign(a.localeCompare(b)));
      }
    });

    test("bytes-backed compares against GenotypeString argument", () => {
      const a = GenotypeString.fromBytes(new TextEncoder().encode("AAAA"));
      const b = GenotypeString.fromBytes(new TextEncoder().encode("TTTT"));
      expect(a.localeCompare(b)).toBeLessThan(0);
      expect(b.localeCompare(a)).toBeGreaterThan(0);
      expect(a.localeCompare(GenotypeString.fromString("AAAA"))).toBe(0);
    });
  });

  describe("contains", () => {
    test("finds substring in string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      expect(gs.contains("CGA")).toBe(true);
      expect(gs.contains("XYZ")).toBe(false);
    });

    test("finds substring in bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      expect(gs.contains("CGA")).toBe(true);
      expect(gs.contains("XYZ")).toBe(false);
    });

    test("behaves identically to includes", () => {
      const gs = GenotypeString.fromString("ATCGATCG");
      expect(gs.contains("CGA")).toBe(gs.includes("CGA"));
      expect(gs.contains("XYZ")).toBe(gs.includes("XYZ"));
      expect(gs.contains("")).toBe(gs.includes(""));
      expect(gs.contains("ATCGATCG")).toBe(gs.includes("ATCGATCG"));
    });
  });

  describe("is", () => {
    test("matches character at index in string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.is(0, "A")).toBe(true);
      expect(gs.is(1, "T")).toBe(true);
      expect(gs.is(0, "T")).toBe(false);
    });

    test("matches character at index in bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.is(0, "A")).toBe(true);
      expect(gs.is(1, "T")).toBe(true);
      expect(gs.is(0, "T")).toBe(false);
    });

    test("returns false for out-of-range indices", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.is(-1, "A")).toBe(false);
      expect(gs.is(4, "A")).toBe(false);
      expect(gs.is(100, "A")).toBe(false);
    });

    test("is case-sensitive", () => {
      const gs = GenotypeString.fromString("atcg");
      expect(gs.is(0, "a")).toBe(true);
      expect(gs.is(0, "A")).toBe(false);
    });

    test("works with non-alphabetic characters", () => {
      const gs = GenotypeString.fromString("AT-CG");
      expect(gs.is(2, "-")).toBe(true);
      expect(gs.is(2, ".")).toBe(false);
    });
  });

  describe("isAnyOf", () => {
    test("matches against CharSet in string-backed instance", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.isAnyOf(0, Bases.Purine)).toBe(true); // A is a purine
      expect(gs.isAnyOf(1, Bases.Purine)).toBe(false); // T is not a purine
      expect(gs.isAnyOf(2, Bases.Pyrimidine)).toBe(true); // C is a pyrimidine
      expect(gs.isAnyOf(3, Bases.Purine)).toBe(true); // G is a purine
    });

    test("matches against CharSet in bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      expect(gs.isAnyOf(0, Bases.Purine)).toBe(true);
      expect(gs.isAnyOf(1, Bases.Purine)).toBe(false);
    });

    test("matches against plain string", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.isAnyOf(0, "AC")).toBe(true);
      expect(gs.isAnyOf(1, "AC")).toBe(false);
      expect(gs.isAnyOf(2, "AC")).toBe(true);
    });

    test("returns false for out-of-range indices", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.isAnyOf(-1, Bases.DNA)).toBe(false);
      expect(gs.isAnyOf(4, Bases.DNA)).toBe(false);
    });

    test("works with Bases.Strong and Bases.Weak", () => {
      const gs = GenotypeString.fromString("GCATSW");
      expect(gs.isAnyOf(0, Bases.Strong)).toBe(true); // G
      expect(gs.isAnyOf(1, Bases.Strong)).toBe(true); // C
      expect(gs.isAnyOf(2, Bases.Strong)).toBe(false); // A
      expect(gs.isAnyOf(3, Bases.Strong)).toBe(false); // T
      expect(gs.isAnyOf(4, Bases.Strong)).toBe(true); // S (strong ambiguity)
      expect(gs.isAnyOf(5, Bases.Weak)).toBe(true); // W (weak ambiguity)
    });

    test("works with Bases.Ambiguous", () => {
      const gs = GenotypeString.fromString("ATCGRYN");
      expect(gs.isAnyOf(0, Bases.Ambiguous)).toBe(false); // A is canonical
      expect(gs.isAnyOf(4, Bases.Ambiguous)).toBe(true); // R is ambiguous
      expect(gs.isAnyOf(5, Bases.Ambiguous)).toBe(true); // Y is ambiguous
      expect(gs.isAnyOf(6, Bases.Ambiguous)).toBe(true); // N is ambiguous
    });

    test("works with Bases.Gap", () => {
      const gs = GenotypeString.fromString("AT-C.G*");
      expect(gs.isAnyOf(2, Bases.Gap)).toBe(true); // -
      expect(gs.isAnyOf(4, Bases.Gap)).toBe(true); // .
      expect(gs.isAnyOf(6, Bases.Gap)).toBe(true); // *
      expect(gs.isAnyOf(0, Bases.Gap)).toBe(false); // A
    });

    test("custom CharSet works", () => {
      const stopCodons = CharSet.from("*");
      const gs = GenotypeString.fromString("MAK*LR");
      expect(gs.isAnyOf(3, stopCodons)).toBe(true);
      expect(gs.isAnyOf(0, stopCodons)).toBe(false);
    });
  });

  describe("concat", () => {
    test("concatenates string-backed instances", () => {
      const a = GenotypeString.fromString("ATCG");
      const b = GenotypeString.fromString("GCTA");
      const result = GenotypeString.concat(a, b);
      expect(result.toString()).toBe("ATCGGCTA");
      expect(result.length).toBe(8);
    });

    test("concatenates bytes-backed instances without string conversion", () => {
      const enc = new TextEncoder();
      const a = GenotypeString.fromBytes(enc.encode("ATCG"));
      const b = GenotypeString.fromBytes(enc.encode("GCTA"));
      const result = GenotypeString.concat(a, b);
      expect(result.toString()).toBe("ATCGGCTA");
      expect(result.toBytes()).toEqual(enc.encode("ATCGGCTA"));
    });

    test("concatenates mixed GenotypeString and plain strings", () => {
      const gs = GenotypeString.fromString("ATCG");
      const result = GenotypeString.concat(gs, "NNNN", "GCTA");
      expect(result.toString()).toBe("ATCGNNNNGCTA");
    });

    test("concatenates multiple parts", () => {
      const parts = ["AT", "CG", "NN", "GC", "TA"].map(GenotypeString.fromString);
      const result = GenotypeString.concat(...parts);
      expect(result.toString()).toBe("ATCGNNGCTA");
    });

    test("returns empty GenotypeString for no arguments", () => {
      const result = GenotypeString.concat();
      expect(result.toString()).toBe("");
      expect(result.length).toBe(0);
    });

    test("returns the same instance for a single GenotypeString argument", () => {
      const gs = GenotypeString.fromString("ATCG");
      const result = GenotypeString.concat(gs);
      expect(result).toBe(gs);
    });

    test("wraps a single plain string argument", () => {
      const result = GenotypeString.concat("ATCG");
      expect(result).toBeInstanceOf(GenotypeString);
      expect(result.toString()).toBe("ATCG");
    });

    test("handles empty parts", () => {
      const a = GenotypeString.fromString("ATCG");
      const b = GenotypeString.fromString("");
      const c = GenotypeString.fromString("GCTA");
      const result = GenotypeString.concat(a, b, c);
      expect(result.toString()).toBe("ATCGGCTA");
    });

    test("result is independent of source instances", () => {
      const enc = new TextEncoder();
      const a = GenotypeString.fromBytes(enc.encode("ATCG"));
      const b = GenotypeString.fromBytes(enc.encode("GCTA"));
      const result = GenotypeString.concat(a, b);
      expect(result.toString()).toBe("ATCGGCTA");
      expect(a.toString()).toBe("ATCG");
      expect(b.toString()).toBe("GCTA");
    });

    test("replaces slice+toString+concatenation pattern", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCGATCG"));
      const result = GenotypeString.concat(gs.slice(0, 4), gs.slice(4));
      expect(result.toString()).toBe("ATCGATCG");
    });
  });

  describe("repeat", () => {
    test("repeats string-backed instance", () => {
      const gs = GenotypeString.fromString("AT");
      expect(gs.repeat(3).toString()).toBe("ATATAT");
    });

    test("repeats bytes-backed instance", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("AT"));
      const result = gs.repeat(3);
      expect(result.toString()).toBe("ATATAT");
      expect(result.toBytes()).toEqual(new TextEncoder().encode("ATATAT"));
    });

    test("repeat(0) returns empty", () => {
      const gs = GenotypeString.fromString("ATCG");
      const result = gs.repeat(0);
      expect(result.toString()).toBe("");
      expect(result.length).toBe(0);
    });

    test("repeat(1) returns same instance", () => {
      const gs = GenotypeString.fromString("ATCG");
      expect(gs.repeat(1)).toBe(gs);
    });

    test("repeat with single character", () => {
      const gs = GenotypeString.fromString("N");
      expect(gs.repeat(5).toString()).toBe("NNNNN");
    });

    test("repeat with quality character", () => {
      const gs = GenotypeString.fromString("I");
      const result = gs.repeat(10);
      expect(result.toString()).toBe("IIIIIIIIII");
      expect(result.length).toBe(10);
    });

    test("throws on negative count", () => {
      const gs = GenotypeString.fromString("AT");
      expect(() => gs.repeat(-1)).toThrow(RangeError);
    });

    test("throws on Infinity", () => {
      const gs = GenotypeString.fromString("AT");
      expect(() => gs.repeat(Infinity)).toThrow(RangeError);
    });

    test("matches String.prototype.repeat parity", () => {
      const str = "ATCG";
      const gs = GenotypeString.fromString(str);
      const gsBytes = GenotypeString.fromBytes(new TextEncoder().encode(str));
      for (const n of [0, 1, 2, 5, 10]) {
        expect(gs.repeat(n).toString()).toBe(str.repeat(n));
        expect(gsBytes.repeat(n).toString()).toBe(str.repeat(n));
      }
    });
  });
});

describe("CharSet", () => {
  test("from creates a set from a string of characters", () => {
    const set = CharSet.from("ACGT");
    expect(set.has(0x41)).toBe(true); // A
    expect(set.has(0x43)).toBe(true); // C
    expect(set.has(0x47)).toBe(true); // G
    expect(set.has(0x54)).toBe(true); // T
    expect(set.has(0x4e)).toBe(false); // N
  });

  test("has returns false for characters not in the set", () => {
    const set = CharSet.from("AC");
    expect(set.has(0x41)).toBe(true); // A
    expect(set.has(0x42)).toBe(false); // B
    expect(set.has(0x43)).toBe(true); // C
    expect(set.has(0x44)).toBe(false); // D
  });

  test("handles duplicate characters", () => {
    const set = CharSet.from("AAACCC");
    expect(set.has(0x41)).toBe(true);
    expect(set.has(0x43)).toBe(true);
    expect(set.has(0x47)).toBe(false);
  });

  test("handles empty string", () => {
    const set = CharSet.from("");
    expect(set.has(0x41)).toBe(false);
    expect(set.has(0x00)).toBe(false);
  });

  test("handles non-alphabetic characters", () => {
    const set = CharSet.from("-.*");
    expect(set.has(0x2d)).toBe(true); // -
    expect(set.has(0x2e)).toBe(true); // .
    expect(set.has(0x2a)).toBe(true); // *
    expect(set.has(0x41)).toBe(false); // A
  });
});

describe("Bases", () => {
  test("DNA contains exactly A, C, G, T", () => {
    expect(Bases.DNA.has(0x41)).toBe(true); // A
    expect(Bases.DNA.has(0x43)).toBe(true); // C
    expect(Bases.DNA.has(0x47)).toBe(true); // G
    expect(Bases.DNA.has(0x54)).toBe(true); // T
    expect(Bases.DNA.has(0x55)).toBe(false); // U
    expect(Bases.DNA.has(0x4e)).toBe(false); // N
  });

  test("RNA contains exactly A, C, G, U", () => {
    expect(Bases.RNA.has(0x41)).toBe(true); // A
    expect(Bases.RNA.has(0x43)).toBe(true); // C
    expect(Bases.RNA.has(0x47)).toBe(true); // G
    expect(Bases.RNA.has(0x55)).toBe(true); // U
    expect(Bases.RNA.has(0x54)).toBe(false); // T
  });

  test("Canonical contains A, C, G, T, U", () => {
    for (const code of [0x41, 0x43, 0x47, 0x54, 0x55]) {
      expect(Bases.Canonical.has(code)).toBe(true);
    }
    expect(Bases.Canonical.has(0x4e)).toBe(false); // N
  });

  test("Purine contains A, G, R", () => {
    expect(Bases.Purine.has(0x41)).toBe(true); // A
    expect(Bases.Purine.has(0x47)).toBe(true); // G
    expect(Bases.Purine.has(0x52)).toBe(true); // R
    expect(Bases.Purine.has(0x43)).toBe(false); // C
  });

  test("Pyrimidine contains C, T, U, Y", () => {
    expect(Bases.Pyrimidine.has(0x43)).toBe(true); // C
    expect(Bases.Pyrimidine.has(0x54)).toBe(true); // T
    expect(Bases.Pyrimidine.has(0x55)).toBe(true); // U
    expect(Bases.Pyrimidine.has(0x59)).toBe(true); // Y
    expect(Bases.Pyrimidine.has(0x41)).toBe(false); // A
  });

  test("Ambiguous contains all IUPAC ambiguity codes", () => {
    const ambiguousCodes = "RYSWKMBDHVN";
    for (const char of ambiguousCodes) {
      expect(Bases.Ambiguous.has(char.charCodeAt(0))).toBe(true);
    }
    // Canonical bases are not ambiguous
    for (const char of "ACGTU") {
      expect(Bases.Ambiguous.has(char.charCodeAt(0))).toBe(false);
    }
  });

  test("Gap contains -, ., *", () => {
    expect(Bases.Gap.has("-".charCodeAt(0))).toBe(true);
    expect(Bases.Gap.has(".".charCodeAt(0))).toBe(true);
    expect(Bases.Gap.has("*".charCodeAt(0))).toBe(true);
    expect(Bases.Gap.has("A".charCodeAt(0))).toBe(false);
  });

  test("GC is an alias for Strong", () => {
    for (let i = 0; i < 128; i++) {
      expect(Bases.GC.has(i)).toBe(Bases.Strong.has(i));
    }
  });

  test("AT is an alias for Weak", () => {
    for (let i = 0; i < 128; i++) {
      expect(Bases.AT.has(i)).toBe(Bases.Weak.has(i));
    }
  });
});

describe("genotypeStringInternal", () => {
  describe("mutableBytes", () => {
    test("returns the live backing buffer, not a copy", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      const buf = genotypeStringInternal.mutableBytes(gs);
      buf[0] = 0x58; // 'X'
      expect(gs.toString()).toBe("XTCG");
    });

    test("converts string-backed instance to bytes and returns the buffer", () => {
      const gs = GenotypeString.fromString("ATCG");
      const buf = genotypeStringInternal.mutableBytes(gs);
      expect(buf).toBeInstanceOf(Uint8Array);
      expect(buf.length).toBe(4);
      expect(buf[0]).toBe(65); // 'A'
    });

    test("mutations through buffer are visible via toBytes()", () => {
      const gs = GenotypeString.fromString("ATCG");
      const buf = genotypeStringInternal.mutableBytes(gs);
      buf[1] = 0x41; // 'A' replacing 'T'
      genotypeStringInternal.invalidate(gs, buf);
      expect(gs.toBytes()).toEqual(new TextEncoder().encode("AACG"));
    });

    test("mutations through buffer are visible via toString()", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      const buf = genotypeStringInternal.mutableBytes(gs);
      buf[0] = 0x47; // 'G'
      buf[3] = 0x41; // 'A'
      genotypeStringInternal.invalidate(gs, buf);
      expect(gs.toString()).toBe("GTCA");
    });

    test("successive calls return the same buffer", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      const a = genotypeStringInternal.mutableBytes(gs);
      const b = genotypeStringInternal.mutableBytes(gs);
      expect(a).toBe(b);
    });

    test("mutations are visible via toBytes() without invalidate", () => {
      const gs = GenotypeString.fromString("ATCG");
      const buf = genotypeStringInternal.mutableBytes(gs);
      buf[1] = 0x41; // 'A' replacing 'T'
      expect(gs.toBytes()).toEqual(new TextEncoder().encode("AACG"));
    });

    test("mutations are visible via toString() without invalidate", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      const buf = genotypeStringInternal.mutableBytes(gs);
      buf[0] = 0x47; // 'G'
      buf[3] = 0x41; // 'A'
      expect(gs.toString()).toBe("GTCA");
    });
  });

  describe("invalidate", () => {
    test("drops stale string cache after byte mutation", () => {
      const gs = GenotypeString.fromString("ATCG");
      const buf = genotypeStringInternal.mutableBytes(gs);
      // At this point repr is bytes. Force a string cache by reading toString().
      expect(gs.toString()).toBe("ATCG");
      // Now mutate the buffer. The string cache is stale because toString()
      // converted the repr to string and dropped the byte reference.
      buf[0] = 0x58; // 'X'
      // Passing the buffer back to invalidate() restores it as the authoritative
      // representation, dropping the stale string cache.
      genotypeStringInternal.invalidate(gs, buf);
      expect(gs.toString()).toBe("XTCG");
    });

    test("recovers after repeated stale-cache cycles", () => {
      const gs = GenotypeString.fromString("ATCG");
      const buf = genotypeStringInternal.mutableBytes(gs);

      expect(gs.toString()).toBe("ATCG"); // cache string
      buf[0] = 0x58; // 'X'
      genotypeStringInternal.invalidate(gs, buf);
      expect(gs.toString()).toBe("XTCG"); // re-cache string

      buf[1] = 0x58; // 'X'
      genotypeStringInternal.invalidate(gs, buf);
      expect(gs.toString()).toBe("XXCG");
    });

    test("does not throw when repr is already bytes", () => {
      const gs = GenotypeString.fromBytes(new TextEncoder().encode("ATCG"));
      const buf = genotypeStringInternal.mutableBytes(gs);
      expect(() => {
        genotypeStringInternal.invalidate(gs, buf);
      }).not.toThrow();
      expect(gs.toString()).toBe("ATCG");
    });
  });

  describe("object integrity", () => {
    test("accessor object is frozen", () => {
      expect(Object.isFrozen(genotypeStringInternal)).toBe(true);
    });

    test("cannot add new properties", () => {
      expect(() => {
        (genotypeStringInternal as Record<string, unknown>)["hack"] = () => {};
      }).toThrow();
    });

    test("cannot overwrite existing methods", () => {
      expect(() => {
        (genotypeStringInternal as Record<string, unknown>)["mutableBytes"] = () => {};
      }).toThrow();
    });
  });
});
