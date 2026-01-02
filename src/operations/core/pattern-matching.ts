/**
 * High-performance pattern matching algorithms for genomic sequences.
 *
 * This module provides both low-level algorithm implementations and high-level
 * streaming pattern matching for genomic data. Supports exact matching, fuzzy
 * matching, IUPAC ambiguity codes, and streaming processing of large sequence files.
 *
 * @module pattern-matching
 * @since v0.1.0
 *
 * @remarks
 * Key features:
 * - Low-level algorithms available as named exports for direct use
 * - High-level SequenceMatcher class for rich features and streaming
 * - Multiple algorithms (Boyer-Moore, KMP, fuzzy, regex, Rabin-Karp)
 * - IUPAC ambiguity code support (N, R, Y, etc.)
 * - Memory-efficient streaming for multi-GB files
 * - Rich match objects with surrounding context
 *
 * Performance considerations:
 * - Boyer-Moore is fastest for long patterns (>10 bp)
 * - KMP excels with repetitive patterns
 * - Rabin-Karp is efficient for multiple pattern search
 * - Fuzzy matching scales O(n*m*k) where k is max mismatches
 * - IUPAC matching has overhead for ambiguous base expansion
 */

import type { AbstractSequence } from "../../types";
import { reverseComplement } from "./sequence-manipulation";
import { expandAmbiguous } from "./sequence-validation";

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Simple match result with position and mismatch information
 * Used by low-level algorithm functions
 *
 * @template TPattern - Type of the original pattern (preserves branded types)
 */
export interface PatternMatch<TPattern extends string = string> {
  position: number;
  length: number;
  mismatches: number;
  matched: string;
  pattern: TPattern;
}

/**
 * Rich match result with full context information.
 * Used by high-level SequenceMatcher class
 *
 * @interface SequenceMatch
 * @since v0.1.0
 */
export interface SequenceMatch {
  /**
   * Zero-based position in the sequence where the match starts.
   * @example 42 // Match starts at position 42
   */
  position: number;

  /**
   * Length of the matched region in base pairs.
   * May differ from pattern length for regex or ambiguous matches.
   */
  length: number;

  /**
   * The actual matched text from the sequence.
   * Preserves original case from the input sequence.
   */
  matched: string;

  /**
   * The pattern that was matched.
   * Useful for regex patterns where the match may vary.
   */
  pattern: string;

  /**
   * Number of mismatches for fuzzy matching.
   * Always 0 for exact matches.
   * @minimum 0
   */
  mismatches: number;

  /**
   * ID of the sequence where this match was found.
   * Corresponds to the sequence.id field.
   */
  sequenceId: string;

  /**
   * Context surrounding the match for visualization.
   * Configurable via contextWindow option.
   */
  context: {
    /**
     * Text before the match (up to contextWindow characters).
     * Empty string if match is at sequence start.
     */
    before: string;
    /**
     * Text after the match (up to contextWindow characters).
     * Empty string if match is at sequence end.
     */
    after: string;
    /**
     * Absolute start position of the context window.
     * @minimum 0
     */
    contextStart: number;
    /**
     * Absolute end position of the context window.
     * May exceed sequence length for end matches.
     */
    contextEnd: number;
  };

  /**
   * Match quality score for fuzzy matching.
   * Calculated as: 1.0 - (mismatches / pattern.length)
   * @minimum 0.0
   * @maximum 1.0
   * @example 0.75 // 75% similarity (1 mismatch in 4 bp pattern)
   */
  score: number;
}

/**
 * Configuration options for pattern matching behavior.
 *
 * @interface MatcherOptions
 * @since v0.1.0
 */
export interface MatcherOptions {
  /**
   * Algorithm to use for pattern matching.
   * - 'boyer-moore': Fast for long patterns and alphabets (default)
   * - 'kmp': Efficient for patterns with repetitive structure
   * - 'fuzzy': Allows mismatches up to maxMismatches
   * - 'regex': Full regular expression support
   * @default 'boyer-moore'
   */
  algorithm?: "boyer-moore" | "kmp" | "fuzzy" | "regex";

  /**
   * Maximum number of mismatches allowed for fuzzy matching.
   * Only applies when algorithm is 'fuzzy'.
   * @default 0
   * @minimum 0
   */
  maxMismatches?: number;

  /**
   * Enable IUPAC ambiguity code matching.
   * Supports: N (any), R (A/G), Y (C/T), S (G/C), W (A/T), K (G/T),
   * M (A/C), B (C/G/T), D (A/G/T), H (A/C/T), V (A/C/G).
   * @default false
   */
  iupacAware?: boolean;

  /**
   * Whether pattern matching is case-sensitive.
   * When false, converts both pattern and sequence to uppercase.
   * @default true
   */
  caseSensitive?: boolean;

  /**
   * Number of characters to include before/after match in context.
   * @default 50
   * @minimum 0
   */
  contextWindow?: number;

  /**
   * Buffer size in bytes for streaming large sequences.
   * Larger buffers improve performance but use more memory.
   * @default 1000000 (1MB)
   * @minimum 1024
   */
  bufferSize?: number;
}

// =============================================================================
// LOW-LEVEL ALGORITHM FUNCTIONS (Named Exports)
// =============================================================================

/**
 * Boyer-Moore string search algorithm for exact pattern matching
 *
 * The Boyer-Moore algorithm is a highly efficient string-searching algorithm that is considered
 * the standard benchmark for practical string-search applications. Developed by Robert S. Boyer
 * and J Strother Moore in 1977, it achieves sublinear performance in many cases by reading the
 * pattern from right to left and using precomputed tables to skip characters.
 *
 * **Algorithm Complexity:**
 * - **Best case**: O(n/m) - sublinear when pattern has no repeated characters
 * - **Average case**: O(n) - linear performance for most practical inputs
 * - **Worst case**: O(nm) - when pattern occurs frequently with many partial matches
 * - **Space**: O(m + σ) where σ is alphabet size for bad character table
 *
 * **How it works:**
 * 1. Precompute "bad character" table showing last occurrence of each character in pattern
 * 2. Compare pattern and text from right to left (key insight)
 * 3. On mismatch, use bad character table to determine safe skip distance
 * 4. Can skip multiple characters at once, achieving sublinear performance
 *
 * **Genomics Applications:**
 * - Restriction enzyme site finding (exact sequence matching)
 * - Primer sequence location in genomic DNA
 * - Exact motif searching in large genomic databases
 * - Quality control: finding exact contamination sequences
 *
 * **Performance Notes:**
 * - Excels with longer patterns (>10 bp) and larger alphabets
 * - Particularly effective for genomic searches due to 4-letter DNA alphabet
 * - Preprocessing cost amortized over multiple searches in same text
 *
 * @param text - Text to search in (genomic sequence)
 * @param pattern - Pattern to search for (motif, restriction site, etc.)
 * @returns Array of zero-based positions where pattern occurs
 *
 * @example Finding restriction enzyme sites
 * ```typescript
 * // Find EcoRI recognition sites (GAATTC) in genomic DNA
 * const dna = "ACGTGAATTCAGGAATTCTTG";
 * const ecoRISites = boyerMoore(dna, "GAATTC");
 * console.log(ecoRISites); // [4, 13] - positions of restriction sites
 * ```
 *
 * @example Primer location in genomic sequence
 * ```typescript
 * // Locate PCR primer binding sites
 * const genome = "ATCGATCGATCGATCG..."; // Large genomic sequence
 * const primer = "ATCGATCGATCG";
 * const sites = boyerMoore(genome, primer);
 * ```
 *
 * @see {@link https://epubs.siam.org/doi/10.1137/S0097539791195543} Boyer-Moore Complexity Analysis (SIAM Journal)
 * @see {@link https://dl.acm.org/doi/10.1145/359146.359148} Original Boyer-Moore Paper (ACM Communications)
 * @see {@link https://en.wikipedia.org/wiki/Boyer–Moore_string-search_algorithm} Boyer-Moore Algorithm (Wikipedia)
 *
 * 🔥 NATIVE CRITICAL: Core string search algorithm
 */
export function boyerMoore(text: string, pattern: string): number[] {
  // Tiger Style: Assert inputs
  if (!pattern || pattern.length === 0) return [];
  if (!text || pattern.length > text.length) return [];

  // Build bad character table for skip optimization
  const badChar = buildBadCharTable(pattern);
  const matches: number[] = [];

  let shift = 0;
  while (shift <= text.length - pattern.length) {
    let j = pattern.length - 1;

    // Match from right to left
    while (j >= 0 && pattern[j] === text[shift + j]) {
      j--;
    }

    if (j < 0) {
      // Pattern found at position shift
      matches.push(shift);

      // Calculate next shift
      if (shift + pattern.length < text.length) {
        const nextChar = text.charCodeAt(shift + pattern.length);
        const skip = badChar.get(nextChar) ?? -1;
        shift += pattern.length - skip;
      } else {
        shift += 1;
      }
    } else {
      // Mismatch found, calculate shift
      const mismatchChar = text.charCodeAt(shift + j);
      const skip = badChar.get(mismatchChar) ?? -1;
      shift += Math.max(1, j - skip);
    }
  }

  return matches;
}

