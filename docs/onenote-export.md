# Why the OneNote playbook reads a folder tree, and what each other format is worth

This is the provenance behind `packages/import/playbooks/onenote.md`, written down here by
issue #329. That issue set out to cut it from the playbook's own body, where it is re-sent to
the model on every step of every document at 578 tokens a step and changes no tool call, and
the measurement said no: a prefix that short stops earning Google's implicit prompt cache, and
the lost reads cost 5 to 11 per cent more per model call than the tokens saved. So the two
paragraphs are still in the prompt, this page is the maintainer's copy of them, and
`docs/loop-cost.md` carries the numbers. SPEC.md §6.6 and §6.10 are the shorter product-level
statement of the same decisions, and `apps/web/src/lib/components/docs/importGuides.ts` is
what a user reads.

## OneNote has no clean export, so the playbook picks the shape that keeps the hierarchy

Exporting a whole notebook or section to PDF or DOCX gives one merged document with every
page flattened into a single flow of headings. That is useful, and the `pdf` and `docx`
playbooks already read it, but it throws away the thing that makes OneNote worth a playbook
of its own: the notebook's own page hierarchy. A subpage's indentation under its parent in
OneNote's navigation pane does not survive that export as a reliable marker, so a subpage
becomes just another heading in the sequence, indistinguishable from a top-level page.

So `onenote.md` targets a folder tree of individually exported pages instead, one file per
page:

```
notebook/section/page.htm
notebook/section/page/sub-page.htm      a subpage, in a folder named after its parent page
notebook/section/page_files/image.png   an embedded attachment, in a sibling `_files` folder
```

