/**
 * A minimal local stand-in for a MediaWiki `api.php` (issue #58: "crawl against a small
 * local fixture server you start in the test... a live run is a configuration rather
 * than a code change"). Implements exactly the two calls `MediaWikiClient` makes -
 * `action=query&list=allpages` and `action=query&prop=revisions|info` - against the same
 * JSON shape a real wiki returns, so the production client is what every crawl test
 * exercises, never a parallel fake client class.
 */
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FixtureWikiPage {
	title: string;
	wikitext: string;
	/** ISO 8601 - stands in for the wiki's revision timestamp. */
	updatedAt: string;
}

export interface FixtureWikiServer {
	baseUrl: string;
	requestCount: number;
	/** Replaces (or adds) a page and bumps `updatedAt`, for idempotency tests that need
	 * to simulate an edit between two crawl runs. */
	setPage(page: FixtureWikiPage): void;
	close(): Promise<void>;
}

function sendJson(res: ServerResponse, body: unknown): void {
	res.writeHead(200, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

export async function startFixtureWikiServer(
	initialPages: FixtureWikiPage[]
): Promise<FixtureWikiServer> {
	const pages = new Map(initialPages.map((page) => [page.title, page]));
	const state = { requestCount: 0, baseUrl: '' };

	const server: Server = createServer((req, res) => {
		state.requestCount += 1;
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const action = url.searchParams.get('action');
		const list = url.searchParams.get('list');
		const prop = url.searchParams.get('prop') ?? '';

		if (action === 'query' && list === 'allpages') {
			sendJson(res, { query: { allpages: [...pages.values()].map((p) => ({ title: p.title })) } });
			return;
		}

		if (action === 'query' && prop.includes('revisions')) {
			const title = url.searchParams.get('titles') ?? '';
			const page = pages.get(title);
			if (!page) {
				sendJson(res, { query: { pages: { '-1': { title, missing: '' } } } });
				return;
			}
			sendJson(res, {
				query: {
					pages: {
						'1': {
							title: page.title,
							fullurl: `${state.baseUrl}/wiki/${encodeURIComponent(page.title)}`,
							revisions: [
								{ timestamp: page.updatedAt, slots: { main: { content: page.wikitext } } }
							]
						}
					}
				}
			});
			return;
		}

		res.writeHead(404).end();
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address() as AddressInfo;
	state.baseUrl = `http://127.0.0.1:${address.port}`;

	return {
		get baseUrl() {
			return state.baseUrl;
		},
		get requestCount() {
			return state.requestCount;
		},
		setPage(page: FixtureWikiPage): void {
			pages.set(page.title, page);
		},
		async close(): Promise<void> {
			await new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			});
		}
	};
}
