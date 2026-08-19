# Resolver nonce recovery (VEY-KANEO-853)

This runbook covers the production resolver incident observed on 2026-08-19. The resolver EOA had
chain/pending nonce `63996`, no visible pending transaction, and queued transactions at
`64002`–`64011`. Mission resolution and randomness fulfillment used the same signer through separate
wallet clients, leaving the six-nonce gap `63996`–`64001`.

The recovery is an OpenClaw-owner production operation. A normal Symphony implementation worker must
not resolve credentials, restart Easypanel services, or add `--broadcast`.

## Production checkpoint (2026-08-19 02:05 UTC)

The incident range is already recovered. **Do not run either command below for `63996–64001` again.**
The first two recovery transactions mined; the original higher-fee queued transactions superseded the
remaining four after continuity reopened. The resolver advanced contiguously to `64020`, latest and
pending became equal, and txpool pending/queued became empty. Randomness recovered to `0` pending and
`8/8` ready. Mission signing remains intentionally disabled until this coordinator is merged and
deployed.

The CLI instructions below document the guarded mechanism for audit/future incidents. The remaining
live work for VEY-KANEO-853 is the managed coordinator rollout, mission-signer restoration, mission
backlog drain, and one full error-free resolver interval.

## Safety invariants

- Keep the randomness safety gate closed until the commitment mapping and pending requests are healthy.
- Stop every old backend/oracle process that can sign with the resolver EOA before filling the gap.
- Use the existing Easypanel-managed deployment controls; do not mutate Docker Swarm directly.
- Confirm the configured mission and randomness keys resolve to the same expected public EOA without
  printing either key.
- Never replace an occupied nonce. The recovery command requires `latest == pending == expected` before
  every cancellation and aborts if the range is not exactly contiguous.
- Cancellation transactions are zero-value self-transfers. They do not call the game or randomness
  contracts and therefore cannot change mission, seed, commitment, or battle state.

## Guarded recovery command (audit/future incidents only)

Run from `apps/backend` inside the owner-controlled environment. The normal config variables must
already resolve the RPC URL, chain id, signer key, and shared data volume.

For a newly diagnosed range, first perform the mandatory read-only check with that range (the historical
values are shown only to make the incident evidence reproducible in code review):

```sh
bun run resolver:recover-nonce-gap -- --from 63996 --through 64001
```

The command must report chain id `8453`, the expected resolver public address, dry-run mode, and exactly
six planned nonces. If chain id, address, `latest`, or `pending` differs, stop and record the current
nonce/txpool state; do not widen or shift the range speculatively.

Only the OpenClaw production owner may repeat a newly verified range with broadcasting enabled. Never
repeat the historical command now that nonce `64020` has been reached:

```sh
bun run resolver:recover-nonce-gap -- --from 63996 --through 64001 --broadcast
```

The command holds the same durable resolver lease as the backend, submits one cancellation at a time,
waits for a successful receipt, and rechecks chain continuity before the next nonce. After `64001`
confirms, the previously queued `64002`–`64011` transactions can drain in nonce order. Record every
public transaction hash and receipt; never record environment values.

## Managed rollout ordering

1. Keep the mission signer disabled. At the first fixed-build cutover, stop every pre-fix
   resolver-capable process so an old wallet client cannot race a new coordinator during rolling start.
2. Deploy the backend build containing VEY-KANEO-853 through Easypanel with randomness as the sole writer.
3. Ensure `VEYDRIFT_RESOLVER_TRANSACTION_STORE_PATH` points to a persistent shared SQLite path when an
   override is used. With no override it is `resolver-transactions.sqlite` beside
   `VEYDRIFT_INDEX_DB_PATH`, on the same persistent data volume.
4. Verify the fixed randomness writer remains at `0` pending / `8` ready with no nonce/lease error.
5. Restore the mission signer through Easypanel and perform a managed redeploy. Mission and randomness
   clients now share one per-address coordinator; later rolling replicas serialize through its renewable
   SQLite lease.
6. Do not run the standalone randomness oracle concurrently unless it uses the same shared coordinator
   path and this VEY-KANEO-853 build.

## Live verification

Verify for at least one complete resolver interval after the queues reach zero:

- Preserve the completed recovery proof: nonce `64020`, latest=pending, empty txpool, and no canonical
  loss from the two observed `AlreadyFulfilled` duplicate reverts.
- All 8 incident randomness requests are fulfilled and the commitment inventory returns to its target.
- Overdue arrivals and returns drain to zero (or visibly decrease each interval without retry loops).
- `GET /health` returns HTTP 200, reports healthy mission resolution/randomness readiness, and shows no
  stale due-arrival or due-return warning.
- Indexed head equals chain head exactly after the final receipts are ingested.
- Logs contain no `replacement transaction underpriced`, nonce-too-low, nonce-gap, or resolver lease
  errors for a full resolver interval.
- The randomness safety gate is reopened only after the durable reveal mapping is healthy.

If any check fails, stop further resolver-capable processes, preserve the exact latest/pending nonce,
public transaction hashes/receipts, queue counts, health response, and index/chain heads, and resume from
the first unverified nonce. Do not rerun the original six-nonce range after any nonce has been consumed.
