import { describe, expect, it } from 'vitest';
import type { LanguageModel } from 'ai';
import { DbModelSelector, type PurposeResolution } from './model-selector.js';

describe('DbModelSelector (issue #24)', () => {
	it('resolves a purpose through the injected database read, then through the injected provider factory', async () => {
		const resolutions: Record<string, PurposeResolution> = {
			cheap: {
				provider: 'openai',
				modelId: 'gpt-4o-mini',
				params: { pricePerInputMTok: 0.15, pricePerOutputMTok: 0.6, creditsPerEur: 100 }
			},
			premium: {
				provider: 'anthropic',
				modelId: 'claude-sonnet',
				params: { pricePerInputMTok: 3, pricePerOutputMTok: 15, creditsPerEur: 100 }
			}
		};
		const requestedPurposes: string[] = [];
		const builtModels: Array<{ provider: string; modelId: string }> = [];
		const fakeModel = { modelId: 'fake' } as unknown as LanguageModel;

		const selector = new DbModelSelector({
			resolvePurpose: async (purpose) => {
				requestedPurposes.push(purpose);
				const resolution = resolutions[purpose];
				if (!resolution) throw new Error(`no fixture resolution for purpose "${purpose}"`);
				return resolution;
			},
			createLanguageModel: (provider, modelId) => {
				builtModels.push({ provider, modelId });
				return fakeModel;
			}
		});

		const cheap = await selector.resolve('cheap');
		expect(cheap).toEqual({
			languageModel: fakeModel,
			provider: 'openai',
			modelId: 'gpt-4o-mini',
			params: resolutions.cheap?.params
		});

		const premium = await selector.resolve('premium');
		expect(premium.provider).toBe('anthropic');
		expect(premium.modelId).toBe('claude-sonnet');

		expect(requestedPurposes).toEqual(['cheap', 'premium']);
		expect(builtModels).toEqual([
			{ provider: 'openai', modelId: 'gpt-4o-mini' },
			{ provider: 'anthropic', modelId: 'claude-sonnet' }
		]);
	});

	it('propagates a database resolution failure rather than swallowing it', async () => {
		const selector = new DbModelSelector({
			resolvePurpose: async () => {
				throw new Error('model_config has no active row for purpose "multimodal"');
			},
			createLanguageModel: () => {
				throw new Error('should never be called when resolvePurpose failed');
			}
		});

		await expect(selector.resolve('multimodal')).rejects.toThrow(
			'model_config has no active row for purpose "multimodal"'
		);
	});
});
