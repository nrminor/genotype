//! Rayon parallelism benchmarks for batch kernel functions.
//!
//! These benchmarks compare sequential vs rayon-parallel implementations
//! of each kernel family to determine which kernels benefit from thread-level
//! parallelism. Run with:
//!
//! ```sh
//! cargo test --release --lib bench -- --ignored --nocapture
//! ```
//!
//! Results on Apple M-series (March 2026, 27K sequences x 150bp):
//!
//! | Kernel                      | Sequential | Parallel | Speedup |
//! |-----------------------------|-----------|----------|---------|
//! | `find_pattern_batch` k=2    | 29ms      | 4.5ms   | 6.4x    |
//! | `grep_batch` k=2            | 27ms      | 3.5ms   | 7.7x    |
//! | `grep_batch` k=0            | 15ms      | 2.2ms   | 7.1x    |
//! | `classify_batch`            | 1.5ms     | 532us   | 2.9x    |
//! | `check_valid_batch`         | 633us     | 381us   | 1.7x    |
//! | `transform_batch` complement| 725us     | 1.07ms  | 0.68x   |
//! | `quality_bin_batch`         | 657us     | 1.13ms  | 0.58x   |
//!
//! Conclusion: rayon is worth using for search kernels (sassy-based) and
//! classify. The SIMD transform and quality kernels are memory-bandwidth-bound
//! at 150bp and rayon overhead exceeds the parallelism benefit.

use super::*;
use std::hint::black_box;
use std::time::Instant;

const NUM_SEQUENCES: usize = 27_000;
const SEQ_LEN: usize = 150;
const WARMUP_ITERS: usize = 3;
const BENCH_ITERS: usize = 10;

#[allow(clippy::cast_possible_truncation)]
fn make_synthetic_batch() -> (Vec<u8>, Vec<u32>) {
    let mut rng_state: u64 = 0xDEAD_BEEF_CAFE_BABE;
    let mut next_u64 = || -> u64 {
        rng_state = rng_state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        rng_state
    };

    let bases = [b'A', b'C', b'G', b'T'];
    let primer = b"ACGTACGTACGTACGTACGT";
    let mut data = Vec::with_capacity(NUM_SEQUENCES * SEQ_LEN);
    let mut offsets = Vec::with_capacity(NUM_SEQUENCES + 1);

    for _ in 0..NUM_SEQUENCES {
        offsets.push(data.len() as u32);
        let mut seq = Vec::with_capacity(SEQ_LEN);
        for _ in 0..SEQ_LEN {
            seq.push(bases[(next_u64() % 4) as usize]);
        }
        if next_u64() % 5 != 0 {
            let pos = (next_u64() % (SEQ_LEN - primer.len()) as u64) as usize;
            seq[pos..pos + primer.len()].copy_from_slice(primer);
            let num_edits = next_u64() % 3;
            for _ in 0..num_edits {
                let edit_pos = pos + (next_u64() % primer.len() as u64) as usize;
                seq[edit_pos] = bases[(next_u64() % 4) as usize];
            }
        }
        data.extend_from_slice(&seq);
    }
    offsets.push(data.len() as u32);
    (data, offsets)
}

fn bench<S, P>(label: &str, mut sequential: impl FnMut() -> S, mut parallel: impl FnMut() -> P) {
    for _ in 0..WARMUP_ITERS {
        black_box(sequential());
        black_box(parallel());
    }

    let seq_times = {
        let mut times = Vec::with_capacity(BENCH_ITERS);
        for _ in 0..BENCH_ITERS {
            let start = Instant::now();
            black_box(sequential());
            times.push(start.elapsed());
        }
        times.sort();
        times
    };

    let par_times = {
        let mut times = Vec::with_capacity(BENCH_ITERS);
        for _ in 0..BENCH_ITERS {
            let start = Instant::now();
            black_box(parallel());
            times.push(start.elapsed());
        }
        times.sort();
        times
    };

    let seq_median = seq_times[BENCH_ITERS / 2];
    let par_median = par_times[BENCH_ITERS / 2];
    let speedup = seq_median.as_secs_f64() / par_median.as_secs_f64();

    eprintln!("\n--- {label} ---");
    eprintln!("sequential (median of {BENCH_ITERS}): {seq_median:?}");
    eprintln!("parallel   (median of {BENCH_ITERS}): {par_median:?}");
    eprintln!("speedup: {speedup:.2}x");
    eprintln!(
        "sequential all: {:?}",
        seq_times
            .iter()
            .map(|t| format!("{t:?}"))
            .collect::<Vec<_>>()
    );
    eprintln!(
        "parallel   all: {:?}",
        par_times
            .iter()
            .map(|t| format!("{t:?}"))
            .collect::<Vec<_>>()
    );
}

