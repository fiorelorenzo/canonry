/**
 * Where a step's input tokens actually go (issue #271).
 *
 * The bounded loop of SPEC.md §6.1 is a stateless chat-completions loop: every step
 * resends the whole accumulated transcript, so `gateway-driver.ts`'s own
 * `estimateWorstCaseCredits` prices step N as a function of everything steps 1..N-1
 * produced. That is working as designed, and it also means a document's bill tracks how
 * many steps it took rather than what those steps read. Issue #271 filed that as a
 * finding and named the thing nobody had measured: *which part* of the resent transcript
 * the tokens are in.
 *
 * This module answers that, and it is deliberately pure. It takes the exact three inputs
 * a step is built from (the playbook's system prompt, the accumulated `ModelMessage[]`,
 * and the tool set on offer) and splits them into the five buckets the issue asks about,
 * plus the tool-by-tool split of prior tool results, which is what decides whether the
 * fix is pruning or summarisation. Nothing here calls a model, so the numbers are
 * load-independent and a recorded run can be re-broken-down without spending again.
 *
 * Two things it does not do, on purpose:
 *
 * - It does not tokenize. `CHARS_PER_TOKEN_ESTIMATE` in `gateway-driver.ts` is this
 *   repo's one convention for that (~4 chars per token, same as
 *   `packages/indexing/src/chunking.ts`), and a breakdown whose parts must add up to the
 *   provider's own reported `inputTokens` is more useful as a set of *shares* than as a
 *   second, differently-wrong absolute count. `StepProfile` therefore carries both: the
 *   estimated tokens per bucket, and the provider's reported total for the same step, so
 *   the ratio between them is visible rather than hidden.
 * - It does not change what is sent. A profiler is attached or it is not; when it is not,
 *   `gateway-driver.ts` never calls in here at all.
 */
import { asSchema, type ModelMessage, type ToolSet } from 'ai';

/** Same convention and the same reason as `gateway-driver.ts`'s own constant: no
 * tokenizer dependency in this monorepo, ~4 characters per token. Re-declared rather
 * than exported across, because this module must not become a reason the driver's
 * pricing constant is tuned for a report. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/** The buckets issue #271 names, in characters of what would go on the wire. Every field
 * counts the serialized JSON of the parts it covers, because that is what a provider
 * charges for, and `JSON.stringify`'s punctuation is part of the payload rather than an
 * artefact of measuring it. */
export interface TranscriptSegments {
	/** The playbook's system prompt, resent verbatim every step. */
	systemPrompt: number;
	/** Every enabled tool's name, description and JSON-Schema input, resent every step. */
	toolSchemas: number;
	/** User turns: the driver's opening "process this document" ask, plus anything else
	 * appended as a user turn later (issue #273's smaller-ask retry instruction). */
	userTurns: number;
	/** Prior assistant prose and reasoning, excluding its tool calls. */
	assistantText: number;
	/** Prior tool call arguments: what the model asked for, resent every step after. */
	toolCallArgs: number;
	/** Prior tool results: what the tools handed back, resent every step after. */
	toolResults: number;
}

export interface StepProfile extends TranscriptSegments {
	/** 1-based step number within the document, matching the loop's own `step`. */
	step: number;
	/** 0 for a step's first attempt, 1..n for issue #273's smaller-ask retries, which are
	 * real model calls and are charged like any other. */
	attempt: number;
	/** How many messages the transcript carried into this step. */
	messageCount: number;
	/** Prior tool results split by the tool that produced them. The whole reason this
	 * exists: "prune the transcript" and "summarise tool results after N steps" are
	 * different fixes, and which one is right depends on whether one tool's output
	 * dominates. */
	toolResultsByTool: Record<string, number>;
	/** Sum of every bucket above, in characters. */
	totalChars: number;
	/** `totalChars / 4`, this repo's convention. A ceiling, per bucket then summed, so it
	 * matches how `estimateWorstCaseCredits` rounds. */
	estimatedInputTokens: number;
}

/** A completed step: the profile of what went in, plus what the provider said it cost.
 * Emitted once per model call, retries included. */
export interface StepSample extends StepProfile {
	jobId: string;
	documentId: string;
	playbookId: string;
	playbookVersion: number;
	/** Which `model_config` purpose this step resolved to. */
	purpose: string;
	provider: string;
	modelId: string;
	/** The provider's own reported input tokens for this call. The number the bill is
	 * actually computed from, so the breakdown above is honest about being an estimate of
	 * this rather than a replacement for it. */
	reportedInputTokens: number;
	/** How much of `reportedInputTokens` the provider served from its own prompt cache.
	 * Zero everywhere means nothing is discounting the resent prefix, which is the finding
	 * a fix for #271 hangs on. */
	cachedInputTokens: number;
	reportedOutputTokens: number;
	credits: number;
}

