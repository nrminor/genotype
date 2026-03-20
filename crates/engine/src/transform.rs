//! SIMD-accelerated byte-level sequence transformations.
//!
//! This module contains pure byte-slice operations with no FFI dependencies.
//! Each public function dispatches to the widest available SIMD lane width
//! at runtime on `x86_64`, or uses 128-bit NEON/WASM SIMD on other targets.
//!
//! The core pattern is compare-and-select: compare each byte against known
//! values, select the replacement where a match is found, pass through the
//! original byte otherwise. Case preservation uses the bit 5 trick — ASCII
//! lowercase letters differ from uppercase by exactly bit 5 (0x20).

use std::simd::{prelude::*, Mask, Select, Simd};

pub fn complement(input: &[u8], out: &mut [u8], rna: bool) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            unsafe { complement_avx512(input, out, rna) };
            return;
        }
        if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            unsafe { complement_avx2(input, out, rna) };
            return;
        }
    }
    complement_generic::<16>(input, out, rna);
}

/// Complement using 512-bit vectors (64 bytes per iteration).
///
/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`
/// before calling. The function body is safe — only the call is unsafe
/// because `#[target_feature]` makes executing these instructions on a
/// CPU without the feature undefined behavior.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn complement_avx512(input: &[u8], out: &mut [u8], rna: bool) {
    complement_generic::<64>(input, out, rna);
}

/// Complement using 256-bit vectors (32 bytes per iteration).
///
/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`
/// before calling. The function body is safe — only the call is unsafe
/// because `#[target_feature]` makes executing these instructions on a
/// CPU without the feature undefined behavior.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn complement_avx2(input: &[u8], out: &mut [u8], rna: bool) {
    complement_generic::<32>(input, out, rna);
}

fn complement_generic<const N: usize>(input: &[u8], out: &mut [u8], rna: bool) {
    let chunks = input.chunks_exact(N);
    let remainder = chunks.remainder();
    let mut offset = 0;

    for chunk in chunks {
        let vec = Simd::<u8, N>::from_slice(chunk);
        let result = complement_simd(vec, rna);
        out[offset..offset + N].copy_from_slice(&result.to_array());
        offset += N;
    }

    for (i, &b) in remainder.iter().enumerate() {
        out[offset + i] = complement_scalar(b, rna);
    }
}

#[inline]
fn complement_simd<const N: usize>(vec: Simd<u8, N>, rna: bool) -> Simd<u8, N> {
    let case_bits = vec & Simd::splat(0x20);
    let upper = vec & Simd::splat(!0x20);

    let comp_a = if rna { b'U' } else { b'T' };

    let mut result = upper;

    result = upper
        .simd_eq(Simd::splat(b'A'))
        .select(Simd::splat(comp_a), result);
    result = upper
        .simd_eq(Simd::splat(b'T'))
        .select(Simd::splat(b'A'), result);
    result = upper
        .simd_eq(Simd::splat(b'U'))
        .select(Simd::splat(b'A'), result);
    result = upper
        .simd_eq(Simd::splat(b'C'))
        .select(Simd::splat(b'G'), result);
    result = upper
        .simd_eq(Simd::splat(b'G'))
        .select(Simd::splat(b'C'), result);

    result = upper
        .simd_eq(Simd::splat(b'R'))
        .select(Simd::splat(b'Y'), result);
    result = upper
        .simd_eq(Simd::splat(b'Y'))
        .select(Simd::splat(b'R'), result);
    result = upper
        .simd_eq(Simd::splat(b'K'))
        .select(Simd::splat(b'M'), result);
    result = upper
        .simd_eq(Simd::splat(b'M'))
        .select(Simd::splat(b'K'), result);
    result = upper
        .simd_eq(Simd::splat(b'B'))
        .select(Simd::splat(b'V'), result);
    result = upper
        .simd_eq(Simd::splat(b'V'))
        .select(Simd::splat(b'B'), result);
    result = upper
        .simd_eq(Simd::splat(b'D'))
        .select(Simd::splat(b'H'), result);
    result = upper
        .simd_eq(Simd::splat(b'H'))
        .select(Simd::splat(b'D'), result);

    result | case_bits
}

#[inline]
fn complement_scalar(b: u8, rna: bool) -> u8 {
    let case_bit = b & 0x20;
    let upper = b & !0x20;
    let comp = match upper {
        b'A' => {
            if rna {
                b'U'
            } else {
                b'T'
            }
        }
        b'T' | b'U' => b'A',
        b'C' => b'G',
        b'G' => b'C',
        b'R' => b'Y',
        b'Y' => b'R',
        b'K' => b'M',
        b'M' => b'K',
        b'B' => b'V',
        b'V' => b'B',
        b'D' => b'H',
        b'H' => b'D',
        _ => upper,
    };
    comp | case_bit
}

pub fn reverse(input: &[u8], out: &mut [u8]) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            unsafe { reverse_avx512(input, out) };
            return;
        }
        if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            unsafe { reverse_avx2(input, out) };
            return;
        }
    }
    reverse_generic::<16>(input, out);
}

/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn reverse_avx512(input: &[u8], out: &mut [u8]) {
    reverse_generic::<64>(input, out);
}

/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn reverse_avx2(input: &[u8], out: &mut [u8]) {
    reverse_generic::<32>(input, out);
}

