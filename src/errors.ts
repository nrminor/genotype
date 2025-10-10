/**
 * Error handling for genomic data parsing
 *
 * Provides clear, actionable error messages for common bioinformatics
 * data quality issues and parsing failures.
 */

/**
 * Base error class for all genotype-related errors
 */
export class GenotypeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly lineNumber?: number,
    public readonly context?: string
  ) {
    super(message);
    this.name = "GenotypeError";
  }

  /**
   * Create a user-friendly error message with context
   */
  override toString(): string {
    let msg = `${this.name}: ${this.message}`;
    if (this.lineNumber !== undefined && this.lineNumber !== null) {
      msg += ` (line ${this.lineNumber})`;
    }
    if (this.context !== undefined && this.context !== null && this.context !== "") {
      msg += `\nContext: ${this.context}`;
    }
    return msg;
  }
}

/**
 * Validation errors for malformed or invalid data
 */
export class ValidationError extends GenotypeError {
  constructor(message: string, lineNumber?: number, context?: string) {
    super(message, "VALIDATION_ERROR", lineNumber, context);
    this.name = "ValidationError";
  }
}

/**
 * Parsing errors for format-specific issues
 */
export class ParseError extends GenotypeError {
  constructor(
    message: string,
    public readonly format: string,
    lineNumber?: number,
    context?: string
  ) {
    super(message, "PARSE_ERROR", lineNumber, context);
    this.name = "ParseError";
  }
}

/**
 * DSV-specific parsing error with column context
 */
export class DSVParseError extends ParseError {
  constructor(
    message: string,
    public readonly line?: number,
    public readonly column?: number,
    public readonly field?: string
  ) {
    const context = [
      line && `line ${line}`,
      column && `column ${column}`,
      field && `field "${field}"`,
    ]
      .filter(Boolean)
      .join(", ");

    super(context ? `${message} (${context})` : message, "DSV", line);
    this.name = "DSVParseError";
  }
}

/**
 * Compression/decompression errors with detailed context
 */
export class CompressionError extends GenotypeError {
  constructor(
    message: string,
    public readonly format: "gzip" | "zstd" | "none",
    public readonly operation: "detect" | "decompress" | "stream" | "validate" | "compress",
    public readonly bytesProcessed?: number,
    context?: string
  ) {
    super(message, "COMPRESSION_ERROR", undefined, context);
    this.name = "CompressionError";
  }

  /**
   * Create compression error from system error
   */
  static fromSystemError(
    format: CompressionError["format"],
    operation: CompressionError["operation"],
    systemError: unknown,
    bytesProcessed?: number
  ): CompressionError {
    const errorMessage = systemError instanceof Error ? systemError.message : String(systemError);
    const suggestion = CompressionError.getSuggestionForCompressionError(format, errorMessage);

    return new CompressionError(
      `${operation} operation failed for ${format}: ${errorMessage}${suggestion !== undefined && suggestion !== null && suggestion !== "" ? `. ${suggestion}` : ""}`,
      format,
      operation,
      bytesProcessed,
      `System error: ${errorMessage}`
    );
  }

  /**
   * Get helpful suggestion based on compression error
   */
  private static getSuggestionForCompressionError(
    format: CompressionError["format"],
    errorMessage: string
  ): string | undefined {
    const msg = errorMessage.toLowerCase();

    if (msg.includes("magic") || msg.includes("header")) {
      return `File may be corrupted or not actually ${format} compressed`;
    }
    if (msg.includes("truncated") || msg.includes("unexpected end")) {
      return "File appears to be truncated or incomplete";
    }
    if (msg.includes("dictionary") && format === "zstd") {
      return "ZSTD dictionary may be missing or invalid";
    }
    if (msg.includes("crc") || msg.includes("checksum")) {
      return "Data integrity check failed - file may be corrupted";
    }
    if (msg.includes("memory") || msg.includes("allocation")) {
      return "Try reducing buffer size or processing file in smaller chunks";
    }

    return `Try installing native compression libraries for better ${format} support`;
  }