/**
 * Attach one to `GatewayDriver` and every model call reports what it was built from.
 * Absent, and the driver does no profiling work at all. Synchronous and never awaited by
 * the loop, so a sink that throws is the sink's bug and not a failed import: callers push
 * onto an array or write a line, exactly as `LoopLogger` does.
 */
export type StepProfiler = (sample: StepSample) => void;

/** Serialized size of the tool surface as the provider sees it: each enabled tool's name,
 * description and JSON-Schema input. Computed once per document by the driver when a
 * profiler is attached, because the tool set never changes mid-run.
 *
 * This is the number `gateway-driver.ts`'s `TOOL_DEFINITION_TOKEN_ESTIMATE` (a flat 150
 * tokens per tool) stands in for when pricing a step that has not been sent yet. Measuring
 * it rather than assuming it is half the point of this module: if the flat estimate is far
 * off, every worst-case price the budget gate computes is off in the same direction. */
export function toolSchemaChars(tools: ToolSet): number {
	let chars = 0;
	for (const [name, definition] of Object.entries(tools)) {
		const description = typeof definition.description === 'string' ? definition.description : '';
		let schema: unknown = null;
		try {
			schema = asSchema(definition.inputSchema).jsonSchema;
		} catch {
			// A tool whose schema cannot be converted still costs its name and description
			// on the wire, and a profiler must never be the thing that fails an import.
			schema = null;
		}
		chars += JSON.stringify({ name, description, parameters: schema }).length;
	}
	return chars;
}

/** Serialized size of one message or part: a plain string content costs its own
 * characters, anything structured costs its JSON, which is what goes on the wire. */
function sizeOf(value: unknown): number {
	if (value === undefined) return 0;
	if (typeof value === 'string') return value.length;
	return JSON.stringify(value)?.length ?? 0;
}

/**
 * Splits one step's inputs into the buckets above. `messages` is the accumulated
 * transcript exactly as the driver is about to send it, so calling this before each
 * `callStep` gives the growth curve issue #271 asks for.
 */
export function profileStep(input: {
	step: number;
	attempt: number;
	systemPrompt: string;
	messages: ModelMessage[];
	toolSchemaChars: number;
}): StepProfile {
	const segments: TranscriptSegments = {
		systemPrompt: input.systemPrompt.length,
		toolSchemas: input.toolSchemaChars,
		userTurns: 0,
		assistantText: 0,
		toolCallArgs: 0,
		toolResults: 0
	};
	const toolResultsByTool: Record<string, number> = {};

	for (const message of input.messages) {
		// A system turn inside `messages` is not the playbook prompt (that travels as
		// `system`), so it is counted with the other turns the driver injected rather
		// than with the prompt it is not.
		if (message.role === 'system' || message.role === 'user') {
			segments.userTurns += sizeOf(message.content);
			continue;
		}
		if (message.role === 'assistant') {
			if (typeof message.content === 'string') {
				segments.assistantText += message.content.length;
				continue;
			}
			for (const part of message.content) {
				if (part.type === 'tool-call') segments.toolCallArgs += sizeOf(part);
				else segments.assistantText += sizeOf(part);
			}
			continue;
		}
		// A tool turn carries `ToolResultPart`s, and since AI SDK 7 it can also carry a
		// `ToolApprovalResponse`, which has no tool name. This loop's tool surface never
		// asks for approval, so that branch is unreachable here rather than unhandled, and
		// its bytes are still counted under a name that says so.
		for (const part of message.content) {
			const size = sizeOf(part);
			segments.toolResults += size;
			const toolName = 'toolName' in part ? part.toolName : 'approval-response';
			toolResultsByTool[toolName] = (toolResultsByTool[toolName] ?? 0) + size;
		}
	}

	const totalChars =
		segments.systemPrompt +
		segments.toolSchemas +
		segments.userTurns +
		segments.assistantText +
		segments.toolCallArgs +
		segments.toolResults;

	return {
		step: input.step,
		attempt: input.attempt,
		messageCount: input.messages.length,
		...segments,
		toolResultsByTool,
		totalChars,
		estimatedInputTokens:
			Math.ceil(segments.systemPrompt / CHARS_PER_TOKEN_ESTIMATE) +
			Math.ceil(segments.toolSchemas / CHARS_PER_TOKEN_ESTIMATE) +
			Math.ceil(segments.userTurns / CHARS_PER_TOKEN_ESTIMATE) +
			Math.ceil(segments.assistantText / CHARS_PER_TOKEN_ESTIMATE) +
			Math.ceil(segments.toolCallArgs / CHARS_PER_TOKEN_ESTIMATE) +
			Math.ceil(segments.toolResults / CHARS_PER_TOKEN_ESTIMATE)
	};
}
