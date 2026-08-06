# Local development

## Install

From the repository root:

```sh
bun install
```

Use Bun 1.1 or newer, Node.js 20 or newer, and Foundry when working on contracts.

## Frontend

Start Vite:

```sh
bun run dev:frontend
```

The default URL is `http://localhost:5173`. `apps/frontend/.env.development` points browser API calls at a Vite proxy, which forwards to the selected deployed API without local CORS changes. The committed development default is `/prod-api`.

To select an environment, set `VITE_VEYDRIFT_API_URL` to one of:

- `/test-api` for `https://api-test.veydrift.com`
- `/prod-api` for `https://api.veydrift.com`
- an explicit local API URL when running the backend yourself

The frontend obtains chain IDs and deployed public addresses from `/runtime-config`. Do not duplicate deployment addresses in components.

## Backend

Create a local environment file:

```sh
cp apps/backend/.env.example apps/backend/.env
```

At minimum, choose the deployment mode and chain, then configure the deployed settlement, game, alliance, moon, randomness, and resource-token addresses used by the routes you are testing. Configure an HTTP RPC URL or Alchemy key for indexer and writer work. Keep all secrets out of Git.

Start the service:

```sh
bun run dev:backend
```

Useful checks:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/runtime-config
```

The exact port comes from the backend environment. Normal read routes use the SQLite index; they do not repair state through request-time RPC calls.

## Other services

```sh
bun run dev:keeper
bun run dev:chicken-burn-listener
```

Only run writer services with the intended chain, funded account, and deployment addresses. A local frontend does not require either writer.

## Validation

Use focused commands while iterating:

```sh
bun run test:frontend
bun run check:frontend
bun run test:backend
bun run check:backend
bun run test:contracts
bun run check:contracts
git diff --check
```

Use the repository-wide commands for broad cross-package changes:

```sh
bun run test
bun run check
bun run build
```

Backend response changes require both backend and frontend validation. Contract event changes require contract tests, backend indexer tests, and a state-preservation review.

## Index repair

Index repair is an explicit operator action:

```sh
cd apps/backend
bun run index:sync -- --from-block <block>
bun run index:replay -- --from-block <block>
bun run index:sync -- --alliance-state-seed
```

Use `index:sync` when canonical current-state seeding is required. Use `index:replay` when stored event logs are sufficient. Do not add automatic repair work to frontend requests or normal API reads.

## Common failures

- A local browser CORS error usually means the frontend is pointing at an absolute deployed API URL instead of `/test-api` or `/prod-api`.
- A confirmed transaction with old UI data means the expected event has not reached the indexed read model yet. Inspect backend health and event ingestion; do not fabricate a local balance.
- A failing runtime-config request usually means the API base URL or deployment configuration is wrong.
- A stale historical audit may name moved files or old addresses. Revalidate it before acting.
