/**
 * Audio providers, behind an interface (#68, mirroring ../provider.ts's ImageProvider
 * seam for #66/#70). Two implementations: ElevenLabs for the real generation, and a fake
 * for tests - the fake returns a small real WAV tone instead of pretending to be
 * ElevenLabs' output, so the decompose/cache/generate/store pipeline is provable without
 * spending a real credit on every test run.
 *
 * ElevenLabs' actual product for this feature is its sound-generation endpoint
 * (`/v1/sound-generation`, model `eleven_text_to_sound_v2`) - a text-to-SFX call, not
 * text-to-speech. `@ai-sdk/elevenlabs` only exposes `speech` and `transcription` models,
 * so this cannot go through @canonry/ai's createLanguageModel or the AI SDK at all, and
 * Vercel AI Gateway (this codebase's gateway for text and embeddings) has no
 * sound-generation coverage regardless. This provider goes straight to
 * `https://api.elevenlabs.io/v1/sound-generation` with the `xi-api-key` header
 * (https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) - a
 * deliberate, narrow exception to routing every model call through one gateway, the same
 * carve-out made for Replicate images. Verified live 2026-08-15 against the real API -
 * see this package's report for the exact request/response.
 */
import { chargeFor, type ModelCallAgent } from '@canonry/ai';
import { previewCharge, recordAndCharge, type Db } from '@canonry/db';
import { ProviderLimiter } from '../concurrency.js';

export interface GeneratedAudio {
	bytes: Uint8Array;
	mimeType: string;
}

export interface AudioGenerateInput {
	/** The layer's own SFX prompt, e.g. "gentle rain falling on leaves" - never the whole
	 * scene description (composed upstream, see layers.ts). */
	prompt: string;
	/** Whether this layer must loop seamlessly (a continuous layer) - ElevenLabs' own
	 * `loop` parameter, and part of the SFX cache's filter (cache.ts) since a looping and
	 * a non-looping render of "rain" are not interchangeable. */
	loop: boolean;
	userId: string;
	/** Nullable for a system-attributed call with no particular universe - mirrors
	 * ../provider.ts's GenerateImageInput.universeId exactly, and model_call's own
	 * universe_id column, which is nullable for the same reason. generateAmbientPack
	 * (generate.ts) always passes a real universe id in practice. */
	universeId: string | null;
	/** Always 'audio.layer' in production - threaded through rather than hardcoded so a
	 * test can point it at a scratch operation_price row. */
	operation: string;
}

export interface AudioProvider {
	generate(input: AudioGenerateInput): Promise<GeneratedAudio>;
}

export class MissingElevenLabsEnvError extends Error {
	constructor() {
		super(
			'missing required env var ELEVENLABS_API_KEY: ambient layer generation calls ' +
				'ElevenLabs directly and cannot authenticate without it.'
		);
		this.name = 'MissingElevenLabsEnvError';
	}
}

export function readElevenLabsApiToken(env: NodeJS.ProcessEnv = process.env): string {
	const token = env.ELEVENLABS_API_KEY;
	if (!token) throw new MissingElevenLabsEnvError();
	return token;
}

export class ElevenLabsRequestError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(`ElevenLabs request failed with status ${status}: ${message}`);
		this.name = 'ElevenLabsRequestError';
	}
}

/** Real ElevenLabs host by default; overridable via ElevenLabsAudioProviderDeps.baseUrl
 * so tests can point this at a local HTTP stub instead of the network - the same
 * test-only override replicate.ts's own path threads through. */
const ELEVENLABS_API_BASE_URL = 'https://api.elevenlabs.io';

function elevenLabsSoundGenerationUrl(baseUrl: string): string {
	return `${baseUrl}/v1/sound-generation?output_format=mp3_44100_128`;
}

export const ELEVENLABS_PROVIDER = 'elevenlabs';
export const ELEVENLABS_MODEL_ID = 'eleven_text_to_sound_v2';

