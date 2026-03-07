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

/// Find trim positions (start, end) for a single quality string using a
/// sliding window average.
///
/// Scans forward from position 0 to find the first window whose average
/// quality meets the threshold (`trim_start`), and scans backward from the
/// end to find the last such window (`trim_end`). Uses a running sum that
/// adds the incoming byte and subtracts the outgoing byte, making the
/// algorithm O(n) regardless of window size.
///
/// Returns `(start, end)` where `start` is the first base to keep and
/// `end` is one past the last base to keep (exclusive, like a Rust range).
/// When no window meets the threshold, returns `(0, 0)` for `trim_start`
/// or `(start, start)` for `trim_end`, signaling that trimming consumed
/// the entire sequence.
///
/// The `threshold_sum` parameter is `(threshold + offset) * window_size`,
/// precomputed by the caller so it doesn't repeat per sequence.
#[allow(clippy::cast_precision_loss)]
pub fn quality_trim(
    input: &[u8],
    window_size: u32,
    trim_start: bool,
    trim_end: bool,
    threshold_sum: f64,
) -> (u32, u32) {
    let ws = window_size as usize;
    let len = input.len();

    if len == 0 || ws == 0 || ws > len {
        #[allow(clippy::cast_possible_truncation)]
        return (0, len as u32);
    }

    let mut start: usize = 0;
    let mut end: usize = len;

    if trim_start {
        let mut window_sum: u64 = input[..ws].iter().map(|&b| u64::from(b)).sum();

        if window_sum as f64 >= threshold_sum {
            start = 0;
        } else {
            start = len; // sentinel: no good window found
            for i in 1..=(len - ws) {
                window_sum -= u64::from(input[i - 1]);
                window_sum += u64::from(input[i + ws - 1]);
                if window_sum as f64 >= threshold_sum {
                    start = i;
                    break;
                }
            }
        }
    }

    if start >= len {
        return (0, 0);
    }

    if trim_end {
        let tail_start = len.saturating_sub(ws);
        let mut window_sum: u64 = input[tail_start..tail_start + ws]
            .iter()
            .map(|&b| u64::from(b))
            .sum();

        if window_sum as f64 >= threshold_sum {
            end = tail_start + ws;
        } else {
            end = start; // sentinel: no good window found
            for i in (start..tail_start).rev() {
                window_sum -= u64::from(input[i + ws]);
                window_sum += u64::from(input[i]);
                if window_sum as f64 >= threshold_sum {
                    end = i + ws;
                    break;
                }
            }
        }
    }

    if start >= end {
        return (0, 0);
    }

    #[allow(clippy::cast_possible_truncation)]
    (start as u32, end as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    mod quality_trim_tests {
        use super::*;

        /// Helper: compute `threshold_sum` from score threshold, ASCII offset,
        /// and window size, matching the TypeScript semantics.
        fn ts(threshold: f64, offset: u8, window_size: u32) -> f64 {
            (threshold + f64::from(offset)) * f64::from(window_size)
        }

        #[test]
        fn empty_input() {
            let (s, e) = quality_trim(b"", 4, true, true, ts(20.0, 33, 4));
            assert_eq!((s, e), (0, 0));
        }

        #[test]
        fn window_larger_than_input() {
            // Window size 10, input length 4 → no trimming possible
            let (s, e) = quality_trim(b"IIII", 10, true, true, ts(20.0, 33, 10));
            assert_eq!((s, e), (0, 4));
        }

        #[test]
        fn all_high_quality_unchanged() {
            // 'I' = ASCII 73, Q40 for phred33. Threshold 20 → all windows pass.
            let input = b"IIIIIIIIII";
            let (s, e) = quality_trim(input, 4, true, true, ts(20.0, 33, 4));
            assert_eq!((s, e), (0, 10));
        }

        #[test]
        fn all_low_quality_trimmed_to_nothing() {
            // '!' = ASCII 33, Q0 for phred33. Threshold 20 → no window passes.
            let input = b"!!!!!!!!!!";
            let (s, e) = quality_trim(input, 4, true, true, ts(20.0, 33, 4));
            assert_eq!((s, e), (0, 0));
        }

        #[test]
        fn trim_start_only() {
            // 3 low-quality bases then 7 high-quality bases
            // '!' = Q0, 'I' = Q40, threshold 20, window 4
            // Window at pos 0: "!!!I" → avg 10 < 20
            // Window at pos 1: "!!II" → avg 20 >= 20
            // Wait: "!!II" → (33+33+73+73)/4 - 33 = (212/4) - 33 = 53-33 = 20. Exactly 20.
            let input = b"!!!IIIIIII";
            let (s, e) = quality_trim(input, 4, true, false, ts(20.0, 33, 4));
            assert_eq!(
                s, 1,
                "trim start should find first good window at position 1"
            );
            assert_eq!(e, 10, "end should be unchanged when trim_end is false");
        }

        #[test]
        fn trim_end_only() {
            // 7 high-quality then 3 low-quality
            let input = b"IIIIIII!!!";
            let (s, e) = quality_trim(input, 4, false, true, ts(20.0, 33, 4));
            assert_eq!(s, 0, "start should be unchanged when trim_start is false");
            // Last good window: position 5 "II!!" → avg = (73+73+33+33)/4 - 33 = 20 ≥ 20
            // So end = 5 + 4 = 9
            assert_eq!(e, 9, "trim end should find last good window ending at 9");
        }

        #[test]
        fn trim_both_ends() {
            // Matches the processor test: "!!!IIIIIII!!!"
            let input = b"!!!IIIIIII!!!";
            let (s, e) = quality_trim(input, 4, true, true, ts(20.0, 33, 4));
            assert!(s > 0, "should trim from start");
            assert!(e < 13, "should trim from end");
            assert!(s < e, "should have bases remaining");
        }

        #[test]
        fn window_size_one() {
            // Degenerates to per-base threshold check
            // "!I!I" with threshold 20: first good base at index 1
            let input = b"!I!I";
            let (s, e) = quality_trim(input, 1, true, true, ts(20.0, 33, 1));
            assert_eq!(s, 1, "first base above threshold is at index 1");
            assert_eq!(e, 4, "last base above threshold is at index 3, end = 4");
        }

        #[test]
        fn neither_end_trimmed() {
            // trim_start=false, trim_end=false → returns full range
            let input = b"!!!!!!!!!!";
            let (s, e) = quality_trim(input, 4, false, false, ts(20.0, 33, 4));
            assert_eq!((s, e), (0, 10));
        }

        #[test]
        fn phred64_encoding() {
            // '@' = ASCII 64, Q0 for phred64. 'h' = ASCII 104, Q40.
            let input = b"@@@@hhhhhh";
            let (s, e) = quality_trim(input, 4, true, false, ts(20.0, 64, 4));
            // Window at pos 0: "@@@@" → avg 0 < 20
            // Window at pos 1: "@@@h" → avg 10 < 20
            // Window at pos 2: "@@hh" → avg 20 >= 20
            assert_eq!(s, 2);
            assert_eq!(e, 10);
        }

        #[test]
        fn exact_window_size_equals_input() {
            // Input length equals window size — only one window position
            let input = b"IIII"; // Q40, threshold 20 → passes
            let (s, e) = quality_trim(input, 4, true, true, ts(20.0, 33, 4));
            assert_eq!((s, e), (0, 4));
        }

        #[test]
        fn exact_window_size_equals_input_fails() {
            let input = b"!!!!"; // Q0, threshold 20 → fails
            let (s, e) = quality_trim(input, 4, true, true, ts(20.0, 33, 4));
            assert_eq!((s, e), (0, 0));
        }

        #[test]
        fn matches_typescript_semantics() {
            // Verify against the TypeScript findQualityTrimStart/End behavior:
            // quality = "!!!IIIIII!!!" (3 low, 6 high, 3 low = 12 chars)
            // threshold = 20, window = 4, phred33 (offset 33)
            // threshold_sum = (20 + 33) * 4 = 212
            //
            // Index: 0  1  2  3  4  5  6  7  8  9  10 11
            // Char:  !  !  !  I  I  I  I  I  I  !  !  !
            // ASCII: 33 33 33 73 73 73 73 73 73 33 33 33
            //
            // findQualityTrimStart scans forward:
            //   pos 0: [!,!,!,I] sum=172 < 212
            //   pos 1: [!,!,I,I] sum=212 >= 212 → start=1
            //
            // findQualityTrimEnd scans backward:
            //   pos 8: [I,!,!,!] sum=172 < 212
            //   pos 7: [I,I,!,!] sum=212 >= 212 → end=7+4=11
            let input = b"!!!IIIIII!!!";
            let (s, e) = quality_trim(input, 4, true, true, ts(20.0, 33, 4));
            assert_eq!(s, 1, "trim start should be 1");
            assert_eq!(e, 11, "trim end should be 11");
        }
    }

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
