//! Grep kernel: SIMD-accelerated pattern matching for genomic sequences.
//!
//! This module provides the core search logic used by the `grep_batch` napi
//! function. It wraps sassy's `Searcher` to support exact matching (k=0),
//! approximate matching with edit distance (k>0), case-insensitive search,
//! and reverse complement search. The public interface is a single function
//! that answers "does this sequence contain the pattern?" — no match
//! positions or CIGAR strings are returned.
//!
//! Forward-only searches use the `Ascii` profile (case-sensitive by default,
//! with manual uppercasing for case-insensitive mode). Both-strand searches
//! use the `Iupac` profile, which handles ambiguous bases (N, R, Y, etc.)
//! correctly and is inherently case-insensitive.
//!
//! The `SearchContext` enum is designed to be created once per batch and
//! reused across all sequences, avoiding per-sequence allocation of sassy's
//! internal SIMD buffers and DP matrices.

use sassy::profiles::{Ascii, Iupac, Profile};
use sassy::Searcher;

/// How the kernel should match the pattern against sequences.
///
/// This enum makes invalid flag combinations unrepresentable. The napi
/// boundary converts the JS-friendly `(case_insensitive, search_both_strands)`
/// booleans into this enum immediately.
pub(crate) enum SearchMode {
    /// Case-sensitive forward search using the Ascii profile.
    Forward,
    /// Case-insensitive forward search. Both pattern and sequence are
    /// uppercased before matching via the Ascii profile.
    ForwardCaseInsensitive,
    /// Forward + reverse complement search using the Iupac profile.
    /// Iupac is inherently case-insensitive and handles ambiguous bases
    /// (N, R, Y, etc.) correctly, so no manual case folding is needed.
    BothStrands,
    /// Forward + reverse complement with explicit case-insensitive
    /// request. Functionally identical to `BothStrands` since the Iupac
    /// profile is already case-insensitive, but kept as a distinct variant
    /// so the enum remains a faithful representation of the input flags.
    BothStrandsCaseInsensitive,
}

impl SearchMode {
    pub(crate) fn from_flags(case_insensitive: bool, search_both_strands: bool) -> Self {
        match (case_insensitive, search_both_strands) {
            (false, false) => Self::Forward,
            (true, false) => Self::ForwardCaseInsensitive,
            (false, true) => Self::BothStrands,
            (true, true) => Self::BothStrandsCaseInsensitive,
        }
    }

    fn needs_uppercase(&self) -> bool {
        // Only the Ascii profile requires manual case folding. The Iupac
        // profile used for BothStrands modes is inherently case-insensitive
        // (it strips the case bit via `& 0x1F` during encoding).
        matches!(self, Self::ForwardCaseInsensitive)
    }
}

/// Pre-built searcher and reusable buffers for a batch of searches.
///
/// Sassy's `Searcher` caches internal DP matrices and SIMD buffers, so
/// reusing one across sequences avoids repeated allocation. The `seq_buf`
/// field provides a reusable `Vec<u8>` for uppercasing sequences in the
/// `ForwardCaseInsensitive` mode (the only mode that needs manual case
/// folding). The Iupac profile handles case natively.
pub(crate) enum SearchContext {
    Ascii {
        searcher: Box<Searcher<Ascii>>,
        pattern: Vec<u8>,
        max_edits: usize,
        seq_buf: Vec<u8>,
        needs_uppercase: bool,
    },
    Iupac {
        searcher: Box<Searcher<Iupac>>,
        pattern: Vec<u8>,
        max_edits: usize,
        seq_buf: Vec<u8>,
        needs_uppercase: bool,
    },
}

impl SearchContext {
    pub(crate) fn new(pattern: &[u8], max_edits: u32, mode: &SearchMode) -> Self {
        let k = max_edits as usize;
        let uppercase = mode.needs_uppercase();
        let prepared_pattern: Vec<u8> = if uppercase {
            pattern.iter().map(u8::to_ascii_uppercase).collect()
        } else {
            pattern.to_vec()
        };

        match mode {
            SearchMode::Forward | SearchMode::ForwardCaseInsensitive => Self::Ascii {
                searcher: Box::new(Searcher::<Ascii>::new_fwd().without_trace()),
                pattern: prepared_pattern,
                max_edits: k,
                seq_buf: Vec::new(),
                needs_uppercase: uppercase,
            },
            SearchMode::BothStrands | SearchMode::BothStrandsCaseInsensitive => Self::Iupac {
                searcher: Box::new(Searcher::<Iupac>::new_rc().without_trace()),
                pattern: prepared_pattern,
                max_edits: k,
                seq_buf: Vec::new(),
                needs_uppercase: uppercase,
            },
        }
    }

    /// Check whether `seq` contains the pattern within the configured edit
    /// distance. The searcher and any reusable buffers are mutated in place
    /// to avoid per-call allocation.
    pub(crate) fn contains_match(&mut self, seq: &[u8]) -> bool {
        if seq.is_empty() {
            return false;
        }
        match self {
            Self::Ascii {
                searcher,
                pattern,
                max_edits,
                seq_buf,
                needs_uppercase,
            } => Self::search_with(
                searcher,
                pattern,
                *max_edits,
                seq_buf,
                *needs_uppercase,
                seq,
            ),
            Self::Iupac {
                searcher,
                pattern,
                max_edits,
                seq_buf,
                needs_uppercase,
            } => Self::search_with(
                searcher,
                pattern,
                *max_edits,
                seq_buf,
                *needs_uppercase,
                seq,
            ),
        }
    }

