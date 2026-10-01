# VEY-KANEO-918 — contract batch resolution handoff

## Authorization / release ownership
This is not approval. Parent owns PR, exact-head independent Astra/high review and green CI. No live action, signing or broadcast performed here. Separate Nikita exact-ticket/PR/head greenlight in upgrades topic 4042963 is mandatory. 905's released commit d0510634 and its approval do not authorize 918.

## Actual source and module graph
Game adds a typed batch selector and the batch-result event to its ABI. Its arrival dispatcher moves without changing dispatch/guard semantics to the existing embedded BatchTransport module; that module now receives the same Gameplay, Colonization, DefenseHold and PlanetManagement immutable addresses in its constructor. Game's public constructor ABI and canonical UpgradeGame.s.sol deployment graph remain unchanged: construction deploys embedded BatchTransport automatically. Those child implementations, their behavior and Moon source are unchanged. Game single/manual/lazy arrivals still use identical chronology and pause guard before dispatch; return entrypoint remains unchanged. Batch uses sender-preserving delegatecall through the Game facade, not an externally privileged self-call. **Only Game proxy changes; no Moon proxy upgrade.** Use the canonical full graph/dependency checks, not a hand-wired implementation that omits embedded BatchTransport.

No storage field/struct/layout change. Chronology remains prospective-only: existing 905-registered active missions retain registration and dependencies; pre-905 unregistered missions stay legacy. No new activation, reset, relabeling, backfill or migration. Mixed legacy/new ordering limitations documented by 905 remain. Scheduled order remains timestamp, kind (arrival before return before hold expiry), final ID tie, with actual planet/moon identity and ACS shared battle relationships. Calldata order never overrides the canonical guard.

## ABI / semantics
See vey-918-interface-note.md. Every valid call emits one FleetMissionBatchItem per requested occurrence including duplicate/invalid/skipped occurrences. Settled only follows canonical status transition for that leg; Progress (new ordinal 7) reports persisted scan/prerequisite/round advancement without leg settlement; Pending now means no observed canonical advancement. The return tuple adds executionGasUsed; see interface note for exact gross measurement boundary and required selected-gas re-simulation. AlreadySettled includes stale/terminal arrival or a terminal mission with no remaining return. Return while Outbound is Pending. Invalid leg/unknown ID is Invalid. NotDue uses arrivalAt, returnAt or DefenseHold holdUntil. Failed captures only first 4 revert bytes; zero means empty/OOG (not necessarily a semantic failure). Whole-call pause/length/ABI validation and outer OOG remain atomic reverts. Consumers must re-read canonical status, especially because another item may settle the leg after its own Pending result.

## Gas envelope / boundedness
32 items maximum, no generic arbitrary-call input. Child allowance <=15,000,000, cumulative measured work window <=15,500,000, <=32 bounded status/event tails. Caller-gas reserve 60,000+12,000 per remaining item includes EIP-150 and outcome copy; allowances shrink to available gas. Under 100,000 allowance skips as GasLimited. Child delegatecall uses output length zero and copies only four revert bytes: no unbounded outer returndata allocation. Canonical internal production, earlier-return settlement and nested combat rounds all consume the same child allowance. Thus gas, not the number of visible items, caps recursive/internal work; failure rolls back that child's state while prior independent successes survive.

This is not a universal completion budget. A canonical round/finalization larger than the available allowance must be surfaced as a keeper blocker; never raise fee or transaction limits silently. Low-gas eth_estimateGas can find a successful Pending/GasLimited receipt: use exact selected calldata plus explicit candidate gas, inspect simulated outcomes/canonical progress, and bound shrinking. An expensive/poisoned first item can leave later items gas-limited; reselect unrelated bodies on subsequent polls rather than persistently retrying poison first. Canonical dependency guards still prevent later dependent settlement. Single-item/direct fallback remains available under its existing policy, not automatic permission to bypass the batch fee cap.

## Rollout and rollback limits
1. Review exact combined contract+consumer head; collect offline gates and separate trusted-RPC keyless canonical-script/fork evidence with real deployment dependencies before release approval. No live-fork proof is claimed by local fixtures.
2. Deploy compatible consumers first, disabled/fail-closed until new selector support is verified; retain single-leg compatibility and reconcile previous pending nonce before mode switch. US$0.50 policy is provisional and not spending permission; QA US$0.20 remains separate.
3. After recorded greenlight only, canonical Game upgrade with empty calldata/fresh embedded module, tx journal/receipt reconciliation. No Moon change or backfill transaction. Verify pointers, pause, ownership, old/new mission bytes and new selector; update reviewed deployment manifest and run standard postdeploy smoke.
4. Enable bounded batches after consumer readiness; reconcile actual per-leg outcomes, not receipt success. Dedicated QA follows parent handoff.

