/**
 * Issue #149 (A3 = C, G3 = B): the palette's open/closed flag lives here, outside
 * `CommandPalette.svelte` itself, so anything in the tree can open it - a sidebar
 * button, a phone top bar icon, `mod+K` - without AppShell threading a prop or a
 * callback through every intermediate component. The rune-module pattern: the export
 * is an object, mutated in place, so every importer's `$derived`/template reads stay
 * reactive to the same value (a bare exported `let open = $state(false)` would not
 * survive re-export across module boundaries the same way).
 */
export const paletteState = $state({ open: false });
