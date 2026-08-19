/**
 * Issue #271. Two things are pinned here, and they are different claims.
 *
 * The first is that the breakdown is right: a transcript's characters land in the bucket a
 * reader would expect, prior tool results are attributed to the tool that produced them,
 * and the buckets sum to the total. That is what makes the report in `docs/loop-cost.md`
 * evidence rather than an assertion.
 *
 * The second is the growth itself: profiling step N of a transcript that grew from step 1
 * shows the resend, so the shape the issue describes is observable in a test rather than
 * only in a paid run. Nothing here calls a model, so it runs in CI with no credentials.
 */
import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { createDocumentRunContext, createImportTools } from './tools.js';
import { InMemorySourceReader } from './sources.js';
import { InMemoryImageStore } from './images.js';
import { loadBuiltinPlaybook } from './playbook.js';
import { profileStep, toolSchemaChars } from './transcript-profile.js';

const SYSTEM = 'You are extracting canon.';

function transcript(): ModelMessage[] {
	return [
		{ role: 'user', content: 'Process the document with id "doc-1".' },
		{
			role: 'assistant',
			content: [
				{ type: 'text', text: 'Reading the page first.' },
				{
					type: 'tool-call',
					toolCallId: 'c1',
					toolName: 'source_read',
					input: { path: 'notebook/section/page.htm' }
				}
			]
		},
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'c1',
					toolName: 'source_read',
					output: { type: 'json', value: { content: 'x'.repeat(4000) } }
				}
			]
		}
	];
}

describe('profileStep splits a step into the buckets issue #271 names', () => {
	it('attributes the system prompt, user turns, assistant prose, tool call arguments and tool results separately', () => {
		const profile = profileStep({
			step: 2,
			attempt: 0,
			systemPrompt: SYSTEM,
			messages: transcript(),
			toolSchemaChars: 1000
		});

		expect(profile.systemPrompt).toBe(SYSTEM.length);
		expect(profile.toolSchemas).toBe(1000);
		expect(profile.userTurns).toBe('Process the document with id "doc-1".'.length);
		// The assistant turn's prose is counted, its tool call is not.
		expect(profile.assistantText).toBeGreaterThan(0);
		expect(profile.assistantText).toBeLessThan(100);
		expect(profile.toolCallArgs).toBeGreaterThan(0);
		// The 4000-character page body dominates, and it is a tool result, not assistant text.
		expect(profile.toolResults).toBeGreaterThan(4000);
		expect(profile.messageCount).toBe(3);
	});

	it('attributes prior tool results to the tool that produced them', () => {
		const messages = transcript();
		messages.push({
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'c2',
					toolName: 'entity_propose',
					output: { type: 'json', value: { ok: true } }
				}
			]
		});
		const profile = profileStep({
			step: 3,
			attempt: 0,
			systemPrompt: SYSTEM,
			messages,
			toolSchemaChars: 0
		});

		expect(Object.keys(profile.toolResultsByTool).sort()).toEqual([
			'entity_propose',
			'source_read'
		]);
		expect(profile.toolResultsByTool.source_read).toBeGreaterThan(4000);
		expect(profile.toolResultsByTool.entity_propose).toBeLessThan(200);
		expect(Object.values(profile.toolResultsByTool).reduce((a, b) => a + b, 0)).toBe(
			profile.toolResults
		);
	});

	it('sums every bucket into totalChars, so no part of the payload is uncounted', () => {
		const profile = profileStep({
			step: 2,
			attempt: 0,
			systemPrompt: SYSTEM,
			messages: transcript(),
			toolSchemaChars: 1000
		});
		expect(profile.totalChars).toBe(
			profile.systemPrompt +
				profile.toolSchemas +
				profile.userTurns +
				profile.assistantText +
				profile.toolCallArgs +
				profile.toolResults
		);
		expect(profile.estimatedInputTokens).toBeGreaterThan(profile.totalChars / 5);
		expect(profile.estimatedInputTokens).toBeLessThan(profile.totalChars);
	});

	it('shows the resend: the fixed parts do not grow, the accumulated ones do', () => {
		// The whole claim of issue #271, as a measurement rather than a description. Step 1
		// carries only the opening ask; step 4 carries three rounds of tool traffic on top,
		// and the system prompt and tool schemas are identical in both.
		const first = profileStep({
			step: 1,
			attempt: 0,
			systemPrompt: SYSTEM,
			messages: [transcript()[0]!],
			toolSchemaChars: 1000
		});
		const grown = transcript();
		for (let round = 0; round < 2; round++) grown.push(...transcript().slice(1));
		const later = profileStep({
			step: 4,
			attempt: 0,
			systemPrompt: SYSTEM,
			messages: grown,
			toolSchemaChars: 1000
		});

		expect(later.systemPrompt).toBe(first.systemPrompt);
		expect(later.toolSchemas).toBe(first.toolSchemas);
		expect(later.userTurns).toBe(first.userTurns);
		expect(later.toolResults).toBeGreaterThan(3 * 4000);
		expect(first.toolResults).toBe(0);
		expect(later.totalChars).toBeGreaterThan(4 * first.totalChars);
	});

	it('counts a retry attempt separately from its step, since a retry is a real charged call', () => {
		const withRetry: ModelMessage[] = [
			...transcript(),
			{ role: 'user', content: 'Propose fewer things this turn.' }
		];
		const profile = profileStep({
			step: 5,
			attempt: 1,
			systemPrompt: SYSTEM,
			messages: withRetry,
			toolSchemaChars: 0
		});
		expect(profile.attempt).toBe(1);
		expect(profile.step).toBe(5);
		expect(profile.userTurns).toBeGreaterThan('Process the document with id "doc-1".'.length);
	});
});

describe('toolSchemaChars measures the real tool surface', () => {
	it('prices a playbook\u2019s real tool surface from its actual JSON Schema, and shrinks when the playbook enables fewer tools', async () => {
		const playbook = await loadBuiltinPlaybook('onenote');
		const ctx = createDocumentRunContext('job', 'doc-1', 'notebook/a/page.htm', null);
		const deps = {
			sources: new InMemorySourceReader({ files: {} }),
			images: new InMemoryImageStore()
		};
		const tools = createImportTools(ctx, deps, new Set(playbook.tools));

		const chars = toolSchemaChars(tools);
		expect(chars).toBeGreaterThan(0);
		// `gateway-driver.ts` prices this at a flat `TOOL_DEFINITION_TOKEN_ESTIMATE` of 150
		// tokens per tool, which is 600 characters per tool at this repo's 4-chars-per-token
		// convention. The real average is below that, so the flat stand-in overprices the
		// tool surface rather than underpricing it, which is the direction a ceiling needs.
		// Issue #271 wanted this checked rather than assumed, and the answer is that the
		// tool schemas are not where a step's money goes.
		expect(chars).toBeLessThan(600 * Object.keys(tools).length);
		expect(
			toolSchemaChars(createImportTools(ctx, deps, new Set(['source_read', 'checkpoint'])))
		).toBeLessThan(chars);
	});
});
