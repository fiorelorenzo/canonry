/**
 * ElevenLabsAudioProvider against a local HTTP stub (mirrors ../../ai/src/replicate.test.ts's
 * own pattern for the sibling REST-proxy provider) - this box has no ELEVENLABS_API_KEY, so
 * the real ElevenLabs API itself is never reached. FakeAudioProvider and tinyWavBytes are
 * pure and need no server at all.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeDb, eq, inArray, type Db } from '@canonry/db';
import { modelCall, user, userBilling } from '@canonry/db/schema';
import type { GatewayCredentials } from '@canonry/ai';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProviderLimiter } from '../concurrency.js';
import {
	ELEVENLABS_MODEL_ID,
	ELEVENLABS_PROVIDER,
	ElevenLabsAudioProvider,
	ElevenLabsRequestError,
	FakeAudioProvider,
	tinyWavBytes
} from './provider.js';
import { openTestDb } from '../test-db.js';

const TEST_OPERATION = 'audio.layer';
const TEST_USER_IDS = ['test-user-audio-provider-1', 'test-user-audio-provider-2'];

function readWavHeader(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return {
		riff: String.fromCharCode(...bytes.slice(0, 4)),
		wave: String.fromCharCode(...bytes.slice(8, 12)),
		fmt: String.fromCharCode(...bytes.slice(12, 16)),
		audioFormat: view.getUint16(20, true),
		channels: view.getUint16(22, true),
		sampleRate: view.getUint32(24, true),
		bitsPerSample: view.getUint16(34, true),
		data: String.fromCharCode(...bytes.slice(36, 40))
	};
}

describe('tinyWavBytes (#68)', () => {
	it('encodes a real, valid, decodable mono 16-bit PCM WAV file', () => {
		const bytes = tinyWavBytes();
		const header = readWavHeader(bytes);
		expect(header).toEqual({
			riff: 'RIFF',
			wave: 'WAVE',
			fmt: 'fmt ',
			audioFormat: 1, // PCM
			channels: 1,
			sampleRate: 8000,
			bitsPerSample: 16,
			data: 'data'
		});
		// Real audio, not silence or an empty buffer - some sample is non-zero.
		const samples = new Int16Array(
			bytes.buffer,
			bytes.byteOffset + 44,
			(bytes.byteLength - 44) / 2
		);
		expect(Array.from(samples).some((sample) => sample !== 0)).toBe(true);
	});

	it('honours a requested duration and sample rate', () => {
		const bytes = tinyWavBytes({ durationSeconds: 1, sampleRate: 4000 });
		const header = readWavHeader(bytes);
		expect(header.sampleRate).toBe(4000);
		expect(bytes.byteLength).toBe(44 + 4000 * 2);
	});
});

describe('FakeAudioProvider (#68)', () => {
	it('returns a real decodable WAV, records every call, never touches credits', async () => {
		const provider = new FakeAudioProvider();
		const audio = await provider.generate({
			prompt: 'gentle rain falling on leaves',
			loop: true,
			userId: 'user-1',
			universeId: 'universe-1',
			operation: TEST_OPERATION
		});

		expect(audio.mimeType).toBe('audio/wav');
		expect(readWavHeader(audio.bytes).riff).toBe('RIFF');
		expect(provider.calls).toHaveLength(1);
		expect(provider.calls[0]?.loop).toBe(true);
	});

	it('gives two different prompts audibly different tones (deterministic per prompt)', async () => {
		const provider = new FakeAudioProvider();
		const rain = await provider.generate({
			prompt: 'gentle rain falling on leaves',
			loop: true,
			userId: 'user-1',
			universeId: 'universe-1',
			operation: TEST_OPERATION
		});
		const thunder = await provider.generate({
			prompt: 'distant thunder rumble',
			loop: false,
			userId: 'user-1',
			universeId: 'universe-1',
			operation: TEST_OPERATION
		});
		expect(Array.from(rain.bytes)).not.toEqual(Array.from(thunder.bytes));
	});
});

describe('ElevenLabsAudioProvider (#68, against a local gateway-proxy stub)', () => {
	let db: Db;
	let server: http.Server;
	let baseUrl: string;
	let requests: Array<{
		method: string | undefined;
		url: string | undefined;
		headers: http.IncomingHttpHeaders;
		body: string;
	}>;
	let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;

	beforeAll(async () => {
		db = openTestDb();
		await db
			.insert(user)
			.values(
				TEST_USER_IDS.map((id) => ({
					id,
					name: 'Test User',
					email: `${id}@canonry.invalid`,
					emailVerified: true
				}))
			)
			.onConflictDoNothing();
	});

	afterAll(async () => {
		await db.delete(modelCall).where(inArray(modelCall.userId, TEST_USER_IDS));
		await db.delete(userBilling).where(inArray(userBilling.userId, TEST_USER_IDS));
		await db.delete(user).where(inArray(user.id, TEST_USER_IDS));
		await closeDb(db);
	});

	beforeEach(async () => {
		requests = [];
		respond = (_req, res) => {
			res.setHeader('content-type', 'audio/mpeg');
			res.end(Buffer.from('fake-mp3-bytes'));
		};
		server = http.createServer((req, res) => {
			let body = '';
			req.on('data', (chunk) => (body += chunk));
			req.on('end', () => {
				requests.push({ method: req.method, url: req.url, headers: req.headers, body });
				respond(req, res);
			});
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	function credentials(): GatewayCredentials {
		return { accountId: 'acct-1', gateway: 'gw-1', apiKey: 'gateway-secret', baseUrl };
	}

	function providerFor(): ElevenLabsAudioProvider {
		return new ElevenLabsAudioProvider({
			db,
			credentials: credentials(),
			elevenLabsApiToken: 'elevenlabs-secret',
			limiter: new ProviderLimiter(),
			agent: 'media'
		});
	}

	it('posts to the gateway ElevenLabs proxy path with both auth headers, and charges audio.layer', async () => {
		const userId = TEST_USER_IDS[0]!;
		const audio = await providerFor().generate({
			prompt: 'gentle rain falling on leaves',
			loop: true,
			userId,
			universeId: null,
			operation: TEST_OPERATION
		});

		expect(audio.mimeType).toBe('audio/mpeg');
		expect(Buffer.from(audio.bytes).toString()).toBe('fake-mp3-bytes');

		expect(requests).toHaveLength(1);
		const request = requests[0]!;
		expect(request.method).toBe('POST');
		expect(request.url).toBe(
			'/v1/acct-1/gw-1/elevenlabs/v1/sound-generation?output_format=mp3_44100_128'
		);
		expect(request.headers['xi-api-key']).toBe('elevenlabs-secret');
		expect(request.headers['cf-aig-authorization']).toBe('Bearer gateway-secret');
		const body = JSON.parse(request.body) as Record<string, unknown>;
		expect(body).toEqual({
			text: 'gentle rain falling on leaves',
			model_id: ELEVENLABS_MODEL_ID,
			prompt_influence: 0.8,
			loop: true
		});

		const rows = await db.select().from(modelCall).where(eq(modelCall.userId, userId));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.provider).toBe(ELEVENLABS_PROVIDER);
		expect(rows[0]?.modelId).toBe(ELEVENLABS_MODEL_ID);
		expect(rows[0]?.operation).toBe(TEST_OPERATION);
		expect(rows[0]?.credits).toBeCloseTo(3, 6); // the real seeded audio.layer price
	});

	it('records a row and rethrows on a non-2xx response, without charging', async () => {
		respond = (_req, res) => {
			res.statusCode = 422;
			res.end('rejected: disallowed content');
		};
		const userId = TEST_USER_IDS[1]!;

		await expect(
			providerFor().generate({
				prompt: 'a forbidden sound',
				loop: false,
				userId,
				universeId: null,
				operation: TEST_OPERATION
			})
		).rejects.toBeInstanceOf(ElevenLabsRequestError);

		const rows = await db.select().from(modelCall).where(eq(modelCall.userId, userId));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.credits).toBe(0);
	});
});
