//! FASTQ batch reader backed by noodles.
//!
//! Provides a stateful reader that owns a noodles FASTQ reader and
//! returns batches of parsed records in a struct-of-arrays layout.
//! Handles gzip-compressed input transparently via flate2.

use std::{
    fs::File,
    io::{BufReader, BufWriter, Cursor, Read, Seek, Write},
};

use flate2::{read::GzDecoder, write::GzEncoder};
use noodles_fastq as fastq;

use crate::EngineError;

/// A batch of parsed FASTQ records in struct-of-arrays layout.
#[derive(Debug)]
pub struct FastqBatch {
    pub count: u32,

    pub name_data: Vec<u8>,
    pub name_offsets: Vec<u32>,

    pub description_data: Vec<u8>,
    pub description_offsets: Vec<u32>,

    pub sequence_data: Vec<u8>,
    pub sequence_offsets: Vec<u32>,

    pub quality_data: Vec<u8>,
    pub quality_offsets: Vec<u32>,
}

enum ReaderInner {
    Plain(fastq::io::Reader<BufReader<File>>),
    Gzip(fastq::io::Reader<BufReader<GzDecoder<File>>>),
    PlainBytes(fastq::io::Reader<BufReader<Cursor<Vec<u8>>>>),
    GzipBytes(fastq::io::Reader<BufReader<GzDecoder<Cursor<Vec<u8>>>>>),
}

/// Stateful FASTQ file reader.
///
/// Wraps a noodles FASTQ reader with optional gzip decompression.
/// Records are read lazily via `read_batch`.
pub struct FastqReader {
    inner: ReaderInner,
    record_buf: fastq::Record,
}

impl FastqReader {
    /// Open a FASTQ file by path.
    ///
    /// Gzip compression is detected from the first two bytes (gzip magic).
    ///
    /// # Errors
    ///
    /// Returns `EngineError::Io` if the file cannot be opened or read.
    pub fn open_from_path(path: &str) -> Result<Self, EngineError> {
        let mut file = File::open(path)
            .map_err(|e| EngineError::Io(format!("failed to open '{path}': {e}")))?;

        let mut magic = [0u8; 2];
        let n = file
            .read(&mut magic)
            .map_err(|e| EngineError::Io(format!("failed to read from '{path}': {e}")))?;

        file.seek(std::io::SeekFrom::Start(0))
            .map_err(|e| EngineError::Io(format!("failed to seek in '{path}': {e}")))?;

        let is_gzip = n >= 2 && magic[0] == 0x1f && magic[1] == 0x8b;

        let inner = if is_gzip {
            ReaderInner::Gzip(fastq::io::Reader::new(BufReader::new(GzDecoder::new(file))))
        } else {
            ReaderInner::Plain(fastq::io::Reader::new(BufReader::new(file)))
        };

        Ok(Self {
            inner,
            record_buf: fastq::Record::default(),
        })
    }

    /// Open a FASTQ dataset from an in-memory buffer.
    ///
    /// Gzip compression is detected from the first two bytes.
    ///
    /// # Errors
    ///
    /// Returns `EngineError::Io` if the buffer cannot be parsed.
    pub fn open_from_bytes(bytes: Vec<u8>) -> Result<Self, EngineError> {
        let is_gzip = bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b;

        let inner = if is_gzip {
            ReaderInner::GzipBytes(fastq::io::Reader::new(BufReader::new(GzDecoder::new(
                Cursor::new(bytes),
            ))))
        } else {
            ReaderInner::PlainBytes(fastq::io::Reader::new(BufReader::new(Cursor::new(bytes))))
        };

        Ok(Self {
            inner,
            record_buf: fastq::Record::default(),
        })
    }