  /**
   * Enhanced toString with compression context
   */
  override toString(): string {
    let msg = super.toString();

    if (this.bytesProcessed !== undefined) {
      msg += `\nBytes processed: ${this.bytesProcessed}`;
    }

    return msg;
  }
}

/**
 * File I/O errors with cross-platform support and detailed context
 * Provides comprehensive error information for troubleshooting I/O issues
 */
export class FileError extends GenotypeError {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly operation: "read" | "write" | "stat" | "open" | "close" | "seek",
    public readonly systemError?: unknown,
    context?: string
  ) {
    super(message, "FILE_ERROR", undefined, context);
    this.name = "FileError";
  }

  /**
   * Create file error with system error context
   */
  static fromSystemError(
    operation: FileError["operation"],
    filePath: string,
    systemError: unknown
  ): FileError {
    const errorMessage = systemError instanceof Error ? systemError.message : String(systemError);
    const suggestion = FileError.getSuggestionForSystemError(errorMessage);

    return new FileError(
      `${operation} operation failed: ${errorMessage}${suggestion !== undefined && suggestion !== null && suggestion !== "" ? `. ${suggestion}` : ""}`,
      filePath,
      operation,
      systemError,
      `System error: ${errorMessage}`
    );
  }

  /**
   * Get helpful suggestion based on system error
   */
  private static getSuggestionForSystemError(errorMessage: string): string | undefined {
    const msg = errorMessage.toLowerCase();

    if (msg.includes("enoent") || msg.includes("no such file")) {
      return "Check that the file path is correct and the file exists";
    }
    if (msg.includes("eacces") || msg.includes("permission denied")) {
      return "Check file permissions or run with appropriate privileges";
    }
    if (msg.includes("eisdir") || msg.includes("is a directory")) {
      return "Path points to a directory, not a file";
    }
    if (msg.includes("emfile") || msg.includes("too many open files")) {
      return "Close unused file handles or increase system limits";
    }
    if (msg.includes("enospc") || msg.includes("no space left")) {
      return "Free up disk space or use a different location";
    }
    if (msg.includes("timeout") || msg.includes("etimedout")) {
      return "Increase timeout or check network connectivity for remote files";
    }

    return undefined;
  }

  /**
   * Enhanced toString with system error details
   */
  override toString(): string {
    let msg = super.toString();

    if (this.systemError instanceof Error) {
      msg += `\nSystem Error: ${this.systemError.name}: ${this.systemError.message}`;
      if (
        this.systemError.stack !== undefined &&
        this.systemError.stack !== null &&
        this.systemError.stack !== ""
      ) {
        msg += `\nStack: ${this.systemError.stack}`;
      }
    }

    return msg;
  }
}

/**
 * Memory-related errors for large file handling
 */
export class MemoryError extends GenotypeError {
  constructor(
    message: string,
    public readonly suggestedAction?: string
  ) {
    super(message, "MEMORY_ERROR");
    this.name = "MemoryError";
  }
}

/**
 * Sequence-specific validation errors
 */
export class SequenceError extends ValidationError {
  constructor(
    message: string,
    public readonly sequenceId: string,
    lineNumber?: number,
    context?: string
  ) {
    super(`Sequence '${sequenceId}': ${message}`, lineNumber, context);
    this.name = "SequenceError";
  }
}

/**
 * Quality score-specific errors for FASTQ data
 */
export class QualityError extends ValidationError {
  constructor(
    message: string,
    public readonly sequenceId: string,
    public readonly qualityEncoding?: string,
    lineNumber?: number,
    context?: string
  ) {
    super(`Quality scores for '${sequenceId}': ${message}`, lineNumber, context);
    this.name = "QualityError";
  }
}

/**
 * BED format-specific errors
 */
export class BedError extends ParseError {
  constructor(
    message: string,
    public readonly chromosome?: string,
    public readonly start?: number,
    public readonly end?: number,
    lineNumber?: number,
    context?: string
  ) {
    super(message, "BED", lineNumber, context);
    this.name = "BedError";
  }
}