/**
 * Fuzzy string matching with mismatch tolerance for genomic sequences
 *
 * Approximate string matching (fuzzy matching) allows finding patterns that are "close enough"
 * rather than requiring exact matches. This is essential in genomics where sequencing errors,
 * mutations, and biological variation create mismatches between expected and observed sequences.
 * The algorithm implements a sliding window approach with Hamming distance calculation.
 *
 * **Algorithm Complexity:**
 * - **Time**: O(n * m * k) where k is maxMismatches - examines each position
 * - **Space**: O(1) - constant space for mismatch counting
 * - **Early termination**: Stops counting when maxMismatches exceeded
 *
 * **Distance Metric:**
 * Uses Hamming distance (substitutions only) rather than full edit distance.
 * This is appropriate for genomic applications where indels and substitutions
 * are often analyzed separately.
 *
 * **Genomics Applications:**
 * - **Primer binding with mismatches**: Account for PCR primer degeneracy
 * - **SNP detection**: Find variants with known approximate positions
 * - **Sequencing error tolerance**: Match reads with sequencing artifacts
 * - **Cross-species analysis**: Find conserved motifs with species-specific variation
 * - **Diagnostic assays**: Detect pathogens allowing for genetic variation
 *
 * **Performance Considerations:**
 * - Naive O(nm) implementation chosen for simplicity and predictability
 * - More sophisticated algorithms (Myers, Bitap) available for complex applications
 * - Suitable for short patterns and small mismatch counts typical in genomics
 *
 * @param text - Text to search in (genomic sequence, read data)
 * @param pattern - Pattern to search for (primer, motif, variant)
 * @param maxMismatches - Maximum allowed mismatches (Hamming distance threshold)
 * @returns Array of pattern matches with mismatch counts and positions
 *
 * @example Primer binding with mismatches
 * ```typescript
 * // Allow 2 mismatches in primer binding (accounts for SNPs)
 * const dna = "ATCGATCGTTCGATCG";
 * const primer = "ATCGATCG";
 * const matches = fuzzyMatch(dna, primer, 2);
 * console.log(matches); // Shows positions and actual mismatch counts
 * ```
 *
 * @example Variant detection
 * ```typescript
 * // Find sequences similar to reference with up to 1 mutation
 * const reference = "ATCGATCG";
 * const sample = "ATCGATAG"; // C→A mutation
 * const variants = fuzzyMatch(sample, reference, 1);
 * ```
 *
 * @see {@link https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8274556/} Levenshtein Distance in Bioinformatics (PMC)
 * @see {@link https://en.wikipedia.org/wiki/Approximate_string_matching} Approximate String Matching (Wikipedia)
 * @see {@link https://medium.com/@m.nath/fuzzy-matching-algorithms-81914b1bc498} Fuzzy Matching Algorithms (Medium)
 *
 * 🔥 NATIVE CRITICAL: Approximate string matching
 */
export function fuzzyMatch<T extends string>(
  text: string,
  pattern: T,
  maxMismatches: number
): PatternMatch<T>[] {
  // Tiger Style: Assert inputs
  if (!pattern || pattern.length === 0) return [];
  if (!text || pattern.length > text.length) return [];
  if (maxMismatches < 0) {
    throw new Error("Max mismatches must be non-negative");
  }

  const matches: PatternMatch<T>[] = [];

  for (let i = 0; i <= text.length - pattern.length; i++) {
    let mismatches = 0;
    let j = 0;

    // Count mismatches at current position
    for (j = 0; j < pattern.length; j++) {
      if (text[i + j] !== pattern[j]) {
        mismatches++;
        if (mismatches > maxMismatches) break;
      }
    }

    // Record match if within mismatch threshold
    if (mismatches <= maxMismatches) {
      matches.push({
        position: i,
        length: pattern.length,
        mismatches,
        matched: text.substring(i, i + pattern.length),
        pattern: pattern,
      });
    }
  }

  return matches;
}

/**
 * Pattern matching with IUPAC ambiguity codes for degenerate DNA sequences
 *
 * Implements pattern matching that understands IUPAC nucleotide ambiguity codes, allowing
 * searches with degenerate bases. This is essential for biological pattern matching where
 * exact sequences may vary due to polymorphisms, degeneracy, or incomplete information.
 * The algorithm expands ambiguous bases to all possible combinations and checks for overlap.
 *
 * **IUPAC Ambiguity Codes Supported:**
 * - **R** = A or G (puRines)
 * - **Y** = C or T (pYrimidines)
 * - **S** = G or C (Strong bonds - 3 H-bonds)
 * - **W** = A or T (Weak bonds - 2 H-bonds)
 * - **K** = G or T (Keto groups)
 * - **M** = A or C (aMino groups)
 * - **B** = C, G, or T (not A)
 * - **D** = A, G, or T (not C)
 * - **H** = A, C, or T (not G)
 * - **V** = A, C, or G (not T)
 * - **N** = Any base (A, C, G, or T)
 *
 * **Algorithm Approach:**
 * 1. For each position, expand ambiguous bases to possible nucleotides
 * 2. Check if any combination from pattern matches any combination from sequence
 * 3. Uses set intersection to determine compatibility
 *
 * **Genomics Applications:**
 * - **Restriction enzyme recognition**: Many enzymes recognize degenerate sites
 * - **Primer design**: PCR primers often include degenerate positions
 * - **Consensus sequence matching**: Find matches to consensus motifs
 * - **SNP-tolerant searching**: Account for known polymorphisms
 * - **Cross-species analysis**: Handle species-specific sequence variation
 *
 * **Performance Notes:**
 * - Computational cost increases with number of ambiguous positions
 * - N bases (any nucleotide) always match, providing wildcards
 * - Case-insensitive matching for biological flexibility
 *
 * @param sequence - Sequence to search in (genomic DNA, RNA)
 * @param pattern - Pattern with IUPAC codes (motif, enzyme site, primer)
 * @returns Array of zero-based positions where pattern matches
 *
 * @example Restriction enzyme site with degeneracy
 * ```typescript
 * // BsaI recognition site: GGTCTC(N)1/(N)5
 * const dna = "ATGGTCTCAATCGATCG";
 * const bsaI = matchWithAmbiguous(dna, "GGTCTC");
 * console.log(bsaI); // [2] - finds BsaI site
 * ```
 *
 * @example Degenerate primer matching
 * ```typescript
 * // Universal 16S primer with degeneracies: 515F primer
 * const primer = "GTGYCAGCMGCCGCGGTAA"; // Y=C/T, M=A/C
 * const sequence = "GTGCCAGCAGCCGCGGTAA";
 * const matches = matchWithAmbiguous(sequence, primer);
 * ```
 *
 * @example SNP-tolerant motif search
 * ```typescript
 * // Search allowing for known SNP: R = A or G
 * const motif = "ATCRGATC"; // R allows A→G SNP
 * const variant = "ATCGGATC"; // Contains G variant
 * const found = matchWithAmbiguous(variant, motif);
 * ```
 *
 * @see {@link https://pmc.ncbi.nlm.nih.gov/articles/PMC2865858/} Extended IUPAC Nomenclature for Polymorphic Nucleic Acids (PMC)
 * @see {@link https://www.bioinformatics.org/sms/iupac.html} IUPAC Nucleotide Codes Reference
 * @see {@link https://genome.ucsc.edu/goldenPath/help/iupac.html} UCSC Genome Browser IUPAC Guide
 *
 * 🔥 NATIVE OPTIMIZATION: Degenerate base matching
 */
export function matchWithAmbiguous(sequence: string, pattern: string): number[] {
  // Tiger Style: Assert inputs
  if (!pattern || pattern.length === 0) return [];
  if (!sequence || pattern.length > sequence.length) return [];

  const matches: number[] = [];
  const patternUpper = pattern.toUpperCase();
  const sequenceUpper = sequence.toUpperCase();

  for (let i = 0; i <= sequenceUpper.length - patternUpper.length; i++) {
    let isMatch = true;

    for (let j = 0; j < patternUpper.length; j++) {
      const seqBase = sequenceUpper[i + j];
      const patBase = patternUpper[j];

      // N matches anything
      if (patBase === "N" || seqBase === "N") {
        continue;
      }

      // Check if bases are compatible considering ambiguity
      if (seqBase !== undefined && patBase !== undefined && !areBasesCompatible(seqBase, patBase)) {
        isMatch = false;
        break;
      }
    }

    if (isMatch) {
      matches.push(i);
    }
  }

  return matches;
}

