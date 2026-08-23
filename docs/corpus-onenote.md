# The OneNote corpus, where it is and why it is not here

Epic #590, issue #591.

A friend of mine exported his real campaign notebook from OneNote in **every format
OneNote offers, at every scope it offers them**: the whole notebook, two sections, and one
page. 19 files, 22MB, Italian prose written by a GM who has never seen Canonry. Until this
arrived, every OneNote fixture in this repository was written by us, so "OneNote import
works" was a claim about our own fixtures rather than a measurement.

## Where it is

On the devbox, at `/home/dev/corpora/onenote-luca/export.zip`, mode 0700.

```
sha256  9b9a488a079a0cea77892ab3f6e4478ebef295324d1bc8a83676632d8d783bf1
bytes   22 MB, 19 files
```

Unpacked next to it under `extracted/` when a measurement needs the individual files.
Anyone re-running a number in this document or in a PR under #590 works from that archive
and checks the digest first, because a measurement against a different corpus is a
different measurement.

## Why it is not committed

It is somebody else's private campaign, this repository is public, and its licence is
AGPL-3.0, so committing it would publish his world under a licence he never agreed to and
put it in the history of every clone forever. He handed it over as a test case, not as
content.

So nothing from it lands here: not the files, not a sample of the prose, not a paragraph
quoted in an issue, a PR body or a commit message. What the repository carries instead is
`packages/import/test/fixtures/onenote-formats/`, one fixture per format, structurally
faithful and written on an invented world. That directory's own README says how each one
was made and which signature it reproduces.

## What is in it

| file | bytes | scope |
| --- | --- | --- |
| `Note Campagna DM - Nuova Luce.onepkg` | 3,229,556 | whole notebook |
| `Note Campagna DM - Nuova Luce.mht` | 2,107,071 | whole notebook |
| `Note Campagna DM - Nuova Luce.pdf` | 2,280,818 | whole notebook |
| `Note Campagna DM - Nuova Luce.xps` | 4,220,966 | whole notebook |
| `Mondo.{one,mht,pdf,xps,docx}` | 6.8M / 502K / 793K / 1.5M / 126K | one section |
| `Note Storia.{one,mht,pdf,xps,docx}` | 17.3M / 1.2M / 1.4M / 2.4M / 254K | one section |
| `Storia e Natura del Mondo.{one,mht,pdf,xps,docx}` | 83K / 3.3K / 173K / 505K / 14K | one page |

Note what is missing: there is no `.onepkg` at section or page scope and no `.docx` at
notebook scope, because OneNote does not offer those combinations. So the six extensions
are not six independent choices, they are six choices constrained by what the GM is trying
to export.

## What was measured off it, and where each number lives

- **Signatures.** `.mht` is `MIME-Version: 1.0`; `.pdf` is `%PDF-1.7`; `.docx` and `.xps`
  are both `PK\x03\x04` and are told apart by their payload path (`word/document.xml`
  against `FixedDocSeq.fdseq`); `.onepkg` is `MSCF`, a Microsoft cabinet; all three `.one`
  files open with the [MS-ONESTORE] section GUID
  `{7B5C52E4-D88C-4DA7-AEB1-5378D02996D3}`. `packages/import/src/upload-format.ts` is
  where those turned into code.
- **Provenance.** All three `.pdf` files carry `/Producer` and `/Creator` set to
  "Microsoft OneNote per Microsoft 365", UTF-16BE with a byte order mark, uncompressed, so
  a printed notebook is content-detectable and the GM can be told what they uploaded. All
  three `.docx` files say `Microsoft Office Word` and carry no OneNote trace at all,
  because that export goes through Word, so the same cannot be said of a DOCX. Neither of
  those is a guess.
