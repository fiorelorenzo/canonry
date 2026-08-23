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
 *
 * Two things measured live against the real API since that first probe changed what this
 * file does (issue #116, issue #233). First, ElevenLabs bills sound-generation per call,
 * not per prompt character: with an explicit `duration_seconds` it is 5.5 credits/second,
 * and with the field left unset (this provider's behaviour before #233) it is a flat 27
 * credits for whatever duration the model happens to pick - about one second in
 * measurement, the wrong artefact for a `loop`ing ambient bed. Second, the response's
 * `character-cost` header is the real bill - chargeAndRecordLayer reads and records it
 * rather than deriving a figure from a rate and a duration, which would be a second,
 * driftable model of ElevenLabs' own pricing living in this codebase.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { chargeFor, computeCost, type ModelCallAgent, type ModelParams } from '@canonry/ai';
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

/** Thrown instead of ElevenLabsRequestError when the account's own monthly credit cap is
 * what refused the call, not a transient or malformed-request failure - "you have run
 * out of monthly audio" and "ElevenLabs is broken" read identically as a generic request
 * error, and only one of them is this provider's problem to fix (issue #116). Detected
 * from ElevenLabs' own error body (https://elevenlabs.io/docs/eleven-api/resources/errors:
 * `detail.code`, or the older `detail.status` some responses still carry, both
 * `'quota_exceeded'`) rather than the HTTP status alone, which ElevenLabs has used
 * inconsistently for this case (401 in practice, 402 `payment_required` per the current
 * docs) - see isQuotaExceededResponseBody below. */
export class ElevenLabsQuotaExceededError extends Error {
	constructor() {
		super(
			"ElevenLabs refused the call because the account's monthly credit cap is spent - " +
				'this plan has no invoice fallback for going over, so refusing rather than ' +
				'overspending is the plan working as designed, not the service failing.'
		);
		this.name = 'ElevenLabsQuotaExceededError';
	}
}

/** True when a non-2xx ElevenLabs response body is the account's own quota exhaustion
 * rather than any other rejection - the one distinction ElevenLabsRequestError's status
 * code plus truncated body length deliberately cannot make (see its call site's comment
 * on why the body itself never reaches an error message). Never throws on a body that
 * fails to parse as the expected shape; that is just "not this case". */
function isQuotaExceededResponseBody(bodyText: string): boolean {
	try {
		const parsed = JSON.parse(bodyText) as { detail?: { code?: unknown; status?: unknown } };
		return parsed.detail?.code === 'quota_exceeded' || parsed.detail?.status === 'quota_exceeded';
	} catch {
		return false;
	}
}

/**
 * Thrown once `generateSound` below has retried a 429 as far as its bound allows and
 * ElevenLabs is still refusing (issue #337). Distinct from ElevenLabsRequestError, which
 * is a request ElevenLabs rejected on its merits, and from ElevenLabsQuotaExceededError,
 * which is the account's monthly cap and is never retried: this one says the account was
 * busy, not wrong, and the same call would probably work later.
 *
 * Measured live on 2026-08-23 (see `docs/models.md`'s sound-generation section for the
 * captured response): the refusal is a 429 whose body reads
 * `{"detail":{"type":"rate_limit_error","code":"concurrent_limit_exceeded", ...
 * "status":"too_many_concurrent_requests", ...}}`, and it carries **no `Retry-After`
 * header and no reset time anywhere in the response**, which is the whole reason the
 * backoff below is a number this codebase chose rather than one ElevenLabs sent.
 */
export class ElevenLabsThrottledError extends Error {
	constructor(
		public readonly attempts: number,
		public readonly waitedMs: number
	) {
		super(
			`ElevenLabs throttled sound generation (429) after ${attempts} attempt` +
				`${attempts === 1 ? '' : 's'} and ${waitedMs}ms of backoff`
		);
		this.name = 'ElevenLabsThrottledError';
	}
}

/**
 * How many times one sound generation may be attempted before it gives up as throttled,
 * and the first backoff it waits (issue #337). The schedule is
 * `base * 2^(attempt-1)` with half-and-half jitter, so 4 attempts spend between 2.6 and
 * 7.9 seconds waiting: 750/1500/3000ms nominal, each spread over half to one and a half
 * of itself.
 *
 * Both numbers are chosen here rather than read off the response, which is the one real
 * difference from replicate.ts's `THROTTLE_BUDGET_MS`. Replicate answers a 429 with
 * `Retry-After` and a `retry_after` body field, so #334's bound only had to decide how
 * many of Replicate's own numbers to honour. The live probe of #337 found ElevenLabs
 * sends neither, and no reset time in any other form, so there is nothing to honour and a
 * number copied from Replicate would be a guess wearing a measurement's clothes.
 *
 * What the probe did measure is the shape of the wait. The refusal is a **concurrency**
 * limit, four simultaneous generations on this account, and it comes back in about 240ms
 * having cost nothing, while a 5-second generation holds its slot for about 2.8 seconds.
 * So the thing being waited for is one in-flight generation finishing, and the schedule
 * above covers roughly two of them before giving up. The jitter is there because the
 * probe watched eight requests get refused in the same 30 milliseconds: a fixed schedule
 * would send everything that collided once back into the same collision.
 *
 * An attempt cap rather than a waited-time budget, because with the delays chosen here
 * rather than sent by the provider, the cap already bounds the wait, and a second
 * constant that can never be the binding one is a constant that goes stale unnoticed.
 */
export const ELEVENLABS_THROTTLE_MAX_ATTEMPTS = 4;
export const ELEVENLABS_THROTTLE_BASE_DELAY_MS = 750;

/** Thrown when a successful (2xx) sound-generation response is missing the
 * `character-cost` header, or carries one that does not parse as a number (issue #116).
 * Both are "fail loudly": recording the layer with providerCredits/costEur silently at 0
 * would misreport a real spend as free, which is worse than refusing the layer outright -
 * the header is the only source of truth this codebase has for what a call actually
 * cost, deliberately never derived from duration_seconds and a rate (see this file's own
 * header comment). */
export class ElevenLabsMissingCostHeaderError extends Error {
	constructor(headerValue: string | null) {
		super(
			headerValue === null
				? 'ElevenLabs sound-generation response is missing the character-cost header - ' +
						'refusing to record a layer whose real cost is unknown as if it cost nothing.'
				: "ElevenLabs sound-generation response's character-cost header is not a number: " +
						`"${headerValue}"`
		);
		this.name = 'ElevenLabsMissingCostHeaderError';
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

/** Sent as `duration_seconds` on every sound-generation call (issue #233). Left unset,
 * ElevenLabs bills a flat 27 credits and returns whatever duration it feels like -
 * measured at about 1.1s, a stutter rather than a bed for a `loop`ing ambient layer. An
 * explicit duration bills 5.5 credits/second instead (2s=11, 5s=27, 10s=55, 20s=110), so
 * 5 is the highest duration that costs no more than what this provider already pays: more
 * real audio for the same money, not a new spend. Whether a longer loop sounds better is
 * a question for Lorenzo's ears, not this constant - do not raise it without a listening
 * pass across a few lengths of the same prompt confirming it still loops cleanly. */
export const AUDIO_DURATION_SECONDS = 5;

/**
 * ElevenLabs' own price per credit on the account's current plan (issue #116), in the
 * same `ModelParams` shape #132 gave every other provider's price
 * (`currency` + a `pricePer*` rate, converted to euros at read time by `computeCost` -
 * see packages/ai/src/usage.ts). SPEC.md §8.2 names no admin-switchable audio model, so
 * unlike the four purposes `model_config` drives (SPEC.md §11.1), this stays a dated
 * constant rather than a database row - there is nothing for an admin to switch between.
 *
 * 0 is a measured fact about the account's plan, not "unknown": the account is on the
 * `payg` tier, the first 10,000 credits every month are already included in what is
 * being paid for, there is no invoice for going over
 * (`can_extend_character_limit: false`), and going over fails the call rather than
 * costing anything further (see ElevenLabsQuotaExceededError below). So the marginal
 * euro cost of a credit is genuinely zero today - `computeCost` still runs the
 * multiplication, it just multiplies by a real, measured zero, which is why
 * `chargeAndRecordLayer` also records the raw `providerCredits` figure alongside
 * `costEur`: at zero euros, the credit count is the only number that says anything
 * happened at all.
 *
 * The day this account is on a paid or invoiced tier, this constant is the one number
 * that changes: ElevenLabs' paid tiers price near $0.00017 per credit (Starter $6/30k,
 * Creator $22/121k, Pro $99/600k, Scale $299/1.8M, measured 2026-08-18) - `toEur`/
 * `computeCost` already know how to convert once it is here, so nothing else in this
 * file changes on that day.
 */
export const AUDIO_MODEL_PARAMS: ModelParams = {
	currency: 'USD',
	pricePerProviderCredit: 0
};

/**
 * Charges and records one provider call without going through @canonry/ai's withQuota,
 * because withQuota needs a ResolvedModel typed to ModelPurpose
 * ('cheap'|'premium'|'multimodal'|'embedding'|'image') resolved from a DB-driven
 * `model_config` row, and ElevenLabs' sound-generation call is neither - SPEC.md §8.2
 * names no admin-switchable audio model, so there is no purpose or row for it to resolve
 * (see AUDIO_MODEL_PARAMS above). Composed instead from the same primitives withQuota
 * itself is built on - @canonry/ai's chargeFor/computeCost and @canonry/db's
 * previewCharge/recordAndCharge - so the guarantee is identical (refuse before spending,
 * one model_call row either way, never charged to the user on failure) without inventing
 * a purpose that does not exist.
 *
 * `fn` returns the real `providerCredits` a call cost alongside its output - read by the
 * caller straight off ElevenLabs' `character-cost` response header, never derived from a
 * rate and a duration, which would be a second, driftable model of ElevenLabs' own
 * pricing living in this codebase (issue #116). `costEur` is computed from that figure
 * through the same `computeCost` every other provider's price crosses into euros
 * through - `params.modelParams` is AUDIO_MODEL_PARAMS in production (ElevenLabsAudioProvider.generate
 * below picks it), whose `pricePerProviderCredit` is a measured 0 on the account's
 * current plan (see that constant's own comment for the reasoning), so `costEur` comes
 * out to 0 for a real, priced reason, never as a stand-in for "we don't know".
 */
async function chargeAndRecordLayer<T>(params: {
	db: Db;
	userId: string;
	universeId: string | null;
	agent: ModelCallAgent;
	operation: string;
	provider: string;
	modelId: string;
	modelParams: ModelParams;
	fn: () => Promise<{ output: T; providerCredits: number }>;
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
		requestId: null
	};

	try {
		const { output, providerCredits } = await params.fn();
		const { costEur } = computeCost(params.modelParams, {
			inputTokens: 0,
			outputTokens: 0,
			embeddingTokens: 0,
			images: 0,
			providerCredits
		});
		await recordAndCharge(params.db, {
			...baseRecord,
			credits,
			costEur,
			providerCredits,
			latencyMs: Math.round(performance.now() - startedAt)
		});
		return output;
	} catch (error) {
		// A failed call is still recorded (SPEC.md §15's "free to the user is not free to
		// us"), but never charged - the user is not billed for a layer that never came
		// back, exactly withQuota's own contract in @canonry/ai/src/quota.ts. costEur and
		// providerCredits stay at 0/null: whatever ElevenLabs actually spent processing a
		// rejected request is not something its error response reports, so recording a
		// real figure here would be inventing one.
		await recordAndCharge(params.db, {
			...baseRecord,
			credits: 0,
			costEur: 0,
			providerCredits: null,
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
	/** Test-only override for AUDIO_MODEL_PARAMS (issue #116) - the same test-seam shape
	 * as `baseUrl` above, so a test can assert `model_call.cost_eur` is genuinely computed
	 * through `computeCost` against a real (non-zero) rate rather than merely matching the
	 * account's current, coincidentally-zero one. */
	modelParams?: ModelParams;
	/** Test-only override for ELEVENLABS_THROTTLE_BASE_DELAY_MS (issue #337), same seam
	 * shape again. The real 750ms first backoff is right for a GM and wrong for a test
	 * suite: a test that drives the retry to its bound would spend seconds sleeping to
	 * prove something about attempt counts. */
	throttleBaseDelayMs?: number;
}

/**
 * One sound generation, retrying a 429 in place (issue #337) rather than handing the
 * first one straight back to the caller as a failed layer.
 *
 * This runs inside `chargeAndRecordLayer`'s callback, which is #334's shape and is the
 * whole point: a generation that gets through on its second or third try is still exactly
 * one `model_call` row and one charge. A row per attempt would make the metrics lie about
 * how many layers were actually generated, and retrying one level up (a fresh
 * `provider.generate` per attempt) would do exactly that. There is no poll loop here to
 * hang the retry off, unlike Replicate's submit-then-poll prediction: this endpoint is a
 * single synchronous request-response, so the loop is the whole call.
 *
 * It also runs inside the caller's `ProviderLimiter` slot, for the same reason: a request
 * that has been refused and not yet retried is still one of this process's in-flight
 * ElevenLabs calls. Releasing the slot to sleep would let a fourth caller straight into
 * the collision this one is backing off from.
 *
 * The order of the three refusals matters and is the evidence talking. The account's own
 * monthly cap is checked first and never retried, whatever status it arrives with:
 * retrying into a spent quota is asking a plan limit to change its mind, four times, and
 * ElevenLabs has answered that condition with a 401 in practice and documents a 402, so
 * a status-first branch would eventually retry it by accident. Then a 429, which is the
 * measured throttle and the only retryable case. Then everything else, straight out.
 */
async function generateSound(params: {
	baseUrl: string;
	token: string;
	prompt: string;
	loop: boolean;
	throttleBaseDelayMs: number;
}): Promise<{ output: GeneratedAudio; providerCredits: number }> {
	let waitedMs = 0;
	for (let attempt = 1; attempt <= ELEVENLABS_THROTTLE_MAX_ATTEMPTS; attempt++) {
		const response = await fetch(elevenLabsSoundGenerationUrl(params.baseUrl), {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'xi-api-key': params.token },
			body: JSON.stringify({
				text: params.prompt,
				model_id: ELEVENLABS_MODEL_ID,
				prompt_influence: 0.8,
				loop: params.loop,
				duration_seconds: AUDIO_DURATION_SECONDS
			})
		});

		if (!response.ok) {
			// Body may echo the request text back; never let it reach the logger, only the
			// status code and a truncated length do (mirrors replicate.ts) - except for the
			// one shape worth telling apart from a generic rejection: the account's own
			// monthly cap, which is a plan limit rather than ElevenLabs being down (#116).
			const bodyText = await response.text();
			if (isQuotaExceededResponseBody(bodyText)) throw new ElevenLabsQuotaExceededError();
			if (response.status !== 429) {
				throw new ElevenLabsRequestError(response.status, `${bodyText.length} byte body`);
			}
			if (attempt === ELEVENLABS_THROTTLE_MAX_ATTEMPTS) {
				throw new ElevenLabsThrottledError(attempt, waitedMs);
			}
			const delayMs = Math.round(
				params.throttleBaseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random())
			);
			await sleep(delayMs);
			waitedMs += delayMs;
			continue;
		}

		// The real bill for this call (issue #116), read off the response rather than
		// derived from duration_seconds and a rate - see this file's own header comment for
		// why. Missing or unparseable fails loudly rather than silently recording a real
		// spend as free.
		const characterCostHeader = response.headers.get('character-cost');
		const providerCredits = characterCostHeader === null ? NaN : Number(characterCostHeader);
		if (!Number.isFinite(providerCredits)) {
			throw new ElevenLabsMissingCostHeaderError(characterCostHeader);
		}
		// ElevenLabs' sound-generation endpoint returns mp3 by default (audio/mpeg) - never
		// assume wav; ../storage.ts's EXTENSION_BY_MIME keys off this exact string.
		const mimeType = response.headers.get('content-type') ?? 'audio/mpeg';
		const bytes = new Uint8Array(await response.arrayBuffer());
		return { output: { bytes, mimeType }, providerCredits };
	}
	// Unreachable - the loop always returns or throws before falling off the end, but TS
	// cannot see that from a `for` loop alone (same shape as replicate.ts's own).
	throw new ElevenLabsThrottledError(ELEVENLABS_THROTTLE_MAX_ATTEMPTS, waitedMs);
}

/**
 * The real path (#68, #70). Charges and previews the spend up front (one credited call
 * per layer, SPEC.md §8.1's "3 credits per generated layer" anchor), calls ElevenLabs
 * directly gated by the 'elevenlabs' concurrency slot (SPEC.md §8.1's "3 concurrent
 * requests" fixture, reusing ../concurrency.ts's ProviderLimiter rather than a second
 * one), and records the model_call row on success or failure - now with the account's
 * own real credit cost (issue #116) and an explicit `duration_seconds` (issue #233).
 *
 * Verified live against the real ElevenLabs API (2026-08-15) - see this package's report
 * for the exact request/response: a real `eleven_text_to_sound_v2` call returns
 * decodable `audio/mpeg` for a given prompt within ElevenLabs' own 0.5-30s duration
 * window.
 *
 * A 429 is retried in place inside that one charged call (issue #337, see `generateSound`
 * above), because the measured refusal is a concurrency collision that clears in about
 * three seconds and the alternative is a GM watching a layer fail for a reason that has
 * nothing to do with their prompt.
 */
export class ElevenLabsAudioProvider implements AudioProvider {
	constructor(private readonly deps: ElevenLabsAudioProviderDeps) {}

	async generate(input: AudioGenerateInput): Promise<GeneratedAudio> {
		const modelParams = this.deps.modelParams ?? AUDIO_MODEL_PARAMS;
		return chargeAndRecordLayer({
			db: this.deps.db,
			userId: input.userId,
			universeId: input.universeId,
			agent: this.deps.agent,
			operation: input.operation,
			provider: ELEVENLABS_PROVIDER,
			modelId: ELEVENLABS_MODEL_ID,
			modelParams,
			fn: () =>
				this.deps.limiter.run('elevenlabs', () =>
					generateSound({
						baseUrl: this.deps.baseUrl ?? ELEVENLABS_API_BASE_URL,
						token: this.deps.elevenLabsApiToken,
						prompt: input.prompt,
						loop: input.loop,
						throttleBaseDelayMs: this.deps.throttleBaseDelayMs ?? ELEVENLABS_THROTTLE_BASE_DELAY_MS
					})
				)
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