/**
 * SAM/BAM format-specific errors
 */
export class SamError extends ParseError {
  constructor(
    message: string,
    public readonly qname?: string,
    public readonly fieldName?: string,
    lineNumber?: number,
    context?: string
  ) {
    super(message, "SAM", lineNumber, context);
    this.name = "SamError";
  }
}

/**
 * BAM format-specific errors with binary context
 */
export class BamError extends ParseError {
  constructor(
    message: string,
    public readonly qname?: string,
    public readonly fieldName?: string,
    public readonly blockOffset?: number,
    context?: string
  ) {
    super(message, "BAM", undefined, context);
    this.name = "BamError";
  }

  /**
   * Create BAM error with BGZF block context
   */
  static withBlockContext(
    message: string,
    blockOffset: number,
    qname?: string,
    fieldName?: string
  ): BamError {
    return new BamError(
      `${message} (BGZF block at offset ${blockOffset})`,
      qname,
      fieldName,
      blockOffset,
      `BGZF block offset: ${blockOffset}`
    );
  }

  /**
   * Enhanced toString with BAM-specific context
   */
  override toString(): string {
    let msg = super.toString();

    if (this.blockOffset !== undefined) {
      msg += `\nBGZF Block Offset: ${this.blockOffset}`;
    }

    return msg;
  }
}

/**
 * Helper function to create context-aware error messages
 */
export function createContextualError(
  ErrorClass: typeof GenotypeError,
  message: string,
  options: {
    lineNumber?: number;
    context?: string;
    data?: Record<string, unknown>;
  } = {}
): GenotypeError {
  const { lineNumber, context, data } = options;
  let contextStr = context;

  if (data && (contextStr === undefined || contextStr === null || contextStr === "")) {
    contextStr = Object.entries(data)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
  }

  return new ErrorClass(message, "CONTEXTUAL_ERROR", lineNumber, contextStr);
}

/**
 * Error recovery suggestions for common issues
 */
export const ERROR_SUGGESTIONS = {
  INVALID_FASTA_HEADER: 'FASTA headers must start with ">" followed by an identifier',
  INVALID_FASTQ_HEADER: 'FASTQ headers must start with "@" followed by an identifier',
  SEQUENCE_QUALITY_MISMATCH: "Sequence and quality strings must have the same length",
  INVALID_NUCLEOTIDE: "Use IUPAC nucleotide codes: A, C, G, T, U, R, Y, S, W, K, M, B, D, H, V, N",
  INVALID_BED_COORDINATES: "BED coordinates must be non-negative integers with start < end",
  COMPRESSED_FILE_ERROR: "Try installing appropriate compression libraries or check file integrity",
  MEMORY_EXCEEDED: "Consider using streaming API or processing file in chunks",
  MALFORMED_LINE: "Check for extra whitespace, special characters, or encoding issues",
} as const;

/**
 * Stream processing errors for I/O operations
 */
export class StreamError extends GenotypeError {
  constructor(
    message: string,
    public readonly streamType: "read" | "write" | "transform",
    public readonly bytesProcessed?: number,
    context?: string
  ) {
    super(message, "STREAM_ERROR", undefined, context);
    this.name = "StreamError";
  }
}

/**
 * Buffer management errors for streaming operations
 */
export class BufferError extends GenotypeError {
  constructor(
    message: string,
    public readonly bufferSize: number,
    public readonly operation: "allocate" | "resize" | "overflow" | "underflow",
    context?: string
  ) {
    super(message, "BUFFER_ERROR", undefined, context);
    this.name = "BufferError";
  }
}

/**
 * Timeout errors for I/O operations
 */
export class TimeoutError extends GenotypeError {
  constructor(
    message: string,
    public readonly timeoutMs: number,
    public readonly operation: string,
    context?: string
  ) {
    super(message, "TIMEOUT_ERROR", undefined, context);
    this.name = "TimeoutError";
  }
}

/**
 * Cross-platform compatibility errors
 */
