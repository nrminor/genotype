//! Nucleotide-to-protein translation.
//!
//! Translates DNA/RNA sequences into amino acid sequences using precomputed
//! lookup tables supplied by the caller. Genetic-code semantics (which codon
//! maps to which amino acid, which codons are starts) are driven by the lookup
//! buffers rather than hardcoded here, keeping the source of truth in the
//! TypeScript genetic-code definitions.

pub const CODON_LUT_LEN: usize = 16 * 16 * 16;
pub const EXACT_CODON_TABLE_LEN: usize = 64;

/// Options controlling translation behavior for a single batch.
#[derive(Clone)]
#[allow(clippy::struct_excessive_bools)]
pub struct TranslateOptions {
    pub frame_offset: u8,
    pub reverse: bool,
    pub convert_start_codons: bool,
    pub allow_alternative_starts: bool,
    pub trim_at_first_stop: bool,
    pub remove_stop_codons: bool,
    pub stop_codon_char: u8,
    pub unknown_codon_char: u8,
}

/// Translate a single nucleotide sequence into an amino acid sequence.
#[allow(clippy::too_many_arguments, clippy::fn_params_excessive_bools)]
pub fn translate_one(
    seq: &[u8],
    translation_lut: &[u8],
    start_mask: &[u8],
    alternative_start_mask: &[u8],
    options: &TranslateOptions,
) -> Vec<u8> {
    let normalized = if options.reverse {
        reverse_complement_normalized(seq)
    } else {
        normalize_to_dna_upper(seq)
    };

    let frame_offset = options.frame_offset as usize;

    if normalized.is_empty() || frame_offset >= normalized.len() {
        return Vec::new();
    }

    let mut out = Vec::with_capacity(normalized.len() / 3);
    let mut is_first_codon = true;
    let mut i = frame_offset;

    while i + 2 < normalized.len() {
        let codon = [normalized[i], normalized[i + 1], normalized[i + 2]];
        let codon_index = codon_lookup_index(codon);
        let exact_index = exact_codon_index(codon);
        let mut amino_acid = translation_lut[codon_index as usize];

        if options.convert_start_codons
            && is_first_codon
            && (exact_index.is_some_and(|idx| start_mask[idx] != 0)
                || (options.allow_alternative_starts
                    && exact_index.is_some_and(|idx| alternative_start_mask[idx] != 0)))
        {
            amino_acid = b'M';
        }
        is_first_codon = false;

        if amino_acid == b'*' {
            if options.trim_at_first_stop {
                break;
            }
            if options.remove_stop_codons {
                i += 3;
                continue;
            }
            amino_acid = options.stop_codon_char;
        } else if amino_acid == b'X' {
            amino_acid = options.unknown_codon_char;
        }

        out.push(amino_acid);
        i += 3;
    }

    out
}

fn normalize_to_dna_upper(seq: &[u8]) -> Vec<u8> {
    seq.iter()
        .map(|&b| match b & !0x20 {
            b'U' => b'T',
            upper => upper,
        })
        .collect()
}

fn reverse_complement_normalized(seq: &[u8]) -> Vec<u8> {
    seq.iter()
        .rev()
        .map(|&b| complement_iupac_dna(b & !0x20))
        .collect()
}

fn complement_iupac_dna(base: u8) -> u8 {
    match base {
        b'A' => b'T',
        b'C' => b'G',
        b'G' => b'C',
        b'T' | b'U' => b'A',
        b'R' => b'Y',
        b'Y' => b'R',
        b'S' => b'S',
        b'W' => b'W',
        b'K' => b'M',
        b'M' => b'K',
        b'B' => b'V',
        b'D' => b'H',
        b'H' => b'D',
        b'V' => b'B',
        b'N' => b'N',
        b'.' => b'.',
        b'-' => b'-',
        b'*' => b'*',
        other => other,
    }
}

fn base_mask(base: u8) -> u8 {
    match base {
        b'A' => 0b0001,
        b'C' => 0b0010,
        b'G' => 0b0100,
        b'T' | b'U' => 0b1000,
        b'R' => 0b0101,
        b'Y' => 0b1010,
        b'S' => 0b0110,
        b'W' => 0b1001,
        b'K' => 0b1100,
        b'M' => 0b0011,
        b'B' => 0b1110,
        b'D' => 0b1101,
        b'H' => 0b1011,
        b'V' => 0b0111,
        b'N' => 0b1111,
        _ => 0,
    }
}

fn codon_lookup_index(codon: [u8; 3]) -> u16 {
    let a = u16::from(base_mask(codon[0]));
    let b = u16::from(base_mask(codon[1]));
    let c = u16::from(base_mask(codon[2]));
    (a << 8) | (b << 4) | c
}

fn exact_codon_index(codon: [u8; 3]) -> Option<usize> {
    let a = exact_base_bits(codon[0]);
    let b = exact_base_bits(codon[1]);
    let c = exact_base_bits(codon[2]);
    match (a, b, c) {
        (Some(a), Some(b), Some(c)) => Some((a << 4) | (b << 2) | c),
        _ => None,
    }
}

fn exact_base_bits(base: u8) -> Option<usize> {
    match base {
        b'A' => Some(0),
        b'C' => Some(1),
        b'G' => Some(2),
        b'T' | b'U' => Some(3),
        _ => None,
    }
}
