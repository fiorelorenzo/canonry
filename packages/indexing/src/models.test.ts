import { describe, expect, it } from 'vitest';
import { KNOWN_PROVIDERS } from '@canonry/ai';
import { RECOMMENDED_EMBEDDING_MODEL } from './models.js';

describe('RECOMMENDED_EMBEDDING_MODEL (SPEC.md §17, issue #125)', () => {
	it('names the embedding purpose and a provider this build can actually construct', () => {
		expect(RECOMMENDED_EMBEDDING_MODEL.purpose).toBe('embedding');
		expect(KNOWN_PROVIDERS).toContain(RECOMMENDED_EMBEDDING_MODEL.provider);
	});

	it('is not the one KNOWN_PROVIDERS candidate documented as not multilingual (mistral-embed)', () => {
		expect(RECOMMENDED_EMBEDDING_MODEL.provider).not.toBe('mistral');
	});
});
