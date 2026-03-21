//! WebAssembly adapter for the genotype compute engine.
//!
//! Each `#[wasm_bindgen]` function converts between wasm-bindgen types and the
//! engine's plain Rust types, then delegates to the corresponding engine batch
//! function. No compute logic lives here.

#![allow(clippy::must_use_candidate, clippy::missing_errors_doc)]

use genotype_engine as engine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(getter_with_clone)]
pub struct TransformResult {
    pub data: Vec<u8>,
    pub offsets: Vec<u32>,
}

impl From<engine::TransformResult> for TransformResult {
    fn from(r: engine::TransformResult) -> Self {
        Self {
            data: r.data,
            offsets: r.offsets,
        }
    }
}

#[wasm_bindgen(getter_with_clone)]
pub struct ClassifyResult {
    pub counts: Vec<u32>,
}

#[wasm_bindgen(getter_with_clone)]
pub struct PatternSearchResult {
    pub starts: Vec<u32>,
    pub ends: Vec<u32>,
    pub costs: Vec<u32>,
    pub match_offsets: Vec<u32>,
}

#[wasm_bindgen(getter_with_clone)]
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

#[allow(clippy::needless_pass_by_value)]
fn engine_err(e: engine::EngineError) -> JsError {
    JsError::new(&e.to_string())
}

#[wasm_bindgen]
pub fn grep_batch(
    sequences: &[u8],
    offsets: &[u32],
    pattern: &[u8],
    max_edits: u32,
    case_insensitive: bool,
    search_both_strands: bool,
) -> Result<Vec<u8>, JsError> {
    engine::grep_batch(
        sequences,
        offsets,
        pattern,
        max_edits,
        case_insensitive,
        search_both_strands,
    )
    .map_err(engine_err)
}

#[wasm_bindgen]
pub fn find_pattern_batch(
    sequences: &[u8],
    offsets: &[u32],
    pattern: &[u8],
    max_edits: u32,
    case_insensitive: bool,
) -> Result<PatternSearchResult, JsError> {
    let r = engine::find_pattern_batch(sequences, offsets, pattern, max_edits, case_insensitive)
        .map_err(engine_err)?;
    Ok(PatternSearchResult {
        starts: r.starts,
        ends: r.ends,
        costs: r.costs,
        match_offsets: r.match_offsets,
    })
}

#[wasm_bindgen]
pub fn transform_batch(
    sequences: &[u8],
    offsets: &[u32],
    op: &str,
) -> Result<TransformResult, JsError> {
    let engine_op = match op {
        "Complement" => engine::TransformOp::Complement,
        "ComplementRna" => engine::TransformOp::ComplementRna,
        "Reverse" => engine::TransformOp::Reverse,
        "ReverseComplement" => engine::TransformOp::ReverseComplement,
        "ReverseComplementRna" => engine::TransformOp::ReverseComplementRna,
        "ToRna" => engine::TransformOp::ToRna,
        "ToDna" => engine::TransformOp::ToDna,
        "UpperCase" => engine::TransformOp::UpperCase,
        "LowerCase" => engine::TransformOp::LowerCase,
        _ => return Err(JsError::new(&format!("unknown transform op: {op}"))),
    };
    engine::transform_batch(sequences, offsets, engine_op)
        .map(Into::into)
        .map_err(engine_err)
}

#[wasm_bindgen]
pub fn remove_gaps_batch(
    sequences: &[u8],
    offsets: &[u32],
    gap_chars: &str,
) -> Result<TransformResult, JsError> {
    engine::remove_gaps_batch(sequences, offsets, gap_chars)
        .map(Into::into)
        .map_err(engine_err)
}

#[wasm_bindgen]
pub fn replace_ambiguous_batch(
    sequences: &[u8],
    offsets: &[u32],
    replacement: &str,
) -> Result<TransformResult, JsError> {
    engine::replace_ambiguous_batch(sequences, offsets, replacement)
        .map(Into::into)
        .map_err(engine_err)
}

