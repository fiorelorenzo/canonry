/**
 * Issue #290, decision O3, its "the GM presses keep" half repealed by issue #437 (T10) and
 * issue #455 (U11): the only endpoint in this product that stores an Ask answer, called
 * automatically now, once a turn finishes streaming, by both the docked panel and the Ask
 * page (`$lib/ask/stream.ts`'s own `keepAnswer`) - never by a click any more.
 *
 * `POST /w/<universe>/ask/keep`, JSON in, `{ id }` out. The body carries what the client
 * actually has in front of it, the question, the answer text, the detail level, the sources
 * as references and the path it was asked from. It deliberately does not carry the provider:
 * guardrail 5's claim about which company generated this text is resolved here, from the
 * same `model_config` row and the same universe switch `runAsk` reads, because a disclosure
 * a client can set is not a disclosure.
 *
 * Guardrail 1 is not enforced here because it cannot be violated here: this endpoint writes
 * two rows through `keepAnswer` and neither table can reach canon. Promoting a kept answer
 * to an entry still means asking for a proposal and accepting it.
 */
import { error, json } from '@sveltejs/kit';
import { and, eq, inArray, isNull, or, keepAnswer, universeAccessBySlug } from '@canonry/db';
import { entity, dataSource } from '@canonry/db/schema';
import { resolveModel, ModelNotConfiguredError } from '@canonry/ai';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import { keepRequestSchema } from '$lib/server/ask/keep-request';
import { takeTurnLoss } from '$lib/server/ask/turn-loss';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) error(404, `no universe called "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `no universe called "${params.universe}"`);
	const t = messages(locals.locale).universe.ask.keep;

	const parsed = keepRequestSchema.safeParse(await request.json());
	if (!parsed.success) error(400, t.invalidRequest);
	const body = parsed.data;

	// A citation has to point at something this universe can actually show. Without this an
	// answer could be kept citing another universe's entry, and the history would then render
	// a name from a world this account never had access to.
	const citedEntityIds = [
		...new Set(body.sources.filter((s) => s.kind === 'own_canon').map((s) => s.entityId))
	];
	if (citedEntityIds.length > 0) {
		const found = await conn
			.select({ id: entity.id })
			.from(entity)
			.where(and(eq(entity.universeId, access.universe.id), inArray(entity.id, citedEntityIds)));
		if (found.length !== citedEntityIds.length) error(400, t.sourceNotInUniverse);
	}

	// Same for an indexed corpus: this universe's own source, or a shared official one
	// (`universe_id is null`), and nothing belonging to somebody else's world.
	const citedSourceIds = [
		...new Set(
			body.sources
				.filter((s): s is Extract<typeof s, { kind: 'indexed' }> => s.kind === 'indexed')
				.map((s) => s.dataSourceId)
				.filter((id): id is string => id !== null)
		)
	];
	if (citedSourceIds.length > 0) {
		const found = await conn
			.select({ id: dataSource.id })
			.from(dataSource)
			.where(
				and(
					inArray(dataSource.id, citedSourceIds),
					or(isNull(dataSource.universeId), eq(dataSource.universeId, access.universe.id))
				)
			);
		if (found.length !== citedSourceIds.length) error(400, t.sourceNotInUniverse);
	}

	// Guardrail 5, resolved rather than accepted from the caller. Null on both when writing is
	// switched off for this universe, which is `runAsk`'s reading-only branch: the answer is
	// the GM's own sentences quoted back, no model call happened, and the record has to keep
	// saying so. A model swapped in the admin panel between the ask and the keep would be
	// recorded here instead of the one that actually answered, which is a seconds-wide window
	// and still a truer answer than trusting the body.
	let provider: string | null = null;
	let modelId: string | null = null;
	if (access.universe.aiEnabled) {
		try {
			const model = await resolveModel(conn, 'premium');
			provider = model.provider;
			modelId = model.modelId;
		} catch (err) {
			if (!(err instanceof ModelNotConfiguredError)) throw err;
		}
	}

	// Issue #699, and the same principle as the block above: what the turn could not finish
	// is resolved here from what the stream itself observed, never read off the body. The
	// body carries only the opaque handle `ask/+server.ts` minted, and redeeming it is
	// single-use and scoped to this account. `null` back - an unknown handle, one already
	// spent, one past its TTL, one minted for somebody else, or a body with none at all -
	// leaves both columns null, which is this schema's own way of saying "we do not know"
	// rather than the friendlier and false "it finished".
	const loss = takeTurnLoss(locals.user.id, body.turnId);

	const row = await keepAnswer(conn, {
		universeId: access.universe.id,
		keptBy: locals.user.id,
		question: body.question,
		answer: body.answer,
		detailLevel: body.detailLevel,
		locale: locals.locale,
		askedFromPath: body.askedFromPath,
		provider,
		modelId,
		conversationId: body.conversationId,
		loss,
		sources: body.sources
	});

	return json({ id: row.id }, { status: 201 });
};

export const GET: RequestHandler = ({ locals }) =>
	json({ error: messages(locals.locale).universe.ask.keep.methodNotAllowed }, { status: 405 });
