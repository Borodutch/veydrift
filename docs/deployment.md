# Application deployment

This is application deployment guidance, not authorization to change production
or broadcast contract transactions. Verify the target environment and service
configuration; historical addresses and service names are not deployment evidence.

## Build from the workspace root

Use the repository root as the EasyPanel/Nixpacks build context. A context limited
to `apps/frontend` or `apps/backend` omits workspace packages.

Use committed recipes rather than copying diverging build commands into service
settings:

- [Backend Nixpacks](../apps/backend/nixpacks.test.toml) and
  [backend Dockerfile](../apps/backend/Dockerfile.test).
- [Frontend package scripts](../apps/frontend/package.json) and
  [test frontend Dockerfile](../apps/frontend/Dockerfile.test).
- [Chicken listener deployment](../apps/chicken-burn-listener/README.md).
- [Battle keeper deployment](../apps/battle-keeper/README.md).

Container-specific cache-cleanup commands in build recipes are not host-maintenance
instructions. Do not run broad recursive cache or temporary-directory deletion on
a development machine.

The frontend build surface, chain, API origin and canonical domain must match the
intended environment. The settlement test build uses `vite build --mode settlement`;
verify it with `scripts/veydrift-test-frontend-config-check.mjs`. Do not infer the
current production UI from an old coming-soon deployment note.

## Configuration and secrets

[Backend .env.example](../apps/backend/.env.example) and
[config.ts](../apps/backend/src/config.ts) define supported configuration.
Set deployed addresses and deployment block boundaries from verified release
evidence, not examples in an old document.

- The Game proxy and compact settlement contract are different addresses.
- Resource tokens, alliance, moon, randomness and referral addresses must belong
  to the intended deployment.
- Bootstrap `VEYDRIFT_SETTLEMENT_START_PRICE_WEI` must match Game `startPrice()`;
  later price events update indexed projections.
- Paid-invite treasury history needs its public address and deployment block.
  Private invite signing/encryption capabilities are separate from public treasury
  reads and user-signed withdrawals.
- RPC credentials, private keys and deployment tokens stay in secret storage.
  Never expose a credential-bearing RPC URL as public runtime metadata.
- Mount durable index/service storage. Do not replace a database or copy a live
  SQLite main file without accounting for its WAL and making a consistent backup.

The test surfaces conventionally use `test.veydrift.com` and
`api-test.veydrift.com`; verify their current service mapping before changes.
Rollback only the intended service and preserve its environment and data. Never
repoint or delete production to roll back a test deployment.

## Build identity

[write-build-sha.sh](../apps/backend/scripts/write-build-sha.sh) records the source
SHA in the image. The backend uses this artifact for application build identity
in health/runtime configuration. Do not set stale custom `GIT_SHA` or
`VEYDRIFT_BUILD_GIT_SHA` overrides in EasyPanel. Contract deployment manifest
metadata (`VEYDRIFT_DEPLOYMENT_COMMIT`, ABI hash and timestamp) is separate.
`.dockerignore` excludes `.git/`, so the script's local-Git fallback is unavailable
inside image builds: backend builds require the `GIT_SHA` build argument, which
EasyPanel injects automatically.

## Backend readiness

Use a readiness-gated rollout: a listening socket is not a ready index.
The health endpoint returns 503 until configuration, chain sync and indexed-state
prerequisites are safe to serve. Check `ok` and `readiness.ready`, not HTTP
reachability alone. Required history backfills can delay readiness.

For an EasyPanel service on port 4000, the existing health-check recipe is:

```text
Path: /health
Port: 4000
Interval: 5s
Timeout: 3s
Retries: 3
Start period: 30s
```

