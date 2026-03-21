//! FASTA batch reader backed by noodles.
//!
//! Provides a stateful reader that owns a noodles FASTA reader and
//! returns batches of parsed records in a struct-of-arrays layout.
//! Handles gzip-compressed input transparently via flate2.
//!
//! FASTA sequences can span multiple lines. The noodles reader handles
//! this correctly — it concatenates continuation lines into a single
//! sequence before returning the record.

use std::{
    fs::File,
    io::{BufReader, BufWriter, Cursor, Read, Seek, Write},
};

use flate2::{read::GzDecoder, write::GzEncoder};
use noodles_fasta as fasta;

use crate::EngineError;

/// A batch of parsed FASTA records in struct-of-arrays layout.
pub struct FastaBatch {
    pub count: u32,

    pub name_data: Vec<u8>,
    pub name_offsets: Vec<u32>,

    pub description_data: Vec<u8>,
    pub description_offsets: Vec<u32>,

    pub sequence_data: Vec<u8>,
    pub sequence_offsets: Vec<u32>,
}

/// Stateful FASTA file reader.
///
/// Wraps a noodles FASTA reader with optional gzip decompression.
/// Records are read lazily via `read_batch`. Uses the `records()`
/// iterator internally since noodles-fasta doesn't expose a
/// `read_record` method like noodles-fastq does.
pub struct FastaReader {
    // We store the records as a collected Vec because noodles-fasta's
    // Reader::records() returns an iterator that borrows the reader,
    // making it impossible to store both the reader and iterator in
    // the same struct. Instead we eagerly collect on open (for small
    // files / in-memory buffers) or read line-by-line.
    //
    // For large files, we use the lower-level read_definition +
    // read_sequence approach.
    inner: FastaReaderInner,
}

enum FastaReaderInner {
    PlainFile(fasta::io::Reader<BufReader<File>>),
    GzipFile(fasta::io::Reader<BufReader<GzDecoder<File>>>),
    PlainBytes(fasta::io::Reader<BufReader<Cursor<Vec<u8>>>>),
    GzipBytes(fasta::io::Reader<BufReader<GzDecoder<Cursor<Vec<u8>>>>>),
}

impl FastaReader {
    /// Open a FASTA file by path.
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
            FastaReaderInner::GzipFile(fasta::io::Reader::new(BufReader::new(GzDecoder::new(file))))
        } else {
            FastaReaderInner::PlainFile(fasta::io::Reader::new(BufReader::new(file)))
        };

        Ok(Self { inner })
    }

    /// Open a FASTA dataset from an in-memory buffer.
    ///
    /// Gzip compression is detected from the first two bytes.
    ///
    /// # Errors
    ///
    /// Returns `EngineError::Io` if the buffer cannot be parsed.
    pub fn open_from_bytes(bytes: Vec<u8>) -> Result<Self, EngineError> {
        let is_gzip = bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b;

        let inner = if is_gzip {
            FastaReaderInner::GzipBytes(fasta::io::Reader::new(BufReader::new(GzDecoder::new(
                Cursor::new(bytes),
            ))))
        } else {
            FastaReaderInner::PlainBytes(fasta::io::Reader::new(BufReader::new(Cursor::new(bytes))))
        };

        Ok(Self { inner })
    }

    /// Read the next batch of FASTA records.
    ///
    /// Returns up to `max_records` records, or `None` when all records
    /// have been consumed.
    ///
    /// # Errors
    ///
    /// Returns `EngineError::Io` if a record cannot be parsed.
    #[allow(clippy::cast_possible_truncation)]
    pub fn read_batch(&mut self, max_records: u32) -> Result<Option<FastaBatch>, EngineError> {
        let max = max_records as usize;

        let mut name_bytes: Vec<u8> = Vec::with_capacity(max * 32);
        let mut name_offsets: Vec<u32> = Vec::with_capacity(max + 1);

        let mut desc_bytes: Vec<u8> = Vec::with_capacity(max * 32);
        let mut desc_offsets: Vec<u32> = Vec::with_capacity(max + 1);

        let mut seq_bytes: Vec<u8> = Vec::with_capacity(max * 500);
        let mut seq_offsets: Vec<u32> = Vec::with_capacity(max + 1);

        name_offsets.push(0);
        desc_offsets.push(0);
        seq_offsets.push(0);

        let mut count: u32 = 0;
        let mut def_buf = String::new();
        let mut seq_buf = Vec::new();

        for _ in 0..max {
            def_buf.clear();
            seq_buf.clear();

            let def_bytes = self.read_definition(&mut def_buf)?;
            if def_bytes == 0 {
                break;
            }

            self.read_sequence(&mut seq_buf)?;

            // Parse definition line: ">name description"
            // read_definition returns the full line including the '>' prefix.
            let def_trimmed = def_buf
                .trim_end()
                .strip_prefix('>')
                .unwrap_or(def_buf.trim_end());
            let (name, desc) = match def_trimmed.find(char::is_whitespace) {
                Some(pos) => (&def_trimmed[..pos], &def_trimmed[pos..].trim_start()),
                None => (def_trimmed, &""),
            };

            name_bytes.extend_from_slice(name.as_bytes());
            name_offsets.push(name_bytes.len() as u32);

            desc_bytes.extend_from_slice(desc.as_bytes());
            desc_offsets.push(desc_bytes.len() as u32);

            seq_bytes.extend_from_slice(&seq_buf);
            seq_offsets.push(seq_bytes.len() as u32);

            count += 1;
        }

        if count == 0 {
            return Ok(None);
        }

        Ok(Some(FastaBatch {
            count,
            name_data: name_bytes,
            name_offsets,
            description_data: desc_bytes,
            description_offsets: desc_offsets,
            sequence_data: seq_bytes,
            sequence_offsets: seq_offsets,
        }))
    }

    fn read_definition(&mut self, buf: &mut String) -> Result<usize, EngineError> {
        let result = match &mut self.inner {
            FastaReaderInner::PlainFile(r) => r.read_definition(buf),
            FastaReaderInner::GzipFile(r) => r.read_definition(buf),
            FastaReaderInner::PlainBytes(r) => r.read_definition(buf),
            FastaReaderInner::GzipBytes(r) => r.read_definition(buf),
        };
        result.map_err(|e| EngineError::Io(format!("FASTA definition read error: {e}")))
    }

    fn read_sequence(&mut self, buf: &mut Vec<u8>) -> Result<usize, EngineError> {
        let result = match &mut self.inner {
            FastaReaderInner::PlainFile(r) => r.read_sequence(buf),
            FastaReaderInner::GzipFile(r) => r.read_sequence(buf),
            FastaReaderInner::PlainBytes(r) => r.read_sequence(buf),
            FastaReaderInner::GzipBytes(r) => r.read_sequence(buf),
        };
        result.map_err(|e| EngineError::Io(format!("FASTA sequence read error: {e}")))
    }
}

