//! Native performance layer for genotype bioinformatics library.
//!
//! This crate provides SIMD-accelerated genomic data processing functions
//! exposed to TypeScript via napi-rs. The #[napi] functions in this file
//! are thin wrappers around pure-Rust kernel modules (grep.rs, etc.) that
//! contain no napi dependencies and are independently testable.
//!
//! The search kernels (`grep_batch`, `find_pattern_batch`) and
//! `classify_batch` use rayon to parallelize across sequences within a
//! batch. The search functions use `map_init` to create per-thread
//! `SearchContext` instances that cache sassy's internal DP matrices.

#![feature(portable_simd)]
#![allow(clippy::must_use_candidate)]

mod classify;
mod grep;
mod quality;
mod transform;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;

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

    let results: Vec<u8> = (0..num_sequences)
        .into_par_iter()
        .map_init(
            || {
                let mode = grep::SearchMode::from_flags(case_insensitive, search_both_strands);
                grep::SearchContext::new(pattern, max_edits, &mode)
            },
            |ctx, i| {
                let start = offsets[i] as usize;
                let end = offsets[i + 1] as usize;
                let seq = &sequences[start..end];
                u8::from(ctx.contains_match(seq))
            },
        )
        .collect();

    Ok(results.into())
}

/// CSR-style result for variable-length pattern match results.
///
/// Each sequence produces zero or more matches. `match_offsets` has length
/// `num_sequences + 1`, and the matches for sequence `i` are at indices
/// `match_offsets[i]..match_offsets[i+1]` in the `starts`, `ends`, and
/// `costs` arrays.
///
/// This flat representation avoids nested `Vec<Vec<_>>` allocation across
/// the napi boundary and mirrors the packed input format.
#[derive(Debug)]
#[napi(object)]
pub struct PatternSearchResult {
    pub starts: Vec<u32>,
    pub ends: Vec<u32>,
    pub costs: Vec<u32>,
    pub match_offsets: Vec<u32>,
}

