import { describe, expect, it } from 'vitest';
import { FakeImageProvider, predictionImageUrls, tinyPngBytes } from './provider.js';
import type { ResolvedModel } from '@canonry/ai';

describe('predictionImageUrls', () => {
	it('reads a single-string output (prunaai/p-image shape)', () => {
		expect(predictionImageUrls({ output: 'https://replicate.delivery/one.png' })).toEqual([
			'https://replicate.delivery/one.png'
		]);
	});

	it('reads an array output (black-forest-labs/flux-schnell batch shape)', () => {
		const urls = ['https://replicate.delivery/a.png', 'https://replicate.delivery/b.png'];
		expect(predictionImageUrls({ output: urls })).toEqual(urls);
	});

	it('drops non-string entries from an array output rather than throwing', () => {
		expect(predictionImageUrls({ output: ['https://x/a.png', null, 42] })).toEqual([
			'https://x/a.png'
		]);
	});

	it('returns an empty array for a missing or unrecognised output shape', () => {
		expect(predictionImageUrls({})).toEqual([]);
		expect(predictionImageUrls({ output: { nested: true } })).toEqual([]);
	});
});

describe('tinyPngBytes', () => {
	it('decodes to a real, valid PNG (not a text stub standing in for bytes)', () => {
		const bytes = tinyPngBytes();
		// The PNG file signature, byte for byte (spec-fixed 8 bytes every PNG starts with).
		expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	});
});

describe('FakeImageProvider', () => {
	const model: ResolvedModel = {
		purpose: 'image',
		provider: 'replicate',
		modelId: 'prunaai/p-image',
		params: {}
	};

	it('returns exactly `count` real PNGs and records every call it received', async () => {
		const provider = new FakeImageProvider();
		const images = await provider.generate({
			prompt: 'a portrait',
			model,
			count: 4,
			userId: 'user-1',
			universeId: 'universe-1',
			operation: 'image.variants'
		});

		expect(images).toHaveLength(4);
		for (const image of images) {
			expect(image.mimeType).toBe('image/png');
			expect(image.bytes.byteLength).toBeGreaterThan(0);
		}
		expect(provider.calls).toHaveLength(1);
		expect(provider.calls[0]?.prompt).toBe('a portrait');
	});
});
