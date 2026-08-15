/**
 * Image providers, behind an interface (#66, #70). Two implementations: Replicate for the
 * real generation, and a fake for tests - this sandbox has no REPLICATE_API_TOKEN, so
 * nothing here fabricates a generated image into the database; the fake returns a small
 * real PNG instead of pretending to be Replicate's output.
 */
import { generateImage, type ModelCallAgent, type ResolvedModel } from '@canonry/ai';
import type { Db } from '@canonry/db';
import { ProviderLimiter } from './concurrency.js';

export interface GeneratedImage {
	bytes: Uint8Array;
	mimeType: string;
}

export interface ImageGenerateInput {
	prompt: string;
	model: ResolvedModel;
	count: number;
	userId: string;
	universeId: string;
	operation: string;
	/** Retry safety (SPEC.md §15/#88): threaded through to generateImage/withQuota so a
	 * retried submission is charged once. Omit when there is no retry path. */
	idempotencyKey?: string;
}

export interface ImageProvider {
	generate(input: ImageGenerateInput): Promise<GeneratedImage[]>;
}

/** Pulls the image URL(s) out of a Replicate prediction's `output`, which is either one
 * string (most single-image models, including the seeded prunaai/p-image) or an array of
 * strings (batch models, including the seeded black-forest-labs/flux-schnell). Exported
 * so this URL-shape handling - the part of the Replicate path that needs no credential to
 * exercise - has its own direct unit test, independent of the network call around it. */
export function predictionImageUrls(prediction: { output?: unknown }): string[] {
	const output = prediction.output;
	if (typeof output === 'string') return [output];
	if (Array.isArray(output))
		return output.filter((item): item is string => typeof item === 'string');
	return [];
}

async function downloadImage(url: string): Promise<GeneratedImage> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`failed to download generated image (status ${response.status})`);
	}
	const mimeType = response.headers.get('content-type') ?? 'image/png';
	const bytes = new Uint8Array(await response.arrayBuffer());
	return { bytes, mimeType };
}

export interface ReplicateImageProviderDeps {
	db: Db;
	replicateApiToken: string;
	limiter: ProviderLimiter;
	agent: ModelCallAgent;
}

/**
 * The real path (#66, #70). Submits the prediction through @canonry/ai's generateImage
 * (direct Replicate call, quota check and charging, model_call recording - all unchanged
 * from that package's own tests), gated by the 'replicate' concurrency slot from
 * ProviderLimiter, then downloads the resulting image bytes.
 *
 * The download happens *outside* the semaphore's slot on purpose: the prediction has
 * already finished (generateImage sends `Prefer: wait`), so fetching the resulting file
 * from Replicate's CDN is a second, unrelated network call that should not hold a
 * prediction slot hostage while a CDN serves bytes.
 */
export class ReplicateImageProvider implements ImageProvider {
	constructor(private readonly deps: ReplicateImageProviderDeps) {}

	async generate(input: ImageGenerateInput): Promise<GeneratedImage[]> {
		const prediction = await this.deps.limiter.run('replicate', () =>
			generateImage({
				db: this.deps.db,
				model: input.model,
				replicateApiToken: this.deps.replicateApiToken,
				input: { prompt: input.prompt, num_outputs: input.count },
				userId: input.userId,
				universeId: input.universeId,
				agent: this.deps.agent,
				operation: input.operation,
				...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
			})
		);

		const urls = predictionImageUrls(prediction);
		if (urls.length === 0) {
			throw new Error(`Replicate prediction "${prediction.id}" returned no image output`);
		}
		return Promise.all(urls.slice(0, input.count).map(downloadImage));
	}
}

/** A 1x1 transparent PNG - real magic number, real IHDR/IDAT/IEND chunks, decodable by any
 * image library, just not decorative. Used so a test asserting "this is a real stored
 * image file" has something honest to check against instead of an empty buffer or a text
 * stub standing in for bytes that were never real (see this package's report on why a
 * fabricated generated image never belongs in the database). */
const TINY_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export function tinyPngBytes(): Uint8Array {
	return Uint8Array.from(Buffer.from(TINY_PNG_BASE64, 'base64'));
}

/** Test double (#66's "test against a local fake that returns a small real PNG"). Never
 * touches the network, the gateway or the database - it exists so the generate/cache/
 * attach/publish-guard pipeline can be proven end to end without a Replicate credential. */
export class FakeImageProvider implements ImageProvider {
	public readonly calls: ImageGenerateInput[] = [];

	async generate(input: ImageGenerateInput): Promise<GeneratedImage[]> {
		this.calls.push(input);
		return Array.from({ length: input.count }, () => ({
			bytes: tinyPngBytes(),
			mimeType: 'image/png'
		}));
	}
}
