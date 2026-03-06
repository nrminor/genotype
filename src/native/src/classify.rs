//! SIMD-accelerated byte-level sequence classification.
//!
//! This module contains two primitives for classifying sequence bytes:
//!
//! `classify` counts bytes into 8 classes (AT, GC, strong, weak, two-base
//! ambiguity, multi-base ambiguity, gap, other) using SIMD compare-and-select
//! with per-class `u8` accumulators flushed every 255 chunks. The TypeScript
//! layer computes gcContent, atContent, and base composition from these counts.
//!
//! `check_valid` does an early-exit SIMD scan that bails on the first byte
//! not in the allowed character set. 3-4x faster than the classifier even in
//! its worst case, and orders of magnitude faster when invalid bytes appear
//! early in the sequence.

use std::simd::{prelude::*, Mask, Select, Simd};

/// Number of byte classes returned by `classify`.
pub const NUM_CLASSES: usize = 8;

/// Class indices for the counts array returned by `classify`.
pub const CLASS_AT: usize = 0;
pub const CLASS_GC: usize = 1;
pub const CLASS_STRONG: usize = 2;
pub const CLASS_WEAK: usize = 3;
pub const CLASS_TWO_BASE: usize = 4;
pub const CLASS_MULTI: usize = 5;
pub const CLASS_GAP: usize = 6;
pub const CLASS_OTHER: usize = 7;

pub fn classify(input: &[u8], counts: &mut [u32; NUM_CLASSES]) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            unsafe { classify_avx512(input, counts) };
            return;
        }
        if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            unsafe { classify_avx2(input, counts) };
            return;
        }
    }
    classify_generic::<16>(input, counts);
}

/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn classify_avx512(input: &[u8], counts: &mut [u32; NUM_CLASSES]) {
    classify_generic::<64>(input, counts);
}

/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn classify_avx2(input: &[u8], counts: &mut [u32; NUM_CLASSES]) {
    classify_generic::<32>(input, counts);
}

fn classify_generic<const N: usize>(input: &[u8], counts: &mut [u32; NUM_CLASSES]) {
    let chunks = input.chunks_exact(N);
    let remainder = chunks.remainder();

    let mut accum = [Simd::<u8, N>::splat(0); NUM_CLASSES];
    let mut chunk_count = 0u32;

    let one = Simd::splat(1u8);
    let zero = Simd::splat(0u8);

    for chunk in chunks {
        let vec = Simd::<u8, N>::from_slice(chunk);
        let upper = vec & Simd::splat(!0x20);

        let is_at = upper.simd_eq(Simd::splat(b'A'))
            | upper.simd_eq(Simd::splat(b'T'))
            | upper.simd_eq(Simd::splat(b'U'));

        let is_gc = upper.simd_eq(Simd::splat(b'G')) | upper.simd_eq(Simd::splat(b'C'));

        let is_s = upper.simd_eq(Simd::splat(b'S'));
        let is_w = upper.simd_eq(Simd::splat(b'W'));

        let is_2base = upper.simd_eq(Simd::splat(b'R'))
            | upper.simd_eq(Simd::splat(b'Y'))
            | upper.simd_eq(Simd::splat(b'K'))
            | upper.simd_eq(Simd::splat(b'M'));

        let is_multi = upper.simd_eq(Simd::splat(b'N'))
            | upper.simd_eq(Simd::splat(b'B'))
            | upper.simd_eq(Simd::splat(b'D'))
            | upper.simd_eq(Simd::splat(b'H'))
            | upper.simd_eq(Simd::splat(b'V'));

        // Gap characters are compared without case folding
        let is_gap = vec.simd_eq(Simd::splat(b'-'))
            | vec.simd_eq(Simd::splat(b'.'))
            | vec.simd_eq(Simd::splat(b'*'));

        let is_known = is_at | is_gc | is_s | is_w | is_2base | is_multi | is_gap;
        let is_other = !is_known;

        accum[CLASS_AT] += is_at.select(one, zero);
        accum[CLASS_GC] += is_gc.select(one, zero);
        accum[CLASS_STRONG] += is_s.select(one, zero);
        accum[CLASS_WEAK] += is_w.select(one, zero);
        accum[CLASS_TWO_BASE] += is_2base.select(one, zero);
        accum[CLASS_MULTI] += is_multi.select(one, zero);
        accum[CLASS_GAP] += is_gap.select(one, zero);
        accum[CLASS_OTHER] += is_other.select(one, zero);

        chunk_count += 1;
        if chunk_count == 255 {
            flush_accumulators(&accum, counts);
            accum = [Simd::<u8, N>::splat(0); NUM_CLASSES];
            chunk_count = 0;
        }
    }

    flush_accumulators(&accum, counts);

    for &b in remainder {
        counts[classify_scalar(b)] += 1;
    }
}

