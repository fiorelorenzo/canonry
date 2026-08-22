# References: import and onboarding

This file covers Canonry's import and onboarding surfaces: source selection, the estimate and consent screen, the running job with cancel and resume, the live proposal feed, the dry-run plan's four buckets, batch review of proposals, field conflicts, the matching question, per-source guides, and onboarding measured to first accepted proposal. It is gated by D1 through D7, G6, G11 and V2. None of these ten screens exist as UI today. SPEC §6 already gets the mechanics right (one document at a time, a dry run before any write, a per-field merge policy that already tells a silent update from a real conflict), but every surface below is still a spec section and not a page, so each reference here is chosen for a shape we can build directly, not for inspiration.

## Terraform plan and apply — the canonical plan-then-confirm gate

**Maps to** the estimate and consent screen (D2, G11) and the dry-run plan (D3)

`terraform plan` reads the current state, diffs it against configuration, and prints a change summary that ends in a line like "Plan: 3 to add, 1 to change, 0 to destroy" before anything runs. `terraform apply` without a saved plan file regenerates that same plan and stops for a yes or no confirmation; the only way to skip the prompt is the explicit `-auto-approve` flag, which HashiCorp's own docs warn against outside automation. A saved plan file (`-out=FILE`) can be reviewed and applied later without re-prompting, because passing the file back in is itself the approval.

**Evidence** https://developer.hashicorp.com/terraform/cli/commands/plan (plan creates a preview and does not apply; `-out` saves a speculative plan for later review); https://developer.hashicorp.com/terraform/cli/commands/apply (apply without a saved plan always prompts for confirmation unless `-auto-approve` is passed, which the docs recommend against)

**Take** The "Plan: N to add, M to change, K to destroy" line is the model for the summary above D3's four bucket cards. And the plan-then-apply split is the shape of D2's estimate screen: run the estimate, show it, then one explicit "Run import" action, never a silent re-estimate mid-flight.

**Leave** Terraform's plan has three buckets that all get one bulk apply. Ours needs a fourth that is excluded from any bulk action: conflicts never get a bulk control (D3), which Terraform has no equivalent for, because Terraform never merges two independently edited copies of the same resource.

## Sanity's migration CLI — dry run as the default, not an option

**Maps to** propose never apply, applied to import (guardrail 1, D2, D3)

`sanity migrations run <id>` runs in dry mode by default. You do not pass a flag to preview; you pass `--no-dry-run` to actually write. Dry-run mode prints the list of patches and document IDs the migration would produce, and `--from-export` even lets the dry run's source be a downloaded dataset export rather than a live API call, so a migration can be previewed entirely offline. `--confirm` layers an interactive yes or no in front of the real run.

**Evidence** https://www.sanity.io/docs/cli-reference/cli-migrations (`--dry-run`: "By default the migration runs in dry mode. Use --no-dry-run to migrate dataset"; `--from-export` "only supported for dry runs"; `--confirm` prompts before the real run)

**Take** Default-to-preview is the strongest version of guardrail 1 I found in any tool: the safe path is what happens when you do nothing extra, and an engineer has to type an extra flag to spend anything real. Worth stealing the naming discipline for our own import job API: the function an import calls first should be named for producing a plan, not for "checking" one, so nobody on the team reaches for the wrong one out of habit.

**Leave** This is a CLI run by one engineer at a time. There is no analogue to D4's queue of two hundred proposals or D6's batched matching question, because a content migration script never has to ask "is this the same document." Import does, so this reference stops at the confirm gate and says nothing about the review surface after it.

## Stripe's billing migration toolkit — a scheduled buffer before a paid action becomes final

**Maps to** the estimate and consent screen, and cancel (D2, G11)

Before Stripe migrates anything it validates the uploaded CSV, which the docs say can take up to a few hours for a large file, then shows a review screen: upload date, file name, subscription count, customer count, and the first go-live date, with the choice "Start migration" or "Cancel migration." Once started, subscriptions sit in a scheduled state for 24 hours (1 hour in a sandbox) before they go live and start charging, and the toolkit gives a 10-hour window to cancel the whole migration before that buffer closes. After 10 hours, cancellation moves to the API or to editing subscriptions one at a time.

**Evidence** https://docs.stripe.com/billing/subscriptions/import-subscriptions-toolkit ("Review uploaded subscriptions" lists date, file name, subscription count, customer count and go-live date before "Start migration"; subscriptions stay scheduled for 24 hours with a 10-hour toolkit-level cancel window)

