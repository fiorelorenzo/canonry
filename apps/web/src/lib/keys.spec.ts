import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectPlatform, formatShortcut, isDismissKey, matchesShortcut, SHORTCUTS } from './keys';
import type { KeyLikeEvent } from './keys';

function keydown(init: Partial<KeyLikeEvent> & { key: string }): KeyLikeEvent {
	return { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init };
}

function stubNavigator(platform: string): void {
	vi.stubGlobal('navigator', { platform, userAgent: platform } as Navigator);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the vocabulary', () => {
	it('never binds mod+a, the browser select-all guardrail 1 has to avoid', () => {
		const combos = SHORTCUTS.map((shortcut) => [...shortcut.modifiers, shortcut.key].join('+'));
		expect(combos).not.toContain('mod+a');
	});

	it('keeps accept, reject, undo, next and previous bare and review-scoped', () => {
		const bare = SHORTCUTS.filter((shortcut) => shortcut.modifiers.length === 0);
		expect(bare.map((shortcut) => shortcut.id).sort()).toEqual(
			['accept', 'next', 'previous', 'reject', 'undo'].sort()
		);
		expect(bare.every((shortcut) => shortcut.scope === 'review-surface')).toBe(true);
	});
});

describe('detectPlatform', () => {
	it('reads mac from navigator.platform', () => {
		stubNavigator('MacIntel');
		expect(detectPlatform()).toBe('mac');
	});
});

describe('formatShortcut', () => {
	const palette = SHORTCUTS.find((shortcut) => shortcut.id === 'palette')!;
	const accept = SHORTCUTS.find((shortcut) => shortcut.id === 'accept')!;

	it('renders Cmd as a glyph on macOS', () => {
		expect(formatShortcut(palette, 'mac')).toBe('⌘+K');
	});

	it('resolves Cmd to Ctrl off macOS', () => {
		expect(formatShortcut(palette, 'other')).toBe('Ctrl+K');
	});

	it('renders a bare shortcut as just the key on every platform', () => {
		expect(formatShortcut(accept, 'mac')).toBe('A');
		expect(formatShortcut(accept, 'other')).toBe('A');
	});
});

describe('matchesShortcut', () => {
	const palette = SHORTCUTS.find((shortcut) => shortcut.id === 'palette')!;
	const accept = SHORTCUTS.find((shortcut) => shortcut.id === 'accept')!;

	it('matches Cmd+K on macOS and Ctrl+K elsewhere for the same shortcut', () => {
		expect(matchesShortcut(keydown({ key: 'k', metaKey: true }), palette, 'mac')).toBe(true);
		expect(matchesShortcut(keydown({ key: 'k', ctrlKey: true }), palette, 'other')).toBe(true);
		expect(matchesShortcut(keydown({ key: 'k', ctrlKey: true }), palette, 'mac')).toBe(false);
	});

	it('matches a bare key with no modifier held', () => {
		expect(matchesShortcut(keydown({ key: 'a' }), accept)).toBe(true);
	});

	it('refuses a bare key while an unrelated modifier is held', () => {
		expect(matchesShortcut(keydown({ key: 'a', ctrlKey: true }), accept)).toBe(false);
		expect(matchesShortcut(keydown({ key: 'a', altKey: true }), accept)).toBe(false);
	});
});

describe('isDismissKey', () => {
	it('recognises Escape and nothing else', () => {
		expect(isDismissKey(keydown({ key: 'Escape' }))).toBe(true);
		expect(isDismissKey(keydown({ key: 'a' }))).toBe(false);
	});
});
