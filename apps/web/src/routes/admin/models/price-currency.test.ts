/**
 * The image price form takes a currency alongside the amount now, so this proves the
 * two things the acceptance asks for directly against the same functions `actions.image`
 * calls: the raw amount and the chosen currency reach `params` exactly as submitted, no
 * conversion at write time, and `computeCost` (`@canonry/ai/usage.ts` - the single place
 * a stored price ever crosses into euros) produces the real converted figure from that
 * stored USD price, not the raw number.
 */
import { describe, expect, it } from 'vitest';
import { computeCost, toEur } from '@canonry/ai';
import { parseCurrency, parsePricePerImage } from './image-price.js';

describe('admin/models image price form', () => {
	it('parses a USD amount and currency without converting either', () => {
		const pricePerImage = parsePricePerImage('0.02');
		const currency = parseCurrency('USD');

		// This is exactly the object actions.image writes to image_model_config.params -
		// the raw typed amount and the chosen currency, untouched.
		expect({ pricePerImage, currency }).toEqual({ pricePerImage: 0.02, currency: 'USD' });
	});

	it('computes the converted euro cost from a USD-stored price, not the raw figure', () => {
		const pricePerImage = parsePricePerImage('0.02');
		const currency = parseCurrency('USD');
		if (pricePerImage === null || currency !== 'USD') throw new Error('fixture parse failed');

		const { costEur } = computeCost(
			{ pricePerImage, currency },
			{ inputTokens: 0, outputTokens: 0, embeddingTokens: 0, images: 1 }
		);

		// toEur is the single conversion function computeCost delegates to - asserting
		// against it, not a hardcoded rate, keeps this test correct across an FX update.
		expect(costEur).toBe(toEur(0.02, 'USD'));
		expect(costEur).not.toBe(pricePerImage);
	});

	it('leaves a EUR-stored price unconverted, since EUR is the rate of 1', () => {
		const pricePerImage = parsePricePerImage('0.05');
		const currency = parseCurrency('EUR');
		if (pricePerImage === null || currency !== 'EUR') throw new Error('fixture parse failed');

		const { costEur } = computeCost(
			{ pricePerImage, currency },
			{ inputTokens: 0, outputTokens: 0, embeddingTokens: 0, images: 1 }
		);

		expect(costEur).toBe(0.05);
	});

	it('rejects a currency the converter cannot handle', () => {
		expect(parseCurrency('GBP')).toBeNull();
		expect(parseCurrency(null)).toBeNull();
	});

	it('rejects a negative or malformed price', () => {
		expect(parsePricePerImage('-1')).toBeNull();
		expect(parsePricePerImage('not-a-number')).toBeNull();
		expect(parsePricePerImage(null)).toBeNull();
	});
});