**Take** The scheduled buffer, real charges do not fire the instant you click Start, is the closest thing I found to a built-in undo for a paid, hard-to-reverse action. Canonry's import does not charge per document, but the pattern (confirm, then a bounded cancel window, then the action becomes final) is the right shape for the nine-minute run: cancel needs to keep working all the way up to the moment writes land in canon, past the moment the GM clicked run.

**Leave** Nothing here streams. There is no equivalent of D2's live feed: the toolkit shows a single status word ("Migration in progress," "Scheduled," "Live") with no partial results, so a person watching Stripe's screen learns nothing until the batch finishes. That is the one part of this reference our nine-minute import should not copy.

## Airbyte — one settings pass per stream, and a batched review for schema changes

**Maps to** source selection and the matching question collected once (D1, D6), the dry-run's bucket-like classification (D3), the one bucket with no accept (G6)

Setting up an Airbyte connection means one Schema tab where every stream Airbyte discovered gets a checkbox, one settings pass for the whole sync rather than a decision per row. Schema changes work the same way: Airbyte checks the source before every sync, classifies each change (new column, removed column, new stream, removed stream, cursor or primary key removed) and, depending on a connection-level setting, either propagates it silently, batches every detected change into one "Refreshed source schema" dialog reviewed and confirmed once, or pauses the whole connection for a breaking change (a removed cursor or primary key).

**Evidence** https://docs.airbyte.com/platform/using-airbyte/configuring-schema (stream and field selection are per-connection toggles, not per-row decisions); https://docs.airbyte.com/platform/using-airbyte/schema-change-management (the change-type table; "Review changes" opens one dialog for every detected change; a breaking change pauses the connection for manual review)

**Take** Two things worth taking directly. The single settings pass per stream is the model for D6: the GM sets "same world, new entries" vocabulary once for an import, not per candidate match. And the split between a silent, deterministic propagation mode (a column Airbyte can add on its own with nothing of the user's at stake) and a mode that always pauses for a person is a real precedent for G6: a schema-level, mechanical change is treated differently from anything that needs judgment.

**Leave** Airbyte's review dialog is a technical diff (column names, types) written for an engineer configuring a pipeline, not for a GM deciding whether two characters are the same person. And "Propagate all field and stream changes" is exactly the auto-apply mode guardrail 1 forbids for anything a model, rather than a deterministic diff, produced. We can borrow the batching shape without the automatic-apply option.

## VS Code's three-way merge editor — symmetric panels for a two-sided conflict

**Maps to** field conflicts, two columns (D5)

The merge editor opens three panels: Incoming on the left (the branch being merged in), Current on the right (your branch), and Result at the bottom (what gets saved). Incoming and Current get identical treatment, same panel width, same font, same row of CodeLens actions (Accept Incoming, Accept Current, Accept a Combination of both, Ignore) above each conflicting hunk, and a conflict counter tracks how many are left. The three-dot menu adds a base view, the pre-conflict common ancestor, for context, and the Result panel is directly editable for a manual third answer.

**Evidence** https://code.visualstudio.com/docs/sourcecontrol/merge-conflicts (panel layout; symmetric per-hunk actions: Accept Incoming, Accept Current, Accept a Combination, Ignore; conflict count indicator; base view toggle; editable Result panel)

**Take** Symmetric panel treatment, same width, same font, same action row, is the whole trick for making neither side look like the default. D5's four options (keep mine, take theirs, keep both, edit now) map almost one to one onto VS Code's four (accept current, accept incoming, accept a combination, edit the result). The base view, what a field said at the last import, is worth adding as a third labeled value or a toggle, since it is a number the merge engine already computes for §6.4's "unchanged since last import" case and currently has nowhere to show.

**Leave** VS Code ships this at file granularity with a per-hunk conflict count; a Canonry field conflict is a single field, so D5 already scoped it correctly as two columns inline in the diff rather than a whole separate editor surface. And Accept a Combination quietly concatenates both versions into one block, which is reasonable for code but wrong for prose: "keep both" for a Canonry field has to mean two labeled candidate values side by side, not one merged paragraph nobody wrote.

## Zotero's duplicate merge — field by field, and never a number on screen

**Maps to** the matching question and field conflicts (D6, D5)

Zotero's Duplicate Items view runs its own comparison (title, DOI, ISBN, and where those match, publication year within a year and an author's last name plus initial) and lists everything it thinks is a duplicate cluster with no score shown anywhere in that list, just the grouped items. Selecting one item auto-selects the rest of its cluster. The right panel lets you pick which item is the "master," and where fields disagree across the cluster, small icons beside each mismatched field let you choose which version wins, field by field, not item by item.

