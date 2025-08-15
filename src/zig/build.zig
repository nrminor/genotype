const std = @import("std");
const builtin = @import("builtin");

const LIB_NAME = "genotype";

const SupportedTarget = struct { cpu_arch: std.Target.Cpu.Arch, os_tag: std.Target.Os.Tag, description: []const u8 };

const SUPPORTED_TARGETS = [_]SupportedTarget{
    .{ .cpu_arch = .x86_64, .os_tag = .linux, .description = "Linux x86_64" },
    .{ .cpu_arch = .aarch64, .os_tag = .linux, .description = "Linux aarch64" },
    .{ .cpu_arch = .x86_64, .os_tag = .macos, .description = "macOS x86_64" },
    .{ .cpu_arch = .aarch64, .os_tag = .macos, .description = "macOS aarch64" },
    .{ .cpu_arch = .x86_64, .os_tag = .windows, .description = "Windows x86_64" },
    .{ .cpu_arch = .aarch64, .os_tag = .windows, .description = "Windows aarch64" },
};

pub fn build(b: *std.Build) !void {
    const target = b.standardTargetOptions(.{}); // keeps -Dtarget, -Dcpu, -Dos, ...
    const optimize = b.standardOptimizeOption(.{});

    // If true, build only the target specified via the standard -Dtarget flags
    const single = b.option(bool, "single", "Build only the selected -Dtarget instead of all") orelse false;

    if (single) {
        const desc = "CLI-selected target";
        try buildTargetFromQuery(b, target.query, desc, optimize);
    } else {
        buildAllTargets(b, optimize);
    }

    // tests (still honor the standard target/options)
    const test_step = b.step("test", "Run library tests");
    const unit_tests = b.addTest(.{
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
    });
    const run_unit_tests = b.addRunArtifact(unit_tests);
    test_step.dependOn(&run_unit_tests.step);

    const clean_step = b.step("clean", "Clean build artifacts");
    const clean_run = b.addSystemCommand(&[_][]const u8{ "rm", "-rf", "zig-out", "zig-cache" });
    clean_step.dependOn(&clean_run.step);
}

fn buildTargetFromQuery(
    b: *std.Build,
    q: std.Target.Query,
    desc: []const u8,
    optimize: std.builtin.OptimizeMode,
) !void {
    const target = b.resolveTargetQuery(q);

    // module root (your lib.zig entry)
    const module = b.addModule(LIB_NAME, .{
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = false, // match OpenTUI; flip if you need libc
    });

    // build a dynamic library
    const lib = b.addLibrary(.{
        .name = LIB_NAME,
        .root_module = module,
        .linkage = .dynamic,
    });

    // install to ../lib/<arch-os> (relative to this build.zig dir)
    const target_name = try createTargetName(b.allocator, target.result);
    defer b.allocator.free(target_name);

    const install = b.addInstallArtifact(lib, .{
        .dest_dir = .{ .override = .{
            .custom = try std.fmt.allocPrint(b.allocator, "../lib/{s}", .{target_name}),
        } },
    });

    // optional: nice named `zig build build-<arch-os>` step
    const step_name = try std.fmt.allocPrint(b.allocator, "build-{s}", .{target_name});
    const step = b.step(step_name, try std.fmt.allocPrint(b.allocator, "Build for {s}", .{desc}));
    step.dependOn(&install.step);

    // keep default `zig build install` meaningful
    b.getInstallStep().dependOn(&install.step);
}

fn buildAllTargets(b: *std.Build, optimize: std.builtin.OptimizeMode) void {
    for (SUPPORTED_TARGETS) |t| {
        const q = std.Target.Query{ .cpu_arch = t.cpu_arch, .os_tag = t.os_tag };
        buildTargetFromQuery(b, q, t.description, optimize) catch |err| {
            std.debug.print("Failed to build {s}: {}\n", .{ t.description, err });
        };
    }
}

fn buildSingleTarget(b: *std.Build, target_str: []const u8, optimize: std.builtin.OptimizeMode) !void {
    const q = try std.Target.Query.parse(.{ .arch_os_abi = target_str });
    const desc = try std.fmt.allocPrint(b.allocator, "Custom target: {s}", .{target_str});
    try buildTargetFromQuery(b, q, desc, optimize);
}

fn createTargetName(allocator: std.mem.Allocator, target: std.Target) ![]u8 {
    return std.fmt.allocPrint(allocator, "{s}-{s}", .{ @tagName(target.cpu.arch), @tagName(target.os.tag) });
}