fn reverse_generic<const N: usize>(input: &[u8], out: &mut [u8]) {
    let len = input.len();
    let full_chunks = len / N;
    let remainder = len % N;

    for i in 0..full_chunks {
        let src_start = len - (i + 1) * N;
        let chunk = Simd::<u8, N>::from_slice(&input[src_start..src_start + N]);
        let reversed = chunk.reverse();
        out[i * N..(i + 1) * N].copy_from_slice(&reversed.to_array());
    }

    for i in 0..remainder {
        out[full_chunks * N + i] = input[remainder - 1 - i];
    }
}

pub fn reverse_complement(input: &[u8], out: &mut [u8], rna: bool) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            unsafe { reverse_complement_avx512(input, out, rna) };
            return;
        }
        if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            unsafe { reverse_complement_avx2(input, out, rna) };
            return;
        }
    }
    reverse_complement_generic::<16>(input, out, rna);
}

/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn reverse_complement_avx512(input: &[u8], out: &mut [u8], rna: bool) {
    reverse_complement_generic::<64>(input, out, rna);
}

/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn reverse_complement_avx2(input: &[u8], out: &mut [u8], rna: bool) {
    reverse_complement_generic::<32>(input, out, rna);
}

fn reverse_complement_generic<const N: usize>(input: &[u8], out: &mut [u8], rna: bool) {
    let len = input.len();
    let full_chunks = len / N;
    let remainder = len % N;

    for i in 0..full_chunks {
        let src_start = len - (i + 1) * N;
        let chunk = Simd::<u8, N>::from_slice(&input[src_start..src_start + N]);
        let reversed = chunk.reverse();
        let complemented = complement_simd(reversed, rna);
        out[i * N..(i + 1) * N].copy_from_slice(&complemented.to_array());
    }

    for i in 0..remainder {
        out[full_chunks * N + i] = complement_scalar(input[remainder - 1 - i], rna);
    }
}

pub fn to_rna(input: &[u8], out: &mut [u8]) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            unsafe { to_rna_avx512(input, out) };
            return;
        }
        if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            unsafe { to_rna_avx2(input, out) };
            return;
        }
    }
    to_rna_generic::<16>(input, out);
}

/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn to_rna_avx512(input: &[u8], out: &mut [u8]) {
    to_rna_generic::<64>(input, out);
}

/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn to_rna_avx2(input: &[u8], out: &mut [u8]) {
    to_rna_generic::<32>(input, out);
}

fn to_rna_generic<const N: usize>(input: &[u8], out: &mut [u8]) {
    let chunks = input.chunks_exact(N);
    let remainder = chunks.remainder();
    let mut offset = 0;

    for chunk in chunks {
        let vec = Simd::<u8, N>::from_slice(chunk);
        let case_bits = vec & Simd::splat(0x20);
        let upper = vec & Simd::splat(!0x20);
        let is_t = upper.simd_eq(Simd::splat(b'T'));
        let result = is_t.select(Simd::splat(b'U') | case_bits, vec);
        out[offset..offset + N].copy_from_slice(&result.to_array());
        offset += N;
    }

    for (i, &b) in remainder.iter().enumerate() {
        let case_bit = b & 0x20;
        let upper = b & !0x20;
        out[offset + i] = if upper == b'T' { b'U' | case_bit } else { b };
    }
}

pub fn to_dna(input: &[u8], out: &mut [u8]) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            unsafe { to_dna_avx512(input, out) };
            return;
        }
        if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            unsafe { to_dna_avx2(input, out) };
            return;
        }
    }
    to_dna_generic::<16>(input, out);
}

/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn to_dna_avx512(input: &[u8], out: &mut [u8]) {
    to_dna_generic::<64>(input, out);
}

/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn to_dna_avx2(input: &[u8], out: &mut [u8]) {
    to_dna_generic::<32>(input, out);
}

fn to_dna_generic<const N: usize>(input: &[u8], out: &mut [u8]) {
    let chunks = input.chunks_exact(N);
    let remainder = chunks.remainder();
    let mut offset = 0;

    for chunk in chunks {
        let vec = Simd::<u8, N>::from_slice(chunk);
        let case_bits = vec & Simd::splat(0x20);
        let upper = vec & Simd::splat(!0x20);
        let is_u = upper.simd_eq(Simd::splat(b'U'));
        let result = is_u.select(Simd::splat(b'T') | case_bits, vec);
        out[offset..offset + N].copy_from_slice(&result.to_array());
        offset += N;
    }

    for (i, &b) in remainder.iter().enumerate() {
        let case_bit = b & 0x20;
        let upper = b & !0x20;
        out[offset + i] = if upper == b'U' { b'T' | case_bit } else { b };
    }
}

pub fn uppercase(input: &[u8], out: &mut [u8]) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            unsafe { uppercase_avx512(input, out) };
            return;
        }
        if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            unsafe { uppercase_avx2(input, out) };
            return;
        }
    }
    uppercase_generic::<16>(input, out);
}

/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn uppercase_avx512(input: &[u8], out: &mut [u8]) {
    uppercase_generic::<64>(input, out);
}

/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn uppercase_avx2(input: &[u8], out: &mut [u8]) {
    uppercase_generic::<32>(input, out);
}