/**
 * Charges and records one provider call without going through @canonry/ai's withQuota,
 * because withQuota needs a ResolvedModel typed to ModelPurpose
 * ('cheap'|'premium'|'multimodal'|'embedding'|'image'), and ElevenLabs' sound-generation
 * call is none of those - there is no DB-driven audio model config either (SPEC.md §8.2
 * names no admin-switchable audio model the way §9 does for images). Composed instead
 * from the same two primitives withQuota itself is built on - @canonry/ai's chargeFor and
 * @canonry/db's previewCharge/recordAndCharge - so the guarantee is identical (refuse
 * before spending, one model_call row either way, never charged on failure) without
 * inventing a purpose that does not exist. costEur is always recorded as 0: ModelParams
 * has a currency-aware `pricePerImage` (issue #132) but no per-second-of-audio field yet,
 * and even a live call's real `character-cost` response header is denominated in
 * ElevenLabs credits, not a currency `toEur` knows how to convert - that needs the
 * account's plan rate, which nothing here has, so this stays 0 rather than guessing one.
 * #132 left room for this: a `pricePerSecond` field plus `currency: 'USD'` (ElevenLabs
 * quotes in dollars, the same currency this field already handles) fits in
 * `ModelParams`/whatever table ends up holding it without another migration, and
 * `computeCost` already knows how to convert whatever currency it declares - #116 is
 * wiring an audio model config up to that, not inventing a new conversion path. Tracked
 * by issue #116, not fixed here.
 */
async function chargeAndRecordLayer<T>(params: {
	db: Db;
	userId: string;
	universeId: string | null;
	agent: ModelCallAgent;
	operation: string;
	provider: string;
	modelId: string;
	fn: () => Promise<T>;
}): Promise<T> {
	const { credits } = await chargeFor(params.db, params.operation);
	await previewCharge(params.db, params.userId, credits);

	const startedAt = performance.now();
	const baseRecord = {
		userId: params.userId,
		universeId: params.universeId,
		agent: params.agent,
		operation: params.operation,
		provider: params.provider,
		modelId: params.modelId,
		inputTokens: 0,
		outputTokens: 0,
		embeddingTokens: 0,
		costEur: 0,
		requestId: null
	};

	try {
		const result = await params.fn();
		await recordAndCharge(params.db, {
			...baseRecord,
			credits,
			latencyMs: Math.round(performance.now() - startedAt)
		});
		return result;
	} catch (error) {
		// A failed call is still recorded (SPEC.md §15's "free to the user is not free to
		// us"), but never charged - the user is not billed for a layer that never came
		// back, exactly withQuota's own contract in @canonry/ai/src/quota.ts.
		await recordAndCharge(params.db, {
			...baseRecord,
			credits: 0,
			latencyMs: Math.round(performance.now() - startedAt)
		});
		throw error;
	}
}

export interface ElevenLabsAudioProviderDeps {
	db: Db;
	elevenLabsApiToken: string;
	/** Test-only override for ELEVENLABS_API_BASE_URL - points the request at a local
	 * HTTP stub instead of the real network (provider.test.ts). */
	baseUrl?: string;
	limiter: ProviderLimiter;
	agent: ModelCallAgent;
}

/**
 * The real path (#68, #70). Charges and previews the spend up front (one credited call
 * per layer, SPEC.md §8.1's "3 credits per generated layer" anchor), calls ElevenLabs
 * directly gated by the 'elevenlabs' concurrency slot (SPEC.md §8.1's "3 concurrent
 * requests" fixture, reusing ../concurrency.ts's ProviderLimiter rather than a second
 * one), and records the model_call row on success or failure.
 *
 * Verified live against the real ElevenLabs API (2026-08-15) - see this package's report
 * for the exact request/response: a real `eleven_text_to_sound_v2` call returns
 * decodable `audio/mpeg` for a given prompt within ElevenLabs' own 0.5-30s duration
 * window.
 */
export class ElevenLabsAudioProvider implements AudioProvider {
	constructor(private readonly deps: ElevenLabsAudioProviderDeps) {}

