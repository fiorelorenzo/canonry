/**
 * Round seventeen V1 = B (#494) named three body widths and no others. Round twenty
 * X1 = A (#598) made the band take the same one, so this map is where both halves of a
 * page read their width from.
 *
 * Why one map rather than a class on each component: before X1 the band sat flush
 * against `main`'s gutter while the body centred inside it, so the distance between a
 * page's title and the first line of its own prose was `max(0, (available - cap) / 2)` -
 * six distinct values between 0 and 336 depending on the width the page declared, on
 * whether the route sat inside the app shell, and on the viewport. Reading the same
 * entry of this map for the band's content box and for the body's makes that distance 0
 * by construction rather than by convention, at every width and on every call site.
 *
 * The values are complete literal class strings, for the reason the old
 * `page-body.svelte` stated: Tailwind only emits a utility for a class name it can find
 * spelled out in a source file, so an interpolated `max-w-${width}` produces no CSS at
 * all. This file is now the only place in `apps/web` where those two container tokens
 * are spelled, and `page-header-offset.test.ts` checks that, because a route that spells
 * one itself is a route that can disagree with its own band again.
 *
 * - reading (44rem, `--container-reading`): an entry, the docs, the privacy page, the
 *   players' wiki. Long-form prose narrows further still, to `--container-measure`, on
 *   its own inner element; that token is unchanged and is not this one.
 * - working (62rem, `--container-working`): the inbox, a plan, the settings panes, the
 *   review routes.
 * - wide: full bleed, no cap, so the band and the body already agreed before X1 - the
 *   entries table, table mode, the admin surfaces, the universe list and the world home.
 *   Those seven call sites are the regression check on this change rather than the work.
 */
export type PageWidth = 'reading' | 'working' | 'wide';

export const PAGE_WIDTH_CLASS: Record<PageWidth, string> = {
	reading: 'mx-auto w-full max-w-reading',
	working: 'mx-auto w-full max-w-working',
	wide: 'w-full'
};
