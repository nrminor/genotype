//! Presentation-agnostic compute engine for genotype.
//!
//! This crate contains all SIMD-accelerated genomic data processing logic
//! with no FFI dependencies. Adapter crates (napi, wasm-bindgen) provide
//! thin wrappers that convert between their respective FFI types and the
//! plain Rust types used here.
//!
//! Batch-level functions take packed `(&[u8], &[u32])` inputs and return
//! `Result<T, EngineError>`. Rayon parallelism is used where beneficial.

#![feature(portable_simd)]
#![allow(clippy::must_use_candidate)]

pub mod classify;
pub mod grep;
pub mod hash;
pub mod metrics;
pub mod quality;
pub mod transform;
pub mod translate;

use rayon::prelude::*;

/// Errors originating from the engine layer.
#[derive(Debug)]
pub enum EngineError {
    /// The offset array is malformed (non-monotonic or out of bounds).
    InvalidOffsets(String),
    /// A lookup table or parameter has the wrong length.
    InvalidArgument(String),
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidOffsets(msg) | Self::InvalidArgument(msg) => f.write_str(msg),
        }
    }
}

impl std::error::Error for EngineError {}

/// The result of a batch transform operation.
#[derive(Debug)]
pub struct TransformResult {
    pub data: Vec<u8>,
    pub offsets: Vec<u32>,
}

/// The result of a batch classify operation.
#[derive(Debug)]
pub struct ClassifyResult {
    pub counts: Vec<u32>,
}

/// CSR-style result for variable-length pattern match results.
#[derive(Debug)]
pub struct PatternSearchResult {
    pub starts: Vec<u32>,
    pub ends: Vec<u32>,
    pub costs: Vec<u32>,
    pub match_offsets: Vec<u32>,
}

/// Length-preserving byte-level transformations.
#[derive(Clone, Copy)]
pub enum TransformOp {
    Complement,
    ComplementRna,
    Reverse,
    ReverseComplement,
    ReverseComplementRna,
    ToRna,
    ToDna,
    UpperCase,
    LowerCase,
}

/// Validation modes for `check_valid_batch`.
#[derive(Clone, Copy)]
pub enum ValidationMode {
    StrictDna,
    NormalDna,
    StrictRna,
    NormalRna,
    Protein,
}

impl ValidationMode {
    fn to_classify_mode(self) -> classify::ValidMode {
        match self {
            Self::StrictDna => classify::ValidMode::StrictDna,
            Self::NormalDna => classify::ValidMode::NormalDna,
            Self::StrictRna => classify::ValidMode::StrictRna,
            Self::NormalRna => classify::ValidMode::NormalRna,
            Self::Protein => classify::ValidMode::Protein,
        }
    }
}

fn validate_offsets(offsets: &[u32], data_len: usize) -> Result<(), EngineError> {
    if let Some(&last) = offsets.last() {
        if last as usize > data_len {
            return Err(EngineError::InvalidOffsets(format!(
                "batch: final offset ({last}) exceeds data length ({data_len})"
            )));
        }
    }
    for window in offsets.windows(2) {
        if window[0] > window[1] {
            return Err(EngineError::InvalidOffsets(format!(
                "batch: non-monotonic offsets ({}..{})",
                window[0], window[1]
            )));
        }
    }
    Ok(())
}

fn num_sequences(offsets: &[u32]) -> usize {
    offsets.len().saturating_sub(1)
}

/// Search a batch of sequences for a pattern within a given edit distance.
///
/// Returns a `Vec<u8>` of length `num_sequences` where each byte is 1 if
/// the corresponding sequence contains the pattern, 0 otherwise.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed.
pub fn grep_batch(
    sequences: &[u8],
    offsets: &[u32],
    pattern: &[u8],
    max_edits: u32,
    case_insensitive: bool,
    search_both_strands: bool,
) -> Result<Vec<u8>, EngineError> {
    validate_offsets(offsets, sequences.len())?;

    let n = num_sequences(offsets);
    let results: Vec<u8> = (0..n)
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

    Ok(results)
}

/// Find all pattern matches with positions and edit distances in a batch.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed.
#[allow(clippy::cast_possible_truncation)]
pub fn find_pattern_batch(
    sequences: &[u8],
    offsets: &[u32],
    pattern: &[u8],
    max_edits: u32,
    case_insensitive: bool,
) -> Result<PatternSearchResult, EngineError> {
    validate_offsets(offsets, sequences.len())?;

    let n = num_sequences(offsets);
    let per_seq: Vec<grep::PerSeqMatches> = (0..n)
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
    let mut match_offsets = Vec::with_capacity(n + 1);
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

/// Apply a length-preserving byte-level transformation to every sequence.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed.
#[allow(clippy::cast_possible_truncation)]
pub fn transform_batch(
    sequences: &[u8],
    offsets: &[u32],
    op: TransformOp,
) -> Result<TransformResult, EngineError> {
    validate_offsets(offsets, sequences.len())?;

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
        data: out_data,
        offsets: out_offsets,
    })
}

