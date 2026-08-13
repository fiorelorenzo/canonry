import { generateText } from 'ai';
import { createOpenAI } from 'ai-gateway-provider/providers/openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGateway, MissingGatewayEnvError, readGatewayCredentials } from './gateway.js';

/** Minimal OpenAI-compatible chat completion body the gateway forwards back. */
function chatCompletionBody(content: string) {
	return JSON.stringify({
		id: 'chatcmpl-test',
		object: 'chat.completion',
		created: 1700000000,
		model: 'gpt-4o-mini',
		choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
		usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
	});
}

describe('readGatewayCredentials', () => {
	it('reads all four vars, base url optional', () => {
		const creds = readGatewayCredentials({
			AI_GATEWAY_ACCOUNT_ID: 'acct',
			AI_GATEWAY_NAME: 'gw',
			AI_GATEWAY_API_KEY: 'key',
			AI_GATEWAY_BASE_URL: 'http://localhost:1'
		} as unknown as NodeJS.ProcessEnv);
		expect(creds).toEqual({
			accountId: 'acct',
			gateway: 'gw',
			apiKey: 'key',
			baseUrl: 'http://localhost:1'
		});
	});

	it('omits baseUrl when not set', () => {
		const creds = readGatewayCredentials({
			AI_GATEWAY_ACCOUNT_ID: 'acct',
			AI_GATEWAY_NAME: 'gw',
			AI_GATEWAY_API_KEY: 'key'
		} as unknown as NodeJS.ProcessEnv);
		expect(creds).toEqual({ accountId: 'acct', gateway: 'gw', apiKey: 'key' });
	});

	it.each(['AI_GATEWAY_ACCOUNT_ID', 'AI_GATEWAY_NAME', 'AI_GATEWAY_API_KEY'])(
		'throws a MissingGatewayEnvError naming %s when it is absent',
		(missing) => {
			const env = {
				AI_GATEWAY_ACCOUNT_ID: 'acct',
				AI_GATEWAY_NAME: 'gw',
				AI_GATEWAY_API_KEY: 'key'
			} as Record<string, string>;
			delete env[missing];
			expect(() => readGatewayCredentials(env as unknown as NodeJS.ProcessEnv)).toThrow(
				MissingGatewayEnvError
			);
			expect(() => readGatewayCredentials(env as unknown as NodeJS.ProcessEnv)).toThrow(missing);
		}
	);
});

describe('createGateway against a stubbed global fetch', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends a text generation call to the real gateway URL with the expected authorization header, and nowhere else', async () => {
		const requests: Array<{ url: string; headers: Headers }> = [];
		const stub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : input.toString();
			const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
			requests.push({ url, headers });
			return new Response(chatCompletionBody('hello from the gateway'), {
				status: 200,
				headers: { 'cf-aig-step': '0', 'content-type': 'application/json' }
			});
		});
		vi.stubGlobal('fetch', stub);

		const gateway = createGateway({
			accountId: 'acct-1',
			gateway: 'gw-1',
			apiKey: 'super-secret-key'
		});
		const openai = createOpenAI({ apiKey: 'CF_TEMP_TOKEN' });

		const { text } = await generateText({
			model: gateway(openai.chat('gpt-4o-mini')),
			prompt: 'say hi'
		});

		expect(text).toBe('hello from the gateway');

		// Exactly one network call, and it went to the real gateway URL - nowhere else.
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe('https://gateway.ai.cloudflare.com/v1/acct-1/gw-1');
		expect(requests[0]?.headers.get('cf-aig-authorization')).toBe('Bearer super-secret-key');
	});
});
