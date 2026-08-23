# Why the OneNote playbook reads a folder tree, and why `.onepkg` is deferred

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

## The binary `.onepkg`/`.one` format is deferred, not refused

It is a documented format ([MS-ONESTORE]) with a working open-source reader, the Rust
`onenote_parser` and its `one2html` front end. Shipping it means a Rust sidecar in the
runner for a reader with partial coverage: it reads packages the way OneDrive produces
them, not legacy OneNote 2016 desktop files. That is a real cost for a partial answer, so
it waits until someone asks for it. SPEC.md §6.10 records the same decision.

A user who only has a `.onepkg` and no way to produce a page tree has two honest fallbacks
that are already covered. `File > Export` a section or the whole notebook to Word or PDF,
which the `docx` and `pdf` playbooks read directly, losing the hierarchy and keeping
everything else; or use OneNote's own web or desktop export to reach one of those two
formats.

The playbook itself does not attempt to open a `.onepkg`/`.one` file, and says so twice: in
the scope paragraph near the top, and in step 6 of its own steps, which is the one that
changes a tool call. Say so in `job_finish`'s summary and finish `skipped` rather than
guessing at a binary layout.
