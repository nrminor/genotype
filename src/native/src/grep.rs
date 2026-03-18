//! Grep kernel: SIMD-accelerated pattern matching for genomic sequences.
//!
//! This module provides the core search logic used by the `grep_batch` and
//! `find_pattern_batch` napi functions. It wraps sassy's `Searcher` to
//! support exact matching (k=0), approximate matching with edit distance
//! (k>0), case-insensitive search, and reverse complement search.
//!
//! Two search modes are provided:
//!
//! - `contains_match`: answers "does this sequence contain the pattern?"
//!   Uses `.without_trace()` for maximum throughput since only a boolean
//!   is needed.
//!
//! - `find_matches`: answers "where does this pattern match, and how well?"
//!   Returns `(start, end, cost)` tuples. Uses traceback to compute exact
//!   alignment start positions, which `.without_trace()` would discard.
//!   Always uses the `Iupac` profile (forward-only) since the amplicon
//!   use case involves primers with IUPAC degenerate bases.
//!
//! Forward-only searches use the `Ascii` profile (case-sensitive by default,
//! with manual uppercasing for case-insensitive mode). Both-strand searches
//! use the `Iupac` profile, which handles ambiguous bases (N, R, Y, etc.)
//! correctly and is inherently case-insensitive.
//!
//! The `SearchContext` enum is designed to be created once per batch and
//! reused across all sequences, avoiding per-sequence allocation of sassy's
//! internal SIMD buffers and DP matrices.

use sassy::{
    profiles::{Ascii, Iupac, Profile},
    Searcher,
};
use smallvec::SmallVec;

