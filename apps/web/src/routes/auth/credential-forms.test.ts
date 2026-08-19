/**
 * Issue #262: a form that carries a password must never be submittable as a GET.
 *
 * The defect was `<form onsubmit={submit}>` with no `method` and no action behind it, on
 * `/auth/sign-up`. A form with no method is a GET, so a submit that arrived before the page
 * hydrated sent the name, the email and the password to the current URL as query
 * parameters, which puts a password in browser history, in a proxy log, in the `Referer` of
 * whatever loads next, and in our own request logs the day we log a path.
 *
 * Two kinds of proof, because either one alone would let the defect back in.
 *
 * The first is structural and deliberately reads the markup: `method="post"` on the form
 * element *is* the behaviour under test. It is the browser, not this app, that decides what
 * a submit does before any JavaScript has run, and it decides from that attribute alone, so
 * there is nothing else to assert against. It scans every `.svelte` file under `src` rather
 * than the four this issue touched, so a fifth credential form added next year fails here
 * instead of shipping. This is the half that fails on the old markup.
 *
 * The second is behavioural, and it is what makes the fix worth having rather than merely
 * safe: the POST the browser now sends has to actually create the account and sign the
 * browser in with no JavaScript involved at all. It calls the real exported
 * `actions.signUp`/`actions.signIn` (same technique as `../p/leak.test.ts` and
 * `../admin/models/params-merge.test.ts`) and proves the session through
 * `auth.api.getSession` with the cookie the action handed back, which is the same call
 * `hooks.server.ts` makes on every request, so the assertion reads whatever database the
 * action wrote to rather than one this file picked.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { user as userTable } from '@canonry/db/schema';
import { isActionFailure, isRedirect, type Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { auth } from '$lib/server/auth';
import { CREDENTIAL_QUERY_PARAMS } from '$lib/server/auth-forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actions as signInActions, load as signInLoad } from './sign-in/+page.server.js';
import { actions as signUpActions } from './sign-up/+page.server.js';
import { load as resetPasswordLoad } from './reset-password/+page.server.js';

const SRC = fileURLToPath(new URL('../..', import.meta.url));

function svelteFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) found.push(...svelteFiles(path));
		else if (entry.name.endsWith('.svelte')) found.push(path);
	}
	return found;
}

/**
 * Every `<form>` in a Svelte template, opening-tag attributes separated from body.
 *
 * `<script>` blocks and HTML comments come out first, because the doc comments on these very
 * pages quote the `<form onsubmit={...}>` markup this issue removed, and a scanner that
 * reads those finds the defect it was written to prevent in the file that fixed it.
 *
 * The opening tag cannot be found by looking for the first `>`: `use:enhance={() => {...}}`
 * contains one, and so does any inline arrow. So this tracks quote state and brace depth and
 * stops at the first `>` outside both. Forms do not nest in HTML, so the matching `</form>`
 * is simply the next one.
 */
function formTags(template: string): { attrs: string; body: string }[] {
	const source = template.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
	const tags: { attrs: string; body: string }[] = [];
	let cursor = 0;
	for (;;) {
		const open = source.indexOf('<form', cursor);
		if (open === -1) return tags;
		let i = open + '<form'.length;
		let depth = 0;
		let quote = '';
		for (; i < source.length; i++) {
			const char = source[i];
			// Inside a `{...}` expression only braces count. Tracking quotes in there would trip
			// over an apostrophe in a code comment ("the DOM's own state") and swallow the rest
			// of the tag, which is exactly how this scanner first reported the fixed pages as
			// still broken.
			if (depth > 0) {
				if (char === '{') depth++;
				else if (char === '}') depth--;
			} else if (quote) {
				if (char === quote) quote = '';
			} else if (char === '"' || char === "'") {
				quote = char;
			} else if (char === '{') {
				depth++;
			} else if (char === '>') {
				break;
			}
		}
		const close = source.indexOf('</form>', i);
		const end = close === -1 ? source.length : close;
		tags.push({ attrs: source.slice(open + '<form'.length, i), body: source.slice(i, end) });
		cursor = end + 1;
	}
}

