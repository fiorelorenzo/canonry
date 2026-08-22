# References: money, trust and admin

This file covers the credit meter in the shell footer (F2), the confirm-before-spend pattern on every paid action (G11, H1), the operation_price admin table that prices generation while reading stays free (H1), the subscription and checkout page, the bring-your-own-key and data-transparency surface (F3), the universe-level write switch (G9), the setup checklist and where it is allowed to appear (R4), the export surface (F4, G10), and the admin metrics page built around accept rate and time-to-first-accept (F5). Today none of this exists as a shipped surface: the artifact has the decisions but the meter, the price table admin, the checklist function, and the metrics page are all still to build, so every reference below is chosen for a shape we can adapt rather than a screen we are polishing.

## Vercel — a spend amount that is not a dashboard

**Maps to** the shell footer credit meter, carrying quota and warm budget on separate lines (F2), and the auto-pause behaviour a hard limit could borrow (G11)

Vercel Pro gives every seat a monthly usage credit plus two free-standing allocations (1TB fast data transfer, 10M edge requests) that sit outside the credit and expire unused. Spend management is a single number, "the spend amount," configured once in team settings, that triggers three independent actions at 50/75/100%: a notification, a webhook, or pausing production deployment for every project. Vercel checks the metered total every few minutes rather than continuously, and says so plainly: pausing "is not instantaneous," so a GM relying on it should set the number below their real ceiling. The whole surface is one settings page with one number and three toggles, not a chart.

**Evidence** https://vercel.com/docs/spend-management.md (spend management docs: what counts toward the spend amount, the 50/75/100% notification thresholds, webhook payload shape, and the explicit "not instantaneous" caveat on pausing)

**Take** the footer meter should do exactly what Vercel's spend-amount setting does and no more: a number and a threshold, not a live chart. Two lines, not one merged bar: included quota counted down like Vercel's credit, warm-drafting budget counted down like Vercel's separate free allocation, because they reset on different clocks and mixing them into one bar hides which one a GM is close to exhausting. The "not instantaneous" honesty is worth copying too: if the switch in G9 or a spend cap ever throttles anything, say the check runs every few minutes rather than implying a hard wall.

**Leave** Vercel's spend amount is a single blended number across every metered resource on the team; our two budgets are different in kind (a shipped quota vs. a discretionary warm-drafting allowance) and guardrail 7 means we never imply the meter is judging anything, only counting it, so we do not adopt Vercel's auto-pause-the-whole-product action; G11 already governs stopping generation per action, not a team-wide kill switch triggered by a dashboard threshold.

## Anthropic Console — usage and cost are two different pages, not two widgets on one

**Maps to** the shell footer meter's underlying data model, and the admin metrics surface's separation of "what happened" from "what it cost" (F2, F5, H1)

The Claude Console keeps a Usage page (tokens by model, by API key, by hour, with CSV export) and a separate Cost page (spend by model, by month, with web-search and code-execution line items broken out), plus a Billing page that shows the actual credit balance, auto-reload threshold, and a distinct monthly spend limit a GM sets with "Adjust limit." Usage credits, the pay-as-you-go top-up after a Claude subscription's included allowance runs out, are explicitly billed and displayed separately from the subscription itself, with a note in the support docs that conflating "credit balance" language across the two billing systems is a known confusion the product had to call out.

**Evidence** https://support.claude.com/en/articles/9534590-cost-and-usage-reporting-in-the-claude-console (usage page vs. cost page, per-model and per-key breakdowns, CSV export); https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans (usage credits as a separate, explicitly-labelled spend on top of the plan's included allowance, with its own monthly cap and auto-reload)

**Take** keep the included quota and the warm-drafting budget as genuinely separate ledgers all the way down, not just at the meter's surface: separate rows in whatever backs the footer, separate CSVs if we ever ship export, separate thresholds for whatever confirmation G11 shows. Anthropic's own GitHub issue about "credit balance" meaning two unrelated things in two different UIs is the cautionary tale: name the two Canonry numbers differently in every surface they appear (quota vs. warm budget), never let one word cover both.

