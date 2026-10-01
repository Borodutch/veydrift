# Mission batch resolver (VEY-KANEO-918)

## Rollout guard

The production path is `MissionResolutionService` / `ViemMissionResolutionChainClient`,
not the standalone battle keeper. Batching defaults **off**. Separate exact-head
contract greenlight, compatible backend deployment, contract upgrade, keyless
simulation and explicit runtime enable are required. This change never raises
existing single-call signer policy or the independent QA wallet $0.20 cap.

Set only after review:
- `VEYDRIFT_MISSION_BATCH_ENABLED=true`
- `VEYDRIFT_MISSION_BATCH_MAX_ITEMS`: default 16; range 1–32 (must also fit contract bound).
- `VEYDRIFT_MISSION_BATCH_MAX_USD`: default 0.50; may lower, never exceed the provisional $0.50 guard.
- `VEYDRIFT_MISSION_BATCH_ETH_USD_FEED`: reviewed Chainlink-compatible ETH/USD aggregator on the selected Base chain. No hardcoded/stale price fallback.
- `VEYDRIFT_MISSION_BATCH_PRICE_MAX_AGE_SECONDS`: default 120, range 1–300. Verify actual feed heartbeat; a slower feed blocks instead of relaxing freshness.

Local signer, persistent resolver SQLite and Base 8453/84532 are required. Unlocked
account batching is unsupported. Standalone keeper fails startup if either
`MISSION_BATCH_ENABLED` or `VEYDRIFT_MISSION_BATCH_ENABLED` is true; it does not
silently fall back to uncapped singles. Do not run standalone and backend against
the same signer: standalone has no durable shared nonce coordinator.

## ABI and chronology

Uses `resolveFleetMissionBatch((uint256 missionId,uint8 leg)[] items) returns (uint8[] outcomes,uint256 executionGasUsed)`,
arrival=0 (including hold expiry), return=1. Selector unchanged; updated return ABI is mandatory.
Outcomes: 0 Settled, 1 Pending (no progress), 2 AlreadySettled, 3 Invalid,
4 NotDue, 5 Failed, 6 GasLimited, 7 Progress (canonical prerequisite/round advancement). No generic multicall. Per-item contract events are compatible
with the existing indexer's canonical mission events; the service reconciles each
requested leg from storage, not from receipt success. Returned items are not
claimed settled merely because a transaction mined. Contract ABI/bound/event
compatibility must be checked against the integrated contract head before release.

Read canonical status/due timestamps at a pinned block, sort dueAt, then ordinary
arrival (kind0), return (kind1), DefenseHold expiry (kind2), then numeric mission ID.
Hold expiry comes from the canonical slot50 mapping, not physical arrivalAt or
a projected return time; physical arrival remains unchanged in the read model. Never group all arrivals before returns.
905's prospective/legacy mixed-generation boundary is unchanged; no retroactive
ordering guarantee or mission migration. Contract ordering guards remain the
security boundary, including when an oversized/not-ready earlier mission is omitted.

## Packing and exposure

One bounded SQL keyset page (100) rotates by mission ID, then the page is sorted
chronologically; the cursor wraps at the end. Selection is not an ordering bypass:
canonical guards still block dependencies outside this page. A blocked first 100
or 500 cannot hide later unrelated work. Greedy exact-calldata measurement uses at
most 2N quotes and a 20-second packing deadline plus final leased re-quote, one
transaction per 5-second tick. Each quote performs a full-cap and exact-signed-gas call.
Structured per-leg exclusions cause canonical row reconciliation and individual
backoff, including stale/settled, ordering-unavailable and indivisible candidates.
No delay waiting to fill a lone due item. Mixed-cost candidates can fill gaps after
an indivisible oversized mission; its explicit blocker event asks for gas/prerequisite
review, never raising the cap or splitting mission semantics. Candidate retries use
existing 30–300-second backoff. Final canonical membership change aborts and repacks
next tick rather than signing stale calldata.

