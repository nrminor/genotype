# Genotype Development Commands
# High-performance TypeScript library for genomic data formats
# MANDATORY: All code must pass validation with ZERO warnings before commits

# Default recipe shows available commands
[group('help')]
default:
    @just --list --unsorted

# Show all available recipes with descriptions
[group('help')]
help:
    @just --list

# ===== CRITICAL: Validation (MUST PASS) =====

# 🚨 MANDATORY before ANY commit - Run full validation
[group('validation')]
validate:
    bun run validate

alias v := validate

# 🚨 Full validation including Rust native code
[group('validation')]
validate-full:
    bun run validate:full

alias vf := validate-full

# Quick validation status check
[group('validation')]
status:
    @echo "Checking validation status..."
    @bun run lint 2>&1 | grep -E "(error|warning)" || echo "✓ No TypeScript or ESLint issues"
    @echo ""
    @echo "Run 'just validate' for full check"

alias s := status

# ===== Build Commands =====

# Build TypeScript to JavaScript
[group('build')]
build:
    bun run build

alias b := build

# Build with Rust native optimizations
[group('build')]
build-native:
    bun run build:with-native

alias bn := build-native

# Build Rust native library (debug mode)
[group('build')]
build-rust-dev:
    cargo build

alias brd := build-rust-dev

# Build Rust native library (release mode)
[group('build')]
build-rust:
    cargo build --release

alias br := build-rust

# Watch mode for development
[group('build')]
watch:
    bun run dev

alias w := watch

# Clean all build artifacts
[group('build')]
clean:
    bun run clean

alias c := clean

# Clean Rust build artifacts
[group('build')]
clean-rust:
    cargo clean

alias cr := clean-rust

# ===== Testing =====

# Run all tests
[group('test')]
test:
    bun test

alias t := test

# Run specific test file
[group('test')]
test-file file:
    bun test {{ file }}

alias tf := test-file

# Run tests in watch mode
[group('test')]
test-watch:
    bun test --watch

alias tw := test-watch

# Run tests with coverage
[group('test')]
test-coverage:
    bun test --coverage

alias tc := test-coverage

# Run Rust tests
[group('test')]
test-rust:
    cargo test

alias tr := test-rust

# Test in Node.js environment
[group('test')]
test-node:
    bun run test:node

alias tn := test-node

# Test in Deno environment
[group('test')]
test-deno:
    bun run test:deno

alias td := test-deno

# Run all tests across all environments
[group('test')]
test-all: test test-rust test-node test-deno
    @echo "✓ All tests passed across all environments!"

alias ta := test-all

# ===== Code Quality =====

# Run TypeScript type checking and ESLint
[group('lint')]
lint:
    bun run lint

alias l := lint

# Fix auto-fixable lint issues
[group('lint')]
lint-fix:
    bun run lint:fix

alias lf := lint-fix

# Format code with Prettier
[group('lint')]
fmt:
    bun run format

alias f := fmt

# Run Rust linting
[group('lint')]
lint-rust:
    cargo clippy -- -D warnings

alias lr := lint-rust

# Format Rust code
[group('lint')]
fmt-rust:
    cargo fmt

alias fr := fmt-rust

# Check formatting without changes
[group('lint')]
fmt-check:
    bun run format:check

alias fc := fmt-check

# Type coverage report
[group('lint')]
type-coverage:
    bunx type-coverage --at-least 99

alias tyc := type-coverage

# Check for any type usage
[group('lint')]
check-any:
    @echo "Checking for 'any' type usage..."
    @grep -r "any" src/ --include="*.ts" --exclude-dir=node_modules || echo "✓ No 'any' types found"

alias ca := check-any

# ===== Development Tools =====

# Start interactive REPL with library loaded
[group('dev')]
repl:
    @echo "Starting Bun REPL with genotype loaded..."
    @echo "const { FastaParser, FastqParser, BedParser } = await import('./dist/index.js');" > .repl-init.js
    bun repl -e "$(cat .repl-init.js)"
    @rm .repl-init.js

