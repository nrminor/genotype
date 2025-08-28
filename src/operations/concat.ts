/**
 * ConcatProcessor - Concatenate sequences from multiple sources
 *
 * This processor implements high-performance concatenation of sequences from
 * multiple file paths and AsyncIterables with comprehensive ID conflict
 * resolution and memory-efficient streaming processing.
 *
 * @version v0.1.0
 * @since v0.1.0
 */

import { ConcatError, FileError } from '../errors';
import { detectFormat, parseAny } from '../index';
import { FileReader } from '../io/file-reader';
import type {
  AbstractSequence,
  BedInterval,
  FastaSequence,
  FastqSequence,
  FormatDetection,
} from '../types';
import type { ConcatOptions, Processor } from './types';

/**
 * Result of source validation for concatenation
 */
interface SourceValidation {
  readonly source: string | AsyncIterable<AbstractSequence>;
  readonly label: string;
  readonly format: FormatDetection | undefined;
  readonly isFile: boolean;
}

/**
 * Context for tracking concatenation state
 */
interface ConcatContext {
  readonly seenIds: Set<string>;
  readonly sourceIndex: number;
  readonly sourceLabel: string;
  readonly totalProcessed: number;
}

/**
 * Processor for concatenating sequences from multiple sources
 *
 * Supports both file paths and AsyncIterables with sophisticated ID conflict
 * resolution strategies. Maintains streaming behavior for memory efficiency.
 *
 * @example
 * ```typescript
 * const processor = new ConcatProcessor();
 * const concatenated = processor.process(baseSource, {
 *   sources: ['file1.fasta', 'file2.fasta', asyncIterable],
 *   idConflictResolution: 'suffix',
 *   validateFormats: true
 * });
 * ```
 */
export class ConcatProcessor implements Processor<ConcatOptions> {
  /**
   * Process sequences with concatenation from multiple sources
   *
   * @param source - Base input sequences (will be processed first)
   * @param options - Concatenation options
   * @yields Concatenated sequences from all sources
   */
  async *process(
    source: AsyncIterable<AbstractSequence>,
    options: ConcatOptions
  ): AsyncIterable<AbstractSequence> {
    // Validate and normalize options
    const normalizedOptions = this.normalizeOptions(options);
    const validatedSources = await this.validateSources(normalizedOptions);

    // Initialize context for ID tracking
    let context: ConcatContext = {
      seenIds: new Set<string>(),
      sourceIndex: -1,
      sourceLabel: 'base',
      totalProcessed: 0,
    };

    // Process base source first
    yield* this.processSource(source, context, normalizedOptions);

    // Process additional sources in order
    for (let i = 0; i < validatedSources.length; i++) {
      const validation = validatedSources[i]!;
      context = {
        ...context,
        sourceIndex: i,
        sourceLabel: validation.label,
      };

      const sourceIterable = validation.isFile
        ? await this.loadFileSource(validation.source as string, validation.format)
        : (validation.source as AsyncIterable<AbstractSequence>);

      yield* this.processSource(sourceIterable, context, normalizedOptions);
    }

    // Report final progress
    if (normalizedOptions.onProgress !== undefined) {
      normalizedOptions.onProgress(context.totalProcessed, context.totalProcessed);
    }
  }

  /**
   * Normalize and validate concatenation options
   */
  private normalizeOptions(options: ConcatOptions): Required<ConcatOptions> {
    if (options.sources === undefined || options.sources.length === 0) {
      throw new ConcatError('At least one source must be specified');
    }

    return {
      sources: options.sources,
      idConflictResolution: options.idConflictResolution ?? 'error',
      renameSuffix: options.renameSuffix ?? '_src',
      validateFormats: options.validateFormats ?? true,
      preserveOrder: options.preserveOrder ?? true,
      skipEmpty: options.skipEmpty ?? false,
      sourceLabels: options.sourceLabels ?? [],
      maxMemory: options.maxMemory ?? 104_857_600, // 100MB default
      onProgress: options.onProgress ?? (() => {}),
    };
  }

  /**
   * Validate all sources and prepare for processing
   */
  private async validateSources(options: Required<ConcatOptions>): Promise<SourceValidation[]> {
    const validations: SourceValidation[] = [];

    for (let i = 0; i < options.sources.length; i++) {
      const source = options.sources[i]!;
      const validation = await this.validateSource(source, i, options);
      validations.push(validation);
    }

    // Validate format compatibility if requested
    if (options.validateFormats) {
      this.validateFormatCompatibility(validations);
    }

    return validations;
  }

  /**
   * Validate a single source
   */
  private async validateSource(
    source: string | AsyncIterable<AbstractSequence>,
    index: number,
    options: Required<ConcatOptions>
  ): Promise<SourceValidation> {
    const label = options.sourceLabels[index] ?? `source_${index}`;

    if (typeof source === 'string') {
      // File path source
      try {
        // Check if file exists and get metadata
        if (!(await FileReader.exists(source))) {
          throw new ConcatError(`Cannot access source file: File does not exist`, source);
        }

        const metadata = await FileReader.getMetadata(source);

        // Check if file is readable
        if (!metadata.readable) {
          throw new ConcatError(`Cannot access source file: File is not readable`, source);
        }

        // Detect format for validation
        let format: FormatDetection | undefined;
        if (options.validateFormats) {
          const sampleContent = await this.readSampleContent(source);
          format = detectFormat(sampleContent);

          if (format.format === 'unknown') {
            throw new ConcatError(`Cannot detect format of source file`, source);
          }
        }

        return {
          source,
          label,
          format,
          isFile: true,
        };
      } catch (error) {
        throw ConcatError.withSourceContext(
          `Failed to validate source file: ${error instanceof Error ? error.message : String(error)}`,
          source
        );
      }
    } else {
      // AsyncIterable source
      return {
        source,
        label,
        format: undefined,
        isFile: false,
      };
    }
  }

