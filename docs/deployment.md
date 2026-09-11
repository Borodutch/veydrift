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