#[test]
#[ignore = "expensive benchmark, run manually"]
#[allow(clippy::cast_possible_truncation)]
fn find_pattern() {
    let (data, offsets) = make_synthetic_batch();
    let num_sequences = offsets.len() - 1;
    let primer = b"ACGTACGTACGTACGTACGT";
    let max_edits = 2u32;
    eprintln!(
        "batch: {num_sequences} sequences x {SEQ_LEN}bp = {} bytes",
        data.len()
    );

    let run_sequential = || {
        let mut ctx = grep::SearchContext::new_with_positions(primer, max_edits, false);
        let mut starts = Vec::new();
        let mut match_offsets = Vec::with_capacity(num_sequences + 1);
        for window in offsets.windows(2) {
            match_offsets.push(starts.len() as u32);
            let seq = &data[window[0] as usize..window[1] as usize];
            for (s, _, _) in ctx.find_matches(seq) {
                starts.push(s);
            }
        }
        match_offsets.push(starts.len() as u32);
        starts
    };

    let run_parallel = || {
        let per_seq: Vec<grep::PerSeqMatches> = (0..num_sequences)
            .into_par_iter()
            .map_init(
                || grep::SearchContext::new_with_positions(primer, max_edits, false),
                |ctx, i| {
                    let seq = &data[offsets[i] as usize..offsets[i + 1] as usize];
                    ctx.find_matches(seq)
                },
            )
            .collect();
        let starts: Vec<u32> = per_seq
            .iter()
            .flat_map(|m| m.iter().map(|&(s, _, _)| s))
            .collect();
        starts
    };

    let seq_result = run_sequential();
    let par_result = run_parallel();
    assert_eq!(seq_result, par_result, "results mismatch");
    eprintln!("correctness: {} total matches", seq_result.len());

    bench("find_pattern_batch k=2", run_sequential, run_parallel);
}

#[test]
#[ignore = "expensive benchmark, run manually"]
fn grep() {
    let (data, offsets) = make_synthetic_batch();
    let num_sequences = offsets.len() - 1;
    let primer = b"ACGTACGTACGTACGTACGT";
    eprintln!(
        "batch: {num_sequences} sequences x {SEQ_LEN}bp = {} bytes",
        data.len()
    );

    for &max_edits in &[0u32, 2] {
        let run_sequential = || {
            let mode = grep::SearchMode::from_flags(false, false);
            let mut ctx = grep::SearchContext::new(primer, max_edits, &mode);
            let mut results = vec![0u8; num_sequences];
            for (i, window) in offsets.windows(2).enumerate() {
                let seq = &data[window[0] as usize..window[1] as usize];
                results[i] = u8::from(ctx.contains_match(seq));
            }
            results
        };

        let run_parallel = || {
            (0..num_sequences)
                .into_par_iter()
                .map_init(
                    || {
                        let mode = grep::SearchMode::from_flags(false, false);
                        grep::SearchContext::new(primer, max_edits, &mode)
                    },
                    |ctx, i| {
                        let seq = &data[offsets[i] as usize..offsets[i + 1] as usize];
                        u8::from(ctx.contains_match(seq))
                    },
                )
                .collect::<Vec<u8>>()
        };

        let seq_result = run_sequential();
        let par_result = run_parallel();
        assert_eq!(seq_result, par_result, "results mismatch at k={max_edits}");
        let matches: usize = seq_result.iter().map(|&b| b as usize).sum();
        eprintln!("correctness: {matches}/{num_sequences} matches at k={max_edits}");

        bench(
            &format!("grep_batch k={max_edits}"),
            run_sequential,
            run_parallel,
        );
    }
}

#[test]
#[ignore = "expensive benchmark, run manually"]
fn transform_complement() {
    let (data, offsets) = make_synthetic_batch();
    let num_sequences = offsets.len() - 1;
    eprintln!(
        "batch: {num_sequences} sequences x {SEQ_LEN}bp = {} bytes",
        data.len()
    );

    let run_sequential = || {
        let mut out = vec![0u8; data.len()];
        for window in offsets.windows(2) {
            let start = window[0] as usize;
            let end = window[1] as usize;
            transform::complement(&data[start..end], &mut out[start..end], false);
        }
        out
    };

    let run_parallel = || {
        let chunks: Vec<Vec<u8>> = (0..num_sequences)
            .into_par_iter()
            .map(|i| {
                let start = offsets[i] as usize;
                let end = offsets[i + 1] as usize;
                let seq = &data[start..end];
                let mut dest = vec![0u8; seq.len()];
                transform::complement(seq, &mut dest, false);
                dest
            })
            .collect();
        chunks.concat()
    };

    let seq_result = run_sequential();
    let par_result = run_parallel();
    assert_eq!(seq_result, par_result, "results mismatch");
    eprintln!("correctness: {} bytes transformed", seq_result.len());

    bench("transform_batch complement", run_sequential, run_parallel);
}

