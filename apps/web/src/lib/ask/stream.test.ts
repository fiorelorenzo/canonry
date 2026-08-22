/**
 * Issue #285: two contracts, both of which used to be implicit inside
 * `ask/+page.svelte` and are now shared by the route and the floating panel.
 *
 * The framing one is worth a test because an SSE event can straddle a chunk boundary and a
 * reader that splits per chunk instead of per blank line loses it. The keep one is worth a
 * test because the shape the client sends is validated by `keepRequestSchema` on the other
 * side of a fetch, where a mismatch is a 400 in a browser rather than a type error here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepRequestSchema } from '$lib/server/ask/keep-request';
import {
	consumeAskStream,
	keepSourcePayload,
	streamAsk,
	type AskDone,
	type AskSource
} from '$lib/ask/stream';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		}
	});
}

const ownCanon: AskSource = {
	kind: 'own_canon',
	entityId: '11111111-1111-4111-8111-111111111111',
	entityName: 'Aldric Vane',
	entitySlug: 'aldric-vane',
	statement: 'He now answers to the Ashen Ledger.'
};

const indexed: AskSource = {
	kind: 'indexed',
	dataSourceId: '22222222-2222-4222-8222-222222222222',
	pageTitle: 'Ashen Ledger',
	breadcrumb: 'Factions / Ashen Ledger',
	url: 'https://example.invalid/ashen-ledger',
	text: 'The Ashen Ledger keeps the debts of the drowned quarter. It lends at knife point.',
	statement: 'The Ashen Ledger keeps the debts of the drowned quarter.',
	attribution: 'Example Compendium',
	licence: 'CC BY 4.0',
	licenceUrl: 'https://example.invalid/licence'
};

describe('consumeAskStream', () => {
	it('reassembles an event split across two chunks', async () => {
		const tokens: string[] = [];
		await consumeAskStream(
			streamOf(['event: token\ndata: {"delta":"Answers to ', 'the Ashen Ledger"}\n\n']),
			{ onToken: (delta) => tokens.push(delta) }
		);
		expect(tokens).toEqual(['Answers to the Ashen Ledger']);
	});

	it('delivers sources before tokens, in arrival order, and the done payload last', async () => {
		const seen: string[] = [];
		let sources: AskSource[] = [];
		let done: AskDone | null = null;
		await consumeAskStream(
			streamOf([
				`event: sources\ndata: ${JSON.stringify({ sources: [ownCanon], followUps: ['Who owes him?'] })}\n\n`,
				'event: token\ndata: {"delta":"a"}\n\nevent: token\ndata: {"delta":"b"}\n\n',
				'event: done\ndata: {"generated":true,"provider":"anthropic","modelId":"m","answer":"ab","credits":1}\n\n'
			]),
			{
				onSources: (list) => {
					seen.push('sources');
					sources = list;
				},
				onToken: () => seen.push('token'),
				onDone: (payload) => {
					seen.push('done');
					done = payload;
				}
			}
		);
		expect(seen).toEqual(['sources', 'token', 'token', 'done']);
		expect(sources).toEqual([ownCanon]);
		expect(done).toEqual({ generated: true, provider: 'anthropic', modelId: 'm' });
	});

	it('reads a final event that arrived without its trailing blank line', async () => {
		let message: string | null = null;
		await consumeAskStream(streamOf(['event: error\ndata: {"message":"Ask failed."}']), {
			onError: (value) => (message = value)
		});
		expect(message).toBe('Ask failed.');
	});

	it('drops an event whose payload does not match its shape rather than passing it on', async () => {
		let called = false;
		await consumeAskStream(
			streamOf([
				'event: token\ndata: {"text":"wrong field"}\n\n',
				'event: sources\ndata: not json\n\n'
			]),
			{ onToken: () => (called = true), onSources: () => (called = true) }
		);
		expect(called).toBe(false);
	});
});

describe('keepSourcePayload', () => {
	it('produces a body the keep endpoint accepts', () => {
		const parsed = keepRequestSchema.safeParse({
			question: 'who does aldric vane report to now',
			answer: 'Answers to the Ashen Ledger.',
			detailLevel: 'normal',
			askedFromPath: '/w/valdoria-reach/e/aldric-vane',
			sources: keepSourcePayload([ownCanon, indexed])
		});
		expect(parsed.success).toBe(true);
	});

	it('cites a reference and the one sentence it grounded on, never the chunk and never the rendered prose', () => {
		// #535: `statement` for the indexed source too, not `text` - the retrieved chunk here
		// is two sentences, and a stored citation that is a paragraph is the entry-level
		// pointer the sentence-level citation replaces.
		expect(keepSourcePayload([ownCanon, indexed])).toEqual([
			{ kind: 'own_canon', entityId: ownCanon.entityId, statement: ownCanon.statement },
			{
				kind: 'indexed',
				dataSourceId: indexed.dataSourceId,
				pageTitle: 'Ashen Ledger',
				url: 'https://example.invalid/ashen-ledger',
				statement: 'The Ashen Ledger keeps the debts of the drowned quarter.'
			}
		]);
	});
});

describe('streamAsk (issue #380, decision R5)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('forwards history and context in the request body, unchanged, alongside question and detailLevel', async () => {
		let requestBody: unknown;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: RequestInit) => {
				requestBody = JSON.parse(init.body as string);
				return new Response(new ReadableStream({ start: (c) => c.close() }), { status: 200 });
			})
		);

		const history = [
			{ role: 'gm' as const, text: 'What happened to the old commander?' },
			{ role: 'loremaster' as const, text: 'He was dismissed after the Sable Winter.' }
		];
		const context = { kind: 'entry' as const, name: 'Aldric Vane', entityType: 'character' };

		await streamAsk(
			{
				universeSlug: 'valdoria-reach',
				question: 'Who commands the watch now?',
				detailLevel: 'normal',
				history,
				context
			},
			{}
		);

		expect(requestBody).toEqual({
			question: 'Who commands the watch now?',
			detailLevel: 'normal',
			history,
			context
		});
	});
});