With start-first rollouts, keep traffic on the old healthy instance until the new
one passes readiness. Review overlapping signer/keeper instances and database
ownership; HTTP health gating alone is not a nonce or writer lock.
See [worker topology](backend-indexer.md#workers-and-caches).

Run the repository probe against the intended API before/during a rollout:

```sh
node scripts/veydrift-redeploy-readiness-probe.mjs --api-url <api-origin> --duration-seconds 180
```

Retain its results as release evidence. Do not bypass readiness to shorten a deploy.

## Build disk-write limits on the shared host

EasyPanel builds the backend and frontend images on the host that also runs the
backend, onto the same root disk (`md2`) as its SQLite databases. One deploy
writes 15–18 GB there (source extract, `bun install`, layers, image export). Left
unthrottled, that saturates the disk, and the resolver's `synchronous=FULL` commits
and reads queue behind it (`resolver_reconciliation_blocked`, read deadline
exceeded) for the whole build window, on the old container as well as the new one.
The host therefore caps build writes rather than the backend's own I/O. All build
writers share one budget of 16 MiB/s on `md2`, so the backend and frontend
builds of one deploy, and consecutive steps of one build, do not add their caps
up. A fixed cap per writer let them reach 25–45 MB/s together, with write await
up to 85 ms.

| Build writer | How it is capped |
|---|---|
| dockerd (`COPY`, BuildKit file ops) and containerd (content store, export, unpack) | [build-io-throttle](../scripts/host-build-io/build-io-throttle) service; `IOWriteBandwidthMax="/dev/md2 16777216"` on both units is the fallback |
| BuildKit `RUN` steps (runc cgroups `system.slice:docker:<id>`, not systemd units) | same service |
| EasyPanel container (source checkout and extract) | same service |

Every 2 s the service re-splits the budget. A writer is active if it wrote at
least 256 KiB in one 2 s window within the last 10 s, or appeared within them.

- `RUN` steps and EasyPanel split what is left of the budget after the daemons'
  writes and the writes of cgroups that are already gone in the last window,
  with a floor of 4 MiB/s (a quarter of the budget) each. runc removes a
  finished `RUN` step's cgroup while its unwritten data is still in memory, and
  that data keeps draining at the step's *last* cap, which nothing can raise
  afterwards. The service measures it as the slice's writes minus those of its
  live children. The floor bounds that drain: 300 MB from `bun install` takes
  75 s at 4 MiB/s, where a 1 MiB/s floor took 5 min.
- dockerd and containerd split what is left after the floor of every active
  `RUN` step and EasyPanel, at least the floor each. One busy daemon alone gets
  all 16 MiB/s, and 12 MiB/s beside one active build step. Their container
  create and start writes (fsync) queue in order behind their build writes. An
  idle daemon gets the same share as the busy one, so while one daemon is busy
  the two daemon caps can add up to twice that share; the idle one's writes are
  only json-file logs and container metadata.

A new writer (a build step starting) triggers a re-split at once. Every writer,
idle or not, is capped at its share, so an idle one that starts writing is held
to it until the next split; until then the sum can exceed the budget, for up to
one window. With three or more active build steps the floors add up to more than
the budget. A share changes at once when it moves by 1 MiB/s or more; a smaller
change only after it has held for 5 splits (10 s), so idle noise and small rate
changes do not rewrite `io.max` (every write restarts the kernel's throttling
slice). `BUDGET`, `FLOOR`, `BAND`, `ACTIVE_BYTES`, `INTERVAL`, `WINDOW` and
`HOLD` in the script tune this (set them with `Environment=` in the unit). When
the service stops or crashes, `ExecStopPost` puts dockerd, containerd and
EasyPanel back to the budget; running `RUN` steps keep their caps until they
exit.

Kernel writeback is tuned by [60-build-writeback.conf](../scripts/host-build-io/60-build-writeback.conf)
in `/etc/sysctl.d/`: background flushing starts at 256 MiB dirty, writers are
throttled at 4 GiB, and dirty data is written after 5 s instead of 30 s, checked
every second. ext4 metadata (inode tables, directories, bitmaps) and the journal
are written by the kernel on behalf of no cgroup, so no cap reaches them. A step
that creates many files (`bun install`, source extract) left 30 s of metadata
dirty, which was then flushed at once: up to 18 MB/s outside every cgroup on top
of the capped writes, 35 MB/s on `md2` with a queue of 500, about 35 s after
each build started. With the 5 s expiry it is flushed in smaller pieces as it
is created.

The caps apply to every EasyPanel build and image pull on that host, so builds
take longer. dockerd also writes the json-file logs of all running containers,
so while a build is running those log writes wait behind dockerd's share; the
application containers' own file writes are not capped. Limits of this approach:

- A cap paces only how fast written data reaches the disk; a build step can
  still write hundreds of MB into memory at once. Whatever syncs the whole
  filesystem or waits on an image export (BuildKit and containerd commits, and
  behind them `docker create`) waits until that data has drained, each part at
  the cap of the cgroup that wrote it. For a step that has already finished,
  that is its last cap, at least the floor, so the floor bounds the wait. While
  two test builds of 30,000 files and 400 MB each were exporting, `docker
  create` took up to 60 s (0.3 s otherwise). Under the earlier fixed 16 MB/s
  caps the backend container took 15–18 s from create to start during a
  deploy, and 30–63 s with no caps. That wait adds to the backend's downtime on
  a stop-first update when it overlaps the frontend build; a larger `FLOOR` or
  `BUDGET` shortens it at the cost of write await.
- When the ext4 journal fills, the writer that needs space checkpoints it at
  its own cap, which can briefly stall other writers.
- Cancelling a build (EasyPanel kills a running deploy when a newer push to the
  same service arrives) deletes its snapshots at once, and removing an image
  does the same. That is metadata, not throughput, and nothing here bounds it:
  on 2026-10-12 it pushed write await to 69 ms at 2.4 MB/s and held one
  resolver read for 6.4 s. EasyPanel 2.30.1 also crashed and restarted on the
  aborted build. Do not push to `main` while a backend or frontend deploy is
  running; wait for both actions to finish.

Paced writes of about 17 MB/s from one build step kept `md2` write await at
3–10 ms. The frontend's `vite build` step used to write over 11 GB encoding
animation variants; [pinned frontend media](#pinned-frontend-media) removed that
step, and shrinking what the build writes remains the lasting fix.

Install or update, in a root shell (`sudo -i`): `install -m 0755
scripts/host-build-io/build-io-throttle /usr/local/sbin/`, copy
[build-io-throttle.service](../scripts/host-build-io/build-io-throttle.service)
to `/etc/systemd/system/`, copy the sysctl file and run `sysctl -p` on it, run
`systemctl set-property <unit> IOWriteBandwidthMax="/dev/md2 16777216"` for
`docker.service` and for `containerd.service`, then:

```bash
systemctl daemon-reload
systemctl enable build-io-throttle
systemctl restart build-io-throttle  # a running service keeps the old script
systemctl show -p IOWriteBandwidthMax docker containerd  # expect /dev/md2 16777216 twice
```

Undo, in a root shell (`sudo -i`):

```bash
systemctl disable --now build-io-throttle
rm /etc/systemd/system/build-io-throttle.service /usr/local/sbin/build-io-throttle
rm /etc/systemd/system.control/docker.service.d/50-IOWriteBandwidthMax.conf
rm /etc/systemd/system.control/containerd.service.d/50-IOWriteBandwidthMax.conf
systemctl daemon-reload
dev=$(findmnt -no MAJ:MIN / | tr -d ' ')
ep=$(docker ps -q --no-trunc -f label=com.docker.swarm.service.name=easypanel)
for cg in docker.service containerd.service "docker-$ep.scope"; do
  echo "$dev wbps=max" > "/sys/fs/cgroup/system.slice/$cg/io.max"
done
rm /etc/sysctl.d/60-build-writeback.conf
sysctl -w vm.dirty_ratio=20 vm.dirty_background_ratio=10 \
  vm.dirty_expire_centisecs=3000 vm.dirty_writeback_centisecs=500
systemctl show -p IOWriteBandwidthMax docker containerd  # expect empty values
```

Build steps already running keep their caps until they exit.

Check during a deploy:

- `journalctl -u build-io-throttle` logs each newly capped cgroup and every
  change of the shares (`share wbps=<RUN steps and EasyPanel> daemons
  wbps=<dockerd and containerd> active=<daemons>+<others>` with the daemons'
  and gone cgroups' write rates).
- `iostat -dxy 10 md2` shows `md2` write throughput (`wkB/s`) and write await
  (`w_await`; `sar -d` only reports the combined await).
- The backend logs show no `resolver_reconciliation_blocked` with `read
  deadline exceeded`.
- `docker create` latency while the backend and frontend build in parallel,
  and the backend's downtime: the old task's `FinishedAt` to the new task's
  `StartedAt` (`docker inspect` on both containers).

## Pinned frontend media

Large frontend media is not in git and never enters an image: the landing trailer,
the planet/moon animation masters and their 60 precomputed size variants (82 files,
650 MiB). `apps/frontend/media.json` pins every file by sha256 and byte size. The
files are assets of the `media-v1` GitHub release on this repository, named
`<sha256><ext>`. Moon masters are marked `publishOnly`: no route serves them at full
size, so servers skip them and sync about 410 MiB.

Before binding its port, `bun run serve` (and Vite dev/preview) runs
`scripts/media.mjs` sync into the media root:

- `blobs/<sha256><ext>` holds immutable files. Each one is only ever created by a
  hash-verified atomic rename, so a present blob of the right size is trusted
  without re-reading it.
- `views/<id>/` is a per-pin-set tree of relative symlinks that the server reads.
- During a start-first deploy or a rollback, the old and new containers share the
  mount without overwriting each other's files.
- A download that does not match its pin fails startup after backed-off retries.
- The next sync removes temporaries that a killed download or view build left
  behind, once they are older than 15 minutes.

URLs, headers, byte ranges and responsive variants are unchanged, so Cloudflare and
browser caching behave as before.

The media root defaults to `apps/frontend/.media/` (override with
`VEYDRIFT_MEDIA_ROOT`). In production, the frontend service bind-mounts
`/etc/easypanel/projects/veydrift/frontend/media` there, so a deploy with unchanged
media downloads and writes nothing. The frontend image has no readiness check, and
Swarm moves traffic once the new container runs. So before deploying a
`media.json` change (including the first deploy of this layout), pre-seed the
mount on the host:
`sudo sh apps/frontend/scripts/seed-media.sh apps/frontend/media.json /etc/easypanel/projects/veydrift/frontend/media`
(idle I/O priority, rate-limited; use the script and `media.json` from the commit
being deployed, e.g.
`https://raw.githubusercontent.com/Borodutch/veydrift/<sha>/apps/frontend/media.json`).
It exits non-zero unless every served blob is present. The container then starts
without downloading. Give any other frontend service built from this repository
(for example a test frontend) its own bind mount the same way.
Without the mount (for example the test Dockerfile), every container start downloads
the served media into its writable layer.

To change media:

1. Run `cd apps/frontend && bun scripts/media.mjs checkout`. This copies every
   pinned file into `.media-src/`.
2. Replace masters there and bump the matching animation URL version.
3. Run `bun scripts/media.mjs publish`. This regenerates variants, re-pins
   `media.json` and stages `.media-src/.upload/`.
4. Upload the staged files with
   `gh release upload media-v1 .media-src/.upload/* --repo Borodutch/veydrift`, then
   commit `media.json`.

Never overwrite or delete a release asset that a deployed `media.json` references.
Blobs and views of old pin sets stay in the mount until removed by hand, after no
running revision references them.

After `bun scripts/media.mjs sync`, run `cd apps/frontend && bun scripts/benchmark-animation-delivery.mjs`.
It starts two fresh local serving processes, fans out all 60 real variants with
HTML/API-backed control requests, repeats warm, and decodes all animation frames.
It does not replace first-deployment production timing or dedicated browser QA.

## Frontend metadata and optional wallet integration

Farcaster account associations must be signed for the exact deployed domain.
The settlement build rejects a missing/wrong-domain association. Configure
`VEYDRIFT_TEST_FARCASTER_ACCOUNT_ASSOCIATION` or its supported split variables
through the deployment environment. Page-level `fc:miniapp`/`fc:frame` metadata
and `/.well-known/farcaster.json` must agree; do not restore deprecated manifest
`imageUrl`/`buttonTitle` fields.

WalletConnect setup is documented once in [Development](development.md#optional-walletconnect).

## Contract changes

Follow [state preservation](open-alpha-state-preservation.md),
[contract redeploy](veydrift-contract-redeploy-runbook.md), and the
[contract package guide](../packages/contracts/README.md).
Referral migration additionally requires the
[referral migration runbook](referral-code-migration.md).
Verify deployment, migration finalization, linked addresses, bootstrap price and
post-deploy smoke results before exposing the new frontend flow.
