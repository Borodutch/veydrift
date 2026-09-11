# Veydrift

Veydrift is a public onchain space strategy game targeting Base. Contracts enforce
gameplay; the backend indexes public chain state into SQLite; the frontend renders
indexed state and submits user-authorized wallet actions.

## Start here

- [Development](docs/development.md): installation, local frontend/backend, validation and index repair.
- [Documentation index](docs/README.md): current architecture, operations and safety guides.
- [Frontend state](docs/frontend-data-store.md): centralized state, parallel queries and session-only transactions.
- [Backend and indexer](docs/backend-indexer.md): event ingestion, projections, API boundaries and workers.
- [Deployment](docs/deployment.md): application builds, configuration and readiness gates.
- [Player manual](apps/frontend/src/docs/content/docs.md): gameplay documentation shipped with the app.

## Workspace

| Path | Responsibility |
| --- | --- |
| `apps/frontend` | Preact, TypeScript and Vite game UI |
| `apps/backend` | Bun API, SQLite indexer and configured writer services |
| `apps/battle-keeper` | Separate fleet-resolution service |
| `apps/chicken-burn-listener` | Cross-chain Chicken burn listener |
| `apps/stats` | Isolated statistics service |
| `packages/contracts` | Solidity contracts, deployment scripts and parity tests |
| `packages/universe` | Shared universe generation and types |

## Quick start

```sh
bun install
bun run dev:frontend
```

Open <http://localhost:5173>. The committed Vite default proxies the deployed
production API. For a fully local API/indexer, follow the
[local backend setup](docs/development.md#local-api-and-indexer).
A local page connected to mainnet still submits real mainnet transactions.

Package commands live in [package.json](package.json). Use focused tests while
iterating; `bun run check`, `bun run test`, and `bun run build` cover the workspace.

## Safety and architecture

Veydrift is in open alpha as of 2026-05-29. Preserve existing player and indexed
state. Contract work must follow [open-alpha state preservation](docs/open-alpha-state-preservation.md)
and the [contract redeploy runbook](docs/veydrift-contract-redeploy-runbook.md).
Verify the deployed proxy type and authority; an old deployment note is not
permission to upgrade or redeploy.

Keep secrets, local databases and environment overrides out of Git. Do not copy
production signing keys into local development. Read requests must not trigger
canonical RPC repair, and frontend refresh failures must not become transaction
failures or application-wide locks.

[Public state and product scope](docs/public-onchain-state-architecture.md) is the
authority for the no-hidden-state/no-espionage boundary.
