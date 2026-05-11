//! Native FASTQ sequence sorting backed by spillover-bio.
//!
//! This module is intentionally narrow: it adapts `GenoType`'s existing
//! struct-of-arrays FASTQ batch layout to spillover-bio's current owned
//! `SeqRecord` API, then drains sorted records back into the same batch layout.

use std::path::PathBuf;

use dryice::{RawNameCodec, RawQualityCodec, TwoBitExactCodec};
use spillover::{
    chunk::Sequential,
    compare::{Natural, Reverse as ReverseCompare},
    dedup::Identity,
    merge::{MergeConfig, MergeError},
    sorter::{Basic, Sorter},
};
use spillover_bio::{
    codec::DryIceCodec,
    record::SeqRecord,
    sort::{Builder, Reverse as ReverseOrder, SequenceQualityKey, ILLUMINA_ORDER},
};

use crate::{fastq::FastqBatch, validate_offsets, EngineError};

type SortCodec = DryIceCodec<TwoBitExactCodec, RawQualityCodec, RawNameCodec>;
type SortError = MergeError<dryice::DryIceError>;

type AscSorter = Sorter<SeqRecord, SequenceQualityKey, SortCodec, Natural, Identity, Sequential, Basic>;
type DescSorter = Sorter<
    SeqRecord,
    SequenceQualityKey,
    SortCodec,
    ReverseCompare<Natural>,
    Identity,
    Sequential,
    Basic,
>;

/// Options for the native FASTQ sequence sorter.
#[derive(Debug)]
pub struct FastqSequenceSortOptions {
    pub descending: bool,
    pub memory_budget: usize,
    pub temp_dir: Option<PathBuf>,
}

/// Stateful FASTQ sequence sorter.
pub struct FastqSequenceSorter {
    state: State,
}

enum State {
    Accepting(SorterKind),
    Draining(SortedRecords),
    Done,
}

enum SorterKind {
    Asc(AscSorter),
    Desc(DescSorter),
}

struct SortedRecords {
    inner: Box<dyn Iterator<Item = Result<SeqRecord, SortError>>>,
}

impl SortedRecords {
    fn new(records: impl Iterator<Item = Result<SeqRecord, SortError>> + 'static) -> Self {
        Self {
            inner: Box::new(records),
        }
    }

    fn next_record(&mut self) -> Result<Option<SeqRecord>, EngineError> {
        self.inner.next().transpose().map_err(sort_err)
    }
}

impl FastqSequenceSorter {
    /// Create a new native FASTQ sequence sorter.
    pub fn new(options: FastqSequenceSortOptions) -> Self {
        let codec = DryIceCodec::new().two_bit_exact();
        let mut merge = MergeConfig::default();
        merge.temp_dir = options.temp_dir;

        let state = if options.descending {
            State::Accepting(SorterKind::Desc(
                Builder::new()
                    .sort_by_unkeyed(ReverseOrder(ILLUMINA_ORDER.unkeyed()))
                    .codec(codec)
                    .measured_budget(options.memory_budget)
                    .merge_config(merge)
                    .sort_with_sequential()
                    .build(),
            ))
        } else {
            State::Accepting(SorterKind::Asc(
                Builder::new()
                    .sort_by_unkeyed(ILLUMINA_ORDER.unkeyed())
                    .codec(codec)
                    .measured_budget(options.memory_budget)
                    .merge_config(merge)
                    .sort_with_sequential()
                    .build(),
            ))
        };

        Self { state }
    }

    /// Push a FASTQ batch into the sorter.
    ///
    /// # Errors
    ///
    /// Returns an error if the batch offsets are invalid, sequence and quality
    /// lengths differ, or the sorter fails while spilling records.
    #[allow(clippy::too_many_arguments)]
    pub fn push_batch(
        &mut self,
        name_data: &[u8],
        name_offsets: &[u32],
        description_data: &[u8],
        description_offsets: &[u32],
        sequence_data: &[u8],
        sequence_offsets: &[u32],
        quality_data: &[u8],
        quality_offsets: &[u32],
        count: u32,
    ) -> Result<(), EngineError> {
        validate_batch(
            name_data,
            name_offsets,
            description_data,
            description_offsets,
            sequence_data,
            sequence_offsets,
            quality_data,
            quality_offsets,
            count,
        )?;

        for index in 0..count as usize {
            let name = field_at(name_data, name_offsets, index);
            let description = field_at(description_data, description_offsets, index);
            let sequence = field_at(sequence_data, sequence_offsets, index);
            let quality = field_at(quality_data, quality_offsets, index);

            if sequence.len() != quality.len() {
                return Err(EngineError::InvalidArgument(format!(
                    "sequence sort: FASTQ record {index} has sequence length {} and quality length {}",
                    sequence.len(),
                    quality.len()
                )));
            }

            let record = SeqRecord::new(
                encode_definition(name, description)?,
                normalized_sequence(sequence),
                quality.to_vec(),
            );
            self.push_record(record)?;
        }

        Ok(())
    }