export class CompatibilityError extends GenotypeError {
  constructor(
    message: string,
    public readonly runtime: "node" | "deno" | "bun",
    public readonly feature: string,
    context?: string
  ) {
    super(message, "COMPATIBILITY_ERROR", undefined, context);
    this.name = "CompatibilityError";
  }
}

/**
 * File format detection errors
 */
export class FormatDetectionError extends GenotypeError {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly detectedFormats: string[],
    context?: string
  ) {
    super(message, "FORMAT_DETECTION_ERROR", undefined, context);
    this.name = "FormatDetectionError";
  }
}

/**
 * Pattern search operation errors
 */
export class GrepError extends GenotypeError {
  constructor(message: string, code: string = "GREP_ERROR", lineNumber?: number, context?: string) {
    super(message, code, lineNumber, context);
    this.name = "GrepError";
  }
}

/**
 * Motif location operation errors
 */
export class LocateError extends GenotypeError {
  constructor(
    message: string,
    code: string = "LOCATE_ERROR",
    lineNumber?: number,
    context?: string
  ) {
    super(message, code, lineNumber, context);
    this.name = "LocateError";
  }
}

/**
 * Concatenation operation errors
 */
export class SplitError extends GenotypeError {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly mode?: string,
    public readonly splitContext?: string
  ) {
    super(message, "SPLIT_ERROR");
    this.name = "SplitError";
  }
}

export class ConcatError extends GenotypeError {
  constructor(
    message: string,
    public readonly sourceContext?: string,
    public readonly idConflict?: string,
    lineNumber?: number,
    context?: string
  ) {
    super(message, "CONCAT_ERROR", lineNumber, context);
    this.name = "ConcatError";
  }

  /**
   * Create concat error with source file context
   */
  static withSourceContext(
    message: string,
    sourceFile: string,
    idConflict?: string,
    lineNumber?: number
  ): ConcatError {
    return new ConcatError(
      `${message} (source: ${sourceFile})`,
      sourceFile,
      idConflict,
      lineNumber,
      `Source file: ${sourceFile}`
    );
  }

  /**
   * Enhanced toString with concat-specific context
   */
  override toString(): string {
    let msg = super.toString();

    if (
      this.sourceContext !== undefined &&
      this.sourceContext !== null &&
      this.sourceContext !== ""
    ) {
      msg += `\nSource: ${this.sourceContext}`;
    }

    if (this.idConflict !== undefined && this.idConflict !== null && this.idConflict !== "") {
      msg += `\nConflicting ID: ${this.idConflict}`;
    }

    return msg;
  }
}

/**
 * CIGAR validation errors with detailed mismatch analysis
 */
export class CigarValidationError extends ValidationError {
  constructor(
    message: string,
    public readonly cigar: string,
    public readonly sequenceLength: number,
    public readonly consumedBases: number,
    public readonly mismatchPercentage: number,
    lineNumber?: number,
    context?: string
  ) {
    super(message, lineNumber, context);
    this.name = "CigarValidationError";
  }

  /**
   * Create CIGAR error with detailed analysis
   */
  static withMismatchAnalysis(
    cigar: string,
    sequenceLength: number,
    consumedBases: number,
    lineNumber?: number
  ): CigarValidationError {
    const mismatch = Math.abs(consumedBases - sequenceLength);
    const percentage = (mismatch / sequenceLength) * 100;

    return new CigarValidationError(
      `CIGAR/sequence length mismatch: CIGAR consumes ${consumedBases} bases, sequence has ${sequenceLength} bases (${percentage.toFixed(1)}% difference)`,
      cigar,
      sequenceLength,
      consumedBases,
      percentage,
      lineNumber,
      `CIGAR: ${cigar}, Expected: ${sequenceLength} bases, Actual: ${consumedBases} bases`
    );
  }