Rollback to released 905 Game is storage compatible but removes batching: first disable batch sends, reconcile any pending transaction, then separately authorize the rollback. Settlement already committed cannot be undone; no resource/ship state reset or chronology migration is safe. Never roll back across 905's chronology boundary to legacy writers.

## Prior implementation offline evidence (before productive-measurement correction)
Commands run from packages/contracts, default solc 0.8.28 optimizer runs=1/viaIR. Final logs:
- forge test --match-path test/VeydriftMissionBatch.t.sol -vv: 12 passed, /tmp/vey918-batch-final.log. Additional --isolate: 12 passed, /tmp/vey918-batch-isolated.log.
- forge test --match-path test/VeydriftFleetChronology.t.sol: 17 passed, /tmp/vey918-chronology-final.log.
- forge test --match-path test/VeydriftGame.t.sol: 308 passed, /tmp/vey918-game.log.
- forge test --match-path test/VeydriftMoonSystem.t.sol: 82 passed, /tmp/vey918-moon.log.
- forge test --match-path test/VeydriftCombatReferenceParity.t.sol -vv: 20 passed, /tmp/vey918-parity-final.log. Additional --match-test testBatch --isolate: 3 passed, /tmp/vey918-parity-isolated.log.
- forge test --match-path test/VeydriftLiveUpgradePolicy.t.sol: 4 passed, /tmp/vey918-upgrade-policy-tests.log.
- forge test --match-path test/VeydriftScheduledReturns.t.sol -vv: 34 passed, /tmp/vey918-scheduled-final.log. Additional --match-test testBatch --isolate: 8 passed, /tmp/vey918-scheduled-isolated.log. Total focused correctness: 477 tests passed, plus 23 isolated reruns.
- forge test --match-path test/VeydriftMissionBatch.t.sol --match-test testMaximumCount --gas-report: pass, /tmp/vey918-gas-report.log; reported batch function gas 15,661,617.
- bun run check:upgrade-sizes: pass, /tmp/vey918-sizes-final.log. Runtime/init bytes: Game 24,279/44,343 (297 runtime bytes headroom), BatchTransport 18,601/19,080. Gameplay unchanged 24,538; Moon unchanged 23,937.
- bun run check:storage: pass, /tmp/vey918-storage.log; live v1/reviewed appends exactly match, no storage changes.
- forge lint src/VeydriftBatchTransportModule.sol src/VeydriftGame.sol src/libraries/VeydriftTypes.sol --severity high med --skip test --skip script -D warnings: pass, /tmp/vey918-lint-final.log.
- node scripts/check-live-upgrade-policy.mjs: pass, /tmp/vey918-policy-final.log. forge fmt --check and git diff --check pass.

## Measured gas / capacity (not a universal estimate)
All calls explicitly cap forwarded gas at 16,500,000, except the deliberate 4,000,000 partial-round probe. Isolated measurements use cold/committed state; logged execution-call deltas exclude L1/operator fees and are not USD estimates. Add calldata/intrinsic and a safety margin in keeper exact-transaction simulation. Fixtures use the actual Game/modules; poison uses a dedicated failure harness.

| Mix | Isolated execution gas | Settlement |
|---|---:|---|
| ACS 1,000+1,000 battleships / 500 launchers | 1,396,477 | lead settled; premature return not credited |
| Counterplay: 10 battlecruisers /100 heavy fighters +1 battleship | 10,195,465 | lead settled |
| Same counterplay, explicit low-gas partial then full allowance | 3,190,065 + 8,418,108 | persisted rounds then settled; exact reference survivors/losses/debris |
| Reverse earlier return + later combat, planet / moon | 7,154,375 / 7,265,535 | earlier return included in combat snapshot |
| Reverse later return + earlier empty-body combat, planet / moon | 1,247,061 / 1,316,266 | initially blocked return, then combat, then return |
| 32 independent cheap returns | 4,903,117 | all 32 credited in one receipt |
| 32 same-body cheap returns | max 5,329,441 per batch; 30 batches | all 32 returned; no double credit; preparatory outcomes not counted |
| 32 poison occurrences | 15,669,715 | one outcome each, final GasLimited, below 16M |
| Poison then independent return | 15,078,901 | failed child isolated, independent return settled |

The same-body benchmark exposes 905 scan invalidation costs honestly: 32 items is a calldata/result limit, not 32 guaranteed credits. Keeper should prefer fresh dependency-valid bodies and must measure/reconcile preparation. Low 4M allowance can persist early rounds but later stall on an indivisible round/finalization; tests finish using the supported batch envelope, without raising the real 15M child or Base transaction cap. No fee-cap permission follows from these gas results.

