/**
 * "Exit table mode" on the context strip (E1's mock, both A and B options draw this
 * button). Closes the running `session_context` - the table breaks - and tells every
 * connected client so the strip can show G8 = B's exit-time proposal count and stop
 * pretending a context is still declared.
 */
import { json } from '@sveltejs/kit';
import { endSessionContext } from '@canonry/db';
import { db } from '$lib/server/db';
import { publishTableEvent } from '$lib/server/table-stream';
import { requireTableAccess } from '../_server/guard.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const access = await requireTableAccess(event);
	const ended = await endSessionContext(db(), access.universe.id);

	publishTableEvent(access.universe.id, 'session-ended', {
		contextId: ended?.id ?? null,
		endedAt: ended?.endedAt?.toISOString() ?? new Date().toISOString()
	});

	return json({ ok: true, ended });
};