/// Find all pattern matches with positions and edit distances in a batch
/// of sequences.
///
/// Uses the `Iupac` profile (forward-only) with traceback enabled, so
/// IUPAC degenerate bases (N, R, Y, etc.) are handled correctly and exact
/// match start positions are computed. The caller handles orientation by
/// making separate calls with the original and reverse-complement patterns.
///
/// Returns a CSR-style `PatternSearchResult`. See its documentation for
/// the indexing convention.
///
/// # Errors
///
/// Returns a napi error if the offset array is malformed.
#[napi]
#[allow(clippy::cast_possible_truncation)]
pub fn find_pattern_batch(
    sequences: &[u8],
    offsets: &[u32],
    pattern: &[u8],
    max_edits: u32,
    case_insensitive: bool,
) -> napi::Result<PatternSearchResult> {
    utils::validate_offsets(offsets, sequences.len())?;

    let num_sequences = offsets.len().saturating_sub(1);

    let per_seq: Vec<grep::PerSeqMatches> = (0..num_sequences)
        .into_par_iter()
        .map_init(
            || grep::SearchContext::new_with_positions(pattern, max_edits, case_insensitive),
            |ctx, i| {
                let start = offsets[i] as usize;
                let end = offsets[i + 1] as usize;
                let seq = &sequences[start..end];
                ctx.find_matches(seq)
            },
        )
        .collect();

    let mut starts = Vec::new();
    let mut ends = Vec::new();
    let mut costs = Vec::new();
    let mut match_offsets = Vec::with_capacity(num_sequences + 1);
    for matches in &per_seq {
        match_offsets.push(starts.len() as u32);
        for &(s, e, c) in matches {
            starts.push(s);
            ends.push(e);
            costs.push(c);
        }
    }
    match_offsets.push(starts.len() as u32);

    Ok(PatternSearchResult {
        starts,
        ends,
        costs,
        match_offsets,
    })
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

    let per_seq: Vec<[u32; classify::NUM_CLASSES]> = (0..num_sequences)
        .into_par_iter()
        .map(|i| {
            let start = offsets[i] as usize;
            let end = offsets[i + 1] as usize;
            let seq = &sequences[start..end];
            let mut counts = [0u32; classify::NUM_CLASSES];
            classify::classify(seq, &mut counts);
            counts
        })
        .collect();

    let mut all_counts = Vec::with_capacity(num_sequences * classify::NUM_CLASSES);
    for counts in &per_seq {
        all_counts.extend_from_slice(counts);
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

/// Remap quality bytes into fewer bins using SIMD compare-and-select.
///
/// `boundaries` and `representatives` are raw ASCII byte values
/// (pre-offset-adjusted by the TypeScript caller). The kernel does pure
/// byte comparisons with no encoding awareness.
///
/// Returns a `TransformResult` with the remapped bytes and identical
/// offsets (this is a length-preserving operation).
///
/// # Errors
///
/// Returns a napi error if the offset array is malformed, or if the
/// `boundaries`/`representatives` lengths are inconsistent.
#[napi]
#[allow(clippy::cast_possible_truncation)]
pub fn quality_bin_batch(
    quality: &[u8],
    offsets: &[u32],
    boundaries: &[u8],
    representatives: &[u8],
) -> napi::Result<TransformResult> {
    utils::validate_offsets(offsets, quality.len())?;

    if boundaries.is_empty() || representatives.len() != boundaries.len() + 1 {
        return Err(napi::Error::from_reason(format!(
            "quality_bin_batch: expected representatives.len() == boundaries.len() + 1, \
             got boundaries={}, representatives={}",
            boundaries.len(),
            representatives.len()
        )));
    }

    let mut out_data = vec![0u8; quality.len()];
    let out_offsets: Vec<u32> = offsets.to_vec();

    for window in offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let qual = &quality[start..end];
        let dest = &mut out_data[start..end];
        quality::quality_bin(qual, dest, boundaries, representatives);
    }

    Ok(TransformResult {
        data: out_data.into(),
        offsets: out_offsets,
    })
}

#[napi(object)]
pub struct SequenceMetricsResult {
    pub lengths: Option<Vec<u32>>,
    pub gc: Option<Vec<f64>>,
    pub at: Option<Vec<f64>>,
    pub gc_skew: Option<Vec<f64>>,
    pub at_skew: Option<Vec<f64>>,
    pub entropy: Option<Vec<f64>>,
    pub alphabet_mask: Option<Vec<u32>>,
    pub avg_qual: Option<Vec<f64>>,
    pub min_qual: Option<Vec<i32>>,
    pub max_qual: Option<Vec<i32>>,
}

#[derive(Clone)]
#[allow(clippy::struct_excessive_bools)]
#[napi(object)]
pub struct TranslateBatchOptions {
    pub frame_offset: u8,
    pub reverse: bool,
    pub convert_start_codons: bool,
    pub allow_alternative_starts: bool,
    pub trim_at_first_stop: bool,
    pub remove_stop_codons: bool,
    pub stop_codon_char: String,
    pub unknown_codon_char: String,
}

const METRIC_LENGTH: u32 = 1 << 0;
const METRIC_GC: u32 = 1 << 1;
const METRIC_AT: u32 = 1 << 2;
const METRIC_GC_SKEW: u32 = 1 << 3;
const METRIC_AT_SKEW: u32 = 1 << 4;
const METRIC_ENTROPY: u32 = 1 << 5;
const METRIC_ALPHABET: u32 = 1 << 6;
const METRIC_AVG_QUAL: u32 = 1 << 7;
const METRIC_MIN_QUAL: u32 = 1 << 8;
const METRIC_MAX_QUAL: u32 = 1 << 9;

const CODON_LUT_LEN: usize = 16 * 16 * 16;
const EXACT_CODON_TABLE_LEN: usize = 64;

const ALPHABET_STAR: usize = 0;
const ALPHABET_DASH: usize = 1;
const ALPHABET_DOT: usize = 2;
const ALPHABET_A: usize = 3;
const ALPHABET_B: usize = 4;
const ALPHABET_C: usize = 5;
const ALPHABET_D: usize = 6;
const ALPHABET_E: usize = 7;
const ALPHABET_F: usize = 8;
const ALPHABET_G: usize = 9;
const ALPHABET_H: usize = 10;
const ALPHABET_I: usize = 11;
const ALPHABET_J: usize = 12;
const ALPHABET_K: usize = 13;
const ALPHABET_L: usize = 14;
const ALPHABET_M: usize = 15;
const ALPHABET_N: usize = 16;
const ALPHABET_O: usize = 17;
const ALPHABET_P: usize = 18;
const ALPHABET_Q: usize = 19;
const ALPHABET_R: usize = 20;
const ALPHABET_S: usize = 21;
const ALPHABET_T: usize = 22;
const ALPHABET_U: usize = 23;
const ALPHABET_V: usize = 24;
const ALPHABET_W: usize = 25;
const ALPHABET_X: usize = 26;
const ALPHABET_Y: usize = 27;
const ALPHABET_Z: usize = 28;
const ALPHABET_LEN: usize = 29;

#[derive(Clone, Copy, Default)]
struct SeqAccum {
    len: u32,
    counts: [u32; ALPHABET_LEN],
}

#[derive(Clone, Copy, Default)]
struct QualAccum {
    len: u32,
    sum: u64,
    min_raw: u8,
    max_raw: u8,
    seen: bool,
}

#[derive(Clone, Copy, Default)]
struct MetricsRow {
    seq: SeqAccum,
    qual: QualAccum,
}

/// Compute built-in per-sequence metrics for a packed batch of sequences.
///
/// Sequence-derived metrics are computed from `sequences` and `seq_offsets`.
/// Quality-derived metrics are computed from `quality` and `qual_offsets`,
/// which must describe the same number of records. Sequences without quality
/// data should provide empty quality slices in the parallel quality batch.
///
/// The `metric_flags` bitmask determines which output arrays are populated.
/// Unrequested metrics are returned as `None` to avoid unnecessary allocation.
///
/// # Errors
///
/// Returns a napi error if either offset array is malformed or if the
/// sequence and quality batches describe different numbers of records.
#[napi]
#[allow(clippy::cast_precision_loss)]
pub fn sequence_metrics_batch(
    sequences: &[u8],
    seq_offsets: &[u32],
    quality: &[u8],
    qual_offsets: &[u32],
    metric_flags: u32,
    ascii_offset: u8,
) -> napi::Result<SequenceMetricsResult> {
    utils::validate_offsets(seq_offsets, sequences.len())?;
    utils::validate_offsets(qual_offsets, quality.len())?;

    if seq_offsets.len() != qual_offsets.len() {
        return Err(napi::Error::from_reason(
            "sequence_metrics_batch: sequence and quality offsets must have the same length",
        ));
    }

    let num_sequences = seq_offsets.len().saturating_sub(1);
    let needs_qual = metric_flags & (METRIC_AVG_QUAL | METRIC_MIN_QUAL | METRIC_MAX_QUAL) != 0;

    let rows: Vec<MetricsRow> = (0..num_sequences)
        .into_par_iter()
        .map(|i| {
            let seq_start = seq_offsets[i] as usize;
            let seq_end = seq_offsets[i + 1] as usize;
            let seq = &sequences[seq_start..seq_end];

            let qual_start = qual_offsets[i] as usize;
            let qual_end = qual_offsets[i + 1] as usize;
            let qual = &quality[qual_start..qual_end];

            MetricsRow {
                seq: compute_seq_metrics(seq),
                qual: if needs_qual {
                    compute_qual_metrics(qual)
                } else {
                    QualAccum::default()
                },
            }
        })
        .collect();

    Ok(materialize_sequence_metrics(
        &rows,
        metric_flags,
        ascii_offset,
    ))
}

/// Translate a packed batch of nucleotide sequences into proteins.
///
/// This accelerates the direct frame-translation path. ORF-finding remains in
/// TypeScript. Genetic-code semantics are driven by precomputed lookup buffers
/// supplied by TypeScript so the source of truth for the code tables stays in
/// the existing TS genetic-code definitions.
///
/// # Errors
///
/// Returns a napi error if the offset array is malformed, if any lookup table
/// has the wrong length, or if the requested frame offset is outside 0..=2.
#[napi]
#[allow(
    clippy::cast_possible_truncation,
    clippy::needless_pass_by_value,
    clippy::too_many_arguments,
    clippy::fn_params_excessive_bools
)]
pub fn translate_batch(
    sequences: &[u8],
    offsets: &[u32],
    translation_lut: &[u8],
    start_mask: &[u8],
    alternative_start_mask: &[u8],
    options: TranslateBatchOptions,
) -> napi::Result<TransformResult> {
    utils::validate_offsets(offsets, sequences.len())?;

    if translation_lut.len() != CODON_LUT_LEN {
        return Err(napi::Error::from_reason(
            "translate_batch: translation lookup table must have length 4096",
        ));
    }
    if start_mask.len() != EXACT_CODON_TABLE_LEN {
        return Err(napi::Error::from_reason(
            "translate_batch: start mask must have length 64",
        ));
    }
    if alternative_start_mask.len() != EXACT_CODON_TABLE_LEN {
        return Err(napi::Error::from_reason(
            "translate_batch: alternative start mask must have length 64",
        ));
    }
    if options.frame_offset > 2 {
        return Err(napi::Error::from_reason(
            "translate_batch: frame_offset must be 0, 1, or 2",
        ));
    }

    let stop_byte = options
        .stop_codon_char
        .as_bytes()
        .first()
        .copied()
        .unwrap_or(b'*');
    let unknown_byte = options
        .unknown_codon_char
        .as_bytes()
        .first()
        .copied()
        .unwrap_or(b'X');
    let num_sequences = offsets.len().saturating_sub(1);

    let proteins: Vec<Vec<u8>> = (0..num_sequences)
        .into_par_iter()
        .map(|i| {
            let start = offsets[i] as usize;
            let end = offsets[i + 1] as usize;
            let seq = &sequences[start..end];
            translate_one(
                seq,
                translation_lut,
                start_mask,
                alternative_start_mask,
                &options,
                stop_byte,
                unknown_byte,
            )
        })
        .collect();

    let total_len: usize = proteins.iter().map(Vec::len).sum();
    let mut data = Vec::with_capacity(total_len);
    let mut out_offsets = Vec::with_capacity(num_sequences + 1);
    out_offsets.push(0);

    for protein in proteins {
        data.extend_from_slice(&protein);
        out_offsets.push(data.len() as u32);
    }

    Ok(TransformResult {
        data: data.into(),
        offsets: out_offsets,
    })
}

