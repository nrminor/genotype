const std = @import("std");
const testing = std.testing;

// Performance-critical genomic data processing functions
// These will be called from TypeScript via FFI

/// Fast BGZF block decompression using Zig's optimized inflate
export fn decompress_bgzf_block(
    compressed_data: [*]const u8,
    compressed_size: usize,
    output_buffer: [*]u8,
    output_size: usize,
) callconv(.C) i32 {
    // Implementation placeholder for BGZF decompression
    // This would replace the JavaScript BGZF decompression for speed
    _ = compressed_data;
    _ = compressed_size;
    _ = output_buffer;
    _ = output_size;
    
    // Return -1 for not implemented yet
    return -1;
}

/// High-performance 4-bit nucleotide sequence decoding
export fn decode_packed_sequence(
    packed_data: [*]const u8,
    sequence_length: usize,
    output_buffer: [*]u8,
) callconv(.C) i32 {
    const seq_decoder = "=ACMGRSVTWYHKDBN";
    
    // Tiger Style: Assert function arguments
    if (sequence_length == 0) return 0;
    
    var i: usize = 0;
    while (i < sequence_length) : (i += 1) {
        const byte_idx = i / 2;
        const byte = packed_data[byte_idx];
        const base = if (i % 2 == 0) (byte >> 4) & 0xF else byte & 0xF;
        
        // Bounds check for safety
        if (base >= seq_decoder.len) return -1;
        
        output_buffer[i] = seq_decoder[base];
    }
    
    return @intCast(sequence_length);
}

/// Fast quality score conversion (Phred+33 to numeric)
export fn convert_quality_scores(
    quality_string: [*]const u8,
    length: usize,
    output_scores: [*]f32,
) callconv(.C) i32 {
    // Tiger Style: Assert function arguments
    if (length == 0) return 0;
    
    var i: usize = 0;
    while (i < length) : (i += 1) {
        const ascii_val = quality_string[i];
        
        // Validate ASCII range for Phred+33
        if (ascii_val < 33 or ascii_val > 126) return -1;
        
        output_scores[i] = @floatFromInt(ascii_val - 33);
    }
    
    return @intCast(length);
}

/// Optimized GC content calculation for large sequences
export fn calculate_gc_content(
    sequence: [*]const u8,
    length: usize,
) callconv(.C) f64 {
    if (length == 0) return 0.0;
    
    var gc_count: usize = 0;
    var valid_bases: usize = 0;
    
    var i: usize = 0;
    while (i < length) : (i += 1) {
        const base = sequence[i];
        switch (base) {
            'G', 'C', 'g', 'c' => {
                gc_count += 1;
                valid_bases += 1;
            },
            'A', 'T', 'a', 't' => {
                valid_bases += 1;
            },
            else => {
                // Skip ambiguous bases and gaps
            },
        }
    }
    
    if (valid_bases == 0) return 0.0;
    
    return @as(f64, @floatFromInt(gc_count)) / @as(f64, @floatFromInt(valid_bases));
}

// Tests for our native functions
test "decode_packed_sequence basic functionality" {
    const input = [_]u8{ 0x12, 0x48 }; // ACGT in 4-bit encoding
    var output: [4]u8 = undefined;
    
    const result = decode_packed_sequence(&input, 4, &output);
    
    try testing.expect(result == 4);
    try testing.expectEqualStrings("ACGT", output[0..4]);
}

test "calculate_gc_content accuracy" {
    const sequence = "ATCGATCG";
    const result = calculate_gc_content(sequence.ptr, sequence.len);
    
    try testing.expectApproxEqRel(@as(f64, 0.5), result, 0.001);
}

test "convert_quality_scores basic functionality" {
    const quality = "!\"#$%"; // Phred+33: 0,1,2,3,4
    var scores: [5]f32 = undefined;
    
    const result = convert_quality_scores(quality.ptr, quality.len, &scores);
    
    try testing.expect(result == 5);
    try testing.expectApproxEqRel(@as(f32, 0.0), scores[0], 0.001);
    try testing.expectApproxEqRel(@as(f32, 1.0), scores[1], 0.001);
    try testing.expectApproxEqRel(@as(f32, 4.0), scores[4], 0.001);
}