/**
 * One database handle for the server process. Route loaders import this rather than
 * constructing their own pool, so connection count stays a property of the process and
 * not of how many loaders happen to run.
 *
 * /healthz deliberately does not use this: a health check has to keep answering when
 * the app is misconfigured, so it opens its own single connection.
 */
import { env } from '$env/dynamic/private';
import { createDb, type Db } from '@canonry/db';

let handle: Db | undefined;

export function db(): Db {
	if (handle) return handle;
	if (!env.DATABASE_URL) {
		throw new Error('DATABASE_URL is not set, so there is no canon to read');
	}
	handle = createDb(env.DATABASE_URL);
	return handle;
}
