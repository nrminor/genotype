const std = @import("std");

// ---------- Setting up table of valid bases ----------
fn build_valid_table() [256]bool {
    var t: [256]bool = .{false} ** 256;
    for ("ACGTacgt") |c| t[c] = true;
    return t;
}
const VALID = build_valid_table();

// ---------- SIMD setup based on the current machine ----------
fn simdLanes() comptime_int {
    const target = std.Target.current;
    switch (target.cpu.arch) {
        .x86, .x86_64 => {
            if (target.cpu.features.isEnabled(std.Target.x86.Feature.avx2)) return 32;
            if (target.cpu.features.isEnabled(std.Target.x86.Feature.sse2)) return 16;
            return 8;
        },
        .aarch64 => return 16,
        else => return 8,
    }
}

pub const VEC_BITS = simdLanes();
pub const LANES = if (VEC_BITS == 0) 1 else VEC_BITS / @bitSizeOf(u8);
pub const VecU8 = @Vector(LANES, u8);
pub const VecBool = @Vector(LANES, bool);

/// Scalar implementation of in-place base-cleaning, which simply loops over the bases
/// in the provided array of pointers and replaces them with the given replacement if
/// they are invalid.
fn clean_in_place_scalar(ptr: ?[*]u8, len: usize, replace_byte: u8) usize {
    // no null pointers!
    if (ptr == null) return 0;

    // find and count any necessary replacements
    var i = 0;
    var replaced = 0;
    while (i < len) : (i += 1) {
        const base = ptr[i];
        if (!VALID[base]) {
            ptr[i] = replace_byte;
            replaced += 1;
        }
    }

    return replaced;
}

/// SIMD-parallelized implementation of in-place base-cleaning, which simultaneously
/// replaces all invalid bases within each SIMD vector-length at a time. Replacement is
/// O(N) worst case, but this divides actual N by L, where L is the number of lanes in
/// the current architecture's SIMD vector length
fn clean_in_place_simd(ptr: ?[*]u8, len: usize, replace_byte: u8) usize {
    if (ptr == null) return 0;

    // Treat pointer as unaligned and cast into a SIMD vector pointer
    const PVec = [*]align(1) VecU8;
    const vptr: PVec = @ptrCast(ptr.?);

    // How many full SIMD blocks?
    const blocks = len / LANES;

    // make a bunch of vectors to use in our SIMD operations, including a vector of the
    // replacement byte, a vector serving as a mask to make everything uppercase, a vector
    // for each base, etc.
    const repl: VecU8 = @splat(replace_byte);
    const upper_mask: VecU8 = @splat(~@as(u8, 0x20));
    const A: VecU8 = @splat(@as(u8, 'A'));
    const C: VecU8 = @splat(@as(u8, 'C'));
    const G: VecU8 = @splat(@as(u8, 'G'));
    const T: VecU8 = @splat(@as(u8, 'T'));
    const zero_u8: VecU8 = @splat(@as(u8, 0));
    const ff_u8: VecU8 = @splat(@as(u8, 0xFF));

    // init counters for the loop
    var replaced_total: usize = 0;
    var i: usize = 0;

    // go through each vector-subset of the bases
    while (i < blocks) : (i += 1) {
        // get the current block from the pointer array
        const v: VecU8 = vptr[i];

        // Case-fold to uppercase (ASCII): clear bit 0x20
        const u: VecU8 = v & upper_mask;

        // construct a validity mask: (u == 'A' || 'C' || 'G' || 'T')
        const eqA: VecBool = u == A;
        const eqC: VecBool = u == C;
        const eqG: VecBool = u == G;
        const eqT: VecBool = u == T;
        const validity_mask: VecBool = (eqA or eqC) or (eqG or eqT);

        // Blend: out = valid ? v : repl
        const out: VecU8 = @select(u8, validity_mask, v, repl);
        vptr[i] = out;

        // Count replacements: invalid → 0xFF, valid → 0x00
        const inv_mask_u8: VecU8 = @select(u8, validity_mask, zero_u8, ff_u8);

        // Sum bytes as u16s to avoid overflow; 0xFF per invalid lane.
        const inv_mask_u16: @Vector(LANES, u16) = @intCast(inv_mask_u8);
        const sum: u16 = @reduce(.Add, inv_mask_u16);
        replaced_total += @intCast(sum / 255);
    }

    return replaced_total;
}

pub export fn clean_in_place(ptr: ?[*]u8, len: usize, replace_byte: u8) usize {
    if (ptr == null or len == 0) return 0;
    const p = ptr.?;
    var replaced: usize = 0;

    if (LANES > 1) {
        const block_bytes = (len / LANES) * LANES;
        replaced += clean_in_place_simd(p, block_bytes, replace_byte);
        if (block_bytes < len) {
            replaced += clean_in_place_scalar(p + block_bytes, len - block_bytes, replace_byte);
        }
    } else {
        replaced = clean_in_place_scalar(p, len, replace_byte);
    }
    return replaced;
}