**Evidence** https://www.zotero.org/support/duplicate_detection (matching fields listed with no numeric score displayed anywhere; master item selection; "select one item to be the master... then select alternative versions of mismatched fields using the icons to the right of each field")

**Take** Field by field resolution inside one merge action, not one blanket "use the master's version," is exactly D5's shape, confirmed against a second product. And the complete absence of a similarity number anywhere in the interface, even though the matching algorithm clearly produces one internally, is the strongest precedent I found for D6's "no similarity number ever shown."

**Leave** Zotero surfaces one cluster at a time inside a single list view; there is no batched pre-question the way D6 wants it, collected and asked as one batch before the dry run. A GM reviewing an import needs the vocabulary question front-loaded, not discovered one duplicate at a time the way a researcher browsing their own library does.

## HubSpot's merge records — a real duplicate queue, and a default it should not have

**Maps to** field conflicts and the review queue (D5, D4, V2)

Merging two HubSpot records opens a dialog comparing property values side by side. Every property is pre-selected to the primary record's value by default, "since they are generally kept following a merge," and a user clicks the other value when they want to keep the secondary's instead. Separately, a Data Quality "Manage Duplicates" tab surfaces a running, account-wide queue of detected duplicate pairs, beyond the two records a user happened to open.

**Evidence** https://knowledge.hubspot.com/records/merge-records ("By default, the primary record's properties are selected since they are generally kept following a merge"; a per-field value picker; Data Quality > Manage Duplicates as an account-wide queue with an export of merge history)

**Take** The account-wide duplicate queue is a real precedent for D4 and V2: a review surface listing every pending merge decision across an import, beyond whichever pair a person happens to be looking at, is the queue vocabulary we want for two hundred proposals with type filters.

**Leave** The pre-selected default is exactly the anti-pattern D5 is written against. HubSpot visually marks the primary record's value as already chosen, so "keep mine" reads as correct and "take theirs" reads as an override. A field conflict where the re-imported value and the GM's edited value carry equal visual weight, with nothing pre-checked, is what D5 actually specifies.

## GitHub Actions run view — a job's log is readable before the run finishes

**Maps to** run, cancel, and partial results during a long job (D2)

A workflow run's summary page shows a live status for every job and step in the run, and any single job's log is reachable on its own: `gh run view --job JOB_ID --log` streams one job's log directly, independent of whether the rest of the run has finished. A run can be canceled while queued or in progress; canceling re-evaluates every running job's remaining steps, and a step whose condition still holds keeps running to completion rather than being killed outright.

**Evidence** https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history ("Logs include the status for each job and step in a workflow"; `gh run view --job JOB_ID --log` reads one job's full log); https://docs.github.com/en/actions/how-tos/manage-workflow-runs/cancel-a-workflow-run (cancel works on a queued or in-progress run; the server re-evaluates each running job's remaining steps rather than killing the whole tree at once)

**Take** A job's log being reachable independently of the run's overall state is the exact mechanic D2's live feed needs: proposals from the first document extracted should not wait behind the four-hundredth document still queued. SPEC §6.1 already checkpoints import per document, so we can borrow this directly: surface a document's proposals into the feed the moment that document's extraction step finishes, not when the whole job calls `job_finish`.

**Leave** GitHub Actions logs are built for debugging a build: dense monospace text, timestamps, raw stdout. A Canonry proposal feed is not a log. Each arriving item needs the same evidence-and-diff treatment C2 and C4 already give a propagation proposal, not a scrolling text stream. Borrow the concurrency model, not the visual language.

## Vercel's build logs — cancel framed as recovery, not retreat

**Maps to** cancel (D2)

Vercel's cancel-deployment endpoint stops an in-progress build immediately, and the docs frame it explicitly as recovery from "accidental deploys, wrong-branch pushes, or builds with known errors." Build logs stream during the build and are stored indefinitely once it finishes; a queued or freshly canceled deployment has no logs to show, because nothing has run yet.

