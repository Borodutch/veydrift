# Resolver nonce recovery

Use only for a newly diagnosed and operator-reviewed nonce gap. Verify the current chain, signer,
deployment, queued transactions and exact range independently. Recovery can release previously queued
transactions and is an explicitly authorized deployment-owner operation, not routine development.
Do not access production credentials, restart managed services or broadcast without that authority.

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

## Guarded recovery command

Run from `apps/backend` inside the owner-controlled environment. The normal config variables must
already resolve the RPC URL, chain id, signer key, and shared data volume.

For a newly diagnosed range, set `RECOVERY_FROM_NONCE` and `RECOVERY_THROUGH_NONCE` to the exact
operator-reviewed inclusive boundaries. Independently inspect queued transactions: equality of
latest/pending nonce alone does not prove that higher nonces are empty. Stop incompatible signers
before either command. First run without broadcasting (it still opens the durable coordinator and
acquires its lease, so it is not filesystem-read-only):

```sh
bun run resolver:recover-nonce-gap -- \
  --from "${RECOVERY_FROM_NONCE:?Set the reviewed first nonce}" \
  --through "${RECOVERY_THROUGH_NONCE:?Set the reviewed last nonce}"
```

The command must report the independently verified chain ID (`8453` for Base mainnet), expected
resolver public address, dry-run mode, and exactly the reviewed inclusive range. If chain ID,
address, `latest`, or `pending` differs from the reviewed state, stop and record the current
nonce/txpool state; do not widen or shift the range speculatively.

Only the authorized production deployment owner may repeat that newly verified range with broadcasting enabled:

```sh
bun run resolver:recover-nonce-gap -- \
  --from "${RECOVERY_FROM_NONCE:?Set the reviewed first nonce}" \
  --through "${RECOVERY_THROUGH_NONCE:?Set the reviewed last nonce}" --broadcast
```

The command holds the same durable resolver lease as the backend, submits one cancellation at a time,
waits for a successful receipt, and rechecks chain continuity before the next nonce. Filling a gap
can release already queued higher-nonce transactions, which must be reviewed beforehand. Record every
public transaction hash and receipt; never record environment values.

## Managed rollout ordering

1. Keep the mission signer disabled. At the first fixed-build cutover, stop every pre-fix
   resolver-capable process so an old wallet client cannot race a new coordinator during rolling start.
2. Deploy the reviewed coordinator-capable backend through Easypanel with randomness as the sole signer.
3. Ensure `VEYDRIFT_RESOLVER_TRANSACTION_STORE_PATH` points to a persistent shared SQLite path when an
   override is used. With no override it is `resolver-transactions.sqlite` beside
   `VEYDRIFT_INDEX_DB_PATH`, on the same persistent data volume.
4. Verify randomness reaches its configured ready-inventory target (currently 8 by default), with no
   missing reveal mappings, stale requests or nonce/lease errors.
5. Restore the mission signer through Easypanel and perform a managed redeploy. Mission and randomness
   clients now share one per-address coordinator; later rolling replicas serialize through its renewable
   SQLite lease.
6. Do not run the standalone randomness oracle concurrently unless it uses the same shared coordinator
   path and a compatible coordinator implementation. Never share the signer with the standalone
   battle keeper, which does not use this coordinator.

## Live verification

Verify for at least one complete resolver interval after the queues reach zero:

- Record the recovery's final nonce, latest/pending equality, txpool state and canonical receipts.
- Every affected randomness request is fulfilled and the commitment inventory returns to its target.
- Overdue arrivals and returns drain to zero (or visibly decrease each interval without retry loops).
- `GET /health` returns HTTP 200, reports healthy mission resolution/randomness readiness, and shows no
  stale due-arrival or due-return warning.
- All recovery receipts are indexed canonically and the indexed head catches up to a recorded chain
  head; independently sampled moving heads need not be numerically identical.
- Logs contain no `replacement transaction underpriced`, nonce-too-low, nonce-gap, or resolver lease
  errors for a full resolver interval.
- The randomness safety gate is reopened only after the durable reveal mapping is healthy.

If any check fails, stop further resolver-capable processes, preserve the exact latest/pending nonce,
public transaction hashes/receipts, queue counts, health response, and index/chain heads, and resume from
the first unverified nonce only after a new review. Do not rerun a range after any nonce has been consumed.