Gas does NOT use eth_estimateGas(success): caught OOG/no-op is still RPC success.
An explicit eth_call at min(Base 2^24,current block gas) returns gross internal
execution gas. Add intrinsic/calldata, EIP150 (64/63), 120k proxy/tail reserve and
8k/item overhead, then 20% margin. The result must remain within the unchanged
Base/block cap. The EXACT signed gas/nonce/fees/value/calldata is re-simulated at
the same block and must return the same productive outcomes (only Settled/Progress).
Pending, Failed, NotDue, GasLimited or missing/invalid return data never authorize
a signature. Progress is explicitly not counted as settlement. An indivisible item
that cannot fit is a visible blocker, not permission to raise gas or USD guards.
Signed maxFeePerGas is 2*baseFee+tip. L1 data uses the greater of exact unsigned
serialized-transaction getL1Fee and getL1FeeUpperBound(size), with 2x headroom.
Operator cost uses GasPriceOracle.getOperatorFee(safetyGas), with 2x headroom;
this oracle supports current fork-specific formulas. Every read is fail-closed,
including missing operator support. A block older than 30 seconds is rejected.
Fresh positive completed ETH/USD rounds convert total exposure using integer
arithmetic rounded upward. Membership, measurement, price and fee-oracle reads
are pinned; a new quote and canonical block-hash/age check occur under the nonce
lease before signing.

**Protocol limitation:** EIP-1559 caps execution price, not Base L1/operator fees or
USD exchange rate at eventual inclusion. The $0.50 limit is a fresh conservative
pre-send total exposure envelope, not an impossible protocol-enforced dollar cap.
No replacement/cancellation automatically increases exposure. Release review must
accept this limitation, live-measure the fee oracle, and keep batching disabled if
an absolute inclusion-time dollar guarantee is required.

Synthetic measured workload: 100 legs (20 expensive arrivals at 400k gas and 80
returns at 40k, plus 60k overhead, 1m gas envelope) -> 13 transactions instead of
100, maximum observed fill 14, 1180 estimates across all draining windows. These
are fixture measurements, not real-chain gas benchmarks or a universal safe batch
size. A local Anvil run of the corrected contract chronology harness using this
production quote client reproduces naive successful no-op estimates. For 1/8/32
independent returns, selected gas is 299,018 / 1,080,606 / 3,760,437; actual gas
96,586 / 566,036 / 2,175,953; all 1/8/32 settle. Fee-oracle/price/priority fees
are synthetic (cap unchanged), not live Base measurements. This direct harness
is not proxy/full-battle/ACS proof. Parent integration owns the reproducible
`scripts/mission-batch-anvil-proof.ts`; actual mixed combat/proxy and keyless Base
fee simulation remain release gates.

## Durability and operations

The existing mission/randomness coordinator owns all signing leases. Before send,
SQLite FULL synchronous durable intent records exact membership, nonce and locally
computed signed hash. Signed bytes/private keys are never persisted or logged.
Ambiguous RPC acceptance, crash before/after send, unknown receipt and reorg block
all shared-signer writers (including randomness). No blind resend, replacement or
stale cancellation is allowed for an unfinalized batch. Hash-keyed history never
overwrites older membership. The migration preserves old reconciled rows as
unfinalized confirmed intents. Before every writer, under the shared lease, all
unfinalized hashes are checked against receipt canonical block hashes, the explicit
RPC finalized block, and persisted per-leg membership. Canonical but unfinalized
intents retain protection while later nonces can progress. The mission client
registers this reader for sibling randomness/moon writers; standalone processes
without a batch reader fail closed until the batch owner finalizes. Empty queues
also reconcile. Only explicit finalized-block evidence retires global reorg
checks; history is retained even then and nonce regression/gap cancellation cannot
overlap it. Unknown/orphaned receipts retain the intent and require explicit
operator recovery, never arbitrary reuse. A canonical success **or revert** receipt consumes the
nonce; per-leg state determines work remaining. If a crash occurred before actual
send or a tx was dropped, missing receipt intentionally needs operator reconciliation;
never delete the journal to force a retry or broadcast another nonce blindly.

Telemetry: `mission_batch_prepared` (fill/queue age/estimates/max fees),
`mission_batch_receipt` (status/gas/execution plus available L1/operator fees),
`mission_batch_outcomes` (requested vs canonically settled legs),
`mission_batch_skip`, `mission_batch_indivisible_blocker` and
`mission_batch_blocked`. Per-leg event outcomes, error selectors, canonical
completion and eligibility blocker IDs are persisted/re-read after restart.
Raw Base RPC hex quantities are normalized to bigint. Actual operator fees use
the receipt field or the fork-aware oracle at the canonical receipt block.
Unavailable fee components and total are null, never invented zero or concatenated
hex strings. Receipt totals are wei, not an immutable inclusion-time USD guarantee.
