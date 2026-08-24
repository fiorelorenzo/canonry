/**
 * The disk-backed embedding cache `onenote-relations` replays through, extracted from it by
 * issue #668 so the bug that issue is about can be tested at all: that file ends in
 * `await main()`, so importing it to reach the function drives a real gateway and a real
 * database.
 *
 * **Why a cache exists next to a recording, since #668 asks whether it should.** It should,
 * and the two are not the same half of the run. `--record` captures the *driver's* event
 * stream: everything the model said, which is the expensive and non-reproducible part. It
 * captures no embedding, because no embedding goes through the driver. The merge engine takes
 * them itself, on the harness side, through `bandedSimilarity`'s `embed` for entity matching
 * and through `embedRelationLabel` for `resolveRelationType`'s semantic rung. So a replay with
 * no cache has to re-embed every entity name and every relation label against the real
 * gateway, which means a replay needs a credential, costs money on every run, and stops being
 * bit-identical to the run before it. With the cache a replay reaches no gateway at all, which
 * is what this harness's own header promises and what two issues (#629, #637) promise when they
 * say the corpus costs nothing to re-derive. The cache is kept beside the events for that
 * reason (`/home/dev/corpora/onenote-luca/recordings/` carries both), and deleting it would
 * quietly turn every free replay into a paid one.
 *
 * It buys one more thing worth naming, because it is why `inner` is nullable rather than
 * absent: a replay of a change that makes the merge engine do *more* work than the recorded
 * run legitimately asks for embeddings the recording never took, and topping those up once and
 * caching them is more honest than pretending the two runs did the same work. A cache that
 * spans recordings is what makes that top-up a one-off rather than a per-run cost.
 *
 * The bug #668 filed: `missing` used to be `texts.filter(...)`, so a batch containing the same
 * string twice asked the inner embedder for it twice, and the write-back loop then skipped the
 * second occurrence (its key was already in the cache) without advancing its counter into the
 * returned vectors. From the first repeat onwards every text was handed its predecessor's
 * vector. `bestSemanticMatch` batches the proposed label together with every string the
 * catalogue is known by, and that list contains `contains` twice and `contiene` twice, so the
 * tail of the candidate list was shifted by two on every relation a first import resolved.
 * The shape of the bug is that it is invisible with no duplicate present and silently wrong for
 * everything after one, which is why the test beside this file is the point rather than the fix.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Embedder } from '@canonry/indexing';

/**
 * Wraps `inner` in a cache persisted at `cachePath`, keyed by the sha256 of each text.
 *
 * `inner` may be null, which is the credential-free replay: a cache miss is then a hard error
 * naming how many vectors the recorded run never took, rather than a zero vector that would
 * score 0 and read as a legitimate "no similarity".
 */
export function cachedEmbedder(inner: Embedder | null, cachePath: string): Embedder {
	const cache: Record<string, number[]> = existsSync(cachePath)
		? (JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, number[]>)
		: {};

	return async (texts: string[]): Promise<number[][]> => {
		const keys = texts.map((text) => createHash('sha256').update(text).digest('hex'));

		// One entry per *distinct* missing key, and the vectors come back in this array's own
		// order, so the write-back is an index into it rather than a counter walking `texts` and
		// hoping the two stay in step. A duplicate inside one batch is therefore asked for once
		// rather than twice, which is also the cheaper thing to do.
		const missingKeys: string[] = [];
		const missingTexts: string[] = [];
		const requested = new Set<string>();
		for (let i = 0; i < texts.length; i++) {
			const key = keys[i]!;
			if (cache[key] !== undefined || requested.has(key)) continue;
			requested.add(key);
			missingKeys.push(key);
			missingTexts.push(texts[i]!);
		}

		if (missingKeys.length > 0) {
			if (!inner) {
				throw new Error(
					`replay asked for ${missingKeys.length} embedding(s) the recorded run never took. ` +
						'Re-record, or check that the merge engine is being fed the same payloads.'
				);
			}
			const vectors = await inner(missingTexts);
			// An embedder that returns a different number of vectors than it was asked for would
			// otherwise be absorbed silently, and the vectors it did return would be misaligned
			// from that point on - the same class of defect as #668 itself, one layer down.
			if (vectors.length !== missingTexts.length) {
				throw new Error(
					`embedder returned ${vectors.length} vector(s) for ${missingTexts.length} text(s)`
				);
			}
			for (let m = 0; m < missingKeys.length; m++) cache[missingKeys[m]!] = vectors[m]!;
			writeFileSync(cachePath, JSON.stringify(cache));
		}

		return keys.map((key) => cache[key]!);
	};
}