    fn search_with<P: Profile>(
        searcher: &mut Searcher<P>,
        pattern: &[u8],
        max_edits: usize,
        seq_buf: &mut Vec<u8>,
        needs_uppercase: bool,
        seq: &[u8],
    ) -> bool {
        if pattern.is_empty() || pattern.len() > seq.len() {
            return false;
        }
        let haystack = if needs_uppercase {
            seq_buf.clear();
            seq_buf.extend(seq.iter().map(u8::to_ascii_uppercase));
            seq_buf.as_slice()
        } else {
            seq
        };
        !searcher.search(pattern, haystack, max_edits).is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn search(
        seq: &[u8],
        pattern: &[u8],
        max_edits: u32,
        case_insensitive: bool,
        search_both_strands: bool,
    ) -> bool {
        let mode = SearchMode::from_flags(case_insensitive, search_both_strands);
        let mut ctx = SearchContext::new(pattern, max_edits, &mode);
        ctx.contains_match(seq)
    }

    #[test]
    fn exact_match_present() {
        assert!(search(b"ATCGATCG", b"GATC", 0, false, false));
    }

    #[test]
    fn exact_match_absent() {
        assert!(!search(b"ATCGATCG", b"GGGG", 0, false, false));
    }

    #[test]
    fn exact_match_full_sequence() {
        assert!(search(b"ATCG", b"ATCG", 0, false, false));
    }

    #[test]
    fn approximate_match_one_edit() {
        // GATC vs GTTC: one substitution
        assert!(search(b"ATCGTTCG", b"GATC", 1, false, false));
    }

    #[test]
    fn approximate_match_too_many_edits() {
        // GATC vs TTTT: 3+ edits needed, only 1 allowed
        assert!(!search(b"TTTTTTTT", b"GATC", 1, false, false));
    }

    #[test]
    fn approximate_threshold_boundary() {
        // GTTC is 1 edit from GATC: fails at k=0, passes at k=1
        assert!(!search(b"ATCGTTCG", b"GATC", 0, false, false));
        assert!(search(b"ATCGTTCG", b"GATC", 1, false, false));
    }

    #[test]
    fn case_insensitive_match() {
        assert!(search(b"atcgatcg", b"GATC", 0, true, false));
    }

    #[test]
    fn case_insensitive_both_lowercase() {
        assert!(search(b"atcgatcg", b"gatc", 0, true, false));
    }

    #[test]
    fn case_sensitive_no_match() {
        assert!(!search(b"atcgatcg", b"GATC", 0, false, false));
    }

    #[test]
    fn reverse_complement_match() {
        // RC of ATCG is CGAT
        assert!(search(b"CGATAAAA", b"ATCG", 0, false, true));
    }

    #[test]
    fn reverse_complement_no_match() {
        assert!(!search(b"TTTTTTTT", b"ATCG", 0, false, true));
    }

    #[test]
    fn reverse_complement_also_matches_forward_strand() {
        assert!(search(b"ATCGAAAA", b"ATCG", 0, false, true));
    }

    #[test]
    fn both_strands_case_insensitive() {
        // RC of ATCG is CGAT; lowercase input should be uppercased by kernel
        assert!(search(b"cgataaaa", b"atcg", 0, true, true));
    }

    #[test]
    fn both_strands_case_insensitive_forward_hit() {
        assert!(search(b"atcgaaaa", b"atcg", 0, true, true));
    }

    #[test]
    fn empty_pattern_returns_false() {
        assert!(!search(b"ATCG", b"", 0, false, false));
    }

    #[test]
    fn empty_sequence_returns_false() {
        assert!(!search(b"", b"ATCG", 0, false, false));
    }

    #[test]
    fn pattern_longer_than_sequence() {
        assert!(!search(b"AT", b"ATCGATCG", 0, false, false));
    }

    #[test]
    fn pattern_longer_than_sequence_even_with_edits() {
        assert!(!search(b"AT", b"ATCG", 10, false, false));
    }

    #[test]
    fn approximate_with_reverse_complement() {
        // RC of ATCG is CGAT; CGTT is 1 edit from CGAT
        assert!(search(b"CGTTAAAA", b"ATCG", 1, false, true));
    }

    #[test]
    fn case_insensitive_approximate() {
        // lowercase "gttc" is 1 edit from uppercase "GATC" when case-folded
        assert!(search(b"xxxgttcxxx", b"GATC", 1, true, false));
    }

    #[test]
    fn both_strands_handles_ambiguous_bases() {
        // Iupac profile treats N as matching any base, and doesn't panic
        // on non-ACGT characters (unlike the Dna profile).
        assert!(search(b"CGATNNNN", b"ATCG", 0, false, true));
        // N in the pattern matches any base in the sequence:
        assert!(search(b"CGATAAAA", b"NTCG", 0, false, true));
    }

    #[test]
    fn context_reuse_across_sequences() {
        let mode = SearchMode::from_flags(true, false);
        let mut ctx = SearchContext::new(b"GATC", 0, &mode);
        assert!(ctx.contains_match(b"atcgatcg"));
        assert!(!ctx.contains_match(b"tttttttt"));
        assert!(ctx.contains_match(b"xxgatcxx"));
    }
}
