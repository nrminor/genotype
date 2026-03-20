//! XXH3-128 sequence hashing.
//!
//! Hashes individual sequences using XXH3-128 with optional case folding.
//! The 128-bit output supports two use cases: the full value as a Map/Set
//! key for exact dedup, and the two 64-bit halves as seeds for double-hashing
//! bloom filter probes.

/// Hash a single sequence slice with XXH3-128, optionally folding case.
///
/// When `case_insensitive` is true, each byte is OR-ed with 0x20 before
/// hashing, folding ASCII uppercase into lowercase without a separate
/// normalization pass.
pub fn hash_one(seq: &[u8], case_insensitive: bool) -> u128 {
    if case_insensitive {
        // Fold ASCII letters to lowercase by OR-ing with 0x20.
        // This maps A-Z (0x41-0x5A) to a-z (0x61-0x7A). It also
        // maps some non-letter bytes to different values (e.g. '@' →
        // '`'), but for hashing purposes the only requirement is that
        // uppercase and lowercase ASCII letters produce the same hash,
        // which this achieves.
        //
        // We use a stack buffer for short sequences to avoid allocation,
        // falling back to a heap vec for longer ones.
        const STACK_LIMIT: usize = 4096;
        if seq.len() <= STACK_LIMIT {
            let mut buf = [0u8; STACK_LIMIT];
            let dest = &mut buf[..seq.len()];
            for (d, &s) in dest.iter_mut().zip(seq) {
                *d = s | 0x20;
            }
            xxhash_rust::xxh3::xxh3_128(dest)
        } else {
            let folded: Vec<u8> = seq.iter().map(|&b| b | 0x20).collect();
            xxhash_rust::xxh3::xxh3_128(&folded)
        }
    } else {
        xxhash_rust::xxh3::xxh3_128(seq)
    }
}
