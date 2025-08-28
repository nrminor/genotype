//! Native performance layer for genotype bioinformatics library
//!
//! This library provides high-performance genomic data processing functions
//! that are called from TypeScript via FFI. Following Tiger Style principles:
//! - Functions under 70 lines
//! - Explicit error handling
//! - Assertions at boundaries
//! - Clear over concise

/// Optimized GC content calculation for large sequences
///
/// Calculates the ratio of G and C bases to total valid bases in a DNA sequence.
/// Handles both uppercase and lowercase nucleotides, skipping ambiguous bases.
///
/// # Safety
///
/// Caller must ensure `sequence` points to at least `length` valid bytes.
///
/// # Returns
///
/// GC content as a ratio between 0.0 and 1.0, or 0.0 for empty/invalid sequences.
#[no_mangle]
pub unsafe extern "C" fn calculate_gc_content(sequence: *const u8, length: usize) -> f64 {
    // Tiger Style: Assert function arguments
    if length == 0 {
        return 0.0;
    }

    let mut gc_count = 0usize;
    let mut valid_bases = 0usize;

    // Safety: caller guarantees `sequence` points to at least `length` valid bytes
    let sequence_slice = std::slice::from_raw_parts(sequence, length);

    // Tiger Style: Keep loop simple and readable
    for &base in sequence_slice {
        match base {
            b'G' | b'C' | b'g' | b'c' => {
                gc_count += 1;
                valid_bases += 1;
            }
            b'A' | b'T' | b'a' | b't' => {
                valid_bases += 1;
            }
            _ => {
                // Skip ambiguous bases and gaps
            }
        }
    }

    // Tiger Style: Explicit boundary condition handling
    if valid_bases == 0 {
        return 0.0;
    }

    // Convert to f64 for precise calculation
    gc_count as f64 / valid_bases as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_gc_content_basic() {
        let sequence = b"ATCGATCG";
        let result = unsafe { calculate_gc_content(sequence.as_ptr(), sequence.len()) };
        assert!(
            (result - 0.5).abs() < 0.001,
            "Expected ~0.5, got {}",
            result
        );
    }

    #[test]
    fn test_calculate_gc_content_empty_sequence() {
        let sequence = b"";
        let result = unsafe { calculate_gc_content(sequence.as_ptr(), sequence.len()) };
        assert_eq!(result, 0.0, "Empty sequence should return 0.0");
    }

    #[test]
    fn test_calculate_gc_content_all_gc() {
        let sequence = b"GCGCGC";
        let result = unsafe { calculate_gc_content(sequence.as_ptr(), sequence.len()) };
        assert!(
            (result - 1.0).abs() < 0.001,
            "All GC sequence should return ~1.0, got {}",
            result
        );
    }

    #[test]
    fn test_calculate_gc_content_all_at() {
        let sequence = b"ATATAT";
        let result = unsafe { calculate_gc_content(sequence.as_ptr(), sequence.len()) };
        assert!(
            (result - 0.0).abs() < 0.001,
            "All AT sequence should return ~0.0, got {}",
            result
        );
    }

    #[test]
    fn test_calculate_gc_content_case_insensitive() {
        let sequence = b"atcgatcg";
        let result = unsafe { calculate_gc_content(sequence.as_ptr(), sequence.len()) };
        assert!(
            (result - 0.5).abs() < 0.001,
            "Lowercase sequence should work, got {}",
            result
        );
    }

    #[test]
    fn test_calculate_gc_content_mixed_case() {
        let sequence = b"AtCgAtCg";
        let result = unsafe { calculate_gc_content(sequence.as_ptr(), sequence.len()) };
        assert!(
            (result - 0.5).abs() < 0.001,
            "Mixed case sequence should work, got {}",
            result
        );
    }

    #[test]
    fn test_calculate_gc_content_with_ambiguous_bases() {
        // Include N (ambiguous) - should be skipped
        let sequence = b"ATCGNNATCG";
        let result = unsafe { calculate_gc_content(sequence.as_ptr(), sequence.len()) };
        // 4 GC out of 8 valid bases = 0.5
        assert!(
            (result - 0.5).abs() < 0.001,
            "Ambiguous bases should be skipped, got {}",
            result
        );
    }

    #[test]
    fn test_calculate_gc_content_only_ambiguous_bases() {
        let sequence = b"NNNXXX";
        let result = unsafe { calculate_gc_content(sequence.as_ptr(), sequence.len()) };
        assert_eq!(result, 0.0, "Only ambiguous bases should return 0.0");
    }
}
