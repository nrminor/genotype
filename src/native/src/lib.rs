//! Native performance layer for genotype bioinformatics library.
//!
//! This crate provides SIMD-accelerated genomic data processing functions
//! exposed to TypeScript via napi-rs. The #[napi] functions in this file
//! are thin wrappers around pure-Rust kernel modules (grep.rs, etc.) that
//! contain no napi dependencies and are independently testable.

use napi_derive::napi;

/// Trivial function to validate the napi-rs build pipeline end-to-end.
/// Returns the input unchanged. Will be replaced with real functionality
/// once the grep kernel is implemented.
#[napi]
pub fn echo(input: u32) -> u32 {
    input
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echo_returns_input() {
        assert_eq!(echo(42), 42);
        assert_eq!(echo(0), 0);
    }
}
