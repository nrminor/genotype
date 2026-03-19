//! BAM/SAM alignment reader backed by noodles.
//!
//! Provides a stateful `AlignmentReader` class exposed to TypeScript via
//! napi-rs. The reader owns a noodles BAM or SAM reader, reads the header
//! on open, and returns batches of parsed records in a struct-of-arrays
//! layout for efficient FFI transfer.

use std::{fs::File, io::BufReader};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use noodles_bam as bam;
use noodles_bgzf as bgzf;
use noodles_sam::{
    self as sam,
    alignment::{record::cigar::op::Kind, record_buf::Cigar},
};

/// Information about a reference sequence from the SAM/BAM header.
#[napi(object)]
pub struct ReferenceSequenceInfo {
    pub name: String,
    pub length: u32,
}

/// A batch of parsed alignment records in struct-of-arrays layout.
///
/// Variable-length fields use the packed-bytes-plus-offsets convention
/// established by the existing batch kernels. Fixed-width fields use
/// flat typed arrays with one element per record.
#[napi(object)]
pub struct AlignmentBatch {
    /// Number of records in this batch.
    pub count: u32,

    /// Source format for all records in this batch ("bam" or "sam").
    pub format: String,

    // ── Variable-length fields ──────────────────────────────────
    /// Concatenated read name bytes (UTF-8).
    pub qname_data: Buffer,
    /// N+1 offsets into `qname_data`.
    pub qname_offsets: Vec<u32>,

    /// Concatenated decoded sequence bytes (ASCII).
    pub sequence_data: Buffer,
    /// N+1 offsets into `sequence_data`.
    pub sequence_offsets: Vec<u32>,

    /// Concatenated quality bytes (Phred+33 ASCII).
    pub quality_data: Buffer,
    /// N+1 offsets into `quality_data`.
    pub quality_offsets: Vec<u32>,

    /// Concatenated CIGAR string bytes (UTF-8).
    pub cigar_data: Buffer,
    /// N+1 offsets into `cigar_data`.
    pub cigar_offsets: Vec<u32>,

    /// Concatenated reference sequence name bytes (UTF-8).
    pub rname_data: Buffer,
    /// N+1 offsets into `rname_data`.
    pub rname_offsets: Vec<u32>,

    // ── Fixed-width fields ──────────────────────────────────────
    /// SAM flags (one u16 per record).
    pub flags: Vec<u16>,
    /// 1-based positions (one i32 per record; 0 if unmapped).
    pub positions: Vec<i32>,
    /// Mapping qualities (one u8 per record; 255 if unavailable).
    pub mapping_qualities: Buffer,
}

/// Internal enum to handle both BAM and SAM readers behind a single
/// interface.
enum ReaderInner {
    Bam(bam::io::Reader<bgzf::io::Reader<BufReader<File>>>),
    Sam(sam::io::Reader<BufReader<File>>),
}

#[derive(Clone, Copy)]
enum Format {
    Bam,
    Sam,
}

impl Format {
    fn as_str(self) -> &'static str {
        match self {
            Format::Bam => "bam",
            Format::Sam => "sam",
        }
    }
}

/// Stateful alignment file reader exposed to TypeScript.
///
/// Wraps a noodles BAM or SAM reader. The file handle, decompression
/// state (for BAM), and parsed header are owned by this struct and
/// live on the JS heap until garbage collected.
#[napi]
pub struct AlignmentReader {
    inner: ReaderInner,
    header: sam::Header,
    format: Format,
    reference_names: Vec<String>,
    /// Reusable record buffer to avoid per-record allocation.
    record_buf: sam::alignment::RecordBuf,
}

#[napi]
impl AlignmentReader {
    /// Open a BAM or SAM file for reading.
    ///
    /// Format is detected by reading the first few bytes: if they
    /// match the BGZF magic (`1f 8b`), the file is treated as BAM;
    /// otherwise it is treated as SAM.
    ///
    /// The header is read immediately. Records are read lazily via
    /// `readBatch`.
    #[napi(factory)]
    #[allow(clippy::needless_pass_by_value)] // napi requires String, not &str
    pub fn open(path: String) -> napi::Result<Self> {
        let format = detect_format(&path)?;

        match format {
            Format::Bam => Self::open_bam(&path),
            Format::Sam => Self::open_sam(&path),
        }
    }

    /// Read the next batch of alignment records.
    ///
    /// Returns up to `max_records` records, or `None` when all
    /// records have been consumed.
    #[napi]
    pub fn read_batch(&mut self, max_records: u32) -> napi::Result<Option<AlignmentBatch>> {
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

            // QNAME: BStr derefs to [u8]
            let name: &[u8] = record.name().map_or(&b"*"[..], |n| &**n);
            qname_bytes.extend_from_slice(name);
            #[allow(clippy::cast_possible_truncation)]
            qname_offsets.push(qname_bytes.len() as u32);

            // Sequence: RecordBuf::Sequence implements AsRef<[u8]>
            let seq: &[u8] = record.sequence().as_ref();
            seq_bytes.extend_from_slice(seq);
            #[allow(clippy::cast_possible_truncation)]
            seq_offsets.push(seq_bytes.len() as u32);

            // Quality: convert Phred scores to Phred+33 ASCII
            let qual_scores: &[u8] = record.quality_scores().as_ref();
            if qual_scores.is_empty() || qual_scores.iter().all(|&s| s == 255) {
                // Missing quality: fill with '*' to match sequence length
                qual_bytes.extend(std::iter::repeat_n(b'*', seq.len()));
            } else {
                for &score in qual_scores {
                    qual_bytes.push(score.saturating_add(33));
                }
            }
            #[allow(clippy::cast_possible_truncation)]
            qual_offsets.push(qual_bytes.len() as u32);

            // CIGAR: render ops to string
            format_cigar(record.cigar(), &mut cigar_bytes);
            #[allow(clippy::cast_possible_truncation)]
            cigar_offsets.push(cigar_bytes.len() as u32);

            // Reference name
            let rname: &[u8] = record
                .reference_sequence_id()
                .and_then(|id| self.reference_names.get(id))
                .map_or(&b"*"[..], String::as_bytes);
            rname_bytes.extend_from_slice(rname);
            #[allow(clippy::cast_possible_truncation)]
            rname_offsets.push(rname_bytes.len() as u32);

            // Flag
            flags.push(record.flags().bits());

            // Position (1-based; 0 if unmapped)
            #[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
            let pos = record.alignment_start().map_or(0, |p| p.get() as i32);
            positions.push(pos);

            // Mapping quality (255 if unavailable)
            let mapq = record.mapping_quality().map_or(255, |m| m.get());
            mapqs.push(mapq);

            count += 1;
        }

