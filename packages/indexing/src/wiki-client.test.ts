/**
 * Crawls the real `MediaWikiClient` against a local fixture server (issue #58: "crawl
 * against a small local fixture server you start in the test... keep the real MediaWiki
 * client behind the same interface... so a live run is a configuration rather than a
 * code change"). Pointing `baseUrl` at a real wiki instead of `fixture.baseUrl` is the
 * entire difference between this test and a live crawl - no other code path exists.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
	MediaWikiClient,
	MEDIAWIKI_DEFAULT_RATE_LIMIT,
	WikiPageNotFoundError
} from './wiki-client.js';
import type { RateLimiter } from './rate-limiter.js';
import {
	startFixtureWikiServer,
	type FixtureWikiServer
} from './test-support/fixture-wiki-server.js';

let fixture: FixtureWikiServer | undefined;

afterEach(async () => {
	await fixture?.close();
	fixture = undefined;
});

describe('MediaWikiClient against a local fixture server', () => {
	it('lists page titles via action=query&list=allpages', async () => {
		fixture = await startFixtureWikiServer([
			{ title: 'Valdoria Reach', wikitext: 'Intro.', updatedAt: '2026-01-01T00:00:00.000Z' },
			{ title: 'Cairnmouth', wikitext: 'Intro.', updatedAt: '2026-01-01T00:00:00.000Z' }
		]);
		const client = new MediaWikiClient({ baseUrl: `${fixture.baseUrl}/api.php` });

		const titles = await client.listPageTitles();
		expect(titles.sort()).toEqual(['Cairnmouth', 'Valdoria Reach']);
	});

	it("fetches a page's wikitext, url and revision timestamp", async () => {
		fixture = await startFixtureWikiServer([
			{
				title: 'Valdoria Reach',
				wikitext: "'''Valdoria Reach''' is a coastal city.",
				updatedAt: '2026-02-15T09:30:00.000Z'
			}
		]);
		const client = new MediaWikiClient({ baseUrl: `${fixture.baseUrl}/api.php` });

		const page = await client.getPage('Valdoria Reach');
		expect(page.title).toBe('Valdoria Reach');
		expect(page.wikitext).toContain('coastal city');
		expect(page.updatedAt.toISOString()).toBe('2026-02-15T09:30:00.000Z');
		expect(page.url).toContain('Valdoria');
	});

	it('throws WikiPageNotFoundError for a title the wiki does not have', async () => {
		fixture = await startFixtureWikiServer([]);
		const client = new MediaWikiClient({ baseUrl: `${fixture.baseUrl}/api.php` });

		await expect(client.getPage('Nowhere')).rejects.toBeInstanceOf(WikiPageNotFoundError);
	});

	it('reflects an edit made between two getPage calls (setPage bumps updatedAt)', async () => {
		fixture = await startFixtureWikiServer([
			{ title: 'Cairnmouth', wikitext: 'Before the edit.', updatedAt: '2026-01-01T00:00:00.000Z' }
		]);
		const client = new MediaWikiClient({ baseUrl: `${fixture.baseUrl}/api.php` });

		const before = await client.getPage('Cairnmouth');
		expect(before.wikitext).toBe('Before the edit.');

		fixture.setPage({
			title: 'Cairnmouth',
			wikitext: 'After the edit.',
			updatedAt: '2026-03-01T00:00:00.000Z'
		});
		const after = await client.getPage('Cairnmouth');
		expect(after.wikitext).toBe('After the edit.');
		expect(after.updatedAt.toISOString()).toBe('2026-03-01T00:00:00.000Z');
	});

	it('defaults to the SPEC.md §7 rate of 15 req/s when none is configured', () => {
		expect(MEDIAWIKI_DEFAULT_RATE_LIMIT).toBe(15);
	});

	it('calls acquire() on the injected rate limiter before every request', async () => {
		fixture = await startFixtureWikiServer([
			{ title: 'A', wikitext: 'a', updatedAt: '2026-01-01T00:00:00.000Z' },
			{ title: 'B', wikitext: 'b', updatedAt: '2026-01-01T00:00:00.000Z' }
		]);
		let acquireCalls = 0;
		const countingLimiter: RateLimiter = {
			async acquire() {
				acquireCalls += 1;
			}
		};
		const client = new MediaWikiClient({
			baseUrl: `${fixture.baseUrl}/api.php`,
			rateLimiter: countingLimiter
		});

		await client.listPageTitles();
		await client.getPage('A');
		await client.getPage('B');

		expect(acquireCalls).toBe(3);
		expect(fixture.requestCount).toBe(3);
	});
});