alias r := repl

# Run example/demo scripts
[group('dev')]
demo:
    bun run examples/seqops-demo.ts

alias d := demo

# Generate TypeScript documentation
[group('dev')]
docs:
    bunx typedoc src/index.ts --out docs

alias doc := docs

# Check for outdated dependencies
[group('dev')]
outdated:
    bunx npm-check-updates

alias o := outdated

# Update dependencies (interactive)
[group('dev')]
update:
    bunx npm-check-updates -i

alias u := update

# Bundle size analysis
[group('dev')]
size:
    @echo "Analyzing bundle size..."
    @du -sh dist/* 2>/dev/null || echo "Run 'just build' first"
    @echo ""
    @echo "Source size:"
    @find src -name "*.ts" -not -path "*/native/*" | xargs wc -l | tail -1

# ===== Performance & Benchmarks =====

# Run performance benchmarks
[group('perf')]
bench:
    bun test bench

alias bch := bench

# Profile memory usage
[group('perf')]
profile-memory script:
    bun --inspect run {{ script }}

alias pm := profile-memory

# Create test genomic data files
[group('perf')]
create-test-data:
    @echo "Creating test genomic data files..."
    @mkdir -p test-data
    @echo ">seq1\nATCGATCGATCG\n>seq2\nGGGGAAAATTTT" > test-data/small.fasta
    @echo "@read1\nATCG\n+\nIIII\n@read2\nGGGG\n+\nIIII" > test-data/small.fastq
    @echo "chr1\t100\t200\tfeature1\t1000\t+" > test-data/small.bed
    @echo "✓ Test data created in test-data/"

alias ctd := create-test-data

# ===== Project-Specific Commands =====

# Parse a FASTA file (example usage)
[group('genomics')]
parse-fasta file:
    @echo "import { FastaParser } from './dist/index.js';" > .tmp-parse.js
    @echo "const parser = new FastaParser();" >> .tmp-parse.js
    @echo "for await (const seq of parser.parseFile('{{ file }}')) {" >> .tmp-parse.js
    @echo "  console.log(\`\${seq.id}: \${seq.length} bp\`);" >> .tmp-parse.js
    @echo "}" >> .tmp-parse.js
    @bun run .tmp-parse.js
    @rm .tmp-parse.js

# Count sequences in a file
[group('genomics')]
count-sequences file:
    @echo "Counting sequences in {{ file }}..."
    @grep -c "^>" {{ file }} 2>/dev/null || echo "0 sequences (or not a FASTA file)"

# Validate IUPAC codes in sequence file
[group('genomics')]
check-iupac file:
    @echo "Checking for non-IUPAC characters in {{ file }}..."
    @grep -v "^>" {{ file }} | grep -o "[^ACGTURYSWKMBDHVNacgturyswkmbdhvn.\-*]" | sort -u || echo "✓ All characters are valid IUPAC codes"

# ===== Code Inspection =====

# Show TODO and FIXME comments
[group('inspect')]
todos:
    @echo "TODO items:"
    @grep -r "TODO" src/ --include="*.ts" || echo "No TODOs found"
    @echo ""
    @echo "FIXME items:"
    @grep -r "FIXME" src/ --include="*.ts" || echo "No FIXMEs found"

alias todo := todos

# Count lines of code by module
[group('inspect')]
loc:
    @echo "Lines of code by module:"
    @echo "========================"
    @echo "Formats:"
    @wc -l src/formats/*.ts | sort -rn
    @echo ""
    @echo "Operations:"
    @wc -l src/operations/**/*.ts | sort -rn
    @echo ""
    @echo "Core:"
    @wc -l src/*.ts | sort -rn

# Check for console.log statements (should use proper logging)
[group('inspect')]
check-console:
    @echo "Checking for console.log statements..."
    @grep -r "console.log" src/ --include="*.ts" || echo "✓ No console.log found"

alias cc := check-console

# ===== Git Workflows =====

# Pre-commit validation (git hook helper)
[group('git')]
pre-commit: fmt-check lint test
    @echo "✓ Pre-commit checks passed!"

alias pc := pre-commit

# Prepare for PR (full validation)
[group('git')]
pr-ready: validate-full docs
    @echo "✓ Ready for PR!"
    @echo "Remember to:"
    @echo "  - Update CHANGELOG.md if needed"
    @echo "  - Ensure PR description is complete"  
    @echo "  - Link related issues"

alias pr := pr-ready

# ===== Anti-Entropy Checks =====

# Check for code complexity issues
[group('entropy')]
complexity:
    @echo "Checking function complexity..."
    @echo "Functions over 70 lines (Tiger Style violation):"
    @for file in src/**/*.ts; do \
        awk '/^(export )?[async ]*(function|class)/ {name=$$0; start=NR} \
             /^}/ {if (NR-start > 70) print FILENAME":"start" "name" ("NR-start" lines)"}' $$file; \
    done || echo "✓ All functions under 70 lines"