/// Remove gap characters from every sequence in a packed batch.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed.
#[allow(clippy::cast_possible_truncation)]
pub fn remove_gaps_batch(
    sequences: &[u8],
    offsets: &[u32],
    gap_chars: &str,
) -> Result<TransformResult, EngineError> {
    validate_offsets(offsets, sequences.len())?;

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
        data: out_data,
        offsets: out_offsets,
    })
}

/// Replace non-standard bases with a replacement character.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed.
#[allow(clippy::cast_possible_truncation)]
pub fn replace_ambiguous_batch(
    sequences: &[u8],
    offsets: &[u32],
    replacement: &str,
) -> Result<TransformResult, EngineError> {
    validate_offsets(offsets, sequences.len())?;

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
        data: out_data,
        offsets: out_offsets,
    })
}

/// Replace bytes not in the allowed character set for the given mode.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed.
#[allow(clippy::cast_possible_truncation)]
pub fn replace_invalid_batch(
    sequences: &[u8],
    offsets: &[u32],
    mode: ValidationMode,
    replacement: &str,
) -> Result<TransformResult, EngineError> {
    validate_offsets(offsets, sequences.len())?;

    let replacement_byte = replacement.as_bytes().first().copied().unwrap_or(b'N');
    let valid_mode = mode.to_classify_mode();

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
        data: out_data,
        offsets: out_offsets,
    })
}

/// Classify every byte in every sequence into one of 12 classes.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed.
#[allow(clippy::cast_possible_truncation)]
pub fn classify_batch(sequences: &[u8], offsets: &[u32]) -> Result<ClassifyResult, EngineError> {
    validate_offsets(offsets, sequences.len())?;

    let n = num_sequences(offsets);
    let per_seq: Vec<[u32; classify::NUM_CLASSES]> = (0..n)
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

    let mut all_counts = Vec::with_capacity(n * classify::NUM_CLASSES);
    for counts in &per_seq {
        all_counts.extend_from_slice(counts);
    }

    Ok(ClassifyResult { counts: all_counts })
}

/// Check whether every byte in every sequence belongs to the allowed character set.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed.
#[allow(clippy::cast_possible_truncation)]
pub fn check_valid_batch(
    sequences: &[u8],
    offsets: &[u32],
    mode: ValidationMode,
) -> Result<Vec<u8>, EngineError> {
    validate_offsets(offsets, sequences.len())?;

    let n = num_sequences(offsets);
    let mut results = vec![0u8; n];
    let valid_mode = mode.to_classify_mode();

    for (i, window) in offsets.windows(2).enumerate() {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let seq = &sequences[start..end];
        results[i] = u8::from(classify::check_valid(seq, valid_mode));
    }

    Ok(results)
}

/// Compute the average quality score for each sequence in a batch.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed.
#[allow(clippy::cast_possible_truncation)]
pub fn quality_avg_batch(
    quality_data: &[u8],
    offsets: &[u32],
    ascii_offset: u8,
) -> Result<Vec<f64>, EngineError> {
    validate_offsets(offsets, quality_data.len())?;

    let n = num_sequences(offsets);
    let mut results = Vec::with_capacity(n);

    for window in offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let qual = &quality_data[start..end];
        results.push(quality::quality_avg(qual, ascii_offset));
    }

    Ok(results)
}

/// Find trim positions for each sequence using a sliding window quality threshold.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed.
#[allow(clippy::cast_possible_truncation)]
pub fn quality_trim_batch(
    quality_data: &[u8],
    offsets: &[u32],
    ascii_offset: u8,
    threshold: f64,
    window_size: u32,
    trim_start: bool,
    trim_end: bool,
) -> Result<Vec<u32>, EngineError> {
    validate_offsets(offsets, quality_data.len())?;

    let n = num_sequences(offsets);
    let threshold_sum = (threshold + f64::from(ascii_offset)) * f64::from(window_size);
    let mut results = Vec::with_capacity(n * 2);

    for window in offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let qual = &quality_data[start..end];
        let (trim_s, trim_e) =
            quality::quality_trim(qual, window_size, trim_start, trim_end, threshold_sum);
        results.push(trim_s);
        results.push(trim_e);
    }

    Ok(results)
}