fn uppercase_generic<const N: usize>(input: &[u8], out: &mut [u8]) {
    let chunks = input.chunks_exact(N);
    let remainder = chunks.remainder();
    let mut offset = 0;

    for chunk in chunks {
        let vec = Simd::<u8, N>::from_slice(chunk);
        let is_lower = vec.simd_ge(Simd::splat(b'a')) & vec.simd_le(Simd::splat(b'z'));
        let uppered = vec & Simd::splat(!0x20);
        let result = is_lower.select(uppered, vec);
        out[offset..offset + N].copy_from_slice(&result.to_array());
        offset += N;
    }

    for (i, &b) in remainder.iter().enumerate() {
        out[offset + i] = if b.is_ascii_lowercase() { b & !0x20 } else { b };
    }
}

pub fn lowercase(input: &[u8], out: &mut [u8]) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            unsafe { lowercase_avx512(input, out) };
            return;
        }
        if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            unsafe { lowercase_avx2(input, out) };
            return;
        }
    }
    lowercase_generic::<16>(input, out);
}

/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn lowercase_avx512(input: &[u8], out: &mut [u8]) {
    lowercase_generic::<64>(input, out);
}

/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn lowercase_avx2(input: &[u8], out: &mut [u8]) {
    lowercase_generic::<32>(input, out);
}

fn lowercase_generic<const N: usize>(input: &[u8], out: &mut [u8]) {
    let chunks = input.chunks_exact(N);
    let remainder = chunks.remainder();
    let mut offset = 0;

    for chunk in chunks {
        let vec = Simd::<u8, N>::from_slice(chunk);
        let is_upper = vec.simd_ge(Simd::splat(b'A')) & vec.simd_le(Simd::splat(b'Z'));
        let lowered = vec | Simd::splat(0x20);
        let result = is_upper.select(lowered, vec);
        out[offset..offset + N].copy_from_slice(&result.to_array());
        offset += N;
    }

    for (i, &b) in remainder.iter().enumerate() {
        out[offset + i] = if b.is_ascii_uppercase() { b | 0x20 } else { b };
    }
}

pub fn remove_gaps(input: &[u8], gap_chars: &[u8], out: &mut [u8]) -> usize {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            return unsafe { remove_gaps_avx512(input, gap_chars, out) };
        }
        if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            return unsafe { remove_gaps_avx2(input, gap_chars, out) };
        }
    }
    remove_gaps_generic::<16>(input, gap_chars, out)
}

/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn remove_gaps_avx512(input: &[u8], gap_chars: &[u8], out: &mut [u8]) -> usize {
    remove_gaps_generic::<64>(input, gap_chars, out)
}

/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn remove_gaps_avx2(input: &[u8], gap_chars: &[u8], out: &mut [u8]) -> usize {
    remove_gaps_generic::<32>(input, gap_chars, out)
}

fn remove_gaps_generic<const N: usize>(input: &[u8], gap_chars: &[u8], out: &mut [u8]) -> usize {
    let mut write_cursor = 0;

    let chunks = input.chunks_exact(N);
    let remainder = chunks.remainder();

    for chunk in chunks {
        let vec = Simd::<u8, N>::from_slice(chunk);
        let mut is_gap = Mask::<i8, N>::splat(false);
        for &gap in gap_chars {
            is_gap |= vec.simd_eq(Simd::splat(gap));
        }

        let keep_mask = !is_gap;
        let bitmask = keep_mask.to_bitmask();
        let arr = vec.to_array();

        for (bit, &byte) in arr.iter().enumerate() {
            if (bitmask >> bit) & 1 == 1 {
                out[write_cursor] = byte;
                write_cursor += 1;
            }
        }
    }

    for &b in remainder {
        if !gap_chars.contains(&b) {
            out[write_cursor] = b;
            write_cursor += 1;
        }
    }

    write_cursor
}

pub fn replace_invalid(
    input: &[u8],
    mode: crate::classify::ValidMode,
    replacement: u8,
    out: &mut [u8],
) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            unsafe { replace_invalid_avx512(input, mode, replacement, out) };
            return;
        }
        if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            unsafe { replace_invalid_avx2(input, mode, replacement, out) };
            return;
        }
    }
    replace_invalid_generic::<16>(input, mode, replacement, out);
}

/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn replace_invalid_avx512(
    input: &[u8],
    mode: crate::classify::ValidMode,
    replacement: u8,
    out: &mut [u8],
) {
    replace_invalid_generic::<64>(input, mode, replacement, out);
}

/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn replace_invalid_avx2(
    input: &[u8],
    mode: crate::classify::ValidMode,
    replacement: u8,
    out: &mut [u8],
) {
    replace_invalid_generic::<32>(input, mode, replacement, out);
}

fn replace_invalid_generic<const N: usize>(
    input: &[u8],
    mode: crate::classify::ValidMode,
    replacement: u8,
    out: &mut [u8],
) {
    let chunks = input.chunks_exact(N);
    let remainder = chunks.remainder();
    let mut offset = 0;

    let repl = Simd::splat(replacement);

    for chunk in chunks {
        let vec = Simd::<u8, N>::from_slice(chunk);
        let valid = crate::classify::compute_valid_mask(vec, mode);
        let result = valid.select(vec, repl);
        out[offset..offset + N].copy_from_slice(&result.to_array());
        offset += N;
    }

    for (i, &b) in remainder.iter().enumerate() {
        out[offset + i] = if crate::classify::byte_is_valid(b, mode) {
            b
        } else {
            replacement
        };
    }
}