  /**
   * Read sample content from file for format detection
   */
  private async readSampleContent(filePath: string): Promise<string> {
    try {
      // Read first 8KB for format detection
      const content = await FileReader.readToString(filePath, {
        encoding: 'utf8',
        maxFileSize: 8192,
      });
      return content;
    } catch (error) {
      throw new FileError(
        `Failed to read sample from file: ${error instanceof Error ? error.message : String(error)}`,
        filePath,
        'read'
      );
    }
  }

  /**
   * Validate format compatibility across sources
   */
  private validateFormatCompatibility(validations: SourceValidation[]): void {
    const detectedFormats = validations
      .map((v) => v.format?.format)
      .filter(
        (format): format is 'fasta' | 'fastq' | 'bed' | 'sam' | 'bam' =>
          format !== undefined && format !== 'unknown'
      );

    if (detectedFormats.length === 0) {
      return; // No formats detected, skip validation
    }

    const uniqueFormats = [...new Set(detectedFormats)];
    if (uniqueFormats.length > 1) {
      throw new ConcatError(
        `Incompatible formats detected: ${uniqueFormats.join(', ')}. All sources must have the same format.`
      );
    }
  }

  /**
   * Load sequences from a file source
   */
  private async loadFileSource(
    filePath: string,
    _format?: FormatDetection
  ): Promise<AsyncIterable<AbstractSequence>> {
    try {
      const content = await FileReader.readToString(filePath);

      // Use parseAny to handle different formats
      // Parse any format and filter to sequences only
      const parsed = parseAny(content);
      return this.filterSequencesOnly(parsed);
    } catch (error) {
      throw ConcatError.withSourceContext(
        `Failed to load sequences from file: ${error instanceof Error ? error.message : String(error)}`,
        filePath
      );
    }
  }

  /**
   * Filter to only yield sequences, skip non-sequence items like BED intervals
   */
  private async *filterSequencesOnly(
    source: AsyncIterable<FastaSequence | FastqSequence | BedInterval>
  ): AsyncIterable<AbstractSequence> {
    for await (const item of source) {
      // Check if item has sequence properties
      if (
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        'sequence' in item &&
        'length' in item &&
        typeof item.id === 'string' &&
        typeof item.sequence === 'string' &&
        typeof item.length === 'number'
      ) {
        yield item as AbstractSequence;
      }
    }
  }

  /**
   * Process sequences from a single source with ID conflict resolution
   */
  private async *processSource(
    source: AsyncIterable<AbstractSequence>,
    context: ConcatContext,
    options: Required<ConcatOptions>
  ): AsyncIterable<AbstractSequence> {
    try {
      for await (const sequence of source) {
        // Skip empty sequences if requested
        if (options.skipEmpty && sequence.length === 0) {
          continue;
        }

        // Handle ID conflicts
        const processedSequence = this.resolveIdConflict(sequence, context, options);

        if (processedSequence !== null) {
          yield processedSequence;

          // Update context
          context = {
            ...context,
            totalProcessed: context.totalProcessed + 1,
          };

          // Report progress
          if (options.onProgress !== undefined && context.totalProcessed % 1000 === 0) {
            options.onProgress(context.totalProcessed, undefined, context.sourceLabel);
          }
        }
      }
    } catch (error) {
      throw ConcatError.withSourceContext(
        `Error processing sequences from source: ${error instanceof Error ? error.message : String(error)}`,
        context.sourceLabel
      );
    }
  }

  /**
   * Resolve ID conflicts according to the specified strategy
   */
  private resolveIdConflict(
    sequence: AbstractSequence,
    context: ConcatContext,
    options: Required<ConcatOptions>
  ): AbstractSequence | null {
    const { seenIds } = context;
    const originalId = sequence.id;

    // Check for ID conflict
    if (!seenIds.has(originalId)) {
      seenIds.add(originalId);
      return sequence;
    }

    // Handle ID conflict based on strategy
    switch (options.idConflictResolution) {
      case 'error':
        throw ConcatError.withSourceContext(
          `Duplicate sequence ID found: ${originalId}`,
          context.sourceLabel,
          originalId
        );

      case 'ignore':
        // Skip this sequence
        return null;

      case 'rename': {
        // Generate unique ID
        let newId = originalId;
        let suffix = 1;
        while (seenIds.has(newId)) {
          newId = `${originalId}_${suffix}`;
          suffix++;
        }

        seenIds.add(newId);
        return {
          ...sequence,
          id: newId,
        };
      }

      case 'suffix': {
        // Add source suffix
        const suffix = options.renameSuffix.startsWith('_')
          ? `${options.renameSuffix}${context.sourceIndex}`
          : `_${options.renameSuffix}${context.sourceIndex}`;

        const newId = `${originalId}${suffix}`;

        // Check if the suffixed ID is also a duplicate
        if (seenIds.has(newId)) {
          // Fall back to rename strategy
          let uniqueId = newId;
          let counter = 1;
          while (seenIds.has(uniqueId)) {
            uniqueId = `${newId}_${counter}`;
            counter++;
          }
          seenIds.add(uniqueId);
          return {
            ...sequence,
            id: uniqueId,
          };
        }

        seenIds.add(newId);
        return {
          ...sequence,
          id: newId,
        };
      }

      default:
        // Should never reach here due to type constraints
        throw new ConcatError(
          `Unknown ID conflict resolution strategy: ${options.idConflictResolution}`
        );
    }
  }
}