**Evidence** https://vercel.com/docs/deployments/logs (build logs generated at build time, color coded for warnings and errors, stored indefinitely); https://vercel.com/docs/rest-api/deployments/cancel-a-deployment (cancel stops a build "without waiting" for it to finish, described as recovery from a wrong or broken deploy, not a rare emergency action)

**Take** Framing cancel as "recover from a mistake" rather than "abort because you changed your mind" is the right register for a nine-minute import: a GM who picked the wrong file or the wrong playbook needs an obvious, unembarrassing way out mid-run.

**Leave** Vercel's logs show nothing until a build produces its first output, so a queued deployment is blank. For import, the estimate screen (size, time, cost, queue position) has to be visible before the job starts, which is exactly why D2 has to be its own screen, shown before the run view exists at all.

## OpenAI's Batch API — the discount and the time bound stated together, up front

**Maps to** the estimate and consent screen, confirming a paid action (D2, G11)

The Batch API charges 50% less than the synchronous endpoints and commits to a fixed completion window, currently 24 hours, stated before a batch is even submitted. If a batch does not finish inside the window, requests that completed are returned and the rest expire, rather than the job silently running over or silently failing outright.

**Evidence** https://developers.openai.com/api/docs/guides/batch (states the 50% cost discount and "each batch completes within 24 hours (and often more quickly)" together, as the terms of the batch, before any request is queued)

**Take** Naming the discount and the time bound in the same breath, before commit, is worth copying for our own estimate screen. SPEC §6.7's own example, "about 800 documents, roughly 20 minutes, third in queue," already does this in prose; the job is making sure the UI states size, time, cost and queue position together on one screen rather than splitting cost into a settings page a GM has to go find.

**Leave** OpenAI's answer to "what happens when the estimate is wrong" is to let the job expire and hand back whatever finished, with nothing to watch in between: no queue position, no progress feed. That is the opposite of D2's choice of a live feed, so this reference is good only for the up-front numbers, not for what happens during the wait.

## Google Contacts' Merge & fix — one screen, every suggestion, no score

**Maps to** the matching question, batched (D6)

Merge & fix is a single screen listing every duplicate pair Google's own matching found. The choices are Merge on a single suggestion or Merge all for the whole list, and if there is nothing to merge, the "Merge duplicates" entry point does not appear at all rather than showing an empty state. No score, percentage or confidence label appears anywhere on a suggestion.

**Evidence** https://support.google.com/contacts/answer/7078226 (Merge & fix lists suggestions with a per-suggestion Merge and a Merge all; "If you don't find a 'Merge duplicates' option, you don't have any contacts that you can merge")

**Take** One screen listing every candidate match at once, with a per-item and an all-at-once action, is a clean model for D6's "collected and asked as one batch before the dry run." Omitting the entry point entirely when there is nothing to review, instead of a page that says "no duplicates found," is worth taking for our own dry-run screen when an import raises no ambiguous matches.

**Leave** Merge all is a bulk-accept button, exactly what D6 and D3 both refuse for anything a matcher rather than a person decided. Canonry's ambiguous-match band sits strictly between a certain match and a certain new entity (SPEC §6.4), so every item in it is, by construction, a case the system could not resolve alone. A "confirm all" control there would quietly reintroduce the bulk accept guardrail 1 forbids.

## Apple Photos' duplicate merge — a soft delete under the confirm

**Maps to** the matching question, batched (D6)

Photos surfaces everything it thinks is a duplicate in a dedicated Duplicates collection, side by side in rows. A user selects the pairs to merge, or presses Command-A for all of them, clicks "Merge N Items," confirms once more in a dialog, and the kept original replaces the duplicates in place. The removed copies land in Recently Deleted for 30 days rather than disappearing outright.

**Evidence** https://support.apple.com/guide/photos/remove-duplicates-pht5a3157c1d/mac (Duplicates collection lists candidates side by side; select individually or all at once with Command-A; "Merge N Items" then a confirming dialog; deleted duplicates recoverable for 30 days)

**Take** The 30-day soft delete after a merge is worth borrowing conceptually. An import's silent-update bucket is safe by definition (G6), but a batched "same entity" answer from D6 is a judgment call, and if that judgment turns out wrong days later there should be an undo path rather than a decision that vanishes the moment the proposal leaves the queue.

**Leave** Selecting a pair pre-groups it with no visible reasoning; nothing on screen explains why Photos thinks two images match. Guardrail 3, every proposal shows which entry and which sentence, means our matching question can never be this opaque. The GM needs the two candidate entries and what looks alike about them, not a pre-made pairing to bless.

