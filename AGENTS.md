# Genotype Library - API Documentation & Development Guidelines

## MANDATORY REVIEW REQUIREMENTS

**⚠️ STOP: Before ANY work on this codebase, you MUST:**

1. Read and understand ALL sections of this document
2. Review Tiger Style compliance requirements
3. Review ALL best practices sections (TypeScript, Bun, Zig, ArkType)
4. Understand the Anti-Code-Entropy policies
5. Review the security considerations
6. **Use Bun for ALL development tasks** - No npm, yarn, or pnpm allowed unless
   it's for compatibility testing
7. **Follow Zero-Dependency Philosophy** - No new npm packages without
   exhaustive justification
8. **MANDATORY: Run validation workflows** - All features MUST pass
   `bun run validate` or `bun run validate:full` before being declared complete

**NO EXCEPTIONS. Any code that doesn't follow these guidelines OR fails
validation will be rejected.**

## Overview

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
- **Simplicity wins** - prefer simple, understandable solutions over clever abstractions
- **Say no to complexity** - be willing to reject features that add unnecessary complexity
- **Pragmatism over perfection** - working code today beats perfect code never

**Development Approach:**

- **Prototype to understand** - build early prototypes to grasp the problem domain
- **Avoid premature abstractions** - don't over-engineer before understanding the system
- **Small, focused refactors** - improve code incrementally, not in massive rewrites
- **Code near its data** - keep parsing logic close to format definitions

**Testing Philosophy:**

- **Integration tests are king** - test real genomic file parsing, not just units
- **Test alongside development** - write tests as you code, not just before
- **Regression tests for bugs** - when fixing parser bugs, add tests immediately
- **Minimal end-to-end suite** - a few comprehensive tests over many brittle ones

**Code Clarity:**