**Leave** the Console is a developer billing dashboard with per-model, per-key, per-hour granularity aimed at engineers debugging a bill; that density is exactly the "dashboard" F2 rejected for the shell footer. None of the drill-down belongs outside the admin metrics page, and even there guardrail 7's discipline (state what does not add up, do not perform mastery) argues against a wall of charts.

## OpenAI spend limits — where the confirm-every-time line actually gets drawn

**Maps to** the confirm-before-spend pattern for paid actions (G11), and the boundary between a warning and a block

OpenAI splits spend controls into two mechanisms with genuinely different jobs: a spend alert, which only notifies and never blocks traffic, and a hard spend limit, which returns a 429 and stops requests once the configured amount is reached. The docs are explicit that alerts "do not enforce a cap" and remain active even after a hard limit is added, so a team gets warned before it gets stopped. Enforcement is not instantaneous either: "the API Platform can process a small amount of extra usage while the limit state propagates."

**Evidence** https://developers.openai.com/api/docs/guides/spend-limits (the alert-vs-hard-limit table, the 429 error codes for organization vs. project limits, and the explicit non-instantaneous enforcement caveat)

**Take** this is the cleanest evidence for where G11's "confirm every paid action" should stop being a dialog and start being a running total: per-action confirmation belongs on generation (drafting, propagation plans, images, Ask, imports), because each of those is a discrete choice with a real cost the GM should see before it fires. A budget threshold, if the warm-drafting budget ever gets one, should behave like OpenAI's alert: a notice, not a second confirmation stacked on top of the per-action one. Two different jobs, two different UI weights, never merged into one click that both confirms and warns.

**Leave** OpenAI's hard limit returns an opaque 429 to a running program; a person mid-draft in Canonry needs the failure to read as a sentence ("this would put you over your included quota by 40 credits: continue on the warm budget?") not an error code. The mechanism (a limit an admin sets, checked before the call completes) transfers; the raw-error presentation does not.

## Replicate — the price is on the button, not behind it

**Maps to** the confirmation that states cost before a paid action runs (G11), and the operation_price table's job of having a number for every operation (H1)

Every model's page on Replicate carries its own price line right next to the model name, "$0.04 / output image," "$0.015 / thousand output tokens," before you ever open a run. Pricing is heterogeneous by design: some models bill by wall-clock hardware-seconds, some by input/output tokens, some by output unit (image, video-second), and Replicate's docs say plainly "you'll find estimates for how much any model will cost you on the model's page," rather than hiding the mechanism behind one blended number.

**Evidence** https://replicate.com/pricing (per-model price lines shown inline with the model card, and the explicit statement that estimates live on each model's own page rather than a single global rate)

**Take** the operation_price table's admin-editable, per-operation shape is doing the same job as Replicate's per-model price line: one price, attached to the specific thing that costs money, visible before the button is pressed. The confirmation G11 asks for on every paid action should read like a Replicate model card, not like a blended estimate: "drafting this entry: 3 credits" rather than "this action may incur charges."

**Leave** Replicate's audience is developers comfortable reading GPU-seconds and token-tiers; a GM confirming a propagation plan should never see the operation's underlying unit (tokens, seconds, whatever the price table actually meters on); only the credit number the operation_price row resolves to. Replicate's per-hardware pricing table, useful for us as an admin's mental model of *why* a row costs what it costs, is not surface a player or GM should ever see.

## Notion AI — a plain-sentence answer at every question a GM would actually ask

**Maps to** the bring-your-own-key and data-transparency surface (F3), and the one-sentence-plus-link pattern guardrail 5 asks for

Notion's AI security page answers exactly the questions guardrail 5 anticipates, each in one or two plain sentences rather than policy language: "By default, Notion and its AI Subprocessors do not use Customer Data to train any models." "When using Notion AI, by default our LLM providers utilize zero data retention for Enterprise plan workspaces... for all non-Enterprise plan workspaces, LLM providers only retain Customer Data for 30 days or fewer before deletion." It also states the mechanism, not just the promise: embeddings are generated through "an OpenAI zero-retention embeddings API," stored in a vector database, and "Notion AI honors existing permissions" so the model never sees what the asking user could not already see.

