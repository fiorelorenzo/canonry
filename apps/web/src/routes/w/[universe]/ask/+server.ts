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
import {
	clampAskHistory,
	runAsk,
	type AskContext,
	type AskDetailLevel,
	type AskHistoryTurn
} from '@canonry/copilot';
import { z } from 'zod';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import { identityGateway, modelFactory, queryEmbedderFor, vectorClient } from '$lib/server/copilot';
import { recordTurnLoss } from '$lib/server/ask/turn-loss';
import type { RequestHandler } from './$types';

const DETAIL_LEVELS: readonly AskDetailLevel[] = ['1_line', 'short', 'normal', 'detailed', 'full'];

function isDetailLevel(value: unknown): value is AskDetailLevel {
	return typeof value === 'string' && (DETAIL_LEVELS as readonly string[]).includes(value);
}

// issue #380, decision R5: shape only. `clampAskHistory` - imported from `@canonry/copilot`,
// the same package that owns `MAX_HISTORY_TURNS`/`MAX_HISTORY_TURN_CHARS` and the token
// arithmetic behind them - does the actual capping and truncating in `parseAskRequestBody`
// below. A turn that is merely long is never a validation failure here, only something
// this route trims before it reaches `runAsk`.
const askHistoryTurnSchema = z.object({
	role: z.enum(['gm', 'loremaster']),
	text: z.string()
});

const askContextSchema = z
	.object({
		kind: z.enum(['entry', 'world']),
		name: z.string(),
		entityType: z.string().optional()
	})
	.nullable();

export interface ParsedAskRequest {
	question: string;
	detailLevel: AskDetailLevel;
	history: AskHistoryTurn[];
	context: AskContext | null;
}

/**
 * issue #380: `history` and `context` are validated by the Zod schemas above, then clamped
 * rather than rejected - a GM an hour into a session eventually sends more than six turns,
 * and that is an ordinary request, not a malformed one. Both fields fail *open* on a shape
 * Zod itself rejects (an unrecognised `role`, a `kind` that is neither `entry` nor `world`)
 * rather than 400ing the whole ask: the same forgiving treatment `detailLevel` already gets
 * below when it is not one of the five real levels - a client-side bug in a decoration (the
 * transcript, the context line) should never cost the GM their actual question.
 *
 * Exported (with the `_` prefix SvelteKit requires on a `+server.ts` export that is not a
 * method handler - anything else fails the framework's own build-time export check), and
 * free of `request`/`db`, so this route's own schema tests can exercise it directly,
 * without a live database or a real POST.
 */
export function _parseAskRequestBody(body: unknown): ParsedAskRequest | null {
	const question =
		body && typeof body === 'object' && 'question' in body && typeof body.question === 'string'
			? body.question.trim()
			: '';
	if (question.length === 0) return null;

	const detailLevel =
		body && typeof body === 'object' && 'detailLevel' in body && isDetailLevel(body.detailLevel)
			? body.detailLevel
			: 'normal';

	const rawHistory =
		body && typeof body === 'object' && 'history' in body ? body.history : undefined;
	const parsedHistory = z.array(askHistoryTurnSchema).safeParse(rawHistory);
	// oldest-first is the wire contract, so "drop the oldest, truncate what is kept" is
	// `clampAskHistory` itself - never re-derived here, or the two enforcement sites drift.
	const history = clampAskHistory(parsedHistory.success ? parsedHistory.data : []);

	const rawContext = body && typeof body === 'object' && 'context' in body ? body.context : null;
	const parsedContext = askContextSchema.safeParse(rawContext);
	const context = parsedContext.success ? parsedContext.data : null;

	return { question, detailLevel, history, context };
}

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) error(404, `no universe called "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `no universe called "${params.universe}"`);

	const parsed = _parseAskRequestBody(await request.json());
	if (!parsed) error(400, messages(locals.locale).universe.ask.questionRequired);
	const { question, detailLevel, history, context } = parsed;

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
					history,
					context,
					vectorClient: vectorClient(),
					embedder: queryEmbedderFor(locals.user!.id, access.universe.id),
					modelFactory,
					gateway: identityGateway,
					onSources: (sources, followUps) => {
						send(controller, 'sources', { sources, followUps });
					},
					onToken: (delta) => {
						send(controller, 'token', { delta });
					},
					onProposal: (proposal) => {
						send(controller, 'proposal', proposal);
					},
					onProposalFailure: (failure) => {
						send(controller, 'proposal_failed', failure);
					}
				});
				// Issue #570: no provider and no model id. They fed the keep card's guardrail 5
				// sentence, "<provider> wrote the answer from your own canon" (#290); T10 (#464)
				// deleted that card, and #354 settled that the disclosure is a standing line read
				// before anything is asked rather than a claim about one answer, with the privacy
				// page as the honest place to name a provider. Nothing rendered either field, so
				// each generated answer was paying for a second `model_config` read - `runAsk`
				// resolves `premium` itself on the branch that calls a model - to put two strings
				// on the wire that only looked like the input to a sentence somebody might restore.
				send(controller, 'done', {
					answer: result.answer,
					generated: result.generated,
					credits: result.credits,
					// issue #678: what the turn could not finish, or null when it finished.
					// `done` rather than an event of its own, because it is a property of the
					// settled turn: nothing can know a turn was cut off until it ends.
					loss: result.loss,
					// issue #699: the same fact, filed server-side under an opaque id so the keep
					// that follows can store it without the client being the one that says whether
					// the answer was complete. `loss` above is what the panel paints now; this is
					// what the record is written from. See `$lib/server/ask/turn-loss.ts`.
					turnId: recordTurnLoss(locals.user!.id, result.loss)
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
