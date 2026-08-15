/**
 * Resolves the theme cookie once for every route, so a page that wants to reflect the
 * current preference (the settings form's default-checked radio) reads it from
 * `await parent()` instead of re-parsing the cookie itself.
 *
 * Also the one place `locals.user` becomes page data (issue #86): the shell's
 * sign-in status reads `data.user` from here rather than every layout re-deriving it,
 * same reasoning as the theme preference above. Only the fields a template needs ever
 * cross into page data - never the session id or anything else `locals.session` carries.
 *
 * `locale` (issue #120, SPEC.md §17) is `locals.locale`, already resolved once in
 * hooks.server.ts - every nested route's load function and every `.svelte` component
 * reads it from `data.locale` (SvelteKit merges every layout's returned data down the
 * tree) rather than re-negotiating it. Only the resolved `Locale` string crosses into
 * page data, never the message catalogue itself: `Messages` is half functions, which
 * `devalue` (SvelteKit's data serializer) cannot carry across the server/client
 * boundary - every consumer calls `messages(data.locale)` itself instead.
 *
 * `origin` rides the same event `url` that `adapter-node` rewrites from `ORIGIN` in
 * production (see `$lib/server/auth.ts`'s own `env.ORIGIN` read) - the root layout's
 * Open Graph image tag needs an absolute URL and this is the one place that origin is
 * already correct for every environment, dev included, without hardcoding a domain.
 *
 * Issue #141: `universes` is also here now, not only inside `w/[universe]`'s own
 * layout - the shell's switcher reaches every route, signed in or not yet in a
 * universe, so `routes/+page.server.ts` reads this list from `await parent()`
 * instead of querying `universesForUser` a second time. The entry count per universe
 * is one grouped query (`entityCountsByUniverseIds`) rather than one `count(*)` per
 * universe - that per-universe query is exactly the N+1 shape that is fine scoped to
 * a single universe's own switcher (`w/[universe]/+layout.server.ts`) but would be a
 * real cost multiplied across every page in the app if it ran here too.
 *
 * Issue #150 (F2 = A): `shellQuota` joins `universes` here for the same reason - the
 * shell footer's meter renders on every page, so it reads `billingSummaryFor` (the
 * same function /settings/billing already calls) once per navigation instead of
 * adding a per-component fetch. The added cost is one extra call alongside the two
 * queries above: `billingSummaryFor` is a single primary-key lookup on
 * `user_billing` (an insert-if-missing that no-ops for an existing row, then a
 * select by `userId`, its primary key - no join, no scan), plus an in-memory lookup
 * of the matching `SUBSCRIPTION_PLANS` entry. Never computed for a signed-out
 * request, same guard as `universes` below. Named `shellQuota` rather than `quota`
 * because `w/[universe]/+page.server.ts` already returns its own `quota: { used,
 * total }` for `OverviewStrip` - SvelteKit merges every load's return value onto one
 * `page.data` object by key, so a name collision there would have the page load's
 * shape silently win over this layout's on every universe route.
 */
import { entityCountsByUniverseIds, universesForUser } from '@canonry/db';
import { db } from '$lib/server/db';
import { billingSummaryFor } from '$lib/server/billing/subscription';
import { parseThemePreference, THEME_COOKIE } from '$lib/theme';
import type { ShellQuota, UniverseSummary } from '$lib/components/shell/types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, locals, url }) => {
	let universes: UniverseSummary[] = [];
	let shellQuota: ShellQuota | null = null;
	if (locals.user) {
		const database = db();
		const [rows, summary] = await Promise.all([
			universesForUser(database, locals.user.id),
			billingSummaryFor(locals.user.id)
		]);
		const nameById = new Map(rows.map((row) => [row.id, row.name]));
		const entityCounts = await entityCountsByUniverseIds(
			database,
			rows.map((row) => row.id)
		);
		universes = rows.map((row) => ({
			id: row.id,
			name: row.name,
			slug: row.slug,
			kind: row.kind,
			baseUniverseName: row.baseUniverseId ? (nameById.get(row.baseUniverseId) ?? null) : null,
			entityCount: entityCounts.get(row.id) ?? 0
		}));

		// `subscriptionCredits` is the *remaining* interactive balance - it decrements
		// as it's spent (see w/[universe]/+page.server.ts's own comment on the same
		// field), matching exactly what /settings/billing labels "Included this
		// period". The total is the plan's granted-per-period figure, falling back to
		// the remaining balance itself only for an account on a plan this deployment
		// stopped selling, where there is no granted figure to diff against.
		const includedTotal =
			summary.plan?.subscriptionCreditsPerPeriod ?? summary.balance.subscriptionCredits;
		shellQuota = {
			includedRemaining: summary.balance.subscriptionCredits,
			includedTotal,
			warmRemaining: summary.balance.warmBudgetRemaining,
			warmTotal: summary.balance.warmBudgetCredits
		};
	}

	return {
		themePreference: parseThemePreference(cookies.get(THEME_COOKIE)),
		user: locals.user
			? { id: locals.user.id, name: locals.user.name, email: locals.user.email }
			: null,
		locale: locals.locale,
		origin: url.origin,
		universes,
		shellQuota
	};
};
