# Running a live demo

Written for a demo given from this repo on the dev box, against a real gateway, a real
Postgres and a real Qdrant. Everything below was driven through the UI and the numbers are
measured on 2026-08-19 unless a line says otherwise. Where a beat is not demonstrable
today, this file says so rather than describing what it would look like if it were.

## What to show, and what not to

Demonstrable end to end, verified by clicking through it:

- Editing an entry and reviewing the consequences it proposes on the entries it touches,
  including accepting one, rejecting one, and undoing an accept.
- The audit finding what no longer adds up, as a second plan from the same edit.
- Generating images for an entry, and refining one by saying what is wrong with it.
- Inserting an image into an article body, generated on the spot from inside the editor.
- Publishing an image to the players' wiki, and taking it back.
- Asking the Loremaster a question, with sources shown before any prose arrives, and
  watching it refuse to answer the half it has no canon for.
- Asking the Loremaster to create an entry, which arrives as a pending proposal.
- Switching the interface language, instantly, on any screen.
- The players' wiki, and what it withholds.
- Importing a world from a real Obsidian vault, start to "Import finished", in about two
  minutes, and reviewing the 35 proposals it produced.

One caveat on that last one. It works, and I measured it working, but it took three fixes
landed in this same branch to get there and a fourth is still open (#273), so the OneNote
*run* remains fragile even though OneNote *detection* is the best part of the story. Use the
Obsidian archive for the run and the OneNote archive to show detection. The "Import" beat
below says which numbers to trust.

## Before the day

Two dependencies, both shared machine-wide and both already running most of the time:

```bash
cd /home/dev/.paseo/worktrees/17xput9h/puny-fox
pnpm db:up                       # Postgres 127.0.0.1:55432, Qdrant 127.0.0.1:56333
```

The demo runs against its own database, `canonry_demo`, never the shared `canonry` dev
database, because another session's `apps/web` tests write to that one.

Start the app on a port nobody else is using, and pass `STAFF_EMAILS` in the environment:

```bash
STAFF_EMAILS=lorenzo@canonry.invalid \
DATABASE_URL=postgres://canonry:canonry@127.0.0.1:55432/canonry_demo \
pnpm --filter web dev --port 5196 --host 127.0.0.1 --strictPort
```

`STAFF_EMAILS` has to be exported rather than only written into `.env`: in `pnpm dev` the
value in the file is ignored and `/admin/**` answers 404, which is indistinguishable from
the gate working (#265). `DATABASE_URL` from `.env` is honoured, but passing it here too
costs nothing and removes the question.

Then reset to a known state:

```bash
scripts/demo-reset.sh            # about ten seconds
```

That drops and recreates `canonry_demo`, migrates, seeds Valdoria Reach, creates the demo
account through the app's real sign-up endpoint, and gives it ownership of the seeded
universes. It refuses to run against any database whose name does not end in `_demo`.
Dropping the database takes the dev server down with it, which is expected: the script
waits for it to come back, so run it under a supervisor or restart it in another window.

Sign in at `http://127.0.0.1:5196/auth/sign-in` as `lorenzo@canonry.invalid`, password
`canonry-demo-2026`. You land on three universes: Valdoria Reach with 14 entries, an empty
Forgotten Realms, and Sword Coast (ours) derived from it.

**Walk every screen once before the audience arrives.** The first request to any route in
dev compiles it, and that took 8.3 seconds on a cold server. Every subsequent visit is
under a second.

## Traps worth knowing

- **The players' wiki ignores your language setting, deliberately.** `/p/**` negotiates from
  the request's `Accept-Language` header rather than the account, because its readers are
  not the account holder. So if you switch to Italian and then show the players' wiki, it
  will be in English unless the browser itself asks for Italian. Set the browser's language
  before you start, or show the players' wiki before you switch.
- **Sessions ignore the port.** Cookies are scoped by host, not by port (RFC 6265), so a
  second dev server on `localhost` shares this session and whoever signed in last wins.
  Stay on `127.0.0.1:5196` and do not sign in to a sibling worktree's server.
- **Two demos cannot share one browser profile.** Same reason.
- **Credits are real.** The free plan is 200 credits a month and a run through the beats
  below spends about 25. The reset does not reset the quota, since billing is per account
  and the reset creates a new one, so each reset starts from 200 again.

## The beats, in order

The order matters: the propagation beat needs an edit to have happened, and the Loremaster
beat is more convincing once there are proposals in the queue.

### 1. The world, and what it is (1 minute)

Open `/w/valdoria-reach`. Fourteen entries, a mix of characters, places, factions, an event
and a session. Point out that two entries are in Italian and one is deliberately half and
half, because the language of canon is per entry and never follows the reader.

Open `Aldric Vane`. The reading room: warm paper, serif prose, mentions as quiet links,
aliases beside the title, a language control that says `Detected: English` rather than
asserting it.

### 2. One edit, and its consequences (4 minutes, about 10 credits)

This is the product's whole argument, so give it room.

Open `Aldric Vane`, then Edit. The first sentence reads "Dismissed from the watch in the
thaw after [[The Sable Winter]], he now answers to [[The Ashen Ledger]]." Replace it with:

> Reinstated as captain of [[The Valdoria Watch]] in the spring of 1249, on [[Iselde Wrenn]]
> own signature, he still answers to [[The Ashen Ledger]] and has told the Watch nothing
> about it.

Save. Nothing else changes on screen, which is the point: the AI has not touched anything.

Go to Proposals. Two plans arrive within about twenty seconds, from the one edit:

- **Three entries this touches**: Iselde Wrenn, who appointed him and broke him; The Ashen
  Ledger, whose secret says he is on its payroll; The Valdoria Watch, which he now commands.
- **Two things that no longer add up**, from the audit.

Open the three-entry plan. Read the plan's own rationale, then the per-candidate reasons,
then the two numbers that matter: "3 of 3 kept, cap 10" and "Est. 4.00 credits to generate
diffs". Drop a candidate to show that you decide what it is allowed to spend money on, then
put it back by reloading if you want all three.

Press Generate diffs. Three drafts arrive in about six seconds for three credits. The Ashen
Ledger's draft rewrites the `:::secret` block and keeps it a secret, which is worth pointing
at. Each card carries "Show what this replaced", the drafted text marked as AI with a dashed
underline and a margin marker, an Evidence affordance, and Accept and Reject. There is no
accept-all, anywhere, on purpose.

Accept one. Reject one, and pick a reason from the chips. Then press Undo on the accepted
one and show that it comes back. Open the accepted entry's History tab: the revision is
recorded as AI-accepted, with no author, linked to the proposal that produced it. Your own
edit above it is recorded as human, with you as its author.

### 3. Images (3 minutes, about 7 credits)

On `Aldric Vane`, Images tab, Generate image. The dialog names both models with their cost
before you spend anything, and says plainly that the image stays private until you insert
it and never reaches the players' wiki on its own.

Take Variants: four images in about six seconds for four credits. Pick one, then press
Refine with instruction. The dialog says it builds on the picture you are looking at rather
than rolling again. Type something visual, "much older, grey at the temples, no hat, and a
scar across the left cheek". One new candidate in a few seconds for three credits, sitting
beside the original rather than replacing it.

Refine only works on a generated image: an uploaded one has no prompt to build on and the
product refuses rather than quietly starting from scratch.

### 4. An image inside an article, and then to the players (3 minutes, about 5 credits)

Open `The Gilded Rat`, Edit, put the caret on its own line at the end of the prose, and
press Image in the toolbar. The picker offers this entry's images and can generate a new one
on the spot: take Variants, wait about twenty-five seconds, pick one, Use this one. The
markdown lands in the body as `![image](/w/valdoria-reach/e/the-gilded-rat/media/<id>)`.
Save, and it renders inline in the article.

Now the guardrail. Images tab: the new asset is marked Generated and Private, with the note
"Publish an image to add it to the players' wiki. Nothing here reaches players on its own."
Press Publish. Open `/p/valdoria-reach/the-gilded-rat` and the picture is there, served from
`/p/valdoria-reach/media/<id>`, a different route with its own gate. Press Unpublish and
reload the players' page to show it leave again.

Worth saying out loud while you are on the players' page: an entry is only there at all
because a session revealed it, and `The Drowned Concord` is in this universe and is not
there, because it is GM-only.

### 5. The Loremaster (4 minutes, about 6 credits)

Open Ask. Ask something the canon half-answers:

> Why was Aldric Vane dismissed, and who put him back?

The sources appear before any prose does, which is deliberate. Then the answer opens by
saying the sources do not say why he was dismissed, and answers only the half it can. Three
sources, each quoted verbatim with the entry it came from, one of them a `:::gmnote`. This is
the beat that sells the product to anyone who has been burned by a confident model.

Then ask it to write:

> Create an entry for Mother Sennah's nephew, Tobin, who runs the stables behind the
> Gilded Rat.

It answers that it proposed the entry and that the proposal is pending review, and the entry
arrives in the queue as a draft you accept or reject like any other. Ask in Italian and the
drafted body comes back in Italian, with a `[[The Gilded Rat]]` mention linking it into
existing canon.

Do not linger on the plan header for this one: an Ask-originated proposal still reports its
trigger as table mode, because naming Ask properly needs a migration (#270).

### 6. Switching language (1 minute, free)

Settings, Language, Italiano, Save. Then walk back through the entry, the proposals queue
and Ask: Voci, Opere, Proposte, Tavolo, Giocatori, Chiedi al Loremaster. Instant, no reload,
and it is a preference on the account so it follows you to a phone at the table.

The point to make is the one the settings page itself makes: this is the language the
interface and the Loremaster speak to you in, and it is not the language your canon is
written in. Open `La Casa dei Mercanti` and it is still Italian; open Aldric Vane and he is
still English.

### 7. Table mode (90 seconds)

Secondary for this demo. Declare a context: place The Gilded Rat, session Session 1. Pinned
cards appear for its two-hop neighbours. Jot a note and show that it becomes a proposal
after the session rather than during it. Fire "NPC here" and let the proposal arrive on the
stream a few seconds later.

Ambient audio is generated live through ElevenLabs and takes a few seconds a layer. If the
room has no audio output the player still renders and the browser's audio context sits
suspended with a resume button, so say what it would sound like rather than fighting it.

### 8. Import a world (3 minutes, about 20 credits)

This one now finishes, but it took four stacked fixes to get there and one of them is still
open, so read the numbers before you commit to it on stage.

**Run it with the Obsidian vault**, `.data/small/demo-corpus-obsidian.zip`. Measured, end to
end: 3 notes, 35 proposals, 125 seconds, 19.37 credits actually spent against an estimate of
9 and a ceiling of 54, and it ends on "Import finished, 3 document(s) processed, 35
proposal(s) emitted". Start it, then talk over it: the job runs server-side and does not need
the tab, so you can walk away and come back.

**Show the OneNote archive for detection**, `.data/small/demo-corpus-onenote.zip`. Upload it
and the product says it detected OneNote, found three exported pages and their sibling
`_files` folders, and names the playbook. That is the cleverest part of the import story,
because the folder tree is what carries a subpage's parent and no other source gives us
that. Then point at the estimate screen: size, time and cost before a credit is spent.

The OneNote *run* is the one I would not bet on live. It hit the same truncation wall the
Obsidian run did and I have only fixed that by raising a cap, not by making the loop retry a
truncated step, which is #273. Obsidian is the better-travelled playbook and the one I
measured finishing.

Two things worth saying out loud while the queue fills. The estimate is honest about being an
estimate and is currently about half of what a job really costs, because per-document cost is
driven by the loop resending its transcript rather than by the size of what it read (#271):
850,578 input tokens against 7,576 output on that run. And every one of those 35 proposals is
pending: the import wrote nothing into canon by itself.

In the review queue, filter by type with the chips, then accept two and reject one. Each card
shows the entry it would create, its type, its prose, and which document and which sentence
it came from.

The corpus is real community worldbuilding: Valdris, 78 notes under CC BY-SA 4.0, rendered
into the layout a OneNote page export actually produces. Build it with:

```bash
node scripts/build-demo-corpus.mjs /tmp/corpus-probe/valdris --out .data/small \
  --pages "Regions/The Heartlands.md|Settlements/Millbrook.md|Settlements/Kelathon.md"
```

Attribute it if you show its prose on a screen anybody records.

## The seven guardrails, and where each one shows up

If somebody asks what makes this different, these are the moments to point at rather than
the claims to repeat.

1. **Propose, never apply.** The whole of beat 2. Nothing changed when you saved.
2. **AI text is visually distinct.** The dashed underline and margin marker on a pending
   draft, and the History tab afterwards.
3. **Every proposal shows its evidence.** The Evidence affordance on a diff card, and Ask
   showing its sources before its prose.
4. **The AI switches off completely.** Universe settings. With it off, Ask still answers
   from your own canon by quoting it, and images you uploaded still work.
5. **Data transparency.** `/settings/keys` and `/privacy`.
6. **Nothing unreviewed reaches players.** Beat 4's publish and unpublish, and the GM-only
   faction absent from the players' wiki.
7. **Never promise consistency.** The audit plan is titled as what does not add up, not as a
   clean bill of health.
