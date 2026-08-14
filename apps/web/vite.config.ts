import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

// Route-loader tests (src/routes/p/leak.test.ts calls the real +page.server.ts/
// +layout.server.ts `load` functions) go through `$lib/server/db.ts`'s `db()`, which reads
// `$env/dynamic/private`. SvelteKit's Vite plugin snapshots that from `process.env` via
// `loadEnv()` once, during config resolution - before any test file's own code runs - so a
// fallback set inside a test module is too late. Setting it here, before the config below
// is even passed to Vite, is what makes those tests pass under a plain `pnpm test` with no
// environment configured, matching every other integration test in this repo, which
// already assumes a local Postgres at 127.0.0.1:55432.
// TEST_DATABASE_URL comes first because that is the variable CI sets and the one every
// package's own test harness already reads, and CI's Postgres is not on this box's dev port.
process.env.DATABASE_URL ??=
	process.env.TEST_DATABASE_URL ?? 'postgres://canonry:canonry@127.0.0.1:55432/canonry';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
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
