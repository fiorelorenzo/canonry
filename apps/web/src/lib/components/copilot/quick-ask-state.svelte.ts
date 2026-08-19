/**
 * Issue #285 (decision O3): the floating pill's open flag, outside the component for the
 * same reason `palette-state.svelte.ts` keeps the palette's outside its own - the phone's
 * bottom bar is the launcher below `md` (E4 = A, I10 = B), and it opens the panel without
 * AppShell threading a callback down through PhoneNav.
 *
 * The rune-module pattern: the export is an object mutated in place, so every importer's
 * reads stay reactive across the module boundary.
 */
export const quickAskState = $state({ open: false });
