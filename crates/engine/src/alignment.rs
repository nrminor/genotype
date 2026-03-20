//! BAM/SAM alignment batch reader backed by noodles.
//!
//! Provides a stateful reader that owns a noodles BAM or SAM reader,
//! reads the header on open, and returns batches of parsed records in a
//! struct-of-arrays layout. No FFI dependencies — both the napi and wasm
//! adapters wrap this with their respective type conversions.

use std::{
    fs::File,
    io::{BufReader, Cursor, Read, Seek, Write},
};

use noodles_bam as bam;
use noodles_bgzf as bgzf;
use noodles_sam::{
    self as sam,
    alignment::{record::cigar::op::Kind, record_buf::Cigar},
};

use crate::EngineError;

/// Information about a reference sequence from the SAM/BAM header.
pub struct ReferenceSequenceInfo {
    pub name: String,
    pub length: u32,
}

/// A batch of parsed alignment records in struct-of-arrays layout.
pub struct AlignmentBatch {
    pub count: u32,
    pub format: &'static str,

    pub qname_data: Vec<u8>,
    pub qname_offsets: Vec<u32>,

    pub sequence_data: Vec<u8>,
    pub sequence_offsets: Vec<u32>,

    pub quality_data: Vec<u8>,
    pub quality_offsets: Vec<u32>,

    pub cigar_data: Vec<u8>,
    pub cigar_offsets: Vec<u32>,

    pub rname_data: Vec<u8>,
    pub rname_offsets: Vec<u32>,

    pub flags: Vec<u16>,
    pub positions: Vec<i32>,
    pub mapping_qualities: Vec<u8>,
}

enum ReaderInner {
    BamFile(bam::io::Reader<bgzf::io::Reader<BufReader<File>>>),
    BamBytes(bam::io::Reader<bgzf::io::Reader<Cursor<Vec<u8>>>>),
    SamFile(sam::io::Reader<BufReader<File>>),
    SamBytes(sam::io::Reader<BufReader<Cursor<Vec<u8>>>>),
}

#[derive(Clone, Copy)]
enum Format {
    Bam,
    Sam,
}

impl Format {
    fn as_str(self) -> &'static str {
        match self {
            Self::Bam => "bam",
            Self::Sam => "sam",
        }
    }
}

/// Stateful alignment file reader.
///
/// Wraps a noodles BAM or SAM reader. The file handle (or in-memory
/// buffer), decompression state (for BAM), and parsed header are owned
/// by this struct.
pub struct AlignmentReader {
    inner: ReaderInner,
    header: sam::Header,
    format: Format,
    reference_names: Vec<String>,
    record_buf: sam::alignment::RecordBuf,
}

impl AlignmentReader {
    /// Open a BAM or SAM file by path.
    ///
    /// Format is detected from the first two bytes (BGZF magic). The
    /// header is read immediately; records are read lazily via
    /// `read_batch`.
    ///
    /// # Errors
    ///
    /// Returns `EngineError::InvalidArgument` if the file cannot be
    /// opened or the header cannot be parsed.
    pub fn open_from_path(path: &str) -> Result<Self, EngineError> {
        let mut file = File::open(path)
            .map_err(|e| EngineError::Io(format!("failed to open '{path}': {e}")))?;

        let mut magic = [0u8; 2];
        let n = file.read(&mut magic).map_err(|e| {
            EngineError::Io(format!("failed to read magic bytes from '{path}': {e}"))
        })?;
        file.seek(std::io::SeekFrom::Start(0)).map_err(|e| {
            EngineError::Io(format!("failed to seek in '{path}': {e}"))
        })?;

        let is_bgzf = n >= 2 && magic[0] == 0x1f && magic[1] == 0x8b;

        if is_bgzf {
            Self::open_bam_from_file(file, path)
        } else {
            Self::open_sam_from_file(file, path)
        }
    }

