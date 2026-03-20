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
pub struct TransformResult {
    pub data: Vec<u8>,
    pub offsets: Vec<u32>,
}

/// The result of a batch classify operation.
pub struct ClassifyResult {
    pub counts: Vec<u32>,
}

/// CSR-style result for variable-length pattern match results.
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
