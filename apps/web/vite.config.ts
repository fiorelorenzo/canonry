import { defineConfig } from 'vitest/config';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

// `.env` lives at the workspace root (this app has none of its own), but SvelteKit's
// `kit.env.dir` defaults to `process.cwd()`, and `pnpm --filter web dev` (like every pnpm
// script) runs with cwd set to this package's own directory. Left at the default, `$env/
// dynamic/private` never finds the root `.env` at all - not just STAFF_EMAILS, every key in
// it - and the app only ever sees whatever this file seeds below (issue #265). Pointing it
// here is what makes the root `.env` reachable in the first place.
const workspaceRoot = path.resolve(import.meta.dirname, '..', '..');

// Route-loader tests (src/routes/p/leak.test.ts calls the real +page.server.ts/
// +layout.server.ts `load` functions) go through `$lib/server/db.ts`'s `db()`, which reads
// `$env/dynamic/private`. SvelteKit's Vite plugin snapshots that from `process.env` via
// `loadEnv()` once, during config resolution - before any test file's own code runs - so a
// fallback set inside a test module is too late. Setting it here, before the config below
// is even passed to Vite, is what makes those tests pass under a plain `pnpm test` with no
// environment configured, matching every other integration test in this repo, which
// already assumes a local Postgres at 127.0.0.1:55432.
//
// Gated on `VITEST` (the same flag @sveltejs/kit's own plugin checks in its `config` hook)
// because vite's `loadEnv()` makes `process.env` win over the same key in a `.env` file by
// design - so setting these unconditionally shadowed a real STAFF_EMAILS (or DATABASE_URL,
// or BETTER_AUTH_SECRET) in the workspace-root `.env` under `pnpm dev`, and `requireAdmin`
// answers 404 for a misconfigured allowlist exactly the same way it does for a correct one,
// which is indistinguishable by design (issue #265). `vite dev`/`vite build`/`vite preview`
// never set `VITEST`, so none of them touch `process.env` here, and the workspace `.env` -
// now actually reachable via `workspaceRoot` above - decides these three keys the normal way.
if (process.env.VITEST === 'true') {
	process.env.DATABASE_URL ??=
		process.env.TEST_DATABASE_URL ??
		(process.env.TEST_DB_SUFFIX
			? `postgres://canonry:canonry@127.0.0.1:55432/canonry_test_${process.env.TEST_DB_SUFFIX}`
			: 'postgres://canonry:canonry@127.0.0.1:55432/canonry');
	// Issue #120: hooks.server.ts imports $lib/server/auth.ts, which throws at module load
	// with no BETTER_AUTH_SECRET (issue #86's own fail-loud guard) - a test that imports the
	// hook (src/hooks.server.test.ts) cannot even load without one, and CI's test job has no
	// real secret configured. Signs nothing that outlives this process; never used outside a
	// test run.
	process.env.BETTER_AUTH_SECRET ??= 'vitest-throwaway-secret-not-a-real-deployment';
	// Issue #235: params-merge.test.ts calls /admin/models' `actions.text`/`actions.image`
	// directly, and `requireAdmin` (src/lib/server/admin.ts) 404s unless the session's email
	// is on this allowlist - same snapshot-timing reason as BETTER_AUTH_SECRET above, so it
	// has to be set here rather than in the test file. Not a real staff account; nothing
	// outside a test run ever authenticates as it.
	process.env.STAFF_EMAILS ??= 'admin-models-test@canonry.invalid';
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			env: { dir: workspaceRoot },
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		// The server-side tests call real route loaders against a real database, so the
		// database has to exist and be migrated before any of them run, whatever order the
		// packages happen to execute in.
		globalSetup: ['src/test-global-setup.ts'],
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