## Notion's importers — one entry point, a per-source guide template, and a progress tab

**Maps to** source selection and per-source guides (D1); onboarding (D7)

Notion's import entry point is one place, Settings > Import, or typing `/` and searching an app name, that fans out into per-source flows. The apps with their own connectors (Confluence, Asana, Evernote, Trello, Quip, Dropbox Paper and more) each get a dedicated help article following the same five headings: what imports, what doesn't import, how it maps to Notion's data model, limitations, and troubleshoot common errors. A running import shows upload time, status and size in an "In progress" or "Complete" tab a user can check at any time.

**Evidence** https://www.notion.com/help/import-data-into-notion (single entry point fanning into per-app flows; each app's guide follows What imports / What doesn't import / How it maps / Limitations / Troubleshoot; "Track your import progress" via In progress and Complete tabs)

**Take** The five-heading template is the right shape for Canonry's own per-source guides: seven pages, one per playbook, answering exactly those five questions for Obsidian, Notion, World Anvil, Kanka, LegendKeeper, plain markdown and OneNote, instead of one generic "how to import" page hedging for all seven at once.

**Leave** Notion's progress tab shows a size and a status word, nothing about what was found while it ran. That is a mailbox you have to keep checking, not a live feed, the opposite of D2's choice. This reference is good for the entry-point fan-out and the guide template, not for how it reports progress.

## Obsidian Importer — one picker, a converter per format, a folder per source in the code

**Maps to** source selection, one of seven playbooks (D1); per-source guides

Obsidian's own importer is one plugin with per-format converters behind a single picker inside the app. Airtable, Apple Notes, Bear, CSV, Evernote, Google Keep, HTML, Markdown, Microsoft OneNote, Notion, Roam Research and Textbundle are each a distinct guide page on Obsidian's help site, and each format's conversion code lives in its own folder under `src/formats/`. Two of the seven sources in our own D1 list, Notion and OneNote, already have a working, actively maintained open-source converter here.

**Evidence** https://github.com/obsidianmd/obsidian-importer (README links a dedicated help-site guide per source format, Notion and OneNote among them; per-format converters live under `src/formats/`, one folder per source, confirmed in the repository's file listing)

**Take** One picker, many format-specific paths behind it, each documented and coded as its own unit, is exactly D1's detect-then-confirm shape. Obsidian, Notion, World Anvil, Kanka, LegendKeeper, plain markdown and OneNote should each be a self-contained playbook module with its own guide page, the way `src/formats/notion.ts` and a OneNote converter are separate files here rather than branches inside one big importer function.

**Leave** Obsidian's importer runs entirely client-side with no server round-trip, no queue and no cost, so there is nothing here about D2's estimate screen or D4's review queue. An Obsidian import either works or throws an error into a local log. Treat this as a reference for the source-picker and guide shape only.

## Mailchimp's contacts import — one mapping pass, and two coarse defaults to avoid

**Maps to** field mapping at source selection (D1); the matching question and field conflicts, as an anti-pattern (D5, D6)

Mailchimp's importer has a "Continue to match" step where every CSV column gets matched to an audience field, auto-matched where the name is recognized (Email Address, First Name), manual for the rest, one pass for the whole file. Duplicate handling is a single global checkbox, "Update any existing contacts," checked or unchecked for the entire import, with no per-contact choice. And where a matched column is blank for a given row, the docs say plainly that the blank value overwrites and erases whatever was already stored.

**Evidence** https://mailchimp.com/help/import-contacts-mailchimp/ ("Continue to match" auto-matches recognized columns and lets a user reassign the rest; "Update any existing contacts" is one checkbox for the whole import; "Blank fields overwrite and erase existing email contact data")

**Take** The column-to-field matching screen, one pass, auto-suggested, correctable by hand, is a reasonable model for a lightweight mapping step for the generic playbook, for when D1's detection fails and the product has to ask.

**Leave** Both duplicate-handling choices here are exactly what D5 and D6 refuse. One global "update existing" toggle instead of a per-conflict decision is the coarse shortcut D6's batched-but-still-per-question matching is written against, and letting a blank cell silently erase existing data is precisely the destructive case SPEC §6.4's merge policy exists to prevent: a field the user edited and the source left untouched must be left alone, never treated as blank means delete.