**Evidence** https://www.notion.com/help/notion-ai-security-practices (the training statement, the retention-by-plan statement, the embeddings mechanism, and the permissions statement, each as an independent, quotable sentence)

**Take** this is the register the privacy settings panel behind F3's contextual sentence should be written in: one sentence per question, mechanism named ("your entry text is embedded through an API that does not retain it"), no hedging qualifiers. The trigger differs from Notion's: guardrail 5 wants the sentence *at the moment content leaves*, not only in a settings page a GM has to go looking for. The settings panel the contextual sentence links to should still read exactly like this page: short, declarative, one claim per line.

**Leave** Notion's disclosure lives entirely on a help-centre page a user has to navigate to; there is no in-product moment where Notion tells you, as you type into Notion AI, which provider is about to see this paragraph. That is the gap guardrail 5 is explicitly closing that Notion has not: the sentence has to appear where content leaves (a draft's generation confirmation, an import's extraction step), with this page as what it links to, not as a substitute for it.

## LaunchDarkly — a value that takes effect with no deploy, and the vocabulary for it

**Maps to** every row of operation_price taking effect without a deploy (H1), and the propagation-cap-style settings that need a template (U3)

A LaunchDarkly flag's targeting change is live the moment it is saved, with no build and no redeploy, and the product gives that idea a named template: "Kill switch: A permanent flag that enables or disables non-core functionality," distinct from a temporary "Release" flag. Flags carry a default-on and default-off variation set at creation, environment-scoped configuration, and a maintainer field, so every flag has an owner and an explicit fallback rather than an implicit one.

**Evidence** https://launchdarkly.com/docs/home/flags/new.md (flag creation flow: templates including "Kill switch," per-environment configuration, default on/off variations, and the maintainer field, all live without a deploy)

**Take** operation_price rows should borrow LaunchDarkly's discipline, not its UI: every row needs an owner (who priced this, who last changed it), a clear distinction between "temporary" (a launch promotion, an experiment) and "permanent" (the standing price of drafting an entry), and, most directly relevant to H1's "a missing price fails loudly," no implicit fallback. LaunchDarkly requires every flag to declare its off-variation explicitly at creation; operation_price should require the same: no operation ships without a row, the same way no flag ships without a default.

**Leave** LaunchDarkly's targeting rules (percentage rollouts, user segments, prerequisite flags) are a feature-delivery problem we do not have; operation_price is a price list, not a rollout engine, and importing that complexity would turn a one-column admin table into a targeting console nobody on a two-person team needs to learn.

## Linear — the two-pane settings shape, exactly

**Maps to** the two-pane settings shape (S1), and the admin-only section pattern F5's metrics page and H1's price table both need

Linear's December 2024 settings redesign put a left rail of named categories (Account, Features, Administration, Your teams) against a single right pane, with an explicit admin-only section, "an admin-only API section where you can view and control all OAuth applications and webhooks," that only appears in the rail for people with the role to see it. Team settings, previously scattered, were consolidated into one view per team that opens on a summary (feature counts, member counts, cycle schedule) before drilling into any one setting.

**Evidence** https://linear.app/changelog/2024-12-18-personalized-sidebar (the rail categories, the admin-only API/webhooks section gated by role, and the consolidated team-settings-in-one-view pattern)

**Take** two things map directly onto S1's shape: the rail groups by *who the setting is for* (Account vs. workspace Administration), which is the same instinct S1 used to separate Images/Loremaster/Canon by *what they govern*; and the admin-only section appearing only in the rail for people with the role, which is exactly how operation_price's admin table and the F5 metrics page should surface: not a separate app, a rail entry gated by role inside the same settings shell.

