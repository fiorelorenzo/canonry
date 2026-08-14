/**
 * MediaWiki Action API client (SPEC.md §7/§11.3: "MediaWiki crawl at 15 req/s"). One
 * class serves production and tests alike - `baseUrl` is the only thing that changes
 * between a real wiki and a local fixture server started inside a test (issue #58's "a
 * live run is a configuration rather than a code change"). Uses the core `action=query`
 * endpoint only (`prop=revisions|info`, `list=allpages`), never an extension like
 * TextExtracts, so it works against any MediaWiki installation.
 */
import { TokenBucketRateLimiter, type RateLimiter } from './rate-limiter.js';

export interface WikiPage {
	title: string;
	url: string;
	wikitext: string;
	updatedAt: Date;
}

export interface WikiClient {
	listPageTitles(): Promise<string[]>;
	getPage(title: string): Promise<WikiPage>;
}

export class WikiRequestError extends Error {
	constructor(
		public readonly url: string,
		public readonly status: number
	) {
		super(`MediaWiki API request to ${url} failed with status ${status}`);
		this.name = 'WikiRequestError';
	}
}

export class WikiPageNotFoundError extends Error {
	constructor(public readonly title: string) {
		super(`MediaWiki page not found: "${title}"`);
		this.name = 'WikiPageNotFoundError';
	}
}

export const MEDIAWIKI_DEFAULT_RATE_LIMIT = 15;

export interface MediaWikiClientConfig {
	/** The wiki's api.php endpoint, e.g. `https://en.wikipedia.org/w/api.php`, or a local
	 * fixture server's url in tests. Everything else about a live crawl versus a test run
	 * is identical. */
	baseUrl: string;
	userAgent?: string;
	/** SPEC.md §7/§11.3 default: 15. Overridable per source (`data_source.config`), never
	 * hardcoded past the constructor. */
	requestsPerSecond?: number;
	fetchImpl?: typeof fetch;
	/** Injectable so a test can assert throttling behaviour without waiting on real
	 * wall-clock seconds. */
	rateLimiter?: RateLimiter;
}

interface AllPagesResponse {
	query: { allpages: Array<{ title: string }> };
	continue?: { apcontinue: string };
}

interface RevisionsResponse {
	query: {
		pages: Record<
			string,
			{
				title: string;
				fullurl?: string;
				missing?: string;
				revisions?: Array<{ timestamp: string; slots: { main: { content: string } } }>;
			}
		>;
	};
}

export class MediaWikiClient implements WikiClient {
	private readonly baseUrl: string;
	private readonly userAgent: string;
	private readonly fetchImpl: typeof fetch;
	private readonly rateLimiter: RateLimiter;

	constructor(config: MediaWikiClientConfig) {
		this.baseUrl = config.baseUrl;
		this.userAgent = config.userAgent ?? 'Canonry-Indexer/1.0 (+https://canonry.example.com)';
		this.fetchImpl = config.fetchImpl ?? fetch;
		this.rateLimiter =
			config.rateLimiter ??
			new TokenBucketRateLimiter(config.requestsPerSecond ?? MEDIAWIKI_DEFAULT_RATE_LIMIT);
	}

	private async call<T>(params: Record<string, string>): Promise<T> {
		await this.rateLimiter.acquire();
		const url = new URL(this.baseUrl);
		for (const [key, value] of Object.entries({ format: 'json', ...params })) {
			url.searchParams.set(key, value);
		}
		const response = await this.fetchImpl(url, { headers: { 'user-agent': this.userAgent } });
		if (!response.ok) throw new WikiRequestError(url.toString(), response.status);
		return (await response.json()) as T;
	}

	/** Paginates through `list=allpages` via `apcontinue` until the wiki stops returning
	 * a continuation token. */
	async listPageTitles(): Promise<string[]> {
		const titles: string[] = [];
		let apcontinue: string | undefined;
		do {
			const params: Record<string, string> = { action: 'query', list: 'allpages', aplimit: 'max' };
			if (apcontinue !== undefined) params.apcontinue = apcontinue;
			const body = await this.call<AllPagesResponse>(params);
			titles.push(...body.query.allpages.map((p) => p.title));
			apcontinue = body.continue?.apcontinue;
		} while (apcontinue !== undefined);
		return titles;
	}

	async getPage(title: string): Promise<WikiPage> {
		const body = await this.call<RevisionsResponse>({
			action: 'query',
			prop: 'revisions|info',
			titles: title,
			rvprop: 'content|timestamp',
			rvslots: 'main',
			inprop: 'url'
		});
		const page = Object.values(body.query.pages)[0];
		const revision = page?.revisions?.[0];
		if (!page || page.missing !== undefined || !revision) throw new WikiPageNotFoundError(title);
		return {
			title: page.title,
			url: page.fullurl ?? `${this.baseUrl}?title=${encodeURIComponent(page.title)}`,
			wikitext: revision.slots.main.content,
			updatedAt: new Date(revision.timestamp)
		};
	}
}