- **Readability trumps brevity** - clear code over clever one-liners
- **Name your conditionals** - extract complex boolean logic into named variables
- **Embrace "dumb" questions** - ask when confused, complexity is not a badge of honor
- **Respect existing code** - understand why it exists before changing (Chesterton's Fence)

**Practical Wisdom for Genomics:**

- **Domain complexity is enough** - genomic formats are complex; keep the code simple
- **Tools matter** - invest in understanding Bun, TypeScript, and your debugger
- **Log everything** - especially in streaming parsers where debugging is hard
- **Balance DRY with clarity** - some duplication is better than confusing abstractions

### Zero-Dependency Philosophy

**Dependencies are liabilities.** With Bun's comprehensive standard library and
built-in tooling, we enforce an extremely strict zero-dependency policy for
TypeScript code. Every external dependency is a potential source of:

- Security vulnerabilities
- Version conflicts
- Maintenance burden
- Bundle size bloat
- Breaking changes
- Supply chain attacks

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
2. **Development-only tools** - TypeScript, Prettier, specific linters
3. **Domain-specific libraries** - Only after exhaustive justification

**Any new dependency requires:**

1. Documented justification in AGENTS.md
2. Proof that Bun's standard library cannot provide the functionality
3. Security audit of the package
4. Commitment to eventual removal/replacement

#### Implementation Without Dependencies

```typescript
// ❌ BAD: Using external dependencies
import fetch from 'node-fetch';
import { v4 as uuid } from 'uuid';
import chalk from 'chalk';
import dotenv from 'dotenv';

// ✅ GOOD: Using Bun's native capabilities
// Fetch is global
const response = await fetch('https://api.example.com');

// UUID is built-in
const id = crypto.randomUUID();

// Console styling is native
console.log('\x1b[32m%s\x1b[0m', 'Success!');

// .env files load automatically
console.log(process.env.API_KEY);
```

## ⚠️ MANDATORY FEATURE VALIDATION

**EVERY FEATURE CONTRIBUTION MUST PASS ALL VALIDATION CHECKS BEFORE BEING
DECLARED COMPLETE.**

**It is UNACCEPTABLE to declare work finished when ANY of the following fail:**

- Type checking errors
- Test failures
- Build failures
- Zig compilation errors
- Zig test failures

### Required Validation Commands

**For TypeScript-only contributions:**

```bash
bun run validate
# Equivalent to: bun run lint && bun run test && bun run build
```

**For contributions involving Zig/native code:**

```bash
bun run validate:full
# Equivalent to: bun run lint && bun run test && bun run test:zig && bun run build:with-native
```

### Individual Validation Steps

You can run individual steps for debugging:

```bash
# Type checking and linting
bun run lint

# TypeScript tests
bun run test

# Zig tests
bun run test:zig

# TypeScript build
bun run build

# Full build with native library
bun run build:with-native
```

### Validation Requirements

**ALL of the following MUST be true before declaring any work complete:**

1. ✅ **`bun run lint`** - Zero TypeScript compilation errors
2. ✅ **`bun run test`** - All TypeScript tests pass
3. ✅ **`bun run test:zig`** - All Zig tests pass (if applicable)
4. ✅ **`bun run build`** - Clean TypeScript build
5. ✅ **`bun run build:with-native`** - Clean native + TypeScript build (if
   applicable)

**NO EXCEPTIONS. NO "I'll fix it later." NO "It's just a small issue."**

### When to Use Each Validation Level

- **`bun run validate`** - Most feature contributions (parsers, utilities,
  types)
- **`bun run validate:full`** - Native library changes, FFI modifications,
  performance optimizations

### Failure Protocol

If ANY validation step fails:

1. **STOP** - Do not proceed with other work
2. **FIX** - Address the failing check immediately
3. **RERUN** - Execute the full validation workflow again
4. **VERIFY** - Ensure all checks pass before continuing

**Work is NOT complete until all validation passes.**

#### Bioinformatics-Specific Examples

```typescript
// ❌ BAD: Using external streaming libraries
import { Transform } from 'stream';
import through2 from 'through2';
import split2 from 'split2';

// ✅ GOOD: Using native streams and built-in utilities
const stream = new ReadableStream({
  async start(controller) {
    // Native streaming implementation
  },
});

// ❌ BAD: External compression libraries
import zlib from 'node-zlib';
import { createGunzip } from 'zlib-stream';

// ✅ GOOD: Bun's native compression
const file = Bun.file('genome.fasta.gz');
const decompressed = file.stream().pipeThrough(new DecompressionStream('gzip'));

// ❌ BAD: External file watching
import chokidar from 'chokidar';

// ✅ GOOD: Bun's native file watching
const watcher = Bun.watch('data/', (event, filename) => {
  console.log(`${event}: ${filename}`);
});

// ❌ BAD: External worker pool libraries
import workerpool from 'workerpool';

// ✅ GOOD: Native Worker API
new Worker('./sequence-processor.ts');
```

#### Enforcement

**Package.json must remain minimal:**

```json
{
  "name": "genotype",
  "dependencies": {
    "arktype": "^2.0.0-rc.8"
    // NO OTHER RUNTIME DEPENDENCIES
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0",
    "prettier": "^3.0.0"
    // Development tools only
  }
}
```

**CI will FAIL if unnecessary dependencies are added.**

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

# When Zig code is added, each file must be listed:
# !/src/zig/
# !/src/zig/build.zig
# !/src/zig/build.zig.zon
# !/src/zig/src/
# !/src/zig/src/main.zig
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

#### Code Review Anti-Patterns

**Reject code that:**

- Adds "just in case" functionality
- Introduces multiple ways to accomplish the same task
- Uses overly clever abstractions or meta-programming
- Lacks clear error boundaries and failure modes
- Adds convenience methods that obscure underlying operations
- Creates tight coupling between unrelated concerns

**Champion code that:**

- Solves one problem excellently
- Has obvious failure modes and error handling
- Can be understood by reading the implementation
- Composes well with existing functionality
- Has minimal external dependencies
- Follows established patterns in the codebase

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
     | { status: 'waiting'; buffer: '' }
     | { status: 'reading_header'; buffer: string; headerStart: number }
     | {
         status: 'reading_sequence';
         buffer: string;
         currentSequence: Partial<FastaSequence>;
       }
     | { status: 'complete'; result: FastaSequence };

   // Quality encoding detection with exhaustive matching
   type QualityEncoding =
     | { type: 'phred33'; minScore: 0; maxScore: 93; asciiOffset: 33 }
     | { type: 'phred64'; minScore: 0; maxScore: 93; asciiOffset: 64 }
     | { type: 'solexa'; minScore: -5; maxScore: 62; asciiOffset: 64 };
   ```

3. **Const Assertions for Exhaustive Validation**

   ```typescript
   // Bioinformatics constants with compile-time verification
   const NUCLEOTIDES = ['A', 'T', 'C', 'G'] as const;
   const IUPAC_CODES = ['R', 'Y', 'S', 'W', 'K', 'M', 'B', 'D', 'H', 'V', 'N'] as const;
   const AMINO_ACIDS = [
     'A',
     'C',
     'D',
     'E',
     'F',
     'G',
     'H',
     'I',
     'K',
     'L',
     'M',
     'N',
     'P',
     'Q',
     'R',
     'S',
     'T',
     'V',
     'W',
     'Y',
   ] as const;

   type Nucleotide = (typeof NUCLEOTIDES)[number];
   type IUPACCode = (typeof IUPAC_CODES)[number];
   type AminoAcid = (typeof AMINO_ACIDS)[number];

   // Exhaustive switch statements with compile-time coverage
   function validateNucleotide(char: string): char is Nucleotide {
     switch (char as Nucleotide) {
       case 'A':
       case 'T':
       case 'C':
       case 'G':
         return true;
       default:
         return false;
     }
   }
   ```

4. **Template Literal Types for Format Validation**

   ```typescript
   // Chromosome names with compile-time format checking
   type ChromosomeName = `chr${number}` | `chr${'X' | 'Y' | 'M'}`;
   type StrandOrientation = '+' | '-' | '.';

   // BED coordinate validation at type level
   type BedCoordinate<T extends number> = T extends 0 ? never : T;
   type ValidBedInterval = {
     chromosome: ChromosomeName;
     start: BedCoordinate<number>;
     end: BedCoordinate<number>;
   } & (start extends infer S
     ? end extends infer E
       ? S extends number
         ? E extends number
           ? E extends 0
             ? never
             : S extends 0
               ? never
               : E extends S
                 ? never
                 : {}
           : never
         : never
       : never
     : never);
   ```

5. **Conditional Types for Input Validation**

   ```typescript
   // Only allow valid parser configurations
   type ParserOptions<T extends 'fasta' | 'fastq' | 'bed'> = {
     skipValidation?: boolean;
     maxLineLength?: number;
   } & (T extends 'fastq'
     ? {
         qualityEncoding: 'phred33' | 'phred64' | 'solexa';
         parseQualityScores: boolean;
       }
     : {}) &
     (T extends 'bed'
       ? {
           allowZeroBasedCoordinates: boolean;
         }
       : {});

   // Prevent invalid sequence-quality combinations
   type SequenceWithQuality<S, Q> = S extends string
     ? Q extends string
       ? S['length'] extends Q['length']
         ? { sequence: S; quality: Q }
         : never
       : never
     : never;
   ```

#### Tooling-Based Constraints

1. **ESLint Rules for Genomics Domain**

   ```javascript
   // Custom ESLint rules in .eslintrc.js
   rules: {
     // Prevent direct number arithmetic on coordinates
     '@genomics/no-coordinate-arithmetic': 'error',
     // Require branded types for domain objects
     '@genomics/require-branded-types': 'error',
     // Prevent string concatenation on sequences
     '@genomics/no-sequence-concat': 'error',
     // Require exhaustive switch statements
     '@typescript-eslint/switch-exhaustiveness-check': 'error',
   }
   ```

2. **TypeScript Compiler Strictness**

   ```json
   // tsconfig.json with maximum strictness
   {
     "compilerOptions": {
       "strict": true,
       "exactOptionalPropertyTypes": true,
       "noImplicitReturns": true,
       "noFallthroughCasesInSwitch": true,
       "noUncheckedIndexedAccess": true,
       "noImplicitOverride": true,
       "allowUnreachableCode": false,
       "allowUnusedLabels": false
     }
   }
   ```

3. **Pre-commit Hooks for Safety**
   ```bash
   # .pre-commit-config.yaml
   repos:
     - repo: local
       hooks:
         - id: type-coverage
           name: TypeScript Type Coverage
           entry: npx type-coverage --at-least 100
           language: system
         - id: no-any-types
           name: Prevent any types
           entry: npx tsc --noEmit --strict && grep -r "any\|unknown" src/ && exit 1 || exit 0
           language: system
   ```

#### Runtime-to-Compile-Time Bridges

1. **ArkType Integration with TypeScript**

   ```typescript
   // Generate TypeScript types from ArkType schemas
   import { Type, type } from 'arktype';

   const FastaSequenceSchema = type({
     format: '"fasta"',
     id: 'string',
     sequence: /^[ACGTURYSWKMBDHVN\-\.\*]+$/i,
     length: 'number>0',
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
       seq: T
     ): T extends `${string}${Exclude<string, 'ACGTURYSWKMBDHVN-.*'>}${string}`
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
     end: U
   ): asserts start is T & { __lessThan: U } {
     if (start >= end) {
       throw new Error(`Invalid coordinate order: start=${start} >= end=${end}`);
     }
   }
   ```

#### Build-Time Verification

1. **Generated Type Tests**

   ```typescript
   // Auto-generated compile-time tests
   import { expectError, expectType } from 'tsd';

   // These tests run during build and fail compilation if types are wrong
   expectType<DNASequence>('ATCG' as DNASequence);
   expectError<DNASequence>('ATCGX' as any); // Should fail compilation

   expectType<ValidBedInterval>({ chromosome: 'chr1', start: 100, end: 200 });
   expectError<ValidBedInterval>({ chromosome: 'chr1', start: 200, end: 100 }); // Invalid order
   ```

2. **Static Analysis Integration**

   ```typescript
   // Custom TypeScript transformer for additional checks
   import ts from 'typescript';

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

### Cross-Platform Compatibility

- **Node.js** ≥18.0.0
- **Deno** latest
- **Bun** latest

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
  readonly format: 'fasta';
}