#[allow(clippy::cast_possible_truncation)]
fn compute_seq_metrics(seq: &[u8]) -> SeqAccum {
    let mut counts = [0u32; ALPHABET_LEN];

    for &byte in seq {
        let upper = byte & !0x20;
        let index = match upper {
            b'*' => Some(ALPHABET_STAR),
            b'-' => Some(ALPHABET_DASH),
            b'.' => Some(ALPHABET_DOT),
            b'A' => Some(ALPHABET_A),
            b'B' => Some(ALPHABET_B),
            b'C' => Some(ALPHABET_C),
            b'D' => Some(ALPHABET_D),
            b'E' => Some(ALPHABET_E),
            b'F' => Some(ALPHABET_F),
            b'G' => Some(ALPHABET_G),
            b'H' => Some(ALPHABET_H),
            b'I' => Some(ALPHABET_I),
            b'J' => Some(ALPHABET_J),
            b'K' => Some(ALPHABET_K),
            b'L' => Some(ALPHABET_L),
            b'M' => Some(ALPHABET_M),
            b'N' => Some(ALPHABET_N),
            b'O' => Some(ALPHABET_O),
            b'P' => Some(ALPHABET_P),
            b'Q' => Some(ALPHABET_Q),
            b'R' => Some(ALPHABET_R),
            b'S' => Some(ALPHABET_S),
            b'T' => Some(ALPHABET_T),
            b'U' => Some(ALPHABET_U),
            b'V' => Some(ALPHABET_V),
            b'W' => Some(ALPHABET_W),
            b'X' => Some(ALPHABET_X),
            b'Y' => Some(ALPHABET_Y),
            b'Z' => Some(ALPHABET_Z),
            _ => None,
        };

        if let Some(idx) = index {
            counts[idx] += 1;
        }
    }

    SeqAccum {
        len: seq.len() as u32,
        counts,
    }
}

#[allow(clippy::cast_possible_truncation)]
fn compute_qual_metrics(quality: &[u8]) -> QualAccum {
    if quality.is_empty() {
        return QualAccum::default();
    }

    let mut sum = 0u64;
    let mut min_raw = u8::MAX;
    let mut max_raw = u8::MIN;

    for &q in quality {
        sum += u64::from(q);
        min_raw = min_raw.min(q);
        max_raw = max_raw.max(q);
    }

    QualAccum {
        len: quality.len() as u32,
        sum,
        min_raw,
        max_raw,
        seen: true,
    }
}

