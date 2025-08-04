const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Build shared library for genomic data processing
    const genotype_lib = b.addSharedLibrary(.{
        .name = "genotype_native",
        .root_source_file = .{ .path = "src/main.zig" },
        .target = target,
        .optimize = optimize,
    });

    // Add C ABI export
    genotype_lib.addIncludePath(.{ .path = "include" });
    
    // Install the library
    b.installArtifact(genotype_lib);

    // Create a test step
    const test_step = b.step("test", "Run library tests");
    const unit_tests = b.addTest(.{
        .root_source_file = .{ .path = "src/main.zig" },
        .target = target,
        .optimize = optimize,
    });
    
    const run_unit_tests = b.addRunArtifact(unit_tests);
    test_step.dependOn(&run_unit_tests.step);

    // Clean step
    const clean_step = b.step("clean", "Clean build artifacts");
    const clean_run = b.addSystemCommand(&[_][]const u8{ "rm", "-rf", "zig-out", "zig-cache" });
    clean_step.dependOn(&clean_run.step);
}