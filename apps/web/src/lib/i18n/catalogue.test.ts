/**
 * Two different kinds of proof in one file, on purpose.
 *
 * The `@ts-expect-error` cases below are checked by `svelte-check`/`tsc`
 * (`pnpm --filter web check`), not by `vitest run` - a missing key or a wrongly-typed
 * interpolation argument is a *compile* failure, which is the entire point of writing
 * `Messages` as an interface both `en.ts` and `it.ts` are independently checked against
 * (issue #120: "a missing key is a typecheck failure, not a blank space in production").
 * If either `@ts-expect-error` line stopped actually erroring, `tsc` itself would flag
 * the directive as unused and `check` would fail - so this file also proves the
 * regression the moment someone weakens `Messages` back to something structurally loose.
 *
 * The `describe/it` blocks are ordinary runtime assertions: that `en` and `it` cover the
 * identical set of keys (a belt-and-braces runtime mirror of the type-level guarantee -
 * useful the day someone adds a key with `as any` and slips past review), and that the
 * formatters produce what SPEC.md §17 actually asks for (Italian's decimal comma,
 * correct singular/plural credit counts in both languages).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it as vitestIt } from 'vitest';
import { en } from './en.js';
import { it } from './it.js';
import type { Messages } from './messages.js';
import { dateFormat, numberFormat, pluralRules } from './intl.js';

/** Recursively collects every leaf path in a catalogue object ("shell.signIn",
 * "settings.billing.creditsCount", ...), function leaves included - the shape check
 * that matters here is "does this key exist", not "what does it currently say". */
function leafPaths(value: unknown, prefix = ''): string[] {
	if (typeof value !== 'object' || value === null) return [prefix];
	return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
		leafPaths(child, prefix ? `${prefix}.${key}` : key)
	);
}

describe('message catalogue (issue #120)', () => {
	vitestIt('en and it cover exactly the same keys', () => {
		expect(leafPaths(it).sort()).toEqual(leafPaths(en).sort());
	});

	vitestIt('a catalogue missing a required key does not typecheck', () => {
		const withoutShell = Object.fromEntries(Object.entries(en).filter(([key]) => key !== 'shell'));
		// @ts-expect-error - `Messages` requires `shell`; a catalogue without it must not
		// be assignable, proving a locale that forgets a key the other has fails to
		// compile rather than rendering a blank string in production.
		const incomplete: Messages = withoutShell;
		expect(Object.keys(incomplete)).not.toContain('shell');
	});

	vitestIt('a counted message is typed as a number, not unknown or a string', () => {
		expect(en.settings.billing.creditsCount(1)).toBe('1 credit');
		expect(en.settings.billing.creditsCount(2)).toBe('2 credits');
		// @ts-expect-error - `creditsCount` takes a `number`; a string must not typecheck,
		// which is what "interpolation is explicit and typed" (issue #120) means in
		// practice - the wrong argument type is caught here, not at render time.
		en.settings.billing.creditsCount('1');
	});

	vitestIt('a name-interpolating message rejects a non-string argument', () => {
		expect(en.shell.signedInAs('Wave')).toBe('Signed in as Wave');
		// @ts-expect-error - `signedInAs` takes a `string`; a number must not typecheck.
		en.shell.signedInAs(1);
	});
});

/** issue #263: the onboarding upload/confirm screen's detail line under "Rilevato: …"
 * used to be an English sentence composed server-side (`detectSource`,
 * `$lib/server/onboarding.ts`) and stored on the form data verbatim. It now travels as
 * a `DetectedDetail` value and is rendered here, in the reader's own locale - proven by
 * checking the Italian catalogue produces Italian, not the English sentence the server
 * used to hand back directly. */
describe('upload detection detail renders in the reader locale (issue #263)', () => {
	vitestIt("the onenote detail is Italian, not the server's old English sentence", () => {
		const rendered = it.import.upload.confirm.detail({ kind: 'onenote', pages: 4 });
		expect(rendered).toContain('pagine');
		expect(rendered).not.toContain('exported page');
	});

	vitestIt('every DetectedDetail kind renders distinct English and Italian text', () => {
		const cases: Parameters<typeof en.import.upload.confirm.detail>[0][] = [
			{ kind: 'obsidian', notes: 3 },
			{ kind: 'obsidian-unsure', markdownFiles: 2 },
			{ kind: 'kanka', jsonFiles: 5 },
			{ kind: 'world-anvil' },
			{ kind: 'onenote', pages: 1 },
			{ kind: 'pdf' },
			{ kind: 'docx' },
			{ kind: 'generic', files: 7 }
		];
		for (const detail of cases) {
			const enText = en.import.upload.confirm.detail(detail);
			const itText = it.import.upload.confirm.detail(detail);
			expect(enText.length).toBeGreaterThan(0);
			expect(itText.length).toBeGreaterThan(0);
			expect(itText).not.toBe(enText);
		}
	});
});

