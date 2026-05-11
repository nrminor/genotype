//! Napi-rs adapter for the genotype compute engine.
//!
//! Each `#[napi]` function converts between napi types and the engine's
//! plain Rust types, then delegates to the corresponding engine batch
//! function. No compute logic lives here except for the alignment reader,
//! which remains napi-coupled pending a future extraction into the engine.

#![allow(clippy::must_use_candidate, clippy::missing_errors_doc)]

mod alignment;
mod fasta;
mod fastq;
mod sequence_sort;

use genotype_engine as engine;
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct TransformResult {
    pub data: Buffer,
    pub offsets: Vec<u32>,
}

impl From<engine::TransformResult> for TransformResult {
    fn from(r: engine::TransformResult) -> Self {
        Self {
            data: r.data.into(),
            offsets: r.offsets,
        }
    }
}

#[napi(object)]
pub struct ClassifyResult {
    pub counts: Vec<u32>,
}

#[napi(object)]
pub struct PatternSearchResult {
    pub starts: Vec<u32>,
    pub ends: Vec<u32>,
    pub costs: Vec<u32>,
    pub match_offsets: Vec<u32>,
}

#[napi(string_enum)]
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

impl From<TransformOp> for engine::TransformOp {
    fn from(op: TransformOp) -> Self {
        match op {
            TransformOp::Complement => Self::Complement,
            TransformOp::ComplementRna => Self::ComplementRna,
            TransformOp::Reverse => Self::Reverse,
            TransformOp::ReverseComplement => Self::ReverseComplement,
            TransformOp::ReverseComplementRna => Self::ReverseComplementRna,
            TransformOp::ToRna => Self::ToRna,
            TransformOp::ToDna => Self::ToDna,
            TransformOp::UpperCase => Self::UpperCase,
            TransformOp::LowerCase => Self::LowerCase,
        }
    }
}

#[napi(string_enum)]
pub enum ValidationMode {
    StrictDna,
    NormalDna,
    StrictRna,
    NormalRna,
    Protein,
}