enum WriterInner {
    PlainFile(BufWriter<File>),
    GzipFile(GzEncoder<BufWriter<File>>),
    PlainBytes(Vec<u8>),
    GzipBytes(GzEncoder<Vec<u8>>),
}

/// Stateful FASTA batch writer.
///
/// Accepts batches of records in the same struct-of-arrays layout that
/// `FastaReader` produces. Sequences are wrapped at `line_width`
/// characters (default 80). Optionally gzip-compresses the output.
pub struct FastaWriter {
    inner: WriterInner,
    line_width: usize,
}

impl FastaWriter {
    /// Open a writer to a file path.
    ///
    /// # Errors
    ///
    /// Returns `EngineError::Io` if the file cannot be created.
    pub fn open_to_path(path: &str, compress: bool, line_width: u32) -> Result<Self, EngineError> {
        let file = File::create(path)
            .map_err(|e| EngineError::Io(format!("failed to create '{path}': {e}")))?;
        let buf = BufWriter::new(file);

        let inner = if compress {
            WriterInner::GzipFile(GzEncoder::new(buf, flate2::Compression::default()))
        } else {
            WriterInner::PlainFile(buf)
        };

        Ok(Self {
            inner,
            line_width: line_width as usize,
        })
    }

    /// Open a writer to an in-memory buffer.
    pub fn open_to_bytes(compress: bool, line_width: u32) -> Self {
        let inner = if compress {
            WriterInner::GzipBytes(GzEncoder::new(Vec::new(), flate2::Compression::default()))
        } else {
            WriterInner::PlainBytes(Vec::new())
        };

        Self {
            inner,
            line_width: line_width as usize,
        }
    }

    /// Write a batch of FASTA records.
    ///
    /// Records are formatted as `>name description\nsequence\n` with
    /// sequence lines wrapped at `line_width` characters.
    ///
    /// # Errors
    ///
    /// Returns `EngineError::Io` if writing fails.
    #[allow(clippy::cast_possible_truncation)]
    pub fn write_batch(&mut self, batch: &FastaBatch) -> Result<(), EngineError> {
        let map_err = |e: std::io::Error| EngineError::Io(format!("FASTA write error: {e}"));

        for i in 0..batch.count as usize {
            let name_start = batch.name_offsets[i] as usize;
            let name_end = batch.name_offsets[i + 1] as usize;
            let desc_start = batch.description_offsets[i] as usize;
            let desc_end = batch.description_offsets[i + 1] as usize;
            let seq_start = batch.sequence_offsets[i] as usize;
            let seq_end = batch.sequence_offsets[i + 1] as usize;

            let name = &batch.name_data[name_start..name_end];
            let desc = &batch.description_data[desc_start..desc_end];
            let seq = &batch.sequence_data[seq_start..seq_end];

            let lw = self.line_width;
            let w = self.writer();
            w.write_all(b">").map_err(map_err)?;
            w.write_all(name).map_err(map_err)?;
            if !desc.is_empty() {
                w.write_all(b" ").map_err(map_err)?;
                w.write_all(desc).map_err(map_err)?;
            }
            w.write_all(b"\n").map_err(map_err)?;

            if lw == 0 || seq.len() <= lw {
                w.write_all(seq).map_err(map_err)?;
            } else {
                for chunk in seq.chunks(lw) {
                    w.write_all(chunk).map_err(map_err)?;
                    w.write_all(b"\n").map_err(map_err)?;
                }
                continue;
            }
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
