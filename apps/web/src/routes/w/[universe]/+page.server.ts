/**
 * `/w/[universe]`: issue #145, decision I7 = C ("one page, two modes", docs/ux/DECISIONS.md).
 * The universe home is now the entry browser - a type filter row with real counts, a
 * name/alias search, and a "New entry" action the product had nowhere - with a
 * collapsible overview strip pinned above it (what changed, waiting for review, quota,
 * current work). Replaces the three-sentence Recent-list page this route used to render.
 *
 * Reuses `current` from the layout's own load (`await parent()`) rather than re-querying
 * it, same as the page this replaces did.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import {
	createEntity,
	entityCountsByType,
	listEntitiesForUniverse,
	mostRecentWorkNode,
	searchEntitiesByNameOrAlias,
	universeAccessBySlug,
	type EntityBrowserRow,
	type EntitySearchHit
} from '@canonry/db';
import type { EntityType } from '@canonry/db/schema';
import { db } from '$lib/server/db';
import { messages } from '$lib/i18n';
import { pendingProposalCount } from '$lib/server/proposals';
import { billingSummaryFor } from '$lib/server/billing/subscription';
import { stripMentionSyntax } from '$lib/markdown';
import type { Actions, PageServerLoad } from './$types';

// A universe holding "dozens to a few hundred entries" (table-search.ts's own
// characterisation of what the instant lane is sized for) fits on one page with no
// pagination UI; generous enough that "every entry is reachable by filtering or
// searching" (the issue's acceptance line) holds even for the fixture's 214-entry
// universe, never truncating silently the way the old Recent-only page effectively did.
const BROWSE_LIMIT = 500;

// Deliberately five of the six entity types, not six: 'session' has no create path
// anywhere in the product yet (grepping the app for `type: 'session'` turns up nothing
// but test fixtures), so it earns no filter chip and no dialog option. It still shows
// under "All" and through search - reachable, just not a first-class browsing category
// until something in the product actually creates one on purpose.
const BROWSABLE_TYPES: EntityType[] = ['character', 'place', 'faction', 'event', 'item'];

function isBrowsableType(value: FormDataEntryValue | string | null): value is EntityType {
	return typeof value === 'string' && (BROWSABLE_TYPES as string[]).includes(value);
}

// Issue #145: the overview strip's own collapse state, persisted per user. A cookie is
// the same mechanism `$lib/theme.ts` (THEME_COOKIE) and `$lib/i18n` (LOCALE_COOKIE)
// already use for a per-account UI preference with nowhere else to live - there is no
// per-user "preferences" table this wave, and a cookie survives a reload with no
// server round trip needed just to read it back. Absent means expanded: a first visit
// shows the full strip, and it only ever collapses once a GM has actually clicked to
// collapse it (the artifact's own caption: "collapsed by default after the first visit").
const STRIP_COLLAPSED_COOKIE = 'canonry_entries_strip_collapsed';
const STRIP_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface BrowserRow {
	id: string;
	name: string;
	type: EntityType;
	slug: string;
	excerpt: string;
	updatedAt: Date;
	matchedAlias: string | null;
}

function toBrowserRow(row: EntitySearchHit | EntityBrowserRow): BrowserRow {
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		slug: row.slug,
		excerpt: stripMentionSyntax(row.excerpt),
		updatedAt: row.updatedAt,
		matchedAlias: 'matchedAlias' in row ? row.matchedAlias : null
	};
}

export const load: PageServerLoad = async ({ parent, url, cookies, locals }) => {
	const { current } = await parent();
	if (!locals.user) error(404, `no universe called "${current.slug}"`);
	const database = db();

	const typeParam = url.searchParams.get('type');
	const selectedType = isBrowsableType(typeParam) ? typeParam : null;
	const q = url.searchParams.get('q')?.trim() ?? '';

	// Search (issue #75's instant lane, name/alias only - never the vector index, which
	// belongs to the palette this issue explicitly defers to) and the plain recency
	// browse are mutually exclusive per request, so only one of the two ever runs.
	const entriesPromise: Promise<(EntitySearchHit | EntityBrowserRow)[]> = q
		? searchEntitiesByNameOrAlias(database, current.id, q, {
				type: selectedType ?? undefined,
				limit: BROWSE_LIMIT
			})
		: listEntitiesForUniverse(database, current.id, {
				type: selectedType ?? undefined,
				limit: BROWSE_LIMIT
			});

	const [rawEntries, counts, pendingReview, billing, currentWork, mostRecentChanged] =
		await Promise.all([
			entriesPromise,
			entityCountsByType(database, current.id),
			pendingProposalCount(database, current.id),
			billingSummaryFor(locals.user.id),
			mostRecentWorkNode(database, current.id),
			// The strip's "what changed" signal always reads the true most-recent change,
			// independent of whatever type filter or search is active below it.
			listEntitiesForUniverse(database, current.id, { limit: 1 })
		]);

	const totalCount = Object.values(counts).reduce((sum: number, n) => sum + (n ?? 0), 0);

	// `subscriptionCredits` is the *remaining* balance (it decrements as it's spent -
	// see packages/db/src/queries/billing.ts's `recordAndCharge`), so "used" is the
	// granted period allotment minus what's left. Falls back to the remaining balance
	// itself only for the edge case of an account on a plan this deployment stopped
	// selling (`billing.plan` undefined), where there is no granted figure to diff against.
	const quotaTotal =
		billing.plan?.subscriptionCreditsPerPeriod ?? billing.balance.subscriptionCredits;
	const quotaUsed = Math.max(0, quotaTotal - billing.balance.subscriptionCredits);

	const whatChangedRow = mostRecentChanged[0];

	return {
		entries: rawEntries.map(toBrowserRow),
		counts,
		totalCount,
		selectedType,
		query: q,
		stripCollapsed: cookies.get(STRIP_COLLAPSED_COOKIE) === 'true',
		pendingReview,
		quota: { used: quotaUsed, total: quotaTotal },
		currentWork,
		whatChanged: whatChangedRow
			? {
					name: whatChangedRow.name,
					slug: whatChangedRow.slug,
					updatedAt: whatChangedRow.updatedAt
				}
			: null
	};
};

async function requireEditorAccess(locals: App.Locals, universeSlug: string) {
	if (!locals.user) error(404, `no universe called "${universeSlug}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, universeSlug, locals.user.id);
	if (!access) error(404, `no universe called "${universeSlug}"`);
	return { conn, world: access.universe, role: access.role };
}

export const actions: Actions = {
	/** Issue #145's whole write surface: a name and a type, an entity row, and a
	 * redirect into the real editor. No body, no revision, no `scheduleCanonSaveJob` -
	 * guardrail 2's one write path for canon (`saveEntityBody`) is what the editor's own
	 * first save already calls; this action only ever gets a GM to that door. */
	createEntry: async ({ request, params, locals }) => {
		const { conn, world, role } = await requireEditorAccess(locals, params.universe);
		const t = messages(locals.locale).universe.index.newEntryDialog;
		if (role === 'viewer') return fail(403, { message: t.viewerForbiddenError });

		const form = await request.formData();
		const name = form.get('name');
		const type = form.get('type');
		if (typeof name !== 'string' || name.trim().length === 0) {
			return fail(400, { message: t.nameRequiredError });
		}
		if (!isBrowsableType(type)) {
			return fail(400, { message: t.typeRequiredError });
		}

		const created = await createEntity(conn, {
			universeId: world.id,
			type,
			name: name.trim()
		});

		redirect(303, `/w/${params.universe}/e/${created.slug}/edit`);
	},

	toggleStrip: async ({ request, cookies }) => {
		const form = await request.formData();
		const collapsed = form.get('collapsed') === 'true';
		cookies.set(STRIP_COLLAPSED_COOKIE, collapsed ? 'true' : 'false', {
			path: '/',
			maxAge: STRIP_COOKIE_MAX_AGE
		});
		return { stripCollapsed: collapsed };
	}
};
