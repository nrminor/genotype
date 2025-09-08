# Genotype Library - API Documentation & Development Guidelines

## OVERALL ATTITUDE REQUIREMENT: PRACTICE SELF-DOUBT IN ALL ACTIVITIES

- Be extraordinarily skeptical of your own correctness or stated assumptions.
  You aren't a cynic, you are a highly critical thinker and this is tempered by
  your self-doubt: you absolutely hate being wrong but you live in constant fear
  of it
- When appropriate, broaden the scope of inquiry beyond the stated assumptions
  to think through unconvenitional opportunities, risks, and pattern-matching to
  widen the aperture of solutions
- Before calling anything "done" or "working", take a second look at it ("red
  team" it) to critically analyze that you really are done or it really is
  working

## MANDATORY REVIEW REQUIREMENTS

**⚠️ STOP: Before ANY work on this codebase, you MUST:**

1. Read and understand ALL sections of this document
2. Review Tiger Style compliance requirements
3. Review ALL best practices sections (TypeScript, Bun, Rust, ArkType)
4. Understand the Anti-Code-Entropy policies
5. Review the security considerations
6. **Use Bun for ALL development tasks** - No npm, yarn, or pnpm allowed unless
   it's for compatibility testing
7. **Follow Zero-Dependency Philosophy** - No new npm packages without
   exhaustive justification
8. **MANDATORY: Run validation workflows** - All features MUST pass
   `bun run validate` or `bun run validate:full` before being declared complete
9. **MANDATORY AFTER COMPACTION: Re-read CLAUDE.md and AGENTS.md** - After ANY
   context compaction or conversation continuation, you MUST re-read these
   documents BEFORE proceeding with ANY work

**NO EXCEPTIONS. Any code that doesn't follow these guidelines OR fails
validation will be rejected.**

### ⚠️ CRITICAL: POST-COMPACTION REQUIREMENTS

**Context compaction is lossy and leads to critical oversights.**

After ANY compaction event:

1. **STOP all work immediately**
2. **Re-read CLAUDE.md (if available) in full**
3. **Re-read AGENTS.md in full**
4. **Review any work in progress against these requirements**
5. **ONLY proceed after confirming compliance**

**It is UNACCEPTABLE to proceed without project rules and guidelines in
context.**

## **Collaborative Excellence Protocol**

### **CORE PRINCIPLE: THINK SMALLER, CHECK MORE**

**When forming any goal**: Make it more granular, less ambitious, more
detail-oriented, and more collaborative. The sooner agents check in to ensure
they're on the right track, the better.

### **MICRO-STEP PRECISION**

- **Break everything into 10-20 line components** with independent validation
- **Test after each tiny change** - never accumulate large modifications
- **Document specific achievement** of each micro-component
- **Ask before proceeding** when encountering complexity or architectural
  decisions

### **CONSTANT PROGRESS COMMUNICATION**

```bash
echo "=== Starting [specific micro-task] ===" >> reports/$(date +%Y%m%d)/[PROJECT]/PROGRESS_LOG.md
echo "Found: [specific discovery]" >> reports/$(date +%Y%m%d)/[PROJECT]/PROGRESS_LOG.md  
echo "✅ [specific achievement completed]" >> reports/$(date +%Y%m%d)/[PROJECT]/PROGRESS_LOG.md
```

- **Log every 10-20 lines of work** with what was actually accomplished
- **Document domain reasoning** for sophisticated features in
  reports/DATE/PROJECT/ markdown files
- **Preserve working functionality** while making incremental improvements

### **EXTRAORDINARY SKEPTICISM**

- **Question every assumption** about what "appears to work" or "looks complete"
- **Systematically verify requirements** against actual implementation, not
  appearances
- **Measure actual problems** before suggesting fixes or simplifications
- **Never assume sophistication = completion** without evidence-based checking

### **DOMAIN EXPERTISE PRESERVATION**

- **Complex implementations often represent months of domain research**
- **Enhance through type system improvements** rather than simplifying away
  domain knowledge
- **Trust that domain complexity usually serves accuracy** unless proven
  otherwise
- **Ask before modifying working sophisticated functionality**

### **VALIDATION PROTOCOL**

```bash
# After each 10-20 line micro-step:
bun test [relevant-tests]  # Component works
bun run validate          # Full pipeline works
echo "✅ [achievement] preserved domain expertise" >> reports/$(date +%Y%m%d)/[PROJECT]/LOG.md
```

### **SUCCESS RECOGNITION**

- **Enhanced domain expertise + TypeScript excellence + functionality
  preservation**
- **Frequent collaborative check-ins** that prevent problems before they occur
- **Evidence-based progress** with measurable improvements at each step

This approach has proven **unreasonably effective** because it prevents
accumulation of complex changes, preserves valuable domain knowledge, and
enables precise rollback when needed.

---

## Project Overview

Genotype is a high-performance TypeScript library for working with genomic data
formats. It provides streaming parsers and writers for FASTA, FASTQ, SAM, BAM,
and BED formats with comprehensive validation using Arktype.

**Built by bioinformaticians, for bioinformaticians** - with all the messiness
of real-world data in mind.

### Developer Experience Philosophy

This library has a **relentless obsession with developer experience**:

- **Using the API** - Intuitive, type-safe interfaces that make common tasks
  trivial and complex tasks possible
- **Extending the API** - Simple patterns for adding new file formats, sequence
  types, and data sources
- **Real-world ready** - Handles malformed files, edge cases, and the chaos of
  actual genomic datasets
- **Fail-fast validation** - Clear error messages that help you fix problems
  quickly
- **Zero-surprise behavior** - Predictable APIs that do what you expect
- **Comprehensive documentation** - Every function, every parameter, every edge
  case documented

## Core Principles

### Tiger Style Compliance

This library follows
[Tiger Style](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md)
guidelines:

- **Correctness over performance** - but performance is still critical
- **Simplicity over cleverness** - clear, readable code
- Zero allocation streaming where possible
- Explicit error handling
- Type safety throughout
- **Minimal dependencies** - Bun's rich standard library eliminates most npm
  packages

### Grug Brained Developer Philosophy

This library also embraces the wisdom of the
[Grug Brained Developer](https://grugbrain.dev/):

**Core Principles:**

- **Complexity is the enemy** - complexity very, very bad
- **Simplicity wins** - prefer simple, understandable solutions over clever
  abstractions
- **Say no to complexity** - be willing to reject features that add unnecessary
  complexity
- **Pragmatism over perfection** - working code today beats perfect code never

**Development Approach:**

- **Prototype to understand** - build early prototypes to grasp the problem
  domain
- **Avoid premature abstractions** - don't over-engineer before understanding
  the system
- **Small, focused refactors** - improve code incrementally, not in massive
  rewrites
- **Code near its data** - keep parsing logic close to format definitions

**Testing Philosophy:**

- **Integration tests are king** - test real genomic file parsing, not just
  units
- **Test alongside development** - write tests as you code, not just before
- **Regression tests for bugs** - when fixing parser bugs, add tests immediately
- **Minimal end-to-end suite** - a few comprehensive tests over many brittle
  ones

**Code Clarity:**

- **Readability trumps brevity** - clear code over clever one-liners
- **Name your conditionals** - extract complex boolean logic into named
  variables
- **Embrace "dumb" questions** - ask when confused, complexity is not a badge of
  honor
- **Respect existing code** - understand why it exists before changing
  (Chesterton's Fence)

**Practical Wisdom for Genomics:**

- **Domain complexity is enough** - genomic formats are complex; keep the code
  simple
- **Tools matter** - invest in understanding Bun, TypeScript, and your debugger
- **Log everything** - especially in streaming parsers where debugging is hard
- **Balance DRY with clarity** - some duplication is better than confusing
  abstractions

### Zero-Dependency Philosophy

**Dependencies are liabilities.** With Bun's comprehensive standard library and
built-in tooling, we enforce an strict low-dependency policy for TypeScript
code.

#### Bun Eliminates Common Dependencies

**DO NOT install npm packages for functionality that Bun provides natively:**

| Common npm package          | Bun native replacement       |
| --------------------------- | ---------------------------- |
| `dotenv`                    | Built-in `.env` file support |
| `node-fetch`, `axios`       | Native `fetch()` API         |
| `ws`                        | Native WebSocket support     |
| `sqlite3`, `better-sqlite3` | `bun:sqlite`                 |
| `bcrypt`                    | `Bun.password`               |
| `uuid`                      | `crypto.randomUUID()`        |
| `chalk`, `colors`           | Native console styling       |
| `nodemon`                   | `bun --watch`                |
| `ts-node`                   | Native TypeScript execution  |
| `esbuild`, `webpack`        | `Bun.build()`                |
| `jest`, `mocha`, `vitest`   | `bun:test`                   |
| `eslint` (partial)          | TypeScript strict mode       |
| `prettier` (formatter only) | Still allowed                |
| `npm-run-all`               | Bun scripts                  |
| `cross-env`                 | Bun handles env vars         |
| `rimraf`                    | `rm -rf` or `fs.rm()`        |

#### Allowed Dependencies

**Only these dependencies are permitted:**

1. **arktype** - Runtime validation (core functionality)
2. **Development-only tools** - TypeScript, Biome, specific linters
3. **Domain-specific libraries** - Only after exhaustive justification

**Any new dependency requires:**

1. Documented justification in AGENTS.md
2. Proof that Bun's standard library cannot provide the functionality
3. Security audit of the package
4. Commitment to eventual removal/replacement

## ⚠️ MANDATORY FEATURE VALIDATION

**EVERY FEATURE CONTRIBUTION MUST PASS ALL VALIDATION CHECKS BEFORE BEING
DECLARED COMPLETE.**

**It is UNACCEPTABLE to declare work finished when ANY of the following fail:**

- Type checking errors
- Biome errors OR warnings
- Test failures
- Build failures
- Rust compilation errors
- Rust test failures

**ZERO TOLERANCE for linting issues:**

- ALL Biome warnings must be resolved
- ALL TypeScript strict mode violations must be fixed
- NO suppression comments (@ts-ignore, eslint-disable) without documented
  justification
- Code style warnings are NOT "minor" - they are technical debt

### PREVENTIVE MEASURES

#### 1. ENFORCE VALIDATION-FIRST WORKFLOW

**❌ FORBIDDEN WORKFLOW:**

```
Write code → Mark complete → (Maybe) validate
```

**✅ MANDATORY WORKFLOW:**

```
Write code → Run `bun run validate` → Fix ALL issues → Write tests → Validate again → ONLY THEN mark complete
```

#### 2. REDEFINE "COMPLETE"

A task is ONLY complete when:

- ✅ `bun run validate` passes with ZERO errors AND ZERO warnings
- ✅ Tests exist and pass
- ✅ No TypeScript errors
- ✅ No Biome warnings or errors
- ✅ No build failures
- ✅ Evidence provided (full validation output showing 0 problems)

#### 3. CHECKPOINT SYSTEM

Before marking ANY task complete, you MUST:

1. Show the COMPLETE output of `bun run validate`
2. Show the test results
3. Show the Biome output explicitly stating "✔ 0 problems (0 errors, 0
   warnings)"
4. Explicitly state: "Validation passed, tests passed, ZERO errors, ZERO
   warnings"
5. If validation fails OR any warnings exist, the task stays "in_progress" or
   moves to "blocked"

See the scripts defined in `package.json` and especially the recipes in the
project `justfile` for what you and other developers will use to orchestrate
formatting, linting, building, and testing--you will be using one or both
extensively during your work with this project.

### Linting Standards - ZERO WARNINGS POLICY

**Every warning is a defect. Every suppression is technical debt.**

#### What Constitutes a Linting Violation:

- **Biome warnings** - ALL must be fixed, not suppressed
- **TypeScript strict mode violations** - Fix the code, not the config
- **Unused variables** - Remove them
- **Missing return types** - Add explicit types
- **Any type usage** - Replace with proper types
- **Complexity warnings** - Refactor the code
- **Unsafe operations** - Make them safe
- **Style inconsistencies** - Follow the project style

#### Unacceptable Practices:

```typescript
// ❌ NEVER DO THIS - Suppressing warnings is NOT fixing them
// @ts-ignore
// @ts-expect-error
// eslint-disable-next-line
// eslint-disable
```

#### Why Zero Warnings:

1. **Warnings become normalized** - Teams learn to ignore them
2. **Signal-to-noise ratio degrades** - Real issues get lost
3. **Broken window theory** - One warning leads to hundreds
4. **Maintenance burden** - Future developers inherit your mess
5. **Quality erosion** - Standards slip over time

### Failure Protocol

If ANY validation step fails OR any warnings exist:

1. **STOP** - Do not proceed with other work
2. **FIX** - Address EVERY failing check and warning immediately
3. **RERUN** - Execute the full validation workflow again
4. **VERIFY** - Ensure all checks pass with ZERO problems before continuing

**Work is NOT complete until validation shows: ✔ 0 problems (0 errors, 0
warnings)**

### Inverted .gitignore Strategy

**This project REQUIRES an inverted .gitignore pattern.** Instead of listing
what to ignore, we explicitly list what to include. This approach:

1. **Prevents accidental commits** of sensitive or unnecessary files
2. **Makes the repository structure explicit** and intentional
3. **Reduces repository bloat** by default
4. **Improves security** by requiring explicit inclusion

#### Required .gitignore Structure

```gitignore
# Ignore everything by default
*

# Configuration files (root level)
!/.gitignore
!/package.json
!/bun.lockb
!/tsconfig.json
!/deno.json
!/README.md
!/AGENTS.md
!/LICENSE

# Source code - each file must be explicitly allowed
!/src/
!/src/index.ts
!/src/types.ts
!/src/errors.ts
!/src/formats/
!/src/formats/fasta.ts
!/src/formats/fastq.ts
!/src/formats/sam.ts
!/src/formats/bed.ts
!/src/io/
!/src/io/file-reader.ts
!/src/io/runtime.ts
!/src/io/stream-utils.ts
!/src/utils/
!/src/validation/
!/src/compression/

# When native code is added, each file must be listed:
# !/src/native/
# !/src/native/Cargo.toml
# !/src/native/src/
# !/src/native/src/lib.rs
# etc...

# Tests - each test file explicitly
!/test/
!/test/formats/
!/test/formats/fasta.test.ts
!/test/formats/fastq.test.ts
!/test/formats/sam.test.ts
!/test/io/
!/test/io/file-reader.test.ts
!/test/io/parser-integration.test.ts
!/test/fixtures/
!/test/fixtures/sample.fasta
!/test/fixtures/sample.fastq
!/test/fixtures/sample.bed

# Scripts
!/scripts/
!/scripts/build.js
!/scripts/demo.ts
```

**NO GLOBS. NO WILDCARDS. Every single file must be explicitly listed.** This
prevents accidental commits of sensitive files, generated artifacts, or
experimental code.

**Every file in version control must be explicitly allowed.** This is
non-negotiable.

### Anti-Code-Entropy Policies

**Every line of code is a liability.** All code additions have the potential to
become technical debt, introduce feature creep, add cognitive overhead, and
increase developer fatigue. This is especially critical in JavaScript's
exceptionally flexible and permissive environment, and because TypeScript must
make allowances for JavaScript compatibility, we must maintain vigilant
oversight against entropy in TypeScript projects.

#### Core Anti-Entropy Principles

1. **Justify Every Addition**
   - New code must solve a documented real-world problem
   - Each function must have a clear, single responsibility
   - No speculative features or "nice-to-have" additions
   - Every API surface must be essential and non-redundant

2. **Minimize Cognitive Load**
   - Function signatures should be immediately understandable
   - Parameter counts should be minimized (max 3-4 parameters)
   - Avoid deep nesting and complex control flow
   - Prefer explicit over implicit behavior

3. **Resist Feature Creep**
   - New features require explicit justification in AGENTS.md
   - Each feature must align with core bioinformatics use cases
   - No convenience methods that can be composed from primitives
   - Regular API surface audits to identify cruft

4. **Maintain Deletion Culture**
   - Dead code is removed immediately
   - Unused parameters and options are eliminated
   - Deprecated features are removed, not left behind
   - Code that cannot be easily understood is refactored or removed

5. **Enforce Constraints**
   - Functions must not exceed 70 lines (Tiger Style)
   - Classes should have clear, bounded responsibilities
   - Modules should have minimal, focused exports
   - Dependencies are added only when essential

6. **Combat JavaScript Flexibility**
   - Use `const` by default, `let` only when mutation is required
   - Prefer readonly interfaces for immutable data
   - Use strict type annotations, avoid `any` or `unknown`
   - Explicit function return types for all public APIs
   - Prefer composition over inheritance
   - Use discriminated unions instead of loose object shapes

### Making Invalid States Unrepresentable

**"Make illegal states unrepresentable"** - if invalid data structures cannot be
constructed, entire classes of bugs disappear. Beyond runtime validation, we
leverage TypeScript's type system and tooling to prevent errors at compile time.

#### Compile-Time Safety Mechanisms

1. **Branded Types for Domain Constraints**

   ```typescript
   // Prevent mixing coordinate systems
   type ZeroBasedCoordinate = number & { readonly __brand: 'ZeroBased' };
   type OneBasedCoordinate = number & { readonly __brand: 'OneBased' };

   // Quality scores with compile-time bounds
   type PhredScore = number & { readonly __brand: 'PhredScore'; readonly __range: 0..93 };
   type SolexaScore = number & { readonly __brand: 'SolexaScore'; readonly __range: -5..62 };

   // Sequence strings with format guarantees
   type DNASequence = string & { readonly __brand: 'DNASequence'; readonly __validated: true };
   type ProteinSequence = string & { readonly __brand: 'ProteinSequence'; readonly __validated: true };
   ```

2. **State Machines via Discriminated Unions**

   ```typescript
   // Parser states that prevent invalid transitions
   type ParserState =
     | { status: "waiting"; buffer: "" }
     | { status: "reading_header"; buffer: string; headerStart: number }
     | {
       status: "reading_sequence";
       buffer: string;
       currentSequence: Partial<FastaSequence>;
     }
     | { status: "complete"; result: FastaSequence };

   // Quality encoding detection with exhaustive matching
   type QualityEncoding =
     | { type: "phred33"; minScore: 0; maxScore: 93; asciiOffset: 33 }
     | { type: "phred64"; minScore: 0; maxScore: 93; asciiOffset: 64 }
     | { type: "solexa"; minScore: -5; maxScore: 62; asciiOffset: 64 };
   ```

3. **Const Assertions for Exhaustive Validation**

   ```typescript
   // Bioinformatics constants with compile-time verification
   const NUCLEOTIDES = ["A", "T", "C", "G"] as const;
   const IUPAC_CODES = [
     "R",
     "Y",
     "S",
     "W",
     "K",
     "M",
     "B",
     "D",
     "H",
     "V",
     "N",
   ] as const;
   const AMINO_ACIDS = [
     "A",
     "C",
     "D",
     "E",
     "F",
     "G",
     "H",
     "I",
     "K",
     "L",
     "M",
     "N",
     "P",
     "Q",
     "R",
     "S",
     "T",
     "V",
     "W",
     "Y",
   ] as const;

   type Nucleotide = (typeof NUCLEOTIDES)[number];
   type IUPACCode = (typeof IUPAC_CODES)[number];
   type AminoAcid = (typeof AMINO_ACIDS)[number];

   // Exhaustive switch statements with compile-time coverage
   function validateNucleotide(char: string): char is Nucleotide {
     switch (char as Nucleotide) {
       case "A":
       case "T":
       case "C":
       case "G":
         return true;
       default:
         return false;
     }
   }
   ```

4. **Template Literal Types for Format Validation**

   ```typescript
   // Chromosome names with compile-time format checking
   type ChromosomeName = `chr${number}` | `chr${"X" | "Y" | "M"}`;
   type StrandOrientation = "+" | "-" | ".";

   // BED coordinate validation at type level
   type BedCoordinate<T extends number> = T extends 0 ? never : T;
   type ValidBedInterval =
     & {
       chromosome: ChromosomeName;
       start: BedCoordinate<number>;
       end: BedCoordinate<number>;
     }
     & (start extends infer S
       ? end extends infer E
         ? S extends number ? E extends number ? E extends 0 ? never
             : S extends 0 ? never
             : E extends S ? never
             : {}
           : never
         : never
       : never
       : never);
   ```

5. **Conditional Types for Input Validation**

   ```typescript
   // Only allow valid parser configurations
   type ParserOptions<T extends "fasta" | "fastq" | "bed"> =
     & {
       skipValidation?: boolean;
       maxLineLength?: number;
     }
     & (T extends "fastq" ? {
         qualityEncoding: "phred33" | "phred64" | "solexa";
         parseQualityScores: boolean;
       }
       : {})
     & (T extends "bed" ? {
         allowZeroBasedCoordinates: boolean;
       }
       : {});

   // Prevent invalid sequence-quality combinations
   type SequenceWithQuality<S, Q> = S extends string
     ? Q extends string
       ? S["length"] extends Q["length"] ? { sequence: S; quality: Q }
       : never
     : never
     : never;
   ```

#### Runtime-to-Compile-Time Bridges

1. **ArkType Integration with TypeScript**

   ```typescript
   // Generate TypeScript types from ArkType schemas
   import { Type, type } from "arktype";

   const FastaSequenceSchema = type({
     format: '"fasta"',
     id: "string",
     sequence: /^[ACGTURYSWKMBDHVN\-\.\*]+$/i,
     length: "number>0",
   });

   // Extract compile-time type from runtime schema
   type FastaSequence = Type.infer<typeof FastaSequenceSchema>;

   // Builder pattern that enforces schema at both compile and runtime
   class FastaSequenceBuilder {
     private data: Partial<FastaSequence> = {};

     id<T extends string>(id: T): FastaSequenceBuilder & { _id: T } {
       this.data.id = id;
       return this as any;
     }

     sequence<T extends string>(
       seq: T,
     ): T extends `${string}${Exclude<string, "ACGTURYSWKMBDHVN-.*">}${string}`
       ? never
       : FastaSequenceBuilder & { _sequence: T } {
       this.data.sequence = seq;
       return this as any;
     }
   }
   ```

2. **Assertion Functions for Type Narrowing**

   ```typescript
   // Custom assertion functions that narrow types
   function assertValidDNASequence(seq: string): asserts seq is DNASequence {
     if (!/^[ACGTURYSWKMBDHVN\-\.\*]+$/i.test(seq)) {
       throw new Error(`Invalid DNA sequence: ${seq}`);
     }
   }

   function assertCoordinateOrder<T extends number, U extends number>(
     start: T,
     end: U,
   ): asserts start is T & { __lessThan: U } {
     if (start >= end) {
       throw new Error(
         `Invalid coordinate order: start=${start} >= end=${end}`,
       );
     }
   }
   ```

#### Build-Time Verification

1. **Generated Type Tests**

   ```typescript
   // Auto-generated compile-time tests
   import { expectError, expectType } from "tsd";

   // These tests run during build and fail compilation if types are wrong
   expectType<DNASequence>("ATCG" as DNASequence);
   expectError<DNASequence>("ATCGX" as any); // Should fail compilation

   expectType<ValidBedInterval>({ chromosome: "chr1", start: 100, end: 200 });
   expectError<ValidBedInterval>({ chromosome: "chr1", start: 200, end: 100 }); // Invalid order
   ```

2. **Static Analysis Integration**

   ```typescript
   // Custom TypeScript transformer for additional checks
   import ts from "typescript";

   function createGenomicsTransformer(): ts.TransformerFactory<ts.SourceFile> {
     return (context) => (sourceFile) => {
       function visitor(node: ts.Node): ts.Node {
         // Check for direct coordinate arithmetic
         if (
           ts.isBinaryExpression(node) &&
           (node.operatorToken.kind === ts.SyntaxKind.PlusToken ||
             node.operatorToken.kind === ts.SyntaxKind.MinusToken)
         ) {
           // Emit error if operating on coordinate types
         }
         return ts.visitEachChild(node, visitor, context);
       }
       return ts.visitNode(sourceFile, visitor);
     };
   }
   ```

These mechanisms create multiple layers of protection:

- **Impossible to construct** invalid data structures
- **Impossible to compile** code with type errors
- **Impossible to commit** code that fails safety checks
- **Impossible to ship** code without 100% type coverage

The result: entire categories of bugs become **structurally impossible**.

## API Design

### Core Data Structures

```typescript
// Base sequence interface
interface Sequence {
  readonly id: string;
  readonly description?: string;
  readonly sequence: string;
  readonly length: number;
}

// FASTA sequence
interface FastaSequence extends Sequence {
  readonly format: "fasta";
}

// FASTQ sequence with quality scores
interface FastqSequence extends Sequence {
  readonly format: "fastq";
  readonly quality: string;
  readonly qualityEncoding: "phred33" | "phred64";
}

// BED interval
interface BedInterval {
  readonly chromosome: string;
  readonly start: number;
  readonly end: number;
  readonly name?: string;
  readonly score?: number;
  readonly strand?: "+" | "-" | ".";
  readonly thickStart?: number;
  readonly thickEnd?: number;
  readonly itemRgb?: string;
  readonly blockCount?: number;
  readonly blockSizes?: number[];
  readonly blockStarts?: number[];
}
```

### Streaming API

```typescript
// Generic streaming parser interface
interface StreamingParser<T> {
  parse(input: ReadableStream<Uint8Array>): AsyncIterable<T>;
  parseFile(path: string): AsyncIterable<T>;
  parseString(data: string): AsyncIterable<T>;
}

// Usage examples
const fastaParser = new FastaParser();
for await (const sequence of fastaParser.parseFile("genome.fasta")) {
  console.log(`${sequence.id}: ${sequence.length} bp`);
}

const fastqParser = new FastqParser();
for await (const read of fastqParser.parseFile("reads.fastq.gz")) {
  console.log(`${read.id}: Q${read.quality}`);
}
```

### Validation System

All parsers use Arktype for runtime validation:

```typescript
import { type } from "arktype";

// Validation schemas
const FastaSequenceSchema = type({
  id: "string",
  description: "string?",
  sequence: /^[ACGTN]*$/i,
  length: "number",
});

// Validation during parsing
const validateSequence = (data: unknown) => {
  const result = FastaSequenceSchema(data);
  if (result instanceof type.errors) {
    throw new ValidationError(`Invalid FASTA sequence: ${result.summary}`);
  }
  return result;
};
```

### Compression Support

Built-in support for common bioinformatics compression formats:

```typescript
// Automatic format detection
const parser = new FastaParser();
await parser.parseFile("sequences.fasta.gz"); // Gzip
await parser.parseFile("sequences.fasta.zst"); // Zstandard
await parser.parseFile("sequences.fasta"); // Uncompressed

// Explicit compression
import { GzipDecompressor, ZstdDecompressor } from "./compression";
const decompressor = new GzipDecompressor();
const stream = decompressor.decompress(compressedStream);
```

## Performance Considerations

### Memory Management

- **Streaming-first design** - never load entire files into memory
- **Lazy evaluation** - only parse what's needed
- **Buffer pooling** - reuse buffers to minimize GC pressure
- **Incremental parsing** - parse data as it arrives

### Bottleneck Identification

Performance-critical operations will be implemented in Rust:

1. **String processing** - sequence parsing and validation
2. **Compression/decompression** - especially for large files
3. **Binary parsing** - BAM file parsing
4. **Quality score conversion** - FASTQ quality encoding

### Native Implementation Philosophy

**TypeScript First, Then Optimize.** The development workflow is:

1. **Prototype in TypeScript** - Establish the API and validate the design
2. **Identify bottlenecks** - Through actual usage, not premature optimization
3. **Move to native implementation strategically** - Only after the API is
   stable and bottlenecks are proven
4. **No performance testing until native code** - Performance tests are only
   added when we have native implementations to benchmark

**One implementation per feature.** We do NOT maintain parallel TypeScript and
native implementations. Each feature has exactly one implementation. During the
TypeScript-only phase, we focus on correctness and API design, not performance.

Reference: [OpenTUI](https://github.com/sst/opentui) demonstrates elegant
TypeScript/native code integration patterns via FFI.

#### When to Use Native Implementation (Future)

Once the API is stable, move to native Rust implementation for operations that
benefit from:

1. **SIMD acceleration** - Parallel sequence processing, quality score
   conversion
2. **Multi-core parallelism** - Large file processing, batch operations
3. **Memory-intensive operations** - Binary parsing (BAM), compression
4. **Tight loops** - Character validation, sequence cleaning
5. **Bit manipulation** - SAM flags, binary formats

#### Current Phase: TypeScript API Development

**We are currently in the TypeScript API development phase.** This means:

- **NO performance testing** - We're not optimizing yet
- **NO benchmarks** - Premature optimization is the root of all evil
- **NO parallel implementations** - One way to do things
- **Focus on correctness** - Get the API right first
- **Focus on usability** - Developer experience over speed (for now)

## Error Handling

Explicit error types for different failure modes:

```typescript
export class GenotypeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "GenotypeError";
  }
}

export class ValidationError extends GenotypeError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
  }
}

export class ParseError extends GenotypeError {
  constructor(
    message: string,
    public readonly line?: number,
  ) {
    super(message, "PARSE_ERROR");
  }
}

export class CompressionError extends GenotypeError {
  constructor(message: string) {
    super(message, "COMPRESSION_ERROR");
  }
}
```

## Testing Strategy

### Test Structure

```typescript
// Test file structure
test/
├── formats/
│   ├── fasta.test.ts
│   ├── fastq.test.ts
│   ├── sam.test.ts
│   ├── bam.test.ts
│   └── bed.test.ts
├── compression/
│   ├── gzip.test.ts
│   └── zstd.test.ts
├── validation/
│   └── arktype.test.ts
├── performance/
│   ├── streaming.test.ts
│   └── benchmarks.test.ts
├── integration/
│   ├── large-files.test.ts
│   └── cross-format.test.ts
├── fixtures/
│   ├── valid/
│   │   ├── sample.fasta
│   │   ├── sample.fastq
│   │   └── sample.bed
│   ├── invalid/
│   │   ├── malformed.fasta
│   │   ├── corrupt.fastq
│   │   └── invalid.bed
│   └── edge-cases/
│       ├── empty.fasta
│       ├── huge-sequence.fasta
│       └── mixed-encoding.fastq
└── helpers/
    ├── test-utils.ts
    └── mock-streams.ts
```

### Writing Tests

Use `bun test` to run tests. All tests MUST use the Bun test framework:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FastaParser } from "../src/formats/fasta";
import { ParseError, SequenceError } from "../src/errors";

describe("FastaParser", () => {
  let parser: FastaParser;

  beforeEach(() => {
    parser = new FastaParser();
  });

  describe("valid sequences", () => {
    test("parses single-line FASTA sequence", async () => {
      const input = ">seq1 description\nATCGATCG";
      const sequences = [];

      for await (const seq of parser.parseString(input)) {
        sequences.push(seq);
      }

      expect(sequences).toHaveLength(1);
      expect(sequences[0]).toEqual({
        format: "fasta",
        id: "seq1",
        description: "description",
        sequence: "ATCGATCG",
        length: 8,
        lineNumber: 1,
      });
    });

    test("handles wrapped sequences", async () => {
      const input = ">seq1\nATCG\nATCG\nATCG";
      const [seq] = await Array.fromAsync(parser.parseString(input));

      expect(seq.sequence).toBe("ATCGATCGATCG");
      expect(seq.length).toBe(12);
    });
  });

  describe("error handling", () => {
    test("throws ParseError for missing header", async () => {
      const input = "ATCGATCG"; // No header

      await expect(async () => {
        for await (const _ of parser.parseString(input)) {
          // Should throw before yielding
        }
      }).toThrow(ParseError);
    });

    test("throws SequenceError for invalid nucleotides", async () => {
      const input = ">seq1\nATCGXYZ"; // Invalid chars

      await expect(async () => {
        for await (const _ of parser.parseString(input)) {
          // Should throw on validation
        }
      }).toThrow(SequenceError);
    });
  });

  describe("edge cases", () => {
    test("handles empty file", async () => {
      const sequences = await Array.fromAsync(parser.parseString(""));
      expect(sequences).toHaveLength(0);
    });

    test("handles sequences with IUPAC codes", async () => {
      const input = ">seq1\nATCGRYSWKMBDHVN";
      const [seq] = await Array.fromAsync(parser.parseString(input));

      expect(seq.sequence).toBe("ATCGRYSWKMBDHVN");
    });

    test("preserves case sensitivity when configured", async () => {
      const parser = new FastaParser({ preserveCase: true });
      const input = ">seq1\natcgATCG";
      const [seq] = await Array.fromAsync(parser.parseString(input));

      expect(seq.sequence).toBe("atcgATCG");
    });
  });
});
```

### Test Categories

#### Unit Tests

- Test individual functions and methods in isolation
- Mock external dependencies
- Focus on single responsibility
- Fast execution (< 50ms per test)

#### Integration Tests

- Test interactions between modules
- Use real file I/O and streams
- Validate end-to-end workflows
- Test cross-format conversions

#### Performance Tests

- Benchmark critical operations
- Track performance over time
- Fail on regression (>10% slower)
- Memory usage profiling

```typescript
import { bench, group } from "bun:test";

group("FASTA parsing performance", () => {
  bench("small file (1MB)", async () => {
    await parser.parseFile("fixtures/1mb.fasta");
  });

  bench("large file (100MB)", async () => {
    await parser.parseFile("fixtures/100mb.fasta");
  });

  bench("streaming vs buffered", async () => {
    // Compare performance of different approaches
  });
});
```

#### Property-Based Tests

- Generate random valid/invalid inputs
- Test invariants hold for all inputs
- Discover edge cases automatically

```typescript
import { test } from "bun:test";
import { type } from "arktype";

test.prop([type("string").generate(), type("number.integer >= 0").generate()])(
  "parser handles any string input without crashing",
  async (input, lineLength) => {
    const parser = new FastaParser({ maxLineLength: lineLength });

    try {
      for await (const _ of parser.parseString(input)) {
        // Should either parse or throw appropriate error
      }
    } catch (error) {
      expect(error).toBeInstanceOf(GenotypeError);
    }
  },
);
```

### Test Data Requirements

#### Valid Format Examples

- Canonical format compliance
- Real-world data from NCBI/EBI
- Various sequence lengths (empty to gigabase)
- Different line wrapping styles
- All supported character sets

#### Invalid Format Examples

- Missing headers
- Malformed quality scores
- Invalid characters
- Truncated files
- Mixed format files
- Encoding issues

#### Edge Cases

- Empty files
- Single character sequences
- Maximum length sequences
- Unicode in descriptions
- Windows/Unix/Mac line endings
- Compressed variants

#### Large File Testing

- Performance benchmarks
- Memory usage monitoring
- Streaming validation
- Progress reporting
- Cancellation handling

### Mocking Guidelines

```typescript
// Mock file system for unit tests
import { mockFS } from "./helpers/mock-fs";

beforeEach(() => {
  mockFS.setup({
    "/test/data.fasta": ">seq1\nATCG",
    "/test/empty.fasta": "",
  });
});

afterEach(() => {
  mockFS.restore();
});

// Mock streams for testing streaming parsers
import { MockReadableStream } from "./helpers/mock-streams";

test("handles stream errors gracefully", async () => {
  const stream = new MockReadableStream([
    ">seq1\n",
    "ATCG",
    MockReadableStream.ERROR("Network error"),
  ]);

  await expect(async () => {
    for await (const _ of parser.parse(stream)) {
      // Should handle error
    }
  }).toThrow(StreamError);
});
```

### Testing Best Practices

1. **Test Names**: Use descriptive names that explain the scenario

   ```typescript
   // ✅ Good
   test("throws ParseError when FASTA header is missing '>' prefix", ...)

   // ❌ Bad
   test("test header", ...)
   ```

2. **Arrange-Act-Assert**: Structure tests clearly

   ```typescript
   test("parses multi-line sequence", async () => {
     // Arrange
     const input = ">seq1\nATCG\nGCTA";
     const parser = new FastaParser();

     // Act
     const result = await Array.fromAsync(parser.parseString(input));

     // Assert
     expect(result[0].sequence).toBe("ATCGGCTA");
   });
   ```

3. **One Assertion Per Test**: Keep tests focused
4. **Test Public APIs**: Don't test implementation details
5. **Use Test Fixtures**: Share test data across tests
6. **Clean Up Resources**: Always clean up in afterEach
7. **Avoid Time Dependencies**: Mock dates/timers
8. **Test Error Messages**: Verify helpful error context

## Code Style

### Runtime Requirements

- **Runtime**: Bun with TypeScript (NO exceptions - no npm, yarn, or pnpm)
- **Language**: TypeScript with strict mode enabled
- **Module System**: ES modules only

### Naming Conventions

- **Variables/Functions**: `camelCase` (e.g., `parseSequence`, `qualityScore`)
- **Classes/Interfaces/Types**: `PascalCase` (e.g., `FastaSequence`,
  `ParserOptions`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `MAX_SEQUENCE_LENGTH`,
  `NUCLEOTIDE_CODES`)
- **File names**: `kebab-case.ts` for modules, `PascalCase.ts` for classes
- **Test files**: `*.test.ts` colocated with source files

### Type Requirements

- Strict TypeScript mode enforced
- Use interfaces for options/configs
- Explicit return types for ALL public APIs
- No `any` or `unknown` without explicit justification
- Prefer `readonly` for immutable data

```typescript
// Good example
interface ParserConfig {
  readonly format: "fasta" | "fastq";
  readonly validation: boolean;
  readonly maxSequenceLength?: number;
}

export function parseFile(
  path: string,
  config: ParserConfig,
): AsyncIterable<Sequence> {
  // Implementation
}
```

### Error Handling Patterns

- Use proper Error subclasses (see Error Handling section)
- Never use silent failures
- Provide context in error messages
- Include suggestions for fixing errors

```typescript
// Good error handling
if (!isValidSequence(seq)) {
  throw new SequenceError(
    `Invalid nucleotide sequence: contains non-IUPAC characters`,
    seq.id,
    lineNumber,
    `Valid characters are: A, C, G, T, U, R, Y, S, W, K, M, B, D, H, V, N`,
  );
}
```

### Async Best Practices

- Prefer `async`/`await` over raw Promises
- Handle errors explicitly with try/catch
- Use `AsyncIterable` for streaming data
- Never ignore promise rejections

```typescript
// Good async pattern
async function* parseStream(stream: ReadableStream): AsyncIterable<Sequence> {
  try {
    const reader = stream.getReader();
    // Processing logic
  } catch (error) {
    throw new StreamError("Failed to read stream", "read", bytesProcessed);
  } finally {
    reader?.releaseLock();
  }
}
```

### Code Nesting and Complexity Control

**Deeply nested code is a liability.** Excessive nesting creates cognitive
overhead, reduces readability, makes testing difficult, and increases the
likelihood of bugs. Follow these strict anti-nesting guidelines:

#### Maximum Nesting Limits

- **Functions**: Maximum 3 levels of nesting
- **Control structures**: Maximum 2 levels of if/for/while nesting
- **Callbacks**: Use async/await instead of callback nesting
- **Object access**: Maximum 3 levels of property access

#### De-nesting Techniques

1. **Early Returns (Guard Clauses)**

   ```typescript
   // ❌ BAD: Deep nesting with multiple conditions
   function processSequence(sequence: string, options: Options): Result {
     if (sequence) {
       if (options.validate) {
         if (sequence.length > 0) {
           if (isValidSequence(sequence)) {
             return { success: true, data: cleanSequence(sequence) };
           } else {
             return { success: false, error: "Invalid sequence" };
           }
         } else {
           return { success: false, error: "Empty sequence" };
         }
       } else {
         return { success: true, data: sequence };
       }
     } else {
       return { success: false, error: "No sequence provided" };
     }
   }

   // ✅ GOOD: Early returns eliminate nesting
   function processSequence(sequence: string, options: Options): Result {
     if (!sequence) {
       return { success: false, error: "No sequence provided" };
     }

     if (!options.validate) {
       return { success: true, data: sequence };
     }

     if (sequence.length === 0) {
       return { success: false, error: "Empty sequence" };
     }

     if (!isValidSequence(sequence)) {
       return { success: false, error: "Invalid sequence" };
     }

     return { success: true, data: cleanSequence(sequence) };
   }
   ```

2. **Extract Functions**

   ```typescript
   // ❌ BAD: Complex nested loop with embedded logic
   function parseMultipleFiles(files: string[]): ParsedFile[] {
     const results: ParsedFile[] = [];
     for (const file of files) {
       if (file.endsWith(".fasta")) {
         const content = readFile(file);
         const lines = content.split("\n");
         const sequences: Sequence[] = [];
         let currentSeq = "";
         let currentId = "";
         for (const line of lines) {
           if (line.startsWith(">")) {
             if (currentSeq && currentId) {
               sequences.push({ id: currentId, sequence: currentSeq });
             }
             currentId = line.slice(1);
             currentSeq = "";
           } else {
             currentSeq += line.trim();
           }
         }
         if (currentSeq && currentId) {
           sequences.push({ id: currentId, sequence: currentSeq });
         }
         results.push({ filename: file, sequences });
       }
     }
     return results;
   }

   // ✅ GOOD: Extracted functions with single responsibilities
   function parseMultipleFiles(files: string[]): ParsedFile[] {
     return files.filter(isFastaFile).map(parseFile);
   }

   function isFastaFile(file: string): boolean {
     return file.endsWith(".fasta");
   }

   function parseFile(file: string): ParsedFile {
     const content = readFile(file);
     const sequences = parseSequences(content);
     return { filename: file, sequences };
   }

   function parseSequences(content: string): Sequence[] {
     const lines = content.split("\n");
     const sequences: Sequence[] = [];
     let currentSeq = "";
     let currentId = "";

     for (const line of lines) {
       if (line.startsWith(">")) {
         addSequenceIfValid(sequences, currentId, currentSeq);
         currentId = line.slice(1);
         currentSeq = "";
       } else {
         currentSeq += line.trim();
       }
     }

     addSequenceIfValid(sequences, currentId, currentSeq);
     return sequences;
   }

   function addSequenceIfValid(
     sequences: Sequence[],
     id: string,
     seq: string,
   ): void {
     if (seq && id) {
       sequences.push({ id, sequence: seq });
     }
   }
   ```

3. **Use Continue/Break for Loop Control**

   ```typescript
   // ❌ BAD: Nested if statements in loops
   function processLines(lines: string[]): ProcessedLine[] {
     const results: ProcessedLine[] = [];
     for (const line of lines) {
       if (line.trim()) {
         if (!line.startsWith("#")) {
           if (line.includes("\t")) {
             const fields = line.split("\t");
             if (fields.length >= 3) {
               results.push({ fields, type: "data" });
             } else {
               results.push({ fields, type: "incomplete" });
             }
           } else {
             results.push({ fields: [line], type: "single" });
           }
         }
       }
     }
     return results;
   }

   // ✅ GOOD: Continue statements eliminate nesting
   function processLines(lines: string[]): ProcessedLine[] {
     const results: ProcessedLine[] = [];

     for (const line of lines) {
       const trimmed = line.trim();
       if (!trimmed) continue;
       if (trimmed.startsWith("#")) continue;

       if (!line.includes("\t")) {
         results.push({ fields: [line], type: "single" });
         continue;
       }

       const fields = line.split("\t");
       const type = fields.length >= 3 ? "data" : "incomplete";
       results.push({ fields, type });
     }

     return results;
   }
   ```

4. **Invert Conditions**

   ```typescript
   // ❌ BAD: Positive condition leading to nesting
   function validateInput(input: Input): ValidationResult {
     if (input.isValid) {
       if (input.data) {
         if (input.data.length > 0) {
           // Deep nesting for success case
           return processValidInput(input.data);
         }
       }
     }
     return { error: "Invalid input" };
   }

   // ✅ GOOD: Inverted conditions with early returns
   function validateInput(input: Input): ValidationResult {
     if (!input.isValid) {
       return { error: "Input is not valid" };
     }

     if (!input.data) {
       return { error: "No data provided" };
     }

     if (input.data.length === 0) {
       return { error: "Empty data" };
     }

     return processValidInput(input.data);
   }
   ```

5. **Use Higher-Order Functions**

   ```typescript
   // ❌ BAD: Nested loops for data transformation
   function transformData(records: Record[]): TransformedRecord[] {
     const results: TransformedRecord[] = [];
     for (const record of records) {
       if (record.active) {
         const transformed: TransformedRecord = { id: record.id, values: [] };
         for (const value of record.values) {
           if (value > 0) {
             transformed.values.push(value * 2);
           }
         }
         if (transformed.values.length > 0) {
           results.push(transformed);
         }
       }
     }
     return results;
   }

   // ✅ GOOD: Functional approach eliminates nesting
   function transformData(records: Record[]): TransformedRecord[] {
     return records
       .filter((record) => record.active)
       .map((record) => ({
         id: record.id,
         values: record.values.filter((value) => value > 0).map((value) =>
           value * 2
         ),
       }))
       .filter((record) => record.values.length > 0);
   }
   ```

#### Bioinformatics-Specific Examples

```typescript
// ❌ BAD: Nested genomic data processing
function processGenomicVariants(variants: Variant[]): ProcessedVariant[] {
  const results: ProcessedVariant[] = [];
  for (const variant of variants) {
    if (variant.chromosome) {
      if (variant.position > 0) {
        if (variant.ref && variant.alt) {
          if (variant.quality >= 20) {
            const processed = {
              ...variant,
              normalized: normalizeAlleles(variant.ref, variant.alt),
              annotation: null,
            };
            if (processed.normalized) {
              const annotation = annotateVariant(processed);
              if (annotation) {
                processed.annotation = annotation;
                results.push(processed);
              }
            }
          }
        }
      }
    }
  }
  return results;
}

// ✅ GOOD: De-nested with early returns and extraction
function processGenomicVariants(variants: Variant[]): ProcessedVariant[] {
  return variants.filter(isValidVariant).map(processVariant).filter(
    hasAnnotation,
  );
}

function isValidVariant(variant: Variant): boolean {
  return !!(
    variant.chromosome &&
    variant.position > 0 &&
    variant.ref &&
    variant.alt &&
    variant.quality >= 20
  );
}

function processVariant(variant: Variant): ProcessedVariant | null {
  const normalized = normalizeAlleles(variant.ref, variant.alt);
  if (!normalized) return null;

  const processed = { ...variant, normalized, annotation: null };
  const annotation = annotateVariant(processed);

  return annotation ? { ...processed, annotation } : null;
}

function hasAnnotation(
  variant: ProcessedVariant | null,
): variant is ProcessedVariant {
  return variant !== null && variant.annotation !== null;
}
```

### Documentation Standards

- Minimal inline comments - code should be self-documenting
- Comprehensive JSDoc for ALL public APIs
- Include examples in JSDoc
- Document performance characteristics
- Specify error conditions

### File Structure

- Index files for clean exports
- Group related functionality in directories
- Colocate tests with source files
- Separate types into dedicated files when shared

```
src/
├── formats/
│   ├── fasta.ts
│   ├── fasta.test.ts
│   ├── fastq.ts
│   ├── fastq.test.ts
│   └── index.ts     # Re-exports public APIs
├── types.ts         # Shared type definitions
├── errors.ts        # Error class hierarchy
└── index.ts         # Main library exports
```

## TypeScript Advanced Type Safety Patterns

### Const Assertions and Immutability

Enforce immutability at the type level:

```typescript
// Enforce immutability at the type level
const NUCLEOTIDES = ["A", "T", "C", "G"] as const;
type Nucleotide = (typeof NUCLEOTIDES)[number];

// Function parameter immutability
function processSequence(sequence: readonly string[]): void {
  // sequence cannot be mutated
}

// Deep readonly for complex structures
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};
```

### Type Predicate Guards

```typescript
// Add to validation patterns
function assertValidSequence(seq: unknown): asserts seq is DNASequence {
  if (typeof seq !== "string" || !/^[ACGTN]+$/i.test(seq)) {
    throw new SequenceError("Invalid DNA sequence");
  }
}

// Usage: after this call, TypeScript knows seq is DNASequence
assertValidSequence(input);
```

## API Documentation Standards

### JSDoc Requirements

````typescript
/**
 * Parses FASTA sequences from a string input with streaming support.
 *
 * @param data - Raw FASTA format string
 * @param options - Parser configuration options
 * @returns Async iterable of validated FASTA sequences
 *
 * @example
 * ```typescript
 * for await (const seq of parser.parseString(data)) {
 *   console.log(`${seq.id}: ${seq.length} bp`);
 * }
 * ```
 *
 * @throws {ParseError} When FASTA format is invalid
 * @throws {MemoryError} When sequence exceeds memory limits
 *
 * @performance O(n) time, O(1) memory per sequence
 * @since 0.1.0
 */
````