**Leave** Linear's redesign also converted member and team lists into filterable, sortable data-rich tables, a fine pattern for a workspace with hundreds of people but overbuilt for a table an admin edits maybe once a quarter. The operation_price admin surface wants Linear's *rail-plus-role-gate* structure, not its *dense filterable table* one.

## Shopify — a checklist that marks itself done and lets itself be dismissed

**Maps to** the setup checklist and where it is allowed to appear (R4)

Shopify's setup-guide UI pattern is a self-contained composition: a heading, a fraction ("0 out of 3 steps completed"), a dismiss control, a collapse toggle, and one row per task, each row a checkbox plus an expandable detail with its own action button. The design guidance is procedural, not just visual: "mark tasks as complete when merchants finish them to reinforce progress," and the whole composition is meant to live "on your homepage or a dedicated onboarding page," a specific, bounded home, not every page.

**Evidence** https://shopify.dev/docs/api/app-home/patterns/compositions/setup-guide (the setup-guide composition spec: fraction-complete header, dismiss and collapse controls, per-step checkbox-plus-detail rows, and the guidance that it belongs on the homepage or a dedicated onboarding page)

**Take** R4's own rule (a setting earns the checklist only when it changes what the product does and has no sensible default) pairs well with Shopify's mechanical pattern: a fraction in the header ("1 of 2 set"), a dismiss control, and completed rows that visually resolve rather than lingering as a permanent reproach. Shopify's "mark complete to reinforce progress" is the right tone: the checklist should feel like it is closing, not accumulating.

**Leave** Shopify's guide is a permanent homepage fixture in many stores and is the canonical case of a checklist becoming wallpaper: merchants dismiss it once and it is gone, or it sits at zero-progress for months because nothing forces re-engagement. R4 already designed around this failure mode by capping the list's membership (only settings with no sensible default) and giving it two specific homes rather than a permanent card; Shopify's version has no such cap, which is why store owners routinely complain about it never going away.

## Google Takeout — an export that tells you exactly what it will not give you back

**Maps to** the export surface (F4), and the honesty a lock-in sentence has to carry (G10)

Takeout's docs are unusually candid about the archive's limits: it warns that downloading data "doesn't delete it from Google's servers," that "your data file may not include changes made to your data between when you request a download and when you create your archive," that archives expire in about 7 days and can be downloaded only 5 times, and that files above the chosen size limit split into multiple archives. The mechanism is also named plainly: zip or tgz, a per-product selection you can narrow, delivered by email link or into a connected cloud drive.

**Evidence** https://support.google.com/accounts/answer/3024190 (the recency-gap warning, the 7-day expiry and 5-download cap, the archive-splitting behaviour, and the zip/tgz format choice)

**Take** F4's flat zip should carry the same honesty in miniature: state what is in it (every entry, as markdown, plus attachments) and, if there is any lag between a save and what an export captures, say so in one line the way Takeout does. The "changes made after the request may not be included" caveat is a small, cheap trust-builder worth copying verbatim in spirit.

**Leave** everything about Takeout's ceremony (product-by-product selection, three storage-destination integrations, scheduled recurring exports, a 50GB archive-splitting decision) is scaled for a company exporting Gmail, Photos, and Drive at once. F4 chose "flat zip, unadvertised" specifically to avoid this ceremony; Takeout's multi-step wizard is the shape we are deliberately not building.

## Obsidian — the lock-in sentence, said once, correctly

**Maps to** the lock-in sentence on the landing page and the docs page behind it (G10), and the argument for why F4's export has to be lossless markdown

Obsidian stores every note as a markdown file on the user's own filesystem: "Because notes are plain text files, you can use other text editors and file managers to edit and manage notes." Its CEO's essay "File over app" makes the argument in one line worth quoting directly: "if you want to create digital artifacts that last, they must be files you can control, in formats that are easy to retrieve and read... The app will eventually become obsolete. It's the plain text files I create that are designed to last."

**Evidence** https://obsidian.md/help/data-storage (notes stored as markdown files in a local vault, editable by any text editor); https://stephango.com/file-over-app (the "file over app" essay: durability belongs to the format and the file, not the application)

