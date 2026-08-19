# Deploy, rollback and backups

Operational runbook for prodbox (SPEC.md #12, issues #94, #95, #98). Read
`docker/deploy/compose.deploy.yml` and `scripts/deploy/lib.sh` alongside this
if a command here needs more context than a one-liner gives.

## Architecture in one paragraph

A tag push (`vX.Y.Z`) triggers `.github/workflows/deploy.yml`. It refuses to
proceed unless the tagged commit has a completed, successful `CI` run, builds
the runtime image once on a GitHub-hosted runner and pushes it to GHCR, then
hands off to a self-hosted runner living on prodbox itself for the deploy
step. `scripts/deploy/release.sh` writes an immutable `releases/<sha>`
directory (a copy of `docker/deploy/compose.deploy.yml` pinned to that
build's image, plus a generated `.env`), flips the `current` symlink to it
atomically, runs `docker compose up -d` (which recreates only the `web`
container, since Postgres and Qdrant's config never changes release to
release), and gates on `/healthz` actually serving the version and commit
that was built, not just answering 200. The gate also refuses a release whose
`/healthz` reports `mail: false`, meaning the container has no `RESEND_API_KEY`
and `MAIL_FROM` and therefore cannot send a password reset (#277); a release
built before `/healthz` reported that field at all serves no `mail` key and is
not refused, so a rollback to one still works. A failed gate flips `current` back
and recreates the container again automatically, the same operation a manual
rollback performs by hand. `DEPLOYED.json` at the stack's root always
reflects whatever is actually live. `scripts/deploy/prune-releases.sh` keeps
the 5 most recent releases (plus whatever `current` points at, even if
older).

Two independent stacks live on prodbox, `prod` and `preview`, each its own
directory under `/opt/apps/canonry/<stack>`, its own Postgres, its own Qdrant, its
own secrets, never sharing a compose project.

`release.sh` refuses to deploy a commit that is an ancestor of whatever is
already live for that stack (issue #228). `preview` hangs off `workflow_run`,
so during a GitHub incident an older commit's CI run can finish after a
newer commit's has already deployed, and nothing about that request looks
different from a normal deploy by the time it reaches `release.sh`. The
check is `git merge-base --is-ancestor` between the incoming sha and
`DEPLOYED.json`'s `commit` field, the value `release.sh` already reads
before touching anything, so there is no second source of truth for what is
live. A match logs one line naming both shas and exits 0 without touching
`current`, `DEPLOYED.json` or the containers, because a superseded deploy is
not a failure and should not page anyone. It never fires for a rollback:
`rollback.sh` deliberately moves to an older release and never calls
`release.sh`, it flips `current` and runs compose itself. Redeploying the
sha that is already live is not treated as superseded -- git considers a
commit its own ancestor, but the check excludes that case on purpose, so
whatever `release.sh` already did for that (refusing, because the release
directory is immutable once written) still happens, unchanged.

## One-time setup on prodbox

Everything below happens once per stack. Run as a user with docker access.

1. **Register the self-hosted runner** with the label `prodbox` (Settings ->
   Actions -> Runners -> New self-hosted runner, in this repository or its
   organization). `.github/workflows/deploy.yml`'s deploy job targets
   `runs-on: [self-hosted, prodbox]`; without a runner carrying that label the
   job queues forever.

2. **The deploy account already exists on this box**: `prod`, a member of
   the `docker` group with passwordless sudo. Every release, rollback and
   backup unit runs as `prod`, the same account this whole setup runs as --
   not a separate `canonry-deploy` service account, so there is only one
   account's permissions to reason about, not two that can drift apart.

3. **Create the stack directories** (repeat for `preview` with its own
   port block). `/opt/apps` is root-owned, so the top level needs `sudo`
   once; `backups/` is deliberately *not* created here -- the first backup
   run (by hand or by the timer) creates it itself with `UMask=0077`
   (owner-only), so a plain `mkdir` here would leave it world-readable
   until that first run instead of before it:

   ```
   sudo mkdir -p /opt/apps/canonry && sudo chown prod:prod /opt/apps/canonry
   mkdir -p /opt/apps/canonry/prod/shared
   ```

4. **Write the shared secrets file** from the template committed at
   `docker/deploy/secrets.env.example`:

   ```
   cp docker/deploy/secrets.env.example /opt/apps/canonry/prod/shared/secrets.env
   chmod 600 /opt/apps/canonry/prod/shared/secrets.env
   # edit it: real POSTGRES_PASSWORD, DATABASE_URL, BETTER_AUTH_SECRET, social
   # provider credentials, STAFF_EMAILS, a real Vercel AI_GATEWAY_API_KEY (not a
   # leftover Cloudflare one - see the template's own comment), Replicate and
   # ElevenLabs credentials, ORIGIN, and for preview a distinct port block
   # (WEB_PORT=5296 per docker/Caddyfile.example's convention).
   ```

   This file is never committed and never generated by any script; it is the
   one thing on prodbox that has to be created and kept correct by hand.

5. **Point Caddy** at the stack's `WEB_PORT` (`docker/Caddyfile.example` has
   both stacks' blocks).

6. **Install the backup units** (once, not per stack: `canonry-backup-postgres@.service`
   and `canonry-backup-qdrant@.service` are templates parameterized by stack
   via systemd's `%i`, and the `OnFailure=` alert handler is one global unit):

   ```
   sudo cp docker/deploy/systemd/canonry-backup-*.service docker/deploy/systemd/canonry-backup-*.timer /etc/systemd/system/
   sudo cp scripts/deploy/backup-alert.sh /usr/local/bin/canonry-backup-alert.sh
   sudo chmod +x /usr/local/bin/canonry-backup-alert.sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now \
     canonry-backup-postgres@prod.timer canonry-backup-qdrant@prod.timer \
     canonry-backup-postgres@preview.timer canonry-backup-qdrant@preview.timer
   ```

   `backup-alert.sh` is deliberately self-contained (no shared `lib.sh`
   dependency): it is the one script here installed standalone, outside any
   stack's release directory, and it used to fail with "No such file or
   directory" the moment a real failure tried to trigger it, which is the
   worst possible time to discover a missing dependency.

   **Wire the dead man's switch** (issue #118). A failed backup already lands as
   an `err`-priority journal entry and in `systemctl --failed`, which is three
   places nobody is looking, and none of them catch the case that actually
   matters: a timer that stops firing at all leaves no failure anywhere, it just
   goes quiet. So the four backup units ping healthchecks.io on success and the
   `OnFailure=` handler pings the same check's `/fail`, and the check itself
   complains when a day passes with no word.

   One file, one key, every unit:

   ```
   sudo mkdir -p /etc/canonry
   printf 'HEALTHCHECKS_PING_KEY=%s\n' '<project ping key>' \
     | sudo tee /etc/canonry/backup-alert.env >/dev/null
   sudo chmod 600 /etc/canonry/backup-alert.env
   ```

   The key is a project-wide ping key from healthchecks.io, not a per-check
   UUID, because the check is addressed by slug and each unit's slug comes from
   its own name: `canonry-backup-postgres@prod.service` pings
   `canonry-backup-postgres-prod`. That mapping lives in the unit files
   (`Environment=HEALTHCHECKS_SLUG=...-%i`) and in `backup-alert.sh`'s own
   derivation from `%i`, so adding a fifth backup unit needs no list updated
   anywhere: it pings a check named after itself, and healthchecks answers 404
   rather than quietly attributing the failure to another stack.

   The four checks are period one day, grace one hour. The grace has to absorb
   the timers' `RandomizedDelaySec=10m` plus a slow dump; an hour is comfortable
   without being useless. A check with no notification integration configured
   fails silently, which defeats the whole point, so set one up before trusting
   this.

   `ALERT_WEBHOOK_URL` still works in the same file for a generic webhook
   (Slack, Discord, Matrix) if one is ever wanted alongside. Both are optional
   and independent: with neither set, the handler writes its journal entry and
   stops, which is what every box did before this existed.

7. **First deploy has nowhere to fall back to.** `release.sh`'s automatic
   rollback only works once a previous release exists. The very first tag for
   a fresh stack should be watched live (`gh run watch`, or the Actions tab);
   if it fails, `docker compose ... logs` on the runner is the first place to
   look, since there is nothing to roll back to yet.

## Triggering a deploy

Two triggers, one per stack, and neither needs a human on the box:

```
# preview: merge to main. CI runs, and preview deploys when CI goes green.
git push origin main

# prod: a tag.
git tag -a v1.2.3 -m "v1.2.3: what changed"
git push origin v1.2.3
```

`preview` hangs off `workflow_run` on CI rather than off a push to `main`, which
is worth knowing before you edit the workflow and "simplify" it. The gate refuses
a commit whose CI run is not a *completed* success, and a push trigger races CI
instead of following it, so every preview deploy would fail on a run still in
progress. Letting CI's own completion be the trigger costs nothing and cannot
race. A red main deploys nothing: `workflow_run` fires on any completion, and the
`if` on the first job is what turns a failed CI into a skipped deploy.

The version string differs between the two, deliberately. A tag is its own
version, so prod's `/healthz` and `DEPLOYED.json` read `v1.2.3`. A commit on main
has no tag, so preview reads `git describe`, for example `v0.6.0-7-g1a2b3c4`:
seven commits past the last release, at that commit. That is the number to quote
when somebody asks what preview is running.

To redeploy an already-green commit, or to put a tag on `preview` before it goes
to prod, use the workflow's manual dispatch with the `stack` input and optionally
a `ref`. Dispatch beats both defaults, so `stack: preview` with `ref: v1.2.3` is
how a release gets rehearsed on preview first.

Deploys are serialised per stack (`concurrency`, queued rather than cancelled): a
release is a symlink flip plus a container recreate on a real box, so two
overlapping runs against one stack is the single thing that can leave it half
moved. Two merges to main in quick succession deploy in order.

## Manual rollback

```
scripts/deploy/rollback.sh --stack prod --base /opt/apps/canonry/prod
```

Without `--to`, this reads `previous_release` out of `DEPLOYED.json` and
rolls back to it: a symlink flip plus `docker compose up -d`, then the same
health gate a forward deploy uses, then a new `DEPLOYED.json` entry recording
the rollback. To roll back further than one step, list what is on disk and
name the target:

```
ls /opt/apps/canonry/prod/releases
scripts/deploy/rollback.sh --stack prod --base /opt/apps/canonry/prod --to <sha>
```

Rollback is a symlink flip plus a container recreate, nothing else: it never
touches Postgres or Qdrant, so it never undoes a migration or reverts data.
A release that shipped a destructive migration is not something a rollback
alone fixes.

## Backups

`canonry-backup-postgres@<stack>.timer` and `canonry-backup-qdrant@<stack>.timer`
run once a day (03:15 and 03:45 UTC respectively, `RandomizedDelaySec=10m`),
`Persistent=true` so a run prodbox missed while down still happens on next
boot. Both are installed once and cover both stacks via systemd's `%i`
(`canonry-backup-postgres@prod.timer`, `canonry-backup-postgres@preview.timer`,
and the same pair for qdrant).

**Taking a backup by hand** is the same command the timer runs, so there is
nothing special to remember at three in the morning:

```
/opt/apps/canonry/prod/current/scripts/deploy/backup-postgres.sh \
  --container canonry-prod-postgres-1 \
  --out-dir /opt/apps/canonry/prod/backups/postgres \
  --status-dir /opt/apps/canonry/prod/backups/status

/opt/apps/canonry/prod/current/scripts/deploy/backup-qdrant.sh \
  --container canonry-prod-qdrant-1 \
  --out-dir /opt/apps/canonry/prod/backups/qdrant \
  --status-dir /opt/apps/canonry/prod/backups/status
```

Run it as `prod`, without `sudo`: `prod` already owns
`/opt/apps/canonry/<stack>` and is in the `docker` group, so nothing here
needs root. Running it as root instead still works but leaves root-owned
files behind that a later `prod`-owned run cannot prune; if triggering
through systemd instead of the script directly, `sudo systemctl start
canonry-backup-postgres@prod.service` still lands owned by `prod`, because
the unit itself sets `User=prod`.

Each backup writes into `/opt/apps/canonry/<stack>/backups/{postgres,qdrant}`
and, on every run whether it succeeds or fails, a status file under
`/opt/apps/canonry/<stack>/backups/status/{postgres,qdrant}-last-run.json`.
That status file is the first thing to check, since a missing or stale one is
itself a signal something stopped running:

```
cat /opt/apps/canonry/prod/backups/status/postgres-last-run.json
cat /opt/apps/canonry/prod/backups/status/qdrant-last-run.json
systemctl status canonry-backup-postgres@prod.service canonry-backup-qdrant@prod.service
journalctl -u canonry-backup-postgres@prod.service -u canonry-backup-qdrant@prod.service --since -2d
```

A failed run also triggers `canonry-backup-alert@.service` (systemd's
`OnFailure=`), which writes an `err`-priority journal entry
(`journalctl -p err`) and, if `/etc/canonry/backup-alert.env` sets
`ALERT_WEBHOOK_URL`, posts to it. `systemctl --failed` shows any backup unit
stuck in a failed state. **As of this writing `/etc/canonry/backup-alert.env`
does not exist on prodbox**, so a failure is recorded (journal, status file,
`systemctl --failed`) but nothing pushes it to a person yet. The same gap
exists for every other app's backup job on this box already: loombox's
`relay-backup.service` points its own `OnFailure=` at
`status-email-admin@%n.service`, and that unit is not installed either.
Closing it needs one destination for `ALERT_WEBHOOK_URL` (a Slack/Discord/
Matrix incoming webhook, or a healthchecks.io dead-man's-switch URL both
work with the plain `curl -X POST` this script already does): that is the one
thing still missing for a failure to actually reach a person.

Every file and directory a backup run creates is owned by `prod` and mode
700/600 (`UMask=0077` on the systemd units; `backup-postgres.sh` additionally
`chmod`s the dump right after `docker cp`, since `docker cp` copies the
source file's mode from inside the container rather than respecting the
caller's umask, and would otherwise leave a full plaintext copy of the
database world-readable). `backups/` is a plain top-level directory next to
`releases/` and `current/`, not inside either, the same shape this box's
other apps already exclude by name from their own rsync-based deploys
(`--exclude '/backups'` in loombox's and mastro's `scripts/deploy-prod.sh`),
so it stays out of any release artifact and out of anything that syncs one.

**Retention: 14 daily copies per store per stack, pruned by the script
itself** (`find ... -mtime +14` inside `backup-postgres.sh`/`backup-qdrant.sh`,
no separate cron job, no manual cleanup needed or expected). That is 4
independently-retained streams: prod Postgres, prod Qdrant, preview Postgres,
preview Qdrant. The worst case is written down here rather than discovered
later: prodbox has a 251 GB disk and, as of 2026-08-14, 63 GB free across
every app on the box, not just Canonry. At today's real sizes (about 105 KB
per Postgres dump, empty Qdrant since no collection has been created yet) 14
days of all 4 streams costs under 2 MB total, irrelevant. The number that
matters is the threshold where it stops being irrelevant: 63 GB free / 14
days / 4 streams is about 1.1 GB. If any single stream's daily backup ever
regularly exceeds roughly a gigabyte, Canonry's backups alone could exhaust
today's free space before the 14-day window finishes filling, on a box with
no spare headroom for one app to claim. Watch `du -sh
/opt/apps/canonry/*/backups` in the same breath as the status files, and
lower `--retain-days` (an argument on the systemd unit's `ExecStart=`) well
before that line, not after.

Postgres backups are `pg_dump -Fc` (custom format, already compressed).
Qdrant backups are one directory per run holding one snapshot file per
collection plus a `manifest.json` recording each collection's `points_count`
at backup time.

## Restoring, at three in the morning

Real disaster recovery, in order. **Measured cost of this whole procedure:
about 12 seconds of web downtime** (`docker stop` to a passing `/healthz`
again), timed for real on preview during the issue #98 rehearsal below
against a roughly 105 KB Postgres dump. Downtime scales with dump/snapshot
size, so treat 12 seconds as a floor once real data is involved, not a
promise.

1. **Confirm what is actually broken** before touching anything: is the web
   container down (that is a rollback, not a restore, see above), or is data
   gone or corrupted in Postgres or Qdrant?

2. **Stop the web container** so nothing writes against a database
   mid-restore, and so `dropdb` below has no active connections to fight:

   ```
   docker stop canonry-prod-web-1
   ```

3. **Find the backup to restore.** Postgres:

   ```
   ls -t /opt/apps/canonry/prod/backups/postgres | head -5
   ```

   Qdrant:

   ```
   ls -t /opt/apps/canonry/prod/backups/qdrant | head -5   # one run directory per backup
   ```

4. **Restore Postgres.** `restore-postgres.sh` never drops anything on its
   own; if the target database already has bad data in it (the usual case:
   this is disaster recovery, not a fresh box), drop and recreate it first so
   `pg_restore` writes into something empty rather than fighting existing
   rows. Read the container's own credentials rather than typing them, the
   same way the backup and restore scripts do, so nothing here echoes a
   secret:

   ```
   PGUSER=$(docker exec canonry-prod-postgres-1 printenv POSTGRES_USER)
   PGDB=$(docker exec canonry-prod-postgres-1 printenv POSTGRES_DB)
   PGPW=$(docker exec canonry-prod-postgres-1 printenv POSTGRES_PASSWORD)
   docker exec -e PGPASSWORD="$PGPW" canonry-prod-postgres-1 dropdb -U "$PGUSER" "$PGDB"
   docker exec -e PGPASSWORD="$PGPW" canonry-prod-postgres-1 createdb -U "$PGUSER" "$PGDB"
   scripts/deploy/restore-postgres.sh \
     --container canonry-prod-postgres-1 \
     --dump /opt/apps/canonry/prod/backups/postgres/canonry-<timestamp>.dump \
     --target-db "$PGDB"
   ```

5. **Restore Qdrant** from the chosen run directory into the live instance:

   ```
   scripts/deploy/restore-qdrant.sh \
     --url http://127.0.0.1:<QDRANT_PORT> \
     --backup-dir /opt/apps/canonry/prod/backups/qdrant/<run-timestamp>
   ```

   This restores every collection in the manifest and compares each one's
   `points_count` against what the manifest recorded at backup time, so a
   silently truncated restore fails loudly instead of looking done.

6. **Bring the web container back**:

   ```
   docker start canonry-prod-web-1
   curl -s http://127.0.0.1:<WEB_PORT>/healthz | jq .
   ```

## Restore rehearsal (run this periodically, not just once)

SPEC.md and AGENTS.md both say a backup nobody has restored is not a backup.
Both restore scripts have a mode that proves a backup actually restores
without touching anything live:

**Postgres**, restores into a throwaway database on the same server and
compares every table's row count against the real source database, then
drops the scratch database:

```
scripts/deploy/restore-postgres.sh --rehearse \
  --container canonry-prod-postgres-1 \
  --dump /opt/apps/canonry/prod/backups/postgres/<latest>.dump \
  --source-db canonry
```

**Qdrant**, start a disposable scratch instance on a port nothing else uses,
restore the latest backup into it, and let the script's own manifest
comparison do the checking:

```
docker run -d --name qdrant-rehearsal -p 127.0.0.1:57999:6333 qdrant/qdrant:v1.12.4
scripts/deploy/restore-qdrant.sh \
  --url http://127.0.0.1:57999 \
  --backup-dir /opt/apps/canonry/prod/backups/qdrant/<latest-run>
docker rm -f qdrant-rehearsal
```

Both exit non-zero and print exactly which table or collection did not match
if the rehearsal fails.

## The restore rehearsal, run for real on prodbox (issue #98)

I ran the two non-destructive rehearsals above against real prodbox data,
then went further, on preview only, never on prod: a real drop and restore
with a marker row, because a script exiting zero is not the same claim as a
person's data actually coming back.

**Postgres.** I backed up preview's real database, inserted a `universe` row
with an obvious marker name, took a second backup (the one carrying the
marker), then for real: stopped preview's web container, dropped the live
`canonry` database, recreated it empty, and restored the marker-bearing dump
into it.

```
$ backup-postgres.sh --container canonry-preview-postgres-1 ...
backup complete: .../canonry-20260814T211142Z.dump (108252 bytes, 0s)

$ psql ... -c "insert into universe (...) values (..., 'CANONRY BACKUP
  REHEARSAL MARKER 2026-08-14T21:11:42Z', 'backup-rehearsal-20260814211142',
  'homebrew', '', true) returning id, name, slug, kind;"
                  id                  |                    name                    |              slug
 4749579c-41b9-4459-adf0-d30bbe374481 | CANONRY BACKUP REHEARSAL MARKER ...        | backup-rehearsal-20260814211142
INSERT 0 1

$ backup-postgres.sh --container canonry-preview-postgres-1 ...   # backup #2, carries the marker
backup complete: .../canonry-20260814T211143Z.dump (108430 bytes, 0s)

$ docker stop canonry-preview-web-1
canonry-preview-web-1

$ docker exec canonry-preview-postgres-1 dropdb -U canonry canonry
$ docker exec canonry-preview-postgres-1 psql -U canonry -l | grep canonry
(not listed -- confirmed gone)
$ docker exec canonry-preview-postgres-1 createdb -U canonry canonry

$ restore-postgres.sh --container canonry-preview-postgres-1 \
    --dump .../canonry-20260814T211143Z.dump --target-db canonry
restore complete: canonry

$ docker start canonry-preview-web-1
$ curl -s http://127.0.0.1:5296/healthz
{"status":"ok","version":"v0.1.1","commit":"81ffefcd...","db":true,"qdrant":true}
downtime: 12 seconds

$ psql ... -c "select id, name, slug, kind, created_at from universe
  where slug = 'backup-rehearsal-20260814211142';"
 4749579c-41b9-4459-adf0-d30bbe374481 | CANONRY BACKUP REHEARSAL MARKER ... | backup-rehearsal-20260814211142
(1 row)

$ diff tables_before.txt tables_after.txt && echo "table list IDENTICAL before/after restore"
table list IDENTICAL before/after restore   # 35 tables, same set before and after
```

The marker survived a real drop and restore, all 35 tables came back
identical, and the whole procedure (stop, drop, recreate, restore, start,
wait for a green `/healthz`) took 12 seconds. I deleted the marker row
afterward so preview's data is clean again.

**Qdrant.** Same shape, against a dedicated collection created only for this
rehearsal, so nothing the app itself uses was touched and no web downtime
was needed:

```
$ curl -X PUT http://127.0.0.1:6337/collections/backup_rehearsal_marker \
    -d '{"vectors":{"size":4,"distance":"Cosine"}}'
{"result":true,"status":"ok"}

$ curl -X PUT '.../collections/backup_rehearsal_marker/points?wait=true' \
    -d '{"points":[{"id":1,"vector":[0.1,0.2,0.3,0.4],"payload":{"marker":"CANONRY-BACKUP-REHEARSAL-MARKER"}}]}'
{"result":{"operation_id":0,"status":"completed"},"status":"ok"}

$ backup-qdrant.sh --container canonry-preview-qdrant-1 ...
backup complete: .../20260814T211227Z (1 collection(s), 0s)
  manifest: backup_rehearsal_marker points_count=1, size_bytes=242176

$ curl -X DELETE http://127.0.0.1:6337/collections/backup_rehearsal_marker
{"result":true}
$ curl http://127.0.0.1:6337/collections
{"result":{"collections":[]}}   # confirmed gone

$ restore-qdrant.sh --url http://127.0.0.1:6337 --backup-dir .../20260814T211227Z
OK    backup_rehearsal_marker: points_count=1 matches manifest
restore verification PASSED for 1 collection(s)

$ curl http://127.0.0.1:6337/collections/backup_rehearsal_marker/points/1
{"result":{"id":1,"payload":{"marker":"CANONRY-BACKUP-REHEARSAL-MARKER"},"vector":[0.1,0.2,0.3,0.4]}}
```

The point came back with the same id, payload and vector. I deleted the
rehearsal collection afterward.

**A bug the rehearsal caught before it shipped further.**
`backup-postgres.sh`'s `docker cp` left the dump at mode 644 (world-readable)
regardless of the systemd unit's `UMask=0077`, because `docker cp` copies the
source file's mode from inside the container rather than respecting the
caller's umask. Fixed with an explicit `chmod 600` right after the copy.
Separately, `backup-alert.sh` sourced a sibling `lib.sh` by relative path,
but the documented install step copies only `backup-alert.sh` itself to
`/usr/local/bin`, standalone: the first time `OnFailure=` actually tried to
run it, it failed with "No such file or directory" instead of alerting.
Fixed by making `backup-alert.sh` self-contained, since it only ever used
one three-line `log()` helper out of all of `lib.sh`. A third: running
either backup script by hand (which "taking a backup by hand" above
recommends) inherited whatever ambient umask the caller's shell had --
`002` for an interactive `ssh prod@prodbox` session on this box -- instead
of the systemd unit's `UMask=0077`, and left a Qdrant run directory and its
`manifest.json` group- and world-readable (775/664) the first time this was
actually tried by hand rather than through the timer. Fixed with an
explicit `umask 077` at the top of both `backup-postgres.sh` and
`backup-qdrant.sh`, so the safe permissions no longer depend on who calls
them or how. Proved the `OnFailure=` fix by deliberately failing a backup
unit and watching the alert fire for real:

```
$ sudo systemctl start canonry-backup-postgres@doesnotexist.service
Job for canonry-backup-postgres@doesnotexist.service failed [...]
$ sudo journalctl -p err -t canonry-backup-alert --since "-2 min"
canonry backup unit failed: canonry-backup-postgres@doesnotexist.service (host prodbox)
```

## What was verified here, and what needs prodbox

This repository has no self-hosted runner registered, prodbox is a
different machine, and there are no deploy secrets on this box, so the
tag-to-prodbox path cannot be exercised end to end from here. What was
actually run, with real tools, not a dry run standing in for one:

- **Workflow YAML**: validated with `actionlint` (downloaded for this
  session; not part of the toolchain otherwise). One finding, and only one:
  `label "prodbox" is unknown` on the deploy job's `runs-on`, which is
  exactly the missing self-hosted runner. No other findings, including
  actionlint's embedded shellcheck pass over every `run:` block.
- **Every shell script** (`scripts/deploy/*.sh`): `bash -n` and `shellcheck
  -x` both clean.
- **Systemd units**: `systemd-analyze verify` clean on all three service
  templates and both timers (verified with stub executables standing in for
  paths that only exist once a release has actually been written on
  prodbox; the unit syntax itself, `OnFailure=`, `EnvironmentFile=`,
  templating, is what was being checked).
- **Release, rollback and pruning**: exercised twice. First hermetically
  (fake `docker`/`curl` on `PATH`, fake `releases/<sha>` directories) to
  drive `release.sh` through 7 releases including a deliberately
  stale-serving one, proving the auto-rollback path and that pruning keeps
  exactly 5 while never deleting whatever `current` points at even if it
  falls outside that window. Then again for real: `docker build -f
  docker/Dockerfile` twice for two versions, a real `docker compose` stack
  brought up by `release.sh` on ports 59321/59322/5931 (not 5196), a second
  release proving Postgres and Qdrant's container IDs are byte-identical
  before and after (only `web` gets recreated), and a third release that
  named a version/commit not actually baked into the image, reproducing
  SPEC.md's exact "a green curl has served a stale build" failure and
  watching `release.sh` roll the running stack back to the last good
  release by itself.
- **Health gate**: `health-gate.sh` run against a real container built from
  the real Dockerfile, on port 5931, both the passing case and the case
  where the served version does not match what was asked for.
- **Backups and restores**: `backup-postgres.sh` and `restore-postgres.sh
  --rehearse` run against the real dev Postgres (34 tables at the time of
  this run), every table's row count compared and matched. `backup-qdrant.sh`
  and `restore-qdrant.sh` run against the real dev Qdrant with a seeded test
  collection, restored into a disposable scratch instance, point count
  verified. Both restore scripts' failure-detection paths were also
  exercised directly (a corrupted expected count, an aged-out backup file)
  and correctly reported failure rather than passing silently. **Issue #98,
  on prodbox itself:** all four timers (`canonry-backup-{postgres,qdrant}@
  {prod,preview}.timer`) installed, enabled and confirmed armed in
  `systemctl list-timers`; a real backup taken for every stack/store pair,
  landing owned by `prod`, mode 700/600, with a `*-last-run.json` status
  file recording success; `OnFailure=` proved to actually alert by
  deliberately failing a unit and watching the journal entry land; and a
  full destructive restore rehearsal run for real on preview (see "The
  restore rehearsal, run for real on prodbox" above) rather than only the
  non-destructive scratch mode.
- **`verify-ci.sh`**: run against the real repository's GitHub API, both a
  commit with a real completed successful `CI` run (passed) and a
  commit that never had one (correctly refused), plus offline fixture
  cases for the "pick the most recent run" logic.

What genuinely cannot be proven from here, and what would prove it:

- **The self-hosted runner picking up the deploy job at all.** Missing:
  a runner registered on prodbox with the `prodbox` label. Proof: push a
  tag and watch the `deploy` job leave the queue instead of sitting on
  "Waiting for a runner". First command on prodbox: install the runner
  (`./config.sh --url https://github.com/fiorelorenzo/canonry --token
  <registration token from Settings -> Actions -> Runners> --labels
  prodbox`), then `./run.sh` or install it as a service.
- **GHCR pull actually working from prodbox's network.** Missing: prodbox's
  outbound access to `ghcr.io` and, if the package is private, a
  `docker login` credential for the runner. Proof: `docker pull
  ghcr.io/fiorelorenzo/canonry-web@<digest>` succeeding on prodbox itself.
- **The shared secrets file existing and being correct.** Missing:
  `/opt/apps/canonry/prod/shared/secrets.env` has to be created by hand from
  `docker/deploy/secrets.env.example` (step 4 above); nothing in this repo
  can create it, since it is precisely the thing that must never be
  committed. Proof: `release.sh` refusing loudly ("secrets file not found")
  is the safe failure if this was skipped; the real proof is the health gate
  passing on a real tag push.
- **UFW / loopback-only binding actually holding on that specific box.**
  SPEC.md #12 calls out that publishing to `0.0.0.0` bypasses UFW on
  prodbox; every port in `docker/deploy/compose.deploy.yml` is bound to
  `127.0.0.1` the same way `docker/compose.yml` already is, but whether
  UFW itself is configured and enabled is a prodbox host setting, not
  something this repo controls. Proof: from a machine outside prodbox,
  connect to prodbox's public IP on the Postgres and Qdrant ports and get a
  connection timeout, the same as any closed port, not a Postgres or Qdrant
  handshake.
- **A restore rehearsal on a schedule, not just once.** Issue #98 ran the
  destructive rehearsal for real, once, on preview (see above): a marker
  row and a marker Qdrant collection both survived a real drop-and-restore.
  What is not yet true is that this repeats itself: nothing re-runs the
  rehearsal periodically, so proving it works today says nothing about
  whether it still works after the schema, the Qdrant version or the backup
  scripts themselves change. Missing: a periodic job (a monthly systemd
  timer calling `restore-postgres.sh --rehearse` and the disposable-Qdrant
  sequence in "Restore rehearsal" above, on preview only) so the first time
  it runs after some future change is not the first time it has run since
  this one.
