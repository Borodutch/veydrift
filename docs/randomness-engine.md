# Veydrift Randomness Engine

Veydrift uses a precommit/reveal oracle with a bounded inventory of future commitments.
This describes the current repository, not proof of the code or configuration deployed on a chain.
See [Deployment](deployment.md) before changing a live oracle.

## Trust Model

This is still not fully trustless randomness. Authorized game modules request randomness from
RandomnessEngine, and the configured Veydrift fulfiller account reveals a server-generated uint256
random word. With `precommitRequired == true` (the deployment default), the fulfiller must commit to
`randomnessCommitment(randomWord)` in a prior block. Each game request consumes one ready
commitment from the inventory, and fulfillment must reveal the matching word.

The precommit boundary prevents arbitrary post-request word selection by the fulfiller. It does not
remove oracle liveness/censorship trust: the fulfiller can still fail to keep a pending commitment
ready, withhold the reveal for a consumed commitment, or delay a new commitment. Consumers continue
to block while requests are pending so the game does not fall back to unsafe entropy.

The future migration path is to keep the request/fulfillment consumer boundary and swap the
fulfiller to a VRF or proof-backed randomness provider.

## Contract Behavior

- Only owner-authorized requester contracts can call requestRandomness(bytes32 purposeHash).
- Only the configured fulfiller can call `commitRandomness(bytes32)` or
  `commitRandomnessBatch(bytes32[])`.
- In default precommit mode, requestRandomness(bytes32 purposeHash) requires a non-zero pending
  commitment that was posted in an earlier block, stores it on the request, and consumes it so a
  later request consumes the next ready commitment. A batch can supply multiple requests without
  waiting for another worker tick. Duplicate commitments and inventory overflow revert.
- Only the configured fulfiller can call fulfillRandomness(requestId, randomWord), and in precommit
  mode the revealed word must match the commitment stored on that request.
- Every request stores requester, purpose hash, commitment, created time, fulfilled time, and random
  word.
- Consumers call consumeRandomness(requestId, purposeHash) from the same requester contract.
- Pending requests revert with PendingRandomness, so oracle downtime blocks affected resolution
  instead of falling back to unsafe entropy.
- Unknown requests, missing commitment, same-block commitment consumption, commitment mismatch,
  double fulfillment, unauthorized request/commit/fulfillment, zero purpose, zero random word, and
  cross-purpose consumption all revert.
- The owner can rotate requester authorization, rotate the fulfiller, pause/unpause the engine, and
  explicitly disable precommit mode only for a deployment where the remaining centralized trust is
  accepted.

## Fulfiller Runbook

For hardened deployments:

1. Generate a non-zero uint256 random word from a secure server entropy source before a game request
   exists.
2. Read `randomnessCommitment(randomWord)` from the deployed RandomnessEngine.
3. Persist every word/commitment mapping to durable storage **before** broadcasting a single or
   batch commitment through the configured fulfiller's transaction coordinator.
4. Wait at least one block before relying on that commitment for requestRandomness.
5. After a game request consumes the commitment, submit `fulfillRandomness(requestId, randomWord)`.
6. Refill the bounded inventory as commitments are consumed. Never replace a missing reveal word
   with fresh entropy or delete the secret store to clear an error.

One pending commitment can fund one request. If no active commitment is ready, battle/moon request
creation reverts instead of accepting entropy that could be chosen after the request is known.

## Backend Worker

[randomness.ts](../apps/backend/src/randomness.ts) contains two testable loops:

`RandomnessFulfillmentWorker` is the legacy fulfill-only loop (for deployments with
`precommitRequired == false`):

- polls a chain client for pending RandomnessRequested events;
- generates a non-zero uint256 using node:crypto;
- submits fulfillment through the injected client;
- records fulfilled and failed attempts;
- exposes alert strings for pending request age and failed fulfillments.

`RandomnessCommitmentWorker` implements the hardened precommit lifecycle (Fulfiller Runbook steps
1-6) and is required whenever `precommitRequired == true` (the deployment default). Each `tick()`:

