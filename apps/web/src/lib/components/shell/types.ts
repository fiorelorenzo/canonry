/** Issue #379, decision R4: re-exported rather than re-declared, so the shell reads
 * the same shape `universeSetupItems()` (`$lib/server/universe-setup`) produces -
 * type-only, so it never pulls that server module into the client bundle. */
export type { UniverseSetupItem } from '$lib/server/universe-setup';

import type { EntityType, UniverseKind } from '@canonry/db/schema';

/**
 * What the sidebar's universe switcher renders per row. `baseUniverseName` is set only
 * when `kind` is `'derived'`: SPEC.md 4.1 requires that a derived universe's reliance
 * on another universe's indexed corpus stays visible in the UI rather than implicit.
 */
export interface UniverseSummary {
	id: string;
	name: string;
	slug: string;
	kind: UniverseKind;
	baseUniverseName: string | null;
	entityCount: number;
}

export interface RecentEntity {
	id: string;
	name: string;
	slug: string;
	type: EntityType;
}

/**
 * Issue #150 (F2 = A): the shell footer's quota meter, resolved once in
 * `routes/+layout.server.ts` from `billingSummaryFor` (never recomputed in a
 * component). Two independent lines, mirroring `@canonry/db`'s `Balance` - the
 * interactive ceiling (`subscriptionCredits`, decremented as it is spent) and the
 * warm cache's own separate budget (SPEC.md §15, issue #89) never share a number.
 * `includedTotal`/`warmTotal` are always a real, finite ceiling (guardrail 7 /
 * SPEC.md §15 - "unlimited" is never a value this type can hold).
 *
 * `periodEnd` (issue #201) is `Balance.periodEnd`, the same field `/settings/billing`
 * already renders - both popovers state it rather than recomputing a renewal date.
 */
export interface ShellQuota {
	includedRemaining: number;
	includedTotal: number;
	warmRemaining: number;
	warmTotal: number;
	periodEnd: Date | null;
}
