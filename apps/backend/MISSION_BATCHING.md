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
- `VEYDRIFT_MISSION_BATCH_MAX_USD`: default 1.00; may lower, never exceed the $1 batch guard. (Single-call resolver writes have their own fixed $0.50 cap.)
- `VEYDRIFT_MISSION_BATCH_ETH_USD_FEED`: optional override. Defaults to Chainlink ETH/USD on Base (`0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`) and Base Sepolia (`0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1`). No stale price fallback.
- `VEYDRIFT_MISSION_BATCH_PRICE_MAX_AGE_SECONDS`: default 3600, range 1–3600. The Base ETH/USD feed heartbeat is 20 minutes, so a stricter age blocks most quotes.

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
review, never raising the cap or splitting mission semantics. Capacity retries use
the 30–300-second backoff; unpaid ordering/oracle waits retry on a flat 30 seconds, a
Progress leg (staged battle) is resent next tick, and an already-settled leg is success.
Final canonical membership change aborts and repacks next tick rather than signing
stale calldata.

Gas does NOT use eth_estimateGas(success): caught OOG/no-op is still RPC success.
An explicit eth_call at min(Base 2^24,current block gas) returns gross internal
execution gas. Add intrinsic/calldata, EIP150 (64/63), 120k proxy/tail reserve and
8k/item overhead, then 20% margin: the minimum signed gas. Staged battles use whatever
gas they get and only start another stage with headroom left, so the signed gas is as much
as the USD cap affords up to the Base/block cap (unused gas is not charged), never below
that minimum. A battle that cannot finish even at the cap (Progress) may shrink below the
minimum to fit the USD cap instead of being excluded. The EXACT signed
gas/nonce/fees/value/calldata is re-simulated at the same block and every leg must
still be productive (Settled or Progress; Settled may become Progress).
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
USD exchange rate at eventual inclusion. The $1 limit is a fresh conservative
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
`scripts/mission-batch-anvil-proof.ts`. A separate production-packer/quote proof now
uses the actual compiled Game/module/Transparent-proxy graph: two unrelated due
returns plus counterplay combat settle together at 14,921,654 selected gas and
11,780,261 receipt gas. Reference survivors/losses/debris and no double credits
pass. See `scripts/mission-batch-mixed-proxy-proof.md`; the normal contract test
gate regenerates the ignored fixture state and runs that proof once (CI shard 1).
Those prices remain synthetic, not live Base estimates. Read-only live Base fee
component sampling and keyless upgrade/fork proofs are recorded in
`packages/contracts/manifests/vey-918-upgrade-handoff.md`. The candidate price feed
was 225 seconds old; the feed's 20-minute heartbeat is why the default age is now one
hour. Batching stays disabled until `VEYDRIFT_MISSION_BATCH_ENABLED=true`.

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

### Bounded finality and backpressure

Per signer, admit at most **32 unfinalized batch intents** (not 32 total historical
transactions). The partial unfinalized nonce index is explicitly selected by SQL;
queries load at most 33 rows, never scan finalized lifetime history. At capacity,
new batch preparation/signing stops before nonce allocation; sibling randomness/
moon writes can proceed only after checking **every** retained unfinalized intent.
A pre-upgrade journal larger than 32 can retire up to 32 finalized rows per pass,
but the pass always rejects admission if any rows were outside its checked page.
Repeat reconciliation to drain it; never delete hashes/membership or skip a page.

Each leased reconciliation pass has a **5,000 ms monotonic deadline** and **128
read-work-unit ceiling**. Reads are sequential. Warm durable outcomes need exactly
one containing-block hash check per receipt plus **one shared finalized-head read
per pass**: 32 receipts = 33 reads, including after restart. First/missing hydration
reads receipt/logs, canonical per-leg state/eligibility and fees once, persists the
outcomes, and emits receipt telemetry once (a crash before persistence may repeat
it). Later passes do not rehydrate or re-log receipt/member/fee history and do not
append redundant confirmation audits. Block-hash mismatch still blocks all writers;
no cached evidence substitutes for fresh canonicality. All immutable history remains
available for nonce-regression/gap recovery guards.

A work unit is one client read; pinned canonical mission reads use one RPC plus at
most one DefenseHold storage RPC (and existing bounded transport retries). Thus
128 units bound application fanout, not exact wire retry count. There is only one
underlying read in flight per coordinator/signer. If transport cannot be cancelled,
the timeout releases the lease and invalidates all continuations: no late outcomes,
telemetry, DB writes, follow-up legs or broadcasts. Its unresolved handle blocks
further reconciliation in that coordinator rather than accumulating abandoned
promises. A sibling process can acquire the lease, but must prove the same history
within its own bounds; unavailable evidence never authorizes a nonce. Underlying
HTTP retries may finish independently; no application work follows late results.

Defaults are conservative cadence budgets, not claimed Base latency measurements:
32 warm receipts require 33 reads (99 across three passes), versus the previous
roughly 3,456 full-hydration reads across three passes. The 128-unit allowance fits
31 warm receipts + one worst-case 32-leg incomplete cold receipt (99 units;
up to 131 underlying calls with all DefenseHold second reads, before retries).
At one batch per five-second tick, admission saturates in about 160 seconds without
finality: deliberate backpressure, **not** a promise to sustain that rate across
normal Base finality lag. Five seconds bounds an individual reconciliation lease
hold, not packing/confirmation or the whole tick; synchronous SQLite busy handling
and event-loop scheduling can add latency. Production sizing/throughput needs
measurement and separate review, not automatic limit increases.

Local regression measurements: 32 warm receipts = 33 reads, zero member/fee reads;
100 legacy receipts = at most 32 checks/33 reads per pass with no admission beyond
unchecked history; cold work stops at exactly 128 units and retries reuse completed
receipt hydration. 25 ms test deadlines release the lease, block repeated unresolved
reads, and reject late finality/member results without journal writes or sends.
The resolver_reconciliation_blocked event reports checked/retained lower bound,
work count, duration, limits, reason and operator action. Window-full: wait for
explicit finality while continuing empty-queue reconciliation. RPC/deadline/
unresolved: repair RPC or wait for its outstanding read, then retry. Reorg/missing
receipt: preserve the journal and perform explicit canonical operator recovery;
never broadcast blindly.

Telemetry: `mission_batch_prepared` (fill/queue age/estimates/max fees),
`mission_batch_receipt` (status/gas/execution plus available L1/operator fees),
`mission_batch_outcomes` (requested vs canonically settled legs),
`mission_batch_skip`, `mission_batch_indivisible_blocker` and
`mission_batch_blocked`. Per-leg event outcomes, error selectors, canonical
completion and eligibility blocker IDs are persisted/reused after restart; only
canonicality/finality evidence is refreshed every pass.
Raw Base RPC hex quantities are normalized to bigint. Actual operator fees use
the receipt field or the fork-aware oracle at the canonical receipt block.
Unavailable fee components and total are null, never invented zero or concatenated
hex strings. Receipt totals are wei, not an immutable inclusion-time USD guarantee.