#[allow(clippy::too_many_arguments, clippy::fn_params_excessive_bools)]
fn translate_one(
    seq: &[u8],
    translation_lut: &[u8],
    start_mask: &[u8],
    alternative_start_mask: &[u8],
    options: &TranslateBatchOptions,
    stop_byte: u8,
    unknown_byte: u8,
) -> Vec<u8> {
    let normalized = if options.reverse {
        reverse_complement_normalized(seq)
    } else {
        normalize_to_dna_upper(seq)
    };

    let frame_offset = options.frame_offset as usize;

    if normalized.is_empty() || frame_offset >= normalized.len() {
        return Vec::new();
    }

    let mut out = Vec::with_capacity(normalized.len() / 3);
    let mut is_first_codon = true;
    let mut i = frame_offset;

    while i + 2 < normalized.len() {
        let codon = [normalized[i], normalized[i + 1], normalized[i + 2]];
        let codon_index = codon_lookup_index(codon);
        let exact_index = exact_codon_index(codon);
        let mut amino_acid = translation_lut[codon_index as usize];

        if options.convert_start_codons
            && is_first_codon
            && (exact_index.is_some_and(|idx| start_mask[idx] != 0)
                || (options.allow_alternative_starts
                    && exact_index.is_some_and(|idx| alternative_start_mask[idx] != 0)))
        {
            amino_acid = b'M';
        }
        is_first_codon = false;

        if amino_acid == b'*' {
            if options.trim_at_first_stop {
                break;
            }
            if options.remove_stop_codons {
                i += 3;
                continue;
            }
            amino_acid = stop_byte;
        } else if amino_acid == b'X' {
            amino_acid = unknown_byte;
        }

        out.push(amino_acid);
        i += 3;
    }

    out
}

fn normalize_to_dna_upper(seq: &[u8]) -> Vec<u8> {
    seq.iter()
        .map(|&b| match b & !0x20 {
            b'U' => b'T',
            upper => upper,
        })
        .collect()
}

fn reverse_complement_normalized(seq: &[u8]) -> Vec<u8> {
    seq.iter()
        .rev()
        .map(|&b| complement_iupac_dna(b & !0x20))
        .collect()
}

fn complement_iupac_dna(base: u8) -> u8 {
    match base {
        b'A' => b'T',
        b'C' => b'G',
        b'G' => b'C',
        b'T' | b'U' => b'A',
        b'R' => b'Y',
        b'Y' => b'R',
        b'S' => b'S',
        b'W' => b'W',
        b'K' => b'M',
        b'M' => b'K',
        b'B' => b'V',
        b'D' => b'H',
        b'H' => b'D',
        b'V' => b'B',
        b'N' => b'N',
        b'.' => b'.',
        b'-' => b'-',
        b'*' => b'*',
        other => other,
    }
}

fn base_mask(base: u8) -> u8 {
    match base {
        b'A' => 0b0001,
        b'C' => 0b0010,
        b'G' => 0b0100,
        b'T' | b'U' => 0b1000,
        b'R' => 0b0101,
        b'Y' => 0b1010,
        b'S' => 0b0110,
        b'W' => 0b1001,
        b'K' => 0b1100,
        b'M' => 0b0011,
        b'B' => 0b1110,
        b'D' => 0b1101,
        b'H' => 0b1011,
        b'V' => 0b0111,
        b'N' => 0b1111,
        _ => 0,
    }
}

fn codon_lookup_index(codon: [u8; 3]) -> u16 {
    let a = u16::from(base_mask(codon[0]));
    let b = u16::from(base_mask(codon[1]));
    let c = u16::from(base_mask(codon[2]));
    (a << 8) | (b << 4) | c
}

fn exact_codon_index(codon: [u8; 3]) -> Option<usize> {
    let a = exact_base_bits(codon[0]);
    let b = exact_base_bits(codon[1]);
    let c = exact_base_bits(codon[2]);
    match (a, b, c) {
        (Some(a), Some(b), Some(c)) => Some((a << 4) | (b << 2) | c),
        _ => None,
    }
}

fn exact_base_bits(base: u8) -> Option<usize> {
    match base {
        b'A' => Some(0),
        b'C' => Some(1),
        b'G' => Some(2),
        b'T' | b'U' => Some(3),
        _ => None,
    }
}

#[allow(clippy::cast_precision_loss)]
fn materialize_sequence_metrics(
    rows: &[MetricsRow],
    metric_flags: u32,
    ascii_offset: u8,
) -> SequenceMetricsResult {
    let lengths =
        (metric_flags & METRIC_LENGTH != 0).then(|| rows.iter().map(|row| row.seq.len).collect());

    let gc = (metric_flags & METRIC_GC != 0)
        .then(|| rows.iter().map(|row| gc_content(&row.seq)).collect());

    let at = (metric_flags & METRIC_AT != 0)
        .then(|| rows.iter().map(|row| at_content(&row.seq)).collect());

    let gc_skew = (metric_flags & METRIC_GC_SKEW != 0)
        .then(|| rows.iter().map(|row| gc_skew_value(&row.seq)).collect());

    let at_skew = (metric_flags & METRIC_AT_SKEW != 0)
        .then(|| rows.iter().map(|row| at_skew_value(&row.seq)).collect());

    let entropy = (metric_flags & METRIC_ENTROPY != 0)
        .then(|| rows.iter().map(|row| entropy_value(&row.seq)).collect());

    let alphabet_mask = (metric_flags & METRIC_ALPHABET != 0).then(|| {
        rows.iter()
            .map(|row| alphabet_mask_value(&row.seq))
            .collect()
    });

    let avg_qual = (metric_flags & METRIC_AVG_QUAL != 0).then(|| {
        rows.iter()
            .map(|row| {
                if row.qual.len == 0 {
                    0.0
                } else {
                    row.qual.sum as f64 / f64::from(row.qual.len) - f64::from(ascii_offset)
                }
            })
            .collect()
    });

    let min_qual = (metric_flags & METRIC_MIN_QUAL != 0).then(|| {
        rows.iter()
            .map(|row| {
                if row.qual.seen {
                    i32::from(row.qual.min_raw) - i32::from(ascii_offset)
                } else {
                    0
                }
            })
            .collect()
    });

    let max_qual = (metric_flags & METRIC_MAX_QUAL != 0).then(|| {
        rows.iter()
            .map(|row| {
                if row.qual.seen {
                    i32::from(row.qual.max_raw) - i32::from(ascii_offset)
                } else {
                    0
                }
            })
            .collect()
    });

    SequenceMetricsResult {
        lengths,
        gc,
        at,
        gc_skew,
        at_skew,
        entropy,
        alphabet_mask,
        avg_qual,
        min_qual,
        max_qual,
    }
}

