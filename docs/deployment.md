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
The host therefore caps build writes rather than the backend's own I/O:

| Writer | Mechanism | Cap on `md2` |
|---|---|---|
| dockerd (`COPY`, BuildKit file ops, container logs) | `systemctl set-property docker.service IOWriteBandwidthMax="/dev/md2 10M"` | 10 MB/s |
| containerd (content store, export, unpack) | `systemctl set-property containerd.service IOWriteBandwidthMax="/dev/md2 10M"` | 10 MB/s |
| BuildKit `RUN` steps (runc cgroups `system.slice:docker:<id>`, not systemd units) | [build-io-throttle](../scripts/host-build-io/build-io-throttle) service | 10 MiB/s shared, 2 MiB/s floor per step |
| EasyPanel container (source checkout and extract) | same service | 10 MiB/s |
| Kernel writeback | [60-build-writeback.conf](../scripts/host-build-io/60-build-writeback.conf) in `/etc/sysctl.d/` | flush from 256 MiB dirty, hard limit 4 GiB |

The caps apply to every EasyPanel build on that host, so builds take longer.
Running service containers are not capped.

Install (as root): `install -m 0755 scripts/host-build-io/build-io-throttle
/usr/local/sbin/`, copy [build-io-throttle.service](../scripts/host-build-io/build-io-throttle.service)
to `/etc/systemd/system/`, copy the sysctl file and run `sysctl -p` on it, run the
two `set-property` commands above, then `systemctl daemon-reload && systemctl enable
--now build-io-throttle`.

Undo:

```sh
systemctl disable --now build-io-throttle
rm /etc/systemd/system/build-io-throttle.service /usr/local/sbin/build-io-throttle
rm /etc/systemd/system.control/{docker,containerd}.service.d/50-IOWriteBandwidthMax.conf
systemctl daemon-reload
echo "9:2 wbps=max" > /sys/fs/cgroup/system.slice/docker.service/io.max
echo "9:2 wbps=max" > /sys/fs/cgroup/system.slice/containerd.service/io.max
rm /etc/sysctl.d/60-build-writeback.conf
sysctl -w vm.dirty_ratio=20 vm.dirty_background_ratio=10
```

Check during a deploy: `journalctl -u build-io-throttle` lists capped build steps,
`sar -d -p 10` shows `md2` await, and the backend logs show no
`resolver_reconciliation_blocked` with `read deadline exceeded`.

## Precomputed frontend animations

Every Vite build mode prepares the 60 canonical planet/moon derivatives in
`apps/frontend/.animation-variants/` before bundling. Nixpacks and the test
Dockerfile retain that directory in the application image; a dist-only copy is
not a complete server deployment. No persistent mount or runtime resize is
needed. Generation is sequential, keyed by artwork/version/size/source hash and
encoder settings/versions, with failed promises evicted and obsolete outputs
pruned. The output budget is 512 MiB; current output is about 104 MiB. Source
artwork changes still require the normal animation URL version bump.

The server validates the complete manifest/files before binding its port, then
streams derivatives without decoding or caching image bodies. Missing output
fails startup rather than exposing a cold-page resize timeout. Vite dev/preview
also prepares outputs before accepting requests. For a standalone local server,
run `bun run build` first (or `bun scripts/animation-variants.mjs` when
only rebuilding derivatives). Do not run multiple builds against one output
folder or build into a running deployment's image.

After building, run `cd apps/frontend && bun scripts/benchmark-animation-delivery.mjs`.
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
