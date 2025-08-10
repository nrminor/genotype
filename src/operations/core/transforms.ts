/**
 * Core sequence transformation operations
 * These are the most frequently used operations in bioinformatics
 *
 * Provides complement, reverse, and reverse-complement operations
 * with full IUPAC ambiguity code support
 * 
 * @module transforms
 * @since 1.0.0
 * 
 * @remarks
 * This module exports functions both individually (tree-shakeable) and as a
 * grouped object for convenience. Choose your preferred style:
 * 
 * ```typescript
 * // Import individual functions (tree-shakeable)
 * import { complement, reverse } from './transforms';
 * 
 * // Or use the grouped object
 * import { SequenceTransforms } from './transforms';
 * SequenceTransforms.complement('ATCG');
 * ```
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Complement mapping including IUPAC ambiguity codes
 * 🔥 ZIG OPTIMIZATION: Lookup table could be SIMD-accelerated
 */
const complementMap: Record<string, string> = {
	A: "T",
	T: "A",
	C: "G",
	G: "C",
	U: "A", // RNA
	R: "Y",
	Y: "R", // Purines <-> Pyrimidines
	S: "S",
	W: "W", // Self-complementary
	K: "M",
	M: "K", // Keto <-> Amino
	B: "V",
	V: "B", // Not A <-> Not T
	D: "H",
	H: "D", // Not C <-> Not G
	N: "N", // Any remains any
	"-": "-",
	".": ".",
	"*": "*", // Gaps and stops
};

// =============================================================================
// EXPORTED FUNCTIONS
// =============================================================================

/**
 * Generate complement of DNA/RNA sequence
 *
 * @example
 * ```typescript
 * const comp = complement('ATCG');
 * console.log(comp); // 'TAGC'
 *
 * const rnaComp = complement('AUCG');
 * console.log(rnaComp); // 'UAGC'
 * ```
 *
 * @param sequence - DNA or RNA sequence to complement
 * @returns Complemented sequence
 *
 * 🔥 ZIG CRITICAL: Lookup table with SIMD processing
 */
export function complement(sequence: string): string {
	// Tiger Style: Assert input
	if (!sequence || typeof sequence !== "string") {
		throw new Error("Sequence must be a non-empty string");
	}

	// 🔥 ZIG: Vectorized lookup table operations
	const upper = sequence.toUpperCase();
	const result = new Array(sequence.length);

	for (let i = 0; i < upper.length; i++) {
		const base = upper[i];
		if (base === null || base === undefined || base === "") continue;

		const comp = complementMap[base];
		const originalChar = sequence[i];

		if (
			comp === null ||
			comp === undefined ||
			comp === "" ||
			originalChar === null ||
			originalChar === undefined ||
			originalChar === ""
		) {
			// Unknown character - preserve as N
			result[i] = "N";
		} else {
			// Preserve original case
			result[i] =
				originalChar === originalChar.toLowerCase()
					? comp.toLowerCase()
					: comp;
		}
	}

	return result.join("");
}

/**
 * Reverse a sequence
 *
 * @example
 * ```typescript
 * const rev = reverse('ATCG');
 * console.log(rev); // 'GCTA'
 * ```
 *
 * @param sequence - Sequence to reverse
 * @returns Reversed sequence
 *
 * 🔥 ZIG OPTIMIZATION: In-place reversal with SIMD
 */
export function reverse(sequence: string): string {
	// Tiger Style: Assert input
	if (!sequence || typeof sequence !== "string") {
		throw new Error("Sequence must be a non-empty string");
	}

	// 🔥 ZIG: Vectorized byte swapping
	return Array.from(sequence).reverse().join("");
}

/**
 * Reverse complement - most common operation in bioinformatics
 *
 * @example
 * ```typescript
 * const revComp = reverseComplement('ATCG');
 * console.log(revComp); // 'CGAT'
 *
 * // With IUPAC codes
 * const revCompIUPAC = reverseComplement('ATCGRYMK');
 * console.log(revCompIUPAC); // 'MKRYCGAT'
 * ```
 *
 * @param sequence - DNA or RNA sequence
 * @returns Reverse complemented sequence
 *
 * 🔥 ZIG CRITICAL: Combined reverse + complement with SIMD
 */
export function reverseComplement(sequence: string): string {
	// Tiger Style: Assert input
	if (!sequence || typeof sequence !== "string") {
		throw new Error("Sequence must be a non-empty string");
	}

	// 🔥 ZIG: Fused operation avoiding intermediate string
	const upper = sequence.toUpperCase();
	const result = new Array(sequence.length);

	for (let i = 0; i < upper.length; i++) {
		// Read from end, complement, write to beginning
		const originalIndex = upper.length - 1 - i;
		const base = upper[originalIndex];
		if (base === null || base === undefined || base === "") {
			result[i] = "N";
			continue;
		}

		const comp = complementMap[base];
		const originalChar = sequence[originalIndex];

		if (
			comp === null ||
			comp === undefined ||
			comp === "" ||
			originalChar === null ||
			originalChar === undefined ||
			originalChar === ""
		) {
			result[i] = "N";
		} else {
			// Preserve original case from the original position
			result[i] =
				originalChar === originalChar.toLowerCase()
					? comp.toLowerCase()
					: comp;
		}
	}

	return result.join("");
}

