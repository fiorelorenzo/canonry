# What the `.one`/`.onepkg` parser produced, one fixture per scope

Issue #603, epic #590. These are the input to `oneStoreTree`, which is the half of
`src/onestore.ts` whose behaviour is ours: the path layout, the nesting off `PageLevel`,
duplicate titles, link rewriting, the `_files` folders and the cumulative cap. The other
half is `onenote_parser` reading a binary format inside wasm, and it is exercised
separately in `src/onestore.test.ts` by the two `onenote-formats` binaries, which prove
that the committed artefact decompresses, compiles, instantiates and reports an
unparseable file honestly.

## Why there is no real `.one` in here

Because one cannot be written by hand at fixture size, and a hand-rolled one would be
worse than none. A desktop `.one` is a whole [MS-ONESTORE] revision store: a 1KB header,
file node lists, object spaces, property sets and the object graph a page hangs off. A few
hundred lines of generator could emit something the parser accepts, and passing it would
prove that this code agrees with **our** reading of the specification, not with what
OneNote writes. The claim worth making is the opposite one, and it is made against real
files instead: `docs/onenote-export.md` records what this reader does to the three `.one`
files and the `.onepkg` in the corpus (`docs/corpus-onenote.md`), which is a third party's
private campaign and is deliberately not committed anywhere in this repository.

So the seam is where the fixtures sit, and the words in them are the Ashenport Campaign,
the same invented world as `../onenote/export/` and `../onenote-formats/`. The two PNGs in
`section-scope.blob` are literally the two from `../onenote/export/`, concatenated, so the
folder-tree fixture and this one describe the same handouts in two shapes.

## The shape

Each `.json` is exactly what the wasm module returns as its JSON half: `sections`, each
with a `name` and `pages`, each page with `title`, `level` (the [MS-ONE] `PageLevel`), `id`
(the `onenote:` link target), `created`/`updated` as Unix seconds, `blocks` and `assets`.
An asset's `off`/`len` index into the sibling `.blob`, which is the concatenated attachment
region the module returns after the JSON, so no attachment is ever base64 inside it.

| file                  | what it stands for                     | what every part of it is for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page-scope.json`     | one page exported on its own, as `.one` | one section, one level-1 page, one paragraph, no assets. The corpus's page-scope `.one` is 83KB for a single page, and a per-page `.one` can only come from `File > Export`, which is the fact the import guide keys on                                                                                                                                                                                                                                                                                                                                              |
| `section-scope.json`  | one section, as `.one`                  | four pages carrying, in order: a level-1 page with an outgoing link and an image; a level-2 subpage with a bulleted list, an indented item under it, a numbered item at the outer level and a second image; a **second** level-2 page with the same title, so the per-folder duplicate suffix is exercised; and a page with an **empty title** and an ink-recognition block, because one page of the corpus's notebook export has an empty title paragraph. The link's `page-id` is the second page's own `id`, which is the id path; two assets at offsets 0 and 256 |
| `section-scope.blob`  | that section's attachment region        | 489 bytes: `../onenote/export/Ashenport Campaign/Handouts/The Sunken Archive_files/archive-map.png` (256 bytes) followed by `.../The Sunken Archive/Flooded Stacks_files/stacks-sketch.png` (233 bytes). Real PNGs, so an offset error shows as a broken signature rather than as a byte count that happens to match                                                                                                                                                                                                                                                 |
| `notebook-scope.json` | a whole notebook, as `.onepkg`          | three sections, which is what the corpus's notebook has. `Handouts` carries levels 1, 2 and **3**, the third level being the case the corpus cannot defend since it only ever uses two. `The Deep Roads` carries a link whose `page-id` belongs to no page here and whose title is **percent-encoded**, so the title fallback is exercised. `Session Logs - Year One` is a section whose name came from a section group, flattened with its group's name prefixed                                                                                                    |

The three `.json` files were written by hand rather than dumped from a real parse, for the
same reason the corpus is not here: a dump of the corpus would carry somebody else's prose.
Their shape was taken from a real parse and every field above appears in one.
