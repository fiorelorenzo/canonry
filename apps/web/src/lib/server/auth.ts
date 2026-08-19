/**
 * Better Auth 1.6.29 (issue #86). One instance for the process, built on first use rather
 * than at import (issue #307): `auth()` is the accessor, shaped exactly like
 * `$lib/server/db.ts`'s `db()`, and evaluating this module constructs nothing.
 *
 * It used to be an eager `export const auth = betterAuth(...)`, which meant `db()` ran at
 * import. SvelteKit's postbuild `analyse` step imports every built server chunk in a fresh
 * process to work out each route's options, so `vite build` needed a usable DATABASE_URL to
 * compile an app that never queried anything, and `apps/web/vite.config.ts` had to invent
 * one pointing at the shared dev database (#297). Nothing read it, which was luck rather
 * than design: the day a `betterAuth` option, plugin or adapter reads the database while
 * constructing, a build becomes a write against a database nobody chose.
 *
 * What #86 actually wanted from eagerness was failing loudly at boot rather than
 * half-working, and that survives without constructing anything: `assertAuthEnvironment`
 * runs at import, under the same `building` guard as before, and checks the two things that
 * can only be wrong through misconfiguration - a missing signing secret, and a social
 * provider with a client id but no secret. Both are pure environment reads. A real process
 * with a broken auth configuration still dies before it accepts a request; a build reads
 * neither.
 *
 * The adapter and the SvelteKit mount both come from the installed package rather than
 * general Better Auth folklore: `drizzleAdapter` lives at `better-auth/adapters/drizzle`
 * (re-exported from the separate `@better-auth/drizzle-adapter` package), and the SvelteKit
 * integration needs no catch-all route file at all - `svelteKitHandler` (mounted in
 * hooks.server.ts) matches `/api/auth/*` against the raw request URL and calls
 * `auth().handler` directly, so there is nothing under `src/routes/api/auth` to create.
 * Verified by reading `node_modules/better-auth/dist/adapters/drizzle-adapter` and
 * `node_modules/better-auth/dist/integrations/svelte-kit.d.mts` in this checkout, not
 * assumed from a blog post.
 */
import { betterAuth, type Auth as BetterAuthInstance, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { ensureBilling } from '@canonry/db';
import { account, session, user, verification } from '@canonry/db/schema';
import { db } from './db';
import { buildMailTransport } from './mail/transport.js';
import { makeSendResetPassword } from './mail/reset-password.js';
import { makeSendDeleteAccountVerification } from './mail/delete-account.js';

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

/**
 * Everything about the auth configuration that can only be wrong through misconfiguration,
 * checked without building anything. Called at import below, so a real process still dies
 * at boot rather than on the first sign-in attempt (issue #86: "failing loudly at startup
 * ... rather than half-working").
 *
 * `buildSocialProviders`'s result is discarded here on purpose: it is a pure read of the
 * environment whose only side effect is the throw, and `buildAuth` calls it again for real
 * when it actually needs the map.
 */
export function assertAuthEnvironment(vars: NodeJS.ProcessEnv): void {
	if (!vars.BETTER_AUTH_SECRET) {
		throw new Error(
			"BETTER_AUTH_SECRET is not set: sessions cannot be signed without it, and Better Auth's " +
				'own insecure built-in default is not an acceptable fallback for a real deployment.'
		);
	}
	buildSocialProviders(vars);
}

// Everywhere except during a build. SvelteKit's postbuild analysis imports every server
// module to work out which routes are prerenderable, with no environment behind it, so a
// module-level throw here fails `vite build` and therefore CI, which has no secrets and
// should not need any to compile the app. `building` is the framework's own answer to
// exactly this: refuse at process boot, stay quiet while the bundler is reading.
if (!building) assertAuthEnvironment(env);

/**
 * This deployment's Better Auth instance type, named through the package's own exported
 * generic rather than inferred off the factory below, so a consumer imports a contract and
 * not an implementation detail. `BetterAuthOptions` is the right instantiation because this
 * app passes no plugins and declares no `additionalFields`: `$Infer.Session.user` resolves
 * to the concrete `{ id, createdAt, updatedAt, email, emailVerified, name, image }` that
 * `app.d.ts` puts on `event.locals`, not to anything widened.
 */
export type Auth = BetterAuthInstance<BetterAuthOptions>;

function buildAuth(): Auth {
	const options: BetterAuthOptions = {
		baseURL: env.BETTER_AUTH_URL ?? env.ORIGIN,
		// No build-time placeholder any more: a build never reaches this function, and the
		// import-time guard above has already established that a real process without a real
		// secret dies before it serves a request.
		secret: env.BETTER_AUTH_SECRET,
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
		// #154: turns on Better Auth's /delete-user with the emailed-confirmation path -
		// off by default, because a signed-in session could otherwise destroy an account,
		// and every universe under it (`universe.owner_user_id` is `ON DELETE CASCADE`),
		// with one click and no way back. The loud-vs-silent-failure handling lives in
		// ./mail/delete-account.ts's own doc comment, same reasoning as sendResetPassword
		// above. `settings/account/+page.server.ts`'s requestDeletion action also passes
		// the account's current password on this same call, which Better Auth verifies
		// before it ever sends the mail (issue #154's own decision: a hijacked session
		// with neither the password nor the inbox gets neither step).
		user: {
			deleteUser: {
				enabled: true,
				sendDeleteAccountVerification: makeSendDeleteAccountVerification({
					db: db(),
					transport: buildMailTransport(env)
				})
			}
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
	};
	return betterAuth(options);
}

let instance: Auth | undefined;

/**
 * The process's one Better Auth instance, built the first time something asks for it. Every
 * caller goes through this rather than holding its own: the drizzle adapter it wraps shares
 * `db()`'s single handle, so connection count stays a property of the process.
 */
export function auth(): Auth {
	instance ??= buildAuth();
	return instance;
}
