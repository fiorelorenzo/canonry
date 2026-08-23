/**
 * What ElevenLabs' sound-generation endpoint does when it is pushed past the account's
 * limit (#337).
 *
 *   ELEVENLABS_API_KEY=... pnpm --filter @canonry/bench audio-throttle
 *
 * `generateImage` retries a Replicate 429 in place because #334 captured a real one and
 * read `Retry-After` off it. `ElevenLabsAudioProvider.generate` had no such capture, so
 * it retried nothing, and #337 was blocked on getting one rather than on writing the
 * retry. This is the run that produced it; the report is the sound-generation section of
 * `docs/models.md`.
 *
 * **This spends real ElevenLabs credits**, one sound generation per request that is not
 * refused, so it is deliberately one wave and it prints what it cost from the provider's
 * own `character-cost` header rather than from a rate and a duration.
 *
 * The shape of the wave comes from the provider's documentation rather than from a guess.
 * ElevenLabs' limit is **concurrency, not requests per minute**
 * (https://elevenlabs.io/docs/overview/models#concurrency-and-priority), so a paced burst
 * of the kind that provoked Replicate's 429 would never provoke this one: the requests
 * have to be in flight at the same moment, which is why this fires them all at once and
 * does not pace them at all.
 *
 * The request is the product's own, byte for byte: same URL, same headers, same body as
 * `ElevenLabsAudioProvider.generate` builds, down to `duration_seconds` and
 * `prompt_influence`. A cheaper 0.5 second clip would have cost a tenth as much and left
 * a real doubt behind, since a shorter generation holds its concurrency slot for a
 * shorter time and the whole probe depends on the slots overlapping.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir, requireEnv } from '../env.js';

/** Kept in step with packages/media/src/audio/provider.ts by hand. Importing @canonry/media
 * would drag a database and a ProviderLimiter into a probe that needs neither, and the
 * point of this file is to show the request in full rather than to compose it. */
const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128';
const ELEVENLABS_MODEL_ID = 'eleven_text_to_sound_v2';
const AUDIO_DURATION_SECONDS = 5;

/**
 * How many requests go out at once, and the only number in this file that had to be
 * argued for rather than read off something.
 *
 * The account is on the `payg` tier, which ElevenLabs' own per-plan concurrency table
 * (https://elevenlabs.io/docs/overview/models#concurrency-and-priority) does not list at
 * all: it names Free, Starter, Creator, Pro, Scale, Business and Enterprise, and the
 * highest non-Enterprise limit on the two columns a generative audio endpoint could
 * plausibly sit in is 15. The documented way to find the real number instead of inferring
 * it is the `current-concurrent-requests` and `maximum-concurrent-requests` response
 * headers, and a first probe (2026-08-23) found that `/v1/sound-generation` sends neither:
 * its `access-control-expose-headers` names `character-cost` and nothing else.
 *
 * So 12 is chosen to clear every plan this account could possibly be on except the two
 * 15-slot ones and Enterprise, in one wave, while staying a burst rather than a load test.
 * It is not a measurement and this comment is not pretending it is one; what it buys is a
 * single decisive answer to "does this endpoint refuse or does it queue", which is the
 * only question #337 needed to settle.
 */
const CONCURRENT_REQUESTS = 12;

/** A real ambient layer's prompt rather than a test string, because the endpoint is a
 * generative one and a nonsense prompt is a different request from the product's. */
const PROMPT = 'gentle rain falling on leaves';

interface Attempt {
	label: string;
	status: number;
	headers: Record<string, string>;
	/** Only for a non-2xx: a refusal's body is the evidence. A 2xx body is audio and is
	 * never kept, only its length. */
	body: string | null;
	bodyBytes: number;
	characterCost: string | null;
	startedAtMs: number;
	elapsedMs: number;
}

/** Redacts the API key out of anything the provider hands back. Nothing ElevenLabs sends
 * should carry it, but this run's whole output is meant to be pasted into an issue and a
 * report, so it never leaves the process in one piece regardless of what comes back. */
type Redact = (value: string) => string;

async function soundGeneration(
	token: string,
	redact: Redact,
	label: string,
	runStartedAt: number
): Promise<Attempt> {
	const startedAt = Date.now();
	const response = await fetch(ELEVENLABS_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'xi-api-key': token },
		body: JSON.stringify({
			text: PROMPT,
			model_id: ELEVENLABS_MODEL_ID,
			prompt_influence: 0.8,
			loop: true,
			duration_seconds: AUDIO_DURATION_SECONDS
		})
	});

	const headers: Record<string, string> = {};
	for (const [key, value] of response.headers) headers[key] = redact(value);
	const common = {
		label,
		status: response.status,
		headers,
		characterCost: response.headers.get('character-cost'),
		startedAtMs: startedAt - runStartedAt,
		elapsedMs: 0
	};

	if (response.ok) {
		const audio = await response.arrayBuffer();
		return {
			...common,
			body: null,
			bodyBytes: audio.byteLength,
			elapsedMs: Date.now() - startedAt
		};
	}
	const body = redact(await response.text());
	return { ...common, body, bodyBytes: body.length, elapsedMs: Date.now() - startedAt };
}

async function main(): Promise<void> {
	const token = requireEnv('ELEVENLABS_API_KEY');
	const redact: Redact = (value) => value.split(token).join('<REDACTED ELEVENLABS_API_KEY>');
	const runStartedAt = Date.now();

	console.log(`probe: ${CONCURRENT_REQUESTS} concurrent sound generations, one wave`);
	const attempts = await Promise.all(
		Array.from({ length: CONCURRENT_REQUESTS }, (_unused, index) =>
			soundGeneration(token, redact, `request-${index + 1}`, runStartedAt)
		)
	);

	for (const attempt of attempts) {
		console.log(
			`  ${attempt.label}: ${attempt.status} after ${attempt.elapsedMs}ms ` +
				`(started +${attempt.startedAtMs}ms, character-cost ${attempt.characterCost ?? 'none'})`
		);
	}

	const refused = attempts.filter((attempt) => attempt.status !== 200);
	if (refused.length === 0) {
		console.log(
			`\nEvery one of ${CONCURRENT_REQUESTS} simultaneous requests was served. This endpoint ` +
				'queues past its concurrency limit rather than refusing, which is what the docs say ' +
				'it does. Not escalating to a bigger wave.'
		);
	}
	for (const attempt of refused) {
		console.log(`\n=== refused: ${attempt.label} ===`);
		console.log(`HTTP ${attempt.status}`);
		for (const [key, value] of Object.entries(attempt.headers)) console.log(`${key}: ${value}`);
		console.log('');
		console.log(attempt.body);
	}

	let credits = 0;
	for (const attempt of attempts) {
		const parsed = Number(attempt.characterCost);
		if (Number.isFinite(parsed)) credits += parsed;
	}
	console.log(`\ncost: ${credits} ElevenLabs credits over ${attempts.length} requests`);

	const outDir = path.join(dataDir, 'audio-throttle');
	mkdirSync(outDir, { recursive: true });
	const file = path.join(outDir, `${new Date(runStartedAt).toISOString()}.json`);
	writeFileSync(
		file,
		JSON.stringify({ startedAt: new Date(runStartedAt).toISOString(), attempts }, null, 2)
	);
	console.log(`\nwrote ${file}`);
}

await main();