fn flush_accumulators<const N: usize>(
    accum: &[Simd<u8, N>; NUM_CLASSES],
    counts: &mut [u32; NUM_CLASSES],
) {
    for (i, acc) in accum.iter().enumerate() {
        let arr = acc.to_array();
        let mut sum = 0u32;
        for &v in &arr {
            sum += u32::from(v);
        }
        counts[i] += sum;
    }
}

#[inline]
fn classify_scalar(b: u8) -> usize {
    let upper = b & !0x20;
    match upper {
        b'A' | b'T' | b'U' => CLASS_AT,
        b'G' | b'C' => CLASS_GC,
        b'S' => CLASS_STRONG,
        b'W' => CLASS_WEAK,
        b'R' | b'Y' | b'K' | b'M' => CLASS_TWO_BASE,
        b'N' | b'B' | b'D' | b'H' | b'V' => CLASS_MULTI,
        _ => {
            if matches!(b, b'-' | b'.' | b'*') {
                CLASS_GAP
            } else {
                CLASS_OTHER
            }
        }
    }
}

/// Validation modes corresponding to different allowed character sets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidMode {
    /// ACGT + gaps (.-*)
    StrictDna,
    /// ACGTU + all IUPAC codes + gaps
    NormalDna,
    /// ACGU + gaps
    StrictRna,
    /// ACGU + all IUPAC codes (no T) + gaps
    NormalRna,
    /// 20 standard amino acids + gaps
    Protein,
}

pub fn check_valid(input: &[u8], mode: ValidMode) -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            return unsafe { check_valid_avx512(input, mode) };
        }
        if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            return unsafe { check_valid_avx2(input, mode) };
        }
    }
    check_valid_generic::<16>(input, mode)
}

/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn check_valid_avx512(input: &[u8], mode: ValidMode) -> bool {
    check_valid_generic::<64>(input, mode)
}

/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn check_valid_avx2(input: &[u8], mode: ValidMode) -> bool {
    check_valid_generic::<32>(input, mode)
}

fn check_valid_generic<const N: usize>(input: &[u8], mode: ValidMode) -> bool {
    let chunks = input.chunks_exact(N);
    let remainder = chunks.remainder();

    for chunk in chunks {
        let vec = Simd::<u8, N>::from_slice(chunk);
        if !chunk_is_valid(vec, mode) {
            return false;
        }
    }

    for &b in remainder {
        if !byte_is_valid(b, mode) {
            return false;
        }
    }

    true
}

