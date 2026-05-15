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
  circuits/      zk circuit placeholder workspace and proving stack notes
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
- `GET /graphql` / `POST /graphql` for the existing minimal service status response

Copy `apps/backend/.env.example` to `apps/backend/.env` and provide the Base
Sepolia RPC configuration before using chain-backed routes:

```sh
VEYDRIFT_DEPLOYMENT_MODE=local
VEYDRIFT_CHAIN_ID=84532
VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS=0x...
VEYDRIFT_INDEX_FROM_BLOCK=0
ALCHEMY_BASE_SEPOLIA_API_KEY=...
```

The backend accepts `ALCHEMY_BASE_SEPOLIA_API_KEY`,
`ALCHEMY_BASE_SEPOLIA_RPC_URL`, `BASE_SEPOLIA_RPC_URL`, or `VEYDRIFT_RPC_URL`.
Health/debug responses only report safe configuration metadata and never echo
RPC URLs or API keys. Ownership remains canonical onchain; the in-memory index
can be rebuilt from settlement events with `POST /index/rebuild`.

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

```sh
cd packages/contracts
forge fmt --check
forge build
forge test
```

### Circuits

`packages/circuits` contains placeholder circuit inputs, proof artifact notes,
and a proving-stack decision log. It does not commit to a concrete zk use case or
proving system yet.

```sh
cd packages/circuits
bun run check
```

## Deployment

The initial production target is the existing Hetzner Easypanel instance. The
`veydrift/frontend` service is sourced from this GitHub repository on `main`,
uses build path `/apps/frontend`, and runs the frontend `nixpacks.toml`:

```sh
cd apps/frontend
bun install --frozen-lockfile
bun run build
bun run serve
```

Deploy only the frontend package until backend, contract, circuit, indexing, and
game-specific systems have separate implementation scopes.

The frontend also publishes Farcaster Mini App metadata at
`/.well-known/farcaster.json`. Before submitting it to Farcaster/Base discovery,
generate the signed `accountAssociation` for `veydrift.com` with the owning
Farcaster/Base account and replace the empty manifest values.

### Test App

The separate EasyPanel app for `test.veydrift.com` uses two services in the
existing `veydrift` EasyPanel project:

- `veydrift/frontend` remains the production coming-soon service for
  `https://veydrift.com`.
- `veydrift/frontend-test` serves the MetaMask settlement test frontend at
  `https://test.veydrift.com`.
- `veydrift/backend-test` serves the test API at
  `https://api-test.veydrift.com`.

The test frontend uses the same build path, `/apps/frontend`, and can be built
with either `Dockerfile.test` or `nixpacks.test.toml`. Both run:

```sh
bun run build:test
```

The test build sets `VITE_VEYDRIFT_SURFACE=settlement`, uses
`https://test.veydrift.com` for canonical/social URLs, and emits `noindex`
robots metadata so the MetaMask first-planet flow can be reviewed separately from the quiet
production `veydrift.com` surface. Configure the frontend test service with:

```text
VITE_VEYDRIFT_API_URL=https://api-test.veydrift.com
VITE_VEYDRIFT_SETTLEMENT_ADDRESS=<Base Sepolia settlement address>
```

The backend test service uses build path `/apps/backend` and can be built with
either `Dockerfile.test` or `nixpacks.test.toml`. Configure it with:

```text
VEYDRIFT_ALLOWED_ORIGIN=https://test.veydrift.com
VEYDRIFT_CHAIN_ID=84532
VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS=<Base Sepolia settlement address>
VEYDRIFT_NETWORK_NAME=Base Sepolia
VEYDRIFT_PUBLIC_API_URL=https://api-test.veydrift.com
VEYDRIFT_PUBLIC_GRAPHQL_URL=https://api-test.veydrift.com/graphql
VEYDRIFT_RPC_URL=<Alchemy Base Sepolia RPC URL>
```

`VEYDRIFT_RPC_URL` and deployer keys must come from Vaultwarden or EasyPanel
secret storage and must not be committed. Rollback is service-local: remove the
`test.veydrift.com` and `api-test.veydrift.com` domains from the test services,
or scale/delete `frontend-test` and `backend-test`. Do not repoint or delete the
production `veydrift/frontend` service while rolling back the test app.

## Operating Rules

- Keep public copy non-specific until the game direction is approved.
- Do not commit secrets, credentials, generated proving artifacts, or deployment
  tokens.
- Keep implementation PRs small and include validation evidence.
- Track work through the Veydrift Kaneo project and Symphony.