// Every form in the app that names a secret field, found once and asserted twice below. The
// field list is the same constant the server helper refuses in a query string, so the markup
// guard and the runtime guard can never disagree about what counts as a credential.
const CREDENTIAL_FORMS = svelteFiles(SRC).flatMap((path) =>
	formTags(readFileSync(path, 'utf8'))
		.map((tag) => ({
			path: path.slice(SRC.length).replace(/^\//, ''),
			attrs: tag.attrs,
			fields: CREDENTIAL_QUERY_PARAMS.filter((field) =>
				new RegExp(`name=(["'])${field}\\1`).test(tag.body)
			)
		}))
		.filter((form) => form.fields.length > 0)
);

describe('every form that carries a credential posts (issue #262)', () => {
	// A scan that silently matched nothing would satisfy every `it.each` below, so the
	// inventory itself is asserted first. These four files are the whole of it as of this
	// issue: the three auth screens that collect a password, and the account pane that
	// changes one.
	it('finds every screen in the app that collects a password', () => {
		expect([...new Set(CREDENTIAL_FORMS.map((form) => form.path))].sort()).toEqual([
			'routes/auth/reset-password/+page.svelte',
			'routes/auth/sign-in/+page.svelte',
			'routes/auth/sign-up/+page.svelte',
			'routes/settings/account/+page.svelte'
		]);
	});

	it.each(CREDENTIAL_FORMS)('$path posts its $fields', ({ attrs }) => {
		expect(attrs).toMatch(/\bmethod=(["'])post\1/i);
		expect(attrs).not.toMatch(/\bmethod=(["'])get\1/i);
		// A POST with no `action` reaches the default action, and none of these routes has one
		// (they all carry `setLocale`, and SvelteKit refuses a default action alongside named
		// ones), so a missing `action` here would be a 404 rather than a working submit. Extra
		// query parameters after the action name are allowed: `/auth/reset-password` carries its
		// token that way so a rejected POST re-renders the form rather than the expired-link
		// branch.
		expect(attrs).toMatch(/\baction="\?\/[a-zA-Z]+(&[^"]*)?"/);
	});
});

/** The slice of a `RequestEvent` these actions destructure. Each action's own parameter type
 * carries its own route id, so the cast lands on an intersection of the two rather than being
 * repeated at every call site. */
type ActionEvent = Parameters<typeof signUpActions.signUp>[0] &
	Parameters<typeof signInActions.signIn>[0];

function postEvent(path: string, fields: Record<string, string>) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(fields)) formData.set(key, value);
	const written = new Map<string, string>();
	return {
		written,
		event: {
			request: new Request(`http://localhost${path}`, { method: 'POST', body: formData }),
			cookies: {
				set: (name: string, value: string) => {
					written.set(name, value);
				}
			} as unknown as Cookies,
			locals: { locale: 'en' }
		} as ActionEvent
	};
}

/** What the browser would send back. `cookies.set` receives the decoded value and SvelteKit
 * re-encodes it on the way out, so this has to encode too or a signed token containing `+`
 * or `=` arrives corrupted. */
function sentBack(written: Map<string, string>): Headers {
	const pairs = [...written].map(([name, value]) => `${name}=${encodeURIComponent(value)}`);
	return new Headers({ cookie: pairs.join('; ') });
}

describe('the no-JavaScript POST really signs somebody up (issue #262)', () => {
	// The resolved value rather than a rebuilt one, so this connects to whatever database the
	// actions under test connect to (`$lib/server/db.ts` reads the same module).
	const email = `signup-262-${randomUUID().slice(0, 8)}@canonry.invalid`;
	const password = `pw-${randomUUID()}`;
	let db: Db;

	beforeAll(() => {
		db = createDb(env.DATABASE_URL ?? 'postgres://canonry:canonry@127.0.0.1:55432/canonry', {
			max: 1
		});
	});

	afterAll(async () => {
		// `session`, `account` and `billing` are all `ON DELETE CASCADE` on `user`.
		await db.delete(userTable).where(eq(userTable.email, email));
		await closeDb(db);
	});

	it('actions.signUp creates the account and hands back a session cookie', async () => {
		const { written, event } = postEvent('/auth/sign-up?/signUp', {
			name: 'Lorenzo',
			email,
			password
		});

		const outcome: unknown = await Promise.resolve(signUpActions.signUp(event)).catch(
			(err: unknown) => err
		);
		expect(isRedirect(outcome)).toBe(true);
		if (!isRedirect(outcome)) return;
		expect(outcome.status).toBe(303);
		expect(outcome.location).toBe('/');

		const session = await auth.api.getSession({ headers: sentBack(written) });
		expect(session?.user.email).toBe(email);
		expect(session?.user.name).toBe('Lorenzo');
	});

	it('actions.signIn then authenticates the same credentials', async () => {
		const { written, event } = postEvent('/auth/sign-in?/signIn', { email, password });

		const outcome: unknown = await Promise.resolve(signInActions.signIn(event)).catch(
			(err: unknown) => err
		);
		expect(isRedirect(outcome)).toBe(true);

		const session = await auth.api.getSession({ headers: sentBack(written) });
		expect(session?.user.email).toBe(email);
	});

	it('a rejected sign-in sets no cookie and never sends the password back', async () => {
		const { written, event } = postEvent('/auth/sign-in?/signIn', {
			email,
			password: 'not-the-password'
		});

		const outcome = await signInActions.signIn(event);
		expect(isActionFailure(outcome)).toBe(true);
		expect(written.size).toBe(0);
		expect(JSON.stringify(outcome)).not.toContain('not-the-password');
	});

	it('a sign-up missing a field fails without sending the password back', async () => {
		const { written, event } = postEvent('/auth/sign-up?/signUp', { name: '', email, password });

		const outcome = await signUpActions.signUp(event);
		expect(isActionFailure(outcome)).toBe(true);
		expect(written.size).toBe(0);
		expect(JSON.stringify(outcome)).not.toContain(password);
	});
});

describe('an auth page refuses a URL that carries a credential (issue #262)', () => {
	function redirectFrom(load: unknown, url: string): unknown {
		try {
			(load as (event: { locals: object; url: URL }) => unknown)({
				locals: {},
				url: new URL(url)
			});
		} catch (err) {
			return err;
		}
		return null;
	}

	it.each([
		['http://localhost/auth/sign-in?password=hunter2', '/auth/sign-in'],
		[
			'http://localhost/auth/sign-in?email=gm%40canonry.invalid&password=hunter2',
			'/auth/sign-in?email=gm%40canonry.invalid'
		]
	])('%s redirects to %s', (from, to) => {
		const outcome = redirectFrom(signInLoad, from);
		expect(isRedirect(outcome)).toBe(true);
		if (!isRedirect(outcome)) return;
		expect(outcome.status).toBe(303);
		expect(outcome.location).toBe(to);
	});

	it('keeps the reset token while dropping the passwords beside it', () => {
		const outcome = redirectFrom(
			resetPasswordLoad,
			'http://localhost/auth/reset-password?token=abc123&newPassword=a&confirmPassword=a'
		);
		expect(isRedirect(outcome)).toBe(true);
		if (!isRedirect(outcome)) return;
		expect(outcome.location).toBe('/auth/reset-password?token=abc123');
	});

	it('leaves a clean URL alone', () => {
		expect(
			redirectFrom(resetPasswordLoad, 'http://localhost/auth/reset-password?token=abc123')
		).toBeNull();
	});
});