    /// Open a BAM or SAM dataset from an in-memory buffer.
    ///
    /// Format is detected from the first two bytes, same as
    /// `open_from_path`. This is the cross-runtime primitive — it works
    /// in Node/Bun, browsers, and wasm.
    ///
    /// # Errors
    ///
    /// Returns `EngineError::InvalidArgument` if the header cannot be
    /// parsed.
    pub fn open_from_bytes(bytes: Vec<u8>) -> Result<Self, EngineError> {
        let is_bgzf = bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b;

        if is_bgzf {
            let cursor = Cursor::new(bytes);
            let mut reader = bam::io::Reader::new(cursor);

            let header = reader.read_header().map_err(|e| {
                EngineError::Io(format!("failed to read BAM header from buffer: {e}"))
            })?;

            let reference_names = resolve_reference_names(&header);

            Ok(Self {
                inner: ReaderInner::BamBytes(reader),
                header,
                format: Format::Bam,
                reference_names,
                record_buf: sam::alignment::RecordBuf::default(),
            })
        } else {
            let cursor = Cursor::new(bytes);
            let mut reader = sam::io::Reader::new(BufReader::new(cursor));

            let header = reader.read_header().map_err(|e| {
                EngineError::Io(format!("failed to read SAM header from buffer: {e}"))
            })?;

            let reference_names = resolve_reference_names(&header);

            Ok(Self {
                inner: ReaderInner::SamBytes(reader),
                header,
                format: Format::Sam,
                reference_names,
                record_buf: sam::alignment::RecordBuf::default(),
            })
        }
    }

    /// Read the next batch of alignment records.
    ///
    /// Returns up to `max_records` records, or `None` when all records
    /// have been consumed.
    ///
    /// # Errors
    ///
    /// Returns `EngineError::InvalidArgument` if a record cannot be
    /// parsed.
    #[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
    pub fn read_batch(&mut self, max_records: u32) -> Result<Option<AlignmentBatch>, EngineError> {
        let max = max_records as usize;

        let mut qname_bytes: Vec<u8> = Vec::with_capacity(max * 32);
        let mut qname_offsets: Vec<u32> = Vec::with_capacity(max + 1);

        let mut seq_bytes: Vec<u8> = Vec::with_capacity(max * 150);
        let mut seq_offsets: Vec<u32> = Vec::with_capacity(max + 1);

        let mut qual_bytes: Vec<u8> = Vec::with_capacity(max * 150);
        let mut qual_offsets: Vec<u32> = Vec::with_capacity(max + 1);

        let mut cigar_bytes: Vec<u8> = Vec::with_capacity(max * 20);
        let mut cigar_offsets: Vec<u32> = Vec::with_capacity(max + 1);

        let mut rname_bytes: Vec<u8> = Vec::with_capacity(max * 10);
        let mut rname_offsets: Vec<u32> = Vec::with_capacity(max + 1);

        let mut flags: Vec<u16> = Vec::with_capacity(max);
        let mut positions: Vec<i32> = Vec::with_capacity(max);
        let mut mapqs: Vec<u8> = Vec::with_capacity(max);

        let mut count: u32 = 0;

        qname_offsets.push(0);
        seq_offsets.push(0);
        qual_offsets.push(0);
        cigar_offsets.push(0);
        rname_offsets.push(0);

        for _ in 0..max {
            let bytes_read = self.read_one_record()?;
            if bytes_read == 0 {
                break;
            }

            let record = &self.record_buf;

            let name: &[u8] = record.name().map_or(&b"*"[..], |n| &**n);
            qname_bytes.extend_from_slice(name);
            qname_offsets.push(qname_bytes.len() as u32);

            let seq: &[u8] = record.sequence().as_ref();
            seq_bytes.extend_from_slice(seq);
            seq_offsets.push(seq_bytes.len() as u32);

            let qual_scores: &[u8] = record.quality_scores().as_ref();
            if qual_scores.is_empty() || qual_scores.iter().all(|&s| s == 255) {
                qual_bytes.extend(std::iter::repeat_n(b'*', seq.len()));
            } else {
                for &score in qual_scores {
                    qual_bytes.push(score.saturating_add(33));
                }
            }
            qual_offsets.push(qual_bytes.len() as u32);

            format_cigar(record.cigar(), &mut cigar_bytes);
            cigar_offsets.push(cigar_bytes.len() as u32);

            let rname: &[u8] = record
                .reference_sequence_id()
                .and_then(|id| self.reference_names.get(id))
                .map_or(&b"*"[..], String::as_bytes);
            rname_bytes.extend_from_slice(rname);
            rname_offsets.push(rname_bytes.len() as u32);

            flags.push(record.flags().bits());

            let pos = record.alignment_start().map_or(0, |p| p.get() as i32);
            positions.push(pos);

            let mapq = record.mapping_quality().map_or(255, |m| m.get());
            mapqs.push(mapq);

            count += 1;
        }

        if count == 0 {
            return Ok(None);
        }

        Ok(Some(AlignmentBatch {
            count,
            format: self.format.as_str(),
            qname_data: qname_bytes,
            qname_offsets,
            sequence_data: seq_bytes,
            sequence_offsets: seq_offsets,
            quality_data: qual_bytes,
            quality_offsets: qual_offsets,
            cigar_data: cigar_bytes,
            cigar_offsets,
            rname_data: rname_bytes,
            rname_offsets,
            flags,
            positions,
            mapping_qualities: mapqs,
        }))
    }