/**
 * Knuth-Morris-Pratt (KMP) algorithm for linear-time pattern matching
 *
 * The KMP algorithm, developed by Donald Knuth, Vaughan Pratt, and James Morris in 1977,
 * was the first linear-time algorithm for string matching. It uses the key insight that
 * when a mismatch occurs, the pattern itself contains information about where the next
 * potential match could begin, eliminating the need to re-examine previously matched characters.
 *
 * **Algorithm Complexity:**
 * - **Time**: O(n + m) - guaranteed linear time regardless of input
 * - **Space**: O(m) - for the LPS (Longest Prefix Suffix) array
 * - **Preprocessing**: O(m) - to build the failure function
 * - **Searching**: O(n) - each character examined at most twice
 *
 * **Key Innovation - LPS Array:**
 * The "failure function" or LPS array stores the length of the longest proper prefix
 * of the pattern that is also a suffix. This enables intelligent skipping when mismatches occur.
 *
 * **When to use KMP vs Boyer-Moore:**
 * - **KMP advantages**: Guaranteed linear time, better for repetitive patterns
 * - **Boyer-Moore advantages**: Often faster in practice, sublinear performance possible
 * - **Genomics context**: KMP excels with tandem repeats, microsatellites, repetitive elements
 *
 * **Genomics Applications:**
 * - Tandem repeat detection (ATATATATAT patterns)
 * - Microsatellite analysis (repetitive motifs)
 * - Searching in highly repetitive genomic regions
 * - Finding patterns in low-complexity sequences
 *
 * **Real-world Example:**
 * Searching for Alu elements (repetitive DNA sequences) where KMP's guaranteed
 * linear time prevents worst-case performance on repetitive genomic content.
 *
 * @param text - Text to search in (genomic sequence)
 * @param pattern - Pattern to search for (repetitive motif, element, etc.)
 * @returns Array of zero-based positions where pattern occurs
 *
 * @example Finding tandem repeats
 * ```typescript
 * // Find CA dinucleotide repeats
 * const sequence = "ATGCACACACACAGGC";
 * const repeats = kmpSearch(sequence, "CACA");
 * console.log(repeats); // [3, 5, 7, 9] - overlapping CA repeats
 * ```
 *
 * @example Microsatellite detection
 * ```typescript
 * // Search for (GT)n microsatellites
 * const dna = "ACGTGTGTGTGTACG";
 * const microsats = kmpSearch(dna, "GTGT");
 * console.log(microsats); // Positions of GT repeats
 * ```
 *
 * @see {@link https://www.researchgate.net/publication/220975322_Knuth-Morris-Pratt_Algorithm_An_Analysis} KMP Algorithm Analysis (ResearchGate)
 * @see {@link https://en.wikipedia.org/wiki/Knuth–Morris–Pratt_algorithm} KMP Algorithm (Wikipedia)
 * @see {@link https://medium.com/pattern-searching-algorithm/knuth-morris-pratt-algorithm-74200dcc71fe} KMP Pattern Searching Guide (Medium)
 *
 * ⚡ NATIVE BENEFICIAL: Alternative to Boyer-Moore for specific patterns
 */
export function kmpSearch(text: string, pattern: string): number[] {
  // Tiger Style: Assert inputs
  if (!pattern || pattern.length === 0) return [];
  if (!text || pattern.length > text.length) return [];

  // Build failure function (partial match table)
  const lps = buildLPSArray(pattern);
  const matches: number[] = [];

  let i = 0; // Index for text
  let j = 0; // Index for pattern

  while (i < text.length) {
    if (pattern[j] === text[i]) {
      i++;
      j++;
    }

    if (j === pattern.length) {
      // Pattern found
      matches.push(i - j);
      const prev = lps[j - 1];
      j = prev !== undefined ? prev : 0;
    } else if (i < text.length && pattern[j] !== text[i]) {
      // Mismatch after j matches
      if (j !== 0) {
        const prev = lps[j - 1];
        j = prev !== undefined ? prev : 0;
      } else {
        i++;
      }
    }
  }

  return matches;
}

/**
 * Rabin-Karp rolling hash algorithm for efficient multiple pattern searching
 *
 * The Rabin-Karp algorithm, developed by Michael O. Rabin and Richard Karp in 1987,
 * uses rolling hash functions to achieve efficient string matching. The key innovation
 * is that hash values can be updated incrementally as the search window slides, avoiding
 * recomputation from scratch at each position. This makes it particularly effective
 * when searching for multiple patterns simultaneously.
 *
 * **Algorithm Complexity:**
 * - **Average case**: O(n + m) - linear time with good hash function
 * - **Worst case**: O(nm) - when many hash collisions occur
 * - **Space**: O(1) - constant space for hash computation
 * - **Rolling hash**: O(1) time to update hash for next position
 *
 * **Rolling Hash Technique:**
 * Uses polynomial rolling hash: hash = (hash * base + char) mod prime
 * To slide window: hash = (hash - oldChar * base^(m-1)) * base + newChar
 * Prime modulus reduces hash collisions and ensures uniform distribution.
 *
 * **Why Rabin-Karp for Genomics:**
 * - **Multiple pattern search**: Search for many restriction sites simultaneously
 * - **Database queries**: Efficient similarity searches in sequence databases
 * - **k-mer analysis**: Rolling hash enables efficient k-mer counting
 * - **Sequence comparison**: Fast initial screening before expensive alignment
 *
 * **Genomics Applications:**
 * - **BLAST-style database search**: Initial hash-based screening before alignment
 * - **k-mer indexing**: Building suffix arrays and FM-indexes for genomic databases
 * - **Contamination detection**: Screening reads against contaminant databases
 * - **Repetitive element detection**: Finding multiple copies of transposable elements
 * - **Phylogenetic analysis**: Rapid sequence similarity estimation
 *
 * **Implementation Notes:**
 * - Uses prime = 101 for good distribution with DNA sequences
 * - Hash collisions verified by character-by-character comparison
 * - Optimized for genomic alphabet (A, C, G, T) characteristics
 *
 * @param text - Text to search in (genomic sequence, database)
 * @param pattern - Pattern to search for (motif, k-mer, restriction site)
 * @param prime - Prime modulus for hash function (default: 101, optimized for DNA)
 * @returns Array of zero-based positions where pattern occurs
 *
 * @example Multiple restriction enzyme search
 * ```typescript
 * // Search for multiple restriction sites in genomic DNA
 * const dna = "ATCGAATTCGGATCCAGAATTC";
 * const ecoRI = rabinKarp(dna, "GAATTC");  // EcoRI sites
 * const bamHI = rabinKarp(dna, "GGATCC");  // BamHI sites
 * console.log("EcoRI sites:", ecoRI); // [4, 17]
 * console.log("BamHI sites:", bamHI); // [10]
 * ```
 *
 * @example k-mer frequency analysis
 * ```typescript
 * // Count 6-mer frequencies using rolling hash approach
 * const sequence = "ATCGATCGATCGATCG";
 * const kmers = ["ATCGAT", "TCGATC", "CGATCG"];
 * kmers.forEach(kmer => {
 *   const positions = rabinKarp(sequence, kmer);
 *   console.log(`${kmer}: ${positions.length} occurrences`);
 * });
 * ```
 *
 * @see {@link https://medium.com/analytics-vidhya/matching-genetic-sequences-through-the-blast-and-karp-rabin-algorithm-ffebc810a9d0} Genetic Sequence Matching with Rabin-Karp (Medium)
 * @see {@link https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9477578/} Pattern Matching in DNA Sequencing (PMC)
 * @see {@link https://en.wikipedia.org/wiki/Rabin–Karp_algorithm} Rabin-Karp Algorithm (Wikipedia)
 *
 * ⚡ NATIVE BENEFICIAL: Good for searching multiple patterns
 */
