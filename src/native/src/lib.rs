//! Native performance layer for genotype bioinformatics library.
//!
//! This crate provides SIMD-accelerated genomic data processing functions
//! exposed to TypeScript via napi-rs. The #[napi] functions in this file
//! are thin wrappers around pure-Rust kernel modules (grep.rs, etc.) that
//! contain no napi dependencies and are independently testable.

#![feature(portable_simd)]
#![allow(clippy::must_use_candidate)]

mod classify;
mod grep;
mod transform;

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

/// The result of a batch transform operation.
///
/// For length-preserving operations, `offsets` is identical to the input
/// offsets. For compacting operations (`remove_gaps_batch`), `offsets`
/// reflects the new (shorter) byte positions.
#[napi(object)]
pub struct TransformResult {
    pub data: Buffer,
    pub offsets: Vec<u32>,
}

/// Length-preserving byte-level transformations.
///
/// Each variant maps to a SIMD-accelerated kernel function in
/// `transform.rs`. None of these operations change the byte count, so
/// the output offsets are always identical to the input offsets.
#[napi(string_enum)]
pub enum TransformOp {
    /// DNA complement (A↔T, C↔G, IUPAC codes)
    Complement,
    /// RNA complement (A↔U, C↔G, IUPAC codes)
    ComplementRna,
    /// Reverse byte order
    Reverse,
    /// DNA complement + reverse in one pass
    ReverseComplement,
    /// RNA complement + reverse in one pass
    ReverseComplementRna,
    /// T→U (case-preserving)
    ToRna,
    /// U→T (case-preserving)
    ToDna,
    /// Lowercase ASCII letters → uppercase
    UpperCase,
    /// Uppercase ASCII letters → lowercase
    LowerCase,
}

/// Apply a length-preserving byte-level transformation to every sequence
/// in a packed batch.
///
/// # Errors
///
/// Returns a napi error if the offset array is malformed.
// napi-rs requires owned values for enum parameters (they're deserialized
// from JS values into Rust-owned memory), so pass-by-reference isn't an option.
#[napi]
#[allow(clippy::cast_possible_truncation, clippy::needless_pass_by_value)]
pub fn transform_batch(
    sequences: &[u8],
    offsets: &[u32],
    op: TransformOp,
) -> napi::Result<TransformResult> {
    utils::validate_offsets(offsets, sequences.len())?;

    let mut out_data = vec![0u8; sequences.len()];
    let out_offsets: Vec<u32> = offsets.to_vec();

    for window in offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let seq = &sequences[start..end];
        let dest = &mut out_data[start..end];

        match op {
            TransformOp::Complement => transform::complement(seq, dest, false),
            TransformOp::ComplementRna => transform::complement(seq, dest, true),
            TransformOp::Reverse => transform::reverse(seq, dest),
            TransformOp::ReverseComplement => {
                transform::reverse_complement(seq, dest, false);
            }
            TransformOp::ReverseComplementRna => {
                transform::reverse_complement(seq, dest, true);
            }
            TransformOp::ToRna => transform::to_rna(seq, dest),
            TransformOp::ToDna => transform::to_dna(seq, dest),
            TransformOp::UpperCase => transform::uppercase(seq, dest),
            TransformOp::LowerCase => transform::lowercase(seq, dest),
        }
    }

    Ok(TransformResult {
        data: out_data.into(),
        offsets: out_offsets,
    })
}

/// Remove gap characters from every sequence in a packed batch.
///
/// This is the only transform operation that changes sequence lengths,
/// so it returns new offsets reflecting the compacted byte positions.
///
/// # Errors
///
/// Returns a napi error if the offset array is malformed.
// napi-rs requires owned String for JS string parameters (they're copied
// from the JS heap into Rust-owned memory), so &str isn't an option here.
#[napi]
#[allow(clippy::cast_possible_truncation, clippy::needless_pass_by_value)]
pub fn remove_gaps_batch(
    sequences: &[u8],
    offsets: &[u32],
    gap_chars: String,
) -> napi::Result<TransformResult> {
    utils::validate_offsets(offsets, sequences.len())?;

    let gap_bytes: &[u8] = if gap_chars.is_empty() {
        b".-*"
    } else {
        gap_chars.as_bytes()
    };

    let mut out_data = vec![0u8; sequences.len()];
    let mut out_offsets = Vec::with_capacity(offsets.len());
    let mut write_cursor: u32 = 0;

    for window in offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let seq = &sequences[start..end];

        out_offsets.push(write_cursor);
        let dest = &mut out_data[write_cursor as usize..];
        let written = transform::remove_gaps(seq, gap_bytes, dest);
        write_cursor += written as u32;
    }
    out_offsets.push(write_cursor);

    out_data.truncate(write_cursor as usize);

    Ok(TransformResult {
        data: out_data.into(),
        offsets: out_offsets,
    })
}