#[wasm_bindgen]
pub fn replace_invalid_batch(
    sequences: &[u8],
    offsets: &[u32],
    mode: &str,
    replacement: &str,
) -> Result<TransformResult, JsError> {
    let engine_mode = parse_validation_mode(mode)?;
    engine::replace_invalid_batch(sequences, offsets, engine_mode, replacement)
        .map(Into::into)
        .map_err(engine_err)
}

#[wasm_bindgen]
pub fn classify_batch(sequences: &[u8], offsets: &[u32]) -> Result<ClassifyResult, JsError> {
    let r = engine::classify_batch(sequences, offsets).map_err(engine_err)?;
    Ok(ClassifyResult { counts: r.counts })
}

#[wasm_bindgen]
pub fn check_valid_batch(
    sequences: &[u8],
    offsets: &[u32],
    mode: &str,
) -> Result<Vec<u8>, JsError> {
    let engine_mode = parse_validation_mode(mode)?;
    engine::check_valid_batch(sequences, offsets, engine_mode).map_err(engine_err)
}

#[wasm_bindgen]
pub fn quality_avg_batch(
    quality: &[u8],
    offsets: &[u32],
    ascii_offset: u8,
) -> Result<Vec<f64>, JsError> {
    engine::quality_avg_batch(quality, offsets, ascii_offset).map_err(engine_err)
}

