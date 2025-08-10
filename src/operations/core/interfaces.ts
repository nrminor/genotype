/**
 * Core interfaces for SeqOps operations in the Genotype library
 *
 * This module provides the foundation for streaming genomic data processing
 * with tidyverse-style pipeline composition while maintaining constant memory usage.
 *
 * All operations must implement the SeqOp interface to enable:
 * - Streaming processing: O(1) memory regardless of input size
 * - Pipeline composition: op1.pipe(op2).pipe(op3)
 * - Type safety: Full TypeScript type checking
 * - Memory management: Configurable strategies for large datasets
 *
 * @version 0.1.0
 * @since 2025-01-01
 */

import type { Sequence } from "../../types";

/**
 * Memory management strategies for different dataset sizes and constraints
 *
 * These strategies provide hints to operations about optimal memory usage:
 * - STREAMING: Pure streaming, O(1) memory, no buffering
 * - BUFFERED: Small buffer for performance optimization
 * - EXTERNAL: Disk-based processing for datasets larger than RAM
 * - BLOOM_FILTER: Probabilistic data structures for deduplication
 */
export enum MemoryStrategy {
	STREAMING = "streaming",
	BUFFERED = "buffered",
	EXTERNAL = "external",
	BLOOM_FILTER = "bloom_filter",
}

/**
 * Core interface enabling tidyverse-style pipeline composition for genomic sequences
 *
 * All SeqOps operations must implement this interface to ensure:
 * 1. Streaming behavior: process() returns AsyncIterable, never collects all data
 * 2. Composability: pipe() enables chaining operations together
 * 3. Validation: validate() checks configuration before processing
 * 4. Debugging: name provides operation identification
 * 5. Memory hints: memoryStrategy guides optimization choices
 *
 * @template TInput - Input sequence type, must extend base Sequence interface
 * @template TOutput - Output sequence type, must extend base Sequence interface
 */
export interface SeqOp<
	TInput extends Sequence,
	TOutput extends Sequence = TInput,
> {
	/**
	 * Process sequences through this operation using streaming
	 *
	 * CRITICAL CONTRACT: This method MUST maintain streaming behavior:
	 * - Never collect all input sequences in memory
	 * - Yield results as soon as they are available
	 * - Use async generators for memory-efficient processing
	 * - Handle backpressure through natural async iteration
	 *
	 * @param input - Async iterable of input sequences to process
	 * @returns Async iterable of output sequences (streaming)
	 * @throws {ValidationError} When operation configuration is invalid
	 * @throws {ProcessingError} When sequence processing fails
	 */
	process(input: AsyncIterable<TInput>): AsyncIterable<TOutput>;

	/**
	 * Compose this operation with another operation for pipeline chaining
	 *
	 * Enables fluent API: `operation1.pipe(operation2).pipe(operation3)`
	 * The resulting pipeline maintains streaming behavior throughout.
	 *
	 * @template TNext - Output type of the next operation in pipeline
	 * @param next - The operation to pipe this operation's output into
	 * @returns Composite operation that streams through both operations
	 */
	pipe<TNext extends Sequence>(
		next: SeqOp<TOutput, TNext>,
	): SeqOp<TInput, TNext>;

	/**
	 * Validate operation configuration before processing begins
	 *
	 * Should check all parameters, dependencies, and preconditions.
	 * Called automatically by pipeline operations and can be called manually.
	 *
	 * @throws {ValidationError} When configuration is invalid
	 * @throws {DependencyError} When required dependencies are missing
	 */
	validate(): void;

	/**
	 * Human-readable operation name for debugging and logging
	 *
	 * Used in error messages, pipeline descriptions, and operation introspection.
	 * Should be descriptive but concise (e.g., "reverse-complement", "quality-filter").
	 */
	readonly name: string;

	/**
	 * Optional memory strategy hint for large datasets
	 *
	 * Guides how the operation should handle memory management:
	 * - STREAMING: Pure streaming, no buffering (default)
	 * - BUFFERED: Small buffer for performance optimization
	 * - EXTERNAL: Use disk-based algorithms for huge datasets
	 * - BLOOM_FILTER: Use probabilistic data structures for deduplication
	 */
	readonly memoryStrategy?: MemoryStrategy;
}

/**
 * Abstract base class providing default SeqOp implementation
 *
 * Provides the standard pipe() implementation and empty validate() method.
 * Concrete operations should extend this class and implement:
 * - name: Operation identifier
 * - process(): Core streaming logic
 * - validate(): Configuration validation (optional override)
 *
 * @template TInput - Input sequence type, must extend base Sequence interface
 * @template TOutput - Output sequence type, must extend base Sequence interface
 */