/// Remap quality bytes into fewer bins.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed,
/// or `EngineError::InvalidArgument` if boundary/representative lengths
/// are inconsistent.
#[allow(clippy::cast_possible_truncation)]
pub fn quality_bin_batch(
    quality_data: &[u8],
    offsets: &[u32],
    boundaries: &[u8],
    representatives: &[u8],
) -> Result<TransformResult, EngineError> {
    validate_offsets(offsets, quality_data.len())?;

    if boundaries.is_empty() || representatives.len() != boundaries.len() + 1 {
        return Err(EngineError::InvalidArgument(format!(
            "quality_bin_batch: expected representatives.len() == boundaries.len() + 1, \
             got boundaries={}, representatives={}",
            boundaries.len(),
            representatives.len()
        )));
    }

    let mut out_data = vec![0u8; quality_data.len()];
    let out_offsets: Vec<u32> = offsets.to_vec();

    for window in offsets.windows(2) {
        let start = window[0] as usize;
        let end = window[1] as usize;
        let qual = &quality_data[start..end];
        let dest = &mut out_data[start..end];
        quality::quality_bin(qual, dest, boundaries, representatives);
    }

    Ok(TransformResult {
        data: out_data,
        offsets: out_offsets,
    })
}

/// Compute built-in per-sequence metrics for a packed batch.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if either offset array is malformed,
/// or `EngineError::InvalidArgument` if the sequence and quality batches
/// describe different numbers of records.
#[allow(clippy::cast_possible_truncation)]
pub fn sequence_metrics_batch(
    sequences: &[u8],
    seq_offsets: &[u32],
    quality_data: &[u8],
    qual_offsets: &[u32],
    metric_flags: u32,
    ascii_offset: u8,
) -> Result<metrics::SequenceMetricsResult, EngineError> {
    validate_offsets(seq_offsets, sequences.len())?;
    validate_offsets(qual_offsets, quality_data.len())?;

    if seq_offsets.len() != qual_offsets.len() {
        return Err(EngineError::InvalidArgument(
            "sequence_metrics_batch: sequence and quality offsets must have the same length"
                .to_owned(),
        ));
    }

    let n = num_sequences(seq_offsets);
    let needs_qual = metric_flags
        & (metrics::METRIC_AVG_QUAL | metrics::METRIC_MIN_QUAL | metrics::METRIC_MAX_QUAL)
        != 0;

    let rows: Vec<_> = (0..n)
        .into_par_iter()
        .map(|i| {
            let seq_start = seq_offsets[i] as usize;
            let seq_end = seq_offsets[i + 1] as usize;
            let seq = &sequences[seq_start..seq_end];

            let qual_start = qual_offsets[i] as usize;
            let qual_end = qual_offsets[i + 1] as usize;
            let qual = &quality_data[qual_start..qual_end];

            metrics::compute_row(seq, qual, needs_qual)
        })
        .collect();

    Ok(metrics::materialize(&rows, metric_flags, ascii_offset))
}

/// Translate a packed batch of nucleotide sequences into proteins.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed,
/// or `EngineError::InvalidArgument` if any lookup table has the wrong
/// length or `frame_offset` is outside 0..=2.
#[allow(clippy::cast_possible_truncation)]
pub fn translate_batch(
    sequences: &[u8],
    offsets: &[u32],
    translation_lut: &[u8],
    start_mask: &[u8],
    alternative_start_mask: &[u8],
    options: &translate::TranslateOptions,
) -> Result<TransformResult, EngineError> {
    validate_offsets(offsets, sequences.len())?;

    if translation_lut.len() != translate::CODON_LUT_LEN {
        return Err(EngineError::InvalidArgument(
            "translate_batch: translation lookup table must have length 4096".to_owned(),
        ));
    }
    if start_mask.len() != translate::EXACT_CODON_TABLE_LEN {
        return Err(EngineError::InvalidArgument(
            "translate_batch: start mask must have length 64".to_owned(),
        ));
    }
    if alternative_start_mask.len() != translate::EXACT_CODON_TABLE_LEN {
        return Err(EngineError::InvalidArgument(
            "translate_batch: alternative start mask must have length 64".to_owned(),
        ));
    }
    if options.frame_offset > 2 {
        return Err(EngineError::InvalidArgument(
            "translate_batch: frame_offset must be 0, 1, or 2".to_owned(),
        ));
    }

    let n = num_sequences(offsets);
    let proteins: Vec<Vec<u8>> = (0..n)
        .into_par_iter()
        .map(|i| {
            let start = offsets[i] as usize;
            let end = offsets[i + 1] as usize;
            let seq = &sequences[start..end];
            translate::translate_one(
                seq,
                translation_lut,
                start_mask,
                alternative_start_mask,
                options,
            )
        })
        .collect();

    let total_len: usize = proteins.iter().map(Vec::len).sum();
    let mut data = Vec::with_capacity(total_len);
    let mut out_offsets = Vec::with_capacity(n + 1);
    out_offsets.push(0);

    for protein in proteins {
        data.extend_from_slice(&protein);
        out_offsets.push(data.len() as u32);
    }

    Ok(TransformResult {
        data,
        offsets: out_offsets,
    })
}