/// Replace non-standard bases (anything other than ACGTU) with a
/// replacement character in every sequence in a packed batch.
///
/// # Errors
///
/// Returns a napi error if the offset array is malformed.
// napi-rs requires owned String for JS string parameters.
#[napi]
#[allow(clippy::cast_possible_truncation, clippy::needless_pass_by_value)]
pub fn replace_ambiguous_batch(
    sequences: &[u8],
    offsets: &[u32],
    replacement: String,
) -> napi::Result<TransformResult> {
    utils::validate_offsets(offsets, sequences.len())?;

    let replacement_byte = replacement.as_bytes().first().copied().unwrap_or(b'N');

    let mut out_data = vec![0u8; sequences.len()];
    let out_offsets: Vec<u32> = offsets.to_vec();

    for window in offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let seq = &sequences[start..end];
        let dest = &mut out_data[start..end];
        transform::replace_ambiguous(seq, replacement_byte, dest);
    }

    Ok(TransformResult {
        data: out_data.into(),
        offsets: out_offsets,
    })
}

/// The result of a batch classify operation.
///
/// `counts` is a flat array of length `num_sequences * 8`, indexed as
/// `counts[seq_index * 8 + class_index]`. The 8 classes are:
///
/// 0: AT (A, T, U), 1: GC (G, C), 2: strong (S), 3: weak (W),
/// 4: two-base ambiguity (R, Y, K, M), 5: multi-base ambiguity (N, B, D, H, V),
/// 6: gap (-, ., *), 7: other (everything else).
///
/// All comparisons are case-insensitive except gaps, which are literal.
#[napi(object)]
pub struct ClassifyResult {
    pub counts: Vec<u32>,
}

/// Classify every byte in every sequence into one of 8 classes.
///
/// Returns per-sequence counts that the TypeScript layer uses to compute
/// gcContent, atContent, base composition, and other derived statistics.
/// The Rust side has no bioinformatics knowledge — it just counts bytes.
///
/// # Errors
///
/// Returns a napi error if the offset array is malformed.
// napi-rs requires owned String for JS string parameters, and #[must_use]
// has no meaning across the FFI boundary.
#[napi]
#[allow(clippy::cast_possible_truncation)]
pub fn classify_batch(sequences: &[u8], offsets: &[u32]) -> napi::Result<ClassifyResult> {
    utils::validate_offsets(offsets, sequences.len())?;

    let num_sequences = offsets.len().saturating_sub(1);
    let mut all_counts = Vec::with_capacity(num_sequences * classify::NUM_CLASSES);

    for window in offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let seq = &sequences[start..end];

        let mut counts = [0u32; classify::NUM_CLASSES];
        classify::classify(seq, &mut counts);
        all_counts.extend_from_slice(&counts);
    }

    Ok(ClassifyResult { counts: all_counts })
}

/// Validation modes for `check_valid_batch`.
///
/// Each mode defines a different set of allowed characters. The Rust side
/// has a dedicated SIMD comparison chain per mode, optimized for the number
/// of allowed characters.
#[napi(string_enum)]
pub enum ValidationMode {
    /// ACGT + gaps (.-*)
    StrictDna,
    /// ACGTU + all IUPAC ambiguity codes + gaps
    NormalDna,
    /// ACGU + gaps
    StrictRna,
    /// ACGU + all IUPAC ambiguity codes (no T) + gaps
    NormalRna,
    /// 20 standard amino acids + gaps
    Protein,
}

impl ValidationMode {
    fn to_valid_mode(&self) -> classify::ValidMode {
        match self {
            Self::StrictDna => classify::ValidMode::StrictDna,
            Self::NormalDna => classify::ValidMode::NormalDna,
            Self::StrictRna => classify::ValidMode::StrictRna,
            Self::NormalRna => classify::ValidMode::NormalRna,
            Self::Protein => classify::ValidMode::Protein,
        }
    }
}

