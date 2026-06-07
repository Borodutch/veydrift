# Veydrift Randomness Engine

VEY-116 added a Veydrift-owned randomness oracle for MVP/testnet flows that need random outcomes
before an external VRF integration is ready. VEY-210 hardens that oracle with a default
precommit/reveal mode so the fulfiller cannot choose a random word after seeing a concrete request.

## Trust Model

This is still not fully trustless randomness. Authorized game modules request randomness from
RandomnessEngine, and the configured Veydrift fulfiller account reveals a server-generated uint256
random word. With `precommitRequired == true` (the deployment default), the fulfiller must commit to
`randomnessCommitment(randomWord)` in a prior block, each game request consumes the pending
commitment, and fulfillment must reveal the matching word.

The precommit boundary prevents arbitrary post-request word selection by the fulfiller. It does not
remove oracle liveness/censorship trust: the fulfiller can still fail to keep a pending commitment
ready, withhold the reveal for a consumed commitment, or delay a new commitment. Consumers continue
to block while requests are pending so the game does not fall back to unsafe entropy.

The future migration path is to keep the request/fulfillment consumer boundary and swap the
fulfiller to a VRF or proof-backed randomness provider.

## Contract Behavior

- Only owner-authorized requester contracts can call requestRandomness(bytes32 purposeHash).
- Only the configured fulfiller can call commitRandomness(bytes32 commitment).
- In default precommit mode, requestRandomness(bytes32 purposeHash) requires a non-zero pending
  commitment that was posted in an earlier block, stores it on the request, and consumes it so a
  later request needs a fresh commitment.
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
3. Submit `commitRandomness(commitment)` from the configured fulfiller account.
4. Wait at least one block before relying on that commitment for requestRandomness.
5. After a game request consumes the commitment, submit `fulfillRandomness(requestId, randomWord)`.
6. Immediately prepare and commit the next random word.

One pending commitment can fund one request. If no active commitment is ready, battle/moon request
creation reverts instead of accepting entropy that could be chosen after the request is known.

## Backend Worker

apps/backend/src/randomness.ts contains two testable loops:

`RandomnessFulfillmentWorker` is the legacy fulfill-only loop (for deployments with
`precommitRequired == false`):

- polls a chain client for pending RandomnessRequested events;
- generates a non-zero uint256 using node:crypto;
- submits fulfillment through the injected client;
- records fulfilled and failed attempts;
- exposes alert strings for pending request age and failed fulfillments.

`RandomnessCommitmentWorker` implements the hardened precommit lifecycle (Fulfiller Runbook steps
1-6) and is required whenever `precommitRequired == true` (the deployment default). Each `tick()`:

- reveals any request that has consumed a tracked commitment, using the **exact committed word**
  (a fresh word would fail `RandomnessCommitmentMismatch`);
- keeps exactly one pending commitment available on-chain — it only posts a new `commitRandomness`
  when none is pending, so it never trips `RandomnessCommitmentAlreadyPending`;
- persists the secret word↔commitment pair through an injected `RandomnessCommitmentStore`
  **before** broadcasting the commit tx, so a crash can never strand a request that later consumes
  that commitment (`FileRandomnessCommitmentStore` writes atomically for production;
  `InMemoryRandomnessCommitmentStore` is for tests);
- surfaces operational alerts: no pending commitment available, stale pending requests, an on-chain
  pending commitment whose reveal word is not tracked, and commit failures — plus the pending
  commitment age in blocks (`pendingCommitmentAgeBlocks`).

The contract enforces a one-block delay between commit and consumption, so a freshly committed word
is only consumable from the next block onward; the worker does not need to block on this, it simply
keeps a commitment ready.

Production wiring for a hardened deployment must run `RandomnessCommitmentWorker` against the live
engine from the configured fulfiller account, backed by a durable `RandomnessCommitmentStore`, and
surface the returned `RandomnessCommitmentStatus` in service health/monitoring. If an operator
disables precommit mode, the deployment may fall back to `RandomnessFulfillmentWorker` but must
record that the fulfiller can again choose the word after seeing the request and that the model is
accepted only for non-value-bearing testing.
