//! Napi wrapper for the engine's FASTQ sequence sorter.

use std::path::PathBuf;

use genotype_engine as engine;
use napi_derive::napi;

use crate::fastq::FastqBatch;

#[napi]
pub struct FastqSequenceSorter {
    inner: Option<engine::sequence_sort::FastqSequenceSorter>,
}

#[allow(clippy::needless_pass_by_value)]
fn engine_err(e: engine::EngineError) -> napi::Error {
    napi::Error::from_reason(e.to_string())
}

#[napi]
impl FastqSequenceSorter {
    #[napi(factory)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        order: String,
        memory_budget: u32,
        temp_dir: Option<String>,
    ) -> napi::Result<Self> {
        let descending = match order.as_str() {
            "asc" => false,
            "desc" => true,
            other => {
                return Err(napi::Error::from_reason(format!(
                    "unknown sequence sort order: {other}"
                )))
            }
        };

        let options = engine::sequence_sort::FastqSequenceSortOptions {
            descending,
            memory_budget: memory_budget as usize,
            temp_dir: temp_dir.map(PathBuf::from),
        };

        Ok(Self {
            inner: Some(engine::sequence_sort::FastqSequenceSorter::new(options)),
        })
    }

    #[napi]
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
    ) -> napi::Result<()> {
        let sorter = self
            .inner
            .as_mut()
            .ok_or_else(|| napi::Error::from_reason("sequence sorter already closed"))?;

        sorter
            .push_batch(
                name_data,
                name_offsets,
                description_data,
                description_offsets,
                sequence_data,
                sequence_offsets,
                quality_data,
                quality_offsets,
                count,
            )
            .map_err(engine_err)
    }

    #[napi]
    pub fn finish_input(&mut self) -> napi::Result<()> {
        let sorter = self
            .inner
            .as_mut()
            .ok_or_else(|| napi::Error::from_reason("sequence sorter already closed"))?;
        sorter.finish_input().map_err(engine_err)
    }

    #[napi]
    pub fn read_batch(&mut self, max_records: u32) -> napi::Result<Option<FastqBatch>> {
        let sorter = self
            .inner
            .as_mut()
            .ok_or_else(|| napi::Error::from_reason("sequence sorter already closed"))?;
        sorter
            .read_batch(max_records)
            .map(|batch| batch.map(Into::into))
            .map_err(engine_err)
    }
}