export function rabinKarp(text: string, pattern: string, prime: number = 101): number[] {
  // Tiger Style: Assert inputs
  if (!pattern || pattern.length === 0) return [];
  if (!text || pattern.length > text.length) return [];

  const matches: number[] = [];
  const patternLength = pattern.length;
  const textLength = text.length;

  // Calculate hash value for pattern and first window
  let patternHash = 0;
  let textHash = 0;
  let h = 1;

  // Calculate h = pow(256, patternLength - 1) % prime
  for (let i = 0; i < patternLength - 1; i++) {
    h = (h * 256) % prime;
  }

  // Calculate initial hash values
  for (let i = 0; i < patternLength; i++) {
    patternHash = (256 * patternHash + pattern.charCodeAt(i)) % prime;
    textHash = (256 * textHash + text.charCodeAt(i)) % prime;
  }

  // Slide pattern over text
  for (let i = 0; i <= textLength - patternLength; i++) {
    // Check if hash values match
    if (patternHash === textHash) {
      // Verify character by character
      let match = true;
      for (let j = 0; j < patternLength; j++) {
        if (text[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        matches.push(i);
      }
    }

    // Calculate hash for next window
    if (i < textLength - patternLength) {
      textHash =
        (256 * (textHash - text.charCodeAt(i) * h) + text.charCodeAt(i + patternLength)) % prime;

      // Handle negative hash value
      if (textHash < 0) {
        textHash += prime;
      }
    }
  }

  return matches;
}

/**
 * Find all overlapping pattern matches for tandem repeat and microsatellite detection
 *
 * Unlike standard pattern matching algorithms that skip past found matches, this function
 * finds every occurrence including overlapping matches. This is essential for detecting
 * tandem repeats, microsatellites, and other repetitive genomic elements where overlapping
 * instances provide biological insight into repeat structure and evolution.
 *
 * **Algorithm Approach:**
 * - Slides search window by only 1 position after each match
 * - Finds all possible overlapping occurrences of the pattern
 * - Simple O(nm) sliding window with overlap detection
 *
 * **Why Overlapping Matches Matter in Genomics:**
 * - **Tandem repeats**: ATATATATATAT contains overlapping ATA patterns
 * - **Microsatellites**: (CA)n repeats show overlapping CA patterns
 * - **Repeat unit detection**: Determines minimal repeat unit length
 * - **Structural analysis**: Overlaps reveal repeat organization
 *
 * **Genomics Applications:**
 * - **Microsatellite analysis**: STR (Short Tandem Repeat) characterization
 * - **Tandem repeat detection**: Finding repetitive genomic elements
 * - **Repeat unit determination**: Identifying minimal repeating sequences
 * - **Trinucleotide repeat disorders**: CAG, CGG repeat expansion diseases
 * - **Centromere analysis**: Alpha satellite repeat characterization
 * - **Ribosomal RNA analysis**: Internal repeat structure detection
 *
 * **Clinical Relevance:**
 * Many genetic diseases are caused by tandem repeat expansions:
 * - Huntington's disease: CAG repeats in HTT gene
 * - Fragile X syndrome: CGG repeats in FMR1 gene
 * - Myotonic dystrophy: CTG repeats in DMPK gene
 *
 * @param text - Text to search in (genomic sequence)
 * @param pattern - Repeat unit pattern to find (dinucleotide, trinucleotide, etc.)
 * @returns Array of all positions where pattern occurs (including overlaps)
 *
 * @example Microsatellite analysis
 * ```typescript
 * // Find all CA dinucleotide repeats (including overlaps)
 * const sequence = "ATCACACACACACAGTC";
 * const caRepeats = findOverlapping(sequence, "CA");
 * console.log(caRepeats); // [2, 4, 6, 8, 10, 12] - overlapping CA patterns
 * ```
 *
 * @example Trinucleotide repeat detection
 * ```typescript
 * // Detect CAG repeats (Huntington's disease)
 * const huntingtin = "ATGCAGCAGCAGCAGCAGCTG";
 * const cagRepeats = findOverlapping(huntingtin, "CAG");
 * console.log(`CAG repeat count: ${cagRepeats.length}`);
 * ```
 *
 * @example Minimal repeat unit identification
 * ```typescript
 * // Compare different repeat unit sizes to find minimal unit
 * const tandem = "ATATATATATATATAT";
 * const at = findOverlapping(tandem, "AT");
 * const atat = findOverlapping(tandem, "ATAT");
 * // AT shows more overlaps, confirming AT as minimal unit
 * ```
 *
 * @see {@link https://www.ncbi.nlm.nih.gov/books/NBK1116/} Tandem Repeats in Human Genome (NCBI)
 * @see {@link https://en.wikipedia.org/wiki/Tandem_repeat} Tandem Repeat Overview (Wikipedia)
 * @see {@link https://www.nature.com/articles/s41576-019-0122-z} Tandem Repeats in Disease (Nature Reviews Genetics)
 */
export function findOverlapping(text: string, pattern: string): number[] {
  // Tiger Style: Assert inputs
  if (!pattern || pattern.length === 0) return [];
  if (!text || pattern.length > text.length) return [];

  const matches: number[] = [];
  let pos = 0;

  while (pos <= text.length - pattern.length) {
    if (text.substring(pos, pos + pattern.length) === pattern) {
      matches.push(pos);
      pos++; // Move by 1 to find overlapping matches
    } else {
      pos++;
    }
  }

  return matches;
}

/**
 * Find longest common substring between two genomic sequences using dynamic programming
 *
 * The longest common substring problem is a classic dynamic programming challenge that finds
 * the longest contiguous sequence that appears in both input sequences. In genomics, this
 * is valuable for identifying conserved regions, sequence homology, and evolutionary
 * relationships. The algorithm builds a 2D matrix to track substring lengths.
 *
 * **Algorithm Details:**
 * - **Approach**: Dynamic programming with O(mn) matrix
 * - **Time Complexity**: O(mn) where m, n are sequence lengths
 * - **Space Complexity**: O(mn) for the DP matrix
 * - **Optimization potential**: Space can be reduced to O(min(m,n))
 *
 * **Dynamic Programming Recurrence:**
 * ```
 * if seq1[i] == seq2[j]:
 *   dp[i][j] = dp[i-1][j-1] + 1
 * else:
 *   dp[i][j] = 0
 * ```
 * Track maximum value and position for longest substring.
 *
 * **Genomics Applications:**
 * - **Homology detection**: Find conserved regions between species
 * - **Gene family analysis**: Identify common domains in related genes
 * - **Sequence alignment preprocessing**: Initial similarity assessment
 * - **Duplication detection**: Find large duplicated genomic segments
 * - **Synteny analysis**: Compare genomic organization between species
 * - **Phylogenetic analysis**: Quantify sequence similarity for tree construction
 *
 * **Biological Context:**
 * - **Conserved domains**: Functional protein/DNA regions maintained across evolution
 * - **Ortholog identification**: Find corresponding genes in different species
 * - **Paralog analysis**: Detect gene duplications within same genome
 * - **Regulatory conservation**: Identify conserved non-coding elements
 *
 * **Performance Considerations:**
 * - Matrix-based approach suitable for moderate-length sequences
 * - For very long sequences, consider suffix tree approaches
 * - Memory usage scales quadratically with sequence length
 *
 * @param seq1 - First sequence (reference genome, gene, etc.)
 * @param seq2 - Second sequence (query genome, homolog, etc.)
 * @returns Object containing longest common substring with positions in both sequences
 *
 * @example Gene homology analysis
 * ```typescript
 * // Find conserved region between human and mouse genes
 * const humanGene = "ATGCGATCGATCGAATTCGTACG";
 * const mouseGene = "TTGCGATCGATCGAATTCGCTAG";
 * const homology = longestCommonSubstring(humanGene, mouseGene);
 * console.log(`Conserved region: ${homology.substring} (${homology.length} bp)`);
 * ```
 *
 * @example Duplication detection
 * ```typescript
 * // Identify duplicated segments in genomic sequence
 * const genome1 = "ATCGATCGATCGAATTC";
 * const genome2 = "GGCGATCGATCGAATTTACG";
 * const dup = longestCommonSubstring(genome1, genome2);
 * if (dup.length > 10) {
 *   console.log(`Large duplication found: ${dup.substring}`);
 * }
 * ```
 *
 * @see {@link https://en.wikipedia.org/wiki/Longest_common_substring_problem} Longest Common Substring (Wikipedia)
 * @see {@link https://www.ncbi.nlm.nih.gov/books/NBK62051/} Sequence Homology and Similarity (NCBI)
 * @see {@link https://academic.oup.com/bioinformatics/article/35/9/1556/5160341} Genomic Homology Detection Methods (Bioinformatics)
 *
 * ⚡ NATIVE BENEFICIAL: Matrix operations could be optimized
 */
export function longestCommonSubstring(
  seq1: string,
  seq2: string
): {
  substring: string;
  position1: number;
  position2: number;
  length: number;
} {
  // Tiger Style: Assert inputs
  if (!seq1 || !seq2) {
    return { substring: "", position1: -1, position2: -1, length: 0 };
  }

  const m = seq1.length;
  const n = seq2.length;
  let maxLength = 0;
  let endPos1 = 0;

  // Create DP table
  const dp: number[][] = new Array(m + 1).fill(null).map(() => new Array(n + 1).fill(0));

  // Fill DP table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (seq1[i - 1] === seq2[j - 1]) {
        const prevRow = dp[i - 1];
        const prevValue = prevRow ? (prevRow[j - 1] ?? 0) : 0;
        const currentRow = dp[i];
        if (currentRow) {
          currentRow[j] = prevValue + 1;
          const currentValue = currentRow[j];
          if (currentValue !== undefined && currentValue > maxLength) {
            maxLength = currentValue;
            endPos1 = i;
          }
        }
      }
    }
  }

  // Extract the longest common substring
  const substring = seq1.substring(endPos1 - maxLength, endPos1);

  return {
    substring,
    position1: endPos1 - maxLength,
    position2: seq2.indexOf(substring),
    length: maxLength,
  };
}

