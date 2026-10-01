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

Uses `resolveFleetMissionBatch((uint256 missionId,uint8 leg)[] items)`,
arrival=0, return=1. No generic multicall. Per-item contract events are compatible
with the existing indexer's canonical mission events; the service reconciles each
requested leg from storage, not from receipt success. Returned items are not
claimed settled merely because a transaction mined. Contract ABI/bound/event
compatibility must be checked against the integrated contract head before release.

Read fresh canonical status/due timestamps, sort dueAt, then 905 arrival-before-return
same-timestamp rule, then numeric mission ID. Never group all arrivals before returns.
905's prospective/legacy mixed-generation boundary is unchanged; no retroactive
ordering guarantee or mission migration. Contract ordering guards remain the
security boundary, including when an oversized/not-ready earlier mission is omitted.

## Packing and exposure

One bounded candidate window (100), greedy exact-calldata estimates, at most 2N
packing estimates plus final leased re-estimate, one transaction per 5-second tick.
No delay waiting to fill a lone due item. Mixed-cost candidates can fill gaps after
an indivisible oversized mission; its explicit blocker event asks for gas/prerequisite
review, never raising the cap or splitting mission semantics. Candidate retries use
existing 30–300-second backoff. Final canonical membership change aborts and repacks
next tick rather than signing stale calldata.

Gas uses measured exact calldata +20%, bounded by Base 2^24 and current block gas.
Signed maxFeePerGas is 2*baseFee+tip. L1 data uses the greater of exact unsigned
serialized-transaction getL1Fee and getL1FeeUpperBound(size), with 2x headroom.
Operator cost uses GasPriceOracle.getOperatorFee(safetyGas), with 2x headroom;
this oracle supports current fork-specific formulas. Every read is fail-closed,
including missing operator support. A block older than 30 seconds is rejected.
Fresh positive completed ETH/USD rounds convert total exposure using integer
arithmetic rounded upward. Quotes are re-read under the nonce lease before signing.

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
size. Contract gas/mixed ACS benchmarks and keyless Base simulation remain release gates.

## Durability and operations

The existing mission/randomness coordinator owns all signing leases. Before send,
SQLite FULL synchronous durable intent records exact membership, nonce and locally
computed signed hash. Signed bytes/private keys are never persisted or logged.
Ambiguous RPC acceptance, crash before/after send, unknown receipt and reorg block
all shared-signer writers (including randomness). No blind resend, replacement or
stale cancellation is allowed for a pending batch. Empty candidate queues still
reconcile pending hashes. A canonical success **or revert** receipt consumes the
nonce; per-leg state determines work remaining. If a crash occurred before actual
send or a tx was dropped, missing receipt intentionally needs operator reconciliation;
never delete the journal to force a retry or broadcast another nonce blindly.

Telemetry: `mission_batch_prepared` (fill/queue age/estimates/max fees),
`mission_batch_receipt` (status/gas/execution plus available L1/operator fees),
`mission_batch_outcomes` (requested vs canonically settled legs),
`mission_batch_skip`, `mission_batch_indivisible_blocker` and
`mission_batch_blocked`. Missing receipt fee fields are null, never invented zero.