#[inline]
fn chunk_is_valid<const N: usize>(vec: Simd<u8, N>, mode: ValidMode) -> bool {
    let upper = vec & Simd::splat(!0x20);

    // Gap characters are always allowed (compared without case folding)
    let is_gap = vec.simd_eq(Simd::splat(b'-'))
        | vec.simd_eq(Simd::splat(b'.'))
        | vec.simd_eq(Simd::splat(b'*'));

    let is_valid = match mode {
        ValidMode::StrictDna => {
            upper.simd_eq(Simd::splat(b'A'))
                | upper.simd_eq(Simd::splat(b'C'))
                | upper.simd_eq(Simd::splat(b'G'))
                | upper.simd_eq(Simd::splat(b'T'))
                | is_gap
        }
        ValidMode::StrictRna => {
            upper.simd_eq(Simd::splat(b'A'))
                | upper.simd_eq(Simd::splat(b'C'))
                | upper.simd_eq(Simd::splat(b'G'))
                | upper.simd_eq(Simd::splat(b'U'))
                | is_gap
        }
        ValidMode::NormalDna | ValidMode::NormalRna => {
            let is_standard = upper.simd_eq(Simd::splat(b'A'))
                | upper.simd_eq(Simd::splat(b'C'))
                | upper.simd_eq(Simd::splat(b'G'));

            let is_tu = if mode == ValidMode::NormalDna {
                upper.simd_eq(Simd::splat(b'T')) | upper.simd_eq(Simd::splat(b'U'))
            } else {
                // NormalRna: U is allowed, T is not
                upper.simd_eq(Simd::splat(b'U'))
            };

            let is_iupac = upper.simd_eq(Simd::splat(b'R'))
                | upper.simd_eq(Simd::splat(b'Y'))
                | upper.simd_eq(Simd::splat(b'S'))
                | upper.simd_eq(Simd::splat(b'W'))
                | upper.simd_eq(Simd::splat(b'K'))
                | upper.simd_eq(Simd::splat(b'M'))
                | upper.simd_eq(Simd::splat(b'B'))
                | upper.simd_eq(Simd::splat(b'D'))
                | upper.simd_eq(Simd::splat(b'H'))
                | upper.simd_eq(Simd::splat(b'V'))
                | upper.simd_eq(Simd::splat(b'N'));

            is_standard | is_tu | is_iupac | is_gap
        }
        ValidMode::Protein => {
            // 20 standard amino acids: ACDEFGHIKLMNPQRSTVWY
            upper.simd_eq(Simd::splat(b'A'))
                | upper.simd_eq(Simd::splat(b'C'))
                | upper.simd_eq(Simd::splat(b'D'))
                | upper.simd_eq(Simd::splat(b'E'))
                | upper.simd_eq(Simd::splat(b'F'))
                | upper.simd_eq(Simd::splat(b'G'))
                | upper.simd_eq(Simd::splat(b'H'))
                | upper.simd_eq(Simd::splat(b'I'))
                | upper.simd_eq(Simd::splat(b'K'))
                | upper.simd_eq(Simd::splat(b'L'))
                | upper.simd_eq(Simd::splat(b'M'))
                | upper.simd_eq(Simd::splat(b'N'))
                | upper.simd_eq(Simd::splat(b'P'))
                | upper.simd_eq(Simd::splat(b'Q'))
                | upper.simd_eq(Simd::splat(b'R'))
                | upper.simd_eq(Simd::splat(b'S'))
                | upper.simd_eq(Simd::splat(b'T'))
                | upper.simd_eq(Simd::splat(b'V'))
                | upper.simd_eq(Simd::splat(b'W'))
                | upper.simd_eq(Simd::splat(b'Y'))
                | is_gap
        }
    };

    is_valid == Mask::splat(true)
}

