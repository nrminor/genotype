//! Per-sequence metrics computation.
//!
//! Computes length, GC/AT content, GC/AT skew, Shannon entropy, alphabet
//! masks, and quality statistics from packed sequence and quality batches.
//! All functions are pure computation with no FFI dependencies.

pub const METRIC_LENGTH: u32 = 1 << 0;
pub const METRIC_GC: u32 = 1 << 1;
pub const METRIC_AT: u32 = 1 << 2;
pub const METRIC_GC_SKEW: u32 = 1 << 3;
pub const METRIC_AT_SKEW: u32 = 1 << 4;
pub const METRIC_ENTROPY: u32 = 1 << 5;
pub const METRIC_ALPHABET: u32 = 1 << 6;
pub const METRIC_AVG_QUAL: u32 = 1 << 7;
pub const METRIC_MIN_QUAL: u32 = 1 << 8;
pub const METRIC_MAX_QUAL: u32 = 1 << 9;

const ALPHABET_STAR: usize = 0;
const ALPHABET_DASH: usize = 1;
const ALPHABET_DOT: usize = 2;
const ALPHABET_A: usize = 3;
const ALPHABET_B: usize = 4;
const ALPHABET_C: usize = 5;
const ALPHABET_D: usize = 6;
const ALPHABET_E: usize = 7;
const ALPHABET_F: usize = 8;
const ALPHABET_G: usize = 9;
const ALPHABET_H: usize = 10;
const ALPHABET_I: usize = 11;
const ALPHABET_J: usize = 12;
const ALPHABET_K: usize = 13;
const ALPHABET_L: usize = 14;
const ALPHABET_M: usize = 15;
const ALPHABET_N: usize = 16;
const ALPHABET_O: usize = 17;
const ALPHABET_P: usize = 18;
const ALPHABET_Q: usize = 19;
const ALPHABET_R: usize = 20;
const ALPHABET_S: usize = 21;
const ALPHABET_T: usize = 22;
const ALPHABET_U: usize = 23;
const ALPHABET_V: usize = 24;
const ALPHABET_W: usize = 25;
const ALPHABET_X: usize = 26;
const ALPHABET_Y: usize = 27;
const ALPHABET_Z: usize = 28;
const ALPHABET_LEN: usize = 29;

/// Result of computing per-sequence metrics for a batch.
#[derive(Debug)]
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

#[derive(Clone, Copy, Default)]
struct SeqAccum {
    len: u32,
    counts: [u32; ALPHABET_LEN],
}

#[derive(Clone, Copy, Default)]
struct QualAccum {
    len: u32,
    sum: u64,
    min_raw: u8,
    max_raw: u8,
    seen: bool,
}

#[derive(Clone, Copy, Default)]
pub struct MetricsRow {
    seq: SeqAccum,
    qual: QualAccum,
}

fn compute_seq_metrics(seq: &[u8]) -> MetricsRow {
    let mut counts = [0u32; ALPHABET_LEN];

    for &byte in seq {
        let upper = byte & !0x20;
        #[allow(clippy::cast_possible_truncation)]
        let index = match upper {
            b'*' => Some(ALPHABET_STAR),
            b'-' => Some(ALPHABET_DASH),
            b'.' => Some(ALPHABET_DOT),
            b'A' => Some(ALPHABET_A),
            b'B' => Some(ALPHABET_B),
            b'C' => Some(ALPHABET_C),
            b'D' => Some(ALPHABET_D),
            b'E' => Some(ALPHABET_E),
            b'F' => Some(ALPHABET_F),
            b'G' => Some(ALPHABET_G),
            b'H' => Some(ALPHABET_H),
            b'I' => Some(ALPHABET_I),
            b'J' => Some(ALPHABET_J),
            b'K' => Some(ALPHABET_K),
            b'L' => Some(ALPHABET_L),
            b'M' => Some(ALPHABET_M),
            b'N' => Some(ALPHABET_N),
            b'O' => Some(ALPHABET_O),
            b'P' => Some(ALPHABET_P),
            b'Q' => Some(ALPHABET_Q),
            b'R' => Some(ALPHABET_R),
            b'S' => Some(ALPHABET_S),
            b'T' => Some(ALPHABET_T),
            b'U' => Some(ALPHABET_U),
            b'V' => Some(ALPHABET_V),
            b'W' => Some(ALPHABET_W),
            b'X' => Some(ALPHABET_X),
            b'Y' => Some(ALPHABET_Y),
            b'Z' => Some(ALPHABET_Z),
            _ => None,
        };

        if let Some(idx) = index {
            counts[idx] += 1;
        }
    }

    MetricsRow {
        seq: SeqAccum {
            #[allow(clippy::cast_possible_truncation)]
            len: seq.len() as u32,
            counts,
        },
        qual: QualAccum::default(),
    }
}