fn gc_content(seq: &SeqAccum) -> f64 {
    let strong = seq.counts[ALPHABET_C] + seq.counts[ALPHABET_G] + seq.counts[ALPHABET_S];
    let weak = seq.counts[ALPHABET_A]
        + seq.counts[ALPHABET_T]
        + seq.counts[ALPHABET_U]
        + seq.counts[ALPHABET_W];
    let partial_gc = seq.counts[ALPHABET_R]
        + seq.counts[ALPHABET_Y]
        + seq.counts[ALPHABET_K]
        + seq.counts[ALPHABET_M];
    let partial_ambiguous = seq.counts[ALPHABET_N]
        + seq.counts[ALPHABET_B]
        + seq.counts[ALPHABET_D]
        + seq.counts[ALPHABET_H]
        + seq.counts[ALPHABET_V];
    let total_bases = strong + weak + partial_gc + partial_ambiguous;
    if total_bases == 0 {
        return 0.0;
    }
    ((f64::from(strong)) + f64::from(partial_gc + partial_ambiguous) * 0.5) / f64::from(total_bases)
        * 100.0
}

fn at_content(seq: &SeqAccum) -> f64 {
    let weak = seq.counts[ALPHABET_A]
        + seq.counts[ALPHABET_T]
        + seq.counts[ALPHABET_U]
        + seq.counts[ALPHABET_W];
    let strong = seq.counts[ALPHABET_C] + seq.counts[ALPHABET_G] + seq.counts[ALPHABET_S];
    let partial_gc = seq.counts[ALPHABET_R]
        + seq.counts[ALPHABET_Y]
        + seq.counts[ALPHABET_K]
        + seq.counts[ALPHABET_M];
    let partial_ambiguous = seq.counts[ALPHABET_N]
        + seq.counts[ALPHABET_B]
        + seq.counts[ALPHABET_D]
        + seq.counts[ALPHABET_H]
        + seq.counts[ALPHABET_V];
    let total_bases = strong + weak + partial_gc + partial_ambiguous;
    if total_bases == 0 {
        return 0.0;
    }
    ((f64::from(weak)) + f64::from(partial_gc + partial_ambiguous) * 0.5) / f64::from(total_bases)
        * 100.0
}

fn gc_skew_value(seq: &SeqAccum) -> f64 {
    let g = f64::from(seq.counts[ALPHABET_G]);
    let c = f64::from(seq.counts[ALPHABET_C]);
    if g + c == 0.0 {
        0.0
    } else {
        ((g - c) / (g + c)) * 100.0
    }
}

fn at_skew_value(seq: &SeqAccum) -> f64 {
    let a = f64::from(seq.counts[ALPHABET_A]);
    let t = f64::from(seq.counts[ALPHABET_T] + seq.counts[ALPHABET_U]);
    if a + t == 0.0 {
        0.0
    } else {
        ((a - t) / (a + t)) * 100.0
    }
}

fn entropy_value(seq: &SeqAccum) -> f64 {
    if seq.len == 0 {
        return 0.0;
    }

    let total = f64::from(seq.len);
    let mut entropy = 0.0;
    for &count in &seq.counts {
        if count > 0 {
            let p = f64::from(count) / total;
            entropy -= p * p.log2();
        }
    }
    entropy
}

fn alphabet_mask_value(seq: &SeqAccum) -> u32 {
    let mut mask = 0u32;
    for (idx, &count) in seq.counts.iter().enumerate() {
        if count > 0 {
            mask |= 1u32 << idx;
        }
    }
    mask
}

/// Hash every sequence in a packed batch using XXH3-128.
///
/// Returns a `Buffer` of length `num_sequences * 16` containing one
/// 128-bit hash per sequence as two little-endian u64s (low half first).
/// When `case_insensitive` is true, each byte is OR-ed with 0x20 before
/// hashing, folding ASCII uppercase into lowercase without a separate
/// normalization pass.
///
/// The 128-bit output is designed for two uses:
///
/// 1. **Exact dedup**: the full 128-bit value (or a hex string derived
///    from it) serves as a `Map`/`Set` key with negligible collision risk.
/// 2. **Bloom filter probes**: the two 64-bit halves `h1` and `h2` feed
///    the double-hashing scheme `h_i = h1 + i * h2` to derive `k` probe
///    positions without re-hashing.
///
/// # Offset contract
///
/// `offsets` must be a monotonically non-decreasing `Uint32Array` of length
/// `num_sequences + 1`, where `offsets[last] <= sequences.len()`.
///
/// # Errors
///
/// Returns a napi error if the offset array is malformed.
#[napi]
pub fn hash_batch(
    sequences: &[u8],
    offsets: &[u32],
    case_insensitive: bool,
) -> napi::Result<Buffer> {
    utils::validate_offsets(offsets, sequences.len())?;

    let num_sequences = offsets.len().saturating_sub(1);
    let mut out = vec![0u8; num_sequences * 16];

    out.par_chunks_exact_mut(16)
        .enumerate()
        .for_each(|(i, slot)| {
            let start = offsets[i] as usize;
            let end = offsets[i + 1] as usize;
            let seq = &sequences[start..end];
            let h = hash_one(seq, case_insensitive);
            slot.copy_from_slice(&h.to_le_bytes());
        });

    Ok(out.into())
}

