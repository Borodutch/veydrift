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

## Durable mission replay

Prepared mission batches store their exact signed bytes in the private SQLite signing result
before preparation returns, then transfer the hash/chain/signer/nonce/operation/membership binding
atomically to the prepared intent. The journal is WAL/FULL synchronous and 0600. Signed bytes are
broadcast-capable: protect the database, WAL, backups and volume; never attach them to tickets,
logs or API responses. Send errors retain fixed categories, not raw RPC/viem error objects.

The shared signer lease owns reconciliation and replay across mission/randomness writers and
rolling replicas. Before each RPC send it commits the attempt count and next retry time. Transient
or ambiguous sends receive three initial total attempts (250ms then 500ms backoff), subject to
canonical reads, fee guards and bounded reconciliation deadlines. A slow RPC may spread those
attempts over later resolver ticks. Afterward, one identical replay per 60 seconds remains eligible;
reconciliation continues on normal ticks. Restart reloads this schedule, never allocates a new
nonce, and never treats three failures, already-known, or null lookups as absence/success proof.
Canonical transaction inclusion without a receipt waits for receipt hydration. Deterministic
send rejection stays operator-actionable while canonical receipt reconciliation remains active.

Replay verifies the hash, recovered signer, chain and nonce against the immutable signing
reservation, and calldata/target against mission membership and operation ID. It refreshes Base
L1/operator estimates and productive simulation at the **same signed gas and fee fields**, using
the stricter original/current batch budget and immutable 0.0002 ETH transaction cap, with a
canonical <=30s fee block and synchronous final guard. An unaffordable/stale/unproductive envelope
waits for prerequisites or reviewed operator recovery; it is never fee-bumped or re-signed.
Receipt inclusion, per-member domain completion and finality retirement remain separate gates.

Crash states before signing-result transfer or before first-send validation stay explicitly fenced
(no automatic send), retaining any available raw envelope for independently reviewed recovery.
They do not silently restart preparation. Pending legacy rows with no signed bytes are labeled
as requiring original-envelope recovery evidence; no migration fabricates bytes, resets/deletes
an intent, replaces its nonce or re-signs. In particular this change does **not** recover mission
99306 / nonce 186225 / hash
`0x9a5173dcaaab65ef248fa34eba6014b7a718a0021c4826ac77fb9f8dcf218a09`.
Keep its existing lock until a canonical receipt or separately reviewed supported recovery exists.

Deploy only after independent review/tests, using the persistent journal and compatible writers.
Rollback to an older build disables replay (it cannot recover raw envelopes), so preserve the
journal and do not interpret the old build's hash-only diagnostics as permission for nonce repair.
