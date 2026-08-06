# Veydrift

Veydrift is a persistent onchain space strategy game on Base. Players settle planets, produce Metal, Crystal, and Deuterium, research technology, build fleets and defenses, form alliances, fight, and move resources through the Rift.

The contracts are the source of truth. The backend indexes public contract events into fast read models, and the Preact frontend reads those models through one shared data store.

- Production: [veydrift.com](https://veydrift.com)
- Test environment: [test.veydrift.com](https://test.veydrift.com)
- Player guide: [veydrift.com/docs](https://veydrift.com/docs)
- Repository documentation: [docs/README.md](docs/README.md)

## Repository layout

```text
apps/
  backend/                 Bun HTTP API and event-sourced SQLite indexer
  frontend/                Preact, Vite, and Tailwind web app
  battle-keeper/           Due-mission resolution worker
  chicken-burn-listener/   Burning Chicken moon-grant listener
  stats/                   Public statistics service
packages/
  contracts/               Foundry Solidity contracts and deploy scripts
  universe/                Shared deterministic universe data and formulas
  circuits/                Retired circuit placeholder; no private-gameplay roadmap
docs/                      Architecture decisions, runbooks, and historical audits
```

## Requirements

- [Bun](https://bun.sh/) 1.1 or newer
- Node.js 20 or newer
- [Foundry](https://book.getfoundry.sh/getting-started/installation) for Solidity work

## Quick start

Install dependencies:

```sh
bun install
```

Start the frontend against the API selected in `apps/frontend/.env.development` (currently the production API through Vite's local proxy):

```sh
bun run dev:frontend
```

Vite prints the local URL, normally `http://localhost:5173`. Local API requests use the proxy configured in `apps/frontend/.env.development`, so browser CORS setup is not required.

To run the backend locally, copy its environment template, fill in the required contract and RPC values, then start it:

```sh
cp apps/backend/.env.example apps/backend/.env
bun run dev:backend
```

See [docs/development.md](docs/development.md) for environment choices and focused commands.

## Validate changes

Run the checks closest to the code you changed first:

```sh
bun run test:frontend
bun run check:frontend

bun run test:backend
bun run check:backend

bun run test:contracts
bun run check:contracts
```

Run the complete repository suites before a broad release:

```sh
bun run test
bun run check
bun run build
```

## How data moves

```text
wallet transaction
  -> Base contract and authoritative events
  -> backend event indexer and SQLite read models
  -> typed API client
  -> shared frontend BackendDataStore
  -> every screen that renders that data
```

Frontend components do not issue backend reads directly. They call refresh methods on `BackendDataStore`, which stores the latest response and reuses an existing promise when the same request is already running. Per-planet UI snapshots project that shared data into Overview, Infrastructure, planet details, the planet selector, and other surfaces without creating another network path.

After a wallet transaction confirms, the app waits for the exact indexed transaction or expected state transition before reporting success. Chain-event notifications trigger the same centralized refresh path. See [docs/frontend-data-store.md](docs/frontend-data-store.md).

## Backend and indexer

Normal API reads come from the SQLite index. They must not perform request-time canonical RPC reads. `GET /health` reports index progress and reconciliation health; `GET /chain/events` streams indexed event notifications to frontend refresh triggers.

Use explicit operator commands when an index needs repair:

```sh
# Fetch logs, rematerialize them, then seed canonical current state.
cd apps/backend
bun run index:sync -- --from-block <block>

# Rematerialize stored logs without canonical RPC reads.
bun run index:replay -- --from-block <block>

# Repair only alliance directory, membership, requests, and diplomacy.
bun run index:sync -- --alliance-state-seed
```

Configuration is documented in `apps/backend/.env.example`. Never commit `.env` files, RPC credentials, private keys, or webhook signing keys.

## Contracts and state safety

The contracts use upgradeable proxies and public event-reconstructable gameplay state. Run contract checks from the workspace root or directly with Foundry:

```sh
cd packages/contracts
forge fmt --check
forge build
forge test
```

Veydrift is in open alpha as of 2026-05-29. Contract-affecting work must preserve existing player state. Prefer a compatible proxy upgrade. If a full redeploy is unavoidable, follow [docs/open-alpha-state-preservation.md](docs/open-alpha-state-preservation.md) and [docs/veydrift-contract-redeploy-runbook.md](docs/veydrift-contract-redeploy-runbook.md) before broadcasting anything.

## Documentation

Start with [docs/README.md](docs/README.md). It separates current architecture and runbooks from historical issue investigations so it is clear which documents describe active behavior.

Important references:

- [Local development](docs/development.md)
- [Frontend data store](docs/frontend-data-store.md)
- [Public onchain state](docs/public-onchain-state-architecture.md)
- [Indexer architecture](docs/event-sourced-indexer-VEY-KANEO-475.md)
- [Combat reference](docs/combat-reference.md)
- [Randomness engine](docs/randomness-engine.md)
- [Deployment and state preservation](docs/open-alpha-state-preservation.md)

## Security

Do not post private keys, API keys, deployment manifests with secrets, or unredacted production configuration in issues or pull requests. Treat builds and tests as bounded evidence; deployment-sensitive changes still require the relevant runbook, live configuration checks, and post-deploy smoke tests.