/**
 * Convert DNA to RNA (T -> U)
 *
 * @example
 * ```typescript
 * const rna = toRNA('ATCG');
 * console.log(rna); // 'AUCG'
 * ```
 *
 * @param sequence - DNA sequence
 * @returns RNA sequence
 *
 * 🔥 ZIG OPTIMIZATION: Bulk character replacement
 */
export function toRNA(sequence: string): string {
	// Tiger Style: Assert input
	if (!sequence || typeof sequence !== "string") {
		throw new Error("Sequence must be a non-empty string");
	}

	// 🔥 ZIG: SIMD string replacement
	return sequence.replace(/T/g, "U").replace(/t/g, "u");
}

/**
 * Convert RNA to DNA (U -> T)
 *
 * @example
 * ```typescript
 * const dna = toDNA('AUCG');
 * console.log(dna); // 'ATCG'
 * ```
 *
 * @param sequence - RNA sequence
 * @returns DNA sequence
 *
 * 🔥 ZIG OPTIMIZATION: Bulk character replacement
 */
export function toDNA(sequence: string): string {
	// Tiger Style: Assert input
	if (!sequence || typeof sequence !== "string") {
		throw new Error("Sequence must be a non-empty string");
	}

	// 🔥 ZIG: SIMD string replacement
	return sequence.replace(/U/g, "T").replace(/u/g, "t");
}

/**
 * Calculate GC content
 *
 * @example
 * ```typescript
 * const gc = gcContent('ATCG');
 * console.log(gc); // 0.5 (50%)
 *
 * const gcRich = gcContent('GGCC');
 * console.log(gcRich); // 1.0 (100%)
 * ```
 *
 * @param sequence - DNA or RNA sequence
 * @returns GC content as fraction (0-1)
 *
 * 🔥 ZIG CRITICAL: Character counting with SIMD
 */
export function gcContent(sequence: string): number {
	// Tiger Style: Assert input
	if (!sequence || typeof sequence !== "string") {
		throw new Error("Sequence must be a non-empty string");
	}

	if (sequence.length === 0) {
		return 0;
	}

	// 🔥 ZIG: Vectorized character counting
	let gcCount = 0;
	const upper = sequence.toUpperCase();

	for (let i = 0; i < upper.length; i++) {
		const base = upper[i];
		if (base === "G" || base === "C" || base === "S") {
			// S is Strong (G or C)
			gcCount++;
		}
	}

	return gcCount / sequence.length;
}

/**
 * Calculate AT content
 *
 * @param sequence - DNA sequence
 * @returns AT content as fraction (0-1)
 */
export function atContent(sequence: string): number {
	// Tiger Style: Assert input
	if (!sequence || typeof sequence !== "string") {
		throw new Error("Sequence must be a non-empty string");
	}

	if (sequence.length === 0) {
		return 0;
	}

	let atCount = 0;
	const upper = sequence.toUpperCase();

	for (let i = 0; i < upper.length; i++) {
		const base = upper[i];
		if (base === "A" || base === "T" || base === "U" || base === "W") {
			// W is Weak (A or T)
			atCount++;
		}
	}

	return atCount / sequence.length;
}

/**
 * Count occurrences of each base in sequence
 *
 * @example
 * ```typescript
 * const counts = baseComposition('ATCGATCG');
 * console.log(counts); // { A: 2, T: 2, C: 2, G: 2 }
 * ```
 *
 * @param sequence - DNA or RNA sequence
 * @returns Object with base counts
 */
export function baseComposition(sequence: string): Record<string, number> {
	// Tiger Style: Assert input
	if (!sequence || typeof sequence !== "string") {
		throw new Error("Sequence must be a non-empty string");
	}

	const composition: Record<string, number> = {};
	const upper = sequence.toUpperCase();

	for (let i = 0; i < upper.length; i++) {
		const base = upper[i];
		if (base !== null && base !== undefined && base !== "") {
			composition[base] =
				(composition[base] !== null && composition[base] !== undefined
					? composition[base]
					: 0) + 1;
		}
	}

	return composition;
}

/**
 * Check if sequence is palindromic (equals its reverse complement)
 *
 * @example
 * ```typescript
 * const isPalin = isPalindromic('GAATTC');
 * console.log(isPalin); // true (EcoRI site)
 *
 * const notPalin = isPalindromic('ATCG');
 * console.log(notPalin); // false
 * ```
 *
 * @param sequence - DNA sequence to check
 * @returns true if palindromic
 */