fn compute_qual_metrics(quality: &[u8]) -> QualAccum {
    if quality.is_empty() {
        return QualAccum::default();
    }

    let mut sum = 0u64;
    let mut min_raw = u8::MAX;
    let mut max_raw = u8::MIN;

    for &q in quality {
        sum += u64::from(q);
        min_raw = min_raw.min(q);
        max_raw = max_raw.max(q);
    }

    QualAccum {
        #[allow(clippy::cast_possible_truncation)]
        len: quality.len() as u32,
        sum,
        min_raw,
        max_raw,
        seen: true,
    }
}

pub fn compute_row(seq: &[u8], qual: &[u8], needs_qual: bool) -> MetricsRow {
    let mut row = compute_seq_metrics(seq);
    if needs_qual {
        row.qual = compute_qual_metrics(qual);
    }
    row
}

#[allow(clippy::cast_precision_loss)]
pub fn materialize(
    rows: &[MetricsRow],
    metric_flags: u32,
    ascii_offset: u8,
) -> SequenceMetricsResult {
    let lengths =
        (metric_flags & METRIC_LENGTH != 0).then(|| rows.iter().map(|row| row.seq.len).collect());

    let gc = (metric_flags & METRIC_GC != 0)
        .then(|| rows.iter().map(|row| gc_content(&row.seq)).collect());

    let at = (metric_flags & METRIC_AT != 0)
        .then(|| rows.iter().map(|row| at_content(&row.seq)).collect());

    let gc_skew = (metric_flags & METRIC_GC_SKEW != 0)
        .then(|| rows.iter().map(|row| gc_skew_value(&row.seq)).collect());

    let at_skew = (metric_flags & METRIC_AT_SKEW != 0)
        .then(|| rows.iter().map(|row| at_skew_value(&row.seq)).collect());

    let entropy = (metric_flags & METRIC_ENTROPY != 0)
        .then(|| rows.iter().map(|row| entropy_value(&row.seq)).collect());

    let alphabet_mask = (metric_flags & METRIC_ALPHABET != 0).then(|| {
        rows.iter()
            .map(|row| alphabet_mask_value(&row.seq))
            .collect()
    });

    let avg_qual = (metric_flags & METRIC_AVG_QUAL != 0).then(|| {
        rows.iter()
            .map(|row| {
                if row.qual.len == 0 {
                    0.0
                } else {
                    row.qual.sum as f64 / f64::from(row.qual.len) - f64::from(ascii_offset)
                }
            })
            .collect()
    });

    let min_qual = (metric_flags & METRIC_MIN_QUAL != 0).then(|| {
        rows.iter()
            .map(|row| {
                if row.qual.seen {
                    i32::from(row.qual.min_raw) - i32::from(ascii_offset)
                } else {
                    0
                }
            })
            .collect()
    });

    let max_qual = (metric_flags & METRIC_MAX_QUAL != 0).then(|| {
        rows.iter()
            .map(|row| {
                if row.qual.seen {
                    i32::from(row.qual.max_raw) - i32::from(ascii_offset)
                } else {
                    0
                }
            })
            .collect()
    });

    SequenceMetricsResult {
        lengths,
        gc,
        at,
        gc_skew,
        at_skew,
        entropy,
        alphabet_mask,
        avg_qual,
        min_qual,
        max_qual,
    }
}

