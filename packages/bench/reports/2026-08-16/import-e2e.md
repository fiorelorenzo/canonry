# Import, end to end, re-run 2026-08-16

The same seven-source run as `../2026-08-15/import-e2e.md`, on `main` after #160, #161,
#163, #164, #166, #169 and #178 all merged. Same corpus, same models
(`google/gemini-3.1-flash-lite` cheap), numbers read back out of `import_job` and
`proposal` rather than counted in the runner.

| source      | docs | first   | accepted | refused | second | changed | idempotent |
| ----------- | ---- | ------- | -------- | ------- | ------ | ------- | ---------- |
| obsidian    | 35   | 37      | 37       | 0       | 21     | 82      | **no**     |
| world-anvil | 32   | 34      | 34       | 0       | 48     | 103     | **no**     |
| onenote     | 10   | 15      | 15       | 0       | 18     | 41      | **no**     |
| kanka       | 7    | 32      | 32       | 0       | 0      | 36      | yes        |
| generic     | 5    | 23      | 23       | 0       | 0      | 25      | yes        |
| docx        | 2    | 15      | 15       | 0       | 0      | 33      | yes        |
| pdf         | 1    | 9       | 9        | 0       | 0      | 9       | yes        |
| **total**   |      | **165** | **165**  | **0**   |        |         | 4 of 7     |

## What the fixes did

**Every proposal is now acceptable.** 165 of 165, against 139 of 326 on 2026-08-15. The
duplicate-create defect (#160) and the folded-source gap (#178) are gone, and so is the raw
unique-violation a GM used to get as a 500. This was the P0 and it is closed.

**The proposal counts fell by half and that is the fix working, not a regression.** Obsidian
went from 121 first-run proposals to 37 because 87 of the 121 were duplicate creates of
entities other documents had already proposed. 37 unique entities out of 35 notes is what
the corpus actually contains.

**OneNote imports at all** (#162): 10 documents, 15 proposals, where before it enumerated
zero and finished silently.

## What is still broken

Three sources still fail SPEC.md §6.4's "zero changes on the second run", and it is one
cause, now diagnosed: **`entity_propose` never validates `sourceRef.path`** (issue #186).
The model fills that field itself, the tools only check `sourceRef.documentId`, and
`acceptImportProposal` writes `entity_source_ref.external_id` from the model's path while
writing `content_hash` from the document the loop actually read. When they disagree the row
pairs one document's path with another document's bytes, and the skip can never fire for
either. Eight OneNote refs, five of which carry a hash belonging to a different document, are
the evidence in that issue.

The three sources that fail are the three whose documents cross-reference each other heavily,
which is exactly where a model has several files in context and picks the wrong path.

Two other things worth carrying forward:

- **Obsidian's first and third runs still end `stopped_at_ceiling`**, now with the loop
  guard from #169 in place, so a document is still reaching a ceiling. The guard makes the
  reason legible in the document's own detail; whether it is a loop or genuine 60-step work
  on a dense note is worth one look.
- **`missing_in_source` (#163) had nothing to mark on this run**, because the v2 exports for
  the sources that reached it were processed by a job that ended `finished`, and the two
  entities the corpus drops (`the-drowned-concord`, `session-1`) sit in the obsidian export
  whose jobs ended `stopped_at_ceiling` and therefore correctly marked nothing. The rule is
  right; the corpus needs a source whose v2 run finishes cleanly to exercise it end to end.
