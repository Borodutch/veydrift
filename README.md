# Veydrift

Veydrift is an onchain space project targeting Base. The public surface is
intentionally quiet for now: the website should signal that something is coming
without describing gameplay mechanics, economy details, factions, resources, or
release promises before those systems are approved.

## Repository Layout

```text
apps/
  backend/       Bun + TypeScript HTTP service with health and GraphQL endpoints
  frontend/      Preact + TypeScript + Tailwind public coming-soon app
packages/
  contracts/     Foundry Solidity playable smart-contract MVP for Base deployments
  circuits/      Retired circuit placeholder workspace; no zk gameplay roadmap
```

## Requirements

- Bun 1.1 or newer
- Node.js 20 or newer for frontend tooling launched by Bun
- Foundry for contract checks

## Setup

```sh
bun install
```

## Commands

Run all available checks:

```sh
bun run check
```

Run all tests:

```sh
bun run test
```

Build all packages:

```sh
bun run build
```

Start local development servers:

```sh
bun run dev:backend
bun run dev:frontend
```

## Package Notes

### Backend

`apps/backend` exposes:

- `GET /health`
- `GET /debug/config`
- `GET /wallet/:address/settlement`
- `GET /wallet/:address/queues`
- `GET /planets/:planetId`
- `GET /universe/galaxies/:galaxy/systems/:system`
- `GET /universe/systems?galaxy=1&center=250&radius=2`
- `POST /index/rebuild`
- `POST /webhooks/alchemy`
- `GET /graphql` / `POST /graphql` for the existing minimal service status response

Copy `apps/backend/.env.example` to `apps/backend/.env` and provide the Base
Sepolia RPC configuration before using chain-backed routes:

```sh
VEYDRIFT_DEPLOYMENT_MODE=local
VEYDRIFT_CHAIN_ID=84532
VEYDRIFT_CONTRACT_ADDRESS=0x...
VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS=0x...
VEYDRIFT_GAME_CONTRACT_ADDRESS=0x...
VEYDRIFT_METAL_TOKEN_ADDRESS=0x...
VEYDRIFT_CRYSTAL_TOKEN_ADDRESS=0x...
VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS=0x...
VEYDRIFT_INDEX_DB_PATH=.data/contract-state.sqlite
VEYDRIFT_INDEX_FROM_BLOCK=0
VEYDRIFT_ALCHEMY_WEBHOOK_SIGNING_KEY=...
ALCHEMY_BASE_SEPOLIA_API_KEY=...
# Optional explicit websocket overrides; otherwise the Alchemy key derives the Base Sepolia WS URL.
VEYDRIFT_WS_RPC_URL=
ALCHEMY_BASE_SEPOLIA_WS_URL=
```

The backend accepts `ALCHEMY_BASE_SEPOLIA_API_KEY`,
`ALCHEMY_BASE_SEPOLIA_RPC_URL`, `BASE_SEPOLIA_RPC_URL`, or `VEYDRIFT_RPC_URL`.
For websocket chain sync it accepts `VEYDRIFT_WS_RPC_URL` or
`ALCHEMY_BASE_SEPOLIA_WS_URL`, and falls back to
`wss://base-sepolia.g.alchemy.com/v2/<key>` when only
`ALCHEMY_BASE_SEPOLIA_API_KEY` is set. HTTP RPC remains the startup snapshot and
request/response fallback.
`VEYDRIFT_GAME_CONTRACT_ADDRESS` or the legacy `VEYDRIFT_CONTRACT_ADDRESS` must
point at the deployed `VeydriftGame` proxy for game-state APIs and runtime
Shipyard transactions.
`VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS` is the compact first-planet settlement
contract used for settlement/universe context and must not be used as the game
contract.
`VEYDRIFT_METAL_TOKEN_ADDRESS`, `VEYDRIFT_CRYSTAL_TOKEN_ADDRESS`, and
`VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS` expose the upgradeable ERC-20 resource token
proxies deployed for the game.
Health/debug responses only report safe configuration metadata and never echo
RPC URLs or API keys. Ownership remains canonical onchain; when the default
backend starts with valid chain config it kicks off a background SQLite index
reconciliation from `VEYDRIFT_INDEX_FROM_BLOCK` and reports the last
reconciled block, latest indexed block, in-progress state, reorg detection, and
last reconciliation error in `GET /health`. The websocket chain sync keeps the
SQLite-backed contract state index warm, `GET /chain/events` streams backend
chain-event notifications to the frontend, and `POST /index/rebuild` remains
the manual HTTP fallback for rebuilding settlement events.
`POST /webhooks/alchemy` accepts Alchemy contract log webhook payloads, verifies
`X-Alchemy-Signature` when `VEYDRIFT_ALCHEMY_WEBHOOK_SIGNING_KEY` is configured,
and applies duplicate-safe indexed event updates.

