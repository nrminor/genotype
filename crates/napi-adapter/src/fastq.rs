//! Napi wrapper for the engine's FASTQ reader.

use genotype_engine as engine;
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct FastqBatch {
    pub count: u32,
    pub name_data: Buffer,
    pub name_offsets: Vec<u32>,
    pub description_data: Buffer,
    pub description_offsets: Vec<u32>,
    pub sequence_data: Buffer,
    pub sequence_offsets: Vec<u32>,
    pub quality_data: Buffer,
    pub quality_offsets: Vec<u32>,
}

impl From<engine::fastq::FastqBatch> for FastqBatch {
    fn from(b: engine::fastq::FastqBatch) -> Self {
        Self {
            count: b.count,
            name_data: b.name_data.into(),
            name_offsets: b.name_offsets,
            description_data: b.description_data.into(),
            description_offsets: b.description_offsets,
            sequence_data: b.sequence_data.into(),
            sequence_offsets: b.sequence_offsets,
            quality_data: b.quality_data.into(),
            quality_offsets: b.quality_offsets,
        }
    }
}

#[napi]
pub struct FastqReader {
    inner: engine::fastq::FastqReader,
}

#[allow(clippy::needless_pass_by_value)]
fn engine_err(e: engine::EngineError) -> napi::Error {
    napi::Error::from_reason(e.to_string())
}

#[napi]
impl FastqReader {
    #[napi(factory)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn open(path: String) -> napi::Result<Self> {
        let inner = engine::fastq::FastqReader::open_from_path(&path).map_err(engine_err)?;
        Ok(Self { inner })
    }

    #[napi(factory)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn open_bytes(data: Buffer) -> napi::Result<Self> {
        let inner =
            engine::fastq::FastqReader::open_from_bytes(data.to_vec()).map_err(engine_err)?;
        Ok(Self { inner })
    }

    #[napi]
    pub fn read_batch(&mut self, max_records: u32) -> napi::Result<Option<FastqBatch>> {
        self.inner
            .read_batch(max_records)
            .map(|opt| opt.map(Into::into))
            .map_err(engine_err)
    }
}

#[napi]
pub struct FastqWriter {
    inner: Option<engine::fastq::FastqWriter>,
}

#[napi]
impl FastqWriter {
    #[napi(factory)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn open(path: String, compress: bool) -> napi::Result<Self> {
        let inner =
            engine::fastq::FastqWriter::open_to_path(&path, compress).map_err(engine_err)?;
        Ok(Self { inner: Some(inner) })
    }

    #[napi(factory)]
    pub fn open_bytes(compress: bool) -> Self {
        Self {
            inner: Some(engine::fastq::FastqWriter::open_to_bytes(compress)),
        }
    }

    #[napi]
    #[allow(clippy::too_many_arguments)]
    pub fn write_batch(
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
    ) -> napi::Result<()> {
        let w = self
            .inner
            .as_mut()
            .ok_or_else(|| napi::Error::from_reason("writer already finished"))?;
        let batch = engine::fastq::FastqBatch {
            count,
            name_data: name_data.to_vec(),
            name_offsets: name_offsets.to_vec(),
            description_data: description_data.to_vec(),
            description_offsets: description_offsets.to_vec(),
            sequence_data: sequence_data.to_vec(),
            sequence_offsets: sequence_offsets.to_vec(),
            quality_data: quality_data.to_vec(),
            quality_offsets: quality_offsets.to_vec(),
        };
        w.write_batch(&batch).map_err(engine_err)
    }

    #[napi]
    pub fn finish(&mut self) -> napi::Result<Option<Buffer>> {
        let w = self
            .inner
            .take()
            .ok_or_else(|| napi::Error::from_reason("writer already finished"))?;
        w.finish()
            .map(|opt| opt.map(Into::into))
            .map_err(engine_err)
    }
}