  /**
   * Enhanced toString with CIGAR analysis
   */
  override toString(): string {
    let msg = super.toString();
    msg += `\nCIGAR Analysis:`;
    msg += `\n  CIGAR String: ${this.cigar}`;
    msg += `\n  Sequence Length: ${this.sequenceLength} bases`;
    msg += `\n  CIGAR Consumption: ${this.consumedBases} bases`;
    msg += `\n  Mismatch: ${this.mismatchPercentage.toFixed(1)}%`;
    msg += `\nSuggestion: Check for corrupted SAM/BAM data or non-standard CIGAR operations`;
    return msg;
  }
}

/**
 * Genomic coordinate validation errors
 */
export class GenomicCoordinateError extends ValidationError {
  constructor(
    message: string,
    public readonly coordinate: number,
    public readonly maxExpected: number,
    public readonly coordinateType: "start" | "end" | "position",
    lineNumber?: number,
    context?: string
  ) {
    super(message, lineNumber, context);
    this.name = "GenomicCoordinateError";
  }

  /**
   * Create coordinate error for unusually large values
   */
  static forLargeCoordinate(
    coordinate: number,
    coordinateType: "start" | "end" | "position" = "position",
    lineNumber?: number
  ): GenomicCoordinateError {
    const maxExpected = 2_500_000_000;
    const sizeGB = Math.round((coordinate / 1_000_000_000) * 10) / 10; // One decimal place

    return new GenomicCoordinateError(
      `Genomic coordinate unusually large: ${coordinate} (${sizeGB}GB, exceeds supported limit of 2.5GB)`,
      coordinate,
      maxExpected,
      coordinateType,
      lineNumber,
      `Coordinate: ${coordinate}, Expected max: ~${maxExpected.toLocaleString()}`
    );
  }

  override toString(): string {
    let msg = super.toString();
    msg += `\nCoordinate Analysis:`;
    msg += `\n  Value: ${this.coordinate.toLocaleString()}`;
    msg += `\n  Type: ${this.coordinateType}`;
    msg += `\n  Expected Max: ~${this.maxExpected.toLocaleString()}`;
    msg += `\nSuggestion: Verify coordinate system (0-based vs 1-based) and data integrity`;
    return msg;
  }
}

/**
 * Chromosome naming validation errors
 */
export class ChromosomeNamingError extends ValidationError {
  constructor(
    message: string,
    public readonly chromosomeName: string,
    public readonly suggestedNames: string[],
    lineNumber?: number,
    context?: string
  ) {
    super(message, lineNumber, context);
    this.name = "ChromosomeNamingError";
  }

  /**
   * Create error for non-standard chromosome names
   */
  static forNonStandardName(chromosomeName: string, lineNumber?: number): ChromosomeNamingError {
    const suggestedNames = ["chr1", "chr2", "chrX", "chrY", "chrM"];

    return new ChromosomeNamingError(
      `Non-standard chromosome name: '${chromosomeName}'`,
      chromosomeName,
      suggestedNames,
      lineNumber,
      `Input: ${chromosomeName}`
    );
  }

  override toString(): string {
    let msg = super.toString();
    msg += `\nChromosome: ${this.chromosomeName}`;
    msg += `\nSuggested standard names: ${this.suggestedNames.join(", ")}`;
    msg += `\nNote: Non-standard names may cause compatibility issues with downstream tools`;
    return msg;
  }
}

/**
 * Security path access errors
 */
export class SecurityPathError extends GenotypeError {
  constructor(
    message: string,
    public readonly attemptedPath: string,
    public readonly securityRisk: "traversal" | "sensitive-directory" | "system-access",
    context?: string
  ) {
    super(message, "SECURITY_PATH_ERROR", undefined, context);
    this.name = "SecurityPathError";
  }

  /**
   * Create error for sensitive system path access
   */
  static forSensitiveDirectory(path: string): SecurityPathError {
    return new SecurityPathError(
      `Access denied: path accesses sensitive system directory`,
      path,
      "sensitive-directory",
      `Attempted path: ${path}`
    );
  }

