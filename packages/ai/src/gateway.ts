/**
 * Constructs the Cloudflare AI Gateway provider (issue #97). Every model call
 * this package makes - text, image, everything - goes through here so it
 * lands in the gateway's logs and cost view. There is deliberately no path
 * that talks to a provider directly: a silent fallback is the exact failure
 * this issue exists to prevent, so a missing credential throws rather than
 * degrading.
 */
import { createAiGateway, type AiGateway } from 'ai-gateway-provider';

export interface GatewayCredentials {
	accountId: string;
	gateway: string;
	apiKey: string;
	/**
	 * Overrides the Replicate REST proxy host only (`replicateGatewayBaseUrl`
	 * in this file, used by replicate.ts) - tests only, production never sets
	 * this. The text-generation path (`createGateway` below) always talks to
	 * the real Cloudflare host; see the comment there for why it cannot be
	 * redirected.
	 */
	baseUrl?: string;
}

export class MissingGatewayEnvError extends Error {
	constructor(varName: string) {
		super(
			`missing required env var ${varName}: Cloudflare AI Gateway routing cannot start without it. ` +
				`Refusing to fall back to a direct provider call - that silent fallback is what issue #97 exists to prevent.`
		);
		this.name = 'MissingGatewayEnvError';
	}
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name];
	if (!value) throw new MissingGatewayEnvError(name);
	return value;
}

export function readGatewayCredentials(env: NodeJS.ProcessEnv = process.env): GatewayCredentials {
	const accountId = requireEnv(env, 'AI_GATEWAY_ACCOUNT_ID');
	const gateway = requireEnv(env, 'AI_GATEWAY_NAME');
	const apiKey = requireEnv(env, 'AI_GATEWAY_API_KEY');
	const baseUrl = env.AI_GATEWAY_BASE_URL;
	return baseUrl ? { accountId, gateway, apiKey, baseUrl } : { accountId, gateway, apiKey };
}

/** The real, hardcoded Cloudflare AI Gateway host. */
export const CLOUDFLARE_GATEWAY_HOST = 'https://gateway.ai.cloudflare.com';

/**
 * ai-gateway-provider 4.0.0's API-key path hardcodes the universal-endpoint
 * host inside `AiGatewayChatLanguageModel.processModelRequest`
 * (node_modules/ai-gateway-provider/dist/index.mjs): the final POST is
 * `fetch(\`https://gateway.ai.cloudflare.com/v1/${accountId}/${gateway}\`, ...)`
 * against the *global* `fetch`, and `AiGatewaySettings` has no `baseURL` or
 * `fetch` field to override it - the only `fetch` in that settings object is
 * the *binding* path's `run()`, a different auth mode entirely. The per-model
 * `config.fetch` hook exists too, but it only captures what the underlying
 * provider (openai.chat(...), etc.) would have sent; that captured request is
 * never actually dispatched, only the final gateway POST is.
 *
 * So there is no injectable seam for redirecting this path, and this module
 * does not invent one: `createGateway` always talks to the real Cloudflare
 * host. AI_GATEWAY_BASE_URL does not apply here - it exists for the
 * Replicate REST path below, which builds its own URL and needs no library
 * cooperation. gateway.test.ts covers this path by stubbing `globalThis.fetch`
 * directly for the duration of a test, not by giving production code a
 * redirect switch.
 */
export function createGateway(
	credentials: GatewayCredentials = readGatewayCredentials()
): AiGateway {
	return createAiGateway({
		accountId: credentials.accountId,
		gateway: credentials.gateway,
		apiKey: credentials.apiKey
	});
}

/**
 * The gateway's provider-specific REST proxy path for Replicate
 * (`/v1/{account}/{gateway}/replicate`, SPEC 11.1), used directly by
 * replicate.ts because ai-gateway-provider ships no Replicate model factory -
 * see replicate.ts for why.
 */
export function replicateGatewayBaseUrl(credentials: GatewayCredentials): string {
	const host = credentials.baseUrl ?? CLOUDFLARE_GATEWAY_HOST;
	return `${host}/v1/${credentials.accountId}/${credentials.gateway}/replicate`;
}