pub(crate) type MatchTriple = (u32, u32, u32);
pub(crate) type PerSeqMatches = SmallVec<[MatchTriple; 4]>;

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
    /// Create a context for boolean "does it match?" searches (`contains_match`).
    ///
    /// The searcher is created with `.without_trace()` for maximum throughput
    /// since only a boolean result is needed.
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

    /// Create a context for position-returning searches (`find_matches`).
    ///
    /// Uses the `Iupac` profile (forward-only) with traceback enabled so
    /// that sassy computes exact `text_start` positions. The Iupac profile
    /// is inherently case-insensitive and handles degenerate bases (N, R,
    /// Y, etc.), which is required for primer matching.
    ///
    /// The `case_insensitive` parameter is accepted for API consistency
    /// with the grep kernel but has no effect: the Iupac profile already
    /// handles case folding internally.
    pub(crate) fn new_with_positions(
        pattern: &[u8],
        max_edits: u32,
        case_insensitive: bool,
    ) -> Self {
        let _ = case_insensitive;
        Self::Iupac {
            searcher: Box::new(Searcher::<Iupac>::new_fwd()),
            pattern: pattern.to_vec(),
            max_edits: max_edits as usize,
            seq_buf: Vec::new(),
            needs_uppercase: false,
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
            } => Self::search_bool(
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
            } => Self::search_bool(
                searcher,
                pattern,
                *max_edits,
                seq_buf,
                *needs_uppercase,
                seq,
            ),
        }
    }

    /// Find all matches of the pattern in `seq` within the configured edit
    /// distance. Returns `(text_start, text_end, cost)` tuples.
    ///
    /// The context must have been created with `new_with_positions` so that
    /// traceback is enabled and `text_start` is computed. If called on a
    /// `without_trace` context, `text_start` values will be `usize::MAX`
    /// (sassy's sentinel for "not computed").
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    pub(crate) fn find_matches(&mut self, seq: &[u8]) -> PerSeqMatches {
        match self {
            Self::Ascii {
                searcher,
                pattern,
                max_edits,
                seq_buf,
                needs_uppercase,
            } => Self::search_positions(
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
            } => Self::search_positions(
                searcher,
                pattern,
                *max_edits,
                seq_buf,
                *needs_uppercase,
                seq,
            ),
        }
    }

    fn prepare_haystack<'a>(
        seq: &'a [u8],
        seq_buf: &'a mut Vec<u8>,
        needs_uppercase: bool,
    ) -> &'a [u8] {
        if needs_uppercase {
            seq_buf.clear();
            seq_buf.extend(seq.iter().map(u8::to_ascii_uppercase));
            seq_buf.as_slice()
        } else {
            seq
        }
    }

    fn search_bool<P: Profile>(
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
        let haystack = Self::prepare_haystack(seq, seq_buf, needs_uppercase);
        !searcher.search(pattern, haystack, max_edits).is_empty()
    }

    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    fn search_positions<P: Profile>(
        searcher: &mut Searcher<P>,
        pattern: &[u8],
        max_edits: usize,
        seq_buf: &mut Vec<u8>,
        needs_uppercase: bool,
        seq: &[u8],
    ) -> PerSeqMatches {
        if seq.is_empty() || pattern.is_empty() || pattern.len() > seq.len() {
            return PerSeqMatches::new();
        }
        let haystack = Self::prepare_haystack(seq, seq_buf, needs_uppercase);
        searcher
            .search(pattern, haystack, max_edits)
            .into_iter()
            .map(|m| (m.text_start as u32, m.text_end as u32, m.cost as u32))
            .collect()
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

    fn find(seq: &[u8], pattern: &[u8], max_edits: u32) -> PerSeqMatches {
        let mut ctx = SearchContext::new_with_positions(pattern, max_edits, false);
        ctx.find_matches(seq)
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

    #[test]
    fn find_exact_match_position() {
        // GATC at position 3 in ATCGATCG
        let matches = find(b"ATCGATCG", b"GATC", 0);
        assert_eq!(matches.len(), 1, "expected exactly one match");
        let (start, end, cost) = matches[0];
        assert_eq!(start, 3, "match should start at position 3");
        assert_eq!(end, 7, "match should end at position 7 (exclusive)");
        assert_eq!(cost, 0, "exact match should have cost 0");
    }

    #[test]
    fn find_exact_match_at_start() {
        let matches = find(b"GATCAAAA", b"GATC", 0);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0], (0, 4, 0));
    }

    #[test]
    fn find_exact_match_at_end() {
        let matches = find(b"AAAAGATC", b"GATC", 0);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0], (4, 8, 0));
    }

    #[test]
    fn find_no_match_returns_empty() {
        let matches = find(b"TTTTTTTT", b"GATC", 0);
        assert!(matches.is_empty());
    }

    #[test]
    fn find_approximate_match_with_cost() {
        // GTTC is 1 edit from GATC (substitution at position 1)
        let matches = find(b"AAAAGTTCAAAA", b"GATC", 1);
        assert!(!matches.is_empty(), "should find approximate match");
        let (start, end, cost) = matches[0];
        assert_eq!(start, 4);
        assert_eq!(end, 8);
        assert_eq!(cost, 1);
    }

    #[test]
    fn find_no_match_when_edits_exceed_threshold() {
        let matches = find(b"TTTTTTTT", b"GATC", 1);
        assert!(matches.is_empty());
    }

    #[test]
    fn find_empty_sequence_returns_empty() {
        let matches = find(b"", b"GATC", 0);
        assert!(matches.is_empty());
    }

    #[test]
    fn find_empty_pattern_returns_empty() {
        let matches = find(b"ATCG", b"", 0);
        assert!(matches.is_empty());
    }

    #[test]
    fn find_pattern_longer_than_sequence_returns_empty() {
        let matches = find(b"AT", b"ATCGATCG", 0);
        assert!(matches.is_empty());
    }

    #[test]
    fn find_iupac_degenerate_pattern() {
        // N in pattern matches any base; NATC should match GATC, AATC, etc.
        let matches = find(b"AAAAGATCAAAA", b"NATC", 0);
        assert!(!matches.is_empty(), "IUPAC N should match any base");
        let (start, end, cost) = matches[0];
        assert_eq!(start, 4);
        assert_eq!(end, 8);
        assert_eq!(cost, 0, "IUPAC match should have cost 0");
    }

    #[test]
    fn find_case_insensitive_via_iupac() {
        // Iupac profile is inherently case-insensitive
        let matches = find(b"aaaagatcaaaa", b"GATC", 0);
        assert!(
            !matches.is_empty(),
            "Iupac profile should match case-insensitively"
        );
        assert_eq!(matches[0].2, 0);
    }

    #[test]
    fn find_full_sequence_match() {
        let matches = find(b"GATC", b"GATC", 0);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0], (0, 4, 0));
    }

    #[test]
    fn find_n_in_sequence_matches_any_pattern_base() {
        // N means "unknown base" — the Iupac profile correctly treats it
        // as matching any pattern base with cost 0. This means a region
        // of N's will produce matches wherever the sliding window fits.
        let mut seq = b"ATCGATCGATCGATCG".to_vec();
        seq.extend(std::iter::repeat_n(b'N', 84));
        let matches = find(&seq, b"ATCGATCGATCGATCG", 0);
        assert!(
            matches.len() > 1,
            "N region should produce multiple matches, got {}",
            matches.len()
        );
        assert_eq!(
            matches[0],
            (0, 16, 0),
            "first match should be the exact primer at position 0"
        );
    }

    #[test]
    fn find_context_reuse_across_sequences() {
        let mut ctx = SearchContext::new_with_positions(b"GATC", 0, false);

        let m1 = ctx.find_matches(b"AAAAGATCAAAA");
        assert_eq!(m1.len(), 1, "first sequence should have one match");
        assert_eq!(m1[0], (4, 8, 0));

        let m2 = ctx.find_matches(b"TTTTTTTT");
        assert!(m2.is_empty(), "second sequence should have no matches");

        let m3 = ctx.find_matches(b"GATCTTTTGATC");
        assert!(
            m3.len() >= 2,
            "third sequence should have at least two matches"
        );
    }

    #[test]
    fn find_multiple_matches_in_sequence() {
        // Two occurrences of GATC
        let matches = find(b"GATCTTTTGATC", b"GATC", 0);
        assert!(
            matches.len() >= 2,
            "expected at least 2 matches, got {}",
            matches.len()
        );
        // Verify both positions are present (order may vary)
        let starts: Vec<u32> = matches.iter().map(|m| m.0).collect();
        assert!(starts.contains(&0), "should find match at position 0");
        assert!(starts.contains(&8), "should find match at position 8");
    }
}