  override toString(): string {
    let msg = super.toString();
    msg += `\nAttempted Path: ${this.attemptedPath}`;
    msg += `\nSecurity Risk: ${this.securityRisk}`;
    msg += `\nSuggestion: Use paths within your project directory or explicitly allowed locations`;
    return msg;
  }
}

/**
 * Resource limit validation errors
 */
export class ResourceLimitError extends ValidationError {
  constructor(
    message: string,
    public readonly resourceType: "buffer" | "file-size" | "timeout" | "memory",
    public readonly actualValue: number,
    public readonly maxAllowed: number,
    public readonly unit: "bytes" | "ms" | "count",
    context?: string
  ) {
    super(message, undefined, context);
    this.name = "ResourceLimitError";
  }

  /**
   * Create error for buffer size violations
   */
  static forBufferSize(actualSize: number, maxSize: number, operation: string): ResourceLimitError {
    const actualMB = Math.round(actualSize / 1_048_576);
    const maxMB = Math.round(maxSize / 1_048_576);

    return new ResourceLimitError(
      `${operation} buffer size too large: ${actualMB}MB (maximum ${maxMB}MB)`,
      "buffer",
      actualSize,
      maxSize,
      "bytes",
      `Operation: ${operation}, Actual: ${actualSize} bytes, Max: ${maxSize} bytes`
    );
  }

  /**
   * Create error for timeout violations
   */
  static forTimeout(
    actualTimeout: number,
    maxTimeout: number,
    operation: string
  ): ResourceLimitError {
    const actualMin = Math.round(actualTimeout / 60_000);
    const maxMin = Math.round(maxTimeout / 60_000);

    return new ResourceLimitError(
      `${operation} timeout too long: ${actualMin} minutes (maximum ${maxMin} minutes)`,
      "timeout",
      actualTimeout,
      maxTimeout,
      "ms",
      `Operation: ${operation}, Actual: ${actualTimeout}ms, Max: ${maxTimeout}ms`
    );
  }

  override toString(): string {
    let msg = super.toString();
    msg += `\nResource Limit Violation:`;
    msg += `\n  Type: ${this.resourceType}`;
    msg += `\n  Actual: ${this.actualValue.toLocaleString()} ${this.unit}`;
    msg += `\n  Maximum: ${this.maxAllowed.toLocaleString()} ${this.unit}`;
    msg += `\nSuggestion: Reduce the ${this.resourceType} value or process data in smaller chunks`;
    return msg;
  }
}

/**
 * BAI index validation errors
 */
export class BAIIndexError extends ValidationError {
  constructor(
    message: string,
    public readonly indexComponent: "chunk" | "bin" | "linear-index" | "version" | "interval-size",
    public readonly value: number | string,
    public readonly recommendation?: string,
    context?: string
  ) {
    super(message, undefined, context);
    this.name = "BAIIndexError";
  }

  /**
   * Create error for performance-impacting BAI conditions
   */
  static forPerformanceImpact(
    component: BAIIndexError["indexComponent"],
    value: number | string,
    threshold: number,
    unit: string
  ): BAIIndexError {
    return new BAIIndexError(
      `BAI ${component} may impact performance: ${value} ${unit} (threshold: ${threshold})`,
      component,
      value,
      `Consider regenerating BAI index with standard parameters for better performance`,
      `Component: ${component}, Value: ${value}, Threshold: ${threshold} ${unit}`
    );
  }

  override toString(): string {
    let msg = super.toString();
    msg += `\nBAI Index Issue:`;
    msg += `\n  Component: ${this.indexComponent}`;
    msg += `\n  Value: ${this.value}`;
    if (this.recommendation) {
      msg += `\n  Recommendation: ${this.recommendation}`;
    }
    return msg;
  }
}

/**
 * Paired-end FASTQ synchronization errors
 *
 * Thrown when read IDs don't match between R1 and R2 files, or when
 * files have different lengths. Provides detailed context for debugging
 * paired-end data issues.
 */
