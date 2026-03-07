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
mod quality;
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

/// Replace bytes not in the allowed character set for the given validation
/// mode with a replacement character in every sequence in a packed batch.
///
/// This is the "fix" counterpart to `check_valid_batch`: where `check_valid`
/// returns a boolean per sequence, `replace_invalid` returns the fixed bytes.
/// Valid bytes pass through unchanged; invalid bytes become the replacement.
///
/// # Errors
///
/// Returns a napi error if the offset array is malformed.
#[napi]
#[allow(clippy::cast_possible_truncation, clippy::needless_pass_by_value)]
pub fn replace_invalid_batch(
    sequences: &[u8],
    offsets: &[u32],
    mode: ValidationMode,
    replacement: String,
) -> napi::Result<TransformResult> {
    utils::validate_offsets(offsets, sequences.len())?;

    let replacement_byte = replacement.as_bytes().first().copied().unwrap_or(b'N');
    let valid_mode = mode.to_valid_mode();

    let mut out_data = vec![0u8; sequences.len()];
    let out_offsets: Vec<u32> = offsets.to_vec();

    for window in offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let seq = &sequences[start..end];
        let dest = &mut out_data[start..end];
        transform::replace_invalid(seq, valid_mode, replacement_byte, dest);
    }

    Ok(TransformResult {
        data: out_data.into(),
        offsets: out_offsets,
    })
}

/// The result of a batch classify operation.
///
/// `counts` is a flat array of length `num_sequences * 12`, indexed as
/// `counts[seq_index * 12 + class_index]`. The 12 classes are:
///
/// 0: A, 1: T, 2: U, 3: G, 4: C, 5: N,
/// 6: strong (S), 7: weak (W), 8: two-base ambiguity (R, Y, K, M),
/// 9: BDHV, 10: gap (-, ., *), 11: other (everything else).
///
/// All comparisons are case-insensitive except gaps, which are literal.
#[napi(object)]
pub struct ClassifyResult {
    pub counts: Vec<u32>,
}

/// Classify every byte in every sequence into one of 12 classes.
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

/// Compute the average quality score for each sequence in a batch.
///
/// Quality bytes are Phred-encoded ASCII. The `ascii_offset` parameter
/// (33 for Phred+33, 64 for Phred+64 and Solexa) is subtracted to convert
/// from ASCII code to quality score. The kernel is encoding-agnostic.
///
/// Returns a `Vec<f64>` of length `num_sequences`.
///
/// # Errors
///
/// Returns a napi error if the offset array is malformed.
#[napi]
#[allow(clippy::cast_possible_truncation)]
pub fn quality_avg_batch(
    quality: &[u8],
    offsets: &[u32],
    ascii_offset: u8,
) -> napi::Result<Vec<f64>> {
    utils::validate_offsets(offsets, quality.len())?;

    let num_sequences = offsets.len().saturating_sub(1);
    let mut results = Vec::with_capacity(num_sequences);

    for window in offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let qual = &quality[start..end];
        results.push(quality::quality_avg(qual, ascii_offset));
    }

    Ok(results)
}