// FASTQ sequence with quality scores
interface FastqSequence extends Sequence {
  readonly format: 'fastq';
  readonly quality: string;
  readonly qualityEncoding: 'phred33' | 'phred64';
}

// BED interval
interface BedInterval {
  readonly chromosome: string;
  readonly start: number;
  readonly end: number;
  readonly name?: string;
  readonly score?: number;
  readonly strand?: '+' | '-' | '.';
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
for await (const sequence of fastaParser.parseFile('genome.fasta')) {
  console.log(`${sequence.id}: ${sequence.length} bp`);
}

const fastqParser = new FastqParser();
for await (const read of fastqParser.parseFile('reads.fastq.gz')) {
  console.log(`${read.id}: Q${read.quality}`);
}
```

### Validation System

All parsers use Arktype for runtime validation:

```typescript
import { type } from 'arktype';

// Validation schemas
const FastaSequenceSchema = type({
  id: 'string',
  description: 'string?',
  sequence: /^[ACGTN]*$/i,
  length: 'number',
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
await parser.parseFile('sequences.fasta.gz'); // Gzip
await parser.parseFile('sequences.fasta.zst'); // Zstandard
await parser.parseFile('sequences.fasta'); // Uncompressed

// Explicit compression
import { GzipDecompressor, ZstdDecompressor } from './compression';
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

Performance-critical operations will be implemented in Zig:

1. **String processing** - sequence parsing and validation
2. **Compression/decompression** - especially for large files
3. **Binary parsing** - BAM file parsing
4. **Quality score conversion** - FASTQ quality encoding

### Zig Implementation Philosophy

**One implementation per feature.** We do NOT maintain parallel TypeScript and
Zig implementations. Each feature has exactly one implementation, choosing Zig
where it provides clear performance benefits.

Reference: [OpenTUI](https://github.com/sst/opentui) demonstrates elegant
TypeScript/Zig integration patterns.

#### When to Use Zig

Use Zig for operations that benefit from:

1. **SIMD acceleration** - Parallel sequence processing, quality score
   conversion
2. **Multi-core parallelism** - Large file processing, batch operations
3. **Memory-intensive operations** - Binary parsing (BAM), compression
4. **Tight loops** - Character validation, sequence cleaning
5. **Bit manipulation** - SAM flags, binary formats

#### When to Keep TypeScript

Keep TypeScript for:

1. **I/O operations** - File reading, streaming
2. **High-level orchestration** - API surface, error handling
3. **Complex business logic** - Format detection, validation rules
4. **Integration points** - User-facing APIs

### Native Module Structure

```
src/zig/
├── src/
│   ├── main.zig         # Main entry point
│   ├── fasta.zig        # FASTA parsing primitives
│   ├── fastq.zig        # FASTQ parsing primitives
│   ├── compression.zig  # Compression utilities
│   ├── validation.zig   # Validation primitives
│   └── simd.zig         # SIMD optimizations
├── tests/
│   ├── fasta_test.zig
│   ├── fastq_test.zig
│   └── simd_test.zig
├── build.zig            # Zig build configuration
└── build.zig.zon       # Zig package dependencies
```

## Error Handling

Explicit error types for different failure modes:

```typescript
export class GenotypeError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'GenotypeError';
  }
}

export class ValidationError extends GenotypeError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
  }
}

export class ParseError extends GenotypeError {
  constructor(
    message: string,
    public readonly line?: number
  ) {
    super(message, 'PARSE_ERROR');
  }
}

export class CompressionError extends GenotypeError {
  constructor(message: string) {
    super(message, 'COMPRESSION_ERROR');
  }
}
```

## Testing Strategy

### Testing Philosophy

**Test everything that can break.** Our testing approach prioritizes:

1. **Correctness** - Validate all edge cases in genomic data formats
2. **Performance** - Ensure no performance regressions
3. **Memory Safety** - Detect leaks and excessive allocations
4. **Cross-Platform** - Verify behavior across Node.js, Deno, and Bun
5. **Real-World Data** - Test with actual genomic datasets, not just synthetic
   data

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
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { FastaParser } from '../src/formats/fasta';
import { ParseError, SequenceError } from '../src/errors';

describe('FastaParser', () => {
  let parser: FastaParser;

  beforeEach(() => {
    parser = new FastaParser();
  });

  describe('valid sequences', () => {
    test('parses single-line FASTA sequence', async () => {
      const input = '>seq1 description\nATCGATCG';
      const sequences = [];

      for await (const seq of parser.parseString(input)) {
        sequences.push(seq);
      }

      expect(sequences).toHaveLength(1);
      expect(sequences[0]).toEqual({
        format: 'fasta',
        id: 'seq1',
        description: 'description',
        sequence: 'ATCGATCG',
        length: 8,
        lineNumber: 1,
      });
    });

    test('handles wrapped sequences', async () => {
      const input = '>seq1\nATCG\nATCG\nATCG';
      const [seq] = await Array.fromAsync(parser.parseString(input));

      expect(seq.sequence).toBe('ATCGATCGATCG');
      expect(seq.length).toBe(12);
    });
  });

  describe('error handling', () => {
    test('throws ParseError for missing header', async () => {
      const input = 'ATCGATCG'; // No header

      await expect(async () => {
        for await (const _ of parser.parseString(input)) {
          // Should throw before yielding
        }
      }).toThrow(ParseError);
    });

    test('throws SequenceError for invalid nucleotides', async () => {
      const input = '>seq1\nATCGXYZ'; // Invalid chars

      await expect(async () => {
        for await (const _ of parser.parseString(input)) {
          // Should throw on validation
        }
      }).toThrow(SequenceError);
    });
  });

  describe('edge cases', () => {
    test('handles empty file', async () => {
      const sequences = await Array.fromAsync(parser.parseString(''));
      expect(sequences).toHaveLength(0);
    });

    test('handles sequences with IUPAC codes', async () => {
      const input = '>seq1\nATCGRYSWKMBDHVN';
      const [seq] = await Array.fromAsync(parser.parseString(input));

      expect(seq.sequence).toBe('ATCGRYSWKMBDHVN');
    });

    test('preserves case sensitivity when configured', async () => {
      const parser = new FastaParser({ preserveCase: true });
      const input = '>seq1\natcgATCG';
      const [seq] = await Array.fromAsync(parser.parseString(input));

      expect(seq.sequence).toBe('atcgATCG');
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
import { bench, group } from 'bun:test';

group('FASTA parsing performance', () => {
  bench('small file (1MB)', async () => {
    await parser.parseFile('fixtures/1mb.fasta');
  });

  bench('large file (100MB)', async () => {
    await parser.parseFile('fixtures/100mb.fasta');
  });

  bench('streaming vs buffered', async () => {
    // Compare performance of different approaches
  });
});
```

#### Property-Based Tests

- Generate random valid/invalid inputs
- Test invariants hold for all inputs
- Discover edge cases automatically

```typescript
import { test } from 'bun:test';
import { type } from 'arktype';

test.prop([type('string').generate(), type('number.integer >= 0').generate()])(
  'parser handles any string input without crashing',
  async (input, lineLength) => {
    const parser = new FastaParser({ maxLineLength: lineLength });

    try {
      for await (const _ of parser.parseString(input)) {
        // Should either parse or throw appropriate error
      }
    } catch (error) {
      expect(error).toBeInstanceOf(GenotypeError);
    }
  }
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
import { mockFS } from './helpers/mock-fs';

beforeEach(() => {
  mockFS.setup({
    '/test/data.fasta': '>seq1\nATCG',
    '/test/empty.fasta': '',
  });
});

afterEach(() => {
  mockFS.restore();
});

// Mock streams for testing streaming parsers
import { MockReadableStream } from './helpers/mock-streams';

test('handles stream errors gracefully', async () => {
  const stream = new MockReadableStream([
    '>seq1\n',
    'ATCG',
    MockReadableStream.ERROR('Network error'),
  ]);

  await expect(async () => {
    for await (const _ of parser.parse(stream)) {
      // Should handle error
    }
  }).toThrow(StreamError);
});
```

### Test Coverage Requirements

- **Line Coverage**: Minimum 90%
- **Branch Coverage**: Minimum 85%
- **Function Coverage**: 100% for public APIs
- **Statement Coverage**: Minimum 90%

Generate coverage reports with:

```bash
bun test:coverage
```

### Continuous Integration

All tests must pass in CI before merging:

```yaml
# .github/workflows/test.yml
test:
  runs-on: ${{ matrix.os }}
  strategy:
    matrix:
      os: [ubuntu-latest, macos-latest, windows-latest]
      runtime: [bun, node, deno]
  steps:
    - uses: actions/checkout@v3
    - uses: oven-sh/setup-bun@v1
    - run: bun install
    - run: bun test
    - run: bun test:coverage
    - run: bun bench --threshold
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
   test('parses multi-line sequence', async () => {
     // Arrange
     const input = '>seq1\nATCG\nGCTA';
     const parser = new FastaParser();

     // Act
     const result = await Array.fromAsync(parser.parseString(input));

     // Assert
     expect(result[0].sequence).toBe('ATCGGCTA');
   });
   ```

3. **One Assertion Per Test**: Keep tests focused
4. **Test Public APIs**: Don't test implementation details
5. **Use Test Fixtures**: Share test data across tests
6. **Clean Up Resources**: Always clean up in afterEach
7. **Avoid Time Dependencies**: Mock dates/timers
8. **Test Error Messages**: Verify helpful error context

## Development Workflow

1. **Design** - Document API in AGENTS.md first
2. **Validate** - Use Arktype schemas for all data structures
3. **Implement** - TypeScript first, identify bottlenecks
4. **Optimize** - Move critical paths to Zig
5. **Test** - Comprehensive test coverage
6. **Document** - JSDoc for all public APIs

## Build/Test Commands

**All commands MUST be run with Bun:**

- `bun test` - Run all tests
- `bun test <file>` - Run specific test file (e.g.,
  `bun test test/formats/fasta.test.ts`)
- `bun test:watch` - Run tests in watch mode
- `bun test:coverage` - Run tests with coverage report
- `bun build` - Build TypeScript components
- `bun lint` - Run TypeScript type checking
- `bun bench` - Run performance benchmarks
- `cd src/zig && zig build` - Build Zig components (production)
- `cd src/zig && zig build -Doptimize=Debug` - Build Zig components (debug)
- `cd src/zig && zig build -Doptimize=ReleaseFast` - Build Zig components
  (optimized)
- `cd src/zig && zig build test` - Run Zig tests

## Code Style

### Runtime Requirements

- **Runtime**: Bun with TypeScript (NO exceptions - no npm, yarn, or pnpm)
- **Language**: TypeScript with strict mode enabled
- **Module System**: ES modules only

### Formatting Rules

- **Formatting**: Prettier with bioinformatics-optimized settings
  ```json
  {
    "semi": true,
    "singleQuote": true,
    "printWidth": 100,
    "tabWidth": 2,
    "trailingComma": "es5",
    "bracketSpacing": true,
    "arrowParens": "always"
  }
  ```

### Import Organization

Use explicit imports, grouped in this order:

1. Node.js built-ins
2. External dependencies
3. Internal modules
4. Type imports

```typescript
// Example proper import organization
import { readFile } from 'node:fs/promises';
import { type } from 'arktype';
import { FastaParser } from './formats/fasta';
import type { ParserOptions, Sequence } from './types';
```

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
  readonly format: 'fasta' | 'fastq';
  readonly validation: boolean;
  readonly maxSequenceLength?: number;
}

export function parseFile(path: string, config: ParserConfig): AsyncIterable<Sequence> {
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
    `Valid characters are: A, C, G, T, U, R, Y, S, W, K, M, B, D, H, V, N`
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
    throw new StreamError('Failed to read stream', 'read', bytesProcessed);
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
             return { success: false, error: 'Invalid sequence' };
           }
         } else {
           return { success: false, error: 'Empty sequence' };
         }
       } else {
         return { success: true, data: sequence };
       }
     } else {
       return { success: false, error: 'No sequence provided' };
     }
   }

   // ✅ GOOD: Early returns eliminate nesting
   function processSequence(sequence: string, options: Options): Result {
     if (!sequence) {
       return { success: false, error: 'No sequence provided' };
     }

     if (!options.validate) {
       return { success: true, data: sequence };
     }

     if (sequence.length === 0) {
       return { success: false, error: 'Empty sequence' };
     }

     if (!isValidSequence(sequence)) {
       return { success: false, error: 'Invalid sequence' };
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
       if (file.endsWith('.fasta')) {
         const content = readFile(file);
         const lines = content.split('\n');
         const sequences: Sequence[] = [];
         let currentSeq = '';
         let currentId = '';
         for (const line of lines) {
           if (line.startsWith('>')) {
             if (currentSeq && currentId) {
               sequences.push({ id: currentId, sequence: currentSeq });
             }
             currentId = line.slice(1);
             currentSeq = '';
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
     return file.endsWith('.fasta');
   }

   function parseFile(file: string): ParsedFile {
     const content = readFile(file);
     const sequences = parseSequences(content);
     return { filename: file, sequences };
   }

   function parseSequences(content: string): Sequence[] {
     const lines = content.split('\n');
     const sequences: Sequence[] = [];
     let currentSeq = '';
     let currentId = '';

     for (const line of lines) {
       if (line.startsWith('>')) {
         addSequenceIfValid(sequences, currentId, currentSeq);
         currentId = line.slice(1);
         currentSeq = '';
       } else {
         currentSeq += line.trim();
       }
     }

     addSequenceIfValid(sequences, currentId, currentSeq);
     return sequences;
   }

   function addSequenceIfValid(sequences: Sequence[], id: string, seq: string): void {
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
         if (!line.startsWith('#')) {
           if (line.includes('\t')) {
             const fields = line.split('\t');
             if (fields.length >= 3) {
               results.push({ fields, type: 'data' });
             } else {
               results.push({ fields, type: 'incomplete' });
             }
           } else {
             results.push({ fields: [line], type: 'single' });
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
       if (trimmed.startsWith('#')) continue;

       if (!line.includes('\t')) {
         results.push({ fields: [line], type: 'single' });
         continue;
       }

       const fields = line.split('\t');
       const type = fields.length >= 3 ? 'data' : 'incomplete';
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
     return { error: 'Invalid input' };
   }

   // ✅ GOOD: Inverted conditions with early returns
   function validateInput(input: Input): ValidationResult {
     if (!input.isValid) {
       return { error: 'Input is not valid' };
     }

     if (!input.data) {
       return { error: 'No data provided' };
     }

     if (input.data.length === 0) {
       return { error: 'Empty data' };
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
         values: record.values.filter((value) => value > 0).map((value) => value * 2),
       }))
       .filter((record) => record.values.length > 0);
   }
   ```

#### Anti-Patterns to Avoid

**Never do this:**

- Arrow functions with multiple levels of nesting
- Nested ternary operators beyond 1 level
- Callback pyramids (use async/await)
- Complex nested object destructuring
- Multiple levels of optional chaining (`obj?.a?.b?.c?.d`)

#### Enforcement

**Code review must reject:**

- Functions with more than 3 levels of nesting
- Any callback pyramid patterns
- Complex nested ternary expressions
- Deeply nested object access patterns

**Tools for verification:**

- ESLint rules: `max-depth`, `complexity`, `max-nested-callbacks`
- Manual review for cognitive complexity
- Refactoring when cyclomatic complexity > 10

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
  return variants.filter(isValidVariant).map(processVariant).filter(hasAnnotation);
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

function hasAnnotation(variant: ProcessedVariant | null): variant is ProcessedVariant {
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

### Testing Standards

- Use Bun test framework exclusively
- Descriptive test names that explain the scenario
- Use `describe` blocks for logical grouping
- Implement `beforeEach`/`afterEach` for setup/cleanup
- Test edge cases and error conditions

```typescript
import { beforeEach, describe, expect, test } from 'bun:test';

describe('FastaParser', () => {
  let parser: FastaParser;

  beforeEach(() => {
    parser = new FastaParser();
  });

  test('parses valid FASTA sequence with standard nucleotides', async () => {
    const result = await parser.parseString('>seq1\nATCG');
    expect(result).toEqual({
      id: 'seq1',
      sequence: 'ATCG',
      length: 4,
      format: 'fasta',
    });
  });

  test('throws SequenceError for invalid nucleotides', async () => {
    expect(() => parser.parseString('>seq1\nATCX')).toThrow(SequenceError);
  });
});
```

## Build System

Cross-platform build system supporting multiple runtimes:

```json
{
  "scripts": {
    "build": "tsc && node scripts/build.js",
    "build:zig": "zig build -Doptimize=ReleaseFast",
    "test": "bun test",
    "test:node": "node --test",
    "test:deno": "deno test",
    "test:all": "npm run test && npm run test:node && npm run test:deno"
  }
}
```

## Future Enhancements

- **GPU acceleration** - CUDA/OpenCL for parallel processing
- **WASM builds** - Browser compatibility
- **Additional formats** - VCF, GFF, GTF support
- **Cloud storage** - S3, GCS streaming support
- **Indexing** - Fast random access for large files

## TypeScript Advanced Type Safety Patterns

### Const Assertions and Immutability

Enforce immutability at the type level:

```typescript
// Enforce immutability at the type level
const NUCLEOTIDES = ['A', 'T', 'C', 'G'] as const;
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
  if (typeof seq !== 'string' || !/^[ACGTN]+$/i.test(seq)) {
    throw new SequenceError('Invalid DNA sequence');
  }
}

// Usage: after this call, TypeScript knows seq is DNASequence
assertValidSequence(input);
```

## TypeScript Performance Best Practices

### Compilation Performance Guidelines

1. **Avoid Complex Type Computations**
   - Limit conditional type depth (max 3 levels)
   - Prefer interfaces over type aliases for object types
   - Use `interface extends` instead of intersection types

2. **Monitor Type Instantiations**

   ```bash
   tsc --extendedDiagnostics
   ```

   - Keep type instantiations under 150,000
   - Split complex types into smaller, reusable pieces

3. **Optimize Import Patterns**
   - Use specific imports: `import { FastaParser } from './formats/fasta'`
   - Avoid circular dependencies
   - Enable `"skipLibCheck": true` for faster builds

## Bun Runtime Optimizations

### File I/O Best Practices

- Leverage Bun's 3x faster file operations
- Use `Bun.file()` API for optimal performance
- Pre-allocate buffers for known file sizes

### Native SQLite Integration

- Use for genomic metadata storage
- Enable WAL mode for concurrent reads
- Implement prepared statements for query optimization

```typescript
import { Database } from 'bun:sqlite';

const db = new Database('genomics.sqlite');
db.exec('PRAGMA journal_mode = WAL;');

// Prepared statement for performance
const query = db.query('SELECT * FROM sequences WHERE id = ?');
```

### Testing Strategy

- Use `bun:test` for 80% faster test execution
- Leverage built-in snapshot testing
- Implement parallel test execution

## Zig Performance Module Guidelines

### Memory Management Patterns

```zig
// Allocator hierarchy for genomic data
const SequenceAllocator = struct {
    arena: std.heap.ArenaAllocator,
    pool: ObjectPool(Sequence),

    pub fn init(base: Allocator) SequenceAllocator {
        return .{
            .arena = std.heap.ArenaAllocator.init(base),
            .pool = ObjectPool(Sequence).init(base, 1024),
        };
    }
};
```

### SIMD Optimization Requirements

- Implement vectorized sequence comparison
- Use compile-time vector size selection
- Provide fallback for non-SIMD architectures

### Error Handling Convention

```zig
const ParseError = error{
    InvalidHeader,
    CorruptedData,
    UnsupportedFormat,
    AllocationFailed,
};

// Always use error unions, never panic
fn parseHeader(data: []const u8) ParseError!Header {
    // Implementation
}
```

## ArkType Schema Design Principles

### Performance-First Schema Design

```typescript
// Prefer direct definitions over complex compositions
const FastqRecord = type({
  id: 'string > 0',
  sequence: SequenceSchema,
  quality: 'string',
  qualityEncoding: "'phred33' | 'phred64'",
});

// Avoid deep unions in hot paths
// Use discriminated unions for efficient runtime checks
```

### Custom Validation with Context

```typescript
const ValidatedSequence = type('string').narrow((seq, ctx) => {
  const invalidChars = seq.match(/[^ACGTURYSWKMBDHVN\-\.\*]/gi);
  if (invalidChars) {
    return ctx.reject({
      expected: 'valid IUPAC nucleotide codes',
      actual: `invalid characters: ${invalidChars.join(', ')}`,
    });
  }
  return true;
});
```

### Compile-Time Type Extraction

```typescript
// Extract validated types for use throughout codebase
type ValidatedFasta = typeof FastaSequenceSchema.infer;
```

## Cross-Runtime Design Patterns

### Runtime Detection and Optimization

```typescript
const runtime = detectRuntime();
const fileReader =
  runtime === 'bun'
    ? new BunFileReader() // Use Bun.file() API
    : runtime === 'deno'
      ? new DenoFileReader() // Use Deno.open()
      : new NodeFileReader(); // Use fs.createReadStream()
```

### Platform-Specific Performance Paths

- Bun: Native SQLite, faster file I/O
- Node.js: Worker threads for parallelism
- Deno: Native TypeScript execution

## Comprehensive Testing Requirements

### Property-Based Testing

```typescript
// Test with generated inputs covering edge cases
test.prop([type('string').generate()])('sequence parsing handles all inputs', (input) => {
  const result = parser.parse(input);
  expect(() => result).not.toThrow();
});
```

### Performance Benchmarking

```typescript
// Mandatory benchmarks for critical paths
bench(
  'FASTA parsing',
  () => {
    parser.parseString(largeFastaData);
  },
  {
    warmupIterations: 10,
    iterations: 100,
    // Fail if >10% slower than baseline
    threshold: { percent: 10 },
  }
);
```

### Memory Leak Detection

- Use `--expose-gc` flag in tests
- Monitor heap usage in streaming operations
- Implement resource cleanup validation

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

### Type Documentation

- Document branded types and their invariants
- Explain discriminated union variants
- Provide migration guides from other libraries

## Security Best Practices

### Input Validation

- Limit maximum sequence length to prevent DoS
- Validate file paths against directory traversal
- Sanitize metadata fields in genomic formats

### Resource Limits

```typescript
const LIMITS = {
  maxSequenceLength: 1_000_000_000, // 1GB
  maxFileSize: 10_737_418_240, // 10GB
  maxConcurrentParsers: 10,
  maxMemoryUsage: 0.8, // 80% of available
} as const;
```

## Code Quality Metrics

### Required Metrics

1. **Type Coverage**: Minimum 99% (enforced by CI)
2. **Test Coverage**: Minimum 90% with branch coverage
3. **Bundle Size**: Track and prevent regression
4. **Performance**: Automated benchmarks with regression detection
5. **Memory Usage**: Profile streaming operations

### Enforcement

```json
// package.json scripts
{
  "quality:types": "type-coverage --at-least 99",
  "quality:size": "size-limit",
  "quality:perf": "bun bench --threshold",
  "quality:memory": "node --expose-gc test:memory"
}
```