    /// Get the raw SAM header text.
    ///
    /// # Errors
    ///
    /// Returns `EngineError::InvalidArgument` if the header cannot be
    /// serialized.
    pub fn header_text(&self) -> Result<String, EngineError> {
        let mut buf = Vec::new();
        let mut writer = sam::io::Writer::new(&mut buf);
        writer.write_header(&self.header).map_err(|e| {
            EngineError::InvalidArgument(format!("failed to serialize header: {e}"))
        })?;
        String::from_utf8(buf)
            .map_err(|e| EngineError::InvalidArgument(format!("header is not valid UTF-8: {e}")))
    }

    /// Get the reference sequence dictionary from the header.
    #[allow(clippy::cast_possible_truncation)]
    pub fn reference_sequences(&self) -> Vec<ReferenceSequenceInfo> {
        self.reference_names
            .iter()
            .enumerate()
            .map(|(i, name)| {
                let length = self
                    .header
                    .reference_sequences()
                    .get_index(i)
                    .map_or(0, |(_, rs)| usize::from(rs.length()) as u32);
                ReferenceSequenceInfo {
                    name: name.clone(),
                    length,
                }
            })
            .collect()
    }

    fn open_bam_from_file(file: File, path: &str) -> Result<Self, EngineError> {
        let mut reader = bam::io::Reader::new(BufReader::new(file));

        let header = reader.read_header().map_err(|e| {
            EngineError::Io(format!("failed to read BAM header from '{path}': {e}"))
        })?;

        let reference_names = resolve_reference_names(&header);

        Ok(Self {
            inner: ReaderInner::BamFile(reader),
            header,
            format: Format::Bam,
            reference_names,
            record_buf: sam::alignment::RecordBuf::default(),
        })
    }

    fn open_sam_from_file(file: File, path: &str) -> Result<Self, EngineError> {
        let mut reader = sam::io::Reader::new(BufReader::new(file));

        let header = reader.read_header().map_err(|e| {
            EngineError::Io(format!("failed to read SAM header from '{path}': {e}"))
        })?;

        let reference_names = resolve_reference_names(&header);

        Ok(Self {
            inner: ReaderInner::SamFile(reader),
            header,
            format: Format::Sam,
            reference_names,
            record_buf: sam::alignment::RecordBuf::default(),
        })
    }

    fn read_one_record(&mut self) -> Result<usize, EngineError> {
        match &mut self.inner {
            ReaderInner::BamFile(r) => r
                .read_record_buf(&self.header, &mut self.record_buf)
                .map_err(|e| EngineError::Io(format!("BAM read error: {e}"))),
            ReaderInner::BamBytes(r) => r
                .read_record_buf(&self.header, &mut self.record_buf)
                .map_err(|e| EngineError::Io(format!("BAM read error: {e}"))),
            ReaderInner::SamFile(r) => r
                .read_record_buf(&self.header, &mut self.record_buf)
                .map_err(|e| EngineError::Io(format!("SAM read error: {e}"))),
            ReaderInner::SamBytes(r) => r
                .read_record_buf(&self.header, &mut self.record_buf)
                .map_err(|e| EngineError::Io(format!("SAM read error: {e}"))),
        }
    }
}

fn format_cigar(cigar: &Cigar, out: &mut Vec<u8>) {
    let ops: &[sam::alignment::record::cigar::Op] = cigar.as_ref();
    if ops.is_empty() {
        out.push(b'*');
        return;
    }

    for op in ops {
        let ch = match op.kind() {
            Kind::Match => b'M',
            Kind::Insertion => b'I',
            Kind::Deletion => b'D',
            Kind::Skip => b'N',
            Kind::SoftClip => b'S',
            Kind::HardClip => b'H',
            Kind::Pad => b'P',
            Kind::SequenceMatch => b'=',
            Kind::SequenceMismatch => b'X',
        };
        let _ = write!(out, "{}{}", op.len(), ch as char);
    }
}

fn resolve_reference_names(header: &sam::Header) -> Vec<String> {
    header
        .reference_sequences()
        .iter()
        .map(|(name, _)| name.to_string())
        .collect()
}