    /// Read the next batch of FASTQ records.
    ///
    /// Returns up to `max_records` records, or `None` when all records
    /// have been consumed.
    ///
    /// # Errors
    ///
    /// Returns `EngineError::Io` if a record cannot be parsed.
    #[allow(clippy::cast_possible_truncation)]
    pub fn read_batch(&mut self, max_records: u32) -> Result<Option<FastqBatch>, EngineError> {
        let max = max_records as usize;

        let mut name_bytes: Vec<u8> = Vec::with_capacity(max * 32);
        let mut name_offsets: Vec<u32> = Vec::with_capacity(max + 1);

        let mut desc_bytes: Vec<u8> = Vec::with_capacity(max * 32);
        let mut desc_offsets: Vec<u32> = Vec::with_capacity(max + 1);

        let mut seq_bytes: Vec<u8> = Vec::with_capacity(max * 150);
        let mut seq_offsets: Vec<u32> = Vec::with_capacity(max + 1);

        let mut qual_bytes: Vec<u8> = Vec::with_capacity(max * 150);
        let mut qual_offsets: Vec<u32> = Vec::with_capacity(max + 1);

        name_offsets.push(0);
        desc_offsets.push(0);
        seq_offsets.push(0);
        qual_offsets.push(0);

        let mut count: u32 = 0;

        for _ in 0..max {
            let bytes_read = self.read_one_record()?;
            if bytes_read == 0 {
                break;
            }

            let record = &self.record_buf;
            let seq = record.sequence();
            let qual = record.quality_scores();

            if seq.len() != qual.len() {
                let name = String::from_utf8_lossy(record.definition().name());
                return Err(EngineError::InvalidArgument(format!(
                    "FASTQ record '{}': sequence length ({}) != quality length ({})",
                    name,
                    seq.len(),
                    qual.len()
                )));
            }

            let def = record.definition();

            name_bytes.extend_from_slice(def.name());
            name_offsets.push(name_bytes.len() as u32);

            desc_bytes.extend_from_slice(def.description());
            desc_offsets.push(desc_bytes.len() as u32);

            seq_bytes.extend_from_slice(seq);
            seq_offsets.push(seq_bytes.len() as u32);

            qual_bytes.extend_from_slice(qual);
            qual_offsets.push(qual_bytes.len() as u32);

            count += 1;
        }

        if count == 0 {
            return Ok(None);
        }

        Ok(Some(FastqBatch {
            count,
            name_data: name_bytes,
            name_offsets,
            description_data: desc_bytes,
            description_offsets: desc_offsets,
            sequence_data: seq_bytes,
            sequence_offsets: seq_offsets,
            quality_data: qual_bytes,
            quality_offsets: qual_offsets,
        }))
    }

    fn read_one_record(&mut self) -> Result<usize, EngineError> {
        let result = match &mut self.inner {
            ReaderInner::Plain(r) => r.read_record(&mut self.record_buf),
            ReaderInner::Gzip(r) => r.read_record(&mut self.record_buf),
            ReaderInner::PlainBytes(r) => r.read_record(&mut self.record_buf),
            ReaderInner::GzipBytes(r) => r.read_record(&mut self.record_buf),
        };
        result.map_err(|e| EngineError::Io(format!("FASTQ read error: {e}")))
    }
}

enum WriterInner {
    PlainFile(BufWriter<File>),
    GzipFile(GzEncoder<BufWriter<File>>),
    PlainBytes(Vec<u8>),
    GzipBytes(GzEncoder<Vec<u8>>),
}

/// Stateful FASTQ batch writer.
///
/// Accepts batches of records in the same struct-of-arrays layout that
/// `FastqReader` produces. Optionally gzip-compresses the output.
/// Call `finish()` to flush and close — for bytes mode this returns
/// the accumulated output.
pub struct FastqWriter {
    inner: WriterInner,
}

impl FastqWriter {
    /// Open a writer to a file path.
    ///
    /// If `compress` is true, output is gzip-compressed.
    ///
    /// # Errors
    ///
    /// Returns `EngineError::Io` if the file cannot be created.
    pub fn open_to_path(path: &str, compress: bool) -> Result<Self, EngineError> {
        let file = File::create(path)
            .map_err(|e| EngineError::Io(format!("failed to create '{path}': {e}")))?;
        let buf = BufWriter::new(file);

        let inner = if compress {
            WriterInner::GzipFile(GzEncoder::new(buf, flate2::Compression::default()))
        } else {
            WriterInner::PlainFile(buf)
        };

        Ok(Self { inner })
    }

    /// Open a writer to an in-memory buffer.
    ///
    /// If `compress` is true, output is gzip-compressed.
    pub fn open_to_bytes(compress: bool) -> Self {
        let inner = if compress {
            WriterInner::GzipBytes(GzEncoder::new(Vec::new(), flate2::Compression::default()))
        } else {
            WriterInner::PlainBytes(Vec::new())
        };

        Self { inner }
    }