/**
 * Find palindromic DNA sequences for restriction site and structural feature detection
 *
 * Palindromic sequences read the same forwards and backwards and are fundamental to many
 * biological processes. Most restriction enzymes recognize palindromic sequences, and
 * palindromes form important secondary structures in DNA and RNA. This algorithm uses
 * a sliding window approach to detect palindromes of various lengths.
 *
 * **Biological Significance of Palindromes:**
 * - **Restriction enzyme sites**: Most Type II enzymes recognize palindromic sequences
 * - **Protein binding sites**: Many transcription factors bind palindromic motifs
 * - **DNA secondary structure**: Palindromes can form hairpin loops and cruciforms
 * - **Regulatory elements**: Palindromic sequences often function as regulatory motifs
 * - **Evolution markers**: Palindrome distribution indicates evolutionary processes
 *
 * **Algorithm Complexity:**
 * - **Time**: O(n * L²) where L is average palindrome length
 * - **Space**: O(n) for storing results
 * - **Optimization**: Early termination when palindrome property violated
 *
 * **Common Restriction Enzyme Palindromes:**
 * - **EcoRI**: GAATTC (6 bp palindrome)
 * - **BamHI**: GGATCC (6 bp palindrome)
 * - **HindIII**: AAGCTT (6 bp palindrome)
 * - **PstI**: CTGCAG (6 bp palindrome)
 * - **NotI**: GCGGCCGC (8 bp palindrome)
 *
 * **Applications in Molecular Biology:**
 * - **Cloning strategy**: Identify restriction sites for vector construction
 * - **Genome assembly**: Palindromes can cause assembly difficulties
 * - **Regulatory analysis**: Find palindromic transcription factor binding sites
 * - **DNA damage**: Palindromes are hotspots for certain types of mutations
 * - **PCR design**: Avoid palindromic regions that can form secondary structures
 *
 * @param sequence - Sequence to search in (genomic DNA, plasmid, etc.)
 * @param minLength - Minimum palindrome length (default: 4, typical for short motifs)
 * @param maxLength - Maximum palindrome length (optional, prevents excessive computation)
 * @returns Array of palindrome matches with position and sequence information
 *
 * @example Restriction enzyme site detection
 * ```typescript
 * // Find potential restriction enzyme sites (palindromes 4-8 bp)
 * const plasmid = "ATCGAATTCGGATCCAGCTT";
 * const sites = findPalindromes(plasmid, 4, 8);
 * sites.forEach(site => {
 *   console.log(`Palindrome: ${site.matched} at position ${site.position}`);
 * });
 * // Output: GAATTC at position 4, GGATCC at position 10
 * ```
 *
 * @example Regulatory motif discovery
 * ```typescript
 * // Find palindromic transcription factor binding sites
 * const promoter = "ATGCAAATTTGCATCCG";
 * const tfbs = findPalindromes(promoter, 6, 12);
 * // May find palindromic sequences that could bind transcription factors
 * ```
 *
 * @example DNA structural analysis
 * ```typescript
 * // Identify sequences that could form secondary structures
 * const dna = "ATGCGCATCGATCGCGCATG";
 * const structures = findPalindromes(dna, 8, 16);
 * // Longer palindromes more likely to form stable secondary structures
 * ```
 *
 * @see {@link https://www.nature.com/articles/nature07226} Palindromes and Genome Instability (Nature)
 * @see {@link https://www.ncbi.nlm.nih.gov/books/NBK26822/} Restriction Enzymes (NCBI)
 * @see {@link https://en.wikipedia.org/wiki/Palindromic_sequence} Palindromic Sequences in Biology (Wikipedia)
 */
export function findPalindromes(
  sequence: string,
  minLength: number = 4,
  maxLength?: number
): PatternMatch[] {
  // Tiger Style: Assert inputs
  if (!sequence || sequence.length < minLength) return [];

  const palindromes: PatternMatch[] = [];
  const maxLen = maxLength ?? sequence.length;

  // Check all possible substrings
  for (let length = minLength; length <= Math.min(maxLen, sequence.length); length++) {
    for (let i = 0; i <= sequence.length - length; i++) {
      const substring = sequence.substring(i, i + length);

      if (isPalindrome(substring)) {
        palindromes.push({
          position: i,
          length,
          mismatches: 0,
          matched: substring,
          pattern: substring, // Palindromes match themselves
        });
      }
    }
  }

  return palindromes;
}

/**
 * Find tandem repeats for microsatellite and STR (Short Tandem Repeat) detection
 *
 * Tandem repeats are sequences where a short motif is repeated consecutively multiple times.
 * They are abundant in genomes and have important biological functions including gene regulation,
 * chromatin structure, and disease susceptibility. This algorithm systematically searches for
 * repeat units of various sizes and identifies regions with multiple consecutive copies.
 *
 * **Types of Tandem Repeats:**
 * - **Mononucleotide**: A, T, C, G repeats (homopolymers)
 * - **Dinucleotide**: AT, CA, GC repeats (most common microsatellites)
 * - **Trinucleotide**: CAG, CGG, CTG repeats (disease-associated)
 * - **Tetranucleotide**: GATA, AAAG repeats (forensic markers)
 * - **Pentanucleotide**: AATAT repeats (complex STRs)
 * - **Hexanucleotide**: GGGGCC repeats (ALS/FTD-associated)
 *
 * **Algorithm Strategy:**
 * 1. Try all possible repeat unit sizes (1-6 bp by default)
 * 2. For each position, extract potential repeat unit
 * 3. Count consecutive occurrences of the unit
 * 4. Record repeats meeting minimum threshold
 * 5. Skip past identified repeat regions to avoid overlaps
 *
 * **Clinical and Research Significance:**
 * - **Genetic diseases**: Repeat expansions cause >40 inherited disorders
 * - **Forensic genetics**: STR markers used for human identification
 * - **Population genetics**: Microsatellite diversity for population studies
 * - **Genome evolution**: Repeat dynamics drive genomic instability
 * - **Biomarkers**: STR instability indicates mismatch repair defects
 *
 * **Disease Examples:**
 * - **Huntington's**: CAG expansion in HTT gene (>36 repeats pathogenic)
 * - **Fragile X**: CGG expansion in FMR1 gene (>200 repeats cause disease)
 * - **ALS/FTD**: GGGGCC expansion in C9orf72 gene
 * - **Myotonic dystrophy**: CTG expansion in DMPK gene
 *
 * @param sequence - Sequence to search in (genomic DNA, gene region)
 * @param minRepeatUnit - Minimum repeat unit size (1 = mononucleotide, 2 = dinucleotide)
 * @param maxRepeatUnit - Maximum repeat unit size (6 captures most biologically relevant STRs)
 * @param minRepeats - Minimum number of repeats (2 = minimum for tandem classification)
 * @returns Array of tandem repeat objects with unit, position, and repeat count
 *
 * @example Microsatellite detection
 * ```typescript
 * // Find CA dinucleotide repeats (common microsatellites)
 * const dna = "ATGCACACACACACAGTC";
 * const microsats = findTandemRepeats(dna, 2, 2, 3); // Only dinucleotides, ≥3 repeats
 * console.log(microsats); // [{unit: "CA", repeats: 6, position: 3, totalLength: 12}]
 * ```
 *
 * @example Disease-associated repeat screening
 * ```typescript
 * // Screen for pathogenic CAG repeat expansions
 * const huntingtin = "ATGCAGCAGCAGCAGCAGCAGCAGCAGCAG";
 * const cagRepeats = findTandemRepeats(huntingtin, 3, 3, 5); // Trinucleotides, ≥5 repeats
 * cagRepeats.forEach(repeat => {
 *   if (repeat.unit === "CAG" && repeat.repeats > 36) {
 *     console.log(`Pathogenic CAG expansion: ${repeat.repeats} repeats`);
 *   }
 * });
 * ```
 *
 * @example Forensic STR analysis
 * ```typescript
 * // Analyze tetranucleotide STR markers for forensics
 * const evidence = "GATAGATAGATAGATAGATA";
 * const strs = findTandemRepeats(evidence, 4, 4, 3); // GATA repeats
 * console.log(`GATA STR: ${strs[0]?.repeats} repeats`); // Forensic marker data
 * ```
 *
 * @see {@link https://www.nature.com/articles/s41588-019-0358-1} Tandem Repeats in Human Disease (Nature Genetics)
 * @see {@link https://www.ncbi.nlm.nih.gov/books/NBK1116/} Short Tandem Repeat Sequences (NCBI)
 * @see {@link https://en.wikipedia.org/wiki/Microsatellite} Microsatellites and STRs (Wikipedia)
 */