#[allow(clippy::cast_precision_loss)]
fn gc_content(seq: &SeqAccum) -> f64 {
    let strong = seq.counts[ALPHABET_C] + seq.counts[ALPHABET_G] + seq.counts[ALPHABET_S];
    let weak = seq.counts[ALPHABET_A]
        + seq.counts[ALPHABET_T]
        + seq.counts[ALPHABET_U]
        + seq.counts[ALPHABET_W];
    let partial_gc = seq.counts[ALPHABET_R]
        + seq.counts[ALPHABET_Y]
        + seq.counts[ALPHABET_K]
        + seq.counts[ALPHABET_M];
    let partial_ambiguous = seq.counts[ALPHABET_N]
        + seq.counts[ALPHABET_B]
        + seq.counts[ALPHABET_D]
        + seq.counts[ALPHABET_H]
        + seq.counts[ALPHABET_V];
    let total_bases = strong + weak + partial_gc + partial_ambiguous;
    if total_bases == 0 {
        return 0.0;
    }
    ((f64::from(strong)) + f64::from(partial_gc + partial_ambiguous) * 0.5) / f64::from(total_bases)
        * 100.0
}

#[allow(clippy::cast_precision_loss)]
fn at_content(seq: &SeqAccum) -> f64 {
    let weak = seq.counts[ALPHABET_A]
        + seq.counts[ALPHABET_T]
        + seq.counts[ALPHABET_U]
        + seq.counts[ALPHABET_W];
    let strong = seq.counts[ALPHABET_C] + seq.counts[ALPHABET_G] + seq.counts[ALPHABET_S];
    let partial_gc = seq.counts[ALPHABET_R]
        + seq.counts[ALPHABET_Y]
        + seq.counts[ALPHABET_K]
        + seq.counts[ALPHABET_M];
    let partial_ambiguous = seq.counts[ALPHABET_N]
        + seq.counts[ALPHABET_B]
        + seq.counts[ALPHABET_D]
        + seq.counts[ALPHABET_H]
        + seq.counts[ALPHABET_V];
    let total_bases = strong + weak + partial_gc + partial_ambiguous;
    if total_bases == 0 {
        return 0.0;
    }
    ((f64::from(weak)) + f64::from(partial_gc + partial_ambiguous) * 0.5) / f64::from(total_bases)
        * 100.0
}

fn gc_skew_value(seq: &SeqAccum) -> f64 {
    let g = f64::from(seq.counts[ALPHABET_G]);
    let c = f64::from(seq.counts[ALPHABET_C]);
    if g + c == 0.0 {
        0.0
    } else {
        ((g - c) / (g + c)) * 100.0
    }
}

fn at_skew_value(seq: &SeqAccum) -> f64 {
    let a = f64::from(seq.counts[ALPHABET_A]);
    let t = f64::from(seq.counts[ALPHABET_T] + seq.counts[ALPHABET_U]);
    if a + t == 0.0 {
        0.0
    } else {
        ((a - t) / (a + t)) * 100.0
    }
}

fn entropy_value(seq: &SeqAccum) -> f64 {
    if seq.len == 0 {
        return 0.0;
    }

    let total = f64::from(seq.len);
    let mut entropy = 0.0;
    for &count in &seq.counts {
        if count > 0 {
            let p = f64::from(count) / total;
            entropy -= p * p.log2();
        }
    }
    entropy
}

fn alphabet_mask_value(seq: &SeqAccum) -> u32 {
    let mut mask = 0u32;
    for (idx, &count) in seq.counts.iter().enumerate() {
        if count > 0 {
            mask |= 1u32 << idx;
        }
    }
    mask
}
