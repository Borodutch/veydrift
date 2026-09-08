# Local state-refactoring testing

The draft refactoring PR can be tested with both API workers and the index database
on the laptop. This still reads **Base mainnet**: a transaction approved in your
wallet is a real mainnet transaction. The local backend has no production keeper,
randomness fulfiller, referral signer, or paid-invite encryption keys.

## Start

Configure the ignored `apps/backend/.env.local-runtime` with the current deployed contract
addresses, chain ID, accessible RPC URLs and deployment block boundaries, plus:

```dotenv
HOST=127.0.0.1
PORT=4000
VEYDRIFT_WORKER_COUNT=2
VEYDRIFT_DEPLOYMENT_MODE=local
VEYDRIFT_INDEX_DB_PATH=.data/local-mainnet.sqlite
```

Use `apps/frontend/.env.development.local` to override the default production proxy:

```dotenv
VITE_VEYDRIFT_API_URL=/local-api
VITE_VEYDRIFT_CHAIN=mainnet
```

Run in separate terminals from the repository root:

```sh
(cd apps/backend && bun --env-file=.env.local-runtime src/index.ts)
VITE_VEYDRIFT_SURFACE=playable bun run dev:frontend --host 127.0.0.1
```

Open <http://127.0.0.1:5173/>. Vite forwards `/local-api` exclusively to
`127.0.0.1:4000`; it does not fall back to production. The backend supervisor runs
one local indexing writer on `127.0.0.1:4001` and one API reader on port 4000.
Restart the backend manually after backend code edits. Do not use Bun watch mode
with this two-worker supervisor: a watch reload can leave the old child workers
alive. Frontend changes still hot-reload normally through Vite.

## Verify before gameplay testing

```sh
curl http://127.0.0.1:5173/local-api/runtime-config
curl http://127.0.0.1:5173/local-api/health
```

Verify chain ID 8453, a local `apiUrl`, `missionResolutionEnabled: false`, connected
chain sync, and a healthy index that has caught up to the chain head. A new database
requires an initial history scan; do not mistake listening ports for a ready index.
The existing explicit one-time canonical-state bootstrap can be requested with a
unique `VEYDRIFT_FULL_CANONICAL_STATE_HEAL_RUN_ID` in the local backend environment.
Keep these environment files and the SQLite database out of git.

RPC access on the current VPS is restricted by both UFW and Docker's `DOCKER-USER`
chain. Laptop access needs an exact source-IP allowlist in both; do not open the RPC
to all addresses. Recheck access after a laptop public-IP change or VPS restart.
SSH uses the laptop-only key `~/.ssh/veydrift_rpc_ed25519`; the node does not permit
SSH port forwarding.

Referral issuance and paid-invite secret operations are deliberately unavailable
without their signing/encryption configuration. Do not copy production private keys
just to make those local test flows available.
