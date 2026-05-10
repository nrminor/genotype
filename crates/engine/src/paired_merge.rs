//! Batched paired-read merge kernel backed by libpairassembly.

use libpairassembly::{
    Assembler, AssemblerConfig, CorrectionParams, MergeParams, MergeTiePolicy, OverlapParams,
    OverlapValidator, PairInput, SeqRecordView, TiePolicy, ValidationPreset,
};
use rayon::prelude::*;
use std::fmt::{Display, Formatter};

use crate::{num_sequences, validate_offsets, EngineError};

#[derive(Debug)]
pub struct PairedReadMergeResult {
    pub status: Vec<u8>,
    pub sequence_data: Vec<u8>,
    pub sequence_offsets: Vec<u32>,
    pub quality_data: Vec<u8>,
    pub quality_offsets: Vec<u32>,
}

#[derive(Clone, Copy, Debug)]
pub struct PairedReadMergeOptions {
    pub overlap_diff_max: u32,
    pub min_overlap: u32,
    pub diff_percent_max: f32,
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

impl Default for PairedReadMergeOptions {
    fn default() -> Self {
        Self {
            overlap_diff_max: 5,
            min_overlap: 10,
            diff_percent_max: 0.2,
            min_comparisons: 10,
            overlap_tie_policy: PairedReadOverlapTiePolicy::PreferFromStart,
            merge_tie_policy: PairedReadMergeTiePolicy::PreferForward,
            max_output_qual: 40,
            quality_only: false,
            min_base_correction_delta_q: 0,
            validate_overlap: true,
            validation_preset: PairedReadValidationPreset::Normal,
            correct_overlap: true,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum PairedReadValidationPreset {
    Loose,
    Normal,
    Strict,
}

impl From<PairedReadValidationPreset> for ValidationPreset {
    fn from(preset: PairedReadValidationPreset) -> Self {
        match preset {
            PairedReadValidationPreset::Loose => Self::Loose,
            PairedReadValidationPreset::Normal => Self::Normal,
            PairedReadValidationPreset::Strict => Self::Strict,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum PairedReadOverlapTiePolicy {
    Reject,
    PreferFromStart,
    PreferFromEnd,
}

impl From<PairedReadOverlapTiePolicy> for TiePolicy {
    fn from(policy: PairedReadOverlapTiePolicy) -> Self {
        match policy {
            PairedReadOverlapTiePolicy::Reject => Self::Reject,
            PairedReadOverlapTiePolicy::PreferFromStart => Self::PreferFromStart,
            PairedReadOverlapTiePolicy::PreferFromEnd => Self::PreferFromEnd,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum PairedReadMergeTiePolicy {
    PreferForward,
    PreferReverse,
    EmitAmbiguous,
    RejectDisagreement,
    PreferInteriorBase,
}

impl From<PairedReadMergeTiePolicy> for MergeTiePolicy {
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

#[derive(Clone, Copy)]
struct BatchRead<'a> {
    id: &'a str,
    seq: &'a str,
    qual: &'a str,
}

impl SeqRecordView for BatchRead<'_> {
    fn id(&self) -> &str {
        self.id
    }

    fn seq(&self) -> &str {
        self.seq
    }

    fn qual(&self) -> &str {
        self.qual
    }
}

type MergedPair = (Vec<u8>, Vec<u8>);
type MergeRow = Result<Option<MergedPair>, EngineError>;

#[derive(Clone, Copy, Debug)]
enum MergeField {
    PairId,
    R1Sequence,
    R1Quality,
    R2Sequence,
    R2Quality,
}

impl MergeField {
    fn str_at<'a>(
        self,
        data: &'a [u8],
        offsets: &[u32],
        index: usize,
    ) -> Result<&'a str, EngineError> {
        let start = offsets[index] as usize;
        let end = offsets[index + 1] as usize;
        std::str::from_utf8(&data[start..end]).map_err(|err| {
            EngineError::InvalidArgument(format!(
                "merge_paired_reads_batch: {self} at index {index} is not valid UTF-8: {err}"
            ))
        })
    }
}

impl Display for MergeField {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PairId => f.write_str("pair id"),
            Self::R1Sequence => f.write_str("R1 sequence"),
            Self::R1Quality => f.write_str("R1 quality"),
            Self::R2Sequence => f.write_str("R2 sequence"),
            Self::R2Quality => f.write_str("R2 quality"),
        }
    }
}

/// Merge a batch of paired FASTQ reads.
///
/// Each pair is described by one normalized pair id and parallel R1/R2 sequence
/// and quality batches. `status[i]` is 1 when pair `i` merged and 0 when no
/// acceptable overlap was found. No-overlap is not an error; callers decide
/// whether to keep, skip, or reject those pairs.
///
/// # Errors
///
/// Returns `EngineError::InvalidOffsets` for malformed batch offsets, or
/// `EngineError::InvalidArgument` when text conversion, pair validation, or
/// merge/correction fails.
#[allow(clippy::too_many_arguments)]
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
) -> Result<PairedReadMergeResult, EngineError> {
    validate_offsets(pair_id_offsets, pair_ids.len())?;
    validate_offsets(r1_sequence_offsets, r1_sequences.len())?;
    validate_offsets(r1_quality_offsets, r1_quality.len())?;
    validate_offsets(r2_sequence_offsets, r2_sequences.len())?;
    validate_offsets(r2_quality_offsets, r2_quality.len())?;
    validate_parallel_offsets(&[
        pair_id_offsets,
        r1_sequence_offsets,
        r1_quality_offsets,
        r2_sequence_offsets,
        r2_quality_offsets,
    ])?;

    let config = assembler_config(options);
    let n = num_sequences(pair_id_offsets);

    let rows: Vec<_> = (0..n)
        .into_par_iter()
        .map_init(
            || Assembler::from_config(config.clone()),
            |assembler, i| {
                merge_one_pair(
                    assembler,
                    i,
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
                    options.validate_overlap,
                    options.correct_overlap,
                )
            },
        )
        .collect();

    materialize(rows)
}

fn validate_parallel_offsets(offsets: &[&[u32]]) -> Result<(), EngineError> {
    let Some(first) = offsets.first() else {
        return Ok(());
    };
    let expected = first.len();
    for candidate in offsets.iter().skip(1) {
        if candidate.len() != expected {
            return Err(EngineError::InvalidArgument(
                "merge_paired_reads_batch: all offset arrays must describe the same number of records"
                    .to_owned(),
            ));
        }
    }
    Ok(())
}

fn assembler_config(options: PairedReadMergeOptions) -> AssemblerConfig {
    let overlap = OverlapParams::default()
        .with_settings(
            options.overlap_diff_max as usize,
            options.min_overlap as usize,
            options.diff_percent_max,
            options.min_comparisons as usize,
        )
        .with_tie_policy(options.overlap_tie_policy.into());

    let merge = MergeParams::default().with_tie_policy(options.merge_tie_policy.into());

    let mut correction = CorrectionParams::default()
        .with_max_output_qual(options.max_output_qual)
        .with_min_base_correction_delta_q(options.min_base_correction_delta_q);
    if options.quality_only {
        correction = correction.quality_only();
    }

    AssemblerConfig {
        overlap,
        validator: OverlapValidator::from_preset(options.validation_preset.into()),
        merge,
        correction,
    }
}

#[allow(clippy::too_many_arguments)]
fn merge_one_pair(
    assembler: &mut Assembler,
    index: usize,
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
    validate_overlap: bool,
    correct_overlap: bool,
) -> MergeRow {
    let id = MergeField::PairId.str_at(pair_ids, pair_id_offsets, index)?;
    let r1_seq = MergeField::R1Sequence.str_at(r1_sequences, r1_sequence_offsets, index)?;
    let r1_qual = MergeField::R1Quality.str_at(r1_quality, r1_quality_offsets, index)?;
    let r2_seq = MergeField::R2Sequence.str_at(r2_sequences, r2_sequence_offsets, index)?;
    let r2_qual = MergeField::R2Quality.str_at(r2_quality, r2_quality_offsets, index)?;

    let r1 = BatchRead {
        id,
        seq: r1_seq,
        qual: r1_qual,
    };
    let r2 = BatchRead {
        id,
        seq: r2_seq,
        qual: r2_qual,
    };
    let pair = PairInput::new(r1, r2);

    let merged = process_pair_with_options(assembler, &pair, validate_overlap, correct_overlap)
        .map_err(|err| pairassembly_err(&err))?;
    Ok(merged.map(|read| {
        (
            read.sequence_bytes().to_vec(),
            read.quality_bytes().to_vec(),
        )
    }))
}

fn process_pair_with_options<R>(
    assembler: &mut Assembler,
    pair: &PairInput<R>,
    validate_overlap: bool,
    correct_overlap: bool,
) -> libpairassembly::Result<Option<libpairassembly::OwnedSequenceRead>>
where
    R: SeqRecordView,
{
    assembler.on_pair(pair)?.find_overlap()?.and_then_found(|overlap| {
        match (validate_overlap, correct_overlap) {
            (true, true) => overlap.validate()?.merge()?.correct()?.into_owned_read(),
            (true, false) => overlap.validate()?.merge()?.into_owned_read(),
            (false, true) => overlap.merge()?.correct()?.into_owned_read(),
            (false, false) => overlap.merge()?.into_owned_read(),
        }
    })
}

fn pairassembly_err(err: &libpairassembly::Error) -> EngineError {
    EngineError::InvalidArgument(format!("merge_paired_reads_batch: {err}"))
}

fn materialize(rows: Vec<MergeRow>) -> Result<PairedReadMergeResult, EngineError> {
    let mut status = Vec::with_capacity(rows.len());
    let mut sequence_data = Vec::new();
    let mut sequence_offsets = Vec::with_capacity(rows.len() + 1);
    let mut quality_data = Vec::new();
    let mut quality_offsets = Vec::with_capacity(rows.len() + 1);

    sequence_offsets.push(0);
    quality_offsets.push(0);

    for row in rows {
        match row? {
            Some((sequence, quality)) => {
                status.push(1);
                sequence_data.extend_from_slice(&sequence);
                quality_data.extend_from_slice(&quality);
            }
            None => status.push(0),
        }
        push_offset(&mut sequence_offsets, sequence_data.len(), "sequence")?;
        push_offset(&mut quality_offsets, quality_data.len(), "quality")?;
    }

    Ok(PairedReadMergeResult {
        status,
        sequence_data,
        sequence_offsets,
        quality_data,
        quality_offsets,
    })
}

fn push_offset(offsets: &mut Vec<u32>, len: usize, label: &'static str) -> Result<(), EngineError> {
    let offset = u32::try_from(len).map_err(|_| {
        EngineError::InvalidArgument(format!(
            "merge_paired_reads_batch: {label} output exceeds u32 offset capacity"
        ))
    })?;
    offsets.push(offset);
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn pack(parts: &[&str]) -> (Vec<u8>, Vec<u32>) {
        let mut data = Vec::new();
        let mut offsets = Vec::with_capacity(parts.len() + 1);
        offsets.push(0);
        for part in parts {
            data.extend_from_slice(part.as_bytes());
            offsets.push(u32::try_from(data.len()).unwrap());
        }
        (data, offsets)
    }

    #[test]
    fn merge_paired_reads_batch_merges_overlapping_pair() {
        let (ids, id_offsets) = pack(&["read-1"]);
        let (r1_seq, r1_seq_offsets) =
            pack(&["ACGTTGCAGTACGATCGTACGGAATTCGCCGATGACTGACCTAGGTCAGTACGATC"]);
        let (r1_qual, r1_qual_offsets) =
            pack(&["IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII"]);
        let (r2_seq, r2_seq_offsets) =
            pack(&["GATCGTACTGACCTAGGTCAGTCATCGGCGAATTCCGTACGATCGTACTGCAACGT"]);
        let (r2_qual, r2_qual_offsets) =
            pack(&["IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII"]);

        let result = merge_paired_reads_batch(
            &ids,
            &id_offsets,
            &r1_seq,
            &r1_seq_offsets,
            &r1_qual,
            &r1_qual_offsets,
            &r2_seq,
            &r2_seq_offsets,
            &r2_qual,
            &r2_qual_offsets,
            PairedReadMergeOptions::default(),
        )
        .unwrap();

        assert_eq!(result.status, vec![1]);
        assert_eq!(result.sequence_offsets.len(), 2);
        assert_eq!(result.sequence_data.len(), result.quality_data.len());
        assert!(!result.sequence_data.is_empty());
    }

    #[test]
    fn merge_paired_reads_batch_marks_no_overlap_without_error() {
        let (ids, id_offsets) = pack(&["read-1"]);
        let (r1_seq, r1_seq_offsets) =
            pack(&["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]);
        let (r1_qual, r1_qual_offsets) =
            pack(&["IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII"]);
        let (r2_seq, r2_seq_offsets) =
            pack(&["CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"]);
        let (r2_qual, r2_qual_offsets) =
            pack(&["IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII"]);

        let result = merge_paired_reads_batch(
            &ids,
            &id_offsets,
            &r1_seq,
            &r1_seq_offsets,
            &r1_qual,
            &r1_qual_offsets,
            &r2_seq,
            &r2_seq_offsets,
            &r2_qual,
            &r2_qual_offsets,
            PairedReadMergeOptions::default(),
        )
        .unwrap();

        assert_eq!(result.status, vec![0]);
        assert_eq!(result.sequence_offsets, vec![0, 0]);
        assert_eq!(result.quality_offsets, vec![0, 0]);
    }
}
