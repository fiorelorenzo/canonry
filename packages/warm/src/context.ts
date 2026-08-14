/**
 * SPEC.md §8 / issue #72, the server half: "The GM declares context ('they have entered
 * Valdoria'), which sets `session_context`, and the system anticipates: it pins the main
 * characters of that place (a 2-hop graph query, instant lane)."
 *
 * `declareSessionContext` and `pinnedNeighbors` already live in @canonry/db (they are
 * plain reads/writes); what belongs here is composing the two into the one call a
 * declaration route makes, and only when a place is actually declared - a
 * moment/situation-only declaration has no place to pin from, and the instant lane has
 * nothing graph-shaped to query.
 */
import {
	declareSessionContext,
	pinnedNeighbors,
	type Db,
	type PinnedNeighbor,
	type SessionContextRow
} from '@canonry/db';
import type { DeclareSessionContextInput } from '@canonry/db';

export interface DeclareContextResult {
	context: SessionContextRow;
	/** The instant lane's 2-hop pin, or `[]` when no place was declared - never a promise
	 * that resolves later, since SPEC §8 requires this lane to never wait on anything. */
	pinned: PinnedNeighbor[];
}

export async function declareContextAndPin(
	db: Db,
	input: DeclareSessionContextInput
): Promise<DeclareContextResult> {
	const context = await declareSessionContext(db, input);
	const pinned = context.placeEntityId ? await pinnedNeighbors(db, context.placeEntityId) : [];
	return { context, pinned };
}