export abstract class BaseSeqOp<
	TInput extends Sequence,
	TOutput extends Sequence = TInput,
> implements SeqOp<TInput, TOutput>
{
	/**
	 * Operation name for debugging and pipeline description
	 * Must be implemented by concrete operations
	 */
	abstract readonly name: string;

	/**
	 * Core streaming processing logic
	 * Must be implemented by concrete operations as an async generator
	 *
	 * @param input - Async iterable of input sequences
	 * @returns Async iterable of transformed sequences
	 */
	abstract process(input: AsyncIterable<TInput>): AsyncIterable<TOutput>;

	/**
	 * Compose this operation with another for pipeline chaining
	 *
	 * Creates a PipelineOperation that streams through both operations
	 * without collecting intermediate results in memory.
	 *
	 * @template TNext - Output type of the next operation
	 * @param next - Operation to pipe output into
	 * @returns Composite pipeline operation
	 */
	pipe<TNext extends Sequence>(
		next: SeqOp<TOutput, TNext>,
	): SeqOp<TInput, TNext> {
		// Tiger Style: Assert preconditions
		if (!next) {
			throw new Error("Cannot pipe to null or undefined operation");
		}

		return new PipelineOperation(this, next);
	}

	/**
	 * Validate operation configuration
	 *
	 * Base implementation is empty - override in subclasses for specific validation.
	 * Called automatically by pipeline operations and manually by users.
	 */
	validate(): void {
		// Override in subclasses for specific validation logic
		// Base implementation has no configuration to validate
	}
}

/**
 * Composite operation created when operations are piped together
 *
 * Automatically manages the composition of two operations:
 * 1. Streams input through the first operation
 * 2. Streams those results through the second operation
 * 3. Yields final results without intermediate buffering
 * 4. Combines validation from both operations
 * 5. Creates descriptive name from both operation names
 *
 * This class is private and created automatically by pipe() calls.
 * Users interact with it through the SeqOp interface.
 *
 * @template TInput - Input type to first operation
 * @template TMiddle - Output type of first operation, input type of second
 * @template TOutput - Output type of second operation
 */
class PipelineOperation<
	TInput extends Sequence,
	TMiddle extends Sequence,
	TOutput extends Sequence,
> extends BaseSeqOp<TInput, TOutput> {
	/**
	 * Descriptive name combining both operation names
	 * Uses pipe separator to show pipeline flow: "op1 | op2"
	 */
	readonly name: string;

	constructor(
		private readonly first: SeqOp<TInput, TMiddle>,
		private readonly second: SeqOp<TMiddle, TOutput>,
	) {
		super();

		// Tiger Style: Assert valid operations
		if (!first) {
			throw new Error(
				"First operation in pipeline cannot be null or undefined",
			);
		}
		if (!second) {
			throw new Error(
				"Second operation in pipeline cannot be null or undefined",
			);
		}

		// Initialize name after validation
		this.name = `${this.first.name} | ${this.second.name}`;
	}

	/**
	 * Process input by streaming through both operations
	 *
	 * CRITICAL: This maintains streaming throughout the pipeline:
	 * 1. Pass input directly to first operation's process method
	 * 2. Pass that AsyncIterable directly to second operation's process method
	 * 3. Yield results from second operation as they become available
	 * 4. Never collect intermediate results in memory
	 *
	 * @param input - Input sequences to process through pipeline
	 * @returns Stream of sequences after both transformations
	 */
	async *process(input: AsyncIterable<TInput>): AsyncIterable<TOutput> {
		// Tiger Style: Validate operations before processing
		this.validate();

		// Stream through both operations without intermediate collection
		// this.first.process(input) returns AsyncIterable<TMiddle>
		// this.second.process(...) consumes that and returns AsyncIterable<TOutput>
		yield* this.second.process(this.first.process(input));
	}

	/**
	 * Validate both operations in the pipeline
	 *
	 * Calls validate() on both operations in sequence.
	 * If either operation is invalid, the entire pipeline is invalid.
	 *
	 * @throws {ValidationError} If either operation fails validation
	 */
	override validate(): void {
		// Tiger Style: Validate both operations
		try {
			this.first.validate();
		} catch (error) {
			throw new Error(
				`First operation in pipeline failed validation: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		try {
			this.second.validate();
		} catch (error) {
			throw new Error(
				`Second operation in pipeline failed validation: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