	async generate(input: AudioGenerateInput): Promise<GeneratedAudio> {
		return chargeAndRecordLayer({
			db: this.deps.db,
			userId: input.userId,
			universeId: input.universeId,
			agent: this.deps.agent,
			operation: input.operation,
			provider: ELEVENLABS_PROVIDER,
			modelId: ELEVENLABS_MODEL_ID,
			fn: () =>
				this.deps.limiter.run('elevenlabs', async () => {
					const baseUrl = this.deps.baseUrl ?? ELEVENLABS_API_BASE_URL;
					const response = await fetch(elevenLabsSoundGenerationUrl(baseUrl), {
						method: 'POST',
						headers: {
							'content-type': 'application/json',
							'xi-api-key': this.deps.elevenLabsApiToken
						},
						body: JSON.stringify({
							text: input.prompt,
							model_id: ELEVENLABS_MODEL_ID,
							prompt_influence: 0.8,
							loop: input.loop
						})
					});
					if (!response.ok) {
						// Body may echo the request text back; never let it reach the logger, only
						// the status code and a truncated length do (mirrors replicate.ts).
						const bodyText = await response.text();
						throw new ElevenLabsRequestError(response.status, `${bodyText.length} byte body`);
					}
					// ElevenLabs' sound-generation endpoint returns mp3 by default (audio/mpeg) -
					// never assume wav; ../storage.ts's EXTENSION_BY_MIME keys off this exact string.
					const mimeType = response.headers.get('content-type') ?? 'audio/mpeg';
					const bytes = new Uint8Array(await response.arrayBuffer());
					return { bytes, mimeType };
				})
		});
	}
}

/**
 * Encodes a short, real, decodable mono 16-bit PCM WAV tone - real RIFF/fmt/data chunks,
 * playable by the Web Audio API or any audio library, never a fabricated stub standing in
 * for bytes that were never real (same reasoning as ../provider.ts's tinyPngBytes). A pure
 * sine tone rather than silence so two different fake layers are audibly distinct, which
 * apps/web's table/audio browser demo (issue #69) relies on to actually hear a crossfade.
 */
export function tinyWavBytes(
	options: { frequencyHz?: number; durationSeconds?: number; sampleRate?: number } = {}
): Uint8Array {
	const sampleRate = options.sampleRate ?? 8000;
	const frequencyHz = options.frequencyHz ?? 440;
	const durationSeconds = options.durationSeconds ?? 0.3;
	const frameCount = Math.round(sampleRate * durationSeconds);

	const dataSize = frameCount * 2; // 16-bit mono: 2 bytes per sample
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	function writeString(offset: number, text: string): void {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	}

	writeString(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeString(8, 'WAVE');
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true); // fmt chunk size
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	writeString(36, 'data');
	view.setUint32(40, dataSize, true);

	// A short fade in/out avoids a click at the loop boundary, the same edge findLoopBoundaries
	// in the client player (../../../apps/web/src/lib/components/audio/ambient-player.ts) has
	// to work around for real provider output.
	const fadeFrames = Math.min(frameCount, Math.round(sampleRate * 0.01));
	for (let i = 0; i < frameCount; i++) {
		const t = i / sampleRate;
		let amplitude = 0.4;
		if (i < fadeFrames) amplitude *= i / fadeFrames;
		else if (i > frameCount - fadeFrames) amplitude *= (frameCount - i) / fadeFrames;
		const sample = Math.sin(2 * Math.PI * frequencyHz * t) * amplitude;
		view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
	}

	return new Uint8Array(buffer);
}

/** Deterministic, credential-free tone for tests and dev fixtures - the same prompt
 * always gets the same frequency, so two calls with the same prompt are trivially
 * comparable without the caller having to inspect audio bytes. */
function frequencyForPrompt(prompt: string): number {
	let hash = 0;
	for (let i = 0; i < prompt.length; i++) hash = (hash * 31 + prompt.charCodeAt(i)) | 0;
	return 220 + (Math.abs(hash) % 660); // 220-880 Hz, an audible, musical-ish range
}

/** Test double (#68's "test against a local fake that returns a real short audio
 * buffer"). Never touches the network, the gateway, credits or the database - it exists
 * so the decompose/cache/generate/store pipeline can be proven end to end without an
 * ElevenLabs credential, exactly like ../provider.ts's FakeImageProvider does for images.
 * Charging happens one level up, in generate.ts's chargeFor call, mirroring how the image
 * path's `credits` on each media_asset row comes from generate.ts rather than from
 * FakeImageProvider itself. */
export class FakeAudioProvider implements AudioProvider {
	public readonly calls: AudioGenerateInput[] = [];

	async generate(input: AudioGenerateInput): Promise<GeneratedAudio> {
		this.calls.push(input);
		return {
			bytes: tinyWavBytes({ frequencyHz: frequencyForPrompt(input.prompt) }),
			mimeType: 'audio/wav'
		};
	}
}