export function findTandemRepeats(
  sequence: string,
  minRepeatUnit: number = 1,
  maxRepeatUnit: number = 6,
  minRepeats: number = 2
): Array<{
  position: number;
  unit: string;
  repeats: number;
  totalLength: number;
}> {
  // Tiger Style: Assert inputs
  if (!sequence || sequence.length < minRepeatUnit * minRepeats) return [];

  const repeats: Array<{
    position: number;
    unit: string;
    repeats: number;
    totalLength: number;
  }> = [];

  // Try different repeat unit sizes
  for (let unitSize = minRepeatUnit; unitSize <= maxRepeatUnit; unitSize++) {
    for (let i = 0; i <= sequence.length - unitSize * minRepeats; i++) {
      const unit = sequence.substring(i, i + unitSize);
      let repeatCount = 1;
      let j = i + unitSize;

      // Count consecutive repeats
      while (j + unitSize <= sequence.length) {
        const nextUnit = sequence.substring(j, j + unitSize);
        if (nextUnit === unit) {
          repeatCount++;
          j += unitSize;
        } else {
          break;
        }
      }

      // Record if meets minimum repeat threshold
      if (repeatCount >= minRepeats) {
        repeats.push({
          position: i,
          unit,
          repeats: repeatCount,
          totalLength: unitSize * repeatCount,
        });

        // Skip past this repeat region
        i = j - 1;
      }
    }
  }

  return repeats;
}

// =============================================================================
// HIGH-LEVEL SEQUENCE MATCHER CLASS
// =============================================================================

/**
 * High-performance pattern matcher for genomic sequences.
 *
 * Provides streaming-first pattern matching with support for multiple algorithms,
 * IUPAC ambiguity codes, and fuzzy matching. Designed for both small scripts
 * and production bioinformatics pipelines.
 *
 * @class SequenceMatcher
 * @since v0.1.0
 *
 * @example
 * ```typescript
 * // Simple exact matching
 * const matcher = new SequenceMatcher('ATCG');
 * for await (const match of matcher.findAll(sequences)) {
 *   console.log(`Found ${match.pattern} at position ${match.position}`);
 * }
 *
 * // Fuzzy matching allowing 2 mismatches
 * const fuzzy = new SequenceMatcher('ATCGATCG', {
 *   algorithm: 'fuzzy',
 *   maxMismatches: 2
 * });
 * ```
 */
export class SequenceMatcher {
  private readonly pattern: string;
  private readonly options: Required<MatcherOptions>;
  private readonly patternUpper: string;
  private readonly badCharTable?: Map<number, number>;
  private readonly expandedPatterns?: string[];

  constructor(pattern: string, options: MatcherOptions = {}) {
    if (!pattern || pattern.length === 0) {
      throw new Error("Pattern cannot be empty");
    }

    this.pattern = pattern;
    this.options = {
      algorithm: options.algorithm ?? "boyer-moore",
      maxMismatches: options.maxMismatches ?? 0,
      iupacAware: options.iupacAware ?? false,
      caseSensitive: options.caseSensitive ?? true,
      contextWindow: options.contextWindow ?? 50,
      bufferSize: options.bufferSize ?? 1_000_000, // 1MB default buffer
    };

    this.patternUpper = this.options.caseSensitive ? pattern : pattern.toUpperCase();

    // Pre-build Boyer-Moore table if using that algorithm
    if (this.options.algorithm === "boyer-moore") {
      this.badCharTable = buildBadCharTable(this.patternUpper);
    }

    // Pre-expand IUPAC patterns if needed
    if (this.options.iupacAware && /[RYSWKMBDHVN]/i.test(pattern)) {
      this.expandedPatterns = this.expandIUPACPattern(pattern);
    }
  }

  /**
   * Find all matches in a stream of sequences.
   *
   * @param sequences - Async iterable of sequences to search
   * @yields {SequenceMatch} Match objects as they are found
   */
  async *findAll(sequences: AsyncIterable<AbstractSequence>): AsyncGenerator<SequenceMatch> {
    for await (const sequence of sequences) {
      const matches = this.findInSequence(sequence);
      for (const match of matches) {
        yield match;
      }
    }
  }

  /**
   * Find all matches in a single sequence.
   *
   * @param sequence - Sequence object or raw sequence string to search
   * @returns Array of all matches found in the sequence
   */
  findInSequence(sequence: AbstractSequence | string): SequenceMatch[] {
    const isSequenceObject = typeof sequence === "object";
    const seq = isSequenceObject ? sequence.sequence : sequence;
    const seqId = isSequenceObject ? sequence.id : "unknown";

    const text = this.options.caseSensitive ? seq : seq.toUpperCase();
    const originalText = this.options.caseSensitive ? undefined : seq;

    // Handle IUPAC ambiguity codes
    if (this.options.iupacAware && this.expandedPatterns) {
      return this.findWithIUPAC(text, seqId, originalText);
    }

    // Choose algorithm
    switch (this.options.algorithm) {
      case "fuzzy":
        return this.fuzzyMatchInternal(text, seqId, originalText);
      case "kmp":
        return this.kmpMatchInternal(text, seqId, originalText);
      case "regex":
        return this.regexMatch(text, seqId, originalText);
      default:
        // Default to boyer-moore for best performance
        return this.boyerMooreMatchInternal(text, seqId, originalText);
    }
  }

  /**
   * Find only the first match in a sequence.
   *
   * @param sequence - Sequence to search
   * @returns First match found, or null if no matches
   */
  findFirst(sequence: AbstractSequence | string): SequenceMatch | null {
    const matches = this.findInSequence(sequence);
    if (matches.length > 0) {
      const firstMatch = matches[0];
      // TypeScript should infer this is defined, but we'll be explicit
      return firstMatch !== undefined ? firstMatch : null;
    }
    return null;
  }

  /**
   * Test if pattern exists in sequence.
   *
   * @param sequence - Sequence to test
   * @returns True if pattern exists in sequence
   */
  test(sequence: AbstractSequence | string): boolean {
    return this.findFirst(sequence) !== null;
  }

  /**
   * Count pattern occurrences without creating match objects.
   *
   * @param sequence - Sequence to count matches in
   * @returns Number of pattern occurrences
   */
  count(sequence: AbstractSequence | string): number {
    const text = typeof sequence === "object" ? sequence.sequence : sequence;
    const searchText = this.options.caseSensitive ? text : text.toUpperCase();

    // Fast counting without building match objects
    const positions = this.getBoyerMoorePositions(searchText);
    return positions.length;
  }

  /**
   * Stream matches from chunked sequence data.
   *
   * @param sequenceStream - Async iterable yielding sequence chunks
   * @yields {SequenceMatch} Matches with globally adjusted positions
   */
  async *streamMatches(sequenceStream: AsyncIterable<string>): AsyncGenerator<SequenceMatch> {
    let buffer = "";
    let position = 0;

    for await (const chunk of sequenceStream) {
      buffer += chunk;

      // Keep buffer size manageable
      while (buffer.length > this.options.bufferSize) {
        const searchLength = this.options.bufferSize - this.pattern.length;
        const searchBuffer = buffer.substring(0, searchLength);

        // Find matches in this portion
        const matches = this.findInString(searchBuffer, position, "stream");
        for (const match of matches) {
          yield match;
        }

        // Slide the window
        buffer = buffer.substring(searchLength);
        position += searchLength;
      }
    }

    // Process remaining buffer
    if (buffer.length > 0) {
      const matches = this.findInString(buffer, position, "stream");
      for (const match of matches) {
        yield match;
      }
    }
  }

  // Private implementation methods

  private boyerMooreMatchInternal(
    text: string,
    sequenceId: string,
    originalText?: string
  ): SequenceMatch[] {
    const positions = this.getBoyerMoorePositions(text);
    const textForMatch = originalText ?? text;
    return positions.map((pos) => this.createMatch(textForMatch, pos, sequenceId, 0));
  }

  private getBoyerMoorePositions(text: string): number[] {
    const matches: number[] = [];
    const pattern = this.patternUpper;

    if (!this.badCharTable || pattern.length > text.length) {
      return matches;
    }

    let shift = 0;
    while (shift <= text.length - pattern.length) {
      let j = pattern.length - 1;

      while (j >= 0 && pattern[j] === text[shift + j]) {
        j--;
      }

      if (j < 0) {
        matches.push(shift);
        shift += 1; // For overlapping matches
      } else {
        const mismatchChar = text.charCodeAt(shift + j);
        const skip = this.badCharTable.get(mismatchChar) ?? -1;
        shift += Math.max(1, j - skip);
      }
    }

    return matches;
  }

  private kmpMatchInternal(
    text: string,
    sequenceId: string,
    originalText?: string
  ): SequenceMatch[] {
    const matches: SequenceMatch[] = [];
    const pattern = this.patternUpper;
    const lps = buildLPSArray(pattern);
    const textForMatch = originalText ?? text;

    let i = 0;
    let j = 0;

    while (i < text.length) {
      if (pattern[j] === text[i]) {
        i++;
        j++;
      }

      if (j === pattern.length) {
        matches.push(this.createMatch(textForMatch, i - j, sequenceId, 0));
        const prev = lps[j - 1];
        j = prev !== undefined ? prev : 0;
      } else if (i < text.length && pattern[j] !== text[i]) {
        if (j !== 0) {
          const prev = lps[j - 1];
          j = prev !== undefined ? prev : 0;
        } else {
          i++;
        }
      }
    }

    return matches;
  }