### Frontend

`apps/frontend` is a Vite Preact app with Tailwind CSS. The current production
surface is a space-themed coming-soon page for `https://veydrift.com` with no
game-specific details.

### Contracts

`packages/contracts` contains the first playable Solidity MVP. `VeydriftGame`
is an OpenZeppelin UUPS upgradeable contract behind an ERC1967 proxy with one
home planet per wallet, deterministic coordinates, lazy resource settlement,
building upgrades, defense and ship production, technology research, and
deployment/upgrade scripts.

Veydrift is in open alpha as of 2026-05-29. Contract-affecting work must
preserve existing player state. Prefer proxy upgrades when the deployed contract
supports them; if a full redeploy is unavoidable, follow
`docs/open-alpha-state-preservation.md` and
`docs/veydrift-contract-redeploy-runbook.md` before broadcasting or marking the
task done.

```sh
cd packages/contracts
forge fmt --check
forge build
forge test
```

Resource ERC-20 deployment for an already deployed game contract:

```sh
PRIVATE_KEY=... ADMIN_ADDRESS=0xAdmin VEYDRIFT_GAME_CONTRACT_ADDRESS=0xGame \
  forge script script/DeployResourceTokens.s.sol:DeployResourceTokens \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --verify
```

The token deploy script emits and returns the Metal, Crystal, and Deuterium
proxy addresses. Configure those addresses as backend/runtime environment
variables after deployment.

### Circuits

Veydrift gameplay state is public onchain state. There is no privacy, zk,
hidden-state backend, committed-root, or espionage roadmap for gameplay. See
`docs/public-onchain-state-architecture.md` for the canonical state model and
backend/indexer boundary, and
`docs/espionage-hidden-intel-decision-VEY-KANEO-196.md` for the explicit
classic-espionage exclusion decision.

`packages/circuits` contains retired placeholder files only. It remains in the
workspace so existing scripts keep passing until a cleanup task removes or
repurposes it; it must not be used as product guidance for zk gameplay.
`docs/ogame-parity-scope-VEY-KANEO-198.md` is the current scope record for
Veydrift-only mechanics versus classic OGame parity work.

```sh
cd packages/circuits
bun run check
```

## Deployment

The initial production target is the existing Hetzner Easypanel instance. The
contract deployment path is state-preserving by policy: do not redeploy alpha
contracts as a reset, and do not update backend runtime addresses without a
proxy-upgrade, no-state, or migrated-redeploy note in the Kaneo/PR handoff.
`veydrift/frontend` service is sourced from this GitHub repository on `main`.
Use the repository root as the EasyPanel source/build path and configure
Nixpacks with frontend-scoped commands so Bun can install the whole monorepo
workspace, including `@veydrift/universe`:

```sh
bun install --frozen-lockfile && rm -rf /root/.cache/nix
cd apps/frontend
bun run build
rm -rf /root/.bun/install/cache /tmp/*
bun run serve
```

Deploy only the frontend package until backend, contract, circuit, indexing, and
game-specific systems have separate implementation scopes.

The frontend also publishes Farcaster Mini App metadata at
`/.well-known/farcaster.json`. Before submitting it to Farcaster/Base discovery,
generate the signed `accountAssociation` for `veydrift.com` with the owning
Farcaster/Base account and replace the manifest values. The production build
emits `veydrift.com` manifest URLs, while the test build emits
`test.veydrift.com` manifest URLs.

### Test App

The separate EasyPanel app for `test.veydrift.com` uses two services in the
existing `veydrift` EasyPanel project:

- `veydrift/frontend` remains the production coming-soon service for
  `https://veydrift.com`.
- `veydrift/frontend-test` serves the MetaMask settlement test frontend at
  `https://test.veydrift.com`.
- `veydrift/backend-test` serves the test API at
  `https://api-test.veydrift.com`.

The test frontend must also use the repository root as the EasyPanel
source/build path. Do not set the source/build path to `/apps/frontend`, because
that excludes the root `workspaces` metadata and makes `workspace:*`
dependencies such as `@veydrift/universe` unavailable. Configure
`veydrift/frontend-test` with:

```text
Source path: /
Build type: Nixpacks
Nixpacks version: 1.34.1
Install command: bun install --frozen-lockfile && cd apps/frontend && NODE_ENV=development bun install --frozen-lockfile --force && rm -rf /root/.cache/nix
Build command: cd apps/frontend && node scripts/generate-image-variants.mjs && ../../node_modules/.bin/vite build --mode settlement && rm -rf /root/.bun/install/cache /tmp/*
Start command: cd apps/frontend && bun run serve
```