    /// Write a batch of FASTQ records.
    ///
    /// Records are formatted as standard 4-line FASTQ:
    /// `@name description\nsequence\n+\nquality\n`
    ///
    /// # Errors
    ///
    /// Returns `EngineError::Io` if writing fails.
    #[allow(clippy::cast_possible_truncation)]
    pub fn write_batch(&mut self, batch: &FastqBatch) -> Result<(), EngineError> {
        let map_err = |e: std::io::Error| EngineError::Io(format!("FASTQ write error: {e}"));

        for i in 0..batch.count as usize {
            let name_start = batch.name_offsets[i] as usize;
            let name_end = batch.name_offsets[i + 1] as usize;
            let desc_start = batch.description_offsets[i] as usize;
            let desc_end = batch.description_offsets[i + 1] as usize;
            let seq_start = batch.sequence_offsets[i] as usize;
            let seq_end = batch.sequence_offsets[i + 1] as usize;
            let qual_start = batch.quality_offsets[i] as usize;
            let qual_end = batch.quality_offsets[i + 1] as usize;

            let name = &batch.name_data[name_start..name_end];
            let desc = &batch.description_data[desc_start..desc_end];
            let seq = &batch.sequence_data[seq_start..seq_end];
            let qual = &batch.quality_data[qual_start..qual_end];

            let w = self.writer();
            w.write_all(b"@").map_err(map_err)?;
            w.write_all(name).map_err(map_err)?;
            if !desc.is_empty() {
                w.write_all(b" ").map_err(map_err)?;
                w.write_all(desc).map_err(map_err)?;
            }
            w.write_all(b"\n").map_err(map_err)?;
            w.write_all(seq).map_err(map_err)?;
            w.write_all(b"\n+\n").map_err(map_err)?;
            w.write_all(qual).map_err(map_err)?;
            w.write_all(b"\n").map_err(map_err)?;
        }

        Ok(())
    }

    /// Flush and close the writer.
    ///
    /// For file mode, returns `None`. For bytes mode, returns the
    /// accumulated output bytes.
    ///
    /// # Errors
    ///
    /// Returns `EngineError::Io` if flushing fails.
    pub fn finish(self) -> Result<Option<Vec<u8>>, EngineError> {
        match self.inner {
            WriterInner::PlainFile(mut w) => {
                w.flush()
                    .map_err(|e| EngineError::Io(format!("flush error: {e}")))?;
                Ok(None)
            }
            WriterInner::GzipFile(w) => {
                w.finish()
                    .map_err(|e| EngineError::Io(format!("gzip finish error: {e}")))?;
                Ok(None)
            }
            WriterInner::PlainBytes(v) => Ok(Some(v)),
            WriterInner::GzipBytes(w) => {
                let bytes = w
                    .finish()
                    .map_err(|e| EngineError::Io(format!("gzip finish error: {e}")))?;
                Ok(Some(bytes))
            }
        }
    }

    fn writer(&mut self) -> &mut dyn std::io::Write {
        match &mut self.inner {
            WriterInner::PlainFile(w) => w,
            WriterInner::GzipFile(w) => w,
            WriterInner::PlainBytes(w) => w,
            WriterInner::GzipBytes(w) => w,
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn complete_records_parse_without_error() {
        let input = b"@read1\nATCG\n+\nIIII\n@read2\nGCTA\n+\nJJJJ\n";
        let mut reader = FastqReader::open_from_bytes(input.to_vec()).unwrap();
        let batch = reader.read_batch(100).unwrap().unwrap();
        assert_eq!(batch.count, 2);
        assert!(reader.read_batch(100).unwrap().is_none());
    }

    #[test]
    fn truncated_record_with_missing_quality_is_caught() {
        // Noodles parses the truncated record with empty quality.
        // Our validation catches the sequence/quality length mismatch.
        let input = b"@read1\nATCG\n+\nIIII\n@truncated\nATCG\n+\n";
        let mut reader = FastqReader::open_from_bytes(input.to_vec()).unwrap();
        let result = reader.read_batch(100);
        assert!(
            result.is_err(),
            "should error on truncated record with mismatched lengths"
        );
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("sequence length"),
            "error should mention length mismatch: {err}"
        );
    }

    #[test]
    fn sequence_quality_length_mismatch_is_caught() {
        let input = b"@mismatch\nATCGATCG\n+\nIII\n";
        let mut reader = FastqReader::open_from_bytes(input.to_vec()).unwrap();
        let result = reader.read_batch(100);
        assert!(result.is_err(), "should error on length mismatch");
    }

    #[test]
    fn empty_input_returns_none() {
        let mut reader = FastqReader::open_from_bytes(Vec::new()).unwrap();
        assert!(reader.read_batch(100).unwrap().is_none());
    }
}