- first refills the on-chain inventory toward **8 commitments** by default, then reveals requests
  that have consumed tracked commitments, using the **exact committed word**
  (a fresh word would fail `RandomnessCommitmentMismatch`);
- persists the secret word↔commitment pair through an injected `RandomnessCommitmentStore`
  **before** broadcasting the commit tx, allowing reveal recovery after restart as long as that
  durable store is preserved;
- surfaces operational alerts: no pending commitment available, stale pending requests, an on-chain
  pending commitment whose reveal word is not tracked, and commit failures — plus the pending
  commitment age in blocks (`pendingCommitmentAgeBlocks`), inventory and ready/target counts.

The contract enforces a one-block delay between commit and consumption, so a freshly committed word
is only consumable from the next block onward; the worker does not need to block on this, it simply
maintains inventory ahead of demand. Inventory count is not the same as ready count.

### Production wiring (`RandomnessCommitterService`)

[randomnessCommitter.ts](../apps/backend/src/randomnessCommitter.ts) wires the worker into the
backend. With valid configuration, the **writer** constructs and starts the service; readers do not
run it. It is enabled only when a usable chain client can be built (engine, key and RPC configured).
Configured does not mean healthy: inspect the service snapshot and readiness diagnostics.

The service:

- builds a viem `RandomnessCommitmentChainClient` (`ViemRandomnessCommitmentChainClient`) that reads
  engine state over the configured RPC and **signs `commitRandomness` / `fulfillRandomness` locally**
  with the fulfiller key, so it works against hosted RPC (Base Sepolia / Alchemy) that have no
  unlocked accounts;
- resolves each commitment through the on-chain `randomnessCommitment(word)` view (never a client-side
  keccak) so the committed value is guaranteed to match what `fulfillRandomness` recomputes at reveal;
- discovers requests from indexed candidates, a bounded recent on-chain tail, and periodic history
  audits, then checks candidate requests on chain;
- uses `SqliteRandomnessCommitmentStore` when `VEYDRIFT_RANDOMNESS_COMMITMENT_STORE_PATH` ends in
  `.sqlite`; otherwise uses `FileRandomnessCommitmentStore` (default `.data/randomness-commitments.json`).
  SQLite supports importing a configured legacy file. Keep the durable secrets backed up and private;
- shares `ResolverTransactionCoordinator` with the backend mission resolver, keyed by chain and
  signer and backed by the shared durable resolver store. Do not run an independent wallet client
  with the same signer: a different process or store does not share its nonce lease;
- ticks every **1 second** by default, skips overlapping service ticks, and surfaces the latest
  `RandomnessCommitmentStatus` (and `lastError`) under
  `randomnessCommitter` in `GET /health`.

Required environment for the committer (in addition to the engine being deployed/authorized):

- `VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS` — deployed `RandomnessEngine` proxy address;
- `VEYDRIFT_RANDOMNESS_FULFILLER_KEY` — 0x-prefixed 32-byte private key of the engine's `fulfiller`
  account (least-privilege, funded for gas; **never logged or surfaced in health**);
- `VEYDRIFT_RPC_URL` (or the existing Alchemy/Base-Sepolia RPC env) and `VEYDRIFT_CHAIN_ID`;
- optional `VEYDRIFT_RANDOMNESS_COMMITMENT_STORE_PATH` to relocate the durable secret store;
- optional `VEYDRIFT_RANDOMNESS_COMMITMENT_LEGACY_STORE_PATH` for the reviewed file-to-SQLite import;
- `VEYDRIFT_RESOLVER_TRANSACTION_STORE_PATH` when overriding the coordinator store, which otherwise
  lives beside the configured index database as `resolver-transactions.sqlite`.

`safeConfigSummary` reports `randomnessCommitterConfigured` (engine + key + RPC all present) so health
checks can distinguish configured from unconfigured; check `randomnessCommitter.enabled`, recent
successful runs, alerts and ready inventory separately. If an operator disables precommit mode, the same service
still works (the worker reveals a fresh word for zero-commitment requests), but record that the
fulfiller can again choose the word after seeing the request and that the model is accepted only for
non-value-bearing testing.

For incident handling, see [Resolver nonce recovery](resolver-nonce-recovery.md).
