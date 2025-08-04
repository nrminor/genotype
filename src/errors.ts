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
    this.name = 'GenotypeError';
  }

  /**
   * Create a user-friendly error message with context
   */
  override toString(): string {
    let msg = `${this.name}: ${this.message}`;
    if (this.lineNumber) {
      msg += ` (line ${this.lineNumber})`;
    }
    if (this.context) {
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
    super(message, 'VALIDATION_ERROR', lineNumber, context);
    this.name = 'ValidationError';
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
    super(message, 'PARSE_ERROR', lineNumber, context);
    this.name = 'ParseError';
  }
}

/**
 * Compression/decompression errors with detailed context
 */
export class CompressionError extends GenotypeError {
  constructor(
    message: string,
    public readonly format: 'gzip' | 'zstd' | 'none',
    public readonly operation: 'detect' | 'decompress' | 'stream' | 'validate' | 'compress',
    public readonly bytesProcessed?: number,
    context?: string
  ) {
    super(message, 'COMPRESSION_ERROR', undefined, context);
    this.name = 'CompressionError';
  }

  /**
   * Create compression error from system error
   */
  static fromSystemError(
    format: CompressionError['format'],
    operation: CompressionError['operation'],
    systemError: unknown,
    bytesProcessed?: number
  ): CompressionError {
    const errorMessage = systemError instanceof Error ? systemError.message : String(systemError);
    const suggestion = this.getSuggestionForCompressionError(format, errorMessage);

    return new CompressionError(
      `${operation} operation failed for ${format}: ${errorMessage}${suggestion ? `. ${suggestion}` : ''}`,
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
    format: CompressionError['format'],
    errorMessage: string
  ): string | undefined {
    const msg = errorMessage.toLowerCase();

    if (msg.includes('magic') || msg.includes('header')) {
      return `File may be corrupted or not actually ${format} compressed`;
    }
    if (msg.includes('truncated') || msg.includes('unexpected end')) {
      return 'File appears to be truncated or incomplete';
    }
    if (msg.includes('dictionary') && format === 'zstd') {
      return 'ZSTD dictionary may be missing or invalid';
    }
    if (msg.includes('crc') || msg.includes('checksum')) {
      return 'Data integrity check failed - file may be corrupted';
    }
    if (msg.includes('memory') || msg.includes('allocation')) {
      return 'Try reducing buffer size or processing file in smaller chunks';
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
    public readonly operation: 'read' | 'write' | 'stat' | 'open' | 'close' | 'seek',
    public readonly systemError?: unknown,
    context?: string
  ) {
    super(message, 'FILE_ERROR', undefined, context);
    this.name = 'FileError';
  }

  /**
   * Create file error with system error context
   */
  static fromSystemError(
    operation: FileError['operation'],
    filePath: string,
    systemError: unknown
  ): FileError {
    const errorMessage = systemError instanceof Error ? systemError.message : String(systemError);
    const suggestion = FileError.getSuggestionForSystemError(errorMessage);

    return new FileError(
      `${operation} operation failed: ${errorMessage}${suggestion ? `. ${suggestion}` : ''}`,
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

    if (msg.includes('enoent') || msg.includes('no such file')) {
      return 'Check that the file path is correct and the file exists';
    }
    if (msg.includes('eacces') || msg.includes('permission denied')) {
      return 'Check file permissions or run with appropriate privileges';
    }
    if (msg.includes('eisdir') || msg.includes('is a directory')) {
      return 'Path points to a directory, not a file';
    }
    if (msg.includes('emfile') || msg.includes('too many open files')) {
      return 'Close unused file handles or increase system limits';
    }
    if (msg.includes('enospc') || msg.includes('no space left')) {
      return 'Free up disk space or use a different location';
    }
    if (msg.includes('timeout') || msg.includes('etimedout')) {
      return 'Increase timeout or check network connectivity for remote files';
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
      if (this.systemError.stack) {
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
    super(message, 'MEMORY_ERROR');
    this.name = 'MemoryError';
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
    this.name = 'SequenceError';
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
    this.name = 'QualityError';
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
    super(message, 'BED', lineNumber, context);
    this.name = 'BedError';
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
    super(message, 'SAM', lineNumber, context);
    this.name = 'SamError';
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
    super(message, 'BAM', undefined, context);
    this.name = 'BamError';
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

  if (data && !contextStr) {
    contextStr = Object.entries(data)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
  }

  return new ErrorClass(message, 'CONTEXTUAL_ERROR', lineNumber, contextStr);
}

/**
 * Error recovery suggestions for common issues
 */
export const ERROR_SUGGESTIONS = {
  INVALID_FASTA_HEADER: 'FASTA headers must start with ">" followed by an identifier',
  INVALID_FASTQ_HEADER: 'FASTQ headers must start with "@" followed by an identifier',
  SEQUENCE_QUALITY_MISMATCH: 'Sequence and quality strings must have the same length',
  INVALID_NUCLEOTIDE: 'Use IUPAC nucleotide codes: A, C, G, T, U, R, Y, S, W, K, M, B, D, H, V, N',
  INVALID_BED_COORDINATES: 'BED coordinates must be non-negative integers with start < end',
  COMPRESSED_FILE_ERROR: 'Try installing appropriate compression libraries or check file integrity',
  MEMORY_EXCEEDED: 'Consider using streaming API or processing file in chunks',
  MALFORMED_LINE: 'Check for extra whitespace, special characters, or encoding issues',
} as const;

/**
 * Stream processing errors for I/O operations
 */
export class StreamError extends GenotypeError {
  constructor(
    message: string,
    public readonly streamType: 'read' | 'write' | 'transform',
    public readonly bytesProcessed?: number,
    context?: string
  ) {
    super(message, 'STREAM_ERROR', undefined, context);
    this.name = 'StreamError';
  }
}

/**
 * Buffer management errors for streaming operations
 */
export class BufferError extends GenotypeError {
  constructor(
    message: string,
    public readonly bufferSize: number,
    public readonly operation: 'allocate' | 'resize' | 'overflow' | 'underflow',
    context?: string
  ) {
    super(message, 'BUFFER_ERROR', undefined, context);
    this.name = 'BufferError';
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
    super(message, 'TIMEOUT_ERROR', undefined, context);
    this.name = 'TimeoutError';
  }
}

/**
 * Cross-platform compatibility errors
 */
export class CompatibilityError extends GenotypeError {
  constructor(
    message: string,
    public readonly runtime: 'node' | 'deno' | 'bun',
    public readonly feature: string,
    context?: string
  ) {
    super(message, 'COMPATIBILITY_ERROR', undefined, context);
    this.name = 'CompatibilityError';
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
    super(message, 'FORMAT_DETECTION_ERROR', undefined, context);
    this.name = 'FormatDetectionError';
  }
}

/**
 * Get helpful suggestion for common error patterns
 */
export function getErrorSuggestion(error: GenotypeError): string | undefined {
  const message = error.message.toLowerCase();

  if (message.includes('fasta') && message.includes('header')) {
    return ERROR_SUGGESTIONS.INVALID_FASTA_HEADER;
  }
  if (message.includes('fastq') && message.includes('header')) {
    return ERROR_SUGGESTIONS.INVALID_FASTQ_HEADER;
  }
  if (message.includes('quality') && message.includes('length')) {
    return ERROR_SUGGESTIONS.SEQUENCE_QUALITY_MISMATCH;
  }
  if (message.includes('nucleotide') || message.includes('sequence')) {
    return ERROR_SUGGESTIONS.INVALID_NUCLEOTIDE;
  }
  if (message.includes('bed') && message.includes('coordinate')) {
    return ERROR_SUGGESTIONS.INVALID_BED_COORDINATES;
  }
  if (message.includes('compression') || message.includes('gzip') || message.includes('zstd')) {
    return ERROR_SUGGESTIONS.COMPRESSED_FILE_ERROR;
  }
  if (message.includes('memory') || message.includes('allocation')) {
    return ERROR_SUGGESTIONS.MEMORY_EXCEEDED;
  }

  return ERROR_SUGGESTIONS.MALFORMED_LINE;
}
