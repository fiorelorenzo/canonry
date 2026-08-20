/**
 * Round twelve Q5 (#366): the cover ratio table, and the invariant that makes it more than
 * six literals.
 *
 * Two claims are worth defending here and nowhere else. The first is the decision itself,
 * which O2's words already stated and the old table contradicted: a character and an item
 * read as portrait, a faction sits between, and a place, an event and a session stay wide.
 * The second is the one that costs a real generation to discover by hand: **the shape a
 * cover is generated at and the shape it is displayed at must not differ**, which holds
 * only as long as every value in the table is a shape both cover models will actually
 * draw. A ratio the model refuses becomes a 500 on the first cover of that entity type;
 * one it silently ignores becomes a picture cropped wrong before it ever reaches the band.
 */
import { describe, expect, it } from 'vitest';
import { IMAGE_MODEL_ASPECT_RATIOS } from '@canonry/media';
import { entityTypeEnum } from '@canonry/db/schema';
import {
	COVER_ASPECT_RATIO,
	COVER_ASPECT_RATIOS,
	COVER_FIGURE_WIDTH,
	COVER_POSITION,
	COVER_RATIO,
	coverBandStyle,
	coverFigureStyle,
	coverPlacement
} from './cover-crop';

/** '3:4' -> 0.75. Below 1 is portrait, above 1 is landscape. */
function ratioValue(ratio: string): number {
	const [width, height] = ratio.split(':').map(Number);
	if (!width || !height) throw new Error(`not an aspect ratio: ${ratio}`);
	return width / height;
}

const PORTRAIT_MODEL = 'prunaai/p-image';
const VARIANTS_MODEL = 'black-forest-labs/flux-schnell';

describe('COVER_ASPECT_RATIO (#366)', () => {
	it('reads as portrait for a character and an item', () => {
		expect(ratioValue(COVER_ASPECT_RATIO.character)).toBeLessThan(1);
		expect(ratioValue(COVER_ASPECT_RATIO.item)).toBeLessThan(1);
	});

	it('puts a faction between a portrait and a wide band', () => {
		expect(ratioValue(COVER_ASPECT_RATIO.faction)).toBeGreaterThan(
			ratioValue(COVER_ASPECT_RATIO.character)
		);
		expect(ratioValue(COVER_ASPECT_RATIO.faction)).toBeLessThan(
			ratioValue(COVER_ASPECT_RATIO.place)
		);
	});

	it('keeps a place, an event and a session wide', () => {
		for (const type of ['place', 'event', 'session'] as const) {
			expect(ratioValue(COVER_ASPECT_RATIO[type])).toBeGreaterThan(1.5);
		}
	});

	it('covers every entity type, so no cover falls back to a model default', () => {
		for (const type of entityTypeEnum.enumValues) {
			expect(COVER_ASPECT_RATIO[type]).toBeTruthy();
			expect(COVER_POSITION[type]).toBeTruthy();
		}
	});

	it('asks for nothing either cover model refuses (#332)', () => {
		for (const ratio of COVER_ASPECT_RATIOS) {
			expect(IMAGE_MODEL_ASPECT_RATIOS[PORTRAIT_MODEL]).toContain(ratio);
			expect(IMAGE_MODEL_ASPECT_RATIOS[VARIANTS_MODEL]).toContain(ratio);
		}
	});

	it('lists every distinct shape exactly once', () => {
		expect([...COVER_ASPECT_RATIOS].sort()).toEqual(
			[...new Set(Object.values(COVER_ASPECT_RATIO))].sort()
		);
	});
});

describe('COVER_RATIO (#366)', () => {
	it('is the same table in CSS notation, not a second answer', () => {
		for (const type of entityTypeEnum.enumValues) {
			expect(COVER_RATIO[type]).toBe(COVER_ASPECT_RATIO[type].replace(':', ' / '));
		}
	});
});

describe('coverBandStyle (#366)', () => {
	it('sizes by the cap and takes its width from the ratio, so the cap cannot flatten it', () => {
		// The regression this replaces: `w-full` plus `max-h-[20vh]` drew every type at the
		// column's ratio, 784x180 on a 1440x900 window, so a 3/4 portrait was displayed at
		// 4.36:1 and cropped to it.
		expect(coverBandStyle('character')).toBe(
			'aspect-ratio: 3 / 4; width: calc(20vh * 0.75); max-width: 100%'
		);
		expect(coverBandStyle('place')).toContain('aspect-ratio: 16 / 9');
		expect(coverBandStyle('place')).toContain('max-width: 100%');
	});

	it('states one shape per entity type and never a bare height', () => {
		for (const type of entityTypeEnum.enumValues) {
			const style = coverBandStyle(type);
			expect(style).toContain(`aspect-ratio: ${COVER_RATIO[type]}`);
			expect(style).not.toContain('height:');
		}
	});
});

describe('coverPlacement (#376)', () => {
	it('stands a character and an item beside the title', () => {
		expect(coverPlacement('character')).toBe('figure');
		expect(coverPlacement('item')).toBe('figure');
	});

	it('keeps a faction, a place, an event and a session in the band', () => {
		for (const type of ['faction', 'place', 'event', 'session'] as const) {
			expect(coverPlacement(type)).toBe('band');
		}
	});

	it('answers every entity type from the ratio alone, not a second table (#376)', () => {
		for (const type of entityTypeEnum.enumValues) {
			const wantsFigure = ratioValue(COVER_ASPECT_RATIO[type]) < 1;
			expect(coverPlacement(type)).toBe(wantsFigure ? 'figure' : 'band');
		}
	});
});

describe('coverFigureStyle (#376)', () => {
	it('fixes the width and lets the ratio decide the height, unlike the band', () => {
		expect(coverFigureStyle('character')).toBe(
			`aspect-ratio: 3 / 4; width: ${COVER_FIGURE_WIDTH}`
		);
		expect(coverFigureStyle('character')).not.toContain('max-width');
	});

	it('states one shape per entity type and never a bare height', () => {
		for (const type of entityTypeEnum.enumValues) {
			const style = coverFigureStyle(type);
			expect(style).toContain(`aspect-ratio: ${COVER_RATIO[type]}`);
			expect(style).not.toContain('height:');
		}
	});
});