/// Check whether every byte in every sequence belongs to the allowed
/// character set for the given validation mode.
///
/// Returns a `Buffer` of length `num_sequences` where each byte is 1 if
/// the sequence is valid, 0 if it contains any disallowed character. Uses
/// an early-exit SIMD scan that bails on the first invalid byte.
///
/// # Errors
///
/// Returns a napi error if the offset array is malformed.
// napi-rs requires owned values for enum parameters (they're deserialized
// from JS values into Rust-owned memory), so pass-by-reference isn't an option.
#[napi]
#[allow(clippy::cast_possible_truncation, clippy::needless_pass_by_value)]
pub fn check_valid_batch(
    sequences: &[u8],
    offsets: &[u32],
    mode: ValidationMode,
) -> napi::Result<Buffer> {
    utils::validate_offsets(offsets, sequences.len())?;

    let num_sequences = offsets.len().saturating_sub(1);
    let mut results = vec![0u8; num_sequences];
    let valid_mode = mode.to_valid_mode();

    for (i, window) in offsets.windows(2).enumerate() {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let seq = &sequences[start..end];
        results[i] = u8::from(classify::check_valid(seq, valid_mode));
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
                    "batch: final offset ({last}) exceeds sequences length ({sequences_len})"
                )));
            }
        }
        for window in offsets.windows(2) {
            if window[0] > window[1] {
                return Err(napi::Error::from_reason(format!(
                    "batch: non-monotonic offsets ({}..{})",
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

    #[test]
    fn transform_complement_batch() {
        let (data, offsets) = make_batch(&[b"ATCG", b"aacc"]);
        let result = transform_batch(&data, &offsets, TransformOp::Complement).unwrap();
        assert_eq!(result.data.as_ref(), b"TAGCttgg");
        assert_eq!(result.offsets, vec![0, 4, 8]);
    }

    #[test]
    fn transform_reverse_batch() {
        let (data, offsets) = make_batch(&[b"ATCG", b"AB"]);
        let result = transform_batch(&data, &offsets, TransformOp::Reverse).unwrap();
        assert_eq!(result.data.as_ref(), b"GCTABA");
        assert_eq!(result.offsets, vec![0, 4, 6]);
    }

    #[test]
    fn remove_gaps_batch_compacts() {
        let (data, offsets) = make_batch(&[b"A-T-C", b"GG"]);
        let result = remove_gaps_batch(&data, &offsets, String::new()).unwrap();
        assert_eq!(result.data.as_ref(), b"ATCGG");
        assert_eq!(result.offsets, vec![0, 3, 5]);
    }

    #[test]
    fn classify_batch_flattens_counts_in_order() {
        let (data, offsets) = make_batch(&[b"AAAA", b"", b"GG"]);
        let result = classify_batch(&data, &offsets).unwrap();
        assert_eq!(result.counts.len(), 3 * classify::NUM_CLASSES);

        // Seq 0: 4 AT bases
        assert_eq!(result.counts[0 * 8 + classify::CLASS_AT], 4);
        assert_eq!(result.counts[0 * 8 + classify::CLASS_GC], 0);

        // Seq 1: empty, all zeros
        for c in 0..classify::NUM_CLASSES {
            assert_eq!(result.counts[1 * 8 + c], 0, "empty seq class {c}");
        }

        // Seq 2: 2 GC bases
        assert_eq!(result.counts[2 * 8 + classify::CLASS_GC], 2);
        assert_eq!(result.counts[2 * 8 + classify::CLASS_AT], 0);
    }

    #[test]
    fn check_valid_batch_returns_per_sequence_flags() {
        let (data, offsets) = make_batch(&[b"ACGT", b"ACGX", b"acgt"]);
        let result = check_valid_batch(&data, &offsets, ValidationMode::StrictDna).unwrap();
        assert_eq!(result.as_ref(), &[1, 0, 1]);
    }

    #[test]
    fn classify_batch_empty_returns_empty() {
        let result = classify_batch(&[], &[0]).unwrap();
        assert!(result.counts.is_empty());
    }

    #[test]
    fn check_valid_batch_empty_returns_empty() {
        let result = check_valid_batch(&[], &[0], ValidationMode::StrictDna).unwrap();
        assert_eq!(result.as_ref(), &[] as &[u8]);
    }

    #[test]
    fn classify_batch_rejects_malformed_offsets() {
        let err = classify_batch(b"ATCG", &[0, 100])
            .err()
            .expect("should reject offset beyond data");
        assert!(err.reason.contains("final offset"), "{}", err.reason);

        let err = classify_batch(b"ATCGATCG", &[0, 4, 2, 8])
            .err()
            .expect("should reject non-monotonic offsets");
        assert!(err.reason.contains("non-monotonic"), "{}", err.reason);
    }

    #[test]
    fn check_valid_batch_rejects_malformed_offsets() {
        let err = check_valid_batch(b"ATCG", &[0, 100], ValidationMode::StrictDna)
            .err()
            .expect("should reject offset beyond data");
        assert!(err.reason.contains("final offset"), "{}", err.reason);
    }

    #[test]
    fn classify_batch_matches_manual_per_slice_calls() {
        let seqs: &[&[u8]] = &[b"ATCGNrykm", b"SSWWssw", b"---...**"];
        let (data, offsets) = make_batch(seqs);
        let result = classify_batch(&data, &offsets).unwrap();

        for (i, seq) in seqs.iter().enumerate() {
            let mut expected = [0u32; classify::NUM_CLASSES];
            classify::classify(seq, &mut expected);
            let actual = &result.counts[i * 8..(i + 1) * 8];
            assert_eq!(actual, &expected, "seq {i}");
        }
    }
}