#[wasm_bindgen]
pub fn quality_trim_batch(
    quality: &[u8],
    offsets: &[u32],
    ascii_offset: u8,
    threshold: f64,
    window_size: u32,
    trim_start: bool,
    trim_end: bool,
) -> Result<Vec<u32>, JsError> {
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

#[wasm_bindgen]
pub fn quality_bin_batch(
    quality: &[u8],
    offsets: &[u32],
    boundaries: &[u8],
    representatives: &[u8],
) -> Result<TransformResult, JsError> {
    engine::quality_bin_batch(quality, offsets, boundaries, representatives)
        .map(Into::into)
        .map_err(engine_err)
}

#[wasm_bindgen]
pub fn sequence_metrics_batch(
    sequences: &[u8],
    seq_offsets: &[u32],
    quality: &[u8],
    qual_offsets: &[u32],
    metric_flags: u32,
    ascii_offset: u8,
) -> Result<SequenceMetricsResult, JsError> {
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

#[wasm_bindgen]
#[allow(clippy::too_many_arguments, clippy::fn_params_excessive_bools)]
pub fn translate_batch(
    sequences: &[u8],
    offsets: &[u32],
    translation_lut: &[u8],
    start_mask: &[u8],
    alternative_start_mask: &[u8],
    frame_offset: u8,
    reverse: bool,
    convert_start_codons: bool,
    allow_alternative_starts: bool,
    trim_at_first_stop: bool,
    remove_stop_codons: bool,
    stop_codon_char: &str,
    unknown_codon_char: &str,
) -> Result<TransformResult, JsError> {
    let opts = engine::translate::TranslateOptions {
        frame_offset,
        reverse,
        convert_start_codons,
        allow_alternative_starts,
        trim_at_first_stop,
        remove_stop_codons,
        stop_codon_char: stop_codon_char.as_bytes().first().copied().unwrap_or(b'*'),
        unknown_codon_char: unknown_codon_char
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

#[wasm_bindgen]
pub fn hash_batch(
    sequences: &[u8],
    offsets: &[u32],
    case_insensitive: bool,
) -> Result<Vec<u8>, JsError> {
    engine::hash_batch(sequences, offsets, case_insensitive).map_err(engine_err)
}

fn parse_validation_mode(mode: &str) -> Result<engine::ValidationMode, JsError> {
    match mode {
        "StrictDna" => Ok(engine::ValidationMode::StrictDna),
        "NormalDna" => Ok(engine::ValidationMode::NormalDna),
        "StrictRna" => Ok(engine::ValidationMode::StrictRna),
        "NormalRna" => Ok(engine::ValidationMode::NormalRna),
        "Protein" => Ok(engine::ValidationMode::Protein),
        _ => Err(JsError::new(&format!("unknown validation mode: {mode}"))),
    }
}

#[wasm_bindgen(getter_with_clone)]
pub struct WasmAlignmentBatch {
    pub count: u32,
    pub format: String,
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

impl From<engine::alignment::AlignmentBatch> for WasmAlignmentBatch {
    fn from(b: engine::alignment::AlignmentBatch) -> Self {
        Self {
            count: b.count,
            format: b.format.to_owned(),
            qname_data: b.qname_data,
            qname_offsets: b.qname_offsets,
            sequence_data: b.sequence_data,
            sequence_offsets: b.sequence_offsets,
            quality_data: b.quality_data,
            quality_offsets: b.quality_offsets,
            cigar_data: b.cigar_data,
            cigar_offsets: b.cigar_offsets,
            rname_data: b.rname_data,
            rname_offsets: b.rname_offsets,
            flags: b.flags,
            positions: b.positions,
            mapping_qualities: b.mapping_qualities,
        }
    }
}

#[wasm_bindgen(getter_with_clone)]
pub struct WasmReferenceSequenceInfo {
    pub name: String,
    pub length: u32,
}

#[wasm_bindgen]
pub struct WasmAlignmentReader {
    inner: engine::alignment::AlignmentReader,
}

#[wasm_bindgen]
impl WasmAlignmentReader {
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<WasmAlignmentReader, JsError> {
        let inner = engine::alignment::AlignmentReader::open_from_bytes(data.to_vec())
            .map_err(engine_err)?;
        Ok(Self { inner })
    }

    pub fn read_batch(&mut self, max_records: u32) -> Result<Option<WasmAlignmentBatch>, JsError> {
        self.inner
            .read_batch(max_records)
            .map(|opt| opt.map(Into::into))
            .map_err(engine_err)
    }

    pub fn header_text(&self) -> Result<String, JsError> {
        self.inner.header_text().map_err(engine_err)
    }

    pub fn reference_sequences(&self) -> Vec<WasmReferenceSequenceInfo> {
        self.inner
            .reference_sequences()
            .into_iter()
            .map(|r| WasmReferenceSequenceInfo {
                name: r.name,
                length: r.length,
            })
            .collect()
    }
}

#[wasm_bindgen(getter_with_clone)]
pub struct WasmFastqBatch {
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

impl From<engine::fastq::FastqBatch> for WasmFastqBatch {
    fn from(b: engine::fastq::FastqBatch) -> Self {
        Self {
            count: b.count,
            name_data: b.name_data,
            name_offsets: b.name_offsets,
            description_data: b.description_data,
            description_offsets: b.description_offsets,
            sequence_data: b.sequence_data,
            sequence_offsets: b.sequence_offsets,
            quality_data: b.quality_data,
            quality_offsets: b.quality_offsets,
        }
    }
}

#[wasm_bindgen]
pub struct WasmFastqReader {
    inner: engine::fastq::FastqReader,
}

#[wasm_bindgen]
impl WasmFastqReader {
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<WasmFastqReader, JsError> {
        let inner =
            engine::fastq::FastqReader::open_from_bytes(data.to_vec()).map_err(engine_err)?;
        Ok(Self { inner })
    }

    pub fn read_batch(&mut self, max_records: u32) -> Result<Option<WasmFastqBatch>, JsError> {
        self.inner
            .read_batch(max_records)
            .map(|opt| opt.map(Into::into))
            .map_err(engine_err)
    }
}

#[wasm_bindgen(getter_with_clone)]
pub struct WasmFastaBatch {
    pub count: u32,
    pub name_data: Vec<u8>,
    pub name_offsets: Vec<u32>,
    pub description_data: Vec<u8>,
    pub description_offsets: Vec<u32>,
    pub sequence_data: Vec<u8>,
    pub sequence_offsets: Vec<u32>,
}

impl From<engine::fasta::FastaBatch> for WasmFastaBatch {
    fn from(b: engine::fasta::FastaBatch) -> Self {
        Self {
            count: b.count,
            name_data: b.name_data,
            name_offsets: b.name_offsets,
            description_data: b.description_data,
            description_offsets: b.description_offsets,
            sequence_data: b.sequence_data,
            sequence_offsets: b.sequence_offsets,
        }
    }
}

#[wasm_bindgen]
pub struct WasmFastaReader {
    inner: engine::fasta::FastaReader,
}

#[wasm_bindgen]
impl WasmFastaReader {
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<WasmFastaReader, JsError> {
        let inner =
            engine::fasta::FastaReader::open_from_bytes(data.to_vec()).map_err(engine_err)?;
        Ok(Self { inner })
    }

    pub fn read_batch(&mut self, max_records: u32) -> Result<Option<WasmFastaBatch>, JsError> {
        self.inner
            .read_batch(max_records)
            .map(|opt| opt.map(Into::into))
            .map_err(engine_err)
    }
}

#[wasm_bindgen]
pub struct WasmFastqWriter {
    inner: Option<engine::fastq::FastqWriter>,
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
impl WasmFastqWriter {
    #[wasm_bindgen(constructor)]
    pub fn new(compress: bool) -> WasmFastqWriter {
        Self {
            inner: Some(engine::fastq::FastqWriter::open_to_bytes(compress)),
        }
    }

    pub fn write_batch(
        &mut self,
        name_data: &[u8],
        name_offsets: Vec<u32>,
        description_data: &[u8],
        description_offsets: Vec<u32>,
        sequence_data: &[u8],
        sequence_offsets: Vec<u32>,
        quality_data: &[u8],
        quality_offsets: Vec<u32>,
        count: u32,
    ) -> Result<(), JsError> {
        let w = self
            .inner
            .as_mut()
            .ok_or_else(|| JsError::new("writer already finished"))?;
        let batch = engine::fastq::FastqBatch {
            count,
            name_data: name_data.to_vec(),
            name_offsets,
            description_data: description_data.to_vec(),
            description_offsets,
            sequence_data: sequence_data.to_vec(),
            sequence_offsets,
            quality_data: quality_data.to_vec(),
            quality_offsets,
        };
        w.write_batch(&batch).map_err(engine_err)
    }

    pub fn finish(&mut self) -> Result<Option<Vec<u8>>, JsError> {
        let w = self
            .inner
            .take()
            .ok_or_else(|| JsError::new("writer already finished"))?;
        w.finish().map_err(engine_err)
    }
}

#[wasm_bindgen]
pub struct WasmFastaWriter {
    inner: Option<engine::fasta::FastaWriter>,
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
impl WasmFastaWriter {
    #[wasm_bindgen(constructor)]
    pub fn new(compress: bool, line_width: u32) -> WasmFastaWriter {
        Self {
            inner: Some(engine::fasta::FastaWriter::open_to_bytes(
                compress, line_width,
            )),
        }
    }

    pub fn write_batch(
        &mut self,
        name_data: &[u8],
        name_offsets: Vec<u32>,
        description_data: &[u8],
        description_offsets: Vec<u32>,
        sequence_data: &[u8],
        sequence_offsets: Vec<u32>,
        count: u32,
    ) -> Result<(), JsError> {
        let w = self
            .inner
            .as_mut()
            .ok_or_else(|| JsError::new("writer already finished"))?;
        let batch = engine::fasta::FastaBatch {
            count,
            name_data: name_data.to_vec(),
            name_offsets,
            description_data: description_data.to_vec(),
            description_offsets,
            sequence_data: sequence_data.to_vec(),
            sequence_offsets,
        };
        w.write_batch(&batch).map_err(engine_err)
    }

    pub fn finish(&mut self) -> Result<Option<Vec<u8>>, JsError> {
        let w = self
            .inner
            .take()
            .ok_or_else(|| JsError::new("writer already finished"))?;
        w.finish().map_err(engine_err)
    }
}