pub fn replace_ambiguous(input: &[u8], replacement: u8, out: &mut [u8]) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            unsafe { replace_ambiguous_avx512(input, replacement, out) };
            return;
        }
        if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            unsafe { replace_ambiguous_avx2(input, replacement, out) };
            return;
        }
    }
    replace_ambiguous_generic::<16>(input, replacement, out);
}

/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn replace_ambiguous_avx512(input: &[u8], replacement: u8, out: &mut [u8]) {
    replace_ambiguous_generic::<64>(input, replacement, out);
}

/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn replace_ambiguous_avx2(input: &[u8], replacement: u8, out: &mut [u8]) {
    replace_ambiguous_generic::<32>(input, replacement, out);
}

fn replace_ambiguous_generic<const N: usize>(input: &[u8], replacement: u8, out: &mut [u8]) {
    let chunks = input.chunks_exact(N);
    let remainder = chunks.remainder();
    let mut offset = 0;

    for chunk in chunks {
        let vec = Simd::<u8, N>::from_slice(chunk);
        let upper = vec & Simd::splat(!0x20);
        let is_standard = upper.simd_eq(Simd::splat(b'A'))
            | upper.simd_eq(Simd::splat(b'C'))
            | upper.simd_eq(Simd::splat(b'G'))
            | upper.simd_eq(Simd::splat(b'T'))
            | upper.simd_eq(Simd::splat(b'U'));
        let result = is_standard.select(vec, Simd::splat(replacement));
        out[offset..offset + N].copy_from_slice(&result.to_array());
        offset += N;
    }

    for (i, &b) in remainder.iter().enumerate() {
        let upper = b & !0x20;
        out[offset + i] = if matches!(upper, b'A' | b'C' | b'G' | b'T' | b'U') {
            b
        } else {
            replacement
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_complement(input: &[u8], rna: bool) -> Vec<u8> {
        let mut out = vec![0u8; input.len()];
        complement(input, &mut out, rna);
        out
    }

    fn run_reverse(input: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; input.len()];
        reverse(input, &mut out);
        out
    }

    fn run_reverse_complement(input: &[u8], rna: bool) -> Vec<u8> {
        let mut out = vec![0u8; input.len()];
        reverse_complement(input, &mut out, rna);
        out
    }

    fn run_to_rna(input: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; input.len()];
        to_rna(input, &mut out);
        out
    }

    fn run_to_dna(input: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; input.len()];
        to_dna(input, &mut out);
        out
    }

    fn run_uppercase(input: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; input.len()];
        uppercase(input, &mut out);
        out
    }

    fn run_lowercase(input: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; input.len()];
        lowercase(input, &mut out);
        out
    }

    fn run_remove_gaps(input: &[u8], gap_chars: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; input.len()];
        let written = remove_gaps(input, gap_chars, &mut out);
        out.truncate(written);
        out
    }

    fn run_replace_ambiguous(input: &[u8], replacement: u8) -> Vec<u8> {
        let mut out = vec![0u8; input.len()];
        replace_ambiguous(input, replacement, &mut out);
        out
    }

    fn run_replace_invalid(
        input: &[u8],
        mode: crate::classify::ValidMode,
        replacement: u8,
    ) -> Vec<u8> {
        let mut out = vec![0u8; input.len()];
        replace_invalid(input, mode, replacement, &mut out);
        out
    }

    mod complement_tests {
        use super::*;

        #[test]
        fn standard_dna_bases() {
            assert_eq!(run_complement(b"ATCG", false), b"TAGC");
        }

        #[test]
        fn standard_rna_complement() {
            assert_eq!(run_complement(b"ATCG", true), b"UAGC");
        }

        #[test]
        fn rna_input_dna_mode() {
            assert_eq!(run_complement(b"AUCG", false), b"TAGC");
        }

        #[test]
        fn rna_input_rna_mode() {
            assert_eq!(run_complement(b"AUCG", true), b"UAGC");
        }

        #[test]
        fn case_preservation() {
            assert_eq!(run_complement(b"AtCg", false), b"TaGc");
        }

        #[test]
        fn iupac_ambiguity_codes() {
            assert_eq!(run_complement(b"RYKMSWBVDHN", false), b"YRMKSWVBHDN");
        }

        #[test]
        fn iupac_case_preservation() {
            assert_eq!(run_complement(b"ry", false), b"yr");
        }

        #[test]
        fn non_alphabetic_passthrough() {
            assert_eq!(run_complement(b"A-T.C*G", false), b"T-A.G*C");
        }

        #[test]
        fn empty_input() {
            assert_eq!(run_complement(b"", false), b"");
        }

        #[test]
        fn short_input_scalar_only() {
            assert_eq!(run_complement(b"ACG", false), b"TGC");
        }

        #[test]
        fn exactly_16_bytes() {
            assert_eq!(
                run_complement(b"ATCGATCGATCGATCG", false),
                b"TAGCTAGCTAGCTAGC"
            );
        }

        #[test]
        fn longer_than_16_with_remainder() {
            let input = b"ATCGATCGATCGATCGATCG";
            let expected = b"TAGCTAGCTAGCTAGCTAGC";
            assert_eq!(run_complement(input, false), expected.to_vec());
        }
    }

    mod reverse_tests {
        use super::*;

        #[test]
        fn standard_reverse() {
            assert_eq!(run_reverse(b"ATCG"), b"GCTA");
        }

        #[test]
        fn empty_input() {
            assert_eq!(run_reverse(b""), b"");
        }

        #[test]
        fn single_byte() {
            assert_eq!(run_reverse(b"A"), b"A");
        }

        #[test]
        fn preserves_case() {
            assert_eq!(run_reverse(b"AtCg"), b"gCtA");
        }

        #[test]
        fn exactly_16_bytes() {
            assert_eq!(run_reverse(b"ABCDEFGHIJKLMNOP"), b"PONMLKJIHGFEDCBA");
        }

        #[test]
        fn longer_with_remainder() {
            assert_eq!(run_reverse(b"ABCDEFGHIJKLMNOPQRS"), b"SRQPONMLKJIHGFEDCBA");
        }
    }

    mod reverse_complement_tests {
        use super::*;

        #[test]
        fn standard_dna() {
            assert_eq!(run_reverse_complement(b"ATCG", false), b"CGAT");
        }

        #[test]
        fn standard_rna() {
            assert_eq!(run_reverse_complement(b"AUCG", true), b"CGAU");
        }

        #[test]
        fn case_preservation() {
            assert_eq!(run_reverse_complement(b"AtCg", false), b"cGaT");
        }

        #[test]
        fn empty_input() {
            assert_eq!(run_reverse_complement(b"", false), b"");
        }

        #[test]
        fn single_pass_matches_two_step() {
            let input = b"ATCGATCGATCGATCGATCG";
            let mut comp = vec![0u8; input.len()];
            complement(input, &mut comp, false);
            let mut rev_comp_two_step = vec![0u8; input.len()];
            reverse(&comp, &mut rev_comp_two_step);
            let single_pass = run_reverse_complement(input, false);
            assert_eq!(single_pass, rev_comp_two_step);
        }

        #[test]
        fn known_expected_not_derived() {
            // Hand-verified expected value to avoid self-referential testing
            // where a shared bug in complement+reverse could mask a bug in
            // reverse_complement.
            //   input:    A  T  C  G  a  t  c  g
            //   comp:     T  A  G  C  t  a  g  c
            //   reversed: c  g  a  t  C  G  A  T
            assert_eq!(run_reverse_complement(b"ATCGatcg", false), b"cgatCGAT");
        }
    }

    mod to_rna_tests {
        use super::*;

        #[test]
        fn converts_t_to_u() {
            assert_eq!(run_to_rna(b"ATCG"), b"AUCG");
        }

        #[test]
        fn preserves_case() {
            assert_eq!(run_to_rna(b"AtCg"), b"AuCg");
        }

        #[test]
        fn no_t_unchanged() {
            assert_eq!(run_to_rna(b"ACGN"), b"ACGN");
        }

        #[test]
        fn empty_input() {
            assert_eq!(run_to_rna(b""), b"");
        }

        #[test]
        fn non_alphabetic_passthrough() {
            assert_eq!(run_to_rna(b"A-T.C"), b"A-U.C");
        }
    }

    mod to_dna_tests {
        use super::*;

        #[test]
        fn converts_u_to_t() {
            assert_eq!(run_to_dna(b"AUCG"), b"ATCG");
        }

        #[test]
        fn preserves_case() {
            assert_eq!(run_to_dna(b"AuCg"), b"AtCg");
        }

        #[test]
        fn no_u_unchanged() {
            assert_eq!(run_to_dna(b"ACGN"), b"ACGN");
        }

        #[test]
        fn empty_input() {
            assert_eq!(run_to_dna(b""), b"");
        }
    }

    mod uppercase_tests {
        use super::*;

        #[test]
        fn lowercases_to_upper() {
            assert_eq!(run_uppercase(b"atcg"), b"ATCG");
        }

        #[test]
        fn already_upper_unchanged() {
            assert_eq!(run_uppercase(b"ATCG"), b"ATCG");
        }

        #[test]
        fn non_alphabetic_preserved() {
            assert_eq!(run_uppercase(b"a-t.c*g"), b"A-T.C*G");
        }

        #[test]
        fn digits_preserved() {
            assert_eq!(run_uppercase(b"abc123"), b"ABC123");
        }

        #[test]
        fn empty_input() {
            assert_eq!(run_uppercase(b""), b"");
        }
    }

    mod lowercase_tests {
        use super::*;

        #[test]
        fn uppercases_to_lower() {
            assert_eq!(run_lowercase(b"ATCG"), b"atcg");
        }

        #[test]
        fn already_lower_unchanged() {
            assert_eq!(run_lowercase(b"atcg"), b"atcg");
        }

        #[test]
        fn non_alphabetic_preserved() {
            assert_eq!(run_lowercase(b"A-T.C*G"), b"a-t.c*g");
        }

        #[test]
        fn digits_preserved() {
            assert_eq!(run_lowercase(b"ABC123"), b"abc123");
        }

        #[test]
        fn empty_input() {
            assert_eq!(run_lowercase(b""), b"");
        }
    }

    mod remove_gaps_tests {
        use super::*;

        #[test]
        fn default_gap_chars() {
            assert_eq!(run_remove_gaps(b"AT-C.G*N", b".-*"), b"ATCGN");
        }

        #[test]
        fn custom_gap_chars() {
            assert_eq!(run_remove_gaps(b"AT_C.G", b"_."), b"ATCG");
        }

        #[test]
        fn no_gaps() {
            assert_eq!(run_remove_gaps(b"ATCG", b".-*"), b"ATCG");
        }

        #[test]
        fn all_gaps() {
            assert_eq!(run_remove_gaps(b"---", b"-"), b"");
        }

        #[test]
        fn empty_input() {
            assert_eq!(run_remove_gaps(b"", b".-*"), b"");
        }

        #[test]
        fn preserves_case() {
            assert_eq!(run_remove_gaps(b"At-Cg", b"-"), b"AtCg");
        }
    }

    mod replace_ambiguous_tests {
        use super::*;

        #[test]
        fn replaces_iupac_codes() {
            assert_eq!(run_replace_ambiguous(b"ATCGNR", b'N'), b"ATCGNN");
        }

        #[test]
        fn custom_replacement() {
            assert_eq!(run_replace_ambiguous(b"ATCGNR", b'X'), b"ATCGXX");
        }

        #[test]
        fn preserves_standard_bases_case_insensitive() {
            assert_eq!(run_replace_ambiguous(b"AaTtCcGgUu", b'N'), b"AaTtCcGgUu");
        }

        #[test]
        fn replaces_gaps_and_digits() {
            assert_eq!(run_replace_ambiguous(b"A-T.C*1", b'N'), b"ANTNCNN");
        }

        #[test]
        fn empty_input() {
            assert_eq!(run_replace_ambiguous(b"", b'N'), b"");
        }

        #[test]
        fn all_standard() {
            assert_eq!(run_replace_ambiguous(b"ATCGU", b'N'), b"ATCGU");
        }
    }

    mod replace_invalid_tests {
        use super::*;
        use crate::classify::ValidMode;

        #[test]
        fn strict_dna_replaces_non_acgt() {
            assert_eq!(
                run_replace_invalid(b"ATCGNR", ValidMode::StrictDna, b'N'),
                b"ATCGNN"
            );
        }

        #[test]
        fn strict_dna_replaces_u() {
            assert_eq!(
                run_replace_invalid(b"ATCGU", ValidMode::StrictDna, b'N'),
                b"ATCGN"
            );
        }

        #[test]
        fn strict_dna_preserves_gaps() {
            assert_eq!(
                run_replace_invalid(b"A-T.C*G", ValidMode::StrictDna, b'N'),
                b"A-T.C*G"
            );
        }

        #[test]
        fn strict_rna_replaces_t() {
            assert_eq!(
                run_replace_invalid(b"ACGUT", ValidMode::StrictRna, b'N'),
                b"ACGUN"
            );
        }

        #[test]
        fn strict_rna_preserves_acgu_and_gaps() {
            assert_eq!(
                run_replace_invalid(b"A-C.G*U", ValidMode::StrictRna, b'N'),
                b"A-C.G*U"
            );
        }

        #[test]
        fn normal_dna_preserves_iupac() {
            assert_eq!(
                run_replace_invalid(b"ACGTURYSWKMBDHVN", ValidMode::NormalDna, b'X'),
                b"ACGTURYSWKMBDHVN"
            );
        }

        #[test]
        fn normal_dna_replaces_digits() {
            assert_eq!(
                run_replace_invalid(b"ACGT123", ValidMode::NormalDna, b'N'),
                b"ACGTNNN"
            );
        }

        #[test]
        fn normal_rna_replaces_t() {
            assert_eq!(
                run_replace_invalid(b"ACGUT", ValidMode::NormalRna, b'N'),
                b"ACGUN"
            );
        }

        #[test]
        fn normal_rna_preserves_iupac_without_t() {
            assert_eq!(
                run_replace_invalid(b"ACGURYSWKMBDHVN", ValidMode::NormalRna, b'X'),
                b"ACGURYSWKMBDHVN"
            );
        }

        #[test]
        fn protein_preserves_amino_acids_and_gaps() {
            assert_eq!(
                run_replace_invalid(b"ACDEFGHIKLMNPQRSTVWY-.*", ValidMode::Protein, b'X'),
                b"ACDEFGHIKLMNPQRSTVWY-.*"
            );
        }

        #[test]
        fn protein_replaces_non_amino_acids() {
            assert_eq!(
                run_replace_invalid(b"ACDE1XZ", ValidMode::Protein, b'X'),
                b"ACDEXXX"
            );
        }

        #[test]
        fn case_insensitive() {
            assert_eq!(
                run_replace_invalid(b"atcg", ValidMode::StrictDna, b'N'),
                b"atcg"
            );
        }

        #[test]
        fn custom_replacement() {
            assert_eq!(
                run_replace_invalid(b"ATCG123", ValidMode::StrictDna, b'X'),
                b"ATCGXXX"
            );
        }

        #[test]
        fn empty_input() {
            assert_eq!(run_replace_invalid(b"", ValidMode::StrictDna, b'N'), b"");
        }

        #[test]
        fn all_valid_passes_through() {
            assert_eq!(
                run_replace_invalid(b"ACGT", ValidMode::StrictDna, b'N'),
                b"ACGT"
            );
        }

        #[test]
        fn all_invalid_replaced() {
            assert_eq!(
                run_replace_invalid(b"123!@#", ValidMode::StrictDna, b'N'),
                b"NNNNNN"
            );
        }
    }

    /// Tests that exercise the SIMD path by using inputs at least 16 bytes
    /// long, and that simulate the `transform_batch` calling pattern where
    /// the output slice starts at an arbitrary offset within a larger buffer.
    ///
    /// The original `as_simd` / `as_simd_mut` approach split input and
    /// output slices based on their independent alignments, causing prefix
    /// length mismatches and corrupted output. These tests catch that class
    /// of bug by writing into a sub-slice of a larger allocation.
    mod output_offset_regression {
        use super::*;

        /// Offsets that cover alignment boundaries for SSE2 (16), AVX2 (32),
        /// and AVX-512 (64). Using a 65-byte input ensures at least one full
        /// SIMD chunk at every lane width, plus a scalar remainder.
        const OFFSETS: &[usize] = &[0, 1, 3, 7, 15, 16, 17, 31, 32, 33, 63, 64, 65];

        /// Simulate the `transform_batch` calling pattern: allocate a buffer
        /// larger than needed, skip `skip` bytes, then pass the remainder
        /// as the output slice. This creates a different alignment than the
        /// input, which would trigger the old `as_simd`/`as_simd_mut` bug.
        fn with_offset<F: FnOnce(&[u8], &mut [u8])>(input: &[u8], skip: usize, f: F) -> Vec<u8> {
            let mut buf = vec![0xFFu8; skip + input.len()];
            f(input, &mut buf[skip..]);
            buf[skip..skip + input.len()].to_vec()
        }

        fn make_input(len: usize) -> Vec<u8> {
            b"ATCGNrykmswbdhv.-*1"
                .iter()
                .copied()
                .cycle()
                .take(len)
                .collect()
        }

        #[test]
        fn complement_at_offset() {
            let input = make_input(65);
            let expected = run_complement(&input, false);
            for &skip in OFFSETS {
                let result = with_offset(&input, skip, |i, o| complement(i, o, false));
                assert_eq!(result, expected, "failed at offset {skip}");
            }
        }

        #[test]
        fn complement_rna_at_offset() {
            let input = make_input(65);
            let expected = run_complement(&input, true);
            for &skip in OFFSETS {
                let result = with_offset(&input, skip, |i, o| complement(i, o, true));
                assert_eq!(result, expected, "failed at offset {skip}");
            }
        }

        #[test]
        fn to_rna_at_offset() {
            let input = make_input(65);
            let expected = run_to_rna(&input);
            for &skip in OFFSETS {
                let result = with_offset(&input, skip, to_rna);
                assert_eq!(result, expected, "failed at offset {skip}");
            }
        }

        #[test]
        fn to_dna_at_offset() {
            let input = make_input(65);
            let expected = run_to_dna(&input);
            for &skip in OFFSETS {
                let result = with_offset(&input, skip, to_dna);
                assert_eq!(result, expected, "failed at offset {skip}");
            }
        }

        #[test]
        fn uppercase_at_offset() {
            let input = make_input(65);
            let expected = run_uppercase(&input);
            for &skip in OFFSETS {
                let result = with_offset(&input, skip, uppercase);
                assert_eq!(result, expected, "failed at offset {skip}");
            }
        }

        #[test]
        fn lowercase_at_offset() {
            let input = make_input(65);
            let expected = run_lowercase(&input);
            for &skip in OFFSETS {
                let result = with_offset(&input, skip, lowercase);
                assert_eq!(result, expected, "failed at offset {skip}");
            }
        }

        #[test]
        fn replace_ambiguous_at_offset() {
            let input = make_input(65);
            let expected = run_replace_ambiguous(&input, b'N');
            for &skip in OFFSETS {
                let result = with_offset(&input, skip, |i, o| replace_ambiguous(i, b'N', o));
                assert_eq!(result, expected, "failed at offset {skip}");
            }
        }

        #[test]
        fn replace_invalid_at_offset() {
            let input = make_input(65);
            let mode = crate::classify::ValidMode::StrictDna;
            let expected = run_replace_invalid(&input, mode, b'N');
            for &skip in OFFSETS {
                let result = with_offset(&input, skip, |i, o| replace_invalid(i, mode, b'N', o));
                assert_eq!(result, expected, "failed at offset {skip}");
            }
        }

        #[test]
        fn reverse_at_offset() {
            let input = make_input(65);
            let expected = run_reverse(&input);
            for &skip in OFFSETS {
                let result = with_offset(&input, skip, reverse);
                assert_eq!(result, expected, "failed at offset {skip}");
            }
        }

        #[test]
        fn reverse_complement_at_offset() {
            let input = make_input(65);
            let expected = run_reverse_complement(&input, false);
            for &skip in OFFSETS {
                let result = with_offset(&input, skip, |i, o| reverse_complement(i, o, false));
                assert_eq!(result, expected, "failed at offset {skip}");
            }
        }

        #[test]
        fn remove_gaps_at_offset() {
            let input = make_input(65);
            let expected = run_remove_gaps(&input, b".-*");
            for &skip in OFFSETS {
                let mut buf = vec![0xFFu8; skip + input.len()];
                let written = remove_gaps(&input, b".-*", &mut buf[skip..]);
                let result = buf[skip..skip + written].to_vec();
                assert_eq!(result, expected, "failed at offset {skip}");
            }
        }
    }

    /// Tests at SIMD-relevant input lengths to ensure correct behavior at
    /// chunk boundaries. Each length exercises a different combination of
    /// full SIMD chunks and scalar remainders across SSE2/AVX2/AVX-512.
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

        fn complement_oracle(input: &[u8], rna: bool) -> Vec<u8> {
            input.iter().map(|&b| complement_scalar(b, rna)).collect()
        }

        #[test]
        fn complement_at_all_boundaries() {
            for &len in LENGTHS {
                let input = pattern_bytes(len);
                let expected = complement_oracle(&input, false);
                assert_eq!(run_complement(&input, false), expected, "dna len={len}");
                let expected_rna = complement_oracle(&input, true);
                assert_eq!(run_complement(&input, true), expected_rna, "rna len={len}");
            }
        }

        #[test]
        fn to_rna_at_all_boundaries() {
            for &len in LENGTHS {
                let input = pattern_bytes(len);
                let expected: Vec<u8> = input
                    .iter()
                    .map(|&b| {
                        let c = b & !0x20;
                        if c == b'T' {
                            b'U' | (b & 0x20)
                        } else {
                            b
                        }
                    })
                    .collect();
                assert_eq!(run_to_rna(&input), expected, "len={len}");
            }
        }

        #[test]
        fn to_dna_at_all_boundaries() {
            for &len in LENGTHS {
                let input = pattern_bytes(len);
                let expected: Vec<u8> = input
                    .iter()
                    .map(|&b| {
                        let c = b & !0x20;
                        if c == b'U' {
                            b'T' | (b & 0x20)
                        } else {
                            b
                        }
                    })
                    .collect();
                assert_eq!(run_to_dna(&input), expected, "len={len}");
            }
        }

        #[test]
        fn uppercase_at_all_boundaries() {
            for &len in LENGTHS {
                let input = pattern_bytes(len);
                let expected: Vec<u8> = input
                    .iter()
                    .map(|b| {
                        if b.is_ascii_lowercase() {
                            b & !0x20
                        } else {
                            *b
                        }
                    })
                    .collect();
                assert_eq!(run_uppercase(&input), expected, "len={len}");
            }
        }

        #[test]
        fn lowercase_at_all_boundaries() {
            for &len in LENGTHS {
                let input = pattern_bytes(len);
                let expected: Vec<u8> = input
                    .iter()
                    .map(|b| if b.is_ascii_uppercase() { b | 0x20 } else { *b })
                    .collect();
                assert_eq!(run_lowercase(&input), expected, "len={len}");
            }
        }

        #[test]
        fn reverse_at_all_boundaries() {
            for &len in LENGTHS {
                let input = pattern_bytes(len);
                let mut expected = input.clone();
                expected.reverse();
                assert_eq!(run_reverse(&input), expected, "len={len}");
            }
        }

        #[test]
        fn reverse_complement_at_all_boundaries() {
            for &len in LENGTHS {
                let input = pattern_bytes(len);
                let mut expected = complement_oracle(&input, false);
                expected.reverse();
                assert_eq!(run_reverse_complement(&input, false), expected, "len={len}");
            }
        }

        #[test]
        fn remove_gaps_at_all_boundaries() {
            for &len in LENGTHS {
                let input = pattern_bytes(len);
                let expected: Vec<u8> = input
                    .iter()
                    .copied()
                    .filter(|b| !b".-*".contains(b))
                    .collect();
                assert_eq!(run_remove_gaps(&input, b".-*"), expected, "len={len}");
            }
        }

        #[test]
        fn replace_ambiguous_at_all_boundaries() {
            for &len in LENGTHS {
                let input = pattern_bytes(len);
                let expected: Vec<u8> = input
                    .iter()
                    .map(|&b| {
                        let upper = b & !0x20;
                        if matches!(upper, b'A' | b'C' | b'G' | b'T' | b'U') {
                            b
                        } else {
                            b'N'
                        }
                    })
                    .collect();
                assert_eq!(run_replace_ambiguous(&input, b'N'), expected, "len={len}");
            }
        }

        #[test]
        fn replace_invalid_at_all_boundaries() {
            use crate::classify::ValidMode;

            let modes = [
                ValidMode::StrictDna,
                ValidMode::NormalDna,
                ValidMode::StrictRna,
                ValidMode::NormalRna,
                ValidMode::Protein,
            ];
            for mode in modes {
                for &len in LENGTHS {
                    let input = pattern_bytes(len);
                    let expected: Vec<u8> = input
                        .iter()
                        .map(|&b| {
                            if crate::classify::byte_is_valid(b, mode) {
                                b
                            } else {
                                b'N'
                            }
                        })
                        .collect();
                    assert_eq!(
                        run_replace_invalid(&input, mode, b'N'),
                        expected,
                        "mode={mode:?} len={len}"
                    );
                }
            }
        }
    }
}