/// Hash every sequence in a packed batch using XXH3-128.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` if the offset array is malformed.
pub fn hash_batch(
    sequences: &[u8],
    offsets: &[u32],
    case_insensitive: bool,
) -> Result<Vec<u8>, EngineError> {
    validate_offsets(offsets, sequences.len())?;

    let n = num_sequences(offsets);
    let mut out = vec![0u8; n * 16];

    out.par_chunks_exact_mut(16)
        .enumerate()
        .for_each(|(i, slot)| {
            let start = offsets[i] as usize;
            let end = offsets[i + 1] as usize;
            let seq = &sequences[start..end];
            let h = hash::hash_one(seq, case_insensitive);
            slot.copy_from_slice(&h.to_le_bytes());
        });

    Ok(out)
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

    fn extract_hash(buf: &[u8], index: usize) -> u128 {
        let start = index * 16;
        let bytes: [u8; 16] = buf[start..start + 16]
            .try_into()
            .expect("hash buffer should contain 16 bytes per sequence");
        u128::from_le_bytes(bytes)
    }

    // ── grep_batch ───────────────────────────────────────────────

    #[test]
    fn grep_exact_match() {
        let (data, offsets) = make_batch(&[b"ATCGATCG", b"GGGGGGGG", b"XXGATCXX"]);
        let results = grep_batch(&data, &offsets, b"GATC", 0, false, false).unwrap();
        assert_eq!(results.as_slice(), &[1, 0, 1]);
    }

    #[test]
    fn grep_approximate_match() {
        let (data, offsets) = make_batch(&[b"ATCGTTCG", b"TTTTTTTT"]);
        let results = grep_batch(&data, &offsets, b"GATC", 1, false, false).unwrap();
        assert_eq!(results.as_slice(), &[1, 0]);
    }

    #[test]
    fn grep_case_insensitive() {
        let (data, offsets) = make_batch(&[b"atcgatcg", b"ATCGATCG"]);
        let results = grep_batch(&data, &offsets, b"GATC", 0, true, false).unwrap();
        assert_eq!(results.as_slice(), &[1, 1]);
    }

    #[test]
    fn grep_reverse_complement() {
        let (data, offsets) = make_batch(&[b"CGATAAAA", b"TTTTTTTT"]);
        let results = grep_batch(&data, &offsets, b"ATCG", 0, false, true).unwrap();
        assert_eq!(results.as_slice(), &[1, 0]);
    }

    #[test]
    fn grep_empty_batch() {
        let results = grep_batch(&[], &[0], b"GATC", 0, false, false).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn grep_empty_offsets() {
        let results = grep_batch(&[], &[], b"GATC", 0, false, false).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn grep_single_sequence() {
        let (data, offsets) = make_batch(&[b"ATCGATCG"]);
        let results = grep_batch(&data, &offsets, b"GATC", 0, false, false).unwrap();
        assert_eq!(results.as_slice(), &[1]);
    }

    #[test]
    fn grep_empty_pattern_is_all_zeros() {
        let (data, offsets) = make_batch(&[b"ATCG", b"GATC"]);
        let results = grep_batch(&data, &offsets, b"", 0, false, false).unwrap();
        assert_eq!(results.as_slice(), &[0, 0]);
    }

    #[test]
    fn grep_rejects_offset_beyond_sequences() {
        let err = grep_batch(b"ATCG", &[0, 10], b"ATCG", 0, false, false).unwrap_err();
        assert!(err.to_string().contains("final offset"), "{err}");
    }

    #[test]
    fn grep_rejects_non_monotonic_offsets() {
        let err = grep_batch(b"ATCGATCG", &[0, 4, 2, 8], b"ATCG", 0, false, false).unwrap_err();
        assert!(err.to_string().contains("non-monotonic"), "{err}");
    }

    // ── find_pattern_batch ───────────────────────────────────────

    #[test]
    fn find_pattern_csr_results() {
        let (data, offsets) = make_batch(&[b"ATCGATCG", b"TTTTTTTT", b"GATCAAAA"]);
        let result = find_pattern_batch(&data, &offsets, b"GATC", 0, false).unwrap();

        assert_eq!(result.match_offsets.len(), 4);

        let s0_start = result.match_offsets[0] as usize;
        let s0_end = result.match_offsets[1] as usize;
        assert_eq!(s0_end - s0_start, 1);
        assert_eq!(result.starts[s0_start], 3);
        assert_eq!(result.ends[s0_start], 7);
        assert_eq!(result.costs[s0_start], 0);

        let s1_start = result.match_offsets[1] as usize;
        let s1_end = result.match_offsets[2] as usize;
        assert_eq!(s1_end - s1_start, 0);

        let s2_start = result.match_offsets[2] as usize;
        let s2_end = result.match_offsets[3] as usize;
        assert_eq!(s2_end - s2_start, 1);
        assert_eq!(result.starts[s2_start], 0);
        assert_eq!(result.ends[s2_start], 4);
    }

    #[test]
    fn find_pattern_approximate() {
        let (data, offsets) = make_batch(&[b"AAAAGTTCAAAA", b"TTTTTTTTTTTT"]);
        let result = find_pattern_batch(&data, &offsets, b"GATC", 1, false).unwrap();

        let s0_start = result.match_offsets[0] as usize;
        let s0_end = result.match_offsets[1] as usize;
        assert!(s0_end > s0_start);

        let idx = (s0_start..s0_end)
            .find(|&i| result.starts[i] == 4)
            .expect("should find match starting at position 4");
        assert_eq!(result.ends[idx], 8);
        assert_eq!(result.costs[idx], 1);

        let s1_start = result.match_offsets[1] as usize;
        let s1_end = result.match_offsets[2] as usize;
        assert_eq!(s1_end - s1_start, 0);
    }

    #[test]
    fn find_pattern_iupac_degenerate() {
        let (data, offsets) = make_batch(&[b"AAAAGATCAAAA"]);
        let result = find_pattern_batch(&data, &offsets, b"NATC", 0, false).unwrap();

        let s0_start = result.match_offsets[0] as usize;
        let s0_end = result.match_offsets[1] as usize;
        assert!(s0_end > s0_start);
        let idx = (s0_start..s0_end)
            .find(|&i| result.starts[i] == 4)
            .expect("should find match at position 4");
        assert_eq!(result.costs[idx], 0);
    }

    #[test]
    fn find_pattern_multiple_matches() {
        let (data, offsets) = make_batch(&[b"GATCTTTTGATC"]);
        let result = find_pattern_batch(&data, &offsets, b"GATC", 0, false).unwrap();

        let s0_start = result.match_offsets[0] as usize;
        let s0_end = result.match_offsets[1] as usize;
        assert!(s0_end - s0_start >= 2);
        let starts: Vec<u32> = (s0_start..s0_end).map(|i| result.starts[i]).collect();
        assert!(starts.contains(&0));
        assert!(starts.contains(&8));
    }

    #[test]
    fn find_pattern_empty() {
        let result = find_pattern_batch(&[], &[0], b"GATC", 0, false).unwrap();
        assert!(result.starts.is_empty());
        assert_eq!(result.match_offsets, vec![0]);
    }

    #[test]
    fn find_pattern_rejects_malformed_offsets() {
        let err = find_pattern_batch(b"ATCG", &[0, 100], b"ATCG", 0, false).unwrap_err();
        assert!(err.to_string().contains("final offset"), "{err}");

        let err = find_pattern_batch(b"ATCGATCG", &[0, 4, 2, 8], b"ATCG", 0, false).unwrap_err();
        assert!(err.to_string().contains("non-monotonic"), "{err}");
    }

    // ── transform_batch ──────────────────────────────────────────

    #[test]
    fn transform_complement() {
        let (data, offsets) = make_batch(&[b"ATCG", b"aacc"]);
        let result = transform_batch(&data, &offsets, TransformOp::Complement).unwrap();
        assert_eq!(result.data.as_slice(), b"TAGCttgg");
        assert_eq!(result.offsets, vec![0, 4, 8]);
    }

    #[test]
    fn transform_reverse() {
        let (data, offsets) = make_batch(&[b"ATCG", b"AB"]);
        let result = transform_batch(&data, &offsets, TransformOp::Reverse).unwrap();
        assert_eq!(result.data.as_slice(), b"GCTABA");
        assert_eq!(result.offsets, vec![0, 4, 6]);
    }

    // ── remove_gaps_batch ────────────────────────────────────────

    #[test]
    fn remove_gaps_compacts() {
        let (data, offsets) = make_batch(&[b"A-T-C", b"GG"]);
        let result = remove_gaps_batch(&data, &offsets, "").unwrap();
        assert_eq!(result.data.as_slice(), b"ATCGG");
        assert_eq!(result.offsets, vec![0, 3, 5]);
    }

    // ── classify_batch ───────────────────────────────────────────

    #[test]
    fn classify_flattens_counts() {
        let (data, offsets) = make_batch(&[b"AAAA", b"", b"GG"]);
        let result = classify_batch(&data, &offsets).unwrap();
        assert_eq!(result.counts.len(), 3 * classify::NUM_CLASSES);

        let count_at =
            |seq: usize, class: usize| result.counts[seq * classify::NUM_CLASSES + class];

        assert_eq!(count_at(0, classify::CLASS_A), 4);
        assert_eq!(count_at(0, classify::CLASS_G), 0);
        for c in 0..classify::NUM_CLASSES {
            assert_eq!(count_at(1, c), 0, "empty seq class {c}");
        }
        assert_eq!(count_at(2, classify::CLASS_G), 2);
    }

    #[test]
    fn classify_matches_per_slice_calls() {
        let seqs: &[&[u8]] = &[b"ATCGNrykm", b"SSWWssw", b"---...**"];
        let (data, offsets) = make_batch(seqs);
        let result = classify_batch(&data, &offsets).unwrap();

        for (i, seq) in seqs.iter().enumerate() {
            let mut expected = [0u32; classify::NUM_CLASSES];
            classify::classify(seq, &mut expected);
            let start = i * classify::NUM_CLASSES;
            let actual = &result.counts[start..start + classify::NUM_CLASSES];
            assert_eq!(actual, &expected, "seq {i}");
        }
    }

    #[test]
    fn classify_empty() {
        let result = classify_batch(&[], &[0]).unwrap();
        assert!(result.counts.is_empty());
    }

    #[test]
    fn classify_rejects_malformed_offsets() {
        let err = classify_batch(b"ATCG", &[0, 100]).unwrap_err();
        assert!(err.to_string().contains("final offset"), "{err}");

        let err = classify_batch(b"ATCGATCG", &[0, 4, 2, 8]).unwrap_err();
        assert!(err.to_string().contains("non-monotonic"), "{err}");
    }

    // ── check_valid_batch ────────────────────────────────────────

    #[test]
    fn check_valid_per_sequence_flags() {
        let (data, offsets) = make_batch(&[b"ACGT", b"ACGX", b"acgt"]);
        let result = check_valid_batch(&data, &offsets, ValidationMode::StrictDna).unwrap();
        assert_eq!(result.as_slice(), &[1, 0, 1]);
    }

    #[test]
    fn check_valid_empty() {
        let result = check_valid_batch(&[], &[0], ValidationMode::StrictDna).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn check_valid_rejects_malformed_offsets() {
        let err = check_valid_batch(b"ATCG", &[0, 100], ValidationMode::StrictDna).unwrap_err();
        assert!(err.to_string().contains("final offset"), "{err}");
    }

    // ── replace_invalid_batch ────────────────────────────────────

    #[test]
    fn replace_invalid_fixes_bytes() {
        let (data, offsets) = make_batch(&[b"ACGT", b"ACGX", b"acgt"]);
        let result =
            replace_invalid_batch(&data, &offsets, ValidationMode::StrictDna, "N").unwrap();
        assert_eq!(result.data.as_slice(), b"ACGTACGNacgt");
        assert_eq!(result.offsets, vec![0, 4, 8, 12]);
    }

    #[test]
    fn replace_invalid_empty() {
        let result = replace_invalid_batch(&[], &[0], ValidationMode::StrictDna, "N").unwrap();
        assert!(result.data.is_empty());
    }

    #[test]
    fn replace_invalid_rejects_malformed_offsets() {
        let err =
            replace_invalid_batch(b"ATCG", &[0, 100], ValidationMode::StrictDna, "N").unwrap_err();
        assert!(err.to_string().contains("final offset"), "{err}");
    }

    // ── quality_avg_batch ────────────────────────────────────────

    #[test]
    fn quality_avg_matches_per_sequence() {
        let seqs: &[&[u8]] = &[b"IIIIIIIII", b"!!!!", b"", b"5"];
        let (data, offsets) = make_batch(seqs);
        let results = quality_avg_batch(&data, &offsets, 33).unwrap();

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
    fn quality_avg_empty() {
        let results = quality_avg_batch(&[], &[0], 33).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn quality_avg_rejects_malformed_offsets() {
        let err = quality_avg_batch(b"IIII", &[0, 100], 33).unwrap_err();
        assert!(err.to_string().contains("final offset"), "{err}");

        let err = quality_avg_batch(b"IIIIIIII", &[0, 4, 2, 8], 33).unwrap_err();
        assert!(err.to_string().contains("non-monotonic"), "{err}");
    }

    // ── quality_trim_batch ───────────────────────────────────────

    #[test]
    fn quality_trim_matches_per_sequence() {
        let seqs: &[&[u8]] = &[b"!!!IIIIII!!!", b"IIIIIIIIII", b"!!!!!!!!!!", b""];
        let (data, offsets) = make_batch(seqs);
        let results = quality_trim_batch(&data, &offsets, 33, 20.0, 4, true, true).unwrap();

        assert_eq!(results.len(), seqs.len() * 2);
        let threshold_sum = (20.0 + 33.0) * 4.0;
        for (i, seq) in seqs.iter().enumerate() {
            let (exp_s, exp_e) = quality::quality_trim(seq, 4, true, true, threshold_sum);
            assert_eq!(results[i * 2], exp_s, "sequence {i}: start mismatch");
            assert_eq!(results[i * 2 + 1], exp_e, "sequence {i}: end mismatch");
        }
    }

    #[test]
    fn quality_trim_empty() {
        let results = quality_trim_batch(&[], &[0], 33, 20.0, 4, true, true).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn quality_trim_rejects_malformed_offsets() {
        let err = quality_trim_batch(b"IIII", &[0, 100], 33, 20.0, 4, true, true).unwrap_err();
        assert!(err.to_string().contains("final offset"), "{err}");
    }

    // ── quality_bin_batch ────────────────────────────────────────

    #[test]
    fn quality_bin_matches_per_sequence() {
        let boundaries: &[u8] = &[48, 63];
        let representatives: &[u8] = &[40, 55, 73];

        let seqs: &[&[u8]] = &[b"!!!!!!!!!!", b"5555555555", b"IIIIIIIIII", b"!5I", b""];
        let (data, offsets) = make_batch(seqs);
        let result = quality_bin_batch(&data, &offsets, boundaries, representatives).unwrap();

        assert_eq!(result.offsets, offsets);
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
    fn quality_bin_empty() {
        let result = quality_bin_batch(&[], &[0], &[53], &[40, 63]).unwrap();
        assert!(result.data.is_empty());
        assert_eq!(result.offsets, vec![0]);
    }

    #[test]
    fn quality_bin_rejects_malformed_offsets() {
        let err = quality_bin_batch(b"IIII", &[0, 100], &[53], &[40, 63]).unwrap_err();
        assert!(err.to_string().contains("final offset"), "{err}");
    }

    #[test]
    fn quality_bin_rejects_inconsistent_lengths() {
        let err = quality_bin_batch(b"IIII", &[0, 4], &[53], &[40]).unwrap_err();
        assert!(err.to_string().contains("representatives"), "{err}");
    }

    // ── sequence_metrics_batch ───────────────────────────────────

    #[test]
    fn sequence_metrics_computes_sequence_metrics() {
        let (data, offsets) = make_batch(&[b"ACGTN", b"GGCC"]);
        let (quality, qual_offsets) = make_batch(&[b"", b""]);

        let result = sequence_metrics_batch(
            &data,
            &offsets,
            &quality,
            &qual_offsets,
            metrics::METRIC_LENGTH
                | metrics::METRIC_GC
                | metrics::METRIC_AT
                | metrics::METRIC_GC_SKEW
                | metrics::METRIC_ENTROPY
                | metrics::METRIC_ALPHABET,
            33,
        )
        .unwrap();

        assert_eq!(result.lengths.expect("lengths requested"), vec![5, 4]);
        assert_eq!(result.gc.expect("gc requested"), vec![50.0, 100.0]);
        assert_eq!(result.at.expect("at requested"), vec![50.0, 0.0]);
        assert_eq!(result.gc_skew.expect("gc skew requested"), vec![0.0, 0.0]);
        assert_eq!(result.alphabet_mask.expect("alphabet requested").len(), 2);
        assert!(result.entropy.expect("entropy requested")[0] > 0.0);
    }

    #[test]
    fn sequence_metrics_computes_quality_metrics() {
        let (data, offsets) = make_batch(&[b"ACGT", b"TTTT"]);
        let (quality, qual_offsets) = make_batch(&[b"IIII", b"!?!?"]);

        let result = sequence_metrics_batch(
            &data,
            &offsets,
            &quality,
            &qual_offsets,
            metrics::METRIC_AVG_QUAL | metrics::METRIC_MIN_QUAL | metrics::METRIC_MAX_QUAL,
            33,
        )
        .unwrap();

        assert_eq!(result.avg_qual.expect("avg requested"), vec![40.0, 15.0]);
        assert_eq!(result.min_qual.expect("min requested"), vec![40, 0]);
        assert_eq!(result.max_qual.expect("max requested"), vec![40, 30]);
    }

    // ── hash_batch ───────────────────────────────────────────────

    #[test]
    fn hash_deterministic() {
        let (data, offsets) = make_batch(&[b"ATCGATCG", b"GGGGGGGG"]);
        let r1 = hash_batch(&data, &offsets, false).unwrap();
        let r2 = hash_batch(&data, &offsets, false).unwrap();
        assert_eq!(r1, r2);
    }

    #[test]
    fn hash_distinct_sequences() {
        let (data, offsets) = make_batch(&[b"ATCGATCG", b"GGGGGGGG", b"CCCCCCCC"]);
        let result = hash_batch(&data, &offsets, false).unwrap();
        let h0 = extract_hash(&result, 0);
        let h1 = extract_hash(&result, 1);
        let h2 = extract_hash(&result, 2);
        assert_ne!(h0, h1);
        assert_ne!(h1, h2);
        assert_ne!(h0, h2);
    }

    #[test]
    fn hash_identical_sequences() {
        let (data, offsets) = make_batch(&[b"ATCGATCG", b"ATCGATCG"]);
        let result = hash_batch(&data, &offsets, false).unwrap();
        assert_eq!(extract_hash(&result, 0), extract_hash(&result, 1));
    }

    #[test]
    fn hash_case_insensitive_folds() {
        let (d1, o1) = make_batch(&[b"ATCGATCG"]);
        let (d2, o2) = make_batch(&[b"atcgatcg"]);
        let r1 = hash_batch(&d1, &o1, true).unwrap();
        let r2 = hash_batch(&d2, &o2, true).unwrap();
        assert_eq!(extract_hash(&r1, 0), extract_hash(&r2, 0));
    }

    #[test]
    fn hash_case_sensitive_distinguishes() {
        let (d1, o1) = make_batch(&[b"ATCGATCG"]);
        let (d2, o2) = make_batch(&[b"atcgatcg"]);
        let r1 = hash_batch(&d1, &o1, false).unwrap();
        let r2 = hash_batch(&d2, &o2, false).unwrap();
        assert_ne!(extract_hash(&r1, 0), extract_hash(&r2, 0));
    }

    #[test]
    fn hash_output_length() {
        let (data, offsets) = make_batch(&[b"AA", b"CC", b"GG"]);
        let result = hash_batch(&data, &offsets, false).unwrap();
        assert_eq!(result.len(), 3 * 16);
    }

    #[test]
    fn hash_empty() {
        let result = hash_batch(&[], &[0], false).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn hash_empty_sequences_consistent() {
        let (data, offsets) = make_batch(&[b"", b""]);
        let result = hash_batch(&data, &offsets, false).unwrap();
        assert_eq!(extract_hash(&result, 0), extract_hash(&result, 1));
    }

    #[test]
    fn hash_rejects_out_of_bounds() {
        let err = hash_batch(b"ATCG", &[0, 100], false).unwrap_err();
        assert!(err.to_string().contains("final offset"), "{err}");
    }

    #[test]
    fn hash_rejects_non_monotonic() {
        let err = hash_batch(b"ATCGATCG", &[0, 8, 4], false).unwrap_err();
        assert!(err.to_string().contains("non-monotonic"), "{err}");
    }

    #[test]
    fn hash_mixed_case_folds() {
        let (d1, o1) = make_batch(&[b"AtCgAtCg"]);
        let (d2, o2) = make_batch(&[b"aTcGaTcG"]);
        let (d3, o3) = make_batch(&[b"atcgatcg"]);
        let h1 = extract_hash(&hash_batch(&d1, &o1, true).unwrap(), 0);
        let h2 = extract_hash(&hash_batch(&d2, &o2, true).unwrap(), 0);
        let h3 = extract_hash(&hash_batch(&d3, &o3, true).unwrap(), 0);
        assert_eq!(h1, h2);
        assert_eq!(h2, h3);
    }

    #[test]
    fn hash_long_sequence_case_insensitive() {
        let long_upper: Vec<u8> = b"ATCG".iter().cycle().take(5000).copied().collect();
        let long_lower: Vec<u8> = long_upper.iter().map(|&b| b | 0x20).collect();
        let (d1, o1) = make_batch(&[&long_upper]);
        let (d2, o2) = make_batch(&[&long_lower]);
        let r1 = hash_batch(&d1, &o1, true).unwrap();
        let r2 = hash_batch(&d2, &o2, true).unwrap();
        assert_eq!(extract_hash(&r1, 0), extract_hash(&r2, 0));
    }
}
