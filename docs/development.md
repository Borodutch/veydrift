# Development

## Install

From the repository root:

```sh
bun install
```

Use Bun 1.1 or newer, Node.js 20 or newer, and Foundry for contract work.
The exact CI tool versions are in [.github/workflows/ci.yml](../.github/workflows/ci.yml).

## Frontend

```sh
bun run dev:frontend
```

Open <http://localhost:5173>. The committed `apps/frontend/.env.development`
default is `/prod-api`. Override `VITE_VEYDRIFT_API_URL` in the ignored
`apps/frontend/.env.development.local`:

- `/prod-api`: Vite proxy to the production API.
- `/test-api`: Vite proxy to the test API.
- `/local-api`: Vite proxy exclusively to `127.0.0.1:4000`, with no production fallback.

Runtime configuration supplies chain IDs, public addresses and capabilities.
Do not duplicate deployment addresses in components.

### Optional WalletConnect

Set the public `VITE_REOWN_PROJECT_ID` for a Reown Cloud project that allows the
deployed origin. Farcaster Mini Apps continue using their host EIP-1193 provider.
WalletConnect Base reads use the API's rate-limited `/walletconnect-rpc` allowlist:
read/simulation methods only, never wallet transaction submission or exposed node credentials.

## Local API and indexer

A local frontend/backend connected to Base mainnet still submits **real mainnet
transactions** when approved in the wallet. A copied database does not create a
fork or sandbox chain. For wallet-free UI regression tests, use the isolated
browser fixtures rather than signing live actions.

Use [apps/backend/.env.example](../apps/backend/.env.example) as the configuration
reference. Create the ignored `apps/backend/.env.local-runtime` with the intended
chain, deployed public addresses, accessible HTTP RPC URL and deployment block
boundaries, plus:

```dotenv
HOST=127.0.0.1
PORT=4000
VEYDRIFT_WORKER_COUNT=2
VEYDRIFT_DEPLOYMENT_MODE=local
VEYDRIFT_INDEX_DB_PATH=.data/local-mainnet.sqlite
```

For local mainnet testing, set frontend overrides:

```dotenv
VITE_VEYDRIFT_API_URL=/local-api
VITE_VEYDRIFT_CHAIN=mainnet
```

Run in separate terminals from the repository root:

```sh
(cd apps/backend && bun --env-file=.env.local-runtime src/index.ts)
VITE_VEYDRIFT_SURFACE=playable bun run dev:frontend --host 127.0.0.1
```

The two-worker supervisor runs the indexing writer privately on loopback port 4001
and the public API reader on 4000. Restart the supervisor manually after backend
edits. Do not use Bun watch mode with the multi-worker supervisor: it can leave
old child workers alive. Frontend edits hot-reload through Vite.

Verify before gameplay testing:

```sh
curl http://127.0.0.1:5173/local-api/runtime-config
curl http://127.0.0.1:5173/local-api/health
```

For mainnet, confirm chain ID 8453, the local API base, disabled local mission
resolution/signing services, connected chain sync, `readiness.ready`, and an
index caught up with the head. A new database may need a substantial history
scan. Do not bypass readiness simply because the port is listening.

If the RPC reports `4444: pruned history unavailable`, configure a same-chain,
history-capable `VEYDRIFT_RPC_FALLBACK_URLS`. Log reads can fail over without
retrying a submission. Match `VEYDRIFT_LOG_CHUNK_SPAN` to the fallback's range
limit (for a 2,000-block inclusive window, use `1999`). Keep the original history
boundary and let verification finish; do not manually bless old checkpoints.

Keep environment files, databases and backups out of Git. Never copy production
private keys to make local features available. If importing a production database,
use an authorized consistent SQLite backup, preserve the local copy before
replacement, and verify chain/address/deployment-block compatibility.
Off-chain profile metadata may need a separate authorized transfer; copying chain
logs alone does not guarantee usernames.

Private RPC access must remain scoped to this laptop: use the operator-approved
SSH/network route or exact source-IP allowlists. Where Docker publishes the RPC,
both host firewall and Docker forwarding rules may apply. Do not expose RPC to
the Internet; recheck access after IP changes.