describe('locale-aware Intl formatters (SPEC.md §17)', () => {
	vitestIt('Italian credits use a decimal comma, English a decimal point', () => {
		// SPEC.md §17's literal example: the same 4-digit quota, grouped in both
		// locales. `useGrouping: 'always'` is required to get there - Node's real CLDR
		// data (verified directly, not assumed) gives it-IT's *default* ("auto")
		// grouping a 10,000 cutoff, so a bare `numberFormat('it').format(2400)` would
		// silently render "2400" with no separator at exactly the magnitude this
		// example cares about. `en.settings.billing.creditsCount`/`it...` (asserted
		// below) already exercise the real, production `useGrouping: 'always'` call.
		expect(numberFormat('en', { useGrouping: 'always' }).format(2400.5)).toBe('2,400.5');
		expect(numberFormat('it', { useGrouping: 'always' }).format(2400.5)).toBe('2.400,5');
	});

	vitestIt('English and Italian pluralise "credit" correctly at 1 and at other counts', () => {
		expect(en.settings.billing.creditsCount(0)).toBe('0 credits');
		expect(en.settings.billing.creditsCount(1)).toBe('1 credit');
		expect(en.settings.billing.creditsCount(5)).toBe('5 credits');
		expect(it.settings.billing.creditsCount(0)).toBe('0 crediti');
		expect(it.settings.billing.creditsCount(1)).toBe('1 credito');
		expect(it.settings.billing.creditsCount(5)).toBe('5 crediti');
	});

	vitestIt('PluralRules agrees with the hand-written singular/plural cutover', () => {
		expect(pluralRules('en').select(1)).toBe('one');
		expect(pluralRules('en').select(2)).toBe('other');
		expect(pluralRules('it').select(1)).toBe('one');
		expect(pluralRules('it').select(2)).toBe('other');
	});

	vitestIt('dates format with each locale\u2019s own convention', () => {
		const date = new Date('2026-08-15T00:00:00Z');
		expect(dateFormat('en', { dateStyle: 'medium' }).format(date)).toBe('Aug 15, 2026');
		expect(dateFormat('it', { dateStyle: 'medium' }).format(date)).toBe('15 ago 2026');
	});
});

/**
 * Issue #202: the interface never names a file in this repository, a spec section, a
 * decision id or an issue number - a GM or a staff member reading a rendered string is
 * not the audience for a citation aimed at whoever built the screen. That citation
 * belongs in the code comment above the string, which is this repo's actual home for
 * provenance (see the doc comments throughout `en.ts`/`it.ts`, still citing freely) -
 * so the scan below strips comments first and only ever looks at what would render.
 */
function catalogueSourceWithoutComments(source: string): string {
	const commentOrStringLiteral =
		/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
	return source.replace(commentOrStringLiteral, (match) =>
		match.startsWith('//') || match.startsWith('/*') ? '' : match
	);
}

/** The exact shapes the inventory behind issue #202 was built from: a spec file, the
 * decisions doc, the agents doc, the docs/ux directory, a "§N" section mark or an
 * "issueN"/"issue #N" reference. Deliberately not a check for the word "spec" alone -
 * `docs.hub.intro`'s "rather than a spec section" leaked by naming the thing, not by
 * matching one of these, and was caught and rewritten by hand for that reason. */
const REPO_REFERENCE_PATTERNS: readonly RegExp[] = [
	/SPEC\.md/i,
	/DECISIONS\.md/i,
	/AGENTS\.md/i,
	/docs\/ux/i,
	/§\s*\d/,
	/issue\s*#?\d/i
];

describe('catalogue strings never cite this repo at the user (issue #202)', () => {
	const catalogueSourcePaths: Record<'en' | 'it', string> = {
		en: fileURLToPath(new URL('./en.ts', import.meta.url)),
		it: fileURLToPath(new URL('./it.ts', import.meta.url))
	};

	for (const [locale, path] of Object.entries(catalogueSourcePaths) as Array<
		['en' | 'it', string]
	>) {
		vitestIt(
			`${locale}.ts has no repo file, spec section, decision id or issue number outside a comment`,
			() => {
				const rendered = catalogueSourceWithoutComments(readFileSync(path, 'utf8'));
				for (const pattern of REPO_REFERENCE_PATTERNS) {
					expect(rendered).not.toMatch(pattern);
				}
			}
		);
	}
});