Those commands are equivalent to running:

```sh
bun install --frozen-lockfile && cd apps/frontend
NODE_ENV=development bun install --frozen-lockfile --force && rm -rf /root/.cache/nix
node scripts/generate-image-variants.mjs
../../node_modules/.bin/vite build --mode settlement
rm -rf /root/.bun/install/cache /tmp/*
bun run serve
```

The test build sets `VITE_VEYDRIFT_SURFACE=settlement`, uses
`https://test.veydrift.com` for canonical/social URLs, and emits `noindex`
robots metadata so the MetaMask first-planet flow can be reviewed separately from the quiet
production `veydrift.com` surface. Configure the frontend test service with:

```text
VITE_VEYDRIFT_API_URL=https://api-test.veydrift.com
VITE_VEYDRIFT_SETTLEMENT_ADDRESS=0x8bA1807073ac642A55596A4934c49115E400cD2f
VEYDRIFT_TEST_FARCASTER_ACCOUNT_ASSOCIATION={"header":"...","payload":"...","signature":"..."}
PORT=80
```

`VEYDRIFT_TEST_FARCASTER_ACCOUNT_ASSOCIATION` must be generated by the
Farcaster Mini App Manifest Tool for the exact domain `test.veydrift.com`. As
an alternative, set the three split variables
`VEYDRIFT_TEST_FARCASTER_ACCOUNT_ASSOCIATION_HEADER`,
`VEYDRIFT_TEST_FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD`, and
`VEYDRIFT_TEST_FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE`. The settlement build
intentionally rejects a missing or wrong-domain association so the test app does
not ship a `veydrift.com` account association.

If the Nixpacks deploy needs to be rolled back, keep the same environment
variables and switch only `veydrift/frontend-test` back to Dockerfile build with
Dockerfile path `apps/frontend/Dockerfile.test` from the repository root. Do not
repoint or modify the production `veydrift/frontend` service while rolling back
the test frontend.

The backend test service must also use the repository root as the EasyPanel
source/build path so Bun can install the monorepo workspace and resolve
`@veydrift/universe`. Do not set the source/build path to `/apps/backend`.
Configure `veydrift/backend-test` with:

```text
Source path: /
Build type: Nixpacks
Nixpacks version: 1.34.1
Nixpacks config path: apps/backend/nixpacks.test.toml
Install command: bun install --frozen-lockfile && rm -rf /root/.cache/nix
Build command: cd apps/backend && bun run build && rm -rf /root/.bun/install/cache /tmp/*
Start command: cd apps/backend && bun run start
```

Configure it with:

```text
VEYDRIFT_ALLOWED_ORIGIN=https://test.veydrift.com
VEYDRIFT_CHAIN_ID=84532
VEYDRIFT_CONTRACT_ADDRESS=<Base Sepolia VeydriftGame proxy address>
VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS=<Base Sepolia compact settlement address>
VEYDRIFT_GAME_CONTRACT_ADDRESS=<Base Sepolia VeydriftGame proxy address>
VEYDRIFT_METAL_TOKEN_ADDRESS=<Base Sepolia VeydriftMetal ERC-20 proxy address>
VEYDRIFT_CRYSTAL_TOKEN_ADDRESS=<Base Sepolia VeydriftCrystal ERC-20 proxy address>
VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS=<Base Sepolia VeydriftDeuterium ERC-20 proxy address>
VEYDRIFT_NETWORK_NAME=Base Sepolia
VEYDRIFT_PUBLIC_API_URL=https://api-test.veydrift.com
VEYDRIFT_PUBLIC_GRAPHQL_URL=https://api-test.veydrift.com/graphql
VEYDRIFT_RPC_URL=<Alchemy Base Sepolia RPC URL>
PORT=4000
```

`VEYDRIFT_RPC_URL` and deployer keys must come from Vaultwarden or EasyPanel
secret storage and must not be committed. If the backend Nixpacks deploy needs
to be rolled back, keep the same environment variables and switch only
`veydrift/backend-test` back to Dockerfile build with Dockerfile path
`apps/backend/Dockerfile.test` from the repository root. Broader rollback is
service-local: remove the `test.veydrift.com` and `api-test.veydrift.com`
domains from the test services, or scale/delete `frontend-test` and
`backend-test`. Do not repoint or delete the production `veydrift/frontend`
service while rolling back the test app.

## Operating Rules

- Keep public copy non-specific until the game direction is approved.
- Do not commit secrets, credentials, generated proving artifacts, or deployment
  tokens.
- Keep implementation PRs small and include validation evidence.
- Track work through the Veydrift Kaneo project and Symphony.
