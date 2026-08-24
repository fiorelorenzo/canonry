/**
 * Issue #668. The defining property of the bug this file pins is that it is invisible unless a
 * duplicate is present in the batch, and then silently wrong for every text after the first
 * repeat, so a test that embeds a batch of distinct strings passes against the broken code.
 * The first case below is the issue's own reproduction verbatim: an inner embedder mapping
 * `"N"` to `[N]`, the batch `1 2 3 2 4 5`, which returned `[1] [2] [3] [2] [2] [4]`.
 *
 * Why it mattered rather than being a harness wart: `bestSemanticMatch` embeds the proposed
 * label together with every string the catalogue is known by in one call, and that list carries
 * `contains` twice (`located_in`'s inverse and `part_of`'s) and `contiene` twice, so the tail of
 * the candidate list was shifted by two on every relation a first import scored.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Embedder } from '@canonry/indexing';
import { cachedEmbedder } from './embedding-cache.js';

let dir: string;
let seq = 0;

beforeAll(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'canonry-embedding-cache-'));
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** A fresh cache path per case, so one case's writes cannot answer another's misses. */
function cachePath(): string {
	return path.join(dir, `cache-${++seq}.json`);
}

/** Maps `"N"` to the one-element vector `[N]`, so a returned vector names the text it belongs
 * to and a misalignment is readable rather than a float comparison. Records every batch it was
 * handed, because "was the duplicate asked for twice" is half of what #668 is about. */
function numberEmbedder(): { embed: Embedder; batches: string[][] } {
	const batches: string[][] = [];
	return {
		batches,
		embed: async (texts: string[]) => {
			batches.push([...texts]);
			return texts.map((text) => [Number(text)]);
		}
	};
}

describe('cachedEmbedder (issue #668)', () => {
	it('returns the right vector for every text when a batch repeats one', async () => {
		const inner = numberEmbedder();
		const embed = cachedEmbedder(inner.embed, cachePath());

		const vectors = await embed(['1', '2', '3', '2', '4', '5']);

		// Broken, this was [[1],[2],[3],[2],[2],[4]]: correct up to the repeat, then every
		// later text carried its predecessor's vector.
		expect(vectors).toEqual([[1], [2], [3], [2], [4], [5]]);
	});

	it('asks the inner embedder for a repeated text once rather than twice', async () => {
		const inner = numberEmbedder();
		const embed = cachedEmbedder(inner.embed, cachePath());

		await embed(['1', '2', '3', '2', '4', '5']);

		expect(inner.batches).toEqual([['1', '2', '3', '4', '5']]);
	});

	it('stays correct when the repeat is the first text, and when a text repeats three times', async () => {
		const inner = numberEmbedder();
		const embed = cachedEmbedder(inner.embed, cachePath());

		expect(await embed(['7', '7', '8'])).toEqual([[7], [7], [8]]);
		expect(await embed(['9', '1', '9', '1', '9'])).toEqual([[9], [1], [9], [1], [9]]);
	});

	it('serves a second call from the cache and only asks for what is new', async () => {
		const inner = numberEmbedder();
		const embed = cachedEmbedder(inner.embed, cachePath());

		await embed(['1', '2']);
		const second = await embed(['2', '3', '1', '3']);

		expect(second).toEqual([[2], [3], [1], [3]]);
		expect(inner.batches).toEqual([['1', '2'], ['3']]);
	});

	it('reads a cache a previous process wrote, so a replay costs nothing', async () => {
		const file = cachePath();
		const first = numberEmbedder();
		await cachedEmbedder(first.embed, file)(['1', '2', '2', '3']);

		// A second embedder instance over the same file, with no inner embedder at all: this is
		// the credential-free replay, and it can only work if the whole batch is cached.
		const replayed = await cachedEmbedder(null, file)(['1', '2', '2', '3']);

		expect(replayed).toEqual([[1], [2], [2], [3]]);
	});

	it('refuses a miss with no inner embedder rather than returning a zero vector', async () => {
		const file = cachePath();
		await cachedEmbedder(numberEmbedder().embed, file)(['1']);

		await expect(cachedEmbedder(null, file)(['1', '2'])).rejects.toThrow(
			/replay asked for 1 embedding\(s\)/
		);
	});

	it('refuses an inner embedder that returns the wrong number of vectors', async () => {
		const short: Embedder = async (texts) => texts.slice(1).map(() => [0]);

		await expect(cachedEmbedder(short, cachePath())(['1', '2', '3'])).rejects.toThrow(
			/returned 2 vector\(s\) for 3 text\(s\)/
		);
	});

	it('persists one entry per distinct text', async () => {
		const file = cachePath();
		await cachedEmbedder(numberEmbedder().embed, file)(['1', '2', '2', '3', '1']);

		const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, number[]>;
		expect(Object.keys(written)).toHaveLength(3);
	});

	it('does not rewrite the cache file when every text is already cached', async () => {
		const file = cachePath();
		const embed = cachedEmbedder(numberEmbedder().embed, file);
		await embed(['1', '2']);

		// A sentinel the embedder would clobber if it wrote on a pure hit. The recording's cache
		// is 9 MB, and this harness calls the embedder once per relation, so writing it back on
		// every hit would be the harness's dominant cost.
		writeFileSync(file, '{"sentinel": [0]}');
		await embed(['1', '2']);

		expect(readFileSync(file, 'utf8')).toBe('{"sentinel": [0]}');
	});
});