#[inline]
fn byte_is_valid(b: u8, mode: ValidMode) -> bool {
    let upper = b & !0x20;
    if matches!(b, b'-' | b'.' | b'*') {
        return true;
    }
    match mode {
        ValidMode::StrictDna => matches!(upper, b'A' | b'C' | b'G' | b'T'),
        ValidMode::StrictRna => matches!(upper, b'A' | b'C' | b'G' | b'U'),
        ValidMode::NormalDna => matches!(
            upper,
            b'A' | b'C'
                | b'G'
                | b'T'
                | b'U'
                | b'R'
                | b'Y'
                | b'S'
                | b'W'
                | b'K'
                | b'M'
                | b'B'
                | b'D'
                | b'H'
                | b'V'
                | b'N'
        ),
        ValidMode::NormalRna => matches!(
            upper,
            b'A' | b'C'
                | b'G'
                | b'U'
                | b'R'
                | b'Y'
                | b'S'
                | b'W'
                | b'K'
                | b'M'
                | b'B'
                | b'D'
                | b'H'
                | b'V'
                | b'N'
        ),
        ValidMode::Protein => matches!(
            upper,
            b'A' | b'C'
                | b'D'
                | b'E'
                | b'F'
                | b'G'
                | b'H'
                | b'I'
                | b'K'
                | b'L'
                | b'M'
                | b'N'
                | b'P'
                | b'Q'
                | b'R'
                | b'S'
                | b'T'
                | b'V'
                | b'W'
                | b'Y'
        ),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn run_classify(input: &[u8]) -> [u32; NUM_CLASSES] {
        let mut counts = [0u32; NUM_CLASSES];
        classify(input, &mut counts);
        counts
    }

    mod classify_tests {
        use super::*;

        #[test]
        fn pure_acgt() {
            let counts = run_classify(b"AACCGGTT");
            assert_eq!(counts[CLASS_AT], 4); // AA + TT
            assert_eq!(counts[CLASS_GC], 4); // CC + GG
            assert_eq!(counts[CLASS_STRONG], 0);
            assert_eq!(counts[CLASS_WEAK], 0);
            assert_eq!(counts[CLASS_TWO_BASE], 0);
            assert_eq!(counts[CLASS_MULTI], 0);
            assert_eq!(counts[CLASS_GAP], 0);
            assert_eq!(counts[CLASS_OTHER], 0);
        }

        #[test]
        fn rna_u_counts_as_at() {
            let counts = run_classify(b"AAUUGG");
            assert_eq!(counts[CLASS_AT], 4); // AA + UU
            assert_eq!(counts[CLASS_GC], 2);
        }

        #[test]
        fn case_insensitive() {
            let counts = run_classify(b"AaCcGgTt");
            assert_eq!(counts[CLASS_AT], 4);
            assert_eq!(counts[CLASS_GC], 4);
        }

        #[test]
        fn iupac_strong_weak() {
            let counts = run_classify(b"SSWWssw");
            assert_eq!(counts[CLASS_STRONG], 4); // SS + ss
            assert_eq!(counts[CLASS_WEAK], 3); // WW + w
        }

        #[test]
        fn iupac_two_base_ambiguity() {
            let counts = run_classify(b"RYKMrykm");
            assert_eq!(counts[CLASS_TWO_BASE], 8);
        }

        #[test]
        fn iupac_multi_base_ambiguity() {
            let counts = run_classify(b"NBDHVnbdhv");
            assert_eq!(counts[CLASS_MULTI], 10);
        }

        #[test]
        fn gap_characters() {
            let counts = run_classify(b"A-C.G*T");
            assert_eq!(counts[CLASS_AT], 2);
            assert_eq!(counts[CLASS_GC], 2);
            assert_eq!(counts[CLASS_GAP], 3);
        }

        #[test]
        fn other_characters() {
            let counts = run_classify(b"ACGT123XZ!");
            assert_eq!(counts[CLASS_AT], 2);
            assert_eq!(counts[CLASS_GC], 2);
            assert_eq!(counts[CLASS_OTHER], 6);
        }

        #[test]
        fn empty_input() {
            let counts = run_classify(b"");
            assert_eq!(counts, [0; NUM_CLASSES]);
        }

        #[test]
        fn counts_sum_to_length() {
            let input = b"ATCGNrykmswbdhv.-*1XZ";
            let counts = run_classify(input);
            let total: u32 = counts.iter().sum();
            assert_eq!(total, input.len() as u32);
        }

        #[test]
        fn realistic_mixed_sequence() {
            // A realistic sequence with standard bases, IUPAC codes, and gaps
            let input = b"ATCGATCG-NNRYSWKM..BDHV*acgt";
            let counts = run_classify(input);
            let total: u32 = counts.iter().sum();
            assert_eq!(total, input.len() as u32);
            assert!(counts[CLASS_AT] > 0);
            assert!(counts[CLASS_GC] > 0);
            assert!(counts[CLASS_MULTI] > 0);
            assert!(counts[CLASS_GAP] > 0);
        }
    }

    mod check_valid_tests {
        use super::*;

        #[test]
        fn strict_dna_accepts_acgt() {
            assert!(check_valid(b"ACGTACGT", ValidMode::StrictDna));
            assert!(check_valid(b"acgtacgt", ValidMode::StrictDna));
            assert!(check_valid(b"AcGt", ValidMode::StrictDna));
        }

        #[test]
        fn strict_dna_accepts_gaps() {
            assert!(check_valid(b"A-C.G*T", ValidMode::StrictDna));
        }

        #[test]
        fn strict_dna_rejects_u() {
            assert!(!check_valid(b"ACGU", ValidMode::StrictDna));
        }

        #[test]
        fn strict_dna_rejects_iupac() {
            assert!(!check_valid(b"ACGTN", ValidMode::StrictDna));
            assert!(!check_valid(b"ACGTR", ValidMode::StrictDna));
        }

        #[test]
        fn strict_rna_accepts_acgu() {
            assert!(check_valid(b"ACGUACGU", ValidMode::StrictRna));
            assert!(check_valid(b"acguacgu", ValidMode::StrictRna));
        }

        #[test]
        fn strict_rna_rejects_t() {
            assert!(!check_valid(b"ACGT", ValidMode::StrictRna));
        }

        #[test]
        fn normal_dna_accepts_iupac() {
            assert!(check_valid(
                b"ACGTURYSWKMBDHVNacgturyswkmbdhvn",
                ValidMode::NormalDna
            ));
        }

        #[test]
        fn normal_dna_accepts_gaps() {
            assert!(check_valid(b"ACGT-.*", ValidMode::NormalDna));
        }

        #[test]
        fn normal_dna_rejects_digits() {
            assert!(!check_valid(b"ACGT123", ValidMode::NormalDna));
        }

        #[test]
        fn normal_rna_accepts_iupac_without_t() {
            assert!(check_valid(
                b"ACGURYSWKMBDHVNacguryswkmbdhvn",
                ValidMode::NormalRna
            ));
        }

        #[test]
        fn normal_rna_rejects_t() {
            assert!(!check_valid(b"ACGUT", ValidMode::NormalRna));
        }

        #[test]
        fn protein_accepts_standard_amino_acids() {
            assert!(check_valid(
                b"ACDEFGHIKLMNPQRSTVWYacdefghiklmnpqrstvwy",
                ValidMode::Protein
            ));
        }

        #[test]
        fn protein_accepts_gaps() {
            assert!(check_valid(b"ACDE-.*", ValidMode::Protein));
        }

        #[test]
        fn protein_rejects_non_amino_acids() {
            assert!(!check_valid(b"ACDEX", ValidMode::Protein));
            assert!(!check_valid(b"ACDE1", ValidMode::Protein));
        }

        #[test]
        fn empty_input_is_valid() {
            assert!(check_valid(b"", ValidMode::StrictDna));
            assert!(check_valid(b"", ValidMode::Protein));
        }
    }

    mod simd_boundary_tests {
        use super::*;

        const LENGTHS: &[usize] = &[15, 16, 17, 31, 32, 33, 63, 64, 65];

        fn pattern_bytes(len: usize) -> Vec<u8> {
            b"ATCGNrykmswbdhv.-*1"
                .iter()
                .copied()
                .cycle()
                .take(len)
                .collect()
        }

        fn classify_oracle(input: &[u8]) -> [u32; NUM_CLASSES] {
            let mut counts = [0u32; NUM_CLASSES];
            for &b in input {
                counts[classify_scalar(b)] += 1;
            }
            counts
        }

        #[test]
        fn classify_at_all_boundaries() {
            for &len in LENGTHS {
                let input = pattern_bytes(len);
                let expected = classify_oracle(&input);
                let actual = run_classify(&input);
                assert_eq!(actual, expected, "len={len}");
            }
        }

        #[test]
        fn check_valid_at_all_boundaries() {
            // Pure ACGT sequences at boundary lengths
            for &len in LENGTHS {
                let clean: Vec<u8> = b"ACGT".iter().copied().cycle().take(len).collect();
                assert!(check_valid(&clean, ValidMode::StrictDna), "clean len={len}");
                assert!(check_valid(&clean, ValidMode::NormalDna), "clean len={len}");

                // Sequence with one invalid byte at the end
                let mut dirty = clean.clone();
                dirty[len - 1] = b'X';
                assert!(
                    !check_valid(&dirty, ValidMode::StrictDna),
                    "dirty len={len}"
                );
            }
        }
    }

    mod output_offset_regression {
        use super::*;

        const OFFSETS: &[usize] = &[0, 1, 3, 7, 15, 16, 17, 31, 32, 33, 63, 64, 65];

        fn make_input(len: usize) -> Vec<u8> {
            b"ATCGNrykmswbdhv.-*1"
                .iter()
                .copied()
                .cycle()
                .take(len)
                .collect()
        }

        #[test]
        fn classify_independent_of_buffer_position() {
            // classify writes to a caller-provided counts array, not an output
            // buffer, so alignment shouldn't matter. But verify that the SIMD
            // path produces consistent results regardless of where the input
            // sits in memory.
            let base_input = make_input(65);
            let expected = run_classify(&base_input);

            for &skip in OFFSETS {
                let mut padded = vec![0xFFu8; skip + base_input.len()];
                padded[skip..skip + base_input.len()].copy_from_slice(&base_input);
                let actual = run_classify(&padded[skip..skip + base_input.len()]);
                assert_eq!(actual, expected, "failed at input offset {skip}");
            }
        }
    }

    mod accumulator_flush_tests {
        use super::*;

        fn classify_oracle(input: &[u8]) -> [u32; NUM_CLASSES] {
            let mut counts = [0u32; NUM_CLASSES];
            for &b in input {
                counts[classify_scalar(b)] += 1;
            }
            counts
        }

        fn pattern_bytes(len: usize) -> Vec<u8> {
            b"ATCGNrykmswbdhv.-*1"
                .iter()
                .copied()
                .cycle()
                .take(len)
                .collect()
        }

        // The u8 SIMD accumulators flush every 255 chunks to avoid overflow.
        // With N=16 lanes, flush triggers at 255 * 16 = 4080 bytes.
        // These tests exercise the exact flush boundary and multi-flush paths
        // that the short boundary tests (15-65 bytes) never reach.

        #[test]
        fn flush_boundary_n16() {
            // 255 chunks * 16 lanes = 4080 bytes
            for len in [4079, 4080, 4081] {
                let input = pattern_bytes(len);
                let expected = classify_oracle(&input);
                let mut actual = [0u32; NUM_CLASSES];
                classify_generic::<16>(&input, &mut actual);
                assert_eq!(actual, expected, "N=16 len={len}");
            }
        }

        #[test]
        fn multiple_flushes_with_remainder() {
            // 2 full flush cycles + partial: 2 * 255 * 16 + 7 = 8167
            let len = 2 * 255 * 16 + 7;
            let input = pattern_bytes(len);
            let expected = classify_oracle(&input);
            let mut actual = [0u32; NUM_CLASSES];
            classify_generic::<16>(&input, &mut actual);
            assert_eq!(actual, expected, "multi-flush N=16 len={len}");
        }

        #[test]
        fn all_one_class_at_flush_boundary() {
            // Maximal per-lane pressure: every byte increments the same
            // accumulator lane. If flush is broken, the u8 accumulators
            // overflow and silently wrap.
            let len = 255 * 16 + 1;
            let input = vec![b'A'; len];
            let mut counts = [0u32; NUM_CLASSES];
            classify_generic::<16>(&input, &mut counts);
            assert_eq!(counts[CLASS_AT], len as u32);
            let total: u32 = counts.iter().sum();
            assert_eq!(total, len as u32);
        }

        #[test]
        fn all_one_class_multiple_flushes() {
            // 3 full flush cycles: 3 * 255 * 16 = 12240
            let len = 3 * 255 * 16;
            let input = vec![b'N'; len];
            let mut counts = [0u32; NUM_CLASSES];
            classify_generic::<16>(&input, &mut counts);
            assert_eq!(counts[CLASS_MULTI], len as u32);
        }

        #[test]
        fn flush_via_public_api() {
            // Ensure the runtime-dispatched classify() also handles flush
            // correctly, not just classify_generic::<16>.
            let len = 255 * 16 + 37;
            let input = pattern_bytes(len);
            let expected = classify_oracle(&input);
            let actual = run_classify(&input);
            assert_eq!(actual, expected, "public API len={len}");
        }
    }
}