**Take** G10's one sentence below the landing demo should make Obsidian's exact argument in Canonry's own terms: the wiki is markdown on export, so the world outlives Canonry. That is a stronger, more specific claim than "you can export your data," and it is the sentence that answers the Realm Works objection DECISIONS.md names directly: a world's canon should not die with the tool that helped write it.

**Leave** Obsidian's file-over-app promise is load-bearing for the *entire product*: there is no server, the vault is the source of truth every day, not just at export time. Canonry's canon lives in Postgres and Qdrant day to day; F4's zip is a periodic, deliberately unadvertised safety valve, not the primary storage model. Do not let the sentence imply live, continuous file-level portability we do not offer.

## Fastmail — an export that is complete, plain, and never once advertised

**Maps to** the export surface's placement and tone: Settings, deliberately unadvertised (F4)

Fastmail's "Download all your data" help article is a single utilitarian page: mail (by folder, zipped, 4GB per export), contacts (vCard/CSV/LDIF), calendars, files, payment history, and login history, each with its own short how-to and no marketing framing anywhere on the page. It is filed under Settings → Migration, a name that signals "moving away" rather than "look what we offer," and the page's only tone note is practical: "whether you're migrating away from Fastmail or you'd like to make your own backup."

**Evidence** https://www.fastmail.help/hc/en-us/articles/360060590573-Download-all-your-data (the per-category export list, the 4GB-per-export mail limit, and the Settings → Migration location with no promotional framing)

**Take** this is the closest real-world sibling to F4's "flat zip in Settings, unadvertised": a help article, not a feature announcement; filed under a practical settings path; scoped honestly (Fastmail even admits notes have no export tool yet, telling users to copy-paste rather than pretending otherwise). If any part of Canonry's export has a rough edge on day one, Fastmail's model is to say so plainly rather than omit the feature from view.

**Leave** Fastmail's export is split across five separate flows with different formats and different limits per category, because mail, contacts, and calendars are genuinely different systems there; Canonry's canon is one shape (entries, relations, revisions), so F4 gets to be simpler: one zip, one format, one action, rather than Fastmail's five-tool migration kit.

## Stripe customer portal — a subscription page that is mostly not built by us

**Maps to** the subscription and checkout page

Stripe's no-code customer portal is a hosted, brandable page ("upload your icon or logo, and customize colors") that a subscriber logs into with just their email to self-manage payment details, invoices, and subscription changes, activated from the dashboard "in a few minutes, without writing any code." Customers cannot change the email tied to their billing identity through the portal itself, a small, deliberate friction that keeps billing identity stable.

**Evidence** https://docs.stripe.com/customer-management/activate-no-code-customer-portal (the no-code activation flow, branding customization, email-based login, and the explicit restriction against changing billing email inside the portal)

**Take** the subscription and checkout page should lean on exactly this: Stripe's hosted portal for the mechanics (payment method, invoice history, plan change, cancellation) with only the surrounding chrome (the reading-room header band, the plan comparison, the credit/warm-budget explanation) actually built by us. Building a custom invoice list or payment-method editor would be effort spent on a solved problem guardrail 7 has no opinion about.

**Leave** Stripe's portal is generic SaaS billing chrome with no notion of a "warm budget" or an "included quota"; none of F2's two-line meter language belongs inside the embedded portal itself; that context has to live in the page around it, on our side of the iframe.

## Retool — a table bound straight to the row an admin needs to change

**Maps to** the operation_price admin table (H1, F5)

Retool's pitch for an admin panel is structural, not visual: connect a table component directly to a data source, and the resulting UI reads and writes that table's rows with no intermediate deploy step. Its own use-case framing, "internal tools have the same building blocks: tables, text boxes, dropdowns," describes exactly the operation_price shape: one row per operation, one editable price column, changes live the moment they are saved because the UI is a thin skin over the table itself.