alias cx := complexity

# Check for deeply nested code
[group('entropy')]
nesting:
    @echo "Checking for deep nesting (>3 levels)..."
    @grep -n "        " src/**/*.ts | head -20 || echo "✓ No excessive nesting found"

alias nest := nesting

# Find potential dead code
[group('entropy')]
dead-code:
    @echo "Checking for potentially unused exports..."
    @echo "(This is a heuristic check - verify manually)"
    @for file in src/**/*.ts; do \
        grep "^export" $$file | while read -r line; do \
            name=$$(echo $$line | sed -E 's/export .* ([a-zA-Z0-9_]+).*/\1/'); \
            count=$$(grep -r "$$name" src/ --include="*.ts" | grep -v "^$$file:" | wc -l); \
            if [ $$count -eq 0 ]; then echo "$$file: $$name might be unused"; fi; \
        done; \
    done || echo "✓ No obviously dead code found"

alias dc := dead-code

# ===== Release Preparation =====

# Verify ready for release
[group('release')]
release-check: validate-full test-all lint-rust fmt-rust docs
    @echo "✓ All checks passed!"
    @echo "✓ Documentation generated!"
    @echo ""
    @echo "Ready for release. Remember to:"
    @echo "  1. Update version in package.json"
    @echo "  2. Update CHANGELOG.md"
    @echo "  3. Run 'bun run prepublishOnly'"
    @echo "  4. Create git tag: git tag v0.0.0"
    @echo "  5. Push tag: git push origin v0.0.0"

alias rc := release-check

# Publish to npm (dry run)
[group('release')]
publish-dry:
    npm publish --dry-run

alias pd := publish-dry

# ===== Quick Commands (Most Used) =====

# Quick validate (most common command)
[group('quick')]
q: validate

# Quick test
[group('quick')]
qt: test

# Quick format and lint
[group('quick')]
ql: fmt lint

# Quick check (format check + lint + test)
[group('quick')]
qc: fmt-check lint test

# ===== DANGER ZONE =====

# Install a new dependency (requires justification)
[group('danger')]
add-dep package:
    @echo "⚠️  WARNING: Zero-dependency philosophy!"
    @echo "You must document justification in AGENTS.md"
    @echo ""
    @read -p "Justification (or Ctrl+C to cancel): " reason; \
    echo "Installing {{ package }} with reason: $$reason"; \
    bun add {{ package }}

# Add dev dependency (less strict but still careful)
[group('danger')]
add-dev package:
    bun add -D {{ package }}

# Skip validation (NEVER use in production)
[group('danger')]
yolo:
    @echo "⚠️  SKIPPING VALIDATION - This is WRONG!"
    @echo "Fix your code instead!"
    @sleep 2
    bun run build

# ===== Shortcuts & Aliases =====
# Most important: validate always!

alias val := validate
alias valid := validate

# Common workflows

alias dev := watch
alias cov := test-coverage
alias fix := lint-fix