That is the shape produced by walking OneNote's own `GetHierarchy` and calling `Publish`
once per page, which is what the desktop COM automation scripts that already exist for this
do. The one worth naming is `meichthys/onenote-html-export`, MIT-licensed PowerShell, built
on [@passbe's original bulk-export post](https://passbe.com/2019/08/01/bulk-export-onenote-2013-2016-pages-as-html/).
`packages/bench/src/corpus/render/onenote.ts` mirrors that layout, and
`packages/import/test/fixtures/onenote/export/` is a small checked-in tree of it.

Producing the tree still needs OneNote itself installed somewhere, since there is no web or
Mac equivalent, so it is not for every user. For the user who wants their notebook's
structure back rather than one flattened document, it is the honest path rather than an
invented one.

Two consequences the playbook body does carry, because both change what the model does:
the folder-tree rule for resolving a parent (a sibling `X.htm` beside a folder `X` means
this page is a subpage of `X`), and the `_files` suffix that tells an attachment folder
apart from a subpage folder. `packages/import/src/archive.ts` carries a third, upstream of
the model: Office's own HTML export writes `style`, `class` and `lang` on nearly every run
of text, and `stripHtmlPresentationNoise` removes that before the page reaches a prompt.

## `.xps` is deliberately refused, because its `.pdf` twin is equivalent

Issue #601. Measured against the three `.xps` files in the corpus
(`docs/corpus-onenote.md`) and the `.pdf` of the same scope, which the `pdf` playbook
already reads. Extraction would be easy: an XPS is an OPC zip whose text sits in the
`UnicodeString` attribute of each `Glyphs` element, so no glyph positions have to be
turned back into words, and the only trap is that every markup part is UTF-16LE with a
byte order mark rather than UTF-8. The measurement still says no, on all four things that
could have made it worth a reader.

- **Reading order is the same.** Taking the XPS glyph runs in document order against the
  PDF text `extractPdfPageTexts` produces, the longest common subsequence of the two token
  streams is 98.9 per cent of the XPS tokens for one section and 99.3 per cent for the
  other. Neither format reorders what the other keeps in place.
- **Word boundaries favour the XPS by half a per cent.** The PDF splits 199 words in one
  section (of 31,868 tokens) and 298 in the other (of 64,874) that the XPS keeps whole, and
  the XPS splits 0 and 1 the other way. The effect is real and it is far too small to pay
  for a second reader.
- **Neither loses content the other keeps.** With the `.mht` of the same scope as the
  reference, the `.pdf` is missing 0.1 per cent of its tokens and the `.xps` 0.5 per cent,
  so the printed twin we already read is if anything the closer of the two to the source.
- **The page structure the XPS carries is not the notebook's.** It ships a
  `DocumentStructure` part naming stories, and `StoryFragments` grouping glyph runs into
  paragraphs, 1,374 of them across one section's 49 printed pages, which the PDF has
  nothing like. Those stories are note containers on the printed canvas, not pages and not
  sections, and the `.mht` already gives real paragraphs, so it recovers nothing that is
  not already read.

One thing did come out of that comparison, and it belongs to the `.pdf` rather than to the
`.xps`: **OneNote's notebook-scope export is lossy, in every format except `.xps`.** Taking
the union of the two section-scope files as the reference, the notebook-scope file of the
same format is missing 7.9 per cent of their tokens as `.mht` and 7.9 per cent as `.pdf`,
against 0.0 per cent as `.xps`, and the two missing sets overlap by 98.4 per cent, so it is
one behaviour and not two. It is not a case of the sections being exported later and having
grown: the notebook `.xps` was written a full three minutes before the section files and
already contains everything they do. In printed pages the notebook `.pdf` renders 161 where
the notebook `.xps` renders 197, and its own section-scope `.pdf` files render those same
pages in full. So the honest advice for a whole notebook is to export it a section at a
time, and the reason to keep refusing `.xps` is that reading it would be a worse answer to
that problem than reading the `.one` the GM already has.

## The binary `.onepkg`/`.one` format should be read, and this page used to say otherwise

Issue #600, and this section replaces a deferral whose reasoning turned out to be stale.
What it used to say was that `onenote_parser` reads packages the way OneDrive produces them
and not desktop files, so shipping it bought partial coverage for the cost of a Rust
sidecar in the runner. Both halves of that are now wrong, and the corpus is what showed it.

`onenote_parser` 2.0.0 reads the desktop format ([MS-ONESTORE] §2.3) as well as the OneDrive
one (§2.8), and it read all three of the corpus's `.one` files and the `.onepkg` without a
single failure, in 2.1 seconds for 3.2MB of package plus 24MB of loose sections. It is
MPL-2.0 and carries no Exhibit B notice anywhere in its sources, so §3.3 of that licence
permits a Larger Work under AGPL-3.0 and the constraint in `AGENTS.md` is satisfied. And it
does not need a sidecar process: the library builds for `wasm32-unknown-unknown` with
`--no-default-features`, the `onepkg` feature builds with it (the CAB and LZX crates
included), and a stripped `cdylib` keeping the whole parser reachable is 363KB of wasm.

What it recovers that nothing else does is the hierarchy, which is the thing #599 found the
`.mht` throws away:

- The notebook's three sections, named and in order, out of one `parse_package` call on the
  `.onepkg`. The cabinet directory alone already names them, before any [MS-ONESTORE]
  parsing happens at all.
- 88 pages across those sections, where the notebook `.mht` carries 70 flat ones.
- A `PageLevel` on every page, so 21 of those 88 are top-level pages and 67 are subpages
  under them, grouped into page series. That is exactly the parent/subpage relation
  `onenote.md` reads out of a folder tree, and no export format in the corpus carries it:
  the `.mht` wrapper style is byte identical on every page, and the printed footer names
  the section but never the level.

And it does not cost canon to get it. Against the `.mht` of the same section, the parser's
text is missing 0.5 per cent of the tokens and 0.9 to 1.1 per cent of the distinct words,
every page title matches, and the page counts agree exactly (23 and 23, 52 and 52). So it is
at parity on the prose and strictly ahead on the structure.

Two things not to conclude from that. **Naive scanning is not a shortcut**: pulling UTF-16LE
runs out of a `.one` recovers only 21 to 31 per cent of the section's distinct words, and
what it does yield is dominated by font names repeated thousands of times, so the real
parser is the whole job rather than an optimisation of it. And the cost that remains is
ownership: 8,000 lines of third-party binary-format parsing, on an upstream whose own README
says it takes bugfixes and compatibility rather than features, plus MPL's file-level
copyleft on anything of theirs we edit.

Until that reader exists the playbook does not attempt to open a `.onepkg`/`.one` file, and
says so twice: in the scope paragraph near the top, and in step 6 of its own steps, which is
the one that changes a tool call. Say so in `job_finish`'s summary and finish `skipped`
rather than guessing at a binary layout. The fallbacks stay what they were: `File > Export`
a section to Word or PDF, or the Single File Web Page export the `.mht` reader takes, all
three of which lose the hierarchy and keep the rest. SPEC.md §6.10 still records the old
deferral and needs updating with this decision.
