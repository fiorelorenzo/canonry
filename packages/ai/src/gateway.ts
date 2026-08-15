/**
 * The AI Gateway every text and embedding call goes through (SPEC.md §11.1).
 *
 * This is **Vercel AI Gateway**, not Cloudflare's. The switch was taken deliberately once the
 * coverage was checked against what this product actually calls: Vercel routes language and
 * embedding models, including `google/gemini-embedding-001`, which is the multilingual model
 * §17's cross-language retrieval promise depends on and which nothing here could construct
 * before. It also charges no markup, and the credits already exist on the account.
 *
 * Two paths are deliberately **not** behind this gateway, and the exception is narrow and
 * written down rather than discovered: images go direct to Replicate and ambient sound goes
 * direct to ElevenLabs, because Vercel's gateway carries neither. What survives from the old
 * "one place for every call" rule is the part that mattered: every call, gateway or direct,
 * records itself in `model_call` with its real token counts and cost, and a missing credential
 * throws a named error instead of degrading into a silent direct call.
 *
 * Model ids are gateway slugs, `provider/model`, so the per-provider factory table this file
 * used to need for Cloudflare is gone: see composition.ts.
 */
import { createGateway as createVercelGateway, type GatewayProvider } from '@ai-sdk/gateway';

export interface GatewayCredentials {
	/** A Vercel AI Gateway key, `vck_...`. Project-scoped by preference: one key per product,
	 * so revoking one does not take the others down with it. */
	apiKey: string;
	/** Overrides the gateway host. Tests only, and unlike the Cloudflare implementation this
	 * one can honour it, because `@ai-sdk/gateway` exposes a `baseURL` rather than hardcoding
	 * the host inside its request path. */
	baseUrl?: string;
}

export class MissingGatewayEnvError extends Error {
	constructor(public readonly varName: string) {
		super(
			`missing required env var ${varName}: AI Gateway routing cannot start without it. ` +
				`Refusing to fall back to a direct provider call - a silent fallback is what issue #97 ` +
				`exists to prevent, and it would also bill the wrong account.`
		);
		this.name = 'MissingGatewayEnvError';
	}
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name];
	if (!value) throw new MissingGatewayEnvError(name);
	return value;
}

/**
 * Reads the gateway credential from the environment.
 *
 * `AI_GATEWAY_API_KEY` is the same variable name the Cloudflare implementation used, and that
 * is a trap worth naming: a stale Cloudflare token is a perfectly well-formed string that now
 * authenticates against nothing. A Vercel key starts `vck_`. `AI_GATEWAY_ACCOUNT_ID` and
 * `AI_GATEWAY_NAME` are gone; if a deployment still sets them, they are ignored.
 */
export function readGatewayCredentials(env: NodeJS.ProcessEnv = process.env): GatewayCredentials {
	const apiKey = requireEnv(env, 'AI_GATEWAY_API_KEY');
	const baseUrl = env.AI_GATEWAY_BASE_URL;
	return baseUrl ? { apiKey, baseUrl } : { apiKey };
}

/** Builds the gateway provider. Cheap: it holds configuration, not a connection, so callers
 * may construct one per request rather than sharing a singleton. */
export function createGateway(
	credentials: GatewayCredentials = readGatewayCredentials()
): GatewayProvider {
	return createVercelGateway(
		credentials.baseUrl
			? { apiKey: credentials.apiKey, baseURL: credentials.baseUrl }
			: { apiKey: credentials.apiKey }
	);
}

/**
 * Request-scoped bring-your-own-key, for issue #90: the shape a caller merges into
 * `providerOptions` so one call authenticates with a user's own provider credential instead of
 * the gateway's.
 *
 * Two things about this are worth knowing before trusting it with somebody's bill. Vercel's own
 * documentation states that when a BYOK credential **fails**, the gateway retries the request
 * with its system credentials, and that usage is billed to our credit balance rather than
 * refused. So a user's expired key does not produce an error the user sees, it produces a cost
 * we absorb, and #90's copy has to say so. And under Zero Data Retention, BYOK keys are skipped
 * by default unless the key is marked ZDR-compliant in the dashboard, because they run under
 * the user's own agreement with the provider rather than ours.
 */
export function byokProviderOptions(
	provider: string,
	apiKey: string
): { gateway: { byok: Record<string, Array<{ apiKey: string }>> } } {
	return { gateway: { byok: { [provider]: [{ apiKey }] } } };
}