**Evidence** https://retool.com/use-case/admin-dashboard (a table component bound directly to a data source, described as the basic building block of an internal admin tool, no deploy step between edit and effect)

**Take** operation_price should be built exactly this plainly: a table, one row per operation key, one price column, one "last edited by / when" column for the audit trail H1 already calls for, and nothing else. Retool's whole value proposition is refusing to over-build this kind of surface; the lesson transfers even though we are not using Retool itself.

**Leave** Retool's actual product is a general app builder with dozens of components, integrations, and a much larger surface area than a single price table needs; the only thing worth taking is the "bind a table to a table" idea, not the tool.

## Apple App Store privacy labels — a taxonomy, not a sentence, and why that is the wrong shape here

**Maps to** the bring-your-own-key and data-transparency surface (F3), as the pattern we deliberately do not copy

Apple's privacy label asks a developer to classify every data type collected (contact info, financial info, location, user content, and eleven more categories) against every purpose it is used for (analytics, app functionality, advertising, and three more), then declare whether each is linked to identity and whether it is used for cross-app tracking. The result, shown on the App Store product page, is a static grid completed once at submission time and updated only when a developer chooses to: "you may update your answers at any time, and you do not need to submit an app update in order to change your answers."

**Evidence** https://developer.apple.com/app-store/app-privacy-details/ (the full data-type and data-use taxonomy, and the confirmation that labels are self-declared and updated independently of app releases)

**Take** the taxonomy discipline is worth borrowing internally even if the label format is not: when we write the sentence for guardrail 5, we should be able to answer Apple's own questions first (what leaves, linked to the GM's identity or not, used for what) even though the GM only ever sees the one-sentence summary. Precision behind the sentence, simplicity in front of it.

**Leave** the label itself is exactly the anti-pattern guardrail 5 is written against: a grid filled in once, disconnected from the moment any particular piece of content actually leaves, read (if at all) before an install rather than at the point of use. A GM drafting an entry needs "this paragraph is about to go to Anthropic, for generation, not retained for training" at that instant, not a static compliance grid filed somewhere else in the product they would have to remember to check.

## Mozilla *Privacy Not Included — third-party grading is not the same job as a product's own sentence

**Maps to** the bring-your-org-key and data-transparency surface (F3), as an anti-reference for who should be doing the talking

Mozilla Foundation runs *Privacy Not Included as an independent buyer's guide: products are scored on a "creepiness" scale from "least" to "most," sortable and filterable like a shopping catalogue, built by Mozilla's own researchers reading a company's privacy policy and testing its behaviour rather than by the company disclosing anything itself at the point of use.

**Evidence** https://www.mozillafoundation.org/en/privacynotincluded/ (the product catalogue, the "Creepiness: Least–Most" sort control, and its framing as an independent shopping guide rather than a first-party disclosure)

**Take** nothing structural. This is the clearest anti-reference in the set for exactly what F3 refuses to be. The one thing worth noting is what makes *Privacy Not Included exist at all: companies that only disclose in a policy, never at the moment of use, create the vacuum a third-party auditor fills. Guardrail 5 exists so nobody ever has to go looking for a Canonry entry on a site like this.

**Leave** everything else. A third-party score is not a substitute for a first-party sentence, and "creepiness, least to most" is a value judgement about the whole product, the opposite of guardrail 7's discipline (say what does not add up, never certify the whole). If Canonry ever needs a privacy surface to feel more serious, the answer is a better first-party sentence, not a badge borrowed from someone else's grading scale.

## PostHog — an in-product metrics surface built for a team that reads it every day, and the size it wants to grow past

**Maps to** the admin metrics surface (F5), specifically the two metrics that matter: accept rate and time-to-first-accepted-proposal

A PostHog dashboard is a grid of independently-owned "insight" tiles plus lightweight text and button tiles for annotation, organized into folders, with per-tile filter overrides that let one number on a shared dashboard use a different date range or breakdown than the rest without forking the whole view. Text cards exist specifically to annotate a dashboard with context for other users, and the product explicitly steers deeper analysis elsewhere ("for more in-depth analysis, we recommend creating a notebook"), keeping the dashboard itself scannable.

