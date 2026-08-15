/**
 * The bench talks to a real gateway and a real database, which is the whole point of it,
 * so it refuses to start rather than quietly measuring nothing. Every runner in this
 * package goes through here.
 *
 * `.env` at the repo root is read by hand: this package is driven by `tsx`, not by Vite,
 * so there is no `$env/dynamic/private` and no dotenv dependency. Values already present
 * in the environment win, so a one-off `AI_GATEWAY_API_KEY=... pnpm --filter @canonry/bench models`
 * behaves the way anyone would expect.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** packages/bench/src -> repo root. Also correct from dist/, which is one level deeper in
 * the same shape, because both resolve two directories up to packages/bench. */
export const packageRoot = path.resolve(here, '..');
export const repoRoot = path.resolve(packageRoot, '..', '..');

let loaded = false;

export function loadEnv(): void {
	if (loaded) return;
	loaded = true;
	let raw: string;
	try {
		raw = readFileSync(path.join(repoRoot, '.env'), 'utf8');
	} catch {
		return;
	}
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		if (process.env[key] !== undefined) continue;
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		process.env[key] = value;
	}
}

export function requireEnv(key: string): string {
	loadEnv();
	const value = process.env[key];
	if (value === undefined || value.length === 0) {
		throw new Error(
			`${key} is not set. The bench measures real models against a real database; ` +
				'there is no offline mode, because a number produced without either would be a lie.'
		);
	}
	return value;
}

/** Where the bench writes everything it generates: built corpora, raw model responses,
 * reports. Gitignored, because a run is evidence for one afternoon and the conclusion is
 * what gets committed. */
export const dataDir = path.join(packageRoot, '.data');