impl From<ValidationMode> for engine::ValidationMode {
    fn from(m: ValidationMode) -> Self {
        match m {
            ValidationMode::StrictDna => Self::StrictDna,
            ValidationMode::NormalDna => Self::NormalDna,
            ValidationMode::StrictRna => Self::StrictRna,
            ValidationMode::NormalRna => Self::NormalRna,
            ValidationMode::Protein => Self::Protein,
        }
    }
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

#[napi(object)]
pub struct PairedReadMergeResult {
    pub status: Buffer,
    pub sequence_data: Buffer,
    pub sequence_offsets: Vec<u32>,
    pub quality_data: Buffer,
    pub quality_offsets: Vec<u32>,
}

impl From<engine::paired_merge::PairedReadMergeResult> for PairedReadMergeResult {
    fn from(r: engine::paired_merge::PairedReadMergeResult) -> Self {
        Self {
            status: r.status.into(),
            sequence_data: r.sequence_data.into(),
            sequence_offsets: r.sequence_offsets,
            quality_data: r.quality_data.into(),
            quality_offsets: r.quality_offsets,
        }
    }
}

#[derive(Clone)]
#[napi(string_enum)]
pub enum PairedReadOverlapTiePolicy {
    Reject,
    PreferFromStart,
    PreferFromEnd,
}

impl From<PairedReadOverlapTiePolicy> for engine::paired_merge::PairedReadOverlapTiePolicy {
    fn from(policy: PairedReadOverlapTiePolicy) -> Self {
        match policy {
            PairedReadOverlapTiePolicy::Reject => Self::Reject,
            PairedReadOverlapTiePolicy::PreferFromStart => Self::PreferFromStart,
            PairedReadOverlapTiePolicy::PreferFromEnd => Self::PreferFromEnd,
        }
    }
}

#[derive(Clone)]
#[napi(string_enum)]
pub enum PairedReadValidationPreset {
    Loose,
    Normal,
    Strict,
}

impl From<PairedReadValidationPreset> for engine::paired_merge::PairedReadValidationPreset {
    fn from(preset: PairedReadValidationPreset) -> Self {
        match preset {
            PairedReadValidationPreset::Loose => Self::Loose,
            PairedReadValidationPreset::Normal => Self::Normal,
            PairedReadValidationPreset::Strict => Self::Strict,
        }
    }
}

#[derive(Clone)]
#[napi(string_enum)]
pub enum PairedReadMergeTiePolicy {
    PreferForward,
    PreferReverse,
    EmitAmbiguous,
    RejectDisagreement,
    PreferInteriorBase,
}

impl From<PairedReadMergeTiePolicy> for engine::paired_merge::PairedReadMergeTiePolicy {
    fn from(policy: PairedReadMergeTiePolicy) -> Self {
        match policy {
            PairedReadMergeTiePolicy::PreferForward => Self::PreferForward,
            PairedReadMergeTiePolicy::PreferReverse => Self::PreferReverse,
            PairedReadMergeTiePolicy::EmitAmbiguous => Self::EmitAmbiguous,
            PairedReadMergeTiePolicy::RejectDisagreement => Self::RejectDisagreement,
            PairedReadMergeTiePolicy::PreferInteriorBase => Self::PreferInteriorBase,
        }
    }
}

#[derive(Clone)]
#[napi(object)]
pub struct PairedReadMergeOptions {
    pub overlap_diff_max: u32,
    pub min_overlap: u32,
    pub diff_percent_max: f64,
    pub min_comparisons: u32,
    pub overlap_tie_policy: PairedReadOverlapTiePolicy,
    pub merge_tie_policy: PairedReadMergeTiePolicy,
    pub max_output_qual: u8,
    pub quality_only: bool,
    pub min_base_correction_delta_q: u8,
    pub validate_overlap: bool,
    pub validation_preset: PairedReadValidationPreset,
    pub correct_overlap: bool,
}

#[allow(clippy::cast_possible_truncation)]
impl From<PairedReadMergeOptions> for engine::paired_merge::PairedReadMergeOptions {
    fn from(options: PairedReadMergeOptions) -> Self {
        Self {
            overlap_diff_max: options.overlap_diff_max,
            min_overlap: options.min_overlap,
            diff_percent_max: options.diff_percent_max as f32,
            min_comparisons: options.min_comparisons,
            overlap_tie_policy: options.overlap_tie_policy.into(),
            merge_tie_policy: options.merge_tie_policy.into(),
            max_output_qual: options.max_output_qual,
            quality_only: options.quality_only,
            min_base_correction_delta_q: options.min_base_correction_delta_q,
            validate_overlap: options.validate_overlap,
            validation_preset: options.validation_preset.into(),
            correct_overlap: options.correct_overlap,
        }
    }
}

impl From<engine::metrics::SequenceMetricsResult> for SequenceMetricsResult {
    fn from(r: engine::metrics::SequenceMetricsResult) -> Self {
        Self {
            lengths: r.lengths,
            gc: r.gc,
            at: r.at,
            gc_skew: r.gc_skew,
            at_skew: r.at_skew,
            entropy: r.entropy,
            alphabet_mask: r.alphabet_mask,
            avg_qual: r.avg_qual,
            min_qual: r.min_qual,
            max_qual: r.max_qual,
        }
    }
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

#[allow(clippy::needless_pass_by_value)]
fn engine_err(e: engine::EngineError) -> napi::Error {
    napi::Error::from_reason(e.to_string())
}

#[napi]
pub fn grep_batch(
    sequences: &[u8],
    offsets: &[u32],
    pattern: &[u8],
    max_edits: u32,
    case_insensitive: bool,
    search_both_strands: bool,
) -> napi::Result<Buffer> {
    engine::grep_batch(
        sequences,
        offsets,
        pattern,
        max_edits,
        case_insensitive,
        search_both_strands,
    )
    .map(Into::into)
    .map_err(engine_err)
}

#[napi]
pub fn find_pattern_batch(
    sequences: &[u8],
    offsets: &[u32],
    pattern: &[u8],
    max_edits: u32,
    case_insensitive: bool,
) -> napi::Result<PatternSearchResult> {
    let r = engine::find_pattern_batch(sequences, offsets, pattern, max_edits, case_insensitive)
        .map_err(engine_err)?;
    Ok(PatternSearchResult {
        starts: r.starts,
        ends: r.ends,
        costs: r.costs,
        match_offsets: r.match_offsets,
    })
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
pub fn transform_batch(
    sequences: &[u8],
    offsets: &[u32],
    op: TransformOp,
) -> napi::Result<TransformResult> {
    engine::transform_batch(sequences, offsets, op.into())
        .map(Into::into)
        .map_err(engine_err)
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
pub fn remove_gaps_batch(
    sequences: &[u8],
    offsets: &[u32],
    gap_chars: String,
) -> napi::Result<TransformResult> {
    engine::remove_gaps_batch(sequences, offsets, &gap_chars)
        .map(Into::into)
        .map_err(engine_err)
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
pub fn replace_ambiguous_batch(
    sequences: &[u8],
    offsets: &[u32],
    replacement: String,
) -> napi::Result<TransformResult> {
    engine::replace_ambiguous_batch(sequences, offsets, &replacement)
        .map(Into::into)
        .map_err(engine_err)
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
pub fn replace_invalid_batch(
    sequences: &[u8],
    offsets: &[u32],
    mode: ValidationMode,
    replacement: String,
) -> napi::Result<TransformResult> {
    engine::replace_invalid_batch(sequences, offsets, mode.into(), &replacement)
        .map(Into::into)
        .map_err(engine_err)
}

#[napi]
pub fn classify_batch(sequences: &[u8], offsets: &[u32]) -> napi::Result<ClassifyResult> {
    let r = engine::classify_batch(sequences, offsets).map_err(engine_err)?;
    Ok(ClassifyResult { counts: r.counts })
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
pub fn check_valid_batch(
    sequences: &[u8],
    offsets: &[u32],
    mode: ValidationMode,
) -> napi::Result<Buffer> {
    engine::check_valid_batch(sequences, offsets, mode.into())
        .map(Into::into)
        .map_err(engine_err)
}

#[napi]
pub fn quality_avg_batch(
    quality: &[u8],
    offsets: &[u32],
    ascii_offset: u8,
) -> napi::Result<Vec<f64>> {
    engine::quality_avg_batch(quality, offsets, ascii_offset).map_err(engine_err)
}

#[napi]
pub fn quality_trim_batch(
    quality: &[u8],
    offsets: &[u32],
    ascii_offset: u8,
    threshold: f64,
    window_size: u32,
    trim_start: bool,
    trim_end: bool,
) -> napi::Result<Vec<u32>> {
    engine::quality_trim_batch(
        quality,
        offsets,
        ascii_offset,
        threshold,
        window_size,
        trim_start,
        trim_end,
    )
    .map_err(engine_err)
}

#[napi]
pub fn quality_bin_batch(
    quality: &[u8],
    offsets: &[u32],
    boundaries: &[u8],
    representatives: &[u8],
) -> napi::Result<TransformResult> {
    engine::quality_bin_batch(quality, offsets, boundaries, representatives)
        .map(Into::into)
        .map_err(engine_err)
}

#[napi]
pub fn sequence_metrics_batch(
    sequences: &[u8],
    seq_offsets: &[u32],
    quality: &[u8],
    qual_offsets: &[u32],
    metric_flags: u32,
    ascii_offset: u8,
) -> napi::Result<SequenceMetricsResult> {
    engine::sequence_metrics_batch(
        sequences,
        seq_offsets,
        quality,
        qual_offsets,
        metric_flags,
        ascii_offset,
    )
    .map(Into::into)
    .map_err(engine_err)
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
pub fn translate_batch(
    sequences: &[u8],
    offsets: &[u32],
    translation_lut: &[u8],
    start_mask: &[u8],
    alternative_start_mask: &[u8],
    options: TranslateBatchOptions,
) -> napi::Result<TransformResult> {
    let opts = engine::translate::TranslateOptions {
        frame_offset: options.frame_offset,
        reverse: options.reverse,
        convert_start_codons: options.convert_start_codons,
        allow_alternative_starts: options.allow_alternative_starts,
        trim_at_first_stop: options.trim_at_first_stop,
        remove_stop_codons: options.remove_stop_codons,
        stop_codon_char: options
            .stop_codon_char
            .as_bytes()
            .first()
            .copied()
            .unwrap_or(b'*'),
        unknown_codon_char: options
            .unknown_codon_char
            .as_bytes()
            .first()
            .copied()
            .unwrap_or(b'X'),
    };
    engine::translate_batch(
        sequences,
        offsets,
        translation_lut,
        start_mask,
        alternative_start_mask,
        &opts,
    )
    .map(Into::into)
    .map_err(engine_err)
}

#[napi]
pub fn hash_batch(
    sequences: &[u8],
    offsets: &[u32],
    case_insensitive: bool,
) -> napi::Result<Buffer> {
    engine::hash_batch(sequences, offsets, case_insensitive)
        .map(Into::into)
        .map_err(engine_err)
}

#[napi]
#[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
pub fn merge_paired_reads_batch(
    pair_ids: &[u8],
    pair_id_offsets: &[u32],
    r1_sequences: &[u8],
    r1_sequence_offsets: &[u32],
    r1_quality: &[u8],
    r1_quality_offsets: &[u32],
    r2_sequences: &[u8],
    r2_sequence_offsets: &[u32],
    r2_quality: &[u8],
    r2_quality_offsets: &[u32],
    options: PairedReadMergeOptions,
) -> napi::Result<PairedReadMergeResult> {
    engine::paired_merge::merge_paired_reads_batch(
        pair_ids,
        pair_id_offsets,
        r1_sequences,
        r1_sequence_offsets,
        r1_quality,
        r1_quality_offsets,
        r2_sequences,
        r2_sequence_offsets,
        r2_quality,
        r2_quality_offsets,
        options.into(),
    )
    .map(Into::into)
    .map_err(engine_err)
}
