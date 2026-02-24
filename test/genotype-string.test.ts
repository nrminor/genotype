import { describe, expect, test } from "bun:test";
import { GenotypeString } from "../src/genotype-string";

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
});