## Concrete release blockers / exclusions
No live fork or canonical UpgradeGame script dry run was executed. No production sign/broadcast/merge/push. Exact-head independent combined review, CI and trusted-RPC keyless release proof remain parent/release-owner gates.

The repository's unrelated Uniswap launch manifest gate is already stale relative to landed 905: manifest sourceCommit d7ee5def8ece13052d4a1b4bf7a1e335f39be479 versus latest contracts commit d0510634a242be27dfb72ef4f29947f442d1ff2b. bun run manifest:check and manifest:test fail that provenance check (/tmp/vey918-manifest-final.log, /tmp/vey918-manifest-tests.log). Do not rewrite sourceCommit to fabricate fork evidence. The initial missing viem dependency was resolved by a local ignored symlink to installed viem 2.52.0; no lockfile/dependency changed. Parent must regenerate real reviewed fork manifest if that CI gate applies.

## Productive-measurement correction evidence
Implementation commit: bb35a88d4f536e97a948a6b66f5e75a40497ee6e, contracts-only. No storage change; Game runtime remains 24,279 bytes (297 headroom), init 44,592; BatchTransport runtime/init 18,850/19,329. Fixed-size progress fingerprint adds 249 runtime bytes to the embedded module, none to Game runtime.

Local correctness and storage validation completed successfully. No production, signing, RPC, push or deployment performed. Parent owns independent exact-head review.

Measurement-test accounting note: initial isolated-only wrapper assertions incorrectly compared pre-refund module gas against Foundry’s post-refund caller gas. A bounded diagnostic confirmed `lastCallGas.gasTotalUsed=163709`, `gasRefunded=40927`, versus module measurement 181445. Tests now restore the reported refund for a conservative gross upper bound, following the existing Game/Moon gas checks; no product envelope/Base cap was raised. Final normal and isolated runs supersede those diagnostic failures.

Final local commands and logs (from packages/contracts):
- `forge test --match-path test/VeydriftMissionBatch.t.sol -vv`: 16 passed, `/tmp/vey918-measured-batch.log`; same command with `--isolate`: 16 passed, `/tmp/vey918-measured-batch-isolated.log`.
- `forge test --match-path test/VeydriftScheduledReturns.t.sol -vv`: 34 passed, `/tmp/vey918-measured-scheduled.log`; `--match-test testBatch --isolate -vv`: 8 passed, `/tmp/vey918-measured-scheduled-isolated.log`.
- `forge test --match-path test/VeydriftCombatReferenceParity.t.sol -vv`: 20 passed, `/tmp/vey918-measured-parity.log`; `--match-test testBatch --isolate -vv`: 3 passed, `/tmp/vey918-measured-parity-isolated.log`. Partial-round test proves rounds really advance, then two 500k successful no-op calls remain Pending with unchanged rounds, then full allowance completes exact reference parity.
- `forge test --match-path test/VeydriftFleetChronology.t.sol`: 17 passed, `/tmp/vey918-measured-chronology.log`; `forge test --match-path test/VeydriftLiveUpgradePolicy.t.sol`: 4 passed, `/tmp/vey918-measured-upgrade.log`. Total: **91 focused tests plus 27 isolated reruns**.
- `bun run check:storage`: passed, `/tmp/vey918-measured-storage.log`; unchanged reviewed layout.
- `bun run check:upgrade-sizes`, strict source `forge lint ... --severity high med --skip test --skip script -D warnings`, `forge fmt --check`, live upgrade policy, and `git diff --check`: passed; logs `/tmp/vey918-measured-{sizes,lint,format,policy}.log`. ABI manifest deep-equals the corresponding compiled Game ABI entries (`/tmp/vey918-measured-abi.log`).

Returned **gross internal execution measurements** from isolated fixtures (not caller deltas, gas limits or USD quotes):
| Fixture | executionGasUsed | Result |
|---|---:|---|
| Two cheap harness returns | 181,445 | Both Settled |
| ACS battle | 1,511,966 | Settled |
| Counterplay battle | 10,325,351 | Settled |
| 4M partial-round call, then 16.5M completion | 3,197,254 / 8,472,492 | Progress with actual rounds / Settled |
| Earlier return then combat, planet / moon | 7,502,522 / 7,613,661 | Progress prerequisite / Settled |

Maximum-count gas-poison caller delta is 15,734,517; all 32 outcomes emitted, below existing 16M test bound. Real-stack tests also assert a conservative gross upper bound below Base 16,777,216 minus 50,000 intrinsic headroom. The original 15M child / 15.5M shared limits were not changed.
