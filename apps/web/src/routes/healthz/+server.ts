// Liveness/readiness probe for the compose healthcheck, the deploy health gate
// (SPEC.md #12) and CI's post-boot check. Deliberately dependency-light: it opens
// its own single-connection pool instead of reaching into app-wide server state,
// because a health endpoint has to keep working even when the rest of the app is
// misconfigured.
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createDb, ping, type Db } from '@canonry/db';
import type { RequestHandler } from './$types';

const QDRANT_TIMEOUT_MS = 1500;

// One pooled connection for the life of the process. Health checks run often
// (container healthcheck every few seconds, uptime monitors), so opening a fresh
// connection per request would be wasteful and would itself become a source of
// exhaustion under load.
let db: Db | undefined;

function getDb(): Db | undefined {
	if (db) return db;
	if (!env.DATABASE_URL) return undefined;
	db = createDb(env.DATABASE_URL, { max: 1 });
	return db;
}

async function checkPostgres(): Promise<boolean> {
	const instance = getDb();
	if (!instance) return false;
	try {
		return await ping(instance);
	} catch {
		// ping() contractually never throws, but a health check must not become a
		// 500 no matter what the dependency does.
		return false;
	}
}

async function checkQdrant(): Promise<boolean> {
	if (!env.QDRANT_URL) return false;
	try {
		const res = await fetch(new URL('/healthz', env.QDRANT_URL), {
			signal: AbortSignal.timeout(QDRANT_TIMEOUT_MS)
		});
		return res.ok;
	} catch {
		return false;
	}
}

export const GET: RequestHandler = async () => {
	const [dbOk, qdrantOk] = await Promise.all([checkPostgres(), checkQdrant()]);

	// Postgres is structural: without it there is no wiki. Qdrant only backs
	// semantic search and the Loremaster, so its absence degrades rather than
	// fails (SPEC.md #4.1, #11).
	const status = !dbOk ? 'down' : qdrantOk ? 'ok' : 'degraded';

	return json(
		{
			status,
			version: env.APP_VERSION ?? 'unknown',
			commit: env.APP_COMMIT ?? 'unknown',
			db: dbOk,
			qdrant: qdrantOk
		},
		{ status: dbOk ? 200 : 503 }
	);
};