## Shopify's product CSV import — no cancel, no history, and the anti-reference for it

**Maps to** run and cancel (D2), and the dry-run report as an anti-pattern (D3)

Shopify's own docs say plainly: "Product imports started with a CSV file can't be canceled once they begin, and you can't view a history of past imports." The only after-the-fact visibility is a confirmation email and, on failure, a downloadable CSV of just the failing rows with a `processing_error` column explaining each one. There is a review step before the import commits (file name, whether existing handles get overwritten) but it ends in a single "Import products" button, with no bucket breakdown of what will change versus what is new.

**Evidence** https://help.shopify.com/en/manual/products/import-export/import-products ("Product imports started with a CSV file can't be canceled once they begin, and you can't view a history of past imports"; failed rows delivered as a downloadable CSV filtered to a `processing_error` column)

**Take** The downloadable, filtered error file, only the rows that failed with the reason inline, is a good pattern for a conflicts bucket's export or detail view: never make someone page past four hundred unchanged rows to find the three that need a decision.

**Leave** No cancel, no history, no per-item plan before commit. This is the anti-reference for D2 and D3 both. A GM nine minutes into an import with no way to stop it and no record afterward of what the import even did is precisely the failure mode D2's live feed and D7's "measured from signup to first accepted proposal" metric exist to prevent; you cannot measure or improve what leaves no trace.

## What I would build from this

- Borrow GitHub Actions' per-job independence for D2's live feed: since SPEC §6.1 already checkpoints per document, surface a document's proposals into the review queue the moment that document's extraction step finishes, rather than waiting for the whole job to call `job_finish`.
- Give D5's field conflicts VS Code's symmetric two-panel treatment (identical width, font and action row) plus a base-value toggle showing what the field said at the last import, a number the merge engine already computes for free.
- Default the import job's internal API to a dry-run-first verb the way Sanity's CLI does, so the propose-never-apply ordering cannot be gotten backwards by mistake in our own code, not only enforced in the UI.
- Build D6's batched matching screen as one page listing every ambiguous pair with a per-row confirm action, Google Contacts' shape, and never a confirm-all, HubSpot's and Mailchimp's mistake, since every item in the list is a case the matcher could not resolve alone.
- Write the seven per-source guides (Obsidian, Notion, World Anvil, Kanka, LegendKeeper, plain markdown, OneNote) to Notion's five-heading template: what imports, what doesn't import, how it maps to our entity types, limitations, troubleshoot common errors.
- State the estimate screen's numbers together in one sentence before the confirm action, the way OpenAI's batch docs state the discount and the time window together: size, time, cost and the queue position SPEC §6.7 already promises.
- Give the conflicts bucket a filtered, exportable view the way Shopify's failed-rows CSV works, so a GM with two hundred proposals can find the ones needing a decision without paging past everything already unchanged.
- Give a batched matching decision (D6) a short window to walk back before it is fully written into canon, mirroring Apple Photos' 30-day soft delete, since a wrong same-entity call is a judgment error a GM should be able to undo.

## Anti-references

- HubSpot pre-selects the primary record's value in its merge dialog, so "keep mine" reads as the default and the other side reads as an override. https://knowledge.hubspot.com/records/merge-records D5 requires equal visual weight for both sides of a field conflict, with nothing pre-checked.
- Mailchimp's duplicate handling is a single global "update existing contacts" checkbox for the entire import, and a blank matched cell silently overwrites and erases existing data. https://mailchimp.com/help/import-contacts-mailchimp/ Both are the coarse, destructive shortcuts D5 and D6 are written to refuse.
- The WordPress Importer plugin has no reconciliation on re-import. Its own plugin page describes a single import pass with no dedup or update logic beyond an author-mapping filter, and a WordPress.org moderator confirms on the support forum that "it's not possible to have the original post replaced with the new content, it will always import a duplicate." https://en-ca.wordpress.org/plugins/wordpress-importer/ and https://wordpress.org/support/topic/when-importing-if-a-post-was-updated-a-new-duplicate-post-appears/ No dry run, no merge policy, no bucket breakdown: the model SPEC §6.4 was written to avoid.
- Shopify's product CSV import cannot be canceled once started and keeps no history of past imports. https://help.shopify.com/en/manual/products/import-export/import-products A GM partway into a run has no way out and nothing to look back on, the opposite of D2's live feed and D7's traceable time to first accepted proposal.