/// Find trim positions (start, end) for each sequence in a batch using a
/// sliding window average quality threshold.
///
/// Returns a flat `Vec<u32>` of length `num_sequences * 2`, where
/// `result[i*2]` is the start position and `result[i*2+1]` is the end
/// position (exclusive) for sequence `i`. A `(0, 0)` pair means trimming
/// consumed the entire sequence.
///
/// The `threshold` and `ascii_offset` are combined into a single
/// `threshold_sum = (threshold + offset) * window_size` that the kernel
/// compares against the integer window sum, avoiding per-byte floating
/// point arithmetic.
///
/// # Errors
///
/// Returns a napi error if the offset array is malformed.
#[napi]
#[allow(clippy::cast_possible_truncation)]
pub fn quality_trim_batch(
    quality: &[u8],
    offsets: &[u32],
    ascii_offset: u8,
    threshold: f64,
    window_size: u32,
    trim_start: bool,
    trim_end: bool,
) -> napi::Result<Vec<u32>> {
    utils::validate_offsets(offsets, quality.len())?;

    let num_sequences = offsets.len().saturating_sub(1);
    let threshold_sum = (threshold + f64::from(ascii_offset)) * f64::from(window_size);
    let mut results = Vec::with_capacity(num_sequences * 2);

    for window in offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let qual = &quality[start..end];
        let (trim_s, trim_e) =
            quality::quality_trim(qual, window_size, trim_start, trim_end, threshold_sum);
        results.push(trim_s);
        results.push(trim_e);
    }

    Ok(results)
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
        let results = grep_batch(&data, &offsets, b"GATC", 0, false, false)
            .expect("offset validation rejected a well-formed batch");
        assert_eq!(results.as_ref(), &[1, 0, 1]);
    }

    #[test]
    fn batch_approximate_match() {
        let (data, offsets) = make_batch(&[b"ATCGTTCG", b"TTTTTTTT"]);
        // GTTC is 1 edit from GATC
        let results = grep_batch(&data, &offsets, b"GATC", 1, false, false)
            .expect("offset validation rejected a well-formed batch");
        assert_eq!(results.as_ref(), &[1, 0]);
    }

    #[test]
    fn batch_case_insensitive() {
        let (data, offsets) = make_batch(&[b"atcgatcg", b"ATCGATCG"]);
        let results = grep_batch(&data, &offsets, b"GATC", 0, true, false)
            .expect("offset validation rejected a well-formed batch");
        assert_eq!(results.as_ref(), &[1, 1]);
    }

    #[test]
    fn batch_reverse_complement() {
        // RC of ATCG is CGAT
        let (data, offsets) = make_batch(&[b"CGATAAAA", b"TTTTTTTT"]);
        let results = grep_batch(&data, &offsets, b"ATCG", 0, false, true)
            .expect("offset validation rejected a well-formed batch");
        assert_eq!(results.as_ref(), &[1, 0]);
    }

    #[test]
    fn batch_empty() {
        let results = grep_batch(&[], &[0], b"GATC", 0, false, false)
            .expect("empty batch with sentinel offset [0] is valid");
        assert_eq!(results.as_ref(), &[] as &[u8]);
    }

    #[test]
    fn batch_empty_offsets() {
        let results = grep_batch(&[], &[], b"GATC", 0, false, false)
            .expect("completely empty batch (no offsets) is valid");
        assert_eq!(results.as_ref(), &[] as &[u8]);
    }

    #[test]
    fn batch_single_sequence() {
        let (data, offsets) = make_batch(&[b"ATCGATCG"]);
        let results = grep_batch(&data, &offsets, b"GATC", 0, false, false)
            .expect("offset validation rejected a well-formed batch");
        assert_eq!(results.as_ref(), &[1]);
    }

    #[test]
    fn batch_empty_pattern_is_all_zeros() {
        let (data, offsets) = make_batch(&[b"ATCG", b"GATC"]);
        let results = grep_batch(&data, &offsets, b"", 0, false, false)
            .expect("offset validation rejected a well-formed batch");
        assert_eq!(results.as_ref(), &[0, 0]);
    }

    #[test]
    fn batch_rejects_offset_beyond_sequences() {
        let result = grep_batch(b"ATCG", &[0, 10], b"ATCG", 0, false, false);
        let err = result
            .err()
            .expect("out-of-bounds offset [0, 10] was not rejected");
        assert!(
            err.reason.contains("final offset"),
            "unexpected error: {}",
            err.reason
        );
    }

    #[test]
    fn batch_rejects_non_monotonic_offsets() {
        let result = grep_batch(b"ATCGATCG", &[0, 4, 2, 8], b"ATCG", 0, false, false);
        let err = result
            .err()
            .expect("non-monotonic offsets [0, 4, 2, 8] were not rejected");
        assert!(
            err.reason.contains("non-monotonic"),
            "unexpected error: {}",
            err.reason
        );
    }

    #[test]
    fn transform_complement_batch() {
        let (data, offsets) = make_batch(&[b"ATCG", b"aacc"]);
        let result = transform_batch(&data, &offsets, TransformOp::Complement)
            .expect("offset validation rejected a well-formed batch");
        assert_eq!(result.data.as_ref(), b"TAGCttgg");
        assert_eq!(result.offsets, vec![0, 4, 8]);
    }

    #[test]
    fn transform_reverse_batch() {
        let (data, offsets) = make_batch(&[b"ATCG", b"AB"]);
        let result = transform_batch(&data, &offsets, TransformOp::Reverse)
            .expect("offset validation rejected a well-formed batch");
        assert_eq!(result.data.as_ref(), b"GCTABA");
        assert_eq!(result.offsets, vec![0, 4, 6]);
    }

    #[test]
    fn remove_gaps_batch_compacts() {
        let (data, offsets) = make_batch(&[b"A-T-C", b"GG"]);
        let result = remove_gaps_batch(&data, &offsets, String::new())
            .expect("offset validation rejected a well-formed batch");
        assert_eq!(result.data.as_ref(), b"ATCGG");
        assert_eq!(result.offsets, vec![0, 3, 5]);
    }

    #[test]
    fn classify_batch_flattens_counts_in_order() {
        let (data, offsets) = make_batch(&[b"AAAA", b"", b"GG"]);
        let result = classify_batch(&data, &offsets)
            .expect("offset validation rejected a well-formed batch");
        assert_eq!(result.counts.len(), 3 * classify::NUM_CLASSES);

        let count_at =
            |seq: usize, class: usize| result.counts[seq * classify::NUM_CLASSES + class];

        // Seq 0: 4 A bases
        assert_eq!(count_at(0, classify::CLASS_A), 4);
        assert_eq!(count_at(0, classify::CLASS_G), 0);

        // Seq 1: empty, all zeros
        for c in 0..classify::NUM_CLASSES {
            assert_eq!(count_at(1, c), 0, "empty seq class {c}");
        }

        // Seq 2: 2 G bases
        assert_eq!(count_at(2, classify::CLASS_G), 2);
        assert_eq!(count_at(2, classify::CLASS_A), 0);
    }

    #[test]
    fn check_valid_batch_returns_per_sequence_flags() {
        let (data, offsets) = make_batch(&[b"ACGT", b"ACGX", b"acgt"]);
        let result = check_valid_batch(&data, &offsets, ValidationMode::StrictDna)
            .expect("offset validation rejected a well-formed batch");
        assert_eq!(result.as_ref(), &[1, 0, 1]);
    }

    #[test]
    fn classify_batch_empty_returns_empty() {
        let result =
            classify_batch(&[], &[0]).expect("empty batch with sentinel offset [0] is valid");
        assert!(result.counts.is_empty());
    }

    #[test]
    fn check_valid_batch_empty_returns_empty() {
        let result = check_valid_batch(&[], &[0], ValidationMode::StrictDna)
            .expect("empty batch with sentinel offset [0] is valid");
        assert_eq!(result.as_ref(), &[] as &[u8]);
    }

    #[test]
    fn classify_batch_rejects_malformed_offsets() {
        let err = classify_batch(b"ATCG", &[0, 100])
            .err()
            .expect("out-of-bounds offset [0, 100] was not rejected");
        assert!(err.reason.contains("final offset"), "{}", err.reason);

        let err = classify_batch(b"ATCGATCG", &[0, 4, 2, 8])
            .err()
            .expect("non-monotonic offsets [0, 4, 2, 8] were not rejected");
        assert!(err.reason.contains("non-monotonic"), "{}", err.reason);
    }

    #[test]
    fn check_valid_batch_rejects_malformed_offsets() {
        let err = check_valid_batch(b"ATCG", &[0, 100], ValidationMode::StrictDna)
            .err()
            .expect("out-of-bounds offset [0, 100] was not rejected");
        assert!(err.reason.contains("final offset"), "{}", err.reason);
    }

    #[test]
    fn replace_invalid_batch_fixes_invalid_bytes() {
        let (data, offsets) = make_batch(&[b"ACGT", b"ACGX", b"acgt"]);
        let result = replace_invalid_batch(
            &data,
            &offsets,
            ValidationMode::StrictDna,
            String::from("N"),
        )
        .expect("offset validation rejected a well-formed batch");
        assert_eq!(result.data.as_ref(), b"ACGTACGNacgt");
        assert_eq!(result.offsets, vec![0, 4, 8, 12]);
    }

    #[test]
    fn replace_invalid_batch_empty_returns_empty() {
        let result = replace_invalid_batch(&[], &[0], ValidationMode::StrictDna, String::from("N"))
            .expect("empty batch with sentinel offset [0] is valid");
        assert_eq!(result.data.as_ref(), &[] as &[u8]);
    }

    #[test]
    fn replace_invalid_batch_rejects_malformed_offsets() {
        let err = replace_invalid_batch(
            b"ATCG",
            &[0, 100],
            ValidationMode::StrictDna,
            String::from("N"),
        )
        .err()
        .expect("out-of-bounds offset [0, 100] was not rejected");
        assert!(err.reason.contains("final offset"), "{}", err.reason);
    }

    #[test]
    fn quality_avg_batch_matches_per_sequence_calls() {
        let seqs: &[&[u8]] = &[
            b"IIIIIIIII", // Phred+33 Q40 uniform → 40.0
            b"!!!!",      // Phred+33 Q0 uniform → 0.0
            b"",          // empty → 0.0
            b"5",         // single byte, ASCII 53 → 53-33 = 20.0
        ];
        let (data, offsets) = make_batch(seqs);
        let results = quality_avg_batch(&data, &offsets, 33)
            .expect("offset validation rejected a well-formed batch");

        assert_eq!(results.len(), 4);

        for (i, seq) in seqs.iter().enumerate() {
            let expected = quality::quality_avg(seq, 33);
            assert!(
                (results[i] - expected).abs() < f64::EPSILON,
                "sequence {i}: got {}, expected {expected}",
                results[i]
            );
        }
    }

    #[test]
    fn quality_avg_batch_rejects_malformed_offsets() {
        let err = quality_avg_batch(b"IIII", &[0, 100], 33)
            .expect_err("out-of-bounds offset [0, 100] was not rejected");
        assert!(err.reason.contains("final offset"), "{}", err.reason);

        let err = quality_avg_batch(b"IIIIIIII", &[0, 4, 2, 8], 33)
            .expect_err("non-monotonic offsets [0, 4, 2, 8] were not rejected");
        assert!(err.reason.contains("non-monotonic"), "{}", err.reason);
    }

    #[test]
    fn quality_avg_batch_empty_returns_empty() {
        let results = quality_avg_batch(&[], &[0], 33)
            .expect("empty batch with sentinel offset [0] is valid");
        assert!(results.is_empty());
    }

    #[test]
    fn quality_trim_batch_matches_per_sequence_calls() {
        let seqs: &[&[u8]] = &[
            b"!!!IIIIII!!!", // low-high-low, should trim both ends
            b"IIIIIIIIII",   // all high, no trimming
            b"!!!!!!!!!!",   // all low, trimmed to nothing
            b"",             // empty
        ];
        let (data, offsets) = make_batch(seqs);
        let threshold = 20.0_f64;
        let window_size = 4_u32;
        let ascii_offset = 33_u8;

        let results = quality_trim_batch(
            &data,
            &offsets,
            ascii_offset,
            threshold,
            window_size,
            true,
            true,
        )
        .expect("offset validation rejected a well-formed batch");

        assert_eq!(results.len(), seqs.len() * 2);

        let threshold_sum = (threshold + f64::from(ascii_offset)) * f64::from(window_size);
        for (i, seq) in seqs.iter().enumerate() {
            let (exp_s, exp_e) = quality::quality_trim(seq, window_size, true, true, threshold_sum);
            assert_eq!(results[i * 2], exp_s, "sequence {i}: start mismatch");
            assert_eq!(results[i * 2 + 1], exp_e, "sequence {i}: end mismatch");
        }
    }

    #[test]
    fn quality_trim_batch_rejects_malformed_offsets() {
        let err = quality_trim_batch(b"IIII", &[0, 100], 33, 20.0, 4, true, true)
            .expect_err("out-of-bounds offset [0, 100] was not rejected");
        assert!(err.reason.contains("final offset"), "{}", err.reason);
    }

    #[test]
    fn quality_trim_batch_empty_returns_empty() {
        let results = quality_trim_batch(&[], &[0], 33, 20.0, 4, true, true)
            .expect("empty batch with sentinel offset [0] is valid");
        assert!(results.is_empty());
    }

    #[test]
    fn classify_batch_matches_manual_per_slice_calls() {
        let seqs: &[&[u8]] = &[b"ATCGNrykm", b"SSWWssw", b"---...**"];
        let (data, offsets) = make_batch(seqs);
        let result = classify_batch(&data, &offsets)
            .expect("offset validation rejected a well-formed batch");

        for (i, seq) in seqs.iter().enumerate() {
            let mut expected = [0u32; classify::NUM_CLASSES];
            classify::classify(seq, &mut expected);
            let start = i * classify::NUM_CLASSES;
            let actual = &result.counts[start..start + classify::NUM_CLASSES];
            assert_eq!(actual, &expected, "seq {i}");
        }
    }
}