export function isPalindromic(sequence: string): boolean {
	// Tiger Style: Assert input
	if (!sequence || typeof sequence !== "string") {
		throw new Error("Sequence must be a non-empty string");
	}

	const revComp = reverseComplement(sequence);
	return sequence.toUpperCase() === revComp.toUpperCase();
}

/**
 * Find all positions of a pattern in sequence (including overlapping)
 *
 * @example
 * ```typescript
 * const positions = findPattern('ATATA', 'ATA');
 * console.log(positions); // [0, 2] (overlapping matches)
 * ```
 *
 * @param sequence - Sequence to search in
 * @param pattern - Pattern to find
 * @returns Array of 0-based positions
 */
export function findPattern(sequence: string, pattern: string): number[] {
	// Tiger Style: Assert inputs
	if (!sequence || typeof sequence !== "string") {
		throw new Error("Sequence must be a non-empty string");
	}
	if (!pattern || typeof pattern !== "string") {
		throw new Error("Pattern must be a non-empty string");
	}

	const positions: number[] = [];
	const upperSeq = sequence.toUpperCase();
	const upperPat = pattern.toUpperCase();

	let index = upperSeq.indexOf(upperPat);
	while (index !== -1) {
		positions.push(index);
		// Look for overlapping matches
		index = upperSeq.indexOf(upperPat, index + 1);
	}

	return positions;
}

/**
 * Translate DNA sequence to amino acids (simple, frame 0 only)
 * This is a basic implementation - use genetic-codes.ts for full translation
 *
 * @param sequence - DNA sequence (must be multiple of 3)
 * @returns Amino acid sequence using standard genetic code
 */
export function translateSimple(sequence: string): string {
	// Tiger Style: Assert input
	if (!sequence || typeof sequence !== "string") {
		throw new Error("Sequence must be a non-empty string");
	}
	if (sequence.length % 3 !== 0) {
		throw new Error("Sequence length must be multiple of 3 for translation");
	}

	// Standard genetic code (simplified)
	const codonTable: Record<string, string> = {
		TTT: "F",
		TTC: "F",
		TTA: "L",
		TTG: "L",
		TCT: "S",
		TCC: "S",
		TCA: "S",
		TCG: "S",
		TAT: "Y",
		TAC: "Y",
		TAA: "*",
		TAG: "*",
		TGT: "C",
		TGC: "C",
		TGA: "*",
		TGG: "W",
		CTT: "L",
		CTC: "L",
		CTA: "L",
		CTG: "L",
		CCT: "P",
		CCC: "P",
		CCA: "P",
		CCG: "P",
		CAT: "H",
		CAC: "H",
		CAA: "Q",
		CAG: "Q",
		CGT: "R",
		CGC: "R",
		CGA: "R",
		CGG: "R",
		ATT: "I",
		ATC: "I",
		ATA: "I",
		ATG: "M",
		ACT: "T",
		ACC: "T",
		ACA: "T",
		ACG: "T",
		AAT: "N",
		AAC: "N",
		AAA: "K",
		AAG: "K",
		AGT: "S",
		AGC: "S",
		AGA: "R",
		AGG: "R",
		GTT: "V",
		GTC: "V",
		GTA: "V",
		GTG: "V",
		GCT: "A",
		GCC: "A",
		GCA: "A",
		GCG: "A",
		GAT: "D",
		GAC: "D",
		GAA: "E",
		GAG: "E",
		GGT: "G",
		GGC: "G",
		GGA: "G",
		GGG: "G",
	};

	const upper = sequence.toUpperCase().replace(/U/g, "T");
	let protein = "";

	for (let i = 0; i < upper.length; i += 3) {
		const codon = upper.substring(i, i + 3);
		const aa = codonTable[codon];
		protein += aa !== null && aa !== undefined && aa !== "" ? aa : "X"; // X for unknown
	}

	return protein;
}

// =============================================================================
// GROUPED EXPORT
// =============================================================================

/**
 * Sequence transformation utilities grouped for convenience.
 * 
 * All functions are also available as individual exports for tree-shaking.
 * 
 * @example
 * ```typescript
 * // Use via the grouped object
 * import { SequenceTransforms } from './transforms';
 * const comp = SequenceTransforms.complement('ATCG');
 * 
 * // Or import individual functions
 * import { complement } from './transforms';
 * const comp = complement('ATCG');
 * ```
 */
export const SequenceTransforms = {
	complement,
	reverse,
	reverseComplement,
	toRNA,
	toDNA,
	gcContent,
	atContent,
	baseComposition,
	isPalindromic,
	findPattern,
	translateSimple,
} as const;