#[test]
#[ignore = "expensive benchmark, run manually"]
#[allow(clippy::cast_possible_truncation)]
fn classify() {
    let (data, offsets) = make_synthetic_batch();
    let num_sequences = offsets.len() - 1;
    eprintln!(
        "batch: {num_sequences} sequences x {SEQ_LEN}bp = {} bytes",
        data.len()
    );

    let run_sequential = || {
        let mut all_counts = Vec::with_capacity(num_sequences * classify::NUM_CLASSES);
        for window in offsets.windows(2) {
            let seq = &data[window[0] as usize..window[1] as usize];
            let mut counts = [0u32; classify::NUM_CLASSES];
            classify::classify(seq, &mut counts);
            all_counts.extend_from_slice(&counts);
        }
        all_counts
    };

    let run_parallel = || {
        let per_seq: Vec<[u32; classify::NUM_CLASSES]> = (0..num_sequences)
            .into_par_iter()
            .map(|i| {
                let seq = &data[offsets[i] as usize..offsets[i + 1] as usize];
                let mut counts = [0u32; classify::NUM_CLASSES];
                classify::classify(seq, &mut counts);
                counts
            })
            .collect();
        let mut all_counts = Vec::with_capacity(num_sequences * classify::NUM_CLASSES);
        for counts in &per_seq {
            all_counts.extend_from_slice(counts);
        }
        all_counts
    };

    let seq_result = run_sequential();
    let par_result = run_parallel();
    assert_eq!(seq_result, par_result, "results mismatch");
    eprintln!("correctness: {} count entries", seq_result.len());

    bench("classify_batch", run_sequential, run_parallel);
}

#[test]
#[ignore = "expensive benchmark, run manually"]
fn check_valid() {
    let (data, offsets) = make_synthetic_batch();
    let num_sequences = offsets.len() - 1;
    eprintln!(
        "batch: {num_sequences} sequences x {SEQ_LEN}bp = {} bytes",
        data.len()
    );

    let mode = classify::ValidMode::StrictDna;

    let run_sequential = || {
        let mut results = vec![0u8; num_sequences];
        for (i, window) in offsets.windows(2).enumerate() {
            let seq = &data[window[0] as usize..window[1] as usize];
            results[i] = u8::from(classify::check_valid(seq, mode));
        }
        results
    };

    let run_parallel = || {
        (0..num_sequences)
            .into_par_iter()
            .map(|i| {
                let seq = &data[offsets[i] as usize..offsets[i + 1] as usize];
                u8::from(classify::check_valid(seq, mode))
            })
            .collect::<Vec<u8>>()
    };

    let seq_result = run_sequential();
    let par_result = run_parallel();
    assert_eq!(seq_result, par_result, "results mismatch");
    let valid: usize = seq_result.iter().map(|&b| b as usize).sum();
    eprintln!("correctness: {valid}/{num_sequences} valid");

    bench("check_valid_batch StrictDna", run_sequential, run_parallel);
}

#[test]
#[ignore = "expensive benchmark, run manually"]
fn quality_bin() {
    let (data, offsets) = make_synthetic_batch();
    let num_sequences = offsets.len() - 1;
    // Reinterpret the sequence data as quality scores (they're all
    // valid ASCII bytes, which is all quality_bin cares about).
    let boundaries: &[u8] = &[b'#' + 10, b'#' + 20, b'#' + 30];
    let representatives: &[u8] = &[b'#' + 5, b'#' + 15, b'#' + 25, b'#' + 35];
    eprintln!(
        "batch: {num_sequences} sequences x {SEQ_LEN}bp = {} bytes",
        data.len()
    );

    let run_sequential = || {
        let mut out = vec![0u8; data.len()];
        for window in offsets.windows(2) {
            let start = window[0] as usize;
            let end = window[1] as usize;
            quality::quality_bin(
                &data[start..end],
                &mut out[start..end],
                boundaries,
                representatives,
            );
        }
        out
    };

    let run_parallel = || {
        let chunks: Vec<Vec<u8>> = (0..num_sequences)
            .into_par_iter()
            .map(|i| {
                let start = offsets[i] as usize;
                let end = offsets[i + 1] as usize;
                let mut dest = vec![0u8; end - start];
                quality::quality_bin(&data[start..end], &mut dest, boundaries, representatives);
                dest
            })
            .collect();
        chunks.concat()
    };

    let seq_result = run_sequential();
    let par_result = run_parallel();
    assert_eq!(seq_result, par_result, "results mismatch");
    eprintln!("correctness: {} bytes binned", seq_result.len());

    bench("quality_bin_batch", run_sequential, run_parallel);
}
