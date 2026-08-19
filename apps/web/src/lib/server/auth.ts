/**
 * Better Auth 1.6.27 (issue #86). One eager, module-level instance: `betterAuth(...)`
 * runs the moment this module is first imported (from `hooks.server.ts`, at process
 * boot), so a misconfigured secret or a social provider missing its half of a
 * client id/secret pair throws before the server accepts a single request rather than
 * failing the first sign-in attempt. "Half-working" - a provider silently absent from
 * the sign-in screen because its secret was forgotten - is exactly what that buys
 * against.
 *
 * The adapter and the SvelteKit mount both come from the installed package rather than
 * general Better Auth folklore: `drizzleAdapter` lives at `better-auth/adapters/drizzle`
 * in 1.6.27 (re-exported from the separate `@better-auth/drizzle-adapter` package), and
 * the SvelteKit integration needs no catch-all route file at all - `svelteKitHandler`
 * (mounted in hooks.server.ts) matches `/api/auth/*` against the raw request URL and
 * calls `auth.handler` directly, so there is nothing under `src/routes/api/auth` to
 * create. Verified by reading `node_modules/better-auth/dist/adapters/drizzle-adapter`
 * and `node_modules/better-auth/dist/integrations/svelte-kit.d.mts` in this checkout,
 * not assumed from a blog post.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { ensureBilling } from '@canonry/db';
import { account, session, user, verification } from '@canonry/db/schema';
import { db } from './db';
import { buildMailTransport } from './mail/transport.js';
import { makeSendResetPassword } from './mail/reset-password.js';

interface SocialProviderEnvVars {
	idVar: string;
	secretVar: string;
}

// Every provider this deployment knows how to wire up. Adding a third provider is one
// entry here, nothing else - the loop below and the fail-loud check are provider-agnostic.
const SOCIAL_PROVIDER_ENV: Record<string, SocialProviderEnvVars> = {
	github: { idVar: 'GITHUB_CLIENT_ID', secretVar: 'GITHUB_CLIENT_SECRET' },
	google: { idVar: 'GOOGLE_CLIENT_ID', secretVar: 'GOOGLE_CLIENT_SECRET' }
};

export class MissingSocialProviderSecretError extends Error {
	constructor(provider: string, idVar: string, secretVar: string) {
		super(
			`${idVar} is set but ${secretVar} is not: social sign-in with "${provider}" would ` +
				`start and then fail on every callback. Set both or neither - a half-configured ` +
				`provider never ships silently disabled.`
		);
		this.name = 'MissingSocialProviderSecretError';
	}
}

/**
 * Reads every social provider configured from the environment, throwing loudly the
 * moment one has a client id but no matching secret rather than quietly dropping it
 * from the sign-in screen (issue #86: "failing loudly at startup ... rather than
 * half-working"). A provider whose id var is unset is simply not offered - that is a
 * deployment choice, not a misconfiguration.
 */
export function buildSocialProviders(
	vars: NodeJS.ProcessEnv
): Record<string, { clientId: string; clientSecret: string }> {
	const providers: Record<string, { clientId: string; clientSecret: string }> = {};
	for (const [provider, { idVar, secretVar }] of Object.entries(SOCIAL_PROVIDER_ENV)) {
		const clientId = vars[idVar];
		if (!clientId) continue;
		const clientSecret = vars[secretVar];
		if (!clientSecret) throw new MissingSocialProviderSecretError(provider, idVar, secretVar);
		providers[provider] = { clientId, clientSecret };
	}
	return providers;
}

// Eager everywhere except during a build. SvelteKit's postbuild analysis imports every
// server module to work out which routes are prerenderable, with no environment behind it,
// so a module-level throw here fails `vite build` and therefore CI, which has no secrets
// and should not need any to compile the app. `building` is the framework's own answer to
// exactly this: refuse at process boot, stay quiet while the bundler is reading.
if (!building && !env.BETTER_AUTH_SECRET) {
	throw new Error(
		"BETTER_AUTH_SECRET is not set: sessions cannot be signed without it, and Better Auth's " +
			'own insecure built-in default is not an acceptable fallback for a real deployment.'
	);
}

export const auth = betterAuth({
	baseURL: env.BETTER_AUTH_URL ?? env.ORIGIN,
	// Better Auth refuses to construct without a secret, and construction happens at import,
	// which the bundler does. During a build the value is irrelevant and never signs
	// anything: the guard above has already established that a real process without a real
	// secret dies before it serves a request.
	secret: env.BETTER_AUTH_SECRET ?? (building ? 'build-only-placeholder-never-signs' : undefined),
	database: drizzleAdapter(db(), {
		provider: 'pg',
		// Better Auth's own table/column names, already the exact shape packages/db/src/
		// schema/auth.ts carries (see that file's own doc comment) - usePlural defaults to
		// false, which matches the singular `user`/`session`/`account`/`verification` names.
		schema: { user, session, account, verification }
	}),
	emailAndPassword: {
		enabled: true,
		// #151: the forgotten-password link the sign-in form already carries. The actual
		// loud-vs-silent-failure handling lives in ./mail/reset-password.ts's own doc
		// comment, not here - this line only wires the transport in.
		sendResetPassword: makeSendResetPassword({ db: db(), transport: buildMailTransport(env) })
	},
	socialProviders: buildSocialProviders(env),
	databaseHooks: {
		user: {
			create: {
				// SPEC.md §15: a stated, finite ceiling from the account's first moment, not
				// a page that quietly assumes one exists later. Runs after the user row's own
				// transaction commits (Better Auth's own hook contract), so it cannot see or
				// join that transaction - a second, separate write is the correct shape here,
				// not a workaround.
				after: async (createdUser) => {
					await ensureBilling(db(), createdUser.id);
				}
			}
		}
	}
});

export type Auth = typeof auth;
