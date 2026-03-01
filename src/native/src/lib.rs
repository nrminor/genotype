//! Native performance layer for genotype bioinformatics library.
//!
//! This crate provides SIMD-accelerated genomic data processing functions
//! exposed to TypeScript via napi-rs. The #[napi] functions in this file
//! are thin wrappers around pure-Rust kernel modules (grep.rs, etc.) that
//! contain no napi dependencies and are independently testable.

#![allow(clippy::must_use_candidate)]

mod grep;

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Search a batch of sequences for a pattern within a given edit distance.
///
/// Returns a `Buffer` of length `num_sequences` where each byte is 1 if the
/// corresponding sequence contains the pattern, 0 otherwise.
///
/// All slice parameters are zero-copy borrows from JavaScript `Buffer` and
/// `TypedArray` values for the duration of this synchronous call.
///
/// # Offset contract
///
/// `offsets` must be a monotonically non-decreasing `Uint32Array` of length
/// `num_sequences + 1`, where `offsets[last] <= sequences.len()`. Violations
/// throw a JavaScript `Error`.
///
/// # Errors
///
/// Returns a napi error (thrown as a JS `Error`) if the offset array is
/// malformed. This has zero overhead on the happy path.
// `#[must_use]` has no meaning across the napi FFI boundary — JS callers
// never see Rust attributes — so the clippy lint is inapplicable here.
#[napi]
pub fn grep_batch(
    sequences: &[u8],
    offsets: &[u32],
    pattern: &[u8],
    max_edits: u32,
    case_insensitive: bool,
    search_both_strands: bool,
) -> napi::Result<Buffer> {
    utils::validate_offsets(offsets, sequences.len())?;

    let num_sequences = offsets.len().saturating_sub(1);
    let mut results = vec![0u8; num_sequences];

    let mode = grep::SearchMode::from_flags(case_insensitive, search_both_strands);
    let mut ctx = grep::SearchContext::new(pattern, max_edits, &mode);

    for (i, window) in offsets.windows(2).enumerate() {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let seq = &sequences[start..end];
        results[i] = u8::from(ctx.contains_match(seq));
    }

    Ok(results.into())
}

mod utils {

    /// Validate that `offsets` is a well-formed batch layout for `sequences`.
    ///
    /// A valid offset array is monotonically non-decreasing, and its final
    /// element does not exceed `sequences.len()`.
    pub(super) fn validate_offsets(offsets: &[u32], sequences_len: usize) -> napi::Result<()> {
        if let Some(&last) = offsets.last() {
            if last as usize > sequences_len {
                return Err(napi::Error::from_reason(format!(
                    "grep_batch: final offset ({last}) exceeds sequences length ({sequences_len})"
                )));
            }
        }
        for window in offsets.windows(2) {
            if window[0] > window[1] {
                return Err(napi::Error::from_reason(format!(
                    "grep_batch: non-monotonic offsets ({}..{})",
                    window[0], window[1]
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[allow(clippy::cast_possible_truncation)]
    fn make_batch(seqs: &[&[u8]]) -> (Vec<u8>, Vec<u32>) {
        let mut data = Vec::new();
        let mut offsets = Vec::with_capacity(seqs.len() + 1);
        for seq in seqs {
            offsets.push(data.len() as u32);
            data.extend_from_slice(seq);
        }
        offsets.push(data.len() as u32);
        (data, offsets)
    }

    #[test]
    fn batch_exact_match() {
        let (data, offsets) = make_batch(&[b"ATCGATCG", b"GGGGGGGG", b"XXGATCXX"]);
        let results = grep_batch(&data, &offsets, b"GATC", 0, false, false).unwrap();
        assert_eq!(results.as_ref(), &[1, 0, 1]);
    }

    #[test]
    fn batch_approximate_match() {
        let (data, offsets) = make_batch(&[b"ATCGTTCG", b"TTTTTTTT"]);
        // GTTC is 1 edit from GATC
        let results = grep_batch(&data, &offsets, b"GATC", 1, false, false).unwrap();
        assert_eq!(results.as_ref(), &[1, 0]);
    }

    #[test]
    fn batch_case_insensitive() {
        let (data, offsets) = make_batch(&[b"atcgatcg", b"ATCGATCG"]);
        let results = grep_batch(&data, &offsets, b"GATC", 0, true, false).unwrap();
        assert_eq!(results.as_ref(), &[1, 1]);
    }

    #[test]
    fn batch_reverse_complement() {
        // RC of ATCG is CGAT
        let (data, offsets) = make_batch(&[b"CGATAAAA", b"TTTTTTTT"]);
        let results = grep_batch(&data, &offsets, b"ATCG", 0, false, true).unwrap();
        assert_eq!(results.as_ref(), &[1, 0]);
    }

    #[test]
    fn batch_empty() {
        let results = grep_batch(&[], &[0], b"GATC", 0, false, false).unwrap();
        assert_eq!(results.as_ref(), &[] as &[u8]);
    }

    #[test]
    fn batch_empty_offsets() {
        let results = grep_batch(&[], &[], b"GATC", 0, false, false).unwrap();
        assert_eq!(results.as_ref(), &[] as &[u8]);
    }

    #[test]
    fn batch_single_sequence() {
        let (data, offsets) = make_batch(&[b"ATCGATCG"]);
        let results = grep_batch(&data, &offsets, b"GATC", 0, false, false).unwrap();
        assert_eq!(results.as_ref(), &[1]);
    }

    #[test]
    fn batch_empty_pattern_is_all_zeros() {
        let (data, offsets) = make_batch(&[b"ATCG", b"GATC"]);
        let results = grep_batch(&data, &offsets, b"", 0, false, false).unwrap();
        assert_eq!(results.as_ref(), &[0, 0]);
    }

    #[test]
    fn batch_rejects_offset_beyond_sequences() {
        let result = grep_batch(b"ATCG", &[0, 10], b"ATCG", 0, false, false);
        let err = result.err().expect("should have returned an error");
        assert!(
            err.reason.contains("final offset"),
            "unexpected error: {}",
            err.reason
        );
    }

    #[test]
    fn batch_rejects_non_monotonic_offsets() {
        let result = grep_batch(b"ATCGATCG", &[0, 4, 2, 8], b"ATCG", 0, false, false);
        let err = result.err().expect("should have returned an error");
        assert!(
            err.reason.contains("non-monotonic"),
            "unexpected error: {}",
            err.reason
        );
    }
}
