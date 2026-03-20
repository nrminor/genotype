//! Napi wrapper for the engine's alignment reader.

use genotype_engine as engine;
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct ReferenceSequenceInfo {
    pub name: String,
    pub length: u32,
}

#[napi(object)]
pub struct AlignmentBatch {
    pub count: u32,
    pub format: String,
    pub qname_data: Buffer,
    pub qname_offsets: Vec<u32>,
    pub sequence_data: Buffer,
    pub sequence_offsets: Vec<u32>,
    pub quality_data: Buffer,
    pub quality_offsets: Vec<u32>,
    pub cigar_data: Buffer,
    pub cigar_offsets: Vec<u32>,
    pub rname_data: Buffer,
    pub rname_offsets: Vec<u32>,
    pub flags: Vec<u16>,
    pub positions: Vec<i32>,
    pub mapping_qualities: Buffer,
}

impl From<engine::alignment::AlignmentBatch> for AlignmentBatch {
    fn from(b: engine::alignment::AlignmentBatch) -> Self {
        Self {
            count: b.count,
            format: b.format,
            qname_data: b.qname_data.into(),
            qname_offsets: b.qname_offsets,
            sequence_data: b.sequence_data.into(),
            sequence_offsets: b.sequence_offsets,
            quality_data: b.quality_data.into(),
            quality_offsets: b.quality_offsets,
            cigar_data: b.cigar_data.into(),
            cigar_offsets: b.cigar_offsets,
            rname_data: b.rname_data.into(),
            rname_offsets: b.rname_offsets,
            flags: b.flags,
            positions: b.positions,
            mapping_qualities: b.mapping_qualities.into(),
        }
    }
}

#[napi]
pub struct AlignmentReader {
    inner: engine::alignment::AlignmentReader,
}

#[allow(clippy::needless_pass_by_value)]
fn engine_err(e: engine::EngineError) -> napi::Error {
    napi::Error::from_reason(e.to_string())
}

#[napi]
impl AlignmentReader {
    #[napi(factory)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn open(path: String) -> napi::Result<Self> {
        let inner =
            engine::alignment::AlignmentReader::open_from_path(&path).map_err(engine_err)?;
        Ok(Self { inner })
    }

    #[napi(factory)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn open_bytes(data: Buffer) -> napi::Result<Self> {
        let inner = engine::alignment::AlignmentReader::open_from_bytes(data.to_vec())
            .map_err(engine_err)?;
        Ok(Self { inner })
    }

    #[napi]
    pub fn read_batch(&mut self, max_records: u32) -> napi::Result<Option<AlignmentBatch>> {
        self.inner
            .read_batch(max_records)
            .map(|opt| opt.map(Into::into))
            .map_err(engine_err)
    }

    #[napi]
    pub fn header_text(&self) -> napi::Result<String> {
        self.inner.header_text().map_err(engine_err)
    }

    #[napi]
    pub fn reference_sequences(&self) -> Vec<ReferenceSequenceInfo> {
        self.inner
            .reference_sequences()
            .into_iter()
            .map(|r| ReferenceSequenceInfo {
                name: r.name,
                length: r.length,
            })
            .collect()
    }
}
