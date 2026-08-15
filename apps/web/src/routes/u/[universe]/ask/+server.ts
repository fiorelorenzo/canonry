/**
 * SSE endpoint for Ask (issues #53/#60, SPEC.md §5). A raw POST skips the layout's own
 * `load`, so membership is re-checked here exactly like every other write-adjacent
 * endpoint under this universe (media/generate/+server.ts's own comment on the pattern).
 *
 * Sources are always resolved and sent before any answer text - `runAsk` itself already
 * guarantees this (both retrieval layers finish before the answer stream starts), and the
 * `sources` SSE event is emitted first here too, so a client that renders on event arrival
 * can never show an answer with nothing beside it, not even for one frame.
 */
import { error, json } from '@sveltejs/kit';
import { universeAccessBySlug } from '@canonry/db';
import { runAsk, type AskDetailLevel } from '@canonry/copilot';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import { identityGateway, modelFactory, queryEmbedderFor, vectorClient } from '$lib/server/copilot';
import type { RequestHandler } from './$types';

const DETAIL_LEVELS: readonly AskDetailLevel[] = ['1_line', 'short', 'normal', 'detailed', 'full'];

function isDetailLevel(value: unknown): value is AskDetailLevel {
	return typeof value === 'string' && (DETAIL_LEVELS as readonly string[]).includes(value);
}

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) error(404, `no universe called "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `no universe called "${params.universe}"`);

	const body: unknown = await request.json();
	const question =
		body && typeof body === 'object' && 'question' in body && typeof body.question === 'string'
			? body.question.trim()
			: '';
	const detailLevel =
		body && typeof body === 'object' && 'detailLevel' in body && isDetailLevel(body.detailLevel)
			? body.detailLevel
			: 'normal';
	if (question.length === 0) error(400, messages(locals.locale).universe.ask.questionRequired);

	const encoder = new TextEncoder();
	const send = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		event: string,
		data: unknown
	) => {
		controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
	};

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				const result = await runAsk({
					db: conn,
					userId: locals.user!.id,
					universeId: access.universe.id,
					// SPEC.md §17: the answer comes back in the reader's language whatever language the
					// canon it cites is written in, and the quoted sources stay in theirs.
					locale: locals.locale,
					question,
					detailLevel,
					vectorClient: vectorClient(),
					embedder: queryEmbedderFor(locals.user!.id, access.universe.id),
					modelFactory,
					gateway: identityGateway,
					onSources: (sources, followUps) => {
						send(controller, 'sources', { sources, followUps });
					},
					onToken: (delta) => {
						send(controller, 'token', { delta });
					}
				});
				send(controller, 'done', {
					answer: result.answer,
					generated: result.generated,
					credits: result.credits
				});
			} catch (err) {
				send(controller, 'error', {
					message:
						err instanceof Error ? err.message : messages(locals.locale).universe.ask.askFailed
				});
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};

export const GET: RequestHandler = ({ locals }) =>
	json({ error: messages(locals.locale).universe.ask.methodNotAllowed }, { status: 405 });
