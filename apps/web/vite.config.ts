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
// fallback set inside a test module is too late. Setting it inside the function below, before
// it returns the config object Vite actually resolves, is what makes those tests pass under a
// plain `pnpm test` with no environment configured, matching every other integration test in
// this repo, which already assumes a local Postgres at 127.0.0.1:55432.
//
// One gate, `VITEST`, and nothing else. It used to be two: DATABASE_URL and
// BETTER_AUTH_SECRET were also seeded for `command === 'build'`, because `vite build`'s own
// postbuild `analyse` step imports every server module in this same process and
// src/lib/server/auth.ts called `db()` and constructed `betterAuth(...)` at module scope, so
// a build with no `.env` died on a database URL it had no use for (issue #297). That module
// builds its instance lazily now (issue #307), so nothing a build evaluates reads either
// key and a build needs neither. Seeding them anyway cost more than it looks: the fallback
// named the shared dev database, so a build carried a connection string nobody chose, and a
// genuinely missing DATABASE_URL was indistinguishable from a configured one.
//
// `vite dev`, `vite build` and `vite preview` therefore never touch `process.env` here, and
// the workspace `.env` - reachable via `workspaceRoot` above - decides all three keys the
// normal way. Under `pnpm test` these three are test-only values: the secret signs nothing
// that outlives the run (issue #120's hooks.server.test.ts cannot even import the hook
// without one) and STAFF_EMAILS is not a real staff account (issue #235's
// params-merge.test.ts calls /admin/models' actions directly, and `requireAdmin` 404s
// unless the session's email is on this allowlist).
export default defineConfig(() => {
	if (process.env.VITEST === 'true') {
		process.env.DATABASE_URL ??=
			process.env.TEST_DATABASE_URL ??
			(process.env.TEST_DB_SUFFIX
				? `postgres://canonry:canonry@127.0.0.1:55432/canonry_test_${process.env.TEST_DB_SUFFIX}`
				: 'postgres://canonry:canonry@127.0.0.1:55432/canonry');
		process.env.BETTER_AUTH_SECRET ??= 'vitest-throwaway-secret-not-a-real-deployment';
		process.env.STAFF_EMAILS ??= 'admin-models-test@canonry.invalid';
	}

	return {
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
	};
});
