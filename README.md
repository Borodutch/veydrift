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
- `GET /graphql`
- `POST /graphql`

The GraphQL endpoint is intentionally minimal and returns only public service
status until the API contract is designed.

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

## Operating Rules

- Keep public copy non-specific until the game direction is approved.
- Do not commit secrets, credentials, generated proving artifacts, or deployment
  tokens.
- Keep implementation PRs small and include validation evidence.
- Track work through the Veydrift Kaneo project and Symphony.
