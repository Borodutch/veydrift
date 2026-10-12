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