  private fuzzyMatchInternal(
    text: string,
    sequenceId: string,
    originalText?: string
  ): SequenceMatch[] {
    const matches: SequenceMatch[] = [];
    const pattern = this.patternUpper;
    const maxMismatches = this.options.maxMismatches;
    const textForMatch = originalText ?? text;

    for (let i = 0; i <= text.length - pattern.length; i++) {
      let mismatches = 0;

      for (let j = 0; j < pattern.length; j++) {
        if (text[i + j] !== pattern[j]) {
          mismatches++;
          if (mismatches > maxMismatches) break;
        }
      }

      if (mismatches <= maxMismatches) {
        matches.push(this.createMatch(textForMatch, i, sequenceId, mismatches));
      }
    }

    return matches;
  }

  private regexMatch(text: string, sequenceId: string, originalText?: string): SequenceMatch[] {
    const matches: SequenceMatch[] = [];
    const textForMatch = originalText ?? text;

    try {
      const regex = new RegExp(this.pattern, this.options.caseSensitive ? "g" : "gi");

      let match: RegExpExecArray | null = regex.exec(text);
      while (match !== null) {
        matches.push(this.createMatch(textForMatch, match.index, sequenceId, 0, match[0]));
        match = regex.exec(text);
      }
    } catch (error) {
      throw new Error(`Invalid regex pattern '${this.pattern}': ${error}"`);
    }

    return matches;
  }

  private findWithIUPAC(text: string, sequenceId: string, originalText?: string): SequenceMatch[] {
    const matches: SequenceMatch[] = [];
    const textForMatch = originalText ?? text;

    for (let i = 0; i <= text.length - this.pattern.length; i++) {
      const substring = text.substring(i, i + this.pattern.length);

      if (this.matchesIUPAC(substring, this.patternUpper)) {
        matches.push(this.createMatch(textForMatch, i, sequenceId, 0));
      }
    }

    return matches;
  }

  private matchesIUPAC(text: string, pattern: string): boolean {
    if (text.length !== pattern.length) return false;

    for (let i = 0; i < text.length; i++) {
      const textBase = text[i];
      const patternBase = pattern[i];

      // N matches anything
      if (patternBase === "N" || textBase === "N") continue;

      // Check if bases are compatible
      const patternExpanded =
        patternBase !== undefined && patternBase !== null && patternBase !== ""
          ? expandAmbiguous(patternBase)
          : [];
      const textExpanded =
        textBase !== undefined && textBase !== null && textBase !== ""
          ? expandAmbiguous(textBase)
          : [];

      // Check for overlap
      const hasOverlap = patternExpanded.some((p) => textExpanded.includes(p));
      if (!hasOverlap) return false;
    }

    return true;
  }

  private findInString(text: string, globalPosition: number, sequenceId: string): SequenceMatch[] {
    const searchText = this.options.caseSensitive ? text : text.toUpperCase();
    const originalText = this.options.caseSensitive ? undefined : text;
    const localMatches = this.boyerMooreMatchInternal(searchText, sequenceId, originalText);

    // Adjust positions to global coordinates
    return localMatches.map((match) => ({
      ...match,
      position: match.position + globalPosition,
      context: {
        ...match.context,
        contextStart: match.context.contextStart + globalPosition,
        contextEnd: match.context.contextEnd + globalPosition,
      },
    }));
  }

  private createMatch(
    text: string,
    position: number,
    sequenceId: string,
    mismatches: number,
    matchedText?: string
  ): SequenceMatch {
    const matched = matchedText ?? text.substring(position, position + this.pattern.length);
    const contextWindow = this.options.contextWindow;

    // Extract context
    const beforeStart = Math.max(0, position - contextWindow);
    const beforeEnd = position;
    const afterStart = position + matched.length;
    const afterEnd = Math.min(text.length, afterStart + contextWindow);

    return {
      position,
      length: matched.length,
      matched,
      pattern: this.pattern,
      mismatches,
      sequenceId,
      context: {
        before: text.substring(beforeStart, beforeEnd),
        after: text.substring(afterStart, afterEnd),
        contextStart: beforeStart,
        contextEnd: afterEnd,
      },
      score: mismatches === 0 ? 1.0 : 1.0 - mismatches / matched.length,
    };
  }

