/**
 * `/w/[universe]/entries`: the entry browser, decision O1 = C (#283). The flat list that used
 * to sit under the overview strip on `/w/[universe]` becomes a dense table here - name, type,
 * relations, facts, changed - and the world home keeps the other job.
 *
 * **Real pagination**, which is the second of the decision's three non-optional points. The
 * page this replaces read `BROWSE_LIMIT = 500` rows in one go and drew no pages at all, so a
 * world larger than the sample one silently lost everything past row 500. `entityBrowserPage`
 * takes a limit and an offset and counts the matching total separately, and `pageWindow`
 * clamps the page number into that total, so the footer's "1-25 of 214, page 1 of 9" is
 * arithmetic over the same numbers the query used rather than a decoration over a capped list.
 *
 * **Search narrows, a column header orders.** The old page swapped in
 * `searchEntitiesByNameOrAlias`, whose whole point is a relevance ranking (exact name, then
 * prefix, then alias). A table cannot honestly do both: with a caret drawn on "Relations", a
 * hidden relevance order would make that caret a lie. So `entityBrowserPage`'s own
 * name-or-alias-or-body substring predicate (R12, round thirteen) lives inside it as a
 * filter, and the order is always the column the header says. The palette (#149) is still
 * where ranked, "who is this" search belongs.
 *
 * The "New entry" dialog and its action moved here with the list, since this is where a GM is
 * looking at entries; the palette's `?new=entry` action points here too, and the home's cold
 * empty state links here rather than growing a second create path.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import {
	createEntity,
	entityBrowserPage,
	entityCountsByType,
	universeAccessBySlug
} from '@canonry/db';
import { db } from '$lib/server/db';
import { scheduleEntityIndexJob } from '$lib/server/jobs';
import { messages } from '$lib/i18n';
import { stripMentionSyntax } from '$lib/markdown';
import {
	isBrowsableType,
	PAGE_SIZE,
	pageWindow,
	parseBrowseParams
} from '$lib/components/entries/browse-params';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url, locals }) => {
	const { current } = await parent();
	if (!locals.user) error(404, `no universe called "${current.slug}"`);
	const database = db();

	const params = parseBrowseParams(url.searchParams);

	// One count for the chips, one paged read for the table. The chips' counts are
	// deliberately unfiltered by search: a chip that changed its number as you typed would
	// stop being the world's shape and become a second search result.
	const counts = await entityCountsByType(database, current.id);

	// Read the page as asked, then clamp: `pageWindow` needs the total to clamp against, and
	// the total arrives with the rows. The second read only ever happens for a page that did
	// not exist (a `?page=99` typed by hand, or a filter that just shrank the result set under
	// the page the GM was on), which is also the only case where the alternative - drawing an
	// empty table under a footer that says "page 4 of 2" - would have been the bug.
	const query = {
		type: params.type ?? undefined,
		query: params.query,
		sort: params.sort,
		direction: params.direction,
		limit: PAGE_SIZE
	};
	let result = await entityBrowserPage(database, current.id, {
		...query,
		offset: (params.page - 1) * PAGE_SIZE
	});
	let window = pageWindow(result.total, params.page);
	if (window.page !== params.page) {
		result = await entityBrowserPage(database, current.id, { ...query, offset: window.offset });
		window = pageWindow(result.total, window.page);
	}

	return {
		rows: result.rows.map((row) => ({
			id: row.id,
			name: row.name,
			type: row.type,
			slug: row.slug,
			excerpt: stripMentionSyntax(row.excerpt),
			updatedAt: row.updatedAt,
			relationCount: row.relationCount,
			factCount: row.factCount
		})),
		counts,
		// Every entry of every type, which is what the "All" chip counts - never the filtered
		// total, or the chip would restate the number the footer already shows.
		totalCount: Object.values(counts).reduce((sum: number, n) => sum + (n ?? 0), 0),
		matchedCount: result.total,
		params,
		window
	};
};

export const actions: Actions = {
	/** Moved verbatim from `/w/[universe]` with the list it belongs to (#283). The smallest
	 * honest write that gets a GM from a name and a type to a slug they can open in the real
	 * editor: no body, no revision, no `scheduleCanonSaveJob`, because guardrail 2's one write
	 * path for canon (`saveEntityBody`) is what the editor's own first save already calls.
	 *
	 * It does schedule an index job since issue #703, and the two are not in tension: that job
	 * runs the index engine and nothing else, so it writes no canon and raises no proposal. An
	 * entry created here has a name, aliases and no prose, which is exactly the state the
	 * entity-level point exists for - before it, this entry was invisible to the copilot until
	 * the GM's first save, and #535's floor work made that read as "the world does not say"
	 * rather than "this entry is not written yet". */
	createEntry: async ({ request, params, locals }) => {
		if (!locals.user) error(404, `no universe called "${params.universe}"`);
		const conn = db();
		const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
		if (!access) error(404, `no universe called "${params.universe}"`);

		const t = messages(locals.locale).universe.index.newEntryDialog;
		if (access.role === 'viewer') return fail(403, { message: t.viewerForbiddenError });

		const form = await request.formData();
		const name = form.get('name');
		const type = form.get('type');
		if (typeof name !== 'string' || name.trim().length === 0) {
			return fail(400, { message: t.nameRequiredError });
		}
		// Two statements rather than one disjunction: a negated type guard inside `||` does not
		// narrow `type` for the `createEntity` call below.
		if (typeof type !== 'string') return fail(400, { message: t.typeRequiredError });
		if (!isBrowsableType(type)) return fail(400, { message: t.typeRequiredError });

		const created = await createEntity(conn, {
			universeId: access.universe.id,
			type,
			name: name.trim()
		});
		scheduleEntityIndexJob({
			universeId: access.universe.id,
			entityId: created.id,
			entityName: created.name,
			userId: locals.user.id,
			locale: locals.locale
		});

		redirect(303, `/w/${params.universe}/e/${created.slug}/edit`);
	}
};