/// Hash a single sequence slice with XXH3-128, optionally folding case.
fn hash_one(seq: &[u8], case_insensitive: bool) -> u128 {
    if case_insensitive {
        // Fold ASCII letters to lowercase by OR-ing with 0x20.
        // This maps A-Z (0x41-0x5A) to a-z (0x61-0x7A). It also
        // maps some non-letter bytes to different values (e.g. '@' →
        // '`'), but for hashing purposes the only requirement is that
        // uppercase and lowercase ASCII letters produce the same hash,
        // which this achieves.
        //
        // We use a stack buffer for short sequences to avoid allocation,
        // falling back to a heap vec for longer ones.
        const STACK_LIMIT: usize = 4096;
        if seq.len() <= STACK_LIMIT {
            let mut buf = [0u8; STACK_LIMIT];
            let dest = &mut buf[..seq.len()];
            for (d, &s) in dest.iter_mut().zip(seq) {
                *d = s | 0x20;
            }
            xxhash_rust::xxh3::xxh3_128(dest)
        } else {
            let folded: Vec<u8> = seq.iter().map(|&b| b | 0x20).collect();
            xxhash_rust::xxh3::xxh3_128(&folded)
        }
    } else {
        xxhash_rust::xxh3::xxh3_128(seq)
    }
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
    fn sequence_metrics_batch_computes_sequence_metrics() {
        let (data, offsets) = make_batch(&[b"ACGTN", b"GGCC"]);
        let (quality, qual_offsets) = make_batch(&[b"", b""]);

        let result = sequence_metrics_batch(
            &data,
            &offsets,
            &quality,
            &qual_offsets,
            METRIC_LENGTH
                | METRIC_GC
                | METRIC_AT
                | METRIC_GC_SKEW
                | METRIC_ENTROPY
                | METRIC_ALPHABET,
            33,
        )
        .expect("sequence metrics batch should succeed");

        assert_eq!(result.lengths.expect("lengths requested"), vec![5, 4]);
        assert_eq!(result.gc.expect("gc requested"), vec![50.0, 100.0]);
        assert_eq!(result.at.expect("at requested"), vec![50.0, 0.0]);
        assert_eq!(result.gc_skew.expect("gc skew requested"), vec![0.0, 0.0]);
        assert_eq!(result.alphabet_mask.expect("alphabet requested").len(), 2);
        assert!(result.entropy.expect("entropy requested")[0] > 0.0);
    }

    #[test]
    fn sequence_metrics_batch_computes_quality_metrics() {
        let (data, offsets) = make_batch(&[b"ACGT", b"TTTT"]);
        let (quality, qual_offsets) = make_batch(&[b"IIII", b"!?!?"]);

        let result = sequence_metrics_batch(
            &data,
            &offsets,
            &quality,
            &qual_offsets,
            METRIC_AVG_QUAL | METRIC_MIN_QUAL | METRIC_MAX_QUAL,
            33,
        )
        .expect("quality metrics batch should succeed");

        assert_eq!(result.avg_qual.expect("avg requested"), vec![40.0, 15.0]);
        assert_eq!(result.min_qual.expect("min requested"), vec![40, 0]);
        assert_eq!(result.max_qual.expect("max requested"), vec![40, 30]);
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
    fn quality_bin_batch_matches_per_sequence_calls() {
        // Illumina 3-bin preset: boundaries [15, 30] → ASCII [48, 63] for phred33
        // Representatives [7, 22, 40] → ASCII [40, 55, 73]
        let boundaries: &[u8] = &[48, 63];
        let representatives: &[u8] = &[40, 55, 73];

        let seqs: &[&[u8]] = &[
            b"!!!!!!!!!!", // All Q0 (ASCII 33) → all below boundary[0]=48 → rep[0]=40
            b"5555555555", // All ASCII 53, 48 <= 53 < 63 → rep[1]=55
            b"IIIIIIIIII", // All ASCII 73 >= 63 → rep[2]=73
            b"!5I",        // Mixed: one per bin
            b"",           // Empty
        ];
        let (data, offsets) = make_batch(seqs);
        let result = quality_bin_batch(&data, &offsets, boundaries, representatives)
            .expect("offset validation rejected a well-formed batch");

        // Offsets should be identical (length-preserving)
        assert_eq!(result.offsets, offsets.clone());

        // Verify each sequence was binned correctly
        for (i, window) in offsets.windows(2).enumerate() {
            let start = window[0] as usize;
            let end = window[1] as usize;
            let actual = &result.data[start..end];

            let mut expected = vec![0u8; seqs[i].len()];
            quality::quality_bin(seqs[i], &mut expected, boundaries, representatives);
            assert_eq!(actual, expected.as_slice(), "sequence {i}");
        }
    }

    #[test]
    fn quality_bin_batch_rejects_malformed_offsets() {
        let err = quality_bin_batch(b"IIII", &[0, 100], &[53], &[40, 63])
            .err()
            .expect("out-of-bounds offset [0, 100] was not rejected");
        assert!(err.reason.contains("final offset"), "{}", err.reason);
    }

    #[test]
    fn quality_bin_batch_rejects_inconsistent_boundaries_representatives() {
        // 1 boundary requires 2 representatives, not 1
        let err = quality_bin_batch(b"IIII", &[0, 4], &[53], &[40])
            .err()
            .expect("mismatched boundaries/representatives was not rejected");
        assert!(
            err.reason.contains("representatives"),
            "unexpected error: {}",
            err.reason
        );
    }

    #[test]
    fn quality_bin_batch_empty_returns_empty() {
        let result = quality_bin_batch(&[], &[0], &[53], &[40, 63])
            .expect("empty batch with sentinel offset [0] is valid");
        assert_eq!(result.data.as_ref(), &[] as &[u8]);
        assert_eq!(result.offsets, vec![0]);
    }

    #[test]
    fn find_pattern_batch_returns_csr_results() {
        // Seq 0: GATC at position 3
        // Seq 1: no match
        // Seq 2: GATC at position 0
        let (data, offsets) = make_batch(&[b"ATCGATCG", b"TTTTTTTT", b"GATCAAAA"]);
        let result = find_pattern_batch(&data, &offsets, b"GATC", 0, false)
            .expect("offset validation rejected a well-formed batch");

        assert_eq!(
            result.match_offsets.len(),
            4,
            "match_offsets should have num_sequences + 1 entries"
        );

        // Seq 0: one match
        let s0_start = result.match_offsets[0] as usize;
        let s0_end = result.match_offsets[1] as usize;
        assert_eq!(s0_end - s0_start, 1, "seq 0 should have 1 match");
        assert_eq!(result.starts[s0_start], 3);
        assert_eq!(result.ends[s0_start], 7);
        assert_eq!(result.costs[s0_start], 0);

        // Seq 1: no matches
        let s1_start = result.match_offsets[1] as usize;
        let s1_end = result.match_offsets[2] as usize;
        assert_eq!(s1_end - s1_start, 0, "seq 1 should have 0 matches");

        // Seq 2: one match at position 0
        let s2_start = result.match_offsets[2] as usize;
        let s2_end = result.match_offsets[3] as usize;
        assert_eq!(s2_end - s2_start, 1, "seq 2 should have 1 match");
        assert_eq!(result.starts[s2_start], 0);
        assert_eq!(result.ends[s2_start], 4);
        assert_eq!(result.costs[s2_start], 0);
    }

    #[test]
    fn find_pattern_batch_approximate_matches() {
        // GTTC is 1 edit from GATC
        let (data, offsets) = make_batch(&[b"AAAAGTTCAAAA", b"TTTTTTTTTTTT"]);
        let result = find_pattern_batch(&data, &offsets, b"GATC", 1, false)
            .expect("offset validation rejected a well-formed batch");

        let s0_start = result.match_offsets[0] as usize;
        let s0_end = result.match_offsets[1] as usize;
        assert!(s0_end > s0_start, "seq 0 should have at least 1 match");

        // Find the match at position 4
        let idx = (s0_start..s0_end)
            .find(|&i| result.starts[i] == 4)
            .expect("should find match starting at position 4");
        assert_eq!(result.ends[idx], 8);
        assert_eq!(result.costs[idx], 1);

        // Seq 1: no match even with 1 edit tolerance
        let s1_start = result.match_offsets[1] as usize;
        let s1_end = result.match_offsets[2] as usize;
        assert_eq!(s1_end - s1_start, 0, "seq 1 should have 0 matches");
    }

    #[test]
    fn find_pattern_batch_empty_returns_sentinel() {
        let result = find_pattern_batch(&[], &[0], b"GATC", 0, false)
            .expect("empty batch with sentinel offset [0] is valid");
        assert!(result.starts.is_empty());
        assert!(result.ends.is_empty());
        assert!(result.costs.is_empty());
        assert_eq!(result.match_offsets, vec![0]);
    }

    #[test]
    fn find_pattern_batch_rejects_malformed_offsets() {
        let err = find_pattern_batch(b"ATCG", &[0, 100], b"ATCG", 0, false)
            .expect_err("out-of-bounds offset [0, 100] was not rejected");
        assert!(err.reason.contains("final offset"), "{}", err.reason);

        let err = find_pattern_batch(b"ATCGATCG", &[0, 4, 2, 8], b"ATCG", 0, false)
            .expect_err("non-monotonic offsets [0, 4, 2, 8] were not rejected");
        assert!(err.reason.contains("non-monotonic"), "{}", err.reason);
    }

    #[test]
    fn find_pattern_batch_iupac_degenerate() {
        // N in pattern matches any base
        let (data, offsets) = make_batch(&[b"AAAAGATCAAAA"]);
        let result = find_pattern_batch(&data, &offsets, b"NATC", 0, false)
            .expect("offset validation rejected a well-formed batch");

        let s0_start = result.match_offsets[0] as usize;
        let s0_end = result.match_offsets[1] as usize;
        assert!(s0_end > s0_start, "IUPAC N should produce matches");
        let idx = (s0_start..s0_end)
            .find(|&i| result.starts[i] == 4)
            .expect("should find match at position 4");
        assert_eq!(result.costs[idx], 0, "IUPAC match should have cost 0");
    }

    #[test]
    fn find_pattern_batch_multiple_matches_per_sequence() {
        // Two occurrences of GATC
        let (data, offsets) = make_batch(&[b"GATCTTTTGATC"]);
        let result = find_pattern_batch(&data, &offsets, b"GATC", 0, false)
            .expect("offset validation rejected a well-formed batch");

        let s0_start = result.match_offsets[0] as usize;
        let s0_end = result.match_offsets[1] as usize;
        assert!(
            s0_end - s0_start >= 2,
            "expected at least 2 matches, got {}",
            s0_end - s0_start
        );
        let match_starts: Vec<u32> = (s0_start..s0_end).map(|i| result.starts[i]).collect();
        assert!(match_starts.contains(&0), "should find match at position 0");
        assert!(match_starts.contains(&8), "should find match at position 8");
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

    // ── hash_batch tests ──────────────────────────────────────────────

    /// Helper to extract the i-th 128-bit hash from a `hash_batch` result buffer.
    fn extract_hash(buf: &[u8], index: usize) -> u128 {
        let start = index * 16;
        let bytes: [u8; 16] = buf[start..start + 16]
            .try_into()
            .expect("hash buffer should contain 16 bytes per sequence");
        u128::from_le_bytes(bytes)
    }

    #[test]
    fn hash_batch_deterministic() {
        let (data, offsets) = make_batch(&[b"ATCGATCG", b"GGGGGGGG"]);
        let result1 = hash_batch(&data, &offsets, false).expect("hash_batch should succeed");
        let result2 = hash_batch(&data, &offsets, false).expect("hash_batch should succeed");
        assert_eq!(
            result1.as_ref(),
            result2.as_ref(),
            "hashes should be deterministic"
        );
    }

    #[test]
    fn hash_batch_distinct_sequences_produce_distinct_hashes() {
        let (data, offsets) = make_batch(&[b"ATCGATCG", b"GGGGGGGG", b"CCCCCCCC"]);
        let result = hash_batch(&data, &offsets, false).expect("hash_batch should succeed");
        let h0 = extract_hash(&result, 0);
        let h1 = extract_hash(&result, 1);
        let h2 = extract_hash(&result, 2);
        assert_ne!(
            h0, h1,
            "different sequences should produce different hashes"
        );
        assert_ne!(
            h1, h2,
            "different sequences should produce different hashes"
        );
        assert_ne!(
            h0, h2,
            "different sequences should produce different hashes"
        );
    }

    #[test]
    fn hash_batch_identical_sequences_produce_identical_hashes() {
        let (data, offsets) = make_batch(&[b"ATCGATCG", b"ATCGATCG"]);
        let result = hash_batch(&data, &offsets, false).expect("hash_batch should succeed");
        let h0 = extract_hash(&result, 0);
        let h1 = extract_hash(&result, 1);
        assert_eq!(
            h0, h1,
            "identical sequences should produce identical hashes"
        );
    }

    #[test]
    fn hash_batch_case_insensitive_folds_case() {
        let (data1, offsets1) = make_batch(&[b"ATCGATCG"]);
        let (data2, offsets2) = make_batch(&[b"atcgatcg"]);
        let r1 = hash_batch(&data1, &offsets1, true).expect("hash_batch should succeed");
        let r2 = hash_batch(&data2, &offsets2, true).expect("hash_batch should succeed");
        assert_eq!(
            extract_hash(&r1, 0),
            extract_hash(&r2, 0),
            "case-insensitive hashes should match regardless of case"
        );
    }

    #[test]
    fn hash_batch_case_sensitive_distinguishes_case() {
        let (data1, offsets1) = make_batch(&[b"ATCGATCG"]);
        let (data2, offsets2) = make_batch(&[b"atcgatcg"]);
        let r1 = hash_batch(&data1, &offsets1, false).expect("hash_batch should succeed");
        let r2 = hash_batch(&data2, &offsets2, false).expect("hash_batch should succeed");
        assert_ne!(
            extract_hash(&r1, 0),
            extract_hash(&r2, 0),
            "case-sensitive hashes should differ for different cases"
        );
    }

    #[test]
    fn hash_batch_output_length_correct() {
        let (data, offsets) = make_batch(&[b"AA", b"CC", b"GG"]);
        let result = hash_batch(&data, &offsets, false).expect("hash_batch should succeed");
        assert_eq!(
            result.len(),
            3 * 16,
            "output should be 16 bytes per sequence"
        );
    }

    #[test]
    fn hash_batch_empty_returns_empty() {
        let result =
            hash_batch(&[], &[0], false).expect("empty batch with sentinel offset [0] is valid");
        assert!(result.is_empty());
    }

    #[test]
    fn hash_batch_empty_sequence_hashes_consistently() {
        let (data, offsets) = make_batch(&[b"", b""]);
        let result = hash_batch(&data, &offsets, false).expect("hash_batch should succeed");
        let h0 = extract_hash(&result, 0);
        let h1 = extract_hash(&result, 1);
        assert_eq!(h0, h1, "two empty sequences should hash identically");
    }

    #[test]
    fn hash_batch_rejects_out_of_bounds_offsets() {
        let err = hash_batch(b"ATCG", &[0, 100], false)
            .err()
            .expect("out-of-bounds offset [0, 100] was not rejected");
        assert!(err.reason.contains("final offset"), "{}", err.reason);
    }

    #[test]
    fn hash_batch_rejects_non_monotonic_offsets() {
        let err = hash_batch(b"ATCGATCG", &[0, 8, 4], false)
            .err()
            .expect("non-monotonic offsets [0, 8, 4] were not rejected");
        assert!(err.reason.contains("non-monotonic"), "{}", err.reason);
    }

    #[test]
    fn hash_batch_single_sequence() {
        let (data, offsets) = make_batch(&[b"ATCGATCG"]);
        let result = hash_batch(&data, &offsets, false).expect("hash_batch should succeed");
        assert_eq!(result.len(), 16, "single sequence should produce 16 bytes");
        // Verify it matches a second call (determinism for single-element batch)
        let result2 = hash_batch(&data, &offsets, false).expect("hash_batch should succeed");
        assert_eq!(result.as_ref(), result2.as_ref());
    }

    #[test]
    fn hash_batch_mixed_case_folds_correctly() {
        let (data1, offsets1) = make_batch(&[b"AtCgAtCg"]);
        let (data2, offsets2) = make_batch(&[b"aTcGaTcG"]);
        let (data3, offsets3) = make_batch(&[b"atcgatcg"]);
        let r1 = hash_batch(&data1, &offsets1, true).expect("hash_batch should succeed");
        let r2 = hash_batch(&data2, &offsets2, true).expect("hash_batch should succeed");
        let r3 = hash_batch(&data3, &offsets3, true).expect("hash_batch should succeed");
        let h1 = extract_hash(&r1, 0);
        let h2 = extract_hash(&r2, 0);
        let h3 = extract_hash(&r3, 0);
        assert_eq!(
            h1, h2,
            "mixed-case sequences should hash identically when case-insensitive"
        );
        assert_eq!(
            h2, h3,
            "mixed-case should match all-lowercase when case-insensitive"
        );
    }

    #[test]
    fn hash_batch_long_sequence_case_insensitive() {
        // Exceeds the STACK_LIMIT (4096) to exercise the heap fallback path
        let long_upper: Vec<u8> = b"ATCG".iter().cycle().take(5000).copied().collect();
        let long_lower: Vec<u8> = long_upper.iter().map(|&b| b | 0x20).collect();
        let (data1, offsets1) = make_batch(&[&long_upper]);
        let (data2, offsets2) = make_batch(&[&long_lower]);
        let r1 = hash_batch(&data1, &offsets1, true).expect("hash_batch should succeed");
        let r2 = hash_batch(&data2, &offsets2, true).expect("hash_batch should succeed");
        assert_eq!(
            extract_hash(&r1, 0),
            extract_hash(&r2, 0),
            "case-insensitive hashing should work for sequences exceeding stack buffer"
        );
    }
}

#[cfg(test)]
mod bench;