**Evidence** https://posthog.com/docs/product-analytics/dashboards (tile-level filter overrides, text and button tiles for context, folder organization, and the explicit note that a dashboard is for tracking, not deep analysis)

**Take** two things transfer directly to a two-metric admin page: PostHog's text-tile pattern (one sentence of context sitting next to a number, not a separate wiki page) is exactly how to explain what "accept rate" and "time to first accepted proposal" mean per playbook without a legend; and its instinct to push deep analysis elsewhere keeps the page from growing past two numbers. F5's "per playbook rather than aggregate" already does PostHog's filter-override job structurally: each playbook gets its own row rather than one blended number with a dropdown.

**Leave** PostHog is a full analytics platform: unlimited insights, breakdowns, cohorts, session replay, error tracking, all addable to any dashboard. That is precisely the growth path F5 rejected when it chose two metrics over an aggregate dashboard; the admin metrics page should resist ever becoming a PostHog-style grid that can hold anything, because a page that can hold anything eventually does.

## What I would build from this

- Build the footer meter as two labelled numbers with a threshold, not a chart: Vercel's spend-amount setting is the whole interaction model, and Anthropic's habit of keeping usage and cost as genuinely separate ledgers (never merging "quota" and "warm budget" under one word) should hold all the way to the database.
- Write operation_price as a bound table, not an app: one row per operation, one price column, one "who/when last edited" column, on Retool's "bind a table to a table" logic; require every row to exist at creation the way LaunchDarkly requires every flag to declare a default, so a missing price is structurally impossible rather than merely discouraged.
- Split the paid-action confirmation into two weights on OpenAI's model: a per-action confirmation naming the exact cost (Replicate's "price on the model page" instinct) for every generation action, and a quieter running-total notice, never a second dialog, if a budget threshold is ever added.
- Write the guardrail-5 sentence in Notion's register: one clause per question (who sees it, is it retained, is it used to train), plain declarative sentences, triggered at the point content leaves, which is the exact gap Notion's own help-centre page leaves open and Apple's static label formalizes as an anti-pattern.
- Build universe and account settings as one shared two-pane shell on Linear's shape: a rail grouped by who a setting is for, with admin-only rows (operation_price, the metrics page) gated by role inside the same rail rather than spun out into a separate tool.
- Give the setup checklist Shopify's mechanics (a fraction in the header, rows that resolve visibly on completion, a dismiss control) but keep R4's stricter membership rule (no sensible default) so it never becomes the permanent wallpaper Shopify's own version is known for.
- Write the export's own honesty line the way Google Takeout writes its recency caveat, then place it and its lock-in sentence the way Fastmail places its export page: a plain Settings entry with zero promotional framing, answering "why should I trust this" with the same specificity Obsidian's "file over app" essay uses for markdown durability.
- Keep the admin metrics page to PostHog's text-tile discipline applied to exactly two numbers per playbook, deliberately refusing the growth path that turns any metrics surface into an everything-dashboard.

## Anti-references

- Mozilla's *Privacy Not Included proves the cost of never disclosing at the point of use: a vacuum that gets filled by someone else's grading scale instead. It is what guardrail 5 exists to make unnecessary, not a shape to imitate.
- Apple's App Store privacy label is a taxonomy filled in once at submission and read (if ever) before install, precisely the "policy, not a sentence" shape guardrail 5 rejects; useful only as the checklist of questions our own sentence should already have answers to.
- Shopify's setup guide has no membership rule beyond "onboarding tasks," so it becomes the canonical wallpaper checklist: present at zero progress for months, dismissed once and never trusted again. R4's cap (only settings with no sensible default) is a direct fix for the failure Shopify's version demonstrates.
- Google Takeout's export ceremony (per-product selection, three cloud-drive integrations, scheduled recurring exports, 50GB archive splitting) is the scale F4 explicitly chose against; building any of that machinery for one markdown zip would be solving a problem Canonry does not have.