    /// Finish input and prepare to drain sorted records.
    ///
    /// # Errors
    ///
    /// Returns an error if called after input has already been finished or if
    /// spillover fails while finalizing sorted runs.
    pub fn finish_input(&mut self) -> Result<(), EngineError> {
        let state = std::mem::replace(&mut self.state, State::Done);
        self.state = match state {
            State::Accepting(SorterKind::Asc(sorter)) => {
                State::Draining(SortedRecords::new(sorter.finish().map_err(sort_err)?))
            }
            State::Accepting(SorterKind::Desc(sorter)) => {
                State::Draining(SortedRecords::new(sorter.finish().map_err(sort_err)?))
            }
            State::Draining(records) => {
                self.state = State::Draining(records);
                return Err(EngineError::InvalidArgument(
                    "sequence sort: input has already been finished".to_owned(),
                ));
            }
            State::Done => {
                return Err(EngineError::InvalidArgument(
                    "sequence sort: sorter is already closed".to_owned(),
                ));
            }
        };

        Ok(())
    }

    /// Read up to `max_records` sorted records as a FASTQ batch.
    ///
    /// # Errors
    ///
    /// Returns an error if called before [`finish_input`](Self::finish_input)
    /// or if decoding sorted records fails.
    pub fn read_batch(&mut self, max_records: u32) -> Result<Option<FastqBatch>, EngineError> {
        if max_records == 0 {
            return Ok(None);
        }

        let (batch, exhausted) = {
            let State::Draining(records) = &mut self.state else {
                if matches!(self.state, State::Done) {
                    return Ok(None);
                }
                return Err(EngineError::InvalidArgument(
                    "sequence sort: read_batch requires finished input".to_owned(),
                ));
            };

            let mut batch = empty_batch(max_records as usize);
            let mut exhausted = false;

            while batch.count < max_records {
                let Some(record) = records.next_record()? else {
                    exhausted = true;
                    break;
                };

                append_record(&mut batch, &record)?;
            }

            (batch, exhausted)
        };

        if exhausted {
            self.state = State::Done;
        }

        if batch.count == 0 {
            Ok(None)
        } else {
            Ok(Some(batch))
        }
    }

