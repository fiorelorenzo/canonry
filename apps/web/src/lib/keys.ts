/**
 * G3 = B (docs/design/DECISIONS.md): bare keys only inside a focused review surface, a
 * modifier everywhere else, and Cmd resolves to Ctrl off macOS. This is the one place
 * that vocabulary is written down as data; nothing else in the app should hardcode a
 * chord or scatter its own keydown handling.
 *
 * #104 ships the foundation, not the palette itself (#75 builds that). `SHORTCUTS`
 * below is the full vocabulary G3 chose (`docs/design/DECISIONS.md`; the drawn table is in
 * git history at `c84c8f8`), so every later surface wires against one source instead of inventing its own;
 * the shell only actively listens for `isDismissKey` today, to close the universe
 * switcher on Escape.
 */

export type Platform = 'mac' | 'other';

export type ModifierToken = 'mod' | 'shift';

/** The slice of `KeyboardEvent` this module actually reads, so `matchesShortcut` and
 * `isDismissKey` stay testable without a DOM and any real `KeyboardEvent` still
 * satisfies the shape for free. */
export interface KeyLikeEvent {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

export interface Shortcut {
	id: string;
	description: string;
	/** `mod` resolves to Cmd on macOS and Ctrl elsewhere. An empty array is a bare
	 * shortcut, only ever live while `scope` is `'review-surface'`. */
	modifiers: readonly ModifierToken[];
	/** The character `KeyboardEvent.key` produces, not a physical key code, so a
	 * non-QWERTY layout still matches by what the key actually prints. */
	key: string;
	scope: 'global' | 'review-surface';
}

export const SHORTCUTS: readonly Shortcut[] = [
	{ id: 'palette', description: 'Open the palette', modifiers: ['mod'], key: 'k', scope: 'global' },
	{
		id: 'ask',
		description: 'Ask, directly',
		modifiers: ['mod', 'shift'],
		key: 'a',
		scope: 'global'
	},
	{ id: 'save', description: 'Save', modifiers: ['mod'], key: 's', scope: 'global' },
	{
		id: 'accept',
		description: 'Accept the item in focus',
		modifiers: [],
		key: 'a',
		scope: 'review-surface'
	},
	{
		id: 'reject',
		description: 'Reject the item in focus',
		modifiers: [],
		key: 'r',
		scope: 'review-surface'
	},
	{
		id: 'undo',
		description: 'Undo the last review action',
		modifiers: [],
		key: 'u',
		scope: 'review-surface'
	},
	{ id: 'next', description: 'Next proposal', modifiers: [], key: 'j', scope: 'review-surface' },
	{
		id: 'previous',
		description: 'Previous proposal',
		modifiers: [],
		key: 'k',
		scope: 'review-surface'
	},
	{
		id: 'reveal',
		description: 'Reveal, at the table',
		modifiers: ['mod', 'shift'],
		key: 'r',
		scope: 'global'
	}
] as const;

// Guardrail 1, checked as a fact about the table instead of left for a reviewer to
// notice by eye: no shortcut may read as the browser's own "select all", `mod+a` with
// no other modifier, since a GM's hand reaching for that habit must never land on an
// accept-all.
const FORBIDDEN_COMBOS: Record<string, true> = { 'mod+a': true };
for (const shortcut of SHORTCUTS) {
	const combo = [...shortcut.modifiers, shortcut.key].join('+');
	if (FORBIDDEN_COMBOS[combo]) {
		throw new Error(`shortcut "${shortcut.id}" collides with the browser's select-all guardrail`);
	}
}

interface NavigatorUAData {
	platform: string;
}

let cachedPlatform: Platform | undefined;

/** Resolved once and cached: the platform cannot change mid-session, so every caller
 * asking again gets the same answer without re-touching `navigator`. */
export function detectPlatform(): Platform {
	if (cachedPlatform) return cachedPlatform;
	if (typeof navigator === 'undefined') {
		cachedPlatform = 'other';
		return cachedPlatform;
	}
	const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
	const platformString = uaData?.platform ?? navigator.platform ?? navigator.userAgent;
	cachedPlatform = /mac/i.test(platformString) ? 'mac' : 'other';
	return cachedPlatform;
}

const MODIFIER_LABEL: Record<Platform, Record<ModifierToken, string>> = {
	mac: { mod: '⌘', shift: '⇧' },
	other: { mod: 'Ctrl', shift: 'Shift' }
};

/** Human-readable chord for a hint or a tooltip, e.g. "⌘+K" on macOS and "Ctrl+K"
 * elsewhere. A bare review-surface shortcut renders as just the key. */
export function formatShortcut(shortcut: Shortcut, platform: Platform = detectPlatform()): string {
	const parts = shortcut.modifiers.map((token) => MODIFIER_LABEL[platform][token]);
	parts.push(shortcut.key.toUpperCase());
	return parts.join('+');
}

/**
 * Matches a live keydown against one shortcut. Takes the small structural shape
 * rather than the full DOM `KeyboardEvent`, so this stays testable outside a browser
 * and any real `KeyboardEvent` still satisfies it for free. A bare (`scope:
 * 'review-surface'`) shortcut also requires that no unrelated modifier is held, so a
 * browser chord that happens to share the letter never gets misread as the bare one.
 */
export function matchesShortcut(
	event: KeyLikeEvent,
	shortcut: Shortcut,
	platform: Platform = detectPlatform()
): boolean {
	if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;

	const wantsMod = shortcut.modifiers.includes('mod');
	const wantsShift = shortcut.modifiers.includes('shift');
	const modHeld = platform === 'mac' ? event.metaKey : event.ctrlKey;
	if (wantsMod !== modHeld || wantsShift !== event.shiftKey) return false;

	if (shortcut.modifiers.length === 0 && (event.metaKey || event.ctrlKey || event.altKey)) {
		return false;
	}
	return true;
}

/** The one dismiss key the shell needs now: closing the universe switcher. Centralised
 * here rather than each component writing its own `event.key === 'Escape'` check. */
export const DISMISS_KEY = 'Escape';

export function isDismissKey(event: Pick<KeyLikeEvent, 'key'>): boolean {
	return event.key === DISMISS_KEY;
}
