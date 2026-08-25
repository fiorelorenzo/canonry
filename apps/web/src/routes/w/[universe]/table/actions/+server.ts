/**
 * Issue #74: the two-tier dock's three named actions (decision E3 = C). Every action that
 * writes reaches this one POST with a `kind` discriminator, so the client's dock component
 * stays a thin set of buttons and the guardrail-1 boundary (proposal, never a direct write,
 * except the reveal path which never was canon-writing to begin with) lives in one place.
 */
import { error, json } from '@sveltejs/kit';
import { runningSessionContext } from '@canonry/db';
import { messages } from '$lib/i18n';
import { identityGateway, modelFactory } from '$lib/server/copilot.js';
import { db } from '$lib/server/db';
import { publishTableEvent } from '$lib/server/table-stream';
import { requireTableAccess } from '../_server/guard.js';
import {
	fireCreateChildLocation,
	fireMarkAsRevealed,
	fireNpcHere,
	NoSessionDeclaredError
} from '../_server/quick-actions.js';
import type { RequestHandler } from './$types';

interface ActionBody {
	kind?: 'npc' | 'location' | 'reveal';
	label?: string;
}

function isActionBody(value: unknown): value is ActionBody {
	return typeof value === 'object' && value !== null;
}

export const POST: RequestHandler = async (event) => {
	const access = await requireTableAccess(event);
	const t = messages(event.locals.locale).table.server;
	const raw: unknown = await event.request.json().catch(() => ({}));
	const body = isActionBody(raw) ? raw : {};

	const conn = db();
	const context = await runningSessionContext(conn, access.universe.id);
	if (!context?.placeEntityId) {
		error(400, t.declareBeforeAction);
	}

	// `language` and `body` come along because a drafted NPC's prose has to be written in the
	// place's own language rather than the GM's interface language (SPEC.md §17): the two are
	// decided here, once, where the request already knows both.
	const placeRow = await conn.query.entity.findFirst({
		where: (entity, { eq }) => eq(entity.id, context.placeEntityId as string),
		columns: { name: true, language: true, body: true }
	});
	const placeName = placeRow?.name ?? 'this place';
	const placeLanguage = placeRow?.language ?? null;
	const placeBody = placeRow?.body ?? '';

	if (body.kind === 'npc') {
		// SPEC.md §8.1's own timeline: "the tap is instant lane, no model involved. The NPC
		// itself drafts in the slow lane, always background, always optional." The
		// acknowledgement publishes and the response returns before `fireNpcHere` resolves;
		// the actual draft (or scaffold fallback) lands on the stream separately, whenever it
		// finishes, however long that takes.
		publishTableEvent(access.universe.id, 'quick-action', {
			action: 'npc-here',
			status: 'drafting',
			placeEntityId: context.placeEntityId
		});

		fireNpcHere({
			db: conn,
			universeId: access.universe.id,
			userId: access.userId,
			placeEntityId: context.placeEntityId,
			placeName,
			locale: event.locals.locale,
			placeLanguage,
			placeBody,
			sessionEntityId: context.sessionEntityId,
			modelFactory,
			gateway: identityGateway
		})
			.then((result) => {
				publishTableEvent(access.universe.id, 'proposal', {
					proposalId: result.proposal.id,
					kind: result.proposal.kind,
					rationale: result.proposal.rationale,
					drafted: result.drafted,
					unavailableReason: result.unavailableReason ?? null,
					via: 'npc-here'
				});
			})
			.catch((err: unknown) => {
				const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
				publishTableEvent(access.universe.id, 'quick-action', {
					action: 'npc-here',
					status: 'failed',
					reason
				});
			});

		return json({ ok: true, status: 'drafting' });
	}

	if (body.kind === 'location') {
		const label = (body.label ?? '').trim();
		if (!label) error(400, t.nameLocationBeforeCreating);
		const proposal = await fireCreateChildLocation(
			{
				db: conn,
				universeId: access.universe.id,
				userId: access.userId,
				placeEntityId: context.placeEntityId,
				placeName,
				locale: event.locals.locale,
				placeLanguage,
				placeBody,
				sessionEntityId: context.sessionEntityId,
				modelFactory,
				gateway: identityGateway
			},
			label
		);
		publishTableEvent(access.universe.id, 'quick-action', {
			action: 'create-child-location',
			proposalId: proposal.id,
			label
		});
		publishTableEvent(access.universe.id, 'proposal', {
			proposalId: proposal.id,
			kind: proposal.kind,
			rationale: proposal.rationale,
			via: 'create-child-location'
		});
		return json({ ok: true, proposal });
	}

	if (body.kind === 'reveal') {
		try {
			const revelation = await fireMarkAsRevealed(
				{
					db: conn,
					universeId: access.universe.id,
					userId: access.userId,
					placeEntityId: context.placeEntityId,
					placeName,
					locale: event.locals.locale,
					placeLanguage,
					placeBody,
					sessionEntityId: context.sessionEntityId,
					modelFactory,
					gateway: identityGateway
				},
				access.userId
			);
			publishTableEvent(access.universe.id, 'reveal', {
				entityId: context.placeEntityId,
				name: placeName,
				confirmedAt: revelation.confirmedAt?.toISOString() ?? null
			});
			return json({ ok: true, revelation });
		} catch (err) {
			if (err instanceof NoSessionDeclaredError) error(400, err.message);
			throw err;
		}
	}

	error(400, t.unknownActionKind(String(body.kind)));
};