Treasury reads need the public `VEYDRIFT_PAID_ALLIANCE_INVITE_ADDRESS` and
`VEYDRIFT_PAID_ALLIANCE_INVITE_INDEX_FROM_BLOCK`, not production signing or
encryption keys. Its history must be indexed before balances become available.
Private invite issuance/redemption/recovery may remain disabled while public
Treasury and user-signed withdrawals work.

## Other services

The frontend does not require local signer services. Run them only with explicit
intent, verified chain/addresses, and an appropriate funded account:

- [Battle keeper](../apps/battle-keeper/README.md).
- [Chicken burn listener](../apps/chicken-burn-listener/README.md).
- [Randomness services](randomness-engine.md).
- [Synthetic stationed-defense QA](stationed-defense-qa.md), for non-production rendering only.

## Validation and CI

Use focused tests first, then checks appropriate to the changed layers:

```sh
bun run test:frontend
bun run check:frontend
bun run test:backend
bun run check:backend
bun run test:contracts
bun run check:contracts
bun run check:alpha-state
bun run check:docs
git diff --check
```

The [isolated browser suite](../apps/frontend/tests/planetPickerTouchBrowser.browser.mjs)
uses fixture data and a wallet stub without broadcasting:

```sh
(cd apps/frontend && bun run test:touch-browser)
```

Backend payload changes require frontend consumer tests too. Contract/event
changes require contract/indexer tests and a state-preservation review.
Workspace-wide `bun run test`, `bun run check`, and `bun run build` are for broad changes.

GitHub Actions remains the CI entry point. The workflow uses repository variable
`VEYDRIFT_LOCAL_CI_RUNNER_LABELS` for eligible `backmeupplz` PRs, checking both
login and numeric user ID; other PRs and main pushes use hosted runners.
This does not imply a configured self-hosted runner is currently online.

Run the same scoped runner locally when needed:

```sh
bun run ci:preflight -- --base origin/main
```

[ci-scope.mjs](../scripts/ci-scope.mjs) and
[ci-run-scoped-checks.mjs](../scripts/ci-run-scoped-checks.mjs) define selection.
The scoped runner always checks project Markdown links and player-copy restrictions, even when
no package checks are selected. `bun run check:docs` runs the same checks and the link-checker test
locally, without network access or additional dependencies. Code examples are not executed by it.
Contract fast checks and storage-layout checks are separate; do not bypass the
storage gate for storage-relevant changes. Local checks do not replace required PR CI.
During rapid iteration, validate locally rather than checking GitHub at every step.

## Index repair

Repair changes the chosen database. Verify its path/chain and make a consistent
backup first. Run against an offline copy or under controlled writer ownership;
do not run competing repair writers against an active service.

```sh
cd apps/backend
bun run index:sync -- --from-block "${REPLAY_FROM_BLOCK:?Set the reviewed boundary}"
bun run index:replay -- --from-block "${REPLAY_FROM_BLOCK:?Set the reviewed boundary}"
bun run index:sync -- --alliance-state-seed
```

These are alternatives, not a sequence to run blindly:

- `index:sync` collects/stores requested logs, rematerializes stored history and
  performs canonical current-state reads for drift old events cannot reconstruct.
  The manual sync has no startup rebuild deadline unless
  `--sync-deadline-ms <milliseconds>` is explicitly supplied.
- `index:replay` rematerializes event history without a canonical-state reseed.
- `--alliance-state-seed` narrows repair to alliance state, avoiding planet/resource reseeding.

The writer also supports explicit one-time repair IDs:
`VEYDRIFT_CURRENT_STATE_HEAL_RUN_ID` for active/returning missions and
`VEYDRIFT_FULL_CANONICAL_STATE_HEAL_RUN_ID` for a full canonical repair.
Use a unique ID for an authorized operation, verify completion, then remove the
override. These are not periodic refresh settings or frontend loading workarounds.

## Troubleshooting

- CORS: prefer the matching Vite proxy over an absolute deployed API URL.
- Old state after confirmation: inspect transaction application status, indexer
  health, logs and query invalidation. Never fabricate a balance or resubmit automatically.
- Unavailable local treasury: verify public contract address/block and history readiness,
  not private signer availability.
- Backend port responds but state is unavailable: inspect readiness/backfill progress.