export class PairSyncError extends ParseError {
  /**
   * Create a new paired-end synchronization error
   *
   * @param message - Detailed error message
   * @param pairIndex - Index of the pair where sync failed (0-based)
   * @param failedFile - Which file(s) failed: 'r1', 'r2', or 'both'
   *
   * @example
   * ```typescript
   * try {
   *   for await (const pair of parser.parseFiles('R1.fq', 'R2.fq')) {
   *     // Process pairs
   *   }
   * } catch (error) {
   *   if (error instanceof PairSyncError) {
   *     console.error(`Sync error at pair ${error.pairIndex}`);
   *     console.error(`Failed file: ${error.failedFile}`);
   *     console.error(error.message);
   *   }
   * }
   * ```
   */
  constructor(
    message: string,
    public readonly pairIndex: number,
    public readonly failedFile: "r1" | "r2" | "both",
  ) {
    super(message, "FASTQ-Paired", pairIndex);
    this.name = "PairSyncError";
  }

  /**
   * Create error for read ID mismatch
   */
  static forIdMismatch(
    r1Id: string,
    r2Id: string,
    pairIndex: number,
    baseR1?: string,
    baseR2?: string,
  ): PairSyncError {
    const baseIds = baseR1 && baseR2 
      ? ` (base IDs: "${baseR1}" vs "${baseR2}")`
      : '';
    
    return new PairSyncError(
      `Read ID mismatch at pair ${pairIndex}: R1="${r1Id}" vs R2="${r2Id}"${baseIds}`,
      pairIndex,
      "both",
    );
  }

  /**
   * Create error for file length mismatch
   */
  static forLengthMismatch(
    pairIndex: number,
    exhaustedFile: "r1" | "r2",
  ): PairSyncError {
    const otherFile = exhaustedFile === "r1" ? "R2" : "R1";
    
    return new PairSyncError(
      `Paired FASTQ files have different lengths: ${exhaustedFile === "r1" ? "R1" : "R2"} exhausted first at pair ${pairIndex}. ${otherFile} file has more reads.`,
      pairIndex,
      exhaustedFile,
    );
  }

  /**
   * Create error for unpaired read in strict mode
   */
  static forUnpairedRead(readId: string): PairSyncError {
    return new PairSyncError(
      `Unpaired read found: "${readId}". No matching pair in opposite stream.`,
      -1, // No pair index for unpaired reads
      "both",
    );
  }

  override toString(): string {
    let msg = super.toString();
    msg += `\nPair Index: ${this.pairIndex}`;
    msg += `\nFailed File(s): ${this.failedFile === "both" ? "R1 and R2" : this.failedFile.toUpperCase()}`;
    msg += `\nSuggestion: Check that R1 and R2 files are from the same sequencing run and properly synchronized`;
    return msg;
  }
}

/**
 * Get helpful suggestion for common error patterns
 */
export function getErrorSuggestion(error: GenotypeError): string | undefined {
  const message = error.message.toLowerCase();

  if (message.includes("fasta") && message.includes("header")) {
    return ERROR_SUGGESTIONS.INVALID_FASTA_HEADER;
  }
  if (message.includes("fastq") && message.includes("header")) {
    return ERROR_SUGGESTIONS.INVALID_FASTQ_HEADER;
  }
  if (message.includes("quality") && message.includes("length")) {
    return ERROR_SUGGESTIONS.SEQUENCE_QUALITY_MISMATCH;
  }
  if (message.includes("nucleotide") || message.includes("sequence")) {
    return ERROR_SUGGESTIONS.INVALID_NUCLEOTIDE;
  }
  if (message.includes("bed") && message.includes("coordinate")) {
    return ERROR_SUGGESTIONS.INVALID_BED_COORDINATES;
  }
  if (message.includes("compression") || message.includes("gzip") || message.includes("zstd")) {
    return ERROR_SUGGESTIONS.COMPRESSED_FILE_ERROR;
  }
  if (message.includes("memory") || message.includes("allocation")) {
    return ERROR_SUGGESTIONS.MEMORY_EXCEEDED;
  }

  return ERROR_SUGGESTIONS.MALFORMED_LINE;
}