- **Structure of the `.mht` export.** One `<div style='direction:ltr;border-width:100%'>`
  wrapper per page, always at the top of `<body>` and never nested, and the page's title is
  the **first `<p>` inside that wrapper**, followed by a date paragraph and a time paragraph.
  Not the 20pt `Calibri Light` paragraph, which is what it looks like at first and which
  finds only 63 of the notebook export's 70 pages: 7 of them carry their title in some other
  size. The page-scope file has one wrapper, the two section-scope files 23 and 52, the
  notebook-scope file 70. The notebook file is the two sections' pages concatenated **with
  nothing between them**: no section name, no boundary, no nesting attribute, and the wrapper
  `div`'s style is byte-identical on every page. The varying `margin-left` values inside a
  page follow where the GM put a note container on the page canvas, not the page's place in
  the notebook. So the `.mht` export carries pages and loses the hierarchy, which is the
  opposite of the folder-tree export the `onenote` playbook was written against.
- **Two page titles repeat inside one section.** `Mondo` has two pages called "X Continente
  Orientale" and two called "X Lunga Terra", so the reader's duplicate-title suffix is not a
  defensive flourish. One page of the notebook export has an empty title paragraph.
- **Internal links survive** as `onenote:#<page title>&section-id={...}&page-id={...}`, three
  of them in the `Note Storia` section and one in the notebook file, so a link between two
  pages of the same export is recoverable and a link out of it is not.
- **This notebook has no embedded pictures at all, and the one that looked like one is a note
  tag** (issue #614, correcting what this bullet said until then). All three `.docx` files
  carry zero `word/media/` parts, and across the four `.mht` files there is exactly one
  `<img>` tag and exactly one `image/png` part, both in `Note Storia.mht`: 364 bytes,
  genuinely 16x16 in its own IHDR, declared `width=16 height=16 alt=Contatto`. That is
  OneNote's own UI glyph for a tagged line, which [MS-ONE] models as a `NoteTag`, and it is
  why `onestore.ts` reports no images off the same notebook and is right to. So the earlier
  reading, that the envelope preserved an image the DOCX export dropped, was wrong: neither
  export carries a picture because the notebook has none. What the number does bound is the
  cost of the bug, since one glyph per tagged line is what a heavily tagged notebook would
  have offered `image_store`.
- **The exporter's layout tables are the page, not scaffolding** (issue #614). `Note
  Storia.mht` has 48 `<table>` elements, `Note Campagna DM` 39 and `Mondo` 3, every one of
  them a three-column OneNote canvas table whose first column is a `width:1px` spacer cell
  holding `&nbsp;`. Tempting to read as noise and wrong: the page's entire prose lives in the
  other cells of those same tables, 1,032,742 of `Note Storia`'s 1,146,649 raw characters.
  `stripHtmlPresentationNoise` leaves them alone, correctly. What it also left, until issue
  #616, was 852 genuinely empty cells across the corpus. Two things came out of measuring
  those. All 90 tables carry a `rowspan`, so a column is not a cell index and a rule that
  assumed it was measured a 0.00% saving on this corpus. And an empty cell is not always
  noise: the rule that shipped drops one only when its whole column is empty, plus a row
  that nothing spans into or out of, which leaves a blank cell in a column that says
  something elsewhere exactly where it was. Measured over the four files after the
  attribute strip, with a `.mht` expanded into its 146 pages first: 1,833,276 characters to
  1,802,872, and 557,889 `o200k_base` tokens to 544,543, so 13,346 tokens, 0.54% of `Mondo`,
  1.93% of `Note Campagna DM` and 3.98% of `Note Storia`. 852 empty cells become 104, all
  of them blank cells in columns that carry text in another row, and the plain text of all
  146 pages is identical before and after.
- **What today's upload path does with each of the six.** Measured through the real HTTP
  upload path, before and after #591, in that PR's own body and in the issue comment on #591.
  What the `.mht` reader produces at each of the three scopes, and what it cost live, is in
  #592's PR body and in `docs/models.md`.

## Handling rules

Read it, measure against it, derive a fixture from it. Do not commit it, do not paste his
prose anywhere, and do not send it to a model except as part of a measurement that needs a
real file. Every gateway run against it costs real money and is recorded with what it
cost.