    fn push_record(&mut self, record: SeqRecord) -> Result<(), EngineError> {
        match &mut self.state {
            State::Accepting(SorterKind::Asc(sorter)) => sorter.push(record).map_err(sort_err),
            State::Accepting(SorterKind::Desc(sorter)) => sorter.push(record).map_err(sort_err),
            State::Draining(_) => Err(EngineError::InvalidArgument(
                "sequence sort: cannot push after input is finished".to_owned(),
            )),
            State::Done => Err(EngineError::InvalidArgument(
                "sequence sort: sorter is already closed".to_owned(),
            )),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_batch(
    name_data: &[u8],
    name_offsets: &[u32],
    description_data: &[u8],
    description_offsets: &[u32],
    sequence_data: &[u8],
    sequence_offsets: &[u32],
    quality_data: &[u8],
    quality_offsets: &[u32],
    count: u32,
) -> Result<(), EngineError> {
    validate_offsets(name_offsets, name_data.len())?;
    validate_offsets(description_offsets, description_data.len())?;
    validate_offsets(sequence_offsets, sequence_data.len())?;
    validate_offsets(quality_offsets, quality_data.len())?;

    let expected = count as usize + 1;
    for (label, len) in [
        ("name", name_offsets.len()),
        ("description", description_offsets.len()),
        ("sequence", sequence_offsets.len()),
        ("quality", quality_offsets.len()),
    ] {
        if len != expected {
            return Err(EngineError::InvalidOffsets(format!(
                "sequence sort: {label} offsets length {len} does not match count {count}"
            )));
        }
    }

    Ok(())
}

fn field_at<'a>(data: &'a [u8], offsets: &[u32], index: usize) -> &'a [u8] {
    let start = offsets[index] as usize;
    let end = offsets[index + 1] as usize;
    &data[start..end]
}

fn encode_definition(name: &[u8], description: &[u8]) -> Result<Vec<u8>, EngineError> {
    let name_len = u32::try_from(name.len()).map_err(|_| {
        EngineError::InvalidArgument("sequence sort: record name exceeds u32 length".to_owned())
    })?;

    let mut encoded = Vec::with_capacity(4 + name.len() + description.len());
    encoded.extend_from_slice(&name_len.to_le_bytes());
    encoded.extend_from_slice(name);
    encoded.extend_from_slice(description);
    Ok(encoded)
}

fn decode_definition(bytes: &[u8]) -> Result<(&[u8], &[u8]), EngineError> {
    let Some(prefix) = bytes.get(..4) else {
        return Err(EngineError::InvalidArgument(
            "sequence sort: stored FASTQ definition is truncated".to_owned(),
        ));
    };
    let name_len = u32::from_le_bytes(prefix.try_into().map_err(|_| {
        EngineError::InvalidArgument("sequence sort: invalid definition length".to_owned())
    })?) as usize;
    let name_end = 4 + name_len;
    if name_end > bytes.len() {
        return Err(EngineError::InvalidArgument(
            "sequence sort: stored FASTQ name length exceeds definition length".to_owned(),
        ));
    }
    Ok((&bytes[4..name_end], &bytes[name_end..]))
}

fn normalized_sequence(sequence: &[u8]) -> Vec<u8> {
    sequence
        .iter()
        .map(|&base| match base {
            b'a' => b'A',
            b'c' => b'C',
            b'g' => b'G',
            b't' => b'T',
            other => other,
        })
        .collect()
}

fn empty_batch(capacity: usize) -> FastqBatch {
    let mut batch = FastqBatch {
        count: 0,
        name_data: Vec::new(),
        name_offsets: Vec::with_capacity(capacity + 1),
        description_data: Vec::new(),
        description_offsets: Vec::with_capacity(capacity + 1),
        sequence_data: Vec::new(),
        sequence_offsets: Vec::with_capacity(capacity + 1),
        quality_data: Vec::new(),
        quality_offsets: Vec::with_capacity(capacity + 1),
    };
    batch.name_offsets.push(0);
    batch.description_offsets.push(0);
    batch.sequence_offsets.push(0);
    batch.quality_offsets.push(0);
    batch
}

fn append_record(batch: &mut FastqBatch, record: &SeqRecord) -> Result<(), EngineError> {
    let (name, description) = decode_definition(record.name())?;

    batch.name_data.extend_from_slice(name);
    push_offset(&mut batch.name_offsets, batch.name_data.len(), "name")?;

    batch.description_data.extend_from_slice(description);
    push_offset(
        &mut batch.description_offsets,
        batch.description_data.len(),
        "description",
    )?;

    batch.sequence_data.extend_from_slice(record.sequence());
    push_offset(
        &mut batch.sequence_offsets,
        batch.sequence_data.len(),
        "sequence",
    )?;

    batch.quality_data.extend_from_slice(record.quality());
    push_offset(&mut batch.quality_offsets, batch.quality_data.len(), "quality")?;

    batch.count += 1;
    Ok(())
}

fn push_offset(offsets: &mut Vec<u32>, len: usize, label: &'static str) -> Result<(), EngineError> {
    let offset = u32::try_from(len).map_err(|_| {
        EngineError::InvalidArgument(format!(
            "sequence sort: {label} output exceeds u32 offset capacity"
        ))
    })?;
    offsets.push(offset);
    Ok(())
}

#[allow(clippy::needless_pass_by_value)]
fn sort_err(err: SortError) -> EngineError {
    EngineError::Io(format!("sequence sort failed: {err}"))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn push_records(sorter: &mut FastqSequenceSorter, rows: &[(&[u8], &[u8], &[u8])]) {
        let mut names = Vec::new();
        let mut name_offsets = vec![0];
        let mut sequences = Vec::new();
        let mut sequence_offsets = vec![0];
        let mut qualities = Vec::new();
        let mut quality_offsets = vec![0];

        for (name, sequence, quality) in rows {
            names.extend_from_slice(name);
            name_offsets.push(u32::try_from(names.len()).unwrap());
            sequences.extend_from_slice(sequence);
            sequence_offsets.push(u32::try_from(sequences.len()).unwrap());
            qualities.extend_from_slice(quality);
            quality_offsets.push(u32::try_from(qualities.len()).unwrap());
        }

        sorter
            .push_batch(
                &names,
                &name_offsets,
                &[],
                &vec![0; rows.len() + 1],
                &sequences,
                &sequence_offsets,
                &qualities,
                &quality_offsets,
                u32::try_from(rows.len()).unwrap(),
            )
            .unwrap();
    }

    fn collect_names(mut sorter: FastqSequenceSorter) -> Vec<Vec<u8>> {
        sorter.finish_input().unwrap();
        let mut names = Vec::new();
        while let Some(batch) = sorter.read_batch(2).unwrap() {
            for index in 0..batch.count as usize {
                names.push(
                    batch.name_data
                        [batch.name_offsets[index] as usize..batch.name_offsets[index + 1] as usize]
                        .to_vec(),
                );
            }
        }
        names
    }

    #[test]
    fn sorts_fastq_records_by_sequence() {
        let mut sorter = FastqSequenceSorter::new(FastqSequenceSortOptions {
            descending: false,
            memory_budget: 1024 * 1024,
            temp_dir: None,
        });

        push_records(
            &mut sorter,
            &[
                (b"read-c", b"CCCC", b"!!!!"),
                (b"read-a", b"AAAA", b"!!!!"),
                (b"read-b", b"ACGT", b"!!!!"),
            ],
        );

        assert_eq!(
            collect_names(sorter),
            vec![b"read-a".to_vec(), b"read-b".to_vec(), b"read-c".to_vec()]
        );
    }

    #[test]
    fn sorts_descending() {
        let mut sorter = FastqSequenceSorter::new(FastqSequenceSortOptions {
            descending: true,
            memory_budget: 1024 * 1024,
            temp_dir: None,
        });

        push_records(&mut sorter, &[(b"a", b"AAAA", b"!!!!"), (b"c", b"CCCC", b"!!!!")]);

        assert_eq!(collect_names(sorter), vec![b"c".to_vec(), b"a".to_vec()]);
    }
}