        if count == 0 {
            return Ok(None);
        }

        Ok(Some(AlignmentBatch {
            count,
            format: self.format.as_str().to_owned(),
            qname_data: qname_bytes.into(),
            qname_offsets,
            sequence_data: seq_bytes.into(),
            sequence_offsets: seq_offsets,
            quality_data: qual_bytes.into(),
            quality_offsets: qual_offsets,
            cigar_data: cigar_bytes.into(),
            cigar_offsets,
            rname_data: rname_bytes.into(),
            rname_offsets,
            flags,
            positions,
            mapping_qualities: mapqs.into(),
        }))
    }

    /// Get the raw SAM header text.
    #[napi]
    pub fn header_text(&self) -> napi::Result<String> {
        let mut buf = Vec::new();
        let mut writer = sam::io::Writer::new(&mut buf);
        writer
            .write_header(&self.header)
            .map_err(|e| napi::Error::from_reason(format!("failed to serialize header: {e}")))?;
        String::from_utf8(buf)
            .map_err(|e| napi::Error::from_reason(format!("header is not valid UTF-8: {e}")))
    }

    /// Get the reference sequence dictionary from the header.
    #[napi]
    pub fn reference_sequences(&self) -> Vec<ReferenceSequenceInfo> {
        self.reference_names
            .iter()
            .enumerate()
            .map(|(i, name)| {
                #[allow(clippy::cast_possible_truncation)]
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

    // ── Private helpers ─────────────────────────────────────────

    fn open_bam(path: &str) -> napi::Result<Self> {
        let file = File::open(path).map_err(|e| {
            napi::Error::from_reason(format!("failed to open BAM file '{path}': {e}"))
        })?;
        let mut reader = bam::io::Reader::new(BufReader::new(file));

        let header = reader.read_header().map_err(|e| {
            napi::Error::from_reason(format!("failed to read BAM header from '{path}': {e}"))
        })?;

        let reference_names = resolve_reference_names(&header);

        Ok(Self {
            inner: ReaderInner::Bam(reader),
            header,
            format: Format::Bam,
            reference_names,
            record_buf: sam::alignment::RecordBuf::default(),
        })
    }

    fn open_sam(path: &str) -> napi::Result<Self> {
        let file = File::open(path).map_err(|e| {
            napi::Error::from_reason(format!("failed to open SAM file '{path}': {e}"))
        })?;
        let mut reader = sam::io::Reader::new(BufReader::new(file));

        let header = reader.read_header().map_err(|e| {
            napi::Error::from_reason(format!("failed to read SAM header from '{path}': {e}"))
        })?;

        let reference_names = resolve_reference_names(&header);

        Ok(Self {
            inner: ReaderInner::Sam(reader),
            header,
            format: Format::Sam,
            reference_names,
            record_buf: sam::alignment::RecordBuf::default(),
        })
    }

    /// Read one record into `self.record_buf`, returning the number
    /// of bytes read (0 at EOF).
    fn read_one_record(&mut self) -> napi::Result<usize> {
        match &mut self.inner {
            ReaderInner::Bam(reader) => reader
                .read_record_buf(&self.header, &mut self.record_buf)
                .map_err(|e| napi::Error::from_reason(format!("BAM read error: {e}"))),
            ReaderInner::Sam(reader) => reader
                .read_record_buf(&self.header, &mut self.record_buf)
                .map_err(|e| napi::Error::from_reason(format!("SAM read error: {e}"))),
        }
    }
}

/// Render a CIGAR to its string representation, appending to `out`.
/// Produces "*" for an empty CIGAR.
fn format_cigar(cigar: &Cigar, out: &mut Vec<u8>) {
    use std::io::Write;

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

/// Detect whether a file is BAM (BGZF-compressed) or SAM (text) by
/// reading the first two bytes and checking for the gzip magic number.
fn detect_format(path: &str) -> napi::Result<Format> {
    use std::io::Read;
    let mut file = File::open(path)
        .map_err(|e| napi::Error::from_reason(format!("failed to open '{path}': {e}")))?;
    let mut magic = [0u8; 2];
    let n = file.read(&mut magic).map_err(|e| {
        napi::Error::from_reason(format!("failed to read magic bytes from '{path}': {e}"))
    })?;

    if n >= 2 && magic[0] == 0x1f && magic[1] == 0x8b {
        Ok(Format::Bam)
    } else {
        Ok(Format::Sam)
    }
}

/// Build a Vec of reference sequence names from the header, indexed
/// by reference sequence ID (0-based).
fn resolve_reference_names(header: &sam::Header) -> Vec<String> {
    header
        .reference_sequences()
        .iter()
        .map(|(name, _)| name.to_string())
        .collect()
}
