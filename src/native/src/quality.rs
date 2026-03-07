//! SIMD-accelerated quality score operations.
//!
//! This module operates on quality bytes (Phred-encoded ASCII), not sequence
//! bytes. All functions are encoding-agnostic — they receive the ASCII offset
//! (33 for Phred+33, 64 for Phred+64 and Solexa) as a parameter rather than
//! knowing about encoding schemes. This works because all three supported
//! encodings map linearly from ASCII code to quality score: `score = byte -
//! offset`. The non-linear Solexa math only appears in error probability
//! calculations, which are not kernel operations.

use std::simd::Simd;

/// Compute the average quality score for a single quality string.
///
/// Returns `sum(bytes) / len - offset`, which is equivalent to
/// `mean(byte - offset for byte in input)` but avoids a per-byte
/// subtraction by factoring out the offset.
///
/// Returns 0.0 for empty input.
#[allow(clippy::cast_precision_loss)]
pub fn quality_avg(input: &[u8], ascii_offset: u8) -> f64 {
    if input.is_empty() {
        return 0.0;
    }

    let sum;

    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            // SAFETY: avx512bw support verified by the runtime check above.
            sum = unsafe { sum_bytes_avx512(input) };
        } else if is_x86_feature_detected!("avx2") {
            // SAFETY: avx2 support verified by the runtime check above.
            sum = unsafe { sum_bytes_avx2(input) };
        } else {
            sum = sum_bytes_generic::<16>(input);
        }
    }

    #[cfg(not(target_arch = "x86_64"))]
    {
        sum = sum_bytes_generic::<16>(input);
    }

    // cast_precision_loss: u64→f64 and usize→f64 can lose precision for
    // values above 2^53, but quality byte sums are bounded by 126 * seq_len
    // which won't approach that range for any realistic sequence.
    sum as f64 / input.len() as f64 - f64::from(ascii_offset)
}

/// # Safety
///
/// Caller must verify `avx512bw` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn sum_bytes_avx512(input: &[u8]) -> u64 {
    sum_bytes_generic::<64>(input)
}

/// # Safety
///
/// Caller must verify `avx2` support via `is_x86_feature_detected!`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn sum_bytes_avx2(input: &[u8]) -> u64 {
    sum_bytes_generic::<32>(input)
}

/// Sum all bytes in the input using SIMD horizontal addition.
///
/// Accumulates into `u16` lanes to avoid overflow (max 255 per byte × 255
/// chunks = 65,025 per lane, which fits in `u16`). Flushes to a `u64`
/// running total every 255 chunks to prevent `u16` overflow.
fn sum_bytes_generic<const N: usize>(input: &[u8]) -> u64 {
    let chunks = input.chunks_exact(N);
    let remainder = chunks.remainder();

    let mut total: u64 = 0;
    let mut accum = Simd::<u16, N>::splat(0);
    let mut chunk_count: u32 = 0;

    for chunk in chunks {
        let vec = Simd::<u8, N>::from_slice(chunk);
        // Widen u8 lanes to u16 before adding to avoid overflow.
        // Simd<u8, N> doesn't directly cast to Simd<u16, N> because the
        // lane count changes, so we convert via arrays.
        let arr = vec.to_array();
        let mut wide = [0u16; N];
        for i in 0..N {
            wide[i] = u16::from(arr[i]);
        }
        accum += Simd::<u16, N>::from_array(wide);

        chunk_count += 1;
        if chunk_count == 255 {
            total += horizontal_sum_u16(&accum);
            accum = Simd::<u16, N>::splat(0);
            chunk_count = 0;
        }
    }

    total += horizontal_sum_u16(&accum);

    for &b in remainder {
        total += u64::from(b);
    }

    total
}

#[inline]
fn horizontal_sum_u16<const N: usize>(v: &Simd<u16, N>) -> u64 {
    let arr = v.to_array();
    let mut sum: u64 = 0;
    for &val in &arr {
        sum += u64::from(val);
    }
    sum
}

#[cfg(test)]
mod tests {
    use super::*;

    mod quality_avg_tests {
        use super::*;

        #[test]
        fn empty_input_returns_zero() {
            assert!(
                quality_avg(b"", 33).abs() < f64::EPSILON,
                "expected 0.0 for empty input"
            );
        }

        #[test]
        fn uniform_phred33_q40() {
            // 'I' = ASCII 73, offset 33, score = 40
            let input = b"IIIIIIIIII";
            let avg = quality_avg(input, 33);
            assert!((avg - 40.0).abs() < 1e-10, "expected 40.0, got {avg}");
        }

        #[test]
        fn uniform_phred33_q0() {
            // '!' = ASCII 33, offset 33, score = 0
            let input = b"!!!!!!!!!!";
            let avg = quality_avg(input, 33);
            assert!((avg - 0.0).abs() < 1e-10, "expected 0.0, got {avg}");
        }

        #[test]
        fn mixed_phred33() {
            // '!' = Q0, 'I' = Q40 → average = 20.0
            let input = b"!I";
            let avg = quality_avg(input, 33);
            assert!((avg - 20.0).abs() < 1e-10, "expected 20.0, got {avg}");
        }

        #[test]
        fn phred64_encoding() {
            // 'h' = ASCII 104, offset 64, score = 40
            let input = b"hhhh";
            let avg = quality_avg(input, 64);
            assert!((avg - 40.0).abs() < 1e-10, "expected 40.0, got {avg}");
        }

        #[test]
        fn solexa_negative_scores() {
            // ';' = ASCII 59, offset 64, score = -5 (Solexa minimum)
            let input = b";;;;";
            let avg = quality_avg(input, 64);
            assert!((avg - (-5.0)).abs() < 1e-10, "expected -5.0, got {avg}");
        }

        #[test]
        fn single_byte() {
            // 'F' = ASCII 70, offset 33, score = 37
            let avg = quality_avg(b"F", 33);
            assert!((avg - 37.0).abs() < 1e-10, "expected 37.0, got {avg}");
        }

        #[test]
        fn long_sequence_crosses_flush_boundary() {
            // 255 chunks × 16 lanes = 4080 bytes, plus extra to cross the boundary
            let len = 4100;
            let input = vec![b'I'; len]; // All Q40
            let avg = quality_avg(&input, 33);
            assert!(
                (avg - 40.0).abs() < 1e-10,
                "expected 40.0 for {len}-byte input, got {avg}"
            );
        }

        #[test]
        #[allow(clippy::cast_precision_loss)]
        fn result_matches_scalar_oracle() {
            let input = b"!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            let expected: f64 = {
                let sum: u64 = input.iter().map(|&b| u64::from(b)).sum();
                sum as f64 / input.len() as f64 - 33.0
            };
            let actual = quality_avg(input, 33);
            assert!(
                (actual - expected).abs() < 1e-10,
                "expected {expected}, got {actual}"
            );
        }

        #[test]
        fn boundary_lengths() {
            // Test at SIMD chunk boundaries (N=16)
            for len in [15, 16, 17, 31, 32, 33, 63, 64, 65] {
                let input = vec![b'5'; len]; // ASCII 53, Q20 for phred33
                let avg = quality_avg(&input, 33);
                assert!(
                    (avg - 20.0).abs() < 1e-10,
                    "expected 20.0 at len={len}, got {avg}"
                );
            }
        }
    }
}
