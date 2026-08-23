/**
 * X1 = A (#598): one export, on purpose. `page-band.svelte` is not re-exported here
 * because a route reaching the band on its own is a route whose title can drift away
 * from its body again, which is the whole of what this decision closes. `dev/ui` imports
 * that file by path, and it is a component gallery rather than a product surface.
 */
export { default as Page } from './page.svelte';
export type { PageWidth } from './page-width';