  private expandIUPACPattern(pattern: string): string[] {
    // For now, return single pattern
    // Full implementation would expand all ambiguous positions
    return [pattern];
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Find all occurrences of a pattern in a sequence.
 *
 * @param pattern - Pattern to search for
 * @param sequence - Sequence to search in
 * @param options - Optional matching configuration
 * @returns Array of all matches found
 *
 * @since v0.1.0
 */
export function findPattern(
  pattern: string,
  sequence: AbstractSequence | string,
  options?: MatcherOptions
): SequenceMatch[] {
  const matcher = new SequenceMatcher(pattern, options);
  return matcher.findInSequence(sequence);
}

/**
 * Check if a pattern exists in a sequence.
 *
 * @param pattern - Pattern to search for
 * @param sequence - Sequence to search in
 * @param options - Optional matching configuration
 * @returns True if pattern exists in sequence
 *
 * @since v0.1.0
 */
export function hasPattern(
  pattern: string,
  sequence: AbstractSequence | string,
  options?: MatcherOptions
): boolean {
  const matcher = new SequenceMatcher(pattern, options);
  return matcher.test(sequence);
}

/**
 * Check if pattern matches with up to maxMismatches, including reverse complement
 *
 * Optimized for grep-style boolean matching (no position information needed)
 *
 * @param sequence - Text to search in
 * @param pattern - Pattern to search for
 * @param maxMismatches - Maximum allowed mismatches
 * @param searchBothStrands - Whether to check reverse complement
 * @returns True if pattern matches within mismatch threshold
 */
export function hasPatternWithMismatches(
  sequence: string,
  pattern: string,
  maxMismatches: number,
  searchBothStrands: boolean = false
): boolean {
  // Check forward strand
  const forwardMatches = fuzzyMatch(sequence, pattern, maxMismatches);
  if (forwardMatches.length > 0) {
    return true;
  }

  // Check reverse complement if requested
  if (searchBothStrands) {
    const patternRC = reverseComplement(pattern);
    const reverseMatches = fuzzyMatch(sequence, patternRC, maxMismatches);
    if (reverseMatches.length > 0) {
      return true;
    }
  }

  return false;
}

// =============================================================================
// ADDITIONAL PATTERN UTILITIES (moved from transforms.ts)
// =============================================================================

/**
 * Test if a DNA sequence is palindromic (equals its reverse complement)
 *
 * In molecular biology, a palindromic sequence is a DNA sequence that reads the same
 * on both strands when read in the 5' to 3' direction. This is different from
 * linguistic palindromes - biological palindromes compare a sequence to its reverse
 * complement, reflecting the antiparallel nature of double-stranded DNA.
 *
 * **Biological Palindromes vs Linguistic Palindromes:**
 * - **Linguistic**: "RACECAR" reads same forwards/backwards
 * - **Biological**: "GAATTC" = reverse complement "GAATTC" (both strands 5'→3')
 * - **Double-strand structure**: Reflects DNA's antiparallel double helix
 *
 * **Why Biological Palindromes Matter:**
 * - **Restriction enzymes**: Most Type II enzymes recognize palindromic sequences
 * - **Protein binding**: Many DNA-binding proteins recognize palindromic sites
 * - **DNA structure**: Palindromes can form cruciform structures under supercoiling
 * - **Replication origins**: Some origins of replication contain palindromic elements
 * - **Regulatory elements**: Palindromic sequences often have regulatory functions
 *
 * **Algorithm Approach:**
 * 1. Calculate reverse complement of input sequence
 * 2. Compare original sequence to reverse complement (case-insensitive)
 * 3. Return true if they match exactly
 *
 * **Common Palindromic Recognition Sites:**
 * - **EcoRI**: 5'-GAATTC-3' / 3'-CTTAAG-5' (6-cutter)
 * - **BamHI**: 5'-GGATCC-3' / 3'-CCTAGG-5' (6-cutter)
 * - **HindIII**: 5'-AAGCTT-3' / 3'-TTCGAA-5' (6-cutter)
 * - **PstI**: 5'-CTGCAG-3' / 3'-GACGTC-5' (6-cutter)
 * - **SmaI**: 5'-CCCGGG-3' / 3'-GGGCCC-5' (blunt-end cutter)
 *
 * **Applications in Molecular Biology:**
 * - **Restriction mapping**: Predict where enzymes will cut DNA
 * - **Cloning design**: Choose compatible enzymes for vector construction
 * - **Site-directed mutagenesis**: Design palindromic oligonucleotides
 * - **Regulatory analysis**: Identify potential transcription factor binding sites
 * - **Structural prediction**: Palindromes may form secondary structures
 *
 * @param sequence - DNA sequence to test (restriction site, motif, etc.)
 * @returns True if sequence equals its reverse complement
 *
 * @example Restriction enzyme site validation
 * ```typescript
 * // Verify that common restriction sites are palindromic
 * console.log(isPalindromic("GAATTC")); // true - EcoRI site
 * console.log(isPalindromic("GGATCC")); // true - BamHI site
 * console.log(isPalindromic("ATCGAT")); // false - not palindromic
 * ```
 *
 * @example Transcription factor binding site analysis
 * ```typescript
 * // Check if potential TFBS is palindromic (common for homodimers)
 * const tfbs = "TGACTCA"; // AP-1 binding site
 * if (isPalindromic(tfbs)) {
 *   console.log("Palindromic TFBS - likely homodimer binding");
 * }
 * ```
 *
 * @example Oligonucleotide design validation
 * ```typescript
 * // Verify PCR primers don't contain palindromic regions (avoid secondary structure)
 * const primer = "ATCGATCGATCG";
 * if (isPalindromic(primer)) {
 *   console.warn("Primer contains palindrome - may form hairpin structure");
 * }
 * ```
 *
 * @see {@link https://www.ncbi.nlm.nih.gov/books/NBK26822/} Molecular Biology of Restriction Enzymes (NCBI)
 * @see {@link https://en.wikipedia.org/wiki/Palindromic_sequence} Palindromic Sequences in Biology (Wikipedia)
 * @see {@link https://www.nature.com/articles/nrg1655} DNA-Protein Interactions and Palindromic Recognition (Nature Reviews)
 *
 * 🔥 NATIVE: Vectorized comparison could speed up palindrome checking
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
 * Simple pattern finding with overlapping matches
 *
 * This is a simpler version than the full SequenceMatcher,
 * useful for basic pattern finding needs.
 *
 * @example
 * ```typescript
 * const positions = findSimplePattern('ATATA', 'ATA');
 * console.log(positions); // [0, 2] (overlapping matches)
 * ```
 *
 * @param sequence - Sequence to search in
 * @param pattern - Pattern to find
 * @returns Array of zero-based positions where pattern occurs
 */
export function findSimplePattern(sequence: string, pattern: string): number[] {
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
 * Find pattern matches with mismatch tolerance, returning position information
 *
 * Enhances the boolean hasPatternWithMismatches to return detailed match positions.
 * Essential for amplicon detection where primer locations are needed.
 * Automatically handles IUPAC degenerate bases when present in pattern.
 *
 * @param sequence - Text to search in
 * @param pattern - Pattern to search for (supports IUPAC codes)
 * @param maxMismatches - Maximum allowed mismatches
 * @param searchBothStrands - Whether to check reverse complement
 * @returns Array of pattern matches with position and mismatch information
 *
 * @example
 * ```typescript
 * // Exact nucleotides
 * const exact = findPatternWithMismatches('ATCGATCGTT', 'ATCG', 1);
 *
 * // IUPAC degenerate bases (handled automatically)
 * const degenerate = findPatternWithMismatches('ATCGATCGTT', 'ATCR', 0); // R = A|G
 * ```
 *
 * @since v0.1.0
 */
export function findPatternWithMismatches<T extends string>(
  sequence: string,
  pattern: T,
  maxMismatches: number,
  searchBothStrands: boolean = false
): PatternMatch<T>[] {
  // Tiger Style: Assert inputs
  if (!sequence || typeof sequence !== "string") {
    throw new Error("Sequence must be a non-empty string");
  }
  if (!pattern || typeof pattern !== "string") {
    throw new Error("Pattern must be a non-empty string");
  }
  if (maxMismatches < 0) {
    throw new Error("Max mismatches must be non-negative");
  }

  // Auto-detect IUPAC degenerate bases for biological accuracy
  const hasDegenerate = /[RYSWKMBDHVN]/i.test(pattern);

  if (hasDegenerate) {
    // Use IUPAC-aware matching for biological accuracy
    return findWithIUPACMatching(sequence, pattern, maxMismatches, searchBothStrands);
  } else {
    // Fast path for exact nucleotides
    return findWithExactMatching(sequence, pattern, maxMismatches, searchBothStrands);
  }
}

// =============================================================================
// LEGACY COMPATIBILITY EXPORT
// =============================================================================

/**
 * @deprecated Use individual function exports instead
 * Grouped object for backwards compatibility
 */
export const PatternMatcher = {
  boyerMoore,
  fuzzyMatch,
  matchWithAmbiguous,
  kmpSearch,
  rabinKarp,
  findOverlapping,
  longestCommonSubstring,
  findPalindromes,
  findTandemRepeats,
  isPalindromic,
  findSimplePattern,
} as const;

// =============================================================================
// PRIVATE HELPER FUNCTIONS
// =============================================================================

function buildBadCharTable(pattern: string): Map<number, number> {
  const table = new Map<number, number>();

  for (let i = 0; i < pattern.length - 1; i++) {
    table.set(pattern.charCodeAt(i), i);
  }

  return table;
}

function areBasesCompatible(base1: string, base2: string): boolean {
  // Exact match
  if (base1 === base2) return true;

  // Expand ambiguous bases and check for overlap
  const expanded1 = expandAmbiguous(base1);
  const expanded2 = expandAmbiguous(base2);

  // Check if there's any overlap in possible bases
  return expanded1.some((b1) => expanded2.includes(b1));
}

function buildLPSArray(pattern: string): number[] {
  const lps = new Array(pattern.length).fill(0);
  let len = 0;
  let i = 1;

  while (i < pattern.length) {
    if (pattern[i] === pattern[len]) {
      len++;
      lps[i] = len;
      i++;
    } else {
      if (len !== 0) {
        len = lps[len - 1];
      } else {
        lps[i] = 0;
        i++;
      }
    }
  }

  return lps;
}

function isPalindrome(sequence: string): boolean {
  const len = sequence.length;
  for (let i = 0; i < len / 2; i++) {
    if (sequence[i] !== sequence[len - 1 - i]) {
      return false;
    }
  }
  return true;
}

function findWithIUPACMatching<T extends string>(
  sequence: string,
  pattern: T,
  maxMismatches: number,
  searchBothStrands: boolean
): PatternMatch<T>[] {
  const allMatches: PatternMatch<T>[] = [];

  // Forward strand IUPAC matching
  allMatches.push(...findIUPACPositions(sequence, pattern, maxMismatches));

  // Reverse strand IUPAC matching
  if (searchBothStrands) {
    const patternRC = reverseComplement(pattern);
    const reverseMatches = findIUPACPositions(sequence, patternRC, maxMismatches);
    // Map back to original pattern type for consistency
    const typedReverseMatches = reverseMatches.map((match) => ({
      ...match,
      pattern: pattern, // Keep original pattern type
    }));
    allMatches.push(...typedReverseMatches);
  }

  return allMatches.sort((a, b) => a.position - b.position);
}

function findWithExactMatching<T extends string>(
  sequence: string,
  pattern: T,
  maxMismatches: number,
  searchBothStrands: boolean
): PatternMatch<T>[] {
  const allMatches: PatternMatch<T>[] = [];

  // Forward strand exact matching
  const forwardMatches = fuzzyMatch(sequence, pattern, maxMismatches);
  allMatches.push(...forwardMatches);

  // Reverse strand exact matching
  if (searchBothStrands) {
    const patternRC = reverseComplement(pattern);
    const reverseMatches = fuzzyMatch(sequence, patternRC, maxMismatches);
    // Map back to original pattern type for consistency
    const typedReverseMatches = reverseMatches.map((match) => ({
      ...match,
      pattern: pattern, // Keep original pattern type
    }));
    allMatches.push(...typedReverseMatches);
  }

  return allMatches.sort((a, b) => a.position - b.position);
}

function findIUPACPositions<T extends string>(
  sequence: string,
  pattern: T,
  maxMismatches: number
): PatternMatch<T>[] {
  const matches: PatternMatch<T>[] = [];

  for (let i = 0; i <= sequence.length - pattern.length; i++) {
    const substring = sequence.substring(i, i + pattern.length);
    const mismatchCount = countIUPACMismatches(substring, pattern);

    if (mismatchCount <= maxMismatches) {
      matches.push({
        position: i,
        length: pattern.length,
        mismatches: mismatchCount,
        matched: substring,
        pattern: pattern,
      });
    }
  }

  return matches;
}

function countIUPACMismatches(text: string, pattern: string): number {
  if (text.length !== pattern.length) return Infinity;

  let mismatches = 0;
  for (let i = 0; i < text.length; i++) {
    const textBase = text[i];
    const patternBase = pattern[i];

    // TypeScript safety - ensure characters exist
    if (!textBase || !patternBase) continue;

    // N matches anything
    if (patternBase === "N" || textBase === "N") continue;

    // Check IUPAC compatibility using existing infrastructure
    const patternExpanded = expandAmbiguous(patternBase);
    const textExpanded = expandAmbiguous(textBase);

    // Check for overlap - if no overlap, it's a mismatch
    const hasOverlap = patternExpanded.some((p) => textExpanded.includes(p));
    if (!hasOverlap) {
      mismatches++;
    }
  }

  return mismatches;
}
