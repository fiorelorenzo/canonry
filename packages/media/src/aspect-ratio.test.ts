/**
 * #332. The interesting cases here are the two refusals, because the alternative to a
 * refusal is what the bug was: Replicate quietly generating at the model's own default and
 * nothing anywhere saying so.
 */
import { describe, expect, it } from 'vitest';
import {
	assertAspectRatioSupported,
	IMAGE_MODEL_ASPECT_RATIOS,
	ImageAspectRatioUnsupportedError
} from './aspect-ratio.js';

describe('assertAspectRatioSupported (#332)', () => {
	it('accepts a ratio the model lists', () => {
		expect(() => assertAspectRatioSupported('prunaai/p-image', '3:2')).not.toThrow();
		expect(() => assertAspectRatioSupported('bytedance/seedream-4', '16:9')).not.toThrow();
	});

	it('accepts an unconfigured ratio, which means "leave the model default alone"', () => {
		expect(() => assertAspectRatioSupported('some/unrecorded-model', undefined)).not.toThrow();
	});

	it('refuses a ratio the model does not list, and names what it does accept', () => {
		// 21:9 is real, and flux-schnell takes it, which is exactly why a ratio has to be
		// checked against the model rather than against a global list of plausible shapes.
		expect(() => assertAspectRatioSupported('prunaai/p-image', '21:9')).toThrow(
			ImageAspectRatioUnsupportedError
		);
		try {
			assertAspectRatioSupported('prunaai/p-image', '21:9');
			expect.unreachable('expected a refusal');
		} catch (err) {
			expect(err).toBeInstanceOf(ImageAspectRatioUnsupportedError);
			const error = err as ImageAspectRatioUnsupportedError;
			expect(error.accepted).toEqual(IMAGE_MODEL_ASPECT_RATIOS['prunaai/p-image']);
			expect(error.message).toContain('3:2');
		}
	});

	it('refuses a model whose enum nobody recorded rather than guessing', () => {
		// Replicate ignores an input key a model's schema does not declare, so sending a
		// ratio to an unread model is indistinguishable from this bug.
		try {
			assertAspectRatioSupported('some/unrecorded-model', '3:2');
			expect.unreachable('expected a refusal');
		} catch (err) {
			expect(err).toBeInstanceOf(ImageAspectRatioUnsupportedError);
			expect((err as ImageAspectRatioUnsupportedError).accepted).toBeUndefined();
			expect((err as Error).message).toContain('IMAGE_MODEL_ASPECT_RATIOS');
		}
	});

	it('offers 3:2 on both models a portrait can be shown through', () => {
		// `variants` is four alternates of what `portrait` produces (migration 0011 gives
		// them different models), so the shape migration 0045 seeds has to exist in both
		// enums or the chooser shows a shape the chosen picture will not have.
		expect(IMAGE_MODEL_ASPECT_RATIOS['prunaai/p-image']).toContain('3:2');
		expect(IMAGE_MODEL_ASPECT_RATIOS['black-forest-labs/flux-schnell']).toContain('3:2');
	});
});